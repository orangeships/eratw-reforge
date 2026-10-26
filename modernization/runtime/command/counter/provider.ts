/**
 * EVENT_COUNTER action-provider seam — the AI extension point for "the
 * character decides what to do".
 *
 * Contract (CLAUDE.md agent boundary): an AI provider may only *select* an
 * action from the deterministic candidate pool (or abstain). It never writes
 * state directly; every selection re-validates against the pool and the
 * action's own gate before the deterministic pipeline executes it. With no
 * provider wired (the default), `selectCounterAction`'s weighted-random
 * behaviour is used verbatim — AI-off stays byte-identical.
 *
 * Sync boundary: `resolveCommand` is a synchronous pure pipeline, so an LLM
 * provider cannot call the model inside it. The shell (game-state-store)
 * pre-requests a selection keyed by `counterSeed` while a training/room
 * session is active and serves it from cache; on a cache miss the runtime
 * silently falls back to the deterministic draw. This file ships only the
 * seam + the deterministic implementation; the LLM-backed provider joins
 * `web/app/ai/` in a later slice.
 */

import type { Rng } from "../types.js";
import { counterActionById } from "./counter-actions.js";

/** Snapshot handed to providers — no GameState leaks across the seam. */
export interface CounterCandidateSnapshot {
  readonly id: number;
  readonly label: string;
  readonly family: string;
  /** The deterministic weight (upstream CCOM_ORDER × COUNTER_TYPE). */
  readonly weight: number;
}

export interface CounterSelection {
  readonly actionId: number;
  /** Provenance for diagnostics / audit trails. */
  readonly origin: "deterministic" | "ai";
}

export interface CounterActionProvider {
  readonly kind: "deterministic" | "ai";
  /**
   * Pick one candidate from the pool. Return null to abstain — the caller
   * then falls back to the deterministic weighted draw. Must not throw.
   */
  select(pool: readonly CounterCandidateSnapshot[], rng: Rng): CounterSelection | null;
}

/**
 * The default provider: verbatim `ARRAY_HIT` semantics over the pool
 * weights. Behaves identically to calling `selectCounterAction` directly.
 */
export function createDeterministicCounterProvider(): CounterActionProvider {
  return {
    kind: "deterministic",
    select(pool, rng) {
      if (pool.length === 0) return null;
      const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
      if (total <= 0) return null;
      let roll = rng.int(total);
      for (const candidate of pool) {
        roll -= candidate.weight;
        if (roll < 0) {
          return { actionId: candidate.id, origin: "deterministic" };
        }
      }
      return { actionId: pool[pool.length - 1]!.id, origin: "deterministic" };
    },
  };
}

/**
 * Validate a (possibly AI-produced) selection against the pool and the
 * action's own gate. Returns null unless the id is a pool member whose
 * `able` gate still holds — AI requests may race state changes between
 * request time and resolution time, so the gate re-check is mandatory.
 */
export function validateCounterSelection(
  selection: unknown,
  pool: readonly CounterCandidateSnapshot[],
  recheckAble: (id: number) => boolean,
): CounterSelection | null {
  if (typeof selection !== "object" || selection === null) return null;
  const actionId = (selection as { actionId?: unknown }).actionId;
  if (typeof actionId !== "number" || !Number.isSafeInteger(actionId)) return null;
  if (!pool.some((candidate) => candidate.id === actionId)) return null;
  if (!counterActionById(actionId)) return null;
  if (!recheckAble(actionId)) return null;
  return { actionId, origin: "ai" };
}
