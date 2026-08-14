/**
 * Spot-level cross-map encounter refresh.
 *
 * This ports the portable base-game core of:
 *   - `BEFORETRAIN.ERB -> @遭遇判定`
 *   - `遭遇判定.ERB -> @遭遇フラグ決定`
 *   - `日時天候管理.ERB -> @TIMEZONE_MOVE`
 *
 * Important distinction: this is NOT the same as the already-ported
 * `COMF400` / `SKIP_MOVE` same-map “路过” pause. Upstream first rolls a
 * character's `CFLAG:遭遇位置` as a spot-level odekake point (10/20/210/…);
 * later movement code sends the character there during their active window.
 *
 * Scope: every modern-built map (0-10) contributes representative public
 * points. We still leave map 11+ / DLC-only destinations unresolved instead of
 * inventing rooms that are not present in the current scene bundle.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import type { CharaSlot, GameState } from "../state/index.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { canAppearAtSpot as charaMoveSpotCanAppear } from "./chara-move-spots.js";

/** Modern representative room for each built odekake spot id. Spot ids are
 *  `mapId * 100 + ordinal` (1-99), matching the PLACE_ERH.ERH convention.
 *  Each spot is an outdoor / public room suitable for an encounter — never
 *  a private bedroom or bathroom. */
const ODEKAKE_SPOT_LOCATIONS = {
  // 神社 (mapId 0)
  10: "神社:鳥居",
  20: "神社:境内",
  30: "神社:本堂",
  40: "神社:走廊",
  50: "神社:三妖精之家・大廳",
  60: "神社:夢幻遺跡・一階通路",
  // 人間之里 (mapId 2)
  210: "人間之里:中央広場",
  220: "人間之里:鈴奈庵",
  230: "人間之里:酒屋",
  240: "人間之里:寺子屋",
  250: "人間之里:銭湯",
  260: "人間之里:情人用宿屋",
  270: "人間之里:長屋前",
  // 命蓮寺 (mapId 1)
  110: "命蓮寺:山門",
  120: "命蓮寺:境内",
  130: "命蓮寺:墓地",
  140: "霊廟:霊廟大門",
  150: "霊廟:霊廟広場",
  160: "霊廟:霊廟広場", // 神霊廟広場 alias upstream duplicate
  170: "霊廟:霊廟道場",
  // 紅魔館・霧之湖 (mapId 3)
  310: "霧之湖:湖畔",
  320: "紅魔館:正門",
  330: "紅魔館:庭",
  340: "紅魔館:大露台",
  350: "廃洋館:廃洋館・入口",
  // 永遠亭・竹林・夢幻館 (mapId 4)
  410: "永遠亭:永遠亭入口",
  420: "迷途竹林:斜角的竹林",
  430: "迷途竹林:迷失的小道",
  440: "迷途竹林:太陽花田",
  450: "夢幻館:庭",
  // 魔法之森 / 人偶的洋馆 (mapId 5)
  509: "魔法之森:再思之道",
  502: "魔法之森:香霖堂",
  540: "魔法之森:古木的大樹",
  510: "魔理沙宅:霧雨魔法店",
  525: "人偶的洋馆:人偶洋館・生活間",
  // 彼岸・冥界 (mapId 6)
  601: "彼岸",
  602: "彼岸:賽の河原",
  604: "彼岸:彼岸",
  605: "彼岸:地獄",
  614: "是非曲直厅:是非曲直庁等候室",
  621: "白玉楼:庭",
  629: "白玉楼:西行妖",
  // 妖怪之山山麓 / 圣域 / 浅间净秽山 (mapId 7)
  701: "妖怪之山・山麓",
  703: "妖怪之山・山麓:玄武之澤",
  708: "妖怪之山・山麓:大蛤蟆之池",
  712: "妖怪之山・山麓:間欠泉地下中樞",
  738: "妖怪之山・山麓:森の深奥",
  741: "圣域:猿猴通路",
  752: "浅间净秽山:四季竖穴",
  // 妖怪之山山顶 / 守矢神社 / 天界 (mapId 8)
  801: "妖怪之山・山顶",
  805: "妖怪之山・山顶:頂上",
  811: "守矢神社:境内",
  814: "守矢神社:湖畔",
  832: "天界:有頂天街",
  855: "妖怪之山・山顶:虹龍洞",
  // 地底 (mapId 9)
  901: "地灵殿",
  926: "地灵殿:中庭",
  928: "旧地狱:灼熱地獄跡",
  931: "旧都:大街",
  933: "旧都:酒場",
  934: "旧都:温泉",
  946: "旧都:橋",
  // 月之世界 (mapId 10)
  1001: "月之世界",
  1002: "月之世界:月之都",
  1003: "月之世界:玉兎街",
  1014: "月之世界:桃林",
  1015: "月之世界:砂浜",
  1016: "月之世界:入海口",
  1021: "绵月亭:綿月亭・玄関",
} as const;

