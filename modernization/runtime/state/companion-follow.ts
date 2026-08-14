/**
 * Parity QA P-6b — companion follow.
 *
 * When the master moves between rooms, every character with
 * `CFLAG:同行 != 0` (brought along via 連れ出す[351]) follows: their
 * `location` is synced to the master's new location and they pay a
 * stamina cost faithful to the upstream move subsystem
 * (`体力 -= 5 * 経過時間`).
 *
 * SINGLE SOURCE OF TRUTH: the `CFLAG:同行` companion loop the original
 * runs after each step of `MOVEMENT_MOVE.ERB`. Our runtime models the
 * deterministic core; the upstream RAND fatigue / 依頼 / 陪睡 arms are
 * deferred.
 */
import type { GameState } from "./game-state.js";
import { BASE_ID, CFLAG_ID } from "./settlement.js";
import { setSlotLocation } from "../world/room-id-location.js";

/** Stamina cost per elapsed minute for a following companion (ERB: 5 * 経過時間). */
const COMPANION_STAMINA_PER_MINUTE = 5;

/**
 * Sync all 同行 companions to `state.master.location` and drain their 体力.
 * Call AFTER the master's location + time have been advanced for the step.
 *
 * @param minutes the time delta the master just paid for this step.
 * @returns the charaNums that followed (for narration / callers).
 */
export function followCompanions(state: GameState, minutes: number): number[] {
  const followed: number[] = [];
  const drain = COMPANION_STAMINA_PER_MINUTE * minutes;
  for (const [numText, slot] of Object.entries(state.charas)) {
    if (!slot) continue;
    if ((slot.state.CFLAG[CFLAG_ID.同行] ?? 0) === 0) continue;
    const charaNum = Number(numText);
    // Sync to the master's room, keeping CFLAG[300] in sync (two-track fix).
    setSlotLocation(slot, state.master.location);
    // ERB: 体力 -= 5 * 経過時間 (floored at 0, matching our BASE-clamp convention).
    const cur = (slot.state.BASE[BASE_ID.体力] ?? 0) - drain;
    slot.state.BASE[BASE_ID.体力] = cur < 0 ? 0 : cur;
    followed.push(charaNum);
  }
  return followed;
}
