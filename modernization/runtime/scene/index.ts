/**
 * Phase 4.5A — `runtime/scene` barrel.
 *
 * The scene data model (S2): static `SceneAsset` + runtime presence.
 * Consumed by the Game Client's `SceneView` and the `scene-store`
 * (`selectScene`).
 */

export type { SceneAsset, SceneExit } from "./types.js";
export { selectPresentCharas } from "./presence.js";
export {
  parseSceneAsset,
  loadSceneAsset,
  loadAllScenes,
  indexScenesByLocation,
} from "./loader.js";
export { extractUpstreamMapIntroduction } from "./upstream-map-prose.js";
