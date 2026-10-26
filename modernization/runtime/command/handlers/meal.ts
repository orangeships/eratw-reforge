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
 *   - **特殊料理 TFLAG:194** (ERB 38-54), all five arms: 涮涮锅 with an
 *     uncovered guest → 194=1 **and** the dish gains the 精力 tag; `跳蛋/`
 *     taste → 2; 奶酪番茄沙拉 → 30; 興奮劑高湯 → 31; 银吉獣料理 → 34. The
 *     chain runs AFTER `AssembleForMeal` (upstream order) because the 涮涮锅
 *     arm inspects the assembled cast.
 *   - **participant loop** (ERB 56-140): present NPCs eat via `@COM414_実食`
 *     (non-target first, then TARGET with BONUS=1); `Setting_单独一人吃饭` +
 *     `KOJO_MESSAGE_SEND`/`TFLAG:192` pre-loop defer (no kojo → 評価値=0 →
 *     REVIEW_DISH fills it). `TFLAG:信頼度管理` set-but-unconsumed → skip.
 *   - **meal assembly** (`CALL AssembleForMeal`, `集合.ERB:299-347` via
 *     `COMF414.ERB:28`): hungry awake NPCs within BFS cost ≤ 3 on the base
 *     map walk into the master's room (see `world/assemble-for-meal.ts`),
 *     each narrating the smell line.
 *   - **per-eater prose**: `%CALLNAME%的评价………… N点` (`COMF414.ERB:745`,
 *     N = 料理評価値/10, width 3) + the `TFLAG:193` reaction line
 *     (`EVENT_MESSAGE_COM400.ERB:419-432`; the per-dish bespoke描写 defer).
 *   - **master eat** `CALL 吃飯(MASTER)` (ERB 142) — recovery only (master is
 *     not evaluated, gets no SOURCE).
 *   - **TIME += EAT_TIME** + `CFLAG:MASTER:同行 += EAT_TIME` (ERB 149-151).
 *
 * **DEFERRED (handler layer; mechanism deferrals in dish.ts header):**
 *   - `TFLAG:100` / `GLOBAL_COMABLE` reachability gates — catalog reach.
 *   - `KOJO_MESSAGE_SEND` / `TFLAG:192` 口上 evaluation override (no kojo).
 *   - `Setting_单独一人吃饭` (always false → group path; single-eat is the
 *     `TARGET == 0` arm below).
 *   - 約會経験 / 约会临时标记 — no dating subsystem.
 *   - `TFLAG:授乳コマンド` — set in ERB, no consumer in our slice.
 *
 * 料理リセット IS wired: `clearDish` runs below for the commands tagged
 * `BIT_料理リセット` (EVENTCOMEND2.ERB:58).
 */

import type { GameState } from "../../state/game-state.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { selectPresentCharas } from "../../scene/presence.js";
import {
  CFLAG_ID,
  EQUIP_SLOT,
  FLAG_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import {
  canEatMeal,
  clearDish,
  computeMealSources,
  eatMeal,
  getDish,
  mealTrustSeed,
  tasteCount,
  type DishRng,
} from "../../state/dish.js";
import { bathCheck, inRoom } from "../../world/location-predicates.js";
import { assembleForMeal } from "../../world/assemble-for-meal.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

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
  /** The addressed TARGET. Only their meal drives `TFLAG:信頼度管理`
   *  (`@COM414` ERB 139 / `@COM415` ERB 93 both read `TCVAR:TARGET:料理評価値`). */
  isTarget = false,
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
  // Settle SOURCE → PALAM → 好感度 (no favorBias — 414 has no TFLAG:97 pre-seed),
  // plus TRUST_CALC for the TARGET only (ERB 139: the seed is derived from the
  // TARGET's evaluation, so attendee meals never move 信頼度).
  if (charaNum > 0) {
    applySourceCheck(state, charaNum, sources, 0, isTarget ? mealTrustSeed(state, charaNum) : 0);
  }
  return { ate: true, tflag193 };
}

// ---------------------------------------------------------------------------
// per-eater prose — `COMF414.ERB:745` 评价行 + `EVENT_MESSAGE_COM400.ERB:419-432`
// ---------------------------------------------------------------------------

