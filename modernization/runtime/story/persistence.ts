import type { NarrativeEventInstance, NarrativeSituationSessionV1, StoryArcInstanceV1, StoryArcMaintenanceV1, StoryTemplateFavoriteRequest } from "./types.js";
import { isStoryProgramV2 } from "./validator-v2.js";
import { normalizeParkedStoryProgram } from "./reconciliation.js";
import type { StoryProgramV2 } from "./types.js";
import { NARRATIVE_PLAYER_INTENT_MAX_LENGTH, NARRATIVE_MAX_PARTICIPANTS, NARRATIVE_MAX_NPCS } from "./types.js";
import { isStoryBackgroundV1 } from "./background.js";
import { isStoryInteractionState } from "./interaction-progress.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const expected = [...required, ...optional.filter((key) => value[key] !== undefined)].sort();
  const actual = Object.keys(value).sort();
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

function text(value: unknown, max = 240): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function integerList(value: unknown, max = 16): value is number[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0) && new Set(value).size === value.length;
}

function stringList(value: unknown, max = 32): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => text(entry)) && new Set(value).size === value.length;
}

export function validateNarrativeEventInstance(value: unknown): string[] {
  if (!isRecord(value)) return ["narrative event must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, ["version", "id", "title", "status", "participantIds", "locationIds", "windowStartTick", "windowEndTick", "deferCount", "createdAtTick", "contextHash", "program"], ["introText", "objectiveText", "startCommandLabel", "arcId", "anchor", "manual", "lifecycleReason", "missCount", "lastMissedTick", "nextAttemptTick", "openingRecorded"])) diagnostics.push("narrative event has unknown or missing fields");
  if (value.manual !== undefined && typeof value.manual !== "boolean") diagnostics.push("narrative event manual flag is invalid");
  if (value.openingRecorded !== undefined && typeof value.openingRecorded !== "boolean") diagnostics.push("narrative event opening flag is invalid");
  for (const key of ["missCount", "lastMissedTick", "nextAttemptTick"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) diagnostics.push(`narrative event ${key} is invalid`);
  }
  if (value.lifecycleReason !== undefined && !text(value.lifecycleReason)) diagnostics.push("narrative event lifecycle reason is invalid");
  if (value.version !== 1 || !text(value.id) || !text(value.title) || !text(value.contextHash)) diagnostics.push("narrative event identity is invalid");
  if (!(new Set(["scheduled", "ready", "active", "missed", "resolved", "expired", "cancelled"])).has(String(value.status))) diagnostics.push("narrative event status is invalid");
  if (!integerList(value.participantIds, NARRATIVE_MAX_PARTICIPANTS) || value.participantIds.length < 1) diagnostics.push("narrative event participants are invalid");
  if (!stringList(value.locationIds, 8) || value.locationIds.length < 1) diagnostics.push("narrative event locations are invalid");
  if (!Number.isSafeInteger(value.windowStartTick) || !Number.isSafeInteger(value.windowEndTick) || Number(value.windowEndTick) <= Number(value.windowStartTick)) diagnostics.push("narrative event window is invalid");
  if (!Number.isSafeInteger(value.deferCount) || Number(value.deferCount) < 0 || Number(value.deferCount) > 1) diagnostics.push("narrative event deferCount is invalid");
  if (!Number.isSafeInteger(value.createdAtTick) || Number(value.createdAtTick) < 0) diagnostics.push("narrative event createdAtTick is invalid");
  if (!isStoryProgramV2(value.program)) diagnostics.push("narrative event program is invalid");
  if (value.introText !== undefined && !text(value.introText, 800)) diagnostics.push("narrative event intro is invalid");
  if (value.objectiveText !== undefined && !text(value.objectiveText, 300)) diagnostics.push("narrative event objective is invalid");
  if (value.startCommandLabel !== undefined && !text(value.startCommandLabel, 80)) diagnostics.push("narrative event start command is invalid");
  if (value.arcId !== undefined && !text(value.arcId)) diagnostics.push("narrative event arcId is invalid");
  if (value.anchor !== undefined && !["tanabata", "weather-anomaly", "free"].includes(String(value.anchor))) diagnostics.push("narrative event anchor is invalid");
  return diagnostics;
}

export function isNarrativeEventInstance(value: unknown): value is NarrativeEventInstance {
  return validateNarrativeEventInstance(value).length === 0;
}

export function validateStoryArcInstanceV1(value: unknown): string[] {
  if (!isRecord(value)) return ["story arc must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, ["version", "id", "templateId", "title", "status", "phase", "participantRoles", "goals", "acceptedFactIds", "unresolvedThreads", "deadlineTick", "variables", "beatHistory", "nextOpportunities", "providerFailureDays"], ["maintenance", "lifecycleReason", "background"])) diagnostics.push("story arc has unknown or missing fields");
  if (value.background !== undefined && !isStoryBackgroundV1(value.background)) diagnostics.push("story arc background is invalid");
  if (value.maintenance !== undefined) diagnostics.push(...validateArcMaintenance(value.maintenance));
  if (value.lifecycleReason !== undefined && !text(value.lifecycleReason)) diagnostics.push("story arc lifecycle reason is invalid");
  if (value.version !== 1 || !text(value.id) || !text(value.templateId) || !text(value.title)) diagnostics.push("story arc identity is invalid");
  if (!["active", "paused", "completed", "abandoned", "expired"].includes(String(value.status))) diagnostics.push("story arc status is invalid");
  if (!Number.isSafeInteger(value.phase) || Number(value.phase) < 1 || Number(value.phase) > 32) diagnostics.push("story arc phase is invalid");
  if (!Array.isArray(value.participantRoles) || value.participantRoles.length < 1 || value.participantRoles.length > NARRATIVE_MAX_PARTICIPANTS || value.participantRoles.some((entry) => !isRecord(entry) || !exactKeys(entry, ["characterId", "roleId"]) || !Number.isSafeInteger(entry.characterId) || Number(entry.characterId) < 0 || !text(entry.roleId))) diagnostics.push("story arc participant roles are invalid");
  if (!stringList(value.goals, 8) || !stringList(value.acceptedFactIds, 64) || !stringList(value.unresolvedThreads, 16)) diagnostics.push("story arc bounded lists are invalid");
  if (!Number.isSafeInteger(value.deadlineTick) || Number(value.deadlineTick) < 0) diagnostics.push("story arc deadline is invalid");
  if (!isRecord(value.variables) || Object.entries(value.variables).length > 24 || Object.entries(value.variables).some(([key, entry]) => !text(key) || !text(entry))) diagnostics.push("story arc variables are invalid");
  if (!Array.isArray(value.beatHistory) || value.beatHistory.length > 64 || value.beatHistory.some((entry) => !isRecord(entry) || !exactKeys(entry, ["eventId", "programId", "outcomeId", "resolvedAtTick"]) || !text(entry.eventId) || !text(entry.programId) || !text(entry.outcomeId) || !Number.isSafeInteger(entry.resolvedAtTick))) diagnostics.push("story arc beat history is invalid");
  if (!Array.isArray(value.nextOpportunities) || value.nextOpportunities.length > 8 || value.nextOpportunities.some((entry) => !isRecord(entry) || !exactKeys(entry, ["earliestTick", "latestTick", "locationIds"]) || !Number.isSafeInteger(entry.earliestTick) || !Number.isSafeInteger(entry.latestTick) || Number(entry.latestTick) <= Number(entry.earliestTick) || !stringList(entry.locationIds, 8))) diagnostics.push("story arc opportunities are invalid");
  if (!Number.isSafeInteger(value.providerFailureDays) || Number(value.providerFailureDays) < 0 || Number(value.providerFailureDays) > 30) diagnostics.push("story arc provider failure count is invalid");
  return diagnostics;
}

export function isStoryArcInstanceV1(value: unknown): value is StoryArcInstanceV1 {
  return validateStoryArcInstanceV1(value).length === 0;
}

const ARC_DISPOSITIONS = ["continue", "wait", "paused", "conclude"];
const ARC_WAIT_KINDS = ["time", "event", "meeting", "player-action"];
const ARC_MISS_POLICIES = ["defer", "expire", "conclude"];

function optionalText(value: unknown, max: number): boolean {
  return value === undefined || text(value, max);
}

/** Bounded exactly like the rest of the Arc: every list has a ceiling so a save
 * cannot grow without limit, and a text field has a length cap. */
export function validateArcMaintenance(value: unknown): string[] {
  if (!isRecord(value)) return ["story arc maintenance must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, ["conflict", "confirmedChanges", "disposition", "waitOn", "nextChance", "lastFailure", "recentScenes", "consumedEvidenceIds", "plannedBeats"], ["evolution", "interaction", "executedCapabilityIds"])) {
    diagnostics.push("story arc maintenance has unknown or missing fields");
  }
  if (value.evolution !== undefined) diagnostics.push(...validateArcEvolutionState(value.evolution));
  if (value.interaction !== undefined && !isStoryInteractionState(value.interaction)) diagnostics.push("story interaction state is invalid");
  if (value.executedCapabilityIds !== undefined && !stringList(value.executedCapabilityIds, 512)) diagnostics.push("story capability ledger is invalid");
  if (value.conflict !== null) {
    const conflict = value.conflict;
    if (!isRecord(conflict) || !exactKeys(conflict, ["summary", "sides"])
      || !text(conflict.summary, 300)
      || !Array.isArray(conflict.sides) || conflict.sides.length < 1 || conflict.sides.length > NARRATIVE_MAX_PARTICIPANTS
      || conflict.sides.some((side) => !isRecord(side) || !exactKeys(side, ["characterId", "wants"])
        || !Number.isSafeInteger(side.characterId) || Number(side.characterId) < 0
        || !text(side.wants, 400))) {
      diagnostics.push("story arc conflict is invalid");
    }
  }
  if (!Array.isArray(value.confirmedChanges) || value.confirmedChanges.length > 16
    || value.confirmedChanges.some((entry) => !isRecord(entry) || !exactKeys(entry, ["id", "text", "atTick"])
      || !text(entry.id, 160) || !text(entry.text, 300)
      || !Number.isSafeInteger(entry.atTick) || Number(entry.atTick) < 0)) {
    diagnostics.push("story arc confirmed changes are invalid");
  }
  if (!ARC_DISPOSITIONS.includes(String(value.disposition))) diagnostics.push("story arc disposition is invalid");
  if (value.waitOn !== null) {
    const wait = value.waitOn;
    if (!isRecord(wait) || !exactKeys(wait, ["kind"], ["refId", "latestTick"])
      || !ARC_WAIT_KINDS.includes(String(wait.kind))
      || !optionalText(wait.refId, 160)
      || (wait.latestTick !== undefined && (!Number.isSafeInteger(wait.latestTick) || Number(wait.latestTick) < 0))) {
      diagnostics.push("story arc wait is invalid");
    }
  }
  if (value.nextChance !== null) {
    const chance = value.nextChance;
    if (!isRecord(chance) || !exactKeys(chance, ["earliestTick", "latestTick", "locationIds", "onMiss"])
      || !Number.isSafeInteger(chance.earliestTick) || Number(chance.earliestTick) < 0
      || !Number.isSafeInteger(chance.latestTick) || Number(chance.latestTick) <= Number(chance.earliestTick)
      || !stringList(chance.locationIds, 8) || chance.locationIds.length < 1
      || !ARC_MISS_POLICIES.includes(String(chance.onMiss))) {
      diagnostics.push("story arc next chance is invalid");
    }
  }
  if (value.lastFailure !== null) {
    const failure = value.lastFailure;
    if (!isRecord(failure) || !exactKeys(failure, ["atTick", "reason"])
      || !Number.isSafeInteger(failure.atTick) || Number(failure.atTick) < 0
      || !text(failure.reason, 300)) {
      diagnostics.push("story arc last failure is invalid");
    }
  }
  if (!Array.isArray(value.recentScenes) || value.recentScenes.length > 16
    || value.recentScenes.some((entry) => !isRecord(entry) || !exactKeys(entry, ["programId", "outcomeId", "summary", "atTick"])
      || !text(entry.programId, 160) || !text(entry.outcomeId, 160) || !text(entry.summary, 300)
      || !Number.isSafeInteger(entry.atTick) || Number(entry.atTick) < 0)) {
    diagnostics.push("story arc recent scenes are invalid");
  }
  if (!stringList(value.consumedEvidenceIds, 32)) diagnostics.push("story arc consumed evidence is invalid");
  if (!Array.isArray(value.plannedBeats) || value.plannedBeats.length > 16
    || value.plannedBeats.some((entry) => !isRecord(entry) || !exactKeys(entry, ["atTick", "kind"], ["refId"])
      || !Number.isSafeInteger(entry.atTick) || Number(entry.atTick) < 0
      || !text(entry.kind, 60) || !optionalText(entry.refId, 160))) {
    diagnostics.push("story arc planned beats are invalid");
  }
  return diagnostics;
}

export function isStoryArcMaintenanceV1(value: unknown): value is StoryArcMaintenanceV1 {
  return validateArcMaintenance(value).length === 0;
}

function validateArcEvolutionState(value: unknown): string[] {
  if (!isRecord(value)) return ["story arc evolution state must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, [], ["lastRequestId", "lastAttemptTick", "cooldownUntilTick", "attemptsDayIndex", "attemptsToday", "nextTrigger", "pendingPlayerIntents", "backgroundSummary"])) {
    diagnostics.push("story arc evolution state has unknown fields");
  }
  if (value.lastRequestId !== undefined && !text(value.lastRequestId, 256)) diagnostics.push("story arc evolution request id is invalid");
  for (const key of ["lastAttemptTick", "cooldownUntilTick", "attemptsDayIndex", "attemptsToday"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) diagnostics.push(`story arc evolution ${key} is invalid`);
  }
  if (value.attemptsToday !== undefined && Number(value.attemptsToday) > 3) diagnostics.push("story arc evolution daily budget is invalid");
  if (value.nextTrigger !== undefined && !["missed-window", "clock-boundary", "important-fact", "provider-retry"].includes(String(value.nextTrigger))) diagnostics.push("story arc evolution trigger is invalid");
  if (value.backgroundSummary !== undefined && !text(value.backgroundSummary, 300)) diagnostics.push("story arc background summary is invalid");
  if (value.pendingPlayerIntents !== undefined) {
    if (!Array.isArray(value.pendingPlayerIntents) || value.pendingPlayerIntents.length > 8
      || value.pendingPlayerIntents.some((entry) => !isRecord(entry) || !exactKeys(entry, ["capabilityId", "reason", "createdAtTick"])
        || !text(entry.capabilityId, 200) || !text(entry.reason, 300)
        || !Number.isSafeInteger(entry.createdAtTick) || Number(entry.createdAtTick) < 0)) {
      diagnostics.push("story arc pending player intents are invalid");
    }
  }
  return diagnostics;
}

function isSituationOption(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!exactKeys(value, ["id", "premise", "characters", "tension", "meetingPoint", "participantIds", "locationIds"])) return false;
  if (!text(value.id, 160) || !text(value.premise, 500) || !text(value.tension, 500) || !text(value.meetingPoint, 500)) return false;
  if (!Array.isArray(value.characters) || value.characters.length < 1 || value.characters.length > NARRATIVE_MAX_NPCS) return false;
  if (value.characters.some((entry) => !isRecord(entry)
    || !exactKeys(entry, ["characterId", "wants"])
    || !Number.isSafeInteger(entry.characterId) || Number(entry.characterId) < 0
    || !text(entry.wants, 400))) return false;
  if (!integerList(value.participantIds, NARRATIVE_MAX_PARTICIPANTS) || value.participantIds.length < 1) return false;
  if (!stringList(value.locationIds, 8) || value.locationIds.length < 1) return false;
  return true;
}

/** A malformed situation set is dropped whole: a partially understood menu
 * would offer the player choices the runtime cannot honour. */
export function normalizeNarrativeSituationSession(value: unknown): NarrativeSituationSessionV1 | null {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  if (!exactKeys(value, ["version", "id", "createdAtTick", "dayIndex", "contextHash", "situations"], ["playerIntent", "replacePending", "manual", "autoSelect", "arcId", "promisedLocationIds"])) return null;
  if (value.version !== 1 || !text(value.id) || !text(value.contextHash)) return null;
  if (!Number.isSafeInteger(value.createdAtTick) || Number(value.createdAtTick) < 0) return null;
  if (!Number.isSafeInteger(value.dayIndex) || Number(value.dayIndex) < 0) return null;
  if (!Array.isArray(value.situations) || value.situations.length < 1 || value.situations.length > 3) return null;
  if (!value.situations.every(isSituationOption)) return null;
  if (value.playerIntent !== undefined && !text(value.playerIntent, NARRATIVE_PLAYER_INTENT_MAX_LENGTH)) return null;
  if (value.replacePending !== undefined && typeof value.replacePending !== "boolean") return null;
  if (value.manual !== undefined && typeof value.manual !== "boolean") return null;
  if (value.autoSelect !== undefined && typeof value.autoSelect !== "boolean") return null;
  if (value.arcId !== undefined && !text(value.arcId, 200)) return null;
  if (value.promisedLocationIds !== undefined && !stringList(value.promisedLocationIds, 8)) return null;
  return structuredClone(value) as unknown as NarrativeSituationSessionV1;
}

export function normalizeNarrativeEvents(value: unknown, warnings: string[]): NarrativeEventInstance[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("discarded invalid narrative events");
    return [];
  }
  const candidates = value.map((entry: unknown) => {
    const copy = structuredClone(entry);
    if (isRecord(copy) && isRecord(copy.program) && copy.program.version === 2) normalizeParkedStoryProgram(copy.program as unknown as StoryProgramV2);
    return copy;
  });
  const accepted = candidates.filter(isNarrativeEventInstance).slice(-32);
  if (accepted.length !== value.length) warnings.push("discarded invalid narrative event instances");
  let activeSeen = false;
  for (const event of accepted) {
    if (event.status !== "active") continue;
    if (activeSeen) event.status = "ready";
    activeSeen = true;
  }
  return accepted;
}

