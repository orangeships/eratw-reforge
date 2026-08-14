/**
 * Weather S6 — regional weather arrays and current-region selectors.
 *
 * Port of `qol_REGION_CHANGE_WEATHER_SYSTEM`, `qol_SET_REGION_WEATHER`, and
 * the three `qol_FORCESET_REGION_*` helpers from
 * `魔改内容/qol/qol_weather.ERB:194-359`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState, REGION_ID } from "../state/weather-state.js";
import type { WeatherState } from "../state/weather-state.js";
import { weatherName } from "../state/weather.js";
import { COMMON_REGION, RAINBOW_ID, WEATHER_ID, WIND_ID } from "./constants.js";
import {
  isNoRainbowLocation,
  isNoWeatherSeeLocation,
  isNoWindVelocityLocation,
  regionIdOfLocation,
  regionName,
} from "./region-system.js";

export const RAINBOW_NAMES = ["无虹", "彩虹", "钻石尘", "流星", "流星群"] as const;
export const WIND_NAMES = ["无风", "强风", "暴风", "飓风"] as const;

export interface RegionWeatherSnapshot {
  regionId: number;
  regionName: string;
  location: string;
  weatherIndex: number;
  weatherName: string;
  rainbowIndex: number;
  rainbowName: string;
  windIndex: number;
  windName: string;
  weatherVisible: boolean;
  rainbowVisible: boolean;
  windVisible: boolean;
}

// The weather DISPLAY must always reflect the SIMULATED weather
// (`gensokyoWeatherSystem`), never the vestigial `weatherIndexApprox` formula —
// mixing the two decoupled the status-bar name from the ticked simulation
// (main line showed the approximation while the region detail showed the real
// state). When no weather has been simulated yet, fall back to the sim's own
// canonical default (少云 = 0, the `ensureWeatherState` fill value), so every
// display path agrees on the same value.
function commonWeatherFrom(_state: GameState, w?: WeatherState): number {
  if (!w) return WEATHER_ID.少云;
  return w.gensokyoWeatherSystem[COMMON_REGION] ?? WEATHER_ID.少云;
}

function commonRainbowFrom(w?: WeatherState): number {
  return w?.gensokyoRainbowSystem[COMMON_REGION] ?? RAINBOW_ID.无虹;
}

function commonWindFrom(w?: WeatherState): number {
  return w?.gensokyoWindVeSystem[COMMON_REGION] ?? w?.windVelocity ?? WIND_ID.无风;
}

function weatherForRegion(region: number, commonWeather: number): number {
  switch (region) {
    case REGION_ID.三途:
      return commonWeather === WEATHER_ID.雨 ||
        commonWeather === WEATHER_ID.大雨 ||
        commonWeather === WEATHER_ID.暴雨
        ? WEATHER_ID.雨
        : WEATHER_ID.雾;
    case REGION_ID.彼岸:
      return WEATHER_ID.阴;
    case REGION_ID.冥界:
      return commonWeather;
    case REGION_ID.地狱:
      return WEATHER_ID.雾;
    case REGION_ID.旧狱:
      return WEATHER_ID.阴;
    case REGION_ID.天界:
    case REGION_ID.梦境:
    case REGION_ID.月都:
      return WEATHER_ID.晴;
    case REGION_ID.魔界:
      return WEATHER_ID.阴;
    default:
      return commonWeather;
  }
}

function rainbowForRegion(region: number, commonRainbow: number): number {
  switch (region) {
    case REGION_ID.冥界:
    case REGION_ID.天界:
      return commonRainbow;
    case REGION_ID.月都:
      return commonRainbow === RAINBOW_ID.流星 || commonRainbow === RAINBOW_ID.流星群
        ? RAINBOW_ID.流星群
        : RAINBOW_ID.无虹;
    default:
      return region === REGION_ID.通用 ? commonRainbow : RAINBOW_ID.无虹;
  }
}

function windForRegion(region: number, commonWind: number): number {
  switch (region) {
    case REGION_ID.冥界:
      return commonWind;
    case REGION_ID.魔界:
      return WIND_ID.强风;
    default:
      return region === REGION_ID.通用 ? commonWind : WIND_ID.无风;
  }
}

function storedOrDerived(stored: number | undefined, derived: number): number {
  if (stored === undefined || stored === 0) return derived;
  return stored;
}

/** Refresh all 10 `GENSOKYO_*_SYSTEM` arrays from the current common weather. */
export function qolRegionChangeWeatherSystem(state: GameState): void {
  const w = ensureWeatherState(state);
  const commonWeather = commonWeatherFrom(state, w);
  const commonRainbow = commonRainbowFrom(w);
  const commonWind = commonWindFrom(w);

  for (let region = 0; region <= REGION_ID.魔界; region += 1) {
    w.gensokyoWeatherSystem[region] = weatherForRegion(region, commonWeather);
    w.gensokyoRainbowSystem[region] = rainbowForRegion(region, commonRainbow);
    w.gensokyoWindVeSystem[region] = windForRegion(region, commonWind);
  }
}

