import { cloneGameState, type GameState } from "../state/game-state.js";
import { ensureArcEvolution, ensureArcMaintenance } from "./arc-maintenance.js";
import type { NarrativeEventInstance, StoryProgramV2 } from "./types.js";
import { validateNarrativeEventInstance } from "./persistence.js";
import { isOpenStoryProgram, reconcileNarrativeState } from "./reconciliation.js";
import { cancelNarrativeHooks } from "./dialogue-hook.js";
import { narrativeCastWaitReason } from "./attendance.js";
import { setSlotLocation } from "../world/room-id-location.js";
import { hasPendingStoryInteraction } from "./interaction-progress.js";
import { recordStoryOpening } from "./opening.js";

export interface NarrativeFrequencyPolicy {
  id: "sparse" | "moderate" | "frequent";
  maxForegroundPerDay: number;
  maxForegroundPerSevenDays: number;
  maxActiveArcs: number;
}

export const NARRATIVE_FREQUENCY_POLICIES: Readonly<Record<NarrativeFrequencyPolicy["id"], NarrativeFrequencyPolicy>> = Object.freeze({
  sparse: { id: "sparse", maxForegroundPerDay: 1, maxForegroundPerSevenDays: 2, maxActiveArcs: 3 },
  moderate: { id: "moderate", maxForegroundPerDay: 1, maxForegroundPerSevenDays: 3, maxActiveArcs: 3 },
  frequent: { id: "frequent", maxForegroundPerDay: 2, maxForegroundPerSevenDays: 5, maxActiveArcs: 3 },
});

/** The foreground is only a projection of one of these live Arcs. */
export const NARRATIVE_MAX_ACTIVE_ARCS = 3;
export function activeNarrativeStoryCount(state: Readonly<GameState>): number {
  return (state.storyArcs ?? []).filter(arc => arc.status === "active" || arc.status === "paused").length
    + (state.storylets ?? []).filter(story => story.status === "active").length;
}
/** Three in-game hours. Automatic evolution is intentionally conservative. */
export const NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS = 3 * 60;
export const NARRATIVE_ARC_EVOLUTION_DAILY_LIMIT = 3;

export interface ScheduleNarrativeEventOptions {
  id: string;
  title: string;
  windowStartTick: number;
  windowEndTick: number;
  program: StoryProgramV2;
  introText?: string;
  objectiveText?: string;
  startCommandLabel?: string;
  arcId?: string;
  anchor?: NarrativeEventInstance["anchor"];
  policy?: NarrativeFrequencyPolicy;
  /** Player-requested story: the foreground budget neither blocks it nor
   * counts it. See `NarrativeEventInstance.manual`. */
  manual?: boolean;
}

export interface NarrativeMutationResult {
  state: GameState;
  accepted: boolean;
  diagnostics: string[];
  event?: NarrativeEventInstance;
}

/** Whether an event spends one of the frequency policy's foreground slots.
 * A manual story is the player's own request, so it is spent by neither
 * counter — see `NarrativeEventInstance.manual`. */
export function countsAgainstForegroundBudget(event: NarrativeEventInstance): boolean {
  return event.status !== "cancelled" && event.status !== "missed" && event.manual !== true;
}

