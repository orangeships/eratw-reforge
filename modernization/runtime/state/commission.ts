/**
 * 委托 / 依頼 core state.
 *
 * This mirrors the original split:
 * - pending/unaccepted request: per-chara CFLAG:依頼状況 / 依頼内容;
 * - accepted requests: compact 1-based `IRAI_SLOT` arrays, modeled here as
 *   `GameState.commissions.slots` (0-based JS array, max 9).
 *
 * The V1 catalog is intentionally narrow: only source-read requests whose
 * dependencies are already modeled are allowed to generate. Missing source
 * text/kojo never becomes generated prose.
 */

import type {
  CommissionKind,
  CommissionOffer,
  CommissionProgress,
  CommissionSearchReveal,
  CommissionSlot,
  CommissionState,
  CommissionTaskKind,
  GameState,
} from "./game-state.js";
import { GATHERING_SPOT_1_ITEMS } from "./gathering.js";
import { LETTER_MATERIAL_POOL, type LetterMaterialReward } from "./commission-materials.js";
import {
  dishOrderAffinity,
  dishScoreStars,
  generateTasteRequest,
  pickDishRequest,
  scoreDishCommission,
  type DishRequest,
} from "./commission-dish.js";
import { clearDish, getDish, reviewDish } from "./dish.js";
import { addItem, ITEM_ID, itemCount, removeItem } from "./items.js";
import { grant } from "./money.js";
import { recordCommissionSignal } from "../agent/recorder.js";
import { applyRelationshipDelta } from "./relationship.js";
import {
  BASE_ID,
  ABL_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getCharaCflag,
  setCharaCflag,
} from "./settlement.js";
import { applySourceCheck, settleSourcePalam } from "../command/source-check.js";
import { createRng } from "../command/rng.js";
import { mapCanMove0 } from "../world/map-can-move.js";
import { roomIdToLocation } from "../world/room-id-location.js";
import { youbiMatch } from "../world/calendar.js";
import { atPlayerBase, mapIdOfLocation, placeFlagsOf } from "../world/location-predicates.js";
import { isSanzukawa } from "../weather/region-system.js";
import {
  hasPlace,
  PLACE_KITCHEN,
  PLACE_TRAINING,
} from "../world/place-flags.js";
import { getYogore, setYogore, sweepAmount, sweepPower } from "./yogore.js";
import type { ObservationEvent } from "../../schemas/types.js";

export const COMMISSION_MAX_SLOTS = 9;
export const ITEM_WOOD = 629;
export const ITEM_FISHING_ROD = 37;
export const ITEM_GOOD_FISH = 708;
export const ITEM_CHEAP_INGREDIENT = 81;
export const ITEM_HIGH_INGREDIENT = 83;
export const ITEM_AOJIRU = 500;

export const COMMISSION_PROGRESS = {
  Generated: -1,
  Offered: 1,
  Active: 2,
  Completed: 3,
  Expired: 4,
  MissedReport: 5,
  Failed: 6,
  EndedSuccess: 103,
  EndedExpired: 104,
  EndedMissedReport: 105,
  EndedFailed: 106,
} as const satisfies Record<string, CommissionProgress>;

export type CommissionScene =
  | "依頼提示時"
  | "依頼非受託時"
  | "依頼受託時"
  | "依頼確認時"
  | "依頼破棄時"
  | "依頼実行直前"
  | "依頼実行直後"
  | "成功報告時"
  | "失敗報告時"
  | "依頼報告不要";

export type CommissionExecutionResult = "cancel" | "success" | "failed" | "unresolved";

export interface CommissionDef {
  kind: CommissionKind;
  localId: number;
  /** Source character whose unique request owns this local id. */
  clientId?: number;
  name: string;
  description: string;
  rewardText: string;
  actName: string;
  /** Upstream `依頼実行指令名` may depend on MASTER (一般依頼17/18 branch on
   *  性別 for the joke delivery line); this overrides `actName` when present. */
  actNameFor?: (state: Readonly<GameState>) => string;
  task: CommissionTaskKind;
  weight: number;
  deadlineDays: number;
  targetChara?: (state: Readonly<GameState>, clientId: number) => number | undefined;
  targetLocation?: (state: Readonly<GameState>, clientId: number) => string | undefined;
  /** Resolve random/persisted request data at generation time. */
  resolveOffer?: (
    state: Readonly<GameState>,
    clientId: number,
    rng: CommissionRng,
  ) => CommissionOffer | undefined;
  itemId?: number;
  itemQty?: number;
  canGenerate: (state: Readonly<GameState>, clientId: number) => boolean;
  canAccept?: (state: Readonly<GameState>, clientId: number) => boolean;
  canExecute?: (state: Readonly<GameState>, slot: CommissionSlot, target: number) => boolean;
  /** Upstream `依頼人連れ出し可能` data slot (FUNC_IRAI.ERB:252): the client of
   *  an ACTIVE commission with this flag can be brought along by COMF351
   *  regardless of 態度 (COMF351 連れ出す.ERB:298). Declared by 一般依頼
   *  01/04/05/06/07/15. */
  canTakeAlong?: boolean;
  noReport?: boolean;
}

interface CommissionRng {
  int(max: number): number;
  pick<T>(arr: readonly T[]): T;
}

const FALLBACK_COMMISSION_RNG: CommissionRng = {
  int: () => 0,
  pick: <T>(arr: readonly T[]) => arr[0]!,
};

/** Optional authored-kojo hooks used while building the morning catalog. */
export interface CommissionGenerationHooks {
  /** Return true when the target's personal IRAI_BLOCKED hook suppresses it. */
  isIraiBlocked?: (
    clientId: number,
    localId: number,
    state: Readonly<GameState>,
    rng: CommissionRng,
  ) => boolean;
}

export function makeIraiId(clientId: number, localId: number): number {
  return clientId * 1000 + localId;
}

export function iraiIdToClient(iraiId: number): number {
  return Math.trunc(iraiId / 1000);
}

export function iraiIdToLocalId(iraiId: number): number {
  return iraiId % 1000;
}

export function ensureCommissionState(state: GameState): CommissionState {
  if (!state.commissions) state.commissions = { slots: [], offers: {} };
  if (!Array.isArray(state.commissions.slots)) state.commissions.slots = [];
  if (!state.commissions.offers || typeof state.commissions.offers !== "object") {
    state.commissions.offers = {};
  }
  return state.commissions;
}

export function commissionStatus(
  state: Readonly<GameState>,
  charaNum: number,
): CommissionProgress | 0 {
  const slot = state.charas[charaNum];
  if (!slot) return 0;
  const raw = slot.state.CFLAG[CFLAG_ID.依頼状況] ?? 0;
  return isCommissionProgress(raw) ? raw : 0;
}

export function commissionContent(state: Readonly<GameState>, charaNum: number): number {
  return state.charas[charaNum]?.state.CFLAG[CFLAG_ID.依頼内容] ?? 0;
}

function isCommissionProgress(value: number): value is CommissionProgress {
  return (
    value === -1 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6 ||
    value === 103 ||
    value === 104 ||
    value === 105 ||
    value === 106
  );
}

export function setCommissionProgress(
  state: GameState,
  charaNum: number,
  progress: CommissionProgress | 0,
  iraiId = commissionContent(state, charaNum),
): void {
  const slot = state.charas[charaNum];
  if (!slot) return;
  slot.state.CFLAG[CFLAG_ID.依頼状況] = progress;
  if (progress === 0) {
    slot.state.CFLAG[CFLAG_ID.依頼内容] = 0;
    if (state.commissions?.offers) delete state.commissions.offers[charaNum];
  } else {
    slot.state.CFLAG[CFLAG_ID.依頼内容] = iraiId;
  }
}

function changeRelation(state: GameState, charaNum: number, favor: number, trust: number): void {
  applyRelationshipDelta(state, charaNum, favor, trust);
}

function commissionRelationshipTarget(slot: CommissionSlot): number {
  return slot.targetCharaNum ?? slot.clientId;
}

/**
 * Unique requests call SOURCE_CHECK from their ERB bodies.  Keep that
 * settlement path authoritative here instead of approximating SOURCE with a
 * direct PALAM write; this preserves the same converters, favor floors, and
 * trust semantics used by ordinary commands.
 */
function settleUniqueSource(
  state: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  trustSeed = 0,
): void {
  if (target <= 0 || !state.charas[target]) return;
  applySourceCheck(state, target, source, 0, trustSeed);
}

function settleUniqueMasterSource(
  state: GameState,
  source: Readonly<Record<number, number>>,
): void {
  settleSourcePalam(state, state.master, state.master, source);
}

function adjustMood(state: GameState, charaNum: number, delta: number): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  slot.state.TALENT[TALENT_ID.心情] = Math.max(
    -1,
    Math.min(1, (slot.state.TALENT[TALENT_ID.心情] ?? 0) + delta),
  );
}

function addBase(state: GameState, charaNum: number, id: number, delta: number): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  slot.state.BASE[id] = (slot.state.BASE[id] ?? 0) + delta;
}

function sameSanzuLocation(state: Readonly<GameState>, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  return isSanzukawa(state.master.location) && isSanzukawa(slot.location);
}

function clientHome(state: Readonly<GameState>, clientId: number): string | undefined {
  return state.charas[clientId]?.homeLocation ?? state.charas[clientId]?.location;
}

/**
 * `IRAI_HIT(CHARA, "HAPPEN")` reads these three weights from character data.
 * Character rows retain their upstream none/common/unique weights. The
 * deterministic runtime keeps the source-backed unique definitions keyed by
 * client and local id, so their unique buckets are generated instead of being
 * silently folded into common requests; unsupported characters keep the
 * upstream 7/3/0 fallback.
 */
const COMMISSION_GENERATION_RATES: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [2, 3, 5], // Chara_data_1_霊夢.ERB
  10: [2, 3, 5],
  13: [2, 3, 5],
  14: [2, 3, 5],
  15: [2, 3, 5],
  23: [2, 3, 5],
  29: [2, 3, 5],
  30: [2, 3, 5],
  42: [0, 2, 8],
  49: [2, 3, 5],
  51: [2, 3, 5],
  76: [2, 3, 5],
  79: [2, 3, 5],
  139: [2, 3, 5],
  159: [2, 3, 5],
};

function generationBucket(
  clientId: number,
  rng: CommissionRng,
): "common" | "unique" | null {
  const [none, common, unique] = COMMISSION_GENERATION_RATES[clientId] ?? [7, 3, 0];
  const total = none + common + unique;
  if (total <= 0) return null;
  const roll = rng.int(total);
  if (roll < none) return null;
  return roll < none + common ? "common" : "unique";
}

/** Upstream CAN_MEET: exists, is not banned/passerby, and is not the active roleplay slot. */
function canMeet(state: Readonly<GameState>, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) return false;
  if ((state.flagStore[FLAG_ID.扮演] ?? 0) === charaNum) return false;
  if ((slot.state.TALENT[TALENT_ID.路人] ?? 0) !== 0) return false;
  return true;
}

function sameMap(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.split(":")[0] === b.split(":")[0];
}

