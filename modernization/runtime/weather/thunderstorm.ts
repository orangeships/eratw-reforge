/**
 * S3 thunderstorm predicates from `天候予測システム.ERB:1200-1277`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { FLAG_ID } from "../state/settlement.js";
import { COMMON_REGION, WEATHER_ID } from "./constants.js";
import {
  getLocationCumulus,
  getLocationLinerRainband,
  getLocationLow,
} from "./low-pressure.js";

export function getHeatThunderstorm(state: GameState): boolean {
  const w = ensureWeatherState(state);
  const low = getLocationLow(state);
  const rainband = getLocationLinerRainband(state);
  const cumulus = getLocationCumulus(state);
  const season = state.time.season ?? 1;

  if (rainband === "線状降水帯勢力圏") return true;
  if (cumulus === "積乱雲直下") {
    if (w.canCumulus[0] === 3 && w.atmosphericInstability <= -3) return true;
    return w.canCumulus[0] >= 4;
  }
  if (cumulus === "積乱雲接近") {
    if (w.canCumulus[0] === 4 && w.atmosphericInstability <= -7) return true;
    return w.canCumulus[0] >= 5;
  }
  if (w.isTyphoon[3] === 1 && low === "台風勢力圏" && w.atmosphericInstability <= -1) return true;
  if ((w.isRainySeason1[0] === 1 || w.isRainySeason2 === 1) && w.powerWarmAir >= 4 && w.atmosphericInstability <= 0) return true;
  if (
    (season === 1 || season === 3) &&
    (low === "温暖前線接近" || low === "寒冷前線通過" || low === "寒冷渦接近") &&
    w.powerWarmAir >= 5 &&
    w.atmosphericInstability <= -1
  ) {
    return true;
  }
  return false;
}

export function getFrontalThunderstorm(state: GameState): boolean {
  const w = ensureWeatherState(state);
  const low = getLocationLow(state);
  const season = state.time.season ?? 1;

  if ((season === 1 || season === 3) && (low === "寒冷前線通過" || low === "寒冷渦接近") && w.powerWarmAir >= 3 && w.powerColdAir >= 4) {
    return true;
  }
  if (w.isRainySeason1[1] === 1) return true;
  if (w.isRainySeason1[0] === 1 && w.powerColdAir >= 4) return true;
  if ((low === "二つ玉低気圧接近" || low === "二つ玉低気圧通過中") && w.powerWarmAir >= 3 && w.powerColdAir >= 3) {
    return true;
  }
  if ((low === "日本海低気圧接近" || low === "日本海低気圧通過中") && w.powerWarmAir >= 3 && w.powerColdAir >= 3) {
    return true;
  }
  return false;
}

export function getWeatherThunderstorm(state: GameState): boolean {
  const w = ensureWeatherState(state);
  const weather = w.gensokyoWeatherSystem[COMMON_REGION] ?? WEATHER_ID.少云;
  const abnormal = state.flagStore[FLAG_ID.異常気象] ?? 0;
  return (getHeatThunderstorm(state) || getFrontalThunderstorm(state)) &&
    weather !== WEATHER_ID.晴 &&
    (abnormal === 0 || abnormal === 9 || abnormal === 10) &&
    !w.forbiddenChangeWeather;
}
