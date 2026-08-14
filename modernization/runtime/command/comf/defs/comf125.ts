/**
 * Phase 7 — `COMF125 愛撫させる` (make target caress master), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM125`
 * (`ERB/コマンド関連/COMF/COMF125 愛撫させる.ERB`).
 *
 * **Oral/hand family.** Master commands the target to perform caressing.
 * Master receives 快Ｃ 40; target takes 情愛 50 and 反感 100 (commented-
 * out 性行動/屈従/逸脱 are inactive in the normal branch). Large 鬱屈
 * penalty for self-loving or resistant targets.
 *
 * **Faithful normal-mode core (ERB 35-56, ELSE branch):**
 *   - target DOWNBASE: 体力 10 / 気力 100 (ERB 35-36)
 *   - master SOURCE: 快Ｃ = 40 (ERB 37)
 *   - target SOURCE: 情愛 50, 反感 100 (ERB 38-45; note: 性行動 250,
 *     屈従 350, 逸脱 100 are COMMENTED OUT → inactive)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗 (ERB 52-53)
 *   - EXP: 手淫経験 target++ (ERB 71-72)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 30-33) — TSP drain, different SOURCE values.
 *   - 不潔 SOURCE calculation (ERB 46-52) — depends on STAIN state.
 *   - STAIN swap (mutual hand/B, ERB 54-55) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 56) — gender-pair helper deferred.
 *   - Master female 快Ｂ bonus (ERB beyond normal branch) — deferred.
 *   - COM_ABLE125 success-rate calculation — COMABLE layer.
 *   - TCVAR markers — H-scene chaining deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` for 触手搾精 (ERB 188-201), pure for tests. Y from master Ｖ soil bits,
 * no /=, ×(2-汚臭耐性)/2. 不潔 = Y*80 + 50 (ERB 49).
 */
export function computeTentacleMilkFuketsu(masterVSoil: number, tolerance: number): number {
  let y = 0;
  if (masterVSoil & STAIN_BIT.愛液) y += 1;
  if (masterVSoil & STAIN_BIT.精液) y += 3;
  if (masterVSoil & STAIN_BIT.肛門) y += 7;
  if (masterVSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 80 + 50;
}

export const comf125Def: ComfDef = {
  commandNo: 125,
  label: "愛撫させる",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    // ERB 38-45: target SOURCE (commented-out 性行動 250, 屈従 350,
    // 逸脱 100 are INACTIVE). Only 情愛 50 and 反感 100 are active.
    // 不潔 = Y*80+50. Y from STAIN:PLAYER:3 (master Ｖ) + 汚臭耐性 (ERB 188-201).
    const fuketsu = computeTentacleMilkFuketsu(getStain(c.master, STAIN_PART.Ｖ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: 50,
      [SOURCE_ID.反感]: 100,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // ERB 52-53: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // ERB 37: master SOURCE:PLAYER:快Ｃ = 40.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 40,
  }),

  body: (c) => {
    // ERB 35-36: target 体力 10 / 気力 100 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 71-72: EXP:手淫経験 target++.
    c.t.state.EXP[EXP_ID.手淫経験] =
      (c.t.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 62-63 + 65-66: STAIN swap — master 手 ⇔ target Ｐ AND master Ｂ ⇔ target Ｐ.
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    const mh = getStain(c.master, STAIN_PART.手);
    const mb = getStain(c.master, STAIN_PART.Ｂ);
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | mh | mb;
    c.master.state.STAIN[STAIN_PART.手] = mh | tp;
    c.master.state.STAIN[STAIN_PART.Ｂ] = mb | tp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 爱抚了 %CALLNAME:MASTER% — 愛撫させる；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf125HandlerEntry: HandlerEntry = makeComfHandler(comf125Def);
