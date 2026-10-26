/**
 * Phase 7.3 — `COMF704` (move → 命蓮寺).
 *
 * Cross-map move handler for 命蓮寺 (mapId=1). Falls the master to the root
 * location `"命蓮寺"` (P101 山門 entry gate), syncs CFLAG[300] via
 * `setSlotLocation`, advances time by 5 minutes, and ends any in-progress
 * date (命蓮寺 is a base-map return destination).
 *
 * CommandNo 10704 is defined by the `REGIONS` table (`regions.ts`) and the
 * cross-map exit on P101 山門's scene.json.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { followCompanions } from "../../state/companion-follow.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const REITEN_GATE = "命蓮寺";

export const moveToReitenHandlerEntry: HandlerEntry = {
  commandNo: 10704,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // O4: returning to the base map (命蓮寺 is in BASE_MAP_PREFIXES) ends any
    // in-progress date.
    const endedDate = endOdekakeIfReturningHome(next, REITEN_GATE);
    setSlotLocation(next.master, REITEN_GATE);
    advanceTimeTicks(next, 5);
    followCompanions(next, 5);
    const activityEvents = pitfallArrivalEvents(next, REITEN_GATE, ctx.now());
    const tail = endedDate ? " 约会结束了。" : "";
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 回到 命蓮寺。${tail}`,
        },
      ],
      outcome: "ok",
    };
  },
};
