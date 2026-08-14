/**
 * Phase 7B — `COMF315 クリ愛撫` (clitoris caress) settlement, as a `ComfDef`.
 *
 * Ports `@COM315` (`ERB/コマンド関連/COMF/日常系/COMF315 クリ愛撫.ERB`),
 * 通常 arm (the outer ELSE block excluding the
 * FLAG:70==1 時間停止 path and TFLAG:192==-1 forced-failure path).
 *
 * Outcome roll: No explicit RAND roll in the ERB — the command has no
 * 大成功/失敗 bifurcation. Default maxRoll 100, greatThreshold 5,
 * failThreshold 90 are preserved so the factory skeleton still runs,
 * but all per-source outcome multipliers are MUL_NONE (1.0) so the
 * roll has no effect on source quanta.
 *
 * SOURCE build (ERB 47-91, 通常 arm only):
 *   - Base: 歓楽 100, 情愛 150, 欲情 150, 露出 250, 反感 600, 快Ｃ 80,
 *     受動 = 145 + 270*ABL:従順
 *   - ABL:PLAYER:指 (id 50) adds to 快Ｃ: >=4 → +50, else +yubi*10
 *   - TALENT:自己愛(31) < 0 || TALENT:抵抗(32) → 鬱屈 += 20
 *
 * 好感度 delta handled by shared `applySourceCheck`.
 *
 * Persisted: TIME += 5 (via timeCost; ERB line 107); EXP:PLAYER:手淫経験++
 * (EXP id 24, ERB line 109).
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - FLAG:70 == 1 && CFLAG:TARGET:344 == 0 (時間停止) path — entirely
 *     separate arm with different SOURCE quantities, TSP consumption,
 *     and no DOWNBASE
 *   - TFLAG:192 == -1 (口上による強制失敗) — early RETURN -1
 *   - DOWNBASE:体力 += 5, DOWNBASE:気力 += 50
 *   - TEQUIP clothing checks (TEQUIP:0 & 16 → 0.80x / TEQUIP > 1 → 0.90x)
 *     on 快Ｃ / 欲情 / 露出
 *   - HITOKE(1) bystander check → 2.00x on 露出 / 反感
 *   - TFLAG:信頼度管理 = -5
 *   - STAIN (汚れ) bit-flag propagation between PLAYER and TARGET (lines 95-97)
 *   - EXP:(50+HETEROSEX) dynamic experience grants (lines 103-105)
 *   - TCVAR:116 = PLAYER (line 22)
 *   - TFLAG:理性削り = 1 (line 23)
 *   - MAGIC_DLC_*, dating, 催眠/強行, CASE 1/-1/-2 arms
 *   - IS_DATING_WITH_PLAYER
 *   - GET_SUCCESS_RATE
 *   - FAVOR_CALC 日常時 BASE/情緒/理性 block, TRUST_CALC
 *   - TALENT/MARK/DLC personality modifiers
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";

/** ABL id for 指 (finger technique). Not yet in ABL_ID enum. */
const ABL_YUBI = 50;
/** TALENT id for 自己愛 (self-love / narcissism / repression). */
const TALENT_JIKOAI = 31;
/** TALENT id for 抵抗 (resistance). */
const TALENT_TEIKOU = 32;
/** EXP id for 手淫経験 (manual experience). Not yet in EXP_ID enum. */
const EXP_SHUNIN = 24;

export const comf315Def: ComfDef = {
  commandNo: 315,
  label: "クリ愛撫",
  // @COM_ABLE315 (Slice 7): only 気力>0 is unconditional; the
  // 亲热<2/睡眠/陪睡中/行動/約會/甲斐性無 cluster is !FLAG:70-conditional, and
  // the rest are TFLAG:61 MASTER_POSE / TCVAR:26 counter gates — deferred.
  gate: {
    requiresMasterStamina: true,
    deferredGates:
      "亲热<2/睡眠/陪睡中/行動==5/約會/甲斐性無 (!FLAG:70-conditional); TFLAG:61 MASTER_POSE; GETBIT(TCVAR:26,5)",
  },
  timeCost: 5,
  maxRoll: 100,
  greatThreshold: 5,
  failThreshold: 100,

  // ERB 52-53 (通常 arm): 体力 5 + 気力 50
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {

    // Base sources (ERB 55-61)
    const kanraku = 100;   // SOURCE:歓楽 = 100
    const jouai = 150;     // SOURCE:情愛 = 150
    const yokujo = 150;    // SOURCE:欲情 = 150
    const roshutsu = 250;  // SOURCE:露出 = 250
    const hankan = 600;    // SOURCE:反感 = 600
    let kaiC = 80;         // SOURCE:快Ｃ = 80
    const judo = 145 + 270 * c.tAbl(ABL_ID.従順); // SOURCE:受動 = 145+270*ABL:従順

    // ABL:PLAYER:指 adjustment on SOURCE:快Ｃ (ERB 62-66)
    const yubi = c.mAbl(ABL_YUBI);
    if (yubi >= 4) {
      kaiC += 50;
    } else {
      kaiC += yubi * 10;
    }

    // 特殊ソース処理: TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 20 (ERB 89-90)
    let utsukutsu = 0;
    const jikoai = c.tTalent(TALENT_JIKOAI);
    const teikou = c.tTalent(TALENT_TEIKOU);
    // TALENT values: 0 = absent, positive = present trait, negative = inverted trait
    // ERB `SIF TALENT:自己愛 < 0 || TALENT:抵抗` — truthy check on 抵抗
    if (jikoai < 0 || teikou !== 0) {
      utsukutsu = 20;
    }

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.欲情]: yokujo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.鬱屈]: utsukutsu,
    };
  },

  // No outcome-based TIMES in the ERB → all sources use MUL_NONE.
  // Must be explicit: the factory defaults missing entries to MUL_POSITIVE.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.情愛]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.快Ｃ]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.鬱屈]: MUL_NONE,
  },

  // No TFLAG:97 pre-seed brackets in the ERB. favorBias omitted (defaults to 0).

  // EXP:PLAYER:手淫経験++ (ERB line 109).
  body: (c) => {
    c.master.state.EXP[EXP_SHUNIN] = (c.master.state.EXP[EXP_SHUNIN] ?? 0) + 1;
  },

  narration: (c, favorDelta) => {
    const word =
      c.outcome === 1 ? "娴熟地"
      : c.outcome === -1 ? "笨拙地"
      : "温柔地";
    return `%CALLNAME:MASTER% ${word} 爱抚了%CALLNAME:TARGET%的阴蒂；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf315HandlerEntry: HandlerEntry = makeComfHandler(comf315Def);
