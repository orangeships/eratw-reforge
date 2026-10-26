import type { DatePlanEvent, GameState } from "../state/game-state.js";
import type { Rng } from "../command/rng.js";
import { createRng } from "../command/rng.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";

export interface DateProposal {
  scheduledStartTick: number;
  location: string;
}

export interface DateProposalProvider {
  propose(state: Readonly<GameState>, partner: number, seed: number): DateProposal | null;
}

export function offeredDateInvitations(state: Readonly<GameState>): DatePlanEvent[] {
  return (state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && event.phase === "offered")
    .sort((a, b) => a.createdAtTick - b.createdAtTick || a.partner - b.partner || a.id.localeCompare(b.id));
}

export function datePlanScheduleLabel(event: Readonly<DatePlanEvent>): string {
  if (event.scheduledStartTick == null) return "时间未定 · 地点未定";
  const day = Math.floor(event.scheduledStartTick / 1440) + 1;
  const minute = event.scheduledStartTick % 1440;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `第 ${day} 日 ${hh}:${mm} · ${event.location ?? "地点未定"}`;
}

export const PUBLIC_DATE_LOCATIONS = [
  "命蓮寺", "人間之里", "紅魔館", "迷途竹林", "魔法之森",
  "冥界", "妖怪之山", "山頂", "地底", "月",
] as const;

function conflicts(state: Readonly<GameState>, tick: number): boolean {
  return (state.worldEvents ?? []).some((event) => {
    if (event.kind === "date-plan" && ["seeking-player", "offered", "scheduled", "waiting"].includes(event.phase) && event.scheduledStartTick != null) {
      return Math.abs(event.scheduledStartTick - tick) < 120;
    }
    if (event.kind === "banquet" && !["resolved", "cancelled"].includes(event.phase)) {
      return tick < event.forcedEndTick && tick + 120 > event.scheduledStartTick;
    }
    return false;
  });
}

export const deterministicDateProposalProvider: DateProposalProvider = {
  propose(state, _partner, seed) {
    const rng = createRng(seed);
    for (let i = 0; i < 96; i++) {
      const dayOffset = 1 + rng.int(3);
      const halfHour = 20 + rng.int(17); // 10:00 through 18:00
      const tick = Math.floor(state.time.tickValue / 1440) * 1440 + dayOffset * 1440 + halfHour * 30;
      if (!conflicts(state, tick)) return { scheduledStartTick: tick, location: PUBLIC_DATE_LOCATIONS[rng.int(PUBLIC_DATE_LOCATIONS.length)]! };
    }
    return null;
  },
};

