/**
 * Phase 7 — `COMF311 抱き付く` (hug) settlement, as a `ComfDef`.
 *
 * Ports `@COM311` (`ERB/コマンド関連/COMF/日常系/COMF311 抱き付く.ERB`),
 * the post-check arm (non-time-stop, non-甲斐性無 bypassed). The
 * 甲斐性無 FOR-loop (ERB 20-33) is a multi-target interactive check —
 * **DEFERRED** (C-tier shape).
 *
 * Outcome roll (ERB CASE 0):
 *   - `LOCAL = RAND:110` → maxRoll 110.
 *   - `LOCAL:2 = 9`; `IF LOCAL <= LOCAL:2` → 大成功 ⇒ roll <= 9 ⇒ greatThreshold 10.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 90), clamped ≤ 109;
 *     `IF LOCAL >= LOCAL:1` → 失敗 ⇒ failThreshold 90.
 *   - `TIME += 10` → timeCost.
 *
 * SOURCE build (ERB 95-128):
 *   - fixed: 歓楽 120 / 情愛 160 / 露出 100 / 反感 250
 *   - ABL:親密 bracket adds to 情愛 (≤8 also adds 露出 + 欲望*15)
 *   - CFLAG:好感度 bracket (ERB 120-127): 恭順 in 3 arms (else floor ≥ 0)
 *   - 受動 = 120 + 240 * ABL:従順
 *   - 征服 = 120 + 240 * ABL:施虐属性
 *
 * Outcome scaling (ERB 148-168):
 *   - 歓楽: great 2.00 / fail 0.10
 *   - 情愛: great 2.00 / fail 0.50
 *   - 征服: great 2.00 / fail 0.50
 *   - 受動: great 2.00 / fail 0.50
 *   - 露出: great 1.80 / fail 0.40
 *   - 反感: NOT in the TIMES block → MUL_NONE
 *   - **DEVIATION**: 露出 ×0.90 on 通常 (ERB 159) cannot be expressed — see spec.
 *
 * favorBias (ERB 131-139): low-favor penalty brackets (CFLAG:2 <=50/100/250).
 *
 * DOWNBASE (ERB 88-93): 気力 100 + MASTER:気力 50 (陪睡中 case: master only 50).
 *   Default 50 in factory, target 100 in body.
 *
 * Persisted: none (EXP writes depend on IS_DATING_WITH_PLAYER/HETEROSEX — DEFERRED).
 *
 * **DEFERRED (documented, off in a clean state):**
 *   - Time-stop arm (ERB 13-17) — TSP drain, no DOWNBASE/SOURCE
 *   - 甲斐性無 FOR-loop over targets (ERB 20-33) — multi-target interactive check
 *   - TFLAG:理性削り = 1 (ERB 34)
 *   - MAGIC_DLC_大成功相关 / M_TFLAG:成功 (ERB 41-42, 62-63, 83-84)
 *   - TFLAG:102 == 3 先制 floor (ERB 86-87)
 *   - 陪睡中 DOWNBASE branch (ERB 88-89) — factory form can't model switch
 *   - TFLAG:信頼度管理 (ERB 31, 36, 41, 52, 57, 62) — TRUST_CALC input
 *   - TFLAG:情緒BONUS (ERB 160, 167) — FAVOR_CALC input
 *   - CASE 1/-1/-2 arms
 *   - IS_DATING_WITH_PLAYER → 约会経験++ (ERB 48-51, 67-70, 171-174, 263-266)
 *   - HETEROSEX EXP writes (ERB 176-179)
 *   - HITOKE bystander, 強制成功/失敗/指令終了 arms
 *   - 露出 ×0.90 deviation on 通常 (factory outcomeMul has no per-source 通常 slot)
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID } from "../../../state/settlement.js";
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

export const comf311Def: ComfDef = {
  commandNo: 311,
  label: "抱き付く",
  timeCost: 10,
  maxRoll: 110,
  greatThreshold: 10, // LOCAL <= 9 → 大成功
  failThreshold: 90,  // LOCAL:1 = 90 (deferred → 90)

  // ERB 88-93 (ELSE arm, 陪睡中=0 in clean state): 気力 100 + MASTER:気力 50.
  // Factory downbase is master-only → 50 here; target 100 in body.
  downbase: { [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const yokubo = c.tAbl(ABL_ID.欲望);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // Fixed bases (ERB 96-99)
    const kanraku = 120;
    let jouai = 160;
    let roshutsu = 100;
    const hankan = 250;

    // ABL:親密 bracket (ERB 102-117)
    if (shinmitsu <= 1) {
      jouai += shinmitsu * 30;
    } else if (shinmitsu <= 3) {
      jouai += 200 + shinmitsu * 30;
    } else if (shinmitsu <= 5) {
      jouai += 400 + shinmitsu * 30;
    } else if (shinmitsu <= 8) {
      jouai += 600 + shinmitsu * 40;
      roshutsu += 200 + yokubo * 15;
    } else if (shinmitsu <= 11) {
      jouai += 800 + shinmitsu * 40;
      roshutsu += 300 + yokubo * 15;
    } else {
      jouai += 1800 + shinmitsu * 20;
      roshutsu += 700 + yokubo * 10;
    }

    // CFLAG:好感度 bracket (ERB 120-127) — 恭順 only
    let kyoujun = 0;
    if (favor <= 1000) {
      // nothing
    } else if (favor <= 5000) {
      kyoujun = Math.trunc(favor / 5);
    } else if (favor <= 10000) {
      kyoujun = 100 + Math.trunc(favor / 20);
    } else {
      kyoujun = 350 + Math.trunc(favor / 100);
    }
    if (kyoujun < 0) kyoujun = 0;

    // 受動 + 征服 (ERB 142-143)
    const judo = 120 + 240 * c.tAbl(ABL_ID.従順);
    const seofuku = 120 + 240 * c.tAbl(ABL_ID.施虐属性);

    const sources: Record<number, number> = {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.征服]: seofuku,
      [SOURCE_ID.反感]: hankan,
    };
    if (roshutsu !== 0) sources[SOURCE_ID.露出] = roshutsu;
    if (kyoujun !== 0) sources[SOURCE_ID.恭順] = kyoujun;
    return sources;
  },

  // ERB 148-168. 反感 has no TIMES anywhere → MUL_NONE.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.情愛]: MUL_POSITIVE,
    [SOURCE_ID.征服]: MUL_POSITIVE,
    [SOURCE_ID.受動]: MUL_POSITIVE,
    [SOURCE_ID.露出]: MUL_ROSHUTSU,
    [SOURCE_ID.恭順]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
  },

  // ERB 131-139: 好感度 penalty brackets.
  favorBias: (c) => {
    const favor = c.favor;
    let bias = 0;
    if (favor <= 50) bias -= 3;
    else if (favor <= 100) bias -= 2;
    else if (favor <= 250) bias -= 1;
    return bias;
  },

  // ERB 88-93: target 気力 drain (factory downbase covers master only).
  body: (c) => {
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;
  },

  narration: (c, favorDelta) => {
    const line =
      c.outcome === 1
        ? "%CALLNAME:MASTER%热情地抱住了%CALLNAME:TARGET%。"
        : c.outcome === -1
          ? "%CALLNAME:MASTER%有些笨拙地抱住了%CALLNAME:TARGET%。"
          : "%CALLNAME:MASTER%轻轻抱住了%CALLNAME:TARGET%。";
    return `${line}；好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}.`;
  },
};

export const comf311HandlerEntry: HandlerEntry = makeComfHandler(comf311Def);
