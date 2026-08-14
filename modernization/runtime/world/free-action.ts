/**
 * NPC 自由行動 V1 — the portable, low-dependency part of
 * `MOVEMENTS/自由行動/FREE_ACT_*.ERB`.
 *
 * Upstream shape:
 *   - `MOVEMENT_自由行動.ERB` rolls a free action with
 *     `5 * TIME_PROGRESS(TIME:1) >= RAND:800`, shuffles action ids 0..19,
 *     and calls `自由行動内容_{id}(ARG, "発生")`.
 *   - While active, `Activity_Duration` counts down; `行動中` / `完了` apply
 *     the action body and print common prose, then EVENT-32 personal kojo may
 *     fire from the scheduler.
 *
 * Ordinary actions and the authored-role special actions (15 sermon, 16
 * pitfall, 17 snow creation, 19 nesting) share the same deterministic clock.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import type { CharaFreeAction, CharaSlot, GameState } from "../state/game-state.js";
import { gatheringSpot } from "../state/gathering.js";
import { fishingSpot } from "../state/fishing.js";
import { getYogore, setYogore } from "../state/yogore.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  TALENT_ID,
  TCVAR_ID,
  recoverBase,
} from "../state/settlement.js";
import { atOwnHome, atPlayerBase, inRoom, outRoof, placeFlagsOf } from "./location-predicates.js";
import { VILLAGE_SHOPS } from "../state/shop.js";
import { roomIdToLocation } from "./room-id-location.js";
import { weatherDamage } from "../weather/effects.js";
import { addSnowVisibility, snowObjectDescription } from "./free-activity-events.js";
import {
  hasPlace,
  PLACE_KITCHEN,
  PLACE_KOTATSU,
  PLACE_INDOOR,
  PLACE_MEAL,
  PLACE_PRIVATE,
  PLACE_REST,
  PLACE_SNACK,
  PLACE_STUDY,
  PLACE_TRAINING,
} from "./place-flags.js";

type FreeActionType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;
type FreeActionPhase = "start" | "progress" | "complete";

const MODELED_FREE_ACTIONS: readonly FreeActionType[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
];
const CHAINABLE_FREE_ACTIONS = new Set<FreeActionType>(
  MODELED_FREE_ACTIONS.filter((type) => ![0, 6, 16, 19].includes(type)),
);

const TALENT_ALCHEMY_LEVEL = 49;
const TALENT_MUSIC_KNOWLEDGE = 161;
const TALENT_FISHING_LEVEL = 47;
const TALENT_ALCOHOL_TOLERANCE = 121;
const TALENT_ANIMAL_EARS = 143;
const TALENT_AQUATIC = 163;
const TALENT_ICE_FAIRY = 164;
const TALENT_FAIRY = 192;

const EXP_COOKING = 76;
const EXP_SINGING = 80;
const EXP_DANCE = 83;
const EXP_PERFORMANCE = 79;
const EXP_FISHING = 82;
const EXP_ALCHEMY = 85;

const SNACK_SPECIAL_CHARAS = new Set([12, 38, 58, 66, 126]);
const PHARMACY_SPECIAL_ROOM_IDS = [49, 132, 405, 513, 524, 644, 704, 871, 1134];
const EIKI_CHARA = 30;
const SERMON_DIVINE_SPIRIT_EXCEPTIONS = new Set([76, 129]);
const PITFALL_PRANKSTERS = new Set([5, 6, 7, 14, 53, 111]);
const SNOW_DURATION_BASE: Readonly<Record<number, number>> = {
  127: 90, // 瓔花
  68: 40,  // 幽香
  131: 40, // 磨弓
  132: 40, // 袿姫
  47: 60,  // 里香
};

function pharmacySpot(location: string): 0 | 2 {
  for (const id of PHARMACY_SPECIAL_ROOM_IDS) {
    if (roomIdToLocation(id) === location) return 2;
  }
  return 0;
}

function isShopLocation(location: string): boolean {
  return VILLAGE_SHOPS.some((shop) => shop.location === location);
}

function timeOfDay(state: GameState): number {
  return ((state.time.tickValue % 1440) + 1440) % 1440;
}

/** Shared upstream `自由行動条件(ARG)` gate. */
export function canRunFreeAction(state: GameState, slot: CharaSlot): boolean {
  const cf = slot.state.CFLAG;
  const tc = slot.state.TCVAR;
  const current = cf[CFLAG_ID.現在位置] ?? 0;
  const previous = cf[CFLAG_ID.前一次的位置] ?? 0;
  return (
    (atPlayerBase(state, slot.charaNum) || atOwnHome(state, slot.charaNum)) &&
    (cf[CFLAG_ID.睡眠] ?? 0) === 0 &&
    (cf[CFLAG_ID.衰弱] ?? 0) === 0 &&
    (cf[CFLAG_ID.招待] ?? 0) === 0 &&
    (cf[CFLAG_ID.诶嘿嘿] ?? 0) === 0 &&
    (cf[CFLAG_ID.行动] ?? 0) === 0 &&
    (cf[CFLAG_ID.延迟] ?? 0) === 0 &&
    (cf[CFLAG_ID.同行] ?? 0) === 0 &&
    (tc[TCVAR_ID.泥酔] ?? 0) === 0 &&
    (current === 0 || previous === 0 || current === previous) &&
    weatherDamage(state, slot.location, slot.charaNum) >= 0 &&
    (cf[CFLAG_ID["妊娠自覚状態"]] ?? 0) !== 1
  );
}