export function canCharacterInitiateDate(state: GameState, partner: number): boolean {
  const slot = state.charas[partner];
  if (!slot || state.dateSession?.partner === partner) return false;
  if ((state.worldEvents ?? []).some((event) => event.kind === "date-plan" && event.partner === partner && !["declined", "cancelled", "missed", "resolved"].includes(event.phase))) return false;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 || (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return false;
  const fallen = (slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  const authority = deriveRelationshipAuthority(slot, state.master, state);
  return fallen && authority.attitude >= 1 && !authority.angry;
}

/** Independent per-character morning roll; iteration order cannot change a hit. */
export function generateMorningDateIntentions(state: GameState, _rng?: Rng): DatePlanEvent[] {
  const created: DatePlanEvent[] = [];
  for (const partner of Object.keys(state.charas).map(Number).sort((a, b) => a - b)) {
    if (!canCharacterInitiateDate(state, partner)) continue;
    const seed = ((state.time.dayIndex + 1) * 1_000_003 + partner * 97) >>> 0;
    const local = createRng(seed);
    // Reuse the relationship-weighted spirit of the visit roll while keeping
    // every character independent: stronger fall talents reduce the divisor.
    const slot = state.charas[partner]!;
    const divisor = Math.max(2, 12 - ((slot.state.TALENT[TALENT_ID.恋慕] ?? 0) ? 4 : 0) - (slot.state.TALENT[TALENT_ID.思慕] ?? 0) - ((slot.state.TALENT[TALENT_ID.愛欲] ?? 0) ? 2 : 0));
    if (local.int(divisor) !== 0) continue;
    const event: DatePlanEvent = { kind: "date-plan", id: `date-${state.time.dayIndex}-${partner}`, partner, seed, phase: "seeking-player", createdAtTick: state.time.tickValue, controller: "partner" };
    (state.worldEvents ??= []).push(event);
    slot.state.CFLAG[CFLAG_ID.拠点来訪] = 1;
    created.push(event);
  }
  return created;
}

export function offerDateIntentionsOnEncounter(state: GameState): DatePlanEvent[] {
  // Several co-located characters may invite the player in the same encounter.
  // The owner-aware UI presents the resulting offered events sequentially.
  const offered = (state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && event.phase === "seeking-player" && state.charas[event.partner]?.location === state.master.location)
    .sort((a, b) => a.createdAtTick - b.createdAtTick || a.partner - b.partner);
  return offered.filter((event) => {
    const reserved = reserveDateInvitationProposal(state, event.id);
    if (!reserved) {
      event.phase = "cancelled";
      event.resolvedAtTick = state.time.tickValue;
      return false;
    }
    event.phase = "offered";
    return true;
  });
}

/** Reserve the one canonical proposal before invitation prose or UI is shown.
 * Dialogue, the invitation card and later acceptance must all read these same
 * fields; acceptance never rolls a second destination. */
export function reserveDateInvitationProposal(
  state: GameState,
  eventId: string,
  provider: DateProposalProvider = deterministicDateProposalProvider,
): DatePlanEvent | null {
  const event = (state.worldEvents ?? []).find((item): item is DatePlanEvent => item.kind === "date-plan" && item.id === eventId);
  if (!event || !["seeking-player", "offered"].includes(event.phase)) return null;
  if (event.scheduledStartTick != null && event.location) return event;
  const proposal = provider.propose(state, event.partner, event.seed);
  if (!proposal) return null;
  event.scheduledStartTick = proposal.scheduledStartTick;
  event.location = proposal.location;
  event.arrivalTick = proposal.scheduledStartTick - 30;
  event.waitUntilTick = proposal.scheduledStartTick + 60;
  return event;
}

export function scheduleAcceptedDate(state: GameState, eventId: string, provider: DateProposalProvider = deterministicDateProposalProvider): DatePlanEvent | null {
  const event = reserveDateInvitationProposal(state, eventId, provider);
  if (!event || event.phase !== "offered") return null;
  event.phase = "scheduled";
  return event;
}

export function advanceDateAppointments(state: GameState): void {
  const now = state.time.tickValue;
  for (const event of state.worldEvents ?? []) {
    if (event.kind !== "date-plan") continue;
    // A morning-generated invitation belongs to that day. Previously an NPC
    // could keep `seeking-player` for several days and surface after the
    // outing/event that created it was already over.
    if (event.phase === "seeking-player" && now >= event.createdAtTick + 1440) {
      event.phase = "cancelled";
      event.resolvedAtTick = now;
      continue;
    }
    if (event.scheduledStartTick == null) continue;
    const slot = state.charas[event.partner];
    if (event.phase === "scheduled" && now >= (event.arrivalTick ?? event.scheduledStartTick - 30)) {
      event.phase = "waiting";
      if (slot && event.location) slot.location = event.location;
    }
    if (event.phase === "waiting" && now > (event.waitUntilTick ?? event.scheduledStartTick + 60)) {
      event.phase = "missed";
      event.resolvedAtTick = now;
      if (slot) {
        slot.state.CFLAG[CFLAG_ID.好感度] = Math.max(0, (slot.state.CFLAG[CFLAG_ID.好感度] ?? 0) - 100);
        slot.state.CFLAG[CFLAG_ID.信頼度] = Math.max(0, (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) - 20);
      }
    }
  }
}
