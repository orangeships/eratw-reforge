import { cloneGameState, type GameState } from "../state/game-state.js";
import { ensureArcEvolution, ensureArcMaintenance } from "./arc-maintenance.js";
import type { StoryArcInstanceV1, StoryProgramV2 } from "./types.js";

const MISSED_EVENT_COOLDOWN_TICKS = 3 * 60;

type StoryArcEventLike = {
  id: string;
  locationIds: string[];
  status: string;
  program: StoryProgramV2;
  missCount?: number;
  lastMissedTick?: number;
  nextAttemptTick?: number;
};

function retainMissedOpportunity(state: GameState, event: StoryArcEventLike, arc: StoryArcInstanceV1 | undefined): void {
  const now = state.time.tickValue;
  event.missCount = (event.missCount ?? 0) + (event.lastMissedTick === now ? 0 : 1);
  event.lastMissedTick = now;
  event.nextAttemptTick ??= now + MISSED_EVENT_COOLDOWN_TICKS;
  event.program.status = "aborted";
  delete event.program.pausedStatus;
  if (!arc || arc.status !== "active") return;
  const maintenance = ensureArcMaintenance(arc);
  const evolution = ensureArcEvolution(arc);
  evolution.nextTrigger = "missed-window";
  evolution.cooldownUntilTick = event.nextAttemptTick;
  const earliestTick = event.nextAttemptTick;
  const latestTick = Math.min(arc.deadlineTick, earliestTick + 6 * 60);
  if (!maintenance.nextChance || maintenance.nextChance.latestTick < now) {
    maintenance.nextChance = { earliestTick, latestTick, locationIds: [...event.locationIds], onMiss: "defer" };
  }
  maintenance.disposition = "wait";
  maintenance.waitOn = { kind: "event", refId: event.id, latestTick };
}

const LEGACY_CORRUPT_FREE_TITLE = "涓€娈电煭鏁呬簨";
const LEGACY_CORRUPT_FREE_GOAL = "鍦ㄥ綋鍓嶄笘鐣屽紑灞曚竴娈靛彲缁х画鐨勭煭鏁呬簨";
const LEGACY_CORRUPT_FREE_THREAD = "鏁呬簨鐨勪笅涓€涓彂灞曟柟鍚戝皻鏈畾";

/** Text repair only. Every array here is read defensively: this runs from
 * `reconcileNarrativeState`, which is called on every state read, so a
 * malformed or partially-stripped Arc must not be able to throw and take the
 * whole game down with it. There is nothing to repair when the field is
 * absent, and inventing a value would be worse than leaving it unset. */
function repairLegacyFreeStoryText(arc: StoryArcInstanceV1): void {
  if (arc.templateId !== "free-story") return;
  if (arc.title === LEGACY_CORRUPT_FREE_TITLE) arc.title = "一段短故事";
  if (Array.isArray(arc.goals)) {
    arc.goals = arc.goals.map((goal) => goal === LEGACY_CORRUPT_FREE_GOAL
      ? "在当前世界展开一段可继续的短故事"
      : goal);
  }
  if (Array.isArray(arc.unresolvedThreads)) {
    arc.unresolvedThreads = arc.unresolvedThreads.map((thread) => thread === LEGACY_CORRUPT_FREE_THREAD
      ? "故事的下一个发展方向尚未确定"
      : thread);
  }
}

/** A closed Arc is not waiting for anything. Kept here rather than in a writer
 * so every close path agrees on what a dead Arc's record says. */
function concludeArcRecord(arc: StoryArcInstanceV1): void {
  if (!arc.maintenance) return;
  arc.maintenance.disposition = "conclude";
  arc.maintenance.waitOn = null;
  arc.maintenance.nextChance = null;
}

export function isOpenStoryProgram(program: { status: string } | null | undefined): boolean {
  return !!program && ["active", "awaiting-player", "paused"].includes(program.status);
}

/** Old parked saves retained dead branches. A closed round has no live graph;
 * its accepted summary survives, but no node may be executed again. */
export function normalizeParkedStoryProgram(program: StoryProgramV2): void {
  if (program.status !== "awaiting-player" && !(program.status === "paused" && program.pausedStatus === "awaiting-player")) return;
  if (program.cursorNodeId !== null) return;
  program.nodes = [];
  program.startNodeId = "";
  program.executedNodeIds = [];
  program.executedCapabilityIds = [];
  program.selectedChoices = {};
  program.capabilities = [];
}

/** No provider, no gameplay effects. Repeated calls produce identical state.
 * Explicit diagnostics are also retained on the affected narrative object. */
