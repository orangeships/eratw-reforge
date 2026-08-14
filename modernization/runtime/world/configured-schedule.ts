/**
 * CSV-driven subset of eraTW's character movement state machine.
 *
 * The source CSV configures four time boundaries per character:
 * 来访(352), 归宅(353), 就寝(354), 起床(355). It does not configure the
 * hand-authored "lunch/walk/work" routes that previously lived here.
 *
 * Implemented now:
 * - 就寝: return to configured 初期位置 and set 睡眠.
 * - 起床: clear 睡眠 and remain at 初期位置.
 *
 * 来访/归宅, jobs, free actions, random movement and CHARAMOVE_DATA events
 * require their original state-machine branches. Until those branches land,
 * crossing them is intentionally a no-op, per the parity rule: no invented
 * fallback event or destination.
 */

import type { CharaSlot, GameState } from "../state/index.js";
import { CFLAG_ID } from "../state/settlement.js";
import { setSlotLocation } from "./room-id-location.js";
import { applyCharaAwake, planCharaAwake } from "./chara-awake.js";

export type ConfiguredScheduleEventKind = "wake" | "visit" | "return" | "sleep";

export interface ConfiguredScheduleEvent {
  kind: ConfiguredScheduleEventKind;
  at: number;
}

const EVENT_FIELDS: ReadonlyArray<readonly [ConfiguredScheduleEventKind, number]> = [
  ["wake", CFLAG_ID.起床時間],
  ["visit", CFLAG_ID.来訪時間],
  ["return", CFLAG_ID.帰宅時間],
  ["sleep", CFLAG_ID.就寝時間],
];

function minuteOfDay(value: number): number {
  return ((value % 1440) + 1440) % 1440;
}

function configuredTime(slot: CharaSlot, field: number): number | null {
  const value = slot.state.CFLAG[field];
  return Number.isFinite(value) ? minuteOfDay(value!) : null;
}

/** Whether the CSV sleep interval covers `tickValue`. */
export function isConfiguredSleepTime(slot: CharaSlot, tickValue: number): boolean {
  const sleep = configuredTime(slot, CFLAG_ID.就寝時間);
  const wake = configuredTime(slot, CFLAG_ID.起床時間);
  if (sleep === null || wake === null || sleep === wake) return false;
  const minute = minuteOfDay(tickValue);
  return sleep < wake
    ? minute >= sleep && minute < wake
    : minute >= sleep || minute < wake;
}

/** Return every configured boundary in `(oldTick, newTick]`, including
 * midnight-normalized CSV values such as 1440. */
export function configuredEventsBetween(
  slot: CharaSlot,
  oldTick: number,
  newTick: number,
): ConfiguredScheduleEvent[] {
  if (newTick <= oldTick) return [];
  const firstDay = Math.floor(oldTick / 1440);
  const lastDay = Math.floor(newTick / 1440);
  const events: ConfiguredScheduleEvent[] = [];
  for (let day = firstDay; day <= lastDay; day++) {
    for (const [kind, field] of EVENT_FIELDS) {
      const minute = configuredTime(slot, field);
      if (minute === null) continue;
      const at = day * 1440 + minute;
      if (at > oldTick && at <= newTick) events.push({ kind, at });
    }
  }
  return events.sort((a, b) => a.at - b.at || EVENT_FIELDS.findIndex(([k]) => k === a.kind) - EVENT_FIELDS.findIndex(([k]) => k === b.kind));
}

/** Apply only source branches that are implemented. Unimplemented configured
 * boundaries are consumed without mutation. */
export function applyConfiguredSchedule(
  state: GameState,
  oldTick: number,
  newTick: number,
): void {
  for (const slot of Object.values(state.charas)) {
    for (const event of configuredEventsBetween(slot, oldTick, newTick)) {
      if (event.kind === "sleep") {
        const initialId = slot.state.CFLAG[CFLAG_ID.初期位置];
        const previousId = slot.state.CFLAG[CFLAG_ID.現在位置] ?? initialId;
        if (slot.homeLocation) setSlotLocation(slot, slot.homeLocation);
        if (Number.isFinite(initialId)) {
          slot.state.CFLAG[CFLAG_ID.前一次的位置] = previousId!;
          slot.state.CFLAG[CFLAG_ID.現在位置] = initialId!;
        }
        slot.state.CFLAG[CFLAG_ID.睡眠] = 1;
      } else if (event.kind === "wake") {
        // Use the same SET_SLEEP(0) tail as an explicit wake.  Besides the
        // sleep flag this resets sleep depth/fatigue and clears prank/stealth
        // bits, which otherwise leave a character visually awake but still
        // treated as a sleep-mode participant by later movement/commands.
        const plan = planCharaAwake(state, slot.charaNum, true);
        if (plan) applyCharaAwake(state, slot.charaNum, plan);
        else slot.state.CFLAG[CFLAG_ID.睡眠] = 0;
      }
    }
  }
}

/** Initialize a new game directly from the CSV fields. No activity venue is
 * selected: characters begin at their configured 初期位置. */
export function initializeConfiguredSchedules(state: GameState): void {
  for (const slot of Object.values(state.charas)) {
    const initialId = slot.state.CFLAG[CFLAG_ID.初期位置];
    if (Number.isFinite(initialId)) slot.state.CFLAG[CFLAG_ID.現在位置] = initialId!;
    slot.state.CFLAG[CFLAG_ID.睡眠] = isConfiguredSleepTime(slot, state.time.tickValue) ? 1 : 0;
  }
}
