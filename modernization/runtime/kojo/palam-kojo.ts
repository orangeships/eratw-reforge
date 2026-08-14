import type { PalamKojoKind } from "./types.js";

/** Keep PALAM's string detail verbatim: source distinguishes `00` from `0`. */
export function palamKojoKey(
  kind: PalamKojoKind,
  detail: string | number | undefined,
): string {
  return `${kind}:${detail === undefined ? "" : String(detail)}`;
}
