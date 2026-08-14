/**
 * S3 weather calendar helpers from `天候予測システム.ERB`.
 *
 * eraTW weather timestamps are triples `[DAY:2 season, DAY:3 date, TIME:0]`.
 * These helpers intentionally keep that shape so low-pressure timing can be
 * audited against the ERB formulas line-by-line.
 */

import type { GameState } from "../state/game-state.js";
import type { WeatherDateTime } from "../state/weather-state.js";

export const SEASON_COUNT = 4;
export const DAYS_PER_WEATHER_SEASON = 31;
export const MINUTES_PER_DAY = 1440;
export const TERMS_PER_SEASON = 6;

export function currentWeatherDateTime(state: GameState): WeatherDateTime {
  return [
    state.time.season ?? 1,
    state.time.date ?? 1,
    Math.max(0, Math.min(1439, state.time.hourOfDay * 60)),
  ];
}

export function calculateAddTime(
  season: number,
  date: number,
  minute: number,
  addMinutes: number,
): WeatherDateTime {
  let total =
    (normalizeSeason(season) - 1) * DAYS_PER_WEATHER_SEASON * MINUTES_PER_DAY +
    (normalizeDate(date) - 1) * MINUTES_PER_DAY +
    normalizeMinute(minute) +
    Math.trunc(addMinutes);

  const year = SEASON_COUNT * DAYS_PER_WEATHER_SEASON * MINUTES_PER_DAY;
  total = ((total % year) + year) % year;

  const seasonIndex = Math.floor(total / (DAYS_PER_WEATHER_SEASON * MINUTES_PER_DAY));
  const remSeason = total % (DAYS_PER_WEATHER_SEASON * MINUTES_PER_DAY);
  const dateIndex = Math.floor(remSeason / MINUTES_PER_DAY);
  const minuteOfDay = remSeason % MINUTES_PER_DAY;

  return [seasonIndex + 1, dateIndex + 1, minuteOfDay];
}

export function calculateAddTerm(season: number, term: number, addTerms: number): [number, number] {
  let total = (normalizeSeason(season) - 1) * TERMS_PER_SEASON + (normalizeTerm(term) - 1) + Math.trunc(addTerms);
  const year = SEASON_COUNT * TERMS_PER_SEASON;
  total = ((total % year) + year) % year;
  return [Math.floor(total / TERMS_PER_SEASON) + 1, (total % TERMS_PER_SEASON) + 1];
}

export function compareWeatherDateTime(a: WeatherDateTime, b: WeatherDateTime): number {
  return ordinal(a) - ordinal(b);
}

export function isBefore(a: WeatherDateTime, b: WeatherDateTime): boolean {
  return compareWeatherDateTime(a, b) < 0;
}

export function isZeroDateTime(t: WeatherDateTime): boolean {
  return t[0] === 0 && t[1] === 0 && t[2] === 0;
}

export function zeroDateTime(): WeatherDateTime {
  return [0, 0, 0];
}

function ordinal(t: WeatherDateTime): number {
  if (isZeroDateTime(t)) return -1;
  return (normalizeSeason(t[0]) - 1) * DAYS_PER_WEATHER_SEASON * MINUTES_PER_DAY +
    (normalizeDate(t[1]) - 1) * MINUTES_PER_DAY +
    normalizeMinute(t[2]);
}

function normalizeSeason(season: number): number {
  if (!Number.isFinite(season)) return 1;
  const s = Math.trunc(season);
  if (s < 1) return 1;
  if (s > SEASON_COUNT) return ((s - 1) % SEASON_COUNT) + 1;
  return s;
}

function normalizeDate(date: number): number {
  if (!Number.isFinite(date)) return 1;
  return Math.max(1, Math.min(DAYS_PER_WEATHER_SEASON, Math.trunc(date)));
}

function normalizeMinute(minute: number): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.trunc(minute)));
}

function normalizeTerm(term: number): number {
  if (!Number.isFinite(term)) return 1;
  return Math.max(1, Math.min(TERMS_PER_SEASON, Math.trunc(term)));
}
