/**
 * Phase 7B — `COMF314 アナル愛撫` (anal caress) settlement, as a `ComfDef`.
 *
 * Ports `@COM314` (`ERB/コマンド関連/COMF/日常系/COMF314 アナル愛撫.ERB`),
 * 通常 arm (TFLAG:192 == 0, the outer ELSE block excluding the
 * FLAG:70==1 時間停止 path and TFLAG:192==-1 forced-failure path).
 *
 * Outcome roll: No explicit RAND roll in the ERB — the command has no
 * 大成功/失敗 bifurcation. Default maxRoll 100, greatThreshold 5,
 * failThreshold 90 are preserved so the factory skeleton still runs,
 * but all per-source outcome multipliers are MUL_NONE (1.0) so the
 * roll has no effect on source quanta.
 *
 * SOURCE build (ERB 43-81, 通常 arm only):
 *   - Base: 快Ａ 80, 苦痛 50, 屈従 100, 露出 500, 欲情 170, 歓楽 50,
 *     逸脱 80, 反感 1000, 受動 = 150 + 300*ABL:従順
 *   - ABL:PLAYER:指 (id 50) adds to 快Ａ: >=4 → +50, else +yubi*10
 *   - TALENT:自己愛(31) < 0 || TALENT:抵抗(32) → 鬱屈 += 100
 *
 * 好感度 delta handled by shared `applySourceCheck`.
 *
 * Persisted: TIME += 5 (via timeCost; ERB line 120, inner ELSE branch
 * which always executes in the 通常 arm).
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - FLAG:70 == 1 && CFLAG:TARGET:344 == 0 (時間停止) path — entirely
 *     separate arm with different SOURCE quantities, TSP consumption,
 *     and no DOWNBASE
 *   - TFLAG:192 == -1 (口上による強制失敗) — early RETURN -1
 *   - DOWNBASE:体力 += 40, DOWNBASE:気力 += 100
 *   - TEQUIP clothing checks (TEQUIP:0 & 16 → 0.60x / TEQUIP > 1 → 0.80x)
 *     on 快Ａ / 欲情 / 露出
 *   - HITOKE(1) bystander check → 2.00x on 露出 / 反感
 *   - TFLAG:信頼度管理 = -7
 *   - PAIN_CHECK_A(TARGET) (A-pain callback, line 84)
 *   - STAIN 汚れ移動 default finger branch (ERB 95-98) now wired; the
 *     TCVAR:20==72 oral-service variant (master 口 ⇔ target Ａ, ERB 91-92)
 *     deferred to the equipment/position layer.
 *   - EXP:PLAYER:手淫経験++, EXP:PLAYER:口淫経験++, EXP:(50+HETEROSEX)+=4
 *     (experience grants, lines 103-119)
 *   - TCVAR:116 = PLAYER (line 10)
 *   - TFLAG:理性削り = 1 (line 11)
 *   - MAGIC_DLC_*, dating, 催眠/強行, CASE 1/-1/-2 arms
 *   - IS_DATING_WITH_PLAYER
 *   - GET_SUCCESS_RATE
 *   - FAVOR_CALC 日常時 BASE/情緒/理性 block, TRUST_CALC
 *   - TALENT/MARK/DLC personality modifiers
 */

