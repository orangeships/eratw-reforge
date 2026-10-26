import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { archivedEpisodes, importLegacyMemories, pendingArchivedDialogues, prepareMemoryRecords } from "./memory-archive.js";
import type { AgentMemoryRecordV1 } from "../../../modernization/runtime/agent/memory-archive.js";
import { completeWithStateContext } from "./state-context.js";
import { cloneGameState } from "../../../modernization/runtime/state/game-state.js";
import { getVisibleExperiences } from "../../../modernization/runtime/experience.js";
import type {
  AgentCommissionCandidate,
  AgentDailyCharacterRecord,
  AgentNightDraft,
  AgentNightResponseV2,
  AgentNightResponseV3,
  AgentNightResult,
  AgentPlanCandidate,
  AgentPlanSelection,
} from "../../../modernization/runtime/agent/types.js";
import {
  applyAgentPlan,
  applyCommissionDecision,
  captureRelationshipEvidence,
  compileCommissionCandidates,
  compileHardBlocks,
  DEFAULT_ORCHESTRATION_CONFIG,
  deriveFreeWindows,
  eligibleAgentCharaNums,
  enforceCognitiveCaps,
  ensureCognitiveState,
  applyAgentMindUpdates,
  consumePendingEpisodes,
  createAgentMindState,
  filterValidSelections,
  generateCandidates,
  getAgentDailyCharacterRecord,
  hashPlanContext,
  hasInterestingEventAnchor,
  recordAgentDecision,
  validateAgentStoryClaim,
  consumeDaytimeEvidenceForNight,
} from "../../../modernization/runtime/agent/index.js";
import type { AiProvider, AiSettings } from "./types.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { useAiStore } from "./store.js";
import { buildAgentNightCompletion } from "./agent-night-context.js";
import { compileAiCharacterSemanticContext } from "./context.js";
import { buildAgentDiaryCompletion, createJevDiaryJudge, parseAgentDiaryText, withDiaryDeadline,
  type AgentDiaryInput, type AgentDiaryJudge } from "./agent-diary.js";
import { parseAgentNightResponse } from "./agent-night-validator.js";
import {
  buildAgentNightAuditCompletion,
  parseAgentNightAuditResponse,
} from "./agent-night-audit.js";

let providerOverride: AiProvider | null = null;

export function configureAgentNightProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

function hashText(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return `night-${Math.abs(hash).toString(36)}`;
}

function activeRosterLimit(state: Readonly<GameState>): number {
  return Math.max(1, Math.min(state.agentRuntime?.settings.maxActiveAgents ?? 10, 20));
}

// ── Night cycle progress (morning-menu waiting screen) ─────────────────────
//
// The store layer surfaces these through `nightCycleStatus` so the 起床前主菜单
// can show what the background sidecar is doing while day-break waits for it
// (「xxx正在回想一天的经历」/「xxx正在写日记」/「少女祈祷中....」).

/** Only "writing" means that a positive JEV result started diary generation. */
export type AgentNightCharaPhase = "reflecting" | "reviewing" | "judging-diary" | "writing" | "settled" | "failed";

export interface AgentNightCharaProgress {
  charaNum: number;
  /** Display name (`callName`), resolved once per cycle. */
  name: string;
  phase: AgentNightCharaPhase;
}

export type AgentNightPhase = "preparing" | "auditing" | "committing" | "complete";

export interface NightCycleProgress {
  phase: AgentNightPhase;
  /** The observation day being reflected upon (not the request day). */
  dayIndex: number;
  entries: readonly AgentNightCharaProgress[];
}

export interface AgentNightCycleDeps {
  signal?: AbortSignal;
  observationDayIndex?: number;
  onProgress?: (progress: NightCycleProgress) => void;
  /** Caller-specific request cap. Night orchestration always clamps this to
   *  four, even if a future setting accidentally supplies a larger value. */
  maxConcurrency?: number;
  /** Injected classifier for regression tests; production always uses JEV. */
  diaryJudge?: AgentDiaryJudge;
}

export const MAX_NIGHT_LLM_CONCURRENCY = 4;

