/**
 * Phase 4.5A — `runtime/scene` barrel.
 *
 * The scene data model (S2): static `SceneAsset` + runtime presence.
 * Consumed by the Game Client's `SceneView` and the `scene-store`
 * (`selectScene`).
 */

export {
  SCENE_INTRO_DIAGNOSTIC_PREFIX,
  isMissingSceneIntro,
  type SceneAsset,
  type SceneExit,
} from "./types.js";
export { selectPresentCharas } from "./presence.js";
export {
  parseSceneAsset,
  loadSceneAsset,
  loadAllScenes,
  indexScenesByLocation,
} from "./loader.js";
export { extractUpstreamMapIntroduction } from "./upstream-map-prose.js";
