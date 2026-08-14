/**
 * Phase 7A — `COMF308 頬をつつく` (poke the cheek) settlement, as a `ComfDef`.
 *
 * Ports `@COM308` (`ERB/コマンド関連/COMF/日常系/COMF308 頬をつつく.ERB`),
 * 通常 (TFLAG:192 == 0) arm.
 *
 * Outcome roll (ERB CASE 0): `LOCAL = RAND:110`; `LOCAL:2 = 9` →
 * `LOCAL <= 9` 大成功 (greatThreshold 10); `LOCAL:1 = 90 +
 * GET_SUCCESS_RATE()/5` and GET_SUCCESS_RATE is deferred → 0, so
 * `LOCAL:1 = 90` → `LOCAL >= 90` 失敗 (failThreshold 90); else 通常.
 *
 * SOURCE build (固定で獲得するソース … 受動):
 *   - fixed: 歓楽 80 / 情愛 50 / 反感 200
 *   - ABL:親密 bracket adds to 歓楽 + 情愛
 *   - CFLAG:2 (好感度) bracket adds to 歓楽, then `SIF SOURCE:歓楽 < 0 → 0`
 *   - 屈従 = 500
 *   - 受動 = 100 + 200 * ABL:従順
 *
 * Outcome multiplier (IF TFLAG:193 …):
 *   - 歓楽: great 2.00 / fail 0.10        → MUL_PLEASURE
 *   - 情愛: great 2.00 / fail 0.50        → MUL_POSITIVE
 *   - 受動: great 2.00 / fail 0.50        → MUL_POSITIVE
 *   - 屈従: great 0.50 / fail 1.50        → custom (NOT a preset)
 *   - 反感: great 0.75 / fail 1.50        → MUL_NEGATIVE
 *     (反感/屈従 are NOT 抚摸了 in the 通常 block; only great/fail scale them.)
 *
 * favorBias: NONE — the 通常 arm has no `TFLAG:97 +=` pre-seed. → 0.
 *
 * Persisted: `TIME += 10`; no TCVAR marker, no EXP grant. → no body.
 *
 * **DEFERRED (documented, off in a clean state):**
 * `MAGIC_DLC_大成功相关` / `MAGIC_SuccessRate` great-cutoff boost,
 * `M_TFLAG:成功`, `TFLAG:102 == 3` 先制 (no-fail) branch,
 * `DOWNBASE:気力` (master + target, gated on `CFLAG:陪睡中`).
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_NEGATIVE,
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
  type OutcomeMul,
} from "../comf-def.js";

/** 屈従: great 0.50 / fail 1.50 — inverted but distinct from MUL_NEGATIVE (great 0.75). */
const MUL_KUTSUJUU: OutcomeMul = { great: 0.5, fail: 1.5 };

export const comf308Def: ComfDef = {
  commandNo: 308,
  label: "頬をつつく",
  timeCost: 10,
  maxRoll: 110,
  greatThreshold: 10, // LOCAL <= 9 → 大成功
  failThreshold: 90, // LOCAL:1 = 90 (GET_SUCCESS_RATE deferred → 0)

  // ERB 55-56 (ELSE arm, 陪睡中=0 in clean state): 気力 50 + MASTER:気力 50
  downbase: { [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor; // CFLAG:2 好感度, pre-command
    // 固定で獲得するソース
    let kanraku = 80;
    let jouai = 50;
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
    // 好感度をみる — adds to 歓楽 (ERA `/` truncates), then SIF < 0 → 0
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 200 + Math.trunc((favor - 500) / 3);
    else kanraku += 1000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.反感]: 200,
      [SOURCE_ID.屈従]: 500,
      [SOURCE_ID.受動]: 100 + 200 * c.tAbl(ABL_ID.従順),
    };
  },

  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE, // great 2.00 / fail 0.10
    [SOURCE_ID.情愛]: MUL_POSITIVE, // great 2.00 / fail 0.50
    [SOURCE_ID.受動]: MUL_POSITIVE, // great 2.00 / fail 0.50
    [SOURCE_ID.屈従]: MUL_KUTSUJUU, // great 0.50 / fail 1.50
    [SOURCE_ID.反感]: MUL_NEGATIVE, // great 0.75 / fail 1.50
  },

  // No TFLAG:97 pre-seed in the 通常 arm.
  favorBias: () => 0,

  narration: (c, favorDelta) => {
    const word = c.outcome === 1 ? "调皮地" : c.outcome === -1 ? "笨拙地" : "轻轻";
    return `%CALLNAME:MASTER% ${word} 戳了戳 %CALLNAME:TARGET%'s cheek；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf308HandlerEntry: HandlerEntry = makeComfHandler(comf308Def);