import type { CommandContext, HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, FLAG_ID, SOURCE_ID, TCVAR_ID, TEQUIP_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";
import { isTimeStopped } from "../../h-mode.js";
import { activeDatePartner } from "../../../world/date-session.js";
import { OMANEKI_PLACE } from "../../../world/omaneki.js";
import { getTflag, TFLAG_ID } from "../../../state/tflag.js";
import { isEquipped, readTequipOptional } from "../../../state/tequip.js";
import { readTouchPart, TOUCH_COMPONENT, TOUCH_DEPTH, TOUCH_PART } from "../../../state/touch-state.js";
import { STAIN_PART } from "../../../state/stain.js";

/** ABL id for 指 (finger technique). Not yet in ABL_ID enum. */
const ABL_YUBI = 50;
/** TALENT id for 自己愛 (self-love / narcissism / repression). */
const TALENT_JIKOAI = 31;
/** TALENT id for 抵抗 (resistance). */
const TALENT_TEIKOU = 32;

/** The remaining COM_ABLE314 branches that the shared gate extractor cannot
 * express. Keep those checks explicit so this H-only command can be offered
 * in a valid session without bypassing its upstream busy/date restrictions. */
function com314HModeMenuCheck(ctx: CommandContext) {
  const target = ctx.state.charas[ctx.target];
  if (!target || ctx.target <= 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "需要在场的对象。" } };
  }

  // The COM314 time-stop settlement arm has not been ported yet. Keep its
  // command hidden until that separate SOURCE path is available.
  if (isTimeStopped(ctx.state)) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "现在无法使用这项行为。" } };
  }

  const targetCflag = target.state.CFLAG;
  const stealthHidden = ((targetCflag[CFLAG_ID.潜伏状態] ?? 0) & 1) !== 0;
  if (!stealthHidden) {
    if (activeDatePartner(ctx.state) === ctx.target && target.location !== OMANEKI_PLACE) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "约会中不能进行这项行为。" } };
    }
    if ((ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0 && (targetCflag[CFLAG_ID.诶嘿嘿] ?? 0) === 0) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "当前状态下无法进行这项行为。" } };
    }
  }

  // TEQUIP:51 is the current A-intercourse partner. An absent sparse slot is
  // the upstream -1 (no partner); 0 is a real value (the player).
  const analPartner = readTequipOptional(target, TEQUIP_ID.Ａ性交);
  if (analPartner !== undefined && analPartner >= 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "肛门已在使用中。" } };
  }

  // These two upstream routes intentionally bypass the ordinary hand-use
  // checks after the active-A-partner check above.
  if ((target.state.TCVAR[TCVAR_ID.Counter行動] ?? 0) === 72 || isEquipped(target, TEQUIP_ID.六九式)) {
    return { ok: true as const };
  }

  const masterFingerOnTargetA =
    readTouchPart(target, TOUCH_COMPONENT.Ａ, TOUCH_DEPTH.現在) === TOUCH_PART.指;
  if (getTflag(ctx.state, TFLAG_ID.手使用中) !== 0 && !masterFingerOnTargetA) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "双手正在进行其他行为。" } };
  }
  if (((ctx.state.master.state.TCVAR[TCVAR_ID.MASTER_COUNTER制御] ?? 0) & (1 << 4)) !== 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "这项行为本轮已经使用过。" } };
  }
  return { ok: true as const };
}

