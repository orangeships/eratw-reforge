import type { DatePlanEvent, DateSession, GameState } from "../state/game-state.js";
import { cloneGameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { TFLAG_ID, setTflag } from "../state/tflag.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { applyRelationshipDelta } from "../state/relationship.js";
import { mapIdOfLocation } from "./location-predicates.js";
import { setSlotLocation } from "./room-id-location.js";
import { recordDateBanquetSignal } from "../agent/recorder.js";

export interface DateStartOptions {
  partner: number;
  source: DateSession["source"];
  mapId?: number;
  destination?: string;
  travelMinutes?: number;
  forcedEndTick?: number;
}

export type DateStartCheck = { ok: true } | { ok: false; reason: string };

export function isDateActive(state: Readonly<GameState>): boolean {
  return state.dateSession != null;
}

export function activeDatePartner(state: Readonly<GameState>): number | null {
  return state.dateSession?.partner ?? null;
}

export function syncDateMirrors(state: GameState): void {
  const session = state.dateSession;
  const mapId = session?.mapId ?? 0;
  state.master.state.CFLAG[CFLAG_ID.约会中] = mapId;
  state.flagStore[FLAG_ID.デート相手] = session?.partner ?? 0;
  setTflag(state, TFLAG_ID.约会前好感度, session?.initialFavor ?? 0);
  setTflag(
    state,
    TFLAG_ID.约会道中,
    session?.phase === "traveling" || session?.phase === "returning"
      ? Math.max(1, session.travelRemainingMinutes ?? 1)
      : 0,
  );
  for (const [idText, slot] of Object.entries(state.charas)) {
    slot.state.CFLAG[CFLAG_ID.约会中] = Number(idText) === session?.partner ? mapId : 0;
  }
}

export function canStartPlayerDate(state: Readonly<GameState>, partner: number): DateStartCheck {
  if (state.dateSession) return { ok: false, reason: "すでに約会中です。" };
  const slot = state.charas[partner];
  if (!slot || partner <= 0) return { ok: false, reason: "約会相手がいません。" };
  if (slot.location !== state.master.location) return { ok: false, reason: "約会相手が同じ場所にいません。" };
  if ((slot.state.CFLAG[CFLAG_ID.同行] ?? 0) <= 0) return { ok: false, reason: "約会相手は同行していません。" };
  if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return { ok: false, reason: "約会相手は仕事中です。" };
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return { ok: false, reason: "約会相手は眠っています。" };
  const authority = deriveRelationshipAuthority(slot, state.master, state as GameState);
  if (authority.attitude < 1) return { ok: false, reason: "約会に応じる関係ではありません。" };
  return { ok: true };
}

export function startDate(state: GameState, options: DateStartOptions): DateSession {
  if (state.dateSession) throw new Error("a date session is already active");
  const partner = state.charas[options.partner];
  if (!partner) throw new Error(`unknown date partner ${options.partner}`);
  const mapId = options.mapId ?? mapIdOfLocation(options.destination ?? state.master.location) ?? 0;
  const travelMinutes = Math.max(0, Math.trunc(options.travelMinutes ?? 0));
  const session: DateSession = {
    partner: options.partner,
    source: options.source,
    initialFavor: partner.state.CFLAG[CFLAG_ID.好感度] ?? 0,
    startedAtTick: state.time.tickValue,
    mapId,
    forcedEndTick: options.forcedEndTick,
    phase: travelMinutes > 0 ? "traveling" : "active",
    destination: options.destination,
    travelRemainingMinutes: travelMinutes || undefined,
  };
  state.dateSession = session;
  state.outing = null;
  syncDateMirrors(state);
  recordDateBanquetSignal(state, options.partner, "约会开始");
  return session;
}

export function beginDateTravel(state: GameState, destination: string, minutes: number): boolean {
  const session = state.dateSession;
  if (!session) return false;
  session.destination = destination;
  session.mapId = mapIdOfLocation(destination) ?? session.mapId;
  session.phase = "traveling";
  session.travelRemainingMinutes = Math.max(1, Math.trunc(minutes));
  syncDateMirrors(state);
  return true;
}

export function advanceDateTravel(state: GameState, minutes: number): boolean {
  const session = state.dateSession;
  if (!session || (session.phase !== "traveling" && session.phase !== "returning")) return false;
  session.travelRemainingMinutes = Math.max(0, (session.travelRemainingMinutes ?? 0) - Math.max(0, Math.trunc(minutes)));
  if (session.travelRemainingMinutes === 0 && session.phase === "traveling") {
    session.phase = "active";
    if (session.destination) {
      setSlotLocation(state.master, session.destination);
      const partner = state.charas[session.partner];
      if (partner) setSlotLocation(partner, session.destination);
    }
  } else if (session.travelRemainingMinutes === 0 && session.phase === "returning") {
    endDate(state, { returnHome: true });
    return true;
  }
  syncDateMirrors(state);
  return true;
}

export function beginDateReturn(state: GameState, minutes: number): boolean {
  const session = state.dateSession;
  if (!session) return false;
  session.phase = "returning";
  session.destination = state.homeLocation ?? state.master.homeLocation ?? "神社:倉庫";
  session.travelRemainingMinutes = Math.max(1, Math.trunc(minutes));
  syncDateMirrors(state);
  return true;
}

export function endDate(state: GameState, options: { returnHome?: boolean; resolution?: "resolved" | "cancelled" | "missed" } = {}): DateSession | null {
  const session = state.dateSession;
  if (!session) return null;
  const partner = state.charas[session.partner];
  if (options.returnHome) {
    setSlotLocation(state.master, state.homeLocation ?? state.master.homeLocation ?? "神社:倉庫");
    if (partner) setSlotLocation(partner, partner.homeLocation ?? state.homeLocation ?? "神社:倉庫");
  }
  if (partner) partner.state.CFLAG[CFLAG_ID.同行] = 0;
  state.master.state.CFLAG[CFLAG_ID.同行] = 0;
  state.dateSession = null;
  const plan = (state.worldEvents ?? []).find(
    (event): event is DatePlanEvent => event.kind === "date-plan" && event.partner === session.partner && event.phase === "started",
  );
  if (plan) {
    plan.phase = options.resolution ?? "resolved";
    plan.resolvedAtTick = state.time.tickValue;
  }
  syncDateMirrors(state);
  return session;
}

export function followDatePartner(state: GameState): void {
  const partner = state.dateSession ? state.charas[state.dateSession.partner] : undefined;
  if (partner) setSlotLocation(partner, state.master.location);
}

export function resolveDateInvitation(state: GameState, eventId: string, accept: boolean): DatePlanEvent | null {
  const event = (state.worldEvents ?? []).find(
    (item): item is DatePlanEvent => item.kind === "date-plan" && item.id === eventId,
  );
  if (!event || event.phase !== "offered") return null;
  event.phase = accept ? "scheduled" : "declined";
  event.resolvedAtTick = accept ? undefined : state.time.tickValue;
  return event;
}

function applyAppointmentPenalty(state: GameState, partner: number, favor: number, trust: number): void {
  applyRelationshipDelta(state, partner, favor, trust);
}

export function cancelDateAppointment(state: GameState, eventId: string): DatePlanEvent | null {
  const event = (state.worldEvents ?? []).find(
    (item): item is DatePlanEvent => item.kind === "date-plan" && item.id === eventId,
  );
  if (!event || !["scheduled", "waiting"].includes(event.phase) || event.scheduledStartTick == null) return null;
  const until = event.scheduledStartTick - state.time.tickValue;
  if (until <= 60) applyAppointmentPenalty(state, event.partner, -100, -20);
  else if (until < 1440) applyAppointmentPenalty(state, event.partner, -50, -10);
  event.phase = "cancelled";
  event.resolvedAtTick = state.time.tickValue;
  return event;
}

export function tryStartAppointmentOnArrival(state: GameState): DatePlanEvent | null {
  if (state.dateSession) return null;
  const now = state.time.tickValue;
  const event = (state.worldEvents ?? []).find(
    (item): item is DatePlanEvent => item.kind === "date-plan" && ["scheduled", "waiting"].includes(item.phase) &&
      item.location === state.master.location && item.scheduledStartTick != null &&
      now >= item.scheduledStartTick - 30 && now <= item.scheduledStartTick + 60,
  );
  if (!event) return null;
  event.phase = "started";
  startDate(state, { partner: event.partner, source: "appointment", destination: event.location, mapId: mapIdOfLocation(event.location ?? "") ?? 0 });
  // The appointment can start in the same post-command pass that first moves
  // time into the arrival window. At that point advanceDateAppointments has
  // not necessarily projected the waiting partner yet, so project now rather
  // than leaving the date partner one successful command behind the master.
  followDatePartner(state);
  syncDateMirrors(state);
  return event;
}

/** Clone-friendly helper used by adapters that do not mutate their input. */
export function withEndedDate(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state as GameState);
  endDate(next);
  return next;
}
