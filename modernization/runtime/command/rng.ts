/**
 * Phase 5A — Deterministic seeded RNG.
 *
 * Implements the locked `Rng` interface from `./types.ts` using
 * mulberry32 (a 32-bit state, single-step PRNG). Same seed → byte-
 * identical sequence, so 5B+ hand-traced ERB fixtures stay
 * reproducible across test runs and across CI / local environments.
 *
 * **Parity contract (critical, see phase-5-plan.md §5A risks):**
 *
 * - `next()` returns a float in `[0, 1)`.
 * - `int(max)` returns an integer in `[0, max)` — matches ERA BASIC
 *   `RAND n` (which is inclusive-exclusive: `RAND 5` yields 0..4).
 *   `rng.test.ts` pins 5 known outputs from `createRng(12345).int(10)`
 *   as the reproducibility anchor for 5B+ ERB math.
 * - `pick(arr)` returns the element at `int(arr.length)`. Throws on
 *   empty arrays.
 *
 * **Why mulberry32:** fast (no BigInt, no class state), 32-bit state,
 * good statistical quality for non-cryptographic use (eraTW is a game,
 * not a security boundary), and the algorithm is short enough to fit
 * in one screen and audit by eye.
 *
 * **No imports** — this file has zero internal dependencies, so it can
 * be the first file written after `types.ts` and is usable from tests
 * directly.
 */

import type { Rng } from "./types.js";

export type { Rng };

/**
 * Throw if `max` is not a positive integer. Prevents the silent
 * off-by-one that `Math.floor(Math.random() * 0)` would cause.
 */
function requirePositiveInt(max: number): void {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`int(max) requires max > 0 (got ${max})`);
  }
}

/**
 * Single-step mulberry32 PRNG. Returns a float in `[0, 1)`.
 * Implementation is the standard reference; do NOT substitute a
 * different algorithm without re-pinning the parity anchors in
 * `rng.test.ts` (5B+ ERB math depends on these exact outputs).
 */
function mulberry32(state: number): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Build a deterministic RNG. `seed` must be a 32-bit integer; non-
 * integer or non-finite seeds are coerced via `| 0` (matches JS
 * modulo semantics and keeps mulberry32's `| 0` arithmetic happy).
 */
export function createRng(seed: number): Rng {
  // `| 0` coerces to int32 in [-2^31, 2^31). Negative seeds are valid
  // — mulberry32's state arithmetic is mod-2^32.
  let state = seed | 0;

  const next = (): number => {
    return mulberry32(state++);
  };

  const int = (max: number): number => {
    requirePositiveInt(max);
    // `Math.floor(next() * max)` gives `[0, max)` because `next()`
    // returns `[0, 1)` (mulberry32 returns `[0, 1)` — see reference
    // impl above; the `>>> 0` cast guarantees non-negative).
    return Math.floor(next() * max);
  };

  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) {
      throw new Error("pick(arr) requires non-empty array");
    }
    const idx = int(arr.length);
    return arr[idx]!;
  };

  return { next, int, pick };
}