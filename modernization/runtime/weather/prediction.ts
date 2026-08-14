/**
 * S3 weather prediction state machines.
 *
 * Ported from `天候予測システム.ERB:94-638`:
 *   - `WEATHER_FORECAST_1YEAR`
 *   - `WEATHER_FORECAST_1TERM`
 *   - `WEATHER_FORECAST_1DAY`
 *
 * Text output is S7 scope. Term-boundary crop effects are delegated to the S5
 * kitchen-garden adapter after the forecast state is updated.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import type { WeatherDateTime } from "../state/weather-state.js";
import type { Rng } from "../command/rng.js";
import { getTerm } from "../state/weather.js";
import {
  calculateAddTerm,
  calculateAddTime,
  currentWeatherDateTime,
  zeroDateTime,
} from "./calendar-math.js";
import {
  dateTimeBeforeCurrent,
  generateLinerRainband,
  getLocationLinerRainband,
  getLocationLow,
} from "./low-pressure.js";
import { qolWeatherForecast1TermToCrop } from "./crop-damage.js";

export function weatherForecast1Year(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  switch (w.yearWeatherControl) {
    case 4:
      w.yearWeatherControl = 1;
      break;
    case 3:
      w.yearWeatherControl = 4;
      break;
    case 2:
      w.yearWeatherControl = 3;
      break;
    default:
      w.yearWeatherControl = rng.int(4) === 0 ? 2 : 1;
      break;
  }
}

export function weatherForecast1Term(state: GameState, rng: Rng): boolean {
  const w = ensureWeatherState(state);
  if (w.yearWeatherControl <= 0) weatherForecast1Year(state, rng);

  const season = state.time.season ?? 1;
  const date = state.time.date ?? 1;
  const term = getTerm(date);
  if (w.nowTerm === term) return false;

  w.nowTerm = term;

  enterRainySeasons(state);
  rollAirPower(state, rng);
  leaveRainySeasons(state, rng);
  updateColdLow(state, rng);
  clearWinterLows(w);
  clearTyphoonIfExpired(state);
  clearLinerRainbandIfExpired(state);
  extendWanderingTyphoonIfNeeded(state, rng);
  maybeGenerateTyphoon(state, rng);
  maybeGenerateLinerRainbandFromColdLow(state, rng);
  maybeGenerateWinterLow(state, rng);
  updateExtratropicalLow(state, rng, season);

  // Upstream WEATHER_FORECAST_1TERM applies crop effects only after the
  // term actually changes.  The kitchen-garden adapter keeps this as the
  // low-frequency seasonal/extreme-weather layer; runYasaiTick remains the
  // ordinary nightly growth/moisture settlement.
  qolWeatherForecast1TermToCrop(state, rng);

  return true;
}

export function weatherForecast1Day(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  if (w.yearWeatherControl <= 0) weatherForecast1Year(state, rng);

  w.forbiddenChangeWeather = 0;
  w.canStratus = 0;
  w.atmosphericInstability = 0;
  clearCumulus(w);

  if (!w.isColdLow && !w.isTyphoon[0] && !w.isSojLow && !w.isSouthernLow && rng.int(10) === 0) {
    w.canStratus = 1;
  }

  w.atmosphericInstability = rng.int(Math.max(1, 8 - w.powerWarmAir)) + (7 - w.powerWarmAir - w.powerColdAir);
  if ((state.time.season ?? 1) === 2 && (w.isColdLow || getLocationLow(state) === "台風勢力圏")) {
    w.atmosphericInstability -= 6;
  }

  if (
    w.atmosphericInstability <= -2 &&
    w.isLinerRainband[0] === 0 &&
    rng.int(Math.max(1, 13 + w.atmosphericInstability)) === 0 &&
    (state.time.season ?? 1) !== 4
  ) {
    generateLinerRainband(state, rng, state.time.season ?? 1, state.time.date ?? 1, rng.int(1320));
  }

  updateCumulus(state, rng);
}

function enterRainySeasons(state: GameState): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;

  if (season === 1 && w.nowTerm === 6) {
    w.isRainySeason1[0] = 1;
  } else if (season === 3 && w.nowTerm === 1) {
    w.isRainySeason2 = 1;
  }
}

function leaveRainySeasons(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;

  if (w.isRainySeason1[0] === 1 && w.powerWarmAir >= 3 && w.isRainySeason1[1] !== 1) {
    w.isRainySeason1[1] = 1;
    if (w.powerWarmAir === 5 && rng.int(5) === 0 && w.isLinerRainband[0] === 0) {
      const t = calculateAddTime(season, state.time.date ?? 1, minuteOfDay(state), rng.int(4200));
      generateLinerRainband(state, rng, t[0], t[1], t[2]);
    }
  } else if (w.isRainySeason1[0] === 1 && season === 3 && w.nowTerm === 1) {
    w.isRainySeason1 = [0, 0];
  } else if (w.isRainySeason1[1] === 1) {
    w.isRainySeason1 = [0, 0];
  } else if (season === 3 && w.nowTerm === 2) {
    w.isRainySeason2 = 0;
  }
}

function rollAirPower(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;
  switch (w.yearWeatherControl) {
    case 3:
      if (season === 2) {
        w.powerColdAir = Math.min(rng.int(5) + 2, 5);
        w.powerWarmAir = Math.min(rng.int(5) + 2, 5);
      } else if (season === 4) {
        w.powerColdAir = Math.min(rng.int(5) + 2, 5);
        w.powerWarmAir = rng.int(5) + 1;
      } else {
        w.powerColdAir = rng.int(5) + 1;
        w.powerWarmAir = Math.min(rng.int(5) + 2, 5);
      }
      break;
    case 2:
      if (season === 4) {
        w.powerColdAir = Math.max(rng.int(5), 1);
        w.powerWarmAir = Math.min(rng.int(5) + 2, 5);
      } else {
        w.powerColdAir = rng.int(5) + 1;
        w.powerWarmAir = Math.max(rng.int(5), 1);
      }
      break;
    default:
      w.powerColdAir = rng.int(5) + 1;
      w.powerWarmAir = rng.int(5) + 1;
      break;
  }
}

function updateColdLow(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  if (!w.isRainySeason1[0] && !w.isRainySeason2 && w.powerColdAir === 5) {
    w.isColdLow = 1;
    w.timeEnterTerritoryColdLow = [state.time.season ?? 1, (state.time.date ?? 1) + rng.int(2), rng.int(1440)];
    w.timePassageTerritoryColdLow = calculateAddTime(...w.timeEnterTerritoryColdLow, 2880);
  } else {
    w.isColdLow = 0;
    w.timeEnterTerritoryColdLow = zeroDateTime();
    w.timePassageTerritoryColdLow = zeroDateTime();
  }
}

function clearWinterLows(w: ReturnType<typeof ensureWeatherState>): void {
  if (w.isSojLow >= 1) {
    w.isSojLow = 0;
    w.timeEnterTerritorySojLow = zeroDateTime();
    w.timeClosestSojLow = zeroDateTime();
    w.timePassageFakeFine = zeroDateTime();
    w.timePassageSojLow = zeroDateTime();
  }
  if (w.isSouthernLow === 1) {
    w.isSouthernLow = 0;
    w.timeEnterTerritorySouthernLow = zeroDateTime();
    w.timePassageSouthernLow = zeroDateTime();
  }
}

function clearTyphoonIfExpired(state: GameState): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;
  const location = getLocationLow(state);
  if (
    w.isTyphoon[0] === 1 &&
    (season === 1 ||
      (season === 3 && w.nowTerm >= 4) ||
      season === 4 ||
      w.timePassageWindZoneTyphoon[0] < season ||
      location === "台風一過")
  ) {
    w.isTyphoon = [0, 0, 0, 0];
    w.timeEnterTerritoryTyphoon = zeroDateTime();
    w.timeEnterWindZoneTyphoon = zeroDateTime();
    w.timeClosestTyphoon = zeroDateTime();
    w.timePassageEyeTyphoon = zeroDateTime();
    w.timePassageWindZoneTyphoon = zeroDateTime();
    w.timeEnterStormAreaTyphoon = zeroDateTime();
    w.timePassageStormAreaTyphoon = zeroDateTime();
  }
}

function clearLinerRainbandIfExpired(state: GameState): void {
  const w = ensureWeatherState(state);
  if (
    w.isLinerRainband[0] >= 1 &&
    (w.timePassageLinerRainband[0] < (state.time.season ?? 1) || getLocationLinerRainband(state) === "線状降水帯通過")
  ) {
    w.isLinerRainband = [0, 0];
    w.timeEnterTerritoryLinerRainband = zeroDateTime();
    w.timePassageLinerRainband = zeroDateTime();
  }
}

function extendWanderingTyphoonIfNeeded(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  if (!w.isTyphoon[0] || !w.isColdLow) return;
  const extend = 720 + rng.int(360);
  w.timePassageWindZoneTyphoon = calculateAddTime(...w.timePassageWindZoneTyphoon, extend);
  if (w.isTyphoon[1] >= 3) {
    w.timePassageStormAreaTyphoon = calculateAddTime(...w.timePassageStormAreaTyphoon, 720 + rng.int(360));
  }
}

function maybeGenerateTyphoon(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;
  if (!((season === 2 || (season === 3 && w.nowTerm <= 2)) && w.powerWarmAir === 5 && !w.isTyphoon[0])) return;

  w.isTyphoon[0] = 1;
  w.isTyphoon[1] = rng.int(5) + 1;
  w.isTyphoon[2] = rng.int(3) + 1;
  if (rng.int(5) === 0) w.isTyphoon[3] = 1;

  const positionMultiplier = w.isTyphoon[2] === 1 ? 7 : w.isTyphoon[2] === 2 ? 10 : 9;
  const nextTerm = calculateAddTerm(season, w.nowTerm, 1);
  w.timeEnterTerritoryTyphoon = [nextTerm[0], (nextTerm[1] - 1) * 5 + 1, rng.int(1440)];
  w.timeEnterWindZoneTyphoon = calculateAddTime(...w.timeEnterTerritoryTyphoon, 2880);

  if (w.isTyphoon[1] >= 3) {
    w.timeEnterStormAreaTyphoon = calculateAddTime(...w.timeEnterWindZoneTyphoon, Math.trunc((360 * positionMultiplier) / 10));
    w.timePassageStormAreaTyphoon = calculateAddTime(...w.timeEnterWindZoneTyphoon, Math.trunc((1080 * positionMultiplier) / 10));
  }

  w.timeClosestTyphoon = calculateAddTime(...w.timeEnterWindZoneTyphoon, Math.trunc((720 * positionMultiplier) / 10));
  w.timePassageEyeTyphoon = calculateAddTime(...w.timeClosestTyphoon, 10 * w.isTyphoon[1]);
  w.timePassageWindZoneTyphoon = calculateAddTime(...w.timeEnterWindZoneTyphoon, Math.trunc((1420 * positionMultiplier) / 10));

  if (
    (w.isTyphoon[3] === 1 || (w.timeEnterTerritoryTyphoon[0] === 3 && w.timeEnterTerritoryTyphoon[1] <= 5)) &&
    w.powerWarmAir === 5 &&
    rng.int(4) === 0 &&
    w.isLinerRainband[0] === 0
  ) {
    generateLinerRainband(state, rng, ...w.timeEnterTerritoryTyphoon);
  }
}

function maybeGenerateLinerRainbandFromColdLow(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  if (w.isColdLow && w.powerWarmAir === 5 && rng.int(4) !== 0 && w.isLinerRainband[0] === 0) {
    const t = calculateAddTime(state.time.season ?? 1, state.time.date ?? 1, minuteOfDay(state), rng.int(4200));
    generateLinerRainband(state, rng, t[0], t[1], t[2]);
  }
}

function maybeGenerateWinterLow(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  if ((state.time.season ?? 1) !== 4 || w.isColdLow) return;

  const soj = rng.int(5);
  const southern = rng.int(5);
  if (soj === 0 && southern === 0) {
    w.isSojLow = 2;
    buildSojLowTimes(state, rng, true);
  } else if (soj === 0) {
    w.isSojLow = 1;
    buildSojLowTimes(state, rng, false);
  } else if (southern === 0) {
    w.isSouthernLow = 1;
    w.timeEnterTerritorySouthernLow = [state.time.season ?? 1, (state.time.date ?? 1) + rng.int(3), rng.int(1440)];
    w.timePassageSouthernLow = calculateAddTime(...w.timeEnterTerritorySouthernLow, 1440);
  }
}

function buildSojLowTimes(state: GameState, rng: Rng, twin: boolean): void {
  const w = ensureWeatherState(state);
  w.timeEnterTerritorySojLow = [state.time.season ?? 1, (state.time.date ?? 1) + rng.int(3), rng.int(1440)];
  w.timeClosestSojLow = calculateAddTime(...w.timeEnterTerritorySojLow, 720);
  if (twin) {
    w.timePassageFakeFine = calculateAddTime(...w.timeClosestSojLow, 30 * (rng.int(6) + 1));
  }
  w.timePassageSojLow = calculateAddTime(...w.timeClosestSojLow, 1080);
}

function updateExtratropicalLow(state: GameState, rng: Rng, season: number): void {
  const w = ensureWeatherState(state);
  if ((season === 1 || season === 3) && !w.isColdLow && !w.isRainySeason1[0] && !w.isRainySeason2) {
    w.timeEnterTerritoryExtratropicalLow = [season, (state.time.date ?? 1) + 1 + rng.int(2), rng.int(1440)];
    w.timePassageWarmFront = calculateAddTime(...w.timeEnterTerritoryExtratropicalLow, 1440);
    w.timePassageColdFront = calculateAddTime(...w.timePassageWarmFront, 720);
    w.timePassageExtratropicalLow = calculateAddTime(...w.timePassageColdFront, 180);
  } else {
    w.timeEnterTerritoryExtratropicalLow = zeroDateTime();
    w.timePassageWarmFront = zeroDateTime();
    w.timePassageColdFront = zeroDateTime();
    w.timePassageExtratropicalLow = zeroDateTime();
  }
}

function updateCumulus(state: GameState, rng: Rng): void {
  const w = ensureWeatherState(state);
  const season = state.time.season ?? 1;
  const low = getLocationLow(state);

  if (season === 2 && w.powerWarmAir >= 2 && !w.isColdLow && (low === "台風遠方" || low === "台風一過" || low === "低気圧未発生")) {
    if (w.atmosphericInstability >= 4) w.canCumulus[0] = 1;
    else if (w.atmosphericInstability >= 0) w.canCumulus[0] = 2;
    else w.canCumulus[0] = 3;
    if (rng.int(4) === 0) w.canCumulus[1] = 1;
  } else if (season === 2 && (w.isColdLow || low === "台風勢力圏")) {
    if (w.atmosphericInstability >= 0) {
      w.canCumulus[0] = 2;
      if (rng.int(4) === 0) w.canCumulus[1] = 1;
    } else if (w.atmosphericInstability >= -3) {
      w.canCumulus[0] = 3;
      if (rng.int(2) === 0) w.canCumulus[1] = 1;
    } else if (w.atmosphericInstability >= -6) {
      w.canCumulus[0] = 4;
      if (rng.int(2) === 0) w.canCumulus[1] = 1;
    } else if (w.atmosphericInstability >= -8) {
      w.canCumulus = [4, 1, 0];
    } else {
      w.canCumulus = [5, 1, 0];
    }
  } else {
    clearCumulus(w);
  }

  if (w.canCumulus[1] === 1) {
    w.timeEnterTerritoryCumulus = 840 + rng.int(120);
    w.timeClosestCumulus = w.timeEnterTerritoryCumulus + 30 + rng.int(15);
    if (w.canCumulus[0] <= 3) {
      w.timePassageCumulus = w.timeClosestCumulus + 60 + rng.int(15);
    } else if (w.canCumulus[0] === 4) {
      w.timePassageCumulus = w.timeClosestCumulus + 90 + rng.int(2) * 60 + rng.int(30);
    } else if (w.canCumulus[0] === 5) {
      w.timePassageCumulus = w.timeClosestCumulus + 120 + rng.int(3) * 60 + rng.int(30);
    }
  }

  if (w.canCumulus[0] === 4 && w.canCumulus[1] === 1) {
    w.canCumulus[2] = rng.int(Math.max(1, 40 + w.atmosphericInstability)) === 0 ? 2 : 1;
  } else if (w.canCumulus[0] === 5 && w.canCumulus[1] === 1) {
    w.canCumulus[2] = rng.int(5) === 0 ? 2 : 1;
  }
}

function clearCumulus(w: ReturnType<typeof ensureWeatherState>): void {
  w.canCumulus = [0, 0, 0];
  w.timeEnterTerritoryCumulus = 0;
  w.timeClosestCumulus = 0;
  w.timePassageCumulus = 0;
}

export function seedInitialWeatherForecasts(state: GameState, rng: Rng): void {
  weatherForecast1Term(state, rng);
  weatherForecast1Day(state, rng);
}

export function refreshWeatherForecastsForNewDay(state: GameState, rng: Rng, seasonWrapped: boolean): void {
  if (seasonWrapped) weatherForecast1Year(state, rng);
  weatherForecast1Term(state, rng);
  weatherForecast1Day(state, rng);
}

function minuteOfDay(state: GameState): number {
  return Math.max(0, Math.min(1439, state.time.hourOfDay * 60));
}

export function forecastReferenceNow(state: GameState): WeatherDateTime {
  return currentWeatherDateTime(state);
}

export function hasForecastEventArrived(state: GameState, t: WeatherDateTime): boolean {
  return dateTimeBeforeCurrent(state, t);
}