/** Hash every fact whose drift invalidates the whole Night batch. */
export function computeAgentNightBatchContextHash(
  state: Readonly<GameState>,
  observationDayIndex: number,
): string {
  const runtime = state.agentRuntime;
  const roster = (runtime?.activeRoster ?? []).filter((id) => state.charas[id]).slice(0, activeRosterLimit(state));
  const ledgerDay = runtime?.dailyLedger.days.find((day) => day.dayIndex === observationDayIndex);
  const records = roster.map((charaNum) => {
    const record = ledgerDay?.characters[charaNum];
    return record ? {
      charaNum,
      activities: record.activities,
      visitedLocations: record.visitedLocations,
      encounters: record.encounters,
      relationshipStart: record.relationshipStart,
      relationshipEnd: record.relationshipEnd,
      relationshipChanges: record.relationshipChanges,
    } : { charaNum, missing: true };
  });
  const cognitionInputs = roster.map((charaNum) => {
    const cognition = runtime?.cognitions[charaNum];
    return cognition ? {
      charaNum,
      memories: cognition.memories,
      reflections: cognition.reflections,
      mind: cognition.mind ?? null,
      pendingEpisodes: cognition.pendingEpisodes ?? [],
      memoryHead: runtime?.memoryArchive?.heads[charaNum] ?? null,
      memoryReadThrough: runtime?.memoryArchive?.reflectedThrough[charaNum] ?? null,
      daytimeSync: cognition.daytimeSync ?? null,
      currentPlan: cognition.currentPlan ?? null,
      commissionDecision: cognition.commissionDecision ?? null,
      diarySchedule: cognition.diaries.map((entry) => ({ dayIndex: entry.dayIndex, trigger: entry.trigger ?? null })),
      commandDays: (runtime?.engagements[charaNum]?.signals ?? [])
        .filter((signal) => signal.kind === "command")
        .map((signal) => signal.dayIndex),
    } : { charaNum, missing: true };
  });
  const experienceIds = (state.acceptedExperiences ?? [])
    .filter((entry) => entry.endTick > observationDayIndex * 1440 && entry.startTick < (observationDayIndex + 1) * 1440)
    .map((entry) => entry.id)
    .sort();
  return hashText(JSON.stringify({
    tick: state.time.tickValue,
    dayIndex: state.time.dayIndex,
    observationDayIndex,
    roster,
    records,
    cognitionInputs,
    experienceIds,
  }));
}

function ephemeralRecord(
  state: Readonly<GameState>,
  charaNum: number,
  dayIndex: number,
): AgentDailyCharacterRecord | null {
  const slot = state.charas[charaNum];
  const relationship = captureRelationshipEvidence(state, charaNum);
  if (!slot || !relationship) return null;
  return {
    charaNum,
    dayIndex,
    startedAtTick: state.time.tickValue,
    initialLocation: slot.location,
    lastKnownLocation: slot.location,
    activities: [],
    visitedLocations: [],
    encounters: [],
    relationshipStart: relationship,
    relationshipEnd: relationship,
    relationshipChanges: [],
    sequence: 0,
  };
}

