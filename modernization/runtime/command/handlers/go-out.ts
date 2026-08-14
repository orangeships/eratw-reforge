/**
 * Slice O1 — COMF405 外出 / ODEKAKE entry.
 *
 * This is the modern equivalent of `@COM405` → `OTHERREGIONS("外出")` for the
 * narrowed date subsystem: a B9 `pick_one` over built ODEKAKE destinations,
 * then `enterOdekake` writes the MAPID-backed `CFLAG:约会中` state. The rich
 * GMF field map, road encounters, and full companion invitation logic are
 * later O-slices; this file only opens the state gate for already-ported
 * date commands.
 */

import type { GameState } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterCflag,
} from "../../state/settlement.js";
import { atPlayerBase, chkDateNow, isGapGuest } from "../../world/location-predicates.js";
import {
  ODEKAKE_DESTINATIONS,
  enterOdekake,
  odekakeDestinationForMap,
} from "../../world/odekake.js";
import { runOutingDepartureEvents } from "../../world/outing-events.js";
import { canStartPlayerDate, startDate } from "../../world/date-session.js";
import { dateTravelMinutes } from "../../world/date-travel-time.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";

const GO_OUT_TIME_COST = 5;

function block(message: string): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

function goOutPrompt(_ctx: CommandContext): PromptSpec {
  return pickOne(
    "どこへ出かける？",
    ODEKAKE_DESTINATIONS.map((d) => ({
      id: d.mapId,
      label: d.label,
    })),
  );
}

function checkGoOut(
  state: Readonly<GameState>,
  actor: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("外出は主人公だけが実行できます。");
  if (!atPlayerBase(state as GameState, 0)) return block("据点外では外出を開始できません。");
  if (chkDateNow(state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0)) {
    return block("すでに外出中です。");
  }
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return block("時間停止中です。");
  if (((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0) return block("潜伏中です。");
  if (isGapGuest(state as GameState, 0)) return block("隙間客の状態では外出できません。");
  if (getMasterCflag(state as GameState, CFLAG_ID.睡眠) !== 0) return block("睡眠中です。");
  if (getMasterCflag(state as GameState, CFLAG_ID.陪睡中) !== 0) return block("陪睡中です。");
  if (getMasterCflag(state as GameState, CFLAG_ID.恶作剧) !== 0) return block("恶作剧中です。");
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) === 2) {
    return block("今は外出できません。");
  }
  return { ok: true };
}

export const goOut405HandlerEntry: HandlerEntry = {
  commandNo: 405,
  prompt: goOutPrompt,
  execCheck: (ctx) => checkGoOut(ctx.state, ctx.actor),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const spec = goOutPrompt(ctx);
    if (!ctx.promptAnswer) {
      return { state: next, events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "行き先が決まっていません。" }], outcome: "noop" as const };
    }
    const picked = requirePickOne(spec, ctx.promptAnswer);
    const mapId = typeof picked === "number" ? picked : Number(picked);
    const destination = Number.isFinite(mapId)
      ? odekakeDestinationForMap(mapId)
      : undefined;

    if (!destination) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "行き先が決まっていません。" },
        ],
        outcome: "noop" as const,
      };
    }

    const companions = Object.values(next.charas)
      .filter((slot) => (slot.state.CFLAG[CFLAG_ID.同行] ?? 0) > 0)
      .map((slot) => slot.charaNum)
      .sort((a, b) => a - b);
    if (companions.length > 1) {
      return { state: next, events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "单人约会模式不能带多名同行者外出。" }], outcome: "noop" as const };
    }
    if (companions.length === 1) {
      const check = canStartPlayerDate(next, companions[0]!);
      if (!check.ok) return { state: next, events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: check.reason }], outcome: "noop" as const };
    }
    const originLocation = next.master.location;
    const originMapId = mapIdOfLocation(originLocation) ?? 0;
    const entered = enterOdekake(next, destination.mapId, companions.length === 0 ? companions : []);
    if (companions.length === 1) {
      const travelMinutes = dateTravelMinutes(originMapId, destination.mapId) ?? 0;
      if (travelMinutes > 0) setSlotLocation(next.master, originLocation);
      startDate(next, { partner: companions[0]!, source: "player-405", mapId: destination.mapId, destination: destination.representativeLocation, travelMinutes });
    }
    advanceTimeTicks(next, GO_OUT_TIME_COST);
    const outing = runOutingDepartureEvents(next, ctx.rng);

    const partner =
      companions.length > 0
        ? next.charas[companions[0]!]?.callName ?? `#${companions[0]}`
        : null;
    const text =
      partner != null
        ? `${partner}と一緒に${entered.label}へ出かけた。`
        : `${entered.label}へ出かけた。`;

    return {
      state: outing.state,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...outing.events],
      outcome: "ok" as const,
    };
  },
};
