/**
 * Phase 4.5A — Scene data model (S2).
 *
 * A "scene" in eraTW does not exist upstream (eraTW is a pure text
 * stream; see `docs/era-ui-reference.md` §0). It is a deliberate
 * modernization. Per spec decision **S2**, a scene splits into two:
 *
 *   1. A static, authored `SceneAsset` — the ASCII-art backdrop, the
 *      exits, the intro prose. This is what this file types. It lives
 *      under `modernization/scenes/<id>/` as `background.txt` (the
 *      ascii) + `scene.json` (everything else) and is loaded by
 *      `loader.ts`.
 *   2. Runtime *presence* — which charas are currently AT this scene's
 *      location. That is NOT stored here; it is computed from
 *      `GameState` by `presence.ts`. The立绘 (portrait) overlay is
 *      derived from presence, never written into the asset, so the
 *      Phase 8 scheduler moving NPCs changes the portraits for free.
 *
 * No upstream imports. No LLM. See `modernization/README.md`.
 */

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
  /** The background字符画 (from `background.txt`), newlines normalized to `\n`. */
  ascii: string;
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
