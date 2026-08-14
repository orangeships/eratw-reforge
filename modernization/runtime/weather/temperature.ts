/**
 * Weather S4 — `@GET_現在気温` (`天候予測システム.ERB:1544-2985`): current air
 * temperature with the four corrections layered on the base table.
 *
 * The base table (`気温_<季節>_<T>_<hour>時`, 576 constants) is already in
 * `state/weather-temp-table.ts` via `baseTemperature`. This module adds the
 * four corrections the upstream applies after the base lookup:
 *
 *   補正温度 = 基礎気温 + 気流補正×10 − 高度補正×10           (per-map)
 *   then, outdoor + sunny → 補正温度 += 日射補正
 *         indoor          → 補正温度 pulled toward 20 °C (建造物補正)
 *
 * Units: everything is 0.1 °C (200 = 20.0 °C), matching the base table.
 * `気流補正` / `高度補正` are whole-°C values scaled ×10; `日射補正` /
 * `建造物補正` are already in 0.1 °C.
 *
 * **Faithful scope:** the built maps (神社 / 人間之里 / 迷いの竹林 / 霧の湖 /
 * 自宅) all have altitude 0, so the reachable path is base + airflow + solar/
 * building. The unbuilt fixed-temp areas (地底 灼熱=40°C / 月都=20°C / 魔界
 * 冰雪=−10°C) and non-zero altitudes (寺=3 / 冥界=10 / 山麓=6 / 山頂=12·天界20)
 * are kept as documented constants but are unreachable in the current map set.
 * `IS_NO_SUN` (sunless outdoor areas, e.g. 地底) is likewise moot for built
 * maps — every built outdoor room sees the sun.
 */

import type { GameState } from "../state/game-state.js";
import type { TimeSlot } from "../state/game-state.js";
import type { WeatherState } from "../state/weather-state.js";
import { getWeatherState } from "../state/weather-state.js";
import { baseTemperatureNow, weatherIndexNow } from "../state/weather.js";
import { seasonOf } from "../world/calendar.js";
import { mapKeyOf } from "../world/location-predicates.js";
import { roomProps } from "../command/comable/room-props.js";

const SEASON_SPRING = 1;
const SEASON_SUMMER = 2;
const SEASON_AUTUMN = 3;
const SEASON_WINTER = 4;

/**
 * `気流補正` — airflow correction keyed on `NOW_WEATHER_CONTROL` (1-21), from
 * warm/cold air power (`POWER_WARM_AIR`/`POWER_COLD_AIR`, 1-5), the 積乱雲
 * development stage (`CAN_CUMULUS:0`, cases 7/8) and typhoon (`IS_TYPHOON:1`,
 * cases 16/17/21). Whole-°C (the caller scales ×10). Emuera `/` truncates
 * toward zero, matched with `Math.trunc`.
 */
export function airflowCorrection(
  weatherControl: number,
  powerWarmAir: number,
  powerColdAir: number,
  canCumulus0: number,
  isTyphoon1: number,
  season: number,
): number {
  const w = powerWarmAir;
  const c = powerColdAir;
  switch (weatherControl) {
    case 1: // 春・秋(基本)
    case 2: // 春・秋(温暖前線接近)
      return (w - c) * 2;
    case 3: // 春・秋(暖域)
      return w * 2;
    case 4: // 春・秋(寒冷前線通過)
    case 5: // 春・秋(寒冷渦接近)
      return -c * 2;
    case 6: // 夏(基本)
      return (w - 3) * 3;
    case 7: // 夏(夕立接近)
      if (canCumulus0 >= 1 && canCumulus0 <= 3) return (w - 3) * 3 - Math.trunc(c / 2);
      if (canCumulus0 === 4 || canCumulus0 === 5) return -c;
      return 0;
    case 8: // 夏(夕立通過後)
      if (canCumulus0 >= 1 && canCumulus0 <= 3) return (w - 3) * 3 - c;
      if (canCumulus0 === 4 || canCumulus0 === 5) return -c * 2;
      return 0;
    case 9: // 冬(基本)
      return (w - c) * 2;
    case 10: // 冬(日本海低気圧接近)
      return w * 2;
    case 11: // 冬(日本海低気圧通過)
    case 12: // 冬(南岸低気圧接近)
    case 13: // 冬(寒冷渦接近)
      return -c * 2;
    case 14: // 梅雨・秋雨(基本)
      return w >= c ? w : -c;
    case 15: // 梅雨・秋雨(末期+台風) / 先駆降雨帯
      return w * 2;
    case 16: // 台風(強風域)
    case 21: // 台風(暴風域・最接近)
    case 17: // 台風(台風の目)
      return season === SEASON_SUMMER
        ? (w - 3) * 3 + isTyphoon1
        : (w - c) * 2 + isTyphoon1;
    case 18: // 霧
      return season === SEASON_SUMMER ? (w - 3) * 3 : (w - c) * 2;
    case 19: // 疑似好天
      return Math.trunc((-c * 15) / 10);
    case 20: // 集中豪雨
      return (w - c) * 2;
    default:
      return 0;
  }
}

