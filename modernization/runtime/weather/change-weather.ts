/**
 * S2 `qol_CHANGE_WEATHER_SYSTEM_N` state machines.
 *
 * Source: `魔改内容/qol/qol_天候管理拡張.ERB` (1815 lines), N=1..21.
 * Text/diary output remains a presentation concern. Crop damage is delegated
 * only at the upstream S5 storm transitions; this file otherwise owns weather,
 * wind, rainbow, rainfall/snowfall, and avalanche state.
 */

import type { GameState } from "../state/game-state.js";
import type { Rng } from "../command/rng.js";
import { FLAG_ID } from "../state/settlement.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { COMMON_REGION, RAINBOW_ID, WEATHER_ID, WIND_ID } from "./constants.js";
import { qolContinuousRainfallCounter } from "./rainfall-counter.js";
import {
  qolContinuousSnowfallCounterSpring,
  qolContinuousSnowfallCounterWinter,
} from "./snowfall-counter.js";
import {
  qolNoAvalanche,
  qolPossibilityAvalancheSpring,
  qolPossibilityAvalancheWinter,
  qolPossibilityAvalancheWinterLow,
} from "./avalanche.js";
import { qolDownburstGeneration } from "./downburst.js";
import { qolWeatherChangeToCropStorm } from "./crop-damage.js";
import { getLocationLow } from "./low-pressure.js";
import { getFrontalThunderstorm, getHeatThunderstorm } from "./thunderstorm.js";

function r0(rng: Rng, max: number): boolean {
  return rng.int(max) === 0;
}

function weatherOf(state: GameState): number {
  return ensureWeatherState(state).gensokyoWeatherSystem[COMMON_REGION] ?? WEATHER_ID.少云;
}

function setWeather(state: GameState, weather: number): void {
  ensureWeatherState(state).gensokyoWeatherSystem[COMMON_REGION] = weather;
}

function windOf(state: GameState): number {
  return ensureWeatherState(state).gensokyoWindVeSystem[COMMON_REGION] ?? WIND_ID.无风;
}

function setWind(state: GameState, wind: number): void {
  const w = ensureWeatherState(state);
  w.windVelocity = wind;
  w.gensokyoWindVeSystem[COMMON_REGION] = wind;
}

function setRainbow(state: GameState, rainbow: number): void {
  ensureWeatherState(state).gensokyoRainbowSystem[COMMON_REGION] = rainbow;
}

function openMarket(state: GameState): void {
  state.flagStore[FLAG_ID.市場の神] = 1;
}

function clearToSunAfterRain(state: GameState, rng: Rng, rainbow: number): void {
  setWeather(state, WEATHER_ID.少云);
  if (rng.int(100) < 5) setWeather(state, WEATHER_ID.晴);
  setRainbow(state, rainbow);
  if (rainbow === RAINBOW_ID.彩虹) openMarket(state);
}

function postRain(state: GameState): void {
  qolContinuousRainfallCounter(state, weatherOf(state));
}

function springAvalancheOrReset(state: GameState): void {
  const w = ensureWeatherState(state);
  if ((state.time.season ?? 1) === 1 && w.nowTerm <= 2) {
    qolContinuousSnowfallCounterSpring(state, weatherOf(state));
    qolPossibilityAvalancheSpring(state, weatherOf(state));
  } else {
    qolNoAvalanche(state);
  }
}

function noAvalanchePost(state: GameState): void {
  qolNoAvalanche(state);
}

function winterPost(state: GameState): void {
  qolContinuousSnowfallCounterWinter(state, weatherOf(state));
  qolPossibilityAvalancheWinter(state);
}

function winterLowPost(state: GameState): void {
  qolContinuousSnowfallCounterWinter(state, weatherOf(state));
  qolPossibilityAvalancheWinterLow(state, weatherOf(state));
}

function resetHeader(state: GameState): void {
  setRainbow(state, RAINBOW_ID.无虹);
}

function bit(value: number, index: number): boolean {
  return (value & (1 << index)) !== 0;
}

function setBit(value: number, index: number): number {
  return value | (1 << index);
}

function clearBit(value: number, index: number): number {
  return value & ~(1 << index);
}

function invertBit(value: number, index: number): number {
  return value ^ (1 << index);
}

function stormy(state: GameState): boolean {
  return getHeatThunderstorm(state) && getFrontalThunderstorm(state);
}