export function scheduleNarrativeEvent(input: Readonly<GameState>, options: ScheduleNarrativeEventOptions): NarrativeMutationResult {
  const state = cloneGameState(input);
  const policy = options.policy ?? NARRATIVE_FREQUENCY_POLICIES.moderate;
  const existing = state.narrativeEvents ?? [];
  const dayIndex = Math.floor(options.windowStartTick / 1440);
  const diagnostics: string[] = [];
  if (existing.some((entry) => entry.status !== "cancelled" && (entry.id === options.id || entry.program.id === options.program.id))) diagnostics.push("narrative event id is already accepted");
  if (!options.manual) {
    if (existing.filter(countsAgainstForegroundBudget).filter((entry) => Math.floor(entry.windowStartTick / 1440) === dayIndex).length >= policy.maxForegroundPerDay) diagnostics.push("narrative daily foreground budget is exhausted");
    if (existing.filter(countsAgainstForegroundBudget).filter((entry) => Math.floor(entry.windowStartTick / 1440) >= dayIndex - 6 && Math.floor(entry.windowStartTick / 1440) <= dayIndex).length >= policy.maxForegroundPerSevenDays) diagnostics.push("narrative seven-day foreground budget is exhausted");
  }
  if (options.arcId && !state.storyArcs?.some((arc) => arc.id === options.arcId && arc.status === "active")) diagnostics.push("narrative event arc is unavailable");
  const event: NarrativeEventInstance = {
    version: 1,
    id: options.id,
    title: options.title,
    status: "scheduled",
    participantIds: [...options.program.actorIds],
    locationIds: [...options.program.locationIds],
    windowStartTick: options.windowStartTick,
    windowEndTick: options.windowEndTick,
    deferCount: 0,
    createdAtTick: input.time.tickValue,
    contextHash: options.program.contextHash,
    program: structuredClone(options.program),
    ...(options.introText ? { introText: options.introText } : {}),
    ...(options.objectiveText ? { objectiveText: options.objectiveText } : {}),
    ...(options.startCommandLabel ? { startCommandLabel: options.startCommandLabel } : {}),
    ...(options.arcId ? { arcId: options.arcId } : {}),
    ...(options.anchor ? { anchor: options.anchor } : {}),
    ...(options.manual ? { manual: true } : {}),
  };
  diagnostics.push(...validateNarrativeEventInstance(event));
  if (diagnostics.length > 0) return { state, accepted: false, diagnostics: [...new Set(diagnostics)] };
  state.narrativeEvents = [...existing, event].slice(-32);
  return { state, accepted: true, diagnostics: [], event };
}

export type NarrativeReadyTrigger = "morning" | "arrival" | "command-settled" | "clock-window";

/** Exported so the shell can explain why a waiting story is not presenting:
 * the same predicate gates readiness, and a second copy would drift. */
export function deterministicForegroundConflict(state: Readonly<GameState>): boolean {
  if (state.dateSession) return true;
  // WorkRuntime is the whole world's NPC schedule, not a player session.
  // A remote shopkeeper working must not reserve the player's foreground.
  if (state.workRuntime?.entries.some((entry) => entry.charaNum === 0 && entry.status === "active")) return true;
  if ((state.worldEvents ?? []).some((event) => event.kind === "banquet" && ["preparing", "active", "cleanup", "closing"].includes(event.phase))) return true;
  if (state.festivalEventSession || state.outingEventSession || state.dailyEventSession) return true;
  return false;
}

/** Deterministic readiness check. It never calls a provider. Existing forced
 * event/date/banquet/work owners win; a conflicting narrative window shifts
 * once by one hour, then waits until the window actually ends.
 *
 * `_trigger` names the entry point that asked for the refresh. Readiness itself
 * is a pure function of the clock, the foreground owners and the player's
 * location, so the result must not depend on who asked; the parameter is kept
 * so every call site stays explicit about where it is being asked from. */
export function refreshNarrativeEvents(
  input: Readonly<GameState>,
  _trigger: NarrativeReadyTrigger,
): GameState {
  const state = reconcileNarrativeState(input).state;
  const now = state.time.tickValue;
  const conflict = deterministicForegroundConflict(state);
  for (const event of state.narrativeEvents ?? []) {
    if (event.status !== "scheduled" && event.status !== "ready") continue;
    if (now > event.windowEndTick) {
      markNarrativeEventMissed(state, event);
      continue;
    }
    if (now < event.windowStartTick || narrativeCastWaitReason(state, event.program.actorIds, event.locationIds[0])
      || state.storyArcs?.some(a => a.id === event.arcId && hasPendingStoryInteraction(a))) {
      event.status = "scheduled";
      continue;
    }
    if (event.arcId && state.storyArcs?.some((arc) => arc.id === event.arcId && arc.status === "paused")) continue;
    if (conflict) {
      if (event.deferCount === 0) {
        event.deferCount = 1;
        event.windowStartTick += 60;
        event.windowEndTick += 60;
        const arc = state.storyArcs?.find((entry) => entry.id === event.arcId && entry.status === "active");
        if (arc) arc.deadlineTick = Math.max(arc.deadlineTick, event.windowEndTick);
      }
      // Repeated readiness calls are observations, not elapsed time. Keep the
      // event pending until its real deadline, even after the one deferral.
      event.status = "scheduled";
      continue;
    }
    const locationReady = event.locationIds.includes(state.master.location);
    const participantReady = event.participantIds.some((id) => id > 0 && state.charas[id]?.location === state.master.location);
    event.status = locationReady || participantReady ? "ready" : "scheduled";
  }
  return reconcileNarrativeState(state).state;
}

