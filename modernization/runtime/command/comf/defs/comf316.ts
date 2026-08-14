/**
 * Phase 7B — `COMF316 指挿れ` (finger insertion) settlement, as a `ComfDef`.
 *
 * Ports `@COM316` (`ERB/コマンド関連/COMF/日常系/COMF316 指挿れ.ERB`),
 * 通常 arm (TFLAG:192 == 0, the outer ELSE block excluding the
 * FLAG:70==1 時間停止 path and TFLAG:192==-1 forced-failure path).
 *
 * Outcome roll: No explicit RAND roll in the ERB — the command has no
 * 大成功/失敗 bifurcation. maxRoll 100, greatThreshold 5, failThreshold 100
 * are set so the factory skeleton still runs but the roll never produces
 * fail (roll 0-99 < 100). All per-source outcome multipliers are MUL_NONE
 * (1.0) so the roll has no effect on source quanta.
 *
 * SOURCE build (ERB 34-66, 通常 arm only):
 *   - **処女 (TALENT:処女 > 0):**
 *     快Ｖ 60, 情愛 150, 苦痛 250, 欲情 200, 露出 350, 逸脱 300, 反感 1000
 *   - **非処女 (TALENT:処女 == 0 || == -1):**
 *     快Ｖ 120, 情愛 150, 苦痛 250, 欲情 200, 露出 250, 逸脱 150, 反感 800
 *   - **鬱屈 (conditional, ERB 61-66):**
 *     IF TALENT:自己愛(31) < 0 || TALENT:抵抗(32) → 鬱屈 += 20
 *     SIF TALENT:処女 within that block → 鬱屈 += 10
 *     (=> 処女+抵抗 = 30, 非処女+抵抗 = 20, neither = 0)
 *
 * 好感度 delta handled by shared `applySourceCheck`.
 *
 * Persisted: TIME += 5 (via timeCost; ERB line 89, ELSE branch);
 * EXP:PLAYER:手淫経験++ (ERB line 79, always executed outside the big IF).
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - FLAG:70 == 1 && CFLAG:TARGET:344 == 0 (時間停止) path — entirely
 *     separate arm with BASE:MASTER:TSP -= 40, different SOURCE quantities,
 *     and no DOWNBASE
 *   - TFLAG:192 == -1 (口上による強制失敗) — early RETURN -1
 *   - TCVAR:116 = PLAYER (line 10)
 *   - TFLAG:2 = 1 (破瓜抑制, line 13)
 *   - TFLAG:理性削り = 1 (line 14)
 *   - TFLAG:信頼度管理 = -7 (line 55)
 *   - PAIN_CHECK_V(TARGET) (line 69)
 *   - STAIN bit-flag propagation (lines 74-75)
 *   - EXP:(50+HETEROSEX) += 4 dynamic experience grants (lines 80-88)
 *   - TEQUIP clothing checks (not present in this ERB)
 *   - HITOKE(1) bystander checks (not present in this ERB)
 *   - MAGIC_DLC_*, dating, 催眠/強行, CASE 1/-1/-2 arms
 *   - IS_DATING_WITH_PLAYER
 *   - GET_SUCCESS_RATE
 *   - FAVOR_CALC 日常時 BASE/情緒/理性 block, TRUST_CALC
 *   - TALENT/MARK/DLC personality modifiers
 */

import type { HandlerEntry } from "../../types.js";
import { BASE_ID, SOURCE_ID, TALENT_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";

/** TALENT id for 自己愛 (self-love / narcissism / repression). */
const TALENT_JIKOAI = 31;
/** TALENT id for 抵抗 (resistance). */
const TALENT_TEIKOU = 32;
/** EXP id for 手淫経験 (manual experience). Not yet in EXP_ID enum. */
const EXP_SHUNIN = 24;

export const comf316Def: ComfDef = {
  commandNo: 316,
  label: "指挿れ",
  // @COM_ABLE316 (Slice 7): only 気力>0 is unconditional; the
  // 亲热<2/睡眠/陪睡中/行動/約會/甲斐性無 cluster is !FLAG:70-conditional, and
  // the rest are TEQUIP:0/50 着衣·挿入 / TFLAG:61 / TCVAR:26 gates — deferred.
  gate: {
    requiresMasterStamina: true,
    deferredGates:
      "亲热<2/睡眠/陪睡中/行動==5/約會/甲斐性無 (!FLAG:70-conditional); TEQUIP:0&4 着衣 / TEQUIP:50 挿入; TFLAG:61 MASTER_POSE; GETBIT(TCVAR:26,6)",
  },
  timeCost: 5,
  maxRoll: 100,
  greatThreshold: 5,
  failThreshold: 100,

  // ERB 31-32 (通常 arm): 体力 30 + 気力 80
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 80 },

  buildSources: (c) => {
    // ERB 34-52: branching on TALENT:処女
    // `!TALENT:処女 || TALENT:処女 -1` → non-virgin (talent absent or inverted)
    // ELSE → virgin (TALENT:処女 > 0)
    const isVirgin = c.tTalent(TALENT_ID.処女) > 0;

    const kaiV = isVirgin ? 60 : 120;       // SOURCE:快Ｖ
    const jouai = 150;                       // SOURCE:情愛 (same both branches)
    const kutsuu = 250;                      // SOURCE:苦痛 (same both branches)
    const yokujo = 200;                      // SOURCE:欲情 (same both branches)
    const roshutsu = isVirgin ? 350 : 250;   // SOURCE:露出
    const itsudatsu = isVirgin ? 300 : 150;  // SOURCE:逸脱
    const hankan = isVirgin ? 1000 : 800;    // SOURCE:反感

    // 特殊ソース処理: TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 20 (ERB 61-62)
    // SIF TALENT:処女 → 鬱屈 += 10 (ERB 64-65, nested inside the resistance check)
    let utsukutsu = 0;
    const jikoai = c.tTalent(TALENT_JIKOAI);
    const teikou = c.tTalent(TALENT_TEIKOU);
    // TALENT values: 0 = absent, positive = present trait, negative = inverted trait
    // ERB `SIF TALENT:自己愛 < 0 || TALENT:抵抗` — truthy check on 抵抗
    if (jikoai < 0 || teikou !== 0) {
      utsukutsu += 20;
      if (isVirgin) {
        utsukutsu += 10;
      }
    }

    return {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.欲情]: yokujo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudatsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.鬱屈]: utsukutsu,
    };
  },

  // No outcome-based TIMES in the ERB → all sources use MUL_NONE.
  // Must be explicit: the factory defaults missing entries to MUL_POSITIVE.
  outcomeMul: {
    [SOURCE_ID.快Ｖ]: MUL_NONE,
    [SOURCE_ID.情愛]: MUL_NONE,
    [SOURCE_ID.苦痛]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.逸脱]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.鬱屈]: MUL_NONE,
  },

  // No TFLAG:97 pre-seed brackets in the ERB. favorBias omitted (defaults to 0).

  // EXP:PLAYER:手淫経験++ (ERB line 79, always executed).
  body: (c) => {
    c.master.state.EXP[EXP_SHUNIN] = (c.master.state.EXP[EXP_SHUNIN] ?? 0) + 1;
  },

  narration: (c, favorDelta) => {
    const word =
      c.outcome === 1 ? "娴熟地"
      : c.outcome === -1 ? "笨拙地"
      : "温柔地";
    return `%CALLNAME:MASTER% ${word} inserted a finger into %CALLNAME:TARGET%'s vagina；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf316HandlerEntry: HandlerEntry = makeComfHandler(comf316Def);
