/**
 * 立位/通常体位判定 — `ADD_STANDING_SEX.ERB` + `SYS_FUNCTIONS.ERB @IS_STANDING_SEX`.
 *
 * Upstream decides whether a position command runs standing (対面立位/背面立位/
 * 火车便当式…) from three inputs:
 *
 *   - `CFLAG:MASTER:恶作剧 == 2` (sleep sex) → never standing.
 *   - the QOL `CFLAG:站立式切换` toggle → ask `CAN_STANDING_SEX(COM_ID)`.
 *   - otherwise → standing only when `CAN_NORMAL_SEX` fails (no bed/bath mat/
 *     open place/rest spot).
 *
 * Both the kojo predicate `IS_STANDING_SEX` and the command display names
 * (`@COM60_DISPLAY` and friends) read this, so it lives here rather than in
 * either caller. The command-side helper is `isStandingSex`.
 */

import type { GameState } from "./game-state.js";
import { CFLAG_ID, TALENT_ID } from "./settlement.js";
import { hasItem, ITEM_ID } from "./items.js";
import { openPlace, placeFlagsOf } from "../world/location-predicates.js";
import { hasPlace, PLACE_BATH, PLACE_FUTON, PLACE_REST } from "../world/place-flags.js";

/** `CAN_STANDING_SEX(COM_ID)` from `ADD_STANDING_SEX.ERB:5-33`. Returns null
 *  when the character slot is missing (caller decides the fallback). */
export function canStandingSex(
  state: Readonly<GameState>,
  charaNum: number,
  commandNo: number,
): boolean | null {
  const target = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!target) return null;
  if (
    (commandNo >= 60 && commandNo <= 63) ||
    commandNo === 79 ||
    commandNo === 92 ||
    commandNo === 93 ||
    commandNo === 130 ||
    commandNo === 131
  ) {
    return true;
  }
  if ((commandNo >= 67 && commandNo <= 70) || commandNo === 83) {
    const masterSize = state.master.state.TALENT[TALENT_ID.体型] ?? 0;
    const targetSize = target.state.TALENT[TALENT_ID.体型] ?? 0;
    return masterSize > targetSize || (state.master.state.TALENT[TALENT_ID.力持ち] ?? 0) !== 0;
  }
  return false;
}

/** `CAN_NORMAL_SEX(COM_ID)` from `ADD_STANDING_SEX.ERB:39-48`. */
export function canNormalSex(state: Readonly<GameState>): boolean {
  const location = state.master.location;
  const flags = placeFlagsOf(location);
  return (
    hasPlace(flags, PLACE_FUTON) ||
    (hasPlace(flags, PLACE_BATH) && hasItem(state, ITEM_ID.プレイマット)) ||
    openPlace(state, location) !== 0 ||
    hasPlace(flags, PLACE_REST)
  );
}

/** `@IS_STANDING_SEX(COM_ID)`. An undecidable call resolves to the normal
 *  (non-standing) name, i.e. `false`. */
export function isStandingSex(
  state: Readonly<GameState>,
  target: number,
  commandNo: number,
): boolean {
  if ((state.master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) === 2) return false;
  const standing = canStandingSex(state, target, commandNo);
  if (standing === null) return false;
  if ((state.master.state.CFLAG[CFLAG_ID.站立式切换] ?? 0) !== 0) return standing;
  return canNormalSex(state) ? false : true;
}
