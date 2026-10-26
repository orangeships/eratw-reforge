import { useSyncExternalStore } from "react";

/** Presentation-only scene preferences; never part of GameState or saves. */
export const SCENE_BACKGROUND_ENABLED_KEY = "era-scene-bg-enabled";
export const DEFAULT_SCENE_BACKGROUND_ENABLED = true;

type Listener = () => void;
const listeners = new Set<Listener>();

export function readSceneBackgroundEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULT_SCENE_BACKGROUND_ENABLED;
  try {
    const saved = window.localStorage.getItem(SCENE_BACKGROUND_ENABLED_KEY);
    return saved === null ? DEFAULT_SCENE_BACKGROUND_ENABLED : saved === "true";
  } catch {
    return DEFAULT_SCENE_BACKGROUND_ENABLED;
  }
}

export function setSceneBackgroundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SCENE_BACKGROUND_ENABLED_KEY, String(enabled));
  } catch {
    /* Ignore unavailable browser storage; the next render uses the default. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the persisted presentation preference. */
export function useSceneBackgroundEnabled(): boolean {
  return useSyncExternalStore(subscribe, readSceneBackgroundEnabled, () => DEFAULT_SCENE_BACKGROUND_ENABLED);
}
