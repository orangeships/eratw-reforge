import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type {
  AgentNightResult,
} from "../../../modernization/runtime/agent/types.js";
import {
  ensureCognitiveState,
  compileObservations,
  compileHardBlocks,
  deriveFreeWindows,
  generateCandidates,
  filterValidSelections,
  applyAgentPlan,
  hashPlanContext,
  selectNightTargets,
  recordAgentDecision,
  DEFAULT_ORCHESTRATION_CONFIG,
  compileCommissionCandidates,
  applyCommissionDecision,
  eligibleAgentCharaNums,
} from "../../../modernization/runtime/agent/index.js";
import type { AiProvider, AiSettings } from "./types.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { buildAgentNightCompletion } from "./agent-night-context.js";
import { parseAgentNightResponse } from "./agent-night-validator.js";

/** Test-only override. */
let providerOverride: AiProvider | null = null;

export function configureAgentNightProviderForTests(
  provider: AiProvider | null,
): void {
  providerOverride = provider;
}

// ═══════════════════════════════════════════════════════════════════
// Single-character processing (extracted from the old runAgentNightCycle)
// ═══════════════════════════════════════════════════════════════════

/**
 * Process the night cognitive cycle for ONE character.
 *
 * **The caller MUST have already called `compileObservations` for this
 * character** — this function skips the compilation step and goes straight
 * to building the prompt, calling the LLM, parsing the response, and
 * applying results to the cognitive state.
 *
 * Returns `null` when there are no observations worth processing.
 */
