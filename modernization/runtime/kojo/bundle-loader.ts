/**
 * Phase 6.3 — kojo bundle loader.
 *
 * The committed bundle (`modernization/out/kojo-reimu-bundle.json`)
 * is the runtime's source of truth. In the browser build, we import
 * it directly via `resolveJsonModule`. In Node tests, we read it
 * from disk so the same loader works in both worlds.
 *
 * Future phase: the loader may resolve a chara→bundle map (per-chara
 * `kojo-bundle-index.json`) and lazy-load. For M3, the bundle is a
 * single file loaded eagerly at startup.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { KojoBundle } from "./types.js";

/** Resolve the bundle path relative to this file. Works in both
 *  Node tests and the Vite/TS source build (path arithmetic). */
function defaultBundlePath(): string {
  // .../modernization/runtime/kojo/bundle-loader.ts
  // → .../modernization/out/kojo-reimu-bundle.json
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../out/kojo-reimu-bundle.json");
}

const DEFAULT_PATH = defaultBundlePath();

/** Read and JSON-parse the committed bundle. Throws if the file is
 *  missing (caller is expected to have run `pnpm build:kojo` first). */
export async function loadKojoBundle(
  bundlePath: string = DEFAULT_PATH,
): Promise<KojoBundle> {
  const text = await readFile(bundlePath, "utf-8");
  return JSON.parse(text) as KojoBundle;
}
