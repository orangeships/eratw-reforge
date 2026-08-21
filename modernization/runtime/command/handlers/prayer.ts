/**
 * Phase 7 — `COMF421 願掛け` (shrine wish), MONEY-namespace C-tier command.
 *
 * Faithful to `ERB/コマンド関連/COMF/日常系/COMF421 願掛け.ERB`. The ERB
 * command is an `INPUT` menu offering ~15 options (0/1/2/3/10/15 money
 * options + 8 IKENIE 胖次 options + 21/30/35/40/50/60/66/300 subsystem
 * options). **This MVP wires only option 2 (心の平安)** — the most visible
 * effect (気力 +500) at the common price (3000 円), auto-selected. The
 * handler always picks option 2; the player's "choice" is reduced to
 * "pray or not".
 *
 * Option 2 (心の平安), ERB 72-80 + 155-156:
 *   1. `MONEY -= 3000`          (guard: `MONEY < 3000` → 金钱不足, re-prompt)
 *   2. `BUFF_BASE(MASTER, BASE_気力, 500)` — raises **both** MAXBASE:気力
 *      and BASE:気力 by 500 (COMMON.ERB:722-760; the BUFF accumulator is
 *      not modeled — nothing reads it yet).
 *   3. `FLAG:祈願内容 = 201`     (201 = 心の平安; gates same-day re-prayer)
 *   4. `FLAG:71 = 0`             (resets オナ禁 counter)
 *   5. `DOWNBASE:MASTER:気力 = 100`  (BASE:気力 -= 100)
 *   6. `TIME += 10`
 *   Net: BASE:気力 +400, MAXBASE:気力 +500, MONEY −3000.
 *
 * **DEFERRED (documented, same posture as cleaning/apologize):**
 *   - Option 0 (结缘, 1000 円) — `GANKAKE_0` 约会子系统 (chara picker).
 *   - Option 1 (精力精力超群, 3000 円) — `BUFF_BASE(精力,500)` +
 *     `FLAG:561`/`FLAG:71` 累加 + EXP:11 threshold branch.
 *   - Option 3 (胸部胸部, 3000 円) — `TFLAG:OPPAI = 1`.
 *   - Options 10/15 (内裤扫除 / H气氛) — only set `FLAG:祈願内容`.
 *   - 8 IKENIE 胖次 options (16/20/21/30/35/40/50/60/66/300) — 胖次子系统.
 *   - 黄金律 +30% (MAGIC_DLC) on `GET_MONEY_YEN` — N/A (this command only
 *     spends, never grants).
 *   - `天之声可(loc)` / `守矢神社本殿` 赛銭箱 predicate — uses the shared
 *     place-flag helper, including the player's exact home room after the
 *     panty-collection altar reward.
 *   - `TFLAG:100` menu-reach gate — not modeled (handlers are only invoked
 *     when reachable via the catalog).
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { canAfford, formatMoney, pay } from "../../state/money.js";
import { canHearHeaven } from "../../world/location-predicates.js";

// ---------------------------------------------------------------------------
// Constants — COMF421 option 2 (心の平安)
// ---------------------------------------------------------------------------

/** ERB 11/73: 心の平安 costs 3000 円. */
const COST_PEACE = 3000;
/** ERB 78: `BUFF_BASE(MASTER, BASE_気力, 500)` — 気力 buff magnitude. */
const BUFF_KIJIRYOKU = 500;
/** ERB 155: `DOWNBASE:MASTER:気力 = 100` — command 気力 cost. */
const COST_KIJIRYOKU = 100;
/** ERB 156: `TIME += 10` — minutes. */
const TIME_COST = 10;
/** ERB 79: `FLAG:祈願内容 = 201` (201 = 心の平安). */
const WISH_PEACE = 201;

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE421` (ERB 161-184)
// ---------------------------------------------------------------------------

function checkPrayerEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const master = ctx.state.master;

  // ERB 165: 時間停止中は不可 (`FLAG:70 == 1`).
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法祈愿。" } };
  }
  // ERB 171: すでに今日祈願してたら弾く (`FLAG:祈願内容 > 0`).
  if ((ctx.state.flagStore[FLAG_ID.祈願内容] ?? 0) > 0) {
    return { ok: false, reason: { kind: "precondition", message: "今天已经祈过愿了。" } };
  }
  // ERB 177: 賽銭箱 — `天之声可(現在位置) || 現在位置 == 守矢神社本殿`.
  // `天之声可` also opens the player's own room after ITEM:祭壇 (the
  // third panty-collection milestone) is awarded.
  if (!canHearHeaven(ctx.state) && master.location !== "守矢神社本殿") {
    return { ok: false, reason: { kind: "precondition", message: "只有在能听见天之声的地方才能祈愿（或拥有祭坛时回到自室）。" } };
  }
  // ERB 180: 気力0では不可 (`BASE:MASTER:気力 <= 0`).
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法祈愿。" } };
  }
  // ERB 182: `CFLAG:诶嘿嘿 == 2` blocks (deep H-scene).
  if ((master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是祈愿的时候。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM421` option 2 (心の平安), auto-selected
// ---------------------------------------------------------------------------

export const prayerHandlerEntry: HandlerEntry = {
  commandNo: 421,
  execCheck: (ctx) => {
    const r = checkPrayerEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);

    // ERB 73-76: 金钱不足 → re-prompt (here: noop, the command didn't fire).
    if (!canAfford(next, COST_PEACE)) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `金钱不足。“内心安宁”需要 ${formatMoney(COST_PEACE)}。`,
          },
        ],
        outcome: "noop" as const,
        failReason: { kind: "precondition", message: "金钱不足" },
      };
    }

    // ERB 77: `MONEY -= 3000`.
    pay(next, COST_PEACE);

    // ERB 78: `BUFF_BASE(MASTER, BASE_気力, 500)` — raises MAXBASE + BASE
    // (COMMON.ERB:734-735). The BUFF accumulator (line 736) is unmodeled.
    const kijiryokuBefore = getMasterBase(next, BASE_ID.気力) ?? 0;
    const kijiryokuMax = next.master.state.MAXBASE[BASE_ID.気力] ?? 0;
    next.master.state.MAXBASE[BASE_ID.気力] = kijiryokuMax + BUFF_KIJIRYOKU;
    setMasterBase(next, BASE_ID.気力, kijiryokuBefore + BUFF_KIJIRYOKU);

    // ERB 79: `FLAG:祈願内容 = 201`.
    next.flagStore[FLAG_ID.祈願内容] = WISH_PEACE;
    // ERB 80: `FLAG:71 = 0` (reset オナ禁 counter).
    next.flagStore[FLAG_ID.オナ禁] = 0;

    // ERB 155: `DOWNBASE:MASTER:気力 = 100`.
    setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - COST_KIJIRYOKU);
    // ERB 156: `TIME += 10`.
    advanceTimeTicks(next, TIME_COST);

    const netKijiryoku =
      (getMasterBase(next, BASE_ID.気力) ?? 0) - kijiryokuBefore; // +400
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%向赛钱箱投入了 ${formatMoney(COST_PEACE)}，双手合十祈求内心的平静。気力上升了 ${netKijiryoku}。`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
