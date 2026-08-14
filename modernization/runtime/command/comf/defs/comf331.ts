/**
 * Phase 7 — `COMF331 お茶を淹れる（薬入り）` (brewed tea with drugs) settlement,
 * as a `ComfDef`.
 *
 * Ports `@COM331` + `@COM331_1`
 * (`ERB/コマンド関連/COMF/日常系/COMF331 お茶を淹れる（薬入り）.ERB`),
 * per-target settlement arm.
 *
 * Outcome roll (ERB 10-20):
 *   - `成功確率 = RAND:100`
 *   - ≤ 9 → 大成功 (TFLAG:193 = 1)
 *   - > 9 → 通常 (TFLAG:193 = 0)
 *   - No rolled failure; failure only when no target drinks (set in main body
 *     after the multi-target loop, → TFLAG:193 = -1).
 *   - → maxRoll 100, greatThreshold 10, failThreshold 100 (never rolled).
 *
 * SOURCE build (COM331_1, ERB 104-135):
 *   - 歓楽 = 500 + ABL:従順 bracket + CFLAG:好感度 bracket
 *     (then SIF < 0 → 0)
 *   - 受動 = 200 + 100 * ABL:従順
 *   - 征服 = 200 + 100 * ABL:施虐属性
 *
 * Outcome scaling (ERB 137-149):
 *   - TFLAG:193 == -1 (失敗): 歓楽 ×0.10, 征服 ×0.50, 受動 ×0.50
 *   - TFLAG:193 == 0  (通常): all ×1.00
 *   - TFLAG:193 == 1  (大成功): all ×2.00
 *   → 歓楽: MUL_PLEASURE, 征服/受動: MUL_POSITIVE.
 *
 * Master downbase (ERB 90-91): MASTER:気力 += 100, MASTER:体力 += 50.
 *
 * TARGET downbase (body, ERB 102): 気力 += 10 per target (always applied).
 *
 * **Drug-specific TARGET downbase is DEFERRED.**
 * The ERB writes `DOWNBASE:TARGET:気力 += 150` and `DOWNBASE:TARGET:体力 += 150`
 * for drug types 41 (媚薬), 42 (利尿剤), 250 (催情薬), and 47 (新鲜精液),
 * gated on `TFLAG:131` read inside `COM331_1`. `TFLAG` is not accessible
 * through the `ComfCtx` type — adding it requires a schema change.
 *
 * Similarly deferred: TCVAR drug markers (140 媚薬, 141 利尿剤, TBD 催情薬,
 * 148 睡眠薬強度, 150 睡眠薬お茶使用, TBD 新鲜精液), EXP:精飲経験++ (EXP id 15),
 * TALENT:調合知識 (55) detection-probability gating.
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - Multi-target loop (`FOR LOCAL, 1, GET_TARGETNUM() + 1`) — the factory
 *     handles a single target; the outer loop is a Phase 7 orchestrator concern.
 *   - `TFLAG:信頼度管理` trust-management flag arith.
 *   - KOJO messages (`KOJO_MESSAGE_SEND`).
 *   - Talent-based drink-refusal logic (TALENT:汚臭耐性 61, TALENT:調合知識 55).
 *   - `TCVAR:睡眠薬強度 >= 2` sleep-drug refusal check.
 *   - `SELECTCASE TFLAG:192` CASE 1/-1/-2 arms (forced success/failure).
 *   - `M_TFLAG:时间因子类型 = TimeFactor_调合`.
 *   - `TFLAG:131 = 0` cleanup.
 *   - `TCVAR:300` cooldown gating in `COM_ABLE331`.
 *   - FAVOR_CALC, TRUST_CALC, TALENT/MARK/DLC personality modifiers.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TCVAR_ID,
} from "../../../state/settlement.js";
import { getTflag, setTflag, TFLAG_ID } from "../../../state/tflag.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
} from "../comf-def.js";

// ---------------------------------------------------------------------------
// IDs not yet in settlement.ts enums
// ---------------------------------------------------------------------------

/** TCVAR id for お茶日時 (tea timestamp). */
const TCVAR_OCHA_TIME = 300;

// Deferred ERB ids (documented, not yet consumed by this ComfDef — they
// belong to branches `comf331` does not port: TALENT:調合知識=55,
// TALENT:汚臭耐性=61, TALENT:自己愛=31, TALENT:抵抗=32, TCVAR:睡眠薬強度=148).
// Kept as a comment, not live consts, so the browser `tsc` stays clean.

// ---------------------------------------------------------------------------
// ComfDef
// ---------------------------------------------------------------------------

