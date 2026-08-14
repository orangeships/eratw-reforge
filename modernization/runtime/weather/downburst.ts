/**
 * `qol_DOWNBURST_GENERATION` from `魔改内容/qol/qol_weather.ERB:603-632`.
 *
 * Wind mutation remains here; the exact calm/strong → storm transition also
 * delegates its S5 crop-damage side effect, matching the upstream caller.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { WIND_ID } from "./constants.js";
import { qolWeatherChangeToCropStorm } from "./crop-damage.js";

export function qolDownburstGeneration(state: GameState, enabled = true): void {
  const w = ensureWeatherState(state);
  if (w.atmosphericInstability <= -2 && enabled) {
    const previousWind = w.windVelocity;
    w.windVelocity = WIND_ID.暴风;
    w.gensokyoWindVeSystem[0] = WIND_ID.暴风;
    // qol_DOWNBURST_GENERATION damages crops only when calm/strong wind first
    // becomes a storm; repeated ticks while already storming do not stack it.
    if (previousWind === WIND_ID.无风 || previousWind === WIND_ID.强风) {
      qolWeatherChangeToCropStorm(state);
    }
  } else {
    w.windVelocity = WIND_ID.强风;
    w.gensokyoWindVeSystem[0] = WIND_ID.强风;
  }
}
