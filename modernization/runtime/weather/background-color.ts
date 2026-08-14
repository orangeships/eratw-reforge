/**
 * Weather S6 — map background color selector.
 *
 * Port of `@SET_MAP_WEATHER_BGCOLOR`
 * (`天候予測システム.ERB:1367-1539`) as a pure CSS-color selector. The UI reads
 * this through `weatherBackgroundStyle` and applies it as CSS variables.
 */

import type { GameState } from "../state/game-state.js";
import type { WeatherState } from "../state/weather-state.js";
import { FLAG_ID } from "../state/settlement.js";
import { WEATHER_ID } from "./constants.js";
import { currentRegionWeather } from "./region-override.js";
import {
  isHigan,
  isJigoku,
  isKyuujigoku,
  isMakai,
  isSanzukawa,
  isTsukimiyako,
  isYumesekai,
} from "./region-system.js";

export const WEATHER_MAP_COLORS = {
  sunsetNormal: "#191000",
  sunsetLowPressure: "#2e0e00",
  sunsetTyphoon: "#2e0100",
  fineEarlyMorning: "#001919",
  fineMorning: "#0a0900",
  fineDay: "#001d1f",
  cloudyDay: "#091a1b",
  overcastDay: "#141414",
  rainDay: "#0d162b",
  snowDay: "#242424",
  fogDay: "#303030",
  cumulonimbusDay: "#000000",
  fineNight: "#030024",
  overcastNight: "#000000",
  snowNight: "#242424",
  fogNight: "#303030",
} as const;

type WeatherMapColor = typeof WEATHER_MAP_COLORS[keyof typeof WEATHER_MAP_COLORS];

function isFog(weather: number): boolean {
  return weather === WEATHER_ID.雾雨 || weather === WEATHER_ID.雾 || weather === WEATHER_ID.雾雪;
}

function isSnow(weather: number): boolean {
  return weather === WEATHER_ID.雪 ||
    weather === WEATHER_ID.大雪 ||
    weather === WEATHER_ID.细雪 ||
    weather === WEATHER_ID.雨夹雪;
}

function isRain(weather: number): boolean {
  return weather === WEATHER_ID.雨 ||
    weather === WEATHER_ID.大雨 ||
    weather === WEATHER_ID.冰霰 ||
    weather === WEATHER_ID.暴雨 ||
    weather === WEATHER_ID.冰雹;
}

function minuteOfDay(state: GameState): number {
  return ((state.time.tickValue % 1440) + 1440) % 1440;
}

function hasTyphoonAura(w?: WeatherState): boolean {
  if (!w) return false;
  return (w.isTyphoon[0] ?? 0) !== 0 &&
    (w.nowWeatherControl === 16 || w.nowWeatherControl === 17 || w.nowWeatherControl === 21);
}

function hasLowPressureAura(w?: WeatherState): boolean {
  if (!w) return false;
  return w.isColdLow !== 0 ||
    w.isSojLow !== 0 ||
    w.isSouthernLow !== 0 ||
    w.nowWeatherControl === 2 ||
    w.nowWeatherControl === 5 ||
    w.nowWeatherControl === 10 ||
    w.nowWeatherControl === 12;
}

function hasCumulonimbusAura(w: WeatherState | undefined, minute: number): boolean {
  if (!w || w.canCumulus[0] <= 0) return false;
  if (w.canCumulus[1]) return true;
  if (w.timeEnterTerritoryCumulus === 0 && w.timePassageCumulus === 0) return false;
  return minute >= w.timeEnterTerritoryCumulus && minute <= w.timePassageCumulus;
}

function dawnOrDuskColor(w?: WeatherState): WeatherMapColor {
  if (hasTyphoonAura(w)) return WEATHER_MAP_COLORS.sunsetTyphoon;
  if (hasLowPressureAura(w)) return WEATHER_MAP_COLORS.sunsetLowPressure;
  return WEATHER_MAP_COLORS.fineMorning;
}

