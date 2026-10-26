import type { GameState } from "./game-state.js";
import { CFLAG_ID, FLAG_ID } from "./settlement.js";

type StealthState = Pick<GameState, "charas" | "flagStore">;

function hasStealthParticipant(state: Readonly<StealthState>): boolean {
  return Object.values(state.charas).some(
    (slot) => ((slot.state.CFLAG[CFLAG_ID.潜伏状態] ?? 0) & 1) !== 0,
  );
}

/**
 * `FLAG:潜伏` is only the global summary of a character-scoped stealth
 * session. Historical saves can retain bit 0 after every matching
 * `CFLAG:潜伏状態` has already been cleared; that orphan bit is not an active
 * session and must not block unrelated commands or EVENT_COUNTER.
 */
export function hasActiveStealthSession(state: Readonly<StealthState>): boolean {
  return ((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0 && hasStealthParticipant(state);
}

/** Clear only the orphan summary bit, preserving every unrelated FLAG:99 bit. */
export function repairOrphanStealthSummary(state: GameState): boolean {
  const value = state.flagStore[FLAG_ID.潜伏] ?? 0;
  if ((value & 1) === 0 || hasStealthParticipant(state)) return false;
  state.flagStore[FLAG_ID.潜伏] = value & ~1;
  return true;
}
