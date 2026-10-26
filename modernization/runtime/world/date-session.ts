import type { DatePlanEvent, DateSession, GameState } from "../state/game-state.js";
import { hasDialogueOutingConsent } from "../ai-state/dialogue-action.js";
import { cloneGameState } from "../state/game-state.js";
import { advanceTimeTicks, BASE_ID, CFLAG_ID, FLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { TFLAG_ID, setTflag } from "../state/tflag.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { applyRelationshipDelta } from "../state/relationship.js";
import { hasItem, ITEM_ID } from "../state/items.js";
import { mapIdOfLocation } from "./location-predicates.js";
import { setSlotLocation } from "./room-id-location.js";
import { restoreDateOutfit } from "./date-outfit.js";
import { isInVisitWindow } from "./work/visit.js";
import { recordDateBanquetSignal } from "../agent/recorder.js";
import { recordAgentDailyLocationVisit } from "../agent/daily-ledger.js";
import { canEnterRoom } from "./map-can-move.js";
import { ROOM_CATALOG } from "./room-catalog.js";

export interface DateStartOptions {
  partner: number;
  source: DateSession["source"];
  mapId?: number;
  destination?: string;
  /**
   * Upstream `SET_DATE(P_ID, C_ID, 所要時間)` road cost. Still charged, but the
   * road stage itself is not modeled: both participants land at `destination`
   * in this same settlement pass.
   */
  travelMinutes?: number;
  forcedEndTick?: number;
  controller?: "player" | "partner";
  eventId?: string;
  autoAdvance?: boolean;
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
  // `TFLAG:约会道中` is the upstream road marker (`SET_DATE` writes
  // `所要時間 + 1000`). The road stage is retired, so it always reads 0 —
  // matching upstream once the party has arrived.
  setTflag(state, TFLAG_ID.约会道中, 0);
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
  if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return { ok: false, reason: "約会相手が仕事中です。" };
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return { ok: false, reason: "約会相手が寝ています。" };
  const authority = deriveRelationshipAuthority(slot, state.master, state as GameState);
  const dialogueConsent = hasDialogueOutingConsent(state, partner);
  if (authority.angry) return { ok: false, reason: "約会相手がブチギレしています。" };
  if (authority.attitude < 1 && !dialogueConsent) return { ok: false, reason: "約会に応じる関係ではありません。" };
  // `@CAN_DATE` (DATE_CMN.ERB:208-230): 潜伏中 / _simple-swimming-pool /
  //  partner is 思慕 | 恋慕 | 愛欲.
  if ((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) {
    return { ok: false, reason: "潜伏中は約会できません。" };
  }
  if (!hasItem(state, ITEM_ID.簡易泳池) && partner === 93) {
    return { ok: false, reason: "簡易泳池がないので連れ出せません。" };
  }
  const willing = [TALENT_ID.思慕, TALENT_ID.恋慕, TALENT_ID.愛欲]
    .some((id) => (slot.state.TALENT[id] ?? 0) !== 0);
  if (!willing && !dialogueConsent) {
    return { ok: false, reason: "その関係では誘いを受け入れてくれません。" };
  }
  // `@外出先から誘えるか` (外出先から帰宅.ERB:183-199): the partner must be
  // inside their `[来訪時間, 帰宅時間)` activity window, have 気力 to go out,
  // and have no work still scheduled in the next three hours.
  if (!isInVisitWindow(slot, state.time.tickValue % 1440)) {
    return { ok: false, reason: "今の時間は相手が訪問に来る時間じゃない。" };
  }
  if ((slot.state.BASE[BASE_ID.気力] ?? 0) < 500) {
    return { ok: false, reason: "約会相手が疲れ切っているようです。" };
  }
  const workStart = slot.state.TCVAR[TCVAR_ID.工作開始] ?? 0;
  const hasWork = (slot.state.BASE[BASE_ID.仕事量] ?? 0) > 0;
  if (hasWork && workStart > 0 && workStart < state.time.tickValue + 180) {
    return { ok: false, reason: "約会相手はこのあとまだ仕事があります。" };
  }
  return { ok: true };
}

export function startDate(state: GameState, options: DateStartOptions): DateSession {
  if (state.dateSession) throw new Error("a date session is already active");
  const partner = state.charas[options.partner];
  if (!partner) throw new Error(`unknown date partner ${options.partner}`);
  const destination = options.destination ?? state.master.location;
  const mapId = options.mapId ?? mapIdOfLocation(destination) ?? 0;
  const travelMinutes = Math.max(0, Math.trunc(options.travelMinutes ?? 0));
  const controller = options.controller ?? "player";
  const itinerary = controller === "partner"
    ? buildPartnerLedItinerary(state, options.partner, destination, options.eventId)
    : undefined;
  const session: DateSession = {
    partner: options.partner,
    source: options.source,
    initialFavor: partner.state.CFLAG[CFLAG_ID.好感度] ?? 0,
    startedAtTick: state.time.tickValue,
    mapId,
    forcedEndTick: options.forcedEndTick,
    // Upstream enters a road stage right after `SET_DATE`; the modern runtime
    // collapses it, so a date is `active` the moment it is created.
    phase: "active",
    destination,
    controller,
    leaderId: controller === "partner" ? options.partner : 0,
    eventId: options.eventId,
    autoAdvance: controller === "partner" ? options.autoAdvance !== false : false,
    itinerary,
    itineraryCursor: itinerary ? 0 : undefined,
    executedActionIds: [],
  };
  state.dateSession = session;
  state.outing = null;
  // Upstream `SET_DATE` writes `現在位置 = ROAD_TO(P_ID)` then lands on
  // `GET_ENTRANCE(约会中)`. Without the road stage the party is placed straight
  // at the destination, and only the `所要時間` cost is charged.
  placeDateParticipants(state, destination);
  if (travelMinutes > 0) advanceTimeTicks(state, travelMinutes);
  syncDateMirrors(state);
  recordDateBanquetSignal(state, options.partner, "约会开始");
  return session;
}

function buildPartnerLedItinerary(
  state: GameState,
  partnerId: number,
  origin: string,
  eventId?: string,
): DateSession["itinerary"] {
  const partner = state.charas[partnerId];
  const originRoom = ROOM_CATALOG.find((room) => room.location === origin);
  if (!partner || !originRoom) return [];
  const candidates = ROOM_CATALOG.filter((room) =>
    room.mapId === originRoom.mapId && room.location !== origin && canEnterRoom(state, room.location, partner));
  if (candidates.length === 0) return [];
  const seed = [...(eventId ?? `${state.time.tickValue}:${partnerId}`)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const offset = seed % candidates.length;
  return Array.from({ length: Math.min(3, candidates.length) }, (_, index) => {
    const room = candidates[(offset + index) % candidates.length]!;
    return {
      id: `date-step:${index}:${room.roomId}`,
      location: room.location,
      label: room.displayName,
      travelMinutes: 20 + ((room.roomId + partnerId + index) % 3) * 10,
      status: "pending" as const,
    };
  });
}

/**
 * Upstream `現在位置 = ROAD_TO(P_ID)` / `GET_ENTRANCE(约会中)`: put the master
 * and the partner at `destination` in one step. Upstream's road stage is not
 * modeled, so there is no intermediate position.
 */
function placeDateParticipants(state: GameState, destination: string): void {
  setSlotLocation(state.master, destination);
  const partner = state.charas[state.dateSession?.partner ?? 0];
  if (partner) {
    setSlotLocation(partner, destination);
    recordAgentDailyLocationVisit(state, partner.charaNum, destination);
  }
}

/**
 * Relocate an active date to `destination`, charging the upstream
 * `所要時間` road cost. This is the modern stand-in for `beginDateTravel` +
 * `advanceDateTravel`: the road is traversed instantly and the party arrives
 * before the next command resolves.
 */
export function moveDateTo(state: GameState, destination: string, minutes: number): boolean {
  const session = state.dateSession;
  if (!session) return false;
  session.destination = destination;
  session.mapId = mapIdOfLocation(destination) ?? session.mapId;
  const step = session.itinerary?.find((entry) => entry.location === destination && entry.status === "pending");
  if (step) step.status = "completed";
  if (minutes > 0) advanceTimeTicks(state, Math.trunc(minutes));
  placeDateParticipants(state, destination);
  syncDateMirrors(state);
  return true;
}

export function endDate(state: GameState, options: { returnHome?: boolean; resolution?: "resolved" | "cancelled" | "missed" } = {}): DateSession | null {
  const session = state.dateSession;
  if (!session) return null;
  const partner = state.charas[session.partner];
  if (options.returnHome) {
    setSlotLocation(state.master, state.homeLocation ?? state.master.homeLocation ?? "神社:倉庫");
    if (partner) {
      const destination = partner.homeLocation ?? state.homeLocation ?? "神社:倉庫";
      setSlotLocation(partner, destination);
      recordAgentDailyLocationVisit(state, partner.charaNum, destination);
    }
  }
  // Upstream `SET_DATE`'s end branch restores `TCVAR:本来の服装` before
  // clearing the date mirrors.
  if (partner) restoreDateOutfit(state, session.partner);
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
  const session = state.dateSession;
  const partner = session ? state.charas[session.partner] : undefined;
  if (partner) {
    if (session?.controller === "partner") {
      setSlotLocation(state.master, partner.location);
    } else {
      setSlotLocation(partner, state.master.location);
      recordAgentDailyLocationVisit(state, partner.charaNum, state.master.location);
    }
  }
}

/** Executes one atomic stop of an accepted NPC-led date. Adapters may call it
 * repeatedly with a short visual delay; the player can end the date between
 * any two calls through the existing return-date command. */
export function advancePartnerLedDate(state: GameState): string[] {
  const session = state.dateSession;
  if (!session || session.controller !== "partner" || !session.autoAdvance || session.phase !== "active") return [];
  const cursor = session.itineraryCursor ?? 0;
  const step = session.itinerary?.[cursor];
  if (!step) {
    // Upstream returns home through `帰宅の時間経過`; without the road stage the
    // return is a single time charge plus arrival.
    endDate(state, { returnHome: true, resolution: "resolved" });
    return ["约会行程结束，对方带你返回住处。"];
  }
  if ((session.executedActionIds ?? []).includes(step.id)) return [];
  moveDateTo(state, step.location, step.travelMinutes);
  const current = state.dateSession;
  if (current) {
    current.itineraryCursor = cursor + 1;
    current.executedActionIds = [...(current.executedActionIds ?? []), step.id];
  }
  return [`对方带你前往${step.label}。`];
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
  startDate(state, {
    partner: event.partner,
    source: "appointment",
    destination: event.location,
    mapId: mapIdOfLocation(event.location ?? "") ?? 0,
    controller: event.controller ?? "player",
    eventId: event.id,
    autoAdvance: event.controller === "partner",
  });
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
