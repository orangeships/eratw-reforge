/**
 * Phase 8 — `advanceClock`: the single in-game time authority.
 *
 * Advances `state.time.tickValue` by `minutes`, recomputes `hourOfDay` /
 * `dayIndex`, and — faithfully to eraTW — fires the day-end settlement
 * (`runDayEnd`) once per crossed midnight. eraTW fires day-end from the
 * main loop when `TIME` crosses a day boundary (`@INFO_GO_NEXTDAY`,
 * `INFO.ERB:1232`: `SIF TIME <= 1440: RETURN`, then `DAY++; TIME -= 1440`);
 * `advanceClock` is the modernized equivalent: `dayIndex = floor(tickValue
 * / 1440)`, and each time that floor increments, `runDayEnd` runs.
 *
 * Both other time paths delegate here, and — since DAY-CYCLE-PLAN §S3 — all
 * three (sleep / command / scheduler) fire day-end on a midnight cross:
 *   - `tickClock` (scheduler/NOOP path): converts real-ms → minutes, calls
 *     `advanceClock` (runDayEnd defaults true). Kept as a thin wrapper so
 *     `runSchedulerTick` + `clock.test.ts` imports stay valid.
 *   - `advanceTimeTicks` (command path, `settlement.ts`): delegates with a
 *     null timestamp (day-end events are re-stamped by the caller) and
 *     RETURNS the day-end NARRATION(s) it produces on a midnight cross;
 *     `makeComfHandler` splices them into the command result (R1) so 熬夜
 *     past midnight narrates the wage/cleaning cashout. Other call sites use
 *     it as a `void` statement (no cross → `[]`).
 * Because `tickValue` is shared monotonic state, each midnight is crossed —
 * and settled — exactly once, by whichever path advances across it first.
 *
 * **Tick rate** (locked 8.1): 1 in-game minute = 1.5 real seconds
 * (`MS_PER_TICK`). 1440 min = 24 in-game hours = 36 real minutes per
 * in-game day.
 *
 * `tickValue` is monotonic minutes since boot (not modulo 1440); the
 * scheduler (`scheduler.ts`) does the modulo for slot lookup.
 *
 * **In-place mutation contract:** mutates `state.time` fields in place
 * (NOT replacing the `time` object). Load-bearing — `phase-4-apply-intent
 * .test.ts` asserts `expect(out.state.time).toBe(s.time)` (reference
 * identity). `runDayEnd` likewise mutates `flagStore`/`EX`/`TCVAR` in
 * place.
 *
 * **Module cycle (benign):** `settlement.ts` → `clock.ts` (advanceClock)
 * → `day-end.ts` (runDayEnd) → `settlement.ts` (EX_ID/grant/…). Every
 * cross-module reference is inside a function body, resolved at call time
 * after all modules are fully evaluated; no top-level evaluation uses the
 * imports. Safe under esbuild/vitest.
 */

import type { GameState } from "../state/index.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { runDayEnd } from "../state/day-end.js";
import { advanceDishFreshness } from "../state/dish-freshness.js";
import { progressBugTrap } from "../state/bug-catching.js";
import { CFLAG_ID, FLAG_ID, decrementEffectTimers } from "../state/settlement.js";
import { runWeatherSystemTick } from "../weather/weather-system.js";
import { advanceBanquetsInPlace } from "./banquet.js";

/** Real-time ms per in-game minute. */
export const MS_PER_TICK = 1500;

/** Weather changes and its side-effects are evaluated at the 8 upstream
 * `現在時間帯` boundaries (03:00, 06:00, …, 24:00). Long advances must cross
 * every boundary, not jump directly to their final hour: a typhoon from 08:00
 * to 23:00 is five weather ticks, exactly as fifteen one-hour advances are. */
const WEATHER_BOUNDARIES = [180, 360, 540, 720, 900, 1080, 1260, 1440] as const;