export function weatherBackgroundColorFor(
  weatherIndex: number,
  minute: number,
  location: string,
  w?: WeatherState,
): WeatherMapColor {
  let nextColor: WeatherMapColor;

  if (minute >= 240 && minute <= 359) {
    if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogNight;
    else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowNight;
    else nextColor = WEATHER_MAP_COLORS.fineEarlyMorning;
  } else if (minute >= 360 && minute <= 479) {
    if (weatherIndex <= WEATHER_ID.阴) nextColor = dawnOrDuskColor(w);
    else if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogDay;
    else if (isRain(weatherIndex)) nextColor = WEATHER_MAP_COLORS.rainDay;
    else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowDay;
    else nextColor = WEATHER_MAP_COLORS.fineMorning;
  } else if (minute >= 480 && minute <= 719) {
    if (weatherIndex === WEATHER_ID.少云 || weatherIndex === WEATHER_ID.晴 || weatherIndex === WEATHER_ID.多云) {
      nextColor = WEATHER_MAP_COLORS.fineMorning;
    } else if (weatherIndex === WEATHER_ID.阴) nextColor = WEATHER_MAP_COLORS.overcastDay;
    else if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogDay;
    else if (isRain(weatherIndex)) nextColor = WEATHER_MAP_COLORS.rainDay;
    else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowDay;
    else nextColor = WEATHER_MAP_COLORS.fineMorning;
  } else if (minute >= 720 && minute <= 1079) {
    if (hasCumulonimbusAura(w, minute)) {
      nextColor = weatherIndex === WEATHER_ID.阴 ||
        weatherIndex === WEATHER_ID.雨 ||
        weatherIndex === WEATHER_ID.大雨
        ? WEATHER_MAP_COLORS.cumulonimbusDay
        : WEATHER_MAP_COLORS.overcastDay;
    } else if (weatherIndex === WEATHER_ID.少云 || weatherIndex === WEATHER_ID.晴) {
      nextColor = WEATHER_MAP_COLORS.fineDay;
    } else if (weatherIndex === WEATHER_ID.多云) nextColor = WEATHER_MAP_COLORS.cloudyDay;
    else if (weatherIndex === WEATHER_ID.阴) nextColor = WEATHER_MAP_COLORS.overcastDay;
    else if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogDay;
    else if (isRain(weatherIndex)) nextColor = WEATHER_MAP_COLORS.rainDay;
    else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowDay;
    else nextColor = WEATHER_MAP_COLORS.fineDay;
  } else if (minute >= 1080 && minute <= 1199) {
    if (weatherIndex <= WEATHER_ID.阴) {
      const dusk = dawnOrDuskColor(w);
      nextColor = dusk === WEATHER_MAP_COLORS.fineMorning ? WEATHER_MAP_COLORS.sunsetNormal : dusk;
    } else if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogDay;
    else if (isRain(weatherIndex)) nextColor = WEATHER_MAP_COLORS.rainDay;
    else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowDay;
    else nextColor = WEATHER_MAP_COLORS.sunsetNormal;
  } else if (weatherIndex === WEATHER_ID.少云 || weatherIndex === WEATHER_ID.晴 || weatherIndex === WEATHER_ID.多云) {
    nextColor = WEATHER_MAP_COLORS.fineNight;
  } else if (isFog(weatherIndex)) nextColor = WEATHER_MAP_COLORS.fogNight;
  else if (weatherIndex === WEATHER_ID.阴 || isRain(weatherIndex)) nextColor = WEATHER_MAP_COLORS.overcastNight;
  else if (isSnow(weatherIndex)) nextColor = WEATHER_MAP_COLORS.snowNight;
  else nextColor = WEATHER_MAP_COLORS.fineNight;

  if (isSanzukawa(location)) return WEATHER_MAP_COLORS.fogDay;
  if (isHigan(location)) return WEATHER_MAP_COLORS.sunsetNormal;
  if (isJigoku(location)) return WEATHER_MAP_COLORS.sunsetTyphoon;
  if (isKyuujigoku(location)) return WEATHER_MAP_COLORS.fineNight;
  if (isYumesekai(location)) return WEATHER_MAP_COLORS.fineNight;
  if (isTsukimiyako(location)) return WEATHER_MAP_COLORS.fineNight;
  if (isMakai(location)) return WEATHER_MAP_COLORS.fineNight;

  return nextColor;
}

export function weatherBackgroundColor(state: GameState): WeatherMapColor | null {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return null;
  if (state.flagStore[FLAG_ID.背景色推移] === 0) return null;
  const snapshot = currentRegionWeather(state);
  return weatherBackgroundColorFor(snapshot.weatherIndex, minuteOfDay(state), snapshot.location, state.weather);
}

function rgbTriplet(hex: string): string {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

export function weatherBackgroundStyle(state: GameState): Record<string, string> {
  const color = weatherBackgroundColor(state);
  if (!color) return {};
  return {
    "--era-weather-bg": color,
    "--era-weather-bg-rgb": rgbTriplet(color),
  };
}
