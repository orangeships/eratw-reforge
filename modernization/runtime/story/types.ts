import type { EventDialogueDirectiveV1 } from "../state/game-state.js";
import type { WeatherIncidentOptionV1 } from "../weather/narrative-incident.js";

export const STORY_PROGRAM_VERSION = 1 as const;
export const STORY_PROGRAM_V2_VERSION = 2 as const;
/** Shared by manual input, director requests and saved candidate sessions. */
export const NARRATIVE_PLAYER_INTENT_MAX_LENGTH = 10_000;
/** Includes the protagonist. Shared by generation, execution and save validation. */
export const NARRATIVE_MAX_PARTICIPANTS = 8;
export const NARRATIVE_MAX_NPCS = NARRATIVE_MAX_PARTICIPANTS - 1;

/** Stable creative premise. Never evidence, character knowledge or gameplay authority. */
export interface StoryBackgroundV1 {
  version: 1;
  source: "player" | "generated" | "legacy";
  text: string;
  createdAtTick: number;
}

/** `awaiting-player` means one round closed and the story is waiting for the
 * player to actually do something before the next round is generated. It is
 * still an owned, open story: no other narrative event may start. */
export type StoryProgramStatus = "active" | "awaiting-player" | "paused" | "completed" | "aborted";

/** Compact record of one finished round. The round's nodes are pruned from the
 * program to keep it bounded, so this is what later rounds read for continuity. */
export interface StoryRoundSummaryV1 {
  index: number;
  outcomeId: string;
  summary: string;
  resolvedAtTick: number;
  /** Ids only, kept for idempotency checks and debug inspection. */
  nodeIds: string[];
  /** Player-visible lines produced during the round, for recap continuity. */
  narration: string[];
  selectedChoices?: Record<string, string>;
}
export type StoryRuntimeEffectHandler = "advance-time";

interface StoryBeatBase {
  id: string;
  nextBeatId?: string;
}

export interface NarrationBeat extends StoryBeatBase {
  kind: "narration";
  text: string;
}

/** Presentation-only slot. The deterministic fallback is always complete;
 * the shell may replace it through the separately validated story-expression
 * route, but the generated line never changes program control flow. */
export interface AIExpressionBeat extends StoryBeatBase {
  kind: "ai-expression";
  actorId: number;
  promptHint: string;
  fallbackText: string;
}

export interface StoryChoiceOption {
  id: string;
  label: string;
  nextBeatId: string;
}

export interface PlayerChoiceBeat extends Omit<StoryBeatBase, "nextBeatId"> {
  kind: "player-choice";
  question: string;
  options: StoryChoiceOption[];
}

export interface RuntimeEffectBeat extends StoryBeatBase {
  kind: "runtime-effect";
  handler: StoryRuntimeEffectHandler;
  args: { minutes: number };
  idempotencyKey: string;
}

export interface EndBeat extends Omit<StoryBeatBase, "nextBeatId"> {
  kind: "end";
  outcomeId: string;
  summary: string;
}

export type StoryBeat =
  | NarrationBeat
  | AIExpressionBeat
  | PlayerChoiceBeat
  | RuntimeEffectBeat
  | EndBeat;

/** S5 StoryProgram V1 is deliberately one small, serializable short-event
 * program. It is not a StoryArc or a general effect/graph DSL. */
export interface StoryProgramV1 {
  version: typeof STORY_PROGRAM_VERSION;
  id: string;
  templateId: number;
  contextHash: string;
  createdAtTick: number;
  actorIds: number[];
  locationId: string;
  beats: StoryBeat[];
  /** Index of the next beat to settle. Branches may jump forward only. */
  cursor: number;
  status: StoryProgramStatus;
  executedBeatIds: string[];
  executedEffectIds: string[];
  selectedChoices: Record<string, string>;
}

export type StoryGraphNodeKind =
  | "dialogue-hook"
  | "narration"
  | "expression"
  | "bounded-talk"
  | "player-choice"
  | "agent-choice"
  | "director-choice"
  | "capability"
  | "checkpoint"
  | "end";

interface StoryGraphNodeBase {
  id: string;
  kind: StoryGraphNodeKind;
  nextNodeId?: string;
}

export interface StoryGraphNarrationNode extends StoryGraphNodeBase {
  kind: "narration";
  text: string;
}

