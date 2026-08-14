/**
 * 私室施錠 (private-room night lock) — faithful port of the eraTW lock that
 * stops the master from walking into a resident's 私室 while they sleep inside.
 *
 * Two upstream pieces:
 *   - **Lock on sleep** (`MOVEMENTS/SLEEP.ERB:200-203`): when a 神社在住
 *     resident falls asleep, `LOCK:(CFLAG:CHARA:初期位置) = 1` — UNLESS it is
 *     the master's own room (`CFLAG:MASTER:初期位置 != CFLAG:CHARA:初期位置`,
 *     the cohabitant carve-out). Cleared on wake (`SLEEP.ERB:291-294`).
 *   - **Intrusion gate** (`COMF400 移動.ERB:586-605`): on arrival at a locked
 *     dest the move scans every chara; an intrusion exists when some chara has
 *     `CFLAG:初期位置 == dest && CFLAG:睡眠 && !CFLAG:出禁`. If so the original
 *     asks 潜入/算了; 算了 bounces back to 直前位置.
 *
 * We DERIVE the lock from live sleep state rather than maintaining a stored
 * `LOCK:` array — the intrusion gate already re-scans for a sleeping owner, so
 * the array is just a cache of "owner currently asleep here". A modern resident
 * is relocated to their `homeLocation` (= 初期位置 私室) and flagged 睡眠 by the
 * configured schedule, so the derived scan captures exactly the locked rooms.
 *
 * **Deferred (documented, not fabricated):** the 潜入 (sneak-in) interactive
 * branch and its `@潜入房間` event are a separate unmodeled subsystem. This
 * slice models the *door being locked* (intrusion → blocked / bounce back with
 * the faithful "好像…正在睡觉的样子" line); choosing to sneak in is a follow-up.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID } from "../state/settlement.js";
import { hasPlace, PLACE_PRIVATE } from "./place-flags.js";
import { placeFlagsOf } from "./location-predicates.js";

/** The master's own dwelling — never locked against them (cohabitant carve-out,
 *  `SLEEP.ERB:201`). The player's home is the top-level `state.homeLocation`,
 *  with the master slot's `homeLocation` as a fallback. */
function masterHome(state: GameState): string | undefined {
  return state.homeLocation ?? state.master.homeLocation;
}

/**
 * The sleeping resident whose locked 私室 is `destLocation`, or `null` when the
 * room is not locked against the master (not a 私室, the master's own room, no
 * sleeping non-banned owner). When non-null the master is intruding on a locked
 * room — callers refuse the move / bounce back and narrate via
 * {@link lockedRoomMessage}.
 */
export function lockedRoomOwner(
  state: GameState,
  destLocation: string,
): CharaSlot | null {
  if (!destLocation) return null;
  // Only a 私室 (場所_プライベート) is ever locked — SLEEP.ERB locks 初期位置,
  // which is a PRIVATEROOM, never a shared room (居間/境内/…).
  if (!hasPlace(placeFlagsOf(destLocation), PLACE_PRIVATE)) return null;
  // The master's own room is never locked against them.
  const home = masterHome(state);
  if (home && home === destLocation) return null;
  for (const slot of Object.values(state.charas)) {
    if (slot.homeLocation !== destLocation) continue; // not this chara's 私室
    if (!(slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0)) continue; // awake → unlocked
    if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0)) continue; // 出禁 → no lock
    return slot;
  }
  return null;
}

/** Whether `destLocation` is a 私室 locked against the master right now. */
export function isRoomLocked(state: GameState, destLocation: string): boolean {
  return lockedRoomOwner(state, destLocation) !== null;
}

/** The faithful intrusion narration (`COMF400.ERB:590` "好像…正在睡觉的样子"). */
export function lockedRoomMessage(owner: CharaSlot): string {
  const name = owner.callName ?? `#${owner.charaNum}`;
  return `好像${name}正在睡觉的样子`;
}
