import type { HandlerEntry } from "../types.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import { CFLAG_ID, TALENT_ID, advanceTimeTicks } from "../../state/settlement.js";
import { deriveRelationshipAuthority } from "../../state/attitude.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { startDate } from "../../world/date-session.js";

function check(state: Readonly<GameState>, target: number) {
  if (!state.outing || state.dateSession) return { ok: false as const, reason: { kind: "precondition" as const, message: "普通外出中だけ現地の相手を約会に誘えます。" } };
  const slot = state.charas[target];
  if (!slot || slot.location !== state.master.location) return { ok: false as const, reason: { kind: "precondition" as const, message: "相手が同じ場所にいません。" } };
  const authority = deriveRelationshipAuthority(slot, state.master, state);
  const fallen = (slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 || (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  if (authority.angry || authority.attitude < 1 || !fallen || (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "今は約会に誘えません。" } };
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
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `${target.callName ?? `#${ctx.target}`}を誘って約会を始めた。` }], outcome: "ok" };
  },
};
