import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { endDate, moveDateTo } from "../../world/date-session.js";
import { runDateEvent } from "../../world/date-event.js";
import { dateTravelMinutes } from "../../world/date-travel-time.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { ODEKAKE_DESTINATIONS, odekakeDestinationForMap } from "../../world/odekake.js";
import { runOutingReturnEvents } from "../../world/outing-events.js";
import { pickOne, requirePickOne, askYn, requireYesNo } from "../prompt.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { CFLAG_ID } from "../../state/settlement.js";
import { restoreDateOutfit } from "../../world/date-outfit.js";

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
    // Upstream `COMF464 特殊地域間移動` re-enters the road and charges
    // `TIME_REQUIRED`; the modern runtime skips the road, so the party is
    // placed at the destination and only the time cost is charged.
    moveDateTo(next, destination.representativeLocation, minutes);
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: `向${destination.label}出发。` },
        { kind: "NARRATION", timestamp: ctx.now(), text: `抵达了${destination.label}的${destination.representativeLocation}。` },
      ],
      outcome: "ok",
    };
  },
};

export const returnFromDate19998HandlerEntry: HandlerEntry = {
  commandNo: 19998,
  execCheck: (ctx) => ctx.state.dateSession ? { ok: true } : { ok: false, reason: { kind: "precondition", message: "现在没有约会可以结束。" } },
  prompt: (ctx) => {
    const name = ctx.state.charas[ctx.state.dateSession?.partner ?? 0]?.callName ?? "对方";
    return askYn(`确定要回家吗？和${name}的约会将结束。`, "回家", "再待一会");
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const partnerNum = next.dateSession?.partner;
    if (partnerNum == null) {
      return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "现在没有约会可以结束。" }], outcome: "noop" };
    }
    // Upstream `从外面回家` calls `QoL_DateEndConfirm` whenever a date partner
    // is set, and aborts when the player declines.
    const confirmed = requireYesNo(ctx.promptAnswer);
    if (confirmed === false) {
      return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "决定再待一会儿。" }], outcome: "noop" };
    }
    const from = mapIdOfLocation(next.master.location) ?? next.dateSession?.mapId ?? 0;
    const home = mapIdOfLocation(next.homeLocation ?? next.master.homeLocation ?? "神社:倉庫") ?? 0;
    const entrance = odekakeDestinationForMap(home)?.representativeLocation
      ?? next.homeLocation
      ?? next.master.homeLocation
      ?? "神社:境内";
    // `QOL_RETURN_HOME_TIME_REQUIRED` reduces to `TIME_REQUIRED(约会中, MAIN_MAP)`
    // once the road stage is retired, which is exactly this matrix lookup.
    advanceTimeTicks(next, Math.max(1, dateTravelMinutes(from, home) ?? 1));
    setSlotLocation(next.master, entrance);
    const partner = next.charas[partnerNum];
    if (partner) setSlotLocation(partner, entrance);
    // Upstream `从外面回家` runs `お出かけイベント` on the way home for dates too
    // (the weather + road-encounter arms sit in front of `帰宅の時間経過`).
    // `move-to-home` skips this for a date because that command only serves the
    // ordinary-outing path; 19998 is the date's own return, so it runs them.
    // It clones, so this must run before the settlement below mutates `next`.
    const returning = runOutingReturnEvents(next, ctx.rng);
    if (returning) Object.assign(next, returning.state);
    // Upstream runs `DATE_EVENT` per partner *before* the date mirrors clear:
    // kiss / 反感刻印 / 告白 / 赠礼 / fallback SP_EVENT 3.
    const events = runDateEvent(next, partnerNum, {
      now: ctx.now,
      rng: ctx.rng,
      dialogueRouter: ctx.dialogueRouter,
    });
    const dressedUp = restoreDateOutfit(next, partnerNum);
    endDate(next, { resolution: "resolved" });
    // Re-read the partner: the return events replaced `next.charas` with their
    // own clone, so the pre-clone slot reference is stale.
    const settledPartner = next.charas[partnerNum];
    // Upstream clears the date flags after DATE_EVENT but does not dismiss the
    // companion. Preserve that distinct 同行 state at the home-map entrance.
    next.master.state.CFLAG[CFLAG_ID.同行] = 1;
    if (settledPartner) settledPartner.state.CFLAG[CFLAG_ID.同行] = 1;
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: "两人沿着熟悉的道路踏上归途。" },
        ...(returning?.events ?? []),
        ...events,
        ...(dressedUp
          ? [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `${settledPartner?.callName ?? "对方"}换回了原本的衣装。` }]
          : []),
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: `从约会中回来了。两人在${entrance}停下脚步，仍然结伴同行。` },
      ],
      outcome: "ok" as const,
      kojoHandled: true,
    };
  },
};