export function qolChangeWeatherSystem1(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const current = weatherOf(state);
  let next = current;
  switch (current) {
    case WEATHER_ID.少云:
      next = r0(rng, 5) ? WEATHER_ID.晴 : r0(rng, 5) ? WEATHER_ID.多云 : WEATHER_ID.少云;
      break;
    case WEATHER_ID.晴:
      if (r0(rng, 5)) next = WEATHER_ID.少云;
      else if (r0(rng, 5)) next = WEATHER_ID.多云;
      break;
    case WEATHER_ID.多云:
    case WEATHER_ID.阴:
      next = r0(rng, 2) ? WEATHER_ID.多云 : WEATHER_ID.少云;
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.冰霰:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      if (r0(rng, 2) && current !== WEATHER_ID.雨) next = WEATHER_ID.雨;
      else if (r0(rng, 4)) next = WEATHER_ID.阴;
      else if (current === WEATHER_ID.雨 && r0(rng, 10)) next = WEATHER_ID.雾雨;
      else {
        setWeather(state, current);
        clearToSunAfterRain(state, rng, RAINBOW_ID.彩虹);
        next = weatherOf(state);
      }
      break;
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
      next = WEATHER_ID.少云;
      break;
    default:
      if (current >= WEATHER_ID.雪) {
        if (rng.int(2) !== 0) next = WEATHER_ID.雨;
        else if (r0(rng, 4)) next = WEATHER_ID.阴;
        else {
          setWeather(state, current);
          clearToSunAfterRain(state, rng, RAINBOW_ID.钻石尘);
          next = weatherOf(state);
        }
      } else {
        next = rng.int(4);
      }
      break;
  }
  setWeather(state, next);
  postRain(state);
  setWind(state, WIND_ID.无风);
  springAvalancheOrReset(state);
}

export function qolChangeWeatherSystem2(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.晴:
      setWeather(state, WEATHER_ID.少云);
      break;
    case WEATHER_ID.少云:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.多云);
      else if (r0(rng, 10)) setWeather(state, WEATHER_ID.阴);
      break;
    case WEATHER_ID.多云:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.阴);
      else if (r0(rng, 10)) setWeather(state, WEATHER_ID.雨);
      break;
    case WEATHER_ID.阴:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.雨);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.冰霰:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      if (getHeatThunderstorm(state) && weatherOf(state) === WEATHER_ID.雨) setWeather(state, WEATHER_ID.大雨);
      break;
    default:
      setWeather(state, WEATHER_ID.多云);
      break;
  }
  postRain(state);
  springAvalancheOrReset(state);
}

export function qolChangeWeatherSystem3(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  // Preserve upstream quirk: condition uses ||, so it is effectively always true.
  if (weatherOf(state) !== WEATHER_ID.少云 || weatherOf(state) !== WEATHER_ID.多云) {
    if (rng.int(2) === 1) setWeather(state, WEATHER_ID.少云);
    else setWeather(state, WEATHER_ID.多云);
  }
  postRain(state);
  const local = rng.int(10);
  const w = ensureWeatherState(state);
  if ((state.time.season ?? 1) === 1 && w.nowTerm === 1) {
    if (windOf(state) !== WIND_ID.强风) setWind(state, WIND_ID.强风);
  } else if (w.powerWarmAir >= 4 && local >= 8 && windOf(state) === WIND_ID.无风) {
    setWind(state, WIND_ID.强风);
  } else if (local >= 5 && windOf(state) > WIND_ID.无风) {
    setWind(state, WIND_ID.无风);
  }
  springAvalancheOrReset(state);
}

export function qolChangeWeatherSystem4(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const cur = weatherOf(state);
  if (cur === WEATHER_ID.冰雹 && stormy(state)) setWeather(state, WEATHER_ID.暴雨);
  else if (cur === WEATHER_ID.冰霰 || cur === WEATHER_ID.冰雹) setWeather(state, WEATHER_ID.大雨);
  else if (cur !== WEATHER_ID.雨 && cur !== WEATHER_ID.大雨 && cur !== WEATHER_ID.暴雨) {
    if (r0(rng, 3)) setWeather(state, WEATHER_ID.雨);
    else if (rng.int(3) === 1 && getFrontalThunderstorm(state)) {
      if (ensureWeatherState(state).powerWarmAir === 5) setWeather(state, r0(rng, 3) ? WEATHER_ID.冰雹 : WEATHER_ID.冰霰);
      else setWeather(state, WEATHER_ID.冰霰);
    } else setWeather(state, WEATHER_ID.大雨);
  } else if (stormy(state)) {
    if (weatherOf(state) !== WEATHER_ID.暴雨) setWeather(state, WEATHER_ID.暴雨);
  } else {
    switch (weatherOf(state)) {
      case WEATHER_ID.雨:
        if (r0(rng, 3)) setWeather(state, WEATHER_ID.大雨);
        break;
      case WEATHER_ID.大雨:
        if (r0(rng, 3)) setWeather(state, WEATHER_ID.雨);
        break;
      case WEATHER_ID.暴雨:
        setWeather(state, WEATHER_ID.大雨);
        break;
      default:
        setWeather(state, WEATHER_ID.大雨);
    }
  }
  postRain(state);
  const local = rng.int(4);
  if (stormy(state) && ensureWeatherState(state).atmosphericInstability <= -1) qolDownburstGeneration(state);
  else if (local === 0 && windOf(state) !== WIND_ID.无风) setWind(state, WIND_ID.无风);
  springAvalancheOrReset(state);
}

