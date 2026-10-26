import {
  ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
  MAX_SUMMARY_LENGTH,
  acceptExperience,
} from "../experience.js";
import { projectDaytimeAgentFacts } from "../agent/daytime-sync.js";
import { cloneGameState, type GameState } from "../state/game-state.js";
import { setSlotLocation } from "../world/room-id-location.js";
import { ROOM_CATALOG } from "../world/room-catalog.js";
import { scheduleWeatherIncident } from "../weather/narrative-incident.js";
import { ensureArcEvolution, ensureArcMaintenance } from "./arc-maintenance.js";
import {
  NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS,
  NARRATIVE_ARC_EVOLUTION_DAILY_LIMIT,
  NARRATIVE_MAX_ACTIVE_ARCS,
  deterministicForegroundConflict,
} from "./lifecycle.js";
import { narrativeContextHash, compileRuntimeCapabilityOptions } from "./snapshot.js";
import { applyStoryInteractionUpdate, compileStoryInteractionRequest, hasPendingStoryInteraction, validateStoryInteractionUpdate } from "./interaction-progress.js";
import type {
  NarrativeArcEvolutionOutcome,
  NarrativeArcEvolutionProposalV1,
  NarrativeArcEvolutionRequestV1,
  NarrativeArcEvolutionTrigger,
  RuntimeCapabilityOption,
  StoryArcInstanceV1,
} from "./types.js";

const MAX_CAPABILITIES_PER_PASS = 8;
const MAX_PENDING_PLAYER_INTENTS = 8;

export interface NarrativeArcEvolutionSelection {
  arc: StoryArcInstanceV1;
  trigger: NarrativeArcEvolutionTrigger;
}

export interface NarrativeArcEvolutionApplyResult {
  state: GameState;
  accepted: boolean;
  diagnostics: string[];
  directCapabilityIds: string[];
  deferredCapabilityIds: string[];
}

function isNpcId(state: Readonly<GameState>, id: number): boolean {
  return Number.isSafeInteger(id) && id > 0 && state.charas[id] !== undefined;
}

function isKnownLocation(locationId: string): boolean {
  return ROOM_CATALOG.some((room) => room.location === locationId);
}

function arcNpcIds(state: Readonly<GameState>, arc: Readonly<StoryArcInstanceV1>): number[] {
  return [...new Set(arc.participantRoles.map((entry) => entry.characterId))]
    .filter((id) => isNpcId(state, id))
    .sort((left, right) => left - right);
}

/** Deterministic owner/lock check. A background pass may not pull an NPC out
 * of work, a date, training, or an active banquet; it simply defers that
 * capability until the next boundary. */
function npcHasActiveOwner(state: Readonly<GameState>, charaNum: number): boolean {
  if (state.dateSession?.partner === charaNum) return true;
  if (state.training?.participants.includes(charaNum)) return true;
  if (state.workRuntime?.entries.some((entry) => entry.charaNum === charaNum && entry.status === "active")) return true;
  if ((state.worldEvents ?? []).some((event) => event.kind === "banquet"
    && ["preparing", "active", "cleanup", "closing"].includes(event.phase)
    && event.participants.includes(charaNum))) return true;
  // A ready/active event already owns the cast for foreground presentation.
  // Defer instead of moving a shared NPC underneath that owner; the next
  // readiness pass will retry after the foreground event is consumed.
  return (state.narrativeEvents ?? []).some((event) =>
    event.status === "ready" || event.status === "active"
      ? event.participantIds.includes(charaNum)
      : false,
  );
}

/** A promised or accepted encounter must be delivered before this Arc can
 * advance offscreen again. Otherwise each background pass can replace its
 * window, cast and phase while the player is trying to meet it. */
function hasPendingArcEncounter(state: Readonly<GameState>, arc: Readonly<StoryArcInstanceV1>): boolean {
  const chance = arc.maintenance?.nextChance;
  return (chance != null && state.time.tickValue <= chance.latestTick)
    || (state.narrativeEvents ?? []).some((event) => event.arcId === arc.id
      && ["scheduled", "ready", "active"].includes(event.status));
}

