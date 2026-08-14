/**
 * Slice O2 — COMF617 甘味処へ誘う (invite to sweet shop).
 *
 * Modern equivalent of `@COM617` (`ERB/コマンド関連/COMF/外出系/COMF617 甘味処へ誘う.ERB`).
 * A date-meal variant of COMF610: same RAND:100 success-tier shape + identical
 * SOURCE assembly (歓楽/情愛 + 欲望/奉仕精神/好感度 ladders + 受動/征服), but
 * with smaller RECOVER_PERMIL (100/400/50‰ vs 610's 150/300/100) and
 * `満腹度上昇 "甜点"` (dessert hunger clock) instead of "主食". Costs
 * 3000円 (same as 610).
 *
 * Reachability:
 *   - `CHK_DATENOW(CFLAG:12)` — must be on a date map (set by 405 / O1).
 *   - `!TARGET` → block (needs a co-present date target).
 *   - `@SWEETS_SHOP(MASTER:現在位置)` — must be at a sweet shop location.
 *     Upstream arms: 広場 (P201=人間の里 gate, room 215 in our strings)
 *     + 魔界都市 (unbuilt, out of scope) + 217 甜品店 + 1106 魔界商贸城
 *     (unbuilt). MVP implements the human-village arms; defer the unbuilt
 *     arms rather than fabricating locations.
 *   - `!TIME_PROGRESS(TCVAR:甜点空腹時刻)` — must be hungry for sweets.
 *   - `MONEY >= 3000` (single date) / MOREDATE money gate deferred.
 *   - `!睡眠` / `!FLAG:時間停止` (FLAG:70).
 *
 * Source assembly: identical to 610 (歓楽/情愛 ladder, 好感度 ladder, 受動/
 * 征服). The only meaningful structural difference from 610 is RECOVER +
 * 満腹度. Reuses `compute610Tier` + `compute610Sources` from date-meal.ts;
 * a small local `apply617Tier` mirrors 610's tier TIMES + 情緒BONUS (no
 * talent:15 (機嫌) write — 617 doesn't bump it, that's 610's 大成功 bonus
 * in the ERB).
 *
 * DEFERRED:
 *   - `MOREDATE` group-date arm → `MOREDATES_COM617` (faithful; gates
 *     `MONEY >= 1500 + 1500*NumberOfDates` upstream).
 *   - MAGIC_DLC_大成功相关 `LOCAL:2 += SQRT(ABL:亲密) + MAGIC_SuccessRate/20`
 *     great-success boost.
 *   - 広場 vs SWEETS_SHOP_PICKER variation: upstream `MOREDATE` and 616
 *     special-cases — none in MVP.
 *   - `SWEETS_SHOP` 魔界都市 / 1106 魔界商贸城 arms (unbuilt).
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { isHungryFor, riseFullness } from "../../state/dish.js";
import { canAfford, pay } from "../../state/money.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  palamLevel,
  recoverPermil,
  times,
} from "../../state/settlement.js";
import { chkDateNow } from "../../world/location-predicates.js";
import {
  compute610Tier,
  compute610Sources,
} from "./date-meal.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

const SWEETS_COST = 3000; // 円 — same as 610.
const DESSERT_FULLNESS = 360; // 主食 = 360; desserts use the same 満腹度 base.

// ---------------------------------------------------------------------------
// SWEETS_SHOP — faithful arm subset (人間之里 only; 魔界 deferred).
// ---------------------------------------------------------------------------

/**
 * `@SWEETS_SHOP(ARG)` (COMF617.ERB:170) — the set of locations where the
 * 甘味処 is available. Upstream arms: 広場 (P201=人間の里 gate) / 217
 * 甜品店 (in-home) / 魔界都市 (unbuilt) / 1106 魔界商贸城 (in-home,
 * unbuilt). MVP implements the two human-village arms; the unbuilt arms
 * are documented deferrals (not silent stubs — the predicate returns
 * `false` so 617 blocks faithfully outside the modeled locations).
 */
export function sweetsShop(location: string): boolean {
  if (location === "人間之里") return true; // 広場 / P201 gate
  if (location === "人間之里:甜品店") return true; // 217
  return false;
  // 魔界都市 + 1106 魔界商贸城 arms deferred (地底/魔界 map out of narrowed
  // scope, same posture as the location-predicates.ts placeSento arm).
}

// ---------------------------------------------------------------------------
// Reused helpers (also live in date-meal.ts but kept private there; the
// sweets-variant needs its own applyTier to avoid leaking the aliasing).
// ---------------------------------------------------------------------------

/**
 * `GET_SUCCESS_RATE(chara)` non-DLC branch — copied from date-meal.ts so
 * this file is self-contained (the upstream 公式 is small + identical).
 */
function getSuccessRate(slot: CharaSlot): number {
  let r = 0;
  r += Math.min(slot.state.ABL[ABL_ID.親密] ?? 0, 10) * 5;
  r += palamLevel(slot.state.PALAM[10 /* 恭順 */] ?? 0, 5) * 3;
  r += (slot.state.TALENT[TALENT_ID.心情] ?? 0) * 15;
  return r;
}

