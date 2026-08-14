/** Deterministic, persisted port of the enabled branches in DAILY_EV23. */

import type { ObservationEvent } from "../../schemas/types.js";
import type { PromptAnswer, PromptOption, PromptSpec } from "../command/prompt.js";
import type { Rng } from "../command/types.js";
import type { DailyEventSession, GameState } from "../state/game-state.js";
import { addItem, ITEM_ID } from "../state/items.js";
import { CFLAG_ID, EXP_ID, TALENT_ID } from "../state/settlement.js";

export interface Ev23Context { now: () => number; sleepSeed: number; answer?: PromptAnswer }
export type Ev23Outcome =
  | { kind: "applied"; events: ObservationEvent[] }
  | { kind: "needs-input"; events: ObservationEvent[]; prompt: PromptSpec; session: DailyEventSession }
  | { kind: "unsupported"; reason: string };

const PRICE_LIST = 980000;
const PRICE_SALE = 49800;
const PRICE_FLOOR = 29800;
const VALUE_SELLER = 23;
const SEX_FRIEND_BIT = 4;

function bit(value: number, index: number): boolean { return (value & (1 << index)) !== 0; }
function withBit(value: number, index: number): number { return value | (1 << index); }
function narration(now: () => number, text: string): ObservationEvent { return { kind: "NARRATION", timestamp: now(), text }; }
function selected(answer: PromptAnswer | undefined): number | string | undefined { return answer?.kind === "pick_one" ? answer.value : undefined; }
function persistedFlags(state: Readonly<GameState>): number { return state.dailyEventFlags?.[23] ?? 0; }

/** The seller is an anonymous mob rather than a persistent CharaSlot. The
 * upstream FLAG_DAILY_EV23 bit is therefore the canonical relationship
 * record; keep its meaning behind a named helper instead of exposing a raw
 * bit to callers. */
export function ev23SellerIsSexFriend(state: Readonly<GameState>): boolean {
  return bit(persistedFlags(state), SEX_FRIEND_BIT);
}

function pending(state: GameState, context: Ev23Context, phase: DailyEventSession["phase"], question: string, options: PromptOption[], data: Record<string, number | string | boolean>, lines: string[] = []): Ev23Outcome {
  return { kind: "needs-input", events: lines.map((line) => narration(context.now, line)), prompt: { kind: "pick_one", question, options }, session: { kind: "ev23-visit-sales", eventId: 23, eventDay: state.time.dayIndex, sleepSeed: context.sleepSeed, phase, data } };
}

function addSamples(state: GameState, data: Readonly<Record<string, number | string | boolean>>): void {
  const lube = Number(data.lube ?? 0); const condoms = Number(data.condoms ?? 0); const drinks = Number(data.drinks ?? 0); const stones = Number(data.stones ?? 0);
  if (lube > 0) addItem(state, ITEM_ID.潤滑液, lube);
  if (condoms > 0) addItem(state, ITEM_ID.避孕套, condoms);
  if (drinks > 0) addItem(state, ITEM_ID.姜黄飲料, drinks);
  if (stones > 0) addItem(state, ITEM_ID.奇跡之石, stones);
}

function recordSalespersonFirstKiss(state: GameState): void {
  if ((state.master.state.TALENT[TALENT_ID.キス未経験] ?? 0) === 0) return;
  state.master.state.TALENT[TALENT_ID.キス未経験] = 0;
  state.master.state.CFLAG[CFLAG_ID.初吻喪失記念日] = state.time.dayIndex;
  state.master.state.CFLAG[CFLAG_ID.初吻喪失对手] = -23;
  state.master.state.CFLAG[CFLAG_ID.初吻喪失対象] = 1;
  state.firstKissHistory ??= {};
  state.firstKissHistory[0] = { dayIndex: state.time.dayIndex, location: state.master.location, partner: { kind: "anonymous", label: "兔娘销售员" }, situation: "ordinary" };
}

