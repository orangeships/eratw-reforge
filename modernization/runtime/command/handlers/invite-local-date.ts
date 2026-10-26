/**
 * `USERCOM 992 邀请去约会` (ERB/コマンド関連/USERCOM.ERB:496-515) — the
 * in-place date invitation.
 *
 * Upstream has no destination and no road stage here; it only sets
 * `约会中 = 当前 MAPID`, `约会相手 = TARGET`, `约会前好感度` and `TIME += 1`.
 *
 * The interesting arm is the rival one: `@外出先から誘えるか`
 * (ERB/コマンド関連/外出先から帰宅.ERB:155-182) checks `FLAG:约会的对象` against
 * the *new* target first, and when the master is already dating somebody else
 * it plays the jealousy scene —
 * `KOJO_MESSAGE_SEND("EVENT",27, <current>, 90, 0)` followed by
 * `KOJO_MESSAGE_SEND("EVENT",27, <new>, 91, 0)` — and refuses. That scene is
 * content, not a bare error string, so the refusal is produced here instead of
 * short-circuiting in `execCheck`.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import { CFLAG_ID, TALENT_ID, advanceTimeTicks } from "../../state/settlement.js";
import { deriveRelationshipAuthority } from "../../state/attitude.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { startDate } from "../../world/date-session.js";

type Block = { ok: false; reason: { kind: "precondition"; message: string } };

/** The upstream jealousy arm, kept separate so the handler can act on it. */
interface Jealous {
  ok: true;
  rival: number;
}

type Check = Block | Jealous | { ok: true };

function check(state: Readonly<GameState>, target: number): Check {
  if (!state.outing) {
    return { ok: false, reason: { kind: "precondition", message: "只有普通外出时才能邀请当地角色约会。" } };
  }
  // `SIF LOCAL != ARG && LOCAL != MASTER` → the rival scene. The master can
  // never be a rival target, so any live session with a different partner is.
  const current = state.dateSession?.partner ?? 0;
  if (current !== 0 && current !== target && current !== state.master.charaNum) {
    return { ok: true, rival: current };
  }
  if (state.dateSession) {
    return { ok: false, reason: { kind: "precondition", message: "已经在约会中了。" } };
  }
  const slot = state.charas[target];
  if (!slot || slot.location !== state.master.location) {
    return { ok: false, reason: { kind: "precondition", message: "对方不在同一地点。" } };
  }
  const authority = deriveRelationshipAuthority(slot, state.master, state);
  const fallen = (slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0
    || (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0
    || (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  if (authority.angry || authority.attitude < 1 || !fallen || (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在无法邀请对方约会。" } };
  }
  return { ok: true };
}

export const inviteLocalDate992HandlerEntry: HandlerEntry = {
  commandNo: 992,
  execCheck: (ctx) => {
    const result = check(ctx.state, ctx.target);
    if (!result.ok) return result;
    if ("rival" in result) return { ok: true };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const gate = check(next, ctx.target);
    if (!gate.ok) {
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: gate.reason.message }],
        outcome: "blocked" as const,
        failReason: gate.reason,
      };
    }
    const target = next.charas[ctx.target]!;
    const targetName = target.callName ?? `#${ctx.target}`;

    // ── rival arm: EVENT 27 arm 90 (the current partner) then 91 (the rival) ──
    if ("rival" in gate) {
      const rival = next.charas[gate.rival];
      const rivalName = rival?.callName ?? `#${gate.rival}`;
      const events = [];
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        // Upstream picks one of five personality-flavoured refusal lines from
        // `CFLAG:性格傾向` before the kojo pair plays.
        text: `向${targetName}提出邀请，却注意到了${rivalName}。`,
      });
      for (const line of ctx.dialogueRouter?.resolveEventKojo?.(gate.rival, 90, next, ctx.rng) ?? []) {
        events.push({ kind: "DIALOGUE_LINE" as const, timestamp: ctx.now(), charaNum: gate.rival, text: line.text, form: line.form });
      }
      for (const line of ctx.dialogueRouter?.resolveEventKojo?.(ctx.target, 91, next, ctx.rng) ?? []) {
        events.push({ kind: "DIALOGUE_LINE" as const, timestamp: ctx.now(), charaNum: ctx.target, text: line.text, form: line.form });
      }
      events.push({ kind: "NARRATION" as const, timestamp: ctx.now(), text: `于是放弃了邀请${targetName}。` });
      return { state: next, events, outcome: "noop" as const, kojoHandled: true };
    }

    target.state.CFLAG[CFLAG_ID.同行] = 60;
    next.master.state.CFLAG[CFLAG_ID.同行] = 60;
    startDate(next, {
      partner: ctx.target,
      source: "local-992",
      mapId: mapIdOfLocation(next.master.location) ?? next.outing?.mapId ?? 0,
      destination: next.master.location,
    });
    advanceTimeTicks(next, 1);
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `邀请${targetName}开始了约会。` }],
      outcome: "ok" as const,
    };
  },
};
