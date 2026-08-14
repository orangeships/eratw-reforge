import type { GameState } from "../state/game-state.js";
import type { InteractionSignalKind } from "./types.js";
import { ensureEngagement } from "./init.js";
import { recordSignal } from "./engagement.js";

/**
 * Core signal recording function.
 *
 * No-op when:
 * - `state.agentRuntime` does not exist,
 * - `masterEnabled` is `false`, or
 * - `charaNum` is not a valid character in `state.charas`.
 */
export function recordInteractionSignal(
  state: GameState,
  charaNum: number,
  kind: InteractionSignalKind,
  points: number,
  label: string,
): void {
  if (charaNum <= 0 || !state.charas[charaNum]) return;
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return;
  const eng = ensureEngagement(runtime, charaNum);
  recordSignal(eng, {
    tick: state.time.tickValue,
    dayIndex: state.time.dayIndex,
    kind,
    points,
    label,
    charaNum,
  });
}

/**
 * Record a command-completion signal (4 points).
 * Call from `apply-intent.ts` after a successful `ISSUE_COMMAND`.
 */
export function recordCommandSignal(
  state: GameState,
  targetCharaNum: number,
  _commandNo: number,
  label: string,
): void {
  recordInteractionSignal(state, targetCharaNum, "command", 4, label);
}

/** Record one visible dialogue exchange for a character. */
export function recordDialogueSignal(
  state: GameState,
  targetCharaNum: number,
  label: string,
): void {
  recordInteractionSignal(state, targetCharaNum, "dialogue", 3, label);
}

/**
 * Record a commission state-transition signal (8 points).
 * Call from `commission.ts` at acceptance, completion, or failure.
 */
export function recordCommissionSignal(
  state: GameState,
  targetCharaNum: number,
  label: string,
): void {
  recordInteractionSignal(state, targetCharaNum, "commission", 8, label);
}

/**
 * Record a date / banquet signal (8 points).
 * Call from date-session / banquet modules at creation or resolution.
 */
export function recordDateBanquetSignal(
  state: GameState,
  targetCharaNum: number,
  label: string,
): void {
  recordInteractionSignal(state, targetCharaNum, "date_banquet", 8, label);
}

/**
 * Record a significant relationship-delta signal (1‑6 points).
 * Points are derived from the absolute delta magnitude:
 *
 * | Δ | ≥ 100 → 6 | ≥ 50 → 5 | ≥ 25 → 4 | ≥ 10 → 3 | ≥ 5 → 2 | else 1 |
 */
export function recordRelationDeltaSignal(
  state: GameState,
  targetCharaNum: number,
  delta: number,
): void {
  const absDelta = Math.abs(delta);
  let points = 1;
  if (absDelta >= 100) points = 6;
  else if (absDelta >= 50) points = 5;
  else if (absDelta >= 25) points = 4;
  else if (absDelta >= 10) points = 3;
  else if (absDelta >= 5) points = 2;
  recordInteractionSignal(
    state,
    targetCharaNum,
    "relation_delta",
    points,
    `relation_delta=${delta}`,
  );
}
