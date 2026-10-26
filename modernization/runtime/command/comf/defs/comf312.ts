/**
 * Phase 7 — `COMF312 キスする` (kiss) settlement, as a `ComfDef`.
 *
 * Ports `@COM312` (`ERB/コマンド関連/COMF/日常系/COMF312 キスする.ERB`),
 * the time-stop, ordinary CASE 0, forced outcome, early termination, and
 * pre-roll REJECT_CHECK refusal arms. Other side conditions remain DEFERRED:
 *
 *   - 甲斐性無 FOR-loop (ERB 14-28) — multi-target interactive check
 *   - TCVAR:314 is written by ordinary kisses; its conditional cooldown is
 *     modeled in the exact @COM_ABLE312 override below (ERB 272-273, 306)
 *   - TFLAG:积攒度 LIMIT (ERB 154-155) — MAGIC_DLC_好感亲密重做
 *   - 体目当て (CFLAG 339) → 情愛 *= 3 (ERB 180-181)
 *   - MAGIC_DLC_* and M_TFLAG:成功; first-action failure suppression is
 *     modeled, but DLC-only success-rate additions are not
 *   - RELATION:CHARA:R compatibility term in GET_SUCCESS_RATE (COMMON_J.ERB)
 *   - FAVOR_CALC, TRUST_CALC, TALENT/MARK/DLC personality modifiers
 *
 * Outcome roll (ERB CASE 0):
 *   - `LOCAL = RAND:110` → maxRoll 110.
 *   - `LOCAL:2 = 29` (more lenient than most); `IF LOCAL <= LOCAL:2` → 大成功
 *     ⇒ roll <= 29 ⇒ greatThreshold 30.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5`, clamped ≤ 109. The available
 *     non-Magic GET_SUCCESS_RATE inputs are modeled; RELATION:R and Magic-DLC
 *     variants remain deferred.
 *   - `TIME += 5` → timeCost.
 *
 * SOURCE build (ERB 115-152):
 *   - fixed: 快Ｍ = ABL:PLAYER:舌*2 + 10  (dual-write: target AND master)
 *   - fixed: 歓楽 150 / 情愛 150 / 露出 80 / 反感 300
 *   - CFLAG:睡眠 → 反感 = 200 (overrides the 300 base)
 *   - ABL:親密 bracket (6 arms) on 歓楽/情愛/欲情/露出 (lower arms 情愛 only;
 *     mid arms add 欲情; higher arms add all 4)
 *   - CFLAG:好感度 bracket: 歓楽/情愛 adds
 *   - 受動 = 150 + 300 * ABL:従順
 *   - 征服 = 150 + 300 * ABL:施虐属性
 *
 * Outcome scaling (ERB 233-253):
 *   - 歓楽: great 2.00 / fail 0.10
 *   - 情愛: great 2.00 / fail 0.50
 *   - 征服: great 2.00 / fail 0.50
 *   - 受動: great 2.00 / fail 0.50
 *   - 露出: great 1.80 / fail 0.40
 *   - 快Ｍ/反感/恭順/欲情 NOT in the TIMES block → MUL_NONE
 *
 * **DEVIATIONS** (intentionally not modeled in the factory):
 *   - LOCAL:2 == 1 (two-kiri) ×1.20 bonus on 歓楽/情愛/征服/受動 and
 *     else branch ×0.70-1.10 mixed scaling (ERB 195-206) — multi-target/同室
 *     check, factory has no access to CHARANUM
 *   - 情緒 (BASE:情緒 == MAXBASE:情緒 / <600 / <=200) ×1.30/×0.70-0.50/×0.40
 *     scaling (ERB 207-226) — needs 情緒 read
 *   - TALENT:接吻魔 (id 77) ×1.40 on 歓楽/情愛 (ERB 227-231) — multiplicative
 *     factory outcomeMul has no per-source "always" slot
 *   - 体目当て CFLAG:339 → 情愛 *= 3 (ERB 180-181)
 *   - 露出 ×0.90 on 通常 (ERB 244) — factory has no per-source 通常 slot
 *
 * favorBias (ERB 170-178, gated on !CFLAG:睡眠): low-favor penalty brackets
 * (CFLAG:2 <=100/300/500). When asleep → 0.
 *
 * DOWNBASE (ERB 105-113): 気力 70 (default) + MASTER:気力 100; 陪睡中 case:
 * master only 50; CHK_DATENOW(约会中) case: 気力 30 + MASTER:気力 50.
 * Default to non-陪睡中 / non-约会中 arm: master 100 here, target 70 in body.
 *
 * Persisted writes include ordinary/stop-branch kiss EXP, date EXP on great
 * success while dating, same-sex EXP, TFLAG:キス合意取得, and TCVAR:ＦＫ喪失.
 *
 * **B1b — Dual-participant master SOURCE**: ERB writes
 * `SOURCE:PLAYER:快Ｍ = ABL:舌*2 + 10` (ERB 117). This is the master's
 * own pleasure; settled into the master's PALAM without 好感度 machinery.
 */

