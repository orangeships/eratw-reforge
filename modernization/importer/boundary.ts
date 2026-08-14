/**
 * Phase 3 (revised) — core/mod boundary primitives.
 *
 * The audit (`modernization/docs/phase-1-3-claude-audit.md`, finding P1)
 * identified that the original Phase 3 boundary was enforced at the
 * source-code text level ("don't import a mod-tier path") but not at
 * the manifest level. This module makes the boundary a real, importable
 * primitive that:
 *
 *   1. The build-manifests pipeline uses to filter mod-tier files out
 *      of `functions.json` (Route A: core-only functions.json).
 *   2. The `core-boundary` test uses to assert that every surviving
 *      manifest entry is from a non-mod-tier path.
 *   3. The source-code scan uses to confirm no .ts file under
 *      `modernization/{importer,runtime}` references a mod-tier path.
 *
 * Single source of truth — the inventory documented in
 * `modernization/docs/phase-3-mod-boundary.md`. If you change one,
 * change the other.
 */

export type CoreScope = "core" | "mod";

/**
 * Project-root-relative prefixes of mod-tier content. Used for source
 * text scans (where the path is checked as a substring of source code)
 * and for any caller that has a project-root-relative path.
 *
 * Note (2026-07-02): the weather system (`天候システム.ERH`,
 * `天候予測システム.ERB`, `天候管理拡張.ERB`, `日時天候管理.ERB`) was
 * RECLASSIFIED from mod-tier to CORE by user decision — it is now one of
 * the modernization's core systems (`runtime/weather/`, DAY-CYCLE-PLAN
 * §S0b). The former `"ERB/天候"` prefix was therefore removed from this
 * list. The upstream tree has no top-level `天候パッチ` sibling; the only
 * other 天候 file (`魔改内容/qol/qol_天候管理拡張.ERB`) stays mod via the
 * existing `ERB/魔改内容/` prefix.
 *
 * Note: `plugins/`, `resources/`, and `CSV/` are intentionally NOT
 * in this list. They are data sources (see
 * `phase-3-mod-boundary.md` §"Data sources (NOT mod-tier)").
 */
export const MOD_TIER_PREFIXES = [
  "ERB/DLC/",
  "ERB/魔改内容/",
  "ERB/fromEN/",
  "ERB/method_from_eratohoЯeverse/",
  "ERB/潜伏モード関連/",
  "ERB/カラム機能/",
  "ERB/CASINO/",
  "ERB/ビジュアル関連/",
  "bad/",
  "font/",
  "lang/",
  "sound/",
] as const;

/**
 * ERB-relative prefixes of mod-tier content. Same set as
 * `MOD_TIER_PREFIXES` minus the `ERB/` anchor and minus the project-
 * root asset dirs (`bad/`, `font/`, `lang/`, `sound/`) which never
 * appear under `ERB/`.
 *
 * Use this for any `ErbFile.relPath` / `KojoFile.relPath` /
 * `EventMessageEntry.relPath` check (all ERB-relative).
 */
const ERB_RELATIVE_MOD_TIER_PREFIXES = [
  "DLC/",
  "魔改内容/",
  "fromEN/",
  "method_from_eratohoЯeverse/",
  "潜伏モード関連/",
  "カラム機能/",
  "CASINO/",
  "ビジュアル関連/",
  // "天候" removed 2026-07-02 — weather reclassified as core (see
  // MOD_TIER_PREFIXES note above / DAY-CYCLE-PLAN §S0b).
] as const;

/**
 * Test whether a project-root-relative path is mod-tier.
 */
export function isModTierRootPath(p: string): boolean {
  return MOD_TIER_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Test whether an ERB-relative path is mod-tier. This is the check
 * every surviving `ErbFile.relPath` must pass.
 */
export function isModTierErbPath(p: string): boolean {
  return ERB_RELATIVE_MOD_TIER_PREFIXES.some((prefix) =>
    p.startsWith(prefix),
  );
}

/**
 * Derive a `coreScope` value from an ERB-relative path. The result
 * is a structural assertion of "where did this entry actually come
 * from in the upstream tree" — not a hardcode.
 */
export function deriveCoreScopeFromErbPath(p: string): CoreScope {
  return isModTierErbPath(p) ? "mod" : "core";
}
