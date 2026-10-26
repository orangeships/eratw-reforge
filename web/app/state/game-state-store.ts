import { create } from "zustand";
import { awaitMemoryCommits, hydrateMemoryArchive, importLegacyMemories, memoryPublicationContext, prepareMemoryRecords, trackMemoryCommit } from "../ai/memory-archive.js";
import { commitHookReceipt, selectNarrativeHook, commitHookPlayerResponse, deferUnprocessedProgramHook } from "../../../modernization/runtime/story/dialogue-hook.js";
import { prepareHookPublication, prepareAcceptedHookPublication, attachHookChoice, hookReplyChoice } from "../ai/hook-publication.js";
import { bindStoryChoice, selectedBranchTranscript } from "../ai/story-choice.js";
import { createNarrativeDialogueLease } from "../ai/dialogue-state-lease.js";
import { acceptStorylet, refreshStorylets, recordStoryletDialogue, startReadyStorylet } from "../../../modernization/runtime/story/storylet-runtime.js";
import type { StoryletBindingsV1 } from "../../../modernization/runtime/story/storylet-document.js";
import { memoryContentId, type AgentMemoryArchiveV1 } from "../../../modernization/runtime/agent/memory-archive.js";
import {
  loadState as ipcLoadState,
  listSaveSlots as ipcListSaveSlots,
  mostRecentSlot as ipcMostRecentSlot,
  saveState as ipcSaveState,
  type SaveSlot,
  type SaveSummary,
  type SlotInfo,
  MemoryArchiveLoadError,
} from "../ipc/tauri-bridge";
import {
  applyIntent,
  applyKojoEffects,
  configureIntent,
  finishPlayerSleep,
  finalizeElapsedAction,
  openEyes,
  setMasterWakeMinute,
  buildSeededMasterState,
  buildConfiguredCharaSlot,
  cloneGameState,
  clearTurnContext,
  TFLAG_ID,
  currentIntentDeps,
  dayEventKojoEventsFromSession,
  hydrateConfiguredCharaHomes,
  initializeConfiguredSchedules,
  GAME_STATE_SCHEMA_VERSION,
  migrateGameState,
  resolveDomainTransitionDialogue,
  resolveMobMeal,
  reprojectSchedules,
  resolveOutingEventSession,
  commitOutingChoiceResult,
  dailyEventPromptView,
  type OutingChoiceValue,
  runNewGameInitialLevelSync,
  listNewGameKojoUpdates,
  resolveNewGameKojoUpdate,
  type NewGameKojoUpdateCandidate,
  type NewGameKojoUpdateResult,
  seedScheduledLocations,
  snapshotCharaStates,
  settleDanmakuBattleCore,
  patternForTarget,
  setTflag,
  type BattleInput,
  toggleComFilter,
  type CharaStatsLike,
  type GameState,
  type DomainTransition,
  type TimeSlot,
  buyFishingGear,
  finishFishingSession,
  type FishingGearKind,
  type FishingLineId,
  type FishingRodId,
  type FishingSettlementOutcome,
  acceptStorySelection,
  abortStoryProgram,
  advanceStoryProgram,
  activateReadyNarrativeEvent,
  acceptNarrativeContinuation,
  acceptNarrativeSituationChoice,
  closeUnavailableStoryArcs,
  reconcileNarrativeState,
  recordStoryPlayerInteraction,
  recordStoryExpressionReceipt,
  isOpenStoryProgram,
  compileNarrativeContinuationRequest,
  compileNarrativeDirectorRequest,
  compileNarrativeArcEvolutionRequest,
  compileNarrativeSnapshot,
  applyNarrativeArcEvolution,
  selectDueNarrativeArc,
  selectServableInteractionWindowArc,
  describeArcInteractionIntent,
  NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS,
  NARRATIVE_MAX_ACTIVE_ARCS,
  NARRATIVE_MAX_PARTICIPANTS,
  compileStoryOpportunity,
  deterministicForegroundConflict,
  recordStoryTemplateFavorite,
  refreshNarrativeEvents,
  scheduleNarrativeSituations,
  selectNarrativeSituation,
  setStoryArcStatus,
  type NarrativeReadyTrigger,
  type NarrativeArcEvolutionTrigger,
  type StoryAutonomousChoicePrompt,
  type StoryChoicePrompt,
  type StoryExpressionRequest,
  applyAgentActionProposal,
  type AgentActionProposalV1,
} from "../../../modernization/runtime";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { seedInitialWeatherForecasts } from "../../../modernization/runtime/weather/prediction.js";
import {
  startSkipMove,
  resolveWalkEncounter,
  hasNpcAt,
  type WalkChoice,
} from "../../../modernization/runtime/world/skip-move.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID, getMasterTalent, setCharaCflag, setMasterCflag, setMasterTalent, setMasterAbl, setMasterBase, setMasterExp } from "../../../modernization/runtime/state/settlement.js";
import { SOURCE_ID, advanceTimeTicks } from "../../../modernization/runtime/state/settlement.js";
import { applySourceCheck } from "../../../modernization/runtime/command/source-check.js";
import { addItem } from "../../../modernization/runtime/state/items.js";
import { hasPlace, PLACE_GARDEN } from "../../../modernization/runtime/world/place-flags.js";
import { placeFlagsOf } from "../../../modernization/runtime/world/location-predicates.js";
import { togglePortraitKind } from "../../../modernization/runtime/state/portrait-kind.js";
import { setPortraitVariant } from "../../../modernization/runtime/state/portrait-variant.js";
import {
  claimPantyCollectionBonus,
  spendCollectionDuplicates,
} from "../../../modernization/runtime/state/panty-collection.js";
import { resetAllCommissions } from "../../../modernization/runtime/state/commission.js";
import { resetAllClothes } from "../../../modernization/runtime/state/clothing-write.js";
import { materializeCaughtBug, releaseCaughtBug } from "../../../modernization/runtime/state/bug-catching.js";
import { ensureRinnosuke, resolveMobGirlMemory } from "../../../modernization/runtime/world/dynamic-characters.js";
import {
  computeAgentNightBatchContextHash,
  MAX_NIGHT_LLM_CONCURRENCY,
  runMultiAgentNightCycle,
  type AgentNightCharaProgress,
  type AgentNightPhase,
  type NightCycleProgress,
} from "../ai/agent-night.js";
import {
  appendAiChatBranch,
  appendPlayerAiChatEpisode,
  buildAgentL1Context,
  createAgentRuntimeState,
  buildLazyMaterializationContext,
  clearAiGeneratedState,
  createAgentMaterializationState,
  ensureCurrentAgentLedgerDay,
  ensureAgentRuntime,
  MAX_LAZY_REQUESTS_PER_DAY,
  LAZY_MIN_BLANK_TICKS,
  pruneMaterializationTicks,
  recordInteractionSignal,
  resetMaterializationBudgetForDay,
  projectDaytimeAgentFacts,
  getPendingDaytimeEvidence,
  applyDaytimeMindUpdates,
  type AgentSettings,
  type AgentMindUpdatesV1,
} from "../../../modernization/runtime/agent/index.js";
import {
  acceptExperience,
  type AcceptedExperience,
} from "../../../modernization/runtime/experience.js";
import {
  appendStoneContestPlacement,
  advanceStoneContestClock,
  advanceStoneClerkStory,
  commitStoneContestSettlement,
  continueStoneContest,
  forfeitStoneContestRound,
  leaveStoneContestLobby,
  renameStoneContestClerk,
  resolveSoloStoneRound,
  resolveStoneCouple,
  startStoneContest,
  withdrawStoneContest,
  type StoneContestStartOptions,
} from "../../../modernization/runtime/state/stone-contest.js";
import type { StonePlacementOperation } from "../../../modernization/runtime/state/stone-contest-physics.js";
import { applyMasterConsumable } from "../../../modernization/runtime/command/handlers/item-use.js";
import {
  readCharaGates,
  patchCharaGates,
  readMasterDebugAbilities,
  patchMasterDebugAbilities,
  type CharaGates,
  type MasterDebugAbilities,
} from "../../../modernization/runtime/debug/kojo-probe.js";
import type { NewGameDraft } from "../game/pre/newgame-draft.js";
import { normalizeMasterTalentByGender } from "../game/pre/newgame-talent.js";
import { normalizeMasterExpByGender } from "../game/pre/newgame-exp.js";
import {
  ITEM_STOCK_CODE,
  catalogEntry,
  shopBuy,
  type ShopBuyResult,
} from "../../../modernization/runtime/state/shop.js";
import charaBundle from "../game/charas.bundle.json";
import { eventInstanceKey } from "../game/event-merge.js";
import { isInteractionVisibleEvent } from "../game/player-visible-events.js";
import { mockEmptyWorldSnapshot } from "../../../modernization/schemas/mock.js";
import type {
  AgentIntent,
  ObservationEvent,
  StatusMessage,
} from "../../../modernization/schemas/types.js";
import type { PromptSpec, PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import type { CommandContext } from "../../../modernization/runtime/command/types.js";
import type { DialogueRouter, KojoLine, KojoResolution, PendingKojoChoice } from "../../../modernization/runtime/kojo/types.js";
import {
  detectEncounterTransition,
  runFirstMeeting,
  runFirstMeetingsForTransition,
  type EncounterTransition,
  type FirstMeetingsForTransitionResult,
} from "../../../modernization/runtime/world/first-meeting.js";
import { commandKojoEventsFromSession } from "../../../modernization/runtime/command/command-kojo.js";
import { CONFIGURED_ROSTER_IDS } from "../../../modernization/runtime/world/configured-roster.js";
import { relationOf } from "../../../modernization/runtime/world/relation.js";
import { locationToRoomId, setSlotLocation } from "../../../modernization/runtime/world/room-id-location.js";
import { narrativeCastWaitReason } from "../../../modernization/runtime/story/attendance.js";
import { canAssessStoryInteractions, hasPendingStoryInteraction, recordPlayerStoryChoice, recordStoryInteraction, recordStoryWorldChanges, reserveStoryInteractionAssessment } from "../../../modernization/runtime/story/interaction-progress.js";
import { resolveFestivalEvent } from "../../../modernization/runtime/world/festival-events.js";
import {
  DIALOGUE_SESSION_PRIORITY,
  advanceDialogueSession,
  enqueueDialogueSession,
  mergeReplayedTranscript,
  replaceActiveDialogueSession,
  type DialogueChoiceSession,
  type DialogueSession,
  type DialogueSessionOwner,
} from "./dialogue-session.js";
import {
  cancelAllRealtimeAiKojo,
  AI_CHAT_COMMAND_NO,
  cancelRealtimeAiKojo,
  generateRealtimeAiKojo,
  judgeRealtimeDialogueAction,
  cancelDialogueActionJudge,
  prepareRealtimeAiChat,
  prepareNarrativeHookDialogue,
  prepareRealtimeAiCounterKojo,
  prepareRealtimeAiDateInvitation,
  prepareRealtimeAiKojo,
  prepareRealtimeAiEventKojo,
  prepareRealtimeAiWitnessKojo,
  recordAiCommand,
} from "../ai/kojo-runtime.js";
import type { AiGeneratedLine, PreparedAiKojoRequest } from "../ai/types.js";
import { currentAiCharacterProfile, currentAiSettings, useAiStore } from "../ai/store.js";
import type { AiSettings } from "../ai/types.js";
import { commandLabel, compileAiCharacterSemanticContext } from "../ai/context.js";
import { settleRelationshipProposal } from "../../../modernization/runtime/ai-state/relationship.js";
import { hasDialogueAccompanyDecision, prepareDialogueActionInput, pruneDialogueAccompanyPermits } from "../../../modernization/runtime/ai-state/dialogue-action.js";
import { settleDialogueAction, settleDialogueAccompanyResponse } from "../../../modernization/runtime/ai-state/dialogue-action-settlement.js";
import { TCVAR_ID } from "../../../modernization/runtime/state/settlement.js";
import { resetSceneAmbientRuntime } from "../ai/ambient-runtime.js";
import {
  cancelLazyMaterialization,
  prepareCharacterForEncounter,
  type LazyMaterializationHost,
  type LazyMaterializationReservation,
  type LazyMaterializationTrigger,
} from "../ai/lazy-materialization.js";
import { jsonUtf8Bytes } from "../ai/s4-evaluation.js";
import { beginCommandTiming } from "../ai/command-perf.js";
import { requestNarrativeArcEvolution, requestNarrativeContinuation, requestNarrativeOpening, requestNarrativeSituations, requestStoryAutonomousChoice, requestStoryExpression, requestStorySelection } from "../ai/story-runtime.js";
import { offeredDateInvitations } from "../../../modernization/runtime/world/date-appointments.js";
import { advancePartnerLedDate } from "../../../modernization/runtime/world/date-session.js";
import {
  requestAgentDaytimeReaction,
  isAgentDaytimeSchemaError,
  type AgentDaytimeReactionEnvelope,
} from "../ai/agent-daytime.js";
import {
  AGENT_DAYTIME_PROMPT_VERSION,
  DaytimeFailureGuard,
  daytimeFailureFingerprint,
} from "../ai/daytime-guard.js";
import { DaytimeBatchPacer } from "../ai/daytime-pacing.js";
import { narrativeDirectorStillAuthorized, narrativeParticipantsAuthorized } from "../ai/narrative-authorization.js";
import { recordCompletionExchanges } from "../ai/completion-diagnostics.js";

/**
 * Phase 4D — GameState store.
 *
 * Holds the live `GameState` and exposes actions to load/save it
 * via the Rust IPC commands (Phase 4B). The store is the single
 * place where the renderer's `GameState` is mutated; React
 * components read from the store and call `applyIntentAction` to
 * push new intents.
 *
 * Layering:
 *   - Tauri IPC (loadState / saveState) is the I/O boundary.
 *   - `applyIntent` (TS, Phase 4A) is the settlement stub.
 *   - The store is the React-side glue.
 *
 * Phase 4 scope: NO real settlement. applyIntent is the stub that
 * appends a STATUS_MESSAGE to eventLog. Real settlement lands in
 * Phase 5.
 *
 * Test strategy: `tauri-bridge.ts` is mocked in
 * `game-state-store.test.ts` so this file can be tested without
 * a Tauri runtime. The store's contract is "on load, fetch from
 * IPC; on null, build a fresh state; on applyIntent, mutate eventLog
 * only; on save, push to IPC".
 */

const NOW = () => Date.now();

/** Helper: identify EVENT kojo context from arm and sub for AI prompt. */
function identifyEventKojoContext(eventArm: number, eventSub: number[]): import("../ai/types.js").EventKojoContext {
  if (eventArm === 12) {
    const [sub1, sub2] = eventSub;
    if (sub1 === 1 && sub2 === 2) return "sneak-in-allowed";
    if (sub1 === 1 && sub2 === 4) return "sneak-in-refused";
    if (sub1 === 2 && sub2 === 1) return "sneak-in-rage";
  }
  if (eventArm === 3 && eventSub[0] === 7 && eventSub[1] === 1) {
    return "kick-out-bedroom";
  }
  return "other";
}

/** Helper: build EVENT kojo description for AI prompt context. */
function buildEventKojoDescription(
  state: GameState,
  meta: { target: number; eventArm: number; eventSub: number[] },
): string {
  const targetName = state.charas[meta.target]?.callName ?? `角色${meta.target}`;

  if (meta.eventArm === 12) {
    const [sub1, sub2] = meta.eventSub;
    if (sub1 === 1 && sub2 === 2) {
      return `${targetName}醒来后允许你留下`;
    }
    if (sub1 === 1 && sub2 === 4) {
      return `${targetName}醒来后拒绝你进入，把你赶了出去`;
    }
    if (sub1 === 2 && sub2 === 1) {
      return `${targetName}愤怒地拒绝你的潜入`;
    }
    if (sub1 === 1 && sub2 === 1) {
      return `悄悄潜入了熟睡的${targetName}的房间`;
    }
  }

  if (meta.eventArm === 3 && meta.eventSub[0] === 7 && meta.eventSub[1] === 1) {
    return `${targetName}犯困回到房间，发现你在这里，把你赶了出去`;
  }

  return `EVENT ${meta.eventArm} sub [${meta.eventSub.join(",")}] 场景`;
}


function finalizeActivityState(
  state: GameState,
  oldTick: number,
  commandNo: number,
): GameState {
  const deps = currentIntentDeps();
  const post = finalizeElapsedAction(state, {
    oldTick,
    commandNo,
    now: NOW,
    rng: createRng(commandNo * 100003 + oldTick),
    dialogueRouter: deps.router,
    accrueMobDirt: true,
  });
  post.state.eventLog = [...post.state.eventLog, ...post.events];
  return post.state;
}
let agentNightController: AbortController | null = null;
let agentNightGeneration = 0;
// Completion deferred for the CURRENT nightly AI barrier. `awaitNightCycle()`
// returns this promise so day-break waits for both Agent Night and automatic
// L3 to settle (commit, fail or cancel) before waking the master.
// Created synchronously in finishSleepAction — before the setTimeout launch —
// so the wait is racable the instant the sleep settlement returns.
let agentNightPromise: Promise<void> | null = null;
let agentNightResolve: (() => void) | null = null;

/**
 * Begin (or reuse) the current night's completion deferred. Returns a
 * settle bound to THIS deferred — a superseded cycle's stale cleanup (its
 * launcher firing late, its `.finally` landing after a load/new-game raced
 * in) must only ever resolve its own wait, never a newer cycle's.
 */
function beginAgentNightPromise(): () => void {
  if (!agentNightPromise) {
    agentNightPromise = new Promise<void>((resolve) => {
      agentNightResolve = resolve;
    });
  }
  const target = agentNightPromise;
  const targetResolve = agentNightResolve!;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    targetResolve();
    if (agentNightPromise === target) {
      agentNightPromise = null;
      agentNightResolve = null;
    }
  };
}

/** Settle whatever wait is CURRENTLY pending (cancel/abandon semantics). */
function settleAgentNightPromise(): void {
  agentNightResolve?.();
  agentNightResolve = null;
  agentNightPromise = null;
}

let storyController: AbortController | null = null;
let storyGeneration = 0;
let narrativeController: AbortController | null = null;
let narrativeGeneration = 0;
let backgroundNarrativeEvolutionScheduled = false;
/** Session-level throttle, keyed by Arc. Counts actual provider starts,
 * including failures. Load/reset clears it; it is not a cross-save cost cap. */
const arcWindowDirectorAttempts = new Map<string, { lastTick: number; lastAt: number; dayIndex: number; count: number }>();
const ARC_WINDOW_DIRECTOR_RETRY_MS = 10_000;
let arcWindowDirectorRetryTimer: ReturnType<typeof setTimeout> | null = null;
let arcWindowDirectorRetryAt: number | null = null;
const ARC_WINDOW_DIRECTOR_MIN_GAP_TICKS = NARRATIVE_ARC_EVOLUTION_COOLDOWN_TICKS;
const ARC_WINDOW_DIRECTOR_DAILY_LIMIT = 2;
/** Pre-authoring lead: a promised window whose opening lies within this many
 * ticks is authored NOW, while the player is anywhere. Their arrival then only
 * picks the finished event up (zero provider calls on the walk-in path).
 * Bounded so a far-future window is never authored against a days-stale
 * snapshot; unmet leads are re-evaluated at the next trigger point. */
const NARRATIVE_WINDOW_AUTHORING_LEAD_TICKS = 6 * 60;
let daytimeGeneration = 0;
let daytimeRequestSeq = 0;
const daytimeControllers = new Map<number, AbortController>();
/** Cost pacing for the daytime sidecar: per-character daily ceiling, per-character
 * even spacing, and a global gap so a crowd does not fire on one tick. */
const daytimePacer = new DaytimeBatchPacer();
const DAYTIME_LLM_CONCURRENCY = 2;
const daytimeFailureGuard = new DaytimeFailureGuard();

type AgentAsyncRequestOwner = "night" | "lazy" | "narrative" | "daytime";
interface AgentAsyncRequestRegistration {
  owner: AgentAsyncRequestOwner;
  requestId: string;
  generation: number;
  dayIndex: number;
  contextHash?: string;
  requestKey?: string;
  charaNum?: number;
  baseRevision?: number;
}
const agentAsyncRequests = new Map<string, AgentAsyncRequestRegistration>();
let lazyMaterializationRequestSeq = 0;

type AgentAsyncPatch =
  | {
      owner: "night";
      requestId: string;
      generation: number;
      dayIndex: number;
      observationDayIndex: number;
      contextHash: string;
      signal: AbortSignal;
      cognitions: Record<number, import("../../../modernization/runtime/agent/index.js").AgentCognitiveState>;
      acceptedDecisions: import("../../../modernization/runtime/agent/index.js").AcceptedAgentDecision[];
      decisionSeq: number;
      nightEvents: ObservationEvent[];
      memoryArchive?: AgentMemoryArchiveV1;
      memoryArchiveBaseline?: AgentMemoryArchiveV1;
    }
  | {
      owner: "lazy";
      requestId: string;
      generation: number;
      dayIndex: number;
      signal: AbortSignal;
      characterId: number;
      contextHash: string;
      requestKey: string;
      windowEndTick: number;
      experiences: AcceptedExperience[];
    }
  | {
      owner: "daytime";
      requestId: string;
      generation: number;
      dayIndex: number;
      signal: AbortSignal;
      charaNum: number;
      baseRevision: number;
      contextHash: string;
      observationIds: string[];
      mindUpdates: AgentMindUpdatesV1;
    };

/** Dedicated async merge boundary for Night, Lazy, and daytime L2 patches. */
function commitAgentAsyncPatch(current: GameState, patch: AgentAsyncPatch): GameState | null {
  const registration = agentAsyncRequests.get(`${patch.owner}:${patch.requestId}`);
  if (!registration
    || registration.owner !== patch.owner
    || registration.requestId !== patch.requestId
    || registration.generation !== patch.generation
    || registration.dayIndex !== patch.dayIndex
    || patch.signal.aborted
    || current.time.dayIndex !== patch.dayIndex) return null;

  const next = cloneGameState(current);
  const runtime = ensureAgentRuntime(next);
  if (patch.owner === "night") {
    if (registration.contextHash !== patch.contextHash
      || !runtime.settings.masterEnabled
      || !useAiStore.getState().settings.enabled
      || computeAgentNightBatchContextHash(current, patch.observationDayIndex) !== patch.contextHash) return null;
    if (JSON.stringify(runtime.memoryArchive) !== JSON.stringify(patch.memoryArchiveBaseline)) return null;
    for (const [rawCharaNum, cognition] of Object.entries(patch.cognitions)) {
      runtime.cognitions[Number(rawCharaNum)] = structuredClone(cognition);
    }
    const knownDecisionIds = new Set(runtime.acceptedDecisions.map((decision) => decision.id));
    runtime.acceptedDecisions = [
      ...runtime.acceptedDecisions,
      ...patch.acceptedDecisions.filter((decision) => !knownDecisionIds.has(decision.id)),
    ].slice(-30);
    runtime.decisionSeq = Math.max(runtime.decisionSeq, patch.decisionSeq);
    runtime.memoryArchive = structuredClone(patch.memoryArchive);
    next.nightReport = [...(next.nightReport ?? []), ...patch.nightEvents];
  } else if (patch.owner === "lazy") {
    if (registration.contextHash !== patch.contextHash
      || registration.requestKey !== patch.requestKey
      || !runtime.materialization.requestKeys.includes(patch.requestKey)) return null;
    let accepted = next.acceptedExperiences ?? [];
    for (const experience of patch.experiences) {
      const result = acceptExperience(accepted, experience);
      if (!result.accepted) return null;
      accepted = result.experiences;
    }
    next.acceptedExperiences = accepted;
    syncAgentFactsAndSchedule(next, [
      patch.characterId,
      ...patch.experiences.flatMap((experience) => experience.participantIds),
    ]);
    runtime.materialization.materializedThroughTicks[patch.characterId] = Math.max(
      runtime.materialization.materializedThroughTicks[patch.characterId] ?? 0,
      patch.windowEndTick,
    );
    runtime.materialization.materializedThroughTicks = pruneMaterializationTicks(
      runtime.materialization.materializedThroughTicks,
    );
  } else {
    if (registration.contextHash !== patch.contextHash
      || registration.charaNum !== patch.charaNum
      || registration.baseRevision !== patch.baseRevision
      || !runtime.settings.masterEnabled
      || !useAiStore.getState().settings.enabled
      || !runtime.cognitions[patch.charaNum]) return null;
    const applied = applyDaytimeMindUpdates(next, {
      charaNum: patch.charaNum,
      baseRevision: patch.baseRevision,
      observationIds: patch.observationIds,
      updates: patch.mindUpdates,
    });
    if (!applied.accepted) return null;
  }
  agentAsyncRequests.delete(`${patch.owner}:${patch.requestId}`);
  return next;
}

function clearAgentAsyncRequests(owner: AgentAsyncRequestOwner): void {
  for (const [key, registration] of agentAsyncRequests) {
    if (registration.owner === owner) agentAsyncRequests.delete(key);
  }
}

function cancelAgentNightCycle(): void {
  agentNightGeneration++;
  agentNightController?.abort();
  agentNightController = null;
  // Automatic L3 is part of the same night barrier. Abandon/load/new-game
  // must abort both owners before releasing the morning wait.
  cancelNarrativeDirector("night cycle cancelled");
  clearAgentAsyncRequests("night");
  // Resolve any pending day-break wait and clear the morning-menu status —
  // a cancelled cycle must never leave `awaitNightCycle` or the [100] gate
  // hanging (this is the 「不再等待」 escape hatch's path, too).
  settleAgentNightPromise();
  useGameStateStore.setState({ nightCycleStatus: null });
}

function cancelDaytimeReactions(reason = "cancelled"): void {
  daytimeGeneration++;
  for (const controller of daytimeControllers.values()) controller.abort(reason);
  daytimeControllers.clear();
  clearAgentAsyncRequests("daytime");
  daytimeFailureGuard.reset();
}

function cancelLazyMaterializationFromStore(reason: string): void {
  cancelLazyMaterialization(reason);
  clearAgentAsyncRequests("lazy");
}

function daytimeRequestHash(charaNum: number, dayIndex: number, revision: number, observationIds: readonly string[]): string {
  let hash = 5381;
  const value = `${charaNum}:${dayIndex}:${revision}:${observationIds.join(",")}`;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  return `daytime-${Math.abs(hash).toString(36)}`;
}

/**
 * Start at most two independent daytime L2 reactions.  This queue is a
 * best-effort presentation sidecar: no provider result is allowed to block a
 * command, alter deterministic state, or hide the underlying observations.
 */
function scheduleAgentDaytimeReactions(candidateIds?: readonly number[]): void {
  queueMicrotask(() => {
    const current = useGameStateStore.getState().state;
    const settings = useAiStore.getState().settings;
    if (!current?.agentRuntime?.settings.masterEnabled
      || !settings.enabled
      || settings.daytimeReactionEnabled !== true
      || !settings.apiKey.trim()) return;
    const candidates = [...new Set(candidateIds ?? [
      ...current.agentRuntime.activeRoster,
      ...Object.keys(current.agentRuntime.cognitions).map(Number),
    ])]
      .filter((charaNum) => current.charas[charaNum] !== undefined)
      .filter((charaNum) => currentAiCharacterProfile(charaNum).enabled)
      .sort((left, right) => left - right);
    const slots = Math.max(0, DAYTIME_LLM_CONCURRENCY - daytimeControllers.size);
    if (slots <= 0) return;
    const generation = daytimeGeneration;
    const toStart = candidates
      .filter((charaNum) => !daytimeControllers.has(charaNum))
      .map((charaNum) => ({ charaNum, evidence: getPendingDaytimeEvidence(current, charaNum) }))
      .filter((entry): entry is { charaNum: number; evidence: NonNullable<ReturnType<typeof getPendingDaytimeEvidence>> } => entry.evidence !== null)
      .map((entry) => ({
        ...entry,
        fingerprint: daytimeFailureFingerprint({
          charaNum: entry.charaNum,
          observationIds: entry.evidence.observations.map((observation) => observation.id),
          promptVersion: AGENT_DAYTIME_PROMPT_VERSION,
        }),
      }))
      .filter((entry) => !daytimeFailureGuard.shouldSkip(entry.fingerprint));
    // Pacing is applied last, after the evidence/guard filters, so a deferred
    // character never consumes budget: the pacer only records real starts.
    const eligibleByChara = new Map(toStart.map((entry) => [entry.charaNum, entry]));
    const toStartPaced = daytimePacer
      .admit(
        toStart.map((entry) => entry.charaNum),
        current.time.dayIndex,
        current.time.tickValue,
        slots,
      )
      .map((charaNum) => eligibleByChara.get(charaNum)!);
    for (const { charaNum, evidence, fingerprint } of toStartPaced) {
      daytimeRequestSeq += 1;
      const requestId = `agent-daytime:${current.time.dayIndex}:${current.time.tickValue}:${charaNum}:${daytimeRequestSeq}`;
      const contextHash = daytimeRequestHash(charaNum, current.time.dayIndex, evidence.baseRevision, evidence.observations.map((entry) => entry.id));
      const controller = new AbortController();
      let committedReaction = false;
      daytimeControllers.set(charaNum, controller);
      agentAsyncRequests.set(`daytime:${requestId}`, {
        owner: "daytime",
        requestId,
        generation,
        dayIndex: current.time.dayIndex,
        contextHash,
        charaNum,
        baseRevision: evidence.baseRevision,
      });
      useAiStore.getState().addDebugEntry({
        requestId,
        createdAt: Date.now(),
        feature: "agent-daytime",
        target: charaNum,
        gameDayIndex: current.time.dayIndex,
        gameTick: current.time.tickValue,
        providerStarted: true,
        status: "pending",
      });
      void requestAgentDaytimeReaction({
        requestId,
        state: cloneGameState(current),
        evidence,
        settings,
        signal: controller.signal,
        hooks: recordCompletionExchanges(requestId),
      }).then((response: AgentDaytimeReactionEnvelope) => {
        if (generation !== daytimeGeneration || controller.signal.aborted) return;
        // A parsed provider response breaks the consecutive schema-error
        // streak even when the world moved on and the patch is later rejected
        // as stale at the deterministic merge boundary.
        daytimeFailureGuard.recordSuccess(fingerprint);
        const live = useGameStateStore.getState().state;
        if (!live || live.time.dayIndex !== current.time.dayIndex) return;
        const committed = commitAgentAsyncPatch(live, {
          owner: "daytime",
          requestId,
          generation,
          dayIndex: current.time.dayIndex,
          signal: controller.signal,
          charaNum,
          baseRevision: evidence.baseRevision,
          contextHash,
          observationIds: response.observationIds,
          mindUpdates: response.mindUpdates,
        });
        if (!committed) {
          useAiStore.getState().patchDebugEntry(requestId, {
            status: "cancelled",
            error: "daytime reaction became stale; facts remain queued",
          });
          return;
        }
        if (hasPendingRealtimeAi()) {
          // A realtime AI kojo is streaming: committing now would replace the
          // state object the stream's owner checks, cancelling the kojo and
          // dropping its pending command settlement. Facts stay queued for a
          // later projection pass.
          useAiStore.getState().patchDebugEntry(requestId, {
            status: "skipped",
            skipReason: "实时口上生成中，白天认知提交顺延；事实保留在证据队列。",
          });
          return;
        }
        useGameStateStore.setState({ state: committed });
        committedReaction = true;
        useAiStore.getState().patchDebugEntry(requestId, {
          status: "success",
          acceptedCount: response.observationIds.length,
        });
      }).catch((error) => {
        if (!controller.signal.aborted) {
          const errorText = String(error);
          const failure = daytimeFailureGuard.recordFailure(
            fingerprint,
            isAgentDaytimeSchemaError(error) ? "schema" : "other",
          );
          // Failures are isolated per fingerprint: this batch is skipped while
          // every other character's batches keep processing. The summary entry
          // only makes the accumulated count visible — it never pauses the queue.
          if (failure.summaryDue) {
            const createdAt = Date.now();
            const summaryRequestId = `agent-daytime:skip-summary:${current.time.dayIndex}:${createdAt}`;
            useAiStore.getState().addDebugEntry({
              requestId: summaryRequestId,
              createdAt,
              feature: "agent-daytime",
              gameDayIndex: current.time.dayIndex,
              status: "skipped",
              skipReason: `白天认知：已累计 ${failure.distinctSchemaFailures} 个批次因响应格式错误被跳过（队列未暂停，其他角色的批次继续处理）；这些事实保留在证据队列，新事实或提示词修正后会重试。`,
              error: errorText,
            });
          }
          useAiStore.getState().patchDebugEntry(requestId, { status: "error", error: errorText });
        }
      }).finally(() => {
        agentAsyncRequests.delete(`daytime:${requestId}`);
        if (daytimeControllers.get(charaNum) === controller) daytimeControllers.delete(charaNum);
        // Fill a free slot with another pending character. A successful
        // bounded batch may leave more than the provider cap in the queue, so
        // offer that same character again as well — whether it may actually
        // continue right now is the pacer's call, and its per-character gap
        // usually defers the follow-up to the next game-hour slot. Failed or
        // stale requests are deliberately not retried until a new fact (or a
        // later load/command) re-enters the scheduler.
        const liveAfter = useGameStateStore.getState().state;
        const hasMoreForCharacter = committedReaction
          && liveAfter !== null
          && getPendingDaytimeEvidence(liveAfter, charaNum) !== null;
        scheduleAgentDaytimeReactions([
          ...candidates.filter((id) => id !== charaNum),
          ...(hasMoreForCharacter ? [charaNum] : []),
        ]);
      });
    }
  });
}

/**
 * True while any dialogue session owns an in-flight realtime AI request.
 * The AI-first presentation contract keeps the authoritative GameState object
 * identity-stable until the streamed kojo settles (`commitProjectedSettlement`
 * checks `get().state === base`); every async sidecar commit must defer while
 * this is true or it silently cancels the stream AND drops the pending
 * command settlement. Guards skip — they never cancel the stream.
 */
function hasPendingRealtimeAi(): boolean {
  return useGameStateStore.getState().dialogueQueue.some(
    (session) => session.aiRequestId !== undefined,
  );
}

/** Keep a validated L3 result in its request owner until realtime command
 * settlement releases GameState identity. Abort/load cancels the waiter. */
function waitForNarrativeCommit(controller: AbortController): Promise<boolean> {
  if (controller.signal.aborted) return Promise.resolve(false);
  if (!hasPendingRealtimeAi()) return Promise.resolve(true);
  beginNarrativeDirectorStatus("commit", useGameStateStore.getState().narrativeDirectorStatus?.arcId);
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      unsubscribe();
      controller.signal.removeEventListener("abort", abort);
      resolve(ok);
    };
    const abort = () => finish(false);
    const unsubscribe = useGameStateStore.subscribe(() => {
      if (!hasPendingRealtimeAi()) finish(!controller.signal.aborted);
    });
    controller.signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * True while an AI-first command session defers its deterministic
 * settlement (realtime command kojo / witness kojo). Free AI chat streams
 * rebase on the live state and never qualify — the player may keep issuing
 * commands while a chat reply is pending (the pre-existing contract).
 */
function hasPendingDeferringAi(): boolean {
  return useGameStateStore.getState().dialogueQueue.some(
    (session) => session.aiRequestId !== undefined && session.aiSettlesCommand === true,
  );
}

