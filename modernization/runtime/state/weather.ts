/**
 * Deterministic weather + air-temperature subsystem.
 *
 * eraTW source (eratw-sub-modding-main/ERB/):
 *   - `天候システム.ERH` — `#DIM CONST 気温_<季節>_<T>_<N>時` base temp
 *     tables (0.1 °C), 4 seasons × 6 terms × 24 hours = 576 entries.
 *   - `日時天候管理.ERB` — `@GET_WEATHER` (16-state display table, non-DLC
 *     branch at line 232), `@CHANGE_TIMEZONE` (8-division 現在時間帯),
 *     `@GET_TERM` (date-within-season → term 1..6).
 *   - `天候予測システム.ERB::@GET_現在気温` — base temp lookup; the per-region
 *     補正 (高度/気流/建造物/日射) layered on top are DLC, deferred here.
 *
 * Parity-QA scope (locked decision 2026-06-21): the live weather-SELECTION
 * logic (`qol_CHANGE_WEATHER_SYSTEM_*`, `WEATHER_FORECAST_1YEAR`,
 * `FLAG:異常気象` overlays) is the QoL/DLC weather patch and is NOT ported.
 * What IS ported faithfully:
 *   - Base air temperature (season × term × hour) — real eraTW data.
 *   - `@GET_TERM` term derivation — bit-exact (`((date-1)/5)+1`, date 31→30).
 *   - The 16-state weather display table (non-DLC branch).
 *   - `@CHANGE_TIMEZONE` 8-division timeband.
 * What is an explicit DETERMINISTIC APPROXIMATION (clearly marked): the
 * `TIME:5` weather INDEX. Same (season, date, timeband) always yields the
 * same weather, season-appropriate, but it is NOT the bit-exact qol-patched
 * selection. DLC prediction/control/积雪/台风/异常気象 are all deferred.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { GameState, TimeSlot } from "./game-state.js";
import { TEMP_TABLE } from "./weather-temp-table.js";
import { getWeatherState } from "./weather-state.js";
import { mapIdOfLocation } from "../world/location-predicates.js";

/** Typed view over the generated JSON (string keys → numeric index). */
const TEMP: Readonly<Record<number, Readonly<Record<number, readonly number[]>>>> = TEMP_TABLE;

/** `@GET_TERM` (`天候予測システム.ERB:4`) — date (1..30, 31→30) → term 1..6. */
export function getTerm(date: number): number {
  let d = date;
  if (d === 31) d = 30; // SIF ARG == 31  ARG = 30
  return Math.floor((d - 1) / 5) + 1; // eraTW `/` truncates
}

/**
 * `@GET_現在気温` base core — base air temperature in 0.1 °C (no DLC 補正).
 * Reads `気温_<season>_<term>_<hour>時` from `天候システム.ERH`.
 */
export function baseTemperature(season: number, date: number, hour: number): number {
  const term = getTerm(date);
  const arr = TEMP[season]?.[term];
  if (!arr) return 0;
  return arr[hour] ?? 0;
}

/** Current base temperature (0.1 °C) over a `TimeSlot`. */
export function baseTemperatureNow(time: TimeSlot): number {
  const season = time.season ?? 1;
  const date = time.date ?? 1;
  return baseTemperature(season, date, time.hourOfDay);
}

/**
 * `@CHANGE_TIMEZONE` 現在時間帯 (`日時天候管理.ERB:140-165`) — 8-division
 * timeband from minutes-within-day (TIME, 0..1439): 1=未明 2=明け方 3=朝
 * 4=昼前 5=昼過ぎ 6=夕方 7=夜のはじめ頃 8=夜遅く.
 */
export function currentTimezone(hourOfDay: number): number {
  if (hourOfDay < 3) return 1; // 0:00-2:59 未明
  if (hourOfDay < 6) return 2; // 3:00-5:59 明け方
  if (hourOfDay < 9) return 3; // 6:00-8:59 朝
  if (hourOfDay < 12) return 4; // 9:00-11:59 昼前
  if (hourOfDay < 15) return 5; // 12:00-14:59 昼過ぎ
  if (hourOfDay < 18) return 6; // 15:00-17:59 夕方
  if (hourOfDay < 21) return 7; // 18:00-20:59 夜のはじめ頃
  return 8; // 21:00-23:59 夜遅く
}

