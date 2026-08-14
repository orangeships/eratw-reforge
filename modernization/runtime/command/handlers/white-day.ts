/** COMF491 白色情人节：制作回礼与赠送回礼。 */

import type { CommandContext, HandlerEntry } from "../types.js";
import type { PromptAnswer, PromptSpec } from "../prompt.js";
import { pickOne } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import { addItem, hasItem, removeItem } from "../../state/items.js";
import { buffBase } from "../../state/buff.js";
import { juelUpSpecial } from "../../state/juel.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { dateOf, SEASON_SPRING, seasonOf } from "../../world/calendar.js";
import { getCurrentRoomProps } from "../comable/shrine-rooms.js";

type Recipe = {
  id: string;
  label: string;
  ingredients: readonly [number, number][];
  output: number;
  quantity: (skill: number) => number;
  minSkill?: number;
};

const RECIPES: readonly Recipe[] = [
  { id: "recipe:cookie", label: "手制巧克力曲奇 ×10＋料理技能", ingredients: [[84, 5]], output: 126, quantity: (skill) => 10 + skill },
  { id: "recipe:pudding", label: "手制布丁 ×5＋料理技能/3", ingredients: [[84, 5], [627, 1]], output: 127, quantity: (skill) => 5 + Math.floor(skill / 3) },
  { id: "recipe:cake", label: "装饰蛋糕 ×1", ingredients: [[84, 5], [352, 3]], output: 128, quantity: () => 1, minSkill: 4 },
  { id: "recipe:vibrator", label: "跳蛋巧克力 ×5", ingredients: [[84, 5], [0, 1]], output: 129, quantity: () => 5 },
];

const GIFTS = [
  { id: "gift:120", item: 120, label: "黑雷神巧克力", intimacy: 5, buff: 0, exp: 0 },
  { id: "gift:129", item: 129, label: "跳蛋巧克力", intimacy: 10, buff: 0, exp: 0 },
  { id: "gift:124", item: 124, label: "WD巧克力", intimacy: 25, buff: 100, exp: 0 },
  { id: "gift:126", item: 126, label: "手制巧克力曲奇", intimacy: 50, buff: 100, exp: 1 },
  { id: "gift:125", item: 125, label: "WD布丁", intimacy: 70, buff: 100, exp: 3 },
  { id: "gift:127", item: 127, label: "手制布丁", intimacy: 80, buff: 200, exp: 5 },
  { id: "gift:128", item: 128, label: "装饰蛋糕", intimacy: 200, buff: 1000, exp: 30 },
] as const;