function syncAgentFactsAndSchedule(
  state: GameState,
  relatedCharacterIds: readonly number[] = [],
): void {
  refreshStorylets(state);
  const projection = projectDaytimeAgentFacts(state, { relatedCharacterIds });
  // A related character by itself is enough to refresh deterministic story
  // readiness, but it is not a new daytime fact. Keep provider calls strictly
  // observation-driven; read/restore has its own explicit resume path below.
  if (projection.affectedCharaNums.length > 0) {
    scheduleAgentDaytimeReactions(projection.affectedCharaNums);
  }
  if (projection.affectedCharaNums.length > 0 || relatedCharacterIds.length > 0) {
    // Conditions are still evaluated by the existing deterministic chapter
    // controller. Re-run its bounded readiness pass after the state publish;
    // this never asks an LLM whether a chapter is complete.
    queueMicrotask(() => {
      const store = useGameStateStore.getState();
      // Readiness reconciliation clones GameState. Never replace the object
      // while an AI-owned dialogue session is streaming: the request's owner
      // uses identity to reject stale world updates.
      if (
        store.state !== state ||
        store.dialogueQueue.some((session) => session.aiRequestId !== undefined)
      ) return;
      scheduleNarrativeReadiness("command-settled");
    });
  }
}
// Upstream @DEFAULT_OWNER_0 assigns the player P53 (倉庫) at Hakurei Shrine,
// then marks that room as the player's private bedroom. It is not Reimu's P15.
/**
 * Rebuild the daytime sidecar after a save is loaded. Pending observation IDs
 * are persisted as part of cognition, so a load must resume those batches
 * even when no new command has fired yet; projection also catches facts that
 * were written just before the save boundary.
 */
function resumeAgentDaytimeQueue(state: GameState): void {
  const runtime = state.agentRuntime;
  if (!runtime) return;
  const candidateIds = [
    ...runtime.activeRoster,
    ...Object.keys(runtime.cognitions).map(Number),
  ];
  projectDaytimeAgentFacts(state);
  scheduleAgentDaytimeReactions(candidateIds);
}

const DEFAULT_HAKUREI_HOME = "神社:倉庫";

const CONFIGURED_CHARA_IDS = CONFIGURED_ROSTER_IDS;
function buildConfiguredChara(charaNum: number) {
  const stats = charaBundle[String(charaNum) as keyof typeof charaBundle] as CharaStatsLike;
  return buildConfiguredCharaSlot(stats);
}

/**
 * Build a fresh default `GameState` for a project. Used when the
 * IPC load returns null (first boot, or the user cleared their
 * last project).
 *
 * Phase 4 stub: hardcoded. Phase 5+ will pull the master defaults
 * from `characters.json` and the readOnlyMetadata from the 9
 * manifests. For now the renderer's purpose is to prove the
 * pipeline works end-to-end.
 */
export function buildInitialState(now: number = NOW(), draft?: NewGameDraft): GameState {
  const time: TimeSlot = {
    tickValue: 480, // 08:00 = 8*60 minutes from midnight (L2: matches schedule)
    dayIndex: 0,
    hourOfDay: 8,
    season: 1, // DAY:2 季節 = 春 (NEWGAME seed, NEWGAME.ERB:16)
    date: 1, // DAY:3 日期 = 1 (NEWGAME seed, NEWGAME.ERB:17; = 元旦)
  };
  const bootEvent: StatusMessage = {
    kind: "STATUS_MESSAGE",
    timestamp: now,
    source: "system",
    text: "ready",
  };
  const eventLog: ReadonlyArray<ObservationEvent> = [bootEvent];
  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    time,
    homeLocation: DEFAULT_HAKUREI_HOME,
    // #13 6b — 起床时间 7 点（原版 @NEWGAME:73 TIME:3=420）替代现代 8 点.
    masterWakeMinute: 420,
    master: {
      charaNum: 0,
      callName: "主人公",
      // #13 6b — 主角睡在自宅卧室. 3a/3b/4 仅写 homeLocation 字段,
      // 主角 location 仍写死居間; 6b 修这个错位, 真正落在 home.
      location: DEFAULT_HAKUREI_HOME,
      state: buildSeededMasterState(),
    },
    // Current location starts at the imported initial room. Unsupported
    // activity events do not relocate anyone.
    charas: Object.fromEntries(
      CONFIGURED_CHARA_IDS.map((charaNum) => [charaNum, buildConfiguredChara(charaNum)]),
    ),
    dynamicCharacters: {},
    nextDynamicCharaNum: 10_000,
    mobGirlMemorySession: null,
    stoneContestProgress: undefined,
    stoneContestSession: null,
    flagStore: { 3: 1 },
    dlcSavedata: {},
    tflagStore: {
      // Parity QA Wave 7: TFLAG:あなた起床 (id 216) = TIME + 1440*DAY at the
      // new-game wake (BEFORETRAIN.ERB:219). tickValue 480 = 08:00 start
      // (modern 用 8 点; #13 6b 主角睡到 7 点即醒, 但时间推进仍以 8 点 seed
      // schedule). NEMUKE() subtracts this; seeding it makes sleepiness 0 at
      // wake so the 402 就寝 (NEMUKE≥720) / 417 昼寝 (180≤NEMUKE≤720) gates
      // behave from the first turn.
      [TFLAG_ID.あなた起床]: 480,
    },
    money: 99999, // NEWGAME default 特典 (NEWGAME_BONUS.ERB:70).
    dayEventsEnabled: 1,
    // Faithful to 原版: the base NEWGAME inventory carries no instrument, so
    // 演奏する (COMF416, @MUSIC_ABLE) is correctly blocked until one is bought.
    // A starter 電子琴 (Item.csv id 30) was briefly seeded for trial
    // convenience but removed per user — instruments come from the 隙间商店
    // (gap shop) instead. perform-music.ts + its tests still pin the engine.
    items: {},
    eventLog,
    acceptedExperiences: [],
    readOnlyMetadata: mockEmptyWorldSnapshot(),
    agentRuntime: createAgentRuntimeState(),
  };
  // #13 原版开场流程 — apply the wizard draft (称呼 / 性別 / 居住地 / 扮演模式).
  // Faithful to @NEWGAME_MAKE_INIT (性別 = TALENT_ID.性別) + @SET_MAINHOME +
  // @NEWGAME_MAKE_SELECT_MODE (FLAG_ID.扮演). KojoCache enforces the matching
  // roleplay gate unless the target declares CFLAG_ID.扮演口上有. Gender goes
  // through the namespace-safe setMasterTalent accessor.
  if (draft) {
    if (draft.callName.trim().length > 0) state.master.callName = draft.callName.trim();
    setMasterTalent(state, TALENT_ID.性別, draft.gender);
    // ANATA 能力(ABL) editor (@CUSTOM_ABL) — apply each chosen level (0..2).
    for (const [id, level] of Object.entries(draft.abl)) {
      setMasterAbl(state, Number(id), level);
    }
    // ANATA 素质(性格档位) editor (@CUSTOM_TALENT, slice 3a+3b) — apply each pick.
    for (const [id, value] of Object.entries(draft.talent)) {
      setMasterTalent(state, Number(id), value);
    }
    // 性别/性器 归一化 (@CUSTOM_INIT, slice 3b) — AFTER talent write so clearing arms run.
    normalizeMasterTalentByGender(state, draft.gender);
    // `@NEWGAME_OPTION` calls `@TINKO_DECIDE` for a body with a male organ.
    // Its canonical shape result is consumed by body displays and text.
    if ((draft.gender & 2) !== 0) {
      setMasterTalent(state, TALENT_ID.形状, draft.penisShape ?? 3);
    }
    // ANATA 经验 editor (@CUSTOM_EXP, slice 4) — apply each preset pick.
    for (const [id, value] of Object.entries(draft.exp)) {
      setMasterExp(state, Number(id), value);
    }
    // 经验 性别/性器 归一化 (slice 4 顺手补) — AFTER 性格 normalize so 处女臂生效.
    normalizeMasterExpByGender(state, draft.gender);
    // ANATA 基础(体力/気力 MAXBASE) editor (@CUSTOM_BASE, slice 4) — clamp + apply.
    if (draft.maxHp !== undefined) {
      const v = Math.max(1000, Math.min(2500, draft.maxHp));
      setMasterBase(state, 0, v); // 体力
    }
    if (draft.maxMp !== undefined) {
      const v = Math.max(1000, Math.min(2500, draft.maxMp));
      setMasterBase(state, 1, v); // 気力
    }
    state.homeLocation = draft.homeLocation;
    state.flagStore[FLAG_ID.扮演] = draft.mode;
    state.flagStore[FLAG_ID.甲斐性無] = draft.noGuts ? 1 : 0;
    state.disabledKojo = { ...draft.disabledKojo };
    state.selectedKojoVariants = { ...(draft.selectedKojoVariants ?? {}) };
  }
  // A direct new game without a UI draft retains the upstream male-body
  // default: `PENIS_REFRESH` yields the ordinary shape.
  if ((getMasterTalent(state, TALENT_ID.性別) || 2) & 2) {
    setMasterTalent(state, TALENT_ID.形状, draft?.penisShape ?? 3);
  }
  state.flagStore[FLAG_ID.NEWGAME_OPTION初期化] =
    (state.flagStore[FLAG_ID.NEWGAME_OPTION初期化] ?? 0) | (1 << 1) | (1 << 2);
  addItem(state, 81, 10);
  // NEWGAME.ERB seeds the term/day forecast before the first SHOP. Keep this
  // fresh-game-only; save migration must preserve the saved weather timeline.
  seedInitialWeatherForecasts(
    state,
    createRng((state.time.tickValue + state.time.dayIndex * 31 + (state.time.season ?? 1) * 997) | 0),
  );
  // #13 6b — 主角睡在 home 卧室, 写 sleepSession + 睡眠 cflag.
  // Faithful to @NEWGAME:71-75 (各角色 初始位置 + TIME:3 = 420 +
  // SET_SLEEP(1,MASTER,0)). 起床时刻 = masterWakeMinute (7 点).
  setSlotLocation(state.master, state.homeLocation ?? DEFAULT_HAKUREI_HOME);
  state.master.homeLocation = state.homeLocation ?? DEFAULT_HAKUREI_HOME;
  state.master.state.CFLAG[CFLAG_ID.初期位置] =
    state.master.state.CFLAG[CFLAG_ID.現在位置] ?? state.master.state.CFLAG[CFLAG_ID.初期位置];
  const wake = state.masterWakeMinute ?? 420;
  state.sleepSession = {
    startedAtTick: state.time.tickValue,
    requestedWakeMinute: wake,
    forced: false,
  };
  setMasterCflag(state, CFLAG_ID.睡眠, 1);
  initializeConfiguredSchedules(state);
  // Place scheduled charas at the room their hand-authored agenda says they
  // occupy at the start tick (08:00), so 霊夢 begins in the 居間 rather than
  // her bedroom — the ambient world starts already "in motion".
  seedScheduledLocations(state);
  // Upstream does not provide a Chara CSV row for Rinnosuke. Materialize the
  // stable shopkeeper through the authored-resident compatibility seam so he
  // participates in normal same-room targeting at Kourindou.
  ensureRinnosuke(state);
  // Upstream @INIT_STARTINGLV runs once after the opening options and before
  // the first SHOP. Keep its deterministic EXP/ABL/TALENT reconciliation, but
  // discard the implementation transcript: "LVUP", "获得调合知识" and the
  // matching-progress line are setup diagnostics, not events that happened in
  // the playable world, and must not leak into the persistent scene history.
  runNewGameInitialLevelSync(state, { now: () => now });
  // Day-start NPC snapshot for the night-settlement daily report (the diff
  // baseline). Taken after the roster is built; NPC stats are untouched by the
  // master-only draft above.
  state.daySnapshot = snapshotCharaStates(state.charas);
  return state;
}

/**
 * Split an arrival event stream into `{ inline, popup }` so every arrival flow
 * surfaces first-meeting / encounter 口上 the SAME way: the地文 narration (the
 * 「X向初次见面的Y作了问候」 greeting line) stays in the scene band, and the
 * character's actual 口上 (DIALOGUE_LINE onward) is buffered into the modal
 * InteractionBox. Before this, only `walkPathAction` popped the kojo — arriving
 * via a move command or waking up left the kojo inline in the log, so it read
 * inconsistently (and looked like you had to click 对话 to see it). If there's
 * no DIALOGUE_LINE, everything stays inline (`popup` is null).
 */
export function splitArrivalKojo(events: readonly ObservationEvent[]): {
  inline: ObservationEvent[];
  popup: ObservationEvent[] | null;
} {
  const firstLine = events.findIndex((e) => e.kind === "DIALOGUE_LINE");
  if (firstLine === -1) return { inline: [...events], popup: null };
  return { inline: events.slice(0, firstLine), popup: events.slice(firstLine) };
}

function encounterSessionAvailable(
  ui: {
    dialogueQueue: readonly DialogueSession[];
    pendingPrompt: unknown | null;
  },
): boolean {
  return (
    ui.dialogueQueue.length === 0 &&
    ui.pendingPrompt === null
  );
}

function encounterChoiceSession(
  result: Pick<
    FirstMeetingsForTransitionResult,
    "pending" | "pendingCharaNum" | "pendingEventStart" | "remainingCandidateCharaNums"
    | "continuationId" | "continuationValues" | "continuationInputMode"
  >,
  transition: EncounterTransition,
  seed: number,
  transcriptPrefixLength = 0,
  resultEventOffset = 0,
): DialogueChoiceSession | null {
  if (!result.pending || result.pendingCharaNum === null) return null;
  return {
    kind: "encounter",
    charaNum: result.pendingCharaNum,
    seed,
    choices: [],
    options: [...result.pending.options],
    continuationId: result.continuationId,
    continuationValues: result.continuationValues ? [...result.continuationValues] : undefined,
    continuationInputMode: result.continuationInputMode,
    transcriptStart:
      transcriptPrefixLength +
      Math.max(0, (result.pendingEventStart ?? 0) - resultEventOffset),
    encounterContinuation: {
      kind: transition.kind,
      location: transition.location,
      candidateCharaNums: [...result.remainingCandidateCharaNums],
    },
  };
}

function delegateDialogueRouter(
  router: DialogueRouter,
  overrides: Partial<DialogueRouter>,
): DialogueRouter {
  const wrapped: DialogueRouter = {
    collect(...args) {
      return overrides.collect ? overrides.collect(...args) : router.collect(...args);
    },
    resolveEventKojo(...args) {
      return overrides.resolveEventKojo
        ? overrides.resolveEventKojo(...args)
        : router.resolveEventKojo(...args);
    },
    resolveSpEventKojo(...args) {
      return overrides.resolveSpEventKojo
        ? overrides.resolveSpEventKojo(...args)
        : router.resolveSpEventKojo(...args);
    },
  };

  const optionalKeys = [
    "collectDetailed",
    "collectInteractive",
    "collectContinuation",
    "resumeContinuation",
    "cancelContinuation",
    "resolveEventKojoDetailed",
    "resolveEventKojoInteractive",
    "resolveSpEventKojoDetailed",
    "resolveSpEventKojoInteractive",
    "resolveEncounterKojo",
    "resolveEncounterKojoDetailed",
    "resolveEncounterKojoInteractive",
    // Counter settles inside applyIntent after both interactive wrappers are
    // installed; dropping this family turns authored personal lines into the
    // optional-chain `not-authored` fallback while shared narration survives.
    "resolveCounterKojo",
    "resolveCounterKojoDetailed",
    "resolveCounterKojoInteractive",
    "getCounterKojoMetadata",
    "resolveDiaryKojo",
    "resolveDiaryKojoDetailed",
    "resolveDiaryKojoInteractive",
    "hasDiaryKojo",
    "resolveDiaryHappen",
    "resolveIraiKojo",
    "resolveIraiKojoDetailed",
    "resolveIraiBlocked",
  ] as const;

  const mutableWrapped = wrapped as unknown as Record<string, unknown>;
  for (const key of optionalKeys) {
    const override = overrides[key] as ((...args: unknown[]) => unknown) | undefined;
    const base = router[key] as ((...args: unknown[]) => unknown) | undefined;
    if (override) {
      mutableWrapped[key] = (...args: unknown[]) => override(...args);
    } else if (base) {
      mutableWrapped[key] = (...args: unknown[]) => base.apply(router, args);
    }
  }

  return wrapped;
}