function charaName(slot: CharaSlot): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

function roomLabel(loc: string): string {
  const i = loc.indexOf(":");
  return i >= 0 ? loc.slice(i + 1) : loc;
}

function visible(state: GameState, slot: CharaSlot): boolean {
  return state.master.location === slot.location;
}

function flags(slot: CharaSlot): bigint {
  return placeFlagsOf(slot.location);
}

function isHomeRoom(slot: CharaSlot): boolean {
  return !!slot.homeLocation && slot.location === slot.homeLocation;
}

function hasWill(slot: CharaSlot, min: number): boolean {
  return (slot.state.BASE[BASE_ID.気力] ?? 0) > min;
}

function aboveHalfWill(slot: CharaSlot): boolean {
  const will = slot.state.BASE[BASE_ID.気力] ?? 0;
  const max = slot.state.MAXBASE[BASE_ID.気力] ?? 0;
  return max > 0 ? will > max / 2 : will > 500;
}

function isMealSpot(slot: CharaSlot): boolean {
  const f = flags(slot);
  return isHomeRoom(slot) || hasPlace(f, PLACE_MEAL) || hasPlace(f, PLACE_REST);
}

function isLibraryLike(slot: CharaSlot): boolean {
  return isHomeRoom(slot) || hasPlace(flags(slot), PLACE_STUDY);
}

function isPrivateRoom(slot: CharaSlot): boolean {
  const f = flags(slot);
  return hasPlace(f, PLACE_PRIVATE) || isHomeRoom(slot);
}

function isOutdoorOrTraining(slot: CharaSlot): boolean {
  const f = flags(slot);
  return !hasPlace(f, PLACE_INDOOR) || hasPlace(f, PLACE_TRAINING);
}

function canStartKotatsu(state: GameState, slot: CharaSlot): boolean {
  return (
    (state.time.season ?? 0) === 4 &&
    hasPlace(flags(slot), PLACE_KOTATSU) &&
    (slot.state.TALENT[TALENT_AQUATIC] ?? 0) === 0 &&
    (slot.state.TALENT[TALENT_ICE_FAIRY] ?? 0) === 0
  );
}

function validPitfallMeta(state: GameState): NonNullable<GameState["freeActionMeta"]>["pitfall"] {
  const pitfall = state.freeActionMeta?.pitfall;
  return pitfall?.dayIndex === state.time.dayIndex ? pitfall : undefined;
}

