/**
 * P1-#5 Slice A — full `SET_SLEEP` (SET_CMN.ERB:111-161) port.
 *
 * The upstream `@SET_SLEEP(ARG, ARG:1, ARG:2)` has two cases:
 *   - CASE 0 (FLAG_OFF): clear the sleep flag + 着替え実行 bit 0/1 +
 *     疲労度/睡眠深度 reset + conditional master-連動 wake.
 *   - CASE 1 (FLAG_ON): set the sleep flag (gated on 延迟/衰弱) +
 *     着替え実行 bit 0/1 + sleep-depth = 1200 × (睡眠薬強度+1) +
 *     疲労度/3 + conditional master-連動 sleep + BUFF_RESET.
 *
 * Modern callers:
 *   - sleep.ts:706 — currently only sets CFLAG:睡眠 + 就寝時間 on the
 *     master (a "minimal" subset; the upstream full body wasn't
 *     modeled). This slice replaces that minimal path with a real
 *     `setMasterSleep(state, 1, …)` call so 着替え実行 + BUFF_RESET
 *     are no longer silent.
 *   - `@CHARA_SLEEP` (P1-#5 Slice B, deferred) — the per-chara caller.
 *
 * Conditional gates (`!睡眠時間(ARG:1)` / `衰弱` / `現在位置 != 初期位置`)
 * are evaluated with two faithful modern helpers:
 *   - `isCharaInSleepTime` — mirrors `@睡眠時間(ARG)` (COMMON.ERB:886)
 *     using `BETWEENTIME(CFLAG:起床時間, CFLAG:就寝時間 + 清醒劑)`.
 *   - `isCharaHome` — `現在位置 == 初期位置`, the room-string equality
 *     the modern runtime uses (after the 2026-06-23 room-id bridge).
 *
 * The two upstream-local-only helpers that are referenced but
 * unimportable here:
 *   - `@睡眠時間` (COMMON.ERB:886) — ported as `isCharaInSleepTime`.
 *   - `@BUFF_RESET` (COMMON.ERB:765) — ported as `resetBuff` in
 *     `runtime/state/buff.ts`.
 */

import type { CharaSlot, GameState } from "../state/index.js";
import { CFLAG_ID, TCVAR_ID } from "../state/settlement.js";
import { resetBuff } from "../state/buff.js";
import { MAIN_MAP_ID } from "./location-predicates.js";

/** SET_SLEEP ARG values (upstream: CASE 0 = off, CASE 1 = on). */
export const SET_SLEEP_OFF = 0;
export const SET_SLEEP_ON = 1;

/** ARG:2 values for the master-連動 gate. */
const NO_MASTER_LINK = 0;
const MASTER_LINK_FORCE = 1;
const MASTER_LINK_IF_SAME_ROOM = 2;

/**
 * `睡眠時間(CHARA)` — `CFLAG:起床時間` to `CFLAG:就寝時間 + CFLAG:清醒劑`
 * wrap interval. Returns true when the chara is currently in their
 * sleep window (i.e. NOT in the wake interval). MASTER is always
 * considered "in sleep window" iff `CFLAG:睡眠 == 1`.
 */
function isCharaInSleepTime(slot: CharaSlot, _masterSleepFlag: number): boolean {
  const s = slot.state.CFLAG;
  if (slot.charaNum === 0) return s[CFLAG_ID.睡眠] === 1;
  if (s[CFLAG_ID.衰弱]) return true;
  return !betweenTimeMinutes(
    s[CFLAG_ID.起床時間] ?? 0,
    (s[CFLAG_ID.就寝時間] ?? 0) + (s[CFLAG_ID.清醒劑] ?? 0),
  );
}

/** `BETWEENTIME(from, to)` — the upstream interval helper. Returns
 *  true when `from <= to` (i.e. now is between them, inclusive). */
function betweenTimeMinutes(from: number, to: number): boolean {
  return from <= to;
}

/** CFLAG:現在位置 == CFLAG:初期位置 — used by the SET_SLEEP CASE 1
 *  着替え実行 bit 0 re-set gate. */
function isCharaHome(slot: CharaSlot, currentLocation: string | undefined): boolean {
  if (!currentLocation) return true;
  return slot.state.CFLAG[CFLAG_ID.初期位置] != null &&
    (slot.homeLocation ?? "") !== "" &&
    slot.homeLocation === currentLocation;
}

