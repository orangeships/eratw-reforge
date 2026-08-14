/**
 * Phase 7 — `COMF312 キスする` (kiss) settlement, as a `ComfDef`.
 *
 * Ports `@COM312` (`ERB/コマンド関連/COMF/日常系/COMF312 キスする.ERB`),
 * the post-check CASE 0 arm. Many side conditions are DEFERRED:
 *
 *   - Time-stop arm (ERB 6-12) — different SOURCE / EXP grants
 *   - 甲斐性無 FOR-loop (ERB 14-28) — multi-target interactive check
 *   - REJECT_CHECK branch (ERB 30-49) — TFLAG:193=99, 反感/恐怖 fixed
 *   - TFLAG:理性削り = 1 (ERB 29)
 *   - TCVAR:314 キスタイムスタンプ (ERB 272-273)
 *   - TCVAR:ＦＫ喪失 = 1 (ERB 275)
 *   - TFLAG:キス合意取得 = 1 (ERB 261)
 *   - TFLAG:积攒度 LIMIT (ERB 154-155) — MAGIC_DLC_好感亲密重做
 *   - 体目当て (CFLAG 339) → 情愛 *= 3 (ERB 180-181)
 *   - IS_DATING_WITH_PLAYER → 约会経験++ (ERB 64-67, 82-85, 263-266)
 *   - HETEROSEX EXP writes (ERB 10-11, 267-270)
 *   - MAGIC_DLC_*, 強制成功/失敗/指令終了, M_TFLAG:成功, TFLAG:102 先制
 *   - FAVOR_CALC, TRUST_CALC, TALENT/MARK/DLC personality modifiers
 *
 * Outcome roll (ERB CASE 0):
 *   - `LOCAL = RAND:110` → maxRoll 110.
 *   - `LOCAL:2 = 29` (more lenient than most); `IF LOCAL <= LOCAL:2` → 大成功
 *     ⇒ roll <= 29 ⇒ greatThreshold 30.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 90), clamped ≤ 109;
 *     `IF LOCAL >= LOCAL:1` → 失敗 ⇒ failThreshold 90.
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
 * Persisted (ERB 254-274): TIME+=5 + various EXP (DEFERRED).
 *
 * **B1b — Dual-participant master SOURCE**: ERB writes
 * `SOURCE:PLAYER:快Ｍ = ABL:舌*2 + 10` (ERB 117). This is the master's
 * own pleasure; settled into the master's PALAM without 好感度 machinery.
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_NONE,
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
  type OutcomeMul,
} from "../comf-def.js";

/** 露出: great 1.80 / fail 0.40. */
const MUL_ROSHUTSU: OutcomeMul = { great: 1.8, fail: 0.4 };

/** ABL id for 舌 (tongue technique). */
const ABL_PLAYER_TONGUE = 46;

export const comf312Def: ComfDef = {
  commandNo: 312,
  label: "キスする",
  timeCost: 5,
  maxRoll: 110,
  greatThreshold: 30, // LOCAL <= 29 → 大成功 (lenient)
  failThreshold: 90,  // LOCAL:1 = 90 (deferred → 90)

  // ERB 105-113 (ELSE arm, 陪睡中=0/约会中=0 in clean state): 気力 70 + MASTER:気力 100.
  // Factory downbase is master-only → 100 here; target 70 in body.
  downbase: { [BASE_ID.気力]: 100 },

  buildSources: (c) => {
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
  },

  // ERB 170-178 (gated on !CFLAG:睡眠): 好感度 penalty brackets.
  favorBias: (c) => {
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
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 70;
  },

  narration: (c, favorDelta) => {
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
