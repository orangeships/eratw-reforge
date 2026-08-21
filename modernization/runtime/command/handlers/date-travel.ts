import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { beginDateReturn, beginDateTravel } from "../../world/date-session.js";
import { dateTravelMinutes } from "../../world/date-travel-time.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { ODEKAKE_DESTINATIONS, odekakeDestinationForMap } from "../../world/odekake.js";
import { pickOne, requirePickOne } from "../prompt.js";

export const dateCrossRegion19997HandlerEntry: HandlerEntry = {
  commandNo: 19997,
  prompt: () => pickOne("约会中要去哪里？", ODEKAKE_DESTINATIONS.map((item) => ({ id: item.mapId, label: item.label }))),
  execCheck: (ctx) => ctx.state.dateSession?.phase === "active" ? { ok: true } : { ok: false, reason: { kind: "precondition", message: "约会的自由活动阶段才能跨区移动。" } },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    if (!ctx.promptAnswer) return { state: next, events: [], outcome: "noop" };
    const mapId = Number(requirePickOne(dateCrossRegion19997HandlerEntry.prompt!(ctx)!, ctx.promptAnswer));
    const destination = odekakeDestinationForMap(mapId);
    const from = mapIdOfLocation(next.master.location);
    const minutes = from == null ? null : dateTravelMinutes(from, mapId);
    if (!destination || minutes == null) return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "该地区尚未建成。" }], outcome: "noop" };
    if (minutes === 0) return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "已经在该地区。" }], outcome: "noop" };
    beginDateTravel(next, destination.representativeLocation, minutes);
    advanceTimeTicks(next, 5);
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `向${destination.label}出发。` }], outcome: "ok" };
  },
};

export const returnFromDate19998HandlerEntry: HandlerEntry = {
  commandNo: 19998,
  execCheck: (ctx) => ctx.state.dateSession && ctx.state.dateSession.phase !== "returning" ? { ok: true } : { ok: false, reason: { kind: "precondition", message: "现在不能踏上归途。" } },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const from = mapIdOfLocation(next.master.location) ?? next.dateSession?.mapId ?? 0;
    const home = mapIdOfLocation(next.homeLocation ?? next.master.homeLocation ?? "神社:倉庫") ?? 0;
    beginDateReturn(next, dateTravelMinutes(from, home) ?? 1);
    advanceTimeTicks(next, 5);
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "两人踏上了归途。" }], outcome: "ok" };
  },
};
