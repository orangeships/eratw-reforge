/**
 * Phase 7 — `COMF20 キス` (Kiss) settlement, as a `ComfDef`.
 *
 * Ports `@COM20` (`ERB/コマンド関連/COMF/COMF20 キス.ERB`), the
 * normal-mode (ELSE) core. This is a KISS command that calls
 * KISS_TALENTEFFECT and KISS_EXP helpers from COMF19.
 *
 * **H foreplay family (root 0-26) sibling — dual-participant (B1b).**
 * Target gets 快Ｍ; master also gets 快Ｍ via buildMasterSources.
 *
 * **Faithful normal-mode core (ERB 30-78, ELSE branch):**
 *   - DOWNBASE: target 気力 50 (ERB 31); 体力 drain is 0 (ERB 30)
 *   - SOURCE target: 快Ｍ = ABL:PLAYER:舌*3 + 20 (ERB 33)
 *   - SOURCE target: 情愛 = 100 + GET_REVISION(EXP:愛情経験, 200, 100)
 *     (ERB 34)
 *   - SOURCE target: 性行動 = 50 + GET_REVISION(EXP:愛情経験, 50, 100)
 *     (ERB 35)
 *   - SOURCE target: 屈従 10, 逸脱 10, 反感 10 (ERB 36-38)
 *   - SOURCE target: 不潔 = 10 (ERB 39 — Y*20+10 where Y is STAIN;
 *     deferred, pinned to 10)
 *   - 好感度 (CFLAG:2) bonus to 情愛 (ERB 41-49):
 *     <= 500 → +好感度,
 *     <= 5000 → +300 + (好感度-500)/6,
 *     > 5000 → +1000 + (好感度-5000)/8
 *   - 情愛 >= 0 clamp (ERB 50-51)
 *   - KISS_TALENTEFFECT (COMF19 229-260):
 *     - 鬱屈 +50 if 自己愛<0 || 抵抗 (ERB 231-232)
 *     - 舌使い (master) ×1.50 on 情愛, 快Ｍ (ERB 244-246)
 *     - 猫舌 (master) ×0.75 on 情愛, 快Ｍ (ERB 251-253)
 *     - 接吻魔 (target) ×1.40 on 性行動, 情愛 (ERB 256-259)
 *   - buildMasterSources (ERB SOURCE:PLAYER:快Ｍ = ABL:舌*3 + 10;
 *     reads TARGET's ABL; modified by target 舌使い/猫舌/接吻魔)
 *   - EXP body (KISS_EXP normal mode COMF19 177-188):
 *     キス経験 both, 口淫経験 both, Ｍ経験 target,
 *     嗜虐快楽経験 target if target 猫舌
 *   - 恋慕 conditional: 愛情経験 target++ (ERB 76-78; RAND:2 → fixed 1)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (FLAG:70 == 1 && CFLAG:TARGET:344 == 0).
 *   - STAIN污垢 handling — Y computed from STAIN in CAN_COM20; pinned
 *     to 10 for 不潔.
 *   - KISS_CANCEL interactive check — not ported.
 *   - TEQUIP 体位 bonus (体位 1/4 → 情愛 ×1.30, 性行動 ×1.20) — TEQUIP
 *     not modeled.
 *   - TALENT:猫舌 (target) → SOURCE:加虐 +50 — 加虐 deferred entirely.
 *   - HETEROSEX 同性愛 EXP — gender-pair helper deferred.
 *   - TCVAR markers — deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *   - CFLAG:恶作剧 gate on 愛情経験 EXP — id not in CFLAG_ID exports;
 *     simplified to 恋慕-only gate.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  getRevision,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { canExecuteComf20 } from "../can-com.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` (汚れデータ) for 接吻 (ERB 198-212), pure for tests. Y accumulates
 * weights from the master's 口-part soil bits, then is scaled:
 *   - 愛液 (1) → +1, 精液 (4) → +3, 肛門 (8) → +7, 母乳 (16) → +15
 *   - Y /= 2  (接吻では汚れがそれほど影響しない)
 *   - Y = Y * (2 - 汚臭耐性) / 2
 * Returns the `不潔` SOURCE value = Y*20 + 10 (ERB 47).
 */
