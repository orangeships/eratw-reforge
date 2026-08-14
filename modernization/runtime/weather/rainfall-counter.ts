/**
 * `qol_CONTINUOUS_RAINFALL_COUNTER` from
 * `魔改内容/qol/qol_weather.ERB:588-600`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { WEATHER_ID } from "./constants.js";

export function qolContinuousRainfallCounter(state: GameState, weather: number): void {
  const w = ensureWeatherState(state);
  switch (weather) {
    case WEATHER_ID.少云:
    case WEATHER_ID.晴:
    case WEATHER_ID.多云:
      w.continuousRainfall = 0;
      return;
    case WEATHER_ID.大雨:
      w.continuousRainfall += 1;
      return;
    case WEATHER_ID.暴雨:
      w.continuousRainfall += 3;
      return;
    case WEATHER_ID.阴:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
    case WEATHER_ID.细雪:
    case WEATHER_ID.雾雪:
      w.continuousRainfall = Math.max(0, w.continuousRainfall - 1);
      return;
    default:
      return;
  }
}