export function qolChangeWeatherSystem5(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  const cur = weatherOf(state);
  if (w.powerWarmAir === 1) {
    switch (cur) {
      case WEATHER_ID.阴: {
        const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r <= 2 ? WEATHER_ID.雪 : WEATHER_ID.大雪); break;
      }
      case WEATHER_ID.雪: {
        const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰雹 : r === 1 ? WEATHER_ID.阴 : WEATHER_ID.大雪); break;
      }
      case WEATHER_ID.大雪: {
        const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r === 1 ? WEATHER_ID.阴 : WEATHER_ID.雪); break;
      }
      case WEATHER_ID.冰霰:
        setWeather(state, rng.int(4) === 0 ? WEATHER_ID.雪 : WEATHER_ID.大雪);
        break;
      default:
        setWeather(state, WEATHER_ID.大雪);
    }
  } else {
    switch (cur) {
      case WEATHER_ID.阴:
      case WEATHER_ID.雨: {
        const gateMax = cur === WEATHER_ID.阴 ? 6 : 4;
        if (stormy(state) && r0(rng, gateMax)) {
          const r = rng.int(6);
          setWeather(state, r === 0 ? WEATHER_ID.冰雹 : r >= 2 ? WEATHER_ID.大雨 : WEATHER_ID.暴雨);
        } else {
          const r = rng.int(6);
          setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r === 1 ? WEATHER_ID.雨夹雪 : r === 2 ? (cur === WEATHER_ID.阴 ? WEATHER_ID.雨 : WEATHER_ID.阴) : WEATHER_ID.大雨);
        }
        break;
      }
      case WEATHER_ID.大雨:
      case WEATHER_ID.暴雨: {
        const r = rng.int(5);
        if (r === 0) setWeather(state, WEATHER_ID.冰霰);
        else if (r === 1) setWeather(state, WEATHER_ID.阴);
        else if (cur === WEATHER_ID.暴雨) setWeather(state, WEATHER_ID.大雨);
        else if (stormy(state) && r0(rng, 2)) setWeather(state, WEATHER_ID.暴雨);
        else setWeather(state, WEATHER_ID.雨);
        break;
      }
      case WEATHER_ID.雨夹雪: {
        const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r <= 2 ? WEATHER_ID.阴 : WEATHER_ID.雨); break;
      }
      case WEATHER_ID.冰霰:
        setWeather(state, rng.int(4) === 0 ? WEATHER_ID.雨 : WEATHER_ID.大雨);
        break;
      case WEATHER_ID.冰雹:
        setWeather(state, rng.int(4) === 0 ? WEATHER_ID.暴雨 : WEATHER_ID.大雨);
        break;
      default:
        setWeather(state, WEATHER_ID.大雨);
    }
  }
  postRain(state);
  const local = rng.int(20);
  if (stormy(state) && w.atmosphericInstability <= -1) qolDownburstGeneration(state);
  else if (local === 0 && windOf(state) === WIND_ID.强风) setWind(state, WIND_ID.暴风);
  else if (local >= 10 && windOf(state) === WIND_ID.暴风) setWind(state, WIND_ID.强风);
  else if (windOf(state) === WIND_ID.无风) setWind(state, WIND_ID.强风);
  springAvalancheOrReset(state);
}

export function qolChangeWeatherSystem6(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  const cur = weatherOf(state);
  if (w.powerWarmAir === 1) {
    switch (cur) {
      case WEATHER_ID.少云:
        setWeather(state, r0(rng, 5) ? WEATHER_ID.晴 : r0(rng, 5) ? WEATHER_ID.多云 : WEATHER_ID.少云);
        break;
      case WEATHER_ID.晴:
        if (r0(rng, 5)) setWeather(state, WEATHER_ID.晴);
        else if (r0(rng, 5)) setWeather(state, WEATHER_ID.多云);
        break;
      case WEATHER_ID.多云:
      case WEATHER_ID.阴:
        if (r0(rng, 4)) setWeather(state, WEATHER_ID.多云);
        else if (r0(rng, 5)) setWeather(state, WEATHER_ID.少云);
        break;
      case WEATHER_ID.雨:
      case WEATHER_ID.大雨:
      case WEATHER_ID.暴雨:
      case WEATHER_ID.冰雹:
        if (r0(rng, 4) && cur !== WEATHER_ID.雨) setWeather(state, WEATHER_ID.雨);
        else if (r0(rng, 4)) setWeather(state, WEATHER_ID.阴);
        else if (cur === WEATHER_ID.雨 && r0(rng, 10)) setWeather(state, WEATHER_ID.雾雨);
        else if (r0(rng, 10)) clearToSunAfterRain(state, rng, RAINBOW_ID.彩虹);
        break;
      case WEATHER_ID.雾雨:
      case WEATHER_ID.雾:
        setWeather(state, WEATHER_ID.少云);
        break;
      default:
        if (cur >= WEATHER_ID.雪) summerSnowTransition(state, rng);
        else setWeather(state, rng.int(4));
    }
  } else {
    switch (cur) {
      case WEATHER_ID.少云:
      case WEATHER_ID.多云:
      case WEATHER_ID.阴:
        setWeather(state, WEATHER_ID.晴);
        break;
      case WEATHER_ID.雨:
      case WEATHER_ID.大雨:
      case WEATHER_ID.雾雨:
      case WEATHER_ID.雾:
      case WEATHER_ID.冰霰:
        if (r0(rng, 4)) setWeather(state, WEATHER_ID.阴);
        else clearToSunAfterRain(state, rng, RAINBOW_ID.彩虹);
        break;
      case WEATHER_ID.暴雨:
      case WEATHER_ID.冰雹:
        setWeather(state, WEATHER_ID.大雨);
        break;
      default:
        if (cur >= WEATHER_ID.雪) summerSnowTransition(state, rng);
        else setWeather(state, WEATHER_ID.晴);
    }
  }
  postRain(state);
  if (windOf(state) !== WIND_ID.无风) setWind(state, WIND_ID.无风);
  noAvalanchePost(state);
}

