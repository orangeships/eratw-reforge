/**
 * Phase 2.6 PR 2 — Apply-glossary: the canonical→legacy reverse
 * lookup.
 *
 * This is the **adapter boundary** referenced in [[eratw-canonical-naming]]:
 *
 *   "adapter 就是 legacy 的边界。adapter 边界内保留 legacy,
 *    边界外全部走 canonical。"
 *
 * Translation: new TS code (Phase 3+, web/app, importer) uses
 * `canonical` names. Only this file is allowed to translate back
 * to legacy names when talking to upstream data (CSV / ERB / ALS).
 *
 * Per rule 1: glossary is one-way legacy → canonical. The reverse
 * direction (canonical → legacy) is what *this file* provides; it
 * does NOT have to be 100% (the glossary may have entries where
 * canonical is empty for value-layer — the lookup then returns
 * the legacy name verbatim, which is correct).
 *
 * Per rule 2: value-layer entries have empty canonical. The
 * apply function returns the legacy name unchanged for these.
 */

import type { LoadedGlossary } from "./glossary-loader.js";
import type { GlossaryEntry } from "./types.js";

/**
 * Given a canonical name, return the legacy name. Returns the
 * input unchanged if no entry matches (caller can decide whether
 * to warn / throw).
 */
export function canonicalToLegacy(
  glossary: LoadedGlossary,
  canonical: string,
): string {
  // We don't index by canonical (the glossary is one-way in the
  // OTHER direction: legacy → canonical). For canonical→legacy,
  // we scan. The glossary is small (≤ ~12k entries in the worst
  // case for function-names; in practice well under 20k), so a
  // linear scan is fine and avoids a second index.
  for (const entry of glossary.byLegacy.values()) {
    if (entry.scope === "type-layer" && entry.canonical === canonical) {
      return entry.legacy;
    }
  }
  return canonical;
}

/**
 * Given a legacy name, return the canonical name. Returns the
 * input unchanged if no entry matches.
 */
export function legacyToCanonical(
  glossary: LoadedGlossary,
  legacy: string,
): string {
  const entry = glossary.byLegacy.get(legacy);
  if (!entry) return legacy;
  // value-layer entries have empty canonical; the rule is to
  // NOT rename, so we return the legacy name unchanged.
  if (entry.scope === "value-layer" || !entry.canonical) return legacy;
  return entry.canonical;
}

/**
 * Given a legacy name, return the full entry (for callers that
 * want more than just the canonical). Returns `null` if no match.
 */
export function lookupEntry(
  glossary: LoadedGlossary,
  legacy: string,
): GlossaryEntry | null {
  return glossary.byLegacy.get(legacy) ?? null;
}
