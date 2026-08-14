export type {
  AgentRuntimeState,
  AgentSettings,
  AgentCognitiveState,
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
  AgentNightResult,
  AgentPlanCandidate,
  AgentPlanSelection,
  AcceptedAgentPlanSelection,
  AcceptedAgentDailyPlan,
  AgentCommissionCandidate,
  AgentCommissionSelection,
} from "./types.js";

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
  MAX_REPLACEMENTS_PER_NIGHT,
  selectRoster,
  selectRosterAtNight,
  eligibleAgentCharaNums,
} from "./roster.js";

export {
  AGENT_RUNTIME_VERSION,
  DEFAULT_MAX_ACTIVE_AGENTS,
  COGNITIVE_CAPS,
  createAgentRuntimeState,
  ensureAgentRuntime,
  ensureCognitiveState,
  ensureEngagement,
  enforceCognitiveCaps,
} from "./init.js";

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

export { buildAgentL1Context } from "./context.js";
