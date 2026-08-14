/**
 * Phase 6D — Node-side KojoCache bootstrap.
 *
 * Assembles a ready-to-wire `KojoCache` from the on-disk artifacts:
 *   - `out/kojo-index.json` (built by `build-kojo-index.ts`)
 *   - `web/app/game/charas.bundle.json` (for the `charaNum → callName` map)
 *   - the eraTW ERB subtree (read lazily by `KojoCache` at first hit)
 *
 * **Node-only** (uses `node:fs`). Deliberately NOT re-exported from the
 * browser-facing barrels (`runtime/index.ts`, `runtime/kojo/index.ts`)
 * so a Vite build of the in-browser runtime never pulls these file
 * reads. The browser wiring (async IPC slice) is a tracked follow-up;
 * for now App.tsx keeps its bundle-backed router. This factory serves
 * the Node runtime (end-to-end tests today, a Tauri/Node entry later).
 *
 * Usage:
 *   const { cache, callNames } = createKojoRuntime();
 *   configureIntent({ catalog, dialogueRouter: cache, callNames });
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KojoCache } from "./kojo-cache.js";
import type { KojoCommandIndex } from "./types.js";

// .../modernization/runtime/kojo/node-index.ts
const here = dirname(fileURLToPath(import.meta.url));

/** ERB files are under this subdirectory relative to project root. */
const KOJO_SUBDIR = ["ERB", "口上・メッセージ関連"];

/** Default `kojo-index.json` path (build output under `modernization/out`). */
export function defaultIndexPath(): string {
  return resolve(here, "../../out/kojo-index.json");
}

/** Default eraTW project root (the upstream subtree at the repo root). */
export function defaultProjectRoot(): string {
  return resolve(here, "../../../eratw-sub-modding-main");
}

/** Default `charas.bundle.json` path (the committed chara stat bundle). */
export function defaultCharasBundlePath(): string {
  return resolve(here, "../../../web/app/game/charas.bundle.json");
}

/** Read + JSON-parse the kojo command index. Throws if missing. */
export function loadKojoCommandIndex(indexPath: string = defaultIndexPath()): KojoCommandIndex {
  return JSON.parse(readFileSync(indexPath, "utf-8")) as KojoCommandIndex;
}

/**
 * Node implementation of KojoCache's synchronous source reader. Reads the ERB
 * file at `filePath` (relative to `ERB/口上・メッセージ関連/`) and strips UTF-8 BOM.
 */
export function readNodeKojoTextSync(filePath: string, projectRoot: string): string {
  const fullPath = join(projectRoot, ...KOJO_SUBDIR, ...filePath.split(/[\\/]/));
  const buf = readFileSync(fullPath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf-8", 3);
  }
  return buf.toString("utf-8");
}

/** Structural view of one `charas.bundle.json` entry (callName only). */
interface CharaBundleEntry { callName?: string; name?: string }

/** Build a `charaNum → callName` map from a parsed `charas.bundle.json`. */
export function buildCallNameMap(bundle: Record<string, CharaBundleEntry>): Record<number, string> {
  const map: Record<number, string> = {};
  for (const [k, v] of Object.entries(bundle)) {
    const n = Number(k);
    const name = v?.callName ?? v?.name;
    if (Number.isFinite(n) && name) map[n] = name;
  }
  return map;
}

export interface CreateKojoRuntimeOptions {
  indexPath?: string;
  /** Override the ERB project root. Defaults to the index's baked root
   *  if it still exists on disk, else the repo-relative subtree. */
  projectRoot?: string;
  charasBundlePath?: string;
  masterName?: string;
}

export interface KojoRuntime {
  cache: KojoCache;
  callNames: Record<number, string>;
}

/**
 * Load the index + chara names and construct a wired `KojoCache`. The
 * returned `callNames` map should also be passed to `configureIntent`
 * so handler NARRATION text resolves the same names.
 */
export function createKojoRuntime(opts: CreateKojoRuntimeOptions = {}): KojoRuntime {
  const index = loadKojoCommandIndex(opts.indexPath);

  // Prefer an explicit root, then the repo-relative subtree, then the
  // index's baked (build-machine) absolute path — whichever exists.
  const repoRoot = defaultProjectRoot();
  const projectRoot =
    opts.projectRoot ??
    (existsSync(repoRoot) ? repoRoot : index.projectRoot ?? repoRoot);

  let callNames: Record<number, string> = {};
  try {
    const charasPath = opts.charasBundlePath ?? defaultCharasBundlePath();
    callNames = buildCallNameMap(
      JSON.parse(readFileSync(charasPath, "utf-8")) as Record<string, CharaBundleEntry>,
    );
  } catch {
    /* names are optional — fall back to "对方" inside the cache */
  }

  const cache = new KojoCache(index, projectRoot, {
    nameResolver: (n) => callNames[n],
    masterName: opts.masterName,
    readText: readNodeKojoTextSync,
  });
  return { cache, callNames };
}
