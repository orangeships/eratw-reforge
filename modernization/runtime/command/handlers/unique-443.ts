/**
 * Target-aware COMF443 dispatcher.
 *
 * Upstream uses one command number for a collection of character-owned
 * `CFLAG:固有コマンド` branches. The old modern shell permanently pointed
 * 443 at the Kappa shop, which made every other default branch unreachable.
 * This registry keeps branch predicates, prompts, and settlement in the
 * deterministic runtime while exposing only branches reachable by the
 * current default character data. Plugin/DLC-only branches are deliberately
 * absent.
 */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommissionSlot, GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
  recoverPermil,
} from "../../state/settlement.js";
import {
  TFLAG_ID,
  getTflag,
  isCommandActionPhase,
  setTflag,
  setTflagBit,
} from "../../state/tflag.js";
import {
  ITEM_ID,
  addItem,
  buyItem,
  itemCount,
  removeItem,
} from "../../state/items.js";
import {
  KAPPA_SHOP_ITEM_IDS,
  catalogEntry,
  ensureShopStock,
  shopBuy,
} from "../../state/shop.js";
import { canAfford, formatMoney, grant, pay } from "../../state/money.js";
import {
  COMMISSION_PROGRESS,
  eligibleDefsForClient,
  findActiveSearchCommission,
  setCommissionProgress,
  setNewCommission,
} from "../../state/commission.js";
import { GATHERING_SPOT_1_ITEMS } from "../../state/gathering.js";
import {
  changeInsectForagingRegion,
  INSECT_FORAGING_REGIONS,
  insectForagingFee,
  startInsectForaging,
} from "../../state/insect-foraging.js";
import { STONE_CONTEST_THEMES } from "../../state/stone-contest.js";
import { ensureWeatherState } from "../../state/weather-state.js";
import { WEATHER_ID } from "../../weather/constants.js";
import { applySourceCheck } from "../source-check.js";
import {
  pickOne,
  type PromptAnswer,
  type PromptOption,
  type PromptSpec,
} from "../prompt.js";
import type { CommandContext, CommandResult, HandlerEntry } from "../types.js";
import {
  atPlayerBase,
  isGapGuest,
  mapIdOfLocation,
} from "../../world/location-predicates.js";

type PromptValues = readonly (number | string)[];
type BranchOutcome = "ok" | "noop" | "blocked";

interface UniqueCommandBranch {
  readonly id: string;
  readonly targets: readonly number[];
  readonly label: (state: Readonly<GameState>) => string;
  readonly available: (state: Readonly<GameState>) => boolean;
  readonly prompt?: (state: Readonly<GameState>, values: PromptValues) => PromptSpec | null;
  readonly execute: (
    state: GameState,
    ctx: CommandContext,
    values: PromptValues,
  ) => { outcome: BranchOutcome; message?: string; extraTime?: number; events?: ObservationEvent[] };
}

function valuesOf(answer: PromptAnswer | undefined): PromptValues {
  if (!answer) return [];
  if (answer.kind === "pick_sequence") return answer.values;
  if (answer.kind === "pick_one") return [answer.value];
  return [];
}

function surface(spec: PromptSpec, kind: PromptSpec["surface"] = "unique"): PromptSpec {
  return { ...spec, surface: kind };
}

function stagedPick(
  question: string,
  options: PromptOption[],
  kind: PromptSpec["surface"] = "unique",
): PromptSpec {
  return surface(pickOne(question, options), kind);
}

function cancelOption(label = "算了"): PromptOption {
  return { id: "cancel", label };
}

function paymentOptions(
  state: Readonly<GameState>,
  yen: number,
  chips: number,
  labels: { yen: string; chips: string },
): PromptOption[] {
  return [
    { id: "pay:yen", label: labels.yen, disabled: !canAfford(state as GameState, yen) },
    { id: "pay:chips", label: labels.chips, disabled: (state.casinoChips ?? 0) < chips },
  ];
}

function payChoice(state: GameState, value: number | string, yen: number, chips: number): boolean {
  if (value === "pay:yen") {
    if (!canAfford(state, yen)) return false;
    pay(state, yen);
    return true;
  }
  if (value === "pay:chips") {
    if ((state.casinoChips ?? 0) < chips) return false;
    state.casinoChips = (state.casinoChips ?? 0) - chips;
    return true;
  }
  return false;
}

function optionValues(answer: PromptValues, prefix: string): string | undefined {
  const value = answer.find((entry) => typeof entry === "string" && entry.startsWith(prefix));
  return typeof value === "string" ? value : undefined;
}

function simplePrompt(
  values: PromptValues,
  question: string,
  options: PromptOption[],
  kind: PromptSpec["surface"] = "unique",
): PromptSpec | null {
  return values.length === 0 ? stagedPick(question, options, kind) : null;
}

function targetName(state: Readonly<GameState>, charaNum: number): string {
  return state.charas[charaNum]?.callName ?? state.charas[charaNum]?.name ?? `角色${charaNum}`;
}

function responsiveTarget(state: Readonly<GameState>, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) return false;
  if (isGapGuest(state as GameState, charaNum)) return false;
  return true;
}

function branchResult(
  message: string,
  extraTime = 0,
  events?: ObservationEvent[],
): { outcome: "ok"; message: string; extraTime: number; events?: ObservationEvent[] } {
  return { outcome: "ok", message, extraTime, ...(events ? { events } : {}) };
}

function branchNoop(message: string): { outcome: "noop"; message: string } {
  return { outcome: "noop", message };
}

function branchBlocked(message: string): { outcome: "blocked"; message: string } {
  return { outcome: "blocked", message };
}

function sourceEvents(
  state: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  now: () => number,
): ObservationEvent[] {
  if (target <= 0 || !state.charas[target]) return [];
  return applySourceCheck(state, target, source).events.map((event) => ({
    ...event,
    timestamp: now(),
  }));
}