export const comf314Def: ComfDef = {
  commandNo: 314,
  label: "アナル愛撫",
  hModeMenuCheck: com314HModeMenuCheck,
  // @COM_ABLE314 (Slice 7): only 気力>0 is an unconditional modelable gate;
  // the 亲热<2/睡眠/行動/陪睡中/約會/甲斐性無 cluster is all inside the
  // !FLAG:70 branch (skipped during time-stop), and the rest are TEQUIP/
  // TCVAR:20 counter gates — deferred.
  gate: {
    requiresMasterStamina: true,
    deferredGates: "TFLAG:100/GLOBAL_COMABLE common preamble defaults to enabled; the time-stop settlement arm remains deferred.",
  },
  timeCost: 5,
  maxRoll: 100,
  greatThreshold: 5,
  failThreshold: 90,

  // ERB 40-41 (通常 arm): 体力 40 + 気力 100
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    // Base sources (ERB 43-51)
    let kaiA = 80;         // SOURCE:快Ａ  = 80
    const kutsuu = 50;     // SOURCE:苦痛  = 50
    const kutsuju = 100;   // SOURCE:屈従  = 100
    const roshutsu = 500;  // SOURCE:露出  = 500
    const yokujo = 170;    // SOURCE:欲情  = 170
    const kanraku = 50;    // SOURCE:歓楽  = 50
    const itsudatsu = 80;  // SOURCE:逸脱  = 80
    const hankan = 1000;   // SOURCE:反感  = 1000
    const judo = 150 + 300 * c.tAbl(ABL_ID.従順); // SOURCE:受動 = 150+300*ABL:従順

    // ABL:PLAYER:指 adjustment on SOURCE:快Ａ (ERB 52-56)
    const yubi = c.mAbl(ABL_YUBI);
    if (yubi >= 4) {
      kaiA += 50;
    } else {
      kaiA += yubi * 10;
    }

    // 特殊ソース処理: TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 100 (ERB 78-81)
    let utsukutsu = 0;
    const jikoai = c.tTalent(TALENT_JIKOAI);
    const teikou = c.tTalent(TALENT_TEIKOU);
    // TALENT values: 0 = absent, positive = present trait, negative = inverted trait
    // ERB `SIF TALENT:自己愛 < 0 || TALENT:抵抗` — truthy check on 抵抗
    if (jikoai < 0 || teikou !== 0) {
      utsukutsu = 100;
    }

    return {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.欲情]: yokujo,
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.逸脱]: itsudatsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.鬱屈]: utsukutsu,
    };
  },

  // No outcome-based TIMES in the ERB → all sources use MUL_NONE.
  // Must be explicit: the factory defaults missing entries to MUL_POSITIVE.
  outcomeMul: {
    [SOURCE_ID.快Ａ]: MUL_NONE,
    [SOURCE_ID.苦痛]: MUL_NONE,
    [SOURCE_ID.屈従]: MUL_NONE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.逸脱]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.鬱屈]: MUL_NONE,
  },

  // No TFLAG:97 pre-seed brackets in the ERB. favorBias omitted (defaults to 0).

  // ERB 89-99: 汚れ移動 — two equip-gated branches. TCVAR:20==72 &&
  // !TEQUIP:六九式 (oral-service position) → master 口 ⇔ target Ａ. ELSE
  // (default finger caress) → master 手 ⇔ target Ａ + 腸内. The
  // TCVAR:20 position flag isn't modeled → we run the default finger
  // branch (ERB 95-98) faithfully; the oral-service variant is deferred
  // to the equipment/position layer.
  body: (c) => {
    // ERB 95-98 runs the |= chain sequentially; the updated master 手
    // (union of 手/Ａ/腸内) is what target Ａ/腸内 read back. Mirror exactly.
    c.master.state.STAIN[STAIN_PART.手] =
      (c.master.state.STAIN[STAIN_PART.手] ?? 0) |
      (c.t.state.STAIN[STAIN_PART.Ａ] ?? 0);
    c.master.state.STAIN[STAIN_PART.手] =
      (c.master.state.STAIN[STAIN_PART.手] ?? 0) |
      (c.t.state.STAIN[STAIN_PART.腸内] ?? 0);
    c.t.state.STAIN[STAIN_PART.Ａ] =
      (c.t.state.STAIN[STAIN_PART.Ａ] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.手] ?? 0);
    c.t.state.STAIN[STAIN_PART.腸内] =
      (c.t.state.STAIN[STAIN_PART.腸内] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.手] ?? 0);
  },

  // No persisted side writes for the 通常 arm beyond timeCost.
  // (EXP, TCVAR:116, TFLAG:理性削り are all deferred.)

  narration: (c, favorDelta) => {
    const word =
      c.outcome === 1 ? "娴熟地"
      : c.outcome === -1 ? "笨拙地"
      : "温柔地";
    return `%CALLNAME:MASTER% ${word} 爱抚了%CALLNAME:TARGET%的肛门；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf314HandlerEntry: HandlerEntry = makeComfHandler(comf314Def);
