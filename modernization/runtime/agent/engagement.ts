import type { AgentEngagement, AgentInteractionSignal, InteractionSignalKind } from "./types.js";

/** Points awarded per interaction kind.  relation_delta is dynamic (1‑6). */
export const SIGNAL_POINTS: Record<InteractionSignalKind, number> = {
  command: 4,
  dialogue: 3,
  date_banquet: 8,
  commission: 8,
  relation_delta: 0, // caller supplies 1‑6 dynamically
};

/** 7-day half-life in absolute ticks (7 days × 1440 minutes). */
export const DECAY_HALF_LIFE_TICKS = 7 * 1440;

/** Incumbency bonus multiplier — incumbents get 10 % boost. */
export const INCUMBENCY_BONUS = 1.1;

/**
 * Challenge threshold — a non-incumbent challenger must score at least
 * `CHALLENGE_THRESHOLD × lowest-incumbent-score` to unseat them.
 */
export const CHALLENGE_THRESHOLD = 1.15;

/** Maximum number of signals retained per engagement. */
export const MAX_SIGNALS = 96;

/**
 * Record a single interaction signal.  MUTATES `eng` in place.
 * Trims the signals array to `MAX_SIGNALS` (oldest-first).
 */
export function recordSignal(
  eng: AgentEngagement,
  signal: AgentInteractionSignal,
): void {
  eng.signals.push(signal);
  if (eng.signals.length > MAX_SIGNALS) {
    eng.signals = eng.signals.slice(-MAX_SIGNALS);
  }
}

/**
 * Apply exponential decay to every signal in `eng` and recompute `eng.score`.
 *
 * Decay formula:  score = Σ( signal.points × exp(-λ × age) )
 * where λ = ln(2) / HALF_LIFE and age = max(0, nowTick - signal.tick).
 *
 * MUTATES `eng` in place.  Idempotent when called with the same `nowTick`.
 */
export function applyDecay(eng: AgentEngagement, nowTick: number): void {
  const elapsed = Math.max(0, nowTick - eng.lastDecayTick);
  if (elapsed === 0) return;

  const lambda = Math.LN2 / DECAY_HALF_LIFE_TICKS;
  let score = 0;
  for (const signal of eng.signals) {
    const age = Math.max(0, nowTick - signal.tick);
    score += signal.points * Math.exp(-lambda * age);
  }
  eng.score = score;
  eng.lastDecayTick = nowTick;
}

/**
 * Compute effective score including incumbency bonus.
 */
export function effectiveScore(
  eng: AgentEngagement,
  isIncumbent: boolean,
): number {
  return isIncumbent ? eng.score * INCUMBENCY_BONUS : eng.score;
}

/**
 * Create a fresh, zeroed `AgentEngagement`.
 */
export function createEngagement(): AgentEngagement {
  return {
    score: 0,
    lastDecayTick: 0,
    signals: [],
  };
}
