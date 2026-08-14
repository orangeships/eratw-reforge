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

const PUBLIC_DATE_LOCATIONS = [
  "命蓮寺", "人間之里", "紅魔館", "迷途竹林", "魔法之森",
  "冥界", "妖怪之山", "山頂", "地底", "月",
] as const;

function conflicts(state: Readonly<GameState>, tick: number): boolean {
  return (state.worldEvents ?? []).some((event) => {
    if (event.kind === "date-plan" && ["scheduled", "waiting"].includes(event.phase) && event.scheduledStartTick != null) {
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

function eligible(state: GameState, partner: number): boolean {
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
    if (!eligible(state, partner)) continue;
    const seed = ((state.time.dayIndex + 1) * 1_000_003 + partner * 97) >>> 0;
    const local = createRng(seed);
    // Reuse the relationship-weighted spirit of the visit roll while keeping
    // every character independent: stronger fall talents reduce the divisor.
    const slot = state.charas[partner]!;
    const divisor = Math.max(2, 12 - ((slot.state.TALENT[TALENT_ID.恋慕] ?? 0) ? 4 : 0) - (slot.state.TALENT[TALENT_ID.思慕] ?? 0) - ((slot.state.TALENT[TALENT_ID.愛欲] ?? 0) ? 2 : 0));
    if (local.int(divisor) !== 0) continue;
    const event: DatePlanEvent = { kind: "date-plan", id: `date-${state.time.dayIndex}-${partner}`, partner, seed, phase: "seeking-player", createdAtTick: state.time.tickValue };
    (state.worldEvents ??= []).push(event);
    slot.state.CFLAG[CFLAG_ID.拠点来訪] = 1;
    created.push(event);
  }
  return created;
}

export function offerDateIntentionsOnEncounter(state: GameState): DatePlanEvent[] {
  const offered = (state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && event.phase === "seeking-player" && state.charas[event.partner]?.location === state.master.location)
    .sort((a, b) => a.partner - b.partner);
  for (const event of offered) event.phase = "offered";
  return offered;
}

export function scheduleAcceptedDate(state: GameState, eventId: string, provider: DateProposalProvider = deterministicDateProposalProvider): DatePlanEvent | null {
  const event = (state.worldEvents ?? []).find((item): item is DatePlanEvent => item.kind === "date-plan" && item.id === eventId);
  if (!event || event.phase !== "offered") return null;
  const proposal = provider.propose(state, event.partner, event.seed);
  if (!proposal) return null;
  event.phase = "scheduled";
  event.scheduledStartTick = proposal.scheduledStartTick;
  event.location = proposal.location;
  event.arrivalTick = proposal.scheduledStartTick - 30;
  event.waitUntilTick = proposal.scheduledStartTick + 60;
  return event;
}

export function advanceDateAppointments(state: GameState): void {
  const now = state.time.tickValue;
  for (const event of state.worldEvents ?? []) {
    if (event.kind !== "date-plan" || event.scheduledStartTick == null) continue;
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
