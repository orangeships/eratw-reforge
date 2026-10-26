import type { GameState } from "./state/game-state.js";

/**
 * A-Slim S0/S1 — bounded, accepted narrative experience.
 *
 * Experience is system-accepted narrative history. It is not character
 * knowledge (AgentObservation), subjective cognition, or a source of
 * canonical gameplay state. This module is browser-safe and has no model or
 * persistence dependency.
 */

export const ACCEPTED_EXPERIENCE_SCHEMA_VERSION = 1 as const;
export const MAX_ACCEPTED_EXPERIENCES = 256;
export const MAX_SELECTED_EXPERIENCES = 8;
export const MAX_L1_EXPERIENCES = 3;
export const L1_EXPERIENCE_LOOKBACK_TICKS = 7 * 24 * 60;

const MAX_ID_LENGTH = 160;
export const MAX_SUMMARY_LENGTH = 300;
const MAX_CHARACTER_IDS = 16;
const MAX_LOCATION_IDS = 8;
const MAX_SOURCE_IDS = 16;

export type AcceptedExperienceFactClass =
  | "runtime-hard"
  | "character-soft"
  | "story-runtime";

export type RuntimeHardExperienceKind =
  | "story-interaction"
  | "character-interaction"
  | "relationship-event"
  | "commitment-event"
  | "commission-event"
  | "world-event";

export type CharacterSoftExperienceKind =
  | "reading"
  | "walk"
  | "solo-practice"
  | "reflection"
  | "personal-activity"
  | "freeform-interaction";

export type StoryRuntimeExperienceKind = "story-beat";

export type AcceptedExperienceKind =
  | RuntimeHardExperienceKind
  | CharacterSoftExperienceKind
  | StoryRuntimeExperienceKind;

export interface AcceptedExperienceVisibility {
  participantIds: number[];
  witnessIds: number[];
  public: boolean;
}

export interface SummaryExperiencePayload {
  summary: string;
}

export interface CommitmentExperiencePayload extends SummaryExperiencePayload {
  commitmentId: string;
  status: "made" | "completed" | "failed" | "cancelled";
}

export interface CommissionExperiencePayload extends SummaryExperiencePayload {
  commissionId: string;
  status: "accepted" | "completed" | "failed" | "expired" | "declined";
}

export interface StoryBeatExperiencePayload extends SummaryExperiencePayload {
  programId: string;
  beatId: string;
  outcomeId: string;
}

/** Published speech/settlement evidence, never proof that an asserted action occurred. */
export interface StoryInteractionExperiencePayload extends SummaryExperiencePayload {
  source: "dialogue" | "command" | "choice" | "world";
  sessionId: string;
  commandNo: number;
  speakerId: number;
  truncated?: boolean;
  lines: Array<{ id: string; speaker: "player" | "character" | "runtime"; text: string }>;
}

export type AcceptedExperiencePayload =
  | SummaryExperiencePayload
  | CommitmentExperiencePayload
  | CommissionExperiencePayload
  | StoryInteractionExperiencePayload
  | StoryBeatExperiencePayload;

export interface AcceptedExperience {
  id: string;
  schemaVersion: typeof ACCEPTED_EXPERIENCE_SCHEMA_VERSION;
  factClass: AcceptedExperienceFactClass;
  kind: AcceptedExperienceKind;
  startTick: number;
  endTick: number;
  actorIds: number[];
  participantIds: number[];
  locationIds: string[];
  visibility: AcceptedExperienceVisibility;
  sourceIds: string[];
  contextHash: string;
  payload: AcceptedExperiencePayload;
}

export interface AcceptedExperienceAcceptance {
  accepted: boolean;
  experiences: AcceptedExperience[];
  diagnostics: string[];
  experience?: AcceptedExperience;
}

export interface L1ExperienceQuery {
  /** Every observer must be allowed to know the selected fact. */
  observerIds: readonly number[];
  /** Current command actor/target or Ambient participants. */
  relatedCharacterIds: readonly number[];
  /** Current authoritative location, when the route has one. */
  locationId?: string;
}

const RUNTIME_HARD_KINDS = new Set<AcceptedExperienceKind>([
  "story-interaction",
  "character-interaction",
  "relationship-event",
  "commitment-event",
  "commission-event",
  "world-event",
]);

const CHARACTER_SOFT_KINDS = new Set<AcceptedExperienceKind>([
  "reading",
  "walk",
  "solo-practice",
  "reflection",
  "personal-activity",
  "freeform-interaction",
]);

