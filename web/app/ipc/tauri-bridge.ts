import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Phase 1 + 2.2 + 2.4 IPC bridge.
 *
 * All calls go through Tauri `invoke`. Frontend NEVER touches the FS directly;
 * Rust is the only side that may stat / open / read the project tree.
 */

export interface ProjectValidation {
  path: string;
  hasErb: boolean;
  hasCsv: boolean;
  hasEmueraConfig: boolean;
  isValid: boolean;
  missing: string[];
}

export interface KojoSourceValidation {
  path: string;
  kojoRoot: string | null;
  layout: "project-root" | "erb-directory" | "kojo-directory" | null;
  isValid: boolean;
  error: string | null;
}

/**
 * Liveness check. Returns `"pong-<unix-millis>"`.
 * Called once on app boot to confirm the Rust ↔ JS IPC channel works.
 */
export async function ping(): Promise<string> {
  return await invoke<string>("ping");
}

/**
 * Validate that a directory is an eraTW project root.
 * Returns which of {ERB/, CSV/, emuera.config} are present and which are missing.
 *
 * Does NOT recurse, does NOT read CSV/ERB contents — pure stat() over the
 * three well-known paths.
 */
export async function validateProject(path: string): Promise<ProjectValidation> {
  return await invoke<ProjectValidation>("validate_project_path", { path });
}

/**
 * Open a native folder picker and return the chosen absolute path (or null).
 * Uses the Tauri dialog plugin. Lazy-imported so the bundle stays small.
 */
export async function pickProjectDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    directory: true,
    multiple: false,
    title: "选择 eraTW 项目根目录",
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result ?? null;
}

/** Select the original eraTW project, ERB directory, or Kojo directory. */
export async function pickKojoSourceDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    directory: true,
    multiple: false,
    title: "选择原版 eraTW 项目或口上目录",
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result ?? null;
}

export async function validateKojoSource(path: string): Promise<KojoSourceValidation> {
  return await invoke<KojoSourceValidation>("validate_kojo_source_path", { path });
}

/**
 * Phase 2.1+2.2+2.3 — read a pre-generated JSON manifest from disk via Rust.
 *
 * Rust resolves `<projectRoot>/../modernization/out/<name>.json`. The build
 * script (`pnpm build-manifests`) is what produces those JSON files; the
 * Rust side never parses CSV / XML / ERB itself.
 *
 * Valid manifest names: `variable-sizes`, `characters`, `flags` (Phase 2.1)
 * + `resources`, `plugin-dicts` (Phase 2.2)
 * + `functions`, `commands` (Phase 2.3)
 * + `kojos`, `event-messages` (Phase 2.3-kojo).
 * Anything else returns an error from the Rust side (path-traversal guard).
 */
export type ManifestName =
  | "variable-sizes"
  | "characters"
  | "flags"
  | "resources"
  | "plugin-dicts"
  | "functions"
  | "commands"
  | "kojos"
  | "event-messages";

export interface ManifestEnvelope {
  name: ManifestName;
  path: string;
  data: unknown; // typed by the caller per-manifest
}

export async function getManifest(
  projectRoot: string,
  name: ManifestName,
): Promise<ManifestEnvelope> {
  return await invoke<ManifestEnvelope>("get_manifest", {
    projectRoot,
    name,
  });
}

/**
 * Phase 2.2 — ask Rust to allow `<projectRoot>/resources` in the `asset://`
 * protocol scope. The renderer needs this before it can render
 * `<img src={convertFileSrc(absolutePath)} />` for sprite images.
 *
 * Idempotent on the Rust side: calling twice with the same root is a no-op.
 * Returns the absolute resources directory path (handy for building
 * `convertFileSrc` URLs).
 */
export async function addAssetScope(projectRoot: string): Promise<string> {
  return await invoke<string>("add_asset_scope", { projectRoot });
}

/**
 * Register `<projectRoot>/ERB/口上・メッセージ関連` for `asset://` access.
 * Local/Tauri play uses this so KojoCache can synchronously fetch original
 * ERB files on demand instead of bundling all parsed口上 into the frontend.
 */
export async function addKojoSourceScope(sourcePath: string): Promise<string> {
  return await invoke<string>("add_kojo_source_scope", { sourcePath });
}

