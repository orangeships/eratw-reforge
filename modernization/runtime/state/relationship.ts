import type { GameState } from "./game-state.js";
import { CFLAG_ID } from "./settlement.js";

/** Canonical writer for direct favor/trust changes outside SOURCE settlement. */
export function applyRelationshipDelta(
  state: GameState,
  charaNum: number,
  favorDelta: number,
  trustDelta: number,
): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  slot.state.CFLAG[CFLAG_ID.好感度] = Math.max(
    0,
    (slot.state.CFLAG[CFLAG_ID.好感度] ?? 0) + Math.trunc(favorDelta),
  );
  slot.state.CFLAG[CFLAG_ID.信頼度] = Math.max(
    0,
    (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) + Math.trunc(trustDelta),
  );
  return true;
}
