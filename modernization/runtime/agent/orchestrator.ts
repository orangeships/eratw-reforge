/**
 * A4 — Nightly orchestrator: dirty detection, target selection, decision logging.
 *
 * Runtime-side pure game logic.  The web layer (agent-night.ts) calls
 * `selectNightTargets` to determine which active-roster characters need an
 * LLM call tonight, then batches the calls with a concurrency limit.
 *
 * Per-character failure isolation is the caller's responsibility —
 * `selectNightTargets` only returns the ordered list of targets; it does
 * not invoke the LLM, mutate state beyond the decision log, or manage
 * concurrency.
 */

import type { GameState } from "../state/game-state.js";
import type {
  AcceptedAgentDecision,
  AgentRuntimeState,
} from "./types.js";

// ── Types ───────────────────────────────────────────────────────────

export interface NightTarget {
  /** The character to process. */
  charaNum: number;
  /** Why this character was selected. */
  reason: "roster_entry" | "new_observations" | "plan_expired";
  /**
   * Processing priority — higher values are processed first.
   * New roster members get 10, otherwise the count of new observations
   * (so characters with more to process go first), plan-expired gets 5.
   */
  priority: number;
}

export interface NightOrchestrationConfig {
  /** Hard cap on LLM calls per night (across all characters).  Default 10. */
  maxCallsPerNight: number;
  /** Max concurrent LLM calls.  Default 3. */
  maxConcurrency: number;
  /**
   * Minimum new observations before a character who is already on the
   * roster is considered dirty.  Default 1.  New roster members always
   * qualify regardless of observation count.
   */
  minObservationsToTrigger: number;
}

export const DEFAULT_ORCHESTRATION_CONFIG: NightOrchestrationConfig = {
  maxCallsPerNight: 10,
  maxConcurrency: 3,
  minObservationsToTrigger: 1,
};

/** Max accepted decisions retained (oldest-first trim). */
const MAX_ACCEPTED_DECISIONS = 30;

// ── Target selection ────────────────────────────────────────────────

/**
 * Determine which active-roster characters need a nightly LLM call.
 *
 * A character is "dirty" when:
 * 1. They just entered the roster (not in `previousRoster`) — bootstrap.
 * 2. They have new observations since `lastUpdatedTick`.
 * 3. Their `currentPlan` is for a past day (expired, need new plan).
 *
 * Results are sorted by priority (descending) and capped at
 * `config.maxCallsPerNight`.
 *
 * Pure function — does not mutate state.  The caller is responsible for
 * compiling observations before calling (so `cog.observations` is
 * up-to-date) and for invoking the actual LLM calls.
 */
export function selectNightTargets(
  runtime: AgentRuntimeState,
  state: GameState,
  config?: Partial<NightOrchestrationConfig>,
): NightTarget[] {
  const cfg = { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
  const previousSet = new Set(runtime.previousRoster);
  const nowDay = state.time.dayIndex;
  const targets: NightTarget[] = [];

  for (const charaNum of runtime.activeRoster) {
    const cog = runtime.cognitions[charaNum];
    const isNewToRoster = !previousSet.has(charaNum);

    // 1. Roster entry — always bootstrap (priority 10).
    if (isNewToRoster) {
      targets.push({ charaNum, reason: "roster_entry", priority: 10 });
      continue;
    }

    // 2. New observations since last thought?
    if (cog) {
      let newObsCount = 0;
      for (const obs of cog.observations) {
        if (obs.tick > cog.lastUpdatedTick) newObsCount++;
      }
      if (newObsCount >= cfg.minObservationsToTrigger) {
        targets.push({ charaNum, reason: "new_observations", priority: newObsCount });
        continue;
      }
    }

    // 3. Plan expired (currentPlan is for a past day)?
    if (cog?.currentPlan && cog.currentPlan.dayIndex < nowDay) {
      targets.push({ charaNum, reason: "plan_expired", priority: 5 });
    }
  }

  // Sort by priority descending.  When priorities tie, new roster members
  // go first (they need their bootstrap), then by charaNum for determinism.
  targets.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.reason !== b.reason) {
      if (a.reason === "roster_entry") return -1;
      if (b.reason === "roster_entry") return 1;
    }
    return a.charaNum - b.charaNum;
  });

  return targets.slice(0, cfg.maxCallsPerNight);
}

// ── Decision logging ────────────────────────────────────────────────

/**
 * Record an accepted agent decision in the runtime log.
 *
 * MUTATES `runtime.acceptedDecisions` and `runtime.decisionSeq` in place.
 * Trims the log to `MAX_ACCEPTED_DECISIONS` (oldest-first).
 *
 * Call after a character's night cognitive cycle successfully completes
 * (even if the LLM returned an empty `{}` — the decision to *not* record
 * anything is itself a decision).
 */
export function recordAgentDecision(
  runtime: AgentRuntimeState,
  charaNum: number,
  dayIndex: number,
  tick: number,
  kind: string,
  meta: Record<string, unknown>,
): AcceptedAgentDecision {
  const id = `dec-${runtime.decisionSeq}`;
  runtime.decisionSeq++;

  const decision: AcceptedAgentDecision = {
    id,
    charaNum,
    dayIndex,
    acceptedAtTick: tick,
    kind,
    meta,
  };

  runtime.acceptedDecisions.push(decision);
  if (runtime.acceptedDecisions.length > MAX_ACCEPTED_DECISIONS) {
    runtime.acceptedDecisions = runtime.acceptedDecisions.slice(
      -MAX_ACCEPTED_DECISIONS,
    );
  }

  return decision;
}