function summerSnowTransition(state: GameState, rng: Rng): void {
  let cur = weatherOf(state);
  if (cur === WEATHER_ID.雪) setWeather(state, setBit(clearBit(cur, 3), 2));
  else if (bit(cur, 0) && rng.int(2) !== 0) setWeather(state, clearBit(cur, 0));
  else if (r0(rng, 4)) setWeather(state, WEATHER_ID.阴);
  else if (cur === WEATHER_ID.雪 && r0(rng, 10)) {
    setWeather(state, rng.int(2) !== 0 ? WEATHER_ID.细雪 : WEATHER_ID.雨夹雪);
    if (r0(rng, 10)) setWeather(state, setBit(weatherOf(state), 0));
  } else if (r0(rng, 10)) clearToSunAfterRain(state, rng, RAINBOW_ID.钻石尘);
}

export function qolChangeWeatherSystem7(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (ensureWeatherState(state).canCumulus[0]) {
    case 1:
      setWeather(state, WEATHER_ID.少云);
      break;
    case 2:
    case 3:
      setWeather(state, r0(rng, 2) ? WEATHER_ID.少云 : WEATHER_ID.多云);
      break;
    case 4:
      setWeather(state, r0(rng, 2) ? WEATHER_ID.多云 : WEATHER_ID.阴);
      break;
    case 5:
      setWeather(state, WEATHER_ID.阴);
      break;
  }
  postRain(state);
  noAvalanchePost(state);
}

export function qolChangeWeatherSystem8(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const cc = ensureWeatherState(state).canCumulus;
  const cur = weatherOf(state);
  switch (cc[0]) {
    case 1:
      if (r0(rng, 2) && cur <= WEATHER_ID.晴) setWeather(state, WEATHER_ID.少云);
      else if (cur < WEATHER_ID.阴) setWeather(state, WEATHER_ID.阴);
      break;
    case 2:
      if (r0(rng, 3) && cur < WEATHER_ID.雨) setWeather(state, WEATHER_ID.雨);
      else if (cur < WEATHER_ID.阴) setWeather(state, WEATHER_ID.阴);
      break;
    case 3:
      if (r0(rng, 3) && cur < WEATHER_ID.雨) setWeather(state, WEATHER_ID.大雨);
      else if (cur < WEATHER_ID.雨) setWeather(state, WEATHER_ID.雨);
      break;
    case 4:
      if (r0(rng, 3) && cur === WEATHER_ID.大雨) setWeather(state, WEATHER_ID.冰霰);
      else if (cur !== WEATHER_ID.大雨) setWeather(state, WEATHER_ID.大雨);
      break;
    case 5:
      if (r0(rng, 3) && cur !== WEATHER_ID.冰雹) setWeather(state, WEATHER_ID.冰雹);
      else if (cur !== WEATHER_ID.暴雨) setWeather(state, WEATHER_ID.暴雨);
      break;
  }
  postRain(state);
  if (cc[2] === 2 && windOf(state) !== WIND_ID.暴风) {
    setWind(state, WIND_ID.暴风);
    qolWeatherChangeToCropStorm(state);
  }
  else if (cc[2] === 1 && windOf(state) !== WIND_ID.强风) setWind(state, WIND_ID.强风);
  noAvalanchePost(state);
}