/** Pure selector for the weather at `location` without mutating GameState. */
export function currentRegionWeather(
  state: GameState,
  location = state.master.location,
): RegionWeatherSnapshot {
  const w = state.weather;
  const regionId = regionIdOfLocation(location);
  const commonWeather = commonWeatherFrom(state, w);
  const commonRainbow = commonRainbowFrom(w);
  const commonWind = commonWindFrom(w);
  const derivedWeather = weatherForRegion(regionId, commonWeather);
  const derivedRainbow = rainbowForRegion(regionId, commonRainbow);
  const derivedWind = windForRegion(regionId, commonWind);
  const weatherIndex = storedOrDerived(w?.gensokyoWeatherSystem[regionId], derivedWeather);
  const rainbowIndex = storedOrDerived(w?.gensokyoRainbowSystem[regionId], derivedRainbow);
  const windIndex = storedOrDerived(w?.gensokyoWindVeSystem[regionId], derivedWind);

  return {
    regionId,
    regionName: regionName(regionId),
    location,
    weatherIndex,
    weatherName: weatherName(weatherIndex),
    rainbowIndex,
    rainbowName: RAINBOW_NAMES[rainbowIndex] ?? RAINBOW_NAMES[RAINBOW_ID.无虹],
    windIndex,
    windName: WIND_NAMES[windIndex] ?? WIND_NAMES[WIND_ID.无风],
    weatherVisible: !isNoWeatherSeeLocation(location),
    rainbowVisible: !isNoRainbowLocation(location),
    windVisible: !isNoWindVelocityLocation(location),
  };
}

/** Modern equivalent of `qol_SET_REGION_WEATHER`: return the current-region
 * snapshot and sync `WIND_VELOCITY` so downstream weather effects see the
 * region wind just like upstream's scalar `WIND_VELOCITY`. */
export function qolSetRegionWeather(
  state: GameState,
  location = state.master.location,
): RegionWeatherSnapshot {
  qolRegionChangeWeatherSystem(state);
  const snapshot = currentRegionWeather(state, location);
  ensureWeatherState(state).windVelocity = snapshot.windIndex;
  return snapshot;
}

export function qolForceSetRegionWeatherSystem(
  state: GameState,
  weatherIndex: number,
  location = state.master.location,
): void {
  ensureWeatherState(state).gensokyoWeatherSystem[regionIdOfLocation(location)] = weatherIndex;
}

export function qolForceSetRegionRainbowSystem(
  state: GameState,
  rainbowIndex: number,
  location = state.master.location,
): void {
  ensureWeatherState(state).gensokyoRainbowSystem[regionIdOfLocation(location)] = rainbowIndex;
}

export function qolForceSetRegionWindVeSystem(
  state: GameState,
  windIndex: number,
  location = state.master.location,
): void {
  const w = ensureWeatherState(state);
  const region = regionIdOfLocation(location);
  w.gensokyoWindVeSystem[region] = windIndex;
  if (region === regionIdOfLocation(state.master.location)) {
    w.windVelocity = windIndex;
  }
}

export function formatRegionWeather(snapshot: RegionWeatherSnapshot): string {
  return snapshot.weatherVisible ? snapshot.weatherName : "天候不可知";
}

export function formatRegionRainbow(snapshot: RegionWeatherSnapshot): string {
  return snapshot.rainbowVisible ? snapshot.rainbowName : "天象不可知";
}

export function formatRegionWind(snapshot: RegionWeatherSnapshot): string {
  return snapshot.windVisible ? snapshot.windName : "风力不可知";
}