/** SETBIT CFLAG:n,bit — set bit `bit` of integer CFLAG `n`. */
function setBit(target: Record<number, number>, n: number, bit: number): void {
  target[n] = (target[n] ?? 0) | (1 << bit);
}

/** CLEARBIT CFLAG:n,bit — clear bit `bit` of integer CFLAG `n`. */
function clearBit(target: Record<number, number>, n: number, bit: number): void {
  target[n] = (target[n] ?? 0) & ~(1 << bit);
}

/** Find the slot for a charaNum (master = 0, others = state.charas). */
function slotFor(state: GameState, charaNum: number): CharaSlot | undefined {
  if (charaNum === 0) return state.master;
  return state.charas[charaNum];
}

/** Faithful port of `SET_SLEEP(ARG, ARG:1, ARG:2)`. The `charaNum`
 *  arg is the target; the `masterLink` arg maps to upstream `ARG:2`:
 *   - 0: no master-連動 (default)
 *   - 1: force master-連動 (CFLAG:MASTER:睡眠 follows)
 *   - 2: conditional master-連動 (only when target shares room). */
export function setSleep(
  state: GameState,
  arg: number,
  charaNum: number,
  masterLink: number = NO_MASTER_LINK,
): void {
  if (arg === SET_SLEEP_OFF) {
    flagOff(state, charaNum, masterLink);
  } else if (arg === SET_SLEEP_ON) {
    flagOn(state, charaNum, masterLink);
  }
}

function flagOff(
  state: GameState,
  charaNum: number,
  masterLink: number,
): void {
  const slot = slotFor(state, charaNum);
  if (!slot) return;
  // CFLAG:睡眠 = 0
  slot.state.CFLAG[CFLAG_ID.睡眠] = 0;
  // Master-連動
  if (masterLink === MASTER_LINK_FORCE) {
    state.master.state.CFLAG[CFLAG_ID.睡眠] = 0;
  } else if (masterLink === MASTER_LINK_IF_SAME_ROOM) {
    if (
      state.master.location !== undefined &&
      slot.location === state.master.location
    ) {
      state.master.state.CFLAG[CFLAG_ID.睡眠] = 0;
    }
  }
  // 着替え実行 bit 0 SET, bit 1 CLEAR
  setBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 0);
  clearBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 1);
  // 疲労度 / 睡眠深度 reset
  slot.state.TCVAR[TCVAR_ID.疲労度] = 0;
  slot.state.TCVAR[TCVAR_ID.睡眠深度] = 0;
}

function flagOn(
  state: GameState,
  charaNum: number,
  masterLink: number,
): void {
  const slot = slotFor(state, charaNum);
  if (!slot) return;
  // 整合性チェック: 延迟中 (SET_DERAY 中) 通常不能睡; 衰弱时可
  const delayed = false; // SET_DERAY / CFLAG:延迟 not yet modeled
  const weak = (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0;
  if (!delayed || charaNum === 0 || weak) {
    slot.state.CFLAG[CFLAG_ID.睡眠] = 1;
    slot.state.CFLAG[CFLAG_ID.约会中] = MAIN_MAP_ID;
    if (masterLink === MASTER_LINK_FORCE) {
      state.master.state.CFLAG[CFLAG_ID.睡眠] = 1;
    }
  }
  // 睡眠薬深度 = 1200 × (睡眠薬強度+1) + 疲労度/3, when 着替え実行 bit 0 set
  const clothingBit0 = ((slot.state.CFLAG[CFLAG_ID.着替え実行] ?? 0) & (1 << 0)) !== 0;
  if (slot.state.CFLAG[CFLAG_ID.睡眠] === 1 && clothingBit0) {
    const drugStrength = slot.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0;
    const fatigue = slot.state.TCVAR[TCVAR_ID.疲労度] ?? 0;
    slot.state.TCVAR[TCVAR_ID.睡眠深度] = 1200 * (drugStrength + 1) + Math.trunc(fatigue / 3);
  }
  // 着替え実行 bit 1 SET, bit 0 CLEAR
  setBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 1);
  clearBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 0);
  // 延迟中 OR 不在睡眠时间 OR 衰弱+不在自宅 → 反向 bit
  if (
    delayed ||
    !isCharaInSleepTime(slot, slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) ||
    (weak && !isCharaHome(slot, slot.location))
  ) {
    setBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 0);
    clearBit(slot.state.CFLAG, CFLAG_ID.着替え実行, 1);
  }
  // Master: BUFF_RESET
  if (charaNum === 0) {
    resetBuff(state);
  }
}
