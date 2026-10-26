import type { GameState } from "../state/game-state.js";
import {
  COGNITIVE_CAPS,
  ensureCognitiveState,
} from "./init.js";
import { applyAgentMindUpdates, createAgentMindState } from "./mind.js";
import { compileObservations } from "./observation-compiler.js";
import type {
  AgentCognitiveState,
  AgentMindUpdatesV1,
  AgentObservation,
} from "./types.js";

/** A bounded, deterministic projection result.  It contains no provider data. */
export interface DaytimeFactProjection {
  affectedCharaNums: number[];
  observationIds: string[];
}

export interface DaytimeEvidenceBatch {
  charaNum: number;
  baseRevision: number;
  observations: AgentObservation[];
}

export interface DaytimeMindApplyResult {
  accepted: boolean;
  stale: boolean;
  diagnostics: string[];
  observationIds: string[];
  mindRevision?: number;
}

function validCharaIds(state: Readonly<GameState>, ids: Iterable<number>): number[] {
  return [...new Set([...ids]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .filter((id) => state.charas[id] !== undefined))]
    .sort((left, right) => left - right);
}

/**
 * Find observers that may have learned something since the last projection.
 * Visibility is still enforced inside `compileObservations`; this set only
 * controls which cognition buffers are touched.  Active-roster characters are
 * included for public facts, while private facts add their explicit witnesses
 * and participants.  Existing cognition entries are retained so an off-roster
 * character can keep reading facts without starting a model request.
 */
function observerCandidates(
  state: Readonly<GameState>,
  relatedCharacterIds: readonly number[] = [],
): number[] {
  const runtime = state.agentRuntime;
  const candidates = new Set<number>([
    ...(runtime?.activeRoster ?? []),
    ...Object.keys(runtime?.cognitions ?? {}).map(Number),
    ...Object.keys(runtime?.engagements ?? {}).map(Number),
    ...relatedCharacterIds,
  ]);
  for (const experience of state.acceptedExperiences ?? []) {
    if (experience.endTick > state.time.tickValue) continue;
    if (experience.visibility.public) {
      for (const id of runtime?.activeRoster ?? []) candidates.add(id);
      for (const id of Object.keys(runtime?.cognitions ?? {}).map(Number)) candidates.add(id);
    } else {
      for (const id of experience.visibility.participantIds) candidates.add(id);
      for (const id of experience.visibility.witnessIds) candidates.add(id);
    }
  }
  return validCharaIds(state, candidates);
}

/**
 * Project deterministic facts immediately after a settled state transition.
 * This is intentionally synchronous and provider-free: L1/L3 can consume the
 * same accepted facts before any optional daytime L2 request completes.
 */
export function projectDaytimeAgentFacts(
  state: GameState,
  options: { relatedCharacterIds?: readonly number[] } = {},
): DaytimeFactProjection {
  const runtime = state.agentRuntime;
  if (!runtime?.settings.masterEnabled) return { affectedCharaNums: [], observationIds: [] };

  const affectedCharaNums: number[] = [];
  const observationIds: string[] = [];
  for (const charaNum of observerCandidates(state, options.relatedCharacterIds)) {
    const observations = compileObservations(state, charaNum, state.time.dayIndex);
    const cognition = ensureCognitiveState(runtime, charaNum);
    const sync = cognition.daytimeSync!;
    sync.lastProjectedTick = Math.max(sync.lastProjectedTick, state.time.tickValue);
    if (observations.length === 0) continue;

    const pending = new Set(sync.pendingObservationIds);
    const consumed = new Set(sync.consumedObservationIds);
    for (const observation of observations) {
      if (!consumed.has(observation.id)) pending.add(observation.id);
      observationIds.push(observation.id);
    }
    sync.pendingObservationIds = [...pending].slice(-COGNITIVE_CAPS.daytimePendingObservations);
    sync.revision += 1;
    affectedCharaNums.push(charaNum);
  }
  return {
    affectedCharaNums: [...new Set(affectedCharaNums)].sort((left, right) => left - right),
    observationIds: [...new Set(observationIds)],
  };
}

