/**
 * Spring snow accumulation helper from
 * `魔改内容/qol/qol_weather.ERB:635-679`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { WEATHER_ID } from "./constants.js";

function flushContinuousSnowfall(w: ReturnType<typeof ensureWeatherState>): boolean {
  if (w.continuousSnowfall < 1) return false;
  w.snowCoverage = w.continuousSnowfall;
  w.continuousSnowfall = 0;
  return true;
}

export function qolContinuousSnowfallCounterSpring(state: GameState, weather: number): void {
  const w = ensureWeatherState(state);
  switch (weather) {
    case WEATHER_ID.少云:
    case WEATHER_ID.晴:
    case WEATHER_ID.多云:
    case WEATHER_ID.阴:
    case WEATHER_ID.雾:
      if (flushContinuousSnowfall(w)) {
        w.snowCoverage = Math.max(0, w.snowCoverage - 3);
      } else {
        w.snowCoverage = Math.max(0, w.snowCoverage - 4);
      }
      return;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.暴雨:
      if (flushContinuousSnowfall(w)) {
        w.snowCoverage = Math.max(0, w.snowCoverage - 8);
      } else {
        w.snowCoverage = Math.max(0, w.snowCoverage - 10);
      }
      return;
    case WEATHER_ID.雪:
      flushContinuousSnowfall(w);
      w.snowCoverage += 1;
      return;
    case WEATHER_ID.大雪:
      flushContinuousSnowfall(w);
      w.snowCoverage += 3;
      return;
    default:
      flushContinuousSnowfall(w);
      return;
  }
}

/**
 * Winter snow accumulation helper from
 * `魔改内容/qol/qol_weather.ERB:694-726`.
 */
export function qolContinuousSnowfallCounterWinter(state: GameState, weather: number): void {
  const w = ensureWeatherState(state);
  switch (weather) {
    case WEATHER_ID.少云:
    case WEATHER_ID.晴:
    case WEATHER_ID.多云:
      if (flushContinuousSnowfall(w)) {
        w.snowCoverage = Math.max(0, w.snowCoverage - 1);
      } else {
        w.snowCoverage = Math.max(0, w.snowCoverage - 3);
      }
      return;
    case WEATHER_ID.阴:
      if (!flushContinuousSnowfall(w)) {
        w.snowCoverage = Math.max(0, w.snowCoverage - 1);
      }
      return;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.暴雨:
      if (flushContinuousSnowfall(w)) {
        w.snowCoverage = Math.max(0, w.snowCoverage - 4);
      } else {
        w.snowCoverage = Math.max(0, w.snowCoverage - 6);
      }
      return;
    case WEATHER_ID.雪:
      w.continuousSnowfall += 1;
      return;
    case WEATHER_ID.大雪:
      w.continuousSnowfall += 3;
      return;
    default:
      return;
  }
}
