/** GENERATED cross-map move handler. */
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const MOON_ENTRANCE = "月之世界";

export const moveToMoonHandlerEntry: HandlerEntry = {
  commandNo: 10910,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const endedDate = endOdekakeIfReturningHome(next, MOON_ENTRANCE);
    setSlotLocation(next.master, MOON_ENTRANCE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, MOON_ENTRANCE, ctx.now());
    const tail = endedDate ? " 約會結束了。" : "";
    return {
      state: next,
      events: [...activityEvents, { kind: "NARRATION", timestamp: ctx.now(), text: `%CALLNAME:MASTER% 來到 月之世界。${tail}` }],
      outcome: "ok",
    };
  },
};
