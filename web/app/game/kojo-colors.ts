/**
 * Per-character kojo display colors.
 *
 * This module is intentionally only an adapter around the generated bundle.
 * Keeping a second handwritten table made the interaction dialogue diverge
 * from the SceneView history when new upstream colors were indexed.
 */
import kojoColors from "./kojo-colors.bundle.json";

/** charaNum -> authored hex color from `@M_KOJO_COLOR_K{N}`. */
export const KOJO_COLORS: Readonly<Record<number, string>> = Object.freeze({
  ...(kojoColors as Record<string, string>),
});

/** The fallback when an upstream character has no color hook. */
export const DEFAULT_KOJO_COLOR = "#e8e8e8";

/** Resolve a character's kojo color (0 = MASTER -> default). */
export function kojoColor(charaNum: number): string {
  return KOJO_COLORS[charaNum] ?? DEFAULT_KOJO_COLOR;
}
