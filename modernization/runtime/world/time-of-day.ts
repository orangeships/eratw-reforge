/**
 * Phase 8 (Slice 5) — time-of-day zones + ambient time-of-day narration.
 *
 * Mirrors the upstream `TIME:2` (時間帯) band table in `日時天候管理.ERB`
 * (lines 115-137) — the 7-band day-part used by the main time-management
 * loop. Upstream fires a transition hook (`IF LOCAL != TIME:2 → TIME:2 =
 * LOCAL; TRYCALLFORM MOB_PLACE_…; CALL TIMEZONE_MOVE`) whenever the band
 * changes. We reproduce the *transition detection*; the per-character
 * MOB_PLACE redraw + TIMEZONE_MOVE are visual/scheduler concerns already
 * handled by the slot system, so the modern hook emits a single ambient
 * world NARRATION ("天色渐渐暗了下来……") when the band crosses.
 *
 * The 7 bands (`TIME:2`, minute-of-day 0..1439):
 *   1 早朝     240-359   (AM4-6)
 *   2 正午前   360-719   (AM6-12)
 *   3 昼       720-899   (PM0-3)
 *   4 昼下がり 900-1079  (PM3-6)
 *   5 夕       1080-1199 (PM6-8)
 *   6 夜       1200-1379 (PM8-11)
 *   7 深夜     0-239, ≥1380 (PM11-AM4)
 *
 * **DEFERRED:** the *per-character* time-of-day KOJO greetings (the
 * 朝の挨拶 / 夜の挨拶 personal dialogue dispatched through
 * `KOJO_MESSAGE_SEND`) — those need the DIALOGUE_DUE / KOJO pipeline and
 * per-chara message banks. This slice ships the *world*-level ambient band
 * narration only (the "watch the clock tick and the world change" exit
 * criterion); per-chara greetings are a later KOJO-integration slice.
 */

/** Time-of-day band ids (upstream `TIME:2`, 1..7). */
export type TimeZone = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The `TIME:2` band for an absolute tickValue. Takes the minute-of-day
 * (`tickValue mod 1440`, normalized for negatives) and buckets it exactly
 * as `日時天候管理.ERB` lines 115-137.
 */
export function timeZoneOf(tickValue: number): TimeZone {
  const min = ((Math.trunc(tickValue) % 1440) + 1440) % 1440;
  if (min >= 240 && min <= 359) return 1; // 早朝
  if (min >= 360 && min <= 719) return 2; // 正午前
  if (min >= 720 && min <= 899) return 3; // 昼
  if (min >= 900 && min <= 1079) return 4; // 昼下がり
  if (min >= 1080 && min <= 1199) return 5; // 夕
  if (min >= 1200 && min <= 1379) return 6; // 夜
  return 7; // 深夜 (0-239, ≥1380)
}

/** Short Chinese label for a band (status/debug display). */
export const TIME_ZONE_LABEL: Readonly<Record<TimeZone, string>> = {
  1: "早朝",
  2: "上午",
  3: "正午",
  4: "午后",
  5: "傍晚",
  6: "夜晚",
  7: "深夜",
};

/**
 * Ambient world narration shown when the band crosses INTO this zone.
 * One line per band — describes the world, not a character (per-chara
 * greetings deferred). Keyed by the destination band.
 */
export const TIME_ZONE_NARRATION: Readonly<Record<TimeZone, string>> = {
  1: "天边泛起鱼肚白，新的一天开始了。",
  2: "晨光铺满了庭院，已是上午时分。",
  3: "日头升至正中，正午到了。",
  4: "日影西斜，午后的暖意慵懒地铺开。",
  5: "天色渐渐染上暮色，到了傍晚。",
  6: "夜幕降临，四下静了下来。",
  7: "夜已深，万籁俱寂。",
};

/**
 * Did the time-of-day band change between two absolute tickValues?
 * Returns the new `TimeZone` if it crossed, else `null`. Mirrors the
 * upstream `IF LOCAL != TIME:2` transition check.
 */
export function crossedTimeZone(
  oldTick: number,
  newTick: number,
): TimeZone | null {
  const before = timeZoneOf(oldTick);
  const after = timeZoneOf(newTick);
  return before === after ? null : after;
}