function commit(state: GameState, data: Readonly<Record<string, number | string | boolean>>, context: Ev23Context, lines: string[]): Ev23Outcome {
  const cost = Number(data.cost ?? 0);
  if (cost > state.money) return { kind: "unsupported", reason: "EV23 funds changed before settlement" };
  const chipsCost = Number(data.chipsCost ?? 0);
  if (chipsCost > (state.casinoChips ?? 0)) return { kind: "unsupported", reason: "EV23 casino chips changed before settlement" };
  // Validate consumables before changing money, flags, or sample items. A
  // stale prompt must fail closed even when the stone was consumed elsewhere.
  const availableStones = (state.items?.[ITEM_ID.奇跡之石] ?? 0) + Number(data.stones ?? 0);
  if (data.usedStone === true && availableStones <= 0) {
    return { kind: "unsupported", reason: "EV23 miracle stone missing at use settlement" };
  }
  state.money -= cost;
  if (chipsCost > 0) state.casinoChips = (state.casinoChips ?? 0) - chipsCost;
  state.dailyEventFlags ??= {};
  state.dailyEventFlags[23] = Number(data.flags ?? persistedFlags(state));
  state.dailyEventValues ??= {};
  if (Number(data.seller ?? 0) > 0) state.dailyEventValues[VALUE_SELLER] = Number(data.seller);
  addSamples(state, data);
  if (data.usedStone === true) {
    const current = state.items?.[ITEM_ID.奇跡之石] ?? 0;
    state.items![ITEM_ID.奇跡之石] = current - 1;
    if (((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0 && (state.master.state.TALENT[TALENT_ID.非童貞] ?? 0) === 0) state.master.state.TALENT[TALENT_ID.非童貞] = 1;
    recordSalespersonFirstKiss(state);
  }
  if (data.recordKiss === true) {
    state.master.state.EXP[EXP_ID.接吻経験] = (state.master.state.EXP[EXP_ID.接吻経験] ?? 0) + 1;
    recordSalespersonFirstKiss(state);
  }
  return { kind: "applied", events: lines.map((line) => narration(context.now, line)) };
}

export function ev23Condition(state: Readonly<GameState>, rng: Rng): boolean {
  const flags = persistedFlags(state);
  if (bit(flags, 1)) return false;
  if (rng.int(15) > 0) return false;
  return state.money >= PRICE_FLOOR || ev23SellerIsSexFriend(state);
}

export function runEv23(state: GameState, _rng: Rng, context: Ev23Context): Ev23Outcome {
  const replay = state.dailyEventSession?.kind === "ev23-visit-sales" ? state.dailyEventSession : undefined;
  const phase = replay?.phase ?? (bit(persistedFlags(state), 0) ? "sales-return" : "sales-appearance");
  const data: Record<string, number | string | boolean> = { flags: persistedFlags(state), seller: state.dailyEventValues?.[VALUE_SELLER] ?? 0, ...(replay?.data ?? {}) };
  const choice = selected(context.answer);

  if (phase === "sales-appearance") {
    if (choice === undefined) return pending(state, context, phase, "站在门外的是哪位销售员？", [{ id: "twintail", label: "双马尾兔子销售员" }, { id: "short", label: "短发兔子销售员" }], data, ["一天结束后，刚打算睡觉时，门口传来了声音。", "“对不起、有人在吗？”"]);
    if (choice !== "twintail" && choice !== "short") return { kind: "unsupported", reason: "EV23 invalid seller appearance" };
    data.seller = choice === "twintail" ? 1 : 2; data.flags = withBit(Number(data.flags), 0);
    return pending(state, context, "sales-listen", "要听听她的说明吗？", [{ id: "refuse", label: "不用了" }, { id: "listen", label: "听听说明" }], data, ["兔耳朵一动一动的销售员自称带来了超棒的商品。"]);
  }

  if (phase === "sales-listen") {
    if (choice === undefined) return ev23PromptView(state, replay!) ? pending(state, context, phase, ev23PromptView(state, replay!)!.prompt.question, ev23PromptView(state, replay!)!.prompt.options, data, ev23PromptView(state, replay!)!.lines) : { kind: "unsupported", reason: "EV23 prompt missing" };
    if (choice === "refuse") return commit(state, { ...data, flags: withBit(Number(data.flags), 1) }, context, ["无视了还没说完话的推销员，直接把门关上了。", "她不会再来了。"]);
    if (choice !== "listen") return { kind: "unsupported", reason: "EV23 invalid listen answer" };
    data.flags = withBit(Number(data.flags), 2);
    return pending(state, context, "sales-offer", "购买“独占爱欲的奇迹之石”吗？", [{ id: "no", label: "没兴趣！" }, { id: "bargain", label: "能再便宜点吗！" }, { id: "buy", label: "买了！", disabled: state.money < PRICE_SALE, detail: `${PRICE_SALE}` }], data, [`销售员从通常价格 ${PRICE_LIST} 一路讲到本次特价 ${PRICE_SALE}。`]);
  }

  if (phase === "sales-offer") {
    if (choice === undefined) return repeat(state, context, replay!);
    if (choice === "no") return commit(state, { ...data, drinks: 1, lube: 1, condoms: 1 }, context, ["销售员留下姜黄饮料、润滑液和避孕套各一份样品，深深鞠躬后离开了。"]);
    if (choice === "bargain") return pending(state, context, "sales-bargain", `奇迹安心套餐最低 ${PRICE_FLOOR}，买吗？`, [{ id: "no", label: "不要！" }, { id: "buy", label: "买了！", disabled: state.money < PRICE_FLOOR }], data, ["销售员追加了 3 瓶润滑液和 10 个避孕套，声称已经绝对无法再便宜。"]);
    if (choice === "buy" && state.money >= PRICE_SALE) return pending(state, context, "sales-use", "现在试着使用奇迹之石吗？", [{ id: "sleep", label: "困了，接着睡吧" }, { id: "use", label: "试着用一下" }], { ...data, flags: withBit(Number(data.flags), 3), cost: PRICE_SALE, stones: 1 }, ["“感谢你的购买！”"]);
    return { kind: "unsupported", reason: "EV23 invalid or unaffordable offer answer" };
  }

  if (phase === "sales-bargain") {
    if (choice === undefined) return repeat(state, context, replay!);
    if (choice === "no") return commit(state, { ...data, drinks: 1, lube: 1, condoms: 1 }, context, ["最终还是没有购买。销售员留下三件样品后离开了。"]);
    if (choice === "buy" && state.money >= PRICE_FLOOR) return pending(state, context, "sales-use", "现在试着使用奇迹之石吗？", [{ id: "sleep", label: "困了，接着睡吧" }, { id: "use", label: "试着用一下" }], { ...data, flags: withBit(Number(data.flags), 3), cost: PRICE_FLOOR, stones: 1, lube: 3, condoms: 10 }, ["以底价买下了奇迹安心套餐。"]);
    return { kind: "unsupported", reason: "EV23 invalid bargain answer" };
  }

  if (phase === "sales-use") {
    if (choice === undefined) return repeat(state, context, replay!);
    if (choice === "sleep") return commit(state, data, context, ["目送销售员离开后，满怀期待地睡着了。"]);
    if (choice === "use") return commit(state, { ...data, flags: withBit(Number(data.flags), SEX_FRIEND_BIT), usedStone: true }, context, ["想着眼前销售员的脸握紧石头，石头微微发光。", "销售员因奇迹之石而发情；两人成为了炮友关系。"]);
    if (choice === "do") return commit(state, data, context, ["销售员红着脸留下来亲热了一会儿，随后恋恋不舍地离开。"]);
    if (choice === "skip") return commit(state, data, context, ["销售员看起来有些可惜，但还是告辞了。"]);
    return { kind: "unsupported", reason: "EV23 invalid use answer" };
  }

  if (phase === "sales-return") {
    if (choice === undefined) return pending(state, context, phase, "熟悉的兔耳销售员又来了。怎么办？", [{ id: "stop", label: "不要再来了" }, { id: "no", label: "不需要了" }, { id: "buy", label: "购买", disabled: state.money < PRICE_FLOOR }, { id: "intimate", label: "推倒！", disabled: !bit(Number(data.flags), 4) }], data, [bit(Number(data.flags), 4) ? "“欸嘿嘿。我又来了。”" : "专门贩卖奇迹之石的销售员再次来访。"]);
    if (choice === "stop" && bit(Number(data.flags), 4)) return pending(state, context, "sales-intimate", "真的要让她再也不来吗？", [{ id: "stop", label: "不要再来了" }, { id: "joke", label: "开玩笑的" }], { ...data, stage: "confirm-stop" }, ["“欸欸！？这是不是有点太残忍了！？”"]);
    if (choice === "stop") return commit(state, { ...data, flags: withBit(Number(data.flags), 1) }, context, ["销售员满脸沮丧地离开了。"]);
    if (choice === "no") return commit(state, { ...data, drinks: 1, lube: 1, condoms: 1 }, context, ["销售员留下商品样品后告辞了。"]);
    if (choice === "buy" && state.money >= PRICE_FLOOR) {
      const cost = state.money < PRICE_SALE ? PRICE_FLOOR : PRICE_SALE;
      const next = { ...data, cost, stones: 1, flags: withBit(Number(data.flags), 3) };
      return pending(state, context, "sales-use", bit(Number(data.flags), SEX_FRIEND_BIT) ? "买完东西后还要亲热吗？" : "现在对销售员使用石头吗？", bit(Number(data.flags), SEX_FRIEND_BIT) ? [{ id: "skip", label: "不做" }, { id: "do", label: "做" }] : [{ id: "sleep", label: "犯困了，去睡吧" }, { id: "use", label: "对销售员用石头试试" }], next, ["“感谢你的购买！”"]);
    }
    if (choice === "intimate" && bit(Number(data.flags), SEX_FRIEND_BIT)) return pending(state, context, "sales-intimate-payment", "怎么迎接她？", [{ id: "kiss", label: "亲吻堵上嘴" }, { id: "money", label: "给她 3000", disabled: state.money < 3000 }, { id: "chips", label: "让她握着那根（10CM）", disabled: (state.casinoChips ?? 0) < 10 }], data, ["销售员一边抱怨你妨碍工作，一边还是留了下来。"]);
    return { kind: "unsupported", reason: "EV23 invalid return answer" };
  }

  if (phase === "sales-intimate") {
    if (choice === undefined) return repeat(state, context, replay!);
    if (choice === "stop") return commit(state, { ...data, flags: withBit(Number(data.flags), 1) }, context, ["销售员难过地离开了，从此不再来访。"]);
    if (choice === "joke") return pending(state, context, "sales-return", "那么这次怎么办？", [{ id: "stop", label: "不要再来了" }, { id: "no", label: "不需要了" }, { id: "buy", label: "购买", disabled: state.money < PRICE_FLOOR }, { id: "intimate", label: "推倒！" }], data, ["“不要突然吓我啊～”"]);
    return { kind: "unsupported", reason: "EV23 invalid stop confirmation" };
  }

  if (phase === "sales-intimate-payment") {
    if (choice === undefined) return repeat(state, context, replay!);
    if (choice === "kiss") return commit(state, { ...data, recordKiss: true }, context, ["用亲吻堵住了销售员的抱怨。", "匆匆忙忙虽然有些可惜，她还是满足地离开了。"]);
    if (choice === "money" && state.money >= 3000) return commit(state, { ...data, cost: Number(data.cost ?? 0) + 3000 }, context, ["销售员收下了 3000，又害羞地说比起钱更想下次一起吃午餐。", "她恋恋不舍地离开了。"]);
    if (choice === "chips" && (state.casinoChips ?? 0) >= 10) return commit(state, { ...data, chipsCost: 10 }, context, ["销售员收下了 10 枚赌场筹码，红着脸留下来了一会儿。", "她恋恋不舍地离开了。"]);
    return { kind: "unsupported", reason: "EV23 invalid intimate answer" };
  }
  return { kind: "unsupported", reason: `unsupported EV23 phase ${phase}` };
}

function repeat(state: GameState, context: Ev23Context, active: DailyEventSession): Ev23Outcome {
  const view = ev23PromptView(state, active);
  return view ? pending(state, context, active.phase, view.prompt.question, view.prompt.options, active.data ?? {}, view.lines) : { kind: "unsupported", reason: `EV23 cannot render ${active.phase}` };
}

export function ev23PromptView(state: Readonly<GameState>, active: DailyEventSession): { prompt: PromptSpec; lines: string[] } | null {
  if (active.kind !== "ev23-visit-sales") return null;
  const flags = Number(active.data?.flags ?? persistedFlags(state));
  switch (active.phase) {
    case "sales-appearance": return { prompt: { kind: "pick_one", question: "站在门外的是哪位销售员？", options: [{ id: "twintail", label: "双马尾兔子销售员" }, { id: "short", label: "短发兔子销售员" }] }, lines: ["门口传来了销售员的声音。"] };
    case "sales-listen": return { prompt: { kind: "pick_one", question: "听听商品说明吗？", options: [{ id: "refuse", label: "不用了" }, { id: "listen", label: "听听说明" }] }, lines: [] };
    case "sales-offer": return { prompt: { kind: "pick_one", question: "购买奇迹之石吗？", options: [{ id: "no", label: "没兴趣！" }, { id: "bargain", label: "能再便宜点吗！" }, { id: "buy", label: "买了！", disabled: state.money < PRICE_SALE }] }, lines: [] };
    case "sales-bargain": return { prompt: { kind: "pick_one", question: `底价 ${PRICE_FLOOR}，买吗？`, options: [{ id: "no", label: "不要！" }, { id: "buy", label: "买了！", disabled: state.money < PRICE_FLOOR }] }, lines: [] };
    case "sales-use": return { prompt: { kind: "pick_one", question: bit(flags, SEX_FRIEND_BIT) ? "还要亲热吗？" : "现在使用奇迹之石吗？", options: bit(flags, SEX_FRIEND_BIT) ? [{ id: "skip", label: "不做" }, { id: "do", label: "做" }] : [{ id: "sleep", label: "接着睡" }, { id: "use", label: "试着使用" }] }, lines: [] };
    case "sales-return": return { prompt: { kind: "pick_one", question: "销售员又来了。怎么办？", options: [{ id: "stop", label: "不要再来了" }, { id: "no", label: "不需要了" }, { id: "buy", label: "购买", disabled: state.money < PRICE_FLOOR }, { id: "intimate", label: "推倒！", disabled: !bit(flags, SEX_FRIEND_BIT) }] }, lines: [] };
    case "sales-intimate": return { prompt: { kind: "pick_one", question: "真的不让她再来吗？", options: [{ id: "stop", label: "不要再来了" }, { id: "joke", label: "开玩笑的" }] }, lines: [] };
    case "sales-intimate-payment": return { prompt: { kind: "pick_one", question: "怎么迎接她？", options: [{ id: "kiss", label: "亲吻堵上嘴" }, { id: "money", label: "给她 3000", disabled: state.money < 3000 }, { id: "chips", label: "让她握着那根（10CM）", disabled: (state.casinoChips ?? 0) < 10 }] }, lines: [] };
    default: return null;
  }
}