/**
 * Prose for one non-master eater, emitted AFTER 実食 (so 料理評価値 is set):
 *   - 评价行 (`COMF414.ERB:745`): `%CALLNAME%的评价………… {評価値/10,3}点`.
 *   - `TFLAG:193` reaction (`EVENT_MESSAGE_COM400.ERB:419-432`): 1 = ate it
 *     clean and looks satisfied / -1 = does not suit their taste / else the
 *     happy-time line (with the master when the master eats too — COM414 —
 *     alone when served — COM415). TFLAG:193 == -2 (kojo-refusal arm) cannot
 *     occur without a kojo override.
 * The per-dish bespoke描写 (EVENT_MESSAGE_COM400 CASE arms) defers.
 */
export function mealEaterEvents(
  state: GameState,
  charaNum: number,
  tflag193: number,
  dishName: string,
  serve: boolean,
  now: () => number,
): ObservationEvent[] {
  if (charaNum === 0) return [];
  const slot = state.charas[charaNum];
  if (!slot) return [];
  const name = slot.callName ?? `#${charaNum}`;
  const evalValue = slot.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
  const events: ObservationEvent[] = [
    {
      kind: "NARRATION",
      timestamp: now(),
      text: `${name}的评价………… ${String(Math.trunc(evalValue / 10)).padStart(3)}点`,
    },
  ];
  if (tflag193 === 1) {
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      text: `${name}把＜${dishName}＞吃得干干净净看起来很是满意…`,
    });
  } else if (tflag193 === -1) {
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      text: `…看起来不合${name}口味的样子`,
    });
  } else {
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      text: serve
        ? `${name}一边吃＜${dishName}＞一边度过了一段快乐的时光…`
        : `${name}和${state.master.callName ?? "主人"}一边吃＜${dishName}＞一边度过了一段快乐的时光…`,
    });
  }
  return events;
}

