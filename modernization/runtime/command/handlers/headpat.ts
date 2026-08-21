/**
 * Phase 5E / 7.0 — `COMF309 頭を撫でる` (pat head) settlement, as a `ComfDef`.
 *
 * The 2nd target-directed `SOURCE_CHECK` consumer — proves the shared
 * settlement generalizes beyond 会話. Unlike 会話 it:
 *   - produces 5 SOURCE quanta (歓楽/情愛/反感/欲情/受動), exercising the
 *     SOURCE_情愛/欲情/反感 converters (5E);
 *   - pre-seeds the 好感 accumulator via 親密/好感 **penalty** brackets
 *     (ERB `TFLAG:97 += LOCAL`), passed as `favorBias` — so a clean,
 *     low-affinity target can net **zero** 好感 gain, as upstream intends.
 *
 * Originally a hand-written handler (Phase 5E); Phase 7.0 re-expresses it
 * as a `ComfDef` on `makeComfHandler`. The 5E pinned test is the
 * regression net.
 *
 * Ports `@COM309` (`…/COMF/日常系/COMF309 頭を撫でる.ERB`), 通常 success arm.
 * Persisted (canonical clean target, ABL/TALENT/CFLAG all 0, normal):
 *   - time += 10; TCVAR:TARGET:304 (摸頭time marker) = post-advance tick
 *   - PALAM/CFLAG:好感度 via applySourceCheck
 *
 * **DEFERRED to Phase 7:** TFLAG:192 forced arms, 大成功/失敗 EXP, the
 * 陪睡/约会/睡眠/恶作剧/時止め branches, DOWNBASE:気力, 約會経験, every
 * MAGIC_DLC_* / 路人 / 強行 / 催眠 modifier inside the converters.
 */

import type { HandlerEntry } from "../types.js";
import { ABL_ID, SOURCE_ID, TCVAR_ID } from "../../state/settlement.js";
import { makeComfHandler } from "../comf/make-comf-handler.js";
import { MUL_NEGATIVE, MUL_PLEASURE, MUL_POSITIVE, type ComfDef } from "../comf/comf-def.js";

const headpatDef: ComfDef = {
  commandNo: 309,
  label: "摸头",
  timeCost: 10,
  maxRoll: 110,
  greatThreshold: 10, // roll <= 9 → 大成功
  failThreshold: 90,

  // SOURCE build (ERB 80-142).
  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor;
    let kanraku = 150;
    let jouai = 150;
    if (shinmitsu <= 3) {
      kanraku += 150 + shinmitsu * 50;
      jouai += 180 + shinmitsu * 40;
    } else if (shinmitsu <= 5) {
      kanraku += 500 + shinmitsu * 50;
      jouai += 450 + shinmitsu * 30;
    } else if (shinmitsu <= 8) {
      kanraku += 800 + shinmitsu * 50;
      jouai += 700 + shinmitsu * 50;
    } else if (shinmitsu <= 11) {
      kanraku += 1000 + shinmitsu * 90;
      jouai += 900 + shinmitsu * 50;
    } else {
      kanraku += 1800 + shinmitsu * 40;
      jouai += 2000 + shinmitsu * 20;
    }
    // 好感度 bracket on 歓楽.
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
    else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.反感]: 100,
      [SOURCE_ID.欲情]: 50 + 150 * c.tAbl(ABL_ID.欲望),
      [SOURCE_ID.受動]: 100 + 200 * c.tAbl(ABL_ID.従順),
    };
  },

  // Outcome multiplier (ERB 147-164). 反感 is INVERTED.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.情愛]: MUL_POSITIVE,
    [SOURCE_ID.受動]: MUL_POSITIVE,
    [SOURCE_ID.欲情]: MUL_POSITIVE,
    [SOURCE_ID.反感]: MUL_NEGATIVE,
  },

  // Favor pre-bias: 親密/好感 penalties (ERB 120-139; !睡眠).
  favorBias: (c) => {
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

  // 摸頭時刻 marker (ERB 165-167): reads the POST-advance tick.
  body: (c) => {
    c.t.state.TCVAR[TCVAR_ID.摸頭時刻] = c.next.time.tickValue;
  },

  narration: (c, favorDelta) => {
    const line =
      c.outcome === 1
        ? "%CALLNAME:MASTER%开心地摸了摸%CALLNAME:TARGET%的头。"
        : c.outcome === -1
          ? "%CALLNAME:MASTER%有些僵硬地摸了摸%CALLNAME:TARGET%的头。"
          : "%CALLNAME:MASTER%轻轻摸了摸%CALLNAME:TARGET%的头。";
    return `${line}; 好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}.`;
  },
};

export const headpatHandlerEntry: HandlerEntry = makeComfHandler(headpatDef);
