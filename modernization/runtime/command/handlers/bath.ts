/**
 * Phase 7.2 — `COMF431 お風呂でくつろぐ` (relax in the bath), faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF431 お風呂でくつろぐ.ERB`.
 *
 * The bath mechanism lives in `runtime/state/bath.ts` (`@ODEKAKE_OFURO`);
 * this handler is the `@COM_ABLE431` execCheck + the `@COM431` orchestration
 * (BathType selection → ODEKAKE_OFURO master → ODEKAKE_OFURO target if
 * 態度>0 & awake → TIME+30). Place predicates come from the Phase 7.1a
 * `location-predicates.ts` (`BATHCHECK` / `PLACE_SENTO` / `AT_HOME` /
 * `OPENPLACE` / `IS_GAP_GUEST`).
 *
 * **execCheck (`@COM_ABLE431`), faithful:**
 *   - `FLAG:70` 時間停止 → block; `CFLAG:睡眠`/`陪睡中` → block.
 *   - `!BATHCHECK(loc) && !IS_GAP_GUEST`: needs 簡易泳池 ITEM + summer
 *     (`DAY:2==2`) or 温水機能 (`FLAG:泳池 bit1`) + `OPENPLACE==2` (spacious
 *     outdoor) + `AT_HOME`. **Pool arm deferred** (簡易泳池 ITEM + FLAG:泳池
 *     not modeled) → block when not at a real bath. (Gap-guest arm deferred
 *     too, so the whole non-bath branch blocks — faithful, not a stub.)
 *   - `PLACE_SENTO(loc)` → block (use COMF432 銭湯 instead).
 *   - `CFLAG:诶嘿嘿==2` → block.
 *
 * **@COM431 body, faithful:**
 *   - 入浴 interval gate (`EX:上次的入浴時间`): the魔改 replaced `< 360` with
 *     `< 0`, so it never trips (monotonic tickValue) → no cooldown.
 *   - BathType: `BATHCHECK(loc)` → 1 (real bath); else → 3 (pool). Since the
 *     execCheck pool arm blocks, only BathType 1 reaches the body live.
 *   - `CFLAG:MASTER:風呂 = 0` (clear at real bath).
 *   - `ODEKAKE_OFURO(MASTER, BathType)`.
 *   - If `TARGET > 0 && CFLAG:TARGET:態度 > 0 && !睡眠`: `ODEKAKE_OFURO(TARGET, BathType)`.
 *   - `TIME += 30`.
 *
 * **DEFERRED:** 簡易泳池 arm (ITEM:簡易泳池 + FLAG:泳池 bits + summer gate —
 * the whole non-bath path), STAIN reset (no STAIN namespace), 桧木浴室 bonus,
 * 銭湯/温泉 display variants (`COM431_DISPLAY`), the pool STAIN arm, KOJO.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { computeAttitude } from "../../state/attitude.js";
import {
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import {
  bathCheck,
  placeSento,
  isGapGuest,
} from "../../world/location-predicates.js";
import {
  applyBath,
  BATH_TYPE_BATH,
  BATH_TYPE_POOL,
  minutesSinceLastBath,
} from "../../state/bath.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE431` core (ERB 67-104)
// ---------------------------------------------------------------------------

function checkBathRelax(state: GameState):
  | { ok: true }
  | { ok: false; reason: { kind: "precondition"; message: string } } {
  const loc = state.master.location;

  // ERB 73: FLAG:70 時間停止 → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  // ERB 75-77: 睡眠 / 陪睡中 → block (CFLAG on master).
  if (getMasterCflag(state, CFLAG_ID.睡眠) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中。" } };
  }
  if (getMasterCflag(state, CFLAG_ID.陪睡中) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "陪睡中。" } };
  }

  // ERB 79-94: お風呂のある場所以外は不可 (unless IS_GAP_GUEST).
  // !BATHCHECK(loc) && !IS_GAP_GUEST → needs 簡易泳池 pool arm (deferred).
  if (!bathCheck(state, loc) && !isGapGuest(state, 0)) {
    // Pool arm: ITEM:簡易泳池 + summer(DAY:2==2)||温水(FLAG:泳池 bit1)
    // + OPENPLACE==2 + AT_HOME. All pool preconditions deferred → block.
    return {
      ok: false,
      reason: { kind: "precondition", message: "这里没有浴室。" },
    };
  }

  // ERB 95: PLACE_SENTO → block (use COMF432 銭湯).
  if (placeSento(loc) !== 0) {
    return {
      ok: false,
      reason: { kind: "precondition", message: "在銭湯请使用入浴指令。" },
    };
  }

  // ERB 96: CFLAG:诶嘿嘿 == 2 → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是入浴的时候。" } };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM431` core (ERB 18-60)
// ---------------------------------------------------------------------------

export const bathRelaxHandlerEntry: HandlerEntry = {
  commandNo: 431,
  execCheck: (ctx) => {
    const r = checkBathRelax(ctx.state);
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

    // BathType: BATHCHECK → 1 (real bath); else 3 (pool). Pool arm can't
    // reach here (execCheck blocks it) but stay faithful to the select.
    const bathType = bathCheck(next, loc) ? BATH_TYPE_BATH : BATH_TYPE_POOL;

    // ERB 27: CFLAG:MASTER:風呂 = 0 at a real bath.
    if (bathType === BATH_TYPE_BATH) {
      next.master.state.CFLAG[CFLAG_ID.風呂] = 0;
    }

    // ODEKAKE_OFURO(MASTER, BathType).
    const master = applyBath(next, 0, bathType);

    // ODEKAKE_OFURO(TARGET, BathType) if TARGET>0 && 態度>0 && !睡眠.
    const target = ctx.target;
    let targetRecovered = false;
    if (target > 0 && next.charas[target]) {
      const t = next.charas[target]!;
      // 態度 derived on-demand (no persisted INFO refresh) — not stored CFLAG.
      const taido = computeAttitude(t, next.master, next);
      const sleeping = t.state.CFLAG[CFLAG_ID.睡眠] ?? 0;
      if (taido > 0 && sleeping === 0) {
        applyBath(next, target, bathType);
        targetRecovered = true;
      }
    }

    // ERB 59: TIME += 30.
    advanceTimeTicks(next, 30);

    const verb = bathType === BATH_TYPE_BATH ? "泡了个澡" : "在泳池放松了一会儿";
    const text = targetRecovered
      ? `和${next.charas[target]?.callName ?? `#${target}`}一起${verb}，恢复了体力与精力。（经过 30 分钟）`
      : `${verb}，恢复了体力与精力。（经过 30 分钟）`;
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text },
        // surface recovery for potential UI/testing (not consumed yet).
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: `体力+${master.stamina} 気力+${master.will}` },
      ],
      outcome: "ok" as const,
    };
  },
};