function branchAvailable(state: Readonly<GameState>, target: number): UniqueCommandBranch | undefined {
  return UNIQUE_COMMAND_BRANCHES.find((branch) =>
    branch.targets.includes(target) && branch.available(state),
  );
}

function anyActiveSearchSlots(state: Readonly<GameState>): CommissionSlot[] {
  return (state.commissions?.slots ?? []).filter((slot) =>
    slot.kind === "common" &&
    [9, 10, 11].includes(slot.localId) &&
    (state.charas[slot.clientId]?.state.CFLAG[CFLAG_ID.依頼状況] ?? 0) === COMMISSION_PROGRESS.Active,
  );
}

function searchSlotForValue(state: Readonly<GameState>, value: number | string): CommissionSlot | undefined {
  if (typeof value !== "string" || !value.startsWith("slot:")) return undefined;
  const clientId = Number(value.slice("slot:".length));
  return Number.isInteger(clientId) ? findActiveSearchCommission(state, clientId) : undefined;
}

function dowsingPaymentOptions(
  state: Readonly<GameState>,
  yen: number,
  chips: number,
  question: string,
): PromptSpec {
  return stagedPick(question, [
    ...paymentOptions(state, yen, chips, {
      yen: `${formatMoney(yen)}支付`,
      chips: `${chips}枚赌场筹码支付`,
    }),
    cancelOption(),
  ]);
}

function dowsingPrompt(state: Readonly<GameState>, values: PromptValues): PromptSpec | null {
  if (values.length === 0) {
    const slots = anyActiveSearchSlots(state);
    return stagedPick("选择要用灵摆查找的委托", [
      ...slots.map((slot) => ({
        id: `slot:${slot.clientId}`,
        label: `${targetName(state, slot.clientId)}：${slot.localId === 10 ? "失物地点" : "失主"}`,
      })),
      cancelOption("暂时不找"),
    ]);
  }
  if (values[0] === "cancel") return null;
  const slot = searchSlotForValue(state, values[0]!);
  if (!slot) return null;
  if (values.length === 1) {
    return dowsingPaymentOptions(state, 1000, 5, "第一次灵摆查找要支付什么？");
  }
  if (values[1] === "cancel") return null;
  if (slot.targetCharaNum === 39) return null;
  if (values.length === 2) {
    return stagedPick(
      slot.localId === 10 ? "已经确定失物所在地图，要继续寻找具体地点吗？" : "已经找到了失主，要继续寻找当前位置吗？",
      [
        { id: "skip", label: "到此为止" },
        ...paymentOptions(
          state,
          slot.localId === 10 ? 2000 : 500,
          slot.localId === 10 ? 10 : 3,
          {
            yen: formatMoney(slot.localId === 10 ? 2000 : 500),
            chips: `${slot.localId === 10 ? 10 : 3}枚赌场筹码`,
          },
        ),
      ],
    );
  }
  return null;
}

function dowsingExecute(
  state: GameState,
  _ctx: CommandContext,
  values: PromptValues,
): { outcome: BranchOutcome; message?: string; extraTime?: number } {
  const slot = searchSlotForValue(state, values[0]!);
  if (!slot) return branchNoop("现在没有可以查找的遗失物委托。");
  const firstCost = values[1];
  if (firstCost !== "pay:yen" && firstCost !== "pay:chips") return branchNoop("没有支付第一次查找的费用。");
  if (!payChoice(state, firstCost, 1000, 5)) return branchNoop("钱或筹码不够，灵摆查找没有开始。");

  if (slot.localId === 10) slot.searchReveal = "map";
  else slot.searchReveal = "person";
  if (slot.targetCharaNum === 39) {
    return branchResult("灵摆指向了纳兹琳本人；失主已经找到了。", 0);
  }
  const second = values[2];
  if (second === "skip" || second === undefined) {
    return branchResult(slot.localId === 10 ? "灵摆确定了失物所在的地图。" : "灵摆确定了失物的主人。", 0);
  }
  if (second !== "pay:yen" && second !== "pay:chips") return branchNoop("没有支付第二次查找的费用。");
  const yen = slot.localId === 10 ? 2000 : 500;
  const chips = slot.localId === 10 ? 10 : 3;
  if (!payChoice(state, second, yen, chips)) return branchNoop("钱或筹码不够，暂时无法继续查找。");
  if (slot.localId === 10) {
    slot.searchReveal = "place";
  } else {
    const found = slot.targetCharaNum ? state.charas[slot.targetCharaNum]?.location : undefined;
    if (found && !isGapGuest(state, slot.targetCharaNum ?? 0)) slot.revealedLocation = found;
  }
  return branchResult(slot.localId === 10 ? "灵摆找到了失物的具体地点。" : "灵摆找到了失主当前的位置。", 0);
}

const KAPPA_DISCOUNT = 66;
const MEDICINE_OFFERS = [
  { id: ITEM_ID.潤滑液, quantity: 5, price: 1000, label: "瓶装润滑液×5" },
  { id: ITEM_ID.避孕套, quantity: 50, price: 1000, label: "避孕套×50" },
  { id: 49, quantity: 5, price: 5000, label: "口服避孕药×5" },
  { id: 250, quantity: 1, price: 5000, label: "催情药" },
  { id: ITEM_ID.睡眠薬, quantity: 1, price: 3000, label: "睡眠药" },
  { id: 501, quantity: 1, price: 3000, label: "营养饮料" },
  { id: 502, quantity: 1, price: 10000, label: "精力剂" },
  { id: ITEM_ID.姜黄飲料, quantity: 1, price: 500, label: "姜黄饮料" },
  { id: 520, quantity: 1, price: 1000, label: "绷带" },
] as const;
const HERBAL_SALE_EXCLUDED = new Set([
  600, 602, 610, 611, 616, 621, 626, 627, 628, 629, 630, 631, 636, 638, 639,
  642, 644, 645, 647, 648, 660, 661, 662, 663, 664, 665, 666, 667, 668, 669,
  // COMF443's UNIQUE_COM_HARBAL_SALES also closes the not-yet-registered
  // item ranges, even when a later gathering table happens to expose one.
  ...Array.from({ length: 11 }, (_, index) => 649 + index),
  ...Array.from({ length: 30 }, (_, index) => 670 + index),
]);
const UNIQUE_COMMAND_FISH_DAY_BIT = 12;