/**
 * A missed window is a state transition, not deletion. The Arc remains live
 * and receives a deterministic next chance for the background director.
 */
export function markNarrativeEventMissed(state: GameState, event: NarrativeEventInstance): void {
  if (event.status === "resolved" || event.status === "cancelled" || event.status === "expired") return;
  const now = state.time.tickValue;
  event.status = "missed";
  event.missCount = (event.missCount ?? 0) + 1;
  event.lastMissedTick = now;
  event.nextAttemptTick = now + NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS;
  event.program.status = "aborted";
  delete event.program.pausedStatus;
  event.lifecycleReason = "event window was missed; Arc remains active";
  if (!event.arcId) return;
  const arc = state.storyArcs?.find((entry) => entry.id === event.arcId && entry.status === "active");
  if (!arc) return;
  const maintenance = ensureArcMaintenance(arc);
  const evolution = ensureArcEvolution(arc);
  evolution.nextTrigger = "missed-window";
  evolution.cooldownUntilTick = event.nextAttemptTick;
  const existing = maintenance.nextChance;
  if (!existing || existing.latestTick < now) {
    const earliestTick = event.nextAttemptTick;
    maintenance.nextChance = {
      earliestTick,
      // The deadline can sit before the retry point (a missed event right at
      // the arc's end); without the floor this writes latestTick < earliestTick
      // — an inverted window that selectInteractionWindowArc can never serve.
      latestTick: Math.max(earliestTick + 1, Math.min(arc.deadlineTick, earliestTick + 6 * 60)),
      locationIds: [...event.locationIds],
      onMiss: "defer",
    };
  }
  maintenance.disposition = "wait";
  maintenance.waitOn = { kind: "event", refId: event.id, latestTick: maintenance.nextChance?.latestTick };
  maintenance.lastFailure = null;
}

/** Start the oldest ready event. Only one story owner may be active. */
export function activateReadyNarrativeEvent(input: Readonly<GameState>, eventId?: string): NarrativeMutationResult {
  const state = reconcileNarrativeState(input).state;
  if (isOpenStoryProgram(state.storyProgram) || state.narrativeEvents?.some((entry) => entry.status === "active")) return { state, accepted: false, diagnostics: ["another story owner is active"] };
  const event = (state.narrativeEvents ?? [])
    .filter((entry) => entry.status === "ready" && (eventId === undefined || entry.id === eventId)
      && (!entry.arcId || state.storyArcs?.some((arc) => arc.id === entry.arcId && arc.status === "active")))
    .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id))[0];
  if (!event) return { state, accepted: false, diagnostics: ["no ready narrative event"] };
  if (state.storyArcs?.some(a => a.id === event.arcId && hasPendingStoryInteraction(a))) return { state, accepted: false, diagnostics: ["story interaction assessment is pending"] };
  const waitReason = narrativeCastWaitReason(state, event.program.actorIds, event.locationIds[0]);
  const playerPresent = event.locationIds.includes(state.master.location)
    || event.participantIds.some(id => id > 0 && state.charas[id]?.location === state.master.location);
  if (waitReason || !playerPresent || deterministicForegroundConflict(state) || state.time.tickValue < event.windowStartTick || state.time.tickValue > event.windowEndTick) {
    event.status = "scheduled";
    return { state, accepted: false, diagnostics: [waitReason ?? "narrative event window or foreground is unavailable"] };
  }
  const sceneLocation = event.locationIds[0];
  if (!sceneLocation) return { state, accepted: false, diagnostics: ["narrative scene is unavailable"] };
  // Check the entire cast before moving anyone. Pending plans own no NPCs.
  for (const id of event.program.actorIds) {
    if (id === 0) continue;
    const slot = state.charas[id]!;
    if (slot.location !== sceneLocation) setSlotLocation(slot, sceneLocation);
  }
  event.status = "active";
  event.program.status = "active";
  state.storyProgram = structuredClone(event.program);
  if (!event.openingRecorded) {
    recordStoryOpening(state, state.storyProgram, sceneLocation, {
      introText: event.introText ?? event.title,
      objectiveText: event.objectiveText ?? "",
      startCommandLabel: event.startCommandLabel ?? "",
    });
    event.openingRecorded = true;
  }
  return { state, accepted: true, diagnostics: [], event };
}

