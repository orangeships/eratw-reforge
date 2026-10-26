/**
 * `CAN_MAKE_恋人` (ERB/イベント関連/DATE_CMN.ERB:294-302) — is there room for
 * one more lover?
 *
 * Shared by `COMF352 告白する` and by the date settlement's confession arm, so
 * it lives in `state/` rather than in either command handler.
 */

import type { GameState } from "./game-state.js";
import { FLAG_ID, TALENT_ID } from "./settlement.js";

export function canMakeLover(state: Readonly<GameState>): boolean {
  // `POLYAMOUR_CHEAT || TALENT:MASTER:左拥右抱` bypasses the limit.
  if ((state.master.state.TALENT[TALENT_ID.左拥右抱] ?? 0) !== 0) return true;
  const extra = state.flagStore[FLAG_ID.追加恋人枠] ?? 0;
  const limit = 1 + extra;
  let count = 0;
  for (const slot of Object.values(state.charas)) {
    if ((slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) count++;
  }
  return count < limit;
}
