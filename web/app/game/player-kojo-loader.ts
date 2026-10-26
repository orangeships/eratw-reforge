import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import {
  createBrowserKojoRouter,
  type BrowserKojoBundle,
  type BrowserKojoChara,
} from "./kojo-router.js";

interface KojoChunkManifest {
  version: 1;
  charas: Record<string, { callName?: string }>;
}

export interface PlayerKojoChunkRuntime {
  router: DialogueRouter;
  preloadForState: (state: Readonly<GameState>) => Promise<void>;
  preloadForLocations: (
    state: Readonly<GameState>,
    locations: readonly string[],
  ) => Promise<void>;
}

export interface PlayerKojoChunkRuntimeOptions {
  fetchImpl?: typeof fetch;
  moduleUrl?: string;
  /**
   * Upper bound on simultaneously parsed character chunks. The chunks are
   * 2–10 MiB of JSON each, so an unbounded fan-out trades a latency stall for
   * a heap spike and a much worse major-GC pause right after. 4 keeps the
   * network/parse pipeline busy without letting a 25-resident region warm
   * allocate 50 MiB at once.
   */
  maxConcurrentFetches?: number;
  /**
   * Upper bound on parsed chunks kept resident in the router's bundle.
   * Everything ever visited used to stay forever, so a long session grew
   * toward the full 253 MiB asset set and every later interaction paid major
   * GC for it. Chunks are evicted least-recently-used first; characters in
   * the current room (and the active training / walk targets) are pinned and
   * never evicted.
   */
  maxResidentChunks?: number;
}

/** Defaults tuned against the shipped chunk set (125 files, 253.5 MiB). */
export const DEFAULT_MAX_CONCURRENT_FETCHES = 4;
export const DEFAULT_MAX_RESIDENT_CHUNKS = 16;

function addChara(set: Set<number>, value: number | undefined): void {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    set.add(value);
  }
}

/**
 * Keep the mobile renderer bounded by selecting only characters that can
 * speak synchronously in the current room or an already-pending interaction.
 * Agent `activeRoster` and save-wide `selectedKojoVariants` are metadata, not
 * reasons to download those characters' multi-megabyte chunks at startup.
 */
export function kojoCharaNumsForState(state: Readonly<GameState>): number[] {
  const ids = new Set<number>();
  const masterLocation = state.master.location;

  for (const [charaNum, chara] of Object.entries(state.charas)) {
    if (chara.location === masterLocation) addChara(ids, Number(charaNum));
  }
  addChara(ids, state.training?.target);
  addChara(ids, state.walkSession?.encounter?.charaNum);
  addChara(ids, state.walkSession?.lockedDoor?.ownerCharaNum);

  return [...ids].sort((a, b) => a - b);
}

export function kojoCharaNumsForLocations(
  state: Readonly<GameState>,
  locations: readonly string[],
): number[] {
  const wanted = new Set(locations);
  return Object.entries(state.charas)
    .filter(([, chara]) => wanted.has(chara.location))
    .map(([charaNum]) => Number(charaNum))
    .filter((charaNum) => Number.isInteger(charaNum) && charaNum > 0)
    .sort((left, right) => left - right);
}

/** Resolve beside the built loader chunk instead of the current document URL.
 * This remains correct for subdirectory hosting, SPA fallback URLs and the
 * packaged `file://` player. */
export function playerKojoAssetUrl(fileName: string, moduleUrl = import.meta.url): string {
  return new URL(fileName, new URL("../kojo-chunks/", moduleUrl)).href;
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`kojo asset fetch ${response.status}: ${url}`);
  return await response.json() as T;
}

/** Create a synchronous router backed by a small, incrementally filled bundle. */
export async function createPlayerKojoChunkRuntime(
  options: PlayerKojoChunkRuntimeOptions = {},
): Promise<PlayerKojoChunkRuntime> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const maxConcurrent = Math.max(
    1,
    options.maxConcurrentFetches ?? DEFAULT_MAX_CONCURRENT_FETCHES,
  );
  const maxResident = Math.max(
    1,
    options.maxResidentChunks ?? DEFAULT_MAX_RESIDENT_CHUNKS,
  );
  const manifest = await fetchJson<KojoChunkManifest>(
    playerKojoAssetUrl("index.json", moduleUrl),
    fetchImpl,
  );
  if (manifest.version !== 1 || !manifest.charas || typeof manifest.charas !== "object") {
    throw new Error("invalid kojo chunk manifest");
  }

  const bundle: BrowserKojoBundle = { byChara: {} };
  const loaded = new Set<number>();
  const loading = new Map<number, Promise<void>>();
  /** Characters that must stay resident: current room + active interactions. */
  const pinned = new Set<number>();
  /** Least-recently-used first; every load/serve moves a chara to the tail. */
  const lru: number[] = [];
  const router = createBrowserKojoRouter(bundle);

  const touch = (charaNum: number): void => {
    const at = lru.indexOf(charaNum);
    if (at !== -1) lru.splice(at, 1);
    lru.push(charaNum);
  };

  const evictIfNeeded = (): void => {
    while (loaded.size > maxResident) {
      const victim = lru.find((charaNum) => !pinned.has(charaNum) && !loading.has(charaNum));
      if (victim === undefined) return; // everything left is pinned or in flight
      const at = lru.indexOf(victim);
      if (at !== -1) lru.splice(at, 1);
      loaded.delete(victim);
      delete bundle.byChara[String(victim)];
    }
  };

  const loadChara = (charaNum: number): Promise<void> => {
    const existing = loading.get(charaNum);
    if (existing) return existing;
    const pending = fetchJson<BrowserKojoChara>(
      playerKojoAssetUrl(`${charaNum}.json`, moduleUrl),
      fetchImpl,
    )
      .then((chara) => {
        bundle.byChara[String(charaNum)] = chara;
        loaded.add(charaNum);
        touch(charaNum);
      })
      .finally(() => loading.delete(charaNum));
    loading.set(charaNum, pending);
    return pending;
  };

  /**
   * Fetch every requested chunk with bounded concurrency. The previous
   * implementation awaited one chunk at a time, so a three-character room
   * serialized three multi-megabyte reads and parses — the dominant source of
   * the "movement takes one to two seconds" stall, because every move awaits
   * this before the command is allowed to settle.
   */
  const preloadCharaNums = async (charaNums: readonly number[]): Promise<void> => {
    const wanted = charaNums.filter((charaNum) =>
      !loaded.has(charaNum) && !!manifest.charas[String(charaNum)]);
    if (wanted.length === 0) return;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= wanted.length) return;
        await loadChara(wanted[index]!);
        evictIfNeeded();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(maxConcurrent, wanted.length) }, worker),
    );
  };

  const preloadFor = (
    charaNums: readonly number[],
  ): Promise<void> => {
    pinned.clear();
    for (const charaNum of charaNums) pinned.add(charaNum);
    return preloadCharaNums(charaNums);
  };

  return {
    router,
    async preloadForState(state) {
      await preloadFor(kojoCharaNumsForState(state));
    },
    async preloadForLocations(state, locations) {
      await preloadFor(kojoCharaNumsForLocations(state, locations));
    },
  };
}
