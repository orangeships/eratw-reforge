/**
 * A1 — Agent runtime state types (persistence foundation, no LLM calls).
 *
 * All types are JSON-safe: no Map, Set, Date, class instance, or function.
 * Every collection array has a documented maximum length enforced by the
 * `enforceCognitiveCaps` helper in init.ts.  Callers should not rely on
 * lengths staying within caps without explicitly calling that helper.
 */

import type { CommissionTaskKind } from "../state/game-state.js";

// ── Top-level state ──────────────────────────────────────────────

export interface AgentRuntimeState {
  /** Durable historical roots; full records are save attachments, outside hot state. */
  memoryArchive?: import("./memory-archive.js").AgentMemoryArchiveV1;
  /** Monotonic version for agent-runtime-internal migration.  Starts at 1. */
  version: number;
  /** Per-character cognitive state, keyed by charaNum. */
  cognitions: Record<number, AgentCognitiveState>;
  /** Per-character engagement scores, keyed by charaNum. */
  engagements: Record<number, AgentEngagement>;
  /** Active top-N roster selected at the last night boundary. */
  activeRoster: number[];
  /** Roster BEFORE the most recent selection (used to detect new entrants). */
  previousRoster: number[];
  /** Day index (time.dayIndex) when `activeRoster` was last recomputed. */
  rosterSelectedDay: number;
  /** Runtime settings mirrored into game state for save/load portability. */
  settings: AgentSettings;
  /** Log of accepted agent decisions (max 30, oldest-first trim). */
  acceptedDecisions: AcceptedAgentDecision[];
  /** Monotonic counter for generating decision IDs. */
  decisionSeq: number;
  /** Bounded S2 bookkeeping for best-effort single-character materialization. */
  materialization: AgentMaterializationState;
  /** Deterministic, AI-off-empty daily fact ledger. */
  dailyLedger: AgentDailyLedgerV1;
}

export interface AgentSettings {
  /** Master switch.  Default `false` — no agent behaviour for existing saves. */
  masterEnabled: boolean;
  /** Maximum number of simultaneously active agents. Default 10, hard cap 20. */
  maxActiveAgents: number;
  /** CharaNums that are forced into the active roster (occupy slots). */
  pinnedCharaNums: number[];
  /** CharaNums that are *never* in the top-N. */
  excludedCharaNums: number[];
}

export interface AgentMaterializationState {
  /** Last authoritative encounter tick recorded for each stable character. */
  lastSeenTicks: Record<number, number>;
  /** End of the latest successfully materialized blank window. */
  materializedThroughTicks: Record<number, number>;
  /** Day owning the reservation budget below; `-1` means unused. */
  budgetDay: number;
  /** Reservations consumed on `budgetDay` (success is not required). */
  requestCount: number;
  /** Characters already reserved on `budgetDay`. */
  requestedCharaNums: number[];
  /** Stable idempotency keys reserved on `budgetDay`. */
  requestKeys: string[];
}

// ── Deterministic daily fact ledger ────────────────────────────────

export type AgentDailyActivityKind = "work" | "roam" | "player-command-dialogue";

export interface AgentDailyActivity {
  id: string;
  kind: AgentDailyActivityKind;
  startTick: number;
  endTick: number;
  location: string;
  label: string;
  participants: number[];
}

export interface AgentDailyVisitedLocation {
  id: string;
  location: string;
  arrivedAtTick: number;
  leftAtTick?: number;
}

export interface AgentDailyEncounter {
  id: string;
  startTick: number;
  endTick: number;
  location: string;
  /** Other characters present. `0` is the player. */
  participants: number[];
}

export type AgentRelationshipStage = "ordinary" | "affection" | "love" | "lover";

export interface AgentRelationshipEvidenceSnapshot {
  tick: number;
  favor: number;
  trust: number;
  intimacy: number;
  attitude: 0 | 1 | 2 | 3;
  stage: AgentRelationshipStage;
  traits: {
    affection: boolean;
    love: boolean;
    lover: boolean;
    desire: boolean;
    sexFriend: boolean;
  };
}

