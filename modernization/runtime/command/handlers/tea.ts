/**
 * COMF301 お茶を淹れる / 泡茶.
 *
 * Upstream is not a single-target command even though the UI has a focused
 * TARGET: `@COM301` loops over every present TARGET (`GET_TARGETNUM`) and runs
 * `COM301_1` for each awake chara in the current scene. The previous modern
 * handler only touched the focused target, so tea looked "matched" but most of
 * the real gameplay settlement (SOURCE -> PALAM/CFLAG for everyone nearby) was
 * missing.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { presentNpcs } from "../../scene/presence.js";
import { applySourceCheck } from "../source-check.js";
import { getCurrentRoomProps } from "../comable/shrine-rooms.js";
import { chkDateNow } from "../../world/location-predicates.js";
import type { CommandContext, CommandResult, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

// Numeric ids are pinned in settlement.ts / CSV and mirrored here so this
// file stays robust across mojibake-prone terminals.
const BASE_体力 = 0;
const BASE_気力 = 1;
const ABL_親密 = 9;
const ABL_従順 = 10;
const ABL_施虐属性 = 16;
const CFLAG_好感度 = 2;
const CFLAG_睡眠 = 313;
const CFLAG_陪睡中 = 334;
const CFLAG_约会中 = 12;
const FLAG_時間停止 = 70;
const TCVAR_飲茶時刻 = 300;
const SOURCE_歓楽 = 20;
const SOURCE_征服 = 21;
const SOURCE_受動 = 22;

/** @COM_ABLE301's 60-minute cooldown (魔改 lowered the original 120). */
const TEA_COOLDOWN_MIN = 60;

const times = (value: number, mul: number): number => Math.trunc(value * mul);

function teaTrackerSlot(state: Readonly<GameState>, target: number): Readonly<CharaSlot> {
  return target > 0 && state.charas[target] ? state.charas[target]! : state.master;
}

function teaTrackerValue(state: Readonly<GameState>, target: number): number {
  return teaTrackerSlot(state, target).state.TCVAR[TCVAR_飲茶時刻] ?? 0;
}

function sourceForTeaTarget(slot: CharaSlot, outcome: -1 | 0 | 1): Record<number, number> {
  const abl = slot.state.ABL;
  const cflag = slot.state.CFLAG;

  const juujun = abl[ABL_従順] ?? 0;
  let kanraku = 500;
  if (juujun <= 1) kanraku += juujun * 60;
  else if (juujun <= 3) kanraku += 200 + juujun * 60;
  else if (juujun <= 5) kanraku += 500 + juujun * 60;
  else if (juujun <= 8) kanraku += 750 + juujun * 75;
  else if (juujun <= 11) kanraku += 1000 + juujun * 75;
  else kanraku += 2000 + juujun * 30;

  const favor = cflag[CFLAG_好感度] ?? 0;
  if (favor <= 500) kanraku += favor;
  else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
  else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
  kanraku = Math.max(0, kanraku);

  const sources: Record<number, number> = {
    [SOURCE_歓楽]: kanraku,
    [SOURCE_受動]: 200 + 100 * juujun,
    [SOURCE_征服]: 200 + 100 * (abl[ABL_施虐属性] ?? 0),
  };

  if (outcome === -1) {
    sources[SOURCE_歓楽] = times(sources[SOURCE_歓楽]!, 0.1);
    sources[SOURCE_征服] = times(sources[SOURCE_征服]!, 0.5);
    sources[SOURCE_受動] = times(sources[SOURCE_受動]!, 0.5);
  } else if (outcome === 1) {
    sources[SOURCE_歓楽] = times(sources[SOURCE_歓楽]!, 2.0);
    sources[SOURCE_征服] = times(sources[SOURCE_征服]!, 2.0);
    sources[SOURCE_受動] = times(sources[SOURCE_受動]!, 2.0);
  }

  return sources;
}

function outcomeRoll(ctx: CommandContext): -1 | 0 | 1 {
  const roll = ctx.rng.int(100);
  // GET_SUCCESS_RATE and DLC success modifiers are deferred elsewhere; use
  // the same clean-state thresholds as the ComfDef family.
  if (roll <= 9) return 1;
  if (roll >= 90) return -1;
  return 0;
}

function trustSeed(outcome: -1 | 0 | 1): number {
  // @COM301: TFLAG:信頼度管理 = 2/-2/0, then unconditional += 3.
  if (outcome === 1) return 5;
  if (outcome === -1) return 1;
  return 3;
}

