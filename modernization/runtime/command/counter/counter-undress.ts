/**
 * Bounded COUNTER DATUI intent projection.
 *
 * The upstream CCOMF bodies write TCVAR 22–25, `DATUI_MESSAGE` reads those
 * values before the selected action text, and `DATUI_LATE` commits clothing
 * afterward. This module keeps that ordering for the already-supported
 * actions without expanding the COUNTER pool.
 */

import type { CharaSlot, GameState } from "../../state/game-state.js";
import { readCurrentTouchPose } from "../../state/touch-state.js";
import { readTequip } from "../../state/tequip.js";
import {
  datuiOptimizeBottom,
  stripBottom,
  stripTop,
  type BottomStripMode,
  type TopStripMode,
} from "../../state/clothing-write.js";
import { showBottom, showLowerUnderwear, showTop, showUpperUnderwear } from "../../state/clothing.js";
import { TEQUIP_ID, TCVAR_ID } from "../../state/settlement.js";
import type { Rng } from "../types.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import { hasPlace, PLACE_FUTON } from "../../world/place-flags.js";

export const COUNTER_DATUI_MARKER_IDS = [
  TCVAR_ID.脱衣主角下半身,
  TCVAR_ID.脱衣目标下半身,
  TCVAR_ID.脱衣主角上半身,
  TCVAR_ID.脱衣目标上半身,
] as const;

const markerOrder = COUNTER_DATUI_MARKER_IDS;
const markerMax: Readonly<Record<number, number>> = {
  [TCVAR_ID.脱衣主角下半身]: 3,
  [TCVAR_ID.脱衣目标下半身]: 3,
  [TCVAR_ID.脱衣主角上半身]: 2,
  [TCVAR_ID.脱衣目标上半身]: 2,
};

/** Only these already-registered actions call a DATUI_* routine upstream. */
export const COUNTER_DATUI_ACTION_MARKERS: Readonly<Record<number, readonly number[]>> = {
  50: [TCVAR_ID.脱衣主角下半身],
  51: [TCVAR_ID.脱衣主角下半身],
  52: [TCVAR_ID.脱衣主角下半身, TCVAR_ID.脱衣目标下半身],
  53: [TCVAR_ID.脱衣主角下半身, TCVAR_ID.脱衣目标上半身],
  55: [TCVAR_ID.脱衣主角下半身],
  57: [TCVAR_ID.脱衣主角下半身],
  58: [TCVAR_ID.脱衣主角上半身],
  59: [TCVAR_ID.脱衣主角上半身],
  70: [TCVAR_ID.脱衣目标下半身],
  71: [TCVAR_ID.脱衣目标下半身],
  72: [TCVAR_ID.脱衣目标下半身],
  73: [TCVAR_ID.脱衣目标上半身],
  74: [TCVAR_ID.脱衣主角上半身, TCVAR_ID.脱衣目标上半身],
  75: [TCVAR_ID.脱衣目标下半身],
  77: [TCVAR_ID.脱衣目标上半身],
  80: [TCVAR_ID.脱衣主角下半身],
  83: [TCVAR_ID.脱衣目标下半身],
  85: [TCVAR_ID.脱衣主角下半身, TCVAR_ID.脱衣目标下半身],
  87: [TCVAR_ID.脱衣主角下半身],
};

export interface CounterUndressMarker {
  readonly id: number;
  /** Lower: 1=full, 2=underwear, 3=outerwear. Top: 1=full, 2=half-open. */
  readonly value: number;
}

export type CounterUndressInspection =
  | { readonly ok: true; readonly marker: CounterUndressMarker | null }
  | { readonly ok: false; readonly detail: string };

function targetSlot(state: Readonly<GameState>, target: number): CharaSlot | undefined {
  return state.charas[target];
}

function bedroom(state: Readonly<GameState>): boolean {
  return hasPlace(placeFlagsOf(state.master.location), PLACE_FUTON);
}

function lower(slot: CharaSlot): number {
  return readTequip(slot, TEQUIP_ID.下半身着衣状況);
}

function upper(slot: CharaSlot): number {
  return readTequip(slot, TEQUIP_ID.上半身着衣状況);
}

function setBottom(
  state: GameState,
  target: number,
  subject: "master" | "target",
  rawMode: BottomStripMode,
): void {
  const actor = targetSlot(state, target);
  const subjectSlot = subject === "master" ? state.master : actor;
  if (!actor || !subjectSlot) return;
  // DATUI_BOTTOM_T declines to set TCVAR:23 once the target already has a pose.
  if (subject === "target" && readCurrentTouchPose(subjectSlot) !== 0) return;
  const optimized = datuiOptimizeBottom(subjectSlot, rawMode);
  const id = subject === "master"
    ? TCVAR_ID.脱衣主角下半身
    : TCVAR_ID.脱衣目标下半身;
  actor.state.TCVAR[id] = optimized + 1;
}