export type EncounterSpotId = keyof typeof ODEKAKE_SPOT_LOCATIONS;

const ODEKAKE_SPOT_IDS = Object.keys(ODEKAKE_SPOT_LOCATIONS)
  .map(Number)
  .sort((a, b) => a - b) as EncounterSpotId[];

/** The spots above serve every bundled character. `canAppearAtSpot` now
 *  resolves at call time instead of consulting a hand-written per-chara table:
 *  a character may appear at any spot whose map differs from their home map.
 *  This faithfully mirrors the upstream `@遭遇フラグ決定` which samples
 *  `ODEKAKE_LOCATIONS` globally and only filters `P_ID == 自宅位置 || MAPID ==
 *  よく行く地域` per preference — there is no per-character hard-coded roster. */

function cflag(slot: CharaSlot, id: number): number {
  return slot.state.CFLAG[id] ?? 0;
}

function setCflag(slot: CharaSlot, id: number, value: number): void {
  if (value === 0) {
    delete slot.state.CFLAG[id];
    return;
  }
  slot.state.CFLAG[id] = value;
}

function talent(slot: CharaSlot, id: number): number {
  return slot.state.TALENT[id] ?? 0;
}

export function encounterLocationForSpot(spotId: number): string | null {
  return ODEKAKE_SPOT_LOCATIONS[spotId as EncounterSpotId] ?? null;
}

export function spotMapId(spotId: number): number {
  return spotId < 100 ? 0 : Math.trunc(spotId / 100);
}

function locationMapId(location: string | undefined): number {
  if (!location) return 0;
  // Map prefix → MAPID from PLACE_ERH.ERH / location-predicates.ts
  const prefixes: Record<string, number> = {
    "神社": 0, "自宅": 0,
    "命蓮寺": 1, "霊廟": 1,
    "人間之里": 2,
    "紅魔館": 3, "霧之湖": 3, "廃洋館": 3,
    "永遠亭": 4, "迷途竹林": 4, "夢幻館": 4,
    "魔法之森": 5, "魔理沙宅": 5, "人偶的洋馆": 5,
    "彼岸": 6, "是非曲直厅": 6, "白玉楼": 6, "八云邸": 6, "畜生界": 6,
    "妖怪之山・山麓": 7, "仙人的宅邸　2-3F": 7, "圣域": 7, "浅间净秽山": 7,
    "妖怪之山・山顶": 8, "守矢神社": 8, "天界": 8,
    "地灵殿": 9, "旧都": 9, "旧地狱": 9,
    "月之世界": 10, "绵月亭": 10, "纯狐邸": 10,
  };
  for (const [prefix, mapId] of Object.entries(prefixes)) {
    if (location.startsWith(prefix)) return mapId;
  }
  return 0;
}

function mainMapId(state: GameState): number {
  return locationMapId(state.homeLocation ?? state.master.location);
}

function charaInitialMapId(slot: CharaSlot): number {
  const raw = cflag(slot, CFLAG_ID.初期位置);
  if (raw > 0) return Math.trunc(raw / 100);
  return locationMapId(slot.homeLocation ?? slot.location);
}

