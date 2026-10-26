/**
 * Meal assembly — `@AssembleForMeal` (`ERB/コマンド関連/集合.ERB:299-347`),
 * called by `COMF414 食事を取る.ERB:28` and `COMF415 食事をふるまう.ERB:15`
 * before the eat loop: hungry awake NPCs elsewhere on the base map WALK TO
 * the master's room, drawn by the smell of the dish.
 *
 * **Ported faithfully (non-DLC path):**
 *   - **Master-side gates** (`集合.ERB:305-312`): master not in the 招待屋
 *     (OMANEKIBEYA → the modern `OMANEKI_PLACE` guest room), `AT_HOME(MASTER)`
 *     (→ `atPlayerBase`), master not in their own 初期位置 room, and master not
 *     in any chara's PRIVATEROOM (→ `privateRoomOwner`).
 *   - **Candidate scan** (`@SYUGOS_GETDATA`, `集合.ERB:86-116`): every chara
 *     `AT_HOME` on the base map, excluding: already in the master's room,
 *     睡眠, a room `MAP_CAN_MOVE` refuses (→ `mapCanMove` with the chara as
 *     the mover), bath / toilet rooms, the OMANEKI guest room (upstream also
 *     excludes MAXROOM — off-map, already excluded by the AT_HOME gate), and
 *     `行動 == 5` (working). The upstream `居場所察知` arm (master without the
 *     talent can only summon a chara in a directly-connected room) is exact
 *     on the shrine graph and degraded to "same map counts as connected"
 *     elsewhere (documented deviation below).
 *   - **Distance** (`@SYUGOS_COST` → BFS): cost > 3 → excluded (see
 *     `map-distance.ts` for the graph-scope deviation).
 *   - **Appetite** (`集合.ERB:330-336`): `甜点` reads `甜点空腹時刻`, everything
 *     else `空腹時刻`; not hungry → stays away. Also excluded: ブチギレ
 *     (`CFLAG:勃然大怒`), `CFLAG:延迟`, and `SHIRAHU != 1` (frozen by time
 *     stop / 陪睡中 / 烂醉 / 衰弱; 睡眠 already dropped above).
 *   - **Hit effects** (`集合.ERB:337-342`): the chara relocates to the
 *     master's room (via `setSlotLocation` so `CFLAG[300]現在位置` stays in
 *     sync), `CFLAG:同室 = 1`, the free action is interrupted
 *     (`Activity_Duration/Type = 0` → delete `state.freeActions[n]`), and the
 *     caller narrates the smell line.
 *
 * **Deviations (documented):**
 *   - `@TARGETSET_CHECK` after the loop — the modern handlers own target
 *     selection; a target outside the room is pulled in by the same rule and
 *     keeps its slot.
 *   - `@SYUGOS_GETDATA`'s `居場所察知` exclusion uses the shrine adjacency
 *     edge where available; on maps without an engine graph the same-map
 *     fallback treats every room as connected (see `map-distance.ts`).
 *   - Deterministic by construction — upstream has no RAND here; no RNG is
 *     introduced.
 *
 * No LLM. See `CLAUDE.md`. The 紅魔館まかない mob-meal special case
 * (`web/app/state/mob-meal-store`, `world/mobs.ts`) is a separate subsystem
 * and is deliberately NOT merged with this.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { isHungryFor } from "../state/dish.js";
import { atPlayerBase, bathCheck, inToilet } from "./location-predicates.js";
import { mapCanMove } from "./map-can-move.js";
import { privateRoomOwner } from "./private-room.js";
import { OMANEKI_PLACE } from "./omaneki.js";
import { setSlotLocation, locationToRoomId } from "./room-id-location.js";
import { MEAL_ASSEMBLY_MAX_COST, roomPathDistance, roomsAdjacent } from "./map-distance.js";

/**
 * Upstream `@SHIRAHU(ARG)` (`COMMON.ERB:827-841`) — 1 when the chara is
 * awake and sober: not time-stop-frozen (`FLAG:時間停止 && !時間停止行動`),
 * not 睡眠 / 陪睡中 / 烂醉 / 衰弱. (The `TFLAG:102 > 1` → 2 arm is left out:
 * `AssembleForMeal` only distinguishes `== 1`.)
 */