/** Return the still-unconsumed daytime evidence for one character. */
export function getPendingDaytimeEvidence(
  state: Readonly<GameState>,
  charaNum: number,
  limit = 12,
): DaytimeEvidenceBatch | null {
  const cognition = state.agentRuntime?.cognitions[charaNum];
  const sync = cognition?.daytimeSync;
  if (!cognition || !sync || sync.pendingObservationIds.length === 0) return null;
  const byId = new Map(cognition.observations.map((observation) => [observation.id, observation]));
  const observations = sync.pendingObservationIds
    .map((id) => byId.get(id))
    .filter((observation): observation is AgentObservation => observation !== undefined)
    .slice(-Math.max(1, Math.trunc(limit)));
  if (observations.length === 0) return null;
  return {
    charaNum,
    baseRevision: sync.revision,
    observations: structuredClone(observations),
  };
}

/**
 * Apply one validated daytime mind patch at the Runtime merge boundary.
 * Stale revisions and missing evidence fail closed and leave the pending queue
 * intact so a later request can retry with the current state.
 */
export function applyDaytimeMindUpdates(
  state: GameState,
  input: {
    charaNum: number;
    baseRevision: number;
    observationIds: readonly string[];
    updates?: AgentMindUpdatesV1;
  },
): DaytimeMindApplyResult {
  const runtime = state.agentRuntime;
  const cognition = runtime?.cognitions[input.charaNum];
  const sync = cognition?.daytimeSync;
  if (!runtime?.settings.masterEnabled || !cognition || !sync) {
    return { accepted: false, stale: false, diagnostics: ["daytime sync is disabled or character is unknown"], observationIds: [] };
  }
  if (sync.revision !== input.baseRevision) {
    return { accepted: false, stale: true, diagnostics: ["daytime reaction revision is stale"], observationIds: [] };
  }
  const requestedIds = [...new Set(input.observationIds.filter((id) => typeof id === "string" && id.length > 0))];
  const pending = new Set(sync.pendingObservationIds);
  if (requestedIds.length === 0 || requestedIds.some((id) => !pending.has(id))) {
    return { accepted: false, stale: true, diagnostics: ["daytime reaction references unavailable evidence"], observationIds: [] };
  }
  const knownEvidenceIds = new Set(requestedIds);
  // Older saves may contain cognition buffers without the newer mind object.
  // Materialize the bounded default before applying a daytime reaction so the
  // merge path remains safe even when migration was bypassed in a fixture.
  cognition.mind ??= createAgentMindState();
  const currentMind = cognition.mind;
  const applied = applyAgentMindUpdates(currentMind, input.updates, {
    charaNum: input.charaNum,
    dayIndex: state.time.dayIndex,
    tick: state.time.tickValue,
    knownEvidenceIds,
  });
  cognition.mind = applied.mind;
  cognition.daytimeSync = {
    ...sync,
    pendingObservationIds: sync.pendingObservationIds.filter((id) => !pending.has(id) || !requestedIds.includes(id)),
    consumedObservationIds: [...new Set([...sync.consumedObservationIds, ...requestedIds])]
      .slice(-COGNITIVE_CAPS.daytimeConsumedObservations),
    revision: sync.revision + 1,
    lastReactionTick: state.time.tickValue,
  };
  return {
    accepted: true,
    stale: false,
    diagnostics: applied.diagnostics,
    observationIds: requestedIds,
    mindRevision: cognition.mind.revision,
  };
}

/**
 * Mark the remaining daytime evidence as consumed by a successful Night
 * merge. Night already receives its own validated ledger/experience context;
 * this hand-off prevents the same observations from being queued for a second
 * daytime reaction after the day rolls over. Failed or cancelled Night runs do
 * not call this helper, so the evidence remains retryable.
 */
export function consumeDaytimeEvidenceForNight(
  state: GameState,
  charaNum: number,
): string[] {
  const sync = state.agentRuntime?.cognitions[charaNum]?.daytimeSync;
  if (!sync || sync.pendingObservationIds.length === 0) return [];
  const consumed = [...new Set(sync.pendingObservationIds)];
  sync.pendingObservationIds = [];
  sync.consumedObservationIds = [...new Set([
    ...sync.consumedObservationIds,
    ...consumed,
  ])].slice(-COGNITIVE_CAPS.daytimeConsumedObservations);
  sync.revision += 1;
  return consumed;
}

/** Small diagnostic projection used by the store and focused tests. */
export function daytimeSyncForCharacter(
  state: Readonly<GameState>,
  charaNum: number,
): AgentCognitiveState["daytimeSync"] | undefined {
  const value = state.agentRuntime?.cognitions[charaNum]?.daytimeSync;
  return value ? structuredClone(value) : undefined;
}
