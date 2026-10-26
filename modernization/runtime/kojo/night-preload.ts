/**
 * Night/morning kojo source preload set.
 *
 * `finishSleepAction`'s deterministic settlement sweeps the whole roster's
 * night/morning kojo surfaces (DAYEVENT conditions, arm 31 呢喃, ONANISM
 * palams, the five diary hooks, fall-state arms 21/34, arm 2/3 greetings —
 * see `command/handlers/sleep.ts`). First touch of each ERB file goes through
 * the injected source reader; in the Tauri renderer that is a blocking sync
 * XHR, so ~256 cold first-touch reads used to freeze the night-settlement
 * frame for seconds. `collectNightKojoFilePaths` enumerates exactly those
 * files from the index so the adapter can warm `KojoCache.sourceCache`
 * asynchronously ahead of time (`KojoCache.preloadSources`).
 *
 * Deliberately EXCLUDED: `commands`, `catchAll`, `counters`, `mark`, `irai` —
 * daytime interaction surfaces, each a single first-touch read when the
 * player actually uses them. The preload set stays bounded (~256 files across
 * all 155 characters) instead of the full 1776-file index.
 */

import type { KojoCommandIndex, VariantIndex } from "./types.js";

function collectVariantFiles(variant: VariantIndex, out: Set<string>): void {
  if (variant.dayEventCondition) out.add(variant.dayEventCondition.filePath);
  if (variant.iraiBlocked) out.add(variant.iraiBlocked.filePath);
  if (variant.encounter) out.add(variant.encounter.filePath);
  if (variant.roomDescription) out.add(variant.roomDescription.filePath);
  if (variant.update) out.add(variant.update.filePath);
  if (variant.diaryExist) out.add(variant.diaryExist.filePath);
  if (variant.diaryBeforeCheck) out.add(variant.diaryBeforeCheck.filePath);
  if (variant.diaryAfterCheck) out.add(variant.diaryAfterCheck.filePath);
  for (const loc of Object.values(variant.events ?? {})) out.add(loc.filePath);
  for (const loc of Object.values(variant.dailyEvents ?? {})) out.add(loc.filePath);
  for (const loc of Object.values(variant.spEvents ?? {})) out.add(loc.filePath);
  for (const loc of Object.values(variant.palams ?? {})) out.add(loc.filePath);
  for (const loc of Object.values(variant.diaryText ?? {})) out.add(loc.filePath);
  for (const loc of Object.values(variant.diaryHappens ?? {})) out.add(loc.filePath);
}

/**
 * Union of ERB source files the night/morning settlement can resolve,
 * across every character and variant (the active variant depends on live
 * CFLAG:998 state, so the whole union is warmed). Deduplicated.
 */
export function collectNightKojoFilePaths(index: Readonly<KojoCommandIndex>): string[] {
  const out = new Set<string>();
  for (const variants of Object.values(index.variants)) {
    for (const variant of variants) collectVariantFiles(variant, out);
  }
  return [...out];
}