function isResponsive(state: Readonly<GameState>, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  if ((state.flagStore[70] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) return false;
  return true;
}

function firstOtherChara(state: Readonly<GameState>, clientId: number): number | undefined {
  const ids = Object.keys(state.charas)
    .map(Number)
    .filter((id) => id > 0 && id !== clientId && state.charas[id]);
  return ids.sort((a, b) => a - b)[0];
}

function otherMeetableCharas(state: Readonly<GameState>, clientId: number): number[] {
  return Object.keys(state.charas)
    .map(Number)
    .filter((id) => id > 0 && id !== clientId && canMeet(state, id))
    .sort((a, b) => a - b);
}

function randomOtherChara(
  state: Readonly<GameState>,
  clientId: number,
  rng: CommissionRng,
): number | undefined {
  const candidates = otherMeetableCharas(state, clientId);
  return candidates.length > 0 ? candidates[Math.max(0, Math.min(candidates.length - 1, rng.int(candidates.length)))] : undefined;
}

/** The fixed place pool from `FUNC_IRAI.ERB:@RAND_PLACE(..., "LOST_ITEM")`. */
const LOST_ITEM_PLACE_IDS = [
  1, 2, 3, 5, 20, 21, 22, 23, 24, 25, 36,
  101, 102, 121, 122, 123, 124,
  201, 202, 203, 204, 205, 206, 207, 211, 212, 213, 214, 215, 216, 217, 218, 219, 222,
  301, 302, 306, 309, 334, 343,
  401, 403, 405, 433, 434, 436, 438, 447,
  501, 502, 503, 506, 507, 508, 509, 510, 520, 534, 540,
  610, 620, 630, 640, 650, 660, 670, 680, 690,
  701, 702, 703, 705, 707, 708, 711, 732,
  801, 802, 803, 804, 805, 806, 811, 814, 830, 831, 832, 833,
  901, 902, 926, 931, 932, 933, 939, 944, 945, 946, 948,
  1010, 1050, 1070, 1080, 1090,
] as const;

function lostItemPlaceCandidates(
  state: Readonly<GameState>,
  clientId: number,
): string[] {
  const home = clientHome(state, clientId);
  if (!home) return [];
  const homeMap = mapIdOfLocation(home);
  const homePrefix = home.split(":")[0];
  return LOST_ITEM_PLACE_IDS
    .map((roomId) => roomIdToLocation(roomId))
    .filter((location): location is string => location !== null)
    .filter((location, index, all) => all.indexOf(location) === index)
    .filter((location) => {
      const map = mapIdOfLocation(location);
      return homeMap !== null && map !== null
        ? map !== homeMap
        : location.split(":")[0] !== homePrefix;
    });
}

function randomLostItemPlace(
  state: Readonly<GameState>,
  clientId: number,
  rng: CommissionRng,
): string | undefined {
  const candidates = lostItemPlaceCandidates(state, clientId);
  return candidates.length > 0
    ? candidates[Math.max(0, Math.min(candidates.length - 1, rng.int(candidates.length)))]
    : undefined;
}

function lostPersonOffer(
  state: Readonly<GameState>,
  clientId: number,
  rng: CommissionRng,
  sub: number,
): CommissionOffer | undefined {
  const targetCharaNum = randomOtherChara(state, clientId, rng);
  return targetCharaNum === undefined
    ? undefined
    : { targetCharaNum, sub, searchReveal: "hidden" };
}

function lostPlaceOffer(
  state: Readonly<GameState>,
  clientId: number,
  rng: CommissionRng,
  sub: number,
): CommissionOffer | undefined {
  const targetLocation = randomLostItemPlace(state, clientId, rng);
  return targetLocation === undefined
    ? undefined
    : { targetLocation, sub, searchReveal: "hidden" };
}

function cleaningDefAccept(state: Readonly<GameState>, clientId: number): boolean {
  if (!canMeet(state, clientId)) return false;
  const home = clientHome(state, clientId);
  if (!home) return false;
  return sameMap(state.master.location, home) && getYogore(state as GameState, home) >= 1000;
}

function cleaningDefExecute(state: Readonly<GameState>, slot: CommissionSlot, target: number): boolean {
  return target === slot.clientId && isResponsive(state, target);
}

const COMMISSION_BASE_DEFS: readonly CommissionDef[] = [
  {
    kind: "common",
    localId: 1,
    name: "帮忙做扫除",
    description: "%CALLNAME:TARGET%好像想请你帮忙打扫房间。",
    rewardText: "低级素材",
    actName: "开始扫除",
    task: "work",
    weight: 10,
    deadlineDays: 0,
    targetLocation: clientHome,
    canGenerate: cleaningDefAccept,
    canAccept: cleaningDefAccept,
    canExecute: cleaningDefExecute,
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 2,
    name: "给花浇水",
    description: "为%CALLNAME:TARGET%自宅的草木浇水。",
    rewardText: "¥500",
    actName: "浇水",
    task: "deliver_place",
    weight: 15,
    deadlineDays: 0,
    targetLocation: clientHome,
    canGenerate: (state, clientId) => {
      const home = clientHome(state, clientId);
      return (
        canMeet(state, clientId) &&
        sameMap(state.master.location, home) &&
        mapCanMove0(state as GameState, home ?? "", state.master).can &&
        (state.charas[clientId]?.state.ABL[ABL_ID.親密] ?? 0) >= 2
      );
    },
    canAccept: (state, clientId) => sameMap(state.master.location, clientHome(state, clientId)),
    canExecute: (state, slot) => state.master.location === slot.targetLocation,
    noReport: false,
  },
  {
    kind: "common",
    localId: 3,
    name: "一起玩吧",
    description: "和%CALLNAME:TARGET%一起玩。",
    rewardText: "关系变好",
    actName: "玩游戏",
    task: "work",
    weight: 15,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      (state.charas[clientId]?.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0,
    canExecute: (_state, slot, target) => target === slot.clientId,
  },
  {
    kind: "common",
    localId: 4,
    name: "想变得擅长料理",
    description: "陪%CALLNAME:TARGET%练习料理。",
    rewardText: "¥500",
    actName: "料理练习",
    task: "work",
    weight: 10,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      ability(state, 0, ABL_ID.料理技能) >= 2 &&
      ability(state, clientId, ABL_ID.料理技能) < ability(state, 0, ABL_ID.料理技能) &&
      ability(state, clientId, ABL_ID.親密) >= 3,
    canAccept: (state) => atPlayerBase(state as GameState, 0) && !hasCurrentDish(state),
    canExecute: (state, slot, target) =>
      target === slot.clientId &&
      hasPlace(placeFlagsOf(state.master.location), PLACE_KITCHEN) &&
      !hasCurrentDish(state),
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 5,
    name: "陪我特训",
    description: "陪%CALLNAME:TARGET%进行战斗训练。",
    rewardText: "¥500",
    actName: "开始特训",
    task: "work",
    weight: 10,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      ability(state, 0, ABL_ID.战斗能力) >= 1 &&
      ability(state, clientId, ABL_ID.战斗能力) <= ability(state, 0, ABL_ID.战斗能力) &&
      ability(state, clientId, ABL_ID.親密) >= 2,
    canExecute: (state, slot, target) =>
      target === slot.clientId && hasPlace(placeFlagsOf(state.master.location), PLACE_TRAINING),
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 6,
    name: "谁来教教我！",
    description: "回答%CALLNAME:TARGET%的问题。",
    rewardText: "¥500",
    actName: "回答问题",
    task: "work",
    weight: 10,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      ability(state, clientId, ABL_ID.教養) <= ability(state, 0, ABL_ID.教養),
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 7,
    name: "大扫除做不完",
    description: "在年末帮%CALLNAME:TARGET%完成大扫除。",
    rewardText: "¥1500",
    actName: "帮忙大扫除",
    task: "deliver_place",
    weight: 80,
    deadlineDays: 0,
    targetLocation: clientHome,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      isWinterYearEnd(state) &&
      sameMap(state.master.location, clientHome(state, clientId)) &&
      ability(state, clientId, ABL_ID.親密) >= 3,
    canAccept: (state, clientId) =>
      isWinterYearEnd(state) && sameMap(state.master.location, clientHome(state, clientId)),
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 8,
    name: "送信",
    description: "给某人送信。",
    rewardText: "素材4个",
    actName: "送出信件",
    task: "deliver_person",
    weight: 10,
    deadlineDays: 3,
    targetChara: firstOtherChara,
    resolveOffer: (state, clientId, rng) => {
      const targetCharaNum = randomOtherChara(state, clientId, rng);
      return targetCharaNum === undefined ? undefined : { targetCharaNum };
    },
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      (getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) >= 30) &&
      otherMeetableCharas(state, clientId).length > 0,
    canAccept: (state, clientId) =>
      (getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) >= 30) &&
      firstOtherChara(state, clientId) !== undefined,
    canExecute: (_state, slot, target) => target === slot.targetCharaNum,
  },
  {
    kind: "common",
    localId: 9,
    name: "不知是谁的失物",
    description: "寻找失物的主人。",
    rewardText: "上级素材",
    actName: "询问失物",
    task: "deliver_person",
    weight: 4,
    deadlineDays: 10,
    targetChara: firstOtherChara,
    resolveOffer: (state, clientId, rng) => lostPersonOffer(state, clientId, rng, rng.int(3) + 1),
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) >= 30 &&
      otherMeetableCharas(state, clientId).length > 0,
  },
  {
    kind: "common",
    localId: 10,
    name: "怎么也找不到",
    description: "前往指定地点寻找遗失物。",
    rewardText: "上级素材2个",
    actName: "寻找遗失物",
    task: "deliver_place",
    weight: 3,
    deadlineDays: 10,
    targetLocation: firstOtherHome,
    resolveOffer: (state, clientId, rng) => lostPlaceOffer(state, clientId, rng, rng.int(2) + 1),
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) >= 30 &&
      lostItemPlaceCandidates(state, clientId).length > 0,
  },
  {
    kind: "common",
    localId: 11,
    name: "怎么也找不到",
    description: "向知情者询问遗失物的下落。",
    rewardText: "¥3200",
    actName: "询问线索",
    task: "deliver_person",
    weight: 3,
    deadlineDays: 10,
    targetChara: firstOtherChara,
    resolveOffer: (state, clientId, rng) => lostPersonOffer(state, clientId, rng, 0),
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) >= 30 &&
      otherMeetableCharas(state, clientId).length > 0,
  },
  {
    kind: "common",
    localId: 12,
    name: "替我教训一下！",
    description: "替%CALLNAME:TARGET%战胜指定对象。",
    rewardText: "讨伐赏金",
    actName: "进行讨伐",
    task: "deliver_person",
    weight: 2,
    deadlineDays: 10,
    targetChara: firstOtherChara,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      ability(state, clientId, ABL_ID.战斗能力) >= 1 &&
      ability(state, 0, ABL_ID.战斗能力) >= 1 &&
      firstOtherChara(state, clientId) !== undefined,
  },
  {
    kind: "common",
    localId: 13,
    name: "想吃好吃的鱼",
    description: "给%CALLNAME:TARGET%带一条好吃的鱼。",
    rewardText: "高级食材3个",
    actName: "交付好吃的鱼",
    task: "procure",
    weight: 3,
    deadlineDays: 5,
    itemId: ITEM_GOOD_FISH,
    itemQty: 1,
    canGenerate: (state, clientId) => canMeet(state, clientId),
    canAccept: (state) => itemCount(state as GameState, ITEM_FISHING_ROD) > 0,
  },
  {
    kind: "common",
    localId: 14,
    name: "缺柴火了",
    description: "运送木柴。",
    rewardText: "平价食材３个",
    actName: "给5块木柴",
    task: "procure",
    weight: 3,
    deadlineDays: 5,
    itemId: ITEM_WOOD,
    itemQty: 5,
    canGenerate: (state, clientId) => canMeet(state, clientId),
    canExecute: (_state, slot, target) => target === slot.clientId,
  },
  {
    kind: "common",
    localId: 15,
    name: "想被你拥抱",
    description: "%CALLNAME:TARGET%提出了只对成年人开放的私人请求。",
    rewardText: "¥20000",
    actName: "回应请求",
    task: "work",
    weight: 1,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) &&
      ((state.charas[clientId]?.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0 ||
        (state.charas[clientId]?.state.TALENT[TALENT_ID.セフレ] ?? 0) !== 0),
    canTakeAlong: true,
  },
  {
    kind: "common",
    localId: 16,
    name: "烦恼咨询",
    description: "听取%CALLNAME:TARGET%的烦恼并给出建议。",
    rewardText: "蔬果或素材",
    actName: "听取烦恼",
    task: "work",
    weight: 5,
    deadlineDays: 0,
    canGenerate: (state, clientId) =>
      canMeet(state, clientId) && ability(state, 0, ABL_ID.話術技能) >= 1,
  },
  {
    kind: "common",
    localId: 17,
    // 一般依頼17_あれがたべたい.ERB:16-52 — 依頼名 / 依頼内容表示 /
    // 依頼報酬表示 / 依頼実行指令名 verbatim.
    name: "我想吃那个！那个叫什么来着？",
    description: "凭借模糊的记忆做出并送上料理",
    rewardText: "¥2,500＋奖金",
    actName: "交付料理",
    actNameFor: (state) =>
      (state.master.state.TALENT[TALENT_ID.性別] ?? 0) === 2 ? "您好，外卖到了" : "您好，UmanEats外送",
    task: "work",
    weight: 5,
    deadlineDays: 3,
    // 依頼サブ = RAND:1000000 (`:41-43`) — the seed the taste draw re-uses.
    resolveOffer: (_state, _clientId, rng) => ({ sub: rng.int(1000000) }),
    canGenerate: (state, clientId) => canMeet(state, clientId) && clientId !== 80,
    // 依頼受託可能条件 is unconditional upstream (`:53-54`): accept first, cook
    // within the 3-day deadline. 依頼実行可能条件 needs DISH_NAME (`:55-57`).
    canExecute: (state) => hasCurrentDish(state),
  },
  {
    kind: "common",
    localId: 18,
    // 一般依頼18_おなかすいた.ERB:16-52.
    name: "有谁能帮我做一下吗！",
    description: "接受点单并送达",
    rewardText: "¥2,000＋奖金",
    actName: "交付料理",
    actNameFor: (state) =>
      (state.master.state.TALENT[TALENT_ID.性別] ?? 0) === 2 ? "您好，外卖到了" : "您好，UmanEats外送",
    task: "work",
    weight: 5,
    deadlineDays: 3,
    resolveOffer: (_state, _clientId, rng) => ({ sub: rng.int(1000000) }),
    canGenerate: (state, clientId) => canMeet(state, clientId),
    canExecute: (state) => hasCurrentDish(state),
  },
  {
    kind: "unique",
    localId: 101,
    clientId: 1,
    name: "揉肩",
    description: "为灵梦揉肩。",
    rewardText: "青汁",
    actName: "揉肩",
    task: "work",
    weight: 10,
    deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId) && clientId === 1,
    canExecute: (_state, slot, target) => target === slot.clientId,
  },
];

