/**
 * 立絵↔顔絵 — portrait-kind authority (FLAG:立絵種類 #1047).
 *
 * eraTW `FLAG:立絵種類` (AutoConst_FLAG.ERH:288 `#DIM CONST FLAG_立絵種類 =
 * 1047`) selects between the full-body 立絵 (0) and the face-only 顔絵 (1).
 * `@GET_BASESTYLE` (IMAGE.ERB:862-894) turns it into the resource-name prefix
 * (`立絵_` vs `顔絵_`), and the render layer picks the matching sprite sheet.
 *
 * This module is the runtime-side authority: it owns the FLAG read/write,
 * exposed namespace-free so the UI layer (forbidden from spelling `FLAG`)
 * can drive the toggle. Stored in `GameState.flagStore`.
 */

import type { GameState } from "../state/game-state.js";
import { FLAG_ID } from "../state/settlement.js";

/** Which portrait dimension to render: full-body 立絵 or face-only 顔絵. */
export type PortraitKind = "standing" | "face";

/** Read `FLAG:立絵種類` (absent flag → 0 → standing). */
export function portraitKindOf(state: GameState): PortraitKind {
  return (state.flagStore[FLAG_ID.立絵種類] ?? 0) !== 0 ? "face" : "standing";
}

/** Flip `FLAG:立絵種類` (eraTW `FLAG:立絵種類 = !FLAG:立絵種類`). Returns the
 *  new kind. Mutates `state.flagStore` (caller clones first). */
export function togglePortraitKind(state: GameState): PortraitKind {
  const next = (state.flagStore[FLAG_ID.立絵種類] ?? 0) === 0 ? 1 : 0;
  state.flagStore[FLAG_ID.立絵種類] = next;
  return next === 1 ? "face" : "standing";
}