export interface StoryGraphExpressionNode extends StoryGraphNodeBase {
  kind: "expression";
  actorId: number;
  objective: string;
  fallbackText: string;
}

export interface StoryGraphBoundedTalkNode extends StoryGraphNodeBase {
  kind: "bounded-talk";
  participantIds: number[];
  topicGoal: string;
  exitCondition: string;
  fallbackLines: string[];
}

export interface StoryGraphChoiceOption {
  id: string;
  label: string;
  nextNodeId: string;
}

export interface StoryGraphPlayerChoiceNode extends Omit<StoryGraphNodeBase, "nextNodeId"> {
  kind: "player-choice";
  question: string;
  options: StoryGraphChoiceOption[];
}

/** L3 supplies a conversational objective; L1 owns the actual character expression. */
export interface StoryGraphDialogueHookNode extends StoryGraphNodeBase {
  kind: "dialogue-hook";
  actorId: number;
  objective: string;
}

export interface StoryGraphAgentChoiceNode extends Omit<StoryGraphNodeBase, "nextNodeId"> {
  kind: "agent-choice";
  actorId: number;
  question: string;
  options: StoryGraphChoiceOption[];
  fallbackOptionId: string;
}

export interface StoryGraphDirectorChoiceNode extends Omit<StoryGraphNodeBase, "nextNodeId"> {
  kind: "director-choice";
  question: string;
  options: StoryGraphChoiceOption[];
  fallbackOptionId: string;
}

export interface StoryGraphCapabilityNode extends StoryGraphNodeBase {
  kind: "capability";
  capabilityId: string;
}

export interface StoryGraphCheckpointNode extends StoryGraphNodeBase {
  kind: "checkpoint";
  label: string;
}

export interface StoryGraphEndNode extends Omit<StoryGraphNodeBase, "nextNodeId"> {
  kind: "end";
  outcomeId: string;
  summary: string;
  /** Marks a round boundary rather than the end of the story. The runtime
   * archives the finished round and hands control back to the player, who is
   * then free to act before the next round is generated. */
  continues?: boolean;
}

export type StoryGraphNodeV2 =
  | StoryGraphDialogueHookNode
  | StoryGraphNarrationNode
  | StoryGraphExpressionNode
  | StoryGraphBoundedTalkNode
  | StoryGraphPlayerChoiceNode
  | StoryGraphAgentChoiceNode
  | StoryGraphDirectorChoiceNode
  | StoryGraphCapabilityNode
  | StoryGraphCheckpointNode
  | StoryGraphEndNode;

/** Untrusted L3 output. It contains references only: never code, state field
 * names, numeric deltas, item ids, or handler arguments. */
export interface StoryGraphProposalV2 {
  version: typeof STORY_PROGRAM_V2_VERSION;
  proposalId: string;
  title: string;
  contextHash: string;
  participantIds: number[];
  locationIds: string[];
  factIds: string[];
  startNodeId: string;
  nodes: StoryGraphNodeV2[];
}

export type RuntimeCapabilityKind =
  | "advance-time"
  | "move"
  | "record-clue"
  | "set-arc-variable"
  | "schedule-next-window"
  | "reward-bundle"
  | "relationship-event"
  | "schedule-weather-incident"
  | "open-interaction-window";

interface RuntimeCapabilityBase {
  id: string;
  kind: RuntimeCapabilityKind;
  label: string;
  description: string;
  idempotencyKey: string;
}

export type RuntimeCapabilityOption =
  | (RuntimeCapabilityBase & { kind: "advance-time"; minutes: number })
  | (RuntimeCapabilityBase & { kind: "move"; actorIds: number[]; locationId: string })
  | (RuntimeCapabilityBase & { kind: "record-clue"; arcId: string; clueId: string; summary: string })
  | (RuntimeCapabilityBase & { kind: "set-arc-variable"; arcId: string; variableId: string; valueId: string })
  | (RuntimeCapabilityBase & { kind: "schedule-next-window"; arcId: string; earliestTick: number; latestTick: number; locationId: string })
  | (RuntimeCapabilityBase & { kind: "reward-bundle"; rewardId: string; money: number; summary: string })
  | (RuntimeCapabilityBase & { kind: "relationship-event"; eventId: string; participantIds: number[]; summary: string })
  | (RuntimeCapabilityBase & { kind: "schedule-weather-incident"; incident: WeatherIncidentOptionV1 })
  | (RuntimeCapabilityBase & { kind: "open-interaction-window"; directive: EventDialogueDirectiveV1 });