/** Per-map altitude constants (`高度補正`, whole-°C, SUBTRACTED). Built maps
 *  are all 0; the rest are faithful-but-unreachable. */
const ALTITUDE: Record<string, number> = {
  神社: 0,
  人間之里: 0,
  自宅: 0,
  迷いの竹林: 0,
  霧の湖: 0,
  // Unbuilt (kept faithful; unreachable in the current map set):
  寺: 3,
  冥界: 10,
  山麓: 6,
  山頂: 12,
};

/** `高度補正(GET_MAPID(AT_AREA()))` — whole-°C altitude drop for a location's
 *  map. Unknown maps default to 0 (sea-level). */
export function altitudeCorrection(mapKey: string): number {
  return ALTITUDE[mapKey] ?? 0;
}

/**
 * `日射補正` — solar gain for an OUTDOOR room under 少云/晴/多云, by weather ×
 * time-of-day × season. 0.1 °C. `weatherIndex`: 0 少云 / 1 晴 / 2 多云 (others
 * give no solar gain). `minuteOfDay` = `TIME:0` (0..1439).
 */
export function solarCorrection(
  weatherIndex: number,
  minuteOfDay: number,
  season: number,
): number {
  let solar = 0;
  if (weatherIndex === 0 || weatherIndex === 1) {
    // 少云 / 晴
    if (
      (minuteOfDay >= 360 && minuteOfDay <= 599) ||
      (minuteOfDay >= 960 && minuteOfDay <= 1079)
    ) {
      solar += 15;
    } else if (minuteOfDay >= 600 && minuteOfDay <= 959) {
      solar += 20;
    }
    if (season === SEASON_SPRING || season === SEASON_AUTUMN) solar += 10;
    else if (season === SEASON_SUMMER) solar += 15;
    else if (season === SEASON_WINTER) solar += 10;
  } else if (weatherIndex === 2) {
    // 多云
    solar += 5;
  }
  return solar;
}

/**
 * `建造物補正` — indoors, the temperature is pulled toward 20 °C: below 25 °C
 * it rises +5 °C (capped at 20 °C), above 25 °C it falls −4 °C (floored at
 * 25 °C). Input/output 0.1 °C.
 */
export function buildingCorrection(temp01: number): number {
  if (temp01 <= 250) return Math.min(200, temp01 + 50);
  return Math.max(250, temp01 - 40);
}

/** Airflow correction sourced straight from a `WeatherState` + season. */
function airflowOf(w: WeatherState, season: number): number {
  return airflowCorrection(
    w.nowWeatherControl,
    w.powerWarmAir,
    w.powerColdAir,
    w.canCumulus[0],
    w.isTyphoon[1],
    season,
  );
}

/**
 * `GET_現在気温` — the corrected current air temperature (0.1 °C) at the
 * master's location. Base table + airflow − altitude, then outdoor solar gain
 * or indoor pull-to-20°C. Pure read over `state`.
 */
export function getCurrentTemperature(state: GameState): number {
  const time: TimeSlot = state.time;
  const w = getWeatherState(state);
  const season = seasonOf(time);
  const location = state.master.location;

  const base = baseTemperatureNow(time); // 0.1 °C
  const airflow = airflowOf(w, season); // whole °C
  const altitude = altitudeCorrection(mapKeyOf(location)); // whole °C
  let temp = base + airflow * 10 - altitude * 10;

  const outdoor = !roomProps(location).indoor;
  if (outdoor) {
    const minuteOfDay = (((time.tickValue % 1440) + 1440) % 1440);
    temp += solarCorrection(weatherIndexNow(time), minuteOfDay, season);
  } else {
    temp = buildingCorrection(temp);
  }
  return temp;
}