export function normalizeStoryArcs(value: unknown, warnings: string[]): StoryArcInstanceV1[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("discarded invalid story arcs");
    return [];
  }
  // A malformed maintenance record costs only itself: the Arc it hangs off is
  // still readable, and an unreadable record is dropped rather than repaired.
  // Nothing here invents beliefs, secrets, or propagation history.
  const prepared = value.map((entry: unknown) => {
    const copy = structuredClone(entry);
    if (isRecord(copy) && isRecord(copy.maintenance) && copy.maintenance.interaction !== undefined && !isStoryInteractionState(copy.maintenance.interaction)) {
      delete copy.maintenance.interaction;
      warnings.push("discarded invalid story interaction state");
    }
    if (isRecord(copy) && copy.maintenance !== undefined && !isStoryArcMaintenanceV1(copy.maintenance)) {
      delete copy.maintenance;
      warnings.push("discarded invalid story arc maintenance");
    }
    if (isRecord(copy) && copy.background !== undefined && !isStoryBackgroundV1(copy.background)) {
      delete copy.background;
      warnings.push("discarded invalid story arc background");
    }
    return copy;
  });
  const accepted = prepared.filter(isStoryArcInstanceV1).map((entry) => structuredClone(entry));
  if (accepted.length !== value.length) warnings.push("discarded invalid story arc instances");
  const live = accepted.filter((arc) => arc.status === "active" || arc.status === "paused");
  if (live.length > 3) warnings.push("story arc live capacity exceeded; retained the first three live arcs");
  const retainedLive = new Set(live.slice(0, 3));
  return accepted.filter((arc) => !(arc.status === "active" || arc.status === "paused") || retainedLive.has(arc));
}

function isStoryTemplateFavoriteRequest(value: unknown): value is StoryTemplateFavoriteRequest {
  return isRecord(value)
    && exactKeys(value, ["version", "id", "eventId", "requestedAtTick", "suggestedTitle", "sourceProgram", "status"])
    && value.version === 1
    && text(value.id)
    && text(value.eventId)
    && Number.isSafeInteger(value.requestedAtTick)
    && Number(value.requestedAtTick) >= 0
    && text(value.suggestedTitle)
    && isStoryProgramV2(value.sourceProgram)
    && ["pending-export", "exported", "cancelled"].includes(String(value.status));
}

export function normalizeStoryTemplateFavorites(value: unknown, warnings: string[]): StoryTemplateFavoriteRequest[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push("discarded invalid story template favorites");
    return [];
  }
  const accepted = value.filter(isStoryTemplateFavoriteRequest).slice(-32).map((entry) => structuredClone(entry));
  if (accepted.length !== value.length) warnings.push("discarded invalid story template favorite requests");
  return accepted;
}
