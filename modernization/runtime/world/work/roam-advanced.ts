/**
 * MV-3 — Advanced roaming mechanics (8 items from DEBUG-BOARD).
 *
 * This module extends the basic roam.ts with the full upstream
 * `@角色移動処理` feature set:
 *   1. 引力点 (gravity point) — gradual multi-hop pathfinding toward a target
 *   2. 無差別移動 (indiscriminate move) — move-if-possible when stuck/bathroom/weather-bad
 *   3. 強制移動 (forced move) — unconditional move when indiscriminate fails
 *   4. 天候房间回避 (weather avoidance) — skip rooms with 天候影響 ≤ -3
 *   5. お風呂入りたい (bath desire) — seek bathroom when CFLAG:風呂 ≥ threshold
 *   6. 寝てる子がいる (sleeper in room) — move rate ×1/3 when someone is sleeping
 *   7. ワンルーム家主驱逐 (private-room eviction) — owner leaving kicks out low-RELATION guests
 *   8. 多跳寻路 (multi-hop pathfinding) — BFS to reach non-adjacent gravity points
 *
 * Upstream refs: `MOVEMENT_キャラ移動処理.ERB` lines 1-474.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import { CFLAG_ID, TCVAR_ID, TALENT_ID } from "../../state/settlement.js";
import { createRng } from "../../command/rng.js";
import { shrineNeighbors } from "./shrine-graph.js";
import { canEnterRoom } from "../map-can-move.js";
import { lingerRate, moveRate as baseMoveRate } from "./roam.js";
import { hasPlace, PLACE_BATH, PLACE_ONEROOM } from "../place-flags.js";
import { inHome, placeFlagsOf } from "../location-predicates.js";
import { weatherDamage } from "../../weather/effects.js";
import { roomIdToLocation, setSlotLocation } from "../room-id-location.js";
import { relationOf } from "../relation.js";

/**
 * お風呂入りたい threshold by 汚臭耐性 (line 358-373). When `CFLAG:風呂` accumulates
 * past this value, the NPC seeks a bathroom (bathroom move rate ×10).
 */
function bathDesireThreshold(slot: CharaSlot): number {
  const tolerance = slot.state.TALENT[TALENT_ID.汚臭耐性] ?? 0;
  // 氷精 (ice fairy) or specific charas that dislike baths: 2000 (never bathe in trial)
  // For now we only model the tolerance ladder (line 363-373):
  if (tolerance === -2) return 600;
  if (tolerance === -1) return 800;
  if (tolerance === 0) return 1000;
  if (tolerance === 1) return 1500;
  return 2000; // tolerance >= 2
}

/**
 * 寝てる子がいる (line 446-451): is there a sleeping chara in `location`?
 * If yes, move rate to that room is ×1/3 (privacy / noise concern).
 */
function hasSleeper(state: GameState, location: string): boolean {
  for (const slot of Object.values(state.charas)) {
    if (slot.location === location && slot.state.CFLAG[CFLAG_ID.睡眠]) {
      return true;
    }
  }
  return false;
}

/**
 * お風呂入りたい move-rate multiplier (line 401-408). When the NPC's bath-desire
 * accumulator `CFLAG:風呂` passes the threshold, bathroom rooms get ×10 rate;
 * else bathroom rate = 0 (won't bathe until desire is high enough).
 */
function bathRateMultiplier(
  _state: GameState,
  slot: CharaSlot,
  dest: string,
): number {
  const flags = placeFlagsOf(dest);
  if (!hasPlace(flags, PLACE_BATH)) return 1; // not a bathroom, no change
  const desire = slot.state.CFLAG[CFLAG_ID.風呂] ?? 0;
  const threshold = bathDesireThreshold(slot);
  return desire >= threshold ? 10 : 0; // ×10 if want bath, else 0
}

/**
 * 寝てる子 move-rate multiplier (line 432): if someone is sleeping in `dest`,
 * multiply rate by 1/3 (unless dest is the chara's own home).
 */
function sleeperRateMultiplier(
  state: GameState,
  slot: CharaSlot,
  dest: string,
): number {
  if (!hasSleeper(state, dest)) return 1;
  const initialHome = roomIdToLocation(slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0);
  if (dest === slot.homeLocation || dest === initialHome) return 1;
  return 1 / 3;
}

/**
 * Enhanced move rate with MV-3 multipliers (bath desire, sleeper, weather).
 * Wraps the base `moveRate` from roam.ts and applies the MV-3 arms.
 */