export interface AgentRelationshipChangeEvidence {
  field: "favor" | "trust" | "intimacy" | "attitude" | "stage"
    | "affection" | "love" | "lover" | "desire" | "sexFriend";
  before: number | string | boolean;
  after: number | string | boolean;
}

export interface AgentDailyCharacterRecord {
  charaNum: number;
  dayIndex: number;
  startedAtTick: number;
  closedAtTick?: number;
  initialLocation: string;
  lastKnownLocation: string;
  activities: AgentDailyActivity[];
  visitedLocations: AgentDailyVisitedLocation[];
  encounters: AgentDailyEncounter[];
  relationshipStart: AgentRelationshipEvidenceSnapshot;
  relationshipEnd?: AgentRelationshipEvidenceSnapshot;
  relationshipChanges: AgentRelationshipChangeEvidence[];
  sequence: number;
}

export interface AgentDailyLedgerDay {
  dayIndex: number;
  characters: Record<number, AgentDailyCharacterRecord>;
}

export interface AgentDailyLedgerV1 {
  version: 1;
  days: AgentDailyLedgerDay[];
}

// ── Per-character cognitive state ─────────────────────────────────

export interface AgentCognitiveState {
  /** Observed facts about this character.  Max **96** entries. */
  observations: AgentObservation[];
  /** Condensed episodic memories.  Max **64** entries. */
  memories: AgentMemory[];
  /** Periodic self-reflections.  Max **12** entries. */
  reflections: AgentReflection[];
  /** Active long-term goals.  Max **8** entries. */
  goals: AgentGoal[];
  /** L2 — bounded subjective current mind.  This is not gameplay authority. */
  mind?: AgentMindStateV1;
  /** L2 — player-anchored episodes waiting for the next Night merge. */
  pendingEpisodes?: AgentPendingEpisode[];
  /**
   * Daytime sync bookkeeping.  Runtime facts are projected into observations
   * immediately, while this bounded queue lets the optional daytime L2 worker
   * consume only evidence it has not seen yet.  It is deliberately separate
   * from Night's observation cursor: a daytime response may be discarded and
   * retried without hiding the fact from L1/L3.
   */
  daytimeSync?: AgentDaytimeSyncState;
  /** Personal diary entries.  Max **30** entries. */
  diaries: AgentDiaryEntry[];
  /** Night cursor for legacy orchestration; daytime projection does not move it. */
  lastUpdatedTick: number;
  /** A3 — accepted daily plan for the coming day. */
  currentPlan?: AcceptedAgentDailyPlan;
  /** A5 — agent commission decision for the coming morning. */
  commissionDecision?: {
    action: "propose" | "defer";
    candidateId?: string;
    decidedAtTick: number;
    decidedAtDay: number;
  };
}

export interface AgentDaytimeSyncState {
  version: 1;
  /** Observation ids awaiting an optional daytime subjective reaction. */
  pendingObservationIds: string[];
  /** Recently consumed ids retained for diagnostics/idempotency. */
  consumedObservationIds: string[];
  /** Monotonic local revision for stale daytime request rejection. */
  revision: number;
  /** Last tick at which facts were projected into this cognition. */
  lastProjectedTick: number;
  /** Last tick at which a daytime mind patch was accepted, if any. */
  lastReactionTick?: number;
}

// ── Engagement scoring ────────────────────────────────────────────

export interface AgentEngagement {
  /** Current decayed score.  Read via `applyDecay` / `effectiveScore`. */
  score: number;
  /** Absolute tick of the most recent decay application. */
  lastDecayTick: number;
  /** Individual recorded interaction signals.  Max **96** entries. */
  signals: AgentInteractionSignal[];
}

export interface AgentInteractionSignal {
  /** Absolute tick when this interaction occurred. */
  tick: number;
  /** Day index for decay scheduling. */
  dayIndex: number;
  /** Kind of interaction. */
  kind: InteractionSignalKind;
  /** Numeric score contribution (pre-decay). */
  points: number;
  /** Free-text label for debug display. */
  label: string;
  /** The subject charaNum (who was interacted with). */
  charaNum: number;
}