function createInteractiveDayEventRouter(
  router: DialogueRouter | undefined,
  onPending: (session: {
    charaNum: number;
    subid: number;
    args?: number[];
    pending: PendingKojoChoice;
  }) => void,
): DialogueRouter | undefined {
  if (!router?.resolveSpEventKojoInteractive) return router;
  return delegateDialogueRouter(router, {
    resolveSpEventKojo(
      charaNum: number,
      subid: number,
      state: Readonly<GameState>,
      rng: Parameters<DialogueRouter["resolveSpEventKojo"]>[3],
      args: Parameters<DialogueRouter["resolveSpEventKojo"]>[4],
    ): KojoLine[] {
      const r = router.resolveSpEventKojoInteractive!(
        charaNum,
        subid,
        state,
        rng,
        args,
        [],
      );
      if (r.pending) {
        onPending({
          charaNum,
          subid,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
  });
}

type EventKojoPendingCapture =
  | {
      kind: "event";
      charaNum: number;
      arm: number;
      args?: number[];
      pending: PendingKojoChoice;
    }
  | {
      kind: "diary";
      charaNum: number;
      page: number;
      args?: number[];
      pending: PendingKojoChoice;
    };

function createInteractiveEventRouter(
  router: DialogueRouter | undefined,
  onPending: (session: EventKojoPendingCapture) => void,
): DialogueRouter | undefined {
  if (!router?.resolveEventKojoInteractive && !router?.resolveDiaryKojoInteractive) return router;
  return delegateDialogueRouter(router, {
    resolveEventKojo(
      charaNum: number,
      arm: number,
      state: Readonly<GameState>,
      rng: Parameters<DialogueRouter["resolveEventKojo"]>[3],
      args: Parameters<DialogueRouter["resolveEventKojo"]>[4],
    ): KojoLine[] {
      if (!router.resolveEventKojoInteractive) {
        return router.resolveEventKojo(charaNum, arm, state, rng, args);
      }
      const r = router.resolveEventKojoInteractive(charaNum, arm, state, rng, args, []);
      if (r.pending) {
        onPending({
          kind: "event",
          charaNum,
          arm,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
    resolveDiaryKojo(
      charaNum: number,
      page: number,
      state: Readonly<GameState>,
      rng: Parameters<NonNullable<DialogueRouter["resolveDiaryKojo"]>>[3],
      args: Parameters<NonNullable<DialogueRouter["resolveDiaryKojo"]>>[4],
    ): KojoLine[] {
      if (!router.resolveDiaryKojo) return [];
      if (!router.resolveDiaryKojoInteractive) {
        return router.resolveDiaryKojo(charaNum, page, state, rng, args);
      }
      const r = router.resolveDiaryKojoInteractive(charaNum, page, state, rng, args, []);
      if (r.pending) {
        onPending({
          kind: "diary",
          charaNum,
          page,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
  });
}

function kojoLinesToEvents(
  lines: readonly KojoLine[],
  charaNum: number,
): ObservationEvent[] {
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: NOW(),
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

let dialogueSessionSerial = 0;

function nextDialogueSessionId(owner: DialogueSessionOwner): string {
  dialogueSessionSerial += 1;
  return `${owner}:${dialogueSessionSerial}`;
}

function firstDialogueIndex(events: readonly ObservationEvent[]): number {
  const index = events.findIndex((event) => event.kind === "DIALOGUE_LINE");
  return index === -1 ? events.length : index;
}

interface DialogueUiSnapshot {
  dialogueQueue: readonly DialogueSession[];
  state?: Pick<GameState, "time"> | null;
}

function cancelNarrativeDirector(reason = "cancelled"): void {
  narrativeGeneration += 1;
  narrativeController?.abort(reason);
  narrativeController = null;
  clearAgentAsyncRequests("narrative");
  useGameStateStore.setState({ narrativeDirectorStatus: null });
  // A load/new-game invalidates the session-level window-handoff throttle:
  // the new state has its own arcs, ticks, and day indexes.
  if (reason === "load" || reason === "restore" || reason === "new game" || reason === "reset") {
    arcWindowDirectorAttempts.clear();
  }
  if (reason !== "new narrative request" && reason !== "situation chosen") {
    narrativeReadinessEpoch += 1;
    narrativeReadinessAfterDialogue = null;
    narrativeAutomaticMenuCleanupId = null;
    narrativeReadinessAfterDirector = false;
    if (arcWindowDirectorRetryTimer !== null) clearTimeout(arcWindowDirectorRetryTimer);
    arcWindowDirectorRetryTimer = null;
    arcWindowDirectorRetryAt = null;
  }
}

function releaseNarrativeDirector(controller: AbortController): void {
  if (narrativeController !== controller) return;
  narrativeController = null;
  endNarrativeDirectorStatus(controller);
  if (narrativeReadinessAfterDirector) {
    narrativeReadinessAfterDirector = false;
    scheduleNarrativeReadiness("command-settled");
  }
}

type NarrativeDirectorPhase = NonNullable<GameStateStore["narrativeDirectorStatus"]>["phase"];

/** Begin an L3 provider phase in the UI-visible status mirror. */
function beginNarrativeDirectorStatus(
  phase: NarrativeDirectorPhase,
  arcId?: string,
): void {
  const state = useGameStateStore.getState().state;
  useGameStateStore.setState({
    narrativeDirectorStatus: { phase, ...(arcId ? { arcId } : {}), startedTick: state?.time.tickValue ?? 0 },
  });
}

/** Clear the status mirror. Callers already guard on `narrativeController ===
 * controller`, so a superseded request can never clear a newer one's status. */
function endNarrativeDirectorStatus(_controller: AbortController): void {
  useGameStateStore.setState({ narrativeDirectorStatus: null });
}

/** L3 produced nothing and, from the outside, nobody can tell why. Record the
 * gate that stopped it the same way lazy materialization records `skipReason`.
 *
 * Some of these call sites are per-command hooks, so the log records a blocker
 * when it appears or changes rather than once per command; `clearNarrativeSkip`
 * forgets the last reason as soon as a story actually moves. */
let lastNarrativeSkipReason: string | null = null;

function recordNarrativeSkip(reason: string): void {
  if (lastNarrativeSkipReason === reason) return;
  lastNarrativeSkipReason = reason;
  const state = useGameStateStore.getState().state;
  useAiStore.getState().addDebugEntry({
    requestId: `narrative-skip:${state?.time.tickValue ?? 0}:${reason}`,
    createdAt: Date.now(),
    feature: "narrative-director",
    status: "skipped",
    skipReason: reason,
    ...(state ? { gameDayIndex: state.time.dayIndex, gameTick: state.time.tickValue } : {}),
  });
}

function clearNarrativeSkip(): void {
  lastNarrativeSkipReason = null;
}

/** Every ended request must leave a visible terminal outcome, including stale
 * owner/commit refusals that return before the normal success/error patch. */
function finishNarrativeDiagnostics(requestId: string, startedAt: number): void {
  const ai = useAiStore.getState();
  if (ai.debugEntries.find(entry => entry.requestId === requestId)?.status !== "pending") return;
  ai.patchDebugEntry(requestId, {
    status: "cancelled",
    durationMs: Date.now() - startedAt,
    skipReason: "请求已结束但结果未提交：请求被取消、上下文已变化或提交条件不再满足",
  });
}

// Completion signals resume a waiting handoff even after a long kojo or L3
// request. Epochs keep queued callbacks from acting on another loaded save.
let narrativeReadinessEpoch = 0;
let narrativeReadinessScheduledEpoch: number | null = null;
let narrativeReadinessAfterDialogue: NarrativeReadyTrigger | null = null;
let narrativeAutomaticMenuCleanupId: string | null = null;
let narrativeReadinessAfterDirector = false;

/** The only situation where a handoff blocker is worth reporting. An empty
 * director is the normal state, so logging anything else fills the debug log
 * during ordinary play — the same rule `explainWaitingStory` follows. */
function hasOpenInteractionWindow(state: GameState): boolean {
  const now = state.time.tickValue;
  return (state.storyArcs ?? []).some((arc) => {
    if (arc.status !== "active" || now > arc.deadlineTick) return false;
    const chance = arc.maintenance?.nextChance;
    return chance != null && chance.earliestTick <= now && now <= chance.latestTick;
  });
}

function reportWindowBlocker(state: GameState, reason: string): void {
  if (hasOpenInteractionWindow(state)) recordNarrativeSkip(reason);
}

/** Why a story that is already waiting cannot present itself right now.
 *
 * An empty director is the normal state, so nothing is recorded unless an event
 * is genuinely queued; otherwise the debug log would fill up during ordinary
 * play. Returns null when there is nothing to explain. */
function explainWaitingStory(state: GameState): string | null {
  const waiting = (state.narrativeEvents ?? [])
    .filter((entry) => entry.status === "scheduled" || entry.status === "ready");
  if (waiting.length === 0) return null;
  if (deterministicForegroundConflict(state)) return "确定性前台事件冲突，叙事窗口已顺延";
  if (useGameStateStore.getState().dialogueQueue.length > 0) return "确定性对话占用前台";
  const now = state.time.tickValue;
  const next = waiting
    .filter((entry) => entry.status === "scheduled" && entry.windowStartTick > now)
    .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id))[0];
  if (next) return `叙事窗口尚未到达（还差 ${next.windowStartTick - now}）`;
  return null;
}

/** Names every switch that is off, instead of one anonymous `return false`. */
function narrativeGateReason(settings: AiSettings, masterEnabled: boolean): string | null {
  const closed: string[] = [];
  if (!settings.enabled) closed.push("AI 总开关关闭");
  if (!settings.narrativeEnabled) closed.push("L3 叙事导演关闭");
  if (!settings.apiKey.trim()) closed.push("缺少 API key");
  if (!masterEnabled) closed.push("Agent Runtime 关闭");
  return closed.length > 0 ? closed.join("、") : null;
}

function cancelStoryRequests(): void {
  storyGeneration += 1;
  storyController?.abort();
  storyController = null;
}

function storyChoiceSession(
  prompt: StoryChoicePrompt,
  programId: string,
  actorId: number,
  transcriptStart: number,
): DialogueChoiceSession {
  return {
    kind: "story",
    charaNum: actorId,
    seed: 0,
    choices: prompt.options.map((_, index) => index),
    options: prompt.options.map(({ label }) => ({ label })),
    storyProgramId: programId,
    storyBeatId: prompt.beatId,
    storyChoiceIds: prompt.options.map(({ id }) => id),
    transcriptStart,
  };
}

interface DialogueEnqueueRequest {
  id?: string;
  owner: DialogueSessionOwner;
  transcript: readonly ObservationEvent[] | null;
  choice?: DialogueChoiceSession | null;
  aiRequestId?: string;
  aiCharaNum?: number;
  /** Mirror of `DialogueSession.aiSettlesCommand` — see dialogue-session.ts. */
  aiSettlesCommand?: boolean;
  dayIndex?: number;
}

function dialogueQueueMirrors(queue: readonly DialogueSession[]) {
  const active = queue[0] ?? null;
  return {
    dialogueQueue: [...queue],
    pendingArrivalEvents: active ? [...active.transcript] : null,
    pendingKojoChoice: active?.choice ?? null,
  };
}

/** VM continuations are live call stacks, not save data. Cancel every stack
 * owned by a dialogue queue before that queue is discarded or made stale. */
function cancelVmDialogueContinuations(queue: readonly DialogueSession[]): void {
  const router = currentIntentDeps().router;
  for (const session of queue) {
    const continuationId = session.choice?.continuationId;
    if (continuationId) router?.cancelContinuation?.(continuationId);
  }
}

function cancelDialogueSessions(queue: readonly DialogueSession[]): void {
  cancelVmDialogueContinuations(queue);
  for (const session of queue) {
    if (session.aiRequestId) cancelRealtimeAiKojo(session.aiRequestId);
  }
}

/**
 * AI-first settlement deferral for one command. `base` is the pre-command
 * authoritative state the streaming request's owner checks against; the
 * deterministic `projected` result publishes only when the world has not
 * moved on (`get().state === base`), together with the final AI transcript.
 * Idempotent: whichever of publish/failure path reaches it first wins.
 */
interface DeferredSettlement {
  readonly state: GameState;
  replaceState(state: GameState): void;
  publish(replacedKeys?: readonly string[]): void;
}

function createDeferredSettlement(base: GameState, projected: GameState, hookOwner?: { actor: number; sessionId: string }): DeferredSettlement {
  let settlementCommitted = false;
  const lease = hookOwner ? createNarrativeDialogueLease(base, hookOwner.actor) : null;
  return {
    get state() { return projected; },
    replaceState(state) { if (!settlementCommitted) projected = state; },
    publish(replacedKeys: readonly string[] = []): void {
      if (settlementCommitted) return;
      settlementCommitted = true;
      // A load/reset replaces the state object and cancels AI. Never let an
      // obsolete request overwrite that newer authoritative state.
      const live = useGameStateStore.getState();
      const rebased = lease && live.state && (live.state === base || live.dialogueQueue.some(s => s.id === hookOwner!.sessionId))
        ? lease.merge(projected, live.state) : null;
      if (!lease && live.state === base || rebased) {
        useGameStateStore.setState((ui) => ({
          state: rebased ?? projected,
          error: null,
          ...(replacedKeys.length > 0
            ? { replacedAuthorLineKeys: [...ui.replacedAuthorLineKeys, ...replacedKeys].slice(-80) }
            : {}),
        }));
        scheduleNarrativeReadiness("command-settled");
      }
    },
  };
}

/**
 * Stream one realtime AI kojo into its owner-bound dialogue session —
 * the shared presentation contract of the command AI path: parseable
 * partial lines publish immediately, the final validated lines publish
 * atomically with the deferred deterministic settlement, and a failure
 * restores the authored fallback transcript (or removes an empty session)
 * and still settles. `baseState` must be the state identity the prepared
 * request was built against.
 */
function streamAiIntoSession(params: {
  prepared: PreparedAiKojoRequest;
  baseState: GameState;
  /** Authored transcript restored when the final strict validation fails. */
  fallbackTranscript: readonly ObservationEvent[];
  /** Deterministic events appended under the final AI lines. */
  settlementEvents: readonly ObservationEvent[];
  settlement: DeferredSettlement;
  onFinalized?: () => void;
  onFailed?: () => void;
}): void {
  const { prepared, baseState, fallbackTranscript, settlementEvents, settlement } = params;
  let hookResult: unknown;
  let storyProgress: unknown;
  let storyChoiceGrant: DialogueSession["storyChoiceGrant"];
  const lease = prepared.hookGrant ? createNarrativeDialogueLease(baseState, prepared.target) : null;
  const hookContext = prepared.hookGrant ? memoryPublicationContext(baseState, prepared.target) : null;
  const ownsHookRequest = () => lease?.accepts(useGameStateStore.getState().state) === true
    && memoryPublicationContext(useGameStateStore.getState().state!, prepared.target) === hookContext
    && currentAiSettings().enabled && currentAiCharacterProfile(prepared.target).enabled
    && useGameStateStore.getState().dialogueQueue[0]?.id === prepared.sessionId
    && useGameStateStore.getState().dialogueQueue[0]?.aiRequestId === prepared.requestId;
  const successfulPresentationEvents = prepared.presentationMode === "replace-authored"
    ? settlementEvents.filter((event) => event.kind !== "DIALOGUE_LINE")
    : settlementEvents;
  const replaceStreamingAiLines = (
    lines: ReadonlyArray<AiGeneratedLine>,
    pending: boolean,
    includeSettlement = false,
  ): void => {
    const ui = useGameStateStore.getState();
    if (ui.state !== baseState && !lease?.accepts(ui.state)) {
      cancelRealtimeAiKojo(prepared.requestId);
      return;
    }
    const index = ui.dialogueQueue.findIndex(
      (session) => session.id === prepared.sessionId &&
        session.aiRequestId === prepared.requestId,
    );
    if (index === -1) {
      console.warn("[AI-KOJO] reply dropped: session gone from queue", {
        wantId: prepared.sessionId,
        queue: useGameStateStore.getState().dialogueQueue.map((s) => ({ id: s.id, owner: s.owner, aiRequestId: s.aiRequestId })),
      });
      return; // Session was closed; never attach late text elsewhere.
    }
    const transcript: ObservationEvent[] = [
      ...lines.map((line) => ({
        kind: "DIALOGUE_LINE" as const,
        timestamp: NOW(),
        charaNum: prepared.target,
        text: line.text,
        form: line.form,
        origin: "ai" as const,
        ...(line.aiChoice ? { aiChoice: line.aiChoice } : {}),
      })),
      ...(includeSettlement ? successfulPresentationEvents : []),
    ];
    const queue = ui.dialogueQueue.map((session, sessionIndex) =>
      sessionIndex === index
        ? {
            ...session,
            transcript,
            aiRequestId: pending ? prepared.requestId : undefined,
            storyChoiceGrant: pending ? undefined : storyChoiceGrant,
          }
        : session);
    useGameStateStore.setState(dialogueQueueMirrors(queue));
  };
  // Minimal mode also receives parseable partial lines immediately. The
  // owner-bound session remains pending until strict final validation and
  // deterministic settlement complete.
  void generateRealtimeAiKojo(
    prepared,
    (partialLines) => replaceStreamingAiLines(partialLines, true),
    undefined,
    undefined,
    (result) => { hookResult = result; },
    (result) => { storyProgress = result; },
  )
    .then(async (lines) => {
      let finalLines = lines;
      const ownsRequest = () => useGameStateStore.getState().state === baseState
        && useGameStateStore.getState().dialogueQueue.some(session => session.id === prepared.sessionId && session.aiRequestId === prepared.requestId);
      const actionsEnabled = () => currentAiSettings().enabled && currentAiSettings().dialogueActionsEnabled === true
        && currentAiCharacterProfile(prepared.target).enabled;
      const input = prepared.sessionId.startsWith("command:")
        && !prepared.hookGrant
        && (!prepared.feature || prepared.feature === "command-kojo")
        && prepared.settings.dialogueActionsEnabled && ownsRequest() && actionsEnabled()
        ? prepareDialogueActionInput(settlement.state, prepared.target, prepared.requestId,
          commandLabel(prepared.commandNo), lines.map(line => line.text).join("\n")) : null;
      if (input) {
        replaceStreamingAiLines(lines, true);
        const started = Date.now();
        const proposal = await judgeRealtimeDialogueAction(input, prepared.settings);
        if (ownsRequest() && actionsEnabled()) {
          const result = settleDialogueAction(settlement.state, input, proposal);
          useAiStore.getState().patchDebugEntry(prepared.requestId, { dialogueActionResult: { result: result.result,
            action: proposal && typeof proposal === "object" ? (proposal as { action?: unknown }).action : null,
            route: "command-kojo", target: prepared.target, durationMs: Date.now() - started } });
          if (result.result === "accepted") settlement.replaceState(result.state);
        }
      }
      console.log("[AI-KOJO] resolved", lines.length, "lines, queue:", useGameStateStore.getState().dialogueQueue.map((s) => s.id).join(","));
      if (prepared.hookGrant) {
        const candidate = await trackMemoryCommit(prepareHookPublication({ state: settlement.state, prepared, lines,
          result: hookResult, isCurrent: ownsHookRequest }));
        if (!candidate) {
          const current = useGameStateStore.getState();
          const queue = current.dialogueQueue.map(session => session.id === prepared.sessionId && session.aiRequestId === prepared.requestId
            ? { ...session, transcript: [...fallbackTranscript], aiRequestId: undefined } : session);
          useGameStateStore.setState(dialogueQueueMirrors(queue));
          settlement.publish(); return;
        }
        syncAgentFactsAndSchedule(candidate, [prepared.target]);
        settlement.replaceState(candidate);
        const choice = hookReplyChoice(candidate, prepared.sessionId);
        if (choice) finalLines = lines.map((line, index) => ({ ...line, aiChoice: index === lines.length - 1 ? choice : undefined }));
      }
      if (currentAiSettings().enabled && currentAiSettings().narrativeEnabled && currentAiCharacterProfile(prepared.target).enabled && prepared.storyGrants?.length) {
        recordStoryInteraction(settlement.state, { id: prepared.requestId, sessionId: prepared.sessionId,
          speakerId: prepared.target, commandNo: prepared.commandNo, lines,
          grants: prepared.storyGrants, signals: storyProgress, origin: prepared.storyEvidenceOrigin });
      }
      const boundChoice = bindStoryChoice(settlement.state, prepared, finalLines);
      storyChoiceGrant = boundChoice.grant;
      replaceStreamingAiLines(boundChoice.lines, false, true);
      // The AI replace and deterministic settlement publish atomically:
      // minimal/immersive surfaces never get an intermediate render where
      // both the authored and generated versions are visible.
      const replacedKeys = lines.length > 0 && prepared.presentationMode === "replace-authored"
        ? settlementEvents
          .filter((event) => event.kind === "DIALOGUE_LINE" && event.origin !== "ai")
          .map((event) => eventInstanceKey(event))
        : [];
      settlement.publish(replacedKeys);
      params.onFinalized?.();
    })
    .catch(async (error) => {
      // A provisional stream is presentation-only. If the final strict
      // validator rejects it, remove it, restore the complete authored
      // transcript (including replacement-mode reference lines), publish
      // deterministic output, and settle the already-computed result.
      let restoredTranscript = fallbackTranscript;
      if (prepared.hookGrant && ownsHookRequest()) {
        const h = settlement.state.narrativeHooks?.find(h => h.id === prepared.hookGrant!.hookId);
        if (!h?.fallback) {
          const candidate = cloneGameState(settlement.state);
          if (deferUnprocessedProgramHook(candidate, prepared.hookGrant, "本次剧情对话生成失败")) settlement.replaceState(candidate);
        }
        if (h?.fallback) {
          const fallbackLines = h.fallback.map(text => ({ text, form: "PRINTFORML" as const }));
          try {
            const candidate = await trackMemoryCommit(prepareHookPublication({ state: settlement.state, prepared,
              lines: fallbackLines, result: { hookId: h.id, revision: h.revision, disposition: "raise",
                lineIds: fallbackLines.map((_, index) => `reply:${index}`) }, isCurrent: ownsHookRequest }));
            if (candidate) {
              syncAgentFactsAndSchedule(candidate, [prepared.target]);
              settlement.replaceState(candidate);
              const choice = hookReplyChoice(candidate, prepared.sessionId);
              restoredTranscript = [...fallbackLines.map((line, index) => ({ kind: "DIALOGUE_LINE" as const,
                timestamp: NOW(), charaNum: prepared.target, text: line.text, form: line.form,
                ...(choice && index === fallbackLines.length - 1 ? { aiChoice: choice } : {}) })), ...fallbackTranscript];
            }
          } catch (archiveError) {
            useAiStore.getState().patchDebugEntry(prepared.requestId, { status: "error", error: String(archiveError) });
          }
        }
        useAiStore.getState().patchDebugEntry(prepared.requestId, { status: "error", error: String(error) });
      }
      const ui = useGameStateStore.getState();
      const index = ui.dialogueQueue.findIndex(
        (session) => session.id === prepared.sessionId &&
          session.aiRequestId === prepared.requestId,
      );
      if (index !== -1) {
        const queue = restoredTranscript.length === 0
          ? ui.dialogueQueue.filter((_, sessionIndex) => sessionIndex !== index)
          : ui.dialogueQueue.map((session, sessionIndex) =>
              sessionIndex === index
                ? { ...session, transcript: [...restoredTranscript], aiRequestId: undefined }
                : session);
        useGameStateStore.setState(dialogueQueueMirrors(queue));
      }
      settlement.publish();
      params.onFailed?.();
    });
}

/** The AI-first queue-head request for a prepared realtime kojo. */
function commandAiSessionRequest(prepared: PreparedAiKojoRequest): DialogueEnqueueRequest {
  return {
    id: prepared.sessionId,
    owner: "command",
    // AI-first presentation: keep deterministic output projected but
    // undisplayed until this request finishes or fails.
    transcript: [],
    aiRequestId: prepared.requestId,
    aiCharaNum: prepared.target,
    aiSettlesCommand: true,
  };
}

function currentDialogueDayIndex(
  ui: DialogueUiSnapshot,
  explicitDayIndex?: number,
): number | undefined {
  return explicitDayIndex ?? ui.state?.time.dayIndex;
}

function enqueueDialoguePatch(
  ui: DialogueUiSnapshot,
  owner: DialogueSessionOwner,
  transcript: readonly ObservationEvent[] | null,
  choice: DialogueChoiceSession | null = null,
  dayIndex?: number,
) {
  return enqueueDialogueRequestsPatch(ui, [{ owner, transcript, choice, dayIndex }], dayIndex);
}

function enqueueDialogueRequestsPatch(
  ui: DialogueUiSnapshot,
  requests: readonly DialogueEnqueueRequest[],
  explicitDayIndex?: number,
) {
  const dayIndex = currentDialogueDayIndex(ui, explicitDayIndex);
  const stale = dayIndex === undefined
    ? []
    : ui.dialogueQueue.filter((session) =>
        session.dayIndex !== undefined && session.dayIndex !== dayIndex);
  if (stale.length > 0) cancelDialogueSessions(stale);
  let queue = ui.dialogueQueue.filter((session) => !stale.includes(session));
  for (const request of requests) {
    const choice = request.choice ?? null;
    if (
      (!request.transcript || request.transcript.length === 0) &&
      choice === null &&
      request.aiRequestId === undefined
    ) {
      continue;
    }
    const session: DialogueSession = {
      id: request.id ?? nextDialogueSessionId(request.owner),
      owner: request.owner,
      priority: DIALOGUE_SESSION_PRIORITY[request.owner],
      interruptible: false,
      transcript: request.transcript ? [...request.transcript] : [],
      choice,
      ...(request.dayIndex ?? dayIndex) !== undefined
        ? { dayIndex: request.dayIndex ?? dayIndex }
        : {},
      ...(request.aiRequestId ? { aiRequestId: request.aiRequestId } : {}),
      ...(request.aiCharaNum !== undefined ? { aiCharaNum: request.aiCharaNum } : {}),
      ...(request.aiSettlesCommand ? { aiSettlesCommand: true } : {}),
    };
    queue = enqueueDialogueSession(queue, session);
  }
  return queue.length === ui.dialogueQueue.length &&
    queue.every((session, index) => session === ui.dialogueQueue[index])
    ? {}
    : dialogueQueueMirrors(queue);
}

function resolveTransitionDialogues(
  state: GameState,
  transitions: readonly DomainTransition[],
  router: DialogueRouter,
  seed: number,
): { state: GameState; requests: DialogueEnqueueRequest[] } {
  let next = state;
  const requests: DialogueEnqueueRequest[] = [];
  let index = 0;
  for (const transition of transitions) {
    const resolved = resolveDomainTransitionDialogue(next, transition, {
      router,
      rng: createRng(seed + index * 104729),
      now: NOW,
    });
    index += 1;
    next = resolved.state;
    if (resolved.events.length === 0) continue;
    next = {
      ...next,
      eventLog: [...next.eventLog, ...resolved.events],
    };
    requests.push({
      owner:
        transition.kind === "rebellion-mark-acquired" ||
        transition.kind === "mark-acquired"
          ? "mark"
          : "state",
      transcript: resolved.events,
    });
  }
  return { state: next, requests };
}

function replaceActiveDialoguePatch(
  ui: DialogueUiSnapshot,
  transcript: readonly ObservationEvent[],
  choice: DialogueChoiceSession | null,
) {
  return dialogueQueueMirrors(
    replaceActiveDialogueSession(ui.dialogueQueue, transcript, choice),
  );
}

function advanceDialoguePatch(ui: DialogueUiSnapshot) {
  return dialogueQueueMirrors(advanceDialogueSession(ui.dialogueQueue));
}

/** Finish an interactive command route through the same owner-bound L1
 * presentation path as a non-interactive command. The deterministic command
 * was already settled before the authored kojo paused; only kojo effects and
 * presentation are committed here. */
function startResolvedCommandChoiceAi(
  prepared: PreparedAiKojoRequest,
  settledState: GameState,
  authoredEvents: readonly ObservationEvent[],
): boolean {
  const ui = useGameStateStore.getState();
  const active = ui.dialogueQueue[0];
  if (!active || active.owner !== "command") return false;
  const bound = { ...prepared, sessionId: active.id };
  const retainedEvents = bound.presentationMode === "replace-authored"
    ? authoredEvents.filter((event) => event.kind !== "DIALOGUE_LINE")
    : [...authoredEvents];
  const pendingQueue = replaceActiveDialogueSession(ui.dialogueQueue, [], null).map((session, index) =>
    index === 0
      ? { ...session, aiRequestId: bound.requestId, aiCharaNum: bound.target }
      : session);
  useGameStateStore.setState({ state: settledState, ...dialogueQueueMirrors(pendingQueue), error: null });

  const replaceLines = (lines: readonly AiGeneratedLine[], pending: boolean, includeRetained = false): void => {
    const live = useGameStateStore.getState();
    if (live.state !== settledState) {
      // The deterministic settlement was superseded (load/reset/new command).
      // Do not let a late L1 response repaint a newer world state.
      cancelRealtimeAiKojo(bound.requestId);
      return;
    }
    const index = live.dialogueQueue.findIndex(
      (session) => session.id === bound.sessionId && session.aiRequestId === bound.requestId,
    );
    if (index === -1) return;
    const transcript: ObservationEvent[] = [
      ...lines.map((line) => ({
        kind: "DIALOGUE_LINE" as const,
        timestamp: NOW(),
        charaNum: bound.target,
        text: line.text,
        form: line.form,
        origin: "ai" as const,
        ...(line.aiChoice ? { aiChoice: line.aiChoice } : {}),
      })),
      ...(includeRetained ? retainedEvents : []),
    ];
    const queue = live.dialogueQueue.map((session, sessionIndex) =>
      sessionIndex === index
        ? { ...session, transcript, aiRequestId: pending ? bound.requestId : undefined }
        : session);
    useGameStateStore.setState(dialogueQueueMirrors(queue));
  };

  void generateRealtimeAiKojo(bound, (lines) => replaceLines(lines, true))
    .then((lines) => {
      replaceLines(lines, false, true);
      if (lines.length > 0 && bound.presentationMode === "replace-authored") {
        useGameStateStore.setState((live) => ({
          replacedAuthorLineKeys: [
            ...live.replacedAuthorLineKeys,
            ...authoredEvents
              .filter((event) => event.kind === "DIALOGUE_LINE" && event.origin !== "ai")
              .map((event) => eventInstanceKey(event)),
          ].slice(-80),
        }));
      }
    })
    .catch(() => {
      const live = useGameStateStore.getState();
      const index = live.dialogueQueue.findIndex(
        (session) => session.id === bound.sessionId && session.aiRequestId === bound.requestId,
      );
      if (index === -1) return;
      const queue = live.dialogueQueue.map((session, sessionIndex) =>
        sessionIndex === index
          ? { ...session, transcript: [...authoredEvents], aiRequestId: undefined }
          : session);
      useGameStateStore.setState(dialogueQueueMirrors(queue));
    });
  return true;
}

interface GameStateStore {
  state: GameState | null;
  loading: boolean;
  error: string | null;
  lastSavedAt: number | null;
  saveSlots: SlotInfo[] | null;
  /** Typed owner-aware FIFO. The first entry is the active InteractionBox. */
  dialogueQueue: DialogueSession[];
  /** Compatibility projection of `dialogueQueue[0].transcript`. */
  pendingArrivalEvents: ObservationEvent[] | null;
  /** P2-02 — the dedicated 家庭菜園 (kitchen garden) surface is open. The
   *  FarmScreen stays mounted across multiple per-plot actions (water /
   *  harvest / plant / fertilize / uproot / harvest-all) and only closes
   *  when the player picks the explicit 退出 button. Toggled by the
   *  GameClient when a COM418 intent fires in a PLACE_GARDEN room, and by
   *  FarmScreen when the player exits. Cleared on load / newGame. */
  farmScreenOpen: boolean;
  /** B9 prompt queued by applyIntentAction when a command has a PromptSpec
   *  but the intent carries no promptAnswer. The GameClient renders the
   *  corresponding menu; on pick it calls resolvePromptAnswer which re-issues
   *  the intent WITH the answer. Cleared on cancel / load / newGame. */
  pendingPrompt: {
    spec: PromptSpec;
    commandNo: number;
    target: number;
    /** Ephemeral selections for a HandlerEntry.stagedPrompt session. */
    selections?: readonly (number | string)[];
    staged?: boolean;
  } | null;
  /** Mid-kojo player choice paused (KOJO-CHOICE-PLAN P3). When a first-meeting
   *  ENCOUNTER kojo contains a `PRINTBUTTON`+`INPUT`+`SELECTCASE RESULT(S)`
   *  option, the run stops here until the player picks. The option labels
   *  live here so the UI can render buttons; `seed` is the same RNG seed
   *  used at the original encounter call so resume replays are stable.
   *  Cleared on resolve / load. */
  pendingKojoChoice: DialogueChoiceSession | null;
  /** 问题1 — per-instance keys of author DIALOGUE_LINEs whose realtime AI replace
   *  (fullAiKojo replace-authored) SUCCEEDED for their command batch. The
   *  deterministic eventLog keeps the author lines (creator audit), but the
   *  player-facing immersive history hides them in favour of the AI lines.
   *  Presentation-only, never persisted; capped; cleared on load/restore/
   *  newGame/reset. */
  replacedAuthorLineKeys: readonly string[];
  /** P2-02 — toggle the dedicated farm surface. GameClient sets this when a
   *  COM418 intent arrives in a garden room; FarmScreen sets it back to
   *  false when the player exits. The store never sets it autonomously. */
  setFarmScreenOpen: (open: boolean) => void;

  /** Live progress of the nightly AI barrier (character reflections / diaries
   *  / plans plus automatic L3), surfaced for the 起床前主菜单 waiting screen.
   *  Day-break (openEyes) waits for the whole barrier to settle via
   *  `awaitNightCycle` instead of truncating it. null = no cycle running
   *  (AI off, not launched yet, or already settled). */
  nightCycleStatus: {
    running: boolean;
    dayIndex: number;
    phase: AgentNightPhase;
    entries: readonly AgentNightCharaProgress[];
  } | null;
  /** What the L3 narrative director is doing right now (a provider request in
   * flight). Volatile mirror of the module-level `narrativeController`, which
   * the UI cannot read — same precedent as `nightCycleStatus`. null = no
   * request in flight; blocked/awaiting states stay in the AI debug entries
   * (recordNarrativeSkip) and are derived by `narrative-status.ts`. */
  narrativeDirectorStatus: {
    phase: "evolution" | "situations" | "opening" | "graph" | "validating" | "continuation" | "expression" | "commit";
    arcId?: string;
    startedTick: number;
  } | null;
  /** Resolve when the current nightly Agent/L3 barrier has settled (commit,
   *  failure or cancellation), or immediately when none is running. Never
   *  rejects. The openEyes handler awaits this so day-break no longer
   *  discards the night's reflections. */
  awaitNightCycle: () => Promise<void>;
  /** 「不再等待」escape hatch — cancel the running night barrier (discards
   *  its results, exactly like the pre-wait openEyes behaviour) and ungate
   *  the morning menu. The morning-menu status block only offers this
   *  after the wait has exceeded ~30s. */
  abandonNightCycleAction: () => void;

  /** Fetch the persisted state from Rust. On null, build a fresh one. */
  load: (projectRoot: string) => Promise<void>;
  /** Restore an existing manual save. On null, keep the current state. */
  restore: (projectRoot: string, slot?: SaveSlot) => Promise<boolean>;
  /**
   * Persist the current state to Rust. If the current agent-night sidecar is
   * still generating diaries, wait for its commit before taking the snapshot
   * so a manual save cannot capture the pre-diary state. No-op if state is
   * null.
   */
  save: (projectRoot: string, slot?: SaveSlot) => Promise<boolean>;
  /** Refresh SAVE/LOAD slot metadata for the current project/save key. */
  refreshSaveSlots: (projectRoot: string) => Promise<void>;
  /** Apply an intent to the current state. No-op if state is null. */
  applyIntentAction: (intent: AgentIntent) => void;
  /** Free AI chat turn. With every AI tier enabled, the model may select one
   * runtime-authored action offer which is revalidated before settlement. */
  startAiChatAction: (target: number, semantic: string) => boolean;
  respondDialogueAccompanyAction: (target: number, requestId: string, response: "accept" | "reject" | "cancel") => boolean;
  /** Advance one stop of an accepted NPC-led date. UI repeats this action
   * while autoAdvance remains enabled; the normal return command interrupts. */
  advancePartnerLedDateAction: () => boolean;
  /** Append a picked AI branch to the same player-anchored episode. */
  appendAiChatBranchAction: (sessionId: string, choiceLabel: string, lines: readonly ObservationEvent[]) => Promise<boolean>;
  /** Start the dedicated full-screen battle surface after the command grid
   * already established its normal availability gates. */
  startDanmakuBattleAction: (commandNo: 411 | 480, target?: number) => boolean;
  appendDanmakuInputsAction: (frames: readonly BattleInput[]) => void;
  finishDanmakuBattleAction: (result: "victory" | "defeat" | "complete" | "aborted", playerLives: number) => void;
  finishFishingAction: (result: FishingSettlementOutcome, remainingLine: number) => void;
  /** Commit the in-flight fishing settlement kojo to the persistent eventLog
   *  and clear the terminal phase card. */
  commitFishingSettlementAction: () => void;
  startStoneContestAction: (options: StoneContestStartOptions) => boolean;
  appendStoneContestPlacementAction: (operation: StonePlacementOperation) => void;
  advanceStoneContestClockAction: (targetFrame: number) => void;
  resolveStoneContestRoundAction: () => void;
  continueStoneContestAction: () => void;
  withdrawStoneContestAction: () => void;
  forfeitStoneContestAction: () => void;
  commitStoneContestSettlementAction: () => void;
  renameStoneContestClerkAction: (name: string) => void;
  advanceStoneClerkStoryAction: () => void;
  leaveStoneContestLobbyAction: () => void;
  buyFishingGearAction: (kind: FishingGearKind, id: FishingRodId | FishingLineId) => { ok: boolean; message: string; spent: number };
  /** Resolve the pending B9 prompt with the player's answer (re-issue intent). */
  resolvePromptAnswer: (answer: PromptAnswer) => void;
  /** Cancel the pending B9 prompt (no intent issued). */
  cancelPrompt: () => void;
  /** Resolve a persisted public-festival prompt (currently @NEWYEAR). */
  resolveFestivalEventAction: (answer: PromptAnswer) => void;
  /** Phase D (实玩反馈 #9): walk a multi-hop path (SKIP_MOVE) — narrate each
   *  pass-through encounter + cost time instead of teleporting. `rooms` is the
   *  ordered [first hop … destination] room list (findPath toLocations). The
   *  walk PAUSES at the first occupied relay (sets `state.walkSession`). */
  walkPathAction: (rooms: string[]) => void;
  /** Close the active dialogue session and advance to the next queued one.
   *  The legacy name remains while GameClient callers migrate. */
  clearArrivalPopup: () => void;
  /** Minimal-mode navigation boundary: discard every completed transient
   *  dialogue before a new location settles. Interactive choices and active
   *  AI requests are retained and reported as blocking instead. */
  clearCompletedDialogueBeforeNavigationAction: () => boolean;
  /** Resolve the active mid-kojo choice with a deterministic replay. The
   *  replay replaces that session's transcript segment and never re-settles
   *  the owning command/event. */
  resolveKojoChoiceAction: (optionIndex: number | string) => void;
  /** Phase D slice 2: resolve the current mid-walk encounter with the player's
   *  无视/打招呼/停下来 choice; the walk resumes (or stops). */
  resolveWalkEncounterAction: (choice: WalkChoice) => void;
  /** Resolve the pending sleep session and run morning settlement. */
  finishSleepAction: (dailyEventAnswer?: boolean | PromptAnswer) => void;
  /** Resume a gameplay-affecting DAILY_EV prompt by replaying the settlement. */
  resolveDailyEventPromptAction: (answer: boolean | PromptAnswer) => void;
  /** Resolve the persisted world-level `@MAKANAI` prompt. */
  resolveMobMealAction: (answer: boolean) => void;
  /** Safely skip a malformed/obsolete daily-event prompt and continue sleep. */
  recoverDailyEventSessionAction: () => void;
  /** Clear a legacy outing EV1 session without inventing a battle result. */
  resolveOutingEventAction: () => void;
  /** Commit the player's choice for a paused `outing-choice` session (P1-04). */
  resolveOutingChoiceAction: (answer: OutingChoiceValue | number) => void;
  /** Commit the resolved `outing-choice-result` lines into the persistent
   *  eventLog and clear the dedicated dark-frame result panel. */
  closeOutingChoiceResultAction: () => void;
  /** Cancel a paused `outing-choice` session without applying effects. */
  cancelOutingChoiceAction: () => void;
  /** Resolve the day-end generated-character remember/forget choice. */
  resolveMobGirlMemoryAction: (remember: boolean, replaceSlot?: number) => void;
  /** Commit the explicit [100] 睁开眼睛 menu action. */
  openEyesAction: () => void;
  /** Buy one catalog item through the 起床前主菜单's 隙间商店 page. */
  buyCatalogItemAction: (itemId: number, qty?: number) => ShopBuyResult;
  /** SHOP [104] — run the same authoritative effect as COMF490. */
  useInventoryItemAction: (itemId: number) => { ok: boolean; message: string };
  setWakeMinuteAction: (minute: number) => void;
  /** Set the player's home (自宅) location string. The home is a room *inside*
   *  the player's home region (e.g. 神社:自室), not a standalone scene — this
   *  is the modern form of upstream `@SET_MAINHOME` (NEWGAME.ERB:181). */
  setHomeLocationAction: (homeLocation: string) => void;
  /** SHOP [160] 重置委托 — clear active commission slots + per-chara 委托状況/内容状态. */
  resetCommissionsAction: () => { resetSlots: number; resetFlags: number };
  /** SHOP [161] 重置服装 — restore NPC default outfits + clear coordinate 1-99 (master excluded). */
  resetClothesAction: () => { resetNpcs: number; resetCoords: number };
  /** SHOP [110] — release a selected caged insect. */
  releaseBugAction: (id: string) => boolean;
  /** SHOP [110] — turn a selected caged insect into its material class. */
  materializeBugAction: (id: string) => boolean;
  /** Toggle an Act_COM filter (Parity QA P-1) for the focused target. A pure
   *  preference write (the per-target 過濾器 flags / global 家事過濾器), not a
   *  settlement intent, so it goes through its own action, not `applyIntent`. */
  toggleFilterAction: (toggleId: number, target: number) => void;
  /** Flip `FLAG:立絵種類` (立絵↔顔絵 global toggle, eraTW OPTION [3]). A pure
   *  preference write, not a settlement intent. */
  togglePortraitKindAction: () => void;
  /** Persist a per-character alternate portrait package (CFLAG 564). */
  setPortraitVariantAction: (charaNum: number, variantId: number) => void;
  /** Flip FLAG:87, the original automatic PANTS_SUKIMA transfer mode. */
  togglePantyGapAutoAction: () => void;
  /** Claim one earned SHOP/BONUS2 panty collection milestone. */
  claimPantyCollectionBonusAction: (id: number) => boolean;
  /** SHOP [105] — sell duplicate permanent panties, retaining one of each. */
  sellPantyDuplicatesAction: () => number;
  /** Update persisted Agent Runtime settings through the authoritative store. */
  updateAgentSettingsAction: (patch: Partial<AgentSettings>) => void;
  /** S2 debug/encounter entry; returns immediately and never blocks gameplay. */
  prepareCharacterForEncounterAction: (
    charaNum: number,
    trigger?: LazyMaterializationTrigger,
  ) => void;
  cancelLazyMaterializationAction: (reason?: string) => void;
  /** S5/S6 experimental short-event entry. Omit templateId to let the
   * configured provider rank the two legal templates; passing one is the
   * deterministic authored-fixture/debug path. */
  startStoryProgramAction: (templateId?: 1 | 2, actorId?: number) => Promise<boolean>;
  acceptStoryletAction: (document: unknown, bindings: StoryletBindingsV1) => boolean;
  progressStoryletsAction: () => boolean;
  resolveStoryChoiceAction: (choiceId: string) => void;
  recoverStoryProgramAction: () => void;
  abortStoryProgramAction: () => void;
  skipStoryProgramAction: () => void;
  /** Default-off L3 sidecar. It snapshots after deterministic settlement and
   * commits only validated narrative-owned fields. */
  runNarrativeDirectorAction: (options?: { allowFree?: boolean; forceWeather?: boolean; playerIntent?: string; replacePending?: boolean; autoSelect?: boolean; manual?: boolean; pinArcId?: string }) => Promise<boolean>;
  /** One serialized offscreen pass for the most urgent live StoryArc. */
  evolveNarrativeArcAction: (trigger?: NarrativeArcEvolutionTrigger) => Promise<boolean>;
  /** Stage B: turn the player's chosen situation into the accepted event and
   * its opening act. The situation set is cleared only on success, so a failed
   * opening leaves the menu intact and re-choosable. */
  chooseNarrativeSituationAction: (situationId: string) => Promise<boolean>;
  /** Drop the overnight situation menu without choosing anything. */
  dismissNarrativeSituationsAction: () => void;
  /** Generate the next round of a story parked at a round boundary. Called
   * automatically once the player interacts with its cast; also callable by
   * hand. Resolves false when the story is not parked or nothing changed. */
  continueNarrativeStoryAction: () => Promise<boolean>;
  refreshNarrativeEventsAction: (trigger: NarrativeReadyTrigger) => boolean;
  startNarrativeEventAction: (eventId: string) => boolean;
  favoriteNarrativeEventAction: (eventId: string) => void;
  setStoryArcStatusAction: (arcId: string, status: "active" | "paused" | "abandoned") => void;
  /** Build a fresh game state. With a `draft` (from the opening wizard,
   *  #13) it applies 称呼 / 性別 / 居住地 / 游戏模式; without one it uses the
   *  faithful NEWGAME defaults. */
  newGame: (draft?: NewGameDraft) => void;
  /** Active selected character packs with an opening UPDATE_K body. */
  listNewGameKojoUpdatesAction: () => NewGameKojoUpdateCandidate[];
  /** Replay one UPDATE_K path; state commits only after a complete resolution. */
  resolveNewGameKojoUpdateAction: (
    charaNum: number,
    choices?: readonly number[],
  ) => NewGameKojoUpdateResult | null;
  /** Drop the in-memory state (e.g. user cleared their last project). */
  reset: () => void;
  /** 问题3 — wipe every AI-generated persisted field (agent memories/diaries/
   *  cognition, relationship ledger, experiences, story programs/narrative
   *  events, AI personas) from the CURRENT in-memory state. The player must
   *  save afterwards to make the cleanup durable. Keeps user config (agent
   *  settings, roster, AI connection settings). */
  clearAiGeneratedContentAction: () => void;

  // --- 角色数值调试 (debug panel) ---
  /** Read a chara's 5 relationship stats (信頼度/好感度/親密/従順/欲望). */
  debugReadCharaGates: (charaNum: number) => CharaGates;
  /** Patch a chara's relationship stats (only the keys present). */
  debugPatchChara: (charaNum: number, patch: Partial<CharaGates>) => void;
  /** Read the master-only daily abilities exposed by the in-game debug popup. */
  debugReadMasterAbilities: () => MasterDebugAbilities;
  /** Patch only whitelisted master daily abilities (clamped to 0..5). */
  debugPatchMasterAbilities: (patch: Partial<MasterDebugAbilities>) => void;
}

export const useGameStateStore = create<GameStateStore>((set, get) => ({
  state: null,
  loading: false,
  error: null,
  lastSavedAt: null,
  saveSlots: null,
  dialogueQueue: [],
  pendingArrivalEvents: null,
  farmScreenOpen: false,
  pendingPrompt: null,
  pendingKojoChoice: null,
  replacedAuthorLineKeys: [],
  nightCycleStatus: null,
  narrativeDirectorStatus: null,

  awaitNightCycle() {
    return agentNightPromise ?? Promise.resolve();
  },

  abandonNightCycleAction() {
    cancelAgentNightCycle();
  },

  async load(projectRoot) {
    cancelAgentNightCycle();
    cancelDaytimeReactions("load");
    cancelLazyMaterializationFromStore("load");
    cancelStoryRequests();
    cancelNarrativeDirector("load");
    cancelAllRealtimeAiKojo();
    resetSceneAmbientRuntime();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({ loading: true, error: null });
    try {
      const slots = await ipcListSaveSlots(projectRoot);
      const recentSlot = await ipcMostRecentSlot(projectRoot);
      const loaded = recentSlot === null ? null : await ipcLoadState(projectRoot, recentSlot);
      const loadedSlotInfo =
        recentSlot === null ? null : slots.find((slot) => slot.slot === recentSlot) ?? null;
      const baseline = buildInitialState();
      const migration =
        loaded === null || loaded === undefined
          ? null
          : migrateGameState(loaded, baseline);
      const next = migration?.state ?? baseline;
      await hydrateMemoryArchive(next.agentRuntime?.memoryArchive);
      setMasterWakeMinute(next, next.masterWakeMinute ?? 420);
      hydrateConfiguredCharaHomes(next);
      setSlotLocation(next.master, next.master.location);
      set({
        state: next,
        loading: false,
        error: null,
        lastSavedAt: loadedSlotInfo?.savedAt ?? null,
        saveSlots: slots,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingPrompt: null,
        pendingKojoChoice: null,
        replacedAuthorLineKeys: [],
      });
      resumeAgentDaytimeQueue(next);
      scheduleNarrativeReadiness("arrival");
    } catch (e) {
      set({
        state: e instanceof MemoryArchiveLoadError ? null : buildInitialState(),
        loading: false,
        error: `load failed: ${String(e)}`,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingKojoChoice: null,
        replacedAuthorLineKeys: [],
      });
    }
  },

  async restore(projectRoot, slot = 1) {
    cancelAgentNightCycle();
    cancelDaytimeReactions("restore");
    cancelLazyMaterializationFromStore("restore");
    cancelStoryRequests();
    cancelNarrativeDirector("restore");
    cancelAllRealtimeAiKojo();
    resetSceneAmbientRuntime();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({ loading: true, error: null });
    try {
      const loaded = await ipcLoadState(projectRoot, slot);
      if (loaded === null || loaded === undefined) {
        set({ loading: false, error: "没有可读取的存档。", lastSavedAt: null });
        return false;
      }
      const migration = migrateGameState(loaded, buildInitialState());
      if (!migration.valid) {
        set({ loading: false, error: "存档内容损坏，无法读取。", lastSavedAt: null });
        return false;
      }
      const next = migration.state;
      await hydrateMemoryArchive(next.agentRuntime?.memoryArchive);
      setMasterWakeMinute(next, next.masterWakeMinute ?? 420);
      hydrateConfiguredCharaHomes(next);
      setSlotLocation(next.master, next.master.location);
      const slots = await ipcListSaveSlots(projectRoot);
      const info = slots.find((candidate) => candidate.slot === slot) ?? null;
      set({
        state: next,
        loading: false,
        error: null,
        lastSavedAt: info?.savedAt ?? null,
        saveSlots: slots,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingPrompt: null,
        pendingKojoChoice: null,
        replacedAuthorLineKeys: [],
      });
      resumeAgentDaytimeQueue(next);
      scheduleNarrativeReadiness("arrival");
      return true;
    } catch (e) {
      set({
        loading: false,
        error: `load failed: ${String(e)}`,
      });
      return false;
    }
  },

  async save(projectRoot, slot = 1) {
    if (get().state === null) return false;
    cancelVmDialogueContinuations(get().dialogueQueue);
    if (get().dialogueQueue.some((session) => session.choice?.continuationId)) {
      const queue = get().dialogueQueue.map((session) => session.choice?.continuationId
        ? { ...session, choice: null }
        : session);
      set(dialogueQueueMirrors(queue));
    }
    try {
      // Agent-night diaries are committed asynchronously into GameState. SAVE
      // is available from the morning menu while that sidecar is running, so
      // wait before reading `state`; otherwise the serialized snapshot would
      // permanently miss a diary that finishes a moment later. The wait is
      // cancellation-safe (load/new game/"不再等待" settle it) and never
      // rejects under the store contract.
      await get().awaitNightCycle();
      await awaitMemoryCommits();
      const s = get().state;
      if (s === null) return false;
      const savedAt = Date.now();
      await ipcSaveState(projectRoot, slot, s, saveSummary(s));
      const slots = await ipcListSaveSlots(projectRoot);
      set({ lastSavedAt: savedAt, saveSlots: slots, error: null });
      return true;
    } catch (e) {
      set({ error: `save failed: ${String(e)}` });
      return false;
    }
  },

  async refreshSaveSlots(projectRoot) {
    try {
      const slots = await ipcListSaveSlots(projectRoot);
      set({ saveSlots: slots, error: null });
    } catch (e) {
      set({ error: `save slot refresh failed: ${String(e)}` });
    }
  },

  startAiChatAction(target, semantic) {
    const state = get().state;
    const uiBeforeStart = get();
    if (!state || uiBeforeStart.pendingPrompt) return false;
    // Minimal mode has no popup-close gesture. A completed command/arrival
    // session may therefore still own the queue when the player opens the
    // inline AI chat bar. Treat a new explicit chat as the next presentation
    // boundary: consume every completed session, but never discard a paused
    // choice or an AI request that is still streaming.
    if (uiBeforeStart.dialogueQueue.some(
      (session) => session.choice !== null || session.aiRequestId !== undefined,
    )) {
      set({ error: "AI 对话无法启动：请先完成当前口上或选择。" });
      return false;
    }
    const { router } = currentIntentDeps();
    const prepared = prepareRealtimeAiChat({
      target,
      state,
      semantic,
      router,
      seed: state.time.tickValue * 1009 + target * 97,
    });
    if (!prepared) {
      set({ error: "AI 对话无法启动：请检查 AI 总开关、模型连接与角色开关。" });
      return false;
    }
    if (uiBeforeStart.dialogueQueue.length > 0) {
      cancelDialogueSessions(uiBeforeStart.dialogueQueue);
      set(dialogueQueueMirrors([]));
    }
    set({
      ...enqueueDialogueRequestsPatch(get(), [{
        id: prepared.sessionId,
        owner: "command",
        transcript: [prepared.playerEvent],
        aiRequestId: prepared.requestId,
        aiCharaNum: prepared.target,
      }]),
      error: null,
    });
    let proposedAction: AgentActionProposalV1 | null = null;
    let proposedRelationship: unknown;
    let proposedHookResult: unknown;
    let proposedStoryProgress: unknown;
    let actionLines: string[] = [];

    const replaceAiChatLines = async (
      lines: ReadonlyArray<AiGeneratedLine>,
      pending: boolean,
      failed = false,
    ): Promise<void> => {
      const ui = get();
      const index = ui.dialogueQueue.findIndex((session) =>
        session.id === prepared.sessionId && session.aiRequestId === prepared.requestId);
      if (index === -1) {
        console.warn("[AI-CHAT] reply dropped: session gone from queue", {
          wantId: prepared.sessionId,
          queue: get().dialogueQueue.map((s) => ({ id: s.id, owner: s.owner, aiRequestId: s.aiRequestId })),
        });
        return;
      }
      let nextState: GameState | undefined;
      if (!pending && !failed && ui.state && proposedRelationship !== undefined && prepared.relationshipGrant
        && currentAiSettings().enabled && currentAiSettings().relationshipChangesEnabled
        && currentAiCharacterProfile(prepared.target).enabled) {
        const candidate = cloneGameState(ui.state);
        const result = settleRelationshipProposal(candidate, prepared.relationshipGrant, proposedRelationship);
        useAiStore.getState().patchDebugEntry(prepared.requestId, { relationshipResult: result });
        if (result.status === "applied") {
          nextState = candidate;
          actionLines.push(`好感度 ${result.favorDelta >= 0 ? "+" : ""}${result.favorDelta}，信赖度 ${result.trustDelta >= 0 ? "+" : ""}${result.trustDelta}`);
        }
      }
      const transcript: ObservationEvent[] = [
        prepared.playerEvent,
        ...lines.map((line) => ({
          kind: "DIALOGUE_LINE" as const,
          timestamp: NOW(),
          charaNum: prepared.target,
          text: line.text,
          form: line.form,
          origin: "ai" as const,
          ...(line.aiChoice ? { aiChoice: line.aiChoice } : {}),
        })),
        ...(!pending ? actionLines.map((text) => ({
          kind: "NARRATION" as const,
          timestamp: NOW(),
          text,
        })) : []),
        ...(failed ? [{
          kind: "NARRATION" as const,
          timestamp: NOW(),
          text: "对方一时没有回应。",
        }] : []),
      ];
      let queue = ui.dialogueQueue.map((session, sessionIndex) =>
        sessionIndex === index
          ? { ...session, transcript, aiRequestId: pending ? prepared.requestId : undefined }
          : session);
      if (!pending && !failed && ui.state?.agentRuntime) {
        let candidate = nextState ?? cloneGameState(ui.state);
        if (candidate.agentRuntime!.settings.masterEnabled) {
          const publicationContext = memoryPublicationContext(ui.state, prepared.target);
          if (prepared.hookGrant && proposedHookResult !== undefined) commitHookReceipt(candidate, prepared.hookGrant, proposedHookResult,
            lines.map((line, index) => ({ id: `reply:${index}`, text: line.text })));
          await importLegacyMemories(candidate);
          const root = await prepareMemoryRecords(candidate.agentRuntime!, [{
            kind: "ai-dialogue", charaNum: prepared.target, sourceId: `chat:${prepared.requestId}`,
            sessionId: prepared.sessionId, dayIndex: candidate.time.dayIndex, tick: candidate.time.tickValue,
            location: candidate.master.location,
            lines: [{ speaker: "player", text: prepared.playerEvent.text }, ...lines.map(line => ({ speaker: "character" as const, text: line.text }))],
            details: { actionLines: [...actionLines], responseForms: lines.map(line => line.form),
              ...(prepared.hookGrant ? { hookReceipt: candidate.narrativeHooks?.find(h => h.id === prepared.hookGrant!.hookId)?.lastReceipt } : {}) },
          }]);
          const live = get();
          if (!live.dialogueQueue.some(session => session.id === prepared.sessionId && session.aiRequestId === prepared.requestId)) return;
          if (prepared.hookGrant && live.dialogueQueue[0]?.id !== prepared.sessionId) throw new Error("Narrative hook lost its foreground owner");
          if (!live.state || memoryPublicationContext(live.state, prepared.target) !== publicationContext
            || !currentAiSettings().enabled || !currentAiCharacterProfile(prepared.target).enabled)
            throw new Error("Dialogue changed while archiving its memory");
          if (live.state !== ui.state) {
            candidate = cloneGameState(live.state);
            if (prepared.hookGrant && proposedHookResult !== undefined) commitHookReceipt(candidate, prepared.hookGrant, proposedHookResult,
              lines.map((line, index) => ({ id: `reply:${index}`, text: line.text })));
            if (nextState && proposedRelationship !== undefined && prepared.relationshipGrant) {
              const result = settleRelationshipProposal(candidate, prepared.relationshipGrant, proposedRelationship);
              if (result.status !== "applied") throw new Error("Relationship proposal changed while archiving");
            }
          }
          const currentRoot = candidate.agentRuntime!.memoryArchive;
          candidate.agentRuntime!.memoryArchive = { ...root,
            heads: { ...root.heads, ...currentRoot?.heads, [prepared.target]: root.heads[prepared.target]! },
            reflectedThrough: { ...root.reflectedThrough, ...currentRoot?.reflectedThrough } };
          queue = live.dialogueQueue.map(session => session.id === prepared.sessionId
            ? { ...session, transcript, aiRequestId: undefined } : session);
          nextState = candidate;
        }
        const wrote = appendPlayerAiChatEpisode(candidate.agentRuntime!, {
          charaNum: prepared.target,
          sessionId: prepared.sessionId,
          requestId: prepared.requestId,
          dayIndex: candidate.time.dayIndex,
          tick: candidate.time.tickValue,
          semantic: prepared.playerEvent.text,
          responseLines: lines.map((line) => line.text),
        });
        if (wrote) {
          recordInteractionSignal(candidate, prepared.target, "dialogue", 3, "自由 AI 对话");
          nextState = candidate;
        }
      }
      if (!pending && !failed && ui.state && prepared.hookGrant && proposedHookResult !== undefined
        && get().dialogueQueue[0]?.id === prepared.sessionId) {
        const candidate = nextState ?? cloneGameState(get().state ?? ui.state);
        if (commitHookReceipt(candidate, prepared.hookGrant, proposedHookResult,
          lines.map((line, index) => ({ id: `reply:${index}`, text: line.text })))) nextState = candidate;
      }
      if (!pending && ui.state && prepared.hookGrant && get().dialogueQueue[0]?.id === prepared.sessionId) {
        const candidate = nextState ?? cloneGameState(get().state ?? ui.state);
        const hook = candidate.narrativeHooks?.find(h => h.id === prepared.hookGrant!.hookId);
        if (hook?.lastReceipt?.sessionId !== prepared.sessionId
          && deferUnprocessedProgramHook(candidate, prepared.hookGrant, failed ? "本次剧情对话失败" : "本次回复未引出剧情")) nextState = candidate;
      }
      if (!pending && !failed && lines.length && currentAiSettings().enabled && currentAiSettings().narrativeEnabled && currentAiCharacterProfile(prepared.target).enabled && prepared.storyGrants?.length) {
        const candidate = nextState ?? cloneGameState(get().state ?? ui.state!);
        if (recordStoryInteraction(candidate, { id: prepared.requestId, sessionId: prepared.sessionId, speakerId: prepared.target,
          commandNo: AI_CHAT_COMMAND_NO, playerText: prepared.playerEvent.text, lines,
          grants: prepared.storyGrants, signals: proposedStoryProgress, origin: prepared.storyEvidenceOrigin })) nextState = candidate;
      }
      if (nextState) syncAgentFactsAndSchedule(nextState, [prepared.target]);
      if (!pending && !failed && (nextState ?? ui.state)) {
        const candidate = nextState ?? cloneGameState(ui.state!);
        recordStoryletDialogue(candidate, { id: prepared.sessionId, kind: "dialogue", speakerId: prepared.target, commandNo: 19986, tick: candidate.time.tickValue });
        if (candidate.storylets?.length) { refreshStorylets(candidate); nextState = candidate; }
      }
      const hookChoice = nextState ? hookReplyChoice(nextState, prepared.sessionId) : undefined;
      if (hookChoice) {
        const last = transcript.reduce((found, e, index) => e.kind === "DIALOGUE_LINE" && e.charaNum === prepared.target ? index : found, -1);
        queue = queue.map(s => s.id === prepared.sessionId ? { ...s, transcript: transcript.map((e, i) =>
          i === last && e.kind === "DIALOGUE_LINE" ? { ...e, aiChoice: hookChoice } : e) } : s);
      }
      if (!pending && !failed && !hookChoice) {
        const boundChoice = bindStoryChoice(nextState ?? get().state!, prepared, lines);
        const choice = boundChoice.lines.at(-1)?.aiChoice;
        queue = queue.map(session => session.id === prepared.sessionId ? { ...session,
          storyChoiceGrant: boundChoice.grant,
          transcript: session.transcript.map(event => {
            if (event.kind !== "DIALOGUE_LINE" || !event.aiChoice) return event;
            const { aiChoice: _oldChoice, ...line } = event;
            return { ...line, ...(choice ? { aiChoice: choice } : {}) };
          }) } : session);
      }
      set({ ...dialogueQueueMirrors(queue), ...(nextState ? { state: nextState } : {}) });
      if (!pending && !failed && lines.length > 0 && get().state) {
        const current = cloneGameState(get().state!);
        if (recordStoryPlayerInteraction(current, { id: prepared.requestId, targetId: prepared.target, commandNo: AI_CHAT_COMMAND_NO,
          summary: prepared.playerEvent?.kind === "DIALOGUE_LINE" ? prepared.playerEvent.text : undefined })) {
          set({ state: current });
          scheduleNarrativeReadiness("command-settled");
        }
      }
    };

    // Publish parseable partial lines in every presentation mode. A provider
    // may have produced the reply while keeping its stream open; suppressing
    // partials made minimal mode look frozen until an unrelated scene update.
    void generateRealtimeAiKojo(
      prepared,
      (partialLines) => replaceAiChatLines(partialLines, true),
      (proposal) => { proposedAction = proposal; },
      (proposal) => { proposedRelationship = proposal; },
      (result) => { proposedHookResult = result; },
      (result) => { proposedStoryProgress = result; },
    )
      .then(async (lines) => {
        const ownsSession = () => get().dialogueQueue.some(session =>
          session.id === prepared.sessionId && session.aiRequestId === prepared.requestId);
        const enabled = () => currentAiSettings().enabled && currentAiSettings().dialogueActionsEnabled === true
          && currentAiCharacterProfile(prepared.target).enabled;
        const input = prepared.settings.dialogueActionsEnabled && enabled() && ownsSession()
          ? prepareDialogueActionInput(state, prepared.target, prepared.requestId, semantic, lines.map(line => line.text).join("\n"))
          : null;
        const started = Date.now();
        if (input) replaceAiChatLines(lines, true);
        const proposal = input ? await judgeRealtimeDialogueAction(input, prepared.settings) : null;
        const live = get().state;
        const sessionStillOpen = get().dialogueQueue.some((session) => session.id === prepared.sessionId && session.aiRequestId === prepared.requestId);
        if (live && sessionStillOpen && proposedAction) {
          const result = applyAgentActionProposal(live, prepared.target, proposedAction);
          actionLines = result.lines;
          if (result.status === "applied") {
            syncAgentFactsAndSchedule(result.state, [prepared.target]);
            set({ state: result.state });
          }
        }
        if (input && get().state && ownsSession() && enabled()) {
          const { state: candidate, result } = settleDialogueAction(get().state!, input, proposal);
          useAiStore.getState().patchDebugEntry(prepared.requestId, {
            dialogueActionResult: { result, action: proposal && typeof proposal === "object" ? (proposal as { action?: unknown }).action : null,
              route: "free-chat", target: prepared.target, durationMs: Date.now() - started },
          });
          if (result === "accepted") {
            set({ state: candidate });
          }
        }
        console.log("[AI-CHAT] resolved", lines.length, "lines, queue:", get().dialogueQueue.map((s) => s.id).join(","));
        await trackMemoryCommit(replaceAiChatLines(lines, false));
      })
      .catch((error) => {
        console.warn("[AI-CHAT] failed:", String(error));
        useAiStore.getState().patchDebugEntry(prepared.requestId, { status: "error", error: String(error) });
        replaceAiChatLines([], false, true);
      });
    return true;
  },

  respondDialogueAccompanyAction(target, requestId, response) {
    const ui = get(), settings = currentAiSettings();
    if (!ui.state || ui.pendingPrompt || ui.dialogueQueue.some(session => session.choice || session.aiRequestId)
      || !settings.enabled || !settings.dialogueActionsEnabled || !currentAiCharacterProfile(target).enabled) return false;
    const text = response === "accept" ? "好，一起走吧。" : response === "reject" ? "这次就不去了。" : "这次先不出去了。";
    const event: ObservationEvent = { kind: "DIALOGUE_LINE", timestamp: NOW(), charaNum: ui.state.master.charaNum, text };
    const next = settleDialogueAccompanyResponse({ ...ui.state, eventLog: [...ui.state.eventLog, event] }, target, requestId, response);
    if (!next) return false;
    syncAgentFactsAndSchedule(next, [target]);
    const active = ui.dialogueQueue[0];
    const dialogue = active && active.owner === "command" && active.aiCharaNum === target
      ? dialogueQueueMirrors(ui.dialogueQueue.map((session, index) => index === 0 ? { ...session, transcript: [...session.transcript, event] } : session))
      : enqueueDialogueRequestsPatch(ui, [{ owner: "command", transcript: [event] }]);
    set({ state: next, ...dialogue });
    return true;
  },

  advancePartnerLedDateAction() {
    const state = get().state;
    if (!state?.dateSession || state.dateSession.controller !== "partner" || !state.dateSession.autoAdvance) return false;
    if (get().pendingPrompt || get().dialogueQueue.length > 0) return false;
    const next = cloneGameState(state);
    const lines = advancePartnerLedDate(next);
    if (lines.length === 0) return false;
    const events: ObservationEvent[] = lines.map((text) => ({ kind: "NARRATION", timestamp: NOW(), text }));
    next.eventLog = [...next.eventLog, ...events];
    set({ state: next, error: null });
    return true;
  },

  async appendAiChatBranchAction(sessionId, choiceLabel, lines) {
    const ui = get();
    const session = ui.dialogueQueue[0]?.id === sessionId ? ui.dialogueQueue[0] : undefined;
    if (!ui.state || !session || session.owner !== "command" || !session.aiCharaNum) return false;
    const transcript = selectedBranchTranscript(session, choiceLabel, lines, NOW());
    if (!transcript) return false;
    const grant = session.storyChoiceGrant;
    const discardStaleMenu = () => {
      const live = get();
      if (live.dialogueQueue[0] !== session) return;
      set(dialogueQueueMirrors(live.dialogueQueue.map(entry => entry === session ? { ...entry,
        storyChoiceGrant: undefined, transcript: entry.transcript.map(event => {
          if (event.kind !== "DIALOGUE_LINE") return event;
          const { aiChoice: _choice, ...line } = event;
          return line;
        }) } : entry)));
    };
    if (grant && (!currentAiSettings().enabled || !currentAiSettings().narrativeEnabled
      || !currentAiCharacterProfile(session.aiCharaNum).enabled)) { discardStaleMenu(); return false; }
    const choiceId = `choice:${sessionId}:${memoryContentId(choiceLabel)}`;
    const recordChoice = (state: GameState) => !grant || currentAiSettings().enabled && currentAiSettings().narrativeEnabled
      && currentAiCharacterProfile(session.aiCharaNum!).enabled && recordPlayerStoryChoice(state, {
      id: choiceId, sessionId, speakerId: session.aiCharaNum!, label: choiceLabel,
      lines: lines.flatMap(line => line.kind === "DIALOGUE_LINE" ? [{ text: line.text }] : []), grant });
    const baselineMemoryHead = ui.state.agentRuntime?.memoryArchive?.heads[session.aiCharaNum];
    const publicationContext = memoryPublicationContext(ui.state, session.aiCharaNum);
    const next = cloneGameState(ui.state);
    const hook = next.narrativeHooks?.find(h => h.lastReceipt?.sessionId === sessionId && h.responses?.length);
    const response = hook?.responses?.find(r => r.label === choiceLabel);
    if (hook && (!response || !lines.every(e => e.kind === "DIALOGUE_LINE" && e.charaNum === hook.speakerId)
      || JSON.stringify(response.lines) !== JSON.stringify(lines.flatMap(e => e.kind === "DIALOGUE_LINE" ? [e.text] : []))
      || !commitHookPlayerResponse(next, hook.id, hook.revision, sessionId, response.id))) return false;
    if (!recordChoice(next)) { discardStaleMenu(); return false; }
    if (!next.agentRuntime || !next.agentRuntime.settings.masterEnabled) {
      if (hook || grant) syncAgentFactsAndSchedule(next, [session.aiCharaNum]);
      set({ ...(hook || grant ? { state: next } : {}), ...dialogueQueueMirrors(ui.dialogueQueue.map(entry =>
        entry.id === sessionId ? { ...entry, transcript, storyChoiceGrant: undefined } : entry)) });
      if (grant) scheduleNarrativeReadiness("command-settled");
      return true;
    }
    appendAiChatBranch(next.agentRuntime, {
      charaNum: session.aiCharaNum,
      sessionId,
      tick: next.time.tickValue,
      label: choiceLabel,
      lines: lines.map((line) => line.kind === "DIALOGUE_LINE" ? line.text : "").filter(Boolean),
    });
    return trackMemoryCommit((async () => {
      try {
        await importLegacyMemories(next);
        const root = await prepareMemoryRecords(next.agentRuntime!, [{
          kind: "ai-choice", charaNum: session.aiCharaNum!, sourceId: choiceId,
          sessionId, dayIndex: next.time.dayIndex, tick: next.time.tickValue, location: next.master.location,
          lines: [{ speaker: "player", text: choiceLabel }, ...lines.flatMap(line => line.kind === "DIALOGUE_LINE" ? [{ speaker: "character" as const, text: line.text }] : [])],
          ...(hook ? { details: { hookPlayerResponse: hook.playerResponse } } : {}),
        }]);
        const live = get();
        if (!live.state?.agentRuntime || live.dialogueQueue[0] !== session
          || memoryPublicationContext(live.state, session.aiCharaNum!) !== publicationContext
          || live.state.agentRuntime.memoryArchive?.heads[session.aiCharaNum!] !== baselineMemoryHead) return false;
        const published = cloneGameState(live.state);
        if (hook && response && !commitHookPlayerResponse(published, hook.id, hook.revision, sessionId, response.id)) return false;
        if (!recordChoice(published)) { discardStaleMenu(); return false; }
        appendAiChatBranch(published.agentRuntime!, { charaNum: session.aiCharaNum!, sessionId,
          tick: next.time.tickValue, label: choiceLabel, lines: lines.flatMap(line => line.kind === "DIALOGUE_LINE" ? [line.text] : []) });
        const currentRoot = published.agentRuntime!.memoryArchive;
        published.agentRuntime!.memoryArchive = { ...root,
          heads: { ...root.heads, ...currentRoot?.heads, [session.aiCharaNum!]: root.heads[session.aiCharaNum!]! },
          reflectedThrough: { ...root.reflectedThrough, ...currentRoot?.reflectedThrough } };
        if (hook || grant) syncAgentFactsAndSchedule(published, [session.aiCharaNum!]);
        set({ state: published, ...dialogueQueueMirrors(live.dialogueQueue.map(entry => entry.id === sessionId
          ? { ...entry, transcript, storyChoiceGrant: undefined } : entry)) });
        if (grant) scheduleNarrativeReadiness("command-settled");
        return true;
      } catch (error) { set({ error: `记忆保存失败：${String(error)}` }); return false; }
    })());
  },

  applyIntentAction(intent) {
    const s = get().state;
    if (s === null) return;
    // AI-first 呈现期间确定性结算尚未发布：此时再结算会在旧 state 上算出
    // 过时的 world，并把流中会话的 pending settlement 永久丢弃。先拦下。
    // （自由 AI 聊天流会基于 live state 重定基，不在此列。）
    if (intent.kind === "ISSUE_COMMAND" && hasPendingDeferringAi()) {
      set({ error: "命令无法执行：请先完成当前口上或选择。" });
      return;
    }
    // 命令全链路计时（点击 → 口上出现）：提前 return 的弹窗/委托路径不会
    // finish，自动丢弃，不产生记录。
    const commandTiming = intent.kind === "ISSUE_COMMAND"
      ? beginCommandTiming(intent.commandNo, intent.target)
      : null;

    // Every new player command starts a fresh presentation batch. Completed
    // dialogue sessions are no longer useful once the command is issued and
    // must not remain at queue[0], otherwise a later AI response is stranded
    // behind the old session while the UI renders only the queue head.
    if (intent.kind === "ISSUE_COMMAND") {
      const queue = get().dialogueQueue;
      const completed = queue.filter((session) =>
        session.choice === null && session.aiRequestId === undefined,
      );
      if (completed.length > 0) {
        cancelDialogueSessions(completed);
        set(dialogueQueueMirrors(queue.filter((session) => !completed.includes(session))));
      }
    }

    // B9 prompt intercept: if an ISSUE_COMMAND has no promptAnswer but the
    // handler declares a prompt, build a CommandContext, call entry.prompt(),
    // and surface the PromptSpec through pendingPrompt. The GameClient renders
    // the menu; on pick it calls resolvePromptAnswer which re-issues the
    // intent WITH the answer. This unblocks all B9 picker commands (413 做饭,
    // 418 菜園, 436 読書, 445 採集, 450 酒虫, 604 散歩, 617 甘味, 626 土産 etc.).
    if (intent.kind === "ISSUE_COMMAND" && (!intent.promptAnswer || currentIntentDeps().catalog.get(intent.commandNo)?.stagedPrompt)) {
      const { catalog, router } = currentIntentDeps();
      const entry = catalog.get(intent.commandNo);
      if (entry?.prompt) {
        const rng = createRng(intent.commandNo * 100003 + s.time.tickValue);
        const ctx: CommandContext = {
          state: s,
          actor: intent.actor,
          target: intent.target ?? intent.actor,
          commandNo: intent.commandNo,
          rng,
          now: NOW,
          dialogueRouter: router,
          promptAnswer: intent.promptAnswer,
        };
        const spec = entry.prompt(ctx);
        if (spec) {
          const selections =
            intent.promptAnswer?.kind === "pick_sequence"
              ? intent.promptAnswer.values
              : undefined;
          // P2-02 — open the dedicated 家庭菜園 surface when COM418 fires
          // its B9 picker in a PLACE_GARDEN room. The spec itself is
          // unchanged (the FarmScreen reads `pendingPrompt` and re-renders
          // the same option list as a 5-plot grid). We never auto-open
          // outside a garden — that mirrors `@COM_ABLE418`'s `家庭菜園可`
          // gate, so a stray keystroke in the wrong room falls through to
          // the standard handler execCheck and gets the same "这里没有…
          // 菜园" rejection as before.
          const openFarm =
            intent.commandNo === 418 &&
            !intent.promptAnswer &&
            hasPlace(placeFlagsOf(s.master.location), PLACE_GARDEN);
          set({
            farmScreenOpen: openFarm || get().farmScreenOpen,
            pendingPrompt: {
              spec,
              commandNo: intent.commandNo,
              target: intent.target ?? intent.actor,
              ...(selections ? { selections } : {}),
              ...(entry.stagedPrompt ? { staged: true } : {}),
            },
          });
          return; // Don't settle yet — wait for the player's answer.
        }
        // prompt returned null → the handler has a prompt but decided it's not
        // needed for current state (e.g. already cooking) — fall through and
        // let applyIntent settle normally.
      }
    }

    const intentDeps = currentIntentDeps();
    const hookSettings = currentAiSettings();
    const narrativeHookGeneration = intent.kind === "ISSUE_COMMAND" && intent.commandNo === 300
      && hookSettings.enabled && !!hookSettings.baseUrl.trim() && !!hookSettings.model.trim()
      && currentAiCharacterProfile(intent.target ?? intent.actor).enabled
      && !!selectNarrativeHook(s, intent.target ?? intent.actor, 300);
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(intentDeps.router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const intentRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    let result: ReturnType<typeof applyIntent>;
    commandTiming?.markRuntimeStarted();
    if (intentRouter && intentRouter !== intentDeps.router) {
      configureIntent({ dialogueRouter: intentRouter });
      try {
        result = applyIntent(s, intent, undefined, { narrativeHookGeneration });
      } finally {
        configureIntent({ dialogueRouter: intentDeps.router });
      }
    } else {
      result = applyIntent(s, intent, undefined, { narrativeHookGeneration });
    }
    const intentSeed =
      (intent.kind === "ISSUE_COMMAND" ? intent.commandNo : 0) * 100003 +
      s.time.tickValue;
    // resolveCommand has already resolved mark reactions into result.appended.
    // Re-resolving the same transitions here produced two log entries with
    // different timestamps. Reuse the resolver's concrete event instances.
    const commandMarkEvents = intent.kind === "ISSUE_COMMAND"
      ? result.appended.filter((event) =>
        (event.kind === "NARRATION" || event.kind === "DIALOGUE_LINE") && event.origin === "mark")
      : [];
    const transitionsForStore = intent.kind === "ISSUE_COMMAND"
      ? result.transitions.filter((transition) =>
        transition.kind !== "rebellion-mark-acquired" && transition.kind !== "mark-acquired")
      : result.transitions;
    const transitionDialogue = resolveTransitionDialogues(
      result.state,
      transitionsForStore,
      intentDeps.router,
      intentSeed,
    );
    commandTiming?.markRuntimeFinished();
    let next = transitionDialogue.state;
    // Publish accepted facts/interaction signals immediately.  This happens
    // before any dialogue or async AI branch so every later L1/L3 snapshot is
    // built from the same current projection, even in daytime.
    const syncRelatedIds = intent.kind === "ISSUE_COMMAND"
      ? [intent.actor, ...(intent.target === undefined ? [] : [intent.target])]
      : intent.kind === "PROPOSE_DIALOGUE" || intent.kind === "OVERRIDE_SCHEDULE"
        ? [intent.charaNum]
        : [];
    if (currentAiSettings().enabled && currentAiSettings().narrativeEnabled && s.storyProgram?.version === 2) {
      recordStoryWorldChanges(s, next, `world:${nextDialogueSessionId("command")}`);
    }
    if (intent.kind === "ISSUE_COMMAND" && intent.actor === 0 && result.commandOutcome === "ok") {
      if (intent.commandNo === 300) recordStoryletDialogue(next, { id: `dialogue:${nextDialogueSessionId("command")}`, kind: "dialogue",
        speakerId: intent.target ?? intent.actor, commandNo: 300, tick: next.time.tickValue });
      recordStoryPlayerInteraction(next, {
        id: `story-action:${nextDialogueSessionId("command")}:${NOW()}`,
        targetId: intent.target ?? intent.actor,
        commandNo: intent.commandNo,
        summary: intent.commandNo === 300 ? "玩家与该角色交谈（指令已成功结算；此记录不表示答应其他计划）" : `玩家对该角色成功执行指令 ${intent.commandNo}；不据此推定未表达的动机。`,
      });
      if (intent.commandNo !== 300 && currentAiSettings().enabled && currentAiSettings().narrativeEnabled && intent.target) {
        const id = `command-evidence:${nextDialogueSessionId("command")}`;
        recordStoryInteraction(next, { id, sessionId: id, speakerId: intent.target, commandNo: intent.commandNo, runtime: true,
          lines: [{ text: `玩家成功执行指令 ${intent.commandNo}（${commandLabel(intent.commandNo)}）；仅此指令的实际结算有效。` }] });
      }
    }
    syncAgentFactsAndSchedule(next, syncRelatedIds);
    const transitionRequests = [
      ...(commandMarkEvents.length > 0 ? [{ owner: "mark" as const, transcript: commandMarkEvents }] : []),
      ...transitionDialogue.requests,
    ];
    // A command can legitimately produce only authored public prose (for
    // example a wait/rest action) without a character DIALOGUE_LINE. Keep
    // that prose in the same owner-bound interaction session instead of
    // silently leaving it to the history stream.
    // EVENT_COUNTER is settled as part of the command, but its authored
    // reaction belongs to the next owner-bound surface. Keeping it separate
    // lets the player dismiss the command dialogue first, then see the
    // character's主动动作/口上 immediately afterward (matching the upstream
    // SOURCE_CHECK -> EVENT_COUNTER ordering).
    const counterEvents = result.appended.filter(
      (event) => (event.kind === "DIALOGUE_LINE" || event.kind === "NARRATION") && event.origin === "counter",
    );
    const commandTranscript = result.appended.filter(
      (event) => !((event.kind === "DIALOGUE_LINE" || event.kind === "NARRATION") && event.origin === "counter"),
    );
    const commandHasVisibleTranscript = commandTranscript.some(
      (event) => event.kind === "DIALOGUE_LINE" ||
        (event.kind === "NARRATION" && isInteractionVisibleEvent(event)),
    );
    // Fishing kojo is fired at settlement, not command start. The
    // game-state-store keeps the in-flight session clean so the screen's
    // terminal phase card can render the per-outcome branch instead of
    // dumping it straight to the eventLog. A 621 command whose result still
    // carries dialogue lines must not open the command box either — those
    // lines belong to the settlement card.
    const fishingCommandActive =
      intent.kind === "ISSUE_COMMAND" && intent.commandNo === 621 && next.fishingGame !== null;
    const aiHistoryEntry =
      intent.kind === "ISSUE_COMMAND" &&
      intent.commandNo !== 621 &&
      (intent.target ?? intent.actor) > 0 &&
      result.commandOutcome !== undefined &&
      !result.pendingKojoChoice
        ? recordAiCommand({
            target: intent.target ?? intent.actor,
            commandNo: intent.commandNo,
            outcome: result.commandOutcome,
            state: next,
            beforeState: s,
            events: result.appended,
          })
        : null;

    // Shared by the normal path and every popup early-return path: the
    // realtime AI kojo for THIS command (AI-first presentation defers the
    // deterministic settlement until the stream settles).
    const prepareCommandAi = (afterState: GameState): PreparedAiKojoRequest | null =>
      intent.kind === "ISSUE_COMMAND" &&
      intent.commandNo !== 621 &&
      aiHistoryEntry &&
      result.commandOutcome !== undefined
        ? (narrativeHookGeneration ? prepareNarrativeHookDialogue : prepareRealtimeAiKojo)({
            target: intent.target ?? intent.actor,
            commandNo: intent.commandNo,
            outcome: result.commandOutcome,
            beforeState: s,
            afterState,
            events: commandTranscript,
            promptAnswer: intent.promptAnswer,
            router: intentDeps.router,
            historyEntryId: aiHistoryEntry.id,
            seed: intentSeed,
            authoredResolution: result.commandKojoResolution,
          })
        : null;
    const finishAiTiming = (prepared: PreparedAiKojoRequest): void => {
      // 口上已最终出现。AI 分段从 debug entry 取（generateRealtimeAiKojo
      // 在 kojo-runtime 内埋点，不为此改签名）。
      const aiTimings = useAiStore.getState().debugEntries.find(
        (entry) => entry.requestId === prepared.requestId,
      )?.timings;
      commandTiming?.finish("ai", {
        preparationMs: aiTimings?.preparationMs ?? 0,
        stateContextMs: aiTimings?.stateContextMs ?? 0,
        firstTokenMs: aiTimings?.firstTokenMs ?? 0,
        providerMs: aiTimings?.providerMs ?? 0,
        parseMs: aiTimings?.parseMs ?? 0,
        providerCalls: aiTimings?.providerCalls ?? 1,
      });
    };
    const runCommandAiSession = (
      prepared: PreparedAiKojoRequest,
      afterState: GameState,
      extraRequests: DialogueEnqueueRequest[] = [],
    ): void => {
      if (commandTiming) commandTiming.markPrepared();
      const settlement = createDeferredSettlement(s, afterState);
      set({
        ...enqueueDialogueRequestsPatch(get(), [commandAiSessionRequest(prepared), ...extraRequests]),
        error: null,
      });
      streamAiIntoSession({
        prepared,
        baseState: s,
        fallbackTranscript: commandTranscript,
        settlementEvents: commandTranscript,
        settlement,
        onFinalized: () => finishAiTiming(prepared),
        onFailed: () => commandTiming?.fail("ai"),
      });
    };

    if (result.pendingKojoChoice) {
      const choice: DialogueChoiceSession = {
        kind: "command",
        charaNum: result.pendingKojoChoice.charaNum,
        commandNo: result.pendingKojoChoice.commandNo,
        seed: result.pendingKojoChoice.seed,
        choices: [...result.pendingKojoChoice.choices],
        options: [...result.pendingKojoChoice.options],
        continuationId: result.pendingKojoChoice.continuationId,
        continuationValues: result.pendingKojoChoice.continuationValues
          ? [...result.pendingKojoChoice.continuationValues]
          : undefined,
        continuationInputMode: result.pendingKojoChoice.continuationInputMode,
        transcriptStart: firstDialogueIndex(result.appended),
      };
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [
          {
            owner: "command",
            transcript: result.appended,
            choice,
          },
          ...transitionRequests,
        ]),
        error: null,
      });
      return;
    }

    // First-meeting hook — after every intent that may have changed master.location,
    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const choice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: intentSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      const popupRequest: DialogueEnqueueRequest = {
        owner: "event",
        transcript: result.appended.filter((e) => e.kind === "DIALOGUE_LINE"),
        choice,
      };
      // The day-event popup must not skip the command's own realtime AI
      // kojo: with one prepared, the AI-first session owns the queue head
      // and the deterministic settlement defers until the stream settles.
      const preparedAi = prepareCommandAi(next);
      if (preparedAi) {
        runCommandAiSession(preparedAi, next, [popupRequest, ...transitionRequests]);
        return;
      }
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [popupRequest, ...transitionRequests]),
        error: null,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const choice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: intentSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: intentSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      const popupRequest: DialogueEnqueueRequest = {
        owner: capturedEventKojo.kind === "event" ? "event" : "diary",
        transcript: result.appended.filter((e) => e.kind === "DIALOGUE_LINE"),
        choice,
      };
      const preparedAi = prepareCommandAi(next);
      if (preparedAi) {
        runCommandAiSession(preparedAi, next, [popupRequest, ...transitionRequests]);
        return;
      }
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [popupRequest, ...transitionRequests]),
        error: null,
      });
      return;
    }

    // First-meeting is transition-owned: master/NPC arrival or wake only.
    // An ordinary command that leaves everyone in place cannot rediscover an
    // old shared-room state.
    const { router } = currentIntentDeps();
    const transition = detectEncounterTransition(s, next);
    scheduleLazyMaterializationForTransition(transition);
    if (transition) {
      const fmSeed = (intent.kind === "ISSUE_COMMAND" ? intent.commandNo : 0) * 100003 + s.time.tickValue;
      const fmRng = createRng(fmSeed);
      const r = runFirstMeetingsForTransition(
        next,
        transition,
        { now: NOW, router, rng: fmRng },
        {
          dialogueSessionAvailable: encounterSessionAvailable(get()),
        },
      );
      if (r.events.length > 0) {
        // Unified with walkPathAction/openEyesAction: greeting地文 → band,
        // the encounter 口上 → InteractionBox modal (never open a fresh popup
        // on top of a prompt or an already-open box).
        const { inline, popup } = splitArrivalKojo(r.events);
        next = { ...next, eventLog: [...next.eventLog, ...inline] };
        if (popup && !get().pendingPrompt) {
          const choice = encounterChoiceSession(
            r,
            transition,
            fmSeed,
            0,
            inline.length,
          );
          const counterRequest: DialogueEnqueueRequest[] = counterEvents.length > 0
            ? [{ owner: "event", transcript: counterEvents }]
            : [];
          const popupRequests: DialogueEnqueueRequest[] = [
            ...counterRequest,
            { owner: "encounter", transcript: popup, choice },
            ...transitionRequests,
          ];
          // The encounter popup must not skip the command's own realtime AI
          // kojo: with one prepared, the AI-first session owns the queue head
          // (口上 first, encounter popup behind) and the settlement defers
          // until the stream settles. Without one, the authored transcript
          // keeps its current presentation.
          const preparedAi = prepareCommandAi(next);
          if (preparedAi) {
            runCommandAiSession(preparedAi, next, popupRequests);
            return;
          }
          const commandRequest: DialogueEnqueueRequest[] =
            intent.kind === "ISSUE_COMMAND" && !fishingCommandActive && commandHasVisibleTranscript
              ? [{ owner: "command", transcript: commandTranscript }]
              : [];
          set({
            state: next,
            ...enqueueDialogueRequestsPatch(get(), [
              ...commandRequest,
              ...popupRequests,
            ]),
            error: null,
          });
          return;
        }
      }
    }

    const previousOfferedIds = new Set(offeredDateInvitations(s).map((event) => event.id));
    // 确定性结算 + 口上解析到此完成（authored 口上的玩家可见点）。
    commandTiming?.markSettled();
    const newInvitation = offeredDateInvitations(next).find((event) => !previousOfferedIds.has(event.id));
    const invitationHasAuthoredLine = newInvitation
      ? result.appended.some((event) => event.kind === "DIALOGUE_LINE" && event.charaNum === newInvitation.partner)
      : false;
    const preparedInvitationAi = newInvitation && !invitationHasAuthoredLine && intentDeps.router
      ? prepareRealtimeAiDateInvitation({
          target: newInvitation.partner,
          beforeState: s,
          afterState: next,
          events: result.appended,
          router: intentDeps.router,
          seed: newInvitation.seed,
        })
      : null;
    const preparedAi =
      !preparedInvitationAi
        ? prepareCommandAi(next)
        : null;
    const counterTarget = counterEvents.find(
      (event): event is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> => event.kind === "DIALOGUE_LINE",
    )?.charaNum ?? (intent.kind === "ISSUE_COMMAND" ? intent.target ?? intent.actor : 0);
    const counterAction = counterTarget > 0
      ? next.charas[counterTarget]?.state.TCVAR[TCVAR_ID.Counter行動] ?? 0
      : 0;
    const preparedCounterAi =
      intent.kind === "ISSUE_COMMAND" &&
      counterEvents.length > 0 &&
      counterTarget > 0 &&
      counterAction > 0 &&
      aiHistoryEntry
        ? prepareRealtimeAiCounterKojo({
            target: counterTarget,
            action: counterAction,
            commandNo: intent.commandNo,
            beforeState: s,
            afterState: next,
            events: counterEvents,
            router: intentDeps.router,
            historyEntryId: aiHistoryEntry.id,
            seed: intentSeed,
          })
        : null;
    if (commandTiming && preparedAi) commandTiming.markPrepared();
    // 无 target（神签/摆摊/道具自用…）且结算成功 → 由在场者做 AI 即兴反应
    // （witness kojo）。preparedAi/counter/invitation 存在时不叠加；失败或
    // 无合格在场者 → 完全走原路径，零行为变化。
    const preparedWitnessAi =
      !preparedAi && !preparedCounterAi && !preparedInvitationAi &&
      intent.kind === "ISSUE_COMMAND" &&
      intent.commandNo !== 621 &&
      !result.pendingKojoChoice &&
      result.commandOutcome === "ok" &&
      (intent.target ?? intent.actor) <= 0
        ? prepareRealtimeAiWitnessKojo({
            commandNo: intent.commandNo,
            beforeState: s,
            afterState: next,
            events: commandTranscript,
            seed: intentSeed,
            router: intentDeps.router,
          })
        : null;
    const offlineHook = !preparedAi && !preparedWitnessAi && intent.kind === "ISSUE_COMMAND" && intent.commandNo === 300
      ? next.narrativeHooks?.find(h => h.speakerId === (intent.target ?? intent.actor) && h.lastReceipt?.disposition === "raise"
        && h.lastReceipt.sessionId !== s.narrativeHooks?.find(old => old.id === h.id)?.lastReceipt?.sessionId) : undefined;
    const offlineSessionId = offlineHook?.lastReceipt?.sessionId;
    const offlineArchiveId = offlineSessionId && next.agentRuntime?.settings.masterEnabled ? `archive:${nextDialogueSessionId("command")}` : undefined;
    const normalCommandRequest: DialogueEnqueueRequest[] = preparedAi
      ? [commandAiSessionRequest(preparedAi)]
      : preparedWitnessAi
        ? [commandAiSessionRequest(preparedWitnessAi)]
        : intent.kind === "ISSUE_COMMAND" && !fishingCommandActive && (
        transitionRequests.length > 0 || commandHasVisibleTranscript
      )
        ? [
            {
              owner: "command",
            transcript: offlineArchiveId ? [] : offlineSessionId ? attachHookChoice(next, offlineSessionId, offlineHook!.speakerId, commandTranscript) : commandTranscript,
            ...(offlineSessionId ? { id: offlineSessionId, aiCharaNum: offlineHook!.speakerId } : {}),
            ...(offlineArchiveId ? { aiRequestId: offlineArchiveId, aiSettlesCommand: true } : {}),
          },
        ]
        : [];
    const counterBaseTranscript = preparedCounterAi?.presentationMode === "replace-authored"
      ? counterEvents.filter((event) => event.kind !== "DIALOGUE_LINE")
      : counterEvents;
    const counterRequest: DialogueEnqueueRequest[] = preparedCounterAi
      ? [{
          id: preparedCounterAi.sessionId,
          owner: "event",
          transcript: counterBaseTranscript,
          aiRequestId: preparedCounterAi.requestId,
          aiCharaNum: preparedCounterAi.target,
        }]
      : counterEvents.length > 0
        ? [{ owner: "event", transcript: counterEvents }]
      : [];
    const invitationAiRequest: DialogueEnqueueRequest[] = preparedInvitationAi
      ? [{
          id: preparedInvitationAi.sessionId,
          owner: "event",
          transcript: [],
          aiRequestId: preparedInvitationAi.requestId,
          aiCharaNum: preparedInvitationAi.target,
        }]
      : [];
    const dialoguePatch = enqueueDialogueRequestsPatch(get(), [
      ...normalCommandRequest,
      ...counterRequest,
      ...invitationAiRequest,
      ...transitionRequests,
    ]);
    const provisionalCounterReplacementKeys = preparedCounterAi?.presentationMode === "replace-authored"
      ? counterEvents
          .filter((event) => event.kind === "DIALOGUE_LINE" && event.origin !== "ai")
          .map((event) => eventInstanceKey(event))
      : [];
    const counterReplacementPatch = provisionalCounterReplacementKeys.length > 0
      ? {
          replacedAuthorLineKeys: [
            ...get().replacedAuthorLineKeys,
            ...provisionalCounterReplacementKeys,
          ].slice(-80),
        }
      : {};
    const deferredPrepared = preparedAi ?? preparedWitnessAi;
    if (deferredPrepared) {
      // `next` is the deterministic projected result used by the prompt. Do
      // not publish it until the streamed reaction finishes, so presentation
      // remains kojo first -> settlement second. The AI-first session joins
      // the counter/invitation requests already computed above.
      if (commandTiming) commandTiming.markPrepared();
      const settlement = createDeferredSettlement(s, next, deferredPrepared.hookGrant
        ? { actor: deferredPrepared.target, sessionId: deferredPrepared.sessionId } : undefined);
      set({ ...dialoguePatch, ...counterReplacementPatch, error: null });
      streamAiIntoSession({
        prepared: deferredPrepared,
        baseState: s,
        fallbackTranscript: commandTranscript,
        settlementEvents: commandTranscript,
        settlement,
        onFinalized: () => finishAiTiming(deferredPrepared),
        onFailed: () => commandTiming?.fail("ai"),
      });
    } else if (offlineHook && offlineSessionId && offlineArchiveId) {
      const lease = createNarrativeDialogueLease(s, offlineHook.speakerId);
      const owner = () => lease.accepts(get().state) && get().dialogueQueue[0]?.id === offlineSessionId
        && get().dialogueQueue[0]?.aiRequestId === offlineArchiveId;
      set({ ...dialoguePatch, ...counterReplacementPatch, error: null });
      void trackMemoryCommit((async () => {
        try {
          const candidate = await prepareAcceptedHookPublication(next, offlineHook.id, owner);
          const live = get();
          const published = candidate && live.state ? lease.merge(candidate, live.state) : null;
          if (!published || !owner()) {
            // Dismissing the window cancels expression publication, not the
            // command's already computed canonical cost. Reset/load wins.
            if (live.state === s) {
              const rollback = cloneGameState(next);
              const original = s.narrativeHooks?.find(h => h.id === offlineHook.id);
              rollback.narrativeHooks = rollback.narrativeHooks?.flatMap(h => h.id !== offlineHook.id ? [h] : original ? [structuredClone(original)] : []);
              const settled = lease.merge(rollback, live.state);
              if (settled) set({ state: settled });
            }
            return;
          }
          syncAgentFactsAndSchedule(published, [offlineHook.speakerId]);
          const queue = live.dialogueQueue.map(session => session.id === offlineSessionId
            ? { ...session, transcript: attachHookChoice(published, offlineSessionId, offlineHook.speakerId, commandTranscript), aiRequestId: undefined } : session);
          set({ state: published, ...dialogueQueueMirrors(queue), error: null });
          commandTiming?.finish("authored");
        } catch (error) {
          const live = get();
          if (!live.state || !owner()) return;
          const rollback = cloneGameState(next);
          const original = s.narrativeHooks?.find(h => h.id === offlineHook.id);
          rollback.narrativeHooks = rollback.narrativeHooks?.flatMap(h => h.id !== offlineHook.id ? [h] : original ? [structuredClone(original)] : []);
          const published = lease.merge(rollback, live.state);
          if (!published) return;
          syncAgentFactsAndSchedule(published, [offlineHook.speakerId]);
          const queue = live.dialogueQueue.map(session => session.id === offlineSessionId ? { ...session,
            transcript: commandTranscript.filter(e => e.kind !== "DIALOGUE_LINE"), aiRequestId: undefined } : session);
          set({ state: published, ...dialogueQueueMirrors(queue), error: `剧情记忆保存失败：${String(error)}` });
          commandTiming?.fail("ai");
        } finally {
          // Reset/load/cancellation must not leave an obsolete pending storage owner.
          const live = get();
          if (live.dialogueQueue.some(session => session.id === offlineSessionId && session.aiRequestId === offlineArchiveId)) {
            set(dialogueQueueMirrors(live.dialogueQueue.filter(session => session.id !== offlineSessionId)));
          }
        }
      })());
    } else {
      if (intent.kind === "ISSUE_COMMAND" && intent.commandNo === 300 && intent.target && result.commandOutcome === "ok"
        && currentAiSettings().enabled && currentAiSettings().narrativeEnabled) {
        const id = `authored-evidence:${nextDialogueSessionId("command")}`;
        const lines = commandTranscript.filter(e => e.kind === "DIALOGUE_LINE" && e.charaNum === intent.target)
          .map(e => ({ text: (e as Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>).text }));
        recordStoryInteraction(next, { id, sessionId: id, speakerId: intent.target, commandNo: 300, lines });
      }
      set({ state: next, ...dialoguePatch, ...counterReplacementPatch, error: null });
      commandTiming?.finish("authored");
    }
    if (preparedCounterAi) {
      const replaceCounterAiLines = (
        lines: ReadonlyArray<AiGeneratedLine>,
        pending: boolean,
      ): void => {
        const ui = get();
        const index = ui.dialogueQueue.findIndex(
          (session) => session.id === preparedCounterAi.sessionId &&
            session.aiRequestId === preparedCounterAi.requestId,
        );
        if (index === -1) return;
        const transcript: ObservationEvent[] = [
          ...counterBaseTranscript,
          ...lines.map((line) => ({
            kind: "DIALOGUE_LINE" as const,
            timestamp: NOW(),
            charaNum: preparedCounterAi.target,
            text: line.text,
            form: line.form,
            origin: "ai" as const,
            ...(line.aiChoice ? { aiChoice: line.aiChoice } : {}),
          })),
        ];
        const queue = ui.dialogueQueue.map((session, sessionIndex) =>
          sessionIndex === index
            ? { ...session, transcript, aiRequestId: pending ? preparedCounterAi.requestId : undefined }
            : session);
        set(dialogueQueueMirrors(queue));
      };
      void generateRealtimeAiKojo(
        preparedCounterAi,
        (partialLines) => replaceCounterAiLines(partialLines, true),
      )
        .then((lines) => replaceCounterAiLines(lines, false))
        .catch(() => {
          const ui = get();
          const index = ui.dialogueQueue.findIndex((session) => session.id === preparedCounterAi.sessionId);
          const queue = index === -1
            ? ui.dialogueQueue
            : ui.dialogueQueue.map((session, sessionIndex) =>
                sessionIndex === index
                  ? { ...session, transcript: [...counterEvents], aiRequestId: undefined }
                  : session);
          const replaced = new Set(provisionalCounterReplacementKeys);
          set({
            ...dialogueQueueMirrors(queue),
            replacedAuthorLineKeys: ui.replacedAuthorLineKeys.filter((key) => !replaced.has(key)),
          });
        });
    }
    if (preparedInvitationAi) {
      const replaceInvitationLines = (
        lines: ReadonlyArray<AiGeneratedLine>,
        pending: boolean,
      ): void => {
        const ui = get();
        const index = ui.dialogueQueue.findIndex(
          (session) => session.id === preparedInvitationAi.sessionId &&
            session.aiRequestId === preparedInvitationAi.requestId,
        );
        if (index === -1) return;
        const transcript: ObservationEvent[] = lines.map((line) => ({
          kind: "DIALOGUE_LINE" as const,
          timestamp: NOW(),
          charaNum: preparedInvitationAi.target,
          text: line.text,
          form: line.form,
          origin: "ai" as const,
          ...(line.aiChoice ? { aiChoice: line.aiChoice } : {}),
        }));
        const queue = ui.dialogueQueue.map((session, sessionIndex) =>
          sessionIndex === index
            ? { ...session, transcript, aiRequestId: pending ? preparedInvitationAi.requestId : undefined }
            : session);
        set(dialogueQueueMirrors(queue));
      };
      void generateRealtimeAiKojo(
        preparedInvitationAi,
        (partialLines) => replaceInvitationLines(partialLines, true),
      )
        .then((lines) => replaceInvitationLines(lines, false))
        .catch(() => {
          // EVENT 27 fallback is presentation-only. On any provider or strict
          // validation failure, silently remove it and leave the invitation
          // card plus deterministic world event intact.
          const ui = get();
          const queue = ui.dialogueQueue.filter((session) => session.id !== preparedInvitationAi.sessionId);
          set(dialogueQueueMirrors(queue));
        });
    }
    if (!deferredPrepared) scheduleNarrativeReadiness(
      intent.kind === "NOOP"
        ? "clock-window"
        : detectEncounterTransition(s, next) ? "arrival" : "command-settled",
    );
  },

  startDanmakuBattleAction(commandNo, target) {
    const state = get().state;
    if (!state || state.danmakuBattle) return false;
    const battleTarget = target ?? 0;
    const targetName = battleTarget === 0 ? "训练弹幕" : state.charas[battleTarget]?.callName;
    if (!targetName) return false;
    const mode = commandNo === 411 ? "training" as const : "duel" as const;
    if (mode === "duel" && ![10, 120].includes(battleTarget)) return false;
    const seed = commandNo * 100003 + state.time.tickValue;
    const router = currentIntentDeps().router;
    const kojoLines = mode === "training" && battleTarget > 0 && router
      ? router.collect(battleTarget, commandNo, state, createRng(seed))
          .map((line) => ({ text: line.text }))
          .filter((line) => line.text.trim().length > 0)
      : [];
    const next = cloneGameState(state);
    next.danmakuBattle = {
      id: `danmaku-${seed}-${battleTarget}`,
      commandNo,
      config: { mode, target: battleTarget, targetName, pattern: patternForTarget(battleTarget, mode), seed },
      startedAtTick: state.time.tickValue,
      inputFrames: [],
      ...(kojoLines.length > 0 ? { kojoLines } : {}),
    };
    set({ state: next, error: null });
    return true;
  },

  appendDanmakuInputsAction(frames) {
    if (frames.length === 0) return;
    const state = get().state;
    if (!state?.danmakuBattle) return;
    const next = cloneGameState(state);
    next.danmakuBattle = { ...next.danmakuBattle!, inputFrames: [...next.danmakuBattle!.inputFrames, ...frames] };
    set({ state: next });
  },

  finishDanmakuBattleAction(outcome, playerLives) {
    const state = get().state;
    const session = state?.danmakuBattle;
    if (!state || !session) return;
    if (session.config.mode === "training") {
      const withoutSession = cloneGameState(state);
      withoutSession.danmakuBattle = null;
      if (outcome === "aborted") { set({ state: withoutSession }); return; }
      const eventLogLengthBeforeSettlement = withoutSession.eventLog.length;
      const settled = applyIntent(withoutSession, { kind: "ISSUE_COMMAND", actor: 0, commandNo: 411, ...(session.config.target > 0 ? { target: session.config.target } : {}) });
      if (session.kojoLines?.length) {
        settled.state.eventLog = [
          ...settled.state.eventLog.slice(0, eventLogLengthBeforeSettlement),
          ...settled.state.eventLog.slice(eventLogLengthBeforeSettlement).filter((event) => event.kind !== "DIALOGUE_LINE"),
        ];
      }
      set({ state: settled.state, error: null });
      return;
    }
    const next = cloneGameState(state);
    next.danmakuBattle = null;
    const won = outcome === "victory";
    const battle = settleDanmakuBattleCore(next, session.config.target, {
      won,
      opponentRemaining: won ? 0 : 1,
      masterRemaining: won ? Math.max(1, playerLives) : 0,
      turns: session.inputFrames.length,
      log: [],
    });
    if (battle.favorBonus !== 0) setTflag(next, TFLAG_ID.好感度BONUS, battle.favorBonus);
    const name = session.config.targetName;
    const events: ObservationEvent[] = [
      { kind: "NARRATION", timestamp: NOW(), text: won ? `你赢得了和${name}的胜负！` : `你输给了${name}……` },
      ...(battle.firstWin ? [{ kind: "NARRATION" as const, timestamp: NOW(), text: `【第一次战胜${name}】` }] : []),
      ...(battle.strongEnemyBonus ? [{ kind: "NARRATION" as const, timestamp: NOW(), text: "【强敌BONUS！所获经验提高】" }] : []),
      ...applySourceCheck(next, session.config.target, { [SOURCE_ID.歓楽]: battle.sourcePleasure }, 0, battle.trustSeed).events.map((event) => ({ ...event, timestamp: NOW() })),
      ...advanceTimeTicks(next, 60).map((event) => ({ ...event, timestamp: NOW() })),
    ];
    next.eventLog = [...next.eventLog, ...events];
    set({ state: finalizeActivityState(next, state.time.tickValue, 480), error: null });
  },

  finishFishingAction(outcome, remainingLine) {
    const state = get().state;
    if (!state?.fishingGame) return;
    const settled = finishFishingSession(state, outcome, remainingLine, NOW, {
      dialogueRouter: currentIntentDeps().router,
    });
    // Non-kojo events go straight into the persistent eventLog. The kojo
    // branch stays on the settlement payload until the player dismisses
    // the in-scene terminal phase card.
    const next: GameState = { ...settled.state, eventLog: [...settled.state.eventLog, ...settled.events], fishingSettlement: settled.settlement };
    set({ state: finalizeActivityState(next, state.time.tickValue, 621), error: null });
  },

  commitFishingSettlementAction() {
    const state = get().state;
    if (!state?.fishingSettlement) return;
    const settlement = state.fishingSettlement;
    const kojoEvents: ObservationEvent[] = settlement.settlementKojo.map((entry) => ({
      kind: "DIALOGUE_LINE" as const,
      charaNum: entry.charaNum,
      text: entry.text,
      timestamp: NOW(),
      ...(entry.form ? { form: entry.form } : {}),
    }));
    const next: GameState = {
      ...state,
      eventLog: [...state.eventLog, ...kojoEvents],
      fishingSettlement: null,
    };
    set({ state: next, error: null });
  },

  startStoneContestAction(options) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "lobby") return false;
    const next = startStoneContest(state, options);
    if (next.stoneContestSession?.phase !== "round") return false;
    set({ state: next, error: null });
    return true;
  },

  appendStoneContestPlacementAction(operation) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "round") return;
    set({ state: appendStoneContestPlacement(state, operation) });
  },

  advanceStoneContestClockAction(targetFrame) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "round") return;
    set({ state: advanceStoneContestClock(state, targetFrame), error: null });
  },

  resolveStoneContestRoundAction() {
    const state = get().state;
    const session = state?.stoneContestSession;
    if (!state || !session || session.phase !== "round") return;
    const next = session.mode === "couple" ? resolveStoneCouple(state) : resolveSoloStoneRound(state);
    set({ state: next, error: null });
  },

  continueStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: continueStoneContest(state), error: null });
  },

  withdrawStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: withdrawStoneContest(state), error: null });
  },

  forfeitStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: forfeitStoneContestRound(state), error: null });
  },

  commitStoneContestSettlementAction() {
    const state = get().state;
    if (!state) return;
    const settled = commitStoneContestSettlement(state, NOW);
    set({ state: finalizeActivityState(settled, state.time.tickValue, 633), error: null });
  },

  renameStoneContestClerkAction(name) {
    const state = get().state;
    if (!state) return;
    set({ state: renameStoneContestClerk(state, name), error: null });
  },

  advanceStoneClerkStoryAction() {
    const state = get().state;
    if (!state) return;
    set({ state: advanceStoneClerkStory(state), error: null });
  },

  leaveStoneContestLobbyAction() {
    const state = get().state;
    if (!state) return;
    set({ state: leaveStoneContestLobby(state), error: null });
  },

  buyFishingGearAction(kind, id) {
    const state = get().state;
    if (!state) return { ok: false, message: "尚未载入游戏状态。", spent: 0 };
    if (state.master.location !== "魔法之森:香霖堂") return { ok: false, message: "只有在香霖堂才能购买钓具。", spent: 0 };
    const next = cloneGameState(state);
    const result = buyFishingGear(next, kind, id);
    if (result.ok) {
      const event: ObservationEvent = { kind: "NARRATION", timestamp: NOW(), text: `香霖堂：${result.message}` };
      next.eventLog = [...next.eventLog, event];
      set({ state: next, error: null });
    }
    return result;
  },

  resolvePromptAnswer(answer) {
    const pp = get().pendingPrompt;
    if (!pp) return;
    set({ pendingPrompt: null });
    const choice =
      answer.kind === "pick_one"
        ? answer.value
        : answer.kind === "ask_yn"
          ? (answer.value ? 1 : 0)
          : null;
    const promptAnswer: PromptAnswer =
      pp.staged && choice !== null
        ? { kind: "pick_sequence", values: [...(pp.selections ?? []), choice] }
        : answer;
    // Re-issue with the answer. Staged handlers are intercepted again until
    // their prompt returns null; ordinary B9 handlers settle immediately.
    get().applyIntentAction({
      kind: "ISSUE_COMMAND",
      actor: 0,
      commandNo: pp.commandNo,
      target: pp.target,
      promptAnswer,
    });
  },

  cancelPrompt() {
    set({ pendingPrompt: null });
  },

  resolveFestivalEventAction(answer) {
    const state = get().state;
    if (!state) return;
    const result = resolveFestivalEvent(state, answer, NOW);
    if (!result) return;
    set({
      state: {
        ...result.state,
        eventLog: [...result.state.eventLog, result.event],
      },
      error: null,
    });
  },

  // P2-02 — toggle the dedicated 家庭菜園 surface. Closing also drops any
  // pending B9 prompt (so a stray option from the prior picker can't
  // resurrect in the next command); opening does NOT clear it because the
  // 418 prompt is the spec the FarmScreen renders.
  setFarmScreenOpen(open) {
    if (open) {
      set({ farmScreenOpen: true });
      return;
    }
    const pp = get().pendingPrompt;
    if (pp && pp.commandNo === 418) {
      set({ farmScreenOpen: false, pendingPrompt: null });
    } else {
      set({ farmScreenOpen: false });
    }
  },

  resolveMobMealAction(answer) {
    const state = get().state;
    if (!state?.mobMealSession) return;
    const next = cloneGameState(state);
    const oldTick = next.time.tickValue;
    const events = resolveMobMeal(next, answer, NOW);
    const rng = createRng(oldTick * 1009 + 202);
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng,
    });
    next.eventLog = [...next.eventLog, ...events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  resolveOutingEventAction() {
    const state = get().state;
    const session = state?.outingEventSession;
    if (!state || !session) return;
    // The legacy outing-ev1 modal is retired; clear it without settlement.
    if (session.kind === "outing-ev1") {
      const nextResult = resolveOutingEventSession(state);
      const next = nextResult.state;
      next.eventLog = [...next.eventLog, ...nextResult.events];
      set({ state: next, error: null });
      return;
    }
    // outing-choice sessions should be answered via resolveOutingChoiceAction;
    // calling the legacy resolver without an answer is a no-op.
    if (session.kind === "outing-choice") {
      return;
    }
    const nextResult = resolveOutingEventSession(state);
    const next = nextResult.state;
    const oldTick = state.time.tickValue;
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 301),
    });
    next.eventLog = [...next.eventLog, ...nextResult.events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  resolveOutingChoiceAction(answer) {
    const state = get().state;
    const session = state?.outingEventSession;
    if (!state || !session) return;
    if (session.kind !== "outing-choice") return;
    // The runtime hands the result events + final TFLAG bits + tick advance to
    // the `outing-choice-result` session. The popup persists; the events stay
    // inside the dark event-frame (实玩反馈: 路上遭遇完整呈现) until the player
    // explicitly dismisses via `closeOutingChoiceResultAction`.
    const nextResult = resolveOutingEventSession(state, { eventId: session.eventId, value: answer });
    const next = nextResult.state;
    const oldTick = state.time.tickValue;
    // The tick advanced inside the runtime; reproject schedules across the
    // delta so NPC positions move with the player while the result panel is
    // still up. Do NOT push result events to the eventLog yet — that happens
    // on close, so the popup stays the single source of truth for the
    // outcome text.
    reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 311),
    });
    set({ state: next, error: null });
  },

  closeOutingChoiceResultAction() {
    const state = get().state;
    if (!state || !state.outingEventSession) return;
    if (state.outingEventSession.kind !== "outing-choice-result") return;
    const { state: next, events } = commitOutingChoiceResult(state);
    const oldTick = state.time.tickValue;
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 311),
    });
    next.eventLog = [...next.eventLog, ...events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  cancelOutingChoiceAction() {
    const state = get().state;
    if (!state?.outingEventSession || state.outingEventSession.kind !== "outing-choice") return;
    const next = cloneGameState(state);
    next.outingEventSession = null;
    set({ state: next, error: null });
  },

  resolveMobGirlMemoryAction(remember, replaceSlot) {
    const state = get().state;
    if (!state?.mobGirlMemorySession) return;
    const next = cloneGameState(state);
    const message = resolveMobGirlMemory(next, remember, replaceSlot);
    if (!message) return;
    next.eventLog = [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: message }];
    set({ state: next, error: null });
    get().finishSleepAction();
  },

  walkPathAction(rooms) {
    const s = get().state;
    if (s === null || rooms.length === 0) return;
    if (hasPendingDeferringAi()) {
      set({ error: "移动无法执行：请先完成当前口上或选择。" });
      return;
    }
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const routeSalt = rooms.reduce((acc, room) => {
      let value = acc;
      for (let i = 0; i < room.length; i += 1) value = (value * 31 + room.charCodeAt(i)) >>> 0;
      return value;
    }, rooms.length);
    const rng = createRng(next.time.tickValue * 31 + routeSalt);
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const walkRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const { events } = startSkipMove(next, rooms, NOW, 0, { dialogueRouter: walkRouter, rng });

    const fmSeed = next.time.tickValue * 31 + routeSalt;
    const transition = detectEncounterTransition(s, next);
    scheduleLazyMaterializationForTransition(transition);
    const first = transition
      ? runFirstMeetingsForTransition(
          next,
          transition,
          { now: NOW, router, rng },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const allEvents = first.events.length > 0 ? [...events, ...first.events] : events;
    // Use a deterministic seed keyed on the route so a replay always produces
    // the same choice-encounter sequence.

    // Arrival-popup wiring (2026-07-04): if the destination has a present
    // NPC, the player reached an occupied room — pull the destination-
    // encounter kojo out of the eventLog tail and surface it via the
    // InteractionBox modal instead of the scene band. Without a present
    // NPC, the band handles narration as before.
    const dest = rooms[rooms.length - 1]!;
    let pendingArrivalEvents: ObservationEvent[] | null = null;
    let logEvents = allEvents;
    if (hasNpcAt(next, dest)) {
      const arrivalStart = allEvents.findIndex(
        (e) => e.kind === "DIALOGUE_LINE",
      );
      if (arrivalStart !== -1) {
        pendingArrivalEvents = allEvents.slice(arrivalStart);
        logEvents = allEvents.slice(0, arrivalStart);
      }
    }

    const capturedEventKojo = pendingEventKojo.current;
    const pendingChoice: DialogueChoiceSession | null = capturedEventKojo
      ? capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: fmSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: fmSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
      : transition
        ? encounterChoiceSession(
            first,
            transition,
            fmSeed,
            0,
            Math.max(0, logEvents.length - events.length),
          )
        : null;
    const owner: DialogueSessionOwner = capturedEventKojo
      ? capturedEventKojo.kind === "event" ? "event" : "diary"
      : first.pending ? "encounter" : "arrival";
    set({
      state: { ...next, eventLog: [...next.eventLog, ...logEvents] },
      ...enqueueDialoguePatch(get(), owner, pendingArrivalEvents, pendingChoice),
      error: null,
    });
  },

  clearArrivalPopup() {
    const continuationId = get().dialogueQueue[0]?.choice?.continuationId;
    if (continuationId) currentIntentDeps().router?.cancelContinuation?.(continuationId);
    const requestId = get().dialogueQueue[0]?.aiRequestId;
    if (requestId) cancelRealtimeAiKojo(requestId);
    set(advanceDialoguePatch(get()));
    // An arrival is its own readiness entry point: the player just walked into
    // a scene, which is exactly when a story placed there may present itself.
    scheduleNarrativeReadiness("arrival");
  },

  clearCompletedDialogueBeforeNavigationAction() {
    const queue = get().dialogueQueue;
    if (queue.some((session) => session.choice !== null || session.aiRequestId !== undefined)) return false;
    if (queue.length === 0) return true;
    cancelDialogueSessions(queue);
    set(dialogueQueueMirrors([]));
    return true;
  },

  // KOJO-CHOICE-PLAN P3 — resume a paused first-meeting ENCOUNTER kojo.
  // Appends the picked option index to the session and replays the kojo
  // with the same seed. If it runs to completion, `pendingKojoChoice` is
  // cleared; if it pauses again, the new options replace the buffer.
  resolveKojoChoiceAction(optionIndex) {
    const s = get().state;
    const session = get().pendingKojoChoice;
    if (s === null || session === null) return;
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const legacyOptionIndex = typeof optionIndex === "number" ? optionIndex : null;
    const choices = legacyOptionIndex === null ? [] : [...session.choices, legacyOptionIndex];
    const rng = createRng(session.seed);
    const finishCommandChoice = (
      settled: GameState,
      transcript: readonly ObservationEvent[],
      resolution: KojoResolution | undefined,
    ): void => {
      syncAgentFactsAndSchedule(settled, [session.charaNum]);
      clearTurnContext(settled);
      const history = recordAiCommand({
        target: session.charaNum,
        commandNo: session.commandNo!,
        outcome: "ok",
        state: settled,
        beforeState: s,
        events: transcript,
      });
      const prepared = prepareRealtimeAiKojo({
        target: session.charaNum,
        commandNo: session.commandNo!,
        outcome: "ok",
        beforeState: s,
        afterState: settled,
        events: transcript,
        router,
        historyEntryId: history.id,
        seed: session.seed,
        authoredResolution: resolution,
      });
      if (prepared && startResolvedCommandChoiceAi(prepared, settled, transcript)) return;
      set({
        state: settled,
        ...replaceActiveDialoguePatch(get(), transcript, null),
        error: resolution?.status === "unsupported" ? "VM kojo continuation failed" : null,
      });
    };
    if (session.kind === "command" && session.commandNo !== undefined) {
      if (session.continuationId && router?.resumeContinuation) {
        const value = session.continuationInputMode
          ? optionIndex
          : typeof optionIndex === "number" ? session.continuationValues?.[optionIndex] : undefined;
        if ((session.continuationInputMode === "number" && typeof value !== "number")
          || (session.continuationInputMode === "string" && typeof value !== "string")) {
          set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], session), error: "invalid VM kojo input" });
          return;
        }
        if (value === undefined) {
          router.cancelContinuation?.(session.continuationId);
          set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], null), error: "invalid VM kojo choice" });
          return;
        }
        const vm = router.resumeContinuation(session.continuationId, value);
        const baseEvents = mergeReplayedTranscript(
          get().pendingArrivalEvents ?? [],
          session.transcriptStart,
          kojoLinesToEvents(vm.resolution.lines, session.charaNum),
        );
        if (vm.pending && vm.continuationId) {
          const nextChoice: DialogueChoiceSession = {
            ...session,
            options: [...vm.pending.options],
            continuationId: vm.continuationId,
            continuationValues: vm.pending.values ? [...vm.pending.values] : undefined,
            continuationInputMode: vm.pending.inputMode,
          };
          set({ state: next, ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice), error: null });
          return;
        }
        const settled = vm.resolution.effects.length > 0 ? applyKojoEffects(next, vm.resolution.effects) : next;
        finishCommandChoice(settled, baseEvents, vm.resolution);
        return;
      }
      if (legacyOptionIndex === null) return;
      // IMPORTANT: the seed must be the same as the first call so the
      // replay deterministically retraces the pre-choice lines.
      const kojo = commandKojoEventsFromSession(
        {
          state: next,
          actor: 0,
          target: session.charaNum,
          commandNo: session.commandNo,
          rng,
          rngSeed: session.seed,
          now: NOW,
          dialogueRouter: router,
        },
        { charaNum: session.charaNum, commandNo: session.commandNo, choices },
      );
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojo.events,
      );
      if (kojo.pendingKojoChoice) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...kojo.pendingKojoChoice.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      const settled = kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next;
      finishCommandChoice(settled, baseEvents, kojo.resolution);
      return;
    }
    if (session.kind === "dayevent" && session.subid !== undefined) {
      if (legacyOptionIndex === null) return;
      const kojo = dayEventKojoEventsFromSession(
        next,
        {
          charaNum: session.charaNum,
          subid: session.subid,
          args: session.args,
          choices,
        },
        router,
        rng,
        NOW,
      );
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojo.events,
      );
      if (kojo.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...kojo.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind === "event" && session.arm !== undefined) {
      if (legacyOptionIndex === null) return;
      const r = router?.resolveEventKojoInteractive
        ? router.resolveEventKojoInteractive(
          session.charaNum,
          session.arm,
          next,
          rng,
          session.args,
          choices,
        )
        : (() => {
            const detailed = router?.resolveEventKojoDetailed?.(
              session.charaNum,
              session.arm,
              next,
              rng,
              session.args ? [...session.args] : undefined,
            );
            return {
              status: detailed?.status ?? "not-authored",
              lines: detailed?.lines ??
                router?.resolveEventKojo(session.charaNum, session.arm, next, rng, session.args) ??
                [],
              pending: null,
              effects: detailed?.effects ?? [],
              unsupportedPredicates: detailed?.unsupportedPredicates ?? [],
              unsupportedEffects: detailed?.unsupportedEffects ?? [],
              diagnostics: detailed?.diagnostics ?? [],
            };
          })();
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojoLinesToEvents(r.lines, session.charaNum),
      );
      if (r.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...r.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: r.effects?.length ? applyKojoEffects(next, r.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind === "diary" && session.page !== undefined) {
      if (legacyOptionIndex === null) return;
      const r = router?.resolveDiaryKojoInteractive
        ? router.resolveDiaryKojoInteractive(
          session.charaNum,
          session.page,
          next,
          rng,
          session.args,
          choices,
        )
        : (() => {
            const detailed = router?.resolveDiaryKojoDetailed?.(
              session.charaNum,
              session.page,
              next,
              rng,
              session.args ? [...session.args] : undefined,
            );
            return {
              status: detailed?.status ?? "not-authored",
              lines: detailed?.lines ??
                router?.resolveDiaryKojo?.(session.charaNum, session.page, next, rng, session.args) ??
                [],
              pending: null,
              effects: detailed?.effects ?? [],
              unsupportedPredicates: detailed?.unsupportedPredicates ?? [],
              unsupportedEffects: detailed?.unsupportedEffects ?? [],
              diagnostics: detailed?.diagnostics ?? [],
            };
          })();
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojoLinesToEvents(r.lines, session.charaNum),
      );
      if (r.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...r.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: r.effects?.length ? applyKojoEffects(next, r.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind !== "encounter") return;
    if (session.continuationId && router?.resumeContinuation) {
      const value = session.continuationInputMode
        ? optionIndex
        : typeof optionIndex === "number" ? session.continuationValues?.[optionIndex] : undefined;
      if ((session.continuationInputMode === "number" && typeof value !== "number")
        || (session.continuationInputMode === "string" && typeof value !== "string") || value === undefined) {
        router.cancelContinuation?.(session.continuationId);
        set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], null), error: "invalid VM encounter input" });
        return;
      }
      const vm = router.resumeContinuation(session.continuationId, value);
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [], session.transcriptStart,
        kojoLinesToEvents(vm.resolution.lines, session.charaNum),
      );
      if (vm.pending && vm.continuationId) {
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, {
            ...session, options: [...vm.pending.options], continuationId: vm.continuationId,
            continuationValues: vm.pending.values ? [...vm.pending.values] : undefined,
            continuationInputMode: vm.pending.inputMode,
          }),
          error: null,
        });
        return;
      }
      if (vm.resolution.status === "unsupported") {
        set({ state: next, ...replaceActiveDialoguePatch(get(), baseEvents, null), error: "VM encounter continuation failed" });
        return;
      }
      const settled = vm.resolution.effects.length > 0 ? applyKojoEffects(next, vm.resolution.effects) : next;
      const met = settled.charas[session.charaNum];
      if (met) {
        setCharaCflag(settled, session.charaNum, CFLAG_ID.认识, 1);
        setCharaCflag(settled, session.charaNum, CFLAG_ID.最后见面的日子, settled.time.dayIndex);
        met.state.TCVAR[TCVAR_ID.今天有否见面] = 1;
      }
      const continuation = session.encounterContinuation;
      if (continuation && continuation.candidateCharaNums.length > 0) {
        const transition: EncounterTransition = { kind: continuation.kind, location: continuation.location, candidateCharaNums: [...continuation.candidateCharaNums] };
        const continued = runFirstMeetingsForTransition(settled, transition, { now: NOW, router, rng });
        const nextChoice = encounterChoiceSession(continued, transition, session.seed, baseEvents.length);
        set({ state: settled, ...replaceActiveDialoguePatch(get(), [...baseEvents, ...continued.events], nextChoice), error: null });
        return;
      }
      set({ state: settled, ...replaceActiveDialoguePatch(get(), baseEvents, null), error: null });
      return;
    }
    const r = runFirstMeeting(
      next,
      session.charaNum,
      { now: NOW, router, rng },
      choices,
      { replaying: true },
    );
    const baseEvents = mergeReplayedTranscript(
      get().pendingArrivalEvents ?? [],
      session.transcriptStart,
      r.events,
    );
    if (r.pending) {
      // Still paused — refresh the buffer with the cumulative lines and
      // keep the session growing; the player will pick again.
      set({
        state: next,
        ...replaceActiveDialoguePatch(
          get(),
          baseEvents,
          { ...session, choices, options: r.pending.options },
        ),
        error: null,
      });
      return;
    }
    const continuation = session.encounterContinuation;
    if (continuation && continuation.candidateCharaNums.length > 0) {
      const transition: EncounterTransition = {
        kind: continuation.kind,
        location: continuation.location,
        candidateCharaNums: [...continuation.candidateCharaNums],
      };
      const continued = runFirstMeetingsForTransition(
        next,
        transition,
        { now: NOW, router, rng },
      );
      const continuationStart = baseEvents.length;
      const completedEvents = [...baseEvents, ...continued.events];
      const nextChoice = encounterChoiceSession(
        continued,
        transition,
        session.seed,
        continuationStart,
      );
      set({
        state: next,
        ...replaceActiveDialoguePatch(get(), completedEvents, nextChoice),
        error: null,
      });
      return;
    }

    // Kojo finished and there are no remaining scene candidates.
    set({
      state: next,
      ...replaceActiveDialoguePatch(get(), baseEvents, null),
      error: null,
    });
  },

  resolveWalkEncounterAction(choice) {
    const s = get().state;
    if (s === null || !s.walkSession) return;
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const ws = next.walkSession;
    if (!ws) return;
    // The pause is either a mid-walk encounter or a locked-door (潜入/算了);
    // seed the RNG from whichever owner is present so 潜入's wake roll is stable.
    const owner = ws.lockedDoor?.ownerCharaNum ?? ws.encounter?.charaNum ?? 0;
    const choiceSalt =
      choice === "stop" ? 1 : choice === "ignore" ? 2 : choice === "sneak" ? 4 : choice === "giveup" ? 5 : 3;
    const seed = next.time.tickValue * 31 + owner * 7 + choiceSalt;
    const rng = createRng(seed);
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const walkRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const { events, eventKojoMeta } = resolveWalkEncounter(next, choice, NOW, 0, { dialogueRouter: walkRouter, rng });

    // EVENT kojo AI fallback: when a world event (sneak-in) has no authored
    // dialogue, trigger L1 AI completion (same pattern as command kojo).
    if (eventKojoMeta?.needsAi) {
      const prepared = prepareRealtimeAiEventKojo({
        target: eventKojoMeta.target,
        eventArm: eventKojoMeta.eventArm,
        eventSub: eventKojoMeta.eventSub,
        state: next,
        router,
        seed,
        context: identifyEventKojoContext(eventKojoMeta.eventArm, eventKojoMeta.eventSub),
        contextDescription: buildEventKojoDescription(next, eventKojoMeta),
      });
      if (prepared) {
        // Generate AI kojo asynchronously and append to dialogue
        void generateRealtimeAiKojo(prepared).then((aiLines) => {
          const liveState = get().state;
          if (!liveState) return;
          // This append replaces the state object; defer while another
          // realtime AI request streams (the set would cancel its stream).
          if (hasPendingRealtimeAi()) return;
          // Convert AI lines to DIALOGUE_LINE events
          const aiEvents = aiLines.map((line) => ({
            kind: "DIALOGUE_LINE" as const,
            timestamp: Date.now(),
            charaNum: eventKojoMeta.target,
            text: line.text,
            form: line.form,
          }));
          // Append to event log
          set({
            state: {
              ...liveState,
              eventLog: [...liveState.eventLog, ...aiEvents],
            },
          });
        }).catch((error) => {
          console.warn("[EVENT-KOJO-AI] Generation failed:", error);
        });
      }
    }

    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...events] },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: null,
      });
      return;
    }
    const transition = detectEncounterTransition(s, next);
    scheduleLazyMaterializationForTransition(transition);
    const first = transition
      ? runFirstMeetingsForTransition(
          next,
          transition,
          { now: NOW, router, rng: createRng(seed + 17) },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const { inline, popup } = splitArrivalKojo(first.events);
    const pendingChoice = transition
      ? encounterChoiceSession(first, transition, seed + 17, 0, inline.length)
      : null;
    set({
      state: {
        ...next,
        eventLog: [...next.eventLog, ...events, ...inline],
      },
      ...enqueueDialoguePatch(get(), "encounter", popup, pendingChoice),
      error: null,
    });
  },

  finishSleepAction(dailyEventAnswer) {
    const s = get().state;
    if (s === null) return;
    if (s.mobGirlMemorySession) return;
    const activeDailyEvent = s.dailyEventSession ?? null;
    if (activeDailyEvent && dailyEventAnswer === undefined) return;
    if (!activeDailyEvent && dailyEventAnswer !== undefined) return;
    const next = cloneGameState(s);
    // DAYEVENT (Slice 1) — pass the live router + a seeded RNG so
    // night/morning subevents can fire SP_EVENT kojo and write the
    // MVP source-derived effects. RNG seed = dayIndex × 31 + a salt so
    // each night/morning has its own deterministic draw. Without
    // currentIntentDeps() (e.g. before App.tsx has wired a router),
    // the call falls back to undefined → DAYEVENT is silently skipped.
    const { router } = currentIntentDeps();
    const sleepSeed = activeDailyEvent?.sleepSeed ?? ((next.time.dayIndex + 1) * 31 + 7 + Math.floor(Math.random() * 1000000));
    const rng = createRng(sleepSeed);
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const dayEventRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    // P0-1 (实玩反馈 #12): finishPlayerSleep runs advanceClock /
    // reprojectSchedules / executeDayEvent / greetingLinesFromRouter — any
    // throw here used to skip the set() below, leaving sleepSession set and
    // the NightSettlementScreen permanently pending (the auto-settlement
    // step looked dead). Wrap it so a settlement error can NEVER lock the
    // UI: on failure we roll back every partial settlement write, then clear
    // only the UI-blocking sleep state on a fresh clone of the pre-settlement
    // save. A failed DAYEVENT/router must never leave a half-advanced day that
    // cannot be safely retried or reasoned about.
    let events = [] as ReturnType<typeof finishPlayerSleep>;
    try {
      events = finishPlayerSleep(next, NOW, dayEventRouter, rng, {
        sleepSeed,
        ...(dailyEventAnswer === undefined
          ? {}
          : {
              answer: typeof dailyEventAnswer === "boolean"
                ? { kind: "ask_yn", value: dailyEventAnswer } as const
                : dailyEventAnswer,
            }),
      });
    } catch (e) {
      const recovered = cloneGameState(s);
      recovered.sleepSession = null;
      // Clear the 睡眠 flag through the namespace-safe accessor (the UI layer
      // must not reach into the legacy per-chara namespaces directly — see the
      // forbidden-names guard test).
      setMasterCflag(recovered, CFLAG_ID.睡眠, 0);
      const recoveryEvents = [
        {
          kind: "NARRATION" as const,
          timestamp: NOW(),
          text: "夜间结算出现异常，已跳过夜事件并强制醒来。",
        },
      ];
      events = recoveryEvents as ReturnType<typeof finishPlayerSleep>;
      events.nightReportOnly = [];
      events.morningDialogue = [];
      events.persistentHistory = recoveryEvents;
      set({
        state: { ...recovered, eventLog: [...recovered.eventLog, ...events.persistentHistory] },
        error: `sleep settlement failed: ${String(e)}`,
      });
      return;
    }
    if (events.pendingDailyEvent) {
      const paused = cloneGameState(s);
      paused.dailyEventSession = events.pendingDailyEvent.session;
      set({ state: paused, error: null });
      return;
    }
    // Keep old/test adapters safe while the structured sleep result rolls out:
    // production always supplies these categories, but a legacy array result
    // is still treated as persistent history rather than crashing the wake
    // transition.
    const settlementHistory = events.persistentHistory ?? events;
    const settlementMorningDialogue = events.morningDialogue ?? events.filter((e) => e.kind === "DIALOGUE_LINE");
    const settlementNightReport = events.nightReportOnly ?? [];
    const dailyEventError = events.dailyEventDiagnostics?.length
      ? `daily event failed closed: ${events.dailyEventDiagnostics.map((entry) =>
          `${entry.eventId ?? "?"}/${entry.phase}: ${entry.message}`).join("; ")}`
      : null;
    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const pendingChoice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: sleepSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...settlementHistory] },
        ...enqueueDialoguePatch(
          get(),
          "event",
          [
            ...settlementNightReport.filter((e) => e.kind === "DIALOGUE_LINE"),
            ...settlementMorningDialogue,
          ],
          pendingChoice,
          next.time.dayIndex,
        ),
        error: dailyEventError,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: sleepSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: sleepSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...settlementHistory] },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          [
            ...settlementNightReport.filter((e) => e.kind === "DIALOGUE_LINE"),
            ...settlementMorningDialogue,
          ],
          pendingChoice,
          next.time.dayIndex,
        ),
        error: dailyEventError,
      });
      return;
    }
    // Invalidate the previous night's disposable work before scheduling any
    // new wake-transition materialization. The generation is captured for the
    // deferred sidecar below, so a same-day wake or load cannot resurrect the
    // old settlement after this synchronous report has been committed.
    cancelAgentNightCycle();
    cancelDaytimeReactions("day changed");
    cancelLazyMaterializationFromStore("day changed");
    // The wait gate for THIS night — created synchronously (before the
    // deferred launch) so `awaitNightCycle` is racable the moment the sleep
    // settlement returns; the [100] 睁开眼睛 handler and the morning-menu
    // status screen both subscribe to it. The scoped settle below belongs to
    // exactly this cycle.
    const settleNightCycle = beginAgentNightPromise();
    const nightGeneration = agentNightGeneration;
    const wakeTransition = detectEncounterTransition(s, next);
    scheduleLazyMaterializationForTransition(wakeTransition);
    const firstSeed = sleepSeed + 11;
    const first = wakeTransition
      ? runFirstMeetingsForTransition(
          next,
          wakeTransition,
          { now: NOW, router, rng: createRng(firstSeed) },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const { inline, popup } = splitArrivalKojo(first.events);
    const pendingChoice = wakeTransition
      ? encounterChoiceSession(first, wakeTransition, firstSeed, 0, inline.length)
      : null;
    set({
      state: { ...next, eventLog: [...next.eventLog, ...settlementHistory, ...inline] },
      // Ordinary EVENT 2 morning lines are returned by the runtime as
      // DIALOGUE_LINE events.  Keep them in the owner-aware dialogue queue;
      // eventLog alone is only the audit trail and is not rendered by the
      // InteractionBox.  Encounter popup lines follow them when present.
      ...enqueueDialoguePatch(
        get(),
        popup && popup.length > 0 ? "encounter" : "event",
         [...settlementMorningDialogue, ...(popup ?? [])],
        pendingChoice,
        next.time.dayIndex,
      ),
      error: dailyEventError,
    });
    scheduleNarrativeReadiness("morning");
    // A4 — start the nightly AI barrier only after deterministic state/report
    // has been committed and had one paint opportunity. Ledger snapshotting
    // and cloneGameState are synchronous; doing them before this set made
    // the "正在结算" screen wait even when the provider itself was fully
    // asynchronous. L2 Night uses at most three provider slots while the
    // automatic L3 Director owns the fourth; both must settle before the
    // morning gate opens, so L3 cannot become stale because play resumed.
    const aiSettings = useAiStore.getState().settings;
    setTimeout(() => {
      const current = get().state;
      if (!current || current.time.dayIndex !== next.time.dayIndex) {
        settleNightCycle();
        return;
      }
      if (nightGeneration !== agentNightGeneration) {
        settleNightCycle();
        return;
      }
      const generation = nightGeneration;
      const requestDay = next.time.dayIndex;
      const observationDay = Math.max(0, requestDay - 1);
      const agentSnapshot = cloneGameState(current);
      const nightContextHash = computeAgentNightBatchContextHash(agentSnapshot, observationDay);
      const baselineDecisionIds = new Set(
        (agentSnapshot.agentRuntime?.acceptedDecisions ?? []).map((decision) => decision.id),
      );
      const controller = new AbortController();
      agentNightController = controller;
      const nightRequestId = `night:${generation}:${requestDay}`;
      agentAsyncRequests.set(`night:${nightRequestId}`, {
        owner: "night",
        requestId: nightRequestId,
        generation,
        dayIndex: requestDay,
        contextHash: nightContextHash,
      });
      set({ nightCycleStatus: { running: true, dayIndex: requestDay, phase: "preparing", entries: [] } });
      const onProgress = (progress: NightCycleProgress) => {
        // Drop stale updates from a superseded cycle (load/new-game raced in).
        if (generation !== agentNightGeneration) return;
        set({
          nightCycleStatus: {
            // Agent Night may finish before L3. Keep the wake gate visibly
            // active until the coordinator's Promise.allSettled completes.
            running: true,
            dayIndex: requestDay,
            phase: progress.phase,
            entries: progress.entries,
          },
        });
      };
      const nightArchiveBaseline = structuredClone(agentSnapshot.agentRuntime?.memoryArchive);
      const agentTask = runMultiAgentNightCycle(agentSnapshot, aiSettings, {
        signal: controller.signal,
        observationDayIndex: observationDay,
        maxConcurrency: MAX_NIGHT_LLM_CONCURRENCY - 1,
        onProgress,
      }).then((allResults) => {
        if (generation !== agentNightGeneration || controller.signal.aborted) return;
        if (!allResults || allResults.length === 0) return;
        const s = get();
        if (!s.state || s.state.time.dayIndex !== requestDay) return;
        const snapshotRuntime = agentSnapshot.agentRuntime;
        if (!snapshotRuntime) return;
        const cognitions = Object.fromEntries(allResults
          .map((result) => result.charaNum)
          .filter((charaNum) => snapshotRuntime.cognitions[charaNum])
          .map((charaNum) => [charaNum, structuredClone(snapshotRuntime.cognitions[charaNum]!) ]));
        const nightEvents: ObservationEvent[] = [];
        for (const result of allResults) {
          for (const e of result.events) {
            if (e.kind !== "NARRATION" && e.kind !== "DIALOGUE_LINE") continue;
            nightEvents.push({
              kind: e.kind,
              text: e.text,
              timestamp: NOW(),
              charaNum: e.charaNum,
            } as ObservationEvent);
          }
        }
        const committed = commitAgentAsyncPatch(s.state, {
          owner: "night",
          requestId: nightRequestId,
          generation,
          dayIndex: requestDay,
          observationDayIndex: observationDay,
          contextHash: nightContextHash,
          signal: controller.signal,
          cognitions,
          acceptedDecisions: snapshotRuntime.acceptedDecisions
            .filter((decision) => !baselineDecisionIds.has(decision.id)),
          decisionSeq: snapshotRuntime.decisionSeq,
          nightEvents,
          memoryArchive: snapshotRuntime.memoryArchive,
          memoryArchiveBaseline: nightArchiveBaseline,
        });
        // Defensive: the night barrier should never overlap a streaming
        // command kojo, but a late batch must not break its identity contract.
        if (committed && !hasPendingRealtimeAi()) set({ state: committed });
      }).catch(() => {
        // Agent failures are silent during night settlement.
      });
      // Start L3 only after the L2 batch has synchronously occupied its three
      // slots. requestNarrativeStoryGraph performs its two stages serially,
      // therefore aggregate provider concurrency is capped at 3 + 1 = 4.
      // The overnight pass picks its own opportunity: the player is not asked
      // to choose a premise before the day has even started.
      const narrativeTask = get().runNarrativeDirectorAction({ allowFree: true, autoSelect: true }).catch(() => false);
      void Promise.allSettled([agentTask, narrativeTask]).finally(() => {
        if (generation === agentNightGeneration) agentNightController = null;
        agentAsyncRequests.delete(`night:${nightRequestId}`);
        // Ungate day-break only after both Night and L3 have settled. The
        // scoped settle prevents stale cleanup from releasing a newer night.
        // Scoped settle + generation guard: a superseded cycle's cleanup must
        // never settle a newer cycle's wait or clear its status.
        settleNightCycle();
        if (generation === agentNightGeneration) set({ nightCycleStatus: null });
      });
    }, 0);
  },

  resolveDailyEventPromptAction(answer) {
    const state = get().state;
    if (!state?.dailyEventSession) return;
    get().finishSleepAction(answer);
  },

  recoverDailyEventSessionAction() {
    const state = get().state;
    if (!state?.dailyEventSession) return;
    if (dailyEventPromptView(state, state.dailyEventSession)) return;
    // Only use this path when the persisted phase cannot render. Mark the
    // target post-sleep day as already handled so retrying the sleep session
    // cannot roll a different night event behind the player's back.
    const next = cloneGameState(state);
    next.dailyEventLastRunDay = Math.max(
      next.dailyEventLastRunDay ?? Number.MIN_SAFE_INTEGER,
      next.time.dayIndex + 1,
    );
    next.dailyEventSession = null;
    next.eventLog = [
      ...next.eventLog,
      { kind: "NARRATION", timestamp: NOW(), text: "夜间事件无法恢复，已安全跳过。" },
    ];
    set({ state: next, error: "daily event session recovered without effects" });
    get().finishSleepAction();
  },

  openEyesAction() {
    const s = get().state;
    if (s === null) return;
    // The agent-night sidecar is NO LONGER truncated here: the [100] 睁开眼睛
    // handler awaits `awaitNightCycle()` before calling this action, so the
    // night's reflections/diaries/plans have already committed (or were
    // cancelled through `abandonNightCycleAction` — the 「不再等待」 escape
    // hatch). The sidecar's own generation/dayIndex/contextHash guards remain
    // the safety net for direct action calls that skipped the wait.
    cancelLazyMaterializationFromStore("day changed");
    // `finishPlayerSleep` runs the morning pipeline before the player reaches
    // the morning menu. Its EVENT 2 / encounter transcript is intentionally
    // not part of the night report, but it is already in the UI queue waiting
    // for [100] 睁开眼睛 to enter the main game. Do not discard that queue here:
    // `runMorning` is same-day idempotent and cannot recreate those lines.
    // A queue that predates the current morning is still stale and must be
    // cancelled at this boundary.
    const staleQueue = get().dialogueQueue.filter((session) =>
      session.dayIndex !== undefined && session.dayIndex !== s.time.dayIndex);
    if (staleQueue.length > 0) {
      cancelDialogueSessions(staleQueue);
      set(dialogueQueueMirrors(get().dialogueQueue.filter((session) => !staleQueue.includes(session))));
    }
    const morningAlreadySettled = s.morningRanDay === s.time.dayIndex;
    if (!morningAlreadySettled) {
      cancelDialogueSessions(get().dialogueQueue);
      set(dialogueQueueMirrors([]));
    }
    const next = cloneGameState(s);
    // DAY-CYCLE-PLAN §S2 — delegate the whole [100] 睁开眼睛 body to the
    // runtime `openEyes`: pin the clock forward (monotonic — no more 08:00→
    // 07:00 rewind), wake the master in their 私室, run the shared morning
    // pipeline (visit/encounter/commission plus router-backed DAYEVENT-day /
    // おはよう), re-baseline the
    // daily-report snapshot. Seed unified with finishSleepAction:
    // (dayIndex+1)*31+7.
    const openEyesSeed = (next.time.dayIndex + 1) * 31 + 7 + Math.floor(Math.random() * 1000000);
    const rng = createRng(openEyesSeed);
    const { router } = currentIntentDeps();
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const openEyesRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    const events = openEyes(next, { now: NOW, rng, router: openEyesRouter });
    const morningDialogue = events.filter((event) => event.kind === "DIALOGUE_LINE");
    const morningHistory = events.filter((event) => event.kind !== "DIALOGUE_LINE");
    let logEvents = [...next.eventLog, ...morningHistory];

    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const pendingChoice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: openEyesSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      set({
        state: { ...next, eventLog: logEvents },
        ...enqueueDialoguePatch(
          get(),
          "event",
          morningDialogue,
          pendingChoice,
          next.time.dayIndex,
        ),
        error: null,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: openEyesSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: openEyesSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: logEvents },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          morningDialogue,
          pendingChoice,
          next.time.dayIndex,
        ),
        error: null,
      });
      return;
    }

    const wakeTransition = detectEncounterTransition(s, next);
    scheduleLazyMaterializationForTransition(wakeTransition);
    if (wakeTransition) {
      const fmSeed = openEyesSeed + 11;
      const first = runFirstMeetingsForTransition(
        next,
        wakeTransition,
        { now: NOW, router, rng: createRng(fmSeed) },
        {
          dialogueSessionAvailable: encounterSessionAvailable(get()),
        },
      );
      if (first.events.length > 0) {
        // Same split as applyIntentAction/walkPathAction: greeting地文 → band,
        // encounter 口上 → InteractionBox modal, so waking up next to an unmet
        // NPC pops the kojo consistently instead of burying it in the log.
        const { inline, popup } = splitArrivalKojo(first.events);
        logEvents = [...logEvents, ...inline];
        if (popup) {
          const pendingChoice = encounterChoiceSession(
            first,
            wakeTransition,
            fmSeed,
            0,
            inline.length,
          );
          set({
            state: { ...next, eventLog: logEvents },
            ...enqueueDialogueRequestsPatch(get(), [
              { owner: "event", transcript: morningDialogue, dayIndex: next.time.dayIndex },
              { owner: "encounter", transcript: popup, choice: pendingChoice, dayIndex: next.time.dayIndex },
            ], next.time.dayIndex),
            error: null,
          });
          return;
        }
      }
    }

    set({
      state: { ...next, eventLog: logEvents },
      ...enqueueDialoguePatch(get(), "event", morningDialogue, null, next.time.dayIndex),
      error: null,
    });
  },

  buyCatalogItemAction(itemId, qty = 1) {
    const s = get().state;
    const entry = catalogEntry(itemId);
    if (s === null || entry === undefined) {
      return {
        ok: false,
        code: ITEM_STOCK_CODE.NO_ITEM,
        unitPrice: 0,
        total: 0,
        qty,
      };
    }
    const next = cloneGameState(s);
    const result = shopBuy(next, itemId, qty);
    if (result.ok) {
      const event: ObservationEvent = {
        kind: "NARRATION",
        timestamp: NOW(),
        text: `在隙间商店买了${entry.name} ×${qty}（${result.total.toLocaleString()} 円）。`,
      };
      set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
    }
    return result;
  },

  useInventoryItemAction(itemId) {
    const s = get().state;
    if (s === null) return { ok: false, message: "尚未载入游戏状态。" };
    const next = cloneGameState(s);
    const result = applyMasterConsumable(next, itemId);
    if (!result.ok) return { ok: false, message: result.message };
    const timestamp = NOW();
    const clockEvents = result.clockEvents.map((event) => ({ ...event, timestamp }));
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp,
      text: result.message,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, ...clockEvents, event] }, error: null });
    return { ok: true, message: result.message };
  },

  setWakeMinuteAction(minute) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    const normalized = setMasterWakeMinute(next, minute);
    const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mm = String(normalized % 60).padStart(2, "0");
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `起床预定时刻设定为 ${hh}:${mm}。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
  },

  setHomeLocationAction(homeLocation) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    next.homeLocation = homeLocation;
    next.master.homeLocation = homeLocation;
    const homeRoomId = locationToRoomId(homeLocation);
    if (homeRoomId !== null) next.master.state.CFLAG[CFLAG_ID.初期位置] = homeRoomId;
    // 搬家 while still asleep (起床前菜单): move the sleeping master to the new
    // 私室 so [当前位置] / 睁眼 落点 stay consistent.
    if (next.sleepSession) {
      setSlotLocation(next.master, homeLocation);
    }
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `自宅位置设定为 ${homeLocation}。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
  },

  /** SHOP [160] 重置委托 — clear all active commission slots + per-chara 委托状況/内容状态. */
  resetCommissionsAction() {
    const s = get().state;
    if (s === null) return { resetSlots: 0, resetFlags: 0 };
    const next = cloneGameState(s);
    const result = resetAllCommissions(next);
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `重置委托：清空 ${result.resetSlots} 个进行中委托, 归零 ${result.resetFlags} 个角色状态。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
    return result;
  },

  /** SHOP [161] 重置服装 — restore all NPC default outfits + clear coordinate 1-99 snapshots (master excluded). */
  resetClothesAction() {
    const s = get().state;
    if (s === null) return { resetNpcs: 0, resetCoords: 0 };
    // resetAllClothes already clones the state internally; pass `s` directly.
    const result = resetAllClothes(s);
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `重置服装：恢复 ${result.resetNpcs} 名角色的默认便装, 清空 ${result.resetCoords} 个自定义套装。`,
    };
    set({ state: { ...result.next, eventLog: [...result.next.eventLog, event] }, error: null });
    return { resetNpcs: result.resetNpcs, resetCoords: result.resetCoords };
  },

  releaseBugAction(id) {
    const s = get().state;
    if (s === null) return false;
    const next = cloneGameState(s);
    const released = releaseCaughtBug(next, id);
    if (!released) return false;
    set({
      state: { ...next, eventLog: [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: "放生了虫笼中的昆虫。" }] },
      error: null,
    });
    return true;
  },

  materializeBugAction(id) {
    const s = get().state;
    if (s === null) return false;
    const next = cloneGameState(s);
    const materialized = materializeCaughtBug(next, id);
    if (!materialized) return false;
    set({
      state: { ...next, eventLog: [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: "将虫笼中的昆虫制成了素材。" }] },
      error: null,
    });
    return true;
  },

  toggleFilterAction(toggleId, target) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    toggleComFilter(toggleId, target, next);
    set({ state: next, error: null });
  },

  togglePortraitKindAction() {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    togglePortraitKind(next);
    set({ state: next, error: null });
  },

  setPortraitVariantAction(charaNum, variantId) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    setPortraitVariant(next, charaNum, variantId);
    set({ state: next, error: null });
  },

  togglePantyGapAutoAction() {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    next.flagStore[FLAG_ID.C隙間自動仕様] =
      (next.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) === 0 ? 1 : 0;
    set({ state: next, error: null });
  },

  claimPantyCollectionBonusAction(id) {
    const state = get().state;
    if (!state) return false;
    const next = cloneGameState(state);
    const result = claimPantyCollectionBonus(next, id);
    if (!result.ok) return false;
    next.eventLog = [
      ...next.eventLog,
      ...result.lines.map((text) => ({ kind: "NARRATION" as const, timestamp: NOW(), text })),
    ];
    set({ state: next, error: null });
    return true;
  },

  sellPantyDuplicatesAction() {
    const state = get().state;
    if (!state) return 0;
    const next = cloneGameState(state);
    const sold = spendCollectionDuplicates(next);
    if (sold <= 0) return 0;
    next.eventLog = [
      ...next.eventLog,
      { kind: "NARRATION" as const, timestamp: NOW(), text: `卖出了${sold}条重复胖次，获得￥${sold * 100}。` },
    ];
    set({ state: next, error: null });
    return sold;
  },

  updateAgentSettingsAction(patch) {
    const state = get().state;
    if (!state) return;
    const next = cloneGameState(state);
    const runtime = ensureAgentRuntime(next);
    const maxActiveAgents = patch.maxActiveAgents === undefined
      ? runtime.settings.maxActiveAgents
      : Math.max(1, Math.min(20, Math.trunc(patch.maxActiveAgents)));
    const validCharaNums = new Set(Object.keys(next.charas).map(Number).filter((id) => id > 0));
    const normalizeList = (values: readonly number[] | undefined, fallback: number[]): number[] =>
      values === undefined
        ? fallback
        : [...new Set(values.filter((id) => validCharaNums.has(id)))].slice(0, 20);
    runtime.settings = {
      ...runtime.settings,
      ...patch,
      maxActiveAgents,
      pinnedCharaNums: normalizeList(patch.pinnedCharaNums, runtime.settings.pinnedCharaNums),
      excludedCharaNums: normalizeList(patch.excludedCharaNums, runtime.settings.excludedCharaNums),
    };
    runtime.settings.pinnedCharaNums = runtime.settings.pinnedCharaNums
      .filter((id) => !runtime.settings.excludedCharaNums.includes(id))
      .slice(0, maxActiveAgents);
    if (!runtime.settings.masterEnabled) {
      cancelAgentNightCycle();
      cancelDaytimeReactions("agent runtime disabled");
      cancelLazyMaterializationFromStore("agent runtime disabled");
    } else {
      ensureCurrentAgentLedgerDay(next);
    }
    set({ state: next, error: null });
  },

  prepareCharacterForEncounterAction(charaNum, trigger = "encounter") {
    prepareCharacterForEncounter(charaNum, trigger, lazyMaterializationHost);
  },

  cancelLazyMaterializationAction(reason = "cancelled") {
    cancelLazyMaterializationFromStore(reason);
  },

  acceptStoryletAction(document, bindings) {
    const state = get().state;
    if (!state || hasPendingRealtimeAi()) return false;
    const accepted = acceptStorylet(state, document, bindings);
    if (!accepted.accepted) { set({ error: accepted.diagnostics.join("; ") }); return false; }
    set({ state: accepted.state, error: null });
    scheduleNarrativeReadiness("command-settled");
    return true;
  },

  progressStoryletsAction() {
    const ui = get();
    if (!ui.state?.storylets?.some(s => s.status === "active") || hasPendingRealtimeAi()) return false;
    const next = cloneGameState(ui.state);
    refreshStorylets(next);
    const started = startReadyStorylet(next, ui.dialogueQueue.length === 0 && !ui.pendingPrompt);
    if (JSON.stringify([next.storylets, next.narrativeHooks, next.storyProgram])
      !== JSON.stringify([ui.state.storylets, ui.state.narrativeHooks, ui.state.storyProgram])) set({ state: next });
    if (started.started) get().recoverStoryProgramAction();
    return started.started;
  },

  async startStoryProgramAction(templateId, actorId) {
    const snapshot = get().state;
    if (!snapshot || snapshot.storyProgram?.status === "active") return false;
    if (hasPendingRealtimeAi()) {
      set({ error: "故事无法开始：请先完成当前口上或选择。" });
      return false;
    }
    const settings = useAiStore.getState().settings;
    cancelStoryRequests();
    const requestGeneration = storyGeneration;
    const controller = new AbortController();
    storyController = controller;
    try {
      let opportunity = compileStoryOpportunity(snapshot);
      let proposal;
      if (templateId !== undefined) {
        const selectedActor = actorId ?? opportunity.candidates
          .flatMap((candidate) => candidate.characterIds ?? [])[0];
        if (selectedActor === undefined) return false;
        proposal = {
          setId: opportunity.setId,
          contextHash: opportunity.contextHash,
          rankedCandidateIds: [templateId, ...opportunity.candidates.map((candidate) => candidate.id).filter((id) => id !== templateId)],
          actorIds: [selectedActor],
          locationId: snapshot.master.location,
        };
      } else {
        if (!settings.enabled || !settings.storyEnabled || !settings.apiKey.trim()) return false;
        const selected = await requestStorySelection(snapshot, settings, controller.signal);
        opportunity = selected.opportunity;
        proposal = selected.proposal;
      }

      const current = get().state;
      if (!current || controller.signal.aborted || requestGeneration !== storyGeneration
        || current.storyProgram?.status === "active") return false;
      const currentOpportunity = compileStoryOpportunity(current);
      if (currentOpportunity.contextHash !== opportunity.contextHash) return false;
      const next = cloneGameState(current);
      const accepted = acceptStorySelection(next, currentOpportunity, proposal);
      if (!accepted.accepted || !accepted.program) return false;
      const opening = advanceStoryProgram(next);
      if (opening.diagnostics.length > 0 || !opening.pendingChoice) return false;
      const sessionId = accepted.program.id;
      const session: DialogueSession = {
        id: sessionId,
        owner: "story",
        dayIndex: opening.state.time.dayIndex,
        priority: DIALOGUE_SESSION_PRIORITY.story,
        interruptible: false,
        transcript: opening.events,
        choice: storyChoiceSession(opening.pendingChoice, accepted.program.id, accepted.program.actorIds[0]!, 0),
      };
      const queue = enqueueDialogueSession(get().dialogueQueue, session);
      syncAgentFactsAndSchedule(opening.state, accepted.program.actorIds);
      set({ state: opening.state, error: null, ...dialogueQueueMirrors(queue) });

      const expression = opening.expressionRequests[0] as StoryExpressionRequest | undefined;
      if (expression && settings.enabled && settings.storyEnabled && settings.apiKey.trim()) {
        const profile = currentAiCharacterProfile(expression.actorId);
        void requestStoryExpression(opening.state, expression, settings, controller.signal, profile)
          .then((lines) => {
            if (controller.signal.aborted || requestGeneration !== storyGeneration) return;
            const live = get();
            if (live.state?.storyProgram?.id !== expression.programId
              || live.state.storyProgram.contextHash !== expression.contextHash) return;
            const sessionIndex = live.dialogueQueue.findIndex((entry) => entry.id === sessionId && entry.owner === "story");
            if (sessionIndex < 0) return;
            const active = live.dialogueQueue[sessionIndex]!;
            let replaced = false;
            const transcript = active.transcript.flatMap((event): ObservationEvent[] => {
              if (!replaced && event.kind === "DIALOGUE_LINE" && event.charaNum === expression.actorId && event.text === expression.fallbackText) {
                replaced = true;
                return lines.map((line) => ({ kind: "DIALOGUE_LINE", timestamp: NOW(), charaNum: expression.actorId, text: line.text, form: line.form, origin: "ai" }));
              }
              return [event];
            });
            if (!replaced) return;
            const updatedQueue = [...live.dialogueQueue];
            updatedQueue[sessionIndex] = { ...active, transcript };
            set({ ...dialogueQueueMirrors(updatedQueue) });
          })
          .catch(() => { /* deterministic fallback remains visible */ })
          .finally(() => {
            if (storyController === controller) storyController = null;
          });
      } else if (storyController === controller) {
        storyController = null;
      }
      return true;
    } catch {
      if (storyController === controller) storyController = null;
      return false;
    }
  },

  resolveStoryChoiceAction(choiceId) {
    const state = get().state;
    const active = get().dialogueQueue[0];
    if (!state?.storyProgram || state.storyProgram.status !== "active" || active?.owner !== "story"
      || active.id !== state.storyProgram.id) return;
    const result = advanceStoryProgram(state, choiceId);
    if (result.diagnostics.length > 0) {
      syncAgentFactsAndSchedule(result.state, state.storyProgram.actorIds);
      set({ state: result.state, error: result.diagnostics.join("; ") });
      return;
    }
    const transcript = [...active.transcript, ...result.events];
    const choice = result.pendingChoice
      ? storyChoiceSession(result.pendingChoice, state.storyProgram.id, state.storyProgram.actorIds[0]!, transcript.length)
      : null;
    syncAgentFactsAndSchedule(result.state, state.storyProgram.actorIds);
    set({
      state: result.state,
      error: null,
      ...dialogueQueueMirrors(replaceActiveDialogueSession(get().dialogueQueue, transcript, choice)),
    });
    if (result.pendingAutonomousChoice) void continueAutonomousStoryChoice(result.pendingAutonomousChoice);
  },

  recoverStoryProgramAction() {
    const state = get().state;
    const pendingProgram = state?.storyProgram;
    if (!state || !pendingProgram || pendingProgram.status !== "active"
      || get().dialogueQueue.some((session) => session.owner === "story")) return;
    if (pendingProgram.version === 2 && state.storyArcs?.some(a => a.id === pendingProgram.arcId && hasPendingStoryInteraction(a))) {
      scheduleBackgroundNarrativeEvolution("important-fact");
      return;
    }
    if (pendingProgram.version === 2 && get().dialogueQueue.length > 0
      && pendingProgram.nodes.some(node => node.id === pendingProgram.cursorNodeId && node.kind === "dialogue-hook")) return;
    const result = advanceStoryProgram(state);
    if (result.pendingDialogueHookId && result.events.length === 0 && result.diagnostics.length === 0) {
      set({ state: result.state, error: null });
      return;
    }
    if (result.diagnostics.length > 0 || (result.events.length === 0 && !result.pendingChoice && !result.pendingAutonomousChoice)) {
      syncAgentFactsAndSchedule(result.state, pendingProgram.actorIds);
      set({ state: result.state, error: result.diagnostics.join("; ") || "story program could not resume" });
      return;
    }
    const program = result.state.storyProgram!;
    const transcript = result.events.length > 0
      ? result.events
      : [{ kind: "NARRATION" as const, timestamp: NOW(), text: "短事件从存档中的选择处继续。" }];
    const session: DialogueSession = {
      id: program.id,
      owner: "story",
      dayIndex: result.state.time.dayIndex,
      priority: DIALOGUE_SESSION_PRIORITY.story,
      interruptible: false,
      transcript,
      choice: result.pendingChoice
        ? storyChoiceSession(result.pendingChoice, program.id, program.actorIds[0]!, transcript.length)
        : null,
    };
    const queue = enqueueDialogueSession(get().dialogueQueue, session);
    syncAgentFactsAndSchedule(result.state, program.actorIds);
    set({ state: result.state, error: null, ...dialogueQueueMirrors(queue) });
    if (result.pendingAutonomousChoice) void continueAutonomousStoryChoice(result.pendingAutonomousChoice);
  },

  abortStoryProgramAction() {
    const state = get().state;
    if (!state) return;
    cancelStoryRequests();
    cancelNarrativeDirector("story aborted");
    const queue = get().dialogueQueue.filter((session) => session.owner !== "story");
    set({ state: abortStoryProgram(state), error: null, ...dialogueQueueMirrors(queue) });
  },

  skipStoryProgramAction() {
    const current = get().state;
    if (!current?.storyProgram || current.storyProgram.status !== "active") return;
    let result = advanceStoryProgram(current);
    let guard = 24;
    while ((result.pendingChoice || result.pendingAutonomousChoice) && guard-- > 0) {
      const fallbackChoice = result.pendingChoice?.options[0]?.id
        ?? result.pendingAutonomousChoice?.fallbackOptionId;
      if (!fallbackChoice) break;
      result = advanceStoryProgram(result.state, fallbackChoice);
    }
    const queue = get().dialogueQueue.filter((session) => session.owner !== "story");
    syncAgentFactsAndSchedule(result.state, result.state.storyProgram?.actorIds ?? []);
    set({
      state: result.state,
      error: result.diagnostics.length > 0 ? result.diagnostics.join("; ") : null,
      ...dialogueQueueMirrors(queue),
    });
  },

  async evolveNarrativeArcAction(trigger: NarrativeArcEvolutionTrigger = "clock-boundary") {
    if (narrativeController || hasPendingRealtimeAi()) return false;
    const initial = get().state;
    if (!initial) return false;
    // There is no Arc to evolve. Avoid cloning/publishing the complete save
    // (including its history) on every ordinary command in a story-free game.
    if (!initial.storyArcs?.length && !initial.narrativeEvents?.length && !initial.storyProgram) return false;
    const snapshot = reconcileNarrativeState(initial).state;
    // A foreground owner has the only interactive stage. Background work is
    // retried at the next boundary instead of moving shared cast or dialogue.
    if (!canAssessStoryInteractions(snapshot)) return false;
    if (get().dialogueQueue.length > 0 && snapshot.storyArcs?.some(hasPendingStoryInteraction)) return false;
    const settings = useAiStore.getState().settings;
    const gate = narrativeGateReason(settings, snapshot.agentRuntime?.settings.masterEnabled === true);
    if (gate) {
      recordNarrativeSkip(gate);
      return false;
    }
    const selection = selectDueNarrativeArc(snapshot, trigger);
    if (!selection) return false;
    if (!canAssessStoryInteractions(snapshot, selection.arc.id)) return false;
    let request = compileNarrativeArcEvolutionRequest(snapshot, selection);
    if (!request) return false;
    if (!narrativeParticipantsAuthorized(settings, snapshot, request.participantIds)) {
      recordNarrativeSkip("后台故事参与角色未启用"); return false;
    }
    if (hasPendingStoryInteraction(selection.arc)) {
      reserveStoryInteractionAssessment(snapshot, selection.arc);
      request = compileNarrativeArcEvolutionRequest(snapshot, selection)!;
      set({ state: snapshot });
    }
    const context = compileNarrativeSnapshot(snapshot, request.capabilities, request.participantIds,
      (charaNum) => compileAiCharacterSemanticContext(snapshot, charaNum, "npc-public").lines);
    const controller = new AbortController();
    narrativeController = controller;
    beginNarrativeDirectorStatus("evolution");
    const generation = narrativeGeneration;
    const registrationKey = `narrative:${request.requestId}`;
    agentAsyncRequests.set(registrationKey, {
      owner: "narrative",
      requestId: request.requestId,
      generation,
      dayIndex: request.dayIndex,
      contextHash: request.baseArcHash,
    });
    const startedAt = Date.now();
    useAiStore.getState().addDebugEntry({
      requestId: request.requestId,
      createdAt: startedAt,
      feature: "narrative-director",
      narrativePhase: "evolution",
      participants: request.participantIds,
      gameDayIndex: request.dayIndex,
      gameTick: request.tick,
      providerStarted: true,
      status: "pending",
    });
    try {
      const proposal = await requestNarrativeArcEvolution(
        context,
        request,
        settings,
        controller.signal,
        undefined,
        () => {
          const liveSettings = useAiStore.getState().settings;
          const liveState = get().state;
          return narrativeParticipantsAuthorized(liveSettings, liveState, request.participantIds)
            && generation === narrativeGeneration
            && liveState?.time.dayIndex === request.dayIndex
            && canAssessStoryInteractions(liveState, request.arcId);
        },
        recordCompletionExchanges(request.requestId),
      );
      if (hasPendingRealtimeAi() && !await waitForNarrativeCommit(controller)) return false;
      const current = get().state;
      const liveSettings = useAiStore.getState().settings;
      if (!current || controller.signal.aborted || generation !== narrativeGeneration
        || !narrativeParticipantsAuthorized(liveSettings, current, request.participantIds)
        || !canAssessStoryInteractions(current, request.arcId)
        || (request.interaction?.pending && get().dialogueQueue.length > 0)) return false;
      const liveArc = current.storyArcs?.find((arc) => arc.id === request.arcId && arc.status === "active"
        && current.time.tickValue <= arc.deadlineTick);
      const freshRequest = liveArc ? compileNarrativeArcEvolutionRequest(current, { arc: liveArc, trigger }) : null;
      if (!freshRequest || freshRequest.baseArcHash !== request.baseArcHash) {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "cancelled", durationMs: Date.now() - startedAt, error: "background Arc changed while provider was running" });
        return false;
      }
      const applied = applyNarrativeArcEvolution(current, request, proposal);
      if (!applied.accepted) {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "error", durationMs: Date.now() - startedAt, error: applied.diagnostics.join("; ") });
        return false;
      }
      const next = closeUnavailableStoryArcs(applied.state, true, request.arcId);
      if (proposal.interactionUpdate?.frontier === "replan") arcWindowDirectorAttempts.delete(request.arcId);
      syncAgentFactsAndSchedule(next, request.participantIds);
      set({ state: next, error: null });
      if (request.interaction?.pending) queueMicrotask(() => scheduleNarrativeReadiness("command-settled"));
      useAiStore.getState().patchDebugEntry(request.requestId, {
        status: "success",
        durationMs: Date.now() - startedAt,
        acceptedCount: applied.directCapabilityIds.length,
      });
      return true;
    } catch (error) {
      if (!controller.signal.aborted && !(typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) {
        if (hasPendingRealtimeAi() && !await waitForNarrativeCommit(controller)) return false;
        const current = get().state;
        if (current?.time.dayIndex === request.dayIndex) set({ state: closeUnavailableStoryArcs(current, false, request.arcId) });
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "error", durationMs: Date.now() - startedAt, error: String(error) });
      } else {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "cancelled", durationMs: Date.now() - startedAt });
      }
      return false;
    } finally {
      agentAsyncRequests.delete(registrationKey);
      releaseNarrativeDirector(controller);
    }
  },

  async runNarrativeDirectorAction(options = {}) {
    const initial = get().state;
    if (!initial) { recordNarrativeSkip("尚未载入游戏，无法启动 L3"); return false; }
    // reconcileNarrativeState unconditionally clones GameState; entering while
    // a realtime AI kojo streams would cancel the stream and drop its pending
    // command settlement.
    if (hasPendingRealtimeAi()) { recordNarrativeSkip("实时口上正在生成，请完成当前对话后再启动 L3"); return false; }
    const snapshot = reconcileNarrativeState(initial).state;
    set({ state: snapshot });
    const settings = useAiStore.getState().settings;
    // L3 does not require the shell to replace authored kojo with AI. It needs
    // its own switch, a provider, and the Agent Runtime whose cognition the
    // cast context is built from — not the dialogue-replacement feature.
    const gate = narrativeGateReason(settings, snapshot.agentRuntime?.settings.masterEnabled === true);
    if (gate) { recordNarrativeSkip(gate); return false; }
    cancelNarrativeDirector("new narrative request");
    const generation = narrativeGeneration;
    const request = compileNarrativeDirectorRequest(snapshot, {
      generation,
      frequency: settings.narrativeFrequency,
      allowFree: options.allowFree ?? true,
      forceWeather: options.forceWeather ?? false,
      playerIntent: options.playerIntent,
      replacePending: options.replacePending ?? false,
      // Interaction-window handoff: pin the pass to the Arc whose promised
      // window is open instead of whichever Arc has the earliest deadline.
      ...(options.pinArcId !== undefined ? { pinArcId: options.pinArcId } : {}),
      // The player's own request: it is never refused for a spent frequency
      // budget, and the story it opens does not spend one either.
      manual: options.manual === true,
      // Personality and voice live in the shell's character-card catalog.
      // "npc-public" keeps each character's private feelings toward the
      // player out of the shared narrative prompt.
      personaFor: (charaNum) => compileAiCharacterSemanticContext(snapshot, charaNum, "npc-public").lines,
    });
    if (!request) {
      recordNarrativeSkip("没有合法候选（频率预算用尽、参与者不足、地点不可用，或存在无 NPC 的未结 Arc）");
      return false;
    }
    if (request.context.snapshot.characters.some((character) => character.id > 0 && !currentAiCharacterProfile(character.id).enabled)) {
      recordNarrativeSkip("候选角色未启用");
      return false;
    }
    const controller = new AbortController();
    narrativeController = controller;
    beginNarrativeDirectorStatus("situations", request.arcId);
    agentAsyncRequests.set(`narrative:${request.requestId}`, {
      owner: "narrative",
      requestId: request.requestId,
      generation,
      dayIndex: request.dayIndex,
      contextHash: request.context.snapshot.contextHash,
    });
    useAiStore.getState().addDebugEntry({
      requestId: request.requestId,
      createdAt: Date.now(),
      feature: "narrative-director",
      narrativePhase: "situations",
      participants: request.context.snapshot.characters.map((entry) => entry.id).slice(0, NARRATIVE_MAX_PARTICIPANTS),
      gameDayIndex: request.dayIndex,
      gameTick: snapshot.time.tickValue,
      providerStarted: true,
      status: "pending",
    });
    const startedAt = Date.now();
    try {
      // Stage A only. The opening act is generated after the player picks a
      // situation, so an unchosen menu costs this single call and nothing more.
      // What "still authorized" means depends on what the pass is for. An
      // invented premise must be authored against a world that has not moved at
      // all. A pinned pass serves a promise a background pass already made: it
      // is compiled while the player is anywhere (often mid-walk — walking is
      // what triggers the handoff), and delivery is decided later by the
      // event's own window plus the presence check in refreshNarrativeEvents.
      const pinned = options.pinArcId !== undefined;
      const directorStillAuthorized = (): boolean => narrativeDirectorStillAuthorized({
        settings: useAiStore.getState().settings,
        state: get().state,
        requestDayIndex: request.dayIndex,
        snapshotTick: request.context.snapshot.createdAtTick,
        snapshotLocation: request.context.snapshot.locationId,
        pinned,
        participantIds: request.context.snapshot.characters.map(character => character.id),
        requireActiveRoster: false,
      });
      const situations = await requestNarrativeSituations(
        request.context,
        settings,
        controller.signal,
        request.anchor,
        undefined,
        directorStillAuthorized,
        request.playerIntent,
        request.promisedLocationIds ? { promisedLocationIds: request.promisedLocationIds } : undefined,
        recordCompletionExchanges(request.requestId),
      );
      if (hasPendingRealtimeAi() && !await waitForNarrativeCommit(controller)) return false;
      const registration = agentAsyncRequests.get(`narrative:${request.requestId}`);
      const current = get().state;
      if (!current || !registration || registration.owner !== "narrative"
        || registration.generation !== generation || controller.signal.aborted
        || !directorStillAuthorized()) {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "cancelled", durationMs: Date.now() - startedAt, skipReason: "游戏状态或开关已变化，本次候选未提交" });
        return false;
      }
      if (pinned && !current.storyArcs?.some((arc) => arc.id === options.pinArcId
        && arc.status === "active" && current.time.tickValue <= arc.deadlineTick)) {
        // The provider was in flight while the Arc expired or was paused. The
        // menu would reference a dead promise no stage-B compile can serve
        // (compileNarrativeDirectorRequest returns null for a missing pin).
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "cancelled", durationMs: Date.now() - startedAt, skipReason: "互动窗口所属的故事线在生成期间失效" });
        return false;
      }
      const autoSelect = options.autoSelect === true;
      if (situations.length === 0) {
        const unavailable = request.context.unavailableIntentCharacterNames ?? [];
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "skipped", durationMs: Date.now() - startedAt,
          skipReason: unavailable.length > 0
            ? `模型未返回可用候选；输入提到的 ${unavailable.join("、")} 不在活跃角色名单，请检查核心互动是否可实现`
            : "模型未返回可用候选；本次尚未创建剧情，请检查故事意图与可用角色、地点" });
        return false;
      }
      const published = scheduleNarrativeSituations(request, situations, { autoSelect });
      if (!published.accepted) {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "error", durationMs: Date.now() - startedAt, error: published.diagnostics.join("; ") });
        return false;
      }
      const next = closeUnavailableStoryArcs(current, true, request.arcId);
      next.narrativeSituationSession = published.state.narrativeSituationSession;
      // `replacePending` now replaces only the previous unchosen menu. An
      // accepted event/Arc is never cancelled just because a second manual
      // request arrived; this is what makes the three-Arc budget meaningful.
      set({ state: next, error: null });
      useAiStore.getState().patchDebugEntry(request.requestId, { status: "success", durationMs: Date.now() - startedAt, acceptedCount: situations.length });
      if (!autoSelect) return true;
      // The runtime picks one and opens it without asking. The player only ever
      // meets the story once it is actually happening.
      const selection = selectNarrativeSituation(next, situations,
        request.promisedLocationIds ? { promisedLocationIds: new Set(request.promisedLocationIds) } : {});
      if (!selection.selected) {
        // Nothing legal to pursue; drop the set so the player is never shown a
        // menu the runtime already decided against.
        const cleared = get().state;
        if (cleared?.narrativeSituationSession?.autoSelect) set({ state: { ...cleared, narrativeSituationSession: null } });
        useAiStore.getState().patchDebugEntry(`${request.requestId}:select`, { status: "skipped", durationMs: Date.now() - startedAt, skipReason: selection.diagnostics.join("; ") || "no legal situation" });
        return false;
      }
      useAiStore.getState().patchDebugEntry(`${request.requestId}:select`, { status: "success", durationMs: Date.now() - startedAt, acceptedCount: 1 });
      return await get().chooseNarrativeSituationAction(selection.selected.id);
    } catch (error) {
      if (!controller.signal.aborted && !(typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) {
        if (hasPendingRealtimeAi() && !await waitForNarrativeCommit(controller)) return false;
        const current = get().state;
        if (current?.time.dayIndex === request.dayIndex) set({ state: closeUnavailableStoryArcs(current, false, request.arcId) });
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "error", durationMs: Date.now() - startedAt, error: String(error) });
      } else {
        useAiStore.getState().patchDebugEntry(request.requestId, { status: "cancelled", durationMs: Date.now() - startedAt });
      }
      return false;
    } finally {
      finishNarrativeDiagnostics(request.requestId, startedAt);
      agentAsyncRequests.delete(`narrative:${request.requestId}`);
      releaseNarrativeDirector(controller);
    }
  },

  async chooseNarrativeSituationAction(situationId) {
    const initial = get().state;
    if (!initial) return false;
    if (hasPendingRealtimeAi()) {
      // A runtime-picked set must not outlive this refusal: nobody else can
      // answer it, and a stranded session blocks every future handoff (the
      // window director declines while a session exists). Clear it and let the
      // readiness retry pick the choice back up once the kojo settles.
      const live = get().state;
      if (live?.narrativeSituationSession?.autoSelect) {
        set({ state: { ...live, narrativeSituationSession: null } });
        scheduleNarrativeReadiness("command-settled");
      } else {
        set({ error: "请先完成当前口上或选择。" });
      }
      return false;
    }
    const snapshot = reconcileNarrativeState(initial).state;
    set({ state: snapshot });
    const session = snapshot?.narrativeSituationSession;
    if (!snapshot || !session) return false;
    const situation = session.situations.find((entry) => entry.id === situationId);
    if (!situation) return false;
    // Pre-authored windows are delivered later via the deterministic readiness
    // path — staging the cast into the scene and pushing an intro session now
    // would interrupt a player who is somewhere else entirely.
    const background = session.arcId !== undefined || isOpenStoryProgram(snapshot.storyProgram);
    const settings = useAiStore.getState().settings;
    const gate = narrativeGateReason(settings, snapshot.agentRuntime?.settings.masterEnabled === true);
    if (gate) {
      recordNarrativeSkip(gate);
      // A runtime-picked set is never shown to the player, so leaving it behind
      // would strand a menu that nobody can answer and that the runtime already
      // decided against.
      if (session.autoSelect) set({ state: { ...snapshot, narrativeSituationSession: null } });
      return false;
    }
    cancelNarrativeDirector("situation chosen");
    const generation = narrativeGeneration;
    // The world has moved on since the menu was generated, so stage B builds a
    // fresh request from the current state rather than reusing the old context.
    const request = compileNarrativeDirectorRequest(snapshot, {
      generation,
      frequency: settings.narrativeFrequency,
      allowFree: true,
      chosenSituation: situation,
      personaFor: (charaNum) => compileAiCharacterSemanticContext(snapshot, charaNum, "npc-public").lines,
      ...(session.playerIntent ? { playerIntent: session.playerIntent } : {}),
      // The manual entry may replace an unchosen situation menu. Accepted
      // events/Arcs are kept, so this flag never deletes an existing story.
      ...(session.replacePending ? { replacePending: true } : {}),
      // Same for the budget exemption: it belongs to the story the player
      // ends up opening, and that is decided here.
      ...(session.manual ? { manual: true } : {}),
      // Stage A compiled this menu to serve a promised window: re-pin the same
      // Arc. Without it the recompile picks whichever active Arc has the
      // earliest deadline and authors the wrong encounter.
      ...(session.arcId !== undefined ? { pinArcId: session.arcId } : {}),
    });
    if (!request) {
      // A pinned menu whose promise no longer compiles must not degrade into a
      // normal story: the player never chose a premise, the promise chose them.
      if (session.arcId !== undefined) {
        if (session.autoSelect) set({ state: { ...snapshot, narrativeSituationSession: null } });
        recordNarrativeSkip("互动窗口的承诺已经失效，撰写作废");
      } else recordNarrativeSkip("当前无法创建剧情：候选条件已变化、参与者或故事线名额不可用");
      return false;
    }
    if (!narrativeParticipantsAuthorized(settings, snapshot, situation.participantIds)) {
      recordNarrativeSkip("所选候选角色已不可用，请重新生成候选"); return false;
    }
    if ((session.promisedLocationIds ?? []).length > 0 && (request.promisedLocationIds ?? []).length === 0) {
      // Same reasoning when the compile fell back off nextChance: an
      // interaction-window session without a promise would just be an ordinary
      // story wearing the window's clothes.
      if (session.autoSelect) set({ state: { ...snapshot, narrativeSituationSession: null } });
      recordNarrativeSkip("互动窗口的承诺已经失效，撰写作废");
      return false;
    }
    const controller = new AbortController();
    narrativeController = controller;
    beginNarrativeDirectorStatus("opening", session.arcId);
    const requestId = `${request.requestId}:situation:${situationId}`;
    agentAsyncRequests.set(`narrative:${requestId}`, {
      owner: "narrative",
      requestId,
      generation,
      dayIndex: request.dayIndex,
      contextHash: request.context.snapshot.contextHash,
    });
    useAiStore.getState().addDebugEntry({
      requestId,
      createdAt: Date.now(),
      feature: "narrative-director",
      narrativePhase: "opening",
      participants: request.context.snapshot.characters.map((entry) => entry.id).slice(0, NARRATIVE_MAX_PARTICIPANTS),
      gameDayIndex: request.dayIndex,
      gameTick: snapshot.time.tickValue,
      providerStarted: true,
      status: "pending",
    });
    const startedAt = Date.now();
    // Same contract split as stage A: a session serving a promised window
    // (session.arcId set) is authorized by the promise — the player reading the
    // menu for a few seconds advances the clock and must not void it.
    const stageBPinned = (session.promisedLocationIds ?? []).length > 0;
    const openingStillAuthorized = (): boolean => narrativeDirectorStillAuthorized({
      settings: useAiStore.getState().settings,
      state: get().state,
      requestDayIndex: request.dayIndex,
      snapshotTick: request.context.snapshot.createdAtTick,
      snapshotLocation: request.context.snapshot.locationId,
      pinned: stageBPinned,
      participantIds: situation.participantIds,
      requireActiveRoster: false,
    });
    try {
      const generated = await requestNarrativeOpening(
        request.context,
        situation,
        settings,
        controller.signal,
        request.phaseGoal,
        undefined,
        openingStillAuthorized,
        request.playerIntent,
        recordCompletionExchanges(requestId),
        (phase) => {
          if (controller.signal.aborted || generation !== narrativeGeneration) return;
          beginNarrativeDirectorStatus(phase, session.arcId);
          useAiStore.getState().patchDebugEntry(requestId, { narrativePhase: phase });
        },
      );
      if (hasPendingRealtimeAi() && !await waitForNarrativeCommit(controller)) return false;
      const registration = agentAsyncRequests.get(`narrative:${requestId}`);
      const current = get().state;
      if (!current || !registration || registration.owner !== "narrative"
        || registration.generation !== generation || controller.signal.aborted
        || !openingStillAuthorized()) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "cancelled", durationMs: Date.now() - startedAt, skipReason: "游戏状态或开关已变化，生成结果未创建为剧情" });
        return false;
      }
      // Pinned authoring permits walking while the provider runs. Publish only
      // narrative data onto the live world; never roll time/location/stats back
      // to the request snapshot. The promised window must still be available.
      if (stageBPinned && !current.storyArcs?.some((arc) => arc.id === session.arcId
        && arc.status === "active" && current.time.tickValue <= arc.deadlineTick
        && arc.maintenance?.nextChance?.locationIds.includes(situation.locationIds[0]!)
        && current.time.tickValue <= arc.maintenance.nextChance.latestTick)) return false;
      // Manual requests also retain observations accepted while the provider
      // ran. Their stricter clock/location authorization was checked above.
      // A new manual Arc exists only in Runtime's compiled draft until this
      // acceptance. Carry that one draft forward without restoring old world
      // fields or overwriting another live Arc.
      const draftArc = request.arcId && !current.storyArcs?.some((arc) => arc.id === request.arcId)
        ? request.workingState.storyArcs?.find((arc) => arc.id === request.arcId) : undefined;
      if (draftArc && (current.storyArcs ?? []).filter((arc) => arc.status === "active" || arc.status === "paused").length >= NARRATIVE_MAX_ACTIVE_ARCS) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", durationMs: Date.now() - startedAt,
          error: "活动故事线已达上限，请先完成或关闭一条故事" });
        return false;
      }
      const workingState = draftArc ? { ...current, storyArcs: [...(current.storyArcs ?? []), draftArc] } : current;
      const acceptanceRequest = { ...request, workingState,
        windowStartTick: Math.max(current.time.tickValue, request.windowStartTick) };
      const accepted = acceptNarrativeSituationChoice(acceptanceRequest, situation, generated.proposal, settings.narrativeFrequency, {
        introText: generated.opening.introText,
        objectiveText: generated.opening.objectiveText,
        startCommandLabel: generated.opening.startCommandLabel,
      }, { background });
      if (!accepted.accepted) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", durationMs: Date.now() - startedAt, error: accepted.diagnostics.join("; ") });
        // The menu is deliberately left in place so the player can pick again.
        return false;
      }
      // Base the commit on the ACCEPTED state, not on `current`. Acceptance is
      // what stages the cast into the scene and records the opening beat;
      // rebuilding from `current` (same tick, but pre-staging) would throw both
      // away and leave the story describing people who never moved.
      const next = closeUnavailableStoryArcs(accepted.state, true, request.arcId);
      next.narrativeSituationSession = null;
      const event = accepted.event!;
      if (background) {
        // This event is now a background opportunity. It has no transcript and
        // no activeEventContext; its opening beat is recorded only if the
        // player later enters it through the deterministic readiness path.
        syncAgentFactsAndSchedule(next, event.participantIds.filter((id) => id > 0));
        set({ state: next, error: null });
        useAiStore.getState().patchDebugEntry(requestId, { status: "success", durationMs: Date.now() - startedAt, acceptedCount: 1 });
        // Pre-authored window: if the player happens to already stand inside
        // the promised places, promote the event right now instead of waiting
        // for the next unrelated trigger.
        if (session.arcId !== undefined) scheduleNarrativeReadiness("command-settled");
        return true;
      }
      // The opening prose IS the scene. Objective and route live on the event
      // and are read on demand from the story panel, so they are not pasted
      // into the transcript as labelled lines.
      const introSession: DialogueSession = {
        id: `narrative-intro:${event.id}`,
        owner: "story",
        dayIndex: next.time.dayIndex,
        priority: DIALOGUE_SESSION_PRIORITY.story,
        interruptible: false,
        transcript: [
          { kind: "NARRATION", timestamp: NOW(), text: narrativeCastWaitReason(next, event.participantIds, event.locationIds[0])
            ? `「${event.title}」已准备好。${narrativeCastWaitReason(next, event.participantIds, event.locationIds[0])}。`
            : event.introText ?? event.title },
        ],
        choice: null,
      };
      const withoutOldStoryNotices = get().dialogueQueue.filter((session) => session.owner !== "story");
      const queue = enqueueDialogueSession(withoutOldStoryNotices, introSession);
      syncAgentFactsAndSchedule(next, event.participantIds);
      set({ state: next, error: null, ...dialogueQueueMirrors(queue) });
      useAiStore.getState().patchDebugEntry(requestId, { status: "success", durationMs: Date.now() - startedAt, acceptedCount: 1 });
      return true;
    } catch (error) {
      if (!controller.signal.aborted && !(typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", durationMs: Date.now() - startedAt, error: String(error) });
      } else {
        useAiStore.getState().patchDebugEntry(requestId, { status: "cancelled", durationMs: Date.now() - startedAt });
      }
      return false;
    } finally {
      finishNarrativeDiagnostics(requestId, startedAt);
      agentAsyncRequests.delete(`narrative:${requestId}`);
      const live = get().state;
      if (session.autoSelect && live?.narrativeSituationSession?.id === session.id) {
        // An automatic menu has no player to retry it. A rejected graph or
        // failed provider must release the handoff instead of stranding it.
        if (hasPendingRealtimeAi()) {
          narrativeAutomaticMenuCleanupId = session.id;
          narrativeReadinessAfterDialogue = "command-settled";
        } else set({ state: { ...live, narrativeSituationSession: null } });
      }
      releaseNarrativeDirector(controller);
    }
  },

  dismissNarrativeSituationsAction() {
    const current = get().state;
    if (!current?.narrativeSituationSession) return;
    set({ state: { ...current, narrativeSituationSession: null } });
  },

  async continueNarrativeStoryAction() {
    if (narrativeController) return false;
    const initial = get().state;
    if (!initial) return false;
    if (hasPendingRealtimeAi()) return false;
    const snapshot = reconcileNarrativeState(initial).state;
    set({ state: snapshot });
    const program = snapshot.storyProgram;
    if (!program || program.version !== 2 || program.status !== "awaiting-player") return false;
    const evidence = program.continuationEvidence;
    if (!evidence || evidence.roundIndex !== (program.roundIndex ?? 0) || program.continuationAttemptId === evidence.id) return false;
    const settings = useAiStore.getState().settings;
    if (!narrativeParticipantsAuthorized(settings, snapshot, program.actorIds)) {
      recordNarrativeSkip("续幕条件未满足：检查 AI / L3 / Agent Runtime 开关和参与角色"); return false;
    }
    const request = compileNarrativeContinuationRequest(snapshot, {
      generation: narrativeGeneration,
      personaFor: (charaNum) => compileAiCharacterSemanticContext(snapshot, charaNum, "npc-public").lines,
    });
    if (!request) return false;
    const programId = program.id;
    const generation = narrativeGeneration;
    const controller = new AbortController();
    narrativeController = controller;
    beginNarrativeDirectorStatus("continuation");
    const requestId = `${request.requestId}:${evidence.id}`;
    program.continuationAttemptId = evidence.id;
    const ownedEvent = snapshot.narrativeEvents?.find((entry) => entry.id === program.eventId);
    if (ownedEvent) ownedEvent.program = structuredClone(program);
    set({ state: snapshot });
    agentAsyncRequests.set(`narrative:${requestId}`, {
      owner: "narrative",
      requestId,
      generation,
      dayIndex: request.dayIndex,
      contextHash: request.context.snapshot.contextHash,
    });
    const startedAt = Date.now();
    useAiStore.getState().addDebugEntry({ requestId, createdAt: startedAt, feature: "narrative-director", narrativePhase: "continuation", providerStarted: true, status: "pending",
      participants: program.actorIds, gameDayIndex: snapshot.time.dayIndex, gameTick: snapshot.time.tickValue });
    try {
      const proposal = await requestNarrativeContinuation(
        request.context,
        settings,
        controller.signal,
        request.phaseGoal,
        program.actorIds,
        [...new Set(request.context.snapshot.characters.map((character) => character.locationId))],
        undefined,
        () => {
          const live = useAiStore.getState().settings;
          const liveState = get().state;
          return narrativeParticipantsAuthorized(live, liveState, program.actorIds)
            && generation === narrativeGeneration && narrativeController === controller
            && liveState?.storyProgram?.id === programId
            && liveState.storyProgram.status === "awaiting-player";
        },
        recordCompletionExchanges(requestId),
      );
      const current = get().state;
      const liveSettings = useAiStore.getState().settings;
      if (!current || controller.signal.aborted || !narrativeParticipantsAuthorized(liveSettings, current, program.actorIds)
        || generation !== narrativeGeneration || narrativeController !== controller
        || agentAsyncRequests.get(`narrative:${requestId}`)?.generation !== generation
        || current.storyProgram?.id !== programId
        || current.storyProgram.status !== "awaiting-player") return false;
      const fresh = compileNarrativeContinuationRequest(current, {
        generation,
        personaFor: (charaNum) => compileAiCharacterSemanticContext(current, charaNum, "npc-public").lines,
      });
      if (!fresh || fresh.context.snapshot.contextHash !== request.context.snapshot.contextHash) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "cancelled", durationMs: Date.now() - startedAt, error: "story context changed during continuation" });
        return false;
      }
      const accepted = acceptNarrativeContinuation(request, proposal, current);
      if (!accepted.accepted) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", durationMs: Date.now() - startedAt, error: accepted.diagnostics.join("; ") });
        return false;
      }
      syncAgentFactsAndSchedule(accepted.state, program.actorIds);
      set({ state: accepted.state, error: null });
      useAiStore.getState().patchDebugEntry(requestId, { status: "success", durationMs: Date.now() - startedAt, acceptedCount: 1 });
      // The previous round's session has served its purpose. Clearing it lets
      // the new round open through the normal advance path instead of tripping
      // the "another story session is already open" guard.
      const staleStorySessions = get().dialogueQueue.filter((session) => session.owner === "story");
      if (staleStorySessions.length > 0) {
        const queue = get().dialogueQueue.filter((session) => session.owner !== "story");
        set({ ...dialogueQueueMirrors(queue) });
      }
      // The new round opens immediately: the player is already in the scene.
      get().recoverStoryProgramAction();
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", durationMs: Date.now() - startedAt, error: String(error) });
      }
      return false;
    } finally {
      const entry = useAiStore.getState().debugEntries.find((entry) => entry.requestId === requestId);
      if (entry?.status === "pending") useAiStore.getState().patchDebugEntry(requestId, { status: "cancelled", durationMs: Date.now() - startedAt });
      agentAsyncRequests.delete(`narrative:${requestId}`);
      releaseNarrativeDirector(controller);
      const nextProgram = get().state?.storyProgram;
      if (generation === narrativeGeneration && nextProgram?.version === 2 && nextProgram.status === "awaiting-player"
        && nextProgram.continuationEvidence && nextProgram.continuationEvidence.id !== evidence.id) {
        queueMicrotask(scheduleNarrativeContinuation);
      }
    }
  },

  refreshNarrativeEventsAction(trigger) {
    const current = get().state;
    if (!current) return false;
    if (!current.narrativeEvents?.length && !current.storyArcs?.length && !current.storyProgram) return false;
    const refreshed = refreshNarrativeEvents(current, trigger);
    const ended = isOpenStoryProgram(current.storyProgram) && (!isOpenStoryProgram(refreshed.storyProgram) || refreshed.storyProgram?.status === "paused");
    if (ended) cancelNarrativeDirector("story owner unavailable");
    set({ state: refreshed, ...(ended ? dialogueQueueMirrors(get().dialogueQueue.filter((session) => session.owner !== "story")) : {}) });
    scheduleBackgroundNarrativeEvolution(
      trigger === "clock-window" || trigger === "morning" ? "clock-boundary" : "important-fact",
    );
    return refreshed.narrativeEvents?.some((event) => event.status === "ready") ?? false;
  },

  startNarrativeEventAction(eventId) {
    const current = get().state;
    if (!current || get().dialogueQueue.length > 0) return false;
    const refreshed = refreshNarrativeEvents(current, "command-settled");
    const activated = activateReadyNarrativeEvent(refreshed, eventId);
    if (!activated.accepted || !activated.event) {
      set({ state: refreshed });
      return false;
    }
    cancelNarrativeDirector("foreground event activated");
    const opening = advanceStoryProgram(activated.state);
    if (opening.diagnostics.length > 0) {
      set({ state: opening.state, error: opening.diagnostics.join("; ") });
      return false;
    }
    const program = opening.state.storyProgram!;
    const actorId = program.actorIds.find((id) => id !== 0) ?? program.actorIds[0] ?? 0;
    const transcript: ObservationEvent[] = [
      // Pre-authored events carry the LLM's opening prose; the bare title is
      // only a fallback for authored events without one.
      { kind: "NARRATION", timestamp: NOW(), text: activated.event.introText ?? `【${activated.event.title}】` },
      ...opening.events,
    ];
    const session: DialogueSession = {
      id: program.id,
      owner: "story",
      dayIndex: opening.state.time.dayIndex,
      priority: DIALOGUE_SESSION_PRIORITY.story,
      interruptible: false,
      transcript,
      choice: opening.pendingChoice
        ? storyChoiceSession(opening.pendingChoice, program.id, actorId, transcript.length)
        : null,
    };
    const queue = enqueueDialogueSession(get().dialogueQueue, session);
    syncAgentFactsAndSchedule(opening.state, program.actorIds);
    set({ state: opening.state, error: null, ...dialogueQueueMirrors(queue) });
    if (opening.pendingAutonomousChoice) void continueAutonomousStoryChoice(opening.pendingAutonomousChoice);

    const settings = useAiStore.getState().settings;
    if (opening.expressionRequests.length > 0 && settings.enabled && settings.narrativeEnabled && settings.apiKey.trim()) {
      const controller = new AbortController();
      narrativeController = controller;
      const generation = narrativeGeneration;
      void (async () => {
        for (const expression of opening.expressionRequests) {
          if (controller.signal.aborted || generation !== narrativeGeneration) return;
          const profile = expression.actorId === 0 ? undefined : currentAiCharacterProfile(expression.actorId);
          try {
            const lines = await requestStoryExpression(opening.state, expression, settings, controller.signal, profile);
            const live = get();
            if (live.state?.storyProgram?.id !== expression.programId || live.state.storyProgram.contextHash !== expression.contextHash) return;
            const sessionIndex = live.dialogueQueue.findIndex((entry) => entry.id === program.id && entry.owner === "story");
            if (sessionIndex < 0) return;
            const active = live.dialogueQueue[sessionIndex]!;
            const participants = expression.participantIds?.length ? expression.participantIds : [expression.actorId];
            const fallbackLines = expression.fallbackText.split("\n");
            const first = active.transcript.findIndex((event) => event.kind === "DIALOGUE_LINE" && event.text === fallbackLines[0]);
            if (first < 0) continue;
            const transcript = [...active.transcript];
            transcript.splice(first, fallbackLines.length, ...lines.map((line, index) => ({ kind: "DIALOGUE_LINE" as const, timestamp: NOW(), charaNum: participants[index % participants.length]!, text: line.text, form: line.form, origin: "ai" as const })));
            const updatedQueue = [...live.dialogueQueue];
            updatedQueue[sessionIndex] = { ...active, transcript };
            const receiptState = live.state ? cloneGameState(live.state) : null;
            const recorded = receiptState && recordStoryExpressionReceipt(receiptState, expression, lines.map(line => line.text));
            set({ ...dialogueQueueMirrors(updatedQueue), ...(recorded ? { state: receiptState } : {}) });
          } catch {
            // Accepted deterministic fallback remains visible.
          }
        }
      })().finally(() => {
      releaseNarrativeDirector(controller);
      });
    }
    return true;
  },

  favoriteNarrativeEventAction(eventId) {
    const state = get().state;
    if (state) set({ state: recordStoryTemplateFavorite(state, eventId) });
  },

  setStoryArcStatusAction(arcId, status) {
    const state = get().state;
    if (!state || !state.storyArcs?.some(arc => arc.id === arcId && ["active", "paused"].includes(arc.status))) return;
    cancelNarrativeDirector("story arc status changed");
    cancelStoryRequests();
    const next = setStoryArcStatus(state, arcId, status);
    const ownsProgram = state.storyProgram?.version === 2 && state.storyProgram.arcId === arcId;
    const ownedSessions = new Set((state.narrativeEvents ?? []).filter(event => event.arcId === arcId)
      .flatMap(event => [event.program.id, `narrative-intro:${event.id}`]));
    if (ownsProgram) ownedSessions.add(state.storyProgram!.id);
    if (state.narrativeSituationSession?.arcId === arcId) ownedSessions.add(state.narrativeSituationSession.id);
    const queue = get().dialogueQueue.filter(session => session.owner !== "story" || !ownedSessions.has(session.id));
    set({ state: next, error: null, ...dialogueQueueMirrors(queue) });
    if (status === "active" && ownsProgram) get().recoverStoryProgramAction();
  },

  clearAiGeneratedContentAction() {
    const s = get().state;
    if (!s) return;
    // Mirror the load/restore teardown so no in-flight AI writer can re-commit
    // generated content after the wipe.
    cancelAgentNightCycle();
    cancelDaytimeReactions("clear-ai");
    cancelLazyMaterializationFromStore("clear-ai");
    cancelStoryRequests();
    cancelNarrativeDirector("clear-ai");
    cancelAllRealtimeAiKojo();
    resetSceneAmbientRuntime();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().clearGeneratedPersonas();
    useAiStore.getState().clearS4Evaluation();
    useAiStore.getState().resetEphemeral();
    set({
      state: clearAiGeneratedState(s),
      dialogueQueue: [],
      pendingArrivalEvents: null,
      pendingKojoChoice: null,
      replacedAuthorLineKeys: [],
      error: null,
    });
  },

  newGame(draft) {
    cancelAgentNightCycle();
    cancelDaytimeReactions("new game");
    cancelLazyMaterializationFromStore("new game");
    cancelStoryRequests();
    cancelNarrativeDirector("new game");
    cancelAllRealtimeAiKojo();
    resetSceneAmbientRuntime();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({
      state: buildInitialState(NOW(), draft),
      loading: false,
      error: null,
      farmScreenOpen: false,
      pendingPrompt: null,
      dialogueQueue: [],
      pendingArrivalEvents: null,
      pendingKojoChoice: null,
      replacedAuthorLineKeys: [],
    });
  },

  listNewGameKojoUpdatesAction() {
    const state = get().state;
    if (!state) return [];
    return listNewGameKojoUpdates(state, currentIntentDeps().router);
  },

  resolveNewGameKojoUpdateAction(charaNum, choices = []) {
    const state = get().state;
    if (!state) return null;
    const result = resolveNewGameKojoUpdate(
      state,
      currentIntentDeps().router,
      charaNum,
      choices,
    );
    if (result.state !== state) set({ state: result.state, error: null });
    return result;
  },

  reset() {
    cancelAgentNightCycle();
    cancelDaytimeReactions("reset");
    cancelLazyMaterializationFromStore("reset");
    cancelStoryRequests();
    cancelNarrativeDirector("reset");
    clearNarrativeSkip();
    cancelAllRealtimeAiKojo();
    resetSceneAmbientRuntime();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({
      state: null,
      loading: false,
      error: null,
      lastSavedAt: null,
      saveSlots: null,
      farmScreenOpen: false,
      pendingPrompt: null,
      dialogueQueue: [],
      pendingArrivalEvents: null,
      pendingKojoChoice: null,
      replacedAuthorLineKeys: [],
    });
  },

  // --- 角色数值调试 (debug panel) ---
  debugReadCharaGates(charaNum) {
    const s = get().state;
    if (s === null) return { 信頼度: 0, 好感度: 0, 親密: 0, 従順: 0, 欲望: 0 };
    return readCharaGates(s, charaNum);
  },

  debugPatchChara(charaNum, patch) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    patchCharaGates(next, charaNum, patch);
    set({ state: next, error: null });
  },


  debugReadMasterAbilities() {
    const s = get().state;
    if (s === null) {
      return {
        清扫技能: 0,
        话术技能: 0,
        战斗能力: 0,
        教养: 0,
        料理技能: 0,
        音乐技能: 0,
        采集Lv: 0,
      };
    }
    return readMasterDebugAbilities(s);
  },

  debugPatchMasterAbilities(patch) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    patchMasterDebugAbilities(next, patch);
    set({ state: next, error: null });
  },
}));

const CONFIGURED_LAZY_CHARACTERS = new Set<number>(CONFIGURED_ROSTER_IDS);

function lazyRequestId(characterId: number, label: string): string {
  lazyMaterializationRequestSeq += 1;
  return `lazy:${characterId}:${label}:${lazyMaterializationRequestSeq}`;
}

const lazyMaterializationHost: LazyMaterializationHost = {
  reserve(characterId, trigger, generation) {
    const requestId = lazyRequestId(characterId, trigger);
    const store = useGameStateStore.getState();
    const state = store.state;
    const skipped = (reason: string) => ({
      skipped: reason,
      requestId,
      gameDayIndex: state?.time.dayIndex,
      gameTick: state?.time.tickValue,
    });
    const settings = useAiStore.getState().settings;
    const profile = currentAiCharacterProfile(characterId);
    // Defer the whole reservation while a realtime AI kojo streams: reserve
    // clones + replaces the GameState object (first-seen/window bookkeeping),
    // which would cancel the stream and drop its pending command settlement.
    // Skipping here records no state, so nothing is lost — the next transition
    // re-runs reserve with a fresh window.
    if (hasPendingRealtimeAi()) return skipped("realtime AI kojo streaming");
    if (!state) return skipped("no game state");
    if (!CONFIGURED_LAZY_CHARACTERS.has(characterId) || !state.charas[characterId]) {
      return skipped("dynamic or unknown character");
    }
    const runtime = state.agentRuntime;
    if (!settings.enabled) return skipped("AI disabled");
    if (!runtime?.settings.masterEnabled) return skipped("Agent Runtime disabled");
    if (!settings.lazyMaterializationEnabled) return skipped("Lazy materialization disabled");
    if (!profile.enabled) return skipped("character profile disabled");
    if (!runtime.activeRoster.includes(characterId)) return skipped("character is outside the active roster");
    if (runtime.settings.excludedCharaNums.includes(characterId)) {
      return skipped("character excluded from Agent Runtime");
    }
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      return skipped("provider is not configured");
    }

    const saveBytesBeforeReservation = jsonUtf8Bytes(state);
    const next = cloneGameState(state);
    const nextRuntime = ensureAgentRuntime(next);
    nextRuntime.materialization ??= createAgentMaterializationState();
    const materialization = nextRuntime.materialization;
    resetMaterializationBudgetForDay(materialization, next.time.dayIndex);
    const nowTick = Math.max(0, Math.trunc(next.time.tickValue));
    const previousSeen = materialization.lastSeenTicks[characterId];
    const previousThrough = materialization.materializedThroughTicks[characterId] ?? 0;
    materialization.lastSeenTicks[characterId] = nowTick;
    materialization.lastSeenTicks = pruneMaterializationTicks(materialization.lastSeenTicks);

    if (previousSeen === undefined) {
      useGameStateStore.setState({ state: next, error: null });
      return skipped("first encounter recorded");
    }
    const windowStartTick = Math.max(previousSeen, previousThrough);
    if (nowTick - windowStartTick < LAZY_MIN_BLANK_TICKS) {
      useGameStateStore.setState({ state: next, error: null });
      return skipped("blank window is under 180 minutes");
    }
    if (materialization.requestCount >= MAX_LAZY_REQUESTS_PER_DAY) {
      useGameStateStore.setState({ state: next, error: null });
      return skipped("daily request budget exhausted");
    }
    if (materialization.requestedCharaNums.includes(characterId)) {
      useGameStateStore.setState({ state: next, error: null });
      return skipped("character already requested today");
    }

    const context = buildLazyMaterializationContext({
      state: next,
      characterId,
      windowStartTick,
      windowEndTick: nowTick,
      lore: profile.lore,
      styleGuide: profile.styleGuide,
      activeCharacters: nextRuntime.activeRoster
        .filter((id) => next.charas[id] && currentAiCharacterProfile(id).enabled)
        .map((id) => ({
          characterId: id,
          name: next.charas[id]!.callName ?? next.charas[id]!.name ?? `角色#${id}`,
          stateLines: [
            ...compileAiCharacterSemanticContext(next, id, "npc-public").lines,
            ...buildAgentL1Context(next, id),
          ],
          relationToSubject: relationOf(id, characterId),
          relationFromSubject: relationOf(characterId, id),
        })),
    });
    if (materialization.requestKeys.includes(context.requestKey)) {
      useGameStateStore.setState({ state: next, error: null });
      return skipped("request key already reserved");
    }
    materialization.requestCount += 1;
    materialization.requestedCharaNums.push(characterId);
    materialization.requestKeys.push(context.requestKey);
    const reservation: LazyMaterializationReservation = {
      requestId,
      generation,
      characterId,
      trigger,
      context,
      stateSnapshot: cloneGameState(next),
      settings: structuredClone(settings),
      reservationSaveBytesDelta: jsonUtf8Bytes(next) - saveBytesBeforeReservation,
    };
    agentAsyncRequests.set(`lazy:${requestId}`, {
      owner: "lazy",
      requestId,
      generation,
      dayIndex: next.time.dayIndex,
      contextHash: context.contextHash,
      requestKey: context.requestKey,
    });
    useGameStateStore.setState({ state: next, error: null });
    return { reservation };
  },

  commit(reservation, signal, experiences) {
    const current = useGameStateStore.getState().state;
    const settings = useAiStore.getState().settings;
    // Same streaming-window contract as reserve: commitAgentAsyncPatch clones
    // the state object. This round of experiences is dropped (stale-proposal
    // semantics, visible in the debug entry); queued replay is deferred.
    if (hasPendingRealtimeAi()) return null;
    if (!current
      || !settings.enabled
      || !settings.lazyMaterializationEnabled
      || !current.agentRuntime?.settings.masterEnabled
      || !current.agentRuntime.activeRoster.includes(reservation.characterId)
      || current.agentRuntime.settings.excludedCharaNums.includes(reservation.characterId)
      || !currentAiCharacterProfile(reservation.characterId).enabled
      || experiences.some((experience) => experience.participantIds.some(
        (id) => !current.agentRuntime!.activeRoster.includes(id),
      ))) return null;
    const saveBytesBefore = jsonUtf8Bytes(current);
    const experienceBytesBefore = jsonUtf8Bytes(current.acceptedExperiences ?? []);
    const committed = commitAgentAsyncPatch(current, {
      owner: "lazy",
      requestId: reservation.requestId,
      generation: reservation.generation,
      dayIndex: reservation.context.dayIndex,
      signal,
      characterId: reservation.characterId,
      contextHash: reservation.context.contextHash,
      requestKey: reservation.context.requestKey,
      windowEndTick: reservation.context.windowEndTick,
      experiences,
    });
    if (!committed) return null;
    useGameStateStore.setState({ state: committed, error: null });
    return {
      acceptedCount: experiences.length,
      experienceBytesDelta: jsonUtf8Bytes(committed.acceptedExperiences ?? []) - experienceBytesBefore,
      saveBytesDelta: (reservation.reservationSaveBytesDelta ?? 0)
        + jsonUtf8Bytes(committed) - saveBytesBefore,
    };
  },
};