export function qolChangeWeatherSystem9(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const cur = weatherOf(state);
  switch (cur) {
    case WEATHER_ID.少云:
      setWeather(state, r0(rng, 5) ? WEATHER_ID.多云 : r0(rng, 20) ? WEATHER_ID.阴 : WEATHER_ID.少云);
      break;
    case WEATHER_ID.晴:
      setWeather(state, r0(rng, 5) ? WEATHER_ID.多云 : WEATHER_ID.少云);
      break;
    case WEATHER_ID.多云:
    case WEATHER_ID.阴:
      if (r0(rng, 4)) setWeather(state, invertBit(cur, 0));
      else if (r0(rng, 5)) setWeather(state, WEATHER_ID.少云);
      else if (cur === WEATHER_ID.多云 && r0(rng, 10)) {
        setWeather(state, WEATHER_ID.雪);
        if (r0(rng, 10)) setWeather(state, setBit(weatherOf(state), 1));
      } else if (cur === WEATHER_ID.阴 && rng.int(10) < 3) setWeather(state, WEATHER_ID.雪);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      setWeather(state, WEATHER_ID.雪);
      break;
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
      setWeather(state, WEATHER_ID.少云);
      break;
    default:
      if (cur >= WEATHER_ID.雪) {
        if (cur === WEATHER_ID.大雪) setWeather(state, WEATHER_ID.雪);
        else if (r0(rng, 2)) setWeather(state, WEATHER_ID.阴);
        else if (cur === WEATHER_ID.雪 && r0(rng, 10)) {
          setWeather(state, WEATHER_ID.细雪);
          if (r0(rng, 10)) setWeather(state, setBit(weatherOf(state), 0));
        } else if (r0(rng, 4)) clearToSunAfterRain(state, rng, RAINBOW_ID.钻石尘);
      } else setWeather(state, rng.int(4));
  }
  postRain(state);
  winterWindDecay(state);
  winterPost(state);
}

function winterWindDecay(state: GameState): void {
  if (windOf(state) === WIND_ID.强风) setWind(state, WIND_ID.无风);
  else if (windOf(state) === WIND_ID.暴风) setWind(state, WIND_ID.强风);
  else if (windOf(state) >= WIND_ID.飓风) setWind(state, WIND_ID.暴风);
}

export function qolChangeWeatherSystem10(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  winterLowApproach(state, rng);
  postRain(state);
  winterLowPost(state);
  const w = ensureWeatherState(state);
  if ((w.powerWarmAir >= 4 || w.isSojLow === 2) && windOf(state) === WIND_ID.无风) setWind(state, WIND_ID.强风);
}

function winterLowApproach(state: GameState, rng: Rng): void {
  const warm = ensureWeatherState(state).powerWarmAir;
  const rainOrSnow = warm >= 3 ? WEATHER_ID.雨 : WEATHER_ID.雪;
  const heavyRainOrSnow = warm >= 3 ? WEATHER_ID.大雨 : WEATHER_ID.大雪;
  switch (weatherOf(state)) {
    case WEATHER_ID.晴:
      setWeather(state, WEATHER_ID.少云);
      break;
    case WEATHER_ID.少云:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.多云);
      else if (r0(rng, 10)) setWeather(state, WEATHER_ID.阴);
      break;
    case WEATHER_ID.多云:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.阴);
      else if (r0(rng, 10)) setWeather(state, rainOrSnow);
      break;
    case WEATHER_ID.阴:
      if (r0(rng, 2)) setWeather(state, rainOrSnow);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.雪:
      if (r0(rng, 2)) setWeather(state, heavyRainOrSnow);
      break;
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
    default:
      if (weatherOf(state) >= WEATHER_ID.细雪 || weatherOf(state) === WEATHER_ID.雾雨 || weatherOf(state) === WEATHER_ID.雾) setWeather(state, rainOrSnow);
      break;
  }
}

export function qolChangeWeatherSystem11(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  if (w.isSojLow === 2) {
    if (weatherOf(state) !== WEATHER_ID.大雪 || windOf(state) < WIND_ID.暴风) {
      setWeather(state, WEATHER_ID.大雪);
      setWind(state, w.powerColdAir >= 4 && w.powerWarmAir >= 5 ? WIND_ID.飓风 : WIND_ID.暴风);
    }
    return;
  }
  switch (weatherOf(state)) {
    case WEATHER_ID.雪:
      if (w.powerColdAir >= 3) {
        const r = rng.int(3);
        if (r > 1) setWeather(state, WEATHER_ID.大雪);
        else if (rng.int(3) === 1) setWeather(state, WEATHER_ID.冰霰);
      }
      break;
    case WEATHER_ID.大雪:
      if (r0(rng, 3)) setWeather(state, WEATHER_ID.雪);
      else if (rng.int(3) === 1) setWeather(state, WEATHER_ID.冰霰);
      break;
    case WEATHER_ID.冰霰:
      setWeather(state, w.powerColdAir >= 3 ? WEATHER_ID.大雪 : WEATHER_ID.雪);
      break;
    default:
      setWeather(state, weatherOf(state) < WEATHER_ID.雪 ? (w.powerColdAir < 3 ? WEATHER_ID.雪 : WEATHER_ID.大雪) : WEATHER_ID.雪);
  }
  postRain(state);
  qolContinuousSnowfallCounterWinter(state, weatherOf(state));
  const local = rng.int(20);
  if (local === 0 && windOf(state) === WIND_ID.强风 && w.powerColdAir >= 4) setWind(state, WIND_ID.暴风);
  else if (local >= 10 && windOf(state) === WIND_ID.暴风) setWind(state, WIND_ID.强风);
  else if (local >= 10 && windOf(state) === WIND_ID.无风) setWind(state, WIND_ID.强风);
  qolPossibilityAvalancheWinter(state);
}