async function processAgentNightCycle(
  state: GameState,
  charaNum: number,
  settings: AiSettings,
  deps?: { signal?: AbortSignal; observationDayIndex?: number },
): Promise<AgentNightResult | null> {
  const runtime = state.agentRuntime!;
  const slot = state.charas[charaNum];
  if (!slot) return null;

  const cog = ensureCognitiveState(runtime, charaNum);
  const diagnostics: string[] = [];
  const cognitiveDay = deps?.observationDayIndex ?? state.time.dayIndex;

  // ── 1. Check for new observations ────────────────────────────
  const allObs = cog.observations;
  const newObservations = allObs.filter((o) => o.tick > cog.lastUpdatedTick);
  const newObsCount = newObservations.length;
  diagnostics.push(`${newObsCount} new observations (${allObs.length} total)`);
  if (allObs.length === 0) {
    diagnostics.push("skipped — no observations");
    return null;
  }

  // ── 2. Compile plan candidates for tomorrow (A3) ─────────────
  const planningDay = state.time.dayIndex;
  const blocks = compileHardBlocks(state, charaNum, planningDay);
  const windows = deriveFreeWindows(blocks);
  const candidates = generateCandidates(state, charaNum, windows);
  const proposalContextHash = hashPlanContext(blocks, candidates);
  diagnostics.push(
    `${blocks.length} hard blocks, ${windows.length} free windows, ${candidates.length} candidates`,
  );

  // ── 2b. Compile commission candidates (A5) ──────────────────
  const commissionCandidates = compileCommissionCandidates(state, charaNum);
  if (commissionCandidates.length > 0) {
    diagnostics.push(`${commissionCandidates.length} commission candidates`);
  }

  // ── 3. Build prompt ──────────────────────────────────────────
  const recentMemories = cog.memories.slice(-8);
  const activeGoals = cog.goals.filter((g) => g.status === "active");

  const completion = buildAgentNightCompletion({
    charaNum,
    dayIndex: cognitiveDay,
    contextHash: proposalContextHash,
    state,
    observations: newObservations.slice(-24),
    recentMemories,
    activeGoals,
    planCandidates: candidates,
    commissionCandidates:
      commissionCandidates.length > 0 ? commissionCandidates : undefined,
  });

  // ── 4. Call provider ─────────────────────────────────────────
  const provider = providerOverride ?? createOpenAiCompatibleProvider(settings);
  const timeoutMs = Math.max(5000, Math.min(settings.timeoutMs, 60000));
  const controller = new AbortController();
  const linkedSignal = deps?.signal;
  if (linkedSignal) {
    linkedSignal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    raw = await provider.complete(completion, controller.signal);
  } catch (err) {
    clearTimeout(timeoutId);
    diagnostics.push(`provider failed: ${String(err)}`);
    return {
      charaNum,
      events: [],
      diagnostics,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  // ── 5. Parse & validate ──────────────────────────────────────
  let response: ReturnType<typeof parseAgentNightResponse>;
  try {
    response = parseAgentNightResponse(raw);
  } catch (err) {
    diagnostics.push(`validation failed: ${String(err)}`);
    return {
      charaNum,
      events: [],
      diagnostics,
    };
  }
  if (
    response.charaNum !== charaNum ||
    response.dayIndex !== cognitiveDay ||
    response.contextHash !== proposalContextHash
  ) {
    diagnostics.push("validation failed: stale or mismatched response envelope");
    return {
      charaNum,
      events: [],
      diagnostics,
    };
  }

  // ── 6. Validate observation references ────────────────────────
  const validObsIds = new Set(allObs.map((o) => o.id));
  if (response.memoryDrafts) {
    for (const draft of response.memoryDrafts) {
      if (!validObsIds.has(draft.observationId)) {
        diagnostics.push(`rejected memoryDraft with unknown observationId "${draft.observationId}"`);
        response.memoryDrafts = response.memoryDrafts.filter(
          (d) => d.observationId !== draft.observationId,
        );
      }
    }
  }

  // ── 7. Apply to cognitive state ──────────────────────────────
  const nowTick = state.time.tickValue;
  const dayIndex = cognitiveDay;

  if (response.memoryDrafts && response.memoryDrafts.length > 0) {
    for (const draft of response.memoryDrafts) {
      cog.memories.push({
        id: `mem-${charaNum}-${dayIndex}-${cog.memories.length}`,
        createdDay: dayIndex,
        createdTick: nowTick,
        sourceObservationIds: [draft.observationId],
        text: draft.text,
        importance: draft.importance,
      });
    }
    diagnostics.push(`wrote ${response.memoryDrafts.length} memories`);
  }

  if (response.reflection) {
    cog.reflections.push({
      id: `refl-${charaNum}-${dayIndex}-${cog.reflections.length}`,
      createdDay: dayIndex,
      createdTick: nowTick,
      text: response.reflection.text,
    });
    diagnostics.push("wrote reflection");
  }

  if (response.goalUpdates && response.goalUpdates.length > 0) {
    for (const g of response.goalUpdates) {
      if (g.goalId) {
        const existingGoal = cog.goals.find((goal) => goal.id === g.goalId);
        if (!existingGoal) {
          diagnostics.push(`rejected goal update with unknown goalId "${g.goalId}"`);
          continue;
        }
        existingGoal.text = g.text;
        existingGoal.status = g.status;
        if (g.status !== "active") existingGoal.resolvedDay = dayIndex;
        continue;
      }
      if (g.status !== "active") {
        diagnostics.push("rejected terminal goal update without goalId");
        continue;
      }
      cog.goals.push({
        id: `goal-${charaNum}-${dayIndex}-${cog.goals.length}`,
        createdDay: dayIndex,
        createdTick: nowTick,
        text: g.text,
        status: g.status,
      });
    }
    diagnostics.push(`wrote ${response.goalUpdates.length} goals`);
  }

  let diaryWritten = false;
  if (response.diary) {
    const validDiarySources = response.diary.sourceObservationIds.filter((id) => validObsIds.has(id));
    if (validDiarySources.length !== response.diary.sourceObservationIds.length) {
      diagnostics.push("rejected diary with unknown observation reference");
    } else {
    cog.diaries.push({
      id: `diary-${charaNum}-${dayIndex}`,
      dayIndex,
      tick: nowTick,
      text: response.diary.text,
      sourceObservationIds: validDiarySources,
    });
    diaryWritten = true;
    diagnostics.push("wrote diary");
    }
  }

  // ── 8. Apply plan selections (A3) ────────────────────────────
  let validPlanCount = 0;
  if (response.planSelections && response.planSelections.length > 0) {
    const currentMinute = ((state.time.tickValue % 1440) + 1440) % 1440;
    const { valid, dropped } = filterValidSelections(response.planSelections, candidates, {
      notBeforeMinute: currentMinute,
    });
    if (dropped.length > 0) {
      diagnostics.push(`dropped ${dropped.length} invalid plan selections: ${dropped.join("; ")}`);
    }
    if (valid.length > 0) {
      const scheduleHash = hashPlanContext(blocks);
      applyAgentPlan(runtime, charaNum, valid, candidates, planningDay, scheduleHash, nowTick);
      validPlanCount = valid.length;
      diagnostics.push(`applied ${valid.length} plan selections for day ${planningDay}`);
    }
  }

  // ── 8b. Apply commission selections (A5) ─────────────────────
  let commissionAction: string | undefined;
  if (response.commissionSelections && response.commissionSelections.length > 0) {
    const sel = response.commissionSelections[0];
    // Validate candidate exists for "propose" action
    if (
      sel.action === "defer" ||
      commissionCandidates.some((c) => c.id === sel.candidateId)
    ) {
      applyCommissionDecision(cog, sel, nowTick, planningDay);
      commissionAction = sel.action;
      if (sel.action === "propose") {
        const cand = commissionCandidates.find((c) => c.id === sel.candidateId);
        diagnostics.push(`commission decision: propose ${cand?.name ?? sel.candidateId}`);
      } else {
        diagnostics.push("commission decision: defer");
      }
    } else {
      diagnostics.push(`rejected commission selection: unknown candidate "${sel.candidateId}"`);
    }
  }

  cog.lastUpdatedTick = nowTick;

  // ── 9. Log accepted decision (A4) ────────────────────────────
  recordAgentDecision(runtime, charaNum, dayIndex, nowTick, "nightly-cognitive-cycle", {
    memoryCount: response.memoryDrafts?.length ?? 0,
    hasReflection: !!response.reflection,
    goalUpdateCount: response.goalUpdates?.length ?? 0,
    hasDiary: !!response.diary,
    planSelectionCount: validPlanCount,
    commissionAction: commissionAction ?? null,
  });

  // ── 10. Build result events ───────────────────────────────────
  const name = slot.callName ?? `#${charaNum}`;
  const parts: string[] = [];
  if (response.memoryDrafts?.length)
    parts.push(`整理了 ${response.memoryDrafts.length} 条记忆`);
  if (response.reflection) parts.push("写下了反思");
  if (diaryWritten) parts.push("写了日记");
  const summary = parts.length > 0
    ? `${name} 在入睡前${parts.join("，")}。`
    : `${name} 安静地入睡了。`;

  return {
    charaNum,
    events: [{ kind: "NARRATION", text: summary, charaNum }],
    diagnostics,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Backward-compatible single-pilot wrapper (kept for tests + A2 compat)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the night cognitive cycle for the pilot character (activeRoster[0]).
 *
 * Thin wrapper around `processAgentNightCycle` that compiles observations
 * first.  Kept for backward compatibility with A2/A3 tests — new code
 * should use `runMultiAgentNightCycle` instead.
 */
export async function runAgentNightCycle(
  state: GameState,
  settings: AiSettings,
  deps?: { signal?: AbortSignal; observationDayIndex?: number },
): Promise<AgentNightResult | null> {
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return null;
  if (!settings.enabled || !settings.baseUrl || !settings.model) return null;
  if (runtime.activeRoster.length === 0) return null;

  const charaNum = runtime.activeRoster[0];
  if (!state.charas[charaNum]) return null;

  compileObservations(state, charaNum, deps?.observationDayIndex);
  return processAgentNightCycle(state, charaNum, settings, deps);
}

// ═══════════════════════════════════════════════════════════════════
// Multi-character nightly orchestration (A4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Run the night cognitive cycle for **all dirty characters** on the
 * active roster.
 *
 * Flow:
 * 1. Compile observations for every active roster member.
 * 2. `selectNightTargets` → which characters are dirty + priority order.
 * 3. Process in batches of `maxConcurrency` (default 3).
 * 4. Per-character failures are isolated — one timeout/error never blocks
 *    the rest.
 * 5. Each successful character gets an `AcceptedAgentDecision` logged.
 *
 * Returns all `AgentNightResult` objects (one per successfully processed
 * character).  Returns `[]` (empty array) when the agent is disabled, no
 * characters are on the roster, or none are dirty.
 */
export async function runMultiAgentNightCycle(
  state: GameState,
  settings: AiSettings,
  deps?: { signal?: AbortSignal; observationDayIndex?: number },
): Promise<AgentNightResult[]> {
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return [];
  if (!settings.enabled || !settings.baseUrl || !settings.model) return [];
  if (runtime.activeRoster.length === 0) return [];

  const diagnostics: string[] = [];

  // ── 1. Compile observations for ALL active roster members ────
  for (const charaNum of eligibleAgentCharaNums(state)) {
    if (state.charas[charaNum]) {
      compileObservations(state, charaNum, deps?.observationDayIndex);
    }
  }
  diagnostics.push("compiled observations for all eligible characters");

  // ── 2. Select dirty targets ──────────────────────────────────
  const targets = selectNightTargets(runtime, state);
  diagnostics.push(`${targets.length} dirty targets selected`);

  if (targets.length === 0) {
    // Log skip decision even when nothing to do.
    return [];
  }

  // ── 3. Batch process with concurrency limit ──────────────────
  const concurrency = DEFAULT_ORCHESTRATION_CONFIG.maxConcurrency;

  const results: AgentNightResult[] = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    diagnostics.push(
      `batch ${Math.floor(i / concurrency) + 1}: ${batch.map((t) => `#${t.charaNum}(${t.reason})`).join(", ")}`,
    );

    const settled = await Promise.allSettled(
      batch.map((t) =>
        processAgentNightCycle(state, t.charaNum, settings, deps),
      ),
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      } else if (r.status === "rejected") {
        const target = batch[j];
        diagnostics.push(`#${target.charaNum} failed: ${String(r.reason)}`);
        // Optional AI failure is diagnostic-only; it must not leak into the
        // player's night report or next-morning history.
        results.push({
          charaNum: target.charaNum,
          events: [],
          diagnostics: [`failed: ${String(r.reason)}`],
        });
      }
    }
  }

  // Attach orchestration diagnostics to the first result.
  if (results.length > 0) {
    results[0].diagnostics = [...diagnostics, ...results[0].diagnostics];
  }

  return results;
}
