/**
 * Per-character portrait-package authority.
 *
 * `CFLAG:差し替え適用` is the upstream persisted selection.  Rendering is
 * allowed to clamp the value to the active 立絵/顔絵 dimension, but it must not
 * silently rewrite the saved selection merely because the other dimension has
 * fewer packages.  This keeps the original choice when the player toggles
 * `FLAG:立絵種類`.
 */

import type { GameState } from "./game-state.js";
import { CFLAG_ID } from "./settlement.js";
import type { PortraitKind } from "./portrait-kind.js";

export interface PortraitVariantAvailability {
  /** Maximum selectable package id for 立絵.  The range is inclusive (0..N). */
  standing: number;
  /** Maximum selectable package id for 顔絵.  The range is inclusive (0..N). */
  face: number;
}
function slotFor(state: GameState, charaNum: number) {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

/**
 * Resolve the character whose resources are actually painted.  Upstream
 * QOL_IMAGE uses `VIS_C = CFLAG:変化先` when a character is transformed; if the
 * target slot is absent we fail closed to the original character.
 */
export function effectivePortraitCharaNum(state: GameState, charaNum: number): number {
  const source = slotFor(state, charaNum);
  const transformed = source?.state.CFLAG[CFLAG_ID.変化先] ?? 0;
  return transformed > 0 && slotFor(state, transformed) ? transformed : charaNum;
}

/** Read the persisted package id. Missing/negative values become 0. */
export function portraitVariantOf(state: GameState, charaNum: number): number {
  const effective = effectivePortraitCharaNum(state, charaNum);
  const value = slotFor(state, effective)?.state.CFLAG[CFLAG_ID.差し替え適用] ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** The nearest id in `availableIds`; ties resolve to the lower id. */
function nearestAvailable(value: number, availableIds: readonly number[]): number {
  let best = availableIds[0];
  for (const id of availableIds) {
    if (id === value) return id;
    if (Math.abs(id - value) < Math.abs(best - value)) best = id;
  }
  return best;
}

/**
 * Clamp only for rendering or UI display; this does not write GameState.
 *
 * `availableIds` is the exact list of package ids that own art in `kind`. The
 * declared package range is NOT contiguous: a pack can ship only a 顔絵 or
 * only a 立絵, which leaves holes. Clamping a hole to `max` would silently
 * render a *different* package than the save asked for, so when the caller
 * knows the real ids we snap to the closest one instead. Without that list we
 * fall back to the range clamp (still never writes state).
 */
export function clampPortraitVariant(
  value: number,
  availability: PortraitVariantAvailability | undefined,
  kind: PortraitKind,
  availableIds?: readonly number[],
): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (availableIds && availableIds.length > 0) {
    return nearestAvailable(normalized, availableIds);
  }
  if (!availability) return normalized;
  const max = Math.max(0, Math.trunc(availability[kind] ?? 0));
  return Math.min(normalized, max);
}

/** Current package id after applying the active dimension's render clamp. */
export function renderedPortraitVariant(
  state: GameState,
  charaNum: number,
  kind: PortraitKind,
  availability?: PortraitVariantAvailability,
  availableIds?: readonly number[],
): number {
  return clampPortraitVariant(portraitVariantOf(state, charaNum), availability, kind, availableIds);
}

/**
 * Persist an explicit player selection on the effective visual character.
 * When a catalog is supplied, values are clamped to the package range for
 * the active dimension before writing; without a catalog only integer
 * normalization is applied (useful during old-save migration/tests).
 */
export function setPortraitVariant(
  state: GameState,
  charaNum: number,
  value: number,
  kind?: PortraitKind,
  availability?: PortraitVariantAvailability,
): number {
  const effective = effectivePortraitCharaNum(state, charaNum);
  const slot = slotFor(state, effective);
  if (!slot) return 0;
  const normalized = kind
    ? clampPortraitVariant(value, availability, kind)
    : Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
  slot.state.CFLAG[CFLAG_ID.差し替え適用] = normalized;
  return normalized;
}