export const comf331Def: ComfDef = {
  commandNo: 331,
  label: "お茶を淹れる（薬入り）",
  // @COM_ABLE331 (Slice 7): the unconditional modelable gates — target not
  // sleeping, not co-sleeping, master 気力>0, not time-stopped.
  gate: {
    notWhileTargetSleeping: true,
    notWhileCoSleeping: true,
    requiresMasterStamina: true,
    notWhileTimeStopped: true,
    deferredGates:
      "TIME_PROGRESS(TCVAR:300)<60 cooldown; !TFLAG:131 (drug unlock); BATHCHECK+AT_HOME; IS_DATING_WITH_PLAYER",
  },
  timeCost: 30,
  maxRoll: 100,
  greatThreshold: 10, // 成功確率 <= 9 → 大成功
  failThreshold: 100, // No rolled failure; fail only via body (no-target-drank)

  // ERB 90-91: MASTER:気力 += 100, MASTER:体力 += 50
  downbase: { [BASE_ID.気力]: 100, [BASE_ID.体力]: 50 },

  buildSources: (c) => {
    const juujun = c.tAbl(ABL_ID.従順);
    const gyakutai = c.tAbl(ABL_ID.施虐属性);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // 歓楽: base 500 + ABL:従順 bracket + CFLAG:好感度 bracket (ERB 105-131)
    let kanraku = 500;

    // ABL:従順 bracket (ERB 108-120)
    if (juujun <= 1) {
      kanraku += juujun * 60;
    } else if (juujun <= 3) {
      kanraku += 200 + juujun * 60;
    } else if (juujun <= 5) {
      kanraku += 500 + juujun * 60;
    } else if (juujun <= 8) {
      kanraku += 750 + juujun * 75;
    } else if (juujun <= 11) {
      kanraku += 1000 + juujun * 75;
    } else {
      kanraku += 2000 + juujun * 30;
    }

    // CFLAG:好感度 bracket on 歓楽 (ERB 123-129), then SIF < 0 → 0 (ERB 130-131)
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
    else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.受動]: 200 + 100 * juujun,                   // ERB 134
      [SOURCE_ID.征服]: 200 + 100 * gyakutai,                 // ERB 135
    };
  },

  // ERB 137-149: outcome-based source scaling
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,  // great 2.00 / fail 0.10
    [SOURCE_ID.受動]: MUL_POSITIVE,  // great 2.00 / fail 0.50
    [SOURCE_ID.征服]: MUL_POSITIVE,  // great 2.00 / fail 0.50
  },

  // No TFLAG:97 pre-seed in this command.
  favorBias: () => 0,

  /**
   * Per-target persisted side writes.
   *
   * ALWAYS applied (ERB 102, 181):
   *   - DOWNBASE:気力 += 10 (TARGET base drain)
   *   - TCVAR:300 = 1440 * DAY + TIME (tea timestamp marker)
   *
   * DEFERRED — drug-specific body (requires TFLAG:131 + 下药强度):
   *   - TCVAR:TARGET:媚薬(140) = 下药强度, DOWNBASE:TARGET:気力 += 150, DOWNBASE:TARGET:体力 += 150
   *   - TCVAR:TARGET:利尿剤(141) = 下药强度, same BASE drain
   *   - TCVAR:TARGET:催情薬(TBD) = 下药强度, same BASE drain
   *   - TCVAR:TARGET:睡眠薬強度(148) = 2, TCVAR:TARGET:睡眠薬茶使用(150) = 1
   *   - TCVAR:TARGET:新鲜精液(TBD) = 下药强度, same BASE drain, EXP:精飲経験(15)++
   *   - Gated on TFLAG:131 (41/42/250/252/47) which is not in ComfCtx.
   */
  body: (c) => {
    // ERB 102: DOWNBASE:気力 += 10 (always per target)
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 10;

    // ERB 181: TCVAR:300 = 1440 * DAY + TIME (tea timestamp marker).
    // = tickValue (absolute minute); old `1440*dayIndex + tickValue` doubled
    // the day — see comf302 / oracle 9912.
    c.t.state.TCVAR[TCVAR_OCHA_TIME] = c.next.time.tickValue;
  },

  narration: (c, favorDelta) => {
    const adj =
      c.outcome === 1 ? "流畅地" : c.outcome === -1 ? "不安地" : "";
    return `%CALLNAME:MASTER% ${adj} 给%CALLNAME:TARGET%端上了掺药的茶；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

const comf331RawHandlerEntry: HandlerEntry = makeComfHandler(comf331Def);

export const comf331HandlerEntry: HandlerEntry = {
  ...comf331RawHandlerEntry,
  execCheck: (ctx) => {
    const drug = getTflag(ctx.state, TFLAG_ID.下药选择);
    if (![41, 42, 47, 250, 252].includes(drug)) {
      return {
        ok: false,
        reason: { kind: "precondition", message: "需要先用下药命令准备茶中的药。" },
      };
    }
    return comf331RawHandlerEntry.execCheck?.(ctx) ?? { ok: true };
  },
  handler: (ctx) => {
    const drug = getTflag(ctx.state, TFLAG_ID.下药选择);
    const result = comf331RawHandlerEntry.handler(ctx);
    if (result.outcome !== "ok") return result;
    const target = result.state.charas[ctx.target];
    if (!target) return result;
    if (drug === 41) target.state.TCVAR[TCVAR_ID.媚薬] = 210;
    if (drug === 42) target.state.TCVAR[TCVAR_ID.利尿剤] = 210;
    if (drug === 250) target.state.TCVAR[TCVAR_ID.催情薬] = 210;
    if (drug === 252) {
      target.state.TCVAR[TCVAR_ID.睡眠薬強度] = Math.max(
        2,
        target.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0,
      );
      target.state.TCVAR[TCVAR_ID.睡眠薬茶使用] = 1;
    }
    if (drug === 47) {
      target.state.TCVAR[TCVAR_ID.新鲜精液] = 210;
      target.state.EXP[EXP_ID.精飲経験] = (target.state.EXP[EXP_ID.精飲経験] ?? 0) + 1;
    }
    if ([41, 42, 47, 250].includes(drug)) {
      target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 150;
      target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 150;
    }
    setTflag(result.state, TFLAG_ID.下药选择, 0);
    return result;
  },
};