export interface StoryProgramV2 {
  version: typeof STORY_PROGRAM_V2_VERSION;
  id: string;
  title: string;
  contextHash: string;
  createdAtTick: number;
  actorIds: number[];
  locationIds: string[];
  acceptedFactIds: string[];
  startNodeId: string;
  /** Only the live frontier. Finished rounds are pruned into `rounds` so a
   * story may run for as many rounds as the player keeps engaging with it. */
  nodes: StoryGraphNodeV2[];
  cursorNodeId: string | null;
  status: StoryProgramStatus;
  executedNodeIds: string[];
  executedCapabilityIds: string[];
  selectedChoices: Record<string, string>;
  capabilities: RuntimeCapabilityOption[];
  eventId?: string;
  arcId?: string;
  /** Completed rounds, oldest first, bounded by `MAX_STORY_ROUNDS`. */
  rounds?: StoryRoundSummaryV1[];
  /** Hard safety stop. Unbounded rounds are a product decision, but a runaway
   * loop must still terminate. */
  roundIndex?: number;
  /** Runtime receipt of a successful player interaction after this round. */
  continuationEvidence?: { id: string; targetId: number; commandNo: number; tick: number; roundIndex: number; summary?: string };
  /** One automatic attempt per receipt, including across save/load. */
  continuationAttemptId?: string;
  pausedStatus?: "active" | "awaiting-player";
  lifecycleReason?: string;
}

/** V1 remains readable/resumable; all newly compiled narrative events use V2. */
export type StoryProgram = StoryProgramV1 | StoryProgramV2;

export interface StoryChoicePrompt {
  beatId: string;
  question: string;
  options: Array<{ id: string; label: string }>;
}

export interface StoryAutonomousChoicePrompt {
  programId: string;
  nodeId: string;
  owner: "agent" | "director";
  actorId?: number;
  question: string;
  options: Array<{ id: string; label: string }>;
  fallbackOptionId: string;
  contextHash: string;
}

export interface StoryExpressionRequest {
  programId: string;
  beatId: string;
  actorId: number;
  locationId: string;
  promptHint: string;
  fallbackText: string;
  contextHash: string;
  requestKind?: "expression" | "bounded-talk";
  participantIds?: number[];
  maxLines?: number;
}

export type NarrativeEventStatus =
  | "scheduled"
  | "ready"
  | "active"
  /** This presentation window was missed; its owning Arc may continue. */
  | "missed"
  | "resolved"
  | "expired"
  | "cancelled";

/** One candidate situation offered to the player in the opening stage. It is
 * a state of affairs already under way among the NPCs, not a task list, and
 * never assigns the protagonist a role. */
export interface NarrativeSituationOptionV1 {
  id: string;
  /** One-line statement of what is happening. */
  premise: string;
  /** What each NPC wants in this situation. */
  characters: Array<{ characterId: number; wants: string }>;
  /** Where the friction or the connection lies. */
  tension: string;
  /** How the protagonist could plausibly run into it. */
  meetingPoint: string;
  participantIds: number[];
  locationIds: string[];
}

/** Overnight stage-A output: a small set of situations for the player to
 * choose between once they wake. It carries no program and no accepted event,
 * so declining all of them simply discards the session. */
export interface NarrativeSituationSessionV1 {
  version: 1;
  /** Stable id used as the dialogue-session id and for save replay. */
  id: string;
  createdAtTick: number;
  dayIndex: number;
  contextHash: string;
  /** Free-form premise that produced this set (manual L3 entry only). */
  playerIntent?: string;
  /** The menu was generated by a manual call that asked to replace unstarted
   * stories. The replacement itself can only happen once a situation is
   * chosen, so the intent is carried here across the player's decision. */
  replacePending?: boolean;
  /** The menu came from the player's manual entry, so the story it opens keeps
   * the same budget exemption as the request that produced it. */
  manual?: boolean;
  /** The runtime picked this set by itself and will open one of them without
   * asking. The player must never be shown a menu for it: the set exists only
   * so the already-validated choice plumbing can be reused, and it is cleared
   * as soon as the opening resolves. */
  autoSelect?: boolean;
  /** The menu was compiled while serving a promised interaction window of this
   * Arc (see compileNarrativeDirectorRequest's pinArcId). Stage B must re-pin
   * the same Arc — without it, the recompile would pick whichever active Arc
   * has the earliest deadline and author the wrong encounter. The window
   * itself is deliberately NOT frozen here: the choice compiles against the
   * promise as it stands when the player decides. */
  arcId?: string;
  /** The places the promise named when the menu was compiled. Diagnostic only;
   * the binding constraint is re-derived from the Arc at stage B. */
  promisedLocationIds?: string[];
  situations: NarrativeSituationOptionV1[];
}