export function qolChangeWeatherSystem12(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.少云:
    case WEATHER_ID.晴:
      setWeather(state, WEATHER_ID.阴);
      break;
    case WEATHER_ID.多云:
    case WEATHER_ID.阴:
      if (r0(rng, 4)) setWeather(state, invertBit(weatherOf(state), 0));
      else if (weatherOf(state) === WEATHER_ID.多云 && r0(rng, 4)) setWeather(state, WEATHER_ID.雪);
      else if (weatherOf(state) === WEATHER_ID.阴 && r0(rng, 2)) setWeather(state, WEATHER_ID.雪);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      setWeather(state, WEATHER_ID.雪);
      break;
    default:
      if (weatherOf(state) >= WEATHER_ID.雪) winterSnowLowTransition(state, rng);
      else setWeather(state, WEATHER_ID.雪);
  }
  postRain(state);
  winterLowPost(state);
}

function winterSnowLowTransition(state: GameState, rng: Rng): void {
  const cur = weatherOf(state);
  if (!bit(cur, 0) && r0(rng, 10)) setWeather(state, setBit(cur, 0));
  else if (bit(cur, 0) && rng.int(2) !== 0) setWeather(state, clearBit(cur, 0));
  else if (r0(rng, 4)) setWeather(state, WEATHER_ID.阴);
  else if (cur === WEATHER_ID.雪 && r0(rng, 10)) {
    setWeather(state, WEATHER_ID.细雪);
    if (r0(rng, 10)) setWeather(state, setBit(weatherOf(state), 0));
  }
}

export function qolChangeWeatherSystem13(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.阴: {
      const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r <= 2 ? WEATHER_ID.雪 : WEATHER_ID.大雪); break;
    }
    case WEATHER_ID.雪: {
      const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r === 1 ? WEATHER_ID.阴 : WEATHER_ID.大雪); break;
    }
    case WEATHER_ID.大雪: {
      const r = rng.int(5); setWeather(state, r === 0 ? WEATHER_ID.冰霰 : r === 1 ? WEATHER_ID.阴 : WEATHER_ID.雪); break;
    }
    case WEATHER_ID.冰霰:
      setWeather(state, rng.int(4) === 0 ? WEATHER_ID.雪 : WEATHER_ID.大雪);
      break;
    default:
      setWeather(state, WEATHER_ID.大雪);
  }
  postRain(state);
  qolContinuousSnowfallCounterWinter(state, weatherOf(state));
  const local = rng.int(20);
  if (local === 0 && windOf(state) === WIND_ID.强风) setWind(state, WIND_ID.暴风);
  else if (local >= 10 && windOf(state) === WIND_ID.暴风) setWind(state, WIND_ID.强风);
  else if (windOf(state) === WIND_ID.无风) setWind(state, WIND_ID.强风);
  qolPossibilityAvalancheWinter(state);
}

export function qolChangeWeatherSystem14(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.晴:
      setWeather(state, WEATHER_ID.多云);
      break;
    case WEATHER_ID.多云:
      setWeather(state, r0(rng, 4) ? WEATHER_ID.少云 : WEATHER_ID.阴);
      break;
    case WEATHER_ID.阴:
      setWeather(state, r0(rng, 3) ? WEATHER_ID.多云 : WEATHER_ID.雨);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.大雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      rainySeasonRainTransition(state, rng);
      break;
    default:
      setWeather(state, WEATHER_ID.阴);
  }
  postRain(state);
  if (windOf(state) !== WIND_ID.无风) setWind(state, WIND_ID.无风);
  noAvalanchePost(state);
}

function rainySeasonRainTransition(state: GameState, rng: Rng): void {
  const cur = weatherOf(state);
  if (stormy(state) && (cur === WEATHER_ID.雨 || cur === WEATHER_ID.大雨) && r0(rng, 2)) {
    setWeather(state, WEATHER_ID.暴雨);
  } else if ((getHeatThunderstorm(state) || getFrontalThunderstorm(state)) && cur === WEATHER_ID.雨) {
    setWeather(state, r0(rng, 4) ? WEATHER_ID.冰霰 : WEATHER_ID.大雨);
  } else if (r0(rng, 3)) {
    setWeather(state, WEATHER_ID.少云);
    setRainbow(state, RAINBOW_ID.彩虹);
    openMarket(state);
  } else {
    setWeather(state, WEATHER_ID.阴);
  }
}

