/** COMF435 守矢神签. */

import type { CommandContext, HandlerEntry } from "../types.js";
import type { PromptAnswer, PromptSpec } from "../prompt.js";
import { pickOne } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import { addItem, itemCount, ITEM_ID, removeItem } from "../../state/items.js";
import { buffBase } from "../../state/buff.js";
import {
  BASE_ID,
  EXP_ID,
  FLAG_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { canAfford, pay } from "../../state/money.js";

const LOCATION = "守矢神社:社務所";
const OPEN_MINUTE = 600;
const CLOSE_MINUTE = 1200;
const BIT_SPECIAL_DRAWN = 1 << 3;
const BIT_SPECIAL_STAT = 1 << 4;
const BOX_SIZE = 300;

type Payment = {
  id: string;
  label: string;
  yen: number;
  chips: number;
  seals: number;
  draws: number;
};

const PAYMENTS: readonly Payment[] = [
  { id: "pay:yen:1", label: "3000 日元，单抽", yen: 3000, chips: 0, seals: 0, draws: 1 },
  { id: "pay:chips:1", label: "20 筹码，单抽", yen: 0, chips: 20, seals: 0, draws: 1 },
  { id: "pay:seals:1", label: "5 张守矢守札，单抽", yen: 0, chips: 0, seals: 5, draws: 1 },
  { id: "pay:yen:10", label: "27000 日元，十连抽", yen: 27000, chips: 0, seals: 0, draws: 10 },
  { id: "pay:chips:10", label: "180 筹码，十连抽", yen: 0, chips: 180, seals: 0, draws: 10 },
  { id: "pay:seals:10", label: "50 张守矢守札，十连抽", yen: 0, chips: 0, seals: 50, draws: 10 },
];

function nowMinute(ctx: CommandContext["state"]): number {
  return ((Math.trunc(ctx.time.tickValue) % 1440) + 1440) % 1440;
}

function freshBox(): number[] {
  return Array.from({ length: BOX_SIZE }, (_, value) => value);
}

function selections(answer: PromptAnswer | undefined): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function paymentOptions(state: CommandContext["state"]): PromptSpec {
  const seals = itemCount(state, ITEM_ID.守矢之守札);
  return pickOne("守矢神签怎么抽？", [
    ...PAYMENTS.map((payment) => ({
      id: payment.id,
      label: payment.label,
      disabled: state.money < payment.yen || (state.casinoChips ?? 0) < payment.chips || seals < payment.seals,
    })),
    { id: "cancel", label: "算了" },
  ]);
}

function moriyaPrompt(ctx: CommandContext): PromptSpec | null {
  const values = selections(ctx.promptAnswer);
  const flags = ctx.state.flagStore[FLAG_ID.おみくじ] ?? 0;
  if (values.length === 0 && (flags & BIT_SPECIAL_DRAWN) !== 0) {
    return pickOne("这个签箱已经抽中过特等奖，要怎么处理？", [
      { id: "box:continue", label: "继续抽这个箱子" },
      { id: "box:new", label: "换一个新的签箱" },
    ]);
  }
  if (values.length === 0 || (values.length === 1 && String(values[0]).startsWith("box:"))) {
    return paymentOptions(ctx.state);
  }
  return null;
}

function checkMoriya(ctx: CommandContext): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const minute = nowMinute(ctx.state);
  if (ctx.state.master.location !== LOCATION) return { ok: false, reason: { kind: "precondition", message: "需要在守矢神社社务所抽签。" } };
  if (minute < OPEN_MINUTE || minute > CLOSE_MINUTE) return { ok: false, reason: { kind: "precondition", message: "社务所目前不营业。" } };
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return { ok: false, reason: { kind: "precondition", message: "时间停止中不能抽签。" } };
  if ((ctx.state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) return { ok: false, reason: { kind: "precondition", message: "气力不足。" } };
  return { ok: true };
}

function awardRank(state: ReturnType<typeof cloneGameState>, value: number): string {
  if (value === 0) {
    const stat = ((state.flagStore[FLAG_ID.おみくじ] ?? 0) & BIT_SPECIAL_STAT) === 0 ? BASE_ID.体力 : BASE_ID.気力;
    state.flagStore[FLAG_ID.おみくじ] = (state.flagStore[FLAG_ID.おみくじ] ?? 0) ^ BIT_SPECIAL_STAT | BIT_SPECIAL_DRAWN;
    buffBase(state.master, stat, 50);
    return `特等奖：${stat === BASE_ID.体力 ? "体力" : "气力"}上限 +50`;
  }
  if (value <= 3) {
    const target = value + 30;
    state.flagStore[FLAG_ID.守矢神簽約会的対象] = target;
    return `一等奖：获得与${target === 31 ? "早苗" : target === 32 ? "神奈子" : "诹访子"}约会的权利`;
  }
  if (value <= 8) {
    for (const slot of Object.values(state.charas)) {
      slot.state.TALENT[15] = 1;
      slot.state.BASE[BASE_ID.憤怒] = 0;
    }
    for (const id of [BASE_ID.体力, BASE_ID.気力, BASE_ID.精力, BASE_ID.TSP]) {
      const max = state.master.state.MAXBASE[id] ?? 0;
      if (max > 0) state.master.state.BASE[id] = max;
    }
    state.master.state.BASE[BASE_ID.酒気] = 0;
    return "二等奖：幸福的奇迹恢复了状态";
  }
  if (value <= 14) {
    const expIds = [EXP_ID.会話経験, EXP_ID.戦闘経験, EXP_ID.学習経験];
    const chosen = expIds.reduce((best, id) =>
      (state.master.state.EXP[id] ?? 0) < (state.master.state.EXP[best] ?? 0) ? id : best,
    expIds[0]!);
    state.master.state.EXP[chosen] = (state.master.state.EXP[chosen] ?? 0) + 10;
    const shrineExp: readonly [number, number][] = [[31, EXP_ID.会話経験], [32, EXP_ID.戦闘経験], [33, EXP_ID.学習経験]];
    for (const [charaNum, expId] of shrineExp) {
      const slot = state.charas[charaNum];
      if (slot) slot.state.EXP[expId] = (slot.state.EXP[expId] ?? 0) + 5;
    }
    advanceTimeTicks(state, 20);
    return "三等奖：守矢训练营让一项经验 +10";
  }
  if (value <= 24) {
    for (const id of [56, 51, 52, 53]) addItem(state, id, 1);
    return "四等奖：幻想乡拼酒礼包";
  }
  if (value <= 39) {
    for (const [id, count] of [[502, 1], [503, 1], [507, 1], [510, 5], [500, 10], [251, 10]] as const) addItem(state, id, count);
    return "五等奖：健康补给礼包";
  }
  if (value <= 59) {
    for (const id of [40, 41, 250, 45, 49]) addItem(state, id, 1);
    return "六等奖：恋爱惊喜礼包";
  }
  if (value <= 89) {
    for (const id of [151, 152, 153, 161, 162, 163, 164, 171, 172, 173, 174, 181, 182, 183, 190]) addItem(state, id, 1);
    return "七等奖：蔬菜苗礼包";
  }
  if (value <= 129) {
    addItem(state, ITEM_ID.黑雷神巧克力, 20);
    return "八等奖：黑雷神巧克力 ×20";
  }
  if (value <= 199) {
    const flags = state.flagStore[FLAG_ID.おみくじ] ?? 0;
    const count = (flags >>> 5) & 15;
    if (count >= 9) {
      state.flagStore[FLAG_ID.おみくじ] = (flags & ~(15 << 5)) ^ (1 << 9);
      const skill = (flags & (1 << 9)) === 0 ? EXP_ID.料理経験 : EXP_ID.清掃経験;
      state.master.state.EXP[skill] = (state.master.state.EXP[skill] ?? 0) + 1;
      return "九等奖：集齐刷帚，获得金刷帚效果";
    }
    state.flagStore[FLAG_ID.おみくじ] = (flags & ~(15 << 5)) | ((count + 1) << 5);
    return `九等奖：刷帚收集进度 ${count + 1}/10`;
  }
  addItem(state, ITEM_ID.守矢之守札, 1);
  return "十等奖：守矢守札 ×1";
}

export const moriyaOmikujiHandlerEntry: HandlerEntry = {
  commandNo: 435,
  gateStatus: "complete",
  stagedPrompt: true,
  prompt: moriyaPrompt,
  execCheck: (ctx) => {
    const result = checkMoriya(ctx);
    return result.ok ? { ok: true } : result;
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const values = selections(ctx.promptAnswer);
    if (values.includes("cancel")) return { state: next, events: [], outcome: "noop" as const };
    const boxChoice = values.find((value) => typeof value === "string" && value.startsWith("box:"));
    const paymentId = values.find((value) => typeof value === "string" && value.startsWith("pay:"));
    if (boxChoice === "box:new") {
      next.moriyaOmikujiBox = freshBox();
      next.flagStore[FLAG_ID.おみくじ] = (next.flagStore[FLAG_ID.おみくじ] ?? 0) & ~BIT_SPECIAL_DRAWN;
    }
    const payment = PAYMENTS.find((entry) => entry.id === paymentId);
    if (!payment) return { state: next, events: [], outcome: "blocked" as const, failReason: { kind: "precondition" as const, message: "需要选择抽签方式。" } };
    const seals = itemCount(next, ITEM_ID.守矢之守札);
    if (!canAfford(next, payment.yen) || (next.casinoChips ?? 0) < payment.chips || seals < payment.seals) {
      return { state: next, events: [], outcome: "noop" as const, failReason: { kind: "precondition" as const, message: "资源不足。" } };
    }
    if (payment.yen) pay(next, payment.yen);
    next.casinoChips = Math.max(0, (next.casinoChips ?? 0) - payment.chips);
    removeItem(next, ITEM_ID.守矢之守札, payment.seals);
    if (!next.moriyaOmikujiBox?.length) next.moriyaOmikujiBox = freshBox();
    const results: string[] = [];
    for (let draw = 0; draw < payment.draws; draw += 1) {
      const box = next.moriyaOmikujiBox!;
      const index = ctx.rng.int(box.length);
      const value = box.splice(index, 1)[0]!;
      results.push(awardRank(next, value));
    }
    advanceTimeTicks(next, 2);
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `抽出了${payment.draws === 10 ? "十连" : "一张"}守矢神签。${results.join("；")}` }],
      outcome: "ok" as const,
    };
  },
};