async function completeWithTimeout(
  provider: AiProvider,
  request: Parameters<AiProvider["complete"]>[0],
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeoutId = setTimeout(abort, Math.max(5_000, Math.min(settings.timeoutMs, 60_000)));
  try {
    return await completeWithStateContext(provider, request, controller.signal);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

/** One model attempt for a night reflection: call, parse, and enforce the
 * response envelope. Returns the usable response or the reason it failed —
 * never throws, so the caller can decide whether a second attempt is worth it. */
async function requestNightResponse(
  provider: AiProvider,
  completion: Parameters<AiProvider["complete"]>[0],
  settings: AiSettings,
  signal: AbortSignal | undefined,
  expect: { charaNum: number; observationDayIndex: number; contextHash: string },
): Promise<{ response: AgentNightResponseV2 | AgentNightResponseV3 } | { error: string }> {
  try {
    const response = parseAgentNightResponse(await completeWithTimeout(provider, completion, settings, signal));
    if (response.charaNum !== expect.charaNum
      || response.dayIndex !== expect.observationDayIndex
      || response.contextHash !== expect.contextHash) {
      return { error: "validation failed: stale or mismatched response envelope" };
    }
    return { response };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "";
    return { error: `provider/validation failed: ${reason === "AbortError" ? "aborted" : String(error)}` };
  }
}

interface PreparedDraft extends AgentNightDraft {
  episodeIds: string[];
  archiveReadThrough?: string;
  evidenceSnapshot: Pick<import("./agent-night-context.js").AgentNightPromptInput, "ledger" | "visibleExperiences" | "pendingEpisodes">;
  planCandidates: AgentPlanCandidate[];
  validPlanSelections: AgentPlanSelection[];
  scheduleHash: string;
  planningDay: number;
  commissionCandidates: AgentCommissionCandidate[];
  diagnostics: string[];
  evidenceIds: string[];
}

function evidenceIdsForNight(
  ledger: AgentDailyCharacterRecord,
  visibleExperiences: readonly import("../../../modernization/runtime/experience.js").AcceptedExperience[],
  pendingEpisodes: readonly import("../../../modernization/runtime/agent/types.js").AgentPendingEpisode[],
): string[] {
  return [
    ...ledger.activities.flatMap((entry) => [entry.id, `ledger:${entry.id}`]),
    ...ledger.visitedLocations.flatMap((entry) => [entry.id, `ledger:${entry.id}`]),
    ...ledger.encounters.flatMap((entry) => [entry.id, `ledger:${entry.id}`]),
    ...visibleExperiences.flatMap((entry) => [entry.id, `experience:${entry.id}`]),
    ...pendingEpisodes.flatMap((entry) => [entry.id, `episode:${entry.id}`]),
  ];
}

async function prepareDraft(
  state: Readonly<GameState>,
  charaNum: number,
  observationDayIndex: number,
  batchContextHash: string,
  provider: AiProvider,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<{ draft: PreparedDraft | null; result: AgentNightResult }> {
  const diagnostics: string[] = [];
  const runtime = state.agentRuntime;
  const slot = state.charas[charaNum];
  if (!runtime || !slot) return { draft: null, result: { charaNum, events: [], diagnostics: ["missing runtime character"] } };
  const cognition = runtime.cognitions[charaNum];
  const ledger = getAgentDailyCharacterRecord(state, observationDayIndex, charaNum)
    ?? ephemeralRecord(state, charaNum, observationDayIndex);
  if (!ledger) return { draft: null, result: { charaNum, events: [], diagnostics: ["missing ledger relationship snapshot"] } };

  const planningDay = state.time.dayIndex;
  const blocks = compileHardBlocks(state as GameState, charaNum, planningDay);
  const planCandidates = generateCandidates(state as GameState, charaNum, deriveFreeWindows(blocks));
  const proposalHash = hashPlanContext(blocks, planCandidates);
  const contextHash = hashText(`${batchContextHash}|${charaNum}|${proposalHash}`);
  const commissionCandidates = compileCommissionCandidates(state as GameState, charaNum);
  const dayStart = observationDayIndex * 1440;
  const visibleExperiences = getVisibleExperiences(state.acceptedExperiences ?? [], charaNum)
    .filter((entry) => entry.endTick > dayStart && entry.startTick < dayStart + 1440)
    .slice(-8);
  const mind = cognition?.mind ?? createAgentMindState();
  const archived = pendingArchivedDialogues(runtime, charaNum, observationDayIndex);
  const pendingEpisodes = archived.length ? archivedEpisodes(runtime, charaNum, observationDayIndex)
    : (cognition?.pendingEpisodes ?? []).filter(episode => episode.dayIndex <= observationDayIndex).slice(0, 12);
  const completion = buildAgentNightCompletion({
    charaNum,
    dayIndex: observationDayIndex,
    contextHash,
    state,
    ledger,
    mind,
    pendingEpisodes,
    visibleExperiences,
    recentMemories: cognition?.memories.slice(-8) ?? [],
    recentReflections: cognition?.reflections.slice(-3) ?? [],
    planCandidates,
    commissionCandidates,
  });

  // One retry, inline, on either a provider error or a response the validator
  // rejected. Format slips and transient network errors are both common enough
  // that a second attempt is usually cheaper than losing the whole character's
  // night. A player-initiated cancel is never retried: they asked for the night
  // to end, and a second attempt would only make them wait longer.
  const expect = { charaNum, observationDayIndex, contextHash };
  const first = await requestNightResponse(provider, completion, settings, signal, expect);
  let response: AgentNightResponseV2 | AgentNightResponseV3;
  if ("response" in first) {
    response = first.response;
  } else {
    diagnostics.push(`${first.error} (attempt 1)`);
    if (signal?.aborted) return { draft: null, result: { charaNum, events: [], diagnostics } };
    const second = await requestNightResponse(provider, completion, settings, signal, expect);
    if (!("response" in second)) {
      diagnostics.push(`${second.error} (attempt 2)`);
      return { draft: null, result: { charaNum, events: [], diagnostics } };
    }
    response = second.response;
  }
  if (response.schemaVersion === 3 && response.validationDiagnostics?.length) {
    diagnostics.push(...response.validationDiagnostics);
  }

  let auditStatus: PreparedDraft["auditStatus"] = "not-applicable";
  if (response.interestingEvent) {
    if (!hasInterestingEventAnchor(ledger)) {
      response.interestingEvent = null;
      auditStatus = "story-dropped";
      diagnostics.push("dropped story: no objective ledger anchor");
    } else {
      const validation = validateAgentStoryClaim(state, ledger, response.interestingEvent.claim);
      if (!validation.valid) {
        response.interestingEvent = null;
        auditStatus = "story-dropped";
        diagnostics.push(`dropped story: ${validation.reason}`);
      }
    }
  }

  const currentMinute = ((state.time.tickValue % 1440) + 1440) % 1440;
  const planResult = filterValidSelections(response.nextTendency.planSelections ?? [], planCandidates, {
    notBeforeMinute: currentMinute,
  });
  if (planResult.dropped.length > 0) diagnostics.push(`dropped ${planResult.dropped.length} invalid plan selections`);
  const commission = response.nextTendency.commissionSelection;
  if (commission?.action === "propose" && !commissionCandidates.some((entry) => entry.id === commission.candidateId)) {
    response.nextTendency.commissionSelection = undefined;
    diagnostics.push("dropped unknown commission candidate");
  }

  return {
    draft: {
      charaNum,
      dayIndex: observationDayIndex,
      contextHash,
      response,
      auditStatus,
      planCandidates,
      validPlanSelections: planResult.valid,
      scheduleHash: hashPlanContext(blocks),
      planningDay,
      commissionCandidates,
      diagnostics,
      evidenceIds: evidenceIdsForNight(ledger, visibleExperiences, pendingEpisodes),
      episodeIds: (cognition?.pendingEpisodes ?? []).filter(episode => pendingEpisodes.some(selected => selected.sessionId === episode.sessionId)).map(episode => episode.id),
      archiveReadThrough: archived.at(-1)?.id,
      evidenceSnapshot: { ledger: structuredClone(ledger), visibleExperiences: structuredClone(visibleExperiences), pendingEpisodes: structuredClone(pendingEpisodes) },
    },
    result: { charaNum, events: [], diagnostics },
  };
}

function dropStory(draft: PreparedDraft, status: PreparedDraft["auditStatus"], diagnostic: string): void {
  draft.response.interestingEvent = null;
  draft.auditStatus = status;
  draft.diagnostics.push(diagnostic);
}

async function auditDraftStories(
  state: Readonly<GameState>,
  drafts: PreparedDraft[],
  provider: AiProvider,
  settings: AiSettings,
  batchContextHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const initial = drafts.filter((draft) => draft.response.interestingEvent);
  if (initial.length === 0) return;
  const auditHash = hashText(`${batchContextHash}|audit|${JSON.stringify(initial.map((draft) => draft.response.interestingEvent))}`);
  let audit;
  try {
    const raw = await completeWithTimeout(provider, buildAgentNightAuditCompletion({
      state, dayIndex: initial[0]!.dayIndex, contextHash: auditHash, drafts: initial, phase: "initial", settings,
    }), settings, signal);
    audit = parseAgentNightAuditResponse(raw, {
      dayIndex: initial[0]!.dayIndex,
      contextHash: auditHash,
      charaNums: initial.map((draft) => draft.charaNum),
      allowRewrite: true,
    });
  } catch (error) {
    for (const draft of initial) dropStory(draft, "audit-failed", `audit failed; story removed: ${String(error)}`);
    return;
  }

  const rewritten: PreparedDraft[] = [];
  for (const decision of audit.decisions) {
    const draft = initial.find((entry) => entry.charaNum === decision.charaNum)!;
    if (decision.action === "delete") {
      dropStory(draft, "story-dropped", "audit deleted story");
    } else if (decision.action === "accept") {
      draft.auditStatus = "accepted";
    } else if (decision.interestingEvent) {
      const record = getAgentDailyCharacterRecord(state, draft.dayIndex, draft.charaNum)
        ?? ephemeralRecord(state, draft.charaNum, draft.dayIndex);
      const validation = record ? validateAgentStoryClaim(state, record, decision.interestingEvent.claim) : { valid: false as const, reason: "missing ledger" };
      if (!validation.valid) {
        dropStory(draft, "story-dropped", `audit rewrite rejected: ${validation.reason}`);
      } else {
        draft.response.interestingEvent = decision.interestingEvent;
        rewritten.push(draft);
      }
    }
  }
  if (rewritten.length === 0) return;

  const recheckHash = hashText(`${auditHash}|recheck|${JSON.stringify(rewritten.map((draft) => draft.response.interestingEvent))}`);
  try {
    const raw = await completeWithTimeout(provider, buildAgentNightAuditCompletion({
      state, dayIndex: rewritten[0]!.dayIndex, contextHash: recheckHash, drafts: rewritten, phase: "recheck", settings,
    }), settings, signal);
    const recheck = parseAgentNightAuditResponse(raw, {
      dayIndex: rewritten[0]!.dayIndex,
      contextHash: recheckHash,
      charaNums: rewritten.map((draft) => draft.charaNum),
      allowRewrite: false,
    });
    for (const decision of recheck.decisions) {
      const draft = rewritten.find((entry) => entry.charaNum === decision.charaNum)!;
      if (decision.action === "accept") draft.auditStatus = "rewritten";
      else dropStory(draft, "story-dropped", "recheck deleted rewritten story");
    }
  } catch (error) {
    for (const draft of rewritten) dropStory(draft, "audit-failed", `recheck failed; rewritten story removed: ${String(error)}`);
  }
}

function reflectionText(draft: PreparedDraft, mind: Readonly<import("../../../modernization/runtime/agent/types.js").AgentMindStateV1>): string {
  const story = draft.response.interestingEvent?.text ?? "今天没有足够事实锚点可写成故事。";
  return [
    `对主角的态度：${draft.response.attitudeToPlayer.text}`,
    ...(mind.relationshipToPlayer ? [`归并后的关系理解：${mind.relationshipToPlayer}`] : []),
    `今天有意思的事：${story}`,
    `接下来的倾向：${mind.currentTendency || draft.response.nextTendency.text}`,
  ].join("\n");
}

async function commitDrafts(state: GameState, drafts: PreparedDraft[], canCommit: () => boolean): Promise<AgentNightResult[]> {
  if (drafts.length === 0) return [];
  const next = cloneGameState(state);
  const runtime = next.agentRuntime!;
  const nowTick = next.time.tickValue;
  const results: AgentNightResult[] = [];
  const archiveRecords: AgentMemoryRecordV1[] = [];
  for (const draft of drafts) {
    const cognition = ensureCognitiveState(runtime, draft.charaNum);
    const currentMind = cognition.mind ?? createAgentMindState();
    const mindUpdates = draft.response.schemaVersion === 3
      ? draft.response.mindUpdates
      : {
          relationshipToPlayer: draft.response.attitudeToPlayer.text,
          currentTendency: draft.response.nextTendency.text,
        };
    const mindResult = applyAgentMindUpdates(currentMind, mindUpdates, {
      charaNum: draft.charaNum,
      dayIndex: draft.dayIndex,
      tick: nowTick,
      knownEvidenceIds: new Set(draft.evidenceIds),
    });
    cognition.mind = mindResult.mind;
    if (mindResult.diagnostics.length > 0) draft.diagnostics.push(...mindResult.diagnostics);
    const text = reflectionText(draft, mindResult.mind);
    const storyClaim = draft.response.interestingEvent?.claim;
    cognition.reflections.push({
      id: `refl-${draft.charaNum}-${draft.dayIndex}-${cognition.reflections.length}`,
      createdDay: draft.dayIndex,
      createdTick: nowTick,
      text,
      parts: {
        attitudeToPlayer: draft.response.attitudeToPlayer.text,
        interestingEvent: draft.response.interestingEvent?.text ?? null,
        nextTendency: draft.response.nextTendency.text,
        ...(storyClaim ? { storyClaim } : {}),
      },
      auditStatus: draft.auditStatus,
    });
    // A legacy response may still contain diaryText. It never bypasses JEV.
    archiveRecords.push({ kind: "nightly-reflection", charaNum: draft.charaNum,
      sourceId: `night:${draft.charaNum}:${draft.dayIndex}:${draft.contextHash}`, dayIndex: draft.dayIndex,
      tick: nowTick, location: next.charas[draft.charaNum]?.location ?? null,
      lines: [{ speaker: "character", text }], details: {
        reflection: structuredClone(cognition.reflections.at(-1)), evidence: draft.evidenceSnapshot,
        mindBefore: structuredClone(currentMind), mindAfter: structuredClone(mindResult.mind),
      } });
    const consumedEpisodeIds = consumePendingEpisodes(cognition, draft.dayIndex, draft.episodeIds);
    if (draft.archiveReadThrough && runtime.memoryArchive) runtime.memoryArchive.reflectedThrough[draft.charaNum] = draft.archiveReadThrough;
    consumeDaytimeEvidenceForNight(next, draft.charaNum);
    if (draft.validPlanSelections.length > 0) {
      applyAgentPlan(runtime, draft.charaNum, draft.validPlanSelections, draft.planCandidates,
        draft.planningDay, draft.scheduleHash, nowTick);
    }
    const commission = draft.response.nextTendency.commissionSelection;
    if (commission && (commission.action === "defer"
      || draft.commissionCandidates.some((entry) => entry.id === commission.candidateId))) {
      applyCommissionDecision(cognition, commission, nowTick, draft.planningDay);
    }
    cognition.lastUpdatedTick = nowTick;
    recordAgentDecision(runtime, draft.charaNum, draft.dayIndex, nowTick, draft.response.schemaVersion === 3 ? "nightly-reflection-v3" : "nightly-reflection-v2", {
      auditStatus: draft.auditStatus,
      hasInterestingEvent: draft.response.interestingEvent !== null,
      planSelectionCount: draft.validPlanSelections.length,
      commissionAction: commission?.action ?? null,
      consumedEpisodeIds,
      mindRevision: cognition.mind.revision,
    });
    const name = next.charas[draft.charaNum]?.callName ?? `#${draft.charaNum}`;
    results.push({
      charaNum: draft.charaNum,
      events: [{ kind: "NARRATION", text: `${name}在入睡前整理了今天的三段反思。`, charaNum: draft.charaNum }],
      diagnostics: draft.diagnostics,
    });
  }
  enforceCognitiveCaps(runtime);
  runtime.memoryArchive = await prepareMemoryRecords(runtime, archiveRecords);
  if (!canCommit()) return [];
  // Reflections and their evidence are archived even when no diary is written.
  state.agentRuntime = next.agentRuntime;
  return results;
}

function diaryInput(state: Readonly<GameState>, draft: PreparedDraft): AgentDiaryInput {
  const cognition = state.agentRuntime!.cognitions[draft.charaNum]!;
  const { ledger, visibleExperiences, pendingEpisodes } = draft.evidenceSnapshot;
  return {
    charaNum: draft.charaNum, dayIndex: draft.dayIndex, contextHash: draft.contextHash,
    name: state.charas[draft.charaNum]?.callName ?? `角色${draft.charaNum}`,
    persona: compileAiCharacterSemanticContext(state, draft.charaNum, "player").lines.slice(0, 12).map(line => line.slice(0, 240)),
    reflection: { attitudeToPlayer: draft.response.attitudeToPlayer.text, interestingEvent: draft.response.interestingEvent?.text ?? null,
      nextTendency: draft.response.nextTendency.text },
    currentMind: { relationshipToPlayer: cognition.mind?.relationshipToPlayer ?? "", currentTendency: cognition.mind?.currentTendency ?? "" },
    facts: {
      relationship: { start: ledger.relationshipStart, end: ledger.relationshipEnd, changes: ledger.relationshipChanges },
      activities: ledger.activities, visitedLocations: ledger.visitedLocations, encounters: ledger.encounters,
      experiences: visibleExperiences.map(entry => ({ id: entry.id, summary: entry.payload.summary })),
      // Classification does not need the entire archived transcript.
      conversations: pendingEpisodes.slice(-6).map(episode => ({ id: episode.id,
        lines: episode.lines.slice(-4).map(line => ({ speaker: line.speaker, text: line.text.slice(0, 200) })),
        choices: episode.choices.map(choice => choice.label) })),
    },
    recentDiaries: cognition.diaries.filter(entry => entry.dayIndex <= draft.dayIndex).slice(-3)
      .map(entry => ({ dayIndex: entry.dayIndex, text: entry.text })),
  };
}

/** Optional presentation after the audited reflection transaction. Failure cannot erase it. */
async function prepareDiaries(state: GameState, drafts: PreparedDraft[], provider: AiProvider, settings: AiSettings,
  deps: AgentNightCycleDeps | undefined, concurrency: number,
  onPhase: (charaNum: number, phase: AgentNightCharaPhase) => void): Promise<void> {
  const baseline = computeAgentNightBatchContextHash(state, deps?.observationDayIndex ?? state.time.dayIndex);
  const isCurrent = () => !deps?.signal?.aborted && baseline === computeAgentNightBatchContextHash(state, deps?.observationDayIndex ?? state.time.dayIndex);
  const judge = deps?.diaryJudge ?? createJevDiaryJudge(settings);
  const prepared: Array<{ draft: PreparedDraft; text: string; requestId: string }> = [];
  for (let index = 0; index < drafts.length && isCurrent(); index += concurrency) {
    await Promise.all(drafts.slice(index, index + concurrency).map(async draft => {
      const cognition = state.agentRuntime!.cognitions[draft.charaNum]!;
      if (cognition.diaries.some(entry => entry.dayIndex === draft.dayIndex)) { onPhase(draft.charaNum, "settled"); return; }
      const startedAt = Date.now();
      const requestId = `diary:${draft.contextHash}:${draft.charaNum}:${startedAt}`;
      useAiStore.getState().addDebugEntry({ requestId, createdAt: startedAt, feature: "agent-diary", target: draft.charaNum,
        gameDayIndex: draft.dayIndex, status: "pending" });
      try {
        const input = diaryInput(state, draft);
        onPhase(draft.charaNum, "judging-diary");
        const decision = await withDiaryDeadline(signal => judge.judge(input, signal), deps?.signal, Math.min(settings.timeoutMs, 12000));
        if (!isCurrent()) return;
        if (decision !== "write" && decision !== "skip") throw new Error("Invalid diary classifier category");
        draft.diagnostics.push(`JEV 日记判定：${decision === "write" ? "很重要，值得写日记" : "不写日记"}`);
        useAiStore.getState().patchDebugEntry(requestId, { response: JSON.stringify({ decision }) });
        if (decision === "skip") {
          useAiStore.getState().patchDebugEntry(requestId, { status: "skipped", skipReason: "不写日记", acceptedCount: 0 });
          return;
        }
        onPhase(draft.charaNum, "writing");
        const raw = await withDiaryDeadline(signal => provider.complete(buildAgentDiaryCompletion(input), signal), deps?.signal,
          Math.min(settings.timeoutMs, 60000));
        if (isCurrent()) prepared.push({ draft, text: parseAgentDiaryText(raw, input), requestId });
      } catch (error) {
        draft.diagnostics.push(`日记未生成，反思已保留：${String(error)}`);
        useAiStore.getState().patchDebugEntry(requestId, { status: "error", error: String(error), acceptedCount: 0 });
      } finally {
        useAiStore.getState().patchDebugEntry(requestId, { durationMs: Date.now() - startedAt,
          ...(!isCurrent() ? { status: "cancelled" as const, skipReason: "日记请求已取消或上下文已变化" } : {}) });
        onPhase(draft.charaNum, "settled");
      }
    }));
  }
  if (!isCurrent()) {
    for (const { requestId } of prepared) useAiStore.getState().patchDebugEntry(requestId, { status: "cancelled", acceptedCount: 0 });
    return;
  }
  for (const { draft, text, requestId } of prepared) {
    state.agentRuntime!.cognitions[draft.charaNum]!.diaries.push({
      id: `diary-${draft.charaNum}-${draft.dayIndex}`, dayIndex: draft.dayIndex, tick: state.time.tickValue,
      text, sourceObservationIds: draft.response.interestingEvent?.claim.anchorIds ?? [], trigger: "jev",
    });
    useAiStore.getState().patchDebugEntry(requestId, { status: "success", acceptedCount: 1 });
  }
  enforceCognitiveCaps(state.agentRuntime!);
}

export async function runMultiAgentNightCycle(
  state: GameState,
  settings: AiSettings,
  deps?: AgentNightCycleDeps,
): Promise<AgentNightResult[]> {
  const runtime = state.agentRuntime;
  if (!runtime?.settings.masterEnabled || !settings.enabled || !settings.baseUrl || !settings.model) return [];
  const eligible = new Set(eligibleAgentCharaNums(state));
  const targets = runtime.activeRoster
    .filter((id) => eligible.has(id) && state.charas[id])
    .slice(0, activeRosterLimit(state));
  if (targets.length === 0) return [];
  await importLegacyMemories(state);
  const observationDayIndex = deps?.observationDayIndex ?? state.time.dayIndex;
  const batchContextHash = computeAgentNightBatchContextHash(state, observationDayIndex);
  const provider = providerOverride ?? createOpenAiCompatibleProvider(settings);
  const requestedConcurrency = Math.trunc(deps?.maxConcurrency ?? DEFAULT_ORCHESTRATION_CONFIG.maxConcurrency);
  const concurrency = Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(MAX_NIGHT_LLM_CONCURRENCY, requestedConcurrency))
    : DEFAULT_ORCHESTRATION_CONFIG.maxConcurrency;
  const prepared: PreparedDraft[] = [];
  const results = new Map<number, AgentNightResult>();
  // Progress reporting: snapshot entries in target order on every emit.
  // Wrapped so a throwing consumer can never break the night cycle itself.
  const charaPhases = new Map<number, AgentNightCharaPhase>();
  const emit = (phase: AgentNightPhase): void => {
    if (!deps?.onProgress) return;
    try {
      deps.onProgress({
        phase,
        dayIndex: observationDayIndex,
        entries: targets.map((charaNum) => ({
          charaNum,
          name: state.charas[charaNum]?.callName ?? `#${charaNum}`,
          phase: charaPhases.get(charaNum) ?? "reflecting",
        })),
      });
    } catch {
      // Progress must never break the cycle.
    }
  };
  emit("preparing");
  for (let index = 0; index < targets.length; index += concurrency) {
    const batch = targets.slice(index, index + concurrency);
    for (const charaNum of batch) charaPhases.set(charaNum, "reflecting");
    emit("preparing");
    const settled = await Promise.all(batch.map((charaNum) => prepareDraft(
      state, charaNum, observationDayIndex, batchContextHash, provider, settings, deps?.signal,
    ).then((value) => {
      charaPhases.set(charaNum, value.draft ? "reviewing" : "failed");
      emit("preparing");
      return value;
    })));
    for (const value of settled) {
      results.set(value.result.charaNum, value.result);
      if (value.draft) prepared.push(value.draft);
    }
  }
  if (deps?.signal?.aborted) return targets.map((charaNum) => results.get(charaNum) ?? { charaNum, events: [], diagnostics: ["aborted"] });
  emit("auditing");
  await auditDraftStories(state, prepared, provider, settings, batchContextHash, deps?.signal);
  if (deps?.signal?.aborted || computeAgentNightBatchContextHash(state, observationDayIndex) !== batchContextHash) {
    return targets.map((charaNum) => results.get(charaNum) ?? { charaNum, events: [], diagnostics: ["stale batch discarded"] });
  }
  emit("committing");
  const canCommit = () => !deps?.signal?.aborted && computeAgentNightBatchContextHash(state, observationDayIndex) === batchContextHash;
  const committed = await commitDrafts(state, prepared, canCommit);
  for (const result of committed) results.set(result.charaNum, result);
  await prepareDiaries(state, prepared.filter(draft => committed.some(result => result.charaNum === draft.charaNum)), provider,
    settings, deps, concurrency, (charaNum, phase) => { charaPhases.set(charaNum, phase); emit("committing"); });
  emit("complete");
  return targets.map((charaNum) => results.get(charaNum) ?? { charaNum, events: [], diagnostics: [] });
}

export async function runAgentNightCycle(
  state: GameState,
  settings: AiSettings,
  deps?: AgentNightCycleDeps,
): Promise<AgentNightResult | null> {
  const results = await runMultiAgentNightCycle(state, settings, deps);
  return results[0] ?? null;
}