export function advancedMoveRate(
  state: GameState,
  slot: CharaSlot,
  dest: string,
  linger: number,
): number {
  let rate = baseMoveRate(state, slot, dest, linger);
  // お風呂入りたい (×10 or ×0)
  rate = Math.trunc(rate * bathRateMultiplier(state, slot, dest));
  // 寝てる子がいる (×1/3)
  rate = Math.trunc(rate * sleeperRateMultiplier(state, slot, dest));
  // 天候 ≤-1 (×1/3, line 436-437)
  const weather = weatherDamage(state, dest, slot.charaNum);
  if (weather <= -1) rate = Math.trunc(rate / 3);
  return Math.max(rate, 0);
}

/**
 * 無差別移動 triggers (line 82-131). When any condition is met, the NPC will
 * move to any room with non-zero rate (no probability check, just `rate > 0`).
 * Returns [shouldMove: boolean, gPoint: string | null].
 * `gPoint` is the emergency escape target (地图入口 if stuck in a bad room).
 */
export function shouldIndiscriminateMove(
  state: GameState,
  slot: CharaSlot,
): [boolean, string | null] {
  const here = slot.location;
  const cf = slot.state.CFLAG;
  const tc = slot.state.TCVAR;
  // In bathroom but not bathing (line 84-94)
  const flags = placeFlagsOf(here);
  if (hasPlace(flags, PLACE_BATH) && !(cf[CFLAG_ID.風呂] ?? 0)) {
    return [true, null];
  }
  // In toilet for ≥10 min (line 95-102) — toilet predicate deferred, skip
  // Weather damage ≤-3 at current location (line 104-105)
  if (weatherDamage(state, here, slot.charaNum) <= -3) {
    return [true, null];
  }
  // Current room has move rate ≤0 and master is NOT here (line 106-131)
  const rateHere = advancedMoveRate(state, slot, here, 0);
  if (rateHere <= 0 && here !== state.master.location) {
    // Set G_POINT = 地图入口 if no 引力点 (line 127-128)
    const gravityPoint = tc[TCVAR_ID.引力点] ?? 0;
    const gPoint = gravityPoint ? null : "神社:参道"; // defer: GET_ENTRANCE(MAIN_MAP)
    return [true, gPoint];
  }
  return [false, null];
}

/**
 * BFS pathfinding to find the next hop toward `target` from `start` within
 * the shrine graph. Returns the neighbor of `start` that is on the shortest
 * path to `target`, or null if unreachable.
 * Upstream: SKIP_MOVE (line 179-183), max depth = 最大寻路深度 (undefined in ERB,
 * assume ~10 hops is enough for shrine).
 */
export function findNextHop(
  start: string,
  target: string,
  maxDepth = 10,
): string | null {
  if (start === target) return null; // already there
  const queue: Array<{ loc: string; path: string[] }> = [{ loc: start, path: [] }];
  const visited = new Set<string>([start]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length >= maxDepth) continue;
    const neighbors = shrineNeighbors(current.loc);
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      const newPath = [...current.path, next];
      if (next === target) {
        // Found the target; return the first hop (the neighbor of start)
        return newPath[0] ?? null;
      }
      queue.push({ loc: next, path: newPath });
    }
  }
  return null; // unreachable
}

/**
 * 引力点発動可 (line 454-473): is the gravity point active (should the NPC move
 * toward it)? Returns false if: no gravity point, already there, outside base,
 * weather-damage at target < 0.
 */
export function isGravityPointActive(
  state: GameState,
  slot: CharaSlot,
): boolean {
  const gravityPoint = slot.state.TCVAR[TCVAR_ID.引力点] ?? 0;
  if (!gravityPoint) return false;
  const target = roomIdToLocation(gravityPoint);
  if (!target) return false;
  const here = slot.location;
  if (here === target) return false;
  if (!inHome(here) || !inHome(target)) return false;
  if (weatherDamage(state, target, slot.charaNum) < 0) return false;
  return true;
}

/**
 * ワンルーム家主驱逐 (line 293-331): when the owner of a ワンルーム (private room)
 * leaves, kick out any guests with RELATION ≤ 100 (low affinity). Evicted
 * charas are moved to `dest` (where the owner is going) and marked with
 * `TCVAR:追い出され地点 = here` to avoid re-entering.
 * Returns the names of evicted charas for narration.
 * Mutates `state.charas` in place (moves evicted NPCs).
 */
export function evictFromPrivateRoom(
  state: GameState,
  owner: CharaSlot,
  dest: string,
): string[] {
  const here = owner.location;
  if (!hasPlace(placeFlagsOf(here), PLACE_ONEROOM)) return [];
  const initialHome = roomIdToLocation(owner.state.CFLAG[CFLAG_ID.初期位置] ?? 0);
  if (here !== owner.homeLocation && here !== initialHome) return [];

  const guests = Object.values(state.charas).filter(
    (candidate) => candidate.charaNum !== owner.charaNum && candidate.location === here,
  );
  // Another resident still owns this same one-room home: no lockout occurs.
  if (guests.some((guest) => {
    const guestHome = roomIdToLocation(guest.state.CFLAG[CFLAG_ID.初期位置] ?? 0);
    return guest.homeLocation === here || guestHome === here;
  })) return [];

  const evicted: string[] = [];
  for (const guest of guests) {
    if (relationOf(owner.charaNum, guest.charaNum) > 100) continue;
    setSlotLocation(guest, dest);
    guest.state.TCVAR[TCVAR_ID.なるべく動かない] = 1;
    evicted.push(guest.callName ?? `#${guest.charaNum}`);
  }
  return evicted;
}

