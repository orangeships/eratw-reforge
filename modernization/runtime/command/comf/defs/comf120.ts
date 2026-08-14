/**
 * Phase 7 — `COMF120 クンニ強制` (forced cunnilingus on master), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM120`
 * (`ERB/コマンド関連/COMF/COMF120 クンニ強制.ERB`).
 *
 * **Oral/hand family.** Target is forced to perform cunnilingus on the
 * master. Master receives 快Ｃ scaled by target's ABL:舌; target takes
 * heavy 屈従 (500) and 逸脱 (200), plus a large 鬱屈 penalty for
 * self-loving/resistant targets.
 *
 * **Faithful normal-mode core (ERB 24-51):**
 *   - target DOWNBASE: 体力 10 / 気力 100 (ERB 24-25)
 *   - master SOURCE: 快Ｃ = 80 + (tAbl(舌)>=4 ? 100 : tAbl(舌)*20)
 *     (ERB 26-30)
 *   - target SOURCE: 快Ｍ 50, 性行動 300, 達成 150, 屈従 500, 逸脱 200,
 *     反感 200 (ERB 31-37)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗 (ERB 38-40)
 *   - EXP: 嗜虐快楽経験 master++ if target 猫舌 (ERB 47-49)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 22-23, with ABL scaling block) — deferred.
 *   - 不潔 SOURCE calculation (ERB 42) — depends on STAIN state.
 *   - STAIN swap (ERB 43) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 44) — gender-pair helper deferred.
 *   - SOURCE:PLAYER:液体 (ERB 45) — no SOURCE_ID; deferred.
 *   - EXP口淫経験 (ERB 46) — no existing EXP_ID; deferred.
 *   - COM_ABLE120 success-rate calculation — COMABLE layer.
 *   - TCVAR markers — H-scene chaining deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` for ６９式 (ERB 187-200), pure for tests. Y from master Ｖ soil bits,
 * no /=, ×(2-汚臭耐性)/2. 不潔 = Y*80 + 50 (ERB 36).
 */
export function compute69Fuketsu(masterVSoil: number, tolerance: number): number {
  let y = 0;
  if (masterVSoil & STAIN_BIT.愛液) y += 1;
  if (masterVSoil & STAIN_BIT.精液) y += 3;
  if (masterVSoil & STAIN_BIT.肛門) y += 7;
  if (masterVSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 80 + 50;
}

export const comf120Def: ComfDef = {
  commandNo: 120,
  label: "クンニ強制",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    // 不潔 = Y*80+50. Y from STAIN:PLAYER:3 (master Ｖ) + 汚臭耐性 (ERB 187-200).
    const fuketsu = compute69Fuketsu(getStain(c.master, STAIN_PART.Ｖ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: 50,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.達成]: 150,
      [SOURCE_ID.屈従]: 500,
      [SOURCE_ID.逸脱]: 200,
      [SOURCE_ID.反感]: 200,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // ERB 38-40: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // ERB 26-30: master SOURCE:PLAYER:快Ｃ = 80 + (ABL:舌>=4 ? 100 : ABL:舌*20).
  buildMasterSources: (c) => {
    const tongue = c.tAbl(ABL_ID.舌);
    return {
      [SOURCE_ID.快Ｃ]: 80 + (tongue >= 4 ? 100 : tongue * 20),
    };
  },

  body: (c) => {
    // ERB 24-25: target 体力 10 / 気力 100 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 47-49: EXP:嗜虐快楽経験 master++ if target 猫舌.
    if (c.tTalent(TALENT_ID.猫舌)) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 58-59: STAIN swap — target 口 ⇔ master Ｖ.
    const tm = getStain(c.t, STAIN_PART.口);
    const mv = getStain(c.master, STAIN_PART.Ｖ);
    c.t.state.STAIN[STAIN_PART.口] = tm | mv;
    c.master.state.STAIN[STAIN_PART.Ｖ] = mv | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% %CALLNAME:TARGET%被迫为%CALLNAME:MASTER%口交 — クンニ強制；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf120HandlerEntry: HandlerEntry = makeComfHandler(comf120Def);