export function reconcileNarrativeState(input: Readonly<GameState>): { state: GameState; diagnostics: string[] } {
  const state = cloneGameState(input);
  const diagnostics: string[] = [];
  // A shipped placeholder used mojibake as its title and could be left behind
  // as an empty abandoned Arc. Remove only that known empty shell; repair the
  // text in any live or historically meaningful Arc instead of deleting it.
  const removedArcIds = new Set((state.storyArcs ?? [])
    .filter((arc) => arc.templateId === "free-story"
      && arc.title === LEGACY_CORRUPT_FREE_TITLE
      && arc.status === "abandoned"
      && arc.beatHistory.length === 0
      && arc.acceptedFactIds.length === 0)
    .map((arc) => arc.id));
  if (removedArcIds.size > 0) {
    state.storyArcs = (state.storyArcs ?? []).filter((arc) => !removedArcIds.has(arc.id));
    state.narrativeEvents = (state.narrativeEvents ?? []).filter((event) => !event.arcId || !removedArcIds.has(event.arcId));
    diagnostics.push(...[...removedArcIds].map((id) => `${id}: removed corrupt empty legacy StoryArc`));
  }
  for (const arc of state.storyArcs ?? []) repairLegacyFreeStoryText(arc);
  // Event -> program -> arc invalidation can cascade. Three bounded passes
  // settle all owners without cloning the full game between passes.
  for (let pass = 0; pass < 3; pass += 1) diagnostics.push(...reconcileNarrativePass(state));
  return { state, diagnostics: [...new Set(diagnostics)] };
}

function reconcileNarrativePass(state: GameState): string[] {
  const diagnostics: string[] = [];
  const now = state.time.tickValue;
  const events = state.narrativeEvents ?? [];
  const arcs = state.storyArcs ?? [];
  const program = state.storyProgram?.version === 2 ? state.storyProgram : undefined;
  const liveEvent = (status: string) => ["scheduled", "ready", "active"].includes(status);
  const report = (object: { id: string; lifecycleReason?: string }, reason: string) => {
    if (object.lifecycleReason !== reason) diagnostics.push(`${object.id}: ${reason}`);
    object.lifecycleReason = reason;
  };
  for (const event of events) {
    normalizeParkedStoryProgram(event.program);
    // Before v32 a missed presentation was persisted as `expired`. Revive it
    // when its Arc is still active; the exact slot-2 orphan is removed by the
    // migration boundary before this reconciliation pass runs.
    const linkedArc = event.arcId ? arcs.find((arc) => arc.id === event.arcId) : undefined;
    if (event.status === "expired"
      && linkedArc?.status === "active"
      && event.program.status === "aborted"
      && event.lifecycleReason !== "explicitly expired") {
      event.status = "missed";
      event.lastMissedTick ??= Math.max(event.windowEndTick, now);
      retainMissedOpportunity(state, event, linkedArc);
      report(event, "event window was missed; Arc remains active");
    }
    if (["scheduled", "ready"].includes(event.status) && now > event.windowEndTick) {
      event.status = "missed";
      retainMissedOpportunity(state, event, linkedArc);
      report(event, "event window was missed; Arc remains active");
    }
  }
  if (program) normalizeParkedStoryProgram(program);
  for (const arc of arcs) {
    if (arc.status !== "active" && arc.status !== "paused") continue;
    if (now > arc.deadlineTick) {
      arc.status = "expired";
      concludeArcRecord(arc);
      report(arc, "arc deadline expired");
      continue;
    }
    const linked = events.filter((event) => event.arcId === arc.id);
    const evidence = linked.filter((event) => liveEvent(event.status)
      && event.program.arcId === arc.id
      && event.program.actorIds.some((id) => id > 0 && !!state.charas[id])
      && event.program.actorIds.every((id) => id === 0 || !!state.charas[id]))
      .sort((a, b) => b.createdAtTick - a.createdAtTick || a.id.localeCompare(b.id))[0];
    if (evidence) {
      const ids = evidence.program.actorIds;
      if (arc.participantRoles.length !== ids.length || arc.participantRoles.some((role) => !ids.includes(role.characterId))) {
        arc.participantRoles = ids.map((characterId) => arc.participantRoles.find((role) => role.characterId === characterId)
          ?? { characterId, roleId: characterId === 0 ? "player-entry" : "story-candidate" });
        report(arc, "restored cast from accepted event program");
      }
    }
    if (!arc.participantRoles.some((role) => role.characterId > 0 && !!state.charas[role.characterId])
      || arc.participantRoles.some((role) => role.characterId !== 0 && !state.charas[role.characterId])) {
      arc.status = "abandoned";
      concludeArcRecord(arc);
      report(arc, "arc has no valid cast evidence");
      continue;
    }
    const ownedProgram = program?.arcId === arc.id && isOpenStoryProgram(program);
    const hasNext = arc.nextOpportunities.some((window) => now <= window.latestTick);
    const hasMissedOpportunity = linked.some((event) => event.status === "missed");
    // A valid Arc with maintenance is an open line even when it currently has
    // no foreground event. The background controller will decide its next
    // opportunity; reconciliation must not silently abandon it.
    const hasBackgroundMaintenance = arc.maintenance !== undefined
      && arc.maintenance.disposition !== "conclude";
    // Weather phases already carry a deterministic continuation contract.
    const weatherContinuation = arc.templateId === "weather-anomaly" && arc.phase <= 3;
    if (!linked.some((event) => liveEvent(event.status)) && !ownedProgram && !hasNext
      && !hasMissedOpportunity && !hasBackgroundMaintenance && !weatherContinuation) {
      arc.status = "abandoned";
      concludeArcRecord(arc);
      report(arc, "arc has no live event or continuation");
    }
  }
  for (const event of events) {
    if (!liveEvent(event.status)) continue;
    const arc = event.arcId ? arcs.find((entry) => entry.id === event.arcId) : undefined;
    if (event.arcId && (!arc || !["active", "paused"].includes(arc.status))) {
      event.status = "cancelled";
      report(event, "event arc is unavailable");
    } else if (event.status === "active" && (!program || program.id !== event.program.id || program.eventId !== event.id || !isOpenStoryProgram(program))) {
      event.status = program?.eventId === event.id && program.status === "completed" ? "resolved" : "cancelled";
      if (program?.id === event.program.id && program.eventId === event.id) event.program = structuredClone(program);
      report(event, "event has no live program owner");
    }
    if (event.status === "cancelled") {
      event.program.status = "aborted";
      delete event.program.pausedStatus;
    }
  }
  if (program && isOpenStoryProgram(program)) {
    const event = events.find((entry) => entry.id === program.eventId);
    const arc = arcs.find((entry) => entry.id === program.arcId);
    const unavailable = (program.eventId && (!event || event.status !== "active" || event.program.id !== program.id))
      || (program.arcId && (!arc || !["active", "paused"].includes(arc.status)));
    // Standalone V2 fixtures have no event owner and remain supported.
    if (unavailable || (!program.arcId && event && program.status !== "active" && now > event.windowEndTick)) {
      program.status = "aborted";
      delete program.pausedStatus;
      report(program, "story owner is unavailable or expired");
      if (event && liveEvent(event.status)) event.status = "cancelled";
    } else if (arc?.status === "paused" && program.status !== "paused") {
      program.pausedStatus = program.status as "active" | "awaiting-player";
      program.status = "paused";
    } else if (arc?.status === "active" && program.status === "paused") {
      program.status = program.pausedStatus ?? "awaiting-player";
      delete program.pausedStatus;
    }
    if (event) event.program = structuredClone(program);
  }
  if (state.activeEventContext?.arcId) {
    const arc = arcs.find((entry) => entry.id === state.activeEventContext?.arcId);
    if (!arc || arc.status !== "active") state.activeEventContext = null;
  }
  return diagnostics;
}