function scheduleBackgroundNarrativeEvolution(trigger: NarrativeArcEvolutionTrigger): void {
  if (backgroundNarrativeEvolutionScheduled || narrativeController) return;
  backgroundNarrativeEvolutionScheduled = true;
  const epoch = narrativeReadinessEpoch;
  queueMicrotask(() => {
    backgroundNarrativeEvolutionScheduled = false;
    if (epoch !== narrativeReadinessEpoch) return;
    // Streaming-window guard: evolveNarrativeArcAction replaces the state
    // object; skip this pass while a realtime AI kojo owns the identity.
    if (hasPendingRealtimeAi()) return;
    const store = useGameStateStore.getState();
    void store.evolveNarrativeArcAction(trigger);
  });
}

/** Foreground half of the interaction-window handoff.
 *
 * Background evolution can only *promise* a player-facing window
 * (maintenance.nextChance + pendingPlayerIntents); it never mints events. When
 * such a window is servable — open now, or opening within the authoring lead —
 * this pins a foreground director pass to that Arc so the promised encounter
 * is authored BEFORE the player arrives. The player's location is irrelevant
 * to authoring: the finished event waits as `scheduled` until presence
 * promotes it via refreshNarrativeEvents, so walking in is instant pickup.
 * The presence-specialized selection remains as the on-demand fallback shape.
 *
 * `manual: false` is deliberate: the handoff is not the player's own request,
 * so it spends the foreground frequency budget and is refused once today's
 * slots are spent (window and nextChance survive; the throttle retries later).
 * `allowFree: false` stops a pinned miss from silently minting a free arc.
 *
 * Timing note: the director action runs synchronously up to its provider call
 * and claims `narrativeController` immediately, so a concurrently scheduled
 * background evolution pass yields this round. That is intended — the
 * foreground handoff outranks offscreen evolution — not a race to fix. */
