/** GENERATED cross-map move handler. */
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const MEIKAI_ENTRANCE = "彼岸";

export const moveToMeikaiHandlerEntry: HandlerEntry = {
  commandNo: 10906,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const endedDate = endOdekakeIfReturningHome(next, MEIKAI_ENTRANCE);
    setSlotLocation(next.master, MEIKAI_ENTRANCE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, MEIKAI_ENTRANCE, ctx.now());
    const tail = endedDate ? " 約會結束了。" : "";
    return {
      state: next,
      events: [...activityEvents, { kind: "NARRATION", timestamp: ctx.now(), text: `%CALLNAME:MASTER% 來到 彼岸。${tail}` }],
      outcome: "ok",
    };
  },
};