/** Called only by successful, player-owned settlement/publication paths.
 * Log messages and story-generated dialogue are deliberately not inputs. */
export function recordStoryPlayerInteraction(
  state: GameState,
  receipt: { id: string; targetId: number; commandNo: number; summary?: string },
): boolean {
  const program = state.storyProgram;
  if (!program || program.version !== 2 || program.status !== "awaiting-player"
    || receipt.targetId <= 0 || !program.actorIds.includes(receipt.targetId)
    || program.continuationEvidence?.id === receipt.id) return false;
  if (program.arcId && !state.storyArcs?.some((arc) => arc.id === program.arcId && arc.status === "active")) return false;
  const summary = receipt.summary?.trim().slice(0, 1_000);
  program.continuationEvidence = { id: receipt.id, targetId: receipt.targetId, commandNo: receipt.commandNo,
    tick: state.time.tickValue, roundIndex: program.roundIndex ?? 0, ...(summary ? { summary } : {}) };
  const event = state.narrativeEvents?.find((entry) => entry.id === program.eventId);
  if (event) event.program = structuredClone(program);
  return true;
}

/** Save only the validated presentation of an already-executed beat for later recaps. */
export function recordStoryExpressionReceipt(state: GameState,
  receipt: { programId: string; beatId: string; contextHash: string; fallbackText: string }, lines: readonly string[]): boolean {
  const program = state.storyProgram;
  if (!program || program.version !== 2 || program.id !== receipt.programId || program.contextHash !== receipt.contextHash
    || lines.length < 1 || lines.length > 8 || lines.some(line => !line.trim() || line.length > 800)) return false;
  const node = program.nodes.find(entry => entry.id === receipt.beatId);
  if (node && program.executedNodeIds.includes(node.id)) {
    if (node.kind === "expression") node.fallbackText = lines.join("\n");
    else if (node.kind === "bounded-talk") node.fallbackLines = [...lines];
    else return false;
  } else {
    const round = [...(program.rounds ?? [])].reverse().find(entry => entry.nodeIds.includes(receipt.beatId));
    if (!round) return false;
    const fallback = receipt.fallbackText.split("\n");
    const index = round.narration.findIndex((_, start) => fallback.every((text, offset) => round.narration[start + offset] === text));
    if (index < 0) return false;
    round.narration.splice(index, fallback.length, ...lines);
    round.narration = round.narration.slice(-8);
  }
  const event = state.narrativeEvents?.find(entry => entry.id === program.eventId);
  if (event) event.program = structuredClone(program);
  return true;
}