function mealDishNarration(dishName: string, now: () => number): ObservationEvent[] {
  const name = dishName.trim();
  if (!name) return [];
  const special: Array<[RegExp, string]> = [
    [/寿司|鮨/, "鱼肉与醋饭的香气在屋里散开，连最后一口也被好好享用了。"],
    [/仰望星空|派/, "酥皮和馅料的热气混在一起，桌边一时只剩下餐具轻响。"],
    [/肉包|包子/, "热腾腾的馅香冒着白气，刚出笼的滋味让人忍不住多吃了一个。"],
    [/三明治/, "面包、蔬菜和馅料的味道交叠在一起，正适合这样随手拿着吃。"],
    [/年节菜|年菜/, "一盘盘年节菜摆在眼前，熟悉的香味把屋子也映得热闹起来。"],
    [/荞麦|荞麦面/, "荞麦的清香留在唇齿间，碗底很快就见了光。"],
  ];
  const text = special.find(([pattern]) => pattern.test(name))?.[1]
    ?? `${name}的香味在屋里慢慢散开，大家都安静地享受着这一餐。`;
  return [{ kind: "NARRATION", timestamp: now(), text }];
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

    const events: ObservationEvent[] = [];

    // Meal assembly (CALL AssembleForMeal, COMF414.ERB:28 → 集合.ERB:299).
    // Hungry awake NPCs within cost 3 walk into the master's room; one smell
    // line each. `selectPresentCharas` below then sees them as present.
    const isDessert = dish.type === "甜点";
    for (const slot of assembleForMeal(next, isDessert)) {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${slot.callName ?? `#${slot.charaNum}`}闻着饭菜的香味过来了`,
      });
    }

    // 特殊料理 TFLAG:194 (ERB 38-54). Runs AFTER assembly (upstream order: 28
    // assemble → 37-54 判定) because the 涮涮锅 arm inspects the assembled cast.
    // The chain is IF/ELSEIF: once the 涮涮锅 name matches, the taste/name arms
    // below are skipped even if nobody present qualifies.
    let tflag194 = 0;
    if (dish.name === "涮涮锅" && ctx.target > 0) {
      // A present character not wearing 下半身内衣２ (EQUIP slot 6) turns the hot
      // pot into the 精力 variant: TFLAG:194 = 1 and the dish gains the tag, so
      // REVIEW_DISH sees 精力 on every later eater.
      // The upstream loop is `FOR LOCAL, 1, GET_TARGETNUM() + 1` — it starts at
      // 1, so the MASTER (index 0 of the present list) is not inspected.
      const uncovered = selectPresentCharas(next, next.master.location)
        .some((slot) => slot.charaNum !== 0 && (slot.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) === 0);
      if (uncovered) {
        tflag194 = 1;
        dish.taste += "精力/";
      }
    } else if (tasteCount(dish.taste, "跳蛋")) {
      tflag194 = 2;
    } else if (dish.name === "奶酪番茄沙拉") {
      tflag194 = 30;
    } else if (dish.name === "興奮劑高湯") {
      tflag194 = 31;
    } else if (dish.name === "银吉獣料理") {
      tflag194 = 34;
    }

    // CVARSET 料理評価値 = 0 (ERB 29) — zero master + present NPCs.
    next.master.state.TCVAR[TCVAR_ID.料理評価値] = 0;
    const present = selectPresentCharas(next, next.master.location);
    const npcNums = present
      .filter((s) => s.charaNum !== 0)
      .map((s) => s.charaNum)
      .sort((a, b) => a - b);
    for (const n of npcNums) next.charas[n]!.state.TCVAR[TCVAR_ID.料理評価値] = 0;

    // Participant loop (ERB 56-140). TARGET == 0 → eat alone (master only).
    const target = ctx.target;
    const participants: string[] = [];
    const eaterEvents: ObservationEvent[] = [];
    const kojoParticipants: number[] = [];
    if (target > 0 && next.charas[target]) {
      // Non-target NPCs first (ERB 94-133).
      for (const n of npcNums) {
        if (n === target) continue;
        const participant = runMealParticipant(next, n, eatTime, /*bonus*/ n === dish.assi || (next.charas[n]!.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5, tflag194, ctx.rng);
        if (participant.ate) {
          participants.push(next.charas[n]?.callName ?? `#${n}`);
          eaterEvents.push(...mealEaterEvents(next, n, participant.tflag193, dish.name, /*serve*/ false, ctx.now));
          kojoParticipants.push(n);
        }
      }
      // TARGET last with BONUS=1 (ERB 137).
      const r = runMealParticipant(next, target, eatTime, true, tflag194, ctx.rng, /*isTarget*/ true);
      if (r.ate) {
        participants.push(next.charas[target]?.callName ?? `#${target}`);
        eaterEvents.push(...mealEaterEvents(next, target, r.tflag193, dish.name, /*serve*/ false, ctx.now));
        kojoParticipants.push(target);
      }
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

    // Event order: attracted smell lines → summary opener (mirrors
    // MESSAGE_COM414's `%CALLNAME:PLAYER%吃掉了＜料理＞`) → per-eater 评价行
    // + TFLAG:193 reaction line. The upstream single-tier summary word is
    // superseded by the per-eater reaction lines.
    const text =
      target > 0
        ? `${participants.length > 0 ? participants.join("、") : "大家"}一起享用了${dish.name}。（经过 ${eatTime} 分钟）`
        : `享用了${dish.name}。（经过 ${eatTime} 分钟）`;
    events.push({ kind: "NARRATION", timestamp: ctx.now(), text });
    events.push(...mealDishNarration(dish.name, ctx.now));
    events.push(...eaterEvents);
    let settledState = next;
    let targetKojo: ReturnType<typeof collectCommandKojo> | undefined;
    const personalEvents: ObservationEvent[] = [];
    for (const charaNum of kojoParticipants) {
      if (!ctx.dialogueRouter) break;
      const kojo = collectCommandKojo({ ...ctx, state: { ...settledState, dish }, target: charaNum }, charaNum, 414);
      if (charaNum === ctx.target) targetKojo = kojo;
      if (kojo.effects.length > 0) settledState = applyKojoEffects(settledState, kojo.effects);
      personalEvents.push(...kojo.events);
    }
    return {
      state: settledState,
      events: [...events, ...personalEvents],
      outcome: "ok" as const,
      ...(targetKojo?.resolution ? { commandKojoResolution: targetKojo.resolution } : {}),
      ...(targetKojo?.pendingKojoChoice ? { pendingKojoChoice: targetKojo.pendingKojoChoice } : {}),
      kojoHandled: Boolean(ctx.dialogueRouter),
    };
  },
};
