import type { DatePlanEvent, GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { resolveEventKojoAndApply } from "../../kojo/effects.js";
import { datePlanScheduleLabel, offeredDateInvitations, scheduleAcceptedDate } from "../../world/date-appointments.js";
import { resolveDateInvitation } from "../../world/date-session.js";
import type { HandlerEntry } from "../types.js";

function offeredForTarget(
  state: Parameters<HandlerEntry["handler"]>[0]["state"],
  target: number,
): DatePlanEvent | undefined {
  return offeredDateInvitations(state).find((event) => event.partner === target);
}

function check(ctx: Parameters<NonNullable<HandlerEntry["execCheck"]>>[0]) {
  return offeredForTarget(ctx.state, ctx.target)
    ? { ok: true as const }
    : { ok: false as const, reason: { kind: "precondition" as const, message: "该角色当前没有等待回应的邀约。" } };
}

function responseKojo(
  ctx: Parameters<HandlerEntry["handler"]>[0],
  state: GameState,
  event: DatePlanEvent,
  response: 1 | 2,
) {
  if (!ctx.dialogueRouter) return [];
  return resolveEventKojoAndApply(ctx.dialogueRouter, state, event.partner, 27, ctx.rng, [response, 0])
    .map((line) => ({
      kind: "DIALOGUE_LINE" as const,
      timestamp: ctx.now(),
      charaNum: event.partner,
      text: line.text,
      form: line.form,
    }));
}

export const acceptDateInvitation19989HandlerEntry: HandlerEntry = {
  commandNo: 19989,
  execCheck: check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const event = offeredForTarget(next, ctx.target)!;
    const scheduled = scheduleAcceptedDate(next, event.id);
    if (!scheduled) {
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "暂时找不到双方都合适的时间，邀约仍保留着。" }],
        outcome: "noop",
        kojoHandled: true,
      };
    }
    const name = next.charas[event.partner]?.callName ?? `#${event.partner}`;
    return {
      state: next,
      events: [
        ...responseKojo(ctx, next, event, 1),
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `已接受${name}的邀约。约会时间：${datePlanScheduleLabel(scheduled)}。可在［日历］中查看或取消。`,
        },
      ],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};

export const declineDateInvitation19988HandlerEntry: HandlerEntry = {
  commandNo: 19988,
  execCheck: check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const event = offeredForTarget(next, ctx.target)!;
    resolveDateInvitation(next, event.id, false);
    const name = next.charas[event.partner]?.callName ?? `#${event.partner}`;
    return {
      state: next,
      events: [
        ...responseKojo(ctx, next, event, 2),
        { kind: "NARRATION", timestamp: ctx.now(), text: `已婉拒${name}的邀约。` },
      ],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};