function teaExecCheck(ctx: CommandContext): ReturnType<NonNullable<HandlerEntry["execCheck"]>> {
  const block = (message: string) =>
    ({ ok: false as const, reason: { kind: "com_able" as const, code: 301, message } });

  if ((ctx.state.flagStore[FLAG_時間停止] ?? 0) !== 0) {
    return block("时间停止中，无法泡茶。");
  }
  if ((ctx.state.master.state.BASE[BASE_気力] ?? 0) <= 0) {
    return block("气力不足，没精神泡茶。");
  }

  // P1-3 (实玩反馈 #8, user-requested deviation from upstream): hide tea when
  // the player is alone. Upstream `@COM_ABLE301` has NO target-required gate
  // (solo tea is allowed upstream, and the handler keeps a solo fallback), but
  // the user reports original-eraTW does not show the 泡茶 command when no one
  // is around to drink with. Block unless at least one AWAKE NPC is present in
  // the current scene (sleeping charas can't share tea).
  const awakeGuests = presentNpcs(ctx.state, ctx.state.master.location).filter(
    (slot) => (slot.state.CFLAG[CFLAG_睡眠] ?? 0) === 0,
  );
  if (awakeGuests.length === 0) {
    return block("没有可以一起喝茶的人。");
  }

  const target = ctx.target > 0 ? ctx.state.charas[ctx.target] : undefined;
  if (target) {
    if ((target.state.CFLAG[CFLAG_睡眠] ?? 0) !== 0) return block("目标正在睡觉。");
    if ((target.state.CFLAG[CFLAG_陪睡中] ?? 0) !== 0) return block("陪睡中无法泡茶。");
    // Upstream `@COM_ABLE301:221` — `!AT_HOME(MASTER) && ABL:親密 < 3 → RETURN 0`.
    // AT_HOME(MASTER) = IN_HOME(現在位置) (COMMON2.ERB:51): true whenever the master
    // stands in ANY 拠点/base map — 神社/命蓮寺/紅魔館/竹林 are all 拠点 — and false
    // ONLY on a 外出/ODEKAKE date field. So this intimacy gate fires only while on a
    // date outing, NOT merely because the master left their own home map. (The old
    // `same-map-as-home` check wrongly blocked 泡茶 on 命蓮寺/紅魔館/竹林 where NPC
    // 親密 starts < 3.)
    const onDateOuting = chkDateNow(ctx.state.master.state.CFLAG[CFLAG_约会中] ?? 0);
    if (onDateOuting && (target.state.ABL[ABL_親密] ?? 0) < 3) {
      return block("外出约会时需要亲密达到 3 才能泡茶。");
    }
  }

  const since = ctx.state.time.tickValue - teaTrackerValue(ctx.state, ctx.target);
  if (since < TEA_COOLDOWN_MIN) {
    return block("刚泡过茶，再等一会儿吧。");
  }

  // Upstream has no kitchen/dining restriction. Tea is available anywhere
  // the ordinary target/cooldown/stamina gates pass, except a bath room.
  const room = getCurrentRoomProps(ctx.state.master.location);
  if (room?.bath) {
    return block("浴室里无法泡茶。");
  }

  return { ok: true };
}

export const teaHandlerEntry: HandlerEntry = {
  commandNo: 301,
  execCheck: teaExecCheck,
  handler: (ctx: CommandContext): CommandResult => {
    let next = cloneGameState(ctx.state as GameState);
    const outcome = outcomeRoll(ctx);
    const trust = trustSeed(outcome);
    const events: ObservationEvent[] = [];
    let pendingKojoChoice: CommandResult["pendingKojoChoice"];

    // @COM301: DOWNBASE:MASTER:気力 += 100 / 体力 += 50.
    next.master.state.BASE[BASE_気力] = (next.master.state.BASE[BASE_気力] ?? 0) - 100;
    next.master.state.BASE[BASE_体力] = (next.master.state.BASE[BASE_体力] ?? 0) - 50;

    const affected = presentNpcs(next, next.master.location)
      .filter((slot) => (slot.state.CFLAG[CFLAG_睡眠] ?? 0) === 0);

    for (const slot of affected) {
      // @COM301_1: DOWNBASE:TARGET:気力 += 10, then SOURCE settlement.
      slot.state.BASE[BASE_気力] = (slot.state.BASE[BASE_気力] ?? 0) - 10;
      const settled = applySourceCheck(
        next,
        slot.charaNum,
        sourceForTeaTarget(slot, outcome),
        0,
        trust,
      );
      for (const e of settled.events) {
        events.push("text" in e ? {
          ...e,
          timestamp: ctx.now(),
          text: `%CALLNAME:${slot.charaNum}% ${e.text}`,
        } : {
          ...e,
          timestamp: ctx.now(),
        });
      }

    }

    // COM301 is multi-target: settle everyone first, then resolve each
    // personal route against the shared post-settlement state. Effects are
    // committed between targets in source order, matching the upstream loop.
    for (const slot of affected) {
      const kojo = collectCommandKojo({ ...ctx, state: next }, slot.charaNum, 301);
      events.push(...kojo.events);
      if (kojo.effects.length > 0) next = applyKojoEffects(next, kojo.effects);
      if (kojo.pendingKojoChoice) {
        pendingKojoChoice = kojo.pendingKojoChoice;
        break;
      }
    }

    // `COM301_1` writes TCVAR:300 before COM301's trailing `TIME += 30`.
    // Stamping after the advance accidentally turns the intended 60-minute
    // interval into 90 minutes measured from the action start.
    const teaTick = next.time.tickValue;
    const dayEndEvents = advanceTimeTicks(next, 30);
    if (affected.length === 0) {
      next.master.state.TCVAR[TCVAR_飲茶時刻] = teaTick;
    } else {
      for (const slot of affected) {
        const current = next.charas[slot.charaNum];
        if (current) current.state.TCVAR[TCVAR_飲茶時刻] = teaTick;
      }
    }

    const narration: ObservationEvent = {
      kind: "NARRATION",
      timestamp: ctx.now(),
      text: affected.length > 0
        ? "泡好了茶，在场的人都端起了茶杯。"
        : "泡好了茶，独自慢慢喝了一杯。",
    };

    return {
      state: next,
      events: [
        narration,
        ...events,
        ...dayEndEvents.map((e) => ({ ...e, timestamp: ctx.now() })),
      ],
      outcome: "ok",
      pendingKojoChoice,
      kojoHandled: true,
    };
  },
};
