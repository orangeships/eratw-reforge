/** GENERATED cross-map move handler. */
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const FOREST_ENTRANCE = "魔法之森";

export const moveToForestHandlerEntry: HandlerEntry = {
  commandNo: 10905,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const endedDate = endOdekakeIfReturningHome(next, FOREST_ENTRANCE);
    setSlotLocation(next.master, FOREST_ENTRANCE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, FOREST_ENTRANCE, ctx.now());
    const tail = endedDate ? " 約會結束了。" : "";
    return {
      state: next,
      events: [...activityEvents, { kind: "NARRATION", timestamp: ctx.now(), text: `%CALLNAME:MASTER% 來到 魔法之森。${tail}` }],
      outcome: "ok",
    };
  },
};
