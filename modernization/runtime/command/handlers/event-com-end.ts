/**
 * `@EVENTCOMEND2` post-command per-chara hook — the daily-path slice.
 *
 * `ERB/イベント関連/EVENTCOMEND2.ERB` is a 433-line hook that eraTW runs after
 * EVERY command (the second of two same-named @EVENTCOMEND chains; the first
 * carries our exhaustion-collapse). It loops over all charas and does a LOT:
 * 体位/服装 bookkeeping, STAIN (semen) propagation, 射精 recompute, etc. —
 * almost all of it H-subsystem state we haven't modeled.
 *
 * We port ONLY the lines that fire on the ordinary (non-H) command path and
 * that the oracle's batch-3 traces caught diverging (CFLAG[285] was our single
 * highest-frequency divergence, 21 steps), plus the late-night fatigue drain
 * that keeps the daily loop from becoming a no-consequence all-nighter:
 *
 *   EVENTCOMEND2:154  CFLAG:勃起度２ = BASE:勃起          (snapshot 勃起 into CFLAG)
 *   EVENTCOMEND2:155  BASE:勃起 = MIN(MAXBASE:勃起, BASE:勃起)   (clamp to ceiling)
 *   EVENTCOMEND2:255-263
 *     if awake and NEMUKE() >= 960:
 *       BASE:MASTER:体力 = MAX(BASE:MASTER:体力 - 5 * TIME_PROGRESS(TIME:1), 0)
 *       BASE:MASTER:気力 = MAX(BASE:MASTER:気力 - 10 * TIME_PROGRESS(TIME:1), 0)
 *     else if NEMUKE() >= 840:
 *       BASE:MASTER:気力 = MAX(BASE:MASTER:気力 - 2 * TIME_PROGRESS(TIME:1), 0)
 *
 * The bounded H slice below now also ports the V/A parts of those lines:
 *   - V/A fluid flags, pose history and position-control decay;
 *   - deterministic midpoint semen-stain propagation from internal residue;
 *   - NOWEX:射精 erection recompute.
 * Full clothing-setting side effects and the remaining H/ASSI branches stay
 * outside this hook until their owning state machines are migrated.
 *
 * NOTE on phase (batch-3 finding): in the real traces CFLAG[285] reads as the
 * PREVIOUS command's 勃起, because the trace's own @EVENTCOMEND dump hook runs
 * before eraTW's @EVENTCOMEND2 in load order. That's a dump-timing artifact, not
 * gameplay: the authoritative semantics are "285 = 勃起 after this command", and
 * that's what we implement. The 1-command phase offset only shows up when diffing
 * a trace and is documented in the oracle batch notes, not corrected here.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { CharaSlotState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "../../state/settlement.js";
import { nemuke } from "../../state/nemuke.js";
import { activeHInsertionSite } from "../training-session.js";
import { bodyFillRate } from "../../state/body-fill-rate.js";
import { STAIN_BIT, STAIN_PART } from "../../state/stain.js";
import { readTequip } from "../../state/tequip.js";
import { shiftTouchHistory } from "../../state/touch-state.js";

/** Sync + clamp 勃起 for one chara's slot state. Mutates in place. */
function syncErectionForSlot(s: CharaSlotState): void {
  const erection = s.BASE[BASE_ID.勃起] ?? 0;
  // L154: CFLAG:勃起度２ = BASE:勃起 (snapshot before the clamp — ERB order).
  s.CFLAG[CFLAG_ID.勃起度２] = erection;
  // L155: BASE:勃起 = MIN(MAXBASE:勃起, BASE:勃起). Only clamp when a real
  // ceiling is known. `s.MAXBASE` may be entirely absent on bare test fixtures
  // (emptyCharaSlotState inits it, but hand-written fixtures sometimes omit it);
  // optional chaining keeps the "no ceiling → don't touch" rule recoverPermil /
  // forceSleep use, matching the upstream `MIN` over an unset var.
  const cap = s.MAXBASE?.[BASE_ID.勃起] ?? 0;
  if (cap > 0 && erection > cap) s.BASE[BASE_ID.勃起] = cap;
}

function hasActiveInsertion(state: GameState, slot: CharaSlot): boolean {
  if (slot.charaNum === 0) {
    return (
      readTequip(state.master, TEQUIP_ID.Ｖ性交) !== 0 ||
      readTequip(state.master, TEQUIP_ID.Ａ性交) !== 0
    );
  }
  return activeHInsertionSite(state, slot.charaNum) !== null;
}

function settleFluidFlag(slot: CharaSlotState, flagId: number, senderId: number): void {
  const current = slot.TCVAR[flagId] ?? 0;
  if (current <= 0) return;
  const remaining = Math.max(0, current - 1);
  slot.TCVAR[flagId] = remaining;
  if (remaining === 0) slot.TCVAR[senderId] = -1;
}

