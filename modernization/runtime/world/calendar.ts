/**
 * Phase 7.1b — calendar / season / festival, faithful to eraTW
 * `日時天候管理.ERB` + `祭日イベント.ERB::FESTIVAL` + `DAY.csv`.
 *
 * eraTW's `DAY` array (`CSV/DAY.csv`):
 *   - `DAY:0` 総日数  — total day count (the modern runtime's `dayIndex` +
 *     1; NEWGAME seeds `DAY = 1`).
 *   - `DAY:2` 季節   — 1=春 spring, 2=夏 summer, 3=秋 autumn, 4=冬 winter
 *     (`天候システム.ERH:885-888` 季节_春..冬).
 *   - `DAY:3` 日期   — day-of-month 1–31; on `>31` wraps to 1 and season++
 *     (`日時天候管理.ERB:14-22` `@CHANGE_MONTH`); season wraps `>4 → 1`.
 *
 * There is NO real-world month — a "month" IS a season (31 days), named
 * 春之月/夏之月/秋之月/冬之月 (`@GET_MONTH`). The (season, date) pair
 * cycles every 4×31 = 124 days; `DAY:0` is monotonic. So season/date are
 * NOT derivable from `dayIndex` alone and are tracked as explicit
 * `TimeSlot` fields, advanced once per day-end (`INFO.ERB:1262 DAY:3++`
 * fires from the day-end path = `runDayEnd`).
 *
 * `FESTIVAL()` (`祭日イベント.ERB:6`) returns a festival name from
 * (season, date) — a fixed table. 節分 = winter date 3 (NOT real Feb 3);
 * this unlocks COMF364 豆まき. White Day = spring date 14; Valentine =
 * winter date 14.
 *
 * Weekday (`@GET_DAY`/`@IS_WEEKDAY`): `DAY % 7` with `DAY` 1-based →
 * 0=日 1=月 2=火 3=水 4=木 5=金 6=土. The modern `dayIndex` is 0-based
 * (= upstream `DAY - 1`), so weekday = `(dayIndex + 1) % 7`.
 *
 * `TimeSlot.season` / `TimeSlot.date` are optional — unset defaults to
 * the NEWGAME seed (spring, date 1) so existing test fixtures need no
 * change.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { TimeSlot } from "../state/index.js";

/** 季节_春 = 1. */
export const SEASON_SPRING = 1;
/** 季节_夏 = 2. */
export const SEASON_SUMMER = 2;
/** 季节_秋 = 3. */
export const SEASON_AUTUMN = 3;
/** 季节_冬 = 4. */
export const SEASON_WINTER = 4;

/** Days per eraTW "month" (season). */
export const DAYS_PER_SEASON = 31;

/** Current season (1-4), defaulting to spring (NEWGAME seed). */
export function seasonOf(time: TimeSlot): number {
  return time.season ?? SEASON_SPRING;
}

/** Current date (1-31), defaulting to 1 (NEWGAME seed). */
export function dateOf(time: TimeSlot): number {
  return time.date ?? 1;
}

/**
 * `@CHANGE_MONTH` (`日時天候管理.ERB:8-22`) — advance one day. Mutates
 * `time.date`/`time.season` in place: `date++`; if `> 31` → `date = 1` and
 * `season++`; if `season > 4` → `season = 1`. Called from `runDayEnd`
 * (the day-end site, mirroring `INFO.ERB:1262 DAY:3++`).
 */
export function advanceCalendarDay(time: TimeSlot): boolean {
  let date = dateOf(time) + 1;
  let season = seasonOf(time);
  let seasonWrapped = false;
  if (date > DAYS_PER_SEASON) {
    date = 1;
    season += 1;
    if (season > SEASON_WINTER) season = SEASON_SPRING;
    seasonWrapped = true;
  }
  time.date = date;
  time.season = season;
  return seasonWrapped;
}

