/**
 * Phase 7.5 (§3F) — `COMF414 食事を取る` (eat a meal), the B7-eat eat-loop
 * root. Faithful to the **non-DLC** path of
 * `ERB/コマンド関連/COMF/日常系/COMF414 食事を取る.ERB`.
 *
 * The mechanism lives in `runtime/state/dish.ts` (DISH state, `@吃飯`
 * recovery, `@REVIEW_DISH` evaluation, `@満腹度上昇`, `@COM414_実食` SOURCE,
 * `@KIGEN_CHANGE`). This handler is the `@COM_ABLE414` execCheck + the
 * `@COM414` orchestration: assemble meal participants → per-NPC 実食 loop →
 * master eats → TIME/同行 advance.
 *
 * **Ported faithfully (handler layer):**
 *   - **execCheck** (`@COM_ABLE414`, ERB 306-337): `FLAG:70` 時間停止 block,
 *     `DISH_NAME == ""` block, master 空腹 gate (`TIME_PROGRESS(空腹時刻)`),
 *     `CFLAG:诶嘿嘿` block, 主食 requires `INROOM`, and every dish is blocked
 *     by `BATHCHECK` in a bath room.
 *   - **EAT_TIME** = 主食 40 / else 20 (ERB 31-35).
 *   - **特殊料理 TFLAG:194** (ERB 38-54): `跳蛋/` taste → 194=2. The named-dish
 *     arms (涮涮锅/奶酪番茄沙拉/興奮劑高湯/银吉獣料理) defer (need DISHDATA names).
 *   - **participant loop** (ERB 56-140): present NPCs eat via `@COM414_実食`
 *     (non-target first, then TARGET with BONUS=1); `Setting_单独一人吃饭` +
 *     `KOJO_MESSAGE_SEND`/`TFLAG:192` pre-loop defer (no kojo → 評価値=0 →
 *     REVIEW_DISH fills it). `TFLAG:信頼度管理` set-but-unconsumed → skip.
 *   - **master eat** `CALL 吃飯(MASTER)` (ERB 142) — recovery only (master is
 *     not evaluated, gets no SOURCE).
 *   - **TIME += EAT_TIME** + `CFLAG:MASTER:同行 += EAT_TIME` (ERB 149-151).
 *
 * **DEFERRED (handler layer; mechanism deferrals in dish.ts header):**
 *   - `TFLAG:100` / `GLOBAL_COMABLE` reachability gates — catalog reach.
 *   - `KOJO_MESSAGE_SEND` / `TFLAG:192` 口上 evaluation override (no kojo).
 *   - `Setting_单独一人吃饭` (always false → group path; single-eat is the
 *     `TARGET == 0` arm below).
 *   - 特殊料理 named-dish TFLAG:194 arms (涮涮锅 露出 etc.) — DISHDATA names.
 *   - 約會経験 / 约会临时标记 — no dating subsystem.
 *   - `TFLAG:授乳コマンド` / `TFLAG:信頼度管理` — no consumer in slice.
 *   - 料理リセット (clear dish after meal) — 空腹 gate prevents re-eat.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { selectPresentCharas } from "../../scene/presence.js";
import {
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import {
  canEatMeal,
  clearDish,
  computeMealSources,
  eatMeal,
  getDish,
  tasteCount,
  type DishRng,
} from "../../state/dish.js";
import { bathCheck, inRoom } from "../../world/location-predicates.js";

// ---------------------------------------------------------------------------
// shared participant orchestration — `@COM414_実食` (ERB 161-302)
// ---------------------------------------------------------------------------

/**
 * Run one eater through the meal: `@COM414_実食` gate → `@吃飯` (recovery +
 * REVIEW_DISH for non-master) → SOURCE assembly → SOURCE→PALAM→好感度 settle.
 * Skips (returns `ate: false`) if the eater is 睡眠/衰弱/not hungry. Mutates
 * `state` in place. Shared by COMF414 (NPCs + TARGET) and COMF415 (TARGET).
 */