function scheduleWindowDirectorRetry(): void {
  const state = useGameStateStore.getState().state;
  if (!state) return;
  const retryTimes = (state.storyArcs ?? []).flatMap((arc) => {
    const memo = arcWindowDirectorAttempts.get(arc.id);
    if (!memo || memo.dayIndex !== state.time.dayIndex || memo.count >= ARC_WINDOW_DIRECTOR_DAILY_LIMIT
      || !selectServableInteractionWindowArc({ ...state, storyArcs: [arc] }, { leadTicks: NARRATIVE_WINDOW_AUTHORING_LEAD_TICKS })) return [];
    return [Math.max(Date.now(), memo.lastAt + ARC_WINDOW_DIRECTOR_RETRY_MS)];
  });
  if (retryTimes.length === 0) return;
  const at = Math.min(...retryTimes);
  if (arcWindowDirectorRetryAt !== null && arcWindowDirectorRetryAt <= at) return;
  if (arcWindowDirectorRetryTimer !== null) clearTimeout(arcWindowDirectorRetryTimer);
  const epoch = narrativeReadinessEpoch;
  arcWindowDirectorRetryAt = at;
  arcWindowDirectorRetryTimer = setTimeout(() => {
    arcWindowDirectorRetryTimer = null;
    arcWindowDirectorRetryAt = null;
    if (epoch === narrativeReadinessEpoch) scheduleNarrativeReadiness("command-settled");
  }, at - Date.now());
}

