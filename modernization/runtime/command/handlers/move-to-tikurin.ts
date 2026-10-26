/**
 * Phase 7 — `COMF706` (move → 迷途竹林/永遠亭/夢幻館, mapId=4).
 *
 * Cross-map move handler for the 竹林 field map (mapId=4). Lands the master
 * at the ENTRANCE room `"迷途竹林"` (P447 竹林入口, the cross-map landing spot,
 * bare root location), syncs CFLAG[300] via `setSlotLocation`, and advances
 * time by 5 minutes.
 *
 * 竹林 is a field/odekake destination map (NOT a player base map — it is NOT
 * in `BASE_MAP_PREFIXES`). `endOdekakeIfReturningHome` is called for symmetry
 * with the other move-to handlers, but it is a no-op here because 竹林
 * (mapId=4) is not MAIN_MAP — a date only ends on返回 to MAIN_MAP.
 *
 * CommandNo 10706 is defined by the `REGIONS` table (`regions.ts`) and the
 * cross-map exit on P447 竹林入口's scene.json.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { followCompanions } from "../../state/companion-follow.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

const TIKURIN_ENTRANCE = "迷途竹林";

export const moveToTikurinHandlerEntry: HandlerEntry = {
  commandNo: 10706,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const endedDate = endOdekakeIfReturningHome(next, TIKURIN_ENTRANCE);
    setSlotLocation(next.master, TIKURIN_ENTRANCE);
    advanceTimeTicks(next, 5);
    followCompanions(next, 5);
    const activityEvents = pitfallArrivalEvents(next, TIKURIN_ENTRANCE, ctx.now());
    const tail = endedDate ? " 约会结束了。" : "";
    return {
      state: next,
      events: [
        ...activityEvents,
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 来到 迷途竹林。${tail}`,
        },
      ],
      outcome: "ok",
    };
  },
};
