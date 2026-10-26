/**
 * 接触部位リング — the ERA contact-slot matrix (read model).
 *
 * eraTW records "who is touching whom where" as a **flat ring on every
 * chara**, not as a pair of links:
 *
 *     TEQUIP:n:(100 + component + 10 * depth) = <the other chara's part>
 *
 * - `component` 1..10 is *n's* body part (see `TOUCH_COMPONENT`).
 * - `depth` 0..3 is the turn offset — `EVENTCOMEND2.ERB:99-105`
 *   (「体位の保存」) shifts the whole ring one level each turn.
 * - The stored value is the **other** chara's part index (1..8), or 0 for
 *   "no contact". `@TOUCH_SET(ARG, ARG:1, ARG:2)` writes
 *   `TEQUIP:(ARG:2):(ARG) = ARG:1` where `ARG = 100 + targetComponent`
 *   and `ARG:1` is MASTER's part (`SOURCE_POSE.ERB:79-83`).
 *
 * Upstream names the same memory two ways; `AutoConst_Tequip.ERH` spells it
 * per component@depth (`阴茎２ = 111` is component 1 at depth 1, `体位 = 110`
 * is component 10 at depth 0), while `settlement.ts` names the four depth
 * bases (`体位履歴現在/前回/二回前/三回前 = 100/110/120/130`). Both index
 * the same ring; this module works in (component, depth) space so callers
 * never have to remember which one they are in.
 *
 * Cross-checked at `SOURCE_POSE.ERB:189`, where `@MASTER_POSE` reads
 * `TEQUIP:(TARGET):(100 + ARG + 10 * ARG:2)`.
 *
 * The writer helpers at the bottom of this file are the single state-layer
 * entry point for the 体位/接触部位 slice. They deliberately write only the
 * current depth; `shiftTouchHistory` is the EVENTCOMEND2 boundary operation.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import { readTequip, writeTequip } from "./tequip.js";

/** Base of the contact ring (`100 + component + 10 * depth`). */
export const TOUCH_RING_BASE = 100;

/** Components per depth level. Upstream iterates `FOR LOCAL:1, 1, 11`
 *  (end-exclusive → 1..10) in `EVENTCOMEND2.ERB:100`. */
export const TOUCH_COMPONENT_COUNT = 10;

/** Depth levels: current + three turns of history. */
export const TOUCH_DEPTH_COUNT = 4;

/**
 * Component index → body part. The first eight match the `@TOUCH_SET`
 * argument legend (`SOURCE_POSE.ERB:81`); `腋` is the fork's addition
 * (see the `;custom code, cancel armpitjobs too` loop bound at
 * `SOURCE_POSE.ERB:92`) and `体位` is component 10, which is why
 * `TEQUIP:体位` sits at 110 rather than in the 101-108 block.
 */
export const TOUCH_COMPONENT = {
  Ｐ: 1,
  Ｃ: 2,
  指: 3,
  口: 4,
  Ｂ: 5,
  Ｖ: 6,
  Ａ: 7,
  足: 8,
  腋: 9,
  体位: 10,
} as const;

export type TouchComponent = keyof typeof TOUCH_COMPONENT;

/** Upstream `SET_*` body-part values stored in a contact-ring cell. */
export const TOUCH_PART = {
  Ｐ: 1,
  Ｃ: 2,
  指: 3,
  口: 4,
  Ｂ: 5,
  Ｖ: 6,
  Ａ: 7,
  足: 8,
  腋: 9,
} as const;

export type TouchPart = keyof typeof TOUCH_PART;

/** Depth index → turn offset (`EVENTCOMEND2.ERB:100-105` shift order). */
export const TOUCH_DEPTH = {
  現在: 0,
  前回: 1,
  二回前: 2,
  三回前: 3,
} as const;

export type TouchDepth = keyof typeof TOUCH_DEPTH;

/** The TEQUIP slot for one (component, depth) cell of the ring. */
export function touchSlot(component: number, depth: number = TOUCH_DEPTH.現在): number {
  return TOUCH_RING_BASE + component + 10 * depth;
}

/**
 * Which of the other chara's parts is in contact with `chara`'s `component`,
 * at the given depth. Returns 0 when nothing is recorded — upstream leaves
 * the cell absent/zero rather than writing a sentinel.
 *
 * Note this is a *one-way* read: the ring only stores the other party's part
 * index, so "who" requires `findTouchPartners` over the room.
 */
