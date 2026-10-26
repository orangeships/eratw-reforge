import { STONE_WORLD_WIDTH_Q } from "../../../modernization/runtime/state/stone-contest-physics.js";

/** One uniform scale for polygons, centres, the platform and pointer input. */
export function stoneContestViewport(width: number, height: number) {
  const scale = Math.max(.0001, Math.min(width / STONE_WORLD_WIDTH_Q, height * .68 / 7_000));
  const worldWidth = STONE_WORLD_WIDTH_Q * scale;
  const left = (width - worldWidth) / 2;
  return { scale, left, worldWidth, floorY: height * .76, x: (xQ: number) => left + xQ * scale };
}