/**
 * `@CHANGE_TIMEZONE` 8-division display names (`日時天候管理.ERB:141-164`).
 * Indexed 1..8, translated from the upstream labels in `日時天候管理.ERB`.
 *
 * NOTE: eraTW's status line shows a FINER classical form `(卯时三点-晓-)`
 * via `GET_CLASSICAL_HOUR` (PANIMATION_TOHO.ERB:283) — the twelve-時辰 +
 * 刻 + 晓/朝/昼/夕/夜 suffix. That is a separate, larger port; this 8-division
 * name is the coarser but faithful `現在時間帯` label until then.
 */
const TIMEZONE_NAMES = [
  "", "凌晨", "黎明", "早晨", "上午", "午后", "傍晚", "入夜", "深夜",
] as const;

/** Display name for a `currentTimezone` band (1..8). */
export function timezoneName(timeband: number): string {
  return TIMEZONE_NAMES[timeband] ?? "";
}

/**
 * Weather state indices — the non-DLC `@GET_WEATHER` table
 * (`日時天候管理.ERB:232`):
 *   0 少云 / 1 晴 / 2 多云 / 3 阴 / 4 雨 / 5 大雨 / 6 雾雨 / 7 雾
 *   8 雪 / 9 大雪 / 10 细雪 / 11 雾雪 / 12 雨夹雪 / 13 冰霰 / 14 暴雨 / 15 冰雹
 */
export const WEATHER_NAMES = [
  "少云", "晴", "多云", "阴", "雨", "大雨", "雾雨", "雾",
  "雪", "大雪", "细雪", "雾雪", "雨夹雪", "冰霰", "暴雨", "冰雹",
] as const;

/** `@GET_WEATHER` non-DLC display name for a weather index. */
export function weatherName(weatherIndex: number): string {
  return WEATHER_NAMES[weatherIndex] ?? "少云";
}

/**
 * DETERMINISTIC APPROXIMATION of `TIME:5` weather index.
 *
 * The real selection lives in the QoL/DLC weather patch (deferred). This
 * picks a season-appropriate weather deterministically from (season, date,
 * timeband) so the same game-moment always shows the same weather, and
 * weather changes when the 8-division timeband changes (mirroring
 * `@CHANGE_TIMEZONE` → `@CHANGE_WEATHER`). NOT bit-exact vs the patched
 * original; see file header.
 *
 * Pools are season-flavored: winter leans snow/overcast, summer leans
 * rain/downpour, spring/autumn mix clouds/rain/fog.
 */
const WEATHER_POOLS: Record<number, readonly number[]> = {
  1: [0, 1, 2, 3, 3, 4, 7, 14], // 春: 少云/晴/多云/阴/阴/雨/雾/疏雨(暴雨表外用14近似)
  2: [1, 2, 3, 4, 5, 5, 14, 15], // 夏: 晴/多云/阴/雨/大雨/大雨/暴雨/冰雹
  3: [0, 2, 3, 3, 4, 7, 8, 14], // 秋: 少云/多云/阴/阴/雨/雾/雪/暴雨
  4: [2, 3, 3, 8, 9, 10, 11, 12], // 冬: 多云/阴/阴/大雪/细雪/雾雪/雨夹雪/冰霰
};

export function weatherIndexApprox(season: number, date: number, timeband: number): number {
  const pool = WEATHER_POOLS[season] ?? WEATHER_POOLS[1]!;
  const d = date < 1 ? 1 : date;
  const idx = (((d * 7 + timeband * 3) % pool.length) + pool.length) % pool.length;
  return pool[idx]!;
}

/** Current (approximate) weather index over a `TimeSlot`. */
export function weatherIndexNow(time: TimeSlot): number {
  const season = time.season ?? 1;
  const date = time.date ?? 1;
  return weatherIndexApprox(season, date, currentTimezone(time.hourOfDay));
}

/** Current weather display name over a `TimeSlot`. */
export function weatherNameNow(time: TimeSlot): string {
  return weatherName(weatherIndexNow(time));
}

/**
 * `@INFO_現在の気温` format (`INFO.ERB:1519`) — `気温{N/10}.{ABS(N%10)}℃`
 * with N in 0.1 °C. eraTW truncates `/` and uses `ABS` for the fractional
 * digit so negatives render like `气温-2.4℃`.
 */
export function formatTemperature(temp01: number): string {
  const whole = Math.trunc(temp01 / 10);
  const frac = Math.abs(temp01 % 10);
  return `气温${whole}.${frac}℃`;
}