function specialTrainingPrice(state: Readonly<GameState>): number {
  const predecessor = state.charas[159];
  if ((predecessor?.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) return 10000;
  if ((predecessor?.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) return 35000;
  if ((predecessor?.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0) return 50000;
  return mapIdOfLocation(state.master.location) === 0 ? 80000 : 100000;
}

function catalogPromptOptions(
  state: Readonly<GameState>,
  itemIds: readonly number[],
  discount = 0,
): PromptOption[] {
  return itemIds.flatMap((id) => {
    const entry = catalogEntry(id);
    if (!entry) return [];
    const unitPrice = Math.trunc((entry.price * (100 - discount)) / 100);
    return [{
      id: `item:${id}`,
      label: entry.name,
      detail: formatMoney(unitPrice),
      disabled: state.money < unitPrice || (state.items?.[id] ?? 0) >= 999,
    }];
  });
}

function quantityOptions(
  prefix: string,
  quantity: number,
  maxOptions = 20,
): PromptOption[] {
  const max = Math.min(quantity, maxOptions);
  return Array.from({ length: max }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    label: `${index + 1}个`,
  }));
}

function parsePrefixedNumber(value: number | string | undefined, prefix: string): number | undefined {
  if (typeof value !== "string" || !value.startsWith(prefix)) return undefined;
  const parsed = Number(value.slice(prefix.length));
  return Number.isInteger(parsed) ? parsed : undefined;
}

function stallSource(state: Readonly<GameState>, target: number): Record<number, number> {
  const chara = state.charas[target];
  if (!chara) return {};
  const desire = chara.state.ABL[ABL_ID.欲望] ?? 0;
  const service = chara.state.ABL[ABL_ID.奉仕精神] ?? 0;
  const favor = chara.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  let pleasure: number;
  if (desire <= 1) pleasure = desire * 60;
  else if (desire <= 3) pleasure = 400 + desire * 60;
  else if (desire <= 5) pleasure = 800 + desire * 60;
  else if (desire <= 8) pleasure = 1000 + desire * 75;
  else if (desire <= 11) pleasure = 1700 + desire * 75;
  else pleasure = 2500 + desire * 35;
  if (favor <= 500) pleasure += favor;
  else if (favor <= 5000) pleasure += 750 + Math.trunc((favor - 500) / 3);
  else pleasure += 2000 + Math.trunc((favor - 5000) / 4);
  let affection = 0;
  if (service <= 1) affection = service * 30;
  else if (service <= 3) affection = 200 + service * 30;
  else if (service <= 5) affection = 500 + service * 30;
  else if (service <= 8) affection = 700 + service * 45;
  else if (service <= 11) affection = 1200 + service * 45;
  else affection = 1800 + service * 20;
  return {
    [SOURCE_ID.歓楽]: Math.max(0, 1000 + pleasure),
    [SOURCE_ID.情愛]: 300 + affection,
    [SOURCE_ID.受動]: 200 + 110 * (chara.state.ABL[ABL_ID.従順] ?? 0),
    [SOURCE_ID.征服]: 200 + 110 * (chara.state.ABL[ABL_ID.施虐属性] ?? 0),
  };
}

function buyBundle(state: GameState, id: number, quantity: number, total: number): boolean {
  if (quantity <= 0 || total < 0 || !canAfford(state, total)) return false;
  if ((state.items?.[id] ?? 0) + quantity > 999) return false;
  pay(state, total);
  addItem(state, id, quantity);
  return true;
}

const UNIQUE_COMMAND_BRANCHES: readonly UniqueCommandBranch[] = [
  {
    id: "reimu-fortune-contract",
    targets: [1],
    label: () => "神签契约",
    available: (state) => (state.flagStore[FLAG_ID.神簽契約] ?? 0) === 0,
    prompt: (state, values) => simplePrompt(values, "灵梦会在契约期间每天替你抽取幻存神签，费用按所在区域结算。要与她签订神签契约吗？", [
      {
        id: "pay:chips",
        label: `${mapIdOfLocation(state.master.location) === 0 ? 30 : 50}枚赌场筹码签约`,
        disabled: (state.casinoChips ?? 0) < (mapIdOfLocation(state.master.location) === 0 ? 30 : 50),
        detail: (state.casinoChips ?? 0) < (mapIdOfLocation(state.master.location) === 0 ? 30 : 50)
          ? `当前仅有 ${state.casinoChips ?? 0} 枚筹码`
          : "确认后立即扣除筹码",
      },
      cancelOption(),
    ]),
    execute: (state, _ctx, values) => {
      const chips = mapIdOfLocation(state.master.location) === 0 ? 30 : 50;
      if (values[0] === "cancel") return branchNoop("没有签订神签契约。");
      if (!payChoice(state, values[0]!, 0, chips)) return branchNoop("筹码不够，无法签订神签契约。");
      state.flagStore[FLAG_ID.神簽契約] = 1;
      return branchResult("与灵梦签订了神签契约。", 0);
    },
  },
  {
    id: "special-training",
    targets: [159],
    label: () => "特殊训练",
    available: () => true,
    prompt: (state, values) => {
      if (values.length > 0) return null;
      const price = specialTrainingPrice(state);
      return stagedPick("要接受特殊训练吗？", [
        { id: "accept", label: `支付 ${formatMoney(price)} 接受训练`, disabled: state.money < price },
        cancelOption(),
      ]);
    },
    execute: (state, _ctx, values) => {
      if (values[0] === "cancel") return branchNoop("没有进行特殊训练。");
      const price = specialTrainingPrice(state);
      if (values[0] !== "accept" || !canAfford(state, price)) return branchNoop("钱不够，无法接受特殊训练。");
      pay(state, price);
      state.master.state.EXP[EXP_ID.戦闘経験] = (state.master.state.EXP[EXP_ID.戦闘経験] ?? 0) + 50;
      state.master.state.BASE[BASE_ID.体力] = Math.max(0, (state.master.state.BASE[BASE_ID.体力] ?? 0) - 1200);
      return branchResult("特殊训练结束了。", 0);
    },
  },
  {
    id: "visit-signs",
    targets: [7],
    label: () => "探访迹象",
    available: (state) =>
      (state.charas[7]?.state.CFLAG[CFLAG_ID.好感度] ?? 0) >= 200 && atPlayerBase(state as GameState, 7),
    prompt: (state, values) => simplePrompt(
      values,
      "要确认探访迹象吗？",
      [...paymentOptions(state, 500, 3, { yen: formatMoney(500), chips: "3枚赌场筹码" }), cancelOption()],
    ),
    execute: (state, _ctx, values) => {
      if (values[0] === "cancel") return branchNoop("没有确认探访迹象。");
      if (!payChoice(state, values[0]!, 500, 3)) return branchNoop("钱或筹码不够。");
      return branchResult("确认了探访的迹象。", 0);
    },
  },
  {
    id: "help-others",
    targets: [11],
    label: (state) => (state.charas[11]?.state.CFLAG[CFLAG_ID.口上セレクタ] ?? 0) === 1 ? "少女行动DA☆ZE" : "帮助别人",
    available: () => true,
    prompt: (state, values) => {
      if (values.length > 0) return null;
      const options = Object.keys(state.charas)
        .map(Number)
        .filter((id) => id > 0 && id !== 11)
        .sort((a, b) => a - b)
        .flatMap((clientId) => {
          const status = state.charas[clientId]?.state.CFLAG[CFLAG_ID.依頼状況] ?? 0;
          if (status === COMMISSION_PROGRESS.Generated || status === COMMISSION_PROGRESS.Offered) {
            return [{ id: `commission:${clientId}`, label: `${targetName(state, clientId)}的委托` }];
          }
          if (status !== 0) return [];
          const def = eligibleDefsForClient(state, clientId)[0];
          return def ? [{ id: `commission:${clientId}`, label: `${targetName(state, clientId)}：${def.name}` }] : [];
        });
      return stagedPick("要帮助谁处理委托？", [...options, cancelOption()], "commission");
    },
    execute: (state, ctx, values) => {
      const selected = optionValues(values, "commission:");
      if (!selected) return branchNoop("没有选择要帮助的人。");
      const clientId = Number(selected.slice("commission:".length));
      const slot = state.charas[clientId];
      if (!slot || clientId === 11) return branchBlocked("委托对象不存在。");
      const status = slot.state.CFLAG[CFLAG_ID.依頼状況] ?? 0;
      if (status === COMMISSION_PROGRESS.Generated) {
        setCommissionProgress(state, clientId, COMMISSION_PROGRESS.Offered, slot.state.CFLAG[CFLAG_ID.依頼内容] ?? 0);
        return branchResult(`接下了${targetName(state, clientId)}提出的委托。`, 0);
      }
      if (status === COMMISSION_PROGRESS.Offered) {
        return branchResult(`准备帮助${targetName(state, clientId)}处理委托。`, 0);
      }
      if (status !== 0) return branchNoop("这份委托现在不能接手。");
      const def = eligibleDefsForClient(state, clientId)[0];
      if (!def || !setNewCommission(state, clientId, def, COMMISSION_PROGRESS.Offered, ctx.rng)) {
        return branchNoop("现在没有可以接手的委托。");
      }
      return branchResult(`替${targetName(state, clientId)}接下了「${def.name}」。`, 0);
    },
  },
  {
    id: "ice-cream",
    targets: [14],
    label: () => "买冰淇淋",
    available: () => true,
    prompt: (state, values) => simplePrompt(
      values,
      "要买多少冰淇淋？",
      [
        { id: "one", label: "一份", detail: `${formatMoney([400, 500, 300, 200][(state.time.season ?? 1) - 1] ?? 400)}` },
        { id: "pack", label: "十份装", detail: "按九份价格计算" },
        cancelOption(),
      ],
    ),
    execute: (state, _ctx, values) => {
      const unit = [400, 500, 300, 200][(state.time.season ?? 1) - 1] ?? 400;
      const qty = values[0] === "pack" ? 10 : values[0] === "one" ? 1 : 0;
      if (qty === 0) return branchNoop("没有购买冰淇淋。");
      const price = values[0] === "pack" ? unit * 9 : unit;
      if (!buyItem(state, ITEM_ID.冰淇淋, qty, price)) return branchNoop("钱不够，买不了冰淇淋。");
      return branchResult(`买了冰淇淋×${qty}。`, 0);
    },
  },
  {
    id: "red-mansion-service",
    targets: [15],
    label: () => "红魔馆出差服务",
    available: () => true,
    prompt: (state, values) => {
      if (values.length === 0) {
        return stagedPick("要委托红魔馆的哪项服务？", [
          {
            id: "clean",
            label: "上门清扫",
            detail: `${formatMoney(3000)}或10枚筹码`,
            disabled: (state.flagStore[FLAG_ID.上门清扫] ?? 0) !== 0,
          },
          {
            id: "water",
            label: "代为浇水",
            detail: `${formatMoney(15000)}或70枚筹码`,
            disabled: itemCount(state as GameState, 150) <= 0,
          },
          cancelOption(),
        ]);
      }
      if (values[0] === "clean") {
        return dowsingPaymentOptions(state, 3000, 10, "上门清扫要用什么支付？");
      }
      if (values[0] === "water") {
        return dowsingPaymentOptions(state, 15000, 70, "代为浇水要用什么支付？");
      }
      return null;
    },
    execute: (state, _ctx, values) => {
      const choice = values[0];
      if (choice === "cancel") return branchNoop("没有委托服务。");
      if (choice === "clean") {
        if ((state.flagStore[FLAG_ID.上门清扫] ?? 0) !== 0) return branchNoop("本月已经委托过清扫。");
        if (!payChoice(state, values[1]!, 3000, 10)) return branchNoop("钱或筹码不够。");
        state.flagStore[FLAG_ID.上门清扫] = 1;
        return branchResult("委托了红魔馆的上门清扫服务。", 0);
      }
      if (choice === "water") {
        if (itemCount(state, 150) <= 0) return branchNoop("没有可用于委托浇水的道具。");
        if (!payChoice(state, values[1]!, 15000, 70)) return branchNoop("钱或筹码不够。");
        state.flagStore[FLAG_ID.澆水代行] = 1;
        return branchResult("委托了红魔馆的代为浇水服务。", 0);
      }
      return branchNoop("没有选择服务。");
    },
  },
  {
    id: "kappa-shop",
    targets: [51],
    label: () => "购买道具",
    available: () => true,
    prompt: (state, values) => simplePrompt(
      values,
      "请选择要购买的道具（今天享受特别优惠）。",
      [...catalogPromptOptions(state, KAPPA_SHOP_ITEM_IDS, KAPPA_DISCOUNT), cancelOption("返回")],
      "shop",
    ),
    execute: (state, _ctx, values) => {
      const id = parsePrefixedNumber(values[0], "item:");
      if (id === undefined || !KAPPA_SHOP_ITEM_IDS.includes(id as (typeof KAPPA_SHOP_ITEM_IDS)[number])) {
        return branchNoop("没有购买道具。");
      }
      ensureShopStock(state, KAPPA_SHOP_ITEM_IDS);
      const result = shopBuy(state, id, 1, KAPPA_DISCOUNT);
      if (!result.ok) return branchNoop("这个道具现在买不了。");
      const entry = catalogEntry(id);
      return branchResult(`买下了${entry?.name ?? "道具"}，支付${formatMoney(result.total)}。`, 0);
    },
  },
  {
    id: "medicine-shop",
    targets: [52, 53],
    label: () => "买药",
    available: () => true,
    prompt: (state, values) => simplePrompt(
      values,
      "请选择要购买的药品。",
      [
        ...MEDICINE_OFFERS.map((offer) => ({
          id: `medicine:${offer.id}`,
          label: offer.label,
          detail: formatMoney(offer.price),
          disabled: state.money < offer.price || (state.items?.[offer.id] ?? 0) + offer.quantity > 999,
        })),
        cancelOption("返回"),
      ],
      "shop",
    ),
    execute: (state, _ctx, values) => {
      const id = parsePrefixedNumber(values[0], "medicine:");
      const offer = MEDICINE_OFFERS.find((candidate) => candidate.id === id);
      if (!offer) return branchNoop("没有购买药品。");
      if (!buyBundle(state, offer.id, offer.quantity, offer.price)) {
        return branchNoop("钱或库存上限不够，买不了这件药品。");
      }
      return branchResult(`买了${offer.label}。`, 0);
    },
  },
  {
    id: "stall-meal",
    targets: [28],
    label: () => "路边摊吃饭",
    available: (state) => {
      const target = state.charas[28];
      return (target?.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5 &&
        (state.master.state.BASE[BASE_ID.仕事量] ?? 0) < 3000 &&
        (target?.state.CFLAG[CFLAG_ID.职种] ?? 0) === 44;
    },
    prompt: (state, values) => simplePrompt(
      values,
      `欢迎光临。${1 + ((state.charas[28]?.state.CFLAG[CFLAG_ID.同行] ?? 0) > 0 ? 1 : 0)}位客人要吃什么？`,
      [
        { id: "small", label: "烤串拼盘", detail: "每人3枚赌场筹码" },
        { id: "large", label: "烤串拼盘（大）", detail: "每人5枚赌场筹码" },
        { id: "pack", label: "打包一份", detail: "5枚赌场筹码", disabled: itemCount(state, ITEM_ID.八目鰻烤串) > 0 },
        cancelOption("下次再来"),
      ],
    ),
    execute: (state, _ctx, values) => {
      const choice = values[0];
      if (choice === "cancel") return branchNoop("欢迎下次再来。");
      const guests = 1 + ((state.charas[28]?.state.CFLAG[CFLAG_ID.同行] ?? 0) > 0 ? 1 : 0);
      if (choice === "pack") {
        if (itemCount(state, ITEM_ID.八目鰻烤串) > 0 || !payChoice(state, "pay:chips", 0, 5)) {
          return branchNoop("筹码不够，或者已经有打包的烤串了。");
        }
        addItem(state, ITEM_ID.八目鰻烤串, 1);
        setTflag(state, TFLAG_ID.信頼度管理, 1);
        const events = sourceEvents(state, 28, { [SOURCE_ID.歓楽]: 200 }, _ctx.now);
        return branchResult("打包了一份烤串。", 2, events);
      }
      const unitPrice = choice === "large" ? 5 : choice === "small" ? 3 : 0;
      if (!unitPrice || !payChoice(state, "pay:chips", 0, unitPrice * guests)) {
        return branchNoop("筹码不够，没法在摊位吃饭。");
      }
      const large = choice === "large";
      recoverPermil(state.master, BASE_ID.体力, large ? 100 : 50);
      recoverPermil(state.master, BASE_ID.気力, large ? 200 : 100);
      recoverPermil(state.master, BASE_ID.精力, large ? 100 : 50);
      setTflag(state, TFLAG_ID.信頼度管理, getTflag(state, TFLAG_ID.信頼度管理) + 3);
      const source = stallSource(state, 28);
      const events = sourceEvents(state, 28, source, _ctx.now);
      return branchResult(large ? "吃了一份大份烤串拼盘。" : "吃了一份烤串拼盘。", 27, events);
    },
  },
  {
    id: "umbrella-repair",
    targets: [40],
    label: () => "伞的修理",
    available: (state) => {
      const durability = state.flagStore[FLAG_ID.傘耐久度] ?? 0;
      const once = (getTflag(state, TFLAG_ID.一日一回) & (1 << 13)) !== 0;
      return !once && (durability > 5000 || itemCount(state, ITEM_ID.壊掉的傘) > 0);
    },
    prompt: (state, values) => simplePrompt(
      values,
      itemCount(state, ITEM_ID.壊掉的傘) > 0 ? "小伞要修理坏掉的伞吗？" : "要把伞修好吗？",
      [{ id: "repair", label: "修理" }, cancelOption()],
    ),
    execute: (state, _ctx, values) => {
      if (values[0] !== "repair") return branchNoop("没有修理伞。");
      const broken = itemCount(state, ITEM_ID.壊掉的傘) > 0;
      if (!broken && (state.flagStore[FLAG_ID.傘耐久度] ?? 0) <= 5000) {
        return branchNoop("今天已经不能再修理了。");
      }
      if (broken) {
        removeItem(state, ITEM_ID.壊掉的傘, 1);
        addItem(state, ITEM_ID.折畳傘, 1);
        state.master.state.BASE[BASE_ID.気力] = Math.max(
          0,
          (state.master.state.BASE[BASE_ID.気力] ?? 0) - 200,
        );
        const events = sourceEvents(state, 40, { [SOURCE_ID.歓楽]: 1000 }, _ctx.now);
        setTflagBit(state, TFLAG_ID.一日一回, 13);
        return branchResult("小伞把坏掉的伞修好了。", 42, events);
      }
      const durability = state.flagStore[FLAG_ID.傘耐久度] ?? 0;
      state.master.state.BASE[BASE_ID.気力] = Math.max(
        0,
        (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100,
      );
      setTflag(state, TFLAG_ID.好感度BONUS, Math.min(Math.trunc(durability / 20), 500));
      setTflag(state, TFLAG_ID.信頼度管理, Math.min(Math.trunc(durability / 2000), 5));
      state.flagStore[FLAG_ID.傘耐久度] = 0;
      setTflagBit(state, TFLAG_ID.一日一回, 13);
      const events = sourceEvents(
        state,
        40,
        { [SOURCE_ID.歓楽]: 1000 + (state.charas[40]?.state.ABL[ABL_ID.親密] ?? 0) * 50 },
        _ctx.now,
      );
      return branchResult("小伞把伞修好了。", 27, events);
    },
  },
  {
    id: "herbal-sale",
    targets: [72],
    label: () => "贩卖生药",
    available: () => true,
    prompt: (state, values) => {
      if (values.length === 0) {
        const items = GATHERING_SPOT_1_ITEMS.filter((item) =>
          item.id >= 600 && item.id < 700 &&
          !HERBAL_SALE_EXCLUDED.has(item.id) && itemCount(state as GameState, item.id) > 0,
        );
        return stagedPick("永琳要收购哪种生药？", [
          ...items.map((item) => ({
            id: `herb:${item.id}`,
            label: `${item.name}×${itemCount(state as GameState, item.id)}`,
            detail: `${formatMoney(Math.trunc(item.price / 2))}/个`,
          })),
          cancelOption("返回"),
        ]);
      }
      if (values[0] === "cancel") return null;
      const id = parsePrefixedNumber(values[0], "herb:");
      const item = GATHERING_SPOT_1_ITEMS.find((candidate) => candidate.id === id);
      if (!item || HERBAL_SALE_EXCLUDED.has(item.id)) return null;
      const owned = itemCount(state as GameState, item.id);
      return stagedPick("要卖出多少个？", [
        ...quantityOptions("qty:", owned),
        cancelOption("返回"),
      ]);
    },
    execute: (state, _ctx, values) => {
      const id = parsePrefixedNumber(values[0], "herb:");
      const quantity = parsePrefixedNumber(values[1], "qty:");
      const item = GATHERING_SPOT_1_ITEMS.find((candidate) => candidate.id === id);
      if (!item || HERBAL_SALE_EXCLUDED.has(item.id) || !quantity || quantity > itemCount(state, item.id)) {
        return branchNoop("没有卖出生药。");
      }
      removeItem(state, item.id, quantity);
      const total = Math.trunc(item.price / 2) * quantity;
      grant(state, total);
      return branchResult(`卖出了${item.name}×${quantity}，得到${formatMoney(total)}。`, 0);
    },
  },
  {
    id: "fish-exchange",
    targets: [128],
    label: () => "鱼的交换",
    available: (state) => (getTflag(state, TFLAG_ID.一日一回) & (1 << UNIQUE_COMMAND_FISH_DAY_BIT)) === 0,
    prompt: (state, values) => {
      if (values.length > 0) return null;
      const ratio = Math.max(5, 10 - (state.charas[128]?.state.ABL[ABL_ID.親密] ?? 0));
      return stagedPick("想要交换好吃的鱼吗？", [
        {
          id: "exchange",
          label: `用${ratio}条普通的鱼交换1条好吃的鱼`,
          disabled: itemCount(state, ITEM_ID.魚) < ratio,
        },
        cancelOption(),
      ]);
    },
    execute: (state, _ctx, values) => {
      if (values[0] !== "exchange") return branchNoop("没有交换鱼。");
      const ratio = Math.max(5, 10 - (state.charas[128]?.state.ABL[ABL_ID.親密] ?? 0));
      if (itemCount(state, ITEM_ID.魚) < ratio) return branchNoop("普通的鱼不够。");
      removeItem(state, ITEM_ID.魚, ratio);
      addItem(state, ITEM_ID.好吃的魚, 1);
      setTflagBit(state, TFLAG_ID.一日一回, UNIQUE_COMMAND_FISH_DAY_BIT);
      return branchResult(`用${ratio}条普通的鱼换到了1条好吃的鱼。`, 0);
    },
  },
  {
    id: "stone-theme",
    targets: [127],
    label: () => "今日的叠石主题",
    available: () => true,
    prompt: (_state, values) => simplePrompt(
      values,
      "想知道今天的积石比赛情侣组主题吗？",
      [{ id: "show", label: "告诉我" }, cancelOption()],
    ),
    execute: (state, _ctx, values) => {
      if (values[0] !== "show") return branchNoop("没有询问积石主题。");
      const date = state.time.date ?? 1;
      const theme = date >= 1 && date <= STONE_CONTEST_THEMES.length
        ? STONE_CONTEST_THEMES[date - 1]
        : "特别日";
      return branchResult(`今天的积石比赛主题是「${theme}」。`, 0);
    },
  },
  {
    id: "dragon-orb-trade",
    targets: [140],
    label: () => "龙珠的交易",
    available: (state) => itemCount(state, ITEM_ID.龍珠) > 0,
    prompt: (state, values) => {
      if (values.length > 0) return null;
      const owned = itemCount(state, ITEM_ID.龍珠);
      return stagedPick("要卖出几个龙珠？", [
        ...quantityOptions("orb:", owned),
        cancelOption("返回"),
      ]);
    },
    execute: (state, _ctx, values) => {
      const quantity = parsePrefixedNumber(values[0], "orb:");
      if (!quantity || quantity > itemCount(state, ITEM_ID.龍珠)) return branchNoop("没有交易龙珠。");
      const skill = state.master.state.ABL[ABL_ID.話術技能] ?? 0;
      const multiplier = skill <= 0 ? 1 : skill === 1 ? 1.2 : skill === 2 ? 1.4 : skill === 3 ? 1.7 : skill === 4 ? 2 : skill === 5 ? 2.2 : skill === 6 ? 2.4 : 2.6;
      const unitPrice = Math.trunc(9000 * multiplier);
      const total = unitPrice * quantity;
      removeItem(state, ITEM_ID.龍珠, quantity);
      grant(state, total);
      return branchResult(`卖出龙珠×${quantity}，得到${formatMoney(total)}。`, 0);
    },
  },
  {
    id: "newspaper-subscription",
    targets: [29],
    label: () => "订阅新闻",
    available: (state) => (state.flagStore[FLAG_ID.新聞購読] ?? 0) === 0,
    prompt: (state, values) => simplePrompt(
      values,
      "要订阅本月的文文新闻吗？",
      [...paymentOptions(state, 3000, 10, {
        yen: `${formatMoney(3000)}订阅`,
        chips: "10枚赌场筹码订阅",
      }), cancelOption("不要")],
    ),
    execute: (state, _ctx, values) => {
      if (values[0] === "cancel" || !payChoice(state, values[0]!, 3000, 10)) {
        return branchNoop("没有订阅文文新闻。");
      }
      state.flagStore[FLAG_ID.新聞購読] = 1;
      return branchResult("订阅了文文新闻。", 0);
    },
  },
  {
    id: "weather-control",
    targets: [34],
    label: () => "天候操作",
    available: (state) =>
      (state.weather?.forbiddenChangeWeather ?? 0) === 0 &&
      (state.flagStore[FLAG_ID.異常気象] ?? 0) === 0 &&
      (getTflag(state, TFLAG_ID.一日一回) & (1 << 6)) === 0,
    prompt: (state, values) => simplePrompt(
      values,
      "我只能改变个大概哦，因为太麻烦了。",
      [
        { id: "fine", label: "晴朗" },
        { id: "cloudy", label: "阴天" },
        { id: "rain", label: "雨" },
        { id: "snow", label: "雪", disabled: (state.time.season ?? 1) !== 4 },
        cancelOption("还是算了"),
      ],
    ),
    execute: (state, ctx, values) => {
      const choice = values[0];
      if (choice === "cancel") return branchNoop("没有改变天气。");
      const season = state.time.season ?? 1;
      const weather = ensureWeatherState(state);
      let selected: number;
      if (choice === "fine") selected = ctx.rng.pick([WEATHER_ID.少云, WEATHER_ID.晴]);
      else if (choice === "cloudy") selected = ctx.rng.pick([WEATHER_ID.多云, WEATHER_ID.阴]);
      else if (choice === "rain") selected = ctx.rng.pick([
        WEATHER_ID.雨, WEATHER_ID.大雨, WEATHER_ID.雾雨, WEATHER_ID.雾, WEATHER_ID.暴雨,
      ]);
      else if (choice === "snow" && season === 4) selected = ctx.rng.pick([
        WEATHER_ID.雪, WEATHER_ID.大雪, WEATHER_ID.细雪, WEATHER_ID.雾雪,
        WEATHER_ID.雨夹雪, WEATHER_ID.冰霰, WEATHER_ID.冰雹,
      ]);
      else return branchNoop("没有选择有效的天气。");
      weather.gensokyoWeatherSystem[0] = selected;
      weather.windVelocity = 0;
      weather.forbiddenChangeWeather = 1;
      setTflagBit(state, TFLAG_ID.一日一回, 6);
      state.master.state.BASE[BASE_ID.気力] = Math.max(
        0,
        (state.master.state.BASE[BASE_ID.気力] ?? 0) - 300,
      );
      return branchResult(`天气变成了${selected === WEATHER_ID.晴 || selected === WEATHER_ID.少云 ? "晴朗" : selected === WEATHER_ID.多云 || selected === WEATHER_ID.阴 ? "阴天" : selected >= WEATHER_ID.雪 ? "雪" : "雨"}。`, 0);
    },
  },
  {
    id: "clairvoyance",
    targets: [65],
    label: () => "千里眼",
    available: () => true,
    execute: () => branchResult("椛发动了千里眼，远处的景象映入眼帘。", 0),
  },
  {
    id: "insect-foraging-service",
    targets: [27],
    label: () => "虫虫的采集服务",
    available: (state) => (state.charas[27]?.state.CFLAG[CFLAG_ID.行动] ?? 0) !== 5,
    prompt: (state, values) => {
      const contract = state.insectForaging;
      if (contract) {
        if (values.length === 0) {
          return stagedPick("要改变采集场所吗？", [
            { id: "change", label: "改变地点" },
            cancelOption("不用了"),
          ]);
        }
        if (values[0] === "change") {
          return stagedPick("想让虫子去哪里采集？", [
            ...INSECT_FORAGING_REGIONS.map((region) => ({ id: `region:${region}`, label: `地图${region}` })),
            cancelOption("返回"),
          ]);
        }
        return null;
      }
      if (values.length === 0) {
        const fee = insectForagingFee(state);
        return stagedPick(
          fee === 0 ? "要签订虫虫采集服务吗？（恋人免费）" : `要签订虫虫采集服务吗？费用${formatMoney(fee)}。`,
          [
            { id: "pay:yen", label: fee === 0 ? "免费签约" : `${formatMoney(fee)}签约`, disabled: state.money < fee },
            cancelOption("取消"),
          ],
        );
      }
      if (values[0] === "pay:yen") {
        return stagedPick("想让虫子去哪里采集？", [
          ...INSECT_FORAGING_REGIONS.map((region) => ({ id: `region:${region}`, label: `地图${region}` })),
          cancelOption("返回"),
        ]);
      }
      return null;
    },
    execute: (state, _ctx, values) => {
      const contract = state.insectForaging;
      if (contract) {
        if (values[0] !== "change") return branchNoop("没有改变采集地点。");
        const region = parsePrefixedNumber(values[1], "region:");
        if (region === undefined || !changeInsectForagingRegion(state, region)) {
          return branchNoop("没有选择有效的采集地点。");
        }
        return branchResult(`把虫虫采集服务改到了地图${region}。`, 0);
      }
      const fee = insectForagingFee(state);
      if (values[0] !== "pay:yen" || !payChoice(state, values[0], fee, 0)) {
        return branchNoop("没有签订虫虫采集服务。");
      }
      const region = parsePrefixedNumber(values[1], "region:");
      if (region === undefined || !startInsectForaging(state, region, fee)) {
        return branchNoop("没有选择有效的采集地点。");
      }
      return branchResult(`签订了虫虫采集服务，明天开始在地图${region}收集素材。`, 0);
    },
  },
  {
    id: "pendulum-search",
    targets: [39],
    label: () => "灵摆查找",
    available: (state) => anyActiveSearchSlots(state).length > 0,
    prompt: dowsingPrompt,
    execute: dowsingExecute,
  },
];

export const comf443HandlerEntry: HandlerEntry = {
  commandNo: 443,
  gateStatus: "complete",
  gateDiagnostics: [
    "target-aware CFLAG:固有コマンド dispatch",
    "default character data only; plugin/DLC branches remain hidden",
  ],
  stagedPrompt: true,
  displayCheck: (ctx) => {
    const branch = branchAvailable(ctx.state, ctx.target);
    return branch
      ? { shown: true, labelOverride: branch.label(ctx.state) }
      : { shown: false, tone: "hidden" };
  },
  execCheck: (ctx) => {
    if (!isCommandActionPhase(ctx.state)) {
      return { ok: false, reason: { kind: "precondition", message: "当前不在行动选择阶段。" } };
    }
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
      return { ok: false, reason: { kind: "precondition", message: "时间停止中不能执行固有命令。" } };
    }
    if (ctx.target <= 0 || !ctx.state.charas[ctx.target]) {
      return { ok: false, reason: { kind: "precondition", message: "固有命令需要选择对应角色。" } };
    }
    if (!responsiveTarget(ctx.state, ctx.target)) {
      return { ok: false, reason: { kind: "precondition", message: "对方现在无法回应。" } };
    }
    if (!branchAvailable(ctx.state, ctx.target)) {
      return { ok: false, reason: { kind: "precondition", message: "当前角色没有可执行的固有命令。" } };
    }
    return { ok: true };
  },
  prompt: (ctx) => {
    const branch = branchAvailable(ctx.state, ctx.target);
    return branch?.prompt?.(ctx.state, valuesOf(ctx.promptAnswer)) ?? null;
  },
  handler: (ctx): CommandResult => {
    const next = cloneGameState(ctx.state);
    const branch = branchAvailable(next, ctx.target);
    if (!branch) {
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "当前角色没有可执行的固有命令。" }],
        outcome: "blocked",
        failReason: { kind: "precondition", message: "unique command branch missing" },
      };
    }
    const result = branch.execute(next, ctx, valuesOf(ctx.promptAnswer));
    const events: ObservationEvent[] = [
      ...(result.message ? [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: result.message }] : []),
      ...(result.events ?? []),
    ];
    if (result.outcome === "ok") {
      events.push(...advanceTimeTicks(next, 3 + (result.extraTime ?? 0)).map((event) => ({
        ...event,
        timestamp: ctx.now(),
      })));
    }
    return {
      state: next,
      events,
      outcome: result.outcome,
      ...(result.outcome === "blocked" ? {
        failReason: { kind: "precondition" as const, message: result.message ?? "固有命令条件不足" },
      } : {}),
      kojoHandled: true,
    };
  },
};

export { UNIQUE_COMMAND_BRANCHES };