/** Replace only an unchosen situation menu.
 *
 * The old implementation also cancelled every scheduled/ready event here.
 * That made a second manual L3 request erase a perfectly valid story before
 * the player had even entered it.  Multiple Arcs are now first-class state;
 * a new menu may supersede the previous menu, but never an accepted event or
 * its Arc.  The legacy name remains as a compatibility seam for callers. */
export function replacePendingNarrativeEvents(input: Readonly<GameState>): GameState {
  const state = cloneGameState(input);
  state.narrativeSituationSession = null;
  return state;
}

export function cancelNarrativeEvent(input: Readonly<GameState>, eventId: string): GameState {
  const state = cloneGameState(input);
  const event = state.narrativeEvents?.find((entry) => entry.id === eventId);
  if (!event || event.status === "resolved" || event.status === "expired") return state;
  event.status = "cancelled";
  event.program.status = "aborted";
  delete event.program.pausedStatus;
  if (state.storyProgram?.version === 2 && state.storyProgram.eventId === eventId && isOpenStoryProgram(state.storyProgram)) {
    state.storyProgram.status = "aborted";
    delete state.storyProgram.pausedStatus;
  }
  return reconcileNarrativeState(state).state;
}

export function setStoryArcStatus(input: Readonly<GameState>, arcId: string, status: "active" | "paused" | "abandoned"): GameState {
  const state = cloneGameState(input);
  const arc = state.storyArcs?.find((entry) => entry.id === arcId);
  if (!arc || !["active", "paused"].includes(arc.status)) return state;
  arc.status = status;
  if (status === "abandoned") {
    arc.lifecycleReason = "player ended story arc";
    arc.nextOpportunities = [];
    cancelNarrativeHooks(state, arcId);
    for (const event of state.narrativeEvents ?? []) {
      if (event.arcId === arcId) cancelNarrativeHooks(state, event.program.id);
    }
    if (state.storyProgram?.version === 2 && state.storyProgram.arcId === arcId) cancelNarrativeHooks(state, state.storyProgram.id);
    if (state.narrativeSituationSession?.arcId === arcId) state.narrativeSituationSession = null;
  }
  // Keep the maintenance record honest about what the Arc is doing. A record is
  // only updated if one already exists; flipping a status must not invent one.
  if (arc.maintenance) {
    if (status === "paused") arc.maintenance.disposition = "paused";
    else if (status === "abandoned") arc.maintenance.disposition = "conclude";
    else arc.maintenance.disposition = arc.maintenance.nextChance ? "wait" : "continue";
    if (arc.maintenance.disposition === "conclude") {
      arc.maintenance.waitOn = null;
      arc.maintenance.nextChance = null;
    }
  }
  return reconcileNarrativeState(state).state;
}

export function closeUnavailableStoryArcs(input: Readonly<GameState>, providerAvailable: boolean, arcId?: string): GameState {
  const state = reconcileNarrativeState(input).state;
  for (const arc of state.storyArcs ?? []) {
    if (arcId !== undefined && arc.id !== arcId) continue;
    if (arc.status !== "active") continue;
    if (state.time.tickValue > arc.deadlineTick) {
      arc.status = "expired";
      continue;
    }
    const failureDayKey = "runtime:last-provider-failure-day";
    if (providerAvailable) {
      arc.providerFailureDays = 0;
      delete arc.variables[failureDayKey];
      if (arc.maintenance) arc.maintenance.lastFailure = null;
    } else if (arc.variables[failureDayKey] !== String(state.time.dayIndex)) {
      arc.providerFailureDays = Math.min(30, arc.providerFailureDays + 1);
      arc.variables[failureDayKey] = String(state.time.dayIndex);
      // Say why this Arc made no progress today, so "nothing happened" is
      // distinguishable from "generation kept failing".
      const maintenance = ensureArcMaintenance(arc);
      maintenance.lastFailure = { atTick: state.time.tickValue, reason: "narrative provider unavailable" };
      const evolution = ensureArcEvolution(arc);
      evolution.nextTrigger = "provider-retry";
      evolution.cooldownUntilTick = state.time.tickValue + NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS;
    }
  }
  return reconcileNarrativeState(state).state;
}