export function findCommissionDef(
  kind: CommissionKind,
  localId: number,
  clientId?: number,
): CommissionDef | undefined {
  return COMMISSION_DEFS.find((d) =>
    d.kind === kind &&
    d.localId === localId &&
    (clientId === undefined || d.clientId === undefined || d.clientId === clientId),
  );
}

export function defFromIraiId(iraiId: number): CommissionDef | undefined {
  const clientId = iraiIdToClient(iraiId);
  const localId = iraiIdToLocalId(iraiId);
  return findCommissionDef(localId >= 100 ? "unique" : "common", localId, clientId);
}

export function eligibleDefsForClient(
  state: Readonly<GameState>,
  clientId: number,
  hooks: CommissionGenerationHooks = {},
  rng?: CommissionRng,
): CommissionDef[] {
  return COMMISSION_DEFS.filter((def) => {
    if (def.clientId !== undefined && def.clientId !== clientId) return false;
    if (!def.canGenerate(state, clientId)) return false;
    if (!hooks.isIraiBlocked) return true;
    // The normal morning path always supplies its seeded RNG. Direct catalog
    // callers without one still fail closed rather than evaluating authored
    // random logic nondeterministically.
    if (!rng) return false;
    return !hooks.isIraiBlocked(clientId, def.localId, state, rng);
  });
}

function firstOtherHome(state: Readonly<GameState>, clientId: number): string | undefined {
  const target = firstOtherChara(state, clientId);
  return target === undefined ? undefined : clientHome(state, target);
}

function ability(state: Readonly<GameState>, charaNum: number, id: number): number {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  return slot?.state.ABL[id] ?? 0;
}

function hasCurrentDish(state: Readonly<GameState>): boolean {
  return getDish(state as GameState) !== null;
}

/** Parse "commission:{clientId}:{localId}" → localId, or null on parse failure. */
function parseAgentCandidateLocalId(candidateId: string): number | null {
  const parts = candidateId.split(":");
  if (parts.length !== 3 || parts[0] !== "commission") return null;
  const localId = Number(parts[2]);
  return Number.isFinite(localId) && localId > 0 ? localId : null;
}

function isWinterYearEnd(state: Readonly<GameState>): boolean {
  const date = state.time.date ?? 1;
  return (state.time.season ?? 1) === 4 && date >= 15 && date <= 31;
}

function fixedRoom(roomId: number): CommissionDef["targetLocation"] {
  return () => roomIdToLocation(roomId) ?? undefined;
}

function fixedTarget(charaNum: number): CommissionDef["targetChara"] {
  return (state) => (canMeet(state, charaNum) ? charaNum : undefined);
}

function hasAnyItem(state: Readonly<GameState>, ids: readonly number[], min: number): boolean {
  return ids.reduce((sum, id) => sum + itemCount(state as GameState, id), 0) >= min;
}

function removeAnyItems(state: GameState, ids: readonly number[], count: number): boolean {
  if (!hasAnyItem(state, ids, count)) return false;
  let remaining = count;
  for (const id of ids) {
    const used = Math.min(remaining, itemCount(state, id));
    if (used > 0) removeItem(state, id, used);
    remaining -= used;
    if (remaining <= 0) break;
  }
  return remaining === 0;
}

function hasPenis(state: Readonly<GameState>, charaNum = 0): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  return ((slot?.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
}

function summerFirstHalf(state: Readonly<GameState>): boolean {
  const date = state.time.date ?? 1;
  return (state.time.season ?? 1) === 2 && date >= 1 && date <= 15;
}

function summerSeason(state: Readonly<GameState>): boolean {
  return (state.time.season ?? 1) === 2;
}

function sourceWorkWindow(state: Readonly<GameState>, weekdays: string, startHour: number, endHour: number): boolean {
  const hour = state.time.hourOfDay ?? Math.trunc((state.time.tickValue % 1440) / 60);
  return youbiMatch(state.time.dayIndex, weekdays) && hour >= startHour && hour <= endHour;
}

const ALCOHOL_ITEMS = [ITEM_ID.DOBUROKU, ITEM_ID.SAKE, ITEM_ID.ONIKOROSHI] as const;

/** Source-backed unique requests whose handlers are deterministic even when
 * their original prose/choice scenes are not represented in the web runtime. */
const COMMISSION_UNIQUE_DEFS_SOURCE: readonly CommissionDef[] = [
  {
    kind: "unique", localId: 102, name: "代送信件", description: "把信件送给指定的人。", rewardText: "¥500", actName: "代送信件",
    task: "deliver_person", weight: 10, deadlineDays: 7, targetChara: fixedTarget(11), noReport: true,
    canGenerate: (state, clientId) => canMeet(state, clientId) && canMeet(state, 11) &&
      (mapIdOfLocation(state.charas[11]?.location ?? "") ?? 0) !== 0,
  },
  {
    kind: "unique", localId: 103, name: "宴会帮忙", description: "在宴会中帮忙。", rewardText: "宴会报酬", actName: "参加宴会",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId) && (state.flagStore[FLAG_ID.宴会開催FLAG] ?? 0) !== 0,
    canExecute: (state) => hasAnyItem(state, ALCOHOL_ITEMS, 10),
  },
  {
    kind: "unique", localId: 101, name: "准备清酒", description: "准备一瓶清酒。", rewardText: "¥5000", actName: "准备清酒",
    task: "procure", weight: 10, deadlineDays: 5, itemId: ITEM_ID.SAKE, itemQty: 1,
    canGenerate: (state, clientId) => canMeet(state, clientId),
  },
  {
    kind: "unique", localId: 101, name: "买冰淇淋", description: "准备六份冰淇淋。", rewardText: "¥3000", actName: "准备冰淇淋",
    task: "procure", weight: 10, deadlineDays: 0, itemId: ITEM_ID.ICE_CREAM, itemQty: 6,
    canGenerate: (state, clientId) => canMeet(state, clientId) && canMeet(state, 14),
  },
  {
    kind: "unique", localId: 101, name: "青蛙游戏", description: "陪对方玩一场游戏。", rewardText: "青蛙", actName: "陪玩",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId),
  },
  {
    kind: "unique", localId: 101, name: "送信给美铃", description: "把信交给美铃。", rewardText: "¥1000", actName: "送信",
    task: "deliver_person", weight: 10, deadlineDays: 0, targetChara: fixedTarget(58), noReport: true,
    canGenerate: (state, clientId) => canMeet(state, clientId) && canMeet(state, 58),
    canAccept: (state) => sourceWorkWindow(state, "月火水木金", 7, 11),
  },
  {
    kind: "unique", localId: 101, name: "赌场筹码", description: "带一百枚赌场筹码前往赌场。", rewardText: "¥20000", actName: "交付筹码",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId) && (state.casinoChips ?? 0) < 100,
    canExecute: (state) => (state.casinoChips ?? 0) >= 100,
  },
  {
    kind: "unique", localId: 101, name: "准备酒", description: "准备三份酒。", rewardText: "¥5000", actName: "准备酒",
    task: "work", weight: 10, deadlineDays: 8,
    canGenerate: (state, clientId) => canMeet(state, clientId),
    canExecute: (state) => hasAnyItem(state, ALCOHOL_ITEMS, 3),
  },
  {
    kind: "unique", localId: 102, name: "调查地点", description: "前往人间之里中央调查。", rewardText: "¥3000", actName: "地点调查",
    task: "deliver_place", weight: 10, deadlineDays: 7, targetLocation: fixedRoom(202),
    canGenerate: (state, clientId) => canMeet(state, clientId) && roomIdToLocation(202) !== null,
  },
  {
    kind: "unique", localId: 101, name: "给小町送信", description: "把信送给小町。", rewardText: "¥1000", actName: "送信",
    task: "deliver_person", weight: 10, deadlineDays: 10, targetChara: fixedTarget(76),
    canGenerate: (state, clientId) => canMeet(state, clientId) && canMeet(state, 76),
    canAccept: (state) => sourceWorkWindow(state, "月水金", 11, 15) && sameSanzuLocation(state, 76) &&
      (state.charas[76]?.state.CFLAG[CFLAG_ID.産休中] ?? 0) === 0,
    canExecute: (state) => sameSanzuLocation(state, 76) &&
      (state.charas[76]?.state.CFLAG[CFLAG_ID.産休中] ?? 0) === 0,
  },
  {
    kind: "unique", localId: 102, name: "归还书籍", description: "把书归还到指定地点。", rewardText: "¥500", actName: "归还书籍",
    task: "deliver_place", weight: 10, deadlineDays: 3, targetLocation: fixedRoom(213),
    canGenerate: (state, clientId) => canMeet(state, clientId) && roomIdToLocation(213) !== null,
  },
  {
    kind: "unique", localId: 103, name: "归还另一本书", description: "把书归还到指定地点。", rewardText: "¥500", actName: "归还书籍",
    task: "deliver_place", weight: 10, deadlineDays: 3, targetLocation: fixedRoom(310),
    canGenerate: (state, clientId) => canMeet(state, clientId) && roomIdToLocation(310) !== null,
  },
  {
    kind: "unique", localId: 101, name: "小料理屋调查", description: "前往小料理屋完成调查。", rewardText: "¥3000", actName: "调查",
    task: "deliver_place", weight: 10, deadlineDays: 7, targetLocation: fixedRoom(218),
    canGenerate: (state, clientId) => canMeet(state, clientId) &&
      (state.charas[clientId]?.state.CFLAG[CFLAG_ID.はたて美食記事] ?? 0) >= 1 &&
      ability(state, 0, ABL_ID.教養) >= 1 && roomIdToLocation(218) !== null,
  },
  {
    kind: "unique", localId: 101, name: "借阅书籍", description: "借到指定的书。", rewardText: "¥500", actName: "借书",
    task: "work", weight: 10, deadlineDays: 7,
    canGenerate: (state, clientId) => canMeet(state, clientId),
    canExecute: (state) => state.master.location === roomIdToLocation(213) || state.master.location === roomIdToLocation(310),
  },
  {
    kind: "unique", localId: 102, name: "归还人里的书", description: "把书归还到人间之里。", rewardText: "¥500", actName: "归还书籍",
    task: "deliver_place", weight: 10, deadlineDays: 3, targetLocation: fixedRoom(213),
    canGenerate: (state, clientId) => canMeet(state, clientId) && roomIdToLocation(213) !== null,
  },
  {
    kind: "unique", localId: 103, name: "归还魔界的书", description: "把书归还到魔界。", rewardText: "¥500", actName: "归还书籍",
    task: "deliver_place", weight: 10, deadlineDays: 3, targetLocation: fixedRoom(310),
    canGenerate: (state, clientId) => canMeet(state, clientId) && roomIdToLocation(310) !== null,
  },
  {
    kind: "unique", localId: 101, name: "准备黄瓜", description: "准备一根黄瓜。", rewardText: "¥1000", actName: "准备黄瓜",
    task: "procure", weight: 10, deadlineDays: 7, itemId: ITEM_ID.CUCUMBER, itemQty: 1,
    canGenerate: (state, clientId) => canMeet(state, clientId),
  },
  {
    kind: "unique", localId: 102, name: "赌场筹码交换", description: "带一百枚赌场筹码。", rewardText: "跳蛋", actName: "交付筹码",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId) && (state.casinoChips ?? 0) < 100,
    canExecute: (state) => (state.casinoChips ?? 0) >= 100,
  },
  {
    kind: "unique", localId: 101, name: "三途川帮忙", description: "在三途川帮忙。", rewardText: "¥5000", actName: "帮忙",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId) && summerFirstHalf(state),
    canAccept: (state) => summerFirstHalf(state) && sourceWorkWindow(state, "月火水木金", 10, 15) &&
      (state.flagStore[FLAG_ID.宴会開催FLAG] ?? 0) === 0 &&
      (state.charas[76]?.state.CFLAG[CFLAG_ID.宴会参加] ?? 0) === 0 && sameSanzuLocation(state, 76),
    canExecute: (state) => summerFirstHalf(state) && sourceWorkWindow(state, "月火水木金", 10, 15) &&
      (state.flagStore[FLAG_ID.宴会開催FLAG] ?? 0) === 0 && sameSanzuLocation(state, 76),
  },
  {
    kind: "unique", localId: 101, name: "甜酒二瓶", description: "准备两瓶甜酒。", rewardText: "¥1000", actName: "准备甜酒",
    task: "procure", weight: 10, deadlineDays: 3, itemId: ITEM_ID.SWEET_SAKE, itemQty: 2,
    canGenerate: (state, clientId) => canMeet(state, clientId) && !summerSeason(state),
  },
  {
    kind: "unique", localId: 101, name: "精液请求", description: "完成已建模的精液委托条件。", rewardText: "¥50000", actName: "完成请求",
    task: "work", weight: 10, deadlineDays: 30,
    canGenerate: (state, clientId) => canMeet(state, clientId) && !!state.charas[139] &&
      (state.charas[139]?.state.EXP[EXP_ID.精液経験] ?? 0) > 0 && hasPenis(state),
    canExecute: (state) => (state.master.state.TALENT[TALENT_ID.濃厚精液] ?? 0) !== 0,
  },
  {
    kind: "unique", localId: 101, name: "风景作业", description: "完成一项风景相关工作。", rewardText: "道具503", actName: "风景作业",
    task: "work", weight: 10, deadlineDays: 0,
    canGenerate: (state, clientId) => canMeet(state, clientId),
  },
  {
    kind: "unique", localId: 102, name: "归还遗失物", description: "把遗失物交还给灵梦。", rewardText: "¥500", actName: "归还遗失物",
    task: "deliver_person", weight: 10, deadlineDays: 7, targetChara: fixedTarget(1), noReport: true,
    canGenerate: (state, clientId) => canMeet(state, clientId) && canMeet(state, 11) &&
      (mapIdOfLocation(state.charas[11]?.location ?? "") ?? 0) !== 0,
  },
];

