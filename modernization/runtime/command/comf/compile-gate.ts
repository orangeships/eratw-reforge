/**
 * UI review (2026-06-20) — shared `@COM_ABLE` gate compiler.
 *
 * Both command factories (`make-comf-handler.ts` for ComfDef commands and
 * `handlers/_template.ts` for the light-touch bespoke handlers) need to apply
 * the faithfully-extracted `@COM_ABLE` gate. This module holds the single
 * compiler so 305/306/311/312 (bespoke touch handlers that WIN over their
 * ComfDef) get the same intimacy/room/cooldown gating as the factory commands.
 */

import type { CommandContext, ExecCheck } from "../types.js";
import { CFLAG_ID, FLAG_ID, getMasterBase } from "../../state/settlement.js";
import { computeShinchitsu } from "../../state/attitude.js";
import { nemuke } from "../../state/nemuke.js";
import { roomProps } from "../comable/room-props.js";
import { hasPlace, PLACE_REST, PLACE_STUDY } from "../../world/place-flags.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import { canWaitHere } from "../../world/wait-spot.js";
import type { ComfGate } from "./comf-def.js";
import { COMABLE_GATES } from "./comable-gates.generated.js";
import { getTflag } from "../../state/tflag.js";
import { evaluateSemanticGateExpression } from "./semantic-gate.js";

const BASE_気力 = 1; // BASE_ID.気力 (settlement.ts).
const ABL_性別 = 2; // TALENT:2 — gender bitfield (bit0 = female).

/** ERA `TIME_PROGRESS(stamp)` = current absolute time − the stored stamp.
 *  A stamp of 0 (never fired) → progress huge → cooldown satisfied. */
function timeProgress(state: { time: { tickValue: number } }, stamp: number): number {
  if (!stamp) return Number.MAX_SAFE_INTEGER;
  return state.time.tickValue - stamp;
}

/**
 * Compile a declarative {@link ComfGate} into an `execCheck` (the upstream
 * `@COM_ABLE` predicate). Runs the requested guards in upstream order and
 * returns the first failure's reason. `requiresTarget` adds the no-target
 * guard up front (matching the factory's handler precondition).
 */