export function qolChangeWeatherSystem15(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  const active = w.powerWarmAir === 5 || getLocationLow(state) === "台風勢力圏" || getHeatThunderstorm(state) || getFrontalThunderstorm(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.阴:
      if (active) {
        if (r0(rng, 3)) setWeather(state, WEATHER_ID.大雨);
        else if (r0(rng, 2) && (getHeatThunderstorm(state) || getFrontalThunderstorm(state))) {
          if (stormy(state)) setWeather(state, r0(rng, 4) ? WEATHER_ID.冰雹 : WEATHER_ID.暴雨);
          else setWeather(state, WEATHER_ID.冰霰);
        } else setWeather(state, WEATHER_ID.雨);
      } else setWeather(state, r0(rng, 4) ? WEATHER_ID.大雨 : WEATHER_ID.雨);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
      if (stormy(state) && rng.int(2) !== 0) setWeather(state, r0(rng, 4) ? WEATHER_ID.冰雹 : WEATHER_ID.暴雨);
      else if (active) setWeather(state, rng.int(3) !== 0 ? WEATHER_ID.大雨 : r0(rng, 2) ? WEATHER_ID.冰霰 : WEATHER_ID.阴);
      else setWeather(state, rng.int(2) !== 0 ? WEATHER_ID.大雨 : WEATHER_ID.阴);
      break;
    case WEATHER_ID.大雨:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      if (stormy(state)) {
        if (r0(rng, 4) && weatherOf(state) !== WEATHER_ID.冰雹) setWeather(state, WEATHER_ID.冰雹);
        else if (r0(rng, 2) && weatherOf(state) !== WEATHER_ID.暴雨) setWeather(state, WEATHER_ID.暴雨);
        else if (weatherOf(state) === WEATHER_ID.暴雨) setWeather(state, rng.int(3) !== 0 ? WEATHER_ID.雨 : WEATHER_ID.大雨);
        else setWeather(state, WEATHER_ID.阴);
      } else if (active) setWeather(state, rng.int(2) !== 0 ? WEATHER_ID.冰霰 : WEATHER_ID.雨);
      else setWeather(state, rng.int(2) !== 0 ? WEATHER_ID.雨 : WEATHER_ID.阴);
      break;
    case WEATHER_ID.冰霰:
      setWeather(state, stormy(state) ? WEATHER_ID.暴雨 : WEATHER_ID.大雨);
      break;
    default:
      setWeather(state, WEATHER_ID.雨);
  }
  postRain(state);
  if (stormy(state) && w.atmosphericInstability <= -1) qolDownburstGeneration(state, r0(rng, 2));
  else if (windOf(state) !== WIND_ID.无风) setWind(state, WIND_ID.无风);
  noAvalanchePost(state);
}

export function qolChangeWeatherSystem16(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  typhoonRainTransition(state, rng, false);
  postRain(state);
  if (windOf(state) === WIND_ID.无风) setWind(state, WIND_ID.强风);
  else if (windOf(state) >= WIND_ID.暴风) setWind(state, WIND_ID.强风);
  noAvalanchePost(state);
}

function typhoonRainTransition(state: GameState, rng: Rng, core: boolean): void {
  const w = ensureWeatherState(state);
  const low = getLocationLow(state);
  const heavyRain = w.isTyphoon[1] >= 5 && w.isTyphoon[2] === 3 && w.powerWarmAir >= 5;
  const cur = weatherOf(state);
  const passed = core && low === "台風通過暴風域";
  switch (cur) {
    case WEATHER_ID.阴:
      setWeather(state, r0(rng, 2) ? WEATHER_ID.大雨 : WEATHER_ID.雨);
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾:
      if (rng.int(2) !== 0) setWeather(state, WEATHER_ID.大雨);
      else if (r0(rng, 2)) {
        if (core && heavyRain) setWeather(state, WEATHER_ID.暴雨);
        else if (passed || (!core && low === "台風通過強風域")) setWeather(state, WEATHER_ID.阴);
      } else if (core) setWeather(state, WEATHER_ID.阴);
      break;
    case WEATHER_ID.大雨:
    case WEATHER_ID.暴雨:
      if (cur !== WEATHER_ID.暴雨 && heavyRain) setWeather(state, WEATHER_ID.暴雨);
      else if (rng.int(2) !== 0 && passed) setWeather(state, WEATHER_ID.阴);
      else if (rng.int(2) !== 0) setWeather(state, cur === WEATHER_ID.暴雨 ? WEATHER_ID.大雨 : WEATHER_ID.雨);
      break;
    case WEATHER_ID.冰霰:
    case WEATHER_ID.冰雹:
      setWeather(state, WEATHER_ID.大雨);
      break;
    default:
      setWeather(state, WEATHER_ID.雨);
  }
}

export function qolChangeWeatherSystem21(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  const low = getLocationLow(state);
  const currentTyphoon = low === "台風通過暴風域" ? 2 : low === "台風接近暴風域" || low === "台風最接近" ? 1 : 0;
  typhoonRainTransition(state, rng, true);
  postRain(state);
  const hurricane = w.isTyphoon[1] >= 5 && w.powerColdAir === 1 && w.powerWarmAir >= 5;
  switch (windOf(state)) {
    case WIND_ID.无风:
      setWind(state, hurricane ? WIND_ID.飓风 : WIND_ID.暴风);
      break;
    case WIND_ID.强风:
      setWind(state, WIND_ID.暴风);
      if (w.isTyphoon[2] === 2) qolWeatherChangeToCropStorm(state);
      break;
    case WIND_ID.暴风:
      if (hurricane && currentTyphoon === 1) {
        setWind(state, WIND_ID.飓风);
        qolWeatherChangeToCropStorm(state);
      }
      break;
    default:
      if (windOf(state) >= WIND_ID.飓风 && currentTyphoon === 2) setWind(state, WIND_ID.暴风);
  }
  noAvalanchePost(state);
}

