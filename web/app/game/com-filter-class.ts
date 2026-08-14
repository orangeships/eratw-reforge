/**
 * Parity QA P-1 — command → ComFilterClass resolver (UI side).
 *
 * Faithful to the upstream `IS_COM_*` classifiers (`OPTION_COM_FILTER.ERB:
 * 366-519`). Each returns whether a command belongs to a filter class:
 *   - vagina/anal/service/sm/sekuhara/kaji → `COM_TAGS_CHECK(id, BIT_xxx)`,
 *     i.e. the `command-tags.bundle.json` category (same bit data).
 *   - kojo → range 270-299 (`IS_COM_KOJO`).
 *   - (自慰 `IS_COM_ONANISM` 700-712/740-752/433 exists upstream but its
 *      filter is commented out in `@过滤器表示`:93, so it has no toggle —
 *      we don't classify it, matching the live filter row.)
 *
 * The runtime `quickFilterHidden` (com-filter.ts) consumes this class to
 * decide visibility against the per-target filter CFLAGs. A command with no
 * class → `null` → never filtered (always shown if its gate passes).
 */

import type { ComFilterClass } from "../../../modernization/runtime";
import commandTags from "./command-tags.bundle.json";

/** category code in command-tags.bundle.json → ComFilterClass. */
const CATEGORY_TO_CLASS: Record<string, ComFilterClass> = {
  v: "vagina",
  a: "anal",
  service: "service",
  sm: "sm",
  sekuhara: "sekuhara",
  kaji: "kaji",
};

const TAG_TABLE = commandTags as Record<string, { category?: string }>;

/**
 * Resolve a commandNo to its faithful Act_COM filter class, or `null` if it
 * belongs to no filtered class (always shown). The COM_TAGS category is the
 * authority; 個人口上 custom commands (270-299) are the one range-based class.
 */
export function comFilterClassOf(commandNo: number): ComFilterClass | null {
  // 個人口上 custom commands (IS_COM_KOJO: INRANGE 270-299).
  if (commandNo >= 270 && commandNo <= 299) return "kojo";
  const cat = TAG_TABLE[String(commandNo)]?.category;
  if (cat && CATEGORY_TO_CLASS[cat]) return CATEGORY_TO_CLASS[cat];
  return null;
}