export function compileGate(
  gate: ComfGate | undefined,
  requiresTarget: boolean,
  label: string,
): ExecCheck | undefined {
  if (!gate && !requiresTarget) return undefined;
  return (ctx: CommandContext) => {
    const block = (message: string) =>
      ({ ok: false as const, reason: { kind: "precondition" as const, message } });
    const target = ctx.state.charas[ctx.target];
    if (requiresTarget && (ctx.target <= 0 || !target)) {
      return block(`${label} 需要在场的目标。`);
    }
    if (!gate) return { ok: true };
    const t = target;
    const cflag = (id: number) => (t?.state.CFLAG[id] ?? 0);
    if (
      gate.semanticBlockers?.some((expression) =>
        evaluateSemanticGateExpression(expression, ctx)
      )
    ) {
      return block("当前状态不满足该命令的条件。");
    }
    if (gate.notWhileTimeStopped && (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return block("时间停止中无法进行。");
    // `SIF TCVAR:MASTER:亲热 < n → RETURN 0`. Upstream `TCVAR:MASTER:亲热` is
    // refreshed EVERY turn by INFO.ERB (1130-1146) from the target's 態度; our
    // runtime has no per-turn INFO pass, so the stored master TCVAR:130 is
    // never written during play (only `seedIntimacy`, a test helper, touches
    // it) and would sit at 0 forever — blocking every touch command regardless
    // of 好感/信頼/親密. Derive it on demand instead, exactly like COMF350
    // 押し倒す does (`computeShinchitsu(target, master)`); the single-target
    // command context collapses master 亲热 to the focused target's.
    if (gate.minIntimacy !== undefined) {
      const shinchitsu = t
        ? computeShinchitsu(t, ctx.state.master, ctx.state)
        : 0;
      if (shinchitsu < gate.minIntimacy) return block("亲热度不足。");
    }
    if (gate.notWhileTargetSleeping && cflag(CFLAG_ID.睡眠) !== 0)
      return block("目标正在睡觉。");
    if (gate.notWhileCoSleeping && cflag(CFLAG_ID.陪睡中) !== 0)
      return block("陪睡中无法进行。");
    if (gate.notWhilePranking && cflag(CFLAG_ID.恶作剧) !== 0)
      return block("恶作剧模式中无法进行。");
    if (gate.notWhileTargetWorking && cflag(CFLAG_ID.行动) === 5)
      return block("目标工作中。");
    if (gate.requiresFemaleTarget && ((t?.state.TALENT[ABL_性別] ?? 0) & 1) === 0)
      return block("目标性别不符。");
    if (gate.requiresMasterStamina && (getMasterBase(ctx.state, BASE_気力) ?? 0) <= 0)
      return block("气力不足。");
    if (gate.notWhileMasterHMode && (ctx.state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0)
      return block("诶嘿嘿中无法进行。");
    if (gate.cooldown && timeProgress(ctx.state, t?.state.TCVAR[gate.cooldown.tcvarId] ?? 0) < gate.cooldown.minutes)
      return block("还需要等一会儿。");
    // Location-based gates (read the MASTER's current room).
    if (
      gate.requiresIndoor || gate.notWhileBath ||
      gate.requiresPrivateRoom || gate.requiresTrainingRoom || gate.requiresStudyRoom || gate.requiresWaitSpot
    ) {
      const room = roomProps(ctx.state.master.location);
      if (gate.requiresIndoor && !room.indoor) return block("需要在室内进行。");
      if (gate.notWhileBath && room.bath) return block("这里是浴室，不合适。");
      // COM403 uses the home/rest predicate. The modern Hakurei onsen is an
      // explicit self-care venue, so it is accepted even without PLACE_REST;
      // an ordinary bath/changing room remains a separate upstream gate.
      const masterHome = ctx.state.homeLocation ?? ctx.state.master.homeLocation;
      if (
        gate.requiresPrivateRoom &&
        ctx.state.master.location !== masterHome &&
        !hasPlace(placeFlagsOf(ctx.state.master.location), PLACE_REST) &&
        ctx.state.master.location !== "神社:温泉"
      ) return block("需要回到初始位置，或在可休息地点进行。");
      if (gate.requiresTrainingRoom && !room.training) return block("这里无法进行训练。");
      // ROOMSETTING marks 神社:居間 as a study-capable room as well; rely on
      // the authoritative PLACE_STUDY bit without a location-name exception.
      if (gate.requiresStudyRoom && !hasPlace(placeFlagsOf(ctx.state.master.location), PLACE_STUDY))
        return block("这里不适合学习。");
      if (gate.requiresWaitSpot && !canWaitHere(ctx.state.master.location))
        return block("这里不适合等待。");
    }
    // `SIF CFLAG:MASTER:現在位置 != CFLAG:MASTER:311 → RETURN 0` — the
    // master must be in their own initial room (CFLAG:初期位置, modern
    // `state.homeLocation`). Stricter than `requiresPrivateRoom` (any
    // private room passes that; this requires specifically the player's
    // own room). Used by 417 昼寝 — the nap is allowed only at home.
    if (gate.atMasterHome) {
      const home = ctx.state.homeLocation ?? ctx.state.master.homeLocation;
      if (!home || ctx.state.master.location !== home) {
        return block("需要回到自己的房间。");
      }
    }
    // 照料/介抱 require a passed-out-drunk target (CFLAG:職種==酔いつぶれ).
    // The job system isn't modeled → the target is never drunk → this gate
    // blocks faithfully (照料 only appears in that scenario).
    if (gate.requiresDrunkTarget) return block("对方现在不需要照料。");
    // 碰杯 requires a banquet-participant target (CFLAG:職種==JOB_宴会参加=49).
    // The world banquet scheduler projects JOB_宴会参加 while the event is active.
    if (gate.requiresBanquetParticipant && cflag(CFLAG_ID.职种) !== 49)
      return block("对方没有在参加宴会。");
    // 戦闘訓練 etc. blocked while target is in partner-led (逆推) H-mode.
    if (gate.notWhilePartnerLedH && cflag(CFLAG_ID.诶嘿嘿) === 2)
      return block("对方正主导中，无法进行。");
    // NEMUKE() sleepiness bounds (403 休憩 / 417 昼寝). Parity QA Wave 7.
    if (gate.nemuke) {
      const drowsy = nemuke(ctx.state);
      if (gate.nemuke.min !== undefined && drowsy < gate.nemuke.min)
        return block("现在还不困。");
      if (gate.nemuke.max !== undefined && drowsy > gate.nemuke.max)
        return block("现在太困了，没法休息。");
    }
    // `SIF TFLAG:<id> > 0 → RETURN 0` — 1/day gate (417 昼寝's 午睡 flag).
    if (gate.blocksIfTflagSet !== undefined && getTflag(ctx.state, gate.blocksIfTflagSet) !== 0)
      return block("今天已经休息过了。");
    return { ok: true };
  };
}

/** Merge the auto-extracted `@COM_ABLE` gate for `commandNo` under an explicit
 *  gate (the explicit one wins per-field). Returns undefined if neither has
 *  any field. */
export function mergedGateFor(
  commandNo: number,
  explicit?: ComfGate,
): ComfGate | undefined {
  const auto = COMABLE_GATES[commandNo];
  if (!auto && !explicit) return undefined;
  return { ...auto, ...explicit };
}
