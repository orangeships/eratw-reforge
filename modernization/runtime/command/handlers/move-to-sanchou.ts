/** GENERATED cross-map move handler. */
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const SANCHOU_ENTRANCE = "妖怪之山・山顶";

export const moveToSanchouHandlerEntry: HandlerEntry = {
  commandNo: 10908,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const endedDate = endOdekakeIfReturningHome(next, SANCHOU_ENTRANCE);
    setSlotLocation(next.master, SANCHOU_ENTRANCE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, SANCHOU_ENTRANCE, ctx.now());
    const tail = endedDate ? " 約會結束了。" : "";
    return {
      state: next,
      events: [...activityEvents, { kind: "NARRATION", timestamp: ctx.now(), text: `%CALLNAME:MASTER% 來到 妖怪之山・山顶。${tail}` }],
      outcome: "ok",
    };
  },
};
