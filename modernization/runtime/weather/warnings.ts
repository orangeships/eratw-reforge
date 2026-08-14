/**
 * Weather S5 — `GET_WEATHER_WARNING_*` (`天候予測システム.ERB:956-1160`): the six
 * weather advisories/warnings/special-warnings, faithful string predicates over
 * the `WeatherState` + the S3 low-pressure / cumulus / rainband / thunderstorm
 * locators.
 *
 * Each returns the eraTW warning STRING (e.g. "大雨特別警報" / "強風注意報" /
 * "大雨注意報未発令"). The "…未発令" (not-issued) tail is the ELSE fallthrough,
 * kept verbatim so the caller can test "is a warning active" as
 * `!endsWith("未発令")`.
 *
 * Dependencies (all present): WeatherState fields
 * (continuousRainfall/continuousSnowfall/snowCoverage/windVelocity/
 * possibilityAvalanche/powerWarmAir/powerColdAir/isTyphoon/isColdLow/
 * atmosphericInstability/nowTerm/timeEnterTerritory{ColdLow,LinerRainband}/
 * isLinerRainband/canCumulus/isColdCropDamage) + S3 locators
 * (getLocationLow / getLocationCumulus / getLocationLinerRainband /
 * getLocationAreaTyphoon / getHeatThunderstorm / getFrontalThunderstorm).
 *
 * `TIME:0` = minute-of-day, `TIME:5` = weather index, `DAY:2` = season,
 * `DAY:3` = date, `NOW_TERM` = `w.nowTerm`. WeatherDateTime = [season,date,min],
 * so `:1` = date (index 1), `:2` = minute (index 2).
 */

import type { GameState } from "../state/game-state.js";
import { getWeatherState } from "../state/weather-state.js";
import { seasonOf, dateOf } from "../world/calendar.js";
import { weatherIndexNow } from "../state/weather.js";
import {
  getLocationLow,
  getLocationCumulus,
  getLocationLinerRainband,
  getLocationAreaTyphoon,
} from "./low-pressure.js";
import { getHeatThunderstorm, getFrontalThunderstorm } from "./thunderstorm.js";

const SEASON_SPRING = 1;
const SEASON_SUMMER = 2;
const SEASON_AUTUMN = 3;
const SEASON_WINTER = 4;

// Weather indices used by the warnings (see WEATHER_NAMES).
const WEATHER_大雨 = 5;
const WEATHER_暴雨 = 14;

/** Common reads shared by the warning predicates. */
interface WarnCtx {
  w: ReturnType<typeof getWeatherState>;
  season: number;
  date: number;
  minuteOfDay: number;
  weather: number;
  low: string;
  cumulus: string;
  rainband: string;
  areaTyphoon: boolean;
}

function ctx(state: GameState): WarnCtx {
  const w = getWeatherState(state);
  return {
    w,
    season: seasonOf(state.time),
    date: dateOf(state.time),
    minuteOfDay: (((state.time.tickValue % 1440) + 1440) % 1440),
    weather: weatherIndexNow(state.time),
    low: getLocationLow(state),
    cumulus: getLocationCumulus(state),
    rainband: getLocationLinerRainband(state),
    areaTyphoon: getLocationAreaTyphoon(state),
  };
}

