/**
 * Read-only calendar agenda projection.
 *
 * The owning deterministic subsystems still schedule and settle festivals,
 * dates, banquets and work.  This module only normalizes their already-
 * accepted state into one player-facing calendar model; it never mutates
 * GameState and is not an AI/gameplay authority.
 */

import type { GameState } from "../state/game-state.js";
import { dateOf, festivalOf, seasonOf } from "./calendar.js";
import {
  JOB_LABEL,
  WORK_MANIFEST,
  resolveWorkEntry,
} from "./work/work-manifest.js";

export type CalendarAgendaKind = "festival" | "banquet" | "date" | "work" | "narrative";

export interface CalendarAgendaItem {
  id: string;
  kind: CalendarAgendaKind;
  label: string;
  participantIds: number[];
  startMinute?: number;
  endMinute?: number;
  location?: string;
  /** Present when a player action may address the source world event. */
  worldEventId?: string;
  narrativeStatus?: "scheduled" | "ready" | "active" | "missed" | "resolved" | "expired" | "cancelled";
  arcId?: string;
}

export interface CalendarAgendaDay {
  dayIndex: number;
  season: number;
  date: number;
  items: CalendarAgendaItem[];
}

function nextCalendarDate(season: number, date: number): { season: number; date: number } {
  if (date < 31) return { season, date: date + 1 };
  return { season: season === 4 ? 1 : season + 1, date: 1 };
}

/** Project the next `count` calendar days without changing canonical state. */
export function projectCalendarAgenda(
  state: Readonly<GameState>,
  count = 7,
): CalendarAgendaDay[] {
  const result: CalendarAgendaDay[] = [];
  let season = seasonOf(state.time);
  let date = dateOf(state.time);

  for (let offset = 0; offset < Math.max(0, count); offset += 1) {
    const dayIndex = state.time.dayIndex + offset;
    const items: CalendarAgendaItem[] = [];
    const festival = festivalOf(season, date);
    if (festival) {
      items.push({
        id: `festival:${season}:${date}`,
        kind: "festival",
        label: festival,
        participantIds: [],
      });
    }

    for (const event of state.worldEvents ?? []) {
      if (event.kind === "date-plan"
        && (event.phase === "scheduled" || event.phase === "waiting")
        && event.scheduledStartTick !== undefined
        && Math.floor(event.scheduledStartTick / 1440) === dayIndex) {
        items.push({
          id: `date:${event.id}`,
          kind: "date",
          label: "约会",
          participantIds: [event.partner],
          startMinute: event.scheduledStartTick % 1440,
          location: event.location,
          worldEventId: event.id,
        });
      }
      if (event.kind === "banquet"
        && event.phase !== "resolved"
        && event.phase !== "cancelled"
        && Math.floor(event.scheduledStartTick / 1440) === dayIndex) {
        items.push({
          id: `banquet:${event.id}`,
          kind: "banquet",
          label: "宴会",
          participantIds: [...event.participants],
          startMinute: event.scheduledStartTick % 1440,
          endMinute: event.forcedEndTick % 1440,
          location: event.venue,
          worldEventId: event.id,
        });
      }
    }

    for (const event of state.narrativeEvents ?? []) {
      if (Math.floor(event.windowStartTick / 1440) !== dayIndex) continue;
      items.push({
        id: `narrative:${event.id}`,
        kind: "narrative",
        label: event.title,
        participantIds: [...event.participantIds],
        startMinute: event.windowStartTick % 1440,
        endMinute: event.windowEndTick % 1440,
        location: event.locationIds.join(" / "),
        narrativeStatus: event.status,
        ...(event.arcId ? { arcId: event.arcId } : {}),
      });
    }

    // Work conditions inspect calendar and day fields.  Give them a shallow,
    // throwaway projection so the information view cannot mutate live state.
    const projected = {
      ...state,
      time: {
        ...state.time,
        dayIndex,
        tickValue: state.time.tickValue + offset * 1440,
        season,
        date,
      },
    } as GameState;
    for (const entry of WORK_MANIFEST) {
      const ctx = { state: projected, dayIndex };
      if (!entry.cond(ctx)) continue;
      const resolved = resolveWorkEntry(entry, ctx);
      if (!resolved) continue;
      items.push({
        id: `work:${dayIndex}:${entry.charaNum}:${resolved.jobType}:${resolved.startMin}`,
        kind: "work",
        label: JOB_LABEL[resolved.jobType] ?? `工作 ${resolved.jobType}`,
        participantIds: [entry.charaNum],
        startMinute: resolved.startMin,
        endMinute: resolved.endMin,
        location: resolved.location,
      });
    }

    result.push({ dayIndex, season, date, items });
    ({ season, date } = nextCalendarDate(season, date));
  }
  return result;
}
