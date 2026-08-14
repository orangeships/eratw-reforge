/**
 * Private-room owner reverse lookup.
 *
 * eraTW's `PRIVATEROOM` array (DIM.ERH:279, `SAVEDATA PRIVATEROOM, 100`) maps a
 * room id to the chara who owns it: `PRIVATEROOM:(初期位置 % 100) = chara`
 * (MOVEMENTS/物件関連/MAP_MANAGE.ERB:259). The 697 部屋を訪ねる / 698 部屋に入る
 * ceremony and the `_ROOM_DESCRIPTION` kojo trigger both need the REVERSE
 * direction: "which chara's private room am I standing in?".
 *
 * The modern runtime keeps the owner's home as `CharaSlot.homeLocation` (the
 * resolved string form of CSV `CFLAG:初期位置`) or the numeric `CFLAG:自宅位置`
 * (id 358). We scan `state.charas` and compare by resolved room id (so a
 * numeric CFLAG and a string homeLocation agree), falling back to a string
 * equality check when no numeric id exists for either side.
 */
import type { GameState } from "../state/game-state.js";
import { CFLAG_ID } from "../state/settlement.js";
import { locationToRoomId, roomIdToLocation } from "./room-id-location.js";

/** Resolve a chara's home room location string, preferring the resolved
 *  `homeLocation` then `CFLAG:自宅位置` (numeric → room-id bridge). */
function charaHomeLocation(state: GameState, charaNum: number): string | null {
  const slot = state.charas[charaNum];
  if (!slot) return null;
  if (slot.homeLocation) return slot.homeLocation;
  const homeId = slot.state.CFLAG[CFLAG_ID.自宅位置];
  if (homeId && homeId > 0) return roomIdToLocation(homeId);
  return null;
}

/** Is `homeLocation` the same room as `location`? Compares by resolved numeric
 *  id first (robust across string/numeric representations), then by string. */
function sameRoom(home: string, location: string): boolean {
  if (home === location) return true;
  const a = locationToRoomId(home);
  const b = locationToRoomId(location);
  return a !== null && b !== null && a === b;
}

/**
 * `PRIVATEROOM` reverse lookup — which chara owns the given room?
 * Returns the charaNum whose home is `location`, or `null` when the room is
 * nobody's private room (public room / master's own room / unmapped).
 *
 * The master (charaNum 0) is never a room owner. If multiple charas share one
 * home room, the first by key order wins (upstream PRIVATEROOM can only hold
 * one owner per room id, so this is faithful to the single-owner model).
 */
export function privateRoomOwner(state: Readonly<GameState>, location: string): number | null {
  // `@情景描写` checks CFLAG:MASTER:招待 before consulting PRIVATEROOM. During
  // a 697 visit the invited chara is temporarily in 神社:待客室, while their
  // permanent home still points at their own room. Preserve that explicit
  // owner marker or the already-modelled invitation would lose _ROOM_DESCRIPTION
  // at the exact point where the player enters the guest room.
  const invited = state.master.state.CFLAG[CFLAG_ID.招待] ?? 0;
  if (invited > 0 && location === state.master.location && state.charas[invited]) {
    return invited;
  }

  for (const [k, slot] of Object.entries(state.charas)) {
    const n = Number(k);
    if (n === 0 || !slot) continue;
    const home = charaHomeLocation(state as GameState, n);
    if (home && sameRoom(home, location)) return n;
  }
  return null;
}
