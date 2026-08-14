import type { GameState } from "../state/game-state.js";
import type {
  AgentCognitiveState,
  AgentEngagement,
  AgentRuntimeState,
} from "./types.js";
import { createEngagement, MAX_SIGNALS } from "./engagement.js";

/** Current agent-runtime-internal schema version. */
export const AGENT_RUNTIME_VERSION = 2;

/** Default maximum number of simultaneously active agents. */
export const DEFAULT_MAX_ACTIVE_AGENTS = 10;

/** Storage caps on per-character cognitive collections. */
export const COGNITIVE_CAPS = {
  observations: 96,
  memories: 64,
  reflections: 12,
  goals: 8,
  diaries: 30,
} as const;

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
  };
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
      diaries: [],
      lastUpdatedTick: 0,
    };
    runtime.cognitions[charaNum] = cog;
  }
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
