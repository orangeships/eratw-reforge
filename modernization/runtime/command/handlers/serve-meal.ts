/**
 * Phase 7.5 (§3F) — `COMF415 食事をふるまう` (serve/treat a meal). A thin
 * shell over COMF414 — the ERB self-documents `414_[吃飯]とほぼ同じ,関数も
 * そちらのものを流用` (`COMF415.ERB:4`). Faithful to the non-DLC path of
 * `ERB/コマンド関連/COMF/日常系/COMF415 食事をふるまう.ERB`.
 *
 * **Key difference from 414:** 415 is *serving* — the master does **not**
 * eat (`COMF415` has no `CALL 吃飯(MASTER)`); only the TARGET (and, if the
 * group arm runs, other present NPCs) eat via `@COM414_実食`. 415 is also
 * target-directed (`@COM_ABLE415` blocks on `TARGET < 1` + TARGET 睡眠),
 * and its 空腹 gate checks **TARGET**'s hunger (bare `TCVAR:空腹時刻`
 * defaults to TARGET in eraBASIC), not the master's.
 *
 * **Ported faithfully (handler layer):**
 *   - **execCheck** (`@COM_ABLE415`, ERB 103-143): `FLAG:70` block, `TARGET<1`
 *     block, `CFLAG:睡眠` (TARGET) block, `DISH_NAME==""` block, `BATHCHECK`
 *     (MASTER's room), 軽食以外 は室内 (`INROOM`), TARGET 空腹 gate,
 *     `CFLAG:诶嘿嘿` block. The two room gates reuse the same
 *     `location-predicates` helpers 414 already uses, so 415 is strict where
 *     414 is not: upstream gates 415 on `DISH_TYPE != "軽食"` (ERB 131) but 414
 *     only on `DISH_TYPE == "主食"` (ERB 322).
 *   - **ASK_YN** "只和两人吃?" (ERB 10-16) — interactive prompt (B9); the
 *     "no" (group) branch runs `CALL AssembleForMeal` (`COMF415.ERB:15` →
 *     `集合.ERB:299-347`, see `world/assemble-for-meal.ts`) BEFORE the eat
 *     loop, upstream order preserved: ASK_YN → assemble → 実食. Direct
 *     runtime callers without a prompt answer keep the historical
 *     private-meal default (`TARGET_ONLY = true`).
 *   - **participant loop** (ERB 51-91): reuses `runMealParticipant` (the
 *     shared `@COM414_実食` orchestration from `meal.ts`). TARGET gets
 *     BONUS=1. **No master eat** (the serve semantics).
 *   - **per-eater prose**: `%CALLNAME%的评价………… N点` (`COMF414.ERB:745`)
 *     + the `TFLAG:193` reaction line (`EVENT_MESSAGE_COM400.ERB:419-432`,
 *     the solo "快乐的时光" arm because the master is not eating).
 *   - **TIME += EAT_TIME** + `CFLAG:MASTER:同行 += EAT_TIME` (ERB 94-96).
 *
 * **DEFERRED:** same cluster as 414 (see meal.ts header). TFLAG:信頼度管理 /
 * TFLAG:授乳コマンド (no consumer). 料理リセット (空腹 gate prevents re-eat).
 */

import type { GameState } from "../../state/game-state.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import type { HandlerEntry } from "../types.js";
import { requireYesNo, type PromptSpec } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import { selectPresentCharas } from "../../scene/presence.js";
import {
  CFLAG_ID,
  FLAG_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import { clearDish, getDish, tasteCount } from "../../state/dish.js";
import { bathCheck, inRoom } from "../../world/location-predicates.js";
import { runMealParticipant, mealEaterEvents } from "./meal.js";
import { assembleForMeal } from "../../world/assemble-for-meal.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE415` core (ERB 103-143)
// ---------------------------------------------------------------------------

function checkServeEligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 107/116: 時間停止 (FLAG:70) → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能招待。" } };
  }
  // ERB 119: TARGET < 1 → block.
  if (target < 1) {
    return { ok: false, reason: { kind: "precondition", message: "没有招待的对象。" } };
  }
  const tSlot = state.charas[target];
  // ERB 122: 睡眠中 (CFLAG:睡眠 — bare defaults to TARGET).
  if (!tSlot || (tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  // ERB 125: 料理がない → block.
  if (!getDish(state)) {
    return { ok: false, reason: { kind: "precondition", message: "没有料理可以招待。" } };
  }
  const dish = getDish(state)!;
  // ERB 128: BATHCHECK(CFLAG:MASTER:現在位置) — 風呂場飯禁止. Note this is the
  // MASTER's room, same subject as 414's arm.
  if (bathCheck(state, state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "浴室里不方便招待。" } };
  }
  // ERB 131: `DISH_TYPE != "軽食" && !INROOM(...)` — everything except 軽食 must
  // be served indoors. Deliberately stricter than 414's 主食-only arm (ERB 322).
  if (dish.type !== "軽食" && inRoom(state, state.master.location) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "这道菜只能在室内招待。" } };
  }
  // ERB 134-139: 食べたばかり — TARGET must be hungry (bare TCVAR → TARGET).
  const isDessert = dish.type === "甜点";
  const clockId = isDessert ? 313 : 312;
  const threshold = tSlot.state.TCVAR[clockId] ?? 0;
  if (state.time.tickValue < threshold) {
    return { ok: false, reason: { kind: "precondition", message: "对方刚吃过，还不饿。" } };
  }
  // ERB 141: 诶嘿嘿 (master) → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是招待的时候。" } };
  }
  return { ok: true };
}