/**
 * Phase 2.4 — start watching `<projectRoot>/{CSV,ERB,resources}` for changes.
 * On any fs event Rust spawns `node build-manifests.mjs` to rebuild manifests,
 * then emits either `manifest://rebuilt` or `manifest://error` (subscribe via
 * {@link onManifestRebuilt} / {@link onManifestError}).
 *
 * Idempotent: calling twice swaps the watcher. Throws on non-directory roots.
 */
export async function startWatch(projectRoot: string): Promise<void> {
  await invoke<void>("start_watch", { projectRoot });
}

/**
 * Phase 2.4 — tear down the active watcher. Idempotent.
 */
export async function stopWatch(): Promise<void> {
  await invoke<void>("stop_watch");
}

/**
 * Phase 2.4 — payload of a `manifest://rebuilt` event. Emitted after a
 * successful `pnpm build-manifests` run triggered by a fs event.
 */
export interface ManifestRebuiltEvent {
  projectRoot: string;
  generatedAt: string; // ISO 8601 UTC
  durationMs: number;
  manifestCount: number; // always 9 for now
}

/**
 * Phase 2.4 — payload of a `manifest://error` event. Emitted when a rebuild
 * fails (bad CSV, missing node, …) or when the notify watcher itself errors.
 */
export interface ManifestErrorEvent {
  projectRoot: string;
  phase: "watch" | "rebuild" | "spawn";
  message: string; // stderr tail (~2KB max) for rebuild/ spawn, or notify message for watch
  exitCode: number | null;
}

/**
 * Subscribe to "manifest://rebuilt" events. Returns an unlisten function —
 * call it on component unmount to avoid leaks. The handler runs in Tauri's
 * IPC event loop, NOT in a React render phase.
 */
export async function onManifestRebuilt(
  handler: (event: ManifestRebuiltEvent) => void,
): Promise<UnlistenFn> {
  return await listen<ManifestRebuiltEvent>("manifest://rebuilt", (e) => {
    handler(e.payload);
  });
}

/**
 * Subscribe to "manifest://error" events. See {@link onManifestRebuilt}.
 */
export async function onManifestError(
  handler: (event: ManifestErrorEvent) => void,
): Promise<UnlistenFn> {
  return await listen<ManifestErrorEvent>("manifest://error", (e) => {
    handler(e.payload);
  });
}

// =====================================================================
// Phase 4 — GameState persistence (save_state / load_state)
//
// Multi-slot (2026-07-05): three manual save slots. Each slot is a
// distinct backend file/localStorage key derived by suffixing the base
// project key, so slot 1 stays byte-compatible with the legacy single
// save (`::slot2` / `::slot3` for the others). The persisted payload is a
// `StateEnvelope` carrying `savedAt` + a lightweight `summary` (day /
// place / name) so the SAVE/LOAD page can label a slot without
// deserializing the whole GameState, and「继续游戏」can pick the most
// recent slot. Load is envelope-aware but falls back to a raw legacy
// state object so pre-envelope Tauri saves still load.
// =====================================================================

const LOCAL_STATE_PREFIX = "eratw:game-state:";

/** The three manual save slots. Slot 1 == legacy single-save key. */
export type SaveSlot = 1 | 2 | 3;
export const SAVE_SLOTS: readonly SaveSlot[] = [1, 2, 3] as const;

/** One-line label for a slot, faithful to eraTW `@createSaveInfo`
 *  (INFO.ERB:260): 第N日 · 地点 · 主角名. Stored with the save so the
 *  LOAD page can show it cheaply. */
export interface SaveSummary {
  day: number; // 1-based day (time.dayIndex + 1)
  place: string; // master.location
  name: string; // master.callName
}

interface StateEnvelope {
  version: 1;
  savedAt: number;
  summary?: SaveSummary;
  state: unknown;
}

export interface SlotInfo {
  slot: SaveSlot;
  exists: boolean;
  savedAt: number | null;
  summary: SaveSummary | null;
}

export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function useLocalStateStore(): boolean {
  return typeof window !== "undefined" && !hasTauriRuntime();
}

/** Slot 1 keeps the base key (legacy compat); 2/3 get a `::slotN` suffix.
 *  Used both as the Tauri `projectRoot` (Rust hashes it into a filename)
 *  and inside the localStorage key, so the two backends stay in lockstep. */
