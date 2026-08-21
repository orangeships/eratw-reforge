import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  addKojoSourceScope,
  pickKojoSourceDir,
  validateKojoSource,
  type KojoSourceValidation,
} from "../ipc/tauri-bridge.js";

const STORE_FILE = "settings.json";
const KEY_KOJO_SOURCE = "kojo_source_path";
const store = new LazyStore(STORE_FILE);

interface KojoSourceState {
  selectedPath: string | null;
  validation: KojoSourceValidation | null;
  loading: boolean;
  error: string | null;
  loadInitial: () => Promise<void>;
  pickAndValidate: () => Promise<void>;
  clear: () => Promise<void>;
}

async function validateAndAuthorize(path: string): Promise<KojoSourceValidation> {
  const validation = await validateKojoSource(path);
  if (validation.isValid) {
    const kojoRoot = await addKojoSourceScope(path);
    return { ...validation, kojoRoot };
  }
  return validation;
}

export const useKojoSourceStore = create<KojoSourceState>((set) => ({
  selectedPath: null,
  validation: null,
  loading: false,
  error: null,

  async loadInitial() {
    set({ loading: true, error: null });
    try {
      const saved = await store.get<string>(KEY_KOJO_SOURCE);
      if (!saved) {
        set({ loading: false });
        return;
      }
      const validation = await validateAndAuthorize(saved);
      set({ selectedPath: saved, validation, loading: false, error: validation.error });
    } catch (error) {
      set({ loading: false, error: `读取口上来源失败：${String(error)}` });
    }
  },

  async pickAndValidate() {
    set({ loading: true, error: null });
    try {
      const selectedPath = await pickKojoSourceDir();
      if (!selectedPath) {
        set({ loading: false });
        return;
      }
      const validation = await validateAndAuthorize(selectedPath);
      if (validation.isValid) {
        await store.set(KEY_KOJO_SOURCE, selectedPath);
        await store.save();
      }
      set({ selectedPath, validation, loading: false, error: validation.error });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  async clear() {
    await store.delete(KEY_KOJO_SOURCE).catch(() => undefined);
    await store.save().catch(() => undefined);
    set({ selectedPath: null, validation: null, loading: false, error: null });
  },
}));
