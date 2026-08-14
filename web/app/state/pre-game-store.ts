import { create } from "zustand";
import { DEFAULT_DRAFT, type NewGameDraft } from "../game/pre/newgame-draft.js";

/**
 * #13 原版开场流程 — UI-only store for the new-game wizard draft.
 *
 * Like `scene-store`, this is ephemeral navigation/setup state that must
 * NOT live in `GameState` or the save file. The opening wizard
 * (Title → 身份 → 口上 → 居住地) accumulates the player's choices here; the
 * final step reads the draft once and feeds it to `buildInitialState`.
 * Nothing here is persisted; `reset` returns to the faithful defaults.
 */
interface PreGameStore {
  draft: NewGameDraft;
  /** Patch one or more draft fields (the wizard steps write here). */
  setDraft: (patch: Partial<NewGameDraft>) => void;
  /** Reset to NEWGAME defaults (called when 开始游戏 begins the wizard). */
  resetDraft: () => void;
}

export const usePreGameStore = create<PreGameStore>((set) => ({
  draft: { ...DEFAULT_DRAFT },
  setDraft(patch) {
    set((s) => ({ draft: { ...s.draft, ...patch } }));
  },
  resetDraft() {
    set({ draft: { ...DEFAULT_DRAFT } });
  },
}));
