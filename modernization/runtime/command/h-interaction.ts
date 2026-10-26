/**
 * H-command projection into the upstream TEQUIP contact/pose ring.
 *
 * The command handlers own SOURCE, PALAM, BASE and EXP settlement. This
 * module only prepares the deterministic interaction state that those
 * settlements read: current contact cells (101-109) and current pose (110).
 * It runs after command gates have passed and before a handler settles SOURCE.
 */

import type { GameState } from "../state/game-state.js";
import { TALENT_ID } from "../state/settlement.js";
import {
  clearCurrentTouchActorPart,
  clearCurrentTouchParts,
  clearCurrentTouchTarget,
  readTouchPart,
  setCurrentTouchCell,
  setCurrentTouchRelation,
  writeCurrentTouchPart,
  TOUCH_PART,
  TOUCH_COMPONENT,
  TOUCH_DEPTH,
  clearCurrentTouchRing,
} from "../state/touch-state.js";

interface PositionSpec {
  actorPart: number;
  targetPart: number;
  pose: number;
  /** The upstream position helper also adds a hand-to-breast contact. */
  breastHand?: boolean;
  /** Reverse/"被" position helpers explicitly clear these target cells. */
  clearTargetParts?: readonly number[];
}

/** Position commands whose modern session envelope tracks V insertion. */
export const V_POSITION_COMMANDS: ReadonlySet<number> = new Set([60, 61, 65, 67, 68, 320, 322]);

/** Position commands whose modern session envelope tracks A insertion. */
export const A_POSITION_COMMANDS: ReadonlySet<number> = new Set([62, 63, 66, 69, 70, 323]);

/** `POSE_*` values from `fromEN/SEX_CONSTANTS.ERH`. */
const POSITION_SPECS: Readonly<Record<number, PositionSpec>> = {
  // ADD_TOUCH_SET_TR(PLAYER, SET_V/A, SET_P, target, pose, 1)
  60: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 1 },
  61: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 2 },
  62: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 1 },
  63: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 2 },
  // Reverse rape: target V is the actor-side contact component.
  64: { actorPart: TOUCH_PART.Ｖ, targetPart: TOUCH_PART.Ｐ, pose: 3 },
  65: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 3 },
  66: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 3 },
  67: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 4 },
  68: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 5, breastHand: true },
  69: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 4 },
  70: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 5, breastHand: true },
  79: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 6 },
  // COMF92-94 / ADD_ACTIVE_TOUCH's reverse A positions.
  92: { actorPart: TOUCH_PART.Ａ, targetPart: TOUCH_PART.Ｐ, pose: 1, clearTargetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｖ] },
  93: { actorPart: TOUCH_PART.Ａ, targetPart: TOUCH_PART.Ｐ, pose: 2, clearTargetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｖ] },
  94: { actorPart: TOUCH_PART.Ａ, targetPart: TOUCH_PART.Ｐ, pose: 3, clearTargetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｖ] },
  // The "被" V positions use the same reverse projection as the upstream
  // COMF130-133 touch hooks. They are included for imported saves/fixtures;
  // only registered commands can reach this path in the player resolver.
  130: { actorPart: TOUCH_PART.Ｖ, targetPart: TOUCH_PART.Ｐ, pose: 1 },
  131: { actorPart: TOUCH_PART.Ｖ, targetPart: TOUCH_PART.Ｐ, pose: 2 },
  132: { actorPart: TOUCH_PART.Ｖ, targetPart: TOUCH_PART.Ｐ, pose: 4 },
  133: { actorPart: TOUCH_PART.Ｖ, targetPart: TOUCH_PART.Ｐ, pose: 5 },
  // Opponent-led insertion commands use the same target-side pose cells in
  // the flat TEQUIP projection; their counter/actor ownership is separate.
  320: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 1 },
  322: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ｖ, pose: 1 },
  323: { actorPart: TOUCH_PART.Ｐ, targetPart: TOUCH_PART.Ａ, pose: 1 },
};

interface DirectTouchSpec {
  targetPart: number;
  actorPart: number;
  allowDuplicateActorPart?: boolean;
  resetCurrent?: boolean;
  clearActorParts?: readonly number[];
  releaseInsertedTarget?: boolean;
}

interface MultiTouchSpec {
  /** Current flat-ring relations written in order. */
  readonly relations: readonly {
    actorPart: number;
    targetPart: number;
    allowDuplicateActorPart?: boolean;
  }[];
  pose?: number;
}

