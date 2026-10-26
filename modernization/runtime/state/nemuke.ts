/**
 * Parity QA Wave 7 — `NEMUKE()` 睡意 (sleepiness) shared subsystem.
 *
 * eraTW gates three rest commands off a single sleepiness value
 * (`COMMON.ERB:1513-1518 @NEMUKE`):
 *
 *   NEMUKE() = TIME + 1440 * DAY - TFLAG:你起床 - TFLAG:198(昼寝)
 *                              - CFLAG:MASTER:清醒劑
 *
 * i.e. **minutes elapsed since the master last woke**, minus a nap credit
 * (90 after a 昼寝) and a sobriety-stimulant credit (DLC, deferred → 0).
 * It grows from 0 at wake through the day; the gates are:
 *   - `@COM_ABLE402 就寝`  — `NEMUKE() < 720 → RETURN 0` (need ~12h awake)
 *   - `@COM_ABLE417 昼寝`  — `180 ≤ NEMUKE() ≤ 720` (the 3h–12h window)
 *   - `@COM_ABLE403 休憩`  — `NEMUKE() >= 960 → RETURN 0` (too tired to rest,
 *     must sleep)
 *
 * **Time model.** The modernized `state.time.tickValue` is the absolute
 * `DAY*1440 + TIME` stamp — it does not wrap at midnight. Normal elapsed
 * time advances the authoritative `dayIndex`; a direct negative H TIME
 * correction does not decrement DAY. ERA's `TIME` resets
 * each day (`TIME -= 1440`) while `DAY++`, so `TIME + 1440*DAY` is ERA's
 * monotonic equivalent. Therefore `absoluteTime(state) === tickValue`,
 * and `你起床` (set on wake to `TIME + 1440*DAY`) holds a `tickValue`.
 *
 * **Wake tracking.** `TFLAG:你起床` is set on wake (`BEFORETRAIN.ERB:219`)
 * and on new-game seed (= 480, the 08:00 start). The sleep handler
 * (`handlers/sleep.ts`) sets it after fast-forwarding to next-day 08:00.
 * Nothing in the base game adjusts it thereafter (only magic-DLC does).
 *
 * **Deferred.** `TFLAG:198(昼寝)` is set to 90 by COMF417 and reset daily
 * by `runDayEnd`; `CFLAG:清醒劑` (id 385) has no base-game writer (the
 * 醒酒 consumer is deferred) → reads 0. Both are read here regardless so
 * the formula stays faithful when those subsystems land.
 */

import type { GameState } from "./game-state.js";
import { CFLAG_ID } from "./settlement.js";
import { TFLAG_ID, getTflag } from "./tflag.js";

/** The absolute game time in minutes (= ERA `TIME + 1440 * DAY`).
 *  Equal to `state.time.tickValue`; named for clarity at call sites. */
export function absoluteTime(state: GameState): number {
  return state.time.tickValue;
}

/**
 * `NEMUKE()` — minutes since last wake, minus nap + stimulant credits
 * (`COMMON.ERB:1517`). Never clamped; callers compare against the gate
 * thresholds. Unset `你起床` (0) means "woke at absolute time 0" — only
 * seen in bare test fixtures; the live game seeds 480 on new game.
 */
export function nemuke(state: GameState): number {
  const wake = getTflag(state, TFLAG_ID.あなた起床);
  const nap = getTflag(state, TFLAG_ID.昼寝);
  const stimulant = state.master.state.CFLAG[CFLAG_ID.清醒劑] ?? 0;
  return absoluteTime(state) - wake - nap - stimulant;
}
