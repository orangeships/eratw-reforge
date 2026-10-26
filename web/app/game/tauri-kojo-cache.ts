import { convertFileSrc } from "@tauri-apps/api/core";
import {
  KojoCache,
  type KojoSourceReader,
} from "../../../modernization/runtime/kojo/kojo-cache.js";
import type { KojoAsyncParser } from "../../../modernization/runtime/kojo/async-parser.js";
import { createKojoWorkerClient } from "./kojo-worker-client.js";
import { collectNightKojoFilePaths } from "../../../modernization/runtime/kojo/night-preload.js";
import type { KojoCommandIndex } from "../../../modernization/runtime/kojo/types.js";
import kojoIndexUrl from "./kojo-index.json?url";

export interface TauriKojoCacheOptions {
  /** Absolute, validated path to `口上・メッセージ関連`. */
  kojoRoot: string;
  callNames: Record<number, string>;
  masterName?: string;
}

/** Injectable I/O boundaries for adapter verification and alternate hosts. */
export interface TauriKojoCacheDependencies {
  loadIndex?: () => Promise<KojoCommandIndex>;
  readText?: KojoSourceReader;
  readTextAsync?: (filePath: string, projectRoot: string) => Promise<string>;
  parseAsync?: KojoAsyncParser;
}

const workerDisposers = new Set<() => void>();
if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const dispose of workerDisposers) dispose();
  workerDisposers.clear();
});

function pathSeparator(root: string): "\\" | "/" {
  return root.includes("\\") ? "\\" : "/";
}

function joinProjectPath(root: string, parts: readonly string[]): string {
  const sep = pathSeparator(root);
  const trimmed = root.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}

export function absoluteKojoSourcePath(kojoRoot: string, filePath: string): string {
  return joinProjectPath(kojoRoot, filePath.split(/[\\/]/).filter(Boolean));
}

function readTauriKojoTextSync(filePath: string, kojoRoot: string): string {
  const abs = absoluteKojoSourcePath(kojoRoot, filePath);
  const url = convertFileSrc(abs);
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.overrideMimeType("text/plain; charset=utf-8");
  xhr.send();
  if ((xhr.status < 200 || xhr.status >= 300) && xhr.status !== 0) {
    throw new Error(`read kojo source failed (${xhr.status}): ${filePath}`);
  }
  return xhr.responseText.replace(/^﻿/, "");
}

/**
 * Non-blocking mirror of `readTauriKojoTextSync` — the same asset-protocol
 * URL and UTF-8 decode, but through `fetch` so the main thread keeps
 * painting. Used to warm `KojoCache.sourceCache` before the night
 * settlement needs the files (see `createTauriKojoCacheRouter`).
 */
async function readTauriKojoText(filePath: string, kojoRoot: string): Promise<string> {
  const abs = absoluteKojoSourcePath(kojoRoot, filePath);
  const res = await fetch(convertFileSrc(abs));
  if (!res.ok) {
    throw new Error(`read kojo source failed (${res.status}): ${filePath}`);
  }
  // Decode explicitly: asset:// responses can carry a wrong Content-Type,
  // and the sync XHR path always decodes as UTF-8 (overrideMimeType).
  return (new TextDecoder("utf-8").decode(await res.arrayBuffer())).replace(/^﻿/, "");
}

async function loadKojoIndex(): Promise<KojoCommandIndex> {
  const res = await fetch(kojoIndexUrl);
  if (!res.ok) {
    throw new Error(`load kojo index failed (${res.status})`);
  }
  return await res.json() as KojoCommandIndex;
}

/** Resolves when the most recent router's night/morning source preload has
 *  settled. Never rejects — settlement falls back to the sync reader when
 *  the gate times out or a file failed to load. */
let nightSourcesGate: Promise<void> = Promise.resolve();

export async function ensureNightSourcesPreloaded(): Promise<void> {
  await nightSourcesGate;
}

export async function createTauriKojoCacheRouter(
  opts: TauriKojoCacheOptions,
  deps: TauriKojoCacheDependencies = {},
): Promise<KojoCache> {
  const index = await (deps.loadIndex ?? loadKojoIndex)();
  const compiler = !deps.parseAsync && typeof Worker !== "undefined"
    ? createKojoWorkerClient((filePath) => convertFileSrc(absoluteKojoSourcePath(opts.kojoRoot, filePath)))
    : null;
  if (compiler) workerDisposers.add(compiler.dispose);
  const cache = new KojoCache(index, opts.kojoRoot, {
    nameResolver: (charaNum) => opts.callNames[charaNum],
    masterName: opts.masterName,
    readText: deps.readText ?? readTauriKojoTextSync,
    readTextAsync: deps.readTextAsync ?? readTauriKojoText,
    parseAsync: deps.parseAsync ?? compiler?.parse,
  });
  // Fire-and-forget warmup of every ERB file the night/morning settlement
  // will resolve (~256 files): the first night used to freeze the frame on
  // one blocking sync XHR per cold file.
  nightSourcesGate = (async () => {
    try {
      await cache.preloadSources(collectNightKojoFilePaths(index));
    } catch {
      // Per-file failures are already swallowed inside preloadSources; a
      // catastrophic failure keeps the sync-reader fallback intact.
    }
  })();
  return cache;
}
