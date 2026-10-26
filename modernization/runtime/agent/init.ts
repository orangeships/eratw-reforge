import type { GameState } from "../state/game-state.js";
import { cloneGameState } from "../state/game-state.js";
import type {
  AgentCognitiveState,
  AgentEngagement,
  AgentMaterializationState,
  AgentRuntimeState,
} from "./types.js";
import { createEngagement, MAX_SIGNALS } from "./engagement.js";
import { createAgentDailyLedger } from "./daily-ledger.js";
import {
  AGENT_MIND_CAPS,
  createAgentMindState,
  normalizeAgentMindState,
  normalizeAgentPendingEpisodes,
} from "./mind.js";

/** Current agent-runtime-internal schema version. */
export const AGENT_RUNTIME_VERSION = 2;

/** Default maximum number of simultaneously active agents. */
export const DEFAULT_MAX_ACTIVE_AGENTS = 10;
export const MAX_MATERIALIZATION_CHARACTERS = 256;
export const MAX_LAZY_REQUESTS_PER_DAY = 3;

/** Storage caps on per-character cognitive collections. */
export const COGNITIVE_CAPS = {
  observations: 96,
  daytimePendingObservations: 24,
  daytimeConsumedObservations: 64,
  memories: 64,
  reflections: 12,
  goals: 8,
  mindBeliefs: AGENT_MIND_CAPS.beliefs,
  mindGoals: AGENT_MIND_CAPS.goals,
  mindThreads: AGENT_MIND_CAPS.threads,
  pendingEpisodes: AGENT_MIND_CAPS.pendingEpisodes,
  diaries: 30,
} as const;

export function createAgentMaterializationState(): AgentMaterializationState {
  return {
    lastSeenTicks: {},
    materializedThroughTicks: {},
    budgetDay: -1,
    requestCount: 0,
    requestedCharaNums: [],
    requestKeys: [],
  };
}

export function createAgentRuntimeState(): AgentRuntimeState {
  return {
    version: AGENT_RUNTIME_VERSION,
    cognitions: {},
    engagements: {},
    activeRoster: [],
    previousRoster: [],
    rosterSelectedDay: -1,
    settings: {
      masterEnabled: false,
      maxActiveAgents: DEFAULT_MAX_ACTIVE_AGENTS,
      pinnedCharaNums: [],
      excludedCharaNums: [],
    },
    acceptedDecisions: [],
    decisionSeq: 0,
    materialization: createAgentMaterializationState(),
    dailyLedger: createAgentDailyLedger(),
  };
}

/**
 * 问题3 — wipe every AI-generated persisted field from a game state while
 * keeping user configuration intact. Cleared:
 *   - `agentRuntime` cognition (observations/memories/reflections/goals/
 *     mind/pending episodes/diaries), engagement signals, accepted decisions, materialization
 *     bookkeeping and the daily relationship ledger;
 *   - `acceptedExperiences`, `storyProgram`, `narrativeEvents`, `storyArcs`,
 *     `storyTemplateFavorites`.
 * Preserved: agent settings + roster selection (user config, not AI output)
 * and every deterministic field (原版日记/kojoMemory/charasInfo etc.).
 */
export function clearAiGeneratedState(state: GameState): GameState {
  const next = cloneGameState(state);
  const previous = next.agentRuntime;
  const fresh = createAgentRuntimeState();
  if (previous) {
    fresh.settings = structuredClone(previous.settings);
    fresh.activeRoster = [...previous.activeRoster];
    fresh.previousRoster = [...previous.previousRoster];
    fresh.rosterSelectedDay = previous.rosterSelectedDay;
  }
  next.agentRuntime = fresh;
  next.acceptedExperiences = [];
  next.storyProgram = null;
  next.narrativeEvents = [];
  next.storyArcs = [];
  next.storyTemplateFavorites = [];
  return next;
}

/** Reset only the day-scoped reservation fields. Encounter history survives. */
export function resetMaterializationBudgetForDay(
  materialization: AgentMaterializationState,
  dayIndex: number,
): void {
  if (materialization.budgetDay === dayIndex) return;
  materialization.budgetDay = dayIndex;
  materialization.requestCount = 0;
  materialization.requestedCharaNums = [];
  materialization.requestKeys = [];
}

/** Keep the most recently touched stable characters, deterministically. */
export function pruneMaterializationTicks(
  values: Record<number, number>,
  limit = MAX_MATERIALIZATION_CHARACTERS,
): Record<number, number> {
  return Object.fromEntries(Object.entries(values)
    .filter(([key, tick]) => Number.isSafeInteger(Number(key)) && Number(key) > 0
      && Number.isSafeInteger(tick) && tick >= 0)
    .sort(([leftId, leftTick], [rightId, rightTick]) =>
      rightTick - leftTick || Number(leftId) - Number(rightId))
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(([key, tick]) => [Number(key), tick]));
}

