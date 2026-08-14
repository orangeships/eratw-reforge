/**
 * Deterministic port of `MOVEMENTS/物件関連/MOB.ERB`.
 *
 * MOBs are not character slots.  They are a time-dependent room population
 * which supplies ambient prose, dirt, and a public-place interruption.
 */

import type { GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { getDish, isHungryFor, riseFullness } from "../state/dish.js";
import { getTflag, setTflag, TFLAG_ID } from "../state/tflag.js";
import { advanceTimeTicks, BASE_ID, CFLAG_ID, FLAG_ID, recoverBase, TALENT_ID } from "../state/settlement.js";
import { getYogore, setYogore } from "../state/yogore.js";
import { mapIdOfLocation } from "./location-predicates.js";
import { timeZoneOf, type TimeZone } from "./time-of-day.js";

export type MobMapId = 3 | 4 | 9 | 10;

export interface MobRng {
  int(maxExclusive: number): number;
}

const MOB_MAP_IDS = new Set<MobMapId>([3, 4, 9, 10]);
const NIGHT_ZONES = new Set<TimeZone>([1, 6, 7]);

const KOUMAKAN_BY_ZONE: Readonly<Partial<Record<TimeZone, readonly string[]>>> = {
  2: ["紅魔館:庭", "紅魔館:後院", "紅魔館:東陽台", "紅魔館:西陽台"],
  3: ["紅魔館:厨房", "紅魔館:食堂", "紅魔館:會客廳"],
  4: ["紅魔館:大廳", "紅魔館:二階廊下"],
  5: ["紅魔館:大露台", "紅魔館:小露台"],
  6: ["紅魔館:後院", "紅魔館:地下走廊", "紅魔館:倉庫", "紅魔館:使用人部屋"],
};

const EIENTEI_ROOMS = [
  "永遠亭:廊下", "永遠亭:中廊下", "永遠亭:走廊", "永遠亭:庭", "永遠亭:後院", "迷途竹林:兎的洞穴",
] as const;

const CHITEI_ROOMS = new Set([
  "地灵殿:大會堂", "地灵殿:一階廊下", "地灵殿:食堂", "地灵殿:二階廊下", "地灵殿:露台", "地灵殿:後院", "地灵殿:中庭",
  "旧都:大街", "旧都:後街", "旧都:酒場", "旧都:鬼的聚集場所",
  "旧地狱:灼熱地獄跡", "旧地狱:地獄的人工太陽", "旧地狱:旧血の池地獄",
]);

const MOON_BY_ZONE: Readonly<Partial<Record<TimeZone, readonly string[]>>> = {
  2: ["月之世界:玉兎街", "月之世界:広場", "月之世界:桃林", "绵月亭:綿月亭・門", "绵月亭:門番詰め所", "绵月亭:玉兎詰め所"],
  3: ["月之世界:玉兎街", "月之世界:広場", "绵月亭:綿月亭・門", "绵月亭:玉兎食堂"],
  4: ["月之世界:玉兎街", "月之世界:広場", "月之世界:桃林", "绵月亭:綿月亭・門", "绵月亭:門番詰め所", "绵月亭:玉兎詰め所"],
  5: ["月之世界:玉兎街", "月之世界:広場", "绵月亭:綿月亭・門", "绵月亭:玉兎食堂"],
  6: ["月之世界:玉兎街", "月之世界:広場", "绵月亭:綿月亭・門", "绵月亭:門番詰め所", "绵月亭:玉兎食堂", "绵月亭:玉兎詰め所"],
  1: ["绵月亭:綿月亭・門"],
  7: ["绵月亭:綿月亭・門"],
};

export const MOB_ANIMALS = [
  "狗", "猫", "考拉", "大猩猩", "泽西恶魔", "犰狳", "小野猪", "水豚",
  "食蚁兽", "马", "牛", "羊", "羊驼", "海豹", "大象", "长颈鹿",
  "雏鸡", "企鹅", "鲸头鹳", "孔雀", "鸵鸟", "鳄鱼", "科莫多龙", "缅甸蟒", "象龟",
] as const;

export function mobMapIdAt(location: string): MobMapId | null {
  const id = mapIdOfLocation(location);
  return id !== null && MOB_MAP_IDS.has(id as MobMapId) ? id as MobMapId : null;
}

/** `@ANIMALNAME()` -- stable for the same in-game minute. */
export function mobAnimalName(tickValue: number): string {
  const minute = ((Math.trunc(tickValue) % 1440) + 1440) % 1440;
  return MOB_ANIMALS[minute % MOB_ANIMALS.length]!;
}

/** `MOB_PLACE_<mapId>` as a derived room predicate (no duplicate saved flag). */
export function hasMobAt(location: string, tickValue: number): boolean {
  const zone = timeZoneOf(tickValue);
  switch (mobMapIdAt(location)) {
    case 3:
      return KOUMAKAN_BY_ZONE[zone]?.includes(location) ?? false;
    case 4:
      return EIENTEI_ROOMS.includes(location as typeof EIENTEI_ROOMS[number]);
    case 9:
      return CHITEI_ROOMS.has(location);
    case 10:
      return MOON_BY_ZONE[zone]?.includes(location) ?? false;
    default:
      return false;
  }
}

/** `MOB_YOGORE`: dirt per elapsed in-game minute while sharing a MOB room. */
export function mobDirtRate(location: string, tickValue: number): number {
  if (!hasMobAt(location, tickValue)) return 0;
  const zone = timeZoneOf(tickValue);
  switch (mobMapIdAt(location)) {
    case 3: return -3;
    case 4: return NIGHT_ZONES.has(zone) ? 0 : 1;
    case 9: return NIGHT_ZONES.has(zone) ? 0 : 2;
    default: return 0;
  }
}

/** Apply `EVENTCOMEND.ERB`'s `TIME_PROGRESS * MOB_YOGORE` contribution. */
export function accrueMobDirt(state: GameState, oldTick: number, newTick: number): void {
  const elapsed = Math.max(0, Math.trunc(newTick) - Math.trunc(oldTick));
  if (!elapsed) return;
  const rate = mobDirtRate(state.master.location, newTick);
  if (rate) setYogore(state, state.master.location, getYogore(state, state.master.location) + elapsed * rate);
}

/** `MOB_MESSAGE_<mapId>` for the currently occupied MOB room. */
export function mobMessage(state: Readonly<GameState>, rng: MobRng): string | null {
  const location = state.master.location;
  if (!hasMobAt(location, state.time.tickValue)) return null;
  const stopped = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const zone = timeZoneOf(state.time.tickValue);
  switch (mobMapIdAt(location)) {
    case 3:
      if (stopped) return "哥布林们停下了动作…";
      return location === "紅魔館:倉庫" ? "哥布林们照看着猫…" : "哥布林们正在干活…";
    case 4:
      if (stopped) return "因幡们停下了动作";
      if (NIGHT_ZONES.has(zone)) return "因幡们睡着觉…";
      if (((state.time.date ?? 1) % 10) === 0) {
        return (state.master.state.TALENT[TALENT_ID.性別] ?? 0) === 0
          ? "发情中的因幡们陷入了苦恼……"
          : "感到了从发情中的因幡们投来的强烈视线……";
      }
      return ["因幡们正在闲逛", "因幡们在玩", "因幡们在聊天", "因幡和因幡肩并着肩", "因幡们堆在一起"][rng.int(5)]!;
    case 9: {
      const animal = mobAnimalName(state.time.tickValue);
      if (location.startsWith("旧地狱:")) {
        if (stopped) return "怨灵们停下了动作";
        if ((state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return "怨灵看起来不自在的样子…";
        return rng.int(2) === 0 ? "怨灵在彷徨" : "怨灵飘荡着";
      }
      if (location.startsWith("旧都:")) {
        if (stopped) return "鬼们停下了动作";
        if (NIGHT_ZONES.has(zone)) return "鬼们在睡觉…";
        return ["鬼们举行着酒宴", "鬼们聚集在一起", "鬼们在打着架", "鬼们徘徊着", "鬼们吵闹着", "鬼躺在地上…真碍事"][rng.int(6)]!;
      }
      if (stopped) return `${animal}停下了动作`;
      if (NIGHT_ZONES.has(zone)) return `${animal}在睡觉…`;
      if (location === "地灵殿:後院") return rng.int(2) === 0 ? `${animal}在洗澡` : `${animal}在游泳`;
      return rng.int(2) === 0 ? `${animal}徘徊着` : `${animal}躺在地上…真碍事`;
    }
    case 10:
      if (stopped) return location === "绵月亭:綿月亭・門" || location === "绵月亭:門番詰め所" ? "守卫们停下了动作" : "玉兔们停下了动作";
      if (location === "月之世界:玉兎街" || location === "月之世界:広場") return "玉兔们忙忙碌碌的";
      if (location === "月之世界:桃林") return "玉兔们在训练";
      if (location === "绵月亭:綿月亭・門") return "守卫在看守着";
      if (location === "绵月亭:門番詰め所") return "守卫们在休息";
      if (location === "绵月亭:玉兎食堂") return "玉兔们在用餐";
      return "玉兔们在休息";
    default:
      return null;
  }
}

/** Whether `MOB_TURNENDEVENT` must terminate the active H session. */
export function mobInterruptsHMode(state: Readonly<GameState>): boolean {
  return (state.flagStore[FLAG_ID.時間停止] ?? 0) === 0
    && (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0
    && hasMobAt(state.master.location, state.time.tickValue);
}

export function mobInterruptionMessage(state: Readonly<GameState>): string | null {
  if (!mobInterruptsHMode(state)) return null;
  switch (mobMapIdAt(state.master.location)) {
    case 3: return "被哥布林提醒说这里是公共场所请不要做这种行为";
    case 4: return "四周看到你们的因幡们乱哄哄地吵闹起来，并开始聚集过来。";
    case 10: return state.master.location === "绵月亭:綿月亭・門" || state.master.location === "绵月亭:門番詰め所"
      ? "守卫因为什么事情而嘈嚷地跑了过来。"
      : "四周的玉兔们乱哄哄地吵闹起来，并开始聚集过来。";
    default: return null; // 地底 has no MOB_TURNENDEVENT upstream.
  }
}

/** Upstream clears `BASE:TARGET:情緒`; resolve the focused target at the caller. */
export function clearMobInterruptedTargetEmotion(state: GameState, target: number): void {
  const slot = state.charas[target];
  if (slot) slot.state.BASE[BASE_ID.情緒] = 0;
}

function sameRoomParticipants(state: Readonly<GameState>): number[] {
  const participants = [0];
  for (const slot of Object.values(state.charas)) {
    if (slot.location === state.master.location) participants.push(slot.charaNum);
  }
  return participants;
}

/**
 * `@MAKANAI` trigger. Returns true only when the persisted ASK_YN session was
 * opened. The caller owns the introductory narration.
 */
export function maybeOfferMobMeal(state: GameState, rng: MobRng): boolean {
  if (state.mobMealSession || getTflag(state, TFLAG_ID.まかない)) return false;
  if (state.master.location !== "紅魔館:厨房" || !hasMobAt(state.master.location, state.time.tickValue)) return false;
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 || getDish(state)) return false;

  const participants = sameRoomParticipants(state);
  if (participants.some((charaNum) => !isHungryFor(state, charaNum, false))) return false;
  if (rng.int(5) !== 0) return false;

  setTflag(state, TFLAG_ID.まかない, 1);
  state.mobMealSession = {
    kind: "mob-meal",
    offeredAtTick: state.time.tickValue,
    location: state.master.location,
    participants,
    qualityRoll: rng.int(5),
  };
  return true;
}

/** Resolve the persisted `@MAKANAI` ASK_YN. Mutates `state` in place. */
export function resolveMobMeal(
  state: GameState,
  accept: boolean,
  now: () => number,
): ObservationEvent[] {
  const session = state.mobMealSession;
  if (!session) return [];
  state.mobMealSession = null;

  if (!accept) {
    return [{ kind: "NARRATION", timestamp: now(), text: "你断然拒绝了。" }];
  }

  const quality = session.qualityRoll;
  const stamina = quality <= 1 ? 100 : quality <= 3 ? 150 : 300;
  const will = quality <= 1 ? 300 : quality <= 3 ? 400 : 500;
  const qualityText = quality <= 1 ? "味道马马虎虎。" : quality <= 3 ? "还不错。" : "这个真好吃！";

  for (const charaNum of session.participants) {
    const slot = charaNum === 0 ? state.master : state.charas[charaNum];
    if (!slot) continue;
    recoverBase(slot, BASE_ID.体力, stamina);
    recoverBase(slot, BASE_ID.気力, will);
    riseFullness(state, charaNum, "軽食", 180);
  }

  const dayEvents = advanceTimeTicks(state, 15).map((event) => ({ ...event, timestamp: now() }));
  return [
    { kind: "NARRATION", timestamp: now(), text: qualityText },
    { kind: "NARRATION", timestamp: now(), text: session.participants.length > 1 ? "你们吃饱了。" : "你吃饱了。" },
    ...dayEvents,
  ];
}