const COMMISSION_UNIQUE_CLIENT_IDS = [
  1, 1, 10, 13, 14, 15, 23, 29, 29, 30, 30, 30, 42, 49, 49, 49, 51, 51, 76, 79, 139, 159, 159,
] as const;

const COMMISSION_UNIQUE_DEFS: readonly CommissionDef[] = COMMISSION_UNIQUE_DEFS_SOURCE.map((def, index) => ({
  ...def,
  clientId: COMMISSION_UNIQUE_CLIENT_IDS[index],
}));

export const COMMISSION_DEFS: readonly CommissionDef[] = [
  ...COMMISSION_BASE_DEFS,
  ...COMMISSION_UNIQUE_DEFS,
];

function weightedPick<T extends { weight: number }>(
  items: readonly T[],
  rng: CommissionRng,
): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return undefined;
  let roll = rng.int(total);
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll < 0) return item;
  }
  return items[0];
}

function resolveCommissionOffer(
  state: Readonly<GameState>,
  clientId: number,
  def: CommissionDef,
  rng: CommissionRng,
): CommissionOffer | undefined {
  if (def.resolveOffer) return def.resolveOffer(state, clientId, rng);
  const targetCharaNum = def.targetChara?.(state, clientId);
  const targetLocation = def.targetLocation?.(state, clientId);
  // A generated request with a missing target is invalid.  In particular,
  // never fall back to the client's home for a source-backed lost-place roll.
  if (def.targetChara && targetCharaNum === undefined) return undefined;
  if (def.targetLocation && targetLocation === undefined) return undefined;
  return {
    ...(targetCharaNum !== undefined ? { targetCharaNum } : {}),
    ...(targetLocation !== undefined ? { targetLocation } : {}),
  };
}

export function setNewCommission(
  state: GameState,
  clientId: number,
  def: CommissionDef,
  progress: CommissionProgress = COMMISSION_PROGRESS.Generated,
  rng: CommissionRng = FALLBACK_COMMISSION_RNG,
): boolean {
  if (!state.charas[clientId]) return false;
  if (commissionStatus(state, clientId) !== 0) return false;
  const offer = resolveCommissionOffer(state, clientId, def, rng);
  if (!offer) return false;
  const iraiId = makeIraiId(clientId, def.localId);
  const commissions = ensureCommissionState(state);
  commissions.offers[clientId] = offer;
  setCommissionProgress(state, clientId, progress, iraiId);
  return true;
}

/**
 * Deterministic scratch RNG for the dish-commission draws.
 *
 * Upstream wraps the 17/18 taste and point-order draws in
 * `DUMPRAND / RANDOMIZE IRAI_SUB:受諾 / … / INITRAND`
 * (`一般17.ERB:86-89`, `COMF366 依頼を聞く.ERB:128-132`, `一般18.ERB:108-159`)
 * so the same request is regenerated identically on every display. We draw
 * once at acceptance and persist the result on the slot, seeding from the
 * same `依頼サブ` (`slot.sub`, drawn in `resolveOffer`) so the values are
 * stable for the life of the slot and reproducible across runs.
 */
function dishCommissionRng(slot: CommissionSlot): CommissionRng {
  const mixed =
    Math.imul(slot.iraiId, 2654435761) ^
    Math.imul(slot.sub ?? slot.acceptedDay * 7919 + 13, 40503);
  return createRng(mixed | 0);
}

export function acceptCommission(
  state: GameState,
  clientId: number,
): CommissionSlot | null {
  if (commissionStatus(state, clientId) !== COMMISSION_PROGRESS.Offered) return null;
  const iraiId = commissionContent(state, clientId);
  const def = defFromIraiId(iraiId);
  if (!def) return null;
  const commissions = ensureCommissionState(state);
  if (commissions.slots.length >= COMMISSION_MAX_SLOTS) return null;
  if (commissions.slots.some((s) => s.iraiId === iraiId)) return null;
  const pending = commissions.offers[clientId];
  const fallback = resolveCommissionOffer(state, clientId, def, FALLBACK_COMMISSION_RNG);
  const offer = pending ?? fallback;
  if (!offer) return null;
  const targetCharaNum = offer.targetCharaNum;
  const targetLocation = offer.targetLocation;
  const slot: CommissionSlot = {
    iraiId,
    clientId,
    localId: def.localId,
    kind: def.kind,
    task: def.task,
    deadlineDay: def.deadlineDays > 0 ? state.time.dayIndex + def.deadlineDays : 0,
    acceptedDay: state.time.dayIndex,
    ...(targetCharaNum !== undefined ? { targetCharaNum } : {}),
    ...(targetLocation !== undefined ? { targetLocation } : {}),
    ...(offer.sub !== undefined ? { sub: offer.sub } : {}),
    ...(offer.searchReveal !== undefined ? { searchReveal: offer.searchReveal } : {}),
    ...(offer.revealedLocation !== undefined ? { revealedLocation: offer.revealedLocation } : {}),
    ...(def.itemId !== undefined ? { itemId: def.itemId } : {}),
    ...(def.itemQty !== undefined ? { itemQty: def.itemQty } : {}),
  };
  commissions.slots.push(slot);
  delete commissions.offers[clientId];
  syncCommissionTargets(state);
  setCommissionProgress(state, clientId, COMMISSION_PROGRESS.Active, iraiId);
  // 一般依頼17 味要求 / 一般依頼18 点单 — resolved once here so the accept
  // dialog, the popup detail panel and the delivery all read the same request.
  if (def.kind === "common" && def.localId === 17) {
    slot.tasteRequest = generateTasteRequest(clientId, dishCommissionRng(slot));
  } else if (def.kind === "common" && def.localId === 18) {
    const request: DishRequest | undefined = pickDishRequest(
      clientId,
      dishOrderAffinity(state, clientId),
      canBringCommissionClient(state, clientId),
      dishCommissionRng(slot),
    );
    if (request) slot.dishRequest = request;
  }
  // A1 — record agent interaction signal.
  recordCommissionSignal(state, clientId, `委托受理 #iraiId=${iraiId}`);
  return slot;
}

export function clearCommissionSlot(
  state: GameState,
  slot: CommissionSlot,
  progress: CommissionProgress | 0,
): void {
  const commissions = ensureCommissionState(state);
  commissions.slots = commissions.slots.filter((s) => s.iraiId !== slot.iraiId);
  delete commissions.offers[slot.clientId];
  syncCommissionTargets(state);
  setCommissionProgress(state, slot.clientId, progress, progress === 0 ? 0 : slot.iraiId);
}

export function syncCommissionTargets(state: GameState): void {
  const commissions = ensureCommissionState(state);
  const slots = commissions.slots.slice(0, COMMISSION_MAX_SLOTS);
  state.commissions = { ...commissions, slots };
  for (let i = 0; i < COMMISSION_MAX_SLOTS; i += 1) {
    const cflagId = CFLAG_ID.依頼対象1 + i;
    const target = slots[i]?.targetCharaNum ?? slots[i]?.clientId ?? 0;
    setCharaCflag(state, 0, cflagId, target);
  }
}

export function findSlotByClient(
  state: Readonly<GameState>,
  clientId: number,
): CommissionSlot | undefined {
  return state.commissions?.slots.find((slot) => slot.clientId === clientId);
}

