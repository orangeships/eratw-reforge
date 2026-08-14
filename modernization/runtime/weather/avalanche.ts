/**
 * Avalanche helpers from `魔改内容/qol/qol_weather.ERB`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { WEATHER_ID } from "./constants.js";

export function qolPossibilityAvalancheSpring(state: GameState, weather: number): void {
  const w = ensureWeatherState(state);
  const snow = w.snowCoverage + w.continuousSnowfall;
  if (snow >= 15 && (w.powerWarmAir >= 3 || weather <= WEATHER_ID.雾 || weather === WEATHER_ID.暴雨)) {
    w.possibilityAvalanche = 2;
  } else if (
    snow >= 10
    && (w.powerWarmAir === 4 || weather === WEATHER_ID.雨 || weather === WEATHER_ID.大雨 || weather === WEATHER_ID.暴雨)
  ) {
    w.possibilityAvalanche = 2;
  } else if (snow >= 7 && (w.powerWarmAir >= 5 || weather === WEATHER_ID.大雨 || weather === WEATHER_ID.暴雨)) {
    w.possibilityAvalanche = 2;
  } else {
    w.possibilityAvalanche = 0;
  }
}

export function qolPossibilityAvalancheWinter(state: GameState): void {
  const w = ensureWeatherState(state);
  if (w.snowCoverage >= 15 && w.continuousSnowfall >= 10) {
    w.possibilityAvalanche = 1;
  } else if (w.snowCoverage >= 10 && w.continuousSnowfall >= 7 && w.windVelocity >= 1) {
    w.possibilityAvalanche = 1;
  } else if (w.snowCoverage >= 5 && w.continuousSnowfall >= 5 && w.windVelocity >= 2) {
    w.possibilityAvalanche = 1;
  } else {
    w.possibilityAvalanche = 0;
  }
}

export function qolPossibilityAvalancheWinterLow(state: GameState, weather: number): void {
  const w = ensureWeatherState(state);
  if (w.snowCoverage + w.continuousSnowfall >= 15 && (w.powerWarmAir === 4 || weather === WEATHER_ID.雨)) {
    w.possibilityAvalanche = 2;
  } else if (w.snowCoverage + w.continuousSnowfall >= 10 && (w.powerWarmAir >= 5 || weather === WEATHER_ID.大雨)) {
    w.possibilityAvalanche = 2;
  } else {
    qolPossibilityAvalancheWinter(state);
  }
}

export function qolNoAvalanche(state: GameState): void {
  const w = ensureWeatherState(state);
  w.continuousSnowfall = 0;
  w.snowCoverage = 0;
  w.possibilityAvalanche = 0;
}
