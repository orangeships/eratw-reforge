/**
 * Phase 4.5A — runtime presence (S2).
 *
 * "Who is at this location right now" is a projection of `GameState`,
 * not part of the authored `SceneAsset`. The Game Client maps the
 * returned charas to立绘 sprites for the middle-zone overlay.
 *
 * Ordering: MASTER (player) first, then NPC charas by ascending
 * `charaNum`. Deterministic so snapshot/diff tests are stable.
 */

import type { CharaSlot, GameState } from "../state/index.js";

/**
 * Return every chara (MASTER + NPCs) currently at `location`, MASTER
 * first then NPCs by ascending charaNum. Empty array if nobody is there.
 */
export function selectPresentCharas(state: GameState, location: string): CharaSlot[] {
  const present: CharaSlot[] = [];
  if (state.master.location === location) {
    present.push(state.master);
  }
  const ids = Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const slot = state.charas[id];
    if (slot && slot.location === location) {
      present.push(slot);
    }
  }
  return present;
}

/**
 * Return every NPC (charaNum > 0) currently at `location`, by ascending
 * `charaNum`. Excludes MASTER. The multi-target helper for commands that
 * settle against all present NPCs in one invocation (e.g. `COMF364 豆まき`
 * throws beans at every non-鬼 present chara). Deterministic order so the
 * "last-iterated" chara (ERA `FOR LOCAL,1,GET_TARGETNUM()+1` over the
 * charaNum-ordered target list) is reproducible.
 */
export function presentNpcs(state: GameState, location: string): CharaSlot[] {
  return selectPresentCharas(state, location).filter((c) => c.charaNum > 0);
}