function slotProjectRoot(baseKey: string, slot: SaveSlot): string {
  return slot === 1 ? baseKey : `${baseKey}::slot${slot}`;
}

function localStateKey(projectRoot: string): string {
  return `${LOCAL_STATE_PREFIX}${encodeURIComponent(projectRoot)}`;
}

/** Unwrap a loaded value into an envelope. A raw (pre-envelope) state
 *  object — no `.state`/`.savedAt` — is wrapped as a version-0 envelope so
 *  legacy Tauri/localStorage saves still load (savedAt 0, no summary). */
function toEnvelope(loaded: unknown): StateEnvelope | null {
  if (loaded === null || loaded === undefined) return null;
  if (
    typeof loaded === "object" &&
    "state" in loaded &&
    "savedAt" in loaded &&
    typeof (loaded as Partial<StateEnvelope>).savedAt === "number"
  ) {
    return loaded as StateEnvelope;
  }
  return { version: 1, savedAt: 0, state: loaded };
}

function parseLocalEnvelope(raw: string | null): StateEnvelope | null {
  if (!raw) return null;
  try {
    return toEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Persist a `GameState` to a specific save slot. `summary` is the cheap
 * label (day/place/name) shown on the LOAD page. The state must be a
 * JSON-safe object (no Map / Set / Date / class instances); see
 * `modernization/runtime/state/game-state.ts` for the contract.
 */
export async function saveState(
  baseKey: string,
  slot: SaveSlot,
  state: unknown,
  summary?: SaveSummary,
): Promise<void> {
  const projectRoot = slotProjectRoot(baseKey, slot);
  const envelope: StateEnvelope = { version: 1, savedAt: Date.now(), summary, state };
  if (useLocalStateStore()) {
    window.localStorage.setItem(localStateKey(projectRoot), JSON.stringify(envelope));
    return;
  }
  // Rust round-trips the envelope JSON verbatim (it only hashes projectRoot
  // into a filename), so no Rust change is needed for slots or summary.
  await invoke<void>("save_state", { projectRoot, state: envelope });
}

/**
 * Load a persisted `GameState` from a slot. Returns `null` if the slot is
 * empty. The caller should still validate the shape before going live.
 */
export async function loadState(
  baseKey: string,
  slot: SaveSlot,
): Promise<unknown | null> {
  const projectRoot = slotProjectRoot(baseKey, slot);
  if (useLocalStateStore()) {
    return parseLocalEnvelope(window.localStorage.getItem(localStateKey(projectRoot)))?.state ?? null;
  }
  const loaded = await invoke<unknown | null>("load_state", { projectRoot });
  return toEnvelope(loaded)?.state ?? null;
}

/** Slot metadata for the SAVE/LOAD page: existence + savedAt + summary. */
export async function slotInfo(baseKey: string, slot: SaveSlot): Promise<SlotInfo> {
  const projectRoot = slotProjectRoot(baseKey, slot);
  let env: StateEnvelope | null;
  if (useLocalStateStore()) {
    env = parseLocalEnvelope(window.localStorage.getItem(localStateKey(projectRoot)));
  } else {
    env = toEnvelope(await invoke<unknown | null>("load_state", { projectRoot }));
  }
  return {
    slot,
    exists: env !== null,
    savedAt: env && env.savedAt > 0 ? env.savedAt : null,
    summary: env?.summary ?? null,
  };
}

/** All three slots' metadata, slot order. */
export async function listSaveSlots(baseKey: string): Promise<SlotInfo[]> {
  return Promise.all(SAVE_SLOTS.map((slot) => slotInfo(baseKey, slot)));
}

/** The slot with the newest `savedAt` (for「继续游戏」/ boot load), or null
 *  if every slot is empty. Ties break toward the lower slot number. */
export async function mostRecentSlot(baseKey: string): Promise<SaveSlot | null> {
  const slots = await listSaveSlots(baseKey);
  let best: SlotInfo | null = null;
  for (const info of slots) {
    if (!info.exists) continue;
    if (best === null || (info.savedAt ?? 0) > (best.savedAt ?? 0)) best = info;
  }
  return best?.slot ?? null;
}