export interface NarrativeEventInstance {
  version: 1;
  id: string;
  title: string;
  status: NarrativeEventStatus;
  participantIds: number[];
  locationIds: string[];
  windowStartTick: number;
  windowEndTick: number;
  deferCount: number;
  createdAtTick: number;
  contextHash: string;
  program: StoryProgramV2;
  /** Player-facing lead shown as soon as the generated event is accepted. */
  introText?: string;
  /** Persistent, concise description of what the player should pursue. */
  objectiveText?: string;
  /** One-shot Act_COM label used to explicitly start the first scene. */
  startCommandLabel?: string;
  arcId?: string;
  anchor?: "tanabata" | "weather-anomaly" | "free";
  /** Background/foreground bookkeeping. Missing on old saves means false. */
  missCount?: number;
  lastMissedTick?: number;
  nextAttemptTick?: number;
  /** The opening is recorded only when the player actually enters the event. */
  openingRecorded?: boolean;
  /** The player asked for this story by hand instead of waiting for the
   * automatic overnight pass. Manual events neither respect nor consume the
   * foreground frequency budget: a spent quota must not refuse an explicit
   * request, and a story the player asked for must not starve the automatic
   * pacing that quota exists to ration. */
  manual?: boolean;
  lifecycleReason?: string;
}

export type StoryArcStatus = "active" | "paused" | "completed" | "abandoned" | "expired";

export type StoryArcDisposition = "continue" | "wait" | "paused" | "conclude";

/** What a waiting Arc is waiting for. `latestTick` bounds a time-based wait so
 * a stalled wait cannot park the Arc forever. */
export interface StoryArcWaitV1 {
  kind: "time" | "event" | "meeting" | "player-action";
  refId?: string;
  latestTick?: number;
}

/** The next legal chance for this Arc, plus what happens if it is missed. */
export interface StoryArcNextChanceV1 {
  earliestTick: number;
  latestTick: number;
  locationIds: string[];
  onMiss: "defer" | "expire" | "conclude";
}

/** Minimal cross-day maintenance record for one Arc.
 *
 * Deliberately NOT stored here, because each already has exactly one authority:
 * - who believes what → L2 cognition + `NarrativeSnapshotV1.subjective[].subject`
 * - open questions → `StoryArcInstanceV1.unresolvedThreads`
 * - fact provenance and "who knows it" → `acceptedFactIds` holds Experience ids;
 *   `AcceptedExperience` carries sourceIds/startTick/endTick/visibility, and
 *   `isExperienceVisibleTo` derives the holders. A second copy here would be a
 *   second source of truth for a secret's spread, which is exactly the failure
 *   mode this stage exists to prevent. */
export interface StoryArcMaintenanceV1 {
  /** Cross-frontier execution ledger; old node IDs never authorize replay. */
  executedCapabilityIds?: string[];
  interaction?: import("./interaction-progress.js").StoryInteractionStateV1;
  /** The live contention and what each side wants. */
  conflict: { summary: string; sides: Array<{ characterId: number; wants: string }> } | null;
  /** Changes the Arc has accepted as having actually happened. */
  confirmedChanges: Array<{ id: string; text: string; atTick: number }>;
  disposition: StoryArcDisposition;
  waitOn: StoryArcWaitV1 | null;
  nextChance: StoryArcNextChanceV1 | null;
  /** Why the last generation attempt failed or was deferred. */
  lastFailure: { atTick: number; reason: string } | null;
  /** Compact summaries of scenes already played, kept beside `beatHistory`'s
   * id-only records so a later day can read what happened, not just which
   * program ids ran. */
  recentScenes: Array<{ programId: string; outcomeId: string; summary: string; atTick: number }>;
  /** Evidence the director has already used, so it is not replayed. */
  consumedEvidenceIds: string[];
  /** Arrangements for the future. Kept separate from everything above so a
   * plan cannot be read back as history before it happens. */
  plannedBeats: Array<{ atTick: number; kind: string; refId?: string }>;
  /** Bounded automatic-evolution bookkeeping. Optional for pre-v32 saves. */
  evolution?: StoryArcEvolutionStateV1;
}

