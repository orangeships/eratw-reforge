import type { HandlerEntry } from "../types.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import { CFLAG_ID, TALENT_ID, advanceTimeTicks } from "../../state/settlement.js";
import { deriveRelationshipAuthority } from "../../state/attitude.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { startDate } from "../../world/date-session.js";

function check(state: Readonly<GameState>, target: number) {
  if (!state.outing || state.dateSession) return { ok: false as const, reason: { kind: "precondition" as const, message: "只有普通外出时才能邀请当地角色约会。" } };
  const slot = state.charas[target];
  if (!slot || slot.location !== state.master.location) return { ok: false as const, reason: { kind: "precondition" as const, message: "对方不在同一地点。" } };
  const authority = deriveRelationshipAuthority(slot, state.master, state);
  const fallen = (slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  if (authority.angry || authority.attitude < 1 || !fallen || (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "现在无法邀请对方约会。" } };
  }
  return { ok: true as const };
}

export const inviteLocalDate992HandlerEntry: HandlerEntry = {
  commandNo: 992,
  execCheck: (ctx) => check(ctx.state, ctx.target),
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    target.state.CFLAG[CFLAG_ID.同行] = 60;
    next.master.state.CFLAG[CFLAG_ID.同行] = 60;
    startDate(next, { partner: ctx.target, source: "local-992", mapId: mapIdOfLocation(next.master.location) ?? next.outing?.mapId ?? 0, destination: next.master.location });
    advanceTimeTicks(next, 1);
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `邀请${target.callName ?? `#${ctx.target}`}开始了约会。` }], outcome: "ok" };
  },
};
