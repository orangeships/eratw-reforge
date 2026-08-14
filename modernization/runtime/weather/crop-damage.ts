/**
 * Weather S5 — crop damage for the **kitchen garden** (家庭菜園 COMF418).
 *
 * Originally ported from `魔改内容/qol/qol_weather.ERB:544-590` and gated on
 * `FLAG:地主 > 0` (the NOUMIN landlord-farming subsystem).  Since the landlord
 * economy is not wanted, the weather effects are now applied directly to the
 * kitchen-garden plots (`state/farm.ts`), one plot at a time, so a small
 * home garden feels the seasons just as much as a big field would.
 *
 * Effects, now per‑plot:
 *   - Warm air (3‑4) in spring/autumn            →  grow +1
 *   - Cold air (5) in spring                     →  grow −1  (+ counter)
 *   - 梅雨 early (term 1‑2, summer)              →  grow +2
 *   - 梅雨 mid  (term 4, summer)                 →  grow −1
 *   - 梅雨 late (term 5‑6, summer)               →  grow −2  (+ cold counter)
 *   - Continuous rain ≥ 20 days + RNG hit        →  all planted plots wither
 *   - Storm / downburst                          →  grow −2  (+ storm counter)
 *
 * The three damage counters (`amountColdCropDamage` / `isColdCropDamage` /
 * `isStormCropDamage` / `isFloodCropDamage`) are still maintained so that
 * weather warnings (S5) continue to fire when the garden is under stress.
 */

import type { GameState } from "../state/game-state.js";
import type { Rng } from "../command/rng.js";
import { getFarm } from "../state/farm.js";
import { getWeatherState } from "../state/weather-state.js";
import { seasonOf } from "../world/calendar.js";

const SEASON_SPRING = 1;
const SEASON_SUMMER = 2;
const SEASON_AUTUMN = 3;

/** True when any kitchen-garden plot has a planted crop. */
export function hasPlantedCrops(state: GameState): boolean {
  return state.farm?.some((p) => p.type > 0) ?? false;
}

/**
 * Clamp a plot's grow to [0, 10] (upstream grow never goes negative and
 * `grow > 10` = withered).  Mutates the plot.
 */
function clampGrow(plot: { grow: number }): void {
  if (plot.grow < 0) plot.grow = 0;
  if (plot.grow > 10) plot.grow = 10;
}

/**
 * `@qol_WEATHER_FORECAST_1TERM_TO_CROP` — per‑term weather effects on the
 * kitchen garden.  Mutates each planted plot's `grow` / `dry` and the
 * weather‑state damage counters.  No‑op when nothing is planted.
 */
export function qolWeatherForecast1TermToCrop(state: GameState, rng: Rng): void {
  if (!hasPlantedCrops(state)) return;
  const farm = getFarm(state);

  const w = getWeatherState(state);
  const season = seasonOf(state.time);
  const term = w.nowTerm;

  // ── 寒気・暖気 ──
  if ((w.powerWarmAir === 3 || w.powerWarmAir === 4) &&
      (season === SEASON_SPRING || season === SEASON_AUTUMN)) {
    for (const plot of farm) {
      if (plot.type <= 0) continue;
      plot.grow += 1;
      clampGrow(plot);
    }
  } else if (w.powerColdAir === 5 && season === SEASON_SPRING) {
    for (const plot of farm) {
      if (plot.type <= 0) continue;
      plot.grow -= 1;
      clampGrow(plot);
    }
    w.amountColdCropDamage += 10;
  }

  // ── 梅雨（summer + isRainySeason1[0] == 1）──
  if (season === SEASON_SUMMER && w.isRainySeason1[0] === 1) {
    if (term === 1 || term === 2) {
      for (const plot of farm) {
        if (plot.type <= 0) continue;
        plot.grow += 2;
        clampGrow(plot);
      }
    } else if (term === 4) {
      for (const plot of farm) {
        if (plot.type <= 0) continue;
        plot.grow -= 1;
        clampGrow(plot);
      }
    } else if (term === 5 || term === 6) {
      for (const plot of farm) {
        if (plot.type <= 0) continue;
        plot.grow -= 2;
        clampGrow(plot);
      }
      w.isColdCropDamage += 1;
    }
  }

  // ── 連続降水 20+ → possible flood ──
  if (w.continuousRainfall >= 20) {
    const denom = Math.max(1, Math.trunc((40 - w.continuousRainfall) / 5));
    if (rng.int(denom) === 0) {
      w.isFloodCropDamage = 1;
      for (const plot of farm) {
        if (plot.type <= 0) continue;
        plot.dry = 5; // withers the plot
      }
    }
  }
}

/**
 * `@qol_WEATHER_CHANGE_TO_CROP("STORM")` — a storm / downburst hitting the
 * garden: each planted plot grow −2, `IS_STORM_CROP_DAMAGE++`.
 * No‑op when nothing is planted.
 */
export function qolWeatherChangeToCropStorm(state: GameState): void {
  if (!hasPlantedCrops(state)) return;
  const farm = getFarm(state);

  const w = getWeatherState(state);
  for (const plot of farm) {
    if (plot.type <= 0) continue;
    plot.grow -= 2;
    clampGrow(plot);
  }
  w.isStormCropDamage += 1;
}
