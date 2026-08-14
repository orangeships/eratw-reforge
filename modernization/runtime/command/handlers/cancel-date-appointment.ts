import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { cancelDateAppointment } from "../../world/date-session.js";
import { pickOne, requirePickOne } from "../prompt.js";
import type { DatePlanEvent } from "../../state/game-state.js";

export const cancelDateAppointment19996HandlerEntry: HandlerEntry = {
  commandNo: 19996,
  prompt: (ctx) => pickOne("どの約束を取り消す？", (ctx.state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && ["scheduled", "waiting"].includes(event.phase))
    .map((event) => ({ id: event.id, label: `${ctx.state.charas[event.partner]?.callName ?? `#${event.partner}`} @ ${event.location ?? "未定"}` }))),
  execCheck: (ctx) => (ctx.state.worldEvents ?? []).some((event) => event.kind === "date-plan" && ["scheduled", "waiting"].includes(event.phase))
    ? { ok: true }
    : { ok: false, reason: { kind: "precondition", message: "取り消せる約束はありません。" } },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const id = String(requirePickOne(cancelDateAppointment19996HandlerEntry.prompt!(ctx)!, ctx.promptAnswer));
    const event = cancelDateAppointment(next, id);
    return event
      ? { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "约会预约已取消。" }], outcome: "ok" }
      : { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "无法取消该预约。" }], outcome: "noop" };
  },
};