export type InteractionSignalKind =
  | "command"        // 4 points — command completion
  | "dialogue"       // 3 points — visible dialogue / event interaction
  | "date_banquet"   // 8 points — dates, banquets, significant social events
  | "commission"     // 8 points — commission state transitions
  | "relation_delta"; // 1‑6 points — significant relationship changes

// ── Cognitive primitives ──────────────────────────────────────────

export interface AgentObservation {
  /** Stable unique id (e.g. `obs-{charaNum}-{seq}`). */
  id: string;
  /** Absolute tick when observed. */
  tick: number;
  /** Day index when observed. */
  dayIndex: number;
  /** Semantic kind (e.g. "command", "move", "dialogue", "commission"). */
  kind: string;
  /** Human-readable one-line summary. */
  text: string;
  /** CharaNums involved in the event. */
  participants: number[];
  /** Canonical location string at the time of the event. */
  location: string;
  /** Characters allowed to know this fact. */
  witnessCharaNums: number[];
  /** Deterministic semantic tags used by retrieval. */
  factTags: string[];
  /** Stable runtime event ids used for de-duplication and provenance. */
  sourceEventIds: string[];
  /** Runtime-owned importance before any subjective interpretation. */
  baseImportance: number;
}

export interface AgentMemory {
  /** Stable unique id. */
  id: string;
  /** Day index when this memory was created. */
  createdDay: number;
  /** Absolute tick when this memory was created. */
  createdTick: number;
  /** Source observation ids that were synthesised into this memory (A2+). */
  sourceObservationIds: string[];
  /** Subjective memory text (model-authored in A2+, placeholder in A1). */
  text: string;
  /** Importance 0‑10 (higher = more relevant for retrieval). */
  importance: number;
}

export interface AgentReflection {
  /** Stable unique id. */
  id: string;
  /** Day index when this reflection was created. */
  createdDay: number;
  /** Absolute tick when this reflection was created. */
  createdTick: number;
  /** Reflection text (model-authored in A2+, placeholder in A1). */
  text: string;
  /** V2 structured reflection. Legacy text-only reflections omit this. */
  parts?: AgentReflectionParts;
  /** Result of the independent story consistency audit. */
  auditStatus?: AgentReflectionAuditStatus;
}

// ── L2 — bounded subjective mind and player-anchored work memory ────────

export type AgentMindBeliefTopic = "self" | "player" | "relationship";

/** A bounded, subjective belief or goal. Runtime owns its id and lifecycle. */
export interface AgentMindItem {
  id: string;
  topic: AgentMindBeliefTopic;
  text: string;
  createdTick: number;
  updatedTick: number;
  evidenceIds: string[];
  status?: "active" | "resolved";
}

export type AgentSocialThreadKind = "promise" | "conflict" | "secret" | "question";

/** A subjective social thread; it never creates a deterministic commitment. */
export interface AgentSocialThread {
  id: string;
  kind: AgentSocialThreadKind;
  text: string;
  createdTick: number;
  updatedTick: number;
  evidenceIds: string[];
  status: "open" | "resolved";
}

export interface AgentMindStateV1 {
  version: 1;
  revision: number;
  updatedTick: number;
  relationshipToPlayer: string;
  currentTendency: string;
  beliefs: AgentMindItem[];
  goals: AgentMindItem[];
  threads: AgentSocialThread[];
}

export interface AgentPendingEpisodeLine {
  speaker: "player" | "character";
  text: string;
}

export interface AgentPendingEpisodeChoice {
  label: string;
  lines: string[];
}

/** A final, session-bound free-chat exchange awaiting Night aggregation. */
export interface AgentPendingEpisode {
  /** Archive projections flag surviving legacy fragments; the raw history is not invented. */
  incomplete?: true;
  id: string;
  charaNum: number;
  sessionId: string;
  requestId?: string;
  dayIndex: number;
  createdTick: number;
  updatedTick: number;
  lines: AgentPendingEpisodeLine[];
  choices: AgentPendingEpisodeChoice[];
  /** Interaction heat used only for roster prioritisation. */
  heat: number;
}