/** Upstream `@CAN_IRAI_CHARA_GO_TOGATHER` / `@CAN_IRAI_SLOT_GO_TOGATHER`
 *  (FUNC_IRAI.ERB:227-256): a chara can be brought along by COMF351 when an
 *  ACTIVE commission slot declares `依頼人連れ出し可能` for them as the client.
 *  The original gates this independently of 態度 (COMF351.ERB:298
 *  `態度>0 || CAN_IRAI_CHARA_GO_TOGATHER`). */
export function canBringCommissionClient(
  state: Readonly<GameState>,
  charaNum: number,
): boolean {
  if (commissionStatus(state, charaNum) !== COMMISSION_PROGRESS.Active) return false;
  const slot = findSlotByClient(state, charaNum);
  if (!slot) return false;
  const def = defFromIraiId(commissionContent(state, charaNum));
  return def?.canTakeAlong === true;
}

export function canAcceptCommission(state: Readonly<GameState>, clientId: number): boolean {
  const status = commissionStatus(state, clientId);
  if (status !== COMMISSION_PROGRESS.Offered) return false;
  if ((state.commissions?.slots.length ?? 0) >= COMMISSION_MAX_SLOTS) return false;
  const def = defFromIraiId(commissionContent(state, clientId));
  if (!def) return false;
  return def.canAccept ? def.canAccept(state, clientId) : true;
}

/** Return a short human-readable reason why this commission cannot be
 *  accepted right now, or `null` if it can be accepted. */
export function acceptBlockDescription(
  state: Readonly<GameState>,
  clientId: number,
): string | null {
  const status = commissionStatus(state, clientId);
  if (status !== COMMISSION_PROGRESS.Offered) return "委托状态已变更，请重新确认。";
  if ((state.commissions?.slots.length ?? 0) >= COMMISSION_MAX_SLOTS) return "委托栏已满。";
  const iraiId = commissionContent(state, clientId);
  const def = defFromIraiId(iraiId);
  if (!def) return "委托数据异常，无法受理。";
  if (!def.canAccept) return null; // No extra gate → accepted
  // Walk the common conditions and report the first missing one.
  if (!canMeet(state, clientId)) return "该角色当前无法会面。";
  const home = clientHome(state, clientId);
  if (home && !sameMap(state.master.location, home)) {
    return `需要在「${home}」所在区域才能受理。`;
  }
  if (def.itemId === ITEM_FISHING_ROD && itemCount(state as GameState, ITEM_FISHING_ROD) === 0) {
    return "需要持有钓鱼竿。";
  }
  if (itemCount(state as GameState, def.itemId ?? 0) < (def.itemQty ?? 0)) {
    return "持有的道具不足。";
  }
  // 一般依頼04 gates acceptance on already holding a dish (upstream also
  // accepts 宴会参加 / AT_HOME, which its own 発生条件 already covers).
  // 17/18 are deliberately NOT here: upstream accepts them unconditionally.
  if (!hasCurrentDish(state) && def.localId === 4) {
    return "需要先准备一份料理。";
  }
  const trust30Gated = [8, 9, 10, 11].includes(def.localId);
  if (trust30Gated && getCharaCflag(state as GameState, clientId, CFLAG_ID.信頼度) < 30) {
    return "该角色对你的信赖度还不足以发出此委托。";
  }
  if (def.localId === 7 && !isWinterYearEnd(state)) {
    return "仅在年末（冬季后半月）可受理。";
  }
  if (def.localId === 2 && !mapCanMove0(state as GameState, home ?? "", state.master).can) {
    return "目标地点当前无法到达。";
  }
  // Fallback: the def's custom canAccept rejected it for a reason we
  // haven't enumerated above. Keep it vague but actionable.
  const tried = def.canAccept(state, clientId);
  if (!tried) return "当前暂时无法受理此委托，请检查是否满足条件。";
  return null; // canAccept was true after all — shouldn't happen
}

export function canExecuteCommissionSlot(
  state: Readonly<GameState>,
  slot: CommissionSlot,
  target: number,
): boolean {
  if (commissionStatus(state, slot.clientId) !== COMMISSION_PROGRESS.Active) return false;
  const def = findCommissionDef(slot.kind, slot.localId, slot.clientId);
  if (!def) return false;
  switch (slot.task) {
    case "work":
      if (target !== slot.clientId || !isResponsive(state, target)) return false;
      break;
    case "deliver_person":
      if ((slot.localId === 9 || slot.localId === 11) && slot.searchReveal === "hidden") return false;
      if (!slot.targetCharaNum || target !== slot.targetCharaNum || !isResponsive(state, target)) return false;
      break;
    case "deliver_place":
      if (slot.localId === 10 && (slot.searchReveal === "hidden" || slot.searchReveal === "map")) return false;
      if (!slot.targetLocation || state.master.location !== slot.targetLocation) return false;
      break;
    case "procure":
      if (target !== slot.clientId || !isResponsive(state, target)) return false;
      if (itemCount(state as GameState, slot.itemId ?? 0) < (slot.itemQty ?? 0)) return false;
      break;
  }
  return def.canExecute ? def.canExecute(state, slot, target) : true;
}

/** Active search request addressed to Nazrin's dowsing service. */
export function findActiveSearchCommission(
  state: Readonly<GameState>,
  clientId: number,
): CommissionSlot | undefined {
  return state.commissions?.slots.find((slot) =>
    slot.clientId === clientId &&
    commissionStatus(state, clientId) === COMMISSION_PROGRESS.Active &&
    (slot.localId === 9 || slot.localId === 10 || slot.localId === 11),
  );
}

export function searchActiveCommissionSlot(
  state: Readonly<GameState>,
  target: number,
): CommissionSlot | undefined {
  return state.commissions?.slots.find((slot) =>
    canExecuteCommissionSlot(state, slot, target),
  );
}

export function commissionActName(state: Readonly<GameState>, target: number): string {
  const slot = searchActiveCommissionSlot(state, target);
  if (!slot) return "执行委托";
  const def = findCommissionDef(slot.kind, slot.localId, slot.clientId);
  if (!def) return "执行委托";
  if (slot.localId === 1 && slot.targetLocation && getYogore(state as GameState, slot.targetLocation) < 1000) {
    return "完成扫除";
  }
  return def.actNameFor ? def.actNameFor(state) : def.actName;
}

export function commissionTitleForTarget(
  state: Readonly<GameState>,
  target: number,
): string {
  const status = commissionStatus(state, target);
  if (
    status === COMMISSION_PROGRESS.Completed ||
    status === COMMISSION_PROGRESS.Expired ||
    status === COMMISSION_PROGRESS.MissedReport ||
    status === COMMISSION_PROGRESS.Failed
  ) {
    return "委托报告";
  }
  return "听取委托";
}

function isLostSearchCommission(slot: CommissionSlot | undefined, def: CommissionDef): boolean {
  return def.kind === "common" && (def.localId === 9 || def.localId === 10 || def.localId === 11) && !!slot;
}

function searchRevealFor(
  slot: CommissionSlot | undefined,
  offer: CommissionOffer | undefined,
): CommissionSearchReveal {
  return slot?.searchReveal ?? offer?.searchReveal ?? "hidden";
}

function lostSearchHint(def: CommissionDef, sub: number | undefined): string {
  if (def.localId === 10) {
    return sub === 1
      ? "线索：失物不在委托人平时居住的地图上，先从地图方向查起。"
      : "线索：失物被落在了另一张地图的公共地点。";
  }
  if (def.localId === 11) return "线索：知情者也许知道失物最后出现的地方。";
  if (sub === 1) return "线索：失主并不在委托人身边，可能正在自己的活动范围内。";
  if (sub === 2) return "线索：失主平时会在住处附近活动。";
  return "线索：失物的主人仍在幻想乡中，可以继续追查。";
}

/**
 * The line COMF366 prints the moment a 17/18 request is accepted:
 * `大概是一道有%RESULTS:0%味道の菜肴`, with the tags joined by 、
 * (`COMF366 依頼を聞く.ERB:127-135` — the scratch RNG is re-seeded with
 * `IRAI_SUB:受諾`, so it matches the tag set stored on the slot).
 *
 * 一般依頼18 has no such accept line upstream; it defers to 依頼条件表示
 * (`想要の菜肴：…`), which `describeCommission` renders instead.
 */
export function commissionRequestDialogLines(
  state: Readonly<GameState>,
  clientId: number,
): string[] {
  const slot = findSlotByClient(state, clientId);
  if (slot?.kind !== "common" || slot.localId !== 17 || !slot.tasteRequest) return [];
  return [`大概是一道有${slot.tasteRequest.replace(/\//g, "、")}味道的菜肴`];
}

/** 依頼条件表示 for an accepted 17/18 slot — the popup detail panel's tail. */
function commissionRequestDetailLines(
  state: Readonly<GameState>,
  slot: CommissionSlot | undefined,
): string[] {
  if (slot?.kind !== "common") return [];
  if (slot.localId === 17) {
    return slot.tasteRequest
      ? [`要求的味道：${slot.tasteRequest.replace(/\//g, "、")}`]
      : [];
  }
  if (slot.localId === 18) {
    if (!slot.dishRequest) return [];
    const callName = state.charas[slot.clientId]?.callName ?? "对方";
    // `一般18.ERB:177-183` — TASTE_TR of an already-translated name is a
    // no-op, so the order is shown by name; uniques add the signature line.
    return slot.dishRequest.isSp
      ? [`想要的菜肴：${slot.dishRequest.name}`, `……这是${callName}的拿手菜来着？`]
      : [`想要的菜肴：${slot.dishRequest.name}`];
  }
  return [];
}

export function describeCommission(
  state: Readonly<GameState>,
  clientId: number,
): string[] {
  const iraiId = commissionContent(state, clientId);
  const def = defFromIraiId(iraiId);
  if (!def) return ["委托内容无法确认。"];
  const lines = [
    `＜${def.name}＞`,
    `内容：${def.description.replace(/%CALLNAME:TARGET%/g, state.charas[clientId]?.callName ?? "对方")}`,
    `报酬：${def.rewardText}`,
  ];
  const slot = findSlotByClient(state, clientId);
  const offer = state.commissions?.offers?.[clientId];
  if (slot?.deadlineDay) lines.push(`期限：第 ${slot.deadlineDay + 1} 天`);
  if (isLostSearchCommission(slot, def) || (!slot && offer && [9, 10, 11].includes(def.localId))) {
    const reveal = searchRevealFor(slot, offer);
    if (reveal === "hidden") {
      lines.push(lostSearchHint(def, slot?.sub ?? offer?.sub));
    } else if (def.localId === 10) {
      if (slot?.targetLocation && (reveal === "map" || reveal === "place")) {
        lines.push(`所在地图：${slot.targetLocation.split(":")[0]}`);
      }
      if (reveal === "place" && slot?.targetLocation) lines.push(`目的地：${slot.targetLocation}`);
    } else if (slot?.targetCharaNum) {
      lines.push(`失主：${state.charas[slot.targetCharaNum]?.callName ?? `角色${slot.targetCharaNum}`}`);
      if (slot.targetCharaNum !== 39 && slot.revealedLocation) {
        lines.push(`当前位置：${slot.revealedLocation}`);
      }
    }
  } else {
    if (slot?.targetCharaNum) {
      lines.push(`目标人物：${state.charas[slot.targetCharaNum]?.callName ?? `角色${slot.targetCharaNum}`}`);
    }
    if (slot?.targetLocation) lines.push(`目的地：${slot.targetLocation}`);
  }
  if (slot?.itemId && slot.itemQty) {
    const itemName = slot.itemId === ITEM_WOOD
      ? "木材"
      : slot.itemId === ITEM_GOOD_FISH
        ? "好吃的鱼"
        : `道具${slot.itemId}`;
    lines.push(`要求品：${itemName}×${slot.itemQty}`);
  }
  // 依頼条件表示 — the 17/18 request the client is holding the player to.
  lines.push(...commissionRequestDetailLines(state, slot));
  return lines;
}

