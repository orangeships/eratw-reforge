import { invoke } from "@tauri-apps/api/core";
import { memoryContentId, validateMemoryBlock, type AgentMemoryBlockV1 } from "../../../modernization/runtime/agent/memory-archive.js";

const DATABASE = "eratw-memory-archive-v1";
const STORE = "documents";
let database: Promise<IDBDatabase> | null = null;

function native(): boolean {
  return typeof window !== "undefined" && !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Long-term memory requires IndexedDB"));
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => { database = null; reject(request.error ?? new Error("Memory database failed to open")); };
    request.onblocked = () => { database = null; reject(new Error("Memory database upgrade is blocked")); };
  });
  return database;
}

async function readDocument(key: string): Promise<unknown | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("Memory database read failed"));
  });
}

async function writeDocument(key: string, value: unknown, immutable: boolean): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    let collision = false;
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(collision
      ? new Error("Memory archive content collision") : transaction.error ?? new Error("Memory database write failed"));
    if (!immutable) { store.put(value, key); return; }
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result === undefined) store.put(value, key);
      else if (JSON.stringify(request.result) !== JSON.stringify(value)) {
        collision = true;
        transaction.abort();
      }
    };
  });
}

export async function persistMemoryBlock(block: AgentMemoryBlockV1): Promise<void> {
  const checked = validateMemoryBlock(block);
  if (native()) {
    // Reuse the opaque JSON IPC with a content-addressed namespace in app data.
    const projectRoot = `agent-memory:${checked.id}`;
    const previous = await invoke<unknown | null>("load_state", { projectRoot });
    if (previous !== null) {
      if (JSON.stringify(validateMemoryBlock(previous)) !== JSON.stringify(checked)) throw new Error("Memory archive content collision");
      return;
    }
    await invoke<void>("save_state", { projectRoot, state: checked });
  } else await writeDocument(`block:${checked.id}`, checked, true);
}

export async function loadMemoryBlock(id: string): Promise<AgentMemoryBlockV1> {
  const value = native()
    ? await invoke<unknown | null>("load_state", { projectRoot: `agent-memory:${id}` })
    : await readDocument(`block:${id}`);
  if (value === null) throw new Error(`Missing memory archive block: ${id}`);
  const checked = validateMemoryBlock(value);
  if (checked.id !== id) throw new Error("Memory archive reference mismatch");
  return checked;
}

export async function readMemorySave(key: string): Promise<unknown | null> {
  if (native() || typeof indexedDB === "undefined") return null;
  return readDocument(`save:${key}`);
}

export async function writeMemorySave(key: string, envelope: unknown, legacyOriginal?: string | null): Promise<void> {
  if (legacyOriginal) await writeDocument(`legacy:${memoryContentId(`${key}:${legacyOriginal}`)}`, legacyOriginal, true);
  await writeDocument(`save:${key}`, envelope, false);
}