function setTop(
  state: GameState,
  target: number,
  subject: "master" | "target",
  rawMode: TopStripMode,
): void {
  const actor = targetSlot(state, target);
  if (!actor) return;
  const id = subject === "master"
    ? TCVAR_ID.脱衣主角上半身
    : TCVAR_ID.脱衣目标上半身;
  actor.state.TCVAR[id] = rawMode + 1;
}

function drawOne(rng?: Rng): boolean {
  return (rng?.int(2) ?? 0) !== 0;
}

/**
 * Transcribe the DATUI calls in the CCOMF bodies currently in the pool.
 * The RNG draw sites match upstream RAND:2 branches, so the later dialogue
 * draw stream advances in the same order.
 */
export function seedCounterUndressMarkers(
  state: GameState,
  target: number,
  action: number,
  rng?: Rng,
): void {
  clearCounterUndressMarkers(state, target);
  const actor = targetSlot(state, target);
  if (!actor) return;
  const playerLower = lower(state.master);
  const playerUpper = upper(state.master);
  const targetLower = lower(actor);
  const targetUpper = upper(actor);
  const inBedroom = bedroom(state);

  switch (action) {
    case 50:
      if (playerLower & 1) setBottom(state, target, "master", 1);
      else if (playerLower & 8) setBottom(state, target, "master", 2);
      break;
    case 51:
    case 55:
      if (playerLower & 12) setBottom(state, target, "master", 2);
      else if ((playerLower & 2) && drawOne(rng)) setBottom(state, target, "master", 1);
      break;
    case 52:
      if (playerLower !== 0) setBottom(state, target, "master", 0);
      if (targetLower !== 0) setBottom(state, target, "target", 0);
      break;
    case 53:
      if (playerLower > 1) setBottom(state, target, "master", 0);
      if (targetUpper > 1) setTop(state, target, "target", 0);
      break;
    case 57:
      if (inBedroom) {
        if (playerLower !== 0) setBottom(state, target, "master", 2);
      } else if (playerLower & 14) {
        setBottom(state, target, "master", 1);
      }
      break;
    case 58:
      if ((playerUpper & 2) && drawOne(rng)) setTop(state, target, "master", 0);
      break;
    case 59:
      if (playerUpper & 2) setTop(state, target, "master", 0);
      break;
    case 70:
    case 71:
      if (inBedroom) {
        if (targetLower !== 0) setBottom(state, target, "target", 0);
      } else if (targetLower & 14) {
        setBottom(state, target, "target", 1);
      }
      break;
    case 72:
      if (inBedroom) {
        if (targetLower !== 0) setBottom(state, target, "target", drawOne(rng) ? 1 : 0);
      } else if (targetLower & 14) {
        setBottom(state, target, "target", 1);
      }
      break;
    case 73:
      if (targetUpper & 1) setTop(state, target, "target", 0);
      break;
    case 74:
      if (playerUpper > 1) setTop(state, target, "master", 0);
      if (targetUpper > 1) setTop(state, target, "target", 0);
      break;
    case 75:
      if (targetLower !== 0) setBottom(state, target, "target", 0);
      break;
    case 77:
      if (targetUpper > 1) setTop(state, target, "target", 0);
      break;
    case 80:
      if (inBedroom) {
        if (playerLower !== 0) setBottom(state, target, "master", 0);
      } else if (playerLower & 14) {
        setBottom(state, target, "master", 1);
      }
      break;
    case 83:
      if (inBedroom) {
        if (targetLower !== 0) setBottom(state, target, "target", 0);
      } else if (targetLower & 14) {
        setBottom(state, target, "target", 1);
      }
      break;
    case 85:
      if (playerLower !== 0) setBottom(state, target, "master", 0);
      if (inBedroom) {
        if (targetLower !== 0) setBottom(state, target, "target", 0);
      } else if (targetLower & 14) {
        setBottom(state, target, "target", 1);
      }
      break;
    case 87:
      if (playerLower !== 0) setBottom(state, target, "master", 0);
      break;
  }
}

export function clearCounterUndressMarkers(state: GameState, target: number): void {
  const actor = state.charas[target];
  if (!actor) return;
  for (const id of markerOrder) actor.state.TCVAR[id] = 0;
}