function hasDueSignal(
  state: Readonly<GameState>,
  arc: Readonly<StoryArcInstanceV1>,
  trigger: NarrativeArcEvolutionTrigger,
): boolean {
  const now = state.time.tickValue;
  const evolution = arc.maintenance?.evolution;
  if ((evolution?.attemptsDayIndex === state.time.dayIndex && (evolution.attemptsToday ?? 0) >= NARRATIVE_ARC_EVOLUTION_DAILY_LIMIT)) return false;
  if (hasPendingStoryInteraction(arc)) {
    const i = arc.maintenance!.interaction!;
    return !i.assessmentAttempt || i.assessmentAttempt.revision !== i.revision || now >= i.assessmentAttempt.atTick + 180;
  }
  if (hasPendingArcEncounter(state, arc)) return false;
  if (evolution?.cooldownUntilTick !== undefined && now < evolution.cooldownUntilTick) return false;
  const missed = (state.narrativeEvents ?? []).some((event) => event.arcId === arc.id
    && event.status === "missed"
    && (event.nextAttemptTick === undefined || event.nextAttemptTick <= now));
  const nextChance = arc.maintenance?.nextChance?.earliestTick !== undefined
    && arc.maintenance.nextChance.earliestTick <= now;
  if (missed || nextChance) return true;
  if (evolution?.nextTrigger === trigger) return true;
  if (trigger === "clock-boundary" && evolution?.attemptsDayIndex !== state.time.dayIndex) return true;
  return trigger === "important-fact" && evolution === undefined;
}

/** Select one Arc only. The store serializes the provider pass globally. */
export function selectDueNarrativeArc(
  state: Readonly<GameState>,
  trigger: NarrativeArcEvolutionTrigger = "clock-boundary",
): NarrativeArcEvolutionSelection | null {
  const candidates = (state.storyArcs ?? [])
    .filter((arc) => arc.status === "active" && state.time.tickValue <= arc.deadlineTick)
    .filter((arc) => arcNpcIds(state, arc).length > 0)
    .filter((arc) => hasDueSignal(state, arc, trigger))
    .map((arc) => {
      const now = state.time.tickValue;
      const missed = (state.narrativeEvents ?? []).some((event) => event.arcId === arc.id
        && event.status === "missed"
        && (event.nextAttemptTick === undefined || event.nextAttemptTick <= now));
      const dueTick = arc.maintenance?.nextChance?.earliestTick ?? now;
      return { arc, missed, dueTick };
    })
    .sort((left, right) => Number(hasPendingStoryInteraction(right.arc)) - Number(hasPendingStoryInteraction(left.arc))
      || Number(right.missed) - Number(left.missed)
      || left.dueTick - right.dueTick
      || left.arc.id.localeCompare(right.arc.id));
  const selected = candidates[0];
  return selected ? { arc: selected.arc, trigger } : null;
}

export interface InteractionWindowSelectionOptions {
  /**
   * Require the player (or an Arc NPC) to already share a place with the
   * window. The presence-specialized contract is pinned by tests; the default
   * `false` serves pre-authoring, which must not depend on where the player
   * stands.
   */
  requirePresence?: boolean;
  /**
   * Authoring lead: without presence, an Arc is selectable once its window
   * opens within this many ticks, so the encounter is authored BEFORE the
   * player arrives and their arrival only picks it up. Bounded because a
   * far-future window would be authored against a snapshot of the world that
   * is days stale by the time the window opens.
   */
  leadTicks?: number;
}