function snowState(state: GameState): NonNullable<GameState["freeActionMeta"]>["snow"] {
  const snow = state.freeActionMeta?.snow;
  return snow?.dayIndex === state.time.dayIndex ? snow : undefined;
}

function canJoinSermon(state: GameState, slot: CharaSlot): boolean {
  if (slot.charaNum === EIKI_CHARA) return true;
  if ((slot.state.TALENT[TALENT_ID.追加種族] ?? 0) === 4) return false;
  if (
    (slot.state.TALENT[TALENT_ID.神霊] ?? 0) !== 0 &&
    !SERMON_DIVINE_SPIRIT_EXCEPTIONS.has(slot.charaNum)
  ) return false;
  const sermon = state.freeActionMeta?.sermon;
  const eikiAction = state.freeActions?.[EIKI_CHARA];
  return sermon?.preacher === EIKI_CHARA && sermon.location === slot.location &&
    eikiAction?.type === 15 && eikiAction.remainingMinutes > 0;
}

function canStartSnow(state: GameState, slot: CharaSlot, allowExisting: boolean): boolean {
  if ((state.time.season ?? 0) !== 4) return false;
  if (!outRoof(state, slot.location)) return false;
  if (!hasPlace(flags(slot), PLACE_TRAINING)) return false;
  if (!hasWill(slot, 500)) return false;
  if (getYogore(state, slot.location) < 500) return false;
  if ((state.flagStore[FLAG_ID.異常気象] ?? 0) === 10) return false;
  const object = snowState(state)?.objects[slot.location];
  return allowExisting ? object !== undefined : object === undefined;
}

