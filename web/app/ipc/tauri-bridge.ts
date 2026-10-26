import { invoke } from "@tauri-apps/api/core";
import { readMemorySave, writeMemorySave } from "./memory-archive-storage.js";
import { exportMemoryBlocks, hydrateMemoryArchive, importMemoryBlocks } from "../ai/memory-archive.js";
import { hasArchivedMemories, validateMemoryAttachments } from "../../../modernization/runtime/agent/memory-archive.js";
import type { AgentRuntimeState } from "../../../modernization/runtime/agent/types.js";

/** Player/runtime IPC bridge. Studio project and manifest IPC lives in
 * `tauri-studio-bridge.ts`; keeping that surface separate prevents player
 * code from depending on authoring-only APIs. */
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
 * Register the selected Kojo source for `asset://` access.
 * Local/Tauri play uses this so KojoCache can synchronously fetch original
 * ERB files on demand instead of bundling all parsed dialogue into the
 * frontend.
 */
export async function addKojoSourceScope(sourcePath: string): Promise<string> {
  return await invoke<string>("add_kojo_source_scope", { sourcePath });
}

// =====================================================================
// GameState persistence (save_state / load_state)
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

export interface SeedSavePayload {
  state: unknown;
  summary?: SaveSummary;
}

export interface StateEnvelope {
  version: 1 | 2;
  savedAt: number;
  summary?: SaveSummary;
  state: unknown;
  /** Portable exports include originals; ordinary saves reference durable immutable blocks. */
  memoryBlocks?: readonly unknown[];
}

export class MemoryArchiveLoadError extends Error {
  readonly archiveCause: unknown;
  constructor(cause: unknown) {
    super("存档的长期记忆无法完整读取，请尝试其他存档。");
    this.name = "MemoryArchiveLoadError";
    this.archiveCause = cause;
  }
}

function memoryRuntime(state: unknown): AgentRuntimeState | undefined {
  return state && typeof state === "object" ? (state as { agentRuntime?: AgentRuntimeState }).agentRuntime : undefined;
}

async function loadEnvelope(projectRoot: string): Promise<StateEnvelope | null> {
  if (!useLocalStateStore()) return toEnvelope(await invoke<unknown | null>("load_state", { projectRoot }));
  const raw = window.localStorage.getItem(localStateKey(projectRoot));
  if (!isMemorySaveLocator(raw)) return parseLocalEnvelope(raw);
  try {
    const archived = await readMemorySave(projectRoot);
    if (!archived) throw new Error("Missing memory save document");
    return toEnvelope(archived);
  } catch (error) { throw new MemoryArchiveLoadError(error); }
}

function isMemorySaveLocator(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return value?.version === 2 && value.memoryIndexedDb === true && value.state === null;
  } catch { return false; }
}

/** A self-contained portable save, without exposing other branches' archive blocks. */
export async function exportSaveDocument(state: unknown, summary?: SaveSummary): Promise<StateEnvelope> {
  const runtime = memoryRuntime(state);
  await hydrateMemoryArchive(runtime?.memoryArchive);
  return { version: 2, savedAt: Date.now(), summary, state: structuredClone(state), memoryBlocks: exportMemoryBlocks(runtime) };
}

export async function importSaveDocument(baseKey: string, slot: SaveSlot, input: unknown): Promise<void> {
  const envelope = toEnvelope(input);
  if (!envelope) throw new Error("Invalid save document");
  const runtime = memoryRuntime(envelope.state);
  if (hasArchivedMemories(runtime) && !Array.isArray(envelope.memoryBlocks)) throw new Error("Save document is missing its memory attachments");
  if (envelope.memoryBlocks) await importMemoryBlocks(validateMemoryAttachments(runtime?.memoryArchive, envelope.memoryBlocks));
  await hydrateMemoryArchive(memoryRuntime(envelope.state)?.memoryArchive);
  await saveState(baseKey, slot, envelope.state, envelope.summary);
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
  const runtime = memoryRuntime(state);
  const archived = hasArchivedMemories(runtime);
  await hydrateMemoryArchive(runtime?.memoryArchive);
  const envelope: StateEnvelope = { version: archived ? 2 : 1, savedAt: Date.now(), summary, state };
  if (useLocalStateStore()) {
    const key = localStateKey(projectRoot);
    const previous = window.localStorage.getItem(key);
    const migrated = isMemorySaveLocator(previous);
    // Ordinary AI-off saves never require IndexedDB. Keep the original legacy
    // payload in cold storage before replacing its large localStorage entry.
    if (archived || migrated) {
      await writeMemorySave(projectRoot, envelope, migrated ? null : previous);
      if (!migrated) window.localStorage.setItem(key, JSON.stringify({ version: 2, memoryIndexedDb: true, state: null }));
    } else window.localStorage.setItem(key, JSON.stringify(envelope));
    return;
  }
  // Rust round-trips the envelope JSON verbatim (it only hashes projectRoot
  // into a filename), so no Rust change is needed for slots or summary.
  await invoke<void>("save_state", { projectRoot, state: envelope });
}

/**
 * Install a bundled starter save only when the player has no saves yet.
 * This is deliberately one-shot: an existing local/Tauri save always wins.
 */
export async function installSeedSaveIfEmpty(
  baseKey: string,
  seed: SeedSavePayload,
): Promise<boolean> {
  const slots = await listSaveSlots(baseKey);
  if (slots.some((slot) => slot.exists)) return false;
  await saveState(baseKey, 1, seed.state, seed.summary);
  return true;
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
  const envelope = await loadEnvelope(projectRoot);
  try {
    if (envelope?.memoryBlocks) await importMemoryBlocks(envelope.memoryBlocks);
    await hydrateMemoryArchive(memoryRuntime(envelope?.state)?.memoryArchive);
  } catch (error) { throw new MemoryArchiveLoadError(error); }
  return envelope?.state ?? null;
}

/** Slot metadata for the SAVE/LOAD page: existence + savedAt + summary. */
export async function slotInfo(baseKey: string, slot: SaveSlot): Promise<SlotInfo> {
  const projectRoot = slotProjectRoot(baseKey, slot);
  const env = await loadEnvelope(projectRoot);
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