/**
 * `@GET_MONTH(ARG)` (`日時天候管理.ERB:191-200`) — season → month name
 * (无之月/春之月/夏之月/秋之月/冬之月, index 0 unused).
 */
export function monthName(season: number): string {
  const names = ["无之月", "春之月", "夏之月", "秋之月", "冬之月"];
  return names[season] ?? "无之月";
}

/** Season → Chinese season name (春/夏/秋/冬). */
export function seasonName(season: number): string {
  const names = ["", "春", "夏", "秋", "冬"];
  return names[season] ?? "";
}

/**
 * `@FESTIVAL` (`祭日イベント.ERB:6`) — festival name from (season, date),
 * or `""` if no festival. Faithful table. 節分 = winter 3, 情人節 =
 * winter 14, 白色情人節 = spring 14, 元旦 = spring 1, 聖誕節 = winter 25.
 */
export function festivalOf(season: number, date: number): string {
  switch (season) {
    case SEASON_SPRING:
      switch (date) {
        case 1: return "元旦";
        case 3: return "女兒節";
        case 11: return "母親節";
        case 13: return "白色情人節前日";
        case 14: return "白色情人節";
        case 25: return "例大祭";
        case 28: return "兔子之日";
      }
      return "";
    case SEASON_SUMMER:
      switch (date) {
        case 7: return "七夕";
        case 14: return "盂蘭盆節";
        case 28: return "兔子之日";
      }
      return "";
    case SEASON_AUTUMN:
      switch (date) {
        case 1: return "風神「二百十日」";
        case 15: return "十五夜";
        case 27: return "収穫祭";
        case 28: return "兔子之日";
        case 30: return "萬聖節";
      }
      return "";
    case SEASON_WINTER:
      switch (date) {
        case 3: return "節分";
        case 14: return "情人節";
        case 24: return "平安夜";
        case 25: return "聖誕節";
        case 28: return "兔子之日";
        case 31: return "大晦日";
      }
      return "";
    default:
      return "";
  }
}

/** `FESTIVAL()` over the current time. */
export function festivalNow(time: TimeSlot): string {
  return festivalOf(seasonOf(time), dateOf(time));
}

/**
 * `@GET_DAY(ARG)` (`日時天候管理.ERB:281-291`) — weekday name from
 * `DAY % 7` (0=日 1=月 2=火 3=水 4=木 5=金 6=土). `DAY` is 1-based; the
 * modern `dayIndex` is 0-based (= `DAY - 1`), so we use `(dayIndex + 1)
 * % 7`.
 */
export function weekdayName(dayIndex: number): string {
  const youbi = ["日", "月", "火", "水", "木", "金", "土"];
  return youbi[((dayIndex + 1) % 7 + 7) % 7]!;
}

/**
 * `@IS_WEEKDAY(ARG)` (`日時天候管理.ERB:243-250`) — 1 iff 月–金 (weekday
 * index 1–5). `DAY` 1-based → `(dayIndex + 1) % 7 ∈ [1,5]`.
 */
export function isWeekday(dayIndex: number): boolean {
  const d = ((dayIndex + 1) % 7 + 7) % 7;
  return d >= 1 && d <= 5;
}

/** `@IS_WEEKEND` — 1 iff 土日 (index 0 or 6). */
export function isWeekend(dayIndex: number): boolean {
  return !isWeekday(dayIndex);
}

/**
 * `@YOUBI_MATCH(ARG, ARG:1)` — 1 iff today's weekday glyph appears in the
 * glyph string (e.g. `"月水"` → Monday or Wednesday). The glyphs are the
 * single-char weekday names 日/月/火/水/木/金/土. Used by the work manifest
 * (`JOB_仕事内容.ERB`) for per-weekday job conditions like 魅魔 月水 / 萃香 月.
 */
export function youbiMatch(dayIndex: number, youbi: string): boolean {
  return youbi.includes(weekdayName(dayIndex));
}