function canStartType(state: GameState, slot: CharaSlot, type: FreeActionType): boolean {
  const c = slot.state;
  switch (type) {
    case 15:
      return inRoom(state, slot.location) === 0 &&
        (c.CFLAG[CFLAG_ID.行动] ?? 0) !== 5 && canJoinSermon(state, slot);
    case 16: {
      if (!outRoof(state, slot.location)) return false;
      const pitfall = validPitfallMeta(state);
      const record = pitfall?.records?.[slot.charaNum];
      if (PITFALL_PRANKSTERS.has(slot.charaNum)) {
        if ((c.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return false;
        return !pitfall || (pitfall.location === slot.location && !record);
      }
      return !!pitfall && !pitfall.victim && !record && pitfall.location === slot.location;
    }
    case 17:
      return canStartSnow(state, slot, false);
    case 19:
      return (c.TALENT[TALENT_ID.NESTING] ?? 0) !== 0 && isHomeRoom(slot);
    case 3:
      return (
        ((c.TALENT[TALENT_FAIRY] ?? 0) !== 0 || SNACK_SPECIAL_CHARAS.has(slot.charaNum)) &&
        hasPlace(flags(slot), PLACE_SNACK) &&
        state.time.tickValue >= (c.TCVAR[TCVAR_ID.空腹時刻] ?? 0)
      );
    case 7:
      return (
        (c.ABL[ABL_ID.料理技能] ?? 0) >= 1 &&
        hasPlace(flags(slot), PLACE_KITCHEN) &&
        state.time.tickValue >= (c.TCVAR[TCVAR_ID.空腹時刻] ?? 0)
      );
    case 8:
      return (c.TALENT[TALENT_MUSIC_KNOWLEDGE] ?? 0) !== 0 &&
        hasPlace(flags(slot), PLACE_TRAINING) &&
        aboveHalfWill(slot);
    case 10:
      return (c.TALENT[TALENT_FISHING_LEVEL] ?? 0) >= 1 &&
        hasWill(slot, 500) && fishingSpot(slot.location) !== 0;
    case 11:
      return (c.TALENT[TALENT_ALCHEMY_LEVEL] ?? 0) >= 1 &&
        hasWill(slot, 500) &&
        (pharmacySpot(slot.location) === 2 || (c.CFLAG[CFLAG_ID.神社在住] ?? 0) !== 0);
    case 12:
      return timeOfDay(state) >= 600 && timeOfDay(state) <= 960 &&
        isMealSpot(slot) && !canStartKotatsu(state, slot);
    case 13:
      return (c.TALENT[TALENT_ALCOHOL_TOLERANCE] ?? 0) >= 0 &&
        (timeOfDay(state) >= 1200 || timeOfDay(state) < 120) &&
        isMealSpot(slot);
    case 14:
      return isShopLocation(slot.location) && hasWill(slot, 500) &&
        timeOfDay(state) >= 540 && timeOfDay(state) <= 1140;
    case 18:
      return canStartKotatsu(state, slot);
    case 0: // 考え事 — shrine resident in own room.
      return isHomeRoom(slot) && hasWill(slot, 500);
    case 1: // 玩遊戲 — 幼稚 + outdoor/training.
      return (c.TALENT[TALENT_ID.幼稚] ?? 0) !== 0 && isOutdoorOrTraining(slot) && hasWill(slot, 500);
    case 2: // 吃飯 — meal/rest/home and hungry.
      return isMealSpot(slot) && state.time.tickValue >= (c.TCVAR[TCVAR_ID.空腹時刻] ?? 0);
    case 4:
      // Keep cleaning as a resident action whenever the character has the
      // energy and a private room.  The former dirt threshold made the
      // activity disappear as soon as a room was clean, whereas the desired
      // modern schedule keeps a cleaner on station; `advanceFreeAction`
      // still removes only the dirt that actually exists.
      return isPrivateRoom(slot) && hasWill(slot, 500);
    case 5: // 運動/戦闘訓練.
      return (
        (c.ABL[ABL_ID.战斗能力] ?? 0) >= 1 &&
        (c.ABL[ABL_ID.音楽技能] ?? 0) <= (c.ABL[ABL_ID.战斗能力] ?? 0) &&
        aboveHalfWill(slot) &&
        hasPlace(flags(slot), PLACE_TRAINING)
      );
    case 6: // 読書.
      return (c.ABL[ABL_ID.教養] ?? 0) >= 1 && hasWill(slot, 500) && isLibraryLike(slot);
    case 9: // 採集.
      return (c.TALENT[TALENT_ID.採集Lv] ?? 0) >= 1 && hasWill(slot, 500) && gatheringSpot(slot.location) !== 0;
  }
}

/** Exposes the per-action authored gate for scheduler/UI regression tests. */
export function canStartFreeActionType(
  state: GameState,
  slot: CharaSlot,
  type: FreeActionType,
): boolean {
  return canStartType(state, slot, type);
}

/** Upstream `FreeAct_Chain`: thought and reading are the two non-chainable
 * ordinary actions; object-heavy actions remain excluded until modeled. */
export function canChainFreeActionType(
  state: GameState,
  slot: CharaSlot,
  type: number,
): type is FreeActionType {
  if (!CHAINABLE_FREE_ACTIONS.has(type as FreeActionType)) return false;
  if (type === 17) return canStartSnow(state, slot, true);
  if (type === 11) {
    return (slot.state.TALENT[TALENT_ALCHEMY_LEVEL] ?? 0) >= 1 && hasWill(slot, 500);
  }
  return canStartType(state, slot, type as FreeActionType);
}

/** Shared gate plus action-specific continuity constraints. */
export function canContinueFreeAction(
  state: GameState,
  slot: CharaSlot,
  action: CharaFreeAction,
): boolean {
  if (!canRunFreeAction(state, slot)) return false;
  if (action.type === 15 && slot.charaNum !== EIKI_CHARA) return canJoinSermon(state, slot);
  return true;
}

function duration(type: FreeActionType, rng: Rng, slot: CharaSlot): number {
  switch (type) {
    case 0: return 20 + rng.int(20);
    case 1: return 60 + rng.int(60);
    case 2: return 60 + rng.int(30);
    case 3: return 30 + rng.int(30);
    case 4: return 30 + rng.int(20);
    case 5: return 60 + rng.int(60);
    case 6: return 60 + rng.int(60);
    case 7: return 60 + rng.int(30);
    case 8: return 60 + rng.int(30);
    case 9: return 60 + rng.int(120);
    case 10: return 60 + rng.int(120);
    case 11: return 60 + rng.int(30);
    case 12: return 60 + rng.int(30);
    case 13: return 60 + rng.int(30);
    case 14: return 60 + rng.int(30);
    case 15: return slot.charaNum === EIKI_CHARA ? 60 + rng.int(30) : 30 + rng.int(60) + (slot.charaNum === 76 ? 90 : 0);
    case 16: return 1; // specialized in prepareActionStart
    case 17: return (SNOW_DURATION_BASE[slot.charaNum] ?? 30) + rng.int(30);
    case 18: {
      const ears = slot.state.TALENT[TALENT_ANIMAL_EARS] ?? 0;
      return ears === 4 ? 120 + rng.int(60) : ears !== 0 ? 90 + rng.int(45) : 60 + rng.int(30);
    }
    case 19: return 60 + rng.int(30);
  }
}

function shuffle<T>(input: readonly T[], rng: Rng): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function prose(slot: CharaSlot, type: number, phase: FreeActionPhase): string | null {
  const name = charaName(slot);
  if (phase === "start") {
    switch (type) {
      case 0: return `${name}似乎开始思考着什么。`;
      case 1: return `${name}在${roomLabel(slot.location)}游玩起来了。`;
      case 2: return `${name}准备吃饭了。`;
      case 3: return `${name}开始偷吃零食了。`;
      case 7: return `${name}开始准备做饭了。`;
      case 8: return `${name}开始进行音乐活动了。`;
      case 10: return `${name}拿出鱼竿开始钓鱼了。`;
      case 11: return `${name}开始准备做实验了。`;
      case 12: return `${name}在一旁休息起来了。`;
      case 13: return `${name}开始喝酒了。`;
      case 14: return `${name}拿着购物袋出门了。`;
      case 15: return slot.charaNum === EIKI_CHARA
        ? `${name}开始对附近的人说教了。`
        : `${name}被映姬逮住说教了……`;
      case 16: return PITFALL_PRANKSTERS.has(slot.charaNum)
        ? `${name}开始挖掘恶作剧用的落穴了……`
        : `${name}落入了附近的落穴陷阱！`;
      case 17: return `${name}开始用积雪制作雪雕了。`;
      case 18: return `${name}钻进被炉开始休息了。`;
      case 19: return `${name}开始温柔地温暖自己产下的蛋。`;
      case 4: return `${name}似乎在意房间脏污、决定打扫除了。`;
      case 5: return `${name}做了个深呼吸后开始运动了。`;
      case 6: return `${name}开始看书了。`;
      case 9: return `${name}看了看周围、开始了采集的工作了。`;
      default: return null;
    }
  }
  if (phase === "progress") {
    switch (type) {
      case 0: return `${name}沉默地思考着。`;
      case 1: return `${name}在神采奕奕地玩耍中。`;
      case 2: return `${name}正在吃饭。`;
      case 3: return `${name}正在吃零食。`;
      case 7: return `${name}正在做饭。`;
      case 8: return `${name}正在进行音乐活动。`;
      case 10: return `${name}正在悠闲地钓鱼。`;
      case 11: return `${name}正在做实验。`;
      case 12: return `${name}正在悠闲地休息。`;
      case 13: return `${name}正在喝酒。`;
      case 14: return `${name}正在逛街购物。`;
      case 15: return slot.charaNum === EIKI_CHARA
        ? `${name}正在进行一场长篇说教。`
        : `${name}正在老老实实听映姬说教。`;
      case 16: return PITFALL_PRANKSTERS.has(slot.charaNum)
        ? `${name}正在精心掩饰落穴。`
        : `${name}正在落穴里挣扎。`;
      case 17: return `${name}正在收集积雪、修整雪雕。`;
      case 18: return `${name}躺在被炉里取暖。`;
      case 19: return `${name}正爱怜地抱着蛋。`;
      case 4: return `${name}在手脚利落地收拾着房间。`;
      case 5: return `${name}正在做弹幕模拟的练习。`;
      case 6: return `${name}在默默地看着书。`;
      case 9: return `${name}在周围探寻着。`;
      default: return null;
    }
  }
  switch (type) {
    case 0: return `${name}似乎结束了思考。`;
    case 1: return `${name}似乎玩累了。`;
    case 2: return `${name}似乎吃完饭了。`;
    case 3: return `${name}吃完零食了。`;
    case 7: return `${name}似乎吃完饭了。`;
    case 8: return `${name}结束了音乐活动。`;
    case 10: return `${name}似乎钓完鱼了。`;
    case 11: return `${name}似乎做完实验了。`;
    case 12: return `${name}休息完了。`;
    case 13: return `${name}结束饮酒了。`;
    case 14: return `${name}似乎买完东西了。`;
    case 15: return slot.charaNum === EIKI_CHARA
      ? `${name}终于结束了说教。`
      : `${name}在说教结束后松了一口气。`;
    case 16: return PITFALL_PRANKSTERS.has(slot.charaNum)
      ? `${name}结束了这场落穴恶作剧。`
      : `${name}从落穴里爬了出来。`;
    case 17: return `${name}满意地完成了雪雕。`;
    case 18: return `${name}从被炉里爬出来了。`;
    case 19: return `${name}似乎已经暖好了蛋。`;
    case 4: return `${name}似乎扫除完毕了。`;
    case 5: return `${name}结束运动后缓了缓气。`;
    case 6: return `${name}似乎看完书了。`;
    case 9: return `${name}似乎结束了采集。`;
    default: return null;
  }
}

function exp(slot: CharaSlot, id: number, amount: number): void {
  slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + amount;
}

function applyMealEffect(state: GameState, slot: CharaSlot, elapsed: number): void {
  if (elapsed <= 0) return;
  slot.state.TCVAR[TCVAR_ID.空腹時刻] = state.time.tickValue + 120;
  recoverBase(slot, BASE_ID.体力, 3 * elapsed);
  recoverBase(slot, BASE_ID.気力, 3 * elapsed);
}

function applyDrinkEffect(slot: CharaSlot, elapsed: number, rng?: Rng): void {
  if (elapsed <= 0) return;
  const tolerance = slot.state.TALENT[TALENT_ALCOHOL_TOLERANCE] ?? 0;
  const gain = elapsed * ((rng?.int(3) ?? 0) + 1) * (4 - tolerance);
  const current = slot.state.BASE[BASE_ID.酒気] ?? 0;
  const max = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
  slot.state.BASE[BASE_ID.酒気] = max > 0 ? Math.min(max, current + gain) : current + gain;
}

function applyOngoingEffect(
  state: GameState,
  slot: CharaSlot,
  action: CharaFreeAction,
  elapsed: number,
  rng?: Rng,
): void {
  if (elapsed <= 0) return;
  switch (action.type) {
    case 3:
      applyMealEffect(state, slot, elapsed);
      break;
    case 7: {
      const nextRemaining = Math.max(0, action.remainingMinutes - elapsed);
      const mealElapsed = Math.max(
        0,
        Math.min(30, action.remainingMinutes) - Math.min(30, nextRemaining),
      );
      applyMealEffect(state, slot, mealElapsed);
      break;
    }
    case 13:
      applyDrinkEffect(slot, elapsed, rng);
      break;
    case 2:
      slot.state.TCVAR[TCVAR_ID.空腹時刻] = state.time.tickValue + 120;
      recoverBase(slot, BASE_ID.体力, 3 * elapsed);
      recoverBase(slot, BASE_ID.気力, 3 * elapsed);
      break;
    case 4: {
      const dirt = getYogore(state, slot.location);
      setYogore(state, slot.location, Math.max(0, dirt - Math.trunc((250 * elapsed) / 5)));
      break;
    }
    case 17: {
      const snow = getYogore(state, slot.location);
      setYogore(state, slot.location, Math.max(0, snow - Math.trunc((50 * elapsed) / 5)));
      if (visible(state, slot)) addSnowVisibility(state, slot.location, 10);
      break;
    }
  }
}

function applyCompletionEffect(
  state: GameState,
  slot: CharaSlot,
  action: CharaFreeAction,
  interrupted: boolean,
): void {
  switch (action.type) {
    case 7:
      exp(slot, EXP_COOKING, interrupted ? 1 : 2);
      break;
    case 8: {
      const music = slot.state.TALENT[TALENT_MUSIC_KNOWLEDGE] ?? 0;
      const musicExp = music === 1 ? EXP_PERFORMANCE : music === 2 ? EXP_SINGING : music === 3 ? EXP_DANCE : 0;
      if (musicExp !== 0) exp(slot, musicExp, 1);
      break;
    }
    case 10:
      exp(slot, EXP_FISHING, interrupted ? 1 : 2);
      break;
    case 11:
      exp(slot, EXP_ALCHEMY, 1);
      break;
    case 4:
      exp(slot, EXP_ID.清掃経験, interrupted ? 1 : 3);
      break;
    case 5:
      exp(slot, EXP_ID.戦闘経験, 1);
      break;
    case 6:
      exp(slot, EXP_ID.学習経験, 1);
      break;
    case 9:
      exp(slot, EXP_ID.採集経験, 1);
      break;
    case 15:
      if (slot.charaNum === EIKI_CHARA) {
        delete state.freeActionMeta?.sermon;
        for (const [rawCharaNum, current] of Object.entries(state.freeActions ?? {})) {
          if (Number(rawCharaNum) !== EIKI_CHARA && current.type === 15) {
            delete state.freeActions?.[Number(rawCharaNum)];
          }
        }
      }
      break;
    case 17:
      if (!interrupted) {
        const object = snowState(state)?.objects[slot.location];
        if (object) {
          object.completed = true;
          if (visible(state, slot)) addSnowVisibility(state, slot.location, 10);
        }
      }
      break;
  }
}

export interface FreeActionStart {
  action: CharaFreeAction;
  text?: string;
}

function prepareActionStart(
  state: GameState,
  slot: CharaSlot,
  type: FreeActionType,
  rng: Rng,
): CharaFreeAction | null {
  state.freeActionMeta ??= {};
  if (type === 15) {
    const remainingMinutes = duration(type, rng, slot);
    if (slot.charaNum === EIKI_CHARA) {
      state.freeActionMeta.sermon = { preacher: EIKI_CHARA, location: slot.location };
    } else {
      const preacher = state.freeActions?.[EIKI_CHARA];
      if (!preacher || preacher.type !== 15) return null;
      preacher.remainingMinutes = Math.max(preacher.remainingMinutes, remainingMinutes);
    }
    return { type, remainingMinutes };
  }

  if (type === 16) {
    let pitfall = validPitfallMeta(state);
    if (!pitfall) {
      if (!PITFALL_PRANKSTERS.has(slot.charaNum)) return null;
      pitfall = {
        dayIndex: state.time.dayIndex,
        initiator: slot.charaNum,
        location: slot.location,
        records: { [slot.charaNum]: 2 },
      };
      state.freeActionMeta.pitfall = pitfall;
      return { type, remainingMinutes: 40 + rng.int(30) };
    }
    pitfall.records ??= {};
    if (PITFALL_PRANKSTERS.has(slot.charaNum)) {
      pitfall.records[slot.charaNum] = 2;
      const initiatorAction = state.freeActions?.[pitfall.initiator];
      return {
        type,
        remainingMinutes: initiatorAction?.type === 16 && initiatorAction.remainingMinutes > 0
          ? initiatorAction.remainingMinutes
          : 30 + rng.int(20),
      };
    }
    const rank = slot.state.ABL[ABL_ID.战斗能力] ?? 0;
    if (rank > 4 && rng.int(4) === 0) return null;
    pitfall.records[slot.charaNum] = 1;
    pitfall.victim = slot.charaNum;
    pitfall.rank = rank;
    for (const [rawCharaNum, record] of Object.entries(pitfall.records)) {
      if (record !== 2) continue;
      const pranksterAction = state.freeActions?.[Number(rawCharaNum)];
      if (pranksterAction?.type === 16) pranksterAction.remainingMinutes = 1;
    }
    return { type, remainingMinutes: 1 };
  }

  if (type === 17) {
    const snow = snowState(state) ?? { dayIndex: state.time.dayIndex, objects: {} };
    state.freeActionMeta.snow = snow;
    const description = snowObjectDescription(slot, slot.charaNum);
    snow.objects[slot.location] = {
      creator: slot.charaNum,
      name: description.name,
      suffix: description.suffix,
      ...(visible(state, slot) ? { visibilityUnits: 10 } : {}),
    };
  }
  return { type, remainingMinutes: duration(type, rng, slot) };
}

/** Try to start a free action, faithful to the upstream probability + shuffled
 * action-list shape. Mutates hunger clock for meal start, matching FREE_ACT_2. */
export function maybeStartFreeAction(
  state: GameState,
  slot: CharaSlot,
  elapsed: number,
  rng: Rng,
): FreeActionStart | null {
  if (elapsed <= 0) return null;
  if (rng.int(800) >= 5 * elapsed) return null;

  for (const type of shuffle(MODELED_FREE_ACTIONS, rng)) {
    if (!canStartType(state, slot, type)) continue;
    const action = prepareActionStart(state, slot, type, rng);
    if (!action) continue;
    if (type === 2 || type === 3) slot.state.TCVAR[TCVAR_ID.空腹時刻] = state.time.tickValue + 120;
    slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 1;
    return {
      action,
      text: visible(state, slot) ? prose(slot, type, "start") ?? undefined : undefined,
    };
  }
  return null;
}

export function freeActionText(
  slot: CharaSlot,
  type: number,
  phase: FreeActionPhase,
): string | null {
  return prose(slot, type, phase);
}

export interface FreeActionAdvance {
  completed: boolean;
  event32Phase: 0 | 1;
  text?: string;
}

/** Advance an active free action by `elapsed` minutes. Mutates action/state. */
export function advanceFreeAction(
  state: GameState,
  slot: CharaSlot,
  action: CharaFreeAction,
  elapsed: number,
  rng?: Rng,
): FreeActionAdvance {
  const used = Math.min(Math.max(0, elapsed), Math.max(0, action.remainingMinutes));
  applyOngoingEffect(state, slot, action, used, rng);
  action.remainingMinutes = Math.max(0, action.remainingMinutes - Math.max(0, elapsed));
  const completed = action.remainingMinutes <= 0;
  if (completed) applyCompletionEffect(state, slot, action, false);
  return {
    completed,
    event32Phase: completed ? 1 : 0,
    text: visible(state, slot) ? prose(slot, action.type, completed ? "complete" : "progress") ?? undefined : undefined,
  };
}

/** Cancel a free action because the general 自由行動条件 failed. No common
 * message is printed upstream, but some actions still grant reduced EXP. */
export function interruptFreeAction(state: GameState, slot: CharaSlot, action: CharaFreeAction): void {
  applyCompletionEffect(state, slot, action, true);
}

export function freeActionEvent(
  now: () => number,
  text: string,
): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text, presentation: "ambient" };
}