export function runMealParticipant(
  state: GameState,
  charaNum: number,
  eatTime: number,
  bonus: boolean,
  tflag194: number,
  rng: DishRng,
): { ate: boolean; tflag193: number } {
  const dish = getDish(state);
  if (!dish) return { ate: false, tflag193: 0 };
  const isDessert = dish.type === "甜点";
  if (!canEatMeal(state, charaNum, isDessert)) {
    return { ate: false, tflag193: 0 };
  }
  // @吃飯 (sets 評価値 via REVIEW_DISH for non-master, recovers BASE).
  eatMeal(state, charaNum, rng);
  // SOURCE assembly + KIGEN_CHANGE + TFLAG:193.
  const { sources, tflag193 } = computeMealSources(
    state,
    charaNum,
    eatTime,
    bonus,
    tflag194,
    rng,
  );
  // Settle SOURCE → PALAM → 好感度 (no favorBias — 414 has no TFLAG:97 pre-seed).
  if (charaNum > 0) {
    applySourceCheck(state, charaNum, sources, 0);
  }
  return { ate: true, tflag193 };
}

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE414` core (ERB 306-337)
// ---------------------------------------------------------------------------

function checkMealEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 316: 時間停止 (FLAG:70) → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能吃饭。" } };
  }
  // ERB 319: 料理がない (DISH_NAME == "") → block.
  if (!getDish(state)) {
    return { ok: false, reason: { kind: "precondition", message: "没有料理，吃不了。" } };
  }
  // ERB 322: 主食は屋内じゃなきゃ無理. 軽食/甜点 may be eaten outside.
  const dish = getDish(state)!;
  if (dish.type === "主食" && inRoom(state, state.master.location) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "主食只能在室内吃。" } };
  }
  // ERB 325-330: 食べたばかり — master must be hungry for the dish type.
  const isDessert = dish.type === "甜点";
  const clockId = isDessert
    ? // 甜点空腹時刻 / 空腹時刻 — read directly (TCVAR namespace on master).
      313
    : 312;
  const threshold = state.master.state.TCVAR[clockId] ?? 0;
  if (state.time.tickValue < threshold) {
    return { ok: false, reason: { kind: "precondition", message: "刚吃过，还不饿。" } };
  }
  // ERB 333: 風呂場飯禁止 (applies to every dish type).
  if (bathCheck(state, state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "浴室里不能吃饭。" } };
  }
  // ERB 335: 诶嘿嘿 → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是吃饭的时候。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM414` core (ERB 25-153)
// ---------------------------------------------------------------------------

export const mealHandlerEntry: HandlerEntry = {
  commandNo: 414,
  execCheck: (ctx) => {
    const r = checkMealEligible(ctx.state);
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

    // EAT_TIME (ERB 31-35).
    const eatTime = dish.type === "主食" ? 40 : 20;

    // 特殊料理 TFLAG:194 (ERB 38-54). Named-dish arms defer; 跳蛋 taste → 2.
    let tflag194 = 0;
    if (tasteCount(dish.taste, "跳蛋")) tflag194 = 2;

    // CVARSET 料理評価値 = 0 (ERB 29) — zero master + present NPCs.
    next.master.state.TCVAR[306] = 0;
    const present = selectPresentCharas(next, next.master.location);
    const npcNums = present
      .filter((s) => s.charaNum !== 0)
      .map((s) => s.charaNum)
      .sort((a, b) => a - b);
    for (const n of npcNums) next.charas[n]!.state.TCVAR[306] = 0;

    // Participant loop (ERB 56-140). TARGET == 0 → eat alone (master only).
    const target = ctx.target;
    let lastTier = 0;
    const participants: string[] = [];
    if (target > 0 && next.charas[target]) {
      // Non-target NPCs first (ERB 94-133).
      for (const n of npcNums) {
        if (n === target) continue;
        const participant = runMealParticipant(next, n, eatTime, /*bonus*/ n === dish.assi || (next.charas[n]!.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5, tflag194, ctx.rng);
        if (participant.ate) participants.push(next.charas[n]?.callName ?? `#${n}`);
      }
      // TARGET last with BONUS=1 (ERB 137).
      const r = runMealParticipant(next, target, eatTime, true, tflag194, ctx.rng);
      lastTier = r.tflag193;
      if (r.ate) participants.push(next.charas[target]?.callName ?? `#${target}`);
    }

    // Master eats (ERB 142) — recovery only, no evaluation/SOURCE.
    eatMeal(next, 0, ctx.rng);

    // TIME += EAT_TIME (ERB 149) + CFLAG:MASTER:同行 += EAT_TIME (ERB 150-151).
    // advanceTimeTicks decrements companion timers before the ERB command
    // adds EAT_TIME. Preserve the pre-tick master value so a master-only
    // timer is not cleared by the clock before this post-step addition.
    const masterCompanionBefore = getMasterCflag(next, CFLAG_ID.同行);
    advanceTimeTicks(next, eatTime);
    if (masterCompanionBefore > 0) {
      next.master.state.CFLAG[CFLAG_ID.同行] = masterCompanionBefore + eatTime;
    }

    // EVENTCOMEND2 resets dishes for commands tagged BIT_料理リセット.
    clearDish(next);

    const tierWord =
      lastTier === 1 ? "大家吃得很满意。" : lastTier === -1 ? "似乎不太合胃口。" : "";
    const text =
      target > 0
        ? `${participants.length > 0 ? participants.join("、") : "大家"}一起享用了${dish.name}。${tierWord}（经过 ${eatTime} 分钟）`
        : `享用了${dish.name}。（经过 ${eatTime} 分钟）`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }],
      outcome: "ok" as const,
    };
  },
};