/**
 * The active Arc whose promised interaction window is servable, or null. This
 * is the deterministic half of the foreground handoff: background evolution
 * may only promise a window (maintenance.nextChance), so the store calls this
 * on every readiness trigger and pins the returned Arc into a foreground
 * director pass. Missed/expired events for the Arc do not block the handoff —
 * they are exactly what produced the next chance.
 *
 * Two contracts share the candidate pipeline:
 *  - `requirePresence: true` (selectInteractionWindowArc): the window is open
 *    now AND the player can physically walk into it. This is the on-demand
 *    fallback for a window whose authoring has not happened yet.
 *  - default (pre-authoring): the window is open now, or opens within
 *    `leadTicks`; the player's location is irrelevant because the authored
 *    event waits as `scheduled` until presence promotes it. The
 *    foreground-conflict early-return is also dropped here: authoring does not
 *    own the stage (the real gates are isOpenStoryProgram inside the compile
 *    and hasPendingRealtimeAi at the action entry), and keeping it would idle
 *    through a date/work session and let the window expire unauthored.
 */
export function selectServableInteractionWindowArc(
  state: Readonly<GameState>,
  options: InteractionWindowSelectionOptions = {},
): StoryArcInstanceV1 | null {
  const now = state.time.tickValue;
  const requirePresence = options.requirePresence === true;
  if (requirePresence && deterministicForegroundConflict(state)) return null;
  const candidates = (state.storyArcs ?? [])
    .filter((arc) => arc.status === "active" && now <= arc.deadlineTick)
    .filter((arc) => !hasPendingStoryInteraction(arc))
    .filter((arc) => arcNpcIds(state, arc).length > 0)
    .filter((arc) => {
      const chance = arc.maintenance?.nextChance;
      if (!chance || now > chance.latestTick) return false;
      // No event for this Arc may already be waiting or on stage — this is
      // also the guard against authoring the same window twice.
      if ((state.narrativeEvents ?? []).some((event) => event.arcId === arc.id
        && (event.status === "scheduled" || event.status === "ready" || event.status === "active"))) return false;
      if (requirePresence) {
        if (chance.earliestTick > now) return false;
        const playerInWindow = chance.locationIds.includes(state.master.location);
        const npcHere = arcNpcIds(state, arc).some((id) => state.charas[id]?.location === state.master.location);
        return playerInWindow || npcHere;
      }
      return chance.earliestTick <= now + (options.leadTicks ?? 0);
    })
    .sort((left, right) => (left.maintenance?.nextChance?.earliestTick ?? 0) - (right.maintenance?.nextChance?.earliestTick ?? 0)
      || left.id.localeCompare(right.id));
  return candidates[0] ?? null;
}

/**
 * The presence-specialized contract: the window is open right now and the
 * player can physically walk into it. Retained as the on-demand fallback and
 * because its exact behavior is pinned by tests.
 */
export function selectInteractionWindowArc(state: Readonly<GameState>): StoryArcInstanceV1 | null {
  return selectServableInteractionWindowArc(state, { requirePresence: true });
}

/** One compact Chinese directive for the pinned foreground director pass, so
 * it spends its turn fulfilling the promised window instead of inventing a
 * new premise. */
export function describeArcInteractionIntent(arc: Readonly<StoryArcInstanceV1>): string {
  const chance = arc.maintenance?.nextChance;
  const pending = arc.maintenance?.evolution?.pendingPlayerIntents ?? [];
  const threads = arc.unresolvedThreads.slice(0, 2);
  return [
    `兑现剧情「${arc.title}」的玩家互动窗口（第 ${arc.phase} 阶段）`,
    pending.length > 0 ? `后台导演已留下 ${pending.length} 项待兑现的玩家互动意图` : null,
    threads.length > 0 ? `未解决的线索：${threads.join("；")}` : null,
    chance ? `互动窗口已开启，地点：${chance.locationIds.join("、")}` : null,
  ].filter(Boolean).join("；") + "。优先安排玩家与该 Arc 卡司的正面相遇。";
}

export function computeStoryArcHash(arc: Readonly<StoryArcInstanceV1>): string {
  return narrativeContextHash(arc);
}

