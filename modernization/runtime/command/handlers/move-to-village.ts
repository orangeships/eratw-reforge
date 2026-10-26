/**
 * Phase 7.3 — `COMF702` (move → 人間之里).
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { followCompanions } from "../../state/companion-follow.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

export const moveToVillageHandlerEntry: HandlerEntry = {
  commandNo: 10702,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    setSlotLocation(next.master, "人間之里");
    advanceTimeTicks(next, 5);
    followCompanions(next, 5);
    const activityEvents = pitfallArrivalEvents(next, "人間之里", ctx.now());
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 移动到 人間之里。`,
        },
      ],
      outcome: "ok",
    };
  },
};
