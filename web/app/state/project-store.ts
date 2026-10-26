import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  pickProjectDir,
  validateProject,
  addAssetScope,
  type ProjectValidation,
} from "../ipc/tauri-studio-bridge";

/**
 * Phase 1 project store.
 *
 * Persists the last picked project path via the Tauri store plugin
 * (`settings.json` in the app config dir). The Rust side has no business
 * knowing about this file — only the renderer reads/writes it.
 */

const STORE_FILE = "settings.json";
const KEY_LAST_PROJECT = "last_project_path";

export type AppTab = "pick" | "game" | "browse" | "preview";

// Module-level singleton; LazyStore lazily opens the file on first access.
const store = new LazyStore(STORE_FILE);

interface ProjectState {
  lastPath: string | null;
  validation: ProjectValidation | null;
  loading: boolean;
  error: string | null;
  currentTab: AppTab;

  /** Read the persisted path on app boot and validate it. */
  loadInitial: () => Promise<void>;
  /** Open native folder picker, validate, persist. */
  pickAndValidate: () => Promise<void>;
  /** Re-validate an existing path (e.g. user clicks "re-check"). */
  validateExisting: (path: string) => Promise<void>;
  /** Drop the persisted path. */
  clear: () => Promise<void>;
  /** Phase 2.1: switch between "项目" and "数据浏览" tabs. */
  setCurrentTab: (tab: AppTab) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  lastPath: null,
  validation: null,
  loading: false,
  error: null,
  currentTab: "pick",

  async loadInitial() {
    try {
      const saved = await store.get<string>(KEY_LAST_PROJECT);
      if (saved && typeof saved === "string" && saved.length > 0) {
        set({ lastPath: saved });
        try {
          const v = await validateProject(saved);
          set({ validation: v });
          // Phase 2.2: register the project's resources/ for asset://
          // access so the Resource Preview can render sprite images.
          if (v.isValid) {
            await addAssetScope(saved).catch(() => undefined);
          }
        } catch (e) {
          // The path may no longer be reachable; surface error but keep lastPath.
          set({ error: `已保存路径校验失败：${String(e)}` });
        }
      }
    } catch {
      // settings.json doesn't exist yet — that's expected on first run.
    }
  },

  async pickAndValidate() {
    set({ loading: true, error: null });
    try {
      const picked = await pickProjectDir();
      if (!picked) {
        set({ loading: false });
        return;
      }
      const v = await validateProject(picked);
      await store.set(KEY_LAST_PROJECT, picked);
      await store.save();
      set({ lastPath: picked, validation: v, loading: false });
      if (v.isValid) {
        await addAssetScope(picked).catch(() => undefined);
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  async validateExisting(path: string) {
    set({ loading: true, error: null });
    try {
      const v = await validateProject(path);
      set({ validation: v, loading: false });
      if (v.isValid) {
        await addAssetScope(path).catch(() => undefined);
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  async clear() {
    try {
      await store.delete(KEY_LAST_PROJECT);
      await store.save();
    } catch {
      // ignore — clear is best-effort
    }
    set({ lastPath: null, validation: null, error: null, currentTab: "pick" });
  },

  setCurrentTab(tab) {
    set({ currentTab: tab });
  },
}));
