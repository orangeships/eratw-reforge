/**
 * Same-map room path distance for the meal-assembly slice — the modern port
 * of `@SYUGOS_COST` / `@CALC_SYUGOS_COST` (`ERB/コマンド関連/集合.ERB:184-297`)
 * with the current upstream BFS core (`QOL_GET_DISTANCE`,
 * `ERB/魔改内容/qol/qol_skipmove.ERB:47-100`): hop count over the walkable
 * `CAN_MOVE` adjacency of the master's map. `@AssembleForMeal` drops
 * candidates whose cost exceeds 3 (`集合.ERB:347`).
 *
 * **Data scope (documented deviation):** the only runtime adjacency table is
 * `SHRINE_ADJACENCY` (`work/shrine-graph.ts`, map 0 神社, faithfully
 * transcribed from `MOVEMENT_CAN_MOVE_00.ERB`). Maps 1+ have no engine-side
 * graph — the scene-exit graph lives in the web bundle, which the runtime
 * must not import. The fallback therefore DEGRADES:
 *   - both rooms in the shrine graph → exact BFS hop count;
 *   - same map otherwise → cost 1 (treated as "one hop away");
 *   - different maps → unreachable (`null`, candidate excluded).
 * This is honest about what the runtime knows: it cannot under-count a real
 * shrine path, and a same-map approximation only risks inviting someone who
 * upstream would consider too far — never excluding someone reachable.
 */

import { SHRINE_ADJACENCY } from "./work/shrine-graph.js";
import { sameMap } from "./location-predicates.js";

/** `@AssembleForMeal` cost ceiling (`集合.ERB:347`: `集合:LOCAL:2 > 3`). */
export const MEAL_ASSEMBLY_MAX_COST = 3;

/**
 * Upstream `@SYUGOS_GETDATA`'s detection arm (`集合.ERB:92`): a master
 * WITHOUT `居場所察知` cannot summon a chara in a room they share no
 * `CAN_MOVE` edge with. Exact for shrine-graph rooms; DEGRADED elsewhere
 * (same map → treated as connected — see the header deviation note).
 */
export function roomsAdjacent(from: string, to: string): boolean {
  if (from === to) return true;
  const neighbors = SHRINE_ADJACENCY[from];
  if (neighbors && SHRINE_ADJACENCY[to]) return neighbors.includes(to);
  return sameMap(from, to);
}

/**
 * BFS hop count from `from` to `to` over the walkable room graph, or `null`
 * when no path is modeled. Same room → 0, adjacent room → 1.
 */
export function roomPathDistance(from: string, to: string): number | null {
  if (from === to) return 0;
  // Exact BFS only when BOTH rooms are shrine-graph nodes (directed edges,
  // transcribed verbatim from the upstream CAN_MOVE_0 arms).
  if (SHRINE_ADJACENCY[from] && SHRINE_ADJACENCY[to]) {
    const visited = new Set<string>([from]);
    let frontier = [from];
    let dist = 0;
    while (frontier.length > 0) {
      dist += 1;
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of SHRINE_ADJACENCY[cur] ?? []) {
          if (nb === to) return dist;
          if (!visited.has(nb)) {
            visited.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    return null; // same graph, disconnected — no fabricated path
  }
  // DEGRADED FALLBACK (see header): no engine graph for this pair. Same map
  // → one hop; cross-map → unreachable.
  if (sameMap(from, to)) return 1;
  return null;
}
