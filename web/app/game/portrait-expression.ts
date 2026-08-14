import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { CharaSlot } from "../../../modernization/runtime/state/index.js";
import {
  calcExpressionCore,
  type CoreExpression,
} from "../../../modernization/runtime/state/portrait-expression-core.js";
import { portraitKindOf, type PortraitKind } from "../../../modernization/runtime/state/portrait-kind.js";
import type { SpriteCropSource } from "./SpriteCrop.js";

export type PortraitExpression = CoreExpression;

export interface PortraitSource extends SpriteCropSource {
  variants?: Partial<Record<PortraitExpression, SpriteCropSource>>;
  /** 顔絵 (face-only) dimension — the same char on a different sheet. Absent
   *  → the render layer falls back to the standing 立絵. */
  face?: SpriteCropSource & { variants?: Partial<Record<PortraitExpression, SpriteCropSource>> };
}

const CLICK_EXPRESSIONS: readonly PortraitExpression[] = ["normal", "smile", "angry"];

/** Pick the portrait dimension for the current 立絵種類. `face` falls back to
 *  the standing sheet when the char has no face asset (fail-closed). */
export function dimensionForKind(
  source: PortraitSource | undefined,
  kind: PortraitKind,
): SpriteCropSource | undefined {
  if (!source) return undefined;
  if (kind === "face") return source.face ?? source;
  return source;
}

/**
 * State-driven expression — `@CALC_EXPRESSION_CORE` (QOL_IMAGE.ERB:1392-1530)
 * deterministic port. Returns the candidate base expression for `charaNum`
 * from the state; the render layer then degrades a missing sprite to normal.
 * Signature takes the full GameState (the core reads turn-context / flags).
 */
export function statePortraitExpression(
  state: GameState,
  charaNum: number,
): PortraitExpression {
  return calcExpressionCore(state, charaNum).base;
}

/** Choose only from upstream-indexed portraits (missing variant → base). */
export function portraitForExpression(
  source: SpriteCropSource | undefined,
  expression: PortraitExpression,
): SpriteCropSource | undefined {
  if (!source) return undefined;
  if ("variants" in source) {
    const variants = (source as PortraitSource).variants;
    return variants?.[expression] ?? source;
  }
  return source;
}

export function nextClickExpression(
  source: PortraitSource | undefined,
  current: PortraitExpression | undefined,
): PortraitExpression {
  const available = CLICK_EXPRESSIONS.filter((expression) =>
    expression === "normal" || source?.variants?.[expression],
  );
  const index = available.indexOf(current ?? "normal");
  return available[(index + 1) % available.length] ?? "normal";
}

/** Resolve an authored DISPLAY_COM_IMAGE sprite name across BOTH the standing
 *  and face dimensions. The normal portrait remains the fail-closed fallback. */
export function portraitForSpriteName(
  source: PortraitSource | undefined,
  spriteName: unknown,
): SpriteCropSource | undefined {
  if (!source || typeof spriteName !== "string") return source;
  const match = (dim: SpriteCropSource | undefined): SpriteCropSource | undefined => {
    if (!dim) return undefined;
    if (dim.sprite === spriteName) return dim;
    if ("variants" in dim) {
      return Object.values((dim as PortraitSource).variants ?? {}).find(
        (variant) => variant?.sprite === spriteName,
      );
    }
    return undefined;
  };
  return match(source) ?? match(source.face) ?? source;
}

/** Current 立絵種類 (namespace-free, runtime authority). */
export function portraitKind(state: GameState): PortraitKind {
  return portraitKindOf(state);
}

// Keep a type-level alias so callers can name the char slot shape without
// importing runtime internals.
export type { CharaSlot };
