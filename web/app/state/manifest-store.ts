import { create } from "zustand";
import {
  getManifest,
  type ManifestEnvelope,
  type ManifestName,
  type ManifestRebuiltEvent,
  type ManifestErrorEvent,
} from "../ipc/tauri-studio-bridge";

/**
 * Phase 2.1+2.2+2.3+2.3-kojo+2.4 manifest store.
 *
 * Caches the nine JSON manifests produced by `pnpm build-manifests`. The
 * Data Browser and Resource Preview read from this store instead of
 * invoking Rust on every tab switch, so flipping between them is instant
 * after the initial load.
 *
 * Re-fetches whenever `projectRoot` changes — manifests are tied to a
 * specific eraTW tree.
 *
 * Phase 2.4 adds a `watchStatus` slot fed by the `manifest://rebuilt` and
 * `manifest://error` events from the Rust fs watcher. SyncStatusPill
 * subscribes to this to render the green/yellow/red indicator.
 */

export type WatchStatus = "idle" | "synced" | "rebuilding" | "error";

interface ManifestState {
  projectRoot: string | null;
  variableSizes: ManifestEnvelope | null;
  characters: ManifestEnvelope | null;
  flags: ManifestEnvelope | null;
  resources: ManifestEnvelope | null;
  pluginDicts: ManifestEnvelope | null;
  functions: ManifestEnvelope | null;
  commands: ManifestEnvelope | null;
  kojos: ManifestEnvelope | null;
  eventMessages: ManifestEnvelope | null;
  loading: boolean;
  error: string | null;

  // Phase 2.4 — fs watcher status
  watchStatus: WatchStatus;
  lastRebuiltAt: number | null; // unix-ms of last successful rebuild
  lastDurationMs: number | null;
  watchError: string | null; // stderr tail of the last failed rebuild, if any

  /** Fetch all nine manifests for `projectRoot` (overwrites cache). */
  loadAll: (projectRoot: string) => Promise<void>;
  /** Drop the cache (e.g. when the user clears their project). */
  reset: () => void;
  /** Phase 2.4 — start a "rebuilding" state. Called by the App on each rebuild cycle. */
  setStatus: (status: WatchStatus, opts?: { durationMs?: number; error?: string }) => void;
  /** Phase 2.4 — handler for `manifest://rebuilt` events. */
  onRebuilt: (event: ManifestRebuiltEvent) => Promise<void>;
  /** Phase 2.4 — handler for `manifest://error` events. */
  onError: (event: ManifestErrorEvent) => void;
}

const MANIFEST_NAMES: ManifestName[] = [
  "variable-sizes",
  "characters",
  "flags",
  "resources",
  "plugin-dicts",
  "functions",
  "commands",
  "kojos",
  "event-messages",
];

type EnvelopeKey = Exclude<
  keyof ManifestState,
  | "projectRoot"
  | "loading"
  | "error"
  | "watchStatus"
  | "lastRebuiltAt"
  | "lastDurationMs"
  | "watchError"
  | "loadAll"
  | "reset"
  | "setStatus"
  | "onRebuilt"
  | "onError"
>;

function keyFor(name: ManifestName): EnvelopeKey {
  switch (name) {
    case "variable-sizes": return "variableSizes";
    case "characters": return "characters";
    case "flags": return "flags";
    case "resources": return "resources";
    case "plugin-dicts": return "pluginDicts";
    case "functions": return "functions";
    case "commands": return "commands";
    case "kojos": return "kojos";
    case "event-messages": return "eventMessages";
  }
}

function emptyEnvelopes(): Pick<
  ManifestState,
  "variableSizes" | "characters" | "flags" | "resources" | "pluginDicts" | "functions" | "commands" | "kojos" | "eventMessages"
> {
  return {
    variableSizes: null,
    characters: null,
    flags: null,
    resources: null,
    pluginDicts: null,
    functions: null,
    commands: null,
    kojos: null,
    eventMessages: null,
  };
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  projectRoot: null,
  ...emptyEnvelopes(),
  loading: false,
  error: null,
  watchStatus: "idle",
  lastRebuiltAt: null,
  lastDurationMs: null,
  watchError: null,

  async loadAll(projectRoot) {
    set({ loading: true, error: null, projectRoot });
    try {
      const envelopes = await Promise.all(
        MANIFEST_NAMES.map((name) => getManifest(projectRoot, name)),
      );
      const next: Partial<ManifestState> = { loading: false, error: null };
      envelopes.forEach((env, i) => {
        (next as Record<string, unknown>)[keyFor(MANIFEST_NAMES[i])] = env;
      });
      set(next as ManifestState);
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  reset() {
    set({
      projectRoot: null,
      ...emptyEnvelopes(),
      error: null,
      watchStatus: "idle",
      lastRebuiltAt: null,
      lastDurationMs: null,
      watchError: null,
    });
  },

  setStatus(status, opts) {
    set({
      watchStatus: status,
      lastDurationMs: opts?.durationMs ?? get().lastDurationMs,
      watchError: opts?.error ?? (status === "error" ? get().watchError : null),
    });
  },

  async onRebuilt(event) {
    // Refetch all 9 manifests (cheap — same code path as loadAll).
    const projectRoot = event.projectRoot;
    if (!projectRoot) return;
    if (get().projectRoot !== projectRoot) return; // user switched projects; ignore
    set({ watchStatus: "rebuilding", watchError: null });
    try {
      const envelopes = await Promise.all(
        MANIFEST_NAMES.map((name) => getManifest(projectRoot, name)),
      );
      const next: Partial<ManifestState> = {
        loading: false,
        error: null,
        watchStatus: "synced",
        lastRebuiltAt: Date.now(),
        lastDurationMs: event.durationMs,
      };
      envelopes.forEach((env, i) => {
        (next as Record<string, unknown>)[keyFor(MANIFEST_NAMES[i])] = env;
      });
      set(next as ManifestState);
    } catch (e) {
      // Refetch itself failed (very unusual; the rebuild wrote JSONs successfully).
      // Surface it but don't claim the rebuild was the failure.
      set({
        watchStatus: "error",
        watchError: `refetch failed after rebuild: ${String(e)}`,
        loading: false,
      });
    }
  },

  onError(event) {
    set({
      watchStatus: "error",
      watchError: event.message,
    });
  },
}));