const STORY_RUNTIME_KINDS = new Set<AcceptedExperienceKind>(["story-beat"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedString(value: unknown, maxLength = MAX_ID_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isUniqueIntegerArray(value: unknown, maxLength: number): value is number[] {
  return Array.isArray(value)
    && value.length <= maxLength
    && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0)
    && new Set(value).size === value.length;
}

function isUniqueStringArray(value: unknown, maxLength: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxLength
    && value.every((entry) => isBoundedString(entry))
    && new Set(value).size === value.length;
}

function validatePayload(kind: AcceptedExperienceKind, value: unknown): string | null {
  if (!isRecord(value)) return "payload must be an object";
  if (kind === "commitment-event") {
    if (!hasExactKeys(value, ["summary", "commitmentId", "status"])) return "commitment payload has unknown or missing fields";
    if (!isBoundedString(value.commitmentId)) return "commitmentId is invalid";
    if (!["made", "completed", "failed", "cancelled"].includes(String(value.status))) return "commitment status is invalid";
  } else if (kind === "commission-event") {
    if (!hasExactKeys(value, ["summary", "commissionId", "status"])) return "commission payload has unknown or missing fields";
    if (!isBoundedString(value.commissionId)) return "commissionId is invalid";
    if (!["accepted", "completed", "failed", "expired", "declined"].includes(String(value.status))) return "commission status is invalid";
  } else if (kind === "story-interaction") {
    if (!hasExactKeys(value, ["summary", "source", "sessionId", "commandNo", "speakerId", "lines", ...("truncated" in value ? ["truncated"] : [])])
      || value.truncated !== undefined && typeof value.truncated !== "boolean"
      || !["dialogue", "command", "choice", "world"].includes(String(value.source)) || !isBoundedString(value.sessionId)
      || !Number.isSafeInteger(value.commandNo) || !Number.isSafeInteger(value.speakerId) || Number(value.speakerId) <= 0
      || !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 9
      || value.lines.some(line => !isRecord(line) || !hasExactKeys(line, ["id", "speaker", "text"])
        || !isBoundedString(line.id) || !["player", "character", "runtime"].includes(String(line.speaker)) || !isBoundedString(line.text, 1200))
      || new Set(value.lines.map(line => isRecord(line) ? line.id : null)).size !== value.lines.length) return "story interaction evidence is invalid";
  } else if (kind === "story-beat") {
    if (!hasExactKeys(value, ["summary", "programId", "beatId", "outcomeId"])) return "story payload has unknown or missing fields";
    if (!isBoundedString(value.programId) || !isBoundedString(value.beatId) || !isBoundedString(value.outcomeId)) {
      return "story payload ids are invalid";
    }
  } else if (!hasExactKeys(value, ["summary"])) {
    return "payload has unknown or missing fields";
  }
  if (!isBoundedString(value.summary, MAX_SUMMARY_LENGTH)) return "summary is invalid";
  return null;
}

/** Return all fail-closed contract diagnostics for an untrusted value. */
export function validateAcceptedExperience(value: unknown): string[] {
  if (!isRecord(value)) return ["experience must be an object"];
  const diagnostics: string[] = [];
  if (!hasExactKeys(value, [
    "id",
    "schemaVersion",
    "factClass",
    "kind",
    "startTick",
    "endTick",
    "actorIds",
    "participantIds",
    "locationIds",
    "visibility",
    "sourceIds",
    "contextHash",
    "payload",
  ])) diagnostics.push("experience has unknown or missing fields");
  if (!isBoundedString(value.id)) diagnostics.push("id is invalid");
  if (value.schemaVersion !== ACCEPTED_EXPERIENCE_SCHEMA_VERSION) diagnostics.push("schemaVersion is unsupported");

  const factClass = value.factClass;
  const kind = value.kind;
  const knownFactClass = factClass === "runtime-hard" || factClass === "character-soft" || factClass === "story-runtime";
  const knownKind = typeof kind === "string"
    && (RUNTIME_HARD_KINDS.has(kind as AcceptedExperienceKind)
      || CHARACTER_SOFT_KINDS.has(kind as AcceptedExperienceKind)
      || STORY_RUNTIME_KINDS.has(kind as AcceptedExperienceKind));
  if (!knownFactClass) diagnostics.push("factClass is invalid");
  if (!knownKind) diagnostics.push("kind is invalid");
  if (knownFactClass && knownKind) {
    const allowed = factClass === "runtime-hard"
      ? RUNTIME_HARD_KINDS
      : factClass === "character-soft"
        ? CHARACTER_SOFT_KINDS
        : STORY_RUNTIME_KINDS;
    if (!allowed.has(kind as AcceptedExperienceKind)) diagnostics.push("kind does not belong to factClass");
  }

  if (!Number.isSafeInteger(value.startTick) || Number(value.startTick) < 0) diagnostics.push("startTick is invalid");
  if (!Number.isSafeInteger(value.endTick) || Number(value.endTick) < Number(value.startTick)) diagnostics.push("endTick is invalid");
  if (!isUniqueIntegerArray(value.actorIds, MAX_CHARACTER_IDS) || value.actorIds.length === 0) diagnostics.push("actorIds are invalid");
  if (!isUniqueIntegerArray(value.participantIds, MAX_CHARACTER_IDS) || value.participantIds.length === 0) diagnostics.push("participantIds are invalid");
  if (Array.isArray(value.actorIds) && Array.isArray(value.participantIds)) {
    const participantIds = value.participantIds;
    if (value.actorIds.some((id) => !participantIds.includes(id))) diagnostics.push("actors must be participants");
  }
  if (!isUniqueStringArray(value.locationIds, MAX_LOCATION_IDS)) diagnostics.push("locationIds are invalid");
  if (!isUniqueStringArray(value.sourceIds, MAX_SOURCE_IDS) || value.sourceIds.length === 0) diagnostics.push("sourceIds are invalid");
  if (!isBoundedString(value.contextHash)) diagnostics.push("contextHash is invalid");

  if (!isRecord(value.visibility)) {
    diagnostics.push("visibility is invalid");
  } else {
    const visibility = value.visibility;
    if (!hasExactKeys(visibility, ["participantIds", "witnessIds", "public"])) diagnostics.push("visibility has unknown or missing fields");
    if (!isUniqueIntegerArray(visibility.participantIds, MAX_CHARACTER_IDS)) diagnostics.push("visibility participantIds are invalid");
    if (!isUniqueIntegerArray(visibility.witnessIds, MAX_CHARACTER_IDS)) diagnostics.push("visibility witnessIds are invalid");
    if (typeof visibility.public !== "boolean") diagnostics.push("visibility public is invalid");
    if (Array.isArray(visibility.participantIds) && Array.isArray(value.participantIds)) {
      const participantIds = value.participantIds;
      if (visibility.participantIds.some((id) => !participantIds.includes(id))) {
        diagnostics.push("visible participants must be event participants");
      }
    }
  }

  if (knownKind) {
    const payloadDiagnostic = validatePayload(kind as AcceptedExperienceKind, value.payload);
    if (payloadDiagnostic) diagnostics.push(payloadDiagnostic);
  }
  if (kind === "story-interaction" && isRecord(value.payload) && isRecord(value.visibility)) {
    const expected = [0, value.payload.speakerId];
    if (!Array.isArray(value.actorIds) || value.actorIds.join() !== expected.join()
      || !Array.isArray(value.participantIds) || value.participantIds.join() !== expected.join()
      || !Array.isArray(value.visibility.participantIds) || value.visibility.participantIds.join() !== expected.join()
      || !Array.isArray(value.visibility.witnessIds) || value.visibility.witnessIds.length || value.visibility.public !== false) diagnostics.push("story interaction speaker visibility is invalid");
  }

  if (factClass === "character-soft"
    && Array.isArray(value.actorIds)
    && Array.isArray(value.participantIds)
    && isRecord(value.visibility)) {
    const visibility = value.visibility;
    const actorId = value.actorIds[0];
    const visibleParticipants = Array.isArray(visibility.participantIds)
      ? visibility.participantIds
      : [];
    const participantIds = value.participantIds as number[];
    const commonInvalid = value.actorIds.length !== 1
      || !participantIds.includes(actorId)
      || visibleParticipants.length !== participantIds.length
      || visibleParticipants.some((id, index) => id !== participantIds[index])
      || !Array.isArray(visibility.witnessIds)
      || visibility.witnessIds.length !== 0
      || visibility.public !== false;
    const legacySoftInvalid = kind !== "freeform-interaction"
      && (participantIds.length !== 1 || participantIds[0] !== actorId);
    if (commonInvalid || legacySoftInvalid) {
      diagnostics.push("character-soft experience has invalid private participants");
    }
  }
  return diagnostics;
}

export function isAcceptedExperience(value: unknown): value is AcceptedExperience {
  return validateAcceptedExperience(value).length === 0;
}

function cloneExperience(experience: AcceptedExperience): AcceptedExperience {
  return {
    ...experience,
    actorIds: [...experience.actorIds],
    participantIds: [...experience.participantIds],
    locationIds: [...experience.locationIds],
    visibility: {
      participantIds: [...experience.visibility.participantIds],
      witnessIds: [...experience.visibility.witnessIds],
      public: experience.visibility.public,
    },
    sourceIds: [...experience.sourceIds],
    payload: structuredClone(experience.payload),
  };
}

/** Keep the newest bounded entries with a stable tie-breaker and chronological output. */
export function pruneAcceptedExperiences(
  experiences: readonly AcceptedExperience[],
  limit = MAX_ACCEPTED_EXPERIENCES,
): AcceptedExperience[] {
  const safeLimit = Math.max(0, Math.trunc(limit));
  const sorted = experiences
    .map(cloneExperience)
    .sort((left, right) => left.endTick - right.endTick || left.startTick - right.startTick || left.id.localeCompare(right.id));
  return safeLimit === 0 ? [] : sorted.slice(-safeLimit);
}

/** Validate and append once. A repeated id or source event is a zero-write rejection. */
export function acceptExperience(
  existing: readonly AcceptedExperience[],
  candidate: unknown,
  limit = MAX_ACCEPTED_EXPERIENCES,
): AcceptedExperienceAcceptance {
  const diagnostics = validateAcceptedExperience(candidate);
  if (diagnostics.length > 0) return { accepted: false, experiences: [...existing], diagnostics };
  const accepted = candidate as AcceptedExperience;
  if (existing.some((entry) => entry.id === accepted.id)) {
    return { accepted: false, experiences: [...existing], diagnostics: ["experience id already accepted"] };
  }
  const knownSources = new Set(existing.flatMap((entry) => entry.sourceIds));
  if (accepted.sourceIds.some((sourceId) => knownSources.has(sourceId))) {
    return { accepted: false, experiences: [...existing], diagnostics: ["source event already accepted"] };
  }
  const experience = cloneExperience(accepted);
  return {
    accepted: true,
    experiences: pruneAcceptedExperiences([...existing, experience], limit),
    diagnostics: [],
    experience,
  };
}

/** Undefined observer means a player/system view that can only read public entries. */
export function getVisibleExperiences(
  experiences: readonly AcceptedExperience[],
  observerCharaNum?: number,
  limit = MAX_SELECTED_EXPERIENCES,
): AcceptedExperience[] {
  const visible = experiences.filter((experience) => experience.visibility.public
    || (observerCharaNum !== undefined
      && (experience.visibility.participantIds.includes(observerCharaNum)
        || experience.visibility.witnessIds.includes(observerCharaNum))));
  return pruneAcceptedExperiences(visible, limit);
}

/** Single source of truth for "may this observer know this fact". Routes that
 * publish an information boundary to a model must reuse this rather than
 * re-deriving visibility, which would let the two drift apart. */
export function isExperienceVisibleTo(experience: AcceptedExperience, observerId: number): boolean {
  return experience.visibility.public
    || experience.visibility.participantIds.includes(observerId)
    || experience.visibility.witnessIds.includes(observerId);
}

const isVisibleToObserver = isExperienceVisibleTo;

function stableIdCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Select the small, observer-safe Experience slice consumed by an L1 route.
 *
 * The Agent master switch gates consumption. Lazy Materialization has no read
 * gate: disabling Lazy stops new proposals but keeps already accepted history
 * available. Character relevance outranks location-only relevance.
 */
export function selectRelevantExperiencesForL1(
  state: Readonly<GameState>,
  query: L1ExperienceQuery,
): AcceptedExperience[] {
  if (!state.agentRuntime?.settings.masterEnabled || query.observerIds.length === 0) return [];

  const nowTick = state.time.tickValue;
  const oldestIncludedTick = nowTick - L1_EXPERIENCE_LOOKBACK_TICKS;
  const relatedCharacterIds = new Set(query.relatedCharacterIds);

  return (state.acceptedExperiences ?? [])
    .filter(isAcceptedExperience)
    .filter((experience) => experience.endTick <= nowTick && experience.endTick >= oldestIncludedTick)
    .filter((experience) => query.observerIds.every((observerId) => isVisibleToObserver(experience, observerId)))
    .map((experience) => {
      const characterRelevant = experience.actorIds.some((id) => relatedCharacterIds.has(id))
        || experience.participantIds.some((id) => relatedCharacterIds.has(id));
      const locationRelevant = query.locationId !== undefined
        && experience.locationIds.includes(query.locationId);
      return { experience, relevance: characterRelevant ? 2 : locationRelevant ? 1 : 0 };
    })
    .filter((entry) => entry.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance
      || right.experience.endTick - left.experience.endTick
      || right.experience.startTick - left.experience.startTick
      || stableIdCompare(left.experience.id, right.experience.id))
    .slice(0, MAX_L1_EXPERIENCES)
    .map(({ experience }) => experience);
}

function formatExperienceTick(tick: number): string {
  const minuteOfDay = ((tick % 1440) + 1440) % 1440;
  const day = Math.floor(tick / 1440) + 1;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `第${day}日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Format only accepted event time, kind, and summary for prompt minimization. */
export function formatExperiencesForL1(
  experiences: readonly AcceptedExperience[],
): string[] {
  return experiences.map((experience) => {
    const start = formatExperienceTick(experience.startTick);
    const end = formatExperienceTick(experience.endTick);
    const eventTime = start === end ? start : `${start} 至 ${end}`;
    return `${eventTime}；${experience.kind}：${experience.payload.summary}`;
  });
}
