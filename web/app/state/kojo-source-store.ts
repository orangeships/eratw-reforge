import { create } from "zustand";
import {
  addKojoSourceScope,
  pickKojoSourceDir,
  validateKojoSource,
  type KojoSourceValidation,
} from "../ipc/tauri-bridge.js";

interface KojoSourceState {
  selectedPath: string | null;
  validation: KojoSourceValidation | null;
  loading: boolean;
  error: string | null;
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

  async pickAndValidate() {
    set({ loading: true, error: null });
    try {
      const selectedPath = await pickKojoSourceDir();
      if (!selectedPath) {
        set({ loading: false });
        return;
      }
      const validation = await validateAndAuthorize(selectedPath);
      set({ selectedPath, validation, loading: false, error: validation.error });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  async clear() {
    set({ selectedPath: null, validation: null, loading: false, error: null });
  },
}));