export function qolChangeWeatherSystem17(state: GameState, _noWeather: boolean, _rng: Rng): void {
  resetHeader(state);
  if (ensureWeatherState(state).isTyphoon[1] < 3 && (weatherOf(state) !== WEATHER_ID.多云 || windOf(state) !== WIND_ID.无风)) {
    setWeather(state, WEATHER_ID.多云);
    setWind(state, WIND_ID.无风);
  } else if (weatherOf(state) !== WEATHER_ID.少云 || windOf(state) !== WIND_ID.无风) {
    setWeather(state, WEATHER_ID.少云);
    setWind(state, WIND_ID.无风);
  }
  noAvalanchePost(state);
}

export function qolChangeWeatherSystem18(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.雾雨:
    case WEATHER_ID.细雪:
      setWeather(state, WEATHER_ID.雾);
      break;
    case WEATHER_ID.雾:
      setWeather(state, (state.time.season ?? 1) === 4 ? WEATHER_ID.细雪 : WEATHER_ID.雾雨);
      break;
    default:
      if (r0(rng, 2)) setWeather(state, WEATHER_ID.雾);
      else setWeather(state, (state.time.season ?? 1) === 4 ? WEATHER_ID.细雪 : WEATHER_ID.雾雨);
  }
  postRain(state);
}

export function qolChangeWeatherSystem19(state: GameState, _noWeather: boolean, _rng: Rng): void {
  resetHeader(state);
  if (weatherOf(state) !== WEATHER_ID.晴 || windOf(state) !== WIND_ID.无风) {
    setWeather(state, WEATHER_ID.晴);
    setWind(state, WIND_ID.无风);
  }
  qolPossibilityAvalancheWinter(state);
}

export function qolChangeWeatherSystem20(state: GameState, _noWeather: boolean, rng: Rng): void {
  resetHeader(state);
  const w = ensureWeatherState(state);
  switch (weatherOf(state)) {
    case WEATHER_ID.大雨: {
      const r = rng.int(3);
      setWeather(state, r <= 1 ? WEATHER_ID.暴雨 : w.atmosphericInstability <= 0 ? WEATHER_ID.冰雹 : WEATHER_ID.冰霰);
      break;
    }
    case WEATHER_ID.暴雨: {
      const r = rng.int(4);
      if (r === 0) setWeather(state, WEATHER_ID.大雨);
      else if (r === 1) setWeather(state, w.atmosphericInstability <= 0 ? WEATHER_ID.冰雹 : WEATHER_ID.冰霰);
      break;
    }
    case WEATHER_ID.冰霰:
    case WEATHER_ID.冰雹:
      setWeather(state, WEATHER_ID.暴雨);
      break;
    default:
      setWeather(state, WEATHER_ID.暴雨);
  }
  postRain(state);
  if (w.atmosphericInstability <= 0 && r0(rng, 4)) qolDownburstGeneration(state, r0(rng, 2));
  else if (windOf(state) !== WIND_ID.无风) setWind(state, WIND_ID.无风);
  noAvalanchePost(state);
}

export function runQolChangeWeatherSystem(state: GameState, noWeather: boolean, rng: Rng): boolean {
  switch (ensureWeatherState(state).nowWeatherControl) {
    case 1: qolChangeWeatherSystem1(state, noWeather, rng); return true;
    case 2: qolChangeWeatherSystem2(state, noWeather, rng); return true;
    case 3: qolChangeWeatherSystem3(state, noWeather, rng); return true;
    case 4: qolChangeWeatherSystem4(state, noWeather, rng); return true;
    case 5: qolChangeWeatherSystem5(state, noWeather, rng); return true;
    case 6: qolChangeWeatherSystem6(state, noWeather, rng); return true;
    case 7: qolChangeWeatherSystem7(state, noWeather, rng); return true;
    case 8: qolChangeWeatherSystem8(state, noWeather, rng); return true;
    case 9: qolChangeWeatherSystem9(state, noWeather, rng); return true;
    case 10: qolChangeWeatherSystem10(state, noWeather, rng); return true;
    case 11: qolChangeWeatherSystem11(state, noWeather, rng); return true;
    case 12: qolChangeWeatherSystem12(state, noWeather, rng); return true;
    case 13: qolChangeWeatherSystem13(state, noWeather, rng); return true;
    case 14: qolChangeWeatherSystem14(state, noWeather, rng); return true;
    case 15: qolChangeWeatherSystem15(state, noWeather, rng); return true;
    case 16: qolChangeWeatherSystem16(state, noWeather, rng); return true;
    case 17: qolChangeWeatherSystem17(state, noWeather, rng); return true;
    case 18: qolChangeWeatherSystem18(state, noWeather, rng); return true;
    case 19: qolChangeWeatherSystem19(state, noWeather, rng); return true;
    case 20: qolChangeWeatherSystem20(state, noWeather, rng); return true;
    case 21: qolChangeWeatherSystem21(state, noWeather, rng); return true;
    default: return false;
  }
}
