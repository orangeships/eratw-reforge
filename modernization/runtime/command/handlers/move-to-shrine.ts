/**
 * Phase 7.3 — `COMF701` (move → 神社).
 *
 * Replaces the early prototype movement table. The handler moves the master
 * to the canonical `神社:参道` location (used by `selectPresentCharas` as the
 * key) via `setSlotLocation`, which keeps `CFLAG:300現在位置` in sync with the
 * location string (2026-06-23 two-track fix), and advances the in-game clock
 * by 5 minutes (era's canonical "direct move, single relay, no BFS" cost).
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const SHRINE_GATE = "神社:参道";

export const moveToShrineHandlerEntry: HandlerEntry = {
  commandNo: 10701,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // O4: returning to the shrine (MAIN_MAP) ends any in-progress date.
    const endedDate = endOdekakeIfReturningHome(next, SHRINE_GATE);
    setSlotLocation(next.master, SHRINE_GATE);
    advanceTimeTicks(next, 5);
    const activityEvents = pitfallArrivalEvents(next, SHRINE_GATE, ctx.now());
    const tail = endedDate ? " 约会结束了。" : "";
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 回到 博麗神社。${tail}`,
        },
      ],
      outcome: "ok",
    };
  },
};
