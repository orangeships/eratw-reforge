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
}

export interface AgentSettings {
  /** Master switch.  Default `false` — no agent behaviour for existing saves. */
  masterEnabled: boolean;
  /** Maximum number of simultaneously active agents.  Default 10. */
  maxActiveAgents: number;
  /** CharaNums that are *always* in the top-N (occupy slots). */
  pinnedCharaNums: number[];
  /** CharaNums that are *never* in the top-N. */
  excludedCharaNums: number[];
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
  /** Personal diary entries.  Max **30** entries. */
  diaries: AgentDiaryEntry[];
  /** Absolute tick through which observations were accepted by a night cycle. */
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
}

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