function shirahu(state: GameState, slot: CharaSlot): number {
  if (
    (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
    (slot.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) {
    return 0;
  }
  const cf = slot.state.CFLAG;
  if (
    !(cf[CFLAG_ID.睡眠] ?? 0) &&
    !(cf[CFLAG_ID.陪睡中] ?? 0) &&
    !(slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) &&
    !(cf[CFLAG_ID.衰弱] ?? 0)
  ) {
    return 1;
  }
  return 0;
}

/**
 * `@AssembleForMeal(state, isDessert)` — pull hungry nearby NPCs into the
 * master's room for the meal. Mutates `state` in place. Returns the attracted
 * slots in ascending `charaNum` (the caller narrates one smell line each).
 */
export function assembleForMeal(state: GameState, isDessert: boolean): CharaSlot[] {
  const master = state.master;

  // ── Master-side gates (集合.ERB:305-312) ─────────────────────────────
  if (master.location === OMANEKI_PLACE) return []; // 招待屋
  if (!atPlayerBase(state, 0)) return []; // AT_HOME(MASTER)
  const masterRoomId = locationToRoomId(master.location);
  const masterInitialId = master.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
  // 現在位置 == 初期位置 → eating alone in their own room; nobody "comes over".
  if (masterRoomId !== null && masterInitialId > 0 && masterRoomId === masterInitialId) {
    return [];
  }
  // PRIVATEROOM:(現在位置 % 100) — any chara's private room.
  if (privateRoomOwner(state, master.location) !== null) return [];

  // ── Candidate scan (@SYUGOS_GETDATA + @SYUGOS_COST + appetite) ────────
  const masterSensesAll = (master.state.TALENT[TALENT_ID.居場所察知] ?? 0) !== 0;
  const attracted: CharaSlot[] = [];
  const nums = Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b);
  for (const n of nums) {
    const slot = state.charas[n];
    if (!slot) continue;
    // AT_HOME(LOCAL) == 0 → not on the base map.
    if (!atPlayerBase(state, n)) continue;
    // Already in the room → nothing to attract (upstream sets the NG bit).
    if (slot.location === master.location) continue;
    if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) continue; // 睡眠
    // MAP_CAN_MOVE(現在位置) — the room must be enterable for this chara.
    if (!mapCanMove(state, slot.location, slot).can) continue;
    // BATHCHECK / IN_TOILET.
    if (bathCheck(state, slot.location) || inToilet(slot.location)) continue;
    // MAXROOM / OMANEKIBEYA (MAXROOM is off-map → already gated by AT_HOME).
    if (slot.location === OMANEKI_PLACE) continue;
    // 行動 == 5 — working.
    if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) continue;
    // 居場所察知 arm (see header deviation): without the talent the master
    // cannot call someone on an unconnected room.
    if (!masterSensesAll && !roomsAdjacent(master.location, slot.location)) continue;
    // 移動コスト > 3 → excluded (集合.ERB:347).
    const dist = roomPathDistance(master.location, slot.location);
    if (dist === null) continue;
    if (dist > MEAL_ASSEMBLY_MAX_COST) continue;
    // CFLAG:ブチギレ / CFLAG:延迟.
    if ((slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0) continue;
    if ((slot.state.CFLAG[CFLAG_ID.延迟] ?? 0) !== 0) continue;
    // SHIRAHU(C_ID) != 1.
    if (shirahu(state, slot) !== 1) continue;
    // Appetite clock per dish type (集合.ERB:330-336).
    if (!isHungryFor(state, n, isDessert)) continue;

    // ── Hit effects (集合.ERB:337-341) ────────────────────────────────
    setSlotLocation(slot, master.location);
    slot.state.CFLAG[CFLAG_ID.同室] = 1;
    // 自由行動の中断 (Activity_Duration / Activity_Type = 0).
    if (state.freeActions) delete state.freeActions[n];
    // Hold the guest in the room for this turn. Upstream does NOT write this
    // here: it gets the same effect for free because its movement pass runs at
    // the NEXT command's BEFORETRAIN, so a guest drawn over by the smell is
    // still standing there when the meal resolves. Our schedule projection runs
    // inside the very command that gathered her, so without this the game
    // announced "闻着饭菜的香味过来了" and then immediately showed her back where
    // she came from. `@吃飯` already sets the same flag on everyone who eats
    // (ERB 748); this covers the guests who were called over but do not eat —
    // notably when the player eats alone (`TARGET == 0` skips the whole
    // evaluation loop upstream). The flag is consumed by one reprojection, so
    // the next turn's projection is free to move her on as scheduled.
    slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 1;
    attracted.push(slot);
  }
  return attracted;
}