function serveMealPrompt(ctx: Parameters<NonNullable<HandlerEntry["prompt"]>>[0]): PromptSpec | null {
  if (!getDish(ctx.state) || ctx.target < 1 || !ctx.state.charas[ctx.target]) return null;
  if (ctx.promptAnswer) return null;
  return {
    kind: "ask_yn",
    question: `只和${ctx.state.charas[ctx.target]!.callName ?? `#${ctx.target}`}两人吃吗？`,
    options: [
      { id: 1, label: "只招待对方" },
      { id: 0, label: "邀请同场角色一起吃" },
    ],
  };
}

// ---------------------------------------------------------------------------
// handler — `@COM415` core (ERB 6-98)
// ---------------------------------------------------------------------------

export const serveMealHandlerEntry: HandlerEntry = {
  commandNo: 415,
  prompt: serveMealPrompt,
  execCheck: (ctx) => {
    const r = checkServeEligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const dish = getDish(next);
    if (!dish) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有料理。" },
        ],
        outcome: "noop" as const,
      };
    }
    const target = ctx.target;
    if (target < 1 || !next.charas[target]) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有招待的对象。" },
        ],
        outcome: "noop" as const,
      };
    }

    // ASK_YN "只和两人吃?" (ERB 10-16). Yes keeps the meal private; the "no"
    // (group) branch assembles hungry nearby NPCs first (ERB 15) before the
    // eat loop. Direct runtime callers without the UI prompt retain the
    // historical private-meal default; normal command dispatch supplies ASK_YN.
    const targetOnly = ctx.promptAnswer ? requireYesNo(ctx.promptAnswer) : true;

    const eatTime = dish.type === "主食" ? 40 : 20;
    let tflag194 = 0;
    if (tasteCount(dish.taste, "跳蛋")) tflag194 = 2;

    const events: ObservationEvent[] = [];
    // Group arm: CALL AssembleForMeal (COMF415.ERB:15) → smell lines.
    if (!targetOnly) {
      for (const slot of assembleForMeal(next, dish.type === "甜点")) {
        events.push({
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `${slot.callName ?? `#${slot.charaNum}`}闻着饭菜的香味过来了`,
        });
      }
    }

    // CVARSET 料理評価値 = 0 (ERB 17) — zero present NPCs (incl. assembled).
    next.master.state.TCVAR[TCVAR_ID.料理評価値] = 0;
    const present = selectPresentCharas(next, next.master.location);
    const npcNums = present
      .filter((s) => s.charaNum !== 0)
      .map((s) => s.charaNum)
      .sort((a, b) => a - b);
    for (const n of npcNums) next.charas[n]!.state.TCVAR[TCVAR_ID.料理評価値] = 0;

    const participantNames: string[] = [];
    const eaterEvents: ObservationEvent[] = [];
    // Non-target group loop (ERB 55-86) — skipped when TARGET_ONLY.
    if (!targetOnly) {
      for (const n of npcNums) {
        if (n === target) continue;
        const other = runMealParticipant(
          next,
          n,
          eatTime,
          n === dish.assi || (next.charas[n]!.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5,
          tflag194,
          ctx.rng,
        );
        if (other.ate) {
          participantNames.push(next.charas[n]?.callName ?? `#${n}`);
          eaterEvents.push(...mealEaterEvents(next, n, other.tflag193, dish.name, /*serve*/ true, ctx.now));
        }
      }
    }
    // TARGET eats with BONUS=1 (ERB 91). No master eat (serve semantics).
    // isTarget: only the TARGET's meal drives TFLAG:信頼度管理 (ERB 93).
    const r = runMealParticipant(next, target, eatTime, true, tflag194, ctx.rng, /*isTarget*/ true);
    if (r.ate) {
      participantNames.push(next.charas[target]?.callName ?? `#${target}`);
      eaterEvents.push(...mealEaterEvents(next, target, r.tflag193, dish.name, /*serve*/ true, ctx.now));
    }

    // TIME += EAT_TIME (ERB 94) + CFLAG:MASTER:同行 += EAT_TIME (ERB 95-96).
    // Preserve the pre-tick master companion value before the clock's
    // decrement/cleanup, then apply COMF415's ERB post-step addition.
    const masterCompanionBefore = getMasterCflag(next, CFLAG_ID.同行);
    advanceTimeTicks(next, eatTime);
    if (masterCompanionBefore > 0) {
      next.master.state.CFLAG[CFLAG_ID.同行] = masterCompanionBefore + eatTime;
    }

    // COMF415 shares the meal-reset command tag with COMF414 upstream.
    clearDish(next);

    // Event order mirrors meal.ts: smell lines → summary opener → per-eater
    // 评价行 + TFLAG:193 reaction line (upstream's single-tier summary word
    // is superseded by the per-eater reaction lines).
    const guests = participantNames.length > 0 ? participantNames.join("、") : "没有人";
    const text = `向${guests}招待了${dish.name}。（经过 ${eatTime} 分钟）`;
    events.push({ kind: "NARRATION", timestamp: ctx.now(), text });
    events.push(...eaterEvents);
    return {
      state: next,
      events,
      outcome: "ok" as const,
    };
  },
};
