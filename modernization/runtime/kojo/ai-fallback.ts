import type { KojoResolutionStatus } from "./types.js";

/**
 * AI dialogue may fill only a genuinely unauthored route. Gated and
 * unsupported authored paths must stay silent instead of being overwritten.
 */
export function isKojoAiFallbackEligible(
  status: KojoResolutionStatus,
): boolean {
  // "not-authored": the character has no authored kojo at all.
  // "gated" and "unsupported" are authored paths that must remain silent;
  // allowing AI to fill either one would overwrite an intentional route gate
  // or hide a parser/runtime defect.
  return status === "not-authored";
}