function maybeRunNarrativeWindowDirector(): void {
  const state = useGameStateStore.getState().state;
  if (!state) return;
  // A queued event has already fulfilled the authoring handoff. Do not report
  // it as another failed attempt on every movement or readiness refresh.
  const arc = selectServableInteractionWindowArc({ ...state, storyArcs: state.storyArcs?.filter((entry) => {
    const memo = arcWindowDirectorAttempts.get(entry.id);
    return !memo || memo.dayIndex !== state.time.dayIndex
      || (memo.count < ARC_WINDOW_DIRECTOR_DAILY_LIMIT
        && (state.time.tickValue - memo.lastTick >= ARC_WINDOW_DIRECTOR_MIN_GAP_TICKS
          || Date.now() - memo.lastAt >= ARC_WINDOW_DIRECTOR_RETRY_MS));
  }) }, { leadTicks: NARRATIVE_WINDOW_AUTHORING_LEAD_TICKS });
  if (!arc) {
    const waiting = selectServableInteractionWindowArc(state, { leadTicks: NARRATIVE_WINDOW_AUTHORING_LEAD_TICKS });
    const attempts = waiting ? arcWindowDirectorAttempts.get(waiting.id) : undefined;
    if (attempts?.dayIndex === state.time.dayIndex && attempts.count >= ARC_WINDOW_DIRECTOR_DAILY_LIMIT) {
      recordNarrativeSkip("互动生成暂未成功：今日自动尝试已达上限，请查看具体错误；现有窗口仍按显示的截止时间有效");
    }
    scheduleWindowDirectorRetry();
    return;
  }
  const settings = useAiStore.getState().settings;
  // Gates below report why they stopped, but only when a window is genuinely
  // waiting — an empty director is the normal state and must stay quiet.
  if (!settings.enabled || !settings.narrativeEnabled || !settings.apiKey.trim()) {
    reportWindowBlocker(state, narrativeGateReason(settings, state.agentRuntime?.settings.masterEnabled === true)
      ?? "L3 叙事导演不可用");
    return;
  }
  // Must check before calling: runNarrativeDirectorAction unconditionally
  // cancels the in-flight owner ("new narrative request"), which could kill a
  // running night-cycle or continuation request.
  if (narrativeController !== null) {
    narrativeReadinessAfterDirector = true;
    reportWindowBlocker(state, "互动窗口等待中：已有 L3 请求在飞，结束后自动交接");
    return;
  }
  if (isOpenStoryProgram(state.storyProgram)) {
    reportWindowBlocker(state, "互动窗口等待中：已有故事占用前台");
    return;
  }
  if (useGameStateStore.getState().dialogueQueue.length > 0) {
    narrativeReadinessAfterDialogue = "command-settled";
    reportWindowBlocker(state, "互动窗口等待中：当前还有口上或选择没有走完");
    return;
  }
  if (state.narrativeSituationSession != null) {
    reportWindowBlocker(state, "互动窗口等待中：正在等待叙事情境选择");
    return;
  }
  const now = state.time.tickValue;
  const memo = arcWindowDirectorAttempts.get(arc.id);
  const epoch = narrativeReadinessEpoch;
  const pending = useGameStateStore.getState().runNarrativeDirectorAction({
    allowFree: false,
    autoSelect: true,
    manual: false,
    pinArcId: arc.id,
    playerIntent: describeArcInteractionIntent(arc),
  });
  // The action claims its controller synchronously only after all Runtime
  // gates pass. A disabled cast or exhausted budget does not spend a retry.
  if (narrativeController === null) return;
  arcWindowDirectorAttempts.set(arc.id, {
    lastTick: now, lastAt: Date.now(), dayIndex: state.time.dayIndex,
    count: memo?.dayIndex === state.time.dayIndex ? memo.count + 1 : 1,
  });
  void pending.then((ok) => {
    if (epoch !== narrativeReadinessEpoch) return;
    if (ok) { scheduleNarrativeReadiness("command-settled"); return; }
    // Another Arc may be ready even while this one is cooling down.
    scheduleNarrativeReadiness("command-settled");
    scheduleWindowDirectorRetry();
  });
}

