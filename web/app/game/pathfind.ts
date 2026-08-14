/**
 * UI review (2026-06-21) — map pathfinding.
 *
 * The colored map only made a room clickable if it was an *adjacent* exit of
 * the current scene, so in the 44-room village clicking any non-neighbour did
 * nothing ("can't move by selecting on the map"). The original game walks a
 * multi-step path to the clicked room; this module computes that path.
 *
 * `findPath(from, to)` BFS's the scene graph (`SCENES_BY_LOCATION`, each
 * scene's `exits[].toLocation` + `commandNo`) and returns the ordered list of
 * move `commandNo`s to walk there — or `null` if unreachable. The caller
 * issues them in sequence (each is a normal scene-exit ISSUE_COMMAND).
 *
 * Pure + browser-safe (reads the committed bundle, no node:fs).
 */

import { SCENES_BY_LOCATION } from "./scenes.js";

/** A single hop: the move command + the room it lands in. */
export interface PathStep {
  commandNo: number;
  toLocation: string;
}

/**
 * Shortest path (fewest hops) from `from` to `to` over the scene-exit graph.
 * Returns the ordered hops (empty if already there), or `null` if no route.
 * Ties are broken by exit declaration order (stable, matches the map's own
 * adjacency rendering).
 */
export function findPath(from: string, to: string): PathStep[] | null {
  if (from === to) return [];
  // BFS, tracking the hop that reached each node.
  const prev = new Map<string, PathStep & { from: string }>();
  const queue: string[] = [from];
  const seen = new Set<string>([from]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const scene = SCENES_BY_LOCATION[cur];
    if (!scene) continue;
    for (const exit of scene.exits ?? []) {
      const next = exit.toLocation;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { commandNo: exit.commandNo, toLocation: next, from: cur });
      if (next === to) {
        // Reconstruct.
        const steps: PathStep[] = [];
        let node = to;
        while (node !== from) {
          const hop = prev.get(node)!;
          steps.push({ commandNo: hop.commandNo, toLocation: hop.toLocation });
          node = hop.from;
        }
        steps.reverse();
        return steps;
      }
      queue.push(next);
    }
  }
  return null;
}