export function runCommissionMorning(
  state: GameState,
  rng: CommissionRng,
  now: () => number = () => 0,
  hooks: CommissionGenerationHooks = {},
): ObservationEvent[] {
  const commissions = ensureCommissionState(state);
  if (commissions.lastMorningDay === state.time.dayIndex) return [];
  commissions.lastMorningDay = state.time.dayIndex;
  const events: ObservationEvent[] = [];

  // IRAI_HAPPEN first: source samples 10 characters and tries SET_NEW_IRAI.
  // A5: agent commission decisions override the random roll.
  const agentRuntime = state.agentRuntime;
  const candidates = Object.keys(state.charas)
    .map(Number)
    .filter((id) => id > 0 && commissionStatus(state, id) === 0);
  const sampled: number[] = [];
  const pool = [...candidates];
  // Process agent decisions before random sampling.
  const agentDecided = new Set<number>();
  for (const clientId of candidates) {
    const cog = agentRuntime?.cognitions[clientId];
    const decision = cog?.commissionDecision;
    if (!decision || decision.decidedAtDay !== state.time.dayIndex - 1) continue;
    if (decision.action === "defer") {
      // Agent explicitly chose to skip — remove from pool.
      agentDecided.add(clientId);
      continue;
    }
    if (decision.action === "propose" && decision.candidateId) {
      // Parse candidateId "commission:{clientId}:{localId}"
      const localId = parseAgentCandidateLocalId(decision.candidateId);
      if (localId !== null) {
        const defs = eligibleDefsForClient(state, clientId, hooks, rng);
        const def = defs.find((d) => d.localId === localId);
        if (def && def.canGenerate(state, clientId) &&
          setNewCommission(state, clientId, def, COMMISSION_PROGRESS.Generated, rng)) {
          agentDecided.add(clientId);
          events.push({
            kind: "STATUS_MESSAGE",
            timestamp: now(),
            source: "system",
            text: `${state.charas[clientId]?.callName ?? `#${clientId}`} 主动提出了委托「${def.name}」。`,
          });
        }
      }
      // Clear the one-shot decision regardless of validity.
      cog.commissionDecision = undefined;
    }
  }
  // Build pool excluding agent-decided characters.
  const filteredPool = pool.filter((id) => !agentDecided.has(id));
  while (filteredPool.length > 0 && sampled.length < 10) {
    const idx = rng.int(filteredPool.length);
    const [picked] = filteredPool.splice(idx, 1);
    if (picked !== undefined) sampled.push(picked);
  }
  for (const clientId of sampled) {
    const bucket = generationBucket(clientId, rng);
    if (!bucket) continue;
    const defs = eligibleDefsForClient(state, clientId, hooks, rng).filter((def) => def.kind === bucket);
    if (defs.length === 0) continue;
    const def = weightedPick(defs, rng);
    if (!def) continue;
    setNewCommission(state, clientId, def, COMMISSION_PROGRESS.Generated, rng);
  }
  // Clear any remaining agent decisions that we processed.
  for (const clientId of agentDecided) {
    const cog = agentRuntime?.cognitions[clientId];
    if (cog?.commissionDecision) cog.commissionDecision = undefined;
  }

  // IRAI_VANISH second.
  for (const clientId of Object.keys(state.charas).map(Number)) {
    const status = commissionStatus(state, clientId);
    switch (status) {
      case COMMISSION_PROGRESS.Generated:
        setCommissionProgress(
          state,
          clientId,
          COMMISSION_PROGRESS.Offered,
          commissionContent(state, clientId),
        );
        break;
      case COMMISSION_PROGRESS.Offered: {
        const def = defFromIraiId(commissionContent(state, clientId));
        if (def && rng.int(100) < 30) setCommissionProgress(state, clientId, 0);
        break;
      }
      case COMMISSION_PROGRESS.EndedSuccess:
      case COMMISSION_PROGRESS.EndedExpired:
      case COMMISSION_PROGRESS.EndedMissedReport:
      case COMMISSION_PROGRESS.EndedFailed:
        setCommissionProgress(state, clientId, 0);
        break;
      default:
        break;
    }
  }

  for (const slot of [...ensureCommissionState(state).slots].reverse()) {
    if (slot.deadlineDay !== 0 && state.time.dayIndex > slot.deadlineDay) {
      const status = commissionStatus(state, slot.clientId);
      if (status === COMMISSION_PROGRESS.Active) {
        setCommissionProgress(state, slot.clientId, COMMISSION_PROGRESS.Expired, slot.iraiId);
      } else if (status === COMMISSION_PROGRESS.Completed) {
        const def = findCommissionDef(slot.kind, slot.localId, slot.clientId);
        if (def?.noReport) {
          applyCommissionReport(state, slot, true, rng);
          clearCommissionSlot(state, slot, 0);
          events.push({
            kind: "NARRATION",
            timestamp: now(),
            text: "一件无需报告的委托已经自动处理。",
          });
        } else {
          setCommissionProgress(state, slot.clientId, COMMISSION_PROGRESS.MissedReport, slot.iraiId);
        }
      }
    }
  }
  return events;
}