/** `@GET_WEATHER_WARNING_HEAVY_RAIN` — 大雨. */
export function getWeatherWarningHeavyRain(state: GameState): string {
  const { w, season, date, minuteOfDay, weather, low, cumulus, rainband, areaTyphoon } = ctx(state);
  const rb1 = w.timeEnterTerritoryLinerRainband;
  if (w.continuousRainfall >= 15) return "大雨特別警報";
  if (rainband === "線状降水帯勢力圏" && w.isLinerRainband[1] === 2) return "大雨特別警報";
  if (w.isTyphoon[1] >= 5 && w.isTyphoon[2] === 3 && w.powerWarmAir >= 5 && areaTyphoon) return "大雨特別警報";
  if (w.continuousRainfall >= 10) return "大雨警報(土砂災害警戒情報)";
  if (rainband === "線状降水帯勢力圏") return "大雨警報(土砂災害警戒情報)";
  if (rainband === "線状降水帯遠方" && w.isLinerRainband[1] === 2 && rb1[1] === date && rb1[2] <= minuteOfDay + 180)
    return "大雨警報(土砂災害警戒情報)";
  if ((areaTyphoon || low === "台風勢力圏") && w.isTyphoon[3] === 1) return "大雨警報";
  if (areaTyphoon) return "大雨警報";
  if (w.canCumulus[0] === 5 && (cumulus === "積乱雲視認" || cumulus === "積乱雲接近" || cumulus === "積乱雲直下"))
    return "大雨警報";
  if (w.canCumulus[0] === 4 && (cumulus === "積乱雲接近" || cumulus === "積乱雲直下")) return "大雨警報";
  if (w.continuousRainfall >= 5) return "大雨警報";
  if (rainband === "線状降水帯遠方" && w.isLinerRainband[1] === 2 && rb1[1] === date) return "大雨警報";
  if (weather === WEATHER_暴雨) return "大雨警報";
  if (rainband === "線状降水帯遠方" && rb1[1] === date && rb1[2] <= minuteOfDay + 180) return "大雨注意報";
  if (areaTyphoon || low === "台風勢力圏") return "大雨注意報";
  if (low === "寒冷渦接近" && season !== SEASON_WINTER && w.powerWarmAir !== 1) return "大雨注意報";
  if (w.continuousRainfall >= 1) return "大雨注意報";
  if (w.canCumulus[0] === 5 && cumulus === "積乱雲遠方") return "大雨注意報";
  if (w.canCumulus[0] === 4 && (cumulus === "積乱雲視認" || (cumulus === "積乱雲遠方" && minuteOfDay >= 720)))
    return "大雨注意報";
  if (w.canCumulus[0] === 3 && (cumulus === "積乱雲接近" || cumulus === "積乱雲直下")) return "大雨注意報";
  if (weather === WEATHER_大雨) return "大雨注意報";
  return "大雨注意報未発令";
}

/** `@GET_WEATHER_WARNING_HEAVY_SNOWFALL` — 大雪. */
export function getWeatherWarningHeavySnowfall(state: GameState): string {
  const { w, season, low } = ctx(state);
  if (w.continuousSnowfall >= 30) return "大雪特別警報";
  if (low === "二つ玉低気圧接近" || low === "疑似好天" || low === "二つ玉低気圧通過中") return "大雪警報";
  if (low === "日本海低気圧通過中") return "大雪警報";
  if (low === "寒冷渦接近" && (season === SEASON_WINTER || w.powerWarmAir === 1) && season !== SEASON_AUTUMN)
    return "大雪警報";
  if (w.continuousSnowfall >= 15) return "大雪警報";
  if (low === "日本海低気圧接近") return "大雪注意報";
  if (low === "南岸低気圧接近") return "大雪注意報";
  if (low === "寒冷渦遠方" && season === SEASON_WINTER) return "大雪注意報";
  if (w.continuousSnowfall >= 5) return "大雪注意報";
  return "大雪注意報未発令";
}

/** `@GET_WEATHER_WARNING_STORM` — 暴風・暴風雪. */
export function getWeatherWarningStorm(state: GameState): string {
  const { w, season, date, minuteOfDay, weather, low, areaTyphoon } = ctx(state);
  const cl = w.timeEnterTerritoryColdLow;
  const coldLowNear = low === "寒冷渦接近" || (low === "寒冷渦遠方" && cl[1] === date && cl[2] <= minuteOfDay + 180);
  if ((low === "疑似好天" || low === "二つ玉低気圧通過中") && w.powerColdAir >= 4 && w.powerWarmAir >= 5)
    return "暴風雪特別警報";
  if (w.windVelocity >= 3 && weather >= 8 && weather <= 12) return "暴風雪特別警報";
  if (w.isTyphoon[1] >= 5 && w.powerColdAir === 1 && w.powerWarmAir >= 5 && areaTyphoon) return "暴風特別警報";
  if (w.windVelocity >= 3) return "暴風特別警報";
  if (low === "疑似好天" || low === "二つ玉低気圧通過中") return "暴風雪警報";
  if (low === "日本海低気圧通過中" && w.powerColdAir >= 4) return "暴風雪警報";
  if (coldLowNear && (season === SEASON_WINTER || w.powerWarmAir === 1) && season !== SEASON_AUTUMN)
    return "暴風雪警報";
  if (w.windVelocity >= 2 && weather >= 8 && weather <= 12) return "暴風雪警報";
  if (areaTyphoon && w.isTyphoon[1] >= 3) return "暴風警報";
  if (coldLowNear) return "暴風警報";
  if (w.windVelocity >= 2) return "暴風警報";
  if (low === "二つ玉低気圧接近") return "風雪注意報";
  if (low === "日本海低気圧接近" && w.powerColdAir >= 4) return "風雪注意報";
  if (w.windVelocity >= 1 && weather >= 8 && weather <= 12) return "風雪注意報";
  if (areaTyphoon) return "強風注意報";
  if (
    (low === "温暖前線接近" || low === "暖域") &&
    (w.powerWarmAir >= 4 || (season === SEASON_SPRING && w.nowTerm === 1))
  )
    return "強風注意報";
  if (w.windVelocity >= 1) return "強風注意報";
  return "強風注意報未発令";
}

