/**
 * Phase 7 — `COMF91 アナル舐めされる` (anal licking on master), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM91`
 * (`ERB/コマンド関連/COMF/COMF91 アナル舐めされる.ERB`).
 *
 * **される系 / reverse (90-96).** Master is the recipient of anal
 * licking (rimming) by the target. Master receives `快Ａ`, target
 * takes a heavier SOURCE tail (stronger degradation than 90 愛撫)
 * plus a larger 鬱屈 penalty (1200 vs 400). Target with 猫舌 grants
 * master EXP嗜虐快楽経験.
 *
 * **Faithful normal-mode core (ERB 23-42):**
 *   - DOWNBASE: target 体力 10 / 気力 100 (ERB 23-24)
 *   - master SOURCE: 快Ａ = 100 (ERB 25)
 *   - SOURCE target: 情愛 300, 性行動 300, 屈従 300, 征服 900,
 *     逸脱 600, 反感 600 (ERB 26-31)
 *   - 自己愛<0 || 抵抗 → 鬱屈 +1200 (ERB 39-40)
 *   - EXP 嗜虐快楽経験 master++ if target has 猫舌 (ERB 108-109)
 *
 * **DEFERRED (documented):**
 *   - 不潔 = Y*80+50 (ERB 33) — Y from STAIN; pinned 0.
 *   - STAIN:0 ↔ STAIN:PLAYER:3 swap (ERB 44-45) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes — gender-pair helper.
 *   - STR:0 text marker (ERB 9) — H-scene flags.
 *   - COM_ABLE91 — アナル开发性癖/猫舌/ABL gates.
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
 * `Y` for アナル舐めされる (ERB 207-220), pure for tests. Y from master Ｖ
 * soil bits — note bit 32 (黏液, weight 15), NOT 16 (母乳). No /=3,
 * ×(2-汚臭耐性)/2. 不潔 = Y*80 + 50 (ERB 35).
 */
export function computeAnalLickFuketsu(masterVSoil: number, tolerance: number): number {
  let y = 0;
  if (masterVSoil & STAIN_BIT.愛液) y += 1;
  if (masterVSoil & STAIN_BIT.精液) y += 3;
  if (masterVSoil & STAIN_BIT.肛門) y += 7;
  if (masterVSoil & STAIN_BIT.黏液) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 80 + 50;
}

export const comf91Def: ComfDef = {
  commandNo: 91,
  label: "アナル舐めされる",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 23-24: target drain — in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 26-31: fixed tail. 不潔 = Y*80+50 (ERB 35), Y from master Ｖ.
    const fuketsu = computeAnalLickFuketsu(getStain(c.master, STAIN_PART.Ｖ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: 300,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.屈従]: 300,
      [SOURCE_ID.征服]: 900,
      [SOURCE_ID.逸脱]: 600,
      [SOURCE_ID.反感]: 600,
      [SOURCE_ID.不潔]: fuketsu,
    };
    // ERB 39-40: 鬱屈 +1200 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 1200;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE (ERB 25).
  buildMasterSources: () => ({
    [SOURCE_ID.快Ａ]: 100,
  }),

  body: (c) => {
    // ERB 23-24: target 体力 10 / 気力 100 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 108-109: 嗜虐快楽経験 master++ if target has 猫舌.
    if (c.tTalent(TALENT_ID.猫舌)) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 47-48: STAIN swap — target 口 ⇔ master Ａ.
    const tm = getStain(c.t, STAIN_PART.口);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    c.t.state.STAIN[STAIN_PART.口] = tm | ma;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET%舔舐了%CALLNAME:MASTER%的肛门 — アナル舐めされる；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf91HandlerEntry: HandlerEntry = makeComfHandler(comf91Def);
