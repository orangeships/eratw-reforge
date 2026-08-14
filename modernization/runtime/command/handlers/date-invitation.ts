import type { DatePlanEvent } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { scheduleAcceptedDate } from "../../world/date-appointments.js";
import { resolveDateInvitation } from "../../world/date-session.js";
import type { HandlerEntry } from "../types.js";

function firstOffered(state: Parameters<HandlerEntry["handler"]>[0]["state"]): DatePlanEvent | undefined {
  return (state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && event.phase === "offered")
    .sort((a, b) => a.createdAtTick - b.createdAtTick || a.partner - b.partner)[0];
}

function check(ctx: Parameters<NonNullable<HandlerEntry["execCheck"]>>[0]) {
  return firstOffered(ctx.state) ? { ok: true as const } : { ok: false as const, reason: { kind: "precondition" as const, message: "返事を待っている誘いはありません。" } };
}

export const acceptDateInvitation19989HandlerEntry: HandlerEntry = {
  commandNo: 19989,
  execCheck: check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const event = firstOffered(next)!;
    const scheduled = scheduleAcceptedDate(next, event.id);
    return scheduled
      ? { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `${next.charas[event.partner]?.callName ?? `#${event.partner}`}との約束を受けた。` }], outcome: "ok" }
      : { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "共同の空き時間を見つけられなかった。" }], outcome: "noop" };
  },
};

export const declineDateInvitation19988HandlerEntry: HandlerEntry = {
  commandNo: 19988,
  execCheck: check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const event = firstOffered(next)!;
    resolveDateInvitation(next, event.id, false);
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "约会邀请已婉拒。" }], outcome: "ok" };
  },
};
