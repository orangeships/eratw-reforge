/**
 * S3 low-pressure / cumulonimbus / linear-rainband location helpers.
 *
 * Ported from `天候予測システム.ERB:643-950`. Return strings intentionally
 * match upstream because S2 state machines branch on these labels.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import type { WeatherDateTime } from "../state/weather-state.js";
import type { Rng } from "../command/rng.js";
import {
  calculateAddTime,
  compareWeatherDateTime,
  currentWeatherDateTime,
  isBefore,
  isZeroDateTime,
  zeroDateTime,
} from "./calendar-math.js";

export type LowPressureLocation =
  | "台風遠方"
  | "台風勢力圏"
  | "台風接近強風域"
  | "台風接近暴風域"
  | "台風最接近"
  | "台風通過暴風域"
  | "台風通過強風域"
  | "台風一過"
  | "寒冷渦遠方"
  | "寒冷渦接近"
  | "寒冷渦通過"
  | "二つ玉低気圧遠方"
  | "二つ玉低気圧接近"
  | "疑似好天"
  | "二つ玉低気圧通過中"
  | "二つ玉低気圧通過"
  | "日本海低気圧遠方"
  | "日本海低気圧接近"
  | "日本海低気圧通過中"
  | "日本海低気圧通過"
  | "南岸低気圧遠方"
  | "南岸低気圧接近"
  | "南岸低気圧通過"
  | "温暖前線遠方"
  | "温暖前線接近"
  | "暖域"
  | "寒冷前線通過"
  | "温帯低気圧通過"
  | "低気圧未発生";

export type CumulusLocation =
  | "積乱雲視認"
  | "積乱雲接近"
  | "積乱雲直下"
  | "積乱雲通過"
  | "積乱雲遠方"
  | "積乱雲未発生";

export type LinerRainbandLocation =
  | "線状降水帯遠方"
  | "線状降水帯勢力圏"
  | "線状降水帯通過"
  | "線状降水帯未発生";

export function getLocationLow(state: GameState): LowPressureLocation {
  const w = ensureWeatherState(state);
  const now = currentWeatherDateTime(state);

  if (w.isTyphoon[0]) {
    if (isZeroDateTime(w.timeEnterTerritoryTyphoon)) {
      if (w.nowWeatherControl === 21) return "台風最接近";
      if (w.nowWeatherControl === 17) return "台風通過暴風域";
      if (w.isTyphoon[1] >= 3) return "台風接近暴風域";
      return "台風接近強風域";
    }
    if (beforeNow(now, w.timeEnterTerritoryTyphoon)) return "台風遠方";
    if (beforeNow(now, w.timeEnterWindZoneTyphoon)) return "台風勢力圏";
    if (w.isTyphoon[1] >= 3 && beforeNow(now, w.timeEnterStormAreaTyphoon)) return "台風接近強風域";
    if (w.isTyphoon[1] < 3 && beforeNow(now, w.timeClosestTyphoon)) return "台風接近強風域";
    if (w.isTyphoon[1] >= 3 && beforeNow(now, w.timeClosestTyphoon)) return "台風接近暴風域";
    if (beforeNow(now, w.timePassageEyeTyphoon)) return "台風最接近";
    if (w.isTyphoon[1] >= 3 && beforeNow(now, w.timePassageStormAreaTyphoon)) return "台風通過暴風域";
    if (beforeNow(now, w.timePassageWindZoneTyphoon)) return "台風通過強風域";
    return "台風一過";
  }

  if (w.isColdLow) {
    if (isZeroDateTime(w.timeEnterTerritoryColdLow)) return "寒冷渦接近";
    if (beforeNow(now, w.timeEnterTerritoryColdLow)) return "寒冷渦遠方";
    if (beforeNow(now, w.timePassageTerritoryColdLow)) return "寒冷渦接近";
    return "寒冷渦通過";
  }

  if (w.isSojLow === 2) {
    if (isZeroDateTime(w.timeEnterTerritorySojLow)) return "二つ玉低気圧接近";
    if (beforeNow(now, w.timeEnterTerritorySojLow)) return "二つ玉低気圧遠方";
    if (beforeNow(now, w.timeClosestSojLow)) return "二つ玉低気圧接近";
    if (beforeNow(now, w.timePassageFakeFine)) return "疑似好天";
    if (beforeNow(now, w.timePassageSojLow)) return "二つ玉低気圧通過中";
    return "二つ玉低気圧通過";
  }

  if (w.isSojLow === 1) {
    if (isZeroDateTime(w.timeEnterTerritorySojLow)) return "日本海低気圧接近";
    if (beforeNow(now, w.timeEnterTerritorySojLow)) return "日本海低気圧遠方";
    if (beforeNow(now, w.timeClosestSojLow)) return "日本海低気圧接近";
    if (beforeNow(now, w.timePassageSojLow)) return "日本海低気圧通過中";
    return "日本海低気圧通過";
  }

  if (w.isSouthernLow) {
    if (isZeroDateTime(w.timeEnterTerritorySouthernLow)) return "南岸低気圧接近";
    if (beforeNow(now, w.timeEnterTerritorySouthernLow)) return "南岸低気圧遠方";
    if (beforeNow(now, w.timePassageSouthernLow)) return "南岸低気圧接近";
    return "南岸低気圧通過";
  }

  if ((state.time.season === 1 || state.time.season === 3) && !w.isRainySeason1[0] && !w.isRainySeason2) {
    if (isZeroDateTime(w.timeEnterTerritoryExtratropicalLow)) return "低気圧未発生";
    if (beforeNow(now, w.timeEnterTerritoryExtratropicalLow)) return "温暖前線遠方";
    if (beforeNow(now, w.timePassageWarmFront)) return "温暖前線接近";
    if (beforeNow(now, w.timePassageColdFront)) return "暖域";
    if (beforeNow(now, w.timePassageExtratropicalLow)) return "寒冷前線通過";
    return "温帯低気圧通過";
  }

  return "低気圧未発生";
}

export function getLocationCumulus(state: GameState): CumulusLocation {
  const w = ensureWeatherState(state);
  const now = minuteOfDay(state);
  if (w.canCumulus[0] && w.canCumulus[1]) {
    if (w.timeEnterTerritoryCumulus > now) return "積乱雲視認";
    if (w.timeClosestCumulus > now) return "積乱雲接近";
    if (w.timePassageCumulus > now) return "積乱雲直下";
    return "積乱雲通過";
  }
  if (w.canCumulus[0]) return "積乱雲遠方";
  return "積乱雲未発生";
}

export function getLocationAreaTyphoon(state: GameState): boolean {
  const low = getLocationLow(state);
  return low === "台風接近強風域" ||
    low === "台風接近暴風域" ||
    low === "台風最接近" ||
    low === "台風通過暴風域" ||
    low === "台風通過強風域";
}

export function generateLinerRainband(
  state: GameState,
  rng: Rng,
  season = -1,
  date = -1,
  minute = 0,
): void {
  const w = ensureWeatherState(state);
  const baseSeason = season === -1 ? state.time.season ?? 1 : season;
  const baseDate = date === -1 ? state.time.date ?? 1 : date;

  w.isLinerRainband[0] = 1;
  let duration: number;
  if (rng.int(5) === 0) {
    w.isLinerRainband[1] = 2;
    duration = 420 + rng.int(300);
  } else {
    w.isLinerRainband[1] = 1;
    duration = 180 + rng.int(180);
  }

  const arrival = rng.int(60);
  w.timeEnterTerritoryLinerRainband = calculateAddTime(baseSeason, baseDate, minute, arrival);
  w.timePassageLinerRainband = calculateAddTime(baseSeason, baseDate, minute, arrival + duration);
}

export function getLocationLinerRainband(state: GameState): LinerRainbandLocation {
  const w = ensureWeatherState(state);
  const now = currentWeatherDateTime(state);
  if (w.isLinerRainband[0] >= 1) {
    if (beforeNow(now, w.timeEnterTerritoryLinerRainband)) return "線状降水帯遠方";
    if (beforeNow(now, w.timePassageLinerRainband)) return "線状降水帯勢力圏";
    return "線状降水帯通過";
  }
  return "線状降水帯未発生";
}

function beforeNow(now: WeatherDateTime, target: WeatherDateTime): boolean {
  return compareWeatherDateTime(target, now) > 0;
}

export function hasPassedCurrentSeason(state: GameState, target: WeatherDateTime): boolean {
  return target[0] !== 0 && target[0] < (state.time.season ?? 1);
}

export function clearDateTime(): WeatherDateTime {
  return zeroDateTime();
}

export function dateTimeBeforeCurrent(state: GameState, target: WeatherDateTime): boolean {
  return !isBefore(currentWeatherDateTime(state), target);
}

function minuteOfDay(state: GameState): number {
  return Math.max(0, Math.min(1439, state.time.hourOfDay * 60));
}
