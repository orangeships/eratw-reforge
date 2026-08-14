/**
 * Phase 7.3 — `COMF703` (move → 自宅).
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { leaveOdekake } from "../../world/odekake.js";
import { runOutingReturnEvents } from "../../world/outing-events.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

export const moveToHomeHandlerEntry: HandlerEntry = {
  commandNo: 10703,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const outingReturn = next.outing && !next.dateSession
      ? runOutingReturnEvents(next, ctx.rng)
      : undefined;
    if (outingReturn) {
      Object.assign(next, outingReturn.state);
      leaveOdekake(next, next.homeLocation ?? next.master.homeLocation);
    }
    const homeLocation = next.homeLocation ?? "自宅";
    // O4: returning home (MAIN_MAP) ends any in-progress date.
    const endedDate = endOdekakeIfReturningHome(next, homeLocation);
    setSlotLocation(next.master, homeLocation);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, homeLocation, ctx.now());
    const tail = endedDate ? " 约会结束了。" : "";
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 回到自宅（${homeLocation}）。${tail}`,
        },
        ...(outingReturn?.events ?? []),
      ],
      outcome: "ok",
    };
  },
};