export function computeKissFuketsu(masterMouthSoil: number, tolerance: number): number {
  let y = 0;
  if (masterMouthSoil & STAIN_BIT.愛液) y += 1;
  if (masterMouthSoil & STAIN_BIT.精液) y += 3;
  if (masterMouthSoil & STAIN_BIT.肛門) y += 7;
  if (masterMouthSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc(y / 2);
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 20 + 10;
}

export const comf20Def: ComfDef = {
  commandNo: 20,
  label: "キス",
  canExecute: canExecuteComf20,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  targetDownbase: { [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 33: 快Ｍ = ABL:PLAYER:舌 * 3 + 20.
    let kaiM = c.mAbl(ABL_ID.舌) * 3 + 20;

    // ERB 34-35: 情愛 / 性行動 = 100/50 + GET_REVISION(EXP:愛情経験, limit, 100).
    const expAijou = c.t.state.EXP[EXP_ID.愛情経験] ?? 0;
    let jouai = 100 + getRevision(expAijou, 200, 100);
    let seiKodo = 50 + getRevision(expAijou, 50, 100);

    // ERB 36-38: fixed tail.
    const kutsuju = 10;  // 屈従
    const itsudev = 10;  // 逸脱
    const hankan = 10;   // 反感

    // ERB 47: 不潔 = Y*20 + 10. Y from STAIN:PLAYER:0 (master 口 soil) +
    // 汚臭耐性 scaling (ERB 198-212). STAIN subsystem now modeled.
    const fuketsu = computeKissFuketsu(getStain(c.master, STAIN_PART.口), c.tTalent(TALENT_ID.汚臭耐性));

    // ERB 41-49: 好感度 (CFLAG:2) bonus to 情愛.
    const favor = c.favor;
    if (favor <= 500) {
      jouai += favor;
    } else if (favor <= 5000) {
      jouai += 300 + Math.trunc((favor - 500) / 6);
    } else {
      jouai += 1000 + Math.trunc((favor - 5000) / 8);
    }

    // ---- KISS_TALENTEFFECT (COMF19 229-260) ----

    // ERB 231-232: 鬱屈 +50 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 50 : 0;

    // ERB 244-246: 舌使い (master) ×1.50 on 情愛, 快Ｍ.
    // ERB 247-249: 舌使い (target) ×1.50 on PLAYER:快Ｍ → handled in buildMasterSources.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      jouai = Math.trunc(jouai * 1.5);
      kaiM = Math.trunc(kaiM * 1.5);
    }

    // ERB 251-253: 猫舌 (master) ×0.75 on 情愛, 快Ｍ.
    // ERB 254-255: 猫舌 (target) ×0.75 on PLAYER:快Ｍ → handled in buildMasterSources.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      jouai = Math.trunc(jouai * 0.75);
      kaiM = Math.trunc(kaiM * 0.75);
    }

    // ERB 256-259: 接吻魔 (target) ×1.40 on 性行動, 情愛, PLAYER:快Ｍ.
    if (c.tTalent(TALENT_ID.接吻魔)) {
      seiKodo = Math.trunc(seiKodo * 1.4);
      jouai = Math.trunc(jouai * 1.4);
    }

    // ERB 50-51: 情愛 >= 0 clamp.
    if (jouai < 0) jouai = 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: kaiM,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.不潔]: fuketsu,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // ERB (COMF20 line 34 equivalent): SOURCE:PLAYER:快Ｍ = ABL:TARGET:舌*3 + 10,
  // modified by target 舌使い (×1.5), 猫舌 (×0.75), 接吻魔 (×1.4).
  buildMasterSources: (c): Record<number, number> => {
    let masterKM = c.tAbl(ABL_ID.舌) * 3 + 10;

    // ERB 247-249: IF TALENT:舌使い (target's) → ×1.50 on PLAYER:快Ｍ.
    if (c.tTalent(TALENT_ID.舌使い)) {
      masterKM = Math.trunc(masterKM * 1.5);
    }
    // ERB 254-255: IF TALENT:猫舌 (target's) → ×0.75 on PLAYER:快Ｍ.
    if (c.tTalent(TALENT_ID.猫舌)) {
      masterKM = Math.trunc(masterKM * 0.75);
    }
    // ERB 258-259: IF TALENT:接吻魔 (target's) → ×1.40 on PLAYER:快Ｍ.
    if (c.tTalent(TALENT_ID.接吻魔)) {
      masterKM = Math.trunc(masterKM * 1.4);
    }

    return { [SOURCE_ID.快Ｍ]: masterKM };
  },

  body: (c) => {
    // ---- KISS_EXP normal mode (COMF19 177-188) ----

    // EXP:キス経験 ++ (target).
    c.t.state.EXP[EXP_ID.キス経験] =
      (c.t.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
    // EXP:口淫経験 ++ (target).
    c.t.state.EXP[EXP_ID.口淫経験] =
      (c.t.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    // EXP:Ｍ経験 ++ (target).
    c.t.state.EXP[EXP_ID.Ｍ経験] =
      (c.t.state.EXP[EXP_ID.Ｍ経験] ?? 0) + 1;
    // EXP:PLAYER:口淫経験 ++ (master).
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    // EXP:PLAYER:キス経験 ++ (master).
    c.master.state.EXP[EXP_ID.キス経験] =
      (c.master.state.EXP[EXP_ID.キス経験] ?? 0) + 1;

    // ERB (KISS_EXP 188): SIF TALENT:ARG:猫舌 → 嗜虐快楽経験 += 1 (target).
    if (c.tTalent(TALENT_ID.猫舌)) {
      c.t.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.t.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 76-78: SIF TALENT:恋慕 && !(FLAG:70 == 1 || CFLAG:恶作剧)
    //   → EXP:愛情経験 += 1 (RAND:2 → fixed 1).
    //   Time-stop and 恶作剧 gates deferred.
    if (c.tTalent(TALENT_ID.恋慕)) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 74-75: STAIN swap — target 口 ⇔ master 口.
    const tm = getStain(c.t, STAIN_PART.口);
    const mm = getStain(c.master, STAIN_PART.口);
    c.t.state.STAIN[STAIN_PART.口] = tm | mm;
    c.master.state.STAIN[STAIN_PART.口] = mm | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%亲吻了%CALLNAME:TARGET%。；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf20HandlerEntry: HandlerEntry = makeComfHandler(comf20Def);
