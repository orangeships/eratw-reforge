import { convertFileSrc } from "@tauri-apps/api/core";
import {
  KojoCache,
  type KojoSourceReader,
} from "../../../modernization/runtime/kojo/kojo-cache.js";
import type {
  DialogueRouter,
  KojoCommandIndex,
} from "../../../modernization/runtime/kojo/types.js";
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
}

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
  return xhr.responseText.replace(/^\uFEFF/, "");
}

async function loadKojoIndex(): Promise<KojoCommandIndex> {
  const res = await fetch(kojoIndexUrl);
  if (!res.ok) {
    throw new Error(`load kojo index failed (${res.status})`);
  }
  return await res.json() as KojoCommandIndex;
}

export async function createTauriKojoCacheRouter(
  opts: TauriKojoCacheOptions,
  deps: TauriKojoCacheDependencies = {},
): Promise<DialogueRouter> {
  const index = await (deps.loadIndex ?? loadKojoIndex)();
  return new KojoCache(index, opts.kojoRoot, {
    nameResolver: (charaNum) => opts.callNames[charaNum],
    masterName: opts.masterName,
    readText: deps.readText ?? readTauriKojoTextSync,
  });
}
