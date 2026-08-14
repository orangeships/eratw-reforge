/**
 * Phase 7 — `COMF335 介抱する` (介抱/照料 — nurse a drunk character) settlement,
 * as a `ComfDef`.
 *
 * Ports `@COM335` (`ERB/コマンド関連/COMF/日常系/COMF335 介抱する.ERB`),
 * 通常 (`SELECTCASE TFLAG:192` / `CASE 0`) arm.
 *
 * Outcome roll (ERB 8-31):
 *   - `LOCAL = RAND:100` → maxRoll 100.
 *   - `LOCAL:2 = 9`; `IF LOCAL <= LOCAL:2` → 大成功 ⇒ roll < 10 ⇒ greatThreshold 10.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 0), clamped ≤ 99;
 *     `IF LOCAL >= LOCAL:1` → 失敗 ⇒ failThreshold 90.
 *
 * SOURCE build (ERB 56-104):
 *   - fixed: 歓楽 400.
 *   - ABL:従順 bracket adds to 歓楽 (ERB 60-73).
 *   - ABL:親密 bracket adds to 歓楽 (ERB 76-89).
 *   - CFLAG:2 (好感度) bracket adds to 歓楽 (ERB 92-98), then `LIMIT 0..` (ERB 100-101).
 *   - 受動 = 200 + 200*ABL:従順 (ERB 103).
 *   - 征服 = 40 + 40*ABL:施虐属性 (ERB 104).
 *
 * outcomeMul: this command has **NO** `TIMES SOURCE:x , k` outcome-scaling
 * block (unlike 302). The TFLAG:193 outcome only drives 信頼度/EXP, never the
 * SOURCE quanta — so every source is MUL_NONE (flat on 大成功/失敗).
 *
 * favorBias: this command has **NO** `TFLAG:97 +=` pre-seed block → 0.
 *
 * Persisted (ERB):
 *   - `TIME += 30` (ERB 49) → timeCost.
 *   - `EXP:MASTER:会話経験 ++` (ERB 19) in the 大成功 branch only → body (outcome 1).
 *   - No TCVAR time marker.
 *
 * **DEFERRED to Phase 7 (documented, off / unreachable in a clean state):**
 *   - `MAGIC_DLC_大成功相关` / `MAGIC_SuccessRate` 大成功 widening + `M_TFLAG:成功`.
 *   - `CASE 1` 強制成功, `CASE -1` 強制失敗, `CASE -2` 指令終了 arms.
 *   - `TFLAG:信頼度管理` (= TRUST_CALC seed) — trust handled by deferred
 *     source-check trust block, same as 302/300/309.
 *   - `SIF RAND:2 → EXP:MASTER:会話経験 ++` (RNG-gated bonus EXP — non-deterministic).
 *   - `BASE:酒気` random reduction (`MAXBASE:酒気 * (RAND:3 + LOCAL:2)/100`),
 *     `DOWNBASE:MASTER:体力 += 20`, `DOWNBASE:MASTER:気力 += 100`,
 *     `DOWNBASE:気力 += 10` (DOWNBASE:気力 explicitly deferred).
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID, EXP_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";

export const comf335Def: ComfDef = {
  commandNo: 335,
  label: "介抱する",
  timeCost: 30,
  maxRoll: 100,
  greatThreshold: 10, // LOCAL:2 = 9; roll <= 9 → 大成功
  failThreshold: 90, // LOCAL:1 = 90 + GET_SUCCESS_RATE()/5 (deferred → 90)

  // ERB 68-74 (通常 arm): MASTER:体力 20 + MASTER:気力 100 + 気力 10
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 110 },

  buildSources: (c) => {
    const juujun = c.tAbl(ABL_ID.従順);
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // fixed base (ERB 57)
    let kanraku = 400;

    // ABL:従順 bracket (ERB 60-73)
    if (juujun <= 1) {
      kanraku += juujun * 50;
    } else if (juujun <= 3) {
      kanraku += 100 + juujun * 40;
    } else if (juujun <= 5) {
      kanraku += 200 + juujun * 50;
    } else if (juujun <= 8) {
      kanraku += 400 + juujun * 70;
    } else if (juujun <= 11) {
      kanraku += 500 + juujun * 60;
    } else {
      kanraku += 800 + juujun * 40;
    }

    // ABL:親密 bracket (ERB 76-89)
    if (shinmitsu <= 1) {
      kanraku += shinmitsu * 50;
    } else if (shinmitsu <= 3) {
      kanraku += 80 + shinmitsu * 50;
    } else if (shinmitsu <= 5) {
      kanraku += 200 + shinmitsu * 50;
    } else if (shinmitsu <= 8) {
      kanraku += 500 + shinmitsu * 40;
    } else if (shinmitsu <= 11) {
      kanraku += 800 + shinmitsu * 40;
    } else {
      kanraku += 1200 + shinmitsu * 30;
    }

    // CFLAG:2 好感度 bracket on 歓楽 (ERB 92-98), then LIMIT 0.. (ERB 100-101)
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
    else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.受動]: 200 + 200 * juujun, // ERB 103
      [SOURCE_ID.征服]: 40 + 40 * c.tAbl(ABL_ID.施虐属性), // ERB 104
    };
  },

  // No `TIMES SOURCE` block in this command — sources are NOT outcome-scaled.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.征服]: MUL_NONE,
  },

  // No `TFLAG:97 +=` pre-seed block in this command.
  favorBias: () => 0,

  // ERB 19: 大成功 branch grants EXP:MASTER:会話経験 ++ (deterministic given outcome).
  // The `SIF RAND:2` bonus EXP (ERB 39) is RNG-gated → deferred.
  body: (c) => {
    if (c.outcome === 1) {
      c.master.state.EXP[EXP_ID.会話経験] = (c.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
    }
  },

  narration: (c, favorDelta) => {
    const word = c.outcome === 1 ? "温柔地" : c.outcome === -1 ? "笨拙地" : "小心翼翼";
    return `%CALLNAME:MASTER% ${word} 给%CALLNAME:TARGET%哺乳了 %CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf335HandlerEntry: HandlerEntry = makeComfHandler(comf335Def);