/**
 * Ensure `state.agentRuntime` exists, lazily initialising it with
 * safe defaults.  Follows the `ensureCommissionState` / `getFarm` pattern.
 *
 * Default settings: **masterEnabled = false**, so no agent behaviour
 * triggers for existing saves until explicitly enabled.
 */
export function ensureAgentRuntime(state: GameState): AgentRuntimeState {
  if (!state.agentRuntime) {
    state.agentRuntime = createAgentRuntimeState();
  }
  return state.agentRuntime;
}

/**
 * Ensure a character has a cognitive state entry, lazily initialising it.
 */
export function ensureCognitiveState(
  runtime: AgentRuntimeState,
  charaNum: number,
): AgentCognitiveState {
  let cog = runtime.cognitions[charaNum];
  if (!cog) {
    cog = {
      observations: [],
      memories: [],
      reflections: [],
      goals: [],
      mind: createAgentMindState(),
      pendingEpisodes: [],
      daytimeSync: {
        version: 1,
        pendingObservationIds: [],
        consumedObservationIds: [],
        revision: 0,
        lastProjectedTick: 0,
      },
      diaries: [],
      lastUpdatedTick: 0,
    };
    runtime.cognitions[charaNum] = cog;
  }
  cog.mind ??= createAgentMindState();
  cog.pendingEpisodes ??= [];
  cog.daytimeSync ??= {
    version: 1,
    pendingObservationIds: [],
    consumedObservationIds: [],
    revision: 0,
    lastProjectedTick: 0,
  };
  return cog;
}

/**
 * Ensure a character has an engagement entry, lazily initialising it.
 */
export function ensureEngagement(
  runtime: AgentRuntimeState,
  charaNum: number,
): AgentEngagement {
  let eng = runtime.engagements[charaNum];
  if (!eng) {
    eng = createEngagement();
    runtime.engagements[charaNum] = eng;
  }
  return eng;
}

/**
 * Enforce storage caps on every character's cognitive collections and
 * engagement signals.  Excess entries are trimmed oldest-first.
 *
 * Call this at day-end (before nightly processing) so that capped
 * arrays never grow unbounded across long-running games.
 */
export function enforceCognitiveCaps(runtime: AgentRuntimeState): void {
  for (const key of Object.keys(runtime.cognitions)) {
    const cog = runtime.cognitions[Number(key)];
    if (!cog) continue;
    if (cog.observations.length > COGNITIVE_CAPS.observations) {
      cog.observations = cog.observations.slice(-COGNITIVE_CAPS.observations);
    }
    if (cog.memories.length > COGNITIVE_CAPS.memories) {
      cog.memories = cog.memories.slice(-COGNITIVE_CAPS.memories);
    }
    if (cog.reflections.length > COGNITIVE_CAPS.reflections) {
      cog.reflections = cog.reflections.slice(-COGNITIVE_CAPS.reflections);
    }
    if (cog.goals.length > COGNITIVE_CAPS.goals) {
      cog.goals = cog.goals.slice(-COGNITIVE_CAPS.goals);
    }
    cog.mind = normalizeAgentMindState(cog.mind);
    cog.pendingEpisodes = normalizeAgentPendingEpisodes(cog.pendingEpisodes);
    if (cog.daytimeSync) {
      cog.daytimeSync = {
        version: 1,
        pendingObservationIds: [...new Set(cog.daytimeSync.pendingObservationIds
          .filter((id) => typeof id === "string" && id.length > 0))]
          .slice(-COGNITIVE_CAPS.daytimePendingObservations),
        consumedObservationIds: [...new Set(cog.daytimeSync.consumedObservationIds
          .filter((id) => typeof id === "string" && id.length > 0))]
          .slice(-COGNITIVE_CAPS.daytimeConsumedObservations),
        revision: Number.isSafeInteger(cog.daytimeSync.revision) && cog.daytimeSync.revision >= 0
          ? cog.daytimeSync.revision
          : 0,
        lastProjectedTick: Number.isSafeInteger(cog.daytimeSync.lastProjectedTick)
          && cog.daytimeSync.lastProjectedTick >= 0
          ? cog.daytimeSync.lastProjectedTick
          : 0,
        ...(Number.isSafeInteger(cog.daytimeSync.lastReactionTick)
          && Number(cog.daytimeSync.lastReactionTick) >= 0
          ? { lastReactionTick: Number(cog.daytimeSync.lastReactionTick) }
          : {}),
      };
    }
    if (cog.diaries.length > COGNITIVE_CAPS.diaries) {
      cog.diaries = cog.diaries.slice(-COGNITIVE_CAPS.diaries);
    }
  }
  for (const key of Object.keys(runtime.engagements)) {
    const eng = runtime.engagements[Number(key)];
    if (!eng) continue;
    if (eng.signals.length > MAX_SIGNALS) {
      eng.signals = eng.signals.slice(-MAX_SIGNALS);
    }
  }
}