function values(answer: PromptAnswer | undefined): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function targetCanReceive(state: CommandContext["state"], target: number): boolean {
  const slot = state.charas[target];
  return !!slot && target > 0 && (slot.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0) >= 1 &&
    (slot.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0) <= 4 &&
    (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0 &&
    (slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) === 0 &&
    (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) === 0 &&
    (slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) === 0;
}

function recipePrompt(state: CommandContext["state"]): PromptSpec {
  const skill = state.master.state.ABL[ABL_ID.料理技能] ?? 0;
  return pickOne("要制作哪种回礼？", [
    ...RECIPES.map((recipe) => ({
      id: recipe.id,
      label: recipe.label,
      disabled: (recipe.minSkill ?? 0) > skill || recipe.ingredients.some(([id, count]) => !hasItem(state, id, count)),
    })),
    { id: "cancel", label: "放弃" },
  ]);
}

function giftPrompt(state: CommandContext["state"], target: number): PromptSpec {
  const record = state.charas[target]?.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0;
  return pickOne("要送给对方什么？", [
    ...GIFTS.map((gift) => ({
      id: gift.id,
      label: gift.label,
      disabled: !hasItem(state, gift.item) || (gift.item === 128 && record !== 4),
    })),
    { id: "cancel", label: "放弃" },
  ]);
}

function whiteDayPrompt(ctx: CommandContext): PromptSpec | null {
  const selected = values(ctx.promptAnswer);
  if (selected.length === 0) {
    const options = [{ id: "mode:cook", label: "制作回礼" }];
    if (dateOf(ctx.state.time) === 14 && targetCanReceive(ctx.state, ctx.target)) {
      options.push({ id: "mode:gift", label: `赠送给${ctx.state.charas[ctx.target]!.callName ?? "对方"}` });
    }
    return pickOne("白色情人节要做什么？", [...options, { id: "cancel", label: "离开" }]);
  }
  if (selected.length === 1 && selected[0] === "mode:cook") return recipePrompt(ctx.state);
  if (selected.length === 1 && selected[0] === "mode:gift") return giftPrompt(ctx.state, ctx.target);
  return null;
}

function checkWhiteDay(ctx: CommandContext): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const state = ctx.state;
  const date = dateOf(state.time);
  if (seasonOf(state.time) !== SEASON_SPRING || date < 1 || date > 14) {
    return { ok: false, reason: { kind: "precondition", message: "白色情人节准备期已经结束。" } };
  }
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return { ok: false, reason: { kind: "precondition", message: "时间停止中不能进行白色情人节行动。" } };
  if ((state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) return { ok: false, reason: { kind: "precondition", message: "气力不足。" } };
  if ((state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 ||
      (state.master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0 ||
      (state.master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "当前状态不能准备回礼。" } };
  }
  if (date !== 14 && !getCurrentRoomProps(state.master.location)?.kitchen) {
    return { ok: false, reason: { kind: "precondition", message: "制作回礼需要在厨房。" } };
  }
  return { ok: true };
}

export const whiteDayHandlerEntry: HandlerEntry = {
  commandNo: 491,
  gateStatus: "complete",
  stagedPrompt: true,
  prompt: whiteDayPrompt,
  execCheck: (ctx) => {
    const result = checkWhiteDay(ctx);
    return result.ok ? { ok: true } : result;
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const selected = values(ctx.promptAnswer);
    if (selected.includes("cancel")) return { state: next, events: [], outcome: "noop" as const };
    const mode = selected[0];
    const chosen = selected[1];
    if (typeof chosen !== "string") {
      return { state: next, events: [], outcome: "blocked" as const, failReason: { kind: "precondition" as const, message: "需要选择白色情人节行动。" } };
    }
    if (mode === "mode:cook") {
      const recipe = RECIPES.find((entry) => entry.id === chosen);
      if (!recipe) return { state: next, events: [], outcome: "noop" as const };
      const skill = next.master.state.ABL[ABL_ID.料理技能] ?? 0;
      if ((recipe.minSkill ?? 0) > skill || recipe.ingredients.some(([id, count]) => !hasItem(next, id, count))) {
        return { state: next, events: [], outcome: "noop" as const, failReason: { kind: "precondition" as const, message: "材料不足。" } };
      }
      for (const [id, count] of recipe.ingredients) removeItem(next, id, count);
      addItem(next, recipe.output, recipe.quantity(skill));
      next.master.state.EXP[EXP_ID.料理経験] = (next.master.state.EXP[EXP_ID.料理経験] ?? 0) + 3;
      next.master.state.BASE[BASE_ID.気力] = Math.max(0, (next.master.state.BASE[BASE_ID.気力] ?? 0) - 300);
      advanceTimeTicks(next, 60);
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `制作了${recipe.label.split(" ×")[0]}。` }],
        outcome: "ok" as const,
      };
    }
    const gift = GIFTS.find((entry) => entry.id === chosen);
    const target = next.charas[ctx.target];
    if (!gift || !target || !targetCanReceive(next, ctx.target) || !hasItem(next, gift.item)) {
      return { state: next, events: [], outcome: "blocked" as const, failReason: { kind: "precondition" as const, message: "没有可赠送的对象或礼物。" } };
    }
    removeItem(next, gift.item, 1);
    juelUpSpecial(target.state, false, PALAM_ID.好意, ABL_ID.親密, gift.intimacy, next.flagStore);
    target.state.CFLAG[CFLAG_ID.信頼度] = (target.state.CFLAG[CFLAG_ID.信頼度] ?? 0) + gift.intimacy;
    if (gift.item === 129) {
      target.state.PALAM[PALAM_ID.快Ｃ] = (target.state.PALAM[PALAM_ID.快Ｃ] ?? 0) + 3000;
      target.state.PALAM[PALAM_ID.反感] = (target.state.PALAM[PALAM_ID.反感] ?? 0) + 300;
    }
    if (gift.buff) {
      buffBase(target, BASE_ID.体力, gift.buff);
      buffBase(target, BASE_ID.気力, gift.buff);
    }
    if (gift.item === 125 || gift.item === 127 || gift.item === 128) {
      target.state.TALENT[TALENT_ID.恋慕] = 1;
    }
    target.state.EXP[EXP_ID.愛情経験] = (target.state.EXP[EXP_ID.愛情経験] ?? 0) + gift.exp;
    target.state.CFLAG[CFLAG_ID.バレンタイン] = (target.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0) + 100;
    advanceTimeTicks(next, 10);
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), charaNum: ctx.target, text: `向${target.callName ?? "对方"}赠送了${gift.label}。` }],
      outcome: "ok" as const,
    };
  },
};
