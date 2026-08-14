/**
 * A5 — Commission decision executor.
 *
 * Applies the model's commission selection to the character's cognitive
 * state.  The actual injection into the morning pipeline happens in
 * `runCommissionMorning` (commission.ts), which reads the stored decision.
 */

import type { AgentCognitiveState, AgentCommissionSelection } from "./types.js";

/**
 * Apply a commission selection to the cognitive state.
 * Overwrites any previous decision (one-shot — the morning pipeline
 * clears the decision after applying it).
 */
export function applyCommissionDecision(
  cog: AgentCognitiveState,
  selection: AgentCommissionSelection,
  nowTick: number,
  nowDay: number,
): void {
  cog.commissionDecision = {
    action: selection.action,
    candidateId: selection.action === "propose" ? selection.candidateId : undefined,
    decidedAtTick: nowTick,
    decidedAtDay: nowDay,
  };
}