/** Commands whose upstream hook writes more than one current contact. */
const MULTI_TOUCH_SPECS: Readonly<Record<number, MultiTouchSpec>> = {
  // 二穴愛撫: both holes are touched by the player's finger.
  22: {
    relations: [
      { actorPart: TOUCH_PART.指, targetPart: TOUCH_PART.Ａ },
      { actorPart: TOUCH_PART.指, targetPart: TOUCH_PART.Ｖ, allowDuplicateActorPart: true },
    ],
  },
  // 両穴フィスト: the active-touch fork records the reverse-lotus pose and
  // projects the same hand into both V and A. The handler remains gated by
  // the historical insertion/COMABLE subsystem; this prepares the ring for
  // the bounded route once that gate is opened.
  143: {
    relations: [
      { actorPart: TOUCH_PART.指, targetPart: TOUCH_PART.Ｖ },
      { actorPart: TOUCH_PART.指, targetPart: TOUCH_PART.Ａ, allowDuplicateActorPart: true },
    ],
    pose: 5,
  },
};

/** Commands whose upstream body only resets a prior current contact. */
const RESET_TOUCH_SPECS: Readonly<Record<number, {
  actorParts?: readonly number[];
  targetParts?: readonly number[];
  resetCurrent?: boolean;
}>> = {
  8: { targetParts: [TOUCH_PART.Ｖ] },
  13: { targetParts: [TOUCH_PART.Ａ] },
  40: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  41: { targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  42: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  43: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  44: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｖ] },
  45: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ａ] },
  46: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ａ] },
  47: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｂ] },
  48: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｂ] },
  49: { actorParts: [TOUCH_PART.指] },
  84: { resetCurrent: true },
  100: { actorParts: [TOUCH_PART.指] },
  101: { actorParts: [TOUCH_PART.指] },
  102: { actorParts: [TOUCH_PART.指] },
  103: { actorParts: [TOUCH_PART.指] },
  104: { actorParts: [TOUCH_PART.指] },
  105: { actorParts: [TOUCH_PART.指] },
  106: { actorParts: [TOUCH_PART.指] },
  107: { actorParts: [TOUCH_PART.指] },
  108: { actorParts: [TOUCH_PART.指] },
  125: { targetParts: [TOUCH_PART.指, TOUCH_PART.口] },
  146: { actorParts: [TOUCH_PART.指] },
  147: { actorParts: [TOUCH_PART.指] },
  700: { actorParts: [TOUCH_PART.指] },
  740: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  741: { targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  742: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  743: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｃ, TOUCH_PART.Ｐ] },
  744: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｖ] },
  745: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ａ] },
  746: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ａ] },
  747: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｂ] },
  748: { actorParts: [TOUCH_PART.指], targetParts: [TOUCH_PART.Ｂ] },
  749: { actorParts: [TOUCH_PART.指] },
};

/** Direct `TOUCH_SET` calls used by the currently ported H command families. */
const DIRECT_TOUCH_SPECS: Readonly<Record<number, readonly DirectTouchSpec[]>> = {
  // COMF0's active-touch fork keeps both contacts in the flat compatibility
  // projection, even though the vanilla hook picked one randomly.
  0: [
    { targetPart: TOUCH_PART.Ｃ, actorPart: TOUCH_PART.指, clearActorParts: [TOUCH_PART.口] },
    { targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指, allowDuplicateActorPart: true },
  ],
  2: [{ targetPart: TOUCH_PART.Ｐ, actorPart: TOUCH_PART.口, resetCurrent: true }],
  3: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.指 }],
  4: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.口, resetCurrent: true }],
  5: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.指 }],
  6: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  7: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  10: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.口 }],
  11: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.口 }],
  12: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  15: [{ targetPart: TOUCH_PART.Ｃ, actorPart: TOUCH_PART.指 }],
  19: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.口 }],
  20: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.口 }],
  // Insertion-derived stimulation leaves the active insertion link in place
  // and changes only the target-side contact component.
  // The G-spot/cervix continuations focus on V but do not withdraw a second
  // active A insertion from the same target. Preserve COM71's duplicate P
  // relation while writing the focused V contact.
  72: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.Ｐ, allowDuplicateActorPart: true }],
  73: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.Ｐ, allowDuplicateActorPart: true }],
  74: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.Ｐ }],
  75: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.Ｐ }],
  80: [{ targetPart: TOUCH_PART.指, actorPart: TOUCH_PART.Ｐ }],
  81: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ｐ, releaseInsertedTarget: true }],
  82: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.Ｐ, releaseInsertedTarget: true }],
  83: [{ targetPart: TOUCH_PART.Ｃ, actorPart: TOUCH_PART.Ｐ, releaseInsertedTarget: true }],
  85: [{ targetPart: TOUCH_PART.足, actorPart: TOUCH_PART.Ｐ, releaseInsertedTarget: true }],
  88: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ｐ, releaseInsertedTarget: true }],
  90: [{ targetPart: TOUCH_PART.指, actorPart: TOUCH_PART.Ａ }],
  91: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ａ, releaseInsertedTarget: true }],
  120: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ｃ, resetCurrent: true }],
  121: [{ targetPart: TOUCH_PART.Ｃ, actorPart: TOUCH_PART.Ｃ, resetCurrent: true }],
  124: [{ targetPart: TOUCH_PART.Ｐ, actorPart: TOUCH_PART.指 }],
  126: [
    { targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指, resetCurrent: true },
    { targetPart: TOUCH_PART.指, actorPart: TOUCH_PART.Ｂ },
  ],
  140: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ｐ }],
  141: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.指 }],
  142: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.指 }],
  145: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.Ａ }],
  148: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.Ｐ }],
  149: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  150: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.Ｐ }],
  312: [{ targetPart: TOUCH_PART.口, actorPart: TOUCH_PART.口 }],
  313: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  314: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.指 }],
  316: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.指 }],
  // 自慰系 writes the MASTER-side ring (`TOUCH_SET(..., MASTER)`).
  703: [{ targetPart: TOUCH_PART.Ｖ, actorPart: TOUCH_PART.指 }],
  705: [{ targetPart: TOUCH_PART.Ａ, actorPart: TOUCH_PART.指 }],
  706: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  707: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
  709: [{ targetPart: TOUCH_PART.Ｐ, actorPart: TOUCH_PART.指 }],
  712: [{ targetPart: TOUCH_PART.Ｂ, actorPart: TOUCH_PART.指 }],
};

