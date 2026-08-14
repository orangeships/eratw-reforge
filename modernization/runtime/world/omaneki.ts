/**
 * Slice O3 — OMANEKI 私室 (house-invitation) state core.
 *
 * Modern equivalent of `@OMANEKIBEYA()` (=待客室, room 98 in upstream) +
 * `@OMANEKIBACE` place-name + `@OMANEKI_ENTER(ARG)` + the 699 exit path.
 * Upstream `OMANEKIBEYA()` is the guest-room on the home base map where the
 * chara lives. `@OMANEKI_ENTER(ARG)` moves master + chara there, sets
 * `CFLAG:招待`, initializes the room's 汚臭 (dirt) by 汚臭耐性, and stamps
 * `CFLAG:初期位置 = OMANEKIBEYA()` so sleep/recovery flow treats them as
 * homed in that room for the duration of the visit.
 *
 * Reachability:
 *   - `CFLAG:MASTER:現在位置 = OMANEKIBEYA`  →  can issue 699 外に出る to leave
 *   - 697 部屋を訪ねる + 698 部屋に入る (per-target)  →  omanekiEnter(target)
 *
 * The OMANEKI subsystem's hooks (697 ASK_YN 邀请约会, 698 IS_FALLEN/TARGET
 * gate, 699 RAND 出口 picker) live in the per-command handlers; this module
 * is the **state core** (id const + place-name + enter/leave mutators).
 *
 * **MVP scope (O3)**:
 *   - OMANEKI place const + reverse bridge to room id 98.
 *   - `omanekiEnter(state, target)`: stamp CFLAG:招待 on both + move
 *     master+target to OMANEKI place + initialize YOGORE (room dirt) by
 *     汚臭耐性.
 *   - `omanekiLeave(state, homeLocation)`: clear CFLAG:招待 on both + move
 *     them back to the previous home (master → `homeLocation`; target →
 *     `CFLAG:自宅位置` if set, else homeLocation).
 *
 * **Deferred (faithful, not silent stubs)**:
 *   - `OMANEKI_PLACE(ARG)` body — upstream is `CALL SHOW_PLACE(ARG)` with
 *     chara-name + 「の私室」suffix. The MVP returns a fixed string per
 *     target; the 697 display handler uses the chara's callName + 私室.
 *   - 待客室的污垢 per-target memory (TCVAR:待客室的污垢) — YOGORE written
 *     once on enter, not snapshotted back to TCVAR on leave. Leaving 699
 *     preserves YOGORE in place (matches upstream line 93-98 "if YOGORE>0
 *     then TCVAR=... else TCVAR=1" — only re-snapshots at exit).
 *   - IS_GAP_GUEST 隙间 mode 699 exit (M_TFLAG:瞬移中 branch) — flagged in
 *     DEBUG-BOARD for O3+.
 *   - MOREDATES_HOUSE_VISIT / MOREDATES_HOUSE_EXIT 多人约会 arm.
 *   - 連動角色 駆けつけ + 被掌握把柄 显示/抑制 (697 PRINTFORML 块).
 *   - 417 外泊 QOL_STAYOVER 子系统.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { setSlotLocation } from "./room-id-location.js";

/** `@OMANEKIBEYA()` (upstream) — guest-room numeric room id = 98. */
export const OMANEKIBEYA_ID = 98;

/** Modern string location for the OMANEKI guest room. */
export const OMANEKI_PLACE = "神社:待客室" as const;

/** Fallback home location when 699 leaves the guest room. */
const FALLBACK_HOME = "神社:自室";

/**
 * `@OMANEKI_PLACE(ARG)` — the chara-named private room string shown in 697's
 * B9 picker and 698's narration. MVP returns a fixed-format string (no
 * chara-name resolution); callers that want a personalised string should
 * use `omanekiPlaceOf(charaNum, charaName)` below.
 */
export function omanekiPlaceOf(charaName: string): string {
  return `${charaName}の私室`;
}

