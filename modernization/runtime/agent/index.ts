export { createMemoryArchive, createMemoryBlock, validateMemoryBlock, validateMemoryAttachments, normalizeMemoryArchive } from "./memory-archive.js";
export type { AgentMemoryArchiveV1, AgentMemoryBlockV1, AgentMemoryRecordV1 } from "./memory-archive.js";
export type {
  AgentRuntimeState,
  AgentSettings,
  AgentMaterializationState,
  AgentDailyLedgerV1,
  AgentDailyCharacterRecord,
  AgentDailyActivity,
  AgentDailyEncounter,
  AgentDailyVisitedLocation,
  AgentRelationshipEvidenceSnapshot,
  AgentRelationshipChangeEvidence,
  AgentCognitiveState,
  AgentDaytimeSyncState,
  AgentMindStateV1,
  AgentMindItem,
  AgentMindBeliefTopic,
  AgentSocialThread,
  AgentSocialThreadKind,
  AgentPendingEpisode,
  AgentPendingEpisodeLine,
  AgentPendingEpisodeChoice,
  AgentMindUpdatesV1,
  AgentMindItemUpdate,
  AgentSocialThreadUpdate,
  AgentEngagement,
  AgentInteractionSignal,
  InteractionSignalKind,
  AgentObservation,
  AgentMemory,
  AgentReflection,
  AgentGoal,
  AgentDiaryEntry,
  AcceptedAgentDecision,
  AgentMemoryDraft,
  AgentNightResponse,
  AgentNightResponseV2,
  AgentNightResponseV3,
  AgentNightDraft,
  AgentStoryClaim,
  AgentNightAuditResponseV1,
  AgentNightResult,
  AgentPlanCandidate,
  AgentPlanSelection,
  AcceptedAgentPlanSelection,
  AcceptedAgentDailyPlan,
  AgentCommissionCandidate,
  AgentCommissionSelection,
} from "./types.js";

export {
  AGENT_DAILY_LEDGER_VERSION,
  MAX_LEDGER_DAYS,
  MAX_DAILY_ACTIVITIES,
  MAX_DAILY_LOCATIONS,
  MAX_DAILY_ENCOUNTERS,
  createAgentDailyLedger,
  ensureCurrentAgentLedgerDay,
  recordAgentDailyActivity,
  recordAgentDailyLocationVisit,
  recordAgentDailyWorldInterval,
  finalizeAgentDailyLedgerDay,
  captureRelationshipEvidence,
  getAgentDailyCharacterRecord,
  hasInterestingEventAnchor,
  validateAgentStoryClaim,
} from "./daily-ledger.js";

export {
  SIGNAL_POINTS,
  DECAY_HALF_LIFE_TICKS,
  INCUMBENCY_BONUS,
  CHALLENGE_THRESHOLD,
  MAX_SIGNALS,
  recordSignal,
  applyDecay,
  effectiveScore,
  createEngagement,
} from "./engagement.js";

export {
  MAX_ACTIVE_AGENTS,
  MAX_REPLACEMENTS_PER_NIGHT,
  ROSTER_HEAD_RATIO,
  ROSTER_REPLACEMENT_RATIO,
  replacementLimitForRosterSize,
  selectRoster,
  selectRosterAtNight,
  eligibleAgentCharaNums,
} from "./roster.js";

export {
  AGENT_RUNTIME_VERSION,
  DEFAULT_MAX_ACTIVE_AGENTS,
  MAX_MATERIALIZATION_CHARACTERS,
  MAX_LAZY_REQUESTS_PER_DAY,
  COGNITIVE_CAPS,
  clearAiGeneratedState,
  createAgentRuntimeState,
  createAgentMaterializationState,
  resetMaterializationBudgetForDay,
  pruneMaterializationTicks,
  ensureAgentRuntime,
  ensureCognitiveState,
  ensureEngagement,
  enforceCognitiveCaps,
} from "./init.js";

export {
  AGENT_MIND_VERSION,
  AGENT_MIND_CAPS,
  createAgentMindState,
  normalizeAgentMindState,
  normalizeAgentPendingEpisodes,
  applyAgentMindUpdates,
  appendPlayerAiChatEpisode,
  appendAiChatBranch,
  consumePendingEpisodes,
} from "./mind.js";
export type { ApplyMindUpdatesResult, AppendPlayerAiChatInput } from "./mind.js";

export { getAgentAttentionLevel } from "./attention.js";
export type { AgentAttentionLevel } from "./attention.js";

export {
  recordInteractionSignal,
  recordCommandSignal,
  recordDialogueSignal,
  recordCommissionSignal,
  recordDateBanquetSignal,
  recordRelationDeltaSignal,
} from "./recorder.js";

export { compileObservations } from "./observation-compiler.js";

export {
  projectDaytimeAgentFacts,
  getPendingDaytimeEvidence,
  applyDaytimeMindUpdates,
  consumeDaytimeEvidenceForNight,
  daytimeSyncForCharacter,
} from "./daytime-sync.js";
export type {
  DaytimeFactProjection,
  DaytimeEvidenceBatch,
  DaytimeMindApplyResult,
} from "./daytime-sync.js";

export {
  compileHardBlocks,
  deriveFreeWindows,
  generateCandidates,
  hashPlanContext,
} from "./plan-compiler.js";
export type { HardBlock, FreeWindow } from "./plan-compiler.js";

export { validatePlanSelection, filterValidSelections } from "./plan-validator.js";

export { applyAgentPlan, activePlanSelection } from "./plan-executor.js";

export {
  selectNightTargets,
  recordAgentDecision,
  DEFAULT_ORCHESTRATION_CONFIG,
} from "./orchestrator.js";
export type { NightTarget, NightOrchestrationConfig } from "./orchestrator.js";

export { compileCommissionCandidates } from "./commission-compiler.js";
export { applyCommissionDecision } from "./commission-executor.js";

export { buildAgentL1Context, getCharacterCognition } from "./context.js";

export {
  LAZY_MIN_BLANK_TICKS,
  MAX_LAZY_EXPERIENCES_PER_RESPONSE,
  LAZY_EXPERIENCE_KINDS,
  buildLazyMaterializationContext,
  parseLazyMaterializationResponse,
  buildCharacterSoftExperiences,
} from "./lazy-materialization.js";

export {
  compileAgentActionOffers,
  applyAgentActionProposal,
} from "./action-offers.js";
export type {
  AgentActionKind,
  AgentActionOfferV1,
  AgentActionProposalV1,
  ApplyAgentActionResult,
} from "./action-offers.js";
export type {
  LazyMaterializationResponse,
  LazyMaterializationEnvelope,
  LazyMaterializationContext,
} from "./lazy-materialization.js";