/** Commands whose target argument is intentionally MASTER (chara 0). */
const SELF_TOUCH_COMMANDS: ReadonlySet<number> = new Set([
  700, 703, 705, 706, 707, 708, 709, 712, 713,
  740, 741, 742, 743, 744, 745, 746, 747, 748, 749,
]);

/** Whether a command has a contact/pose projection to prepare. */
export function hCommandReleasesInsertion(commandNo: number): boolean {
  return commandNo === 1
    || RESET_TOUCH_SPECS[commandNo]?.resetCurrent === true
    || (DIRECT_TOUCH_SPECS[commandNo]?.some((spec) =>
      spec.resetCurrent || spec.releaseInsertedTarget) ?? false);
}

/** Whether a command has a contact/pose projection to prepare. */
export function hasHInteractionProjection(commandNo: number): boolean {
  return Object.prototype.hasOwnProperty.call(POSITION_SPECS, commandNo)
    || Object.prototype.hasOwnProperty.call(MULTI_TOUCH_SPECS, commandNo)
    || Object.prototype.hasOwnProperty.call(DIRECT_TOUCH_SPECS, commandNo)
    || Object.prototype.hasOwnProperty.call(RESET_TOUCH_SPECS, commandNo)
    || commandNo === 1
    || commandNo === 315
    || commandNo === 71
    || commandNo === 708
    || commandNo === 713;
}

/**
 * COMF317/318 continue an existing master-P insertion and do not create a
 * contact or pose. The matching upstream `ADD_CHARA_POSE(PLAYER, TARGET,
 * SET_P, SET_V/A)` gate is represented by the target-side contact cell.
 */
export function hasCurrentHInsertion(
  state: GameState,
  target: number,
  channel: "v" | "a",
): boolean {
  const targetSlot = state.charas[target];
  if (!targetSlot) return false;
  const targetPart = channel === "v" ? TOUCH_PART.Ｖ : TOUCH_PART.Ａ;
  return readTouchPart(targetSlot, targetPart) === TOUCH_PART.Ｐ;
}

/** Best-effort flat-ring test for the upstream `ADD_CHARA_INSERTED` guard. */
function hasCurrentInsertionProjection(state: GameState, target: number): boolean {
  const slot = state.charas[target];
  if (!slot) return false;
  return (
    readTouchPart(slot, TOUCH_PART.Ｐ) === TOUCH_PART.Ｖ ||
    readTouchPart(slot, TOUCH_PART.Ｐ) === TOUCH_PART.Ａ ||
    readTouchPart(slot, TOUCH_PART.Ｖ) === TOUCH_PART.Ｐ ||
    readTouchPart(slot, TOUCH_PART.Ａ) === TOUCH_PART.Ｐ
  );
}

/**
 * COM71's `MASTER_POSE(..., 1)` gate reads the previous-depth ring. It is
 * deliberately target-local here: the modern command resolver already owns
 * the selected target, while a future multi-target/ASSI route must not guess
 * an identity from a flat cell.
 */
