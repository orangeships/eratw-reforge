/**
 * In-base character roaming — a faithful port of eraTW `@角色移動処理` /
 * `@角色移動率` (`MOVEMENT_キャラ移動処理.ERB`).
 *
 * The original moves every awake, non-working character around the rooms of
 * the base they're standing in, once per `@CHARA_MOVEMENT` pass (i.e. per
 * command that advances `TIME`). Each candidate destination gets a per-minute
 * move RATE (`@角色移動率`); the character moves if `rate * 経過分 > RAND:1000`.
 *
 * **What we port faithfully (`@角色移動率`, line 350-444):**
 *   - base 15 (1.5%/min) + `CFLAG:移動率補正`
 *   - +`態度*2` if the destination is the master's room and directly visible
 *   - +`YOGORE/300` for 掃除係 shrine residents during cleaning hours (720-1080)
 *   - +`CHARAMOVE_DATA(4)` per-room move tendency (chara-move-data.ts)
 *   - +15 indoor→outdoor anti-hikikomori nudge (weather-damage gate simplified
 *     to "always allow" — the DLC weather patch is deferred; see note)
 *   - private-room gating by `CFLAG:移動節度` (過疎/プライベート rooms)
 *   - −`停留率` (the linger rate), floored at 0
 *
 * **Faithful simplifications (documented, not fabricated):**
 *   - `RAND:1000` → the deterministic `Rng` (createRng) seeded from
 *     (charaNum, tickValue) so the same turn reproduces the same move. eraTW is
 *     RNG-driven; our runtime is deterministic by design (CLAUDE.md), so we
 *     seed rather than invent motion.
 *   - 停留率 (CHARAMOVE_DATA case 4 reuse for linger) uses the same per-room
 *     tendency table as a baseline; the full 引力点/Fisher-Yates/無差別移動/
 *     強制移動/天候 escalation ladder is NOT ported yet — we do ONE rate-checked
 *     candidate scan (the common path) and move to the first room that passes.
 *   - 天候造成的影響 (weather damage) is treated as 0 (no DLC weather) → the
 *     indoor→outdoor nudge always applies and no weather room-avoidance fires.
 *   - お風呂入りたい (bath desire), 寝てる子がいる (sleeper 1/3), ワンルーム
 *     eviction, pathfinding (rooms here are all 1-hop neighbors) are deferred.
 *
 * The engine ONLY moves shrine-resident characters within the shrine graph,
 * and never relocates a working character (the caller gates on that). Village /
 * 守矢 / 冥界 residents and the 拠点来訪 visit-the-player subsystem are separate,
 * deferred. No upstream mutation, no LLM (CLAUDE.md).
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import { CFLAG_ID, TALENT_ID } from "../../state/settlement.js";
import { computeAttitude } from "../../state/attitude.js";
import { getYogore } from "../../state/yogore.js";
import { createRng } from "../../command/rng.js";
import {
  inRoom,
  placeFlagsOf,
} from "../location-predicates.js";
import { hasPlace, PLACE_PRIVATE, PLACE_DEPOPULATED, PLACE_PASSAGE } from "../place-flags.js";
import { shrineNeighbors } from "./shrine-graph.js";
import { moveTendency } from "./chara-move-data.js";
import { betweenTime } from "./visit.js";
import { canEnterRoom } from "../map-can-move.js";

/** Is `location` inside the shrine map (the only base the engine roams)? */
function isShrine(location: string): boolean {
  return location.startsWith("神社:");
}

/**
 * `@角色移動率(ARG, 移動先, 停留率)` — the per-minute move rate (×10 scale,
 * matching the ERB) for `slot` going to `dest`, minus `linger`. Floored at 0.
 * Faithful to lines 350-444 for the shrine common path.
 */
