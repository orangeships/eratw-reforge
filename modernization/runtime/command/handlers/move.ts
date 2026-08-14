/**
 * Phase 5B — `COMF400 移動` settlement tail.
 *
 * The full `@COM400` + `@SKIP_MOVE` ERB file is ~700 lines of
 * Emuera UI (map renderer, BFS pathfinding, animation, dialog),
 * all of which the modernized React Game Client replaces. This
 * handler ports **only the settlement state writes** that the
 * upstream SKIP_MOVE produces:
 *
 *   - `CFLAG:MASTER:現在位置 = 最終目的地`
 *   - `TIME += 2 * 経過時間`
 *
 * 5B mock — real UI-driven location selection (with a
 * `IssueCommandIntent.variant.locationId` schema addition) lands
 * in Phase 7. For 5B we cycle the master's location through three
 * sequential room ids so the test diff is deterministic and the
 * resolver path is exercised end-to-end.
 *
 * **Deferred to later slices** (not 5B):
 *   - Companion (`CFLAG:93:同行`) → `体力 -= 5*経過時間` + extra `TIME += 2`
 *   - Short-stature (`TALENT:MASTER:100 < -4`) → `TIME += 7*経過時間`
 *   - Time-stop / instant-move → `BASE:TSP -= cost` instead of `TIME +=`
 *   - Pitfall event (`TIME += 3`)
 *   - `PREVCOM = 400`
 *   - `ExecCheck` preconditions (not 诶嘿嘿, at home, etc.)
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  advanceTimeTicks,
  getLocation,
  setLocation,
} from "../../state/settlement.js";

/** 5B mock room cycle. Real room ids come from `#DEFINE 場所_*` in Phase 7. */
const MOCK_CYCLE = [310, 311, 312] as const;

export const moveHandlerEntry: HandlerEntry = {
  commandNo: 400,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);

    const cur = getLocation(next, 0);
    const idx = MOCK_CYCLE.indexOf(cur as (typeof MOCK_CYCLE)[number]);
    const target =
      idx >= 0
        ? MOCK_CYCLE[(idx + 1) % MOCK_CYCLE.length]
        : MOCK_CYCLE[0];

    setLocation(next, 0, target);
    // ERA: TIME += 2 * 経過時間. 5B simulates the canonical direct-move
    // path where 経過時間 = 1 (a single relay, no BFS path).
    advanceTimeTicks(next, 2);

    return {
      state: next,
      events: [
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          // `%CALLNAME:MASTER%` is a legacy renderer token; 5B leaves
          // it literal in the narration string — the React UI can
          // substitute the real call name later. We do NOT resolve
          // settlement-time names (Phase 6+).
          text: `%CALLNAME:MASTER% moved to <${target}>.`,
        },
      ],
      outcome: "ok",
    };
  },
};