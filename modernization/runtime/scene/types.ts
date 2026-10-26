/**
 * Phase 4.5A — Scene data model (S2).
 *
 * A "scene" in eraTW does not exist upstream (eraTW is a pure text
 * stream; see `docs/era-ui-reference.md` §0). It is a deliberate
 * modernization. Per spec decision **S2**, a scene splits into two:
 *
 *   1. A static, authored `SceneAsset` — the backdrop, the exits, the intro
 *      prose. This is what this file types. It lives under
 *      `modernization/scenes/<id>/` as `scene.json`; scenes with authored art
 *      keep a `background.source.html` beside it, which
 *      `build-ascii-scene-art.mjs` compiles to SVG (and a motion layer).
 *      Backdrops reach the game as an image URL or a compiled SVG — never as
 *      a character-grid text file.
 *   2. Runtime *presence* — which charas are currently AT this scene's
 *      location. That is NOT stored here; it is computed from
 *      `GameState` by `presence.ts`. The立绘 (portrait) overlay is
 *      derived from presence, never written into the asset, so the
 *      Phase 8 scheduler moving NPCs changes the portraits for free.
 *
 * No upstream imports. No LLM. See `modernization/README.md`.
 */

/**
 * Player-visible marker used when a scene input has no room-specific prose.
 *
 * Scene sources still use the location echo (`<location>。`) as a generator
 * sentinel. The loader turns that sentinel into this Chinese diagnostic so a
 * raw scene can never leak an English `[not-authored: ...]` placeholder into
 * the UI. The legacy prefix remains recognised for old bundles/fixtures.
 */
export const SCENE_INTRO_DIAGNOSTIC_PREFIX = "【暂无原版地文：";
const LEGACY_SCENE_INTRO_DIAGNOSTIC_PREFIX = "[not-authored:";

export function isMissingSceneIntro(intro: string): boolean {
  const value = intro.trim();
  return (
    value.startsWith(SCENE_INTRO_DIAGNOSTIC_PREFIX) ||
    value.startsWith(LEGACY_SCENE_INTRO_DIAGNOSTIC_PREFIX)
  );
}

/** A single navigable exit from a scene to another location. */
export interface SceneExit {
  /**
   * The command number dispatched as an `ISSUE_COMMAND` intent when the
   * player takes this exit (S1). In the 4.5 mock these are reserved
   * placeholders (`< 1000`, documented in the plan); Phase 5/7 maps
   * them to real eraTW move commands. The SceneView and the intent
   * flow do not change when the source of this list changes.
   */
  commandNo: number;
  /** Target location string — must match another `SceneAsset.location`. */
  toLocation: string;
  /** Button label, e.g. "前往 人間之里". */
  label: string;
}

/** The static, authored half of a scene (S2). */
export interface SceneAsset {
  /** Stable, ascii-safe key, e.g. "shrine". */
  id: string;
  /** Location string; matches `GameState.master.location` / `CharaSlot.location`. */
  location: string;
  /** Human-facing place name, e.g. "博麗神社". */
  displayName: string;
  /**
   * Optional full-bleed real-image backdrop (web-public asset URL, e.g.
   * `scenes/shrine-keidai.png`). Absent for the vast majority of scenes, which
   * then show no backdrop at all — the authored `background.source.html` SVG
   * and its motion layer are wired in by scene id, not through this field.
   */
  backgroundImage?: string;
  /** Mock narrative shown on enter; surfaced as a `NARRATION` event. */
  intro: string;
  /**
   * Dynamic "current scene" prose (`@LOOK_AT` → `@情景描写` /
   * `MAP_UNIQUEMESSAGE`), projected at presentation time by
   * `sceneForPresentation`. Separated from `intro` so the static authored
   * "you walk in" text is not confused with live position/state description.
   */
  ambientProse?: string;
  /** Where the player can go from here. Hardcoded in the 4.5 mock (S2). */
  exits: SceneExit[];
  /**
   * Reserved for Phase 8 (day/night/weather variants of the same place).
   * The 4.5 mock leaves this `undefined`.
   */
  variant?: string;
}