/**
 * Upstream stores a `神社在住` bit, but modern home selection can make 人里 the
 * player base. Derive "resident of MAIN_MAP" from 初期位置 vs player home map
 * and keep the explicit bit as a compatibility override for old saves/tests.
 */
export function isMainMapResident(state: GameState, slot: CharaSlot): boolean {
  return cflag(slot, CFLAG_ID.神社在住) !== 0 || charaInitialMapId(slot) === mainMapId(state);
}

export function encounterBaseRate(bannedCount: number, charaCount: number): number {
  if (charaCount <= 0) return 33;
  const ratio = bannedCount / charaCount;
  if (ratio >= 0.6) return 45;
  if (ratio >= 0.45) return 42;
  if (ratio >= 0.3) return 40;
  if (ratio >= 0.15) return 38;
  if (ratio >= 0.1) return 35;
  return 33;
}

/** Per-chara ODEKAKE spot whitelist is provided by `chara-move-spots.ts`
 *  (upstream `CHARAMOVE_DATA_NN(7, P_ID)`). It returns null when no whitelist
 *  is loaded or the chara has no CASE 7 entry (= caller lets the global
 *  ODEKAKE table decide, matching upstream's default for chara without the
 *  override). It returns false explicitly when the chara is whitelisted but
 *  this spot isn't on the list — that's the filter that excludes 心 from
 *  竹林, etc. */

function candidateSpots(
  slot: CharaSlot,
  main: number,
  type: 2 | 3,
  strict: boolean,
): EncounterSpotId[] {
  const home = cflag(slot, CFLAG_ID.自宅位置);
  const favorite = slot.state.CFLAG[CFLAG_ID.よく行く地域] ?? 0;
  return ODEKAKE_SPOT_IDS.filter((spot) => {
    if (spotMapId(spot) === main) return false;
    // Per-chara CHARAMOVE_DATA whitelist (upstream @遭遇フラグ決定 filter):
    //   null  = no whitelist loaded or chara has no CASE 7 entry → allow
    //           (preserve global table behavior for the long tail of chara
    //           without an override file)
    //   false = chara declares a whitelist but this spot isn't on it → drop
    //   true  = explicitly allowed
    const allowed = charaMoveSpotCanAppear(slot.charaNum, spot);
    if (allowed === false) return false;
    if (!strict) return true;
    if (spot === home) return false;
    if (type === 2) return spotMapId(spot) === favorite;
    return spotMapId(spot) !== favorite;
  });
}

function chooseEncounterSpot(state: GameState, slot: CharaSlot, rng: Rng): EncounterSpotId | null {
  const main = mainMapId(state);
  const home = cflag(slot, CFLAG_ID.自宅位置);
  const favorite = slot.state.CFLAG[CFLAG_ID.よく行く地域] ?? 0;
  let type: 2 | 3 | null = null;

  // Original weights: 自宅位置 : よく行く地域 : その他 = 1 : 2 : 1.
  // If an arm points to unmapped/deferred data, keep rolling until a usable
  // arm appears, then fall back to その他 as a guard.
  for (let guard = 0; guard < 8 && type === null; guard += 1) {
    const roll = rng.int(101);
    if (roll <= 25) {
      if (home > 0 && encounterLocationForSpot(home)) return home as EncounterSpotId;
    } else if (roll <= 75) {
      if (favorite >= 0 && favorite !== main) type = 2;
    } else {
      type = 3;
    }
  }
  if (type === null) type = 3;

  const strict = candidateSpots(slot, main, type, true);
  const candidates = strict.length > 0 ? strict : candidateSpots(slot, main, type, false);
  if (candidates.length === 0) return null;
  return candidates[rng.int(candidates.length)] ?? null;
}

function assignEncounterSpot(state: GameState, slot: CharaSlot, rng: Rng): void {
  const spot = chooseEncounterSpot(state, slot, rng);
  setCflag(slot, CFLAG_ID.遭遇位置, spot ?? 0);
}