import type { CommandContext, HandlerEntry } from "../../types.js";
import type { GameState } from "../../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  palamLevel,
} from "../../../state/settlement.js";
import {
  computeShinchitsu,
  isOtokoGirai,
  liftedConsentJudgement,
} from "../../../state/attitude.js";
import { activeDatePartner } from "../../../world/date-session.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { getTflag, setTflag, TFLAG_ID } from "../../../state/tflag.js";
import {
  MUL_NONE,
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
  type ComfOutcome,
  type ComfOutcomeResolution,
  type OutcomeMul,
} from "../comf-def.js";

/** 露出: great 1.80 / fail 0.40. */
const MUL_ROSHUTSU: OutcomeMul = { great: 1.8, fail: 0.4 };

/** ABL id for 舌 (tongue technique). */
const ABL_PLAYER_TONGUE = ABL_ID.舌;
const REJECTED_KISS: ComfOutcome = 99;
const KISS_HISTORY_CONSENT_BIT = 2;

/** `IS_FALLEN()` (COMMON.ERB:3538-3544) used by COM_ABLE312's cooldown
 * exception. 恋人 is not one of its terms; 思慕, 恋慕, セフレ, and 愛欲 are. */
function isKissGateFallen(target: GameState["charas"][number]): boolean {
  if (!target) return false;
  return [TALENT_ID.思慕, TALENT_ID.恋慕, TALENT_ID.セフレ, TALENT_ID.愛欲]
    .some((id) => (target.state.TALENT[id] ?? 0) !== 0);
}

/**
 * COM_ABLE312 (COMF312 ERB:282-318) has an outer condition around intimacy,
 * sleep/work, and kiss cooldown. The generated declarative gate flattens that
 * branch and would over-block time-stop/stealth cases, as well as applying the
 * 甲斐性無 intimacy floor to everyone. Keep this one predicate source-faithful.
 * Shared TFLAG:100 / GLOBAL_COMABLE preambles are handled at the command layer.
 */
