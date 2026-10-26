/**
 * Interactive-surface kojo source preload set.
 *
 * `night-preload.ts` warms the night/morning surfaces so the deterministic
 * sleep settlement stops paying one blocking sync read per cold file. It
 * deliberately stops there: warming every file in the index up front is ~1248
 * further files of I/O for a checkout-sized source tree, which is the wrong
 * trade at boot.
 *
 * The consequence in the Tauri dev shell was that the surface the player uses
 * *most* — `commands`, i.e. 日常系コマンド — stayed cold. First touch of a
 * character's command file went through `readTauriKojoTextSync`, a
 * **synchronous** XHR that blocks the WebView main thread, on files that reach
 * 2.3 MiB (`M_KOJO_K58_1_日常系コマンド.ERB`). That is the "clicking anything
 * freezes for a beat" behaviour, and it is invisible in the Node runtime
 * because `readNodeKojoTextSync` is a cheap warm-page-cache `readFileSync`.
 *
 * This module answers the narrower question instead: *given the characters the
 * player can actually interact with right now, which files can they touch?*
 * `VariantIndex.files` is exactly that set — the files the index generator
 * actually scanned for that character/variant — so warming it is a few files
 * per in-room character instead of the whole tree, and it happens through the
 * non-blocking async reader.
 */

import type { KojoCommandIndex } from "./types.js";

/**
 * Every ERB source file backing the given characters' personal kojo, across
 * all their variants (the active variant depends on live `CFLAG:口上セレクタ`
 * state, so the union is the only safe set). Deduplicated and stable-ordered.
 */
export function collectCharaKojoFilePaths(
  index: Readonly<KojoCommandIndex>,
  charaNums: readonly number[],
): string[] {
  const out = new Set<string>();
  for (const charaNum of charaNums) {
    for (const variant of index.variants[charaNum] ?? []) {
      for (const filePath of variant.files ?? []) out.add(filePath);
    }
  }
  return [...out];
}

/** The characters whose kojo the player can reach without leaving the room. */
export function presentCharaNumsForWarming(
  masterLocation: string,
  charas: Readonly<Record<string, { location: string }>>,
  extra: readonly number[] = [],
): number[] {
  const ids = new Set<number>();
  for (const [rawCharaNum, chara] of Object.entries(charas ?? {})) {
    if (chara.location !== masterLocation) continue;
    const charaNum = Number(rawCharaNum);
    if (Number.isInteger(charaNum) && charaNum > 0) ids.add(charaNum);
  }
  for (const charaNum of extra) {
    if (Number.isInteger(charaNum) && charaNum > 0) ids.add(charaNum);
  }
  return [...ids].sort((left, right) => left - right);
}