/** `@GET_WEATHER_WARNING_LIGHTNING` — 雷・竜巻. */
export function getWeatherWarningLightning(state: GameState): string {
  const { w, season, low, cumulus, rainband } = ctx(state);
  const heat = getHeatThunderstorm(state);
  const frontal = getFrontalThunderstorm(state);
  if (w.canCumulus[2] === 2 && (cumulus === "積乱雲接近" || cumulus === "積乱雲直下")) return "雷注意報(竜巻注意情報)";
  if (heat && frontal && w.atmosphericInstability <= -2) return "雷注意報(竜巻注意情報)";
  if (season === SEASON_SUMMER && (w.isColdLow !== 0 || low === "台風勢力圏")) return "雷注意報";
  if (w.canCumulus[0] === 3 && (cumulus === "積乱雲接近" || cumulus === "積乱雲直下")) return "雷注意報";
  if (rainband === "線状降水帯勢力圏") return "雷注意報";
  if (
    (season === SEASON_SPRING || season === SEASON_AUTUMN) &&
    (low === "寒冷前線通過" || low === "暖域") &&
    w.powerWarmAir >= 3 &&
    w.powerColdAir >= 4
  )
    return "雷注意報";
  if (heat) return "雷注意報";
  if (frontal) return "雷注意報";
  return "雷注意報未発令";
}

/** `@GET_WEATHER_WARNING_COLD` — 低温. `isColdCropDamage` is set by the crop-damage
 *  system (farming-gated → dormant until NOUMIN is built, so this reads 0). */
export function getWeatherWarningCold(state: GameState): string {
  const { w, season } = ctx(state);
  if (w.powerColdAir === 5 && season === SEASON_SPRING) return "低温注意報";
  if (w.isColdCropDamage >= 2) return "低温注意報";
  return "低温注意報未発令";
}

/** `@GET_WEATHER_WARNING_AVALANCHE` — なだれ (depends on the STORM warning). */
export function getWeatherWarningAvalanche(state: GameState): string {
  const { w, season } = ctx(state);
  const storm = getWeatherWarningStorm(state);
  if (w.possibilityAvalanche >= 1) return "なだれ注意報";
  if (season === SEASON_SPRING && w.nowTerm <= 2 && w.snowCoverage + w.continuousSnowfall >= 7)
    return "なだれ注意報";
  if (w.snowCoverage + w.continuousSnowfall >= 10) return "なだれ注意報";
  if (w.snowCoverage >= 15 && w.continuousSnowfall >= 6) return "なだれ注意報";
  if (w.snowCoverage >= 5 && w.continuousSnowfall >= 5 && storm !== "強風注意報未発令") return "なだれ注意報";
  return "なだれ注意報未発令";
}

/** True iff a warning string is an active advisory (not the "…未発令" fallthrough). */
export function isWarningActive(warning: string): boolean {
  return !warning.endsWith("未発令");
}

/** All six warnings for the current state, keyed by category. Active ones only
 *  (drops the "…未発令" fallthroughs) — the display/diary layer (S7) consumes this. */
export function activeWeatherWarnings(state: GameState): string[] {
  return [
    getWeatherWarningHeavyRain(state),
    getWeatherWarningHeavySnowfall(state),
    getWeatherWarningStorm(state),
    getWeatherWarningLightning(state),
    getWeatherWarningCold(state),
    getWeatherWarningAvalanche(state),
  ].filter(isWarningActive);
}
