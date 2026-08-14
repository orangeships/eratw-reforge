/**
 * Phase 7A — `COMF307 頬をつまむ` (pinch cheeks / 捏臉蛋) settlement, as a `ComfDef`.
 *
 * Ports `@COM307` (`ERB/コマンド関連/COMF/日常系/COMF307 頬をつまむ.ERB`),
 * 通常 (TFLAG:192 == 0 / CASE 0) arm.
 *
 * Outcome roll (ERB CASE 0):
 *   - `LOCAL = RAND:110`           → maxRoll = 110
 *   - `LOCAL:2 = 9`, `LOCAL <= LOCAL:2` → roll <= 9 大成功 → greatThreshold = 10
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 90),
 *     `LOCAL >= LOCAL:1` 失敗 → failThreshold = 90
 *   - `TIME += 10`.
 *
 * SOURCE build (ERB "固定で獲得するソース" … onward):
 *   - fixed: 歓楽 100 / 苦痛 150 / 反感 120 (情愛 starts at 0, raised only
 *     by the 親密 bracket).
 *   - ABL:親密 bracket adds to 歓楽 + 情愛.
 *   - CFLAG:好感度(=CFLAG:2) bracket adds to 歓楽, then `LIMIT 0..`
 *     (`SIF SOURCE:歓楽 < 0 → 0`).
 *   - CFLAG:睡眠 (sleep) effect: 歓楽/=2, 情愛/=2, 反感*=2 (only when 歓楽>0).
 *   - 受動/屈従 appear only in the outcome-TIMES blocks but are never
 *     ASSIGNED in the 通常 SOURCE build → they stay 0 and are omitted.
 *   - outcome multiplier (ERB TFLAG:193 TIMES block):
 *       歓楽 great 2.00 / fail 0.10 → MUL_PLEASURE
 *       情愛 great 2.00 / fail 0.50 → MUL_POSITIVE
 *       反感 great 0.75 / fail 1.50 → MUL_NEGATIVE
 *       苦痛 — NO TIMES anywhere    → MUL_NONE
 *
 * favorBias (ERB `TFLAG:97 += LOCAL`, gated by `IF !CFLAG:睡眠`):
 *   親密 0/1/2 → -3/-2/-1 ；好感度(CFLAG:2) <=50/<=100/<=250 → -3/-2/-1.
 *   When the target is asleep the whole penalty block is skipped → 0.
 *
 * No persisted side-write (`body`): COMF307 has no TCVAR time marker.
 * No master-ability scaling.
 *
 * **DEFERRED (documented, off in a clean state):** the
 * `FLAG:70 時間停止` head branch (`CFLAG:344==0` → 苦痛 150 / BASE:TSP-=20),
 * `MAGIC_DLC_大成功相关` (LOCAL:2 += 技巧 + MAGIC_SuccessRate/20), the
 * `M_TFLAG:成功` mirror, `TFLAG:102==3` 先制 floor (`TFLAG:193 = MAX(_,0)`),
 * `DOWNBASE:体力`/`DOWNBASE:気力`/`DOWNBASE:MASTER:気力`, the 強制成功
 * (CASE 1) / 強制失敗 (CASE -1) / 指令終了 (CASE -2) arms,
 * `TFLAG:信頼度管理` (TRUST_CALC), and `IS_DATING_WITH_PLAYER`. The
 * COM_ABLE display gates (亲热<1, 行動==5 仕事中, 約會) are resolver-side.
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_NEGATIVE,
  MUL_NONE,
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
} from "../comf-def.js";

export const comf307Def: ComfDef = {
  commandNo: 307,
  label: "頬をつまむ",
  // @COM_ABLE307 (Slice 7): the modelable gates — 亲热≥1, not working,
  // master 気力>0, not time-stopped. (307 deliberately allows an asleep
  // target, skipping only the favor penalty — so no 睡眠 gate here.)
  gate: {
    minIntimacy: 1,
    notWhileTargetWorking: true,
    requiresMasterStamina: true,
    notWhileTimeStopped: true,
    deferredGates: "IS_DATING_WITH_PLAYER + OMANEKIBEYA (約會地点); GETBIT(CFLAG:526,0) 潜伏",
  },
  timeCost: 10,
  maxRoll: 110,
  greatThreshold: 10, // roll <= 9 → 大成功
  failThreshold: 90, // GET_SUCCESS_RATE deferred → 90

  // ERB 67-69 (ELSE arm, 睡眠=0 in clean state): 体力 20 + 気力 50 + MASTER:気力 50
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor; // CFLAG:2 好感度, pre-command
    const asleep = c.tCflag(CFLAG_ID.睡眠) !== 0;

    // fixed bases (情愛 starts 0, raised only by the 親密 bracket)
    let kanraku = 100;
    let jouai = 0;
    let kutsuu = 150;
    let hankan = 120;

    // ABL:親密 bracket
    if (shinmitsu <= 3) {
      kanraku += 100 + shinmitsu * 20;
      jouai += 150 + shinmitsu * 30;
    } else if (shinmitsu <= 5) {
      kanraku += 300 + shinmitsu * 40;
      jouai += 350 + shinmitsu * 30;
    } else if (shinmitsu <= 8) {
      kanraku += 600 + shinmitsu * 50;
      jouai += 500 + shinmitsu * 40;
    } else if (shinmitsu <= 11) {
      kanraku += 800 + shinmitsu * 70;
      jouai += 700 + shinmitsu * 60;
    } else {
      kanraku += 1200 + shinmitsu * 40;
      jouai += 1500 + shinmitsu * 20;
    }

    // CFLAG:好感度 bracket on 歓楽, then LIMIT 0..
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 200 + Math.trunc((favor - 500) / 3);
    else kanraku += 1000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    // 睡眠 effect (only when 歓楽 > 0): 歓楽/=2, 情愛/=2, 反感*=2.
    if (asleep && kanraku > 0) {
      kanraku = Math.trunc(kanraku / 2);
      jouai = Math.trunc(jouai / 2);
      hankan = hankan * 2;
    }

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.反感]: hankan,
    };
  },

  // ERB TFLAG:193 TIMES block: 歓楽 pleasure, 情愛 positive, 反感 negative
  // (inverted), 苦痛 has no TIMES anywhere → flat.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.情愛]: MUL_POSITIVE,
    [SOURCE_ID.反感]: MUL_NEGATIVE,
    [SOURCE_ID.苦痛]: MUL_NONE,
  },

  // ERB `IF !CFLAG:睡眠` { 親密/好感 penalty brackets }; asleep → no penalty.
  favorBias: (c) => {
    if (c.tCflag(CFLAG_ID.睡眠) !== 0) return 0;
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor;
    let bias = 0;
    if (shinmitsu === 0) bias -= 3;
    else if (shinmitsu === 1) bias -= 2;
    else if (shinmitsu === 2) bias -= 1;
    if (favor <= 50) bias -= 3;
    else if (favor <= 100) bias -= 2;
    else if (favor <= 250) bias -= 1;
    return bias;
  },

  narration: (c, favorDelta) => {
    const word = c.outcome === 1 ? "调皮地" : c.outcome === -1 ? "用力地" : "轻轻";
    return `%CALLNAME:MASTER% ${word} 捏了捏 %CALLNAME:TARGET%'s cheeks；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf307HandlerEntry: HandlerEntry = makeComfHandler(comf307Def);
