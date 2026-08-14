/**
 * 汚れ自然増加 — daily natural dirt accrual, faithful to the per-room loop in
 * `@AFTERTRA` (`イベント関連/AFTERTRA.ERB:283-298`), which runs once per day in
 * the wake / day-end settlement. For every room in the master's current map:
 *
 *   FOR LOCAL, MINROOM(), MAXROOM
 *     YOGORE:LOCAL += RAND:50                                  ; +0..49 dirt/day
 *     YANUSHI = PRIVATEROOM:(LOCAL % 100)                      ; room owner
 *     IF YANUSHI && YOGORE:LOCAL > (4000 - ABL:YANUSHI:清掃技能 * 500)
 *       EXP:YANUSHI:清掃経験 ++ ; YOGORE:LOCAL /= 4            ; owner self-tidies
 *     IF ROOMDATA & 場所_公共の場 || (!MAP_CAN_MOVE && !YANUSHI)
 *       YOGORE:LOCAL = MIN(YOGORE:LOCAL, 500)                  ; public cap
 *   NEXT
 *
 * Effect: the master's own room and any unowned accessible rooms accumulate
 * dirt indefinitely (the player must 掃除[410] them); NPC-owned 私室 self-clean
 * once dirty enough; public squares cap at 500. This is what makes cleaning
 * (and the 清洁度 display) meaningful — without it every room reads 最高 forever.
 *
 * **The upstream `EVENTCOMEND` per-turn MOB contribution** (`EVENTCOMEND.ERB:
 * 393-402`, `YOGORE += TIME_PROGRESS * MOB_YOGORE`) is modeled separately by
 * `world/mobs.ts` from the command settlement path. It is gated to maps
 * 3/4/9/10 (紅魔館/竹林/地底/月); 神社(0) and 人間之里(2) remain a faithful no-op.
 *
 * **Deterministic RAND:50.** Day-end is rng-free (deterministic, serializable
 * GameState invariant), so `RAND:50` is modeled by a per-`(dayIndex, room)`
 * 32-bit hash in [0,50) — same expected effect, fully reproducible/testable.
 *
 * **Deferred:** the `!MAP_CAN_MOVE && !YANUSHI` inaccessible-room cap arm (modern
 * known rooms are accessible) and 大掃除 / 散らかし / 宴会 / 射精 event-driven
 * dirt (separate event subsystems). No upstream file mutation. See CLAUDE.md.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { ABL_ID, EXP_ID } from "../state/settlement.js";
import { getYogore, setYogore } from "../state/yogore.js";
import { hasPlace, PLACE_PUBLIC } from "./place-flags.js";
import { placeFlagsOf, mapKeyOf } from "./location-predicates.js";
import { LOCATION_PLACE_FLAGS } from "./place-flags-data.js";

/** Deterministic stand-in for `RAND:50` → [0,49], stable per (day, room). */
export function dailyDirtIncrement(dayIndex: number, location: string): number {
  // FNV-1a 32-bit over `${dayIndex}:${location}`.
  let h = 0x811c9dc5 ^ (dayIndex >>> 0);
  const s = `${dayIndex}:${location}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche (xmxmx) so neighbouring days/rooms spread across buckets.
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) % 50;
}

/** The NPC who owns `location` as their 私室 (`PRIVATEROOM:(room)`), or null.
 *  The master is never an owner here (state.charas excludes the master), which
 *  matches `IF YANUSHI &&…` skipping the master-owned room (YANUSHI 0 = falsy). */
function privateRoomOwner(state: GameState, location: string): CharaSlot | null {
  for (const slot of Object.values(state.charas)) {
    if (slot.homeLocation === location) return slot;
  }
  return null;
}

/**
 * Apply one day's `@AFTERTRA` dirt accrual to every known room in the master's
 * current map. Mutates `state` in place. Call once per crossed day (day-end).
 */
export function accrueDailyDirt(state: GameState): void {
  const masterMap = mapKeyOf(state.master.location);
  const dayIndex = state.time.dayIndex;
  for (const location of Object.keys(LOCATION_PLACE_FLAGS)) {
    // AFTERTRA scopes to MAIN_MAP (the map the player is in this day).
    if (mapKeyOf(location) !== masterMap) continue;
    const flags = placeFlagsOf(location);

    let yogore = getYogore(state, location) + dailyDirtIncrement(dayIndex, location);

    // Owner auto-clean (ERB 286-291): the resident tidies their own 私室 once
    // it crosses 4000 - 清掃技能*500.
    const owner = privateRoomOwner(state, location);
    if (owner) {
      const skill = owner.state.ABL[ABL_ID.清扫技能] ?? 0;
      if (yogore > 4000 - skill * 500) {
        yogore = Math.floor(yogore / 4);
        owner.state.EXP[EXP_ID.清掃経験] = (owner.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
      }
    }

    // Public-place cap (ERB 292-295): 場所_公共の場 holds at ≤500. (The
    // inaccessible-room arm `!MAP_CAN_MOVE && !YANUSHI` is deferred.)
    if (hasPlace(flags, PLACE_PUBLIC)) {
      yogore = Math.min(yogore, 500);
    }

    setYogore(state, location, yogore);
  }
}