function checkKissGate(ctx: CommandContext) {
  const block = (message: string) => ({
    ok: false as const,
    reason: { kind: "precondition" as const, message },
  });
  const target = ctx.state.charas[ctx.target];
  if (ctx.target <= 0 || !target) return block("亲吻需要在场的目标。");

  const c = target.state.CFLAG;
  const targetHMode = c[CFLAG_ID.诶嘿嘿] ?? 0;
  const sleeping = (c[CFLAG_ID.睡眠] ?? 0) !== 0;
  const targetCanActDuringStop = (c[CFLAG_ID.時間停止行動] ?? 0) === 1;
  const inStealthPose = ((c[CFLAG_ID.潜伏状態] ?? 0) & 1) !== 0;
  const timeStopped = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const conditionalGatesApply = (!timeStopped || targetCanActDuringStop) && !inStealthPose;

  if (conditionalGatesApply) {
    const intimacy = computeShinchitsu(target, ctx.state.master, ctx.state);
    if (intimacy < 1 && !sleeping) return block("亲热度不足。");

    if (
      (ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0 &&
      ((intimacy < 2 && !sleeping) || ((c[CFLAG_ID.既成事実] ?? 0) & 1) === 0)
    ) return block("还需要更多亲热或既成事实。");

    if (
      sleeping &&
      (c[CFLAG_ID.恶作剧] ?? 0) === 0 &&
      (c[CFLAG_ID.陪睡中] ?? 0) === 0
    ) return block("目标正在睡觉。");
    if ((c[CFLAG_ID.行动] ?? 0) === 5) return block("目标工作中。");

    const lastKiss = target.state.TCVAR[TCVAR_ID.キス日時] ?? 0;
    if (
      ctx.state.time.tickValue - lastKiss < 60 &&
      !isKissGateFallen(target) &&
      targetHMode !== 2
    ) return block("距离上次亲吻还不到一小时。");
  }

  if ((ctx.state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
    return block("气力不足。");
  }
  return { ok: true as const };
}

/** Non-Magic branch of COMMON_J.ERB:@GET_SUCCESS_RATE. RELATION:R is not
 * represented in GameState yet, so its compatibility modifier is deferred. */
function kissSuccessRate(target: GameState["charas"][number], next: GameState): number {
  if (!target) return 0;
  const t = target.state;
  const master = next.master.state;
  const talent = (id: number) => t.TALENT[id] ?? 0;
  const masterTalent = (id: number) => master.TALENT[id] ?? 0;
  const cflag = (id: number) => t.CFLAG[id] ?? 0;
  let rate = Math.min(t.ABL[ABL_ID.親密] ?? 0, 10) * 5;
  rate += palamLevel(t.PALAM[PALAM_ID.恭順] ?? 0, 5) * 3;
  rate -= talent(TALENT_ID.態度) * 5;
  if (talent(TALENT_ID.胆量) > 0) rate -= 5;
  if (talent(TALENT_ID.自尊心) > 0) rate -= 15;
  else if (talent(TALENT_ID.自尊心) < 0) rate += 5;
  if (talent(TALENT_ID.目立ちたがり) !== 0) rate += 2;
  if (talent(TALENT_ID.自己愛) < 0) rate -= 10;
  if (talent(TALENT_ID.抵抗) !== 0) rate -= 10;
  if (talent(TALENT_ID.容易高潮) !== 0) rate += 10;
  if (isOtokoGirai(target, next.master)) rate -= 7;
  rate += talent(TALENT_ID.心情) * 15;
  if (masterTalent(TALENT_ID.魅惑) !== 0) rate += 6;
  if (masterTalent(TALENT_ID.謎之魅力) !== 0) rate += 6;
  if (masterTalent(TALENT_ID.魅力) !== 0) rate += 6;
  rate += Math.min(Math.trunc(cflag(CFLAG_ID.好感度) / 200), 50);
  rate += Math.min(Math.trunc(cflag(CFLAG_ID.信頼度) / 20), 50);
  if (talent(TALENT_ID.思慕) !== 0 || talent(TALENT_ID.愛欲) !== 0) rate += 20;
  if (talent(TALENT_ID.恋慕) !== 0) rate += 40;
  rate += Math.trunc(
    ((master.CFLAG[CFLAG_ID.地位] ?? 0) - cflag(CFLAG_ID.地位)) / 500,
  );
  rate += getTflag(next, TFLAG_ID.幸運補正) * 20;
  return Math.max(0, rate);
}

function sameSexExperienceId(
  target: GameState["charas"][number],
  next: GameState,
): number | undefined {
  if (!target) return undefined;
  const targetFemale = ((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
  const masterFemale = ((next.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
  if (targetFemale !== masterFemale) return undefined;
  return targetFemale ? EXP_ID.百合経験 : EXP_ID.断袖経験;
}

function addSameSexExperience(
  target: GameState["charas"][number],
  next: GameState,
): void {
  const expId = sameSexExperienceId(target, next);
  if (expId === undefined || !target) return;
  target.state.EXP[expId] = (target.state.EXP[expId] ?? 0) + 2;
  next.master.state.EXP[expId] = (next.master.state.EXP[expId] ?? 0) + 2;
}

function resolveKissOutcome(
  ctx: CommandContext,
  next: GameState,
): ComfOutcome | ComfOutcomeResolution | undefined {
  const target = next.charas[ctx.target];
  if (!target) return undefined;

  // @COM312 takes the time-stop arm before REJECT_CHECK unless this target is
  // explicitly allowed to act during stopped time (CFLAG:344).
  const timeStopBranch =
    (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
  if (timeStopBranch) {
    return {
      outcome: 0,
      branch: "time-stop",
      outcomeFlag: null,
      frameOutcome: null,
    };
  }

  const forcedOutcome = getTflag(next, TFLAG_ID.口上によるCOM成否判定);
  const asleep = (target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;

  // ATTITUDE.ERB @REJECT_CHECK(312): agreement strictly greater than the
  // required value or existing consensual-H history bit 2 prevents refusal.
  if (!asleep && forcedOutcome <= 0) {
    let required =
      200 +
      (target.state.TALENT[TALENT_ID.一線越えない] ?? 0) * 30 +
      Math.abs(target.state.TALENT[TALENT_ID.キス未経験] ?? 0) * 20;
    const history = target.state.CFLAG[CFLAG_ID.既成事實] ?? 0;
    if ((history & 1) !== 0) required -= 20;
    if (
      (target.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 &&
      (target.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0
    ) {
      required -= 30;
    }
    const hasConsensualHHistory = (history & (1 << KISS_HISTORY_CONSENT_BIT)) !== 0;
    if (
      liftedConsentJudgement(target, next.master, next) <= required &&
      !hasConsensualHHistory
    ) {
      return REJECTED_KISS;
    }
  }

  // COMF312's SELECTCASE TFLAG:192, after REJECT_CHECK.
  if (forcedOutcome === -2) {
    return {
      outcome: -1,
      outcomeFlag: -1,
      tflags: { [TFLAG_ID.COMABLE管理]: 0 },
      returnEarly: "noop",
    };
  }
  if (forcedOutcome === -1) return -1;

  if (forcedOutcome === 1) {
    // CASE 1: force success or great success; MAGIC_DLC's extra threshold is
    // not represented in the modern state yet.
    return ctx.rng.int(110) <= 9 ? 1 : 0;
  }

  const roll = ctx.rng.int(110);
  const failThreshold = Math.min(109, 90 + Math.trunc(kissSuccessRate(target, next) / 5));
  let outcome: ComfOutcome = roll <= 29 ? 1 : roll >= failThreshold ? -1 : 0;
  // TFLAG:COMABLE管理 == 3 is the first-action flow; unless a failure was
  // explicitly forced (-1), that opening action cannot fail.
  if (getTflag(next, TFLAG_ID.COMABLE管理) === 3 && forcedOutcome !== -1) {
    outcome = Math.max(outcome, 0) as ComfOutcome;
  }
  return outcome;
}

export const comf312Def: ComfDef = {
  commandNo: 312,
  label: "キスする",
  gateOverride: checkKissGate,
  resolveOutcome: resolveKissOutcome,
  timeCost: (c) =>
    c.branch === "time-stop" ? 0 : c.outcome === REJECTED_KISS ? 10 : 5,
  maxRoll: 110,
  greatThreshold: 30, // LOCAL <= 29 → 大成功 (lenient)
  failThreshold: 90,  // baseline cutoff; resolveKissOutcome adds GET_SUCCESS_RATE()/5

  // ERB 105-113 (ELSE arm, 陪睡中=0/约会中=0 in clean state): 気力 70 + MASTER:気力 100.
  // Factory downbase is master-only → 100 here; target 70 in body.
  downbase: (c): Record<number, number> =>
    c.branch === "time-stop" || c.outcome === REJECTED_KISS
      ? {}
      : { [BASE_ID.気力]: 100 },

  buildSources: (c): Record<number, number> => {
    if (c.branch === "time-stop") {
      return { [SOURCE_ID.快Ｍ]: c.mAbl(ABL_PLAYER_TONGUE) * 2 + 10 };
    }
    if (c.outcome === REJECTED_KISS) {
      return {
        [SOURCE_ID.反感]: 500,
        [SOURCE_ID.恐怖]: 300,
      };
    }

    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)
    const asleep = c.tCflag(CFLAG_ID.睡眠) !== 0;

    // ABL:PLAYER:舌 → 快Ｍ for target (ERB 116)
    const tongue = c.mAbl(ABL_PLAYER_TONGUE);
    const kaiM = tongue * 2 + 10;

    // Fixed bases (ERB 118-122). 反感 overridden on sleep.
    let kanraku = 150;
    let jouai = 150;
    const roshutsu = 80;
    let hankan = asleep ? 200 : 300;

    // ABL:親密 bracket (ERB 126-152) — 6 arms; lower arms 情愛 only,
    // mid arms add 欲情, higher arms add all 4.
    if (shinmitsu <= 1) {
      jouai += shinmitsu * 30;
    } else if (shinmitsu <= 3) {
      kanraku += 150 + shinmitsu * 30;
      jouai += 150 + shinmitsu * 30;
      // 欲情 += 65 + shinmitsu*20 (only in 3+ arm)
    } else if (shinmitsu <= 5) {
      kanraku += 300 + shinmitsu * 40;
      jouai += 280 + shinmitsu * 30;
      // 欲情 += 130 + shinmitsu*26
      // 露出 += 80 + shinmitsu*15
    } else if (shinmitsu <= 8) {
      kanraku += 450 + shinmitsu * 70;
      jouai += 380 + shinmitsu * 40;
      // 欲情 += 170 + shinmitsu*30
      // 露出 += 110 + shinmitsu*18
    } else if (shinmitsu <= 11) {
      kanraku += 500 + shinmitsu * 85;
      jouai += 480 + shinmitsu * 50;
      // 欲情 += 230 + shinmitsu*35
      // 露出 += 160 + shinmitsu*20
    } else {
      kanraku += 800 + shinmitsu * 80;
      jouai += 760 + shinmitsu * 45;
      // 欲情 += 350 + shinmitsu*30
      // 露出 += 260 + shinmitsu*17
    }

    // NOTE: 欲情/露出 additions inside the 親密 bracket are DEFERRED.
    // They would each require 7 new sub-arms. The factory outcomeMul for
    // 欲情/露出 is MUL_NONE so even if added they wouldn't scale on outcome.
    // 欲情 bracket additions to be added in a follow-up.

    // CFLAG:好感度 bracket (ERB 158-166) — 歓楽/情愛
    if (favor <= 500) {
      jouai += favor;
    } else if (favor <= 5000) {
      jouai += 400 + Math.trunc((favor - 500) / 5);
      kanraku += 400 + Math.trunc((favor - 500) / 4);
    } else {
      jouai += 1200 + Math.trunc((favor - 5000) / 7);
      kanraku += 1200 + Math.trunc((favor - 5000) / 4);
    }
    if (jouai < 0) jouai = 0;

    // 受動 + 征服 (ERB 183-184)
    const judo = 150 + 300 * c.tAbl(ABL_ID.従順);
    const seofuku = 150 + 300 * c.tAbl(ABL_ID.施虐属性);

    return {
      [SOURCE_ID.快Ｍ]: kaiM,
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.征服]: seofuku,
    };
  },

  // B1b — master's own SOURCE (ERB 117) — dual-participant dual write.
  // No TCVAR / 好感度 path; settled into master PALAM only.
  buildMasterSources: (c) => {
    if (c.branch === "time-stop") return undefined;
    const tongue = c.mAbl(ABL_PLAYER_TONGUE);
    return {
      [SOURCE_ID.快Ｍ]: tongue * 2 + 10,
    };
  },

  // ERB 233-253. 露出 has no times on 通常-only in factory.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.情愛]: MUL_POSITIVE,
    [SOURCE_ID.征服]: MUL_POSITIVE,
    [SOURCE_ID.受動]: MUL_POSITIVE,
    [SOURCE_ID.露出]: MUL_ROSHUTSU,
    [SOURCE_ID.快Ｍ]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.恐怖]: MUL_NONE,
  },

  // ERB 170-178 (gated on !CFLAG:睡眠): 好感度 penalty brackets.
  favorBias: (c) => {
    if (c.branch === "time-stop") return 0;
    if (c.outcome === REJECTED_KISS) {
      if (c.favor <= 500) return -50;
      if (c.favor <= 1000) return -30;
      if (c.favor <= 1500) return -10;
      return 0;
    }
    if (c.tCflag(CFLAG_ID.睡眠) !== 0) return 0;
    const favor = c.favor;
    let bias = 0;
    if (favor <= 100) bias -= 3;
    else if (favor <= 300) bias -= 2;
    else if (favor <= 500) bias -= 1;
    return bias;
  },

  // ERB 105-113: target 気力 drain (factory downbase covers master only).
  body: (c) => {
    if (c.branch === "time-stop") {
      c.master.state.BASE[BASE_ID.TSP] = (c.master.state.BASE[BASE_ID.TSP] ?? 0) - 10;
      c.master.state.EXP[EXP_ID.キス経験] = (c.master.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
      addSameSexExperience(c.t, c.next);
      c.t.state.TCVAR[TCVAR_ID.ＦＫ喪失] = 1;
      return;
    }

    setTflag(c.next, TFLAG_ID.理性削り, 1);
    if (c.outcome === REJECTED_KISS) return;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 70;
    if (c.tCflag(CFLAG_ID.睡眠) === 0) {
      c.t.state.EXP[EXP_ID.キス経験] = (c.t.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
    }
    setTflag(c.next, TFLAG_ID.キス合意取得, 1);
    c.master.state.EXP[EXP_ID.キス経験] = (c.master.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
    if (c.outcome === 1 && activeDatePartner(c.next) === c.t.charaNum) {
      c.t.state.EXP[EXP_ID.約會経験] = (c.t.state.EXP[EXP_ID.約會経験] ?? 0) + 1;
      c.master.state.EXP[EXP_ID.約會経験] = (c.master.state.EXP[EXP_ID.約會経験] ?? 0) + 1;
    }
    addSameSexExperience(c.t, c.next);
    if (
      ![
        TALENT_ID.恋慕,
        TALENT_ID.恋人,
        TALENT_ID.愛欲,
        TALENT_ID.炮友,
      ].some((id) => (c.t.state.TALENT[id] ?? 0) !== 0)
    ) {
      // COMF312 ERB:272-273: `1440 * DAY + TIME`; the factory advances the
      // authoritative absolute tick before body, so this is post-command time.
      c.t.state.TCVAR[TCVAR_ID.キス日時] = c.next.time.tickValue;
    }
    c.t.state.TCVAR[TCVAR_ID.ＦＫ喪失] = 1;
  },

  narration: (c, favorDelta) => {
    if (c.outcome === REJECTED_KISS) return "%CALLNAME:TARGET%拒绝了亲吻。";
    const line =
      c.outcome === 1
        ? "%CALLNAME:MASTER%温柔地亲吻了%CALLNAME:TARGET%。"
        : c.outcome === -1
          ? "%CALLNAME:MASTER%有些僵硬地亲吻了%CALLNAME:TARGET%。"
          : "%CALLNAME:MASTER%轻轻亲吻了%CALLNAME:TARGET%。";
    return `${line}；好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}.`;
  },
};

export const comf312HandlerEntry: HandlerEntry = makeComfHandler(comf312Def);