export function executeCommissionCore(
  state: GameState,
  slot: CommissionSlot,
  rng: CommissionRng,
): { result: CommissionExecutionResult; events: ObservationEvent[] } {
  const def = findCommissionDef(slot.kind, slot.localId, slot.clientId);
  const events: ObservationEvent[] = [];
  if (!def) return { result: "cancel", events };

  if (slot.kind === "common" && slot.localId === 1) {
    const loc = slot.targetLocation ?? clientHome(state, slot.clientId) ?? state.master.location;
    const dirt = getYogore(state, loc);
    if (dirt < 1000) {
      advanceTimeTicks(state, 3);
      return { result: "success", events };
    }
    const helper = state.charas[slot.clientId];
    const removed = sweepAmount(dirt, sweepPower(state.master, helper));
    setYogore(state, loc, dirt - removed);
    state.master.state.EXP[EXP_ID.清掃経験] = (state.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
    if (helper) helper.state.EXP[EXP_ID.清掃経験] = (helper.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    if (helper) helper.state.BASE[BASE_ID.気力] = (helper.state.BASE[BASE_ID.気力] ?? 0) - 100;
    advanceTimeTicks(state, 20);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 2) {
    advanceTimeTicks(state, 0);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 3) {
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 150;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    const client = state.charas[slot.clientId];
    if (client) {
      client.state.BASE[BASE_ID.体力] = (client.state.BASE[BASE_ID.体力] ?? 0) - 150;
      client.state.BASE[BASE_ID.気力] = (client.state.BASE[BASE_ID.気力] ?? 0) - 100;
    }
    advanceTimeTicks(state, 20);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 4) {
    const client = state.charas[slot.clientId];
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    state.master.state.EXP[EXP_ID.料理経験] = (state.master.state.EXP[EXP_ID.料理経験] ?? 0) + 1;
    if (client) {
      client.state.BASE[BASE_ID.気力] = (client.state.BASE[BASE_ID.気力] ?? 0) - 100;
      client.state.EXP[EXP_ID.料理経験] = (client.state.EXP[EXP_ID.料理経験] ?? 0) + 2;
    }
    advanceTimeTicks(state, 20);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 5) {
    const client = state.charas[slot.clientId];
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 150;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 150;
    state.master.state.EXP[EXP_ID.戦闘経験] = (state.master.state.EXP[EXP_ID.戦闘経験] ?? 0) + 1;
    if (client) {
      client.state.BASE[BASE_ID.体力] = (client.state.BASE[BASE_ID.体力] ?? 0) - 150;
      client.state.BASE[BASE_ID.気力] = (client.state.BASE[BASE_ID.気力] ?? 0) - 150;
      client.state.EXP[EXP_ID.戦闘経験] = (client.state.EXP[EXP_ID.戦闘経験] ?? 0) + 2;
    }
    advanceTimeTicks(state, 60);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 6) {
    const client = state.charas[slot.clientId];
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 70;
    state.master.state.EXP[EXP_ID.学習経験] = (state.master.state.EXP[EXP_ID.学習経験] ?? 0) + 1;
    if (client) {
      client.state.BASE[BASE_ID.気力] = (client.state.BASE[BASE_ID.気力] ?? 0) - 70;
      client.state.EXP[EXP_ID.学習経験] = (client.state.EXP[EXP_ID.学習経験] ?? 0) + 2;
    }
    advanceTimeTicks(state, 30);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 7) {
    const loc = slot.targetLocation ?? clientHome(state, slot.clientId) ?? state.master.location;
    const dirt = getYogore(state, loc);
    if (dirt < 1000) return { result: "success", events };
    const helper = state.charas[slot.clientId];
    const removed = sweepAmount(dirt, sweepPower(state.master, helper));
    const remaining = Math.max(0, dirt - removed);
    setYogore(state, loc, remaining);
    state.master.state.EXP[EXP_ID.清掃経験] = (state.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
    if (helper) helper.state.EXP[EXP_ID.清掃経験] = (helper.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    advanceTimeTicks(state, 20);
    return { result: remaining < 1000 ? "success" : "unresolved", events };
  }

  if (slot.kind === "common" && slot.localId === 8) {
    settleUniqueSource(state, slot.targetCharaNum ?? 0, { [SOURCE_ID.歓楽]: 500 });
    changeRelation(state, slot.targetCharaNum ?? 0, 20, 0);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 9) {
    const target = commissionRelationshipTarget(slot);
    settleUniqueSource(state, target, {
      [SOURCE_ID.恭顺]: 1500,
      [SOURCE_ID.歓楽]: 1000,
    });
    changeRelation(state, target, 20, 10);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 10) {
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 11) {
    const target = commissionRelationshipTarget(slot);
    settleUniqueSource(state, target, { [SOURCE_ID.歓楽]: 500 });
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 12) {
    const target = state.charas[slot.targetCharaNum ?? 0];
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 200;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 200;
    state.master.state.EXP[EXP_ID.戦闘経験] = (state.master.state.EXP[EXP_ID.戦闘経験] ?? 0) + 2;
    if (target) target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 200;
    advanceTimeTicks(state, 60);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 13) {
    removeItem(state, slot.itemId ?? ITEM_GOOD_FISH, slot.itemQty ?? 1);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 14) {
    removeItem(state, slot.itemId ?? ITEM_WOOD, slot.itemQty ?? 5);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 15) {
    const client = state.charas[slot.clientId];
    state.master.state.BASE[BASE_ID.体力] = (state.master.state.BASE[BASE_ID.体力] ?? 0) - 100;
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    if (client) client.state.BASE[BASE_ID.気力] = (client.state.BASE[BASE_ID.気力] ?? 0) - 100;
    advanceTimeTicks(state, 30);
    return { result: "success", events };
  }

  if (slot.kind === "common" && slot.localId === 16) {
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 50;
    state.master.state.EXP[EXP_ID.会話経験] = (state.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
    advanceTimeTicks(state, 30);
    return { result: "success", events };
  }

  if (slot.kind === "common" && (slot.localId === 17 || slot.localId === 18)) {
    const dish = getDish(state);
    if (!dish) return { result: "cancel", events };
    const deliveredName = dish.name;
    // REVIEW_DISH reads DISH_TASTE, so it must run before the dish is reset
    // (`一般17.ERB:112-113`; 18 blanks DISH_NAME first but still scores on
    // DISH_TASTE, so the net order is the same).
    reviewDish(state, slot.clientId, rng);
    const evaluated = state.charas[slot.clientId]?.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
    clearDish(state);

    const score = scoreDishCommission({
      localId: slot.localId === 18 ? 18 : 17,
      evaluated,
      dishTaste: dish.taste,
      ...(slot.tasteRequest !== undefined ? { tasteRequest: slot.tasteRequest } : {}),
      ...(slot.dishRequest !== undefined ? { dishRequest: slot.dishRequest } : {}),
      deliveredName,
    });
    slot.bonus = score.bonus ? true : undefined;

    const callName = state.charas[slot.clientId]?.callName ?? "对方";
    const isOrder = slot.localId === 18;
    events.push({ kind: "NARRATION", timestamp: 0, text: `料理评价：${dishScoreStars(score.base, score.extra)}` });
    if (score.outcome === "failed") {
      if (isOrder) {
        events.push({
          kind: "NARRATION", timestamp: 0,
          text: score.extra === 0
            ? `${callName}看着手上与要求不一样的菜肴，陷入了困惑`
            : `看着眼前所谓制作完成的菜品，${callName}表情僵硬`,
        });
        events.push({ kind: "NARRATION", timestamp: 0, text: "没能完成委托……" });
      } else {
        events.push({
          kind: "NARRATION", timestamp: 0,
          text: score.base < score.total / 2
            ? `${callName}的表情有些不自然`
            : `${callName}面对着与想象相差甚远的料理，有些不知所措`,
        });
        events.push({ kind: "NARRATION", timestamp: 0, text: `没有达成${callName}的要求……` });
      }
      return { result: "failed", events };
    }

    // 成功 / 大成功 both return 実行して成功 upstream; 大成功 additionally
    // stamps おまけ so the report pays the bonus.
    settleUniqueSource(state, slot.clientId, {
      [SOURCE_ID.歓楽]: isOrder
        ? (score.outcome === "great" ? 1000 : 300)
        : (score.outcome === "great" ? 2000 : 500),
    });
    if (isOrder) {
      events.push({
        kind: "NARRATION", timestamp: 0,
        text: score.outcome === "great"
          ? (score.extra === 0
            ? `虽然和${callName}的委托内容不一样，但好像还是给对方留下了好印象！`
            : `${callName}收到了所委托的好吃的菜肴而十分满足！`)
          : (score.extra === 0
            ? `虽然与点的不太一样，但${callName}觉得还可以接受`
            : `拿到了所委托的料理的${callName}看上去很开心`),
      });
    } else {
      events.push({
        kind: "NARRATION", timestamp: 0,
        text: score.outcome === "great"
          ? `${callName}很高兴地接受了符合自己要求的菜肴！`
          : `${callName}好像勉强接受了`,
      });
    }
    return { result: "success", events };
  }

  if (slot.kind === "unique" && slot.clientId === 1 && slot.localId === 101) {
    settleUniqueSource(state, 1, {
      [SOURCE_ID.歓楽]: 1000,
      [SOURCE_ID.情愛]: 300,
      [SOURCE_ID.露出]: 20,
    });
    state.master.state.BASE[BASE_ID.気力] = (state.master.state.BASE[BASE_ID.気力] ?? 0) - 50;
    const reimu = state.charas[1];
    if (reimu) reimu.state.BASE[BASE_ID.気力] = (reimu.state.BASE[BASE_ID.気力] ?? 0) - 50;
    advanceTimeTicks(state, 10);
    return { result: rng.int(100) < 60 ? "unresolved" : "success", events };
  }

  if (slot.kind === "unique") {
    if (slot.task === "procure") {
      const itemId = slot.itemId ?? 0;
      const itemQty = slot.itemQty ?? 0;
      if (itemQty <= 0 || itemCount(state, itemId) < itemQty) return { result: "cancel", events };
      removeItem(state, itemId, itemQty);
      switch (`${slot.clientId}:${slot.localId}`) {
        case "10:101":
          settleUniqueSource(state, 10, { [SOURCE_ID.歓楽]: 2000 });
          break;
        case "13:101":
          settleUniqueSource(state, 13, {
            [SOURCE_ID.歓楽]: 200,
            [SOURCE_ID.征服]: 300,
          });
          break;
        case "51:101":
          settleUniqueSource(state, 51, { [SOURCE_ID.歓楽]: 500 });
          break;
        case "79:101":
          settleUniqueSource(state, 79, { [SOURCE_ID.歓楽]: 500 });
          settleUniqueMasterSource(state, { [SOURCE_ID.露出]: 100 });
          advanceTimeTicks(state, 10);
          break;
        default:
          break;
      }
      advanceTimeTicks(state, 10);
      return { result: "success", events };
    }

    if ((slot.clientId === 23 && slot.localId === 101) || (slot.clientId === 51 && slot.localId === 102)) {
      if ((state.casinoChips ?? 0) < 100) return { result: "cancel", events };
      state.casinoChips = (state.casinoChips ?? 0) - 100;
      settleUniqueSource(state, slot.clientId, {
        [SOURCE_ID.歓楽]: slot.clientId === 23 ? 3000 : 1000,
      });
      advanceTimeTicks(state, 10);
      return { result: "success", events };
    }

    if (slot.clientId === 1 && slot.localId === 103) {
      const alcohol = ALCOHOL_ITEMS.find((id) => itemCount(state, id) >= 10);
      if (alcohol === undefined) return { result: "cancel", events };
      removeItem(state, alcohol, 10);
      state.flagStore[FLAG_ID.宴会差し入れ] = alcohol;
      settleUniqueSource(state, 1, { [SOURCE_ID.歓楽]: 500 });
      advanceTimeTicks(state, 10);
      return { result: "success", events };
    }

    if (slot.clientId === 29 && slot.localId === 101) {
      if (!removeAnyItems(state, ALCOHOL_ITEMS, 3)) return { result: "cancel", events };
      settleUniqueSource(state, 29, { [SOURCE_ID.歓楽]: 2000 });
      advanceTimeTicks(state, 10);
      return { result: "success", events };
    }

    if (slot.clientId === 139 && slot.localId === 101 && (state.master.state.TALENT[TALENT_ID.濃厚精液] ?? 0) === 0) {
      return { result: "unresolved", events };
    }

    switch (`${slot.clientId}:${slot.localId}`) {
      case "1:102":
        settleUniqueSource(state, slot.targetCharaNum ?? 11, { [SOURCE_ID.歓楽]: 500 });
        changeRelation(state, slot.targetCharaNum ?? 11, 20, 10);
        break;
      case "14:101":
        settleUniqueSource(state, 14, { [SOURCE_ID.歓楽]: 1500 });
        addBase(state, 14, BASE_ID.体力, -150);
        addBase(state, 14, BASE_ID.気力, -100);
        addBase(state, 0, BASE_ID.体力, -150);
        addBase(state, 0, BASE_ID.気力, -100);
        advanceTimeTicks(state, 20);
        return { result: "success", events };
      case "15:101":
        settleUniqueSource(state, slot.targetCharaNum ?? 58, { [SOURCE_ID.歓楽]: 500 });
        changeRelation(state, slot.targetCharaNum ?? 58, 30, 15);
        adjustMood(state, slot.targetCharaNum ?? 58, 1);
        break;
      case "29:102":
        addBase(state, 0, BASE_ID.気力, -50);
        advanceTimeTicks(state, 120);
        break;
      case "30:101":
        settleUniqueSource(state, slot.targetCharaNum ?? 76, {
          [SOURCE_ID.恐怖]: 100,
          [SOURCE_ID.屈従]: 500,
        }, 3);
        break;
      case "42:101":
        addBase(state, 0, BASE_ID.気力, -50);
        advanceTimeTicks(state, 120);
        return { result: "success", events };
      case "49:101":
        break;
      case "76:101":
        addBase(state, 0, BASE_ID.体力, -100);
        addBase(state, 0, BASE_ID.気力, -50);
        advanceTimeTicks(state, 120);
        return { result: "success", events };
      case "139:101":
        addBase(state, 0, BASE_ID.気力, -50);
        addBase(state, 0, BASE_ID.精力, -250);
        settleUniqueMasterSource(state, { [SOURCE_ID.達成]: 500 });
        advanceTimeTicks(state, 10);
        return { result: "success", events };
      case "159:101":
        settleUniqueSource(state, 159, {
          [SOURCE_ID.歓楽]: 1000,
          [SOURCE_ID.情愛]: 300,
          [SOURCE_ID.露出]: 20,
        });
        addBase(state, 0, BASE_ID.気力, -50);
        addBase(state, 159, BASE_ID.気力, -100);
        advanceTimeTicks(state, 10);
        return { result: rng.int(100) < 60 ? "unresolved" : "success", events };
      case "159:102":
        settleUniqueSource(state, slot.targetCharaNum ?? 1, { [SOURCE_ID.歓楽]: 500 });
        changeRelation(state, slot.targetCharaNum ?? 1, 20, 10);
        break;
      default:
        break;
    }

    advanceTimeTicks(state, slot.task === "deliver_place" ? 0 : 10);
    return { result: "success", events };
  }

  return { result: "cancel", events };
}

export function applyCommissionReport(
  state: GameState,
  slot: CommissionSlot,
  success: boolean,
  rng: CommissionRng,
): LetterMaterialReward[] {
  if (!success) {
    if (slot.kind === "unique") {
      const target = slot.targetCharaNum ?? slot.clientId;
      switch (`${slot.clientId}:${slot.localId}`) {
        case "1:101":
        case "159:101":
          changeRelation(state, slot.clientId, -5, -3);
          break;
        case "1:102":
        case "159:102":
          changeRelation(state, target, -10, -10);
          break;
        case "1:103":
          changeRelation(state, slot.clientId, -30, -10);
          break;
        case "10:101":
          changeRelation(state, target, -50, -20);
          adjustMood(state, target, -1);
          break;
        case "13:101":
          changeRelation(state, target, -20, -10);
          break;
        case "14:101":
          break;
        case "15:101":
          changeRelation(state, target, -10, -10);
          break;
        case "23:101":
        case "29:102":
        case "139:101":
        case "76:101":
          changeRelation(state, target, -20, -10);
          break;
        case "29:101":
          changeRelation(state, target, -20, -10);
          break;
        case "30:101":
          changeRelation(state, target, -20, -10);
          break;
        case "42:101":
          changeRelation(state, slot.clientId, -20, -10);
          break;
        case "51:101":
          changeRelation(state, target, -10, -10);
          adjustMood(state, target, -1);
          break;
        case "51:102":
          changeRelation(state, slot.clientId, -10, -10);
          break;
        case "79:101":
          changeRelation(state, target, -10, -10);
          adjustMood(state, target, -1);
          break;
        case "49:101":
        case "49:102":
        case "49:103":
          changeRelation(state, slot.clientId, -10, -10);
          break;
        default:
          changeRelation(state, slot.clientId, -10, -5);
      }
      return [];
    }
    if (slot.localId === 8) changeRelation(state, slot.clientId, -20, -10);
    else if (slot.kind === "common" && [9, 10, 11].includes(slot.localId)) {
      changeRelation(state, commissionRelationshipTarget(slot), -2, -1);
    }
    // 一般依頼17/18 失敗時: 好感 -5 / 信頼 -5 (`一般17.ERB:203-207`,
    // `一般18.ERB:289-293`).
    else if (slot.localId === 101) changeRelation(state, slot.clientId, -5, -3);
    else if (slot.localId === 14) changeRelation(state, slot.clientId, -5, -5);
    else if (slot.kind === "common" && (slot.localId === 17 || slot.localId === 18)) {
      changeRelation(state, slot.clientId, -5, -5);
    }
    else changeRelation(state, slot.clientId, -10, slot.localId === 1 ? -10 : -5);
    return [];
  }

  if (slot.kind === "common" && slot.localId === 1) {
    changeRelation(state, slot.clientId, 20, 10);
    grantRandomMaterial(state, rng, 1);
  } else if (slot.kind === "common" && slot.localId === 2) {
    changeRelation(state, slot.clientId, 20, 15);
    grant(state, 500);
  } else if (slot.kind === "common" && slot.localId === 3) {
    const client = state.charas[slot.clientId];
    if (client) {
      client.state.TALENT[TALENT_ID.心情] = Math.max(
        -1,
        Math.min(1, (client.state.TALENT[TALENT_ID.心情] ?? 0) + 1),
      );
    }
    changeRelation(state, slot.clientId, 30, 5);
  } else if (slot.kind === "common" && [4, 5, 6].includes(slot.localId)) {
    changeRelation(state, slot.clientId, 30, 15);
    grant(state, 500);
  } else if (slot.kind === "common" && slot.localId === 7) {
    changeRelation(state, slot.clientId, 50, 20);
    grant(state, 1500);
  } else if (slot.kind === "common" && slot.localId === 8) {
    settleUniqueSource(state, slot.clientId, { [SOURCE_ID.歓楽]: 500 });
    changeRelation(state, slot.clientId, 50, 30);
    return grantLetterMaterials(state, rng);
  } else if (slot.kind === "common" && slot.localId === 9) {
    const target = commissionRelationshipTarget(slot);
    settleUniqueSource(state, target, { [SOURCE_ID.歓楽]: 500 });
    changeRelation(state, target, 30, 20);
    grantRandomMaterial(state, rng, 1);
  } else if (slot.kind === "common" && slot.localId === 10) {
    const target = commissionRelationshipTarget(slot);
    settleUniqueSource(state, target, {
      [SOURCE_ID.恭順]: 1500,
      [SOURCE_ID.歓楽]: 1000,
    });
    changeRelation(state, target, 50, 30);
    grantRandomMaterial(state, rng, 2);
  } else if (slot.kind === "common" && slot.localId === 11) {
    const target = commissionRelationshipTarget(slot);
    settleUniqueSource(state, target, {
      [SOURCE_ID.恭順]: 1500,
      [SOURCE_ID.歓楽]: 1000,
    });
    changeRelation(state, target, 25, 15);
    grant(state, 3200);
  } else if (slot.kind === "common" && slot.localId === 12) {
    changeRelation(state, slot.clientId, 30, 15);
    grant(state, 1000 + ability(state, slot.targetCharaNum ?? 0, ABL_ID.战斗能力) * 500);
  } else if (slot.kind === "common" && slot.localId === 13) {
    changeRelation(state, slot.clientId, 30, 20);
    addItem(state, ITEM_HIGH_INGREDIENT, 3);
  } else if (slot.kind === "common" && slot.localId === 14) {
    changeRelation(state, slot.clientId, 30, 20);
    const client = state.charas[slot.clientId];
    if (client) {
      client.state.TALENT[TALENT_ID.心情] = Math.max(
        -1,
        Math.min(1, (client.state.TALENT[TALENT_ID.心情] ?? 0) + 1),
      );
    }
    addItem(state, ITEM_CHEAP_INGREDIENT, 3);
  } else if (slot.kind === "common" && slot.localId === 15) {
    changeRelation(state, slot.clientId, 50, 20);
    grant(state, 20000);
  } else if (slot.kind === "common" && slot.localId === 16) {
    changeRelation(state, slot.clientId, 30, 15);
    grantRandomMaterial(state, rng, 1);
  } else if (slot.kind === "common" && slot.localId === 17) {
    // 一般依頼17_あれがたべたい.ERB:190-202 — 好感 +25 / 信頼 +25 / ¥2500,
    // and 大成功 (おまけ) adds another +15 / +15 / ¥1000.
    changeRelation(state, slot.clientId, 25, 25);
    grant(state, 2500);
    if (slot.bonus) {
      changeRelation(state, slot.clientId, 15, 15);
      grant(state, 1000);
    }
  } else if (slot.kind === "common" && slot.localId === 18) {
    // 一般依頼18_おなかすいた.ERB:276-288 — 好感 +20 / 信頼 +20 / ¥2000,
    // 大成功 adds another +20 / +20 / ¥1000.
    changeRelation(state, slot.clientId, 20, 20);
    grant(state, 2000);
    if (slot.bonus) {
      changeRelation(state, slot.clientId, 20, 20);
      grant(state, 1000);
    }
  } else if (slot.kind === "unique") {
    const target = slot.targetCharaNum ?? slot.clientId;
    switch (`${slot.clientId}:${slot.localId}`) {
      case "1:101":
        settleUniqueSource(state, 1, { [SOURCE_ID.歓楽]: 1000 });
        changeRelation(state, 1, 20, 5);
        addItem(state, ITEM_AOJIRU, 1);
        break;
      case "1:102":
        settleUniqueSource(state, target, { [SOURCE_ID.歓楽]: 1000 });
        changeRelation(state, target, 20, 10);
        grant(state, 500);
        break;
      case "1:103":
        changeRelation(state, slot.clientId, 50, 20);
        break;
      case "10:101":
        changeRelation(state, target, 30, 20);
        adjustMood(state, target, 1);
        grant(state, 5000);
        break;
      case "13:101":
        changeRelation(state, target, 20, 5);
        grant(state, 3000);
        break;
      case "14:101":
        adjustMood(state, target, 1);
        changeRelation(state, 14, 30, 15);
        addItem(state, ITEM_ID.FROG, 1);
        break;
      case "15:101":
        grant(state, 1000);
        if (findCommissionDef(slot.kind, slot.localId, slot.clientId)?.noReport) {
          changeRelation(state, slot.clientId, 15, 7);
        } else {
          changeRelation(state, target, 20, 10);
        }
        break;
      case "23:101":
        grant(state, 20000);
        changeRelation(state, slot.clientId, 20, 10);
        break;
      case "29:101":
        grant(state, 5000);
        changeRelation(state, target, 30, 10);
        break;
      case "29:102":
        settleUniqueSource(state, slot.clientId, {
          [SOURCE_ID.歓楽]: 1000,
          [SOURCE_ID.征服]: 500,
        });
        grant(state, 3000);
        changeRelation(state, slot.clientId, 30, 15);
        break;
      case "30:101":
        grant(state, 1000);
        changeRelation(state, target, 20, 15);
        break;
      case "49:101":
      case "49:102":
      case "49:103":
        grant(state, 500);
        changeRelation(state, slot.clientId, 20, 10);
        break;
      case "42:101":
        grant(state, 3000);
        changeRelation(state, slot.clientId, 40, 25);
        break;
      case "51:101":
        grant(state, 1000);
        changeRelation(state, target, 30, 20);
        adjustMood(state, target, 1);
        break;
      case "51:102":
        addItem(state, 0, 1);
        changeRelation(state, slot.clientId, 20, 10);
        break;
      case "76:101":
        grant(state, 5000);
        changeRelation(state, slot.clientId, 20, 10);
        break;
      case "79:101":
        grant(state, 1000);
        changeRelation(state, target, 30, 20);
        adjustMood(state, target, 1);
        break;
      case "139:101":
        settleUniqueSource(state, target, {
          [SOURCE_ID.歓楽]: 1000,
          [SOURCE_ID.征服]: 500,
          [SOURCE_ID.達成]: 500,
          [SOURCE_ID.欲情]: 3000,
        });
        settleUniqueMasterSource(state, { [SOURCE_ID.欲情]: 1000 });
        grant(state, 50000);
        changeRelation(state, slot.clientId, 40, 25);
        break;
      case "159:101":
        settleUniqueSource(state, 159, { [SOURCE_ID.歓楽]: 1000 });
        addItem(state, ITEM_ID.大回復薬, 1);
        changeRelation(state, slot.clientId, 20, 5);
        break;
      case "159:102":
        settleUniqueSource(state, target, { [SOURCE_ID.歓楽]: 1000 });
        grant(state, 500);
        changeRelation(state, target, 20, 10);
        break;
      default:
        grant(state, 500);
        changeRelation(state, slot.clientId, 20, 10);
        break;
    }
  }
  return [];
}

/** @GetRandMaterial builds its candidate array once, then draws with replacement. */
function grantLetterMaterials(state: GameState, rng: CommissionRng): LetterMaterialReward[] {
  const candidates = LETTER_MATERIAL_POOL.filter(({ id }) => itemCount(state, id) < 99);
  const granted: LetterMaterialReward[] = [];
  for (let i = 0; i < 4 && candidates.length > 0; i += 1) {
    const material = candidates[rng.int(candidates.length)]!;
    addItem(state, material.id, 1);
    granted.push(material);
  }
  return granted;
}

function grantRandomMaterial(state: GameState, rng: CommissionRng, count: number): void {
  for (let i = 0; i < count; i += 1) {
    addItem(state, rng.pick(GATHERING_SPOT_1_ITEMS).id, 1);
  }
}

export function setCommissionExecutionResult(
  state: GameState,
  slot: CommissionSlot,
  result: CommissionExecutionResult,
): void {
  if (result === "success") {
    setCommissionProgress(state, slot.clientId, COMMISSION_PROGRESS.Completed, slot.iraiId);
  } else if (result === "failed") {
    setCommissionProgress(state, slot.clientId, COMMISSION_PROGRESS.Failed, slot.iraiId);
  }
}

export function reportCommission(state: GameState, slot: CommissionSlot, rng: CommissionRng): LetterMaterialReward[] {
  const status = commissionStatus(state, slot.clientId);
  if (status === COMMISSION_PROGRESS.Completed) {
    const granted = applyCommissionReport(state, slot, true, rng);
    clearCommissionSlot(state, slot, COMMISSION_PROGRESS.EndedSuccess);
    return granted;
  } else if (status === COMMISSION_PROGRESS.Expired) {
    applyCommissionReport(state, slot, false, rng);
    clearCommissionSlot(state, slot, COMMISSION_PROGRESS.EndedExpired);
  } else if (status === COMMISSION_PROGRESS.MissedReport) {
    applyCommissionReport(state, slot, false, rng);
    clearCommissionSlot(state, slot, COMMISSION_PROGRESS.EndedMissedReport);
  } else if (status === COMMISSION_PROGRESS.Failed) {
    applyCommissionReport(state, slot, false, rng);
    clearCommissionSlot(state, slot, COMMISSION_PROGRESS.EndedFailed);
  }
  return [];
}

// ---------------------------------------------------------------------------
// SHOP [160] 重置委托 — modern equivalent of `IRAI_RESET_PROCESS`
// (`eratw-sub-modding-main/ERB/コマンド関連/COMF/依頼/CTRL_IRAI.ERB:740-762`):
//   - CVARSET CFLAG, 403 / 404 (per-chara 依頼状況 + 依頼内容)
//   - VARSET IRAI_SLOT / IRAI_DATA / … (modern: clear commissions.slots)
// Master mirror 411-419 (CFLAG_ID.依頼対象1..9) is re-synced via
// `syncCommissionTargets` after the clear.
// PRESERVES `lastMorningDay` (同日防二跑守卫) — never touch it.
// ---------------------------------------------------------------------------

/** Clear ALL active commissions + per-chara commission CFLAG. Returns the
 *  number of slots cleared and the number of CFLAG rows zeroed (for the
 *  SHOP [160] panel's post-action summary). */
export function resetAllCommissions(state: GameState): { resetSlots: number; resetFlags: number } {
  const commissions = ensureCommissionState(state);
  const resetSlots = commissions.slots.length;
  commissions.slots = [];
  commissions.offers = {};
  let resetFlags = 0;
  for (const charaNum of Object.keys(state.charas).map(Number)) {
    const slot = state.charas[charaNum];
    if (!slot) continue;
    if ((slot.state.CFLAG[CFLAG_ID.依頼状況] ?? 0) !== 0) resetFlags += 1;
    if ((slot.state.CFLAG[CFLAG_ID.依頼内容] ?? 0) !== 0) resetFlags += 1;
    slot.state.CFLAG[CFLAG_ID.依頼状況] = 0;
    slot.state.CFLAG[CFLAG_ID.依頼内容] = 0;
  }
  // Master 依頼対象1..9 mirror → 0 (no active slots → all mirror 0).
  syncCommissionTargets(state);
  return { resetSlots, resetFlags };
}