export function moveRate(
  state: GameState,
  slot: CharaSlot,
  dest: string,
  linger: number,
): number {
  const cf = slot.state.CFLAG;
  const here = slot.location;
  // base 1.5%/min = 15, + 移動率補正
  let rate = 15 + (cf[CFLAG_ID.移動率補正] ?? 0);

  // +態度*2 if dest is the master's room (visible, adjacent counts as visible)
  if (state.master.location === dest && shrineNeighbors(here).includes(dest)) {
    rate += computeAttitude(slot, state.master, state) * 2;
  }

  // 掃除係 shrine residents pulled toward dirty rooms during cleaning hours
  if (
    (slot.state.TALENT[TALENT_ID.掃除係] ?? 0) &&
    (cf[CFLAG_ID.神社在住] ?? 0) &&
    betweenTime(720, 1080, state.time.tickValue)
  ) {
    rate += Math.trunc(getYogore(state, dest) / 300);
  }

  // per-chara move tendency (CHARAMOVE_DATA case 4)
  rate += moveTendency(slot.charaNum, dest);

  // anti-hikikomori: indoor → outdoor nudge (+15). Weather damage = 0 (deferred),
  // so the gate `天候造成的影響(dest) >= 0` is always true.
  if (inRoom(state, here) === 1 && inRoom(state, dest) !== 1) {
    rate += 15;
  }

  // private-room gating by 移動節度 (line 421-441). dest != own home, here != off-map.
  const sober = cf[CFLAG_ID.移動節度] ?? 0;
  const destFlags = placeFlagsOf(dest);
  const isPrivate = hasPlace(destFlags, PLACE_PRIVATE);
  const isDepop = hasPlace(destFlags, PLACE_DEPOPULATED);
  const shrineResident = (cf[CFLAG_ID.神社在住] ?? 0) !== 0;
  if (dest !== ownHome(slot)) {
    if (sober >= 1 && isDepop) rate = 0;
    if (sober >= 0 && !shrineResident && isPrivate) rate = 0;
    if (sober >= -1) {
      // sleeper-in-room 1/3 and private 2/3 are deferred (need per-room sleep
      // scan / RELATION); depopulated 1/3 is kept (place-flag only).
      if (isDepop) rate = Math.trunc((rate * 1) / 3);
    }
  }

  return Math.max(rate - linger, 0);
}

/** The character's own private room (no relocation penalty there). */
function ownHome(slot: CharaSlot): string {
  return slot.homeLocation ?? slot.location;
}

/**
 * `停留率` baseline (line 64-80, shrine common path): the per-room tendency at
 * the CURRENT room, with the fixed corrections — passage/entrance rooms linger
 * less (−5), the master's room lingers more (+態度*2).
 */
export function lingerRate(state: GameState, slot: CharaSlot): number {
  const here = slot.location;
  let linger = moveTendency(slot.charaNum, here);
  if (hasPlace(placeFlagsOf(here), PLACE_PASSAGE)) linger += -5;
  if (here === state.master.location) {
    // 態度 is a per-turn INFO.ERB derivation with no persisted refresh — compute
    // it on-demand rather than reading the (always-0) stored CFLAG:態度.
    linger += computeAttitude(slot, state.master, state) * 2;
  }
  return linger;
}

/**
 * Roam `slot` one step within the shrine, faithful to `@角色移動処理`'s common
 * path. Returns the new location if it moved, else null (stayed put). Mutates
 * nothing — the caller applies the move via `setSlotLocation` so CFLAG[300]
 * stays in sync.
 *
 * `elapsedMin` is the minutes the command advanced (`TIME_PROGRESS`); the move
 * check is `rate * elapsedMin > RAND:1000`.
 */
export function roamStep(
  state: GameState,
  slot: CharaSlot,
  elapsedMin: number,
): string | null {
  if (!isShrine(slot.location)) return null; // only roams the shrine base
  if (elapsedMin <= 0) return null;

  const neighbors = shrineNeighbors(slot.location);
  if (neighbors.length === 0) return null;

  const linger = lingerRate(state, slot);
  // Deterministic per (chara, turn) seed: same turn reproduces the same roam.
  const rng = createRng((slot.charaNum * 1_000_003) ^ state.time.tickValue);

  // Shuffle candidates deterministically (faithful to FISHER_YATES_SHAFFLE: no
  // directional bias), then take the first that passes its rate check.
  const order = shuffle(neighbors, rng);
  for (const dest of order) {
    // `@MAP_CAN_MOVE_0` entry gate: e.g. 霊夢 (non-inchling) may not roam into
    // 針妙丸's 小人の虫籠, non-妖精 non-master chars may not enter 三妖精之家,
    // non-master chars with 教養≤2 may not enter 夢幻遺跡. Skip barred dests.
    if (!canEnterRoom(state, dest, slot)) continue;
    const rate = moveRate(state, slot, dest, linger);
    if (rate <= 0) continue;
    // rate * elapsed > RAND:1000  (rate is ×10, so 1000 = 100%/min scale)
    if (rate * elapsedMin > rng.int(1000)) {
      return dest;
    }
  }
  return null;
}

/** Fisher-Yates shuffle using the deterministic Rng (no bias, matches ERB). */
function shuffle<T>(arr: readonly T[], rng: { int: (n: number) => number }): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