function decayPoseControl(slot: CharaSlotState, controlId: number, valueId: number): void {
  const current = slot.TCVAR[controlId] ?? 0;
  if (current <= 0) return;
  const remaining = Math.max(0, current - 1);
  slot.TCVAR[controlId] = remaining;
  if (remaining === 0) slot.TCVAR[valueId] = 0;
}

/** Deterministic midpoint of EVENTCOMEND2's random semen-spread check. */
function propagateInternalSemen(slot: CharaSlotState): void {
  const vFill = bodyFillRate(slot, 1) ?? 0;
  if (vFill >= 120 && (slot.STAIN[STAIN_PART.膣内] ?? 0) & STAIN_BIT.精液) {
    slot.STAIN[STAIN_PART.Ｖ] = (slot.STAIN[STAIN_PART.Ｖ] ?? 0) | STAIN_BIT.精液;
  }
  const aFill = bodyFillRate(slot, 2) ?? 0;
  if (aFill >= 120 && (slot.STAIN[STAIN_PART.腸内] ?? 0) & STAIN_BIT.精液) {
    slot.STAIN[STAIN_PART.Ａ] = (slot.STAIN[STAIN_PART.Ａ] ?? 0) | STAIN_BIT.精液;
  }
}

function settleEventComEndSlot(state: GameState, slot: CharaSlot): void {
  const s = slot.state;
  s.TCVAR[TCVAR_ID.調教履歴保存] = s.TCVAR[TCVAR_ID.調教履歴] ?? 0;
  s.TCVAR[TCVAR_ID.前ターン射精箇所] = s.TCVAR[TCVAR_ID.已射精部位FLAG] ?? 0;
  settleFluidFlag(s, TCVAR_ID.V被中出FLAG, TCVAR_ID.Vに中出しした角色番号);
  settleFluidFlag(s, TCVAR_ID.A被中出FLAG, TCVAR_ID.Aに中出しした角色番号);
  decayPoseControl(s, TCVAR_ID.体勢制御, TCVAR_ID.体勢);
  decayPoseControl(s, TCVAR_ID.位置関係制御, TCVAR_ID.位置関係);
  propagateInternalSemen(s);

  const ejaculation = state.turnContext?.frame?.nowExByChara[slot.charaNum]?.[EX_ID.射精] ?? 0;
  if (ejaculation <= 0) return;
  const erection = s.BASE[BASE_ID.勃起] ?? 0;
  if (hasActiveInsertion(state, slot)) {
    s.BASE[BASE_ID.勃起] = 1000;
    return;
  }
  const desire = s.ABL[ABL_ID.欲望] ?? 0;
  const energy = s.BASE[BASE_ID.精力] ?? 0;
  const maxEnergy = s.MAXBASE?.[BASE_ID.精力] ?? 0;
  const denominator = (maxEnergy + 200) * (desire + 10);
  s.BASE[BASE_ID.勃起] = denominator > 0
    ? Math.max(0, Math.trunc((erection * (desire + 1) * (energy + 200)) / denominator))
    : 0;
}

/** Apply EVENTCOMEND2's sleepy-overwork drain to the master. Mutates in place. */
function drainMasterForSleepiness(state: GameState, elapsedMinutes: number): void {
  if (elapsedMinutes <= 0) return;
  if ((state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return;

  const drowsy = nemuke(state);
  const base = state.master.state.BASE;
  if (drowsy >= 960) {
    base[BASE_ID.体力] = Math.max(0, (base[BASE_ID.体力] ?? 0) - 5 * elapsedMinutes);
    base[BASE_ID.気力] = Math.max(0, (base[BASE_ID.気力] ?? 0) - 10 * elapsedMinutes);
  } else if (drowsy >= 840) {
    base[BASE_ID.気力] = Math.max(0, (base[BASE_ID.気力] ?? 0) - 2 * elapsedMinutes);
  }
}

/**
 * Run the daily-path slice of @EVENTCOMEND2 over master + every NPC. Mutates
 * `state` in place. `elapsedMinutes` is ERA's `TIME_PROGRESS(TIME:1)` for the
 * just-finished command; the default preserves direct-test call sites that only
 * care about silent per-slot bookkeeping. Returns `[]` (no narration — this is
 * silent bookkeeping; the signature matches the other EVENTCOMEND hooks so
 * apply-intent can append its result uniformly).
 */
export function runEventComEnd2(state: GameState, elapsedMinutes = 0): never[] {
  shiftTouchHistory(state);
  syncErectionForSlot(state.master.state);
  settleEventComEndSlot(state, state.master);
  state.master.state.CFLAG[CFLAG_ID.前一次的位置] =
    state.master.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
  for (const slot of Object.values(state.charas)) {
    syncErectionForSlot(slot.state);
    settleEventComEndSlot(state, slot);
    // EVENTCOMEND2.ERB:237 — snapshot location after this command. The next
    // movement pass uses current vs previous to reject actions mid-move.
    slot.state.CFLAG[CFLAG_ID.前一次的位置] =
      slot.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
  }
  drainMasterForSleepiness(state, elapsedMinutes);
  return [];
}
