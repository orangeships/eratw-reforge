/** Deterministic port of fromEN/QOL `QOL_CAN_STAY_OVER` / `QOL_STAYOVER`. */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID } from "../state/settlement.js";
import { getUwakiHistory } from "../state/uwaki.js";
import { MAIN_MAP_ID } from "./location-predicates.js";
import { relationOf } from "./relation.js";
import { roomIdToLocation } from "./room-id-location.js";

function initialRoom(slot: Readonly<CharaSlot>): number {
  return slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
}

export function canStayOver(
  state: Readonly<GameState>,
  charaNum: number,
  lewd: boolean,
  asleep: boolean,
): boolean {
  const guest = state.charas[charaNum];
  if (!guest) return false;
  if ((state.flagStore[FLAG_ID.気絶中断] ?? 0) !== 0) return false;
  if ((state.master.state.CFLAG[CFLAG_ID.お招き] ?? 0) !== 0) return false;
  if (asleep && initialRoom(state.master) !== (state.master.state.CFLAG[CFLAG_ID.現在位置] ?? 0)) return false;

  const privileged = (guest.state.TALENT[TALENT_ID.妻] ?? 0) === 2
    || (guest.state.TALENT[TALENT_ID.妾] ?? 0) !== 0;
  const affinityRequired = privileged ? 100 : 150;
  for (const roommate of Object.values(state.charas)) {
    if (roommate.charaNum === charaNum || initialRoom(roommate) !== initialRoom(state.master)) continue;
    if (lewd && getUwakiHistory(state, roommate.charaNum, charaNum) < 2) return false;
    const configured = relationOf(roommate.charaNum, charaNum);
    const affinity = configured === 0 ? 100 : configured;
    if (affinity < affinityRequired) return false;
  }
  return true;
}

export function applyTemporaryStayover(
  state: GameState,
  charaNum: number,
  lewd: boolean,
  asleep: boolean,
): boolean {
  if (!canStayOver(state, charaNum, lewd, asleep)) return false;
  const guest = state.charas[charaNum]!;
  const masterHome = initialRoom(state.master);
  if ((guest.state.CFLAG[CFLAG_ID.神社在住] ?? 0) === 0) {
    guest.state.CFLAG[CFLAG_ID.神社在住] = masterHome;
    guest.state.CFLAG[CFLAG_ID.约会中] = MAIN_MAP_ID;
  }
  state.flagStore[FLAG_ID.一時滞在] = charaNum;
  guest.state.CFLAG[CFLAG_ID.本来の初期位置] = initialRoom(guest);
  guest.state.CFLAG[CFLAG_ID.初期位置] = masterHome;
  guest.homeLocation = state.homeLocation ?? state.master.homeLocation ?? state.master.location;
  guest.state.CFLAG[CFLAG_ID.翌日来訪] = 1;
  return true;
}

/** BEFORETRAIN restore: all guests return to their original home atomically. */
export function restoreTemporaryStayovers(state: GameState): number {
  let restored = 0;
  for (const guest of Object.values(state.charas)) {
    const original = guest.state.CFLAG[CFLAG_ID.本来の初期位置] ?? 0;
    if (original === 0) continue;
    guest.state.CFLAG[CFLAG_ID.初期位置] = original;
    const originalLocation = roomIdToLocation(original);
    if (originalLocation) guest.homeLocation = originalLocation;
    guest.state.CFLAG[CFLAG_ID.本来の初期位置] = 0;
    restored += 1;
  }
  state.flagStore[FLAG_ID.一時滞在] = 0;
  return restored;
}
