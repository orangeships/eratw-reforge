/**
 * EVENT_COUNTER master pipeline — verbatim port of the upstream selection
 * flow (`COUNTER_SELECT.ERB:33 @EVENT_COUNTER` + `COMMON.ERB:2479 @ARRAY_HIT`),
 * for the daily-life / soft counter subset.
 *
 * Discipline (S1):
 * - `collectCounterCandidates` is a pure function: zero RNG (the upstream
 *   CCOM_ABLE/CCOM_ORDER weight pass computes deterministically).
 * - `selectCounterAction` consumes exactly one `rng.int(totalWeight)` draw,
 *   mirroring `ARRAY_HIT`'s single `RAND(0, sum)` over the cumulative
 *   distribution.
 * - The counter rolls on an independent derived RNG stream (`counterSeed`),
 *   never `ctx.rng` — joining the subsystem must not perturb the existing
 *   command/kojo RNG sequences; only the extra counter events themselves
 *   change a trace.
 *
 * Deferred upstream branches (documented, not migrated in S1): the 把柄
 * PUNISHMENT arm, the 诶嘿嘿 REACTION arm, 69-pose handling, SELECTCCOM
 * registration, and the 次回Counter forced pick.
 */

import type { CommandContext } from "../types.js";
import { commandKojoSeed } from "../command-kojo.js";
import type { Rng } from "../types.js";
import type { GameState } from "../../state/index.js";
import { BASE_ID, CFLAG_ID, FLAG_ID, TEQUIP_ID } from "../../state/settlement.js";
import { hasActiveStealthSession } from "../../state/stealth.js";
import { computeShinchitsu } from "../../state/attitude.js";
import { TRAINING_EXIT_COMMANDS } from "../training-session.js";
import { isHMode } from "../h-mode.js";
import { COUNTER_ACTIONS, counterActionById, type CounterActionDef } from "./counter-actions.js";

/** Multiplier salt for the counter's derived RNG stream. */
const COUNTER_SEED_SALT = 0xc0a47e5 | 0;

/** UI parity: the emotion gauge lights one heart per 200 points, capped at 5. */
const EMOTION_PER_HEART = 200;
const MAX_EMOTION_HEARTS = 5;
const BASE_TRIGGER_PERCENT = 20;
const TRIGGER_PERCENT_PER_HEART = 10;

/** Golden-gate command set: upstream aborts on these when not in H mode. */
const NON_H_ABORT_COMMANDS = new Set<number>([350, 355, 400, 402, 404, 405, 420, 604, 699]);

/**
 * Independent derived seed: `(mul(commandKojoSeed, φ) ^ SALT) >>> 0`. Keeping
 * the counter off the command's main RNG stream preserves existing golden
 * traces byte-for-byte (modulo the counter's own extra events).
 */
export function counterSeed(ctx: CommandContext): number {
  return ((Math.imul(commandKojoSeed(ctx), 0x9e3779b1) ^ COUNTER_SEED_SALT) >>> 0) | 0;
}

/** Number of filled 情緒 hearts currently shown for the acting character. */
export function counterEmotionHearts(state: Readonly<GameState>, target: number): number {
  const emotion = state.charas[target]?.state.BASE[BASE_ID.情緒] ?? 0;
  return Math.max(0, Math.min(MAX_EMOTION_HEARTS, Math.trunc(emotion / EMOTION_PER_HEART)));
}

/** 20% base chance, plus 10 percentage points for each filled 情緒 heart. */
export function counterTriggerChancePercent(state: Readonly<GameState>, target: number): number {
  return BASE_TRIGGER_PERCENT + counterEmotionHearts(state, target) * TRIGGER_PERCENT_PER_HEART;
}

/** One bounded trigger draw. Action selection uses a separate RNG stream. */
export function shouldTriggerCounter(
  state: Readonly<GameState>,
  target: number,
  rng: Rng,
): boolean {
  return rng.int(100) < counterTriggerChancePercent(state, target);
}

/**
 * Upstream abort gates (`@EVENT_COUNTER` prefix). Returns a reason string
 * when the counter must not fire this command. Gates whose state fields are
 * not yet modelled modern-side are deliberately **skipped** (fail-closed
 * convergence: a missing gate over-fires rather than silently killing the
 * subsystem) — only the target/exit/dedup/time-stop/date-command gates hard
 * abort.
 */