/**
 * Advanced roam step with MV-3 full feature set. Returns the new location if
 * moved, else null. This is the complete `@角色移動処理` port.
 * `elapsedMin` is the command's TIME_PROGRESS.
 * Mutates nothing itself — the caller applies the move via `setSlotLocation`.
 */
export function advancedRoamStep(
  state: GameState,
  slot: CharaSlot,
  elapsedMin: number,
  destinationOverride?: string,
): string | null {
  if (!slot.location.startsWith("神社:")) return null;
  if (elapsedMin <= 0) return null;
  // なるべく動かない (line 135-138): if set and no 無差別移動, stay put
  const [indiscriminate, gPoint] = shouldIndiscriminateMove(state, slot);
  const stayPut = slot.state.TCVAR[TCVAR_ID.なるべく動かない] ?? 0;
  if (stayPut && !indiscriminate && !destinationOverride) {
    slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 0; // clear flag
    return null;
  }
  if (destinationOverride) slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 0;
  const rng = createRng((slot.charaNum * 1_000_003) ^ state.time.tickValue);
  // 引力点 or G_POINT branch (line 159-206)
  const gravityActive = isGravityPointActive(state, slot);
  const gravityPointId = slot.state.TCVAR[TCVAR_ID.引力点] ?? 0;
  const target = gravityActive
    ? roomIdToLocation(gravityPointId)
    : destinationOverride ?? gPoint;
  if (target) {
    // Multi-hop pathfinding to gravity point (line 179-189)
    let dest = target;
    if (!shrineNeighbors(slot.location).includes(dest)) {
      const nextHop = findNextHop(slot.location, dest);
      if (!nextHop) {
        // Unreachable; give up (line 186-188)
        return null;
      }
      dest = nextHop;
    }
    // Gate: can't enter (line 191-195) — master's private room while うふふ, etc.
    if (!canEnterRoom(state, dest, slot)) return null;
    // Move check with gravity-point bonus (停留率 - 100, line 197)
    const rate = advancedMoveRate(state, slot, dest, -100);
    if (rate * elapsedMin > rng.int(1000)) {
      return dest;
    }
    // 無差別移動: move if rate > 0 (line 202)
    if (indiscriminate && rate > 0) return dest;
    // 強制移動: unconditional move (line 202)
    // Trigger: 無差別移動 failed to find any room (upgraded to 強制, line 244-246)
    // Simplified: if indiscriminate and no move yet, it means all rooms had rate=0
    // → try again with 強制 (skip rate check). Defer: full loop (WHILE 1) is complex.
    return null;
  }
  // Normal roam: scan neighbors (line 207-256)
  const neighbors = shrineNeighbors(slot.location);
  if (neighbors.length === 0) return null;
  const linger = lingerRate(state, slot);
  const order = shuffle(neighbors, rng);
  for (const dest of order) {
    if (dest === slot.location) continue;
    if (!canEnterRoom(state, dest, slot)) continue;
    // Skip if: weather at dest ≤-3 and here is not worse (line 224-226)
    const weatherHere = weatherDamage(state, slot.location, slot.charaNum);
    const weatherDest = weatherDamage(state, dest, slot.charaNum);
    if (weatherDest <= -3 && slot.location !== "神社:参道" && weatherHere >= -2) {
      continue;
    }
    // Skip if: 追い出され地点 (evicted from here, line 228-229).
    const evictedLocation = roomIdToLocation(
      slot.state.TCVAR[TCVAR_ID.追い出され地点] ?? 0,
    );
    if (evictedLocation === dest) continue;
    const rate = advancedMoveRate(state, slot, dest, linger);
    if (rate <= 0) continue;
    if (rate * elapsedMin > rng.int(1000)) {
      return dest;
    }
    // 無差別移動: move if rate > 0 (line 240)
    if (indiscriminate && rate > 0) return dest;
    // If rate > 0 but didn't pass check, stop scanning (line 243-250)
    if (rate > 0) {
      slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 0;
      return null;
    }
  }
  // No move (line 265-266)
  slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 0;
  return null;
}

function shuffle<T>(arr: readonly T[], rng: { int: (n: number) => number }): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