/** Compile an NPC-only, reference-only request. No model or state mutation is
 * performed here; the caller can safely discard it when the provider is off. */
export function compileNarrativeArcEvolutionRequest(
  state: Readonly<GameState>,
  selection: NarrativeArcEvolutionSelection,
): NarrativeArcEvolutionRequestV1 | null {
  const { arc, trigger } = selection;
  if (hasPendingArcEncounter(state, arc) && !hasPendingStoryInteraction(arc)) return null;
  const participantIds = arcNpcIds(state, arc);
  if (participantIds.length === 0) return null;
  const baseArcHash = computeStoryArcHash(arc);
  const requestId = `arc-evolution:${arc.id}:${state.time.tickValue}:${trigger}:${baseArcHash}`;
  const capabilities = compileRuntimeCapabilityOptions(state, participantIds, {
    arcId: arc.id,
    includeWeatherLocations: arc.templateId === "weather-anomaly",
  });
  return {
    version: 1,
    requestId,
    arcId: arc.id,
    trigger,
    baseArcHash,
    ...(compileStoryInteractionRequest(state, arc) ? { interaction: compileStoryInteractionRequest(state, arc) } : {}),
    dayIndex: state.time.dayIndex,
    tick: state.time.tickValue,
    participantIds,
    locationIds: [...new Set(participantIds.map((id) => state.charas[id]?.location).filter((id): id is string => !!id))],
    capabilities,
    maintenance: arc.maintenance ? structuredClone(arc.maintenance) : null,
  };
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

/** Fail closed at the provider boundary. The proposal can only select options
 * already compiled by Runtime for this exact Arc snapshot. */
export function validateNarrativeArcEvolutionProposal(
  value: unknown,
  request: Readonly<NarrativeArcEvolutionRequestV1>,
): string[] {
  const diagnostics: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["background proposal must be an object"];
  const proposal = value as Record<string, unknown>;
  if (!exactKeys(proposal, ["version", "proposalId", "arcId", "baseArcHash", "outcome", "capabilityIds", "summary"], ["nextOpportunity", "interactionUpdate"])) {
    diagnostics.push("background proposal has unknown or missing fields");
  }
  if (proposal.version !== 1) diagnostics.push("background proposal version is unsupported");
  if (!boundedString(proposal.proposalId, 160)) diagnostics.push("background proposal id is invalid");
  if (proposal.arcId !== request.arcId) diagnostics.push("background proposal Arc does not match request");
  if (proposal.baseArcHash !== request.baseArcHash) diagnostics.push("background proposal is stale");
  if (proposal.interactionUpdate !== undefined) diagnostics.push(...validateStoryInteractionUpdate(proposal.interactionUpdate, request.interaction));
  if (request.interaction?.pending && proposal.interactionUpdate === undefined) diagnostics.push("pending interactions require an assessment");
  if (proposal.interactionUpdate !== undefined && proposal.capabilityIds instanceof Array && proposal.capabilityIds.length > 0) diagnostics.push("interaction assessment cannot execute background capabilities");
  if (proposal.interactionUpdate !== undefined && (proposal.outcome === "conclude") !== ((proposal.interactionUpdate as { frontier?: unknown })?.frontier === "conclude")) diagnostics.push("interaction conclusion disagrees with outcome");
  if ((proposal.interactionUpdate as { frontier?: unknown } | undefined)?.frontier === "keep" && proposal.outcome !== "defer") diagnostics.push("unchanged frontier cannot advance the Arc");
  const outcomes: NarrativeArcEvolutionOutcome[] = ["defer", "advance", "escalate", "conclude"];
  if (!outcomes.includes(proposal.outcome as NarrativeArcEvolutionOutcome)) diagnostics.push("background outcome is invalid");
  const capabilityIds = proposal.capabilityIds;
  if (!Array.isArray(capabilityIds) || capabilityIds.length > MAX_CAPABILITIES_PER_PASS
    || capabilityIds.some((id) => !boundedString(id, 160))
    || new Set(capabilityIds).size !== capabilityIds.length) {
    diagnostics.push("background capability ids are invalid");
  } else {
    const known = new Set(request.capabilities.flatMap((capability) => [capability.id, capability.idempotencyKey]));
    if (capabilityIds.some((id) => !known.has(id))) diagnostics.push("background capability is not in the request");
  }
  if (proposal.nextOpportunity !== undefined) {
    const opportunity = proposal.nextOpportunity;
    if (!opportunity || typeof opportunity !== "object" || Array.isArray(opportunity)) {
      diagnostics.push("background next opportunity is invalid");
    } else {
      const next = opportunity as Record<string, unknown>;
      if (!exactKeys(next, ["earliestTick", "latestTick", "locationIds"], ["onMiss"])) diagnostics.push("background next opportunity has unknown or missing fields");
      // An `earliestTick` before `request.tick` is NOT a defect: the model
      // naturally echoes the already-open window from `maintenance` (it was
      // created by an earlier pass), and rejecting that echo deadlocks the
      // arc — every future pass re-proposes the open window and every pass
      // fails validation (the「background earliest tick is invalid」loop).
      // An open window clamps to "open right now" in applyNextOpportunity;
      // only the far-future bound stays a hard rejection.
      if (!Number.isSafeInteger(next.earliestTick)
        || Number(next.earliestTick) > request.tick + 7 * 1440) diagnostics.push("background earliest tick is invalid");
      if (!Number.isSafeInteger(next.latestTick) || Number(next.latestTick) <= Number(next.earliestTick)
        || Number(next.latestTick) > request.tick + 14 * 1440) diagnostics.push("background latest tick is invalid");
      if (!Array.isArray(next.locationIds) || next.locationIds.length === 0 || next.locationIds.length > 8
        || next.locationIds.some((location) => !boundedString(location, 160) || !isKnownLocation(location))) diagnostics.push("background opportunity locations are invalid");
      if (next.onMiss !== undefined && !["defer", "expire", "conclude"].includes(String(next.onMiss))) diagnostics.push("background opportunity onMiss is invalid");
    }
  }
  if (!boundedString(proposal.summary, MAX_SUMMARY_LENGTH)) diagnostics.push("background summary is invalid");
  return [...new Set(diagnostics)];
}

function capabilityById(request: Readonly<NarrativeArcEvolutionRequestV1>, id: string): RuntimeCapabilityOption | undefined {
  return request.capabilities.find((capability) => capability.id === id || capability.idempotencyKey === id);
}

function npcCapabilityIsAllowed(state: Readonly<GameState>, arc: Readonly<StoryArcInstanceV1>, capability: RuntimeCapabilityOption): boolean {
  const participantIds = new Set(arcNpcIds(state, arc));
  if (capability.kind === "move") return capability.actorIds.length > 0
    && capability.actorIds.every((id) => participantIds.has(id) && !npcHasActiveOwner(state, id))
    && isKnownLocation(capability.locationId);
  if (capability.kind === "relationship-event") return capability.participantIds.length > 0
    && capability.participantIds.every((id) => participantIds.has(id) && !npcHasActiveOwner(state, id));
  if (capability.kind === "record-clue" || capability.kind === "set-arc-variable" || capability.kind === "schedule-next-window") return capability.arcId === arc.id;
  return capability.kind === "schedule-weather-incident";
}

function addBackgroundExperience(state: GameState, arc: Readonly<StoryArcInstanceV1>, request: Readonly<NarrativeArcEvolutionRequestV1>, capability: RuntimeCapabilityOption, summary: string): boolean {
  const actorIds = arcNpcIds(state, arc);
  if (actorIds.length === 0) return false;
  const locationIds = [...new Set(actorIds.map((id) => state.charas[id]?.location).filter((id): id is string => !!id))].slice(0, 8);
  if (locationIds.length === 0) return false;
  const id = `story-runtime:${arc.id}:${request.requestId}:${capability.id}`;
  const accepted = acceptExperience(state.acceptedExperiences ?? [], {
    id,
    schemaVersion: ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
    factClass: "story-runtime",
    kind: "story-beat",
    startTick: state.time.tickValue,
    endTick: state.time.tickValue,
    actorIds,
    participantIds: actorIds,
    locationIds,
    visibility: { participantIds: actorIds, witnessIds: [], public: false },
    sourceIds: [id],
    contextHash: request.baseArcHash,
    payload: {
      summary: summary.slice(0, MAX_SUMMARY_LENGTH),
      programId: arc.id,
      beatId: `background:${capability.id}`,
      outcomeId: capability.idempotencyKey,
    },
  });
  if (!accepted.accepted) return false;
  state.acceptedExperiences = accepted.experiences;
  return true;
}

function recordConfirmedChange(arc: StoryArcInstanceV1, id: string, text: string, tick: number): void {
  const maintenance = ensureArcMaintenance(arc);
  if (!maintenance.confirmedChanges.some((entry) => entry.id === id)) {
    maintenance.confirmedChanges = [...maintenance.confirmedChanges, { id, text: text.slice(0, MAX_SUMMARY_LENGTH), atTick: tick }].slice(-16);
  }
}

/**
 * Commit a promised interaction window (`nextChance`). A window that
 * outlives the arc is a dead promise: `selectInteractionWindowArc` filters
 * `now <= arc.deadlineTick` and reconciliation expires the arc past its
 * deadline, so an unclamped window can never fire (the「窗口期去地点无指示」
 * defect). The window is therefore kept inside the arc's lifetime — an
 * active arc's deadline extends just enough to serve a window proposed
 * beyond it, bounded to at most one further day.
 */
function applyNextOpportunity(arc: StoryArcInstanceV1, input: { earliestTick: number; latestTick: number; locationIds: string[]; onMiss?: "defer" | "expire" | "conclude" }): void {
  let deadline = arc.deadlineTick;
  let earliestTick = Math.max(0, Math.trunc(input.earliestTick));
  let latestTick = Math.max(earliestTick + 1, Math.trunc(input.latestTick));
  if (latestTick > deadline) {
    // Serve the promised window: extend the active arc's lifetime, bounded.
    const extended = Math.min(latestTick, deadline + 1440);
    arc.deadlineTick = extended;
    deadline = extended;
    latestTick = Math.min(latestTick, extended);
  }
  if (earliestTick > latestTick) earliestTick = latestTick;
  const opportunity = { earliestTick, latestTick, locationIds: [...new Set(input.locationIds)].slice(0, 8) };
  if (!arc.nextOpportunities.some((entry) => entry.earliestTick === opportunity.earliestTick && entry.latestTick === opportunity.latestTick && entry.locationIds.join("|") === opportunity.locationIds.join("|"))) {
    arc.nextOpportunities = [...arc.nextOpportunities, opportunity].slice(-8);
  }
  const maintenance = ensureArcMaintenance(arc);
  maintenance.disposition = "wait";
  maintenance.waitOn = { kind: "time", latestTick: opportunity.latestTick };
  maintenance.nextChance = { ...opportunity, onMiss: input.onMiss ?? "defer" };
}

/** Apply one validated proposal against the live state. Player-facing
 * capabilities are queued as intent receipts; they never mutate protagonist
 * location, time, money, inventory, relationship, or active dialogue. */
export function applyNarrativeArcEvolution(
  input: Readonly<GameState>,
  request: Readonly<NarrativeArcEvolutionRequestV1>,
  proposal: Readonly<NarrativeArcEvolutionProposalV1>,
): NarrativeArcEvolutionApplyResult {
  const state = cloneGameState(input);
  const diagnostics = validateNarrativeArcEvolutionProposal(proposal, request);
  const arc = state.storyArcs?.find((entry) => entry.id === request.arcId && entry.status === "active");
  if (!arc) diagnostics.push("background Arc is unavailable");
  if (arc && state.time.tickValue > arc.deadlineTick) diagnostics.push("background Arc deadline expired");
  if (arc && computeStoryArcHash(arc) !== request.baseArcHash) diagnostics.push("background Arc changed while provider was running");
  if (state.time.dayIndex !== request.dayIndex) diagnostics.push("background request day changed");
  if (arc && hasPendingArcEncounter(state, arc) && !request.interaction?.pending) diagnostics.push("background Arc is waiting for a player encounter");
  // Walking alone does not invalidate the Arc. Recheck the exact selected
  // grants against the live Runtime instead of requiring an unchanged clock.
  if (arc && Array.isArray(proposal.capabilityIds)) {
    const liveCapabilities = compileRuntimeCapabilityOptions(state, arcNpcIds(state, arc), {
      arcId: arc.id, includeWeatherLocations: arc.templateId === "weather-anomaly",
    });
    for (const id of proposal.capabilityIds) {
      const original = capabilityById(request, id);
      const live = liveCapabilities.find((entry) => entry.id === original?.id);
      // The tick stamp identifies the original receipt. Retain it for
      // idempotence; compare the actual grant parameters against live rules.
      if (!original || !live
        || narrativeContextHash({ ...original, idempotencyKey: "" }) !== narrativeContextHash({ ...live, idempotencyKey: "" })) {
        diagnostics.push("background capability changed while provider was running");
      }
    }
  }
  if ((state.acceptedAgentActionIds ?? []).includes(request.requestId)) diagnostics.push("background request was already settled");
  if (diagnostics.length > 0) return { state, accepted: false, diagnostics: [...new Set(diagnostics)], directCapabilityIds: [], deferredCapabilityIds: [] };

  if (proposal.interactionUpdate) applyStoryInteractionUpdate(state, arc!, proposal.interactionUpdate);

  const directCapabilityIds: string[] = [];
  const deferredCapabilityIds: string[] = [];
  const deferred = ensureArcEvolution(arc!);
  const selected = proposal.capabilityIds.map((id) => capabilityById(request, id)).filter((capability): capability is RuntimeCapabilityOption => capability !== undefined);
  for (const capability of selected) {
    const playerFacing = capability.kind === "advance-time"
      || capability.kind === "reward-bundle"
      || capability.kind === "open-interaction-window"
      || (capability.kind === "move" && capability.actorIds.includes(0))
      || (capability.kind === "relationship-event" && capability.participantIds.includes(0));
    if (playerFacing || !npcCapabilityIsAllowed(state, arc!, capability)) {
      deferredCapabilityIds.push(capability.id);
      deferred.pendingPlayerIntents = [...(deferred.pendingPlayerIntents ?? []), {
        capabilityId: capability.id,
        reason: playerFacing ? "requires a foreground player encounter" : "capability is outside the Arc NPC boundary",
        createdAtTick: state.time.tickValue,
      }].slice(-MAX_PENDING_PLAYER_INTENTS);
      continue;
    }
    let settled = true;
    switch (capability.kind) {
      case "move":
        for (const actorId of capability.actorIds) setSlotLocation(state.charas[actorId]!, capability.locationId);
        recordConfirmedChange(arc!, capability.id, capability.label, state.time.tickValue);
        break;
      case "record-clue": {
        const factId = `clue:${capability.clueId}`;
        if (!arc!.acceptedFactIds.includes(factId)) arc!.acceptedFactIds.push(factId);
        arc!.variables[`clue:${capability.clueId}`] = "accepted";
        const maintenance = ensureArcMaintenance(arc!);
        if (!maintenance.consumedEvidenceIds.includes(capability.clueId)) maintenance.consumedEvidenceIds.push(capability.clueId);
        recordConfirmedChange(arc!, capability.id, capability.summary, state.time.tickValue);
        break;
      }
      case "set-arc-variable":
        arc!.variables[capability.variableId] = capability.valueId;
        recordConfirmedChange(arc!, capability.id, capability.label, state.time.tickValue);
        break;
      case "schedule-next-window":
        applyNextOpportunity(arc!, {
          earliestTick: capability.earliestTick,
          latestTick: capability.latestTick,
          locationIds: [capability.locationId],
          onMiss: "defer",
        });
        recordConfirmedChange(arc!, capability.id, capability.label, state.time.tickValue);
        break;
      case "relationship-event":
        recordConfirmedChange(arc!, capability.id, capability.summary, state.time.tickValue);
        break;
      case "schedule-weather-incident": {
        const scheduled = scheduleWeatherIncident(state, capability.incident, arc!.id);
        settled = scheduled.accepted;
        diagnostics.push(...scheduled.diagnostics);
        if (settled) recordConfirmedChange(arc!, capability.id, capability.incident.label, state.time.tickValue);
        break;
      }
      default:
        settled = false;
        break;
    }
    if (settled) {
      directCapabilityIds.push(capability.id);
      addBackgroundExperience(state, arc!, request, capability, capability.kind === "record-clue" || capability.kind === "relationship-event" ? capability.summary : capability.label);
    } else {
      deferredCapabilityIds.push(capability.id);
    }
  }

  if (proposal.nextOpportunity && proposal.interactionUpdate?.frontier !== "keep") applyNextOpportunity(arc!, proposal.nextOpportunity);
  else if (!arc!.maintenance?.nextChance && proposal.outcome !== "conclude" && proposal.interactionUpdate?.frontier !== "keep") {
    const locations = [...new Set(arcNpcIds(state, arc!).map((id) => state.charas[id]?.location).filter((id): id is string => !!id))];
    if (locations.length > 0) {
      const earliestTick = Math.min(arc!.deadlineTick, state.time.tickValue + (proposal.interactionUpdate?.frontier === "replan" ? 0 : NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS));
      applyNextOpportunity(arc!, { earliestTick, latestTick: Math.min(arc!.deadlineTick, earliestTick + 6 * 60), locationIds: locations, onMiss: "defer" });
    }
  }

  if (proposal.outcome === "advance" || proposal.outcome === "escalate") arc!.phase = Math.min(32, arc!.phase + 1);
  const maintenance = ensureArcMaintenance(arc!);
  maintenance.recentScenes = [...maintenance.recentScenes, {
    programId: arc!.id,
    outcomeId: `background:${proposal.outcome}`,
    summary: proposal.summary.slice(0, MAX_SUMMARY_LENGTH),
    atTick: state.time.tickValue,
  }].slice(-16);
  deferred.backgroundSummary = proposal.summary.slice(0, MAX_SUMMARY_LENGTH);
  deferred.lastRequestId = request.requestId;
  deferred.lastAttemptTick = state.time.tickValue;
  if (!request.interaction?.pending) deferred.attemptsToday = deferred.attemptsDayIndex === state.time.dayIndex ? (deferred.attemptsToday ?? 0) + 1 : 1;
  deferred.attemptsDayIndex = state.time.dayIndex;
  deferred.cooldownUntilTick = state.time.tickValue + NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS;
  deferred.nextTrigger = "clock-boundary";
  if (proposal.outcome === "conclude" && (deferred.pendingPlayerIntents ?? []).length === 0) {
    arc!.status = "completed";
    maintenance.disposition = "conclude";
    maintenance.waitOn = null;
    maintenance.nextChance = null;
    arc!.lifecycleReason = "background Arc concluded";
  }
  state.acceptedAgentActionIds = [...(state.acceptedAgentActionIds ?? []), request.requestId].slice(-128);
  projectDaytimeAgentFacts(state, { relatedCharacterIds: arcNpcIds(state, arc!) });
  return { state, accepted: true, diagnostics: [...new Set(diagnostics)], directCapabilityIds, deferredCapabilityIds };
}

export { NARRATIVE_MAX_ACTIVE_ARCS };
