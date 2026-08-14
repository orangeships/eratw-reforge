/**
 * Phase 7 — move-to-koumakan.ts
 *
 * Cross-map move handler: commandNo 10705 (紅魔館).
 *
 * Destination = P301 正門 → location `"紅魔館"` (root, no colon).
 * Cross-map travel time = 5 ticks.
 * If returning from an ODEKAKE/date map to a base map, end the date.
 *
 * CommandNo 10705 continues the 1070x cross-map convention:
 *   10701 = shrine, 10702 = village, 10703 = hometown (自宅), 10704 = reiten,
 *   10705 = koumakan (紅魔館).
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const KOUMAKAN_GATE = "紅魔館";

export const moveToKoumakanHandlerEntry: HandlerEntry = {
  commandNo: 10705,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);

    // O4: returning to the base map ends any in-progress date.
    const endedDate = endOdekakeIfReturningHome(next, KOUMAKAN_GATE);
    setSlotLocation(next.master, KOUMAKAN_GATE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, KOUMAKAN_GATE, ctx.now());

    const tail = endedDate ? " 约会结束了。" : "";
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 来到了红魔馆正面。${tail}`,
        },
      ],
      outcome: "ok",
    };
  },
};
