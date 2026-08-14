import { create } from "zustand";
// Type-only import: erased at build, so the loader's `node:fs` never
// reaches the browser bundle. (4.5D loads scene assets via a manifest.)
import type { SceneAsset } from "../../../modernization/runtime/scene/index.js";

/**
 * Phase 4.5C — UI-only scene/screen store (spec S1, the A1 split).
 *
 * This store holds the **ephemeral navigation state** that, per S1,
 * must NOT live in `GameState` or the save file:
 *   - `screen`: which top-level surface is showing (title / pre-game
 *     flow / mainGame). Menu navigation is UI-only.
 *   - `interaction`: whether the action interaction box (S4) is open
 *     and which command opened it.
 *
 * The *world* half of "where am I" (the current location) lives in
 * `GameState.master.location` and is changed only through the intent
 * stream (S1) — this store never touches it. `selectScene` joins the
 * two: the scene to render is a pure projection of (screen, location).
 *
 * Nothing here is persisted. On reload, `App.tsx` (4.5F) sets the
 * initial screen from whether a GameState loaded; `interaction` always
 * starts closed.
 */

export type GameScreen =
  | "title"
  | "newGameSetup"
  | "residenceSelect"
  | "kojoSelect"
  | "newGameOptions"
  | "nightSettlement"
  | "morningMenu"
  | "mainGame"
  | "danmakuBattle"
  | "fishingGame"
  | "stoneContest"
  | "farm"
  ;

/** Whether the action interaction box (S4) is open, and its context. */
export interface InteractionState {
  open: boolean;
  /** The COMF/SCOMF command that opened the box; null when closed. */
  rootCommandNo: number | null;
  /**
   * `eventLog.length` at the moment the box opened. The box renders
   * `eventLog[eventLogIndexAtOpen..]` so it shows only this sub-loop's
   * output, not the whole history.
   */
  eventLogIndexAtOpen: number;
}

const CLOSED_INTERACTION: InteractionState = {
  open: false,
  rootCommandNo: null,
  eventLogIndexAtOpen: 0,
};

interface SceneStore {
  screen: GameScreen;
  interaction: InteractionState;
  /** One-shot visual handoff used when a full-screen danmaku battle returns. */
  battleReturn: boolean;
  /** Switch the top-level screen (UI-only navigation, S1). */
  setScreen: (screen: GameScreen) => void;
  /** Open the action interaction box for `commandNo` (S4). */
  openInteraction: (commandNo: number, eventLogLen: number) => void;
  /** Close the interaction box and return to the scene (S4 exit). */
  closeInteraction: () => void;
  /** Mark the next main-game render as the end of a battle transition. */
  beginBattleReturn: () => void;
  /** Consume the visual-only battle return marker. */
  finishBattleReturn: () => void;
}

export const useSceneStore = create<SceneStore>((set) => ({
  screen: "title",
  interaction: { ...CLOSED_INTERACTION },
  battleReturn: false,

  setScreen(screen) {
    set({ screen });
  },

  openInteraction(commandNo, eventLogLen) {
    set({
      interaction: {
        open: true,
        rootCommandNo: commandNo,
        eventLogIndexAtOpen: eventLogLen,
      },
    });
  },

  closeInteraction() {
    set({ interaction: { ...CLOSED_INTERACTION } });
  },

  beginBattleReturn() {
    set({ battleReturn: true });
  },

  finishBattleReturn() {
    set({ battleReturn: false });
  },
}));

/**
 * Pure projection (S1): the `SceneAsset` to render given the current
 * screen and the player's location. Only `mainGame` shows a scene; the
 * pre-game / developer screens render their own chrome and get `null`.
 */
export function selectScene(
  screen: GameScreen,
  location: string,
  scenesByLocation: Record<string, SceneAsset>,
): SceneAsset | null {
  if (screen !== "mainGame") return null;
  return scenesByLocation[location] ?? null;
}
