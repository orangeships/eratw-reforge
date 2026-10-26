import { useSyncExternalStore } from "react";
import type { GamePresentationMode } from "../game/GameClient";
import { PLAYER_BUILD } from "../player-build.js";

/** Both builds use the responsive ASCII shell. Compact components remain
 * available to explicit callers. There is no persisted presentation override. */
export const PRESENTATION_MODE_KEY = "era-presentation-mode";

export function presentationModeForBuild(_playerBuild: boolean): GamePresentationMode {
  return "immersive";
}

export const DEFAULT_PRESENTATION_MODE = presentationModeForBuild(PLAYER_BUILD);

type Listener = () => void;
const listeners = new Set<Listener>();

export function readPresentationMode(): GamePresentationMode {
  return DEFAULT_PRESENTATION_MODE;
}

/** No-op: each build target owns one fixed presentation mode. */
export function setPresentationMode(_mode: GamePresentationMode): void {
  /* Nothing to persist or notify. */
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the build-owned presentation mode. */
export function usePresentationMode(): GamePresentationMode {
  return useSyncExternalStore(subscribe, readPresentationMode, () => DEFAULT_PRESENTATION_MODE);
}