function scheduleNarrativeReadiness(trigger: NarrativeReadyTrigger): void {
  const epoch = narrativeReadinessEpoch;
  if (narrativeReadinessScheduledEpoch === epoch) return;
  narrativeReadinessScheduledEpoch = epoch;
  queueMicrotask(() => {
    if (epoch !== narrativeReadinessEpoch) return;
    narrativeReadinessScheduledEpoch = null;
    const store = useGameStateStore.getState();
    if (!store.state) return;
    // Same identity contract as syncAgentFactsAndSchedule's readiness pass.
    if (hasPendingRealtimeAi()) {
      narrativeReadinessAfterDialogue = trigger;
      reportWindowBlocker(store.state, "互动窗口等待中：正在生成实时口上，结束后自动交接");
      return;
    }
    if (store.progressStoryletsAction()) return;
    store.refreshNarrativeEventsAction(trigger);
    scheduleBackgroundNarrativeEvolution(trigger === "clock-window" || trigger === "morning" ? "clock-boundary" : "important-fact");
    const program = useGameStateStore.getState().state?.storyProgram;
    const progressState = useGameStateStore.getState().state;
    if (program?.version === 2 && progressState?.storyArcs?.some(a => a.id === program.arcId && hasPendingStoryInteraction(a))) {
      if (useGameStateStore.getState().dialogueQueue.length > 0) narrativeReadinessAfterDialogue = trigger;
      return;
    }
    // A story already owns the foreground: `active` means the runtime is
    // mid-round and must not be interrupted, and a parked story advances only
    // once the player has actually done something involving its cast.
    if (isOpenStoryProgram(program)) {
      if (program!.version === 2 && program!.status === "active"
        && program!.nodes.some(node => node.id === program!.cursorNodeId && node.kind === "dialogue-hook")) {
        if (useGameStateStore.getState().dialogueQueue.length === 0) store.recoverStoryProgramAction();
        else narrativeReadinessAfterDialogue = trigger;
        return;
      }
      // A parked story reports its own blocker; an active round needs no note.
      if (program!.status === "awaiting-player") scheduleNarrativeContinuation();
      else clearNarrativeSkip();
      return;
    }
    // Nothing owns the stage, so a story the player can actually walk into
    // presents itself. No provider call happens here — the event was already
    // generated; this only decides when the player meets it. The deterministic
    // owners keep their priority: an empty queue means arrival, date, banquet,
    // work and authored dialogue have all already had their turn.
    const current = useGameStateStore.getState();
    if (current.dialogueQueue.length > 0) narrativeReadinessAfterDialogue = trigger;
    const ready = current.dialogueQueue.length === 0
      ? (current.state?.narrativeEvents ?? [])
        .filter((event) => event.status === "ready")
        .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id))[0]
      : undefined;
    if (ready) {
      clearNarrativeSkip();
      current.startNarrativeEventAction(ready.id);
      return;
    }
    maybeRunNarrativeWindowDirector();
    const reason = useGameStateStore.getState().state ? explainWaitingStory(useGameStateStore.getState().state!) : null;
    if (reason) recordNarrativeSkip(reason);
  });
}