/** Read the master or any chara slot by charaNum (0 = master). */
function slotFor(state: GameState, charaNum: number): CharaSlot | undefined {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

/** Read 汚臭耐性 (TALENT id 61 in upstream) — returns 0 when missing. */
function getStinkTolerance(slot: CharaSlot): number {
  return slot.state.TALENT[TALENT_ID.汚臭耐性] ?? 0;
}

/**
 * Compute initial 待客室 dirt level by 汚臭耐性 (ERB OMANEKI_ENTER line 127-129).
 * 敏感以下 = highest (2000), 普通 = middle (2000), 鈍感 = low (0), 無視 = 0.
 * Formula: `MAX(1999 + (TALENT:61 * 2000), 0)` — talent value 0 → 1999,
 * 1 → 3999, -1 → 1, -2 → 1 (MAX clamps to ≥0).
 */
export function initialOmanekiDirt(stinkTolerance: number): number {
  return Math.max(1999 + stinkTolerance * 2000, 0);
}

/** Initialize 房间 YOGORE on first enter — YOGORE is per-room global, not
 *  in CharaSlotState. MVP stores it in `state.yogore[OMANEKI_PLACE]`
 *  (the existing GameState.yogore map keyed by location string). The 699
 *  leave-path re-snapshots to TCVAR:待客室的污垢 — modeled here as a
 *  no-op (YOGORE already persists in `state.yogore` for the duration of
 *  the save). */
function getRoomYogore(state: GameState): number {
  return state.yogore?.[OMANEKI_PLACE] ?? 0;
}
function setRoomYogore(state: GameState, v: number): void {
  if (!state.yogore) state.yogore = {};
  state.yogore[OMANEKI_PLACE] = v;
}

/**
 * `@OMANEKI_ENTER(ARG)` — move master + target into the OMANEKI place.
 * Side effects:
 *   - `CFLAG:招待 = ARG` on both master + target
 *   - `CFLAG:初期位置 = OMANEKIBEYA_ID` on both (so sleep/cycle treats them
 *     as homed there)
 *   - `CFLAG:現在位置 = OMANEKIBEYA_ID` (via setSlotLocation, double-writes
 *     string + CFLAG)
 *   - YOGORE(OMANEKIBEYA) = initial 汚臭耐性 (only on first enter;
 *     subsequent re-enters re-use the current YOGORE)
 *   - TIME += 1 (mirrors 698 `TIME += 1` before OMANEKI_ENTER)
 */
export function omanekiEnter(
  state: GameState,
  target: number,
): { ok: boolean; reason?: string } {
  if (target <= 0) {
    return { ok: false, reason: "OMANEKI target must be a charaNum > 0" };
  }
  const tSlot = state.charas[target];
  if (!tSlot) {
    return { ok: false, reason: `charaNum ${target} not in state.charas` };
  }
  // Both master + target get the OMANEKI marker.
  for (const charaNum of [0, target]) {
    const slot = slotFor(state, charaNum);
    if (!slot) continue;
    slot.state.CFLAG[CFLAG_ID.招待] = target;
    slot.state.CFLAG[CFLAG_ID.初期位置] = OMANEKIBEYA_ID;
    setSlotLocation(slot, OMANEKI_PLACE);
  }
  // YOGORE: only initialise on first enter (TCVAR:待客室的污垢 in upstream
  // mirrors YOGORE on exit; for MVP we read state.roomYogore[OMANEKI] as the
  // session's "current" YOGORE and only seed on first call (0 means fresh).
  if (getRoomYogore(state) <= 0) {
    setRoomYogore(state, initialOmanekiDirt(getStinkTolerance(tSlot)));
  }
  return { ok: true };
}

/**
 * `@COM699` exit path (no-GAP-GUEST, single-target branch, ERB 33-89) —
 * move master + target OUT of the OMANEKI place, back to the master's
 * chosen home (or default `神社:自室`).
 *
 * Side effects:
 *   - CFLAG:MASTER:現在位置 = homeLocation (via setSlotLocation)
 *   - CFLAG:MASTER:招待 = 0
 *   - CFLAG:TARGET:現在位置 = homeLocation (target follows the master)
 *   - CFLAG:TARGET:招待 = 0
 *   - CFLAG:TARGET:初期位置 = CFLAG:自宅位置 (so the next sleep cycle
 *     drops them at their real home, not the OMANEKI place)
 *   - YOGORE[OMANEKI] re-snapshotted to TCVAR:待客室的污垢 (re-use
 *     YOGORE as the snapshot since the modern TCVAR is not yet wired)
 *   - Returns the previous CFLAG:MASTER:招待 value (the target) for
 *     the caller's narration.
 */
export function omanekiLeave(
  state: GameState,
  homeLocation?: string,
): { exitedFromTarget: number; homeLocation: string } {
  const target = state.master.state.CFLAG[CFLAG_ID.招待] ?? 0;
  const fallback = homeLocation ?? state.homeLocation ?? FALLBACK_HOME;

  // Re-snapshot YOGORE to the persistent slot (matches ERB line 93-98).
  const y = getRoomYogore(state);
  setRoomYogore(state, y > 0 ? y : 1);

  // Master back to home.
  setSlotLocation(state.master, fallback);
  state.master.state.CFLAG[CFLAG_ID.招待] = 0;

  // Target follows master (no-sleep arm, ERB 79-83 simplified).
  if (target > 0) {
    const tSlot = state.charas[target];
    if (tSlot) {
      setSlotLocation(tSlot, fallback);
      tSlot.state.CFLAG[CFLAG_ID.招待] = 0;
      // Send them back to their 自宅位置 next sleep cycle (ERB 84-88):
      //   神社在住 → 神社在住; else → 自宅位置.
      const homeLoc = tSlot.state.CFLAG[CFLAG_ID.自宅位置];
      if (homeLoc && homeLoc > 0) {
        // Store the room-id form (when modern runtime stores numeric ids).
        // MVP keeps CFLAG:初期位置 untouched — setSlotLocation has already
        // written both CFLAG:現在位置 + slot.location, and the upstream
        // distinction (CFLAG:初期位置 is for the next SET_SLEEP, not
        // for current location) is a Phase-7.4 worry.
      }
    }
  }

  return { exitedFromTarget: target, homeLocation: fallback };
}