export function readTouchPart(
  chara: CharaSlot,
  component: number,
  depth: number = TOUCH_DEPTH.現在,
): number {
  return readTequip(chara, touchSlot(component, depth));
}

/** Whether `chara`'s `component` is in contact with anything at `depth`. */
export function hasTouch(
  chara: CharaSlot,
  component: number,
  depth: number = TOUCH_DEPTH.現在,
): boolean {
  return readTouchPart(chara, component, depth) !== 0;
}

/**
 * Every `(component, depth)` cell on `chara` that holds a non-zero part,
 * in ring order (component-major inside each depth).
 *
 * This is the building block for the upstream scans that ask "is anyone
 * touching me with X" (`@MASTER_POSE`, `@TOUCH_RESET_*`). It deliberately
 * does not interpret the value — the caller owns that.
 */
export function listTouches(
  chara: CharaSlot,
): ReadonlyArray<{ component: number; depth: number; part: number }> {
  const out: Array<{ component: number; depth: number; part: number }> = [];
  for (let depth = 0; depth < TOUCH_DEPTH_COUNT; depth++) {
    for (let component = 1; component <= TOUCH_COMPONENT_COUNT; component++) {
      const part = readTouchPart(chara, component, depth);
      if (part !== 0) out.push({ component, depth, part });
    }
  }
  return out;
}

function allSlots(state: GameState): CharaSlot[] {
  return [state.master, ...Object.values(state.charas)];
}

function currentComponent(slot: CharaSlot, component: number): number {
  return readTouchPart(slot, component, TOUCH_DEPTH.現在);
}

/** Read the current pose component without making callers know that it is 110. */
export function readCurrentTouchPose(chara: CharaSlot): number {
  return readTouchPart(chara, TOUCH_COMPONENT.体位, TOUCH_DEPTH.現在);
}

/** Write one current-depth contact cell. Zero is the upstream empty value. */
export function writeCurrentTouchPart(
  chara: CharaSlot,
  component: number,
  part: number,
): void {
  if (component < 1 || component > 9) return;
  writeTequip(chara, touchSlot(component, TOUCH_DEPTH.現在), part);
}

/** Clear every current cell occupied by one actor body part. */
export function clearCurrentTouchActorPart(state: GameState, actorPart: number): void {
  if (actorPart < 1 || actorPart > 9) return;
  for (const slot of allSlots(state)) {
    for (let component = 1; component <= 9; component++) {
      if (currentComponent(slot, component) === actorPart) {
        writeCurrentTouchPart(slot, component, 0);
      }
    }
  }
}

/** Write the current pose component (TEQUIP:110). */
export function writeCurrentTouchPose(chara: CharaSlot, pose: number): void {
  writeTequip(chara, touchSlot(TOUCH_COMPONENT.体位, TOUCH_DEPTH.現在), pose);
}

/** Clear all current-depth contact cells and poses, retaining turn history. */
export function clearCurrentTouchRing(state: GameState): void {
  for (const slot of allSlots(state)) {
    for (let component = 1; component <= 9; component++) {
      writeCurrentTouchPart(slot, component, 0);
    }
    writeCurrentTouchPose(slot, 0);
  }
}

/** Clear selected current components on one target, retaining its pose and history. */
export function clearCurrentTouchParts(
  state: GameState,
  target: number,
  components: readonly number[],
): void {
  const targetSlot = target === 0 ? state.master : state.charas[target];
  if (!targetSlot) return;
  for (const component of components) {
    writeCurrentTouchPart(targetSlot, component, 0);
  }
}

/** Clear one target's current cells and both parties' current pose markers. */
export function clearCurrentTouchTarget(state: GameState, target: number): void {
  const targetSlot = target === 0 ? state.master : state.charas[target];
  if (!targetSlot) return;
  for (let component = 1; component <= 9; component++) {
    writeCurrentTouchPart(targetSlot, component, 0);
  }
  writeCurrentTouchPose(targetSlot, 0);
  writeCurrentTouchPose(state.master, 0);
}

/**
 * Project the original `TOUCH_SET(100 + component, actorPart, target)` call.
 * Unlike the active-touch table, this legacy helper writes the target-side
 * cell directly; it is used by ordinary foreplay and service commands.
 */