useGameStateStore.subscribe((current, previous) => {
  if (narrativeReadinessAfterDialogue === null) return;
  const streamingEnded = previous.dialogueQueue.some((session) => session.aiRequestId !== undefined)
    && !current.dialogueQueue.some((session) => session.aiRequestId !== undefined);
  const dialogueEnded = previous.dialogueQueue.length > 0 && current.dialogueQueue.length === 0;
  if (!streamingEnded && !dialogueEnded) return;
  const trigger = narrativeReadinessAfterDialogue;
  narrativeReadinessAfterDialogue = null;
  if (streamingEnded && narrativeAutomaticMenuCleanupId !== null) {
    const sessionId = narrativeAutomaticMenuCleanupId;
    narrativeAutomaticMenuCleanupId = null;
    if (current.state?.narrativeSituationSession?.id === sessionId) {
      useGameStateStore.setState({ state: { ...current.state, narrativeSituationSession: null } });
    }
  }
  scheduleNarrativeReadiness(trigger);
});

/** A parked story only advances once the player has actually done something
 * involving its cast. The event log is the only record of what just happened,
 * so the check reads it rather than guessing from the clock. */
/** Generate the next round of a story that is waiting on the player.
 *
 * Called from the command-settled hook, so it runs after deterministic
 * settlement and never blocks it. It refuses to run when the provider is
 * unavailable or the player has not engaged the cast — the story simply waits,
 * and the player keeps full control of when it moves. */
function scheduleNarrativeContinuation(): void {
  const store = useGameStateStore.getState();
  const state = store.state;
  const program = state?.storyProgram;
  if (!state || !program || program.status !== "awaiting-player") return;
  if (hasPendingRealtimeAi()) return;
  const settings = useAiStore.getState().settings;
  if (!settings.enabled || !settings.narrativeEnabled || !settings.apiKey.trim()) {
    recordNarrativeSkip("等待玩家介入：叙事 provider 未就绪");
    return;
  }
  if (program.version !== 2 || !program.continuationEvidence || program.continuationAttemptId === program.continuationEvidence.id) {
    // Parked on purpose: the story moves once the player does something that
    // involves its cast, so "no evidence yet" is a state, not a failure.
    recordNarrativeSkip("等待玩家介入：本幕之后还没有属于该卡司的新行动");
    return;
  }
  clearNarrativeSkip();
  void store.continueNarrativeStoryAction();
}

function scheduleLazyMaterializationForTransition(transition: EncounterTransition | null): void {
  if (!transition) return;
  const state = useGameStateStore.getState().state;
  const settings = useAiStore.getState().settings;
  if (!state?.agentRuntime?.settings.masterEnabled
    || !settings.enabled
    || !settings.lazyMaterializationEnabled) return;
  for (const charaNum of [...transition.candidateCharaNums].sort((left, right) => left - right)) {
    prepareCharacterForEncounter(charaNum, "encounter", lazyMaterializationHost);
  }
}

async function continueAutonomousStoryChoice(prompt: StoryAutonomousChoicePrompt): Promise<void> {
  const snapshot = useGameStateStore.getState().state;
  if (!snapshot?.storyProgram || snapshot.storyProgram.version !== 2
    || snapshot.storyProgram.id !== prompt.programId
    || snapshot.storyProgram.cursorNodeId !== prompt.nodeId
    || snapshot.storyProgram.contextHash !== prompt.contextHash) return;
  const settings = useAiStore.getState().settings;
  let optionId = prompt.fallbackOptionId;
  let controller: AbortController | null = null;
  let generation = narrativeGeneration;
  let requestId: string | null = null;
  if (settings.enabled && settings.narrativeEnabled && settings.apiKey.trim()) {
    cancelNarrativeDirector("autonomous story choice");
    generation = narrativeGeneration;
    controller = new AbortController();
    narrativeController = controller;
    requestId = `story-choice:${generation}:${prompt.programId}:${prompt.nodeId}`;
    agentAsyncRequests.set(`narrative:${requestId}`, {
      owner: "narrative",
      requestId,
      generation,
      dayIndex: snapshot.time.dayIndex,
      contextHash: prompt.contextHash,
    });
    try {
      optionId = await requestStoryAutonomousChoice(snapshot, prompt, settings, controller.signal);
    } catch {
      optionId = prompt.fallbackOptionId;
    }
  }
  try {
    const live = useGameStateStore.getState();
    const current = live.state;
    if (!current?.storyProgram || current.storyProgram.version !== 2
      || current.storyProgram.id !== prompt.programId
      || current.storyProgram.cursorNodeId !== prompt.nodeId
      || current.storyProgram.contextHash !== prompt.contextHash
      || (controller && (controller.signal.aborted || generation !== narrativeGeneration))) return;
    const result = advanceStoryProgram(current, optionId);
    if (result.diagnostics.length > 0) {
      useGameStateStore.setState({ state: result.state, error: result.diagnostics.join("; ") });
      return;
    }
    const session = live.dialogueQueue.find((entry) => entry.id === prompt.programId && entry.owner === "story");
    if (session) {
      const transcript = [...session.transcript, ...result.events];
      const actorId = result.state.storyProgram?.actorIds.find((id) => id !== 0)
        ?? result.state.storyProgram?.actorIds[0]
        ?? 0;
      const choice = result.pendingChoice
        ? storyChoiceSession(result.pendingChoice, prompt.programId, actorId, transcript.length)
        : null;
      useGameStateStore.setState({
        state: result.state,
        error: null,
        ...dialogueQueueMirrors(replaceActiveDialogueSession(live.dialogueQueue, transcript, choice)),
      });
    } else {
      useGameStateStore.setState({ state: result.state, error: null });
    }
    if (result.pendingAutonomousChoice) void continueAutonomousStoryChoice(result.pendingAutonomousChoice);
  } finally {
    if (requestId) agentAsyncRequests.delete(`narrative:${requestId}`);
    if (controller && narrativeController === controller) narrativeController = null;
  }
}

// Settings can also be changed outside AiSettingsPopup (tests, future shells,
// or persisted-setting restore). Keep cancellation at the store boundary so
// disabling either global AI or Lazy always invalidates queued/in-flight work.
useGameStateStore.subscribe((current, previous) => {
  const state = current.state;
  if (state !== previous.state && state?.aiDialogueAccompany
    && Object.keys(state.aiDialogueAccompany).some(id => !hasDialogueAccompanyDecision(state, Number(id)))) {
    const next = cloneGameState(state);
    pruneDialogueAccompanyPermits(next);
    useGameStateStore.setState({ state: next });
  }
});

useAiStore.subscribe((current, previous) => {
  const state = useGameStateStore.getState().state;
  if (state?.aiDialogueAccompany && (!current.settings.enabled || !current.settings.dialogueActionsEnabled
    || Object.keys(state.aiDialogueAccompany).some(id => current.settings.characterProfiles[id]?.enabled === false))) {
    const next = cloneGameState(state);
    if (!current.settings.enabled || !current.settings.dialogueActionsEnabled) delete next.aiDialogueAccompany;
    else for (const id of Object.keys(next.aiDialogueAccompany!)) {
      if (current.settings.characterProfiles[id]?.enabled === false) delete next.aiDialogueAccompany![Number(id)];
    }
    useGameStateStore.setState({ state: next });
  }
  if ((previous.settings.enabled && !current.settings.enabled)
    || (previous.settings.dialogueActionsEnabled && !current.settings.dialogueActionsEnabled)) {
    // The second request uses the same owner id as the original chat.
    for (const session of useGameStateStore.getState().dialogueQueue) {
      if (session.aiRequestId) cancelDialogueActionJudge(session.aiRequestId);
    }
  }
  if ((previous.settings.enabled && !current.settings.enabled)
    || (previous.settings.lazyMaterializationEnabled
      && !current.settings.lazyMaterializationEnabled)) {
    cancelLazyMaterializationFromStore("AI or Lazy materialization disabled");
  }
  if ((previous.settings.enabled && !current.settings.enabled)
    || (previous.settings.narrativeEnabled && !current.settings.narrativeEnabled)) {
    cancelNarrativeDirector("AI or Narrative Director disabled");
  }
  if ((previous.settings.enabled && !current.settings.enabled)
    || (previous.settings.daytimeReactionEnabled === true
      && current.settings.daytimeReactionEnabled !== true)) {
    cancelDaytimeReactions("AI or daytime reactions disabled");
  }
});

function saveSummary(state: GameState): SaveSummary {
  return {
    day: state.time.dayIndex + 1,
    place: state.master.location,
    name: state.master.callName ?? "主人公",
  };
}