export function inspectCounterUndressMarkers(
  state: Readonly<GameState>,
  target: number,
  action: number,
): CounterUndressInspection {
  const actor = targetSlot(state, target);
  if (!actor) return { ok: true, marker: null };
  const allowed = COUNTER_DATUI_ACTION_MARKERS[action] ?? [];
  for (const id of markerOrder) {
    const value = actor.state.TCVAR[id] ?? 0;
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, detail: `COUNTER:${action} has an invalid DATUI marker ${id}=${value}` };
    }
    if (value === 0) continue;
    if (!allowed.includes(id) || value > (markerMax[id] ?? 0)) {
      return { ok: false, detail: `COUNTER:${action} has an unexpected DATUI marker ${id}=${value}` };
    }
  }
  const markerId = markerOrder.find((id) => (actor.state.TCVAR[id] ?? 0) > 0);
  if (markerId === undefined) return { ok: true, marker: null };
  return { ok: true, marker: { id: markerId, value: actor.state.TCVAR[markerId] ?? 0 } };
}

function subjectOf(markerId: number): "master" | "target" {
  return markerId === TCVAR_ID.脱衣主角下半身 || markerId === TCVAR_ID.脱衣主角上半身
    ? "master"
    : "target";
}

function projectMarker(
  state: GameState,
  target: number,
  marker: CounterUndressMarker,
): GameState {
  const subject = subjectOf(marker.id);
  const charaNum = subject === "master" ? 0 : target;
  if (marker.id === TCVAR_ID.脱衣主角下半身 || marker.id === TCVAR_ID.脱衣目标下半身) {
    return stripBottom(state, charaNum, (marker.value - 1) as BottomStripMode);
  }
  return stripTop(
    state,
    charaNum,
    (marker.value - 1) as TopStripMode,
    subject,
  );
}

function equipmentChanged(before: CharaSlot, after: CharaSlot): boolean {
  const slots = new Set([...Object.keys(before.state.EQUIP), ...Object.keys(after.state.EQUIP)]);
  return [...slots].some((slot) =>
    (before.state.EQUIP[Number(slot)] ?? 0) !== (after.state.EQUIP[Number(slot)] ?? 0)
  );
}

function visibleItems(chara: CharaSlot, marker: CounterUndressMarker): string[] {
  let candidates: string[];
  if (marker.id === TCVAR_ID.脱衣主角下半身 || marker.id === TCVAR_ID.脱衣目标下半身) {
    candidates = marker.value === 2
      ? [showLowerUnderwear(chara)]
      : marker.value === 3
        ? [showBottom(chara)]
        : [showBottom(chara), showLowerUnderwear(chara)];
  } else {
    candidates = marker.value === 2
      ? ["上衣"]
      : [showTop(chara), showUpperUnderwear(chara)];
  }
  return [...new Set(candidates.filter((item) => item.trim()))];
}

/** Build the factual DATUI prelude from the clothing visible before commit. */
export function counterUndressPrelude(
  state: Readonly<GameState>,
  target: number,
  action: number,
  names: { readonly targetName?: string; readonly masterName?: string } = {},
): string[] {
  const inspection = inspectCounterUndressMarkers(state, target, action);
  if (!inspection.ok || !inspection.marker) return [];
  const marker = inspection.marker;
  const subject = subjectOf(marker.id);
  const subjectNum = subject === "master" ? 0 : target;
  const before = subject === "master" ? state.master : state.charas[target];
  if (!before) return [];
  const afterState = projectMarker(state as GameState, target, marker);
  const after = subject === "master" ? afterState.master : afterState.charas[target];
  if (!after || !equipmentChanged(before, after)) return [];
  const actorName = names.targetName || state.charas[target]?.callName || `#${target}`;
  const subjectName = subjectNum === 0
    ? names.masterName || state.master.callName || "主人公"
    : actorName;
  const items = visibleItems(before, marker);
  const description = items.length > 0
    ? items.join("和")
    : marker.id === TCVAR_ID.脱衣主角上半身 || marker.id === TCVAR_ID.脱衣目标上半身
      ? "上身衣物"
      : "下身衣物";
  const verb = marker.id === TCVAR_ID.脱衣主角上半身 || marker.id === TCVAR_ID.脱衣目标上半身
    ? "解开了"
    : "脱下了";
  return [subjectNum === target
    ? `${actorName}${verb}自己的${description}。`
    : `${actorName}${verb}${subjectName}的${description}。`];
}

/** Commit the first pending marker in upstream DATUI_LATE priority order. */
export function applyCounterUndressLate(state: GameState, target: number, action: number): GameState {
  const inspection = inspectCounterUndressMarkers(state, target, action);
  let next = state;
  if (inspection.ok && inspection.marker) next = projectMarker(state, target, inspection.marker);
  clearCounterUndressMarkers(next, target);
  return next;
}
