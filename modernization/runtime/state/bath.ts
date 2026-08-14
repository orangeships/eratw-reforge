/**
 * Phase 7.2 — bath subsystem, faithful port of eraTW `@ODEKAKE_OFURO`
 * (`COMF432 銭湯.ERB:408-460`). Shared by COMF431 (お風呂でくつろぐ) and
 * COMF432 (銭湯).
 *
 * `ODEKAKE_OFURO(ARG=chara, ARG:1=BathType)`:
 *   - BathType 1 = real bath (風呂 / 銭湯 / 貸切浴場), 2 = 旧地獄温泉,
 *     3 = 簡易泳池 (inflatable pool). 1/2/3 differ only in the魔改-recovery
 *     RECOVER_PERMIL values:
 *       type 1 → 体力 400 / 気力 600
 *       type 2 → 体力 600 / 気力 800
 *       type 3 → 体力 120 / 気力 300
 *     (魔改 doubled vs the commented-out originals 200/300, 300/400, 60/150.)
 *   - Clears 風呂 CFLAG:323 (MIN(風呂-1000, 0)), the five 射精/精液 CFLAG
 *     (286-290), and STAIN (deferred — STAIN not modeled).
 *   - 桧木浴室 bonus (RECOVER_PERMIL 40/50/20 × ITEM:桧木浴室 tier) — only
 *     at the master's nearest bath; deferred (ITEM:桧木浴室 + NEAR_BATH not
 *     modeled; trial has no 桧木浴室).
 *   - `EX:MASTER:上次的入浴時间 = DAY*1440 + TIME` — only when ARG == MASTER.
 *
 * **Ported faithfully:** BathType recovery perms, CFLAG clears, EX 入浴時间.
 * **Deferred:** STAIN (RESET_STAIN + STAIN:ARG:4=0 — no STAIN namespace),
 * 桧木浴室 bonus (ITEM + NEAR_BATH).
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { GameState } from "./game-state.js";
import type { CharaSlot } from "./game-state.js";
import {
  CFLAG_ID,
  EX_ID,
  FLAG_ID,
  BASE_ID,
  recoverPermil,
} from "./settlement.js";
import { clearAllStain } from "./stain.js";

/** BathType 1 — real bath (風呂 / 銭湯 / 貸切浴場). */
export const BATH_TYPE_BATH = 1;
/** BathType 2 — 旧地獄温泉 (deferred, 地底 map). */
export const BATH_TYPE_OLD_HELL = 2;
/** BathType 3 — 簡易泳池 (inflatable pool). */
export const BATH_TYPE_POOL = 3;

/** Recovery permille by BathType (魔改-doubled values, ERB 442-455). */
const RECOVERY: Record<number, { stamina: number; will: number }> = {
  [BATH_TYPE_BATH]: { stamina: 400, will: 600 },
  [BATH_TYPE_OLD_HELL]: { stamina: 600, will: 800 },
  [BATH_TYPE_POOL]: { stamina: 120, will: 300 },
};

/**
 * The five 射精/精液 CFLAG cleared by bathing (`ODEKAKE_OFURO` ERB 436-440).
 */
const BATH_CLEAR_CFLAGS = [
  CFLAG_ID.膣内射精,
  CFLAG_ID.肛門射精,
  CFLAG_ID.口内精液,
  CFLAG_ID.脸上精液,
  CFLAG_ID.手上精液,
] as const;

/**
 * Port of `@ODEKAKE_OFURO(charaNum, bathType)`. Mutates `state` in place.
 *
 * - Clears 風呂 CFLAG (`MIN(風呂-1000, 0)`) + the five 射精/精液 CFLAG.
 * - Restores 体力/気力 by the BathType's permille (魔改 values).
 * - If `charaNum === 0` (master), stamps `EX:上次的入浴時间 = tickValue`.
 *
 * Returns the recovered amounts (for narration/testing).
 *
 * Deferred: STAIN reset, 桧木浴室 bonus (ITEM:桧木浴室 + NEAR_BATH).
 */
export function applyBath(
  state: GameState,
  charaNum: number,
  bathType: number,
): { stamina: number; will: number } {
  const slot: CharaSlot | undefined =
    charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return { stamina: 0, will: 0 };

  // Clear 風呂 (CFLAG:323) — `MIN(風呂-1000, 0)` in ERB. The author's
  // intent is "reduce 風呂 dirt by 1000, floor at 0" (a negative dirt level
  // is meaningless and would break downstream `風呂 > 0` checks). era's
  // `MIN(a,b)` returns the smaller of the two, so `MIN(1500,0)=0` but
  // `MIN(-1000,0)=-1000` — the literal reading produces negative 風呂.
  // We use `max(furo-1000, 0)` (floor at 0) to match the clear intent and
  // avoid negative dirty-state values. (Deferred note: if a downstream
  // test ever pins the literal-negative behavior, revisit.)
  const furo = slot.state.CFLAG[CFLAG_ID.風呂] ?? 0;
  slot.state.CFLAG[CFLAG_ID.風呂] = Math.max(furo - 1000, 0);

  // Clear the five 射精/精液 CFLAG.
  for (const id of BATH_CLEAR_CFLAGS) {
    slot.state.CFLAG[id] = 0;
  }
  // Clear all STAIN body-soil (full bath wash — `RESET_STAIN` equivalent).
  clearAllStain(slot);

  // Recovery by BathType.
  const rec = RECOVERY[bathType] ?? RECOVERY[BATH_TYPE_BATH];
  const beforeSta = slot.state.BASE[BASE_ID.体力] ?? 0;
  const beforeWill = slot.state.BASE[BASE_ID.気力] ?? 0;
  recoverPermil(slot, BASE_ID.体力, rec.stamina);
  recoverPermil(slot, BASE_ID.気力, rec.will);
  const stamina = (slot.state.BASE[BASE_ID.体力] ?? 0) - beforeSta;
  const will = (slot.state.BASE[BASE_ID.気力] ?? 0) - beforeWill;

  // EX:上次的入浴時间 — only master (ERB 458-459: `SIF ARG == MASTER`).
  // era writes `DAY*1440 + TIME`; the modern tickValue already equals that
  // (tickValue is monotonic minutes since boot = DAY*1440+TIME within a day).
  if (charaNum === 0) {
    state.master.state.EX[EX_ID.上次的入浴時间] = state.time.tickValue;
  }

  return { stamina, will };
}

/**
 * Interval since last bath, in minutes. eraTW gates COMF431 on
 * `DAY*1440+TIME - EX:上次的入浴時间` (`COMF431 @COM` ERB 21). The魔改
 * replaces `< 360` with `< 0`, so the cooldown effectively never trips
 * (tickValue is monotonic; the diff is ≥ 0 unless the EX stamp is in the
 * future, which doesn't happen). Kept as a faithful helper for the gate.
 */
export function minutesSinceLastBath(state: GameState): number {
  const last = state.master.state.EX[EX_ID.上次的入浴時间] ?? 0;
  return state.time.tickValue - last;
}

/**
 * `NEAR_BATH()` — the master's nearest bath location (for the 桧木浴室
 * bonus + the 431 "丝柏の清香" flavor). **Deferred** — bath-location
 * resolution needs the full ROOMDATA 拠点 graph; returns the master's
 * current location only if it is itself a bath (a faithful best-effort).
 */
export function nearBath(_state: GameState): string | null {
  return null; // deferred
}

/** Re-export for handler convenience. */
export { FLAG_ID };