/** Advance the one-hour ordinary 同行 lease before follow projection. */
function advanceCompanionTimers(state: GameState, minutes: number): void {
  const elapsed = Math.max(0, Math.trunc(minutes));
  if (elapsed === 0) return;

  let hasOrdinaryCompanion = false;
  let hasDateCompanion = false;
  for (const slot of Object.values(state.charas)) {
    const timer = slot.state.CFLAG[CFLAG_ID.同行] ?? 0;
    if (timer <= 0) continue;
    if ((slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) {
      hasDateCompanion = true;
      continue;
    }
    const remaining = Math.max(timer - elapsed, 0);
    slot.state.CFLAG[CFLAG_ID.同行] = remaining;
    if (remaining > 0) hasOrdinaryCompanion = true;
  }

  const masterTimer = state.master.state.CFLAG[CFLAG_ID.同行] ?? 0;
  const masterOnDate = (state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0;
  if (masterTimer > 0 && !masterOnDate) {
    state.master.state.CFLAG[CFLAG_ID.同行] = Math.max(masterTimer - elapsed, 0);
  }
  if (!hasOrdinaryCompanion && !hasDateCompanion) {
    state.master.state.CFLAG[CFLAG_ID.同行] = 0;
  }
}

function nextWeatherBoundaryAfter(tick: number): number {
  const dayStart = Math.floor(tick / 1440) * 1440;
  const minute = ((tick % 1440) + 1440) % 1440;
  for (const boundary of WEATHER_BOUNDARIES) {
    if (boundary > minute) return dayStart + boundary;
  }
  return dayStart + 1440 + WEATHER_BOUNDARIES[0]!;
}

/** Advance one interval ending at a weather/day boundary. Callers have already
 * handled command-scoped effects (dish freshness and bug traps), so only
 * clock-derived world effects live here. */
function advanceClockInterval(
  state: GameState,
  minutes: number,
  now: () => number,
  shouldRunDayEnd: boolean,
): ObservationEvent[] {
  const oldDay = Math.floor(state.time.tickValue / 1440);
  const oldTick = state.time.tickValue;
  const prevHourOfDay = Math.floor((((oldTick % 1440) + 1440) % 1440) / 60);

  // `@CHARA_MOVEMENT` advances the ordinary 同行 lease from the elapsed
  // game time before `@同行処理` decides whether the NPC still follows.
  advanceCompanionTimers(state, minutes);

  state.time.tickValue += minutes;
  // TCVAR effect timers (媚薬/利尿剤/強制排卵/糖) 按经过分钟递减 (原版每 turn -1).
  decrementEffectTimers(state, minutes);
  const newMinOfDay = ((state.time.tickValue % 1440) + 1440) % 1440;
  state.time.hourOfDay = Math.floor(newMinOfDay / 60);
  state.time.dayIndex = Math.floor(state.time.tickValue / 1440);

  const events: ObservationEvent[] = [];
  for (const e of runWeatherSystemTick(state, now, prevHourOfDay)) {
    events.push(e);
  }

  if (shouldRunDayEnd) {
    const crossed = state.time.dayIndex - oldDay;
    for (let i = 0; i < crossed; i++) {
      const dayEnd = runDayEnd(state);
      for (const e of dayEnd.events) {
        events.push({ ...e, timestamp: now() });
      }
    }
  }
  const banquet = advanceBanquetsInPlace(state, minutes);
  events.push(...banquet.events.map((event) => ({ ...event, timestamp: now() })));
  return events;
}

/**
 * The single in-game time authority. Advance `state.time` by `minutes`
 * (ERA `TIME` units = minutes), recompute `hourOfDay` / `dayIndex`, emit a
 * `TIME_TICK` event, and fire `runDayEnd` once per crossed midnight
 * (restamping its events with `now()`). Mutates `state.time` in place.
 *
 * Parity QA P-16 — while time-stop (`FLAG:時間停止`) is active, the clock is
 * frozen: any time advancement is a no-op. This is THE scene-adaptation
 * behaviour — because scheduled NPCs only move when the clock crosses their
 * slot boundaries (`reprojectSchedules`), a frozen clock means the world
 * stands still. Faithful to eraTW, where time-stop commands don't tick
 * `TIME`. Release (`COM999`) clears the flag and the clock resumes.
 */
export function advanceClock(
  state: GameState,
  minutes: number,
  now: () => number,
  opts: { runDayEnd?: boolean } = {},
): { state: GameState; events: ObservationEvent[] } {
  if (minutes <= 0) {
    return { state, events: [] };
  }
  // P-16: time is frozen during 時間停止 — swallow the advance.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { state, events: [] };
  }

  const finalTick = state.time.tickValue + minutes;

  const events: ObservationEvent[] = [
    {
      kind: "TIME_TICK",
      timestamp: now(),
      tickValue: finalTick,
    },
  ];

  // INFO.ERB @DISH_FRESHNESS runs whenever game time progresses. Keeping it
  // beside the authoritative clock guarantees every command/scheduler/sleep
  // path ages the dish exactly once.
  const freshness = advanceDishFreshness(state, minutes);
  if (freshness.message) {
    events.push({ kind: "NARRATION", timestamp: now(), text: freshness.message });
  }
  // `AFTERTRA.ERB` advances the insect trap after each time progression.
  // Use a deterministic fixed stream here: trap placement/collection remains
  // replay-safe and is not tied to browser wall-clock scheduling.
  progressBugTrap(state);

  // Walk every weather/day boundary. The previous endpoint-only implementation
  // made a long sleep observably different from the same elapsed time spent in
  // ordinary commands: intermediate abnormal-weather penalties and day-end
  // settlement were skipped. Keep one public TIME_TICK for compatibility while
  // applying each world boundary in chronological order.
  while (state.time.tickValue < finalTick) {
    const nextBoundary = nextWeatherBoundaryAfter(state.time.tickValue);
    const intervalEnd = Math.min(finalTick, nextBoundary);
    events.push(
      ...advanceClockInterval(
        state,
        intervalEnd - state.time.tickValue,
        now,
        opts.runDayEnd ?? true,
      ),
    );
  }

  return { state, events };
}

/**
 * DAY-CYCLE-PLAN §3.2 — pin the clock to a minute-of-day **today**, moving
 * only forward. Used by the wake / 起床菜单 paths to set the current time to
 * the master's configured wake minute.
 *
 * **Monotonic — never rewinds.** If the target tick is at or before the
 * current tick (e.g. the clock already sits at 08:00 but the wake minute is
 * 07:00), this is a no-op. The old `openEyesAction` wrote `time.tickValue`
 * directly and DID rewind in exactly that case (new-game seeds tickValue 480
 * / masterWakeMinute 420 → rewound 08:00→07:00); that was a bug, and routing
 * through here removes it. Because the target is a minute-of-day within
 * `[0,1440)` of the current day, the advance never crosses midnight, so no
 * day-end fires — but the weather-band hooks in `advanceClock` do (faithful:
 * advancing to the wake time can cross a 時間帯 boundary).
 */
export function pinClockToMinute(
  state: GameState,
  minuteOfDay: number,
  now: () => number,
): { state: GameState; events: ObservationEvent[] } {
  const target = (((Math.trunc(minuteOfDay) % 1440) + 1440) % 1440);
  const dayStart = Math.floor(state.time.tickValue / 1440) * 1440;
  const delta = dayStart + target - state.time.tickValue;
  if (delta <= 0) return { state, events: [] };
  return advanceClock(state, delta, now);
}

/**
 * Advance `state.time.tickValue` by the in-game minutes that correspond
 * to a wall-clock delta. Thin wrapper over `advanceClock` (converts real-ms
 * → minutes). Used by the autonomous scheduler tick (`runSchedulerTick`).
 */
export function tickClock(
  state: GameState,
  realDeltaMs: number,
  now: () => number,
): { state: GameState; events: ObservationEvent[] } {
  const minutes = Math.max(0, Math.floor(realDeltaMs / MS_PER_TICK));
  // DAY-CYCLE-PLAN §S3: runDayEnd defaults to true — the autonomous scheduler
  // tick fires day-end on a midnight cross (was `{ runDayEnd: false }`, commit
  // 20e0372a, no stated reason). tickValue is shared monotonic state, so each
  // midnight is crossed — and settled — exactly once, by whichever path
  // (command / scheduler / sleep) advances across it first.
  return advanceClock(state, minutes, now);
}