function sortedSlots(state: GameState): CharaSlot[] {
  return Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum);
}

/**
 * Morning `@遭遇判定`, called from wake/open-eyes before commissions. Mutates
 * per-chara `CFLAG:遭遇位置` in place and returns no user-facing text, matching
 * the original silent refresh.
 */
export function runEncounterMorning(
  state: GameState,
  rng: Rng,
  _now?: () => number,
): ObservationEvent[] {
  const day = state.time.dayIndex;
  if (state.encounterMorningDay === day) return [];
  state.encounterMorningDay = day;

  const slots = sortedSlots(state);
  for (const slot of slots) setCflag(slot, CFLAG_ID.遭遇位置, 0);

  const banned = slots.filter((slot) => cflag(slot, CFLAG_ID.出禁) !== 0).length;
  const baseRate = encounterBaseRate(banned, slots.length);
  for (const slot of slots) {
    if (talent(slot, TALENT_ID.路人) !== 0 || cflag(slot, CFLAG_ID.出禁) !== 0) continue;
    if (isMainMapResident(state, slot)) {
      if (20 > rng.int(100)) assignEncounterSpot(state, slot, rng);
      continue;
    }
    if (cflag(slot, CFLAG_ID.拠点来訪) !== 0 && cflag(slot, CFLAG_ID.宴会参加) !== 0) {
      continue;
    }
    if (baseRate > rng.int(100)) assignEncounterSpot(state, slot, rng);
  }

  return [];
}

function sameRoomAsMaster(state: GameState, slot: CharaSlot): boolean {
  return slot.location === state.master.location;
}

function timezoneMoveEligible(state: GameState, slot: CharaSlot): boolean {
  if (talent(slot, TALENT_ID.路人) !== 0 || cflag(slot, CFLAG_ID.出禁) !== 0) return false;
  if (isMainMapResident(state, slot)) return false;
  if (cflag(slot, CFLAG_ID.拠点来訪) !== 0 || cflag(slot, CFLAG_ID.宴会参加) !== 0) return false;
  if (cflag(slot, CFLAG_ID.招待) !== 0 || cflag(slot, CFLAG_ID.同行) !== 0) return false;
  if (cflag(slot, CFLAG_ID.睡眠) !== 0 || cflag(slot, CFLAG_ID.行动) === 5) return false;
  // `TIMEZONE_MOVE` skips characters with no previous physical location.
  return cflag(slot, CFLAG_ID.前一次的位置) !== 0 || cflag(slot, CFLAG_ID.遭遇位置) !== 0;
}

function shouldRerollForTimezone(state: GameState, slot: CharaSlot, rng: Rng): boolean {
  if (sameRoomAsMaster(state, slot)) {
    if (talent(slot, TALENT_ID.恋慕) !== 0) return rng.int(5) === 0;
    if (talent(slot, TALENT_ID.思慕) !== 0) return rng.int(4) === 0;
    return rng.int(3) === 0;
  }
  return rng.int(2) === 0;
}

/**
 * `@TIMEZONE_MOVE` rerolls already-active holiday encounters at time-band
 * boundaries. The full `CHARA_HOLIDAY` subsystem is not separately modeled;
 * this conservative port affects characters that already have/previously had
 * a physical encounter position and leaves visitors/workers/sleepers alone.
 */
export function runEncounterTimezoneMove(state: GameState, rng: Rng): ObservationEvent[] {
  for (const slot of sortedSlots(state)) {
    if (!timezoneMoveEligible(state, slot)) continue;
    if (!shouldRerollForTimezone(state, slot, rng)) continue;
    assignEncounterSpot(state, slot, rng);
  }
  return [];
}

export function encounterTargetLocation(_state: GameState, slot: CharaSlot): string | null {
  const spot = cflag(slot, CFLAG_ID.遭遇位置);
  if (spot <= 0) return null;
  const loc = encounterLocationForSpot(spot);
  if (!loc) {
    setCflag(slot, CFLAG_ID.遭遇位置, 0);
    return null;
  }
  return loc;
}
