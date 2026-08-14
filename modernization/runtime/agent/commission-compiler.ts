/**
 * A5 — Commission candidate compiler.
 *
 * Translates deterministic `CommissionDef`s into `AgentCommissionCandidate`
 * objects for the night cognitive-cycle prompt.  The agent can only choose
 * from these candidates; it cannot invent new commissions or modify rewards.
 */

import type { GameState } from "../state/game-state.js";
import type { AgentCommissionCandidate } from "./types.js";
import { eligibleDefsForClient } from "../state/commission.js";

/**
 * Compile eligible commission candidates for a character.
 * Returns an empty array when the agent is disabled, the character doesn't
 * exist, or no commissions are currently eligible.
 */
export function compileCommissionCandidates(
  state: GameState,
  charaNum: number,
): AgentCommissionCandidate[] {
  if (!state.charas[charaNum]) return [];

  const defs = eligibleDefsForClient(state, charaNum);
  if (defs.length === 0) return [];

  return defs.map((def) => ({
    id: `commission:${def.clientId ?? charaNum}:${def.localId}`,
    name: def.name,
    description: def.description,
    task: def.task,
    deadlineDays: def.deadlineDays,
  }));
}