export function counterBlockReason(
  state: Readonly<GameState>,
  target: number,
  commandNo: number,
): string | null {
  const slot = target > 0 ? state.charas[target] : undefined;
  if (target <= 0 || !slot) return "no-target";
  if (TRAINING_EXIT_COMMANDS.has(commandNo)) return "exit-command";
  // SHIRAHU(ARG): awake, not co-sleeping, sober and not weakened.
  if ((slot.state.CFLAG[313] ?? 0) !== 0) return "shirahu-sleeping";
  if ((slot.state.CFLAG[334] ?? 0) !== 0) return "shirahu-cosleeping";
  if ((slot.state.TCVAR[145] ?? 0) !== 0) return "shirahu-drunk";
  if ((slot.state.CFLAG[316] ?? 0) !== 0) return "shirahu-weakened";
  // Upstream: `FLAG:70 == 1 && CFLAG:344 == 0` — frozen targets cannot act.
  const frozen =
    (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
    (state.charas[target]?.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
  if (frozen) return "time-stop-frozen";
  if ((slot.state.CFLAG[325] ?? 0) === 5) return "working";
  if (computeShinchitsu(slot, state.master, state) < 1) return "shinchitsu-low";
  if (hasActiveStealthSession(state) && !((slot.state.CFLAG[CFLAG_ID.潜伏状態] ?? 0) & 1)) {
    return "stealth-mismatch";
  }
  if ((slot.state.TEQUIP[TEQUIP_ID.六九式] ?? 0) === 1) return "six-nine";
  if (counterFired(state.turnContext?.frame, target)) return "already-fired";
  // Upstream: `CFLAG:うふふ != 2 && GROUPMATCH(SELECTCOM, 350, 355, 400, 402,
  // 404, 405, 420, 604, 699)` — the entry/exit/special commands only accept
  // counters once the target is actually in H. (350 itself is also in the
  // set, so entering H never fires a counter that same command.)
  if (!isHMode(state, target) && NON_H_ABORT_COMMANDS.has(commandNo)) {
    return "h-gated-command";
  }
  // Unmodelled gates, skipped with the documented convergence rationale:
  // SHIRAHU(白浊), CFLAG:行動==5, H-only 亲热 TCVAR, 潜伏 FLAG:99 bit0,
  // TEQUIP 六九式. Each gains a real gate as its state lands.
  return null;
}

/** One weighted candidate: the action plus its resolved weight. */
export interface CounterCandidate {
  readonly def: CounterActionDef;
  readonly weight: number;
}

/**
 * Build the weighted candidate pool (`CCOM_ABLE` × `CCOM_ORDER` pass).
 * Pure: zero RNG. V1's soft/daily subset has no able gates beyond the
 * upstream default (`RETURN 1`).
 */
export function collectCounterCandidates(
  state: Readonly<GameState>,
  target: number,
): CounterCandidate[] {
  const pool: CounterCandidate[] = [];
  for (const def of COUNTER_ACTIONS) {
    if (def.able && !def.able(state, target)) continue;
    const weight = def.weight(state, target);
    if (weight > 0) pool.push({ def, weight });
  }
  return pool;
}

/**
 * `@ARRAY_HIT` (COMMON.ERB:2479): draw `RAND(0, sum(weights))` and return the
 * id of the cumulative-distribution bucket it lands in. Consumes exactly one
 * RNG draw. Returns null when the pool is empty or the total weight is zero
 * (no draw consumed).
 */
export function selectCounterAction(
  pool: readonly CounterCandidate[],
  rng: Rng,
): CounterCandidate | null {
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) return null;
  let roll = rng.int(total);
  for (const candidate of pool) {
    roll -= candidate.weight;
    if (roll < 0) return candidate;
  }
  return pool[pool.length - 1]!;
}

/** Frame bookkeeping key for the once-per-command-per-chara counter dedup. */
export function counterFired(frame: { counterFiredByChara?: Record<number, number> } | undefined, target: number): boolean {
  return (frame?.counterFiredByChara?.[target] ?? 0) > 0;
}

/** Mark the frame so the same target cannot counter twice in one command. */
export function markCounterFired(
  frame: { counterFiredByChara?: Record<number, number> } | undefined,
  target: number,
): void {
  if (!frame) return;
  frame.counterFiredByChara = { ...frame.counterFiredByChara, [target]: 1 };
}

/** Convenience for tests / shell wiring: the action table's def lookup. */
export { counterActionById };