/**
 * `@GetColorTemperature` (`INFO.ERB`) — temperature (0.1 °C) → display
 * color. Thresholds `T_Threshold = [-3000,-50,0,50,100,150,200,250,300,350]`
 * scanned high→low, first `>=` wins. Colors from `天候システム.ERH:817-826`
 * (`C_気温_*`, 0xRRGGBB). CSS hex equivalents.
 */
export function temperatureColor(temp01: number): string {
  if (temp01 >= 350) return "#b40068"; // C_気温_猛暑
  if (temp01 >= 300) return "#ff2800"; // C_気温_真夏
  if (temp01 >= 250) return "#fa9900"; // C_気温_夏
  if (temp01 >= 200) return "#faf500"; // C_気温_暖
  if (temp01 >= 150) return "#ffff96"; // C_気温_温
  if (temp01 >= 100) return "#fffff0"; // C_気温_涼
  if (temp01 >= 50) return "#b9ebff"; // C_気温_冷
  if (temp01 >= 0) return "#0096ff"; // C_気温_寒
  if (temp01 >= -50) return "#0041ff"; // C_気温_冬
  return "#002080"; // C_気温_酷寒
}

/** Time-of-day noun (8-division 現在時間帯 → Chinese). */
const TIMEBAND_NOUN = [
  "", "深夜", "黎明", "清晨", "上午", "午后", "傍晚", "初夜", "深夜",
];

/** Weather-index → scenery descriptor (non-DLC 16-state table). */
const WEATHER_SCENERY = [
  "天空中飘着几朵云", // 0 少云
  "晴空万里", // 1 晴
  "云层铺满了天空", // 2 多云
  "天空阴沉沉的", // 3 阴
  "雨淅淅沥沥地下着", // 4 雨
  "大雨倾盆", // 5 大雨
  "细雨如雾", // 6 雾雨
  "雾气弥漫", // 7 雾
  "雪花纷纷扬扬", // 8 雪
  "大雪纷飞", // 9 大雪
  "细雪静静飘落", // 10 细雪
  "雾气中夹杂着雪", // 11 雾雪
  "雨夹雪落下", // 12 雨夹雪
  "冰霰敲打着地面", // 13 冰霰
  "暴雨如注", // 14 暴雨
  "冰雹砸落下来", // 15 冰雹
];

/**
 * Weather scenery feedback for callers that explicitly request it. eraTW's
 * `@COM495 空を眺める` body has no text (just TIME+1); its separate
 * `@MESSAGE_COM495` describes the current sky and weather.
 * Deterministic: same game-moment → same scene.
 *
 * Legacy variant taking `TimeSlot` only — kept for the few direct tests.
 * Reads the deterministic **approximation** `weatherIndexNow` (season×
 * date×timeband) and does NOT consult the simulated `gensokyoWeatherSystem`.
 * Callers that do want weather scenery should prefer `skySceneTextFromState`
 * so it matches the real weather the runtime has been ticking.
 */
export function skySceneText(time: TimeSlot): string {
  const tz = currentTimezone(time.hourOfDay);
  const w = weatherIndexNow(time);
  return `${TIMEBAND_NOUN[tz]}，${WEATHER_SCENERY[w] ?? WEATHER_SCENERY[0]!}。`;
}

/**
 * Production sky-gaze narration (comf495) — reads the **simulated** weather
 * (`gensokyoWeatherSystem[masterRegionId]`) so the scenery the player reads
 * after looking up matches the weather the runtime has been ticking. Falls
 * back to the deterministic approximation if the runtime hasn't ticked
 * weather yet (a fresh game state without a weather snapshot).
 */
export function skySceneTextFromState(state: GameState): string {
  return skySceneTextFromStateAtLocation(state, state.master.location);
}

/**
 * Production sky-gaze narration for an explicitly rendered location.
 *
 * Scene prose can be requested for a location other than the master's current
 * room (the map/look preview does this), so the weather region must follow the
 * location being rendered rather than silently falling back to the master.
 */
export function skySceneTextFromStateAtLocation(state: GameState, location: string): string {
  const tz = currentTimezone(state.time.hourOfDay);
  const w = getWeatherState(state);
  const regionId = mapIdOfLocation(location);
  const realWeather = (regionId !== null ? w.gensokyoWeatherSystem[regionId] : undefined)
    ?? w.gensokyoWeatherSystem[0]
    ?? weatherIndexNow(state.time);
  return `${TIMEBAND_NOUN[tz]}，${WEATHER_SCENERY[realWeather] ?? WEATHER_SCENERY[0]!}。`;
}