/** `RECOVER_PERMIL_BOTH` — recover chara + master. */
function recoverPermilBoth(
  state: GameState,
  charaNum: number,
  statId: number,
  permille: number,
): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (slot) recoverPermil(slot, statId, permille);
  if (charaNum !== 0) recoverPermil(state.master, statId, permille);
}

/** Bump TARGET's 約會経験 by 1. */
function bumpDateExp(slot: CharaSlot | undefined): void {
  if (!slot) return;
  slot.state.EXP[EXP_ID.約會経験] = (slot.state.EXP[EXP_ID.約會経験] ?? 0) + 1;
}

/** 617's tier TIMES — same 歓楽/情愛/征服/受動 multipliers as 610 (ERB 93-108). */
function apply617Tier(sources: Record<number, number>, tier: number): void {
  const k = (id: number, f: number) => {
    sources[id] = times(sources[id] ?? 0, f);
  };
  if (tier === -1) {
    k(SOURCE_ID.歓楽, 0.1);
    k(SOURCE_ID.情愛, 0.1);
    k(SOURCE_ID.征服, 0.5);
    k(SOURCE_ID.受動, 0.5);
  } else if (tier === 0) {
    k(SOURCE_ID.歓楽, 1.0);
    k(SOURCE_ID.情愛, 1.0);
    k(SOURCE_ID.征服, 1.0);
    k(SOURCE_ID.受動, 1.0);
  } else {
    k(SOURCE_ID.歓楽, 2.0);
    k(SOURCE_ID.情愛, 1.5);
    k(SOURCE_ID.征服, 2.0);
    k(SOURCE_ID.受動, 2.0);
  }
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

function check617Eligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (target < 1 || !state.charas[target]) {
    return { ok: false, reason: { kind: "precondition", message: "没有一起吃甜点的对象。" } };
  }
  const tSlot = state.charas[target]!;
  if (!chkDateNow(tSlot.state.CFLAG[CFLAG_ID.约会中] ?? 0)) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会中。" } };
  }
  if (!sweetsShop(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里不是甘味処。" } };
  }
  if (!isHungryFor(state, target, true)) {
    return { ok: false, reason: { kind: "precondition", message: "对方刚吃过甜点，还不饿。" } };
  }
  if (!canAfford(state, SWEETS_COST)) {
    return { ok: false, reason: { kind: "precondition", message: "钱不够。" } };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const sweetsShop617HandlerEntry: HandlerEntry = {
  commandNo: 617,
  execCheck: (ctx) => check617Eligible(ctx.state, ctx.target),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: "没有一起吃甜点的对象。",
          },
        ],
        outcome: "noop" as const,
      };
    }

    const sr = getSuccessRate(tSlot);
    const tier = compute610Tier(ctx.rng, sr);

    // 大成功 EXP (ERB 27-31): master 会話+1, master/target 約會+1.
    if (tier === 1) {
      next.master.state.EXP[EXP_ID.会話経験] =
        (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
      bumpDateExp(next.master);
      bumpDateExp(tSlot);
    }

    // DOWNBASE:気力 += 10 (ERB 42) — bare = TARGET (char-completion ON).
    tSlot.state.BASE[BASE_ID.気力] = (tSlot.state.BASE[BASE_ID.気力] ?? 0) - 10;

    // SOURCE + tier TIMES (ERB 45-112). 617's SOURCE assembly is identical
    // to 610 — reuse `compute610Sources` and apply 617's tier TIMES.
    const sources = compute610Sources(tSlot);
    apply617Tier(sources, tier);

    // 情緒BONUS (ERB 103/111; 失敗 tier skips it — ERB 95-97 only scales
    // sources, no 情緒BONUS write).
    setTflag(next, TFLAG_ID.情緒BONUS, tier === 1 ? 50 : tier === 0 ? 30 : 0);

    // RECOVER_PERMIL_BOTH (ERB 115-117) — 100/400/50‰, smaller than 610.
    recoverPermilBoth(next, target, BASE_ID.体力, 100);
    recoverPermilBoth(next, target, BASE_ID.気力, 400);
    recoverPermilBoth(next, target, BASE_ID.精力, 50);

    // TIME += 60 (ERB 119).
    advanceTimeTicks(next, 60);

    // 約會経験++ (ERB 120-121) + 満腹度上昇 "甜点" (ERB 122-123).
    bumpDateExp(next.master);
    bumpDateExp(tSlot);
    riseFullness(next, target, "甜点", DESSERT_FULLNESS);
    riseFullness(next, 0, "甜点", DESSERT_FULLNESS);

    // MONEY -= 3000 (ERB 124).
    pay(next, SWEETS_COST);

    // TFLAG:授乳コマンド = 1 (ERB 134) — same as 610 (post-meal state).
    setTflag(next, TFLAG_ID.授乳コマンド, 1);

    const settled = applySourceCheck(next, target, sources, 0);

    // Touch the dessert-clock TCVAR id so the doc-link is live and the
    // test imports stay complete.
    void TCVAR_ID.甜点空腹時刻;

    const tierWord =
      tier === 1 ? "甜点大受好评！" : tier === -1 ? "甜点不合口味……" : "";
    const text = `和对方一起吃了甜点。${tierWord}好感度 ${
      settled.favorDelta >= 0 ? "+" : ""
    }${settled.favorDelta}。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...settled.events],
      outcome: "ok" as const,
    };
  },
};
