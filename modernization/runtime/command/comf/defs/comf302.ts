/**
 * Phase 7A — `COMF302 スキンシップ` (skinship) settlement, as a `ComfDef`.
 *
 * Ports `@COM302` (`ERB/コマンド関連/COMF/日常系/COMF302 スキンシップ.ERB`),
 * 通常 (TFLAG:192 == 0) arm. The first Tier-A command ported through the
 * `makeComfHandler` factory (exemplar for the 7A batch).
 *
 * Outcome roll (ERB 18-43): `RAND:100`; `<= 9` → 大成功 (LOCAL:2 = 9),
 * `>= 90` → 失敗 (GET_SUCCESS_RATE deferred → LOCAL:1 = 90), else 通常.
 *
 * SOURCE build (ERB 76-130):
 *   - fixed: 歓楽 100 / 情愛 100 / 露出 20 / 反感 50
 *   - ABL:親密 bracket adds to 歓楽 + 情愛
 *   - CFLAG:好感度 bracket adds to 歓楽 (then `LIMIT 0..`)
 *   - 受動 = 100 + 200*ABL:従順 ; 征服 = 100 + 200*ABL:施虐属性
 *   - outcome multiplier (ERB 137-162) scales 歓楽/情愛/征服/受動 only
 *     (露出/反感 are NOT outcome-scaled).
 *
 * favorBias (ERB 119-133, `TFLAG:97 += LOCAL`): 親密/好感 penalty brackets.
 *
 * Persisted (ERB 163-170): `TIME += 10`; `TCVAR:TARGET:身体接触時刻(303) =
 * 1440*DAY + TIME` (1-hour cooldown marker).
 *
 * **DEFERRED to Phase 7 (documented, off in a clean state):** the
 * `Five_Orgasm_Magic`/`MAGIC_DLC_*` arms, `IS_DATING_WITH_PLAYER` →
 * 約會経験 + the dating marker branch, `DOWNBASE:気力` (master+target),
 * `TFLAG:情緒BONUS`, `TCVAR:20` 先制, the 宴会 re-roll (`CFLAG:350 == 49`).
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID, TCVAR_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, MUL_PLEASURE, MUL_POSITIVE, type ComfDef } from "../comf-def.js";

export const comf302Def: ComfDef = {
  commandNo: 302,
  label: "スキンシップ",
  timeCost: 10,
  maxRoll: 100,
  greatThreshold: 10,
  failThreshold: 90,

  downbase: { [BASE_ID.気力]: 60 }, // ERB 80-81: DOWNBASE:気力+=30 + DOWNBASE:MASTER:気力+=30

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor;
    // fixed bases
    let kanraku = 100;
    let jouai = 100;
    // ABL:親密 bracket (ERB 90-108)
    if (shinmitsu <= 1) {
      jouai += shinmitsu * 30;
    } else if (shinmitsu <= 3) {
      kanraku += 100 + shinmitsu * 40;
      jouai += 200 + shinmitsu * 30;
    } else if (shinmitsu <= 5) {
      kanraku += 400 + shinmitsu * 50;
      jouai += 400 + shinmitsu * 30;
    } else if (shinmitsu <= 8) {
      kanraku += 700 + shinmitsu * 60;
      jouai += 600 + shinmitsu * 40;
    } else if (shinmitsu <= 11) {
      kanraku += 1200 + shinmitsu * 80;
      jouai += 800 + shinmitsu * 40;
    } else {
      kanraku += 2000 + shinmitsu * 50;
      jouai += 1800 + shinmitsu * 20;
    }
    // CFLAG:好感度 bracket on 歓楽 (ERB 111-118), then LIMIT 0..
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
    else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.反感]: 50,
      [SOURCE_ID.受動]: 100 + 200 * c.tAbl(ABL_ID.従順),
      [SOURCE_ID.征服]: 100 + 200 * c.tAbl(ABL_ID.施虐属性),
    };
  },

  // ERB 137-162: only 歓楽/情愛/征服/受動 are outcome-scaled; 露出/反感 stay flat.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.情愛]: MUL_POSITIVE,
    [SOURCE_ID.征服]: MUL_POSITIVE,
    [SOURCE_ID.受動]: MUL_POSITIVE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
  },

  // ERB 119-133: 親密/好感 penalty brackets.
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

  // ERB 164-170: 身体接触時刻 marker = 1440*DAY + TIME (post-advance).
  // tickValue IS the absolute minute (= dayIndex*1440 + minute-of-day), so it
  // equals 1440*DAY+TIME directly. The old `1440*dayIndex + tickValue`
  // double-counted the day — oracle 9912 caught it (TCVAR[303] ~2× eraTW at
  // DAY=310). The unit tests hid it by using inconsistent tickValue/dayIndex.
  body: (c) => {
    c.t.state.TCVAR[TCVAR_ID.身体接触時刻] = c.next.time.tickValue;
  },

  narration: (c, favorDelta) => {
    const word = c.outcome === 1 ? "温柔地" : c.outcome === -1 ? "笨拙地" : "轻轻";
    return `%CALLNAME:MASTER% ${word} 抚摸了 %CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf302HandlerEntry: HandlerEntry = makeComfHandler(comf302Def);