export type AgentMindUpdateAction = "add" | "update" | "resolve";

export interface AgentMindItemUpdate {
  action: AgentMindUpdateAction;
  id?: string;
  topic?: AgentMindBeliefTopic;
  text?: string;
  evidenceIds?: string[];
}

export interface AgentSocialThreadUpdate {
  action: AgentMindUpdateAction;
  id?: string;
  kind?: AgentSocialThreadKind;
  text?: string;
  evidenceIds?: string[];
}

/** Strictly bounded model proposal applied by Runtime after evidence checks. */
export interface AgentMindUpdatesV1 {
  relationshipToPlayer?: string;
  currentTendency?: string;
  beliefs?: AgentMindItemUpdate[];
  goals?: AgentMindItemUpdate[];
  threads?: AgentSocialThreadUpdate[];
}

export interface AgentReflectionParts {
  attitudeToPlayer: string;
  interestingEvent: string | null;
  nextTendency: string;
  storyClaim?: AgentStoryClaim;
}

export type AgentReflectionAuditStatus =
  | "not-applicable"
  | "accepted"
  | "rewritten"
  | "story-dropped"
  | "audit-failed";

export interface AgentGoal {
  /** Stable unique id. */
  id: string;
  /** Day index when this goal was created. */
  createdDay: number;
  /** Absolute tick when this goal was created. */
  createdTick: number;
  /** Goal text (model-authored in A2+, placeholder in A1). */
  text: string;
  /** Lifecycle status. */
  status: "active" | "completed" | "abandoned";
  /** Day index when resolved (only for completed / abandoned). */
  resolvedDay?: number;
}

export interface AgentDiaryEntry {
  /** Stable unique id. */
  id: string;
  /** Day index this entry covers. */
  dayIndex: number;
  /** Absolute tick when created. */
  tick: number;
  /** Diary text (model-authored in A2+, placeholder in A1). */
  text: string;
  /** Visible observations that ground this entry. */
  sourceObservationIds: string[];
  /** Why this sparse diary entry was written. Missing means a legacy entry. */
  trigger?: "command" | "cadence" | "jev";
}

// ── A2 — Night cognitive cycle drafts ─────────────────────────────

/** A model-authored memory draft referencing a specific observation. */
export interface AgentMemoryDraft {
  /** Observation id this memory is based on (must exist and be visible). */
  observationId: string;
  /** Subjective memory text, 1‑300 chars. */
  text: string;
  /** Importance 0‑10 (higher = more relevant for future retrieval). */
  importance: number;
}

/** Parsed & validated night cognitive-cycle response (A2 subset). */
export interface AgentNightResponse {
  schemaVersion: 1;
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  /** Memory drafts, 0‑4 entries. */
  memoryDrafts?: AgentMemoryDraft[];
  /** Optional nightly reflection, 1‑500 chars. */
  reflection?: { text: string };
  /** Goal updates, 0‑2 entries. */
  goalUpdates?: { goalId?: string; text: string; status: "active" | "completed" | "abandoned" }[];
  /** Optional diary entry, 1‑600 chars. */
  diary?: { text: string; sourceObservationIds: string[] };
  /** A3 — plan selections for tomorrow's free windows. */
  planSelections?: AgentPlanSelection[];
  /** A5 — commission selections for tomorrow morning. */
  commissionSelections?: AgentCommissionSelection[];
}

/** Objective anchors declared by a subjective, presentation-only story. */
export interface AgentStoryClaim {
  startTick: number;
  endTick: number;
  location: string;
  participants: number[];
  anchorIds: string[];
}

export interface AgentNightInterestingEvent {
  text: string;
  claim: AgentStoryClaim;
}

/** Strict V2 three-part nightly response. */
export interface AgentNightResponseV2 {
  schemaVersion: 2;
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  attitudeToPlayer: { text: string };
  interestingEvent: AgentNightInterestingEvent | null;
  nextTendency: {
    text: string;
    planSelections?: AgentPlanSelection[];
    commissionSelection?: AgentCommissionSelection;
  };
  /** Legacy optional prose; new Night requests omit it and only JEV can admit diary generation. */
  diaryText?: string;
}