export function setCurrentTouchCell(
  state: GameState,
  target: number,
  targetComponent: number,
  actorPart: number,
  options: { allowDuplicateActorPart?: boolean } = {},
): void {
  const targetSlot = target === 0 ? state.master : state.charas[target];
  if (!targetSlot || targetComponent < 1 || targetComponent > 9 || actorPart < 1 || actorPart > 9) return;
  if (!options.allowDuplicateActorPart) {
    clearCurrentTouchActorPart(state, actorPart);
  }
  writeCurrentTouchPart(targetSlot, targetComponent, actorPart);
}

/**
 * Record one upstream `ADD_TOUCH_SET_TR` relation in the flat compatibility
 * ring. `actorPart` is the part doing the touching and `targetPart` is the
 * part being touched. When the target is the actor's penis (`SET_P`), the
 * owning cell is on the actor; otherwise it is on the target.
 *
 * The original fork keeps actor/target identity in a separate transient touch
 * table and projects it into this flat ring. The modern bounded H path has one
 * authoritative actor/target pair, so clearing an actor-part value across the
 * current ring is equivalent and keeps saves in the upstream shape.
 */
export function setCurrentTouchRelation(
  state: GameState,
  actor: number,
  target: number,
  actorPart: number,
  targetPart: number,
  options: {
    pose?: number;
    resetCurrent?: boolean;
    allowDuplicateActorPart?: boolean;
  } = {},
): void {
  const actorSlot = actor === 0 ? state.master : state.charas[actor];
  const targetSlot = target === 0 ? state.master : state.charas[target];
  if (!actorSlot || !targetSlot) return;
  if (actorPart < 1 || actorPart > 9 || targetPart < 1 || targetPart > 9) return;

  if (options.resetCurrent) {
    clearCurrentTouchRing(state);
  } else if (!options.allowDuplicateActorPart) {
    // `ADD_TOUCH_SET_TR` removes the actor's previous use of the same part.
    // The flat projection stores the part, not the actor id; the H runtime's
    // single active actor makes this the safe deterministic projection.
    clearCurrentTouchActorPart(state, actorPart);
  }

  if (targetPart === TOUCH_PART.Ｐ) {
    // Reverse/"被" positions are projected on the actor's body.
    writeCurrentTouchPart(actorSlot, actorPart, targetPart);
  } else {
    // A target component has one current occupant.
    writeCurrentTouchPart(targetSlot, targetPart, actorPart);
  }

  if (options.pose !== undefined && options.pose > 0) {
    const poseOwner = targetPart === TOUCH_PART.Ｐ ? actorSlot : targetSlot;
    writeCurrentTouchPose(poseOwner, options.pose);
  }
}

/** Find a current-depth target whose component is occupied by `actorPart`. */
export function findTouchTarget(
  state: Readonly<GameState>,
  actorPart: number,
  targetPart?: number,
  depth: number = TOUCH_DEPTH.現在,
): number | undefined {
  for (const slot of [state.master, ...Object.values(state.charas)]) {
    if (targetPart !== undefined && readTouchPart(slot, targetPart, depth) !== actorPart) continue;
    if (targetPart === undefined) {
      let matched = false;
      for (let component = 1; component <= 9; component++) {
        if (readTouchPart(slot, component, depth) === actorPart) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    }
    return slot.charaNum;
  }
  return undefined;
}

/** Compatibility name for `MASTER_POSE(actorPart, targetPart, history)`. */
export function findMasterPoseTarget(
  state: Readonly<GameState>,
  targetPart: number,
  actorPart: number,
  history = 0,
): number | undefined {
  return findTouchTarget(state, actorPart, targetPart, history);
}

/** Apply EVENTCOMEND2's 10-component, four-depth history shift. */
export function shiftTouchHistory(state: GameState): void {
  for (const slot of allSlots(state)) {
    for (let depth = TOUCH_DEPTH.三回前; depth >= TOUCH_DEPTH.前回; depth--) {
      for (let component = 1; component <= TOUCH_COMPONENT_COUNT; component++) {
        const previous = readTouchPart(slot, component, depth - 1);
        writeTequip(slot, touchSlot(component, depth), previous);
      }
    }
  }
}
