/**
 * Phase 7.2 — `COMF432 銭湯` (public bath), faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF432 銭湯.ERB`.
 *
 * The bath mechanism (`@ODEKAKE_OFURO`) + `PLACE_SENTO` live in
 * `runtime/state/bath.ts` / `runtime/world/location-predicates.ts`; this
 * handler is the `@COM_ABLE432` execCheck + the `@COM432` 人里銭湯 branch
 * (the only branch reachable in the narrowed scope — 旧地獄温泉 is 地底,
 * out of scope). The 人里 branch is an interactive `INPUT` menu
 * [0 放棄 / 1 入浴(400円) / 2 包天(5000円)], modeled via the Wave 2c
 * `pick_one` prompt.
 *
 * **execCheck (`@COM_ABLE432`), faithful:**
 *   - `FLAG:70` 時間停止 / `CFLAG:睡眠` / `陪睡中` → block.
 *   - `!PLACE_SENTO(loc)` → block (only 銭湯 locations).
 *   - `FLAG:潜伏` bit0 → block.
 *   - `CFLAG:诶嘿嘿 == 2` → block.
 *   - `銭湯貸切(DAY)` (day-keyed rental) → block. **Deferred** (銭湯貸切
 *     SAVEDATA system not modeled) → treated as not-rented, so this gate
 *     never trips. Faithful for trial (no rental path exists).
 *
 * **prompt (`@COM432` 人里 branch,番台 normal):**
 *   - `TFLAG:大衆浴場FLAG == 4` (番台 furious) → `null` (handler refuses
 *     without a menu, ERB `RETURN -1`).
 *   - else → `pickOne` [0 放棄, 1 入浴(400円)]. **[2 包天 deferred]**
 *     (銭湯貸切 day-rental system not modeled; MAIN_MAP==2 always true at
 *     人里銭湯 in our string-location scope).
 *
 * **handler (`@COM432` 人里 branch), faithful:**
 *   - 入浴 interval (`EX:上次的入浴時间`, 魔改 `< 0`) — never trips.
 *   - `PLACE_SENTO(loc) != 2` → 旧地獄 (地底) deferred → blocked.
 *   - `TFLAG:大衆浴場FLAG == 4` → noop "番台在生气".
 *   - `requirePickOne`:
 *     - `0` 放棄 → noop (ERB `RETURN -1`; 番台 anger transition deferred).
 *     - `1` 入浴:
 *       - `MONEY < 400` → blocked "钱不够" (番台 anger transition deferred).
 *       - else `PAY_SENTO 400` (`MONEY -= 400`; `SENTO_CONSUMPTION` tracker
 *         deferred), `ODEKAKE_OFURO(MASTER,1)` + `ODEKAKE_OFURO(TARGET,1)`
 *         if `TARGET>0 && 態度>0 && !睡眠`, `TIME += 30`,
 *         `TFLAG:大衆浴場時限入湯回数 ++`, `TFLAG:大衆浴場FLAG = 1`.
 *
 * **DEFERRED:** 旧地獄温泉 branch (地底 map + 番台妖怪 + New-Plan subsystem),
 * 包天/銭湯貸切 day-rental, 番台 anger state machine (TFLAG:209 transitions
 * 2/3/4 on 放棄/金不足), SPTALK 番台 台詞, SENTO_CONSUMPTION accumulator,
 * STAIN reset (no STAIN namespace), KOJO.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import type { CommandContext } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { computeAttitude } from "../../state/attitude.js";
import {
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import { placeSento } from "../../world/location-predicates.js";
import { applyBath, BATH_TYPE_BATH, minutesSinceLastBath } from "../../state/bath.js";
import { canAfford, pay, formatMoney } from "../../state/money.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { TFLAG_ID, addTflag, getTflag, setTflag } from "../../state/tflag.js";

/** 入浴料金 (人里銭湯, ERB @COM432 line 49/98). */
const SENTO_FEE = 400;

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE432` core (ERB 332-360)
// ---------------------------------------------------------------------------

function checkSento(state: GameState):
  | { ok: true }
  | { ok: false; reason: { kind: "precondition"; message: string } } {
  const loc = state.master.location;

  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (getMasterCflag(state, CFLAG_ID.睡眠) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中。" } };
  }
  if (getMasterCflag(state, CFLAG_ID.陪睡中) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "陪睡中。" } };
  }
  // !PLACE_SENTO(loc) → block (only 銭湯 locations reach the body).
  if (placeSento(loc) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有銭湯。" } };
  }
  // FLAG:潜伏 bit0 → block.
  if (((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "潜伏中。" } };
  }
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是入浴的时候。" } };
  }
  // 銭湯貸切(DAY) → block; deferred (no rental system) → never trips.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// prompt — `@COM432` 人里 branch menu (ERB 46-51)
// ---------------------------------------------------------------------------

function sentoPrompt(ctx: CommandContext): PromptSpec | null {
  const next = ctx.state;
  // TFLAG:大衆浴場FLAG == 4 → 番台 furious, no menu (ERB RETURN -1).
  if (getTflag(next, TFLAG_ID.大衆浴場FLAG) === 4) return null;
  return pickOne("「……欢迎光临ー 入浴只要花400円就够了哦」", [
    { id: 0, label: "放弃" },
    { id: 1, label: `花费${formatMoney(SENTO_FEE)}入浴` },
    // [2] 包天 (5000円, MAIN_MAP==2) deferred — 銭湯貸切 day-rental system.
  ]);
}

// ---------------------------------------------------------------------------
// handler — `@COM432` 人里 branch core (ERB 38-117)
// ---------------------------------------------------------------------------

export const sentoHandlerEntry: HandlerEntry = {
  commandNo: 432,
  prompt: sentoPrompt,
  execCheck: (ctx) => {
    const r = checkSento(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const loc = next.master.location;

    // 入浴 interval (魔改 `< 0`, never trips for monotonic tickValue).
    if (minutesSinceLastBath(next) < 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "刚刚才进去过的。" }],
        outcome: "noop" as const,
      };
    }

    // 旧地獄温泉 (PLACE_SENTO==9, 地底) deferred → blocked.
    if (placeSento(loc) !== 2) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "旧地獄温泉尚未开放。" },
        ],
        outcome: "blocked" as const,
      };
    }

    // 番台 furious (TFLAG:209==4) → refuse without menu (ERB 41-45 RETURN -1).
    if (getTflag(next, TFLAG_ID.大衆浴場FLAG) === 4) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: "从前台那边飘来了尖锐的视线……还是改日再来比较好吧……",
          },
        ],
        outcome: "noop" as const,
      };
    }

    // B9: read the [0 放棄 / 1 入浴] pick.
    const spec = sentoPrompt(ctx);
    const picked = spec ? requirePickOne(spec, ctx.promptAnswer) : null;

    if (picked === 0) {
      // 放棄 (ERB 119-131 RETURN -1). 番台 anger transition (TFLAG:209=2) deferred.
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "放弃了入浴。" }],
        outcome: "noop" as const,
      };
    }

    if (picked !== 1) {
      // No valid answer → block (player must pick first).
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "还没决定是否入浴。" }],
        outcome: "noop" as const,
      };
    }

    // 入浴 (RESULT==1).
    if (!canAfford(next, SENTO_FEE)) {
      // ERB 100-113: 番台 anger transition (TFLAG:209=3 or 4) deferred.
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "钱不够，入浴需要400円。" },
        ],
        outcome: "blocked" as const,
      };
    }

    // PAY_SENTO 400 (MONEY -= 400; SENTO_CONSUMPTION tracker deferred).
    pay(next, SENTO_FEE);

    // ODEKAKE_OFURO(TARGET,1) if TARGET>0 && 態度>0 && !睡眠 (ERB 94-96).
    const target = ctx.target;
    let targetRecovered = false;
    if (target > 0 && next.charas[target]) {
      const t = next.charas[target]!;
      // 態度 derived on-demand (no persisted INFO refresh) — not stored CFLAG.
      const taido = computeAttitude(t, next.master, next);
      const sleeping = t.state.CFLAG[CFLAG_ID.睡眠] ?? 0;
      if (taido > 0 && sleeping === 0) {
        applyBath(next, target, BATH_TYPE_BATH);
        targetRecovered = true;
      }
    }

    // ODEKAKE_OFURO(MASTER,1).
    const master = applyBath(next, 0, BATH_TYPE_BATH);

    // TIME += 30 (大衆浴場は30分固定, ERB 109).
    advanceTimeTicks(next, 30);

    // TFLAG:大衆浴場時限入湯回数 ++ (ERB 111).
    addTflag(next, TFLAG_ID.大衆浴場時限入湯回数, 1);
    // TFLAG:大衆浴場FLAG = 1 (大衆浴場FLAG, ERB 113).
    setTflag(next, TFLAG_ID.大衆浴場FLAG, 1);

    const text = targetRecovered
      ? `和${next.charas[target]?.callName ?? `#${target}`}一起在銭湯泡了个澡，恢复了体力与精力。（花费${formatMoney(SENTO_FEE)}円，经过 30 分钟）`
      : `在銭湯泡了个澡，恢复了体力与精力。（花费${formatMoney(SENTO_FEE)}円，经过 30 分钟）`;
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text },
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: `体力+${master.stamina} 気力+${master.will}` },
      ],
      outcome: "ok" as const,
    };
  },
};