export interface StoryArcEvolutionStateV1 {
  /** Last state fingerprint accepted by the background controller. */
  lastRequestId?: string;
  lastAttemptTick?: number;
  cooldownUntilTick?: number;
  attemptsDayIndex?: number;
  attemptsToday?: number;
  nextTrigger?: NarrativeArcEvolutionTrigger;
  /** Validated player-facing capabilities waiting for a foreground encounter. */
  pendingPlayerIntents?: Array<{ capabilityId: string; reason: string; createdAtTick: number }>;
  /** Compact private result; never rendered as a player transcript. */
  backgroundSummary?: string;
}

export type NarrativeArcEvolutionTrigger =
  | "missed-window"
  | "clock-boundary"
  | "important-fact"
  | "provider-retry";

export type NarrativeArcEvolutionOutcome = "defer" | "advance" | "escalate" | "conclude";

/** Narrow, reference-only request for an offscreen Arc pass. */
export interface NarrativeArcEvolutionRequestV1 {
  interaction?: import("./interaction-progress.js").StoryInteractionRequestV1;
  version: 1;
  requestId: string;
  arcId: string;
  trigger: NarrativeArcEvolutionTrigger;
  baseArcHash: string;
  dayIndex: number;
  tick: number;
  participantIds: number[];
  locationIds: string[];
  capabilities: RuntimeCapabilityOption[];
  maintenance: StoryArcMaintenanceV1 | null;
}

/** Untrusted L3 result for one background pass. It contains capability IDs,
 * never state diffs or arbitrary commands. */
export interface NarrativeArcEvolutionProposalV1 {
  interactionUpdate?: import("./interaction-progress.js").StoryInteractionUpdateV1;
  version: 1;
  proposalId: string;
  arcId: string;
  baseArcHash: string;
  outcome: NarrativeArcEvolutionOutcome;
  capabilityIds: string[];
  nextOpportunity?: {
    earliestTick: number;
    latestTick: number;
    locationIds: string[];
    onMiss?: "defer" | "expire" | "conclude";
  };
  summary: string;
}

export interface StoryArcInstanceV1 {
  version: 1;
  id: string;
  templateId: string;
  title: string;
  /** Bound once; later scenes and background evolution must preserve it. */
  background?: StoryBackgroundV1;
  status: StoryArcStatus;
  phase: number;
  participantRoles: Array<{ characterId: number; roleId: string }>;
  goals: string[];
  acceptedFactIds: string[];
  unresolvedThreads: string[];
  deadlineTick: number;
  variables: Record<string, string>;
  beatHistory: Array<{ eventId: string; programId: string; outcomeId: string; resolvedAtTick: number }>;
  nextOpportunities: Array<{ earliestTick: number; latestTick: number; locationIds: string[] }>;
  providerFailureDays: number;
  /** Absent on saves written before schema 31, and on arcs no generation has
   * touched yet. Readers must treat `undefined` as "nothing recorded", never
   * as "nothing happened". */
  maintenance?: StoryArcMaintenanceV1;
  lifecycleReason?: string;
}

export interface StoryTemplateDocumentV2 {
  version: 2;
  id: string;
  title: string;
  characterSlots: Array<{ id: string; min: number; max: number }>;
  locationConstraints: string[];
  triggerAnchors: string[];
  graph: StoryGraphProposalV2;
  fallback: { deterministic: boolean; abortSummary: string };
  requiredCapabilityKinds: RuntimeCapabilityKind[];
  provenance: { source: "authored" | "ai-favorite"; createdAt: string; sourceEventId?: string };
}

export interface StoryTemplateFavoriteRequest {
  version: 1;
  id: string;
  eventId: string;
  requestedAtTick: number;
  suggestedTitle: string;
  sourceProgram: StoryProgramV2;
  status: "pending-export" | "exported" | "cancelled";
}