/** V3 keeps the V2 presentation fields and adds bounded mind operations. */
export interface AgentNightResponseV3 {
  schemaVersion: 3;
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  attitudeToPlayer: { text: string };
  interestingEvent: AgentNightInterestingEvent | null;
  nextTendency: {
    text: string;
    planSelections?: AgentPlanSelection[];
    commissionSelection?: AgentCommissionSelection;
  };
  /** Legacy optional prose, validated for compatibility and never used to bypass JEV. */
  diaryText?: string;
  mindUpdates: AgentMindUpdatesV1;
  /** Runtime/parser diagnostics for dropped bounded operations; never model input. */
  validationDiagnostics?: string[];
}

/** Pure per-character result before any cognition/plan/diary mutation. */
export interface AgentNightDraft {
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  response: AgentNightResponseV2 | AgentNightResponseV3;
  auditStatus: AgentReflectionAuditStatus;
}

export interface AgentNightAuditDecision {
  charaNum: number;
  action: "accept" | "rewrite" | "delete";
  interestingEvent?: AgentNightInterestingEvent;
}

export interface AgentNightAuditResponseV1 {
  schemaVersion: 1;
  dayIndex: number;
  contextHash: string;
  decisions: AgentNightAuditDecision[];
}

/** Return value from a successful night cognitive cycle. */
export interface AgentNightResult {
  charaNum: number;
  /** Narration/status events to append to the night report. */
  events: Array<{ kind: string; text: string; charaNum?: number }>;
  /** Human-readable diagnostics for the debug panel. */
  diagnostics: string[];
}

// ── A3 — Daily plan types ─────────────────────────────────────────

export interface AgentPlanCandidate {
  /** Stable id: "stay" | "room:{roomId}" | "visit:{charaNum}". */
  id: string;
  kind: "stay" | "room" | "visit";
  /** Window this candidate covers, minute-of-day. */
  windowStart: number;
  windowEnd: number;
  /** Target location string. */
  location: string;
  /** Human-readable label for the prompt. */
  label: string;
}

export interface AgentPlanSelection {
  /** Must match a candidate id from the opportunity set. */
  candidateId: string;
  /** Window start, minute-of-day. */
  windowStart: number;
  /** Window end, minute-of-day. */
  windowEnd: number;
}

export interface AcceptedAgentPlanSelection extends AgentPlanSelection {
  kind: AgentPlanCandidate["kind"];
  /** Runtime-owned destination copied from the accepted candidate. */
  location: string;
}

export interface AcceptedAgentDailyPlan {
  /** Day index this plan covers. */
  dayIndex: number;
  /** Selected candidates for each free window. */
  selections: AcceptedAgentPlanSelection[];
  /** Hash of the context used to generate this plan (for invalidation). */
  contextHash: string;
  /** Tick when the plan was accepted. */
  acceptedAtTick: number;
}

// ── A5 — Commission types ──────────────────────────────────────────

export interface AgentCommissionCandidate {
  /** Stable id: "commission:{clientId}:{localId}". */
  id: string;
  /** Commission name (e.g. "帮忙做扫除"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Task kind. */
  task: CommissionTaskKind;
  /** Deadline in days (0 = same-day). */
  deadlineDays: number;
}

export interface AgentCommissionSelection {
  /** Candidate id to propose, or "defer". */
  candidateId: string;
  /** Action: "propose" to offer this commission, "defer" to skip. */
  action: "propose" | "defer";
}

// ── Accepted decisions (for future slices) ────────────────────────

export interface AcceptedAgentDecision {
  /** Stable unique id. */
  id: string;
  /** Owning character. */
  charaNum: number;
  /** Day index when the decision was accepted. */
  dayIndex: number;
  /** Absolute tick when accepted. */
  acceptedAtTick: number;
  /** Discriminator (e.g. "daily-plan", "commission-proposal"). */
  kind: string;
  /** JSON-safe metadata bag. */
  meta: Record<string, unknown>;
}