function previousInsertionPose(state: GameState, target: number): number | undefined {
  const targetSlot = state.charas[target];
  if (!targetSlot) return undefined;
  const previousV = readTouchPart(targetSlot, TOUCH_PART.Ｖ, TOUCH_DEPTH.前回) === TOUCH_PART.Ｐ;
  const previousA = readTouchPart(targetSlot, TOUCH_PART.Ａ, TOUCH_DEPTH.前回) === TOUCH_PART.Ｐ;
  if (!previousV && !previousA) return undefined;
  return readTouchPart(targetSlot, TOUCH_COMPONENT.体位, TOUCH_DEPTH.前回);
}

/**
 * Prepare current H interaction state. Returns whether it changed the state.
 * The caller must pass a private command-state clone; this function mutates it
 * intentionally so SOURCE settlement can observe the new pose/contact.
 */
export function prepareHInteraction(
  state: GameState,
  actor: number,
  target: number,
  commandNo: number,
): boolean {
  const selfTarget = target === 0 && SELF_TOUCH_COMMANDS.has(commandNo);
  if (target < 0 || (!selfTarget && !state.charas[target])) return false;

  const position = POSITION_SPECS[commandNo];
  if (position) {
    setCurrentTouchRelation(
      state,
      actor,
      target,
      position.actorPart,
      position.targetPart,
      { pose: position.pose, resetCurrent: true },
    );
    if (position.breastHand) {
      setCurrentTouchCell(state, target, TOUCH_PART.Ｂ, TOUCH_PART.指);
    }
    for (const part of position.clearTargetParts ?? []) {
      const targetSlot = state.charas[target];
      if (targetSlot) {
        // A reverse position's explicit reset is target-local; it must not
        // disturb the pose just written on the actor side.
        writeCurrentTouchPart(targetSlot, part, 0);
      }
    }
    return true;
  }

  const multi = MULTI_TOUCH_SPECS[commandNo];
  if (multi) {
    for (const [index, relation] of multi.relations.entries()) {
      setCurrentTouchRelation(
        state,
        actor,
        target,
        relation.actorPart,
        relation.targetPart,
        {
          pose: multi.pose,
          resetCurrent: index === 0,
          allowDuplicateActorPart: relation.allowDuplicateActorPart,
        },
      );
    }
    return true;
  }

  if (commandNo === 71) {
    const pose = previousInsertionPose(state, target);
    if (pose === undefined) return false;
    setCurrentTouchRelation(state, actor, target, TOUCH_PART.Ｐ, TOUCH_PART.Ｖ, { pose });
    setCurrentTouchRelation(state, actor, target, TOUCH_PART.Ｐ, TOUCH_PART.Ａ, {
      pose,
      allowDuplicateActorPart: true,
    });
    return true;
  }

  if (selfTarget && (commandNo === 708 || commandNo === 713)) {
    clearCurrentTouchTarget(state, 0);
    return true;
  }

  if (commandNo === 315) {
    clearCurrentTouchActorPart(state, TOUCH_PART.指);
    const targetHasPenis = ((state.charas[target]?.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
    setCurrentTouchCell(
      state,
      target,
      targetHasPenis ? TOUCH_PART.Ｐ : TOUCH_PART.Ｃ,
      TOUCH_PART.指,
    );
    return true;
  }

  const reset = RESET_TOUCH_SPECS[commandNo];
  if (reset?.resetCurrent) clearCurrentTouchRing(state);
  if (reset?.targetParts) clearCurrentTouchParts(state, target, reset.targetParts);
  for (const actorPart of reset?.actorParts ?? []) {
    clearCurrentTouchActorPart(state, actorPart);
  }

  const direct = DIRECT_TOUCH_SPECS[commandNo] ?? (commandNo === 1 ? [] : undefined);
  if (!direct) return reset !== undefined;

  for (const spec of direct) {
    if (spec.resetCurrent) clearCurrentTouchRing(state);
    if (spec.releaseInsertedTarget && hasCurrentInsertionProjection(state, target)) {
      clearCurrentTouchRing(state);
    }
    for (const actorPart of spec.clearActorParts ?? []) {
      clearCurrentTouchActorPart(state, actorPart);
    }
    setCurrentTouchCell(state, target, spec.targetPart, spec.actorPart, {
      allowDuplicateActorPart: spec.allowDuplicateActorPart,
    });
  }

  // COMF1 switches from insertion to mouth contact before its SOURCE body.
  // The modern target gate uses the same sex-bit convention as upstream.
  if (commandNo === 1) {
    clearCurrentTouchRing(state);
    const targetSlot = state.charas[target];
    const targetHasPenis = ((targetSlot?.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
    setCurrentTouchCell(
      state,
      target,
      targetHasPenis ? TOUCH_PART.Ｐ : TOUCH_PART.Ｃ,
      TOUCH_PART.口,
    );
  }

  return true;
}
