import { useLayoutEffect } from "react";
import { create } from "zustand";

export const UI_PREFERENCES_KEY = "eratw:ui-preferences:v1";
export interface UiPreferences {
  fontScale: number;
  lineHeight: number;
  reducedMotion: boolean;
  dialogueFade: boolean;
  textSpeed: number;
}
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  fontScale: 1, lineHeight: 1.5, reducedMotion: false, dialogueFade: true, textSpeed: 1,
};
function normalize(value: Partial<UiPreferences>): UiPreferences {
  const bounded = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  return {
    fontScale: bounded(value.fontScale, 1, .8, 1.3),
    lineHeight: bounded(value.lineHeight, 1.5, 1.3, 1.9),
    reducedMotion: value.reducedMotion === true,
    dialogueFade: value.dialogueFade !== false,
    textSpeed: [0, .5, 1, 2].includes(value.textSpeed ?? -1) ? value.textSpeed! : 1,
  };
}
function load(): UiPreferences {
  try { return normalize(JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) ?? "{}") ?? {}); }
  catch { return { ...DEFAULT_UI_PREFERENCES }; }
}
/** Device-local presentation only; never stored in GameState. */
export const useUiPreferences = create<UiPreferences & {
  update: (patch: Partial<UiPreferences>) => void;
}>((set, get) => ({
  ...load(),
  update(patch) {
    const next = normalize({ ...get(), ...patch });
    set(next);
    try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* In-memory settings still work. */ }
  },
}));

export function useApplyUiPreferences(): void {
  const { fontScale, lineHeight, reducedMotion, dialogueFade } = useUiPreferences();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-font-scale", String(fontScale));
    root.style.setProperty("--ui-line-height", String(lineHeight));
    root.dataset.uiMotion = reducedMotion ? "reduced" : "normal";
    root.dataset.dialogueFade = dialogueFade ? "on" : "off";
  }, [fontScale, lineHeight, reducedMotion, dialogueFade]);
}

/** Keep preference updates out of the main game's React render tree. */
export function UiPreferencesBridge() {
  useApplyUiPreferences();
  return null;
}
