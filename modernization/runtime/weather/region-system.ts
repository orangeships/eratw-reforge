/**
 * Weather S6 — area classification and static `IS_NO_*` flags.
 *
 * Port of `魔改内容/qol/qol_weather.ERB:1-193`. The original receives a
 * numeric `AT_AREA(PID)`/`GET_MAPID(PID)`. The modern runtime stores a
 * canonical location string, so these helpers use faithful prefix/alias
 * matching over that string.
 */

import type { GameState } from "../state/game-state.js";
import { REGION_ID } from "../state/weather-state.js";

export const REGION_NAMES: Record<number, string> = {
  [REGION_ID.通用]: "通用",
  [REGION_ID.三途]: "三途",
  [REGION_ID.彼岸]: "彼岸",
  [REGION_ID.冥界]: "冥界",
  [REGION_ID.地狱]: "地狱",
  [REGION_ID.旧狱]: "旧狱",
  [REGION_ID.天界]: "天界",
  [REGION_ID.梦境]: "梦境",
  [REGION_ID.月都]: "月都",
  [REGION_ID.魔界]: "魔界",
} as const;

function mapRoot(location: string): string {
  const colon = location.indexOf(":");
  return colon === -1 ? location : location.slice(0, colon);
}

function hasAny(location: string, terms: readonly string[]): boolean {
  return terms.some((term) => location.includes(term));
}

export function isSanzukawa(location: string): boolean {
  return hasAny(location, ["中有之道", "三途之川"]) || mapRoot(location).startsWith("三途");
}

export function isHigan(location: string): boolean {
  return hasAny(location, ["彼岸"]);
}

export function isMeikai(location: string): boolean {
  return hasAny(location, ["迷途之家", "迷い家", "白玉楼庭", "白玉楼"]) ||
    mapRoot(location).startsWith("冥界") ||
    mapRoot(location).startsWith("死神");
}

export function isKyuujigoku(location: string): boolean {
  const root = mapRoot(location);
  return root.startsWith("旧地狱") ||
    root.startsWith("旧地獄") ||
    root.startsWith("地底");
}

export function isJigoku(location: string): boolean {
  if (isKyuujigoku(location)) return false;
  return hasAny(location, ["畜生界", "霊長園", "灵长园"]) ||
    mapRoot(location).startsWith("地狱") ||
    mapRoot(location).startsWith("地獄");
}

export function isSenkai(location: string): boolean {
  return hasAny(location, ["天界", "神霊廟広場", "神霊廟道場", "神灵庙广场", "神灵庙道场", "仙人的宅邸"]);
}

export function isYumesekai(location: string): boolean {
  const root = mapRoot(location);
  return hasAny(location, ["槐安通路"]) || root.startsWith("梦") || root.startsWith("夢");
}

export function isTsukimiyako(location: string): boolean {
  if (isYumesekai(location)) return false;
  const root = mapRoot(location);
  return root.startsWith("月") || hasAny(location, ["月都", "月の都"]);
}

export function isMakai(location: string): boolean {
  return mapRoot(location).startsWith("魔界");
}

export function isAsamajouezan(location: string): boolean {
  return hasAny(location, ["浅间净秽山", "浅間浄穢山", "浅間净秽山"]);
}

/** Location string → weather-system region id. Asama has no upstream array
 * slot, so it maps to 通用 for arrays and is handled by location-aware flags. */
export function regionIdOfLocation(location: string): number {
  if (!location) return REGION_ID.通用;
  if (isSanzukawa(location)) return REGION_ID.三途;
  if (isHigan(location)) return REGION_ID.彼岸;
  if (isMeikai(location)) return REGION_ID.冥界;
  if (isKyuujigoku(location)) return REGION_ID.旧狱;
  if (isJigoku(location)) return REGION_ID.地狱;
  if (isSenkai(location)) return REGION_ID.天界;
  if (isYumesekai(location)) return REGION_ID.梦境;
  if (isTsukimiyako(location)) return REGION_ID.月都;
  if (isMakai(location)) return REGION_ID.魔界;
  return REGION_ID.通用;
}

export function regionName(region: number): string {
  return REGION_NAMES[region] ?? "通用";
}

export function masterRegionId(state: GameState): number {
  return regionIdOfLocation(state.master?.location ?? "");
}

export function isNoWeatherSee(region: number): boolean {
  return region === REGION_ID.彼岸 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.月都 ||
    region === REGION_ID.魔界;
}

export function isNoTimeSee(region: number): boolean {
  return region === REGION_ID.三途 ||
    region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.魔界;
}

export function isNoSun(region: number): boolean {
  return isNoTimeSee(region);
}

export function isNoRain(region: number): boolean {
  return region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.天界 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.月都 ||
    region === REGION_ID.魔界;
}

export function isNoWindVelocity(region: number): boolean {
  return region === REGION_ID.三途 ||
    region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.天界 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.月都;
}

export function isNoRainbow(region: number): boolean {
  return region === REGION_ID.三途 ||
    region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.魔界;
}

export function isNoWeatherChange(region: number): boolean {
  return region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.天界 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.月都 ||
    region === REGION_ID.魔界;
}

export function isNoWindChange(region: number): boolean {
  return region === REGION_ID.三途 ||
    region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.旧狱 ||
    region === REGION_ID.天界 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.月都 ||
    region === REGION_ID.魔界;
}

export function isNoSeasonChange(region: number): boolean {
  return region === REGION_ID.三途 ||
    region === REGION_ID.彼岸 ||
    region === REGION_ID.地狱 ||
    region === REGION_ID.天界 ||
    region === REGION_ID.梦境 ||
    region === REGION_ID.月都 ||
    region === REGION_ID.魔界;
}

export function isNoWeatherSeeLocation(location: string): boolean {
  return isNoWeatherSee(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoTimeSeeLocation(location: string): boolean {
  return isNoTimeSee(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoSunLocation(location: string): boolean {
  return isNoSun(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoRainLocation(location: string): boolean {
  return isNoRain(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoWindVelocityLocation(location: string): boolean {
  return isNoWindVelocity(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoRainbowLocation(location: string): boolean {
  return isNoRainbow(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoWeatherChangeLocation(location: string): boolean {
  return isNoWeatherChange(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoWindChangeLocation(location: string): boolean {
  return isNoWindChange(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoSeasonChangeLocation(location: string): boolean {
  return isNoSeasonChange(regionIdOfLocation(location)) || isAsamajouezan(location);
}

export function isNoWeatherSeeAt(state: GameState): boolean {
  return isNoWeatherSeeLocation(state.master?.location ?? "");
}

export function isNoRainAt(state: GameState): boolean {
  return isNoRainLocation(state.master?.location ?? "");
}

export function isNoTimeSeeAt(state: GameState): boolean {
  return isNoTimeSeeLocation(state.master?.location ?? "");
}
