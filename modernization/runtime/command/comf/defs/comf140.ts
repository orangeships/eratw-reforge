/**
 * Phase 7 (Wave 4b) — `COMF140 イラマチオ` (deep-throat / irrumatio), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM140`
 * (`ERB/コマンド関連/COMF/COMF140 イラマチオ.ERB`). The MASTER gets 快Ｃ
 * (tongue-scaled), the target gets a 達成/苦痛/屈従/逸脱/反感 service bundle.
 *
 * **Faithful normal-mode core (ERB ELSE branch):**
 *   - DOWNBASE target 体力 150 / 気力 200.
 *   - SOURCE:PLAYER:快Ｃ = 110, then 性技補正 (ERB): ABL:舌 ≥ 4 →
 *     +100 +ABL:舌×25 then ×1.25; 舌使い → ×1.25; 猫舌 → ×0.50.
 *   - SOURCE target: 達成 500, 苦痛 200, 屈従 1500, 逸脱 700, 反感 700,
 *     不潔 = Y×40 + 100 (Y = STAIN 污垢, deferred → 0 → 100).
 *   - 鬱屈 +700 if 自己愛<0 || 抵抗.
 *   - EXP:口淫経験 ++ (target); 愛情経験 +1 if 恋慕 && 受虐属性 ≥ 5.
 *
 * **DEFERRED:** time-stop branch; STAIN (Y → 不潔 base 100); HETEROSEX EXP;
 * TCVAR markers (射精部位 = 4 口淫); ASSIPLAY gate; COMABLE gate.
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
 * `Y` for フィストファック (ERB 254-266), pure for tests. Y from master Ｐ
 * soil bits, no /=, ×(2-汚臭耐性)/2. 不潔 = Y*40 + 100 (ERB 58).
 */
export function computeFistFuckFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 40 + 100;
}

export const comf140Def: ComfDef = {
  commandNo: 140,
  label: "イラマチオ",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    // 不潔 = Y*40 + 100. Y from STAIN:PLAYER:2 (master Ｐ) + 汚臭耐性 (ERB 254-266).
    const fuketsu = computeFistFuckFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.達成]: 500,
      [SOURCE_ID.苦痛]: 200,
      [SOURCE_ID.屈従]: 1500,
      [SOURCE_ID.逸脱]: 700,
      [SOURCE_ID.反感]: 700,
      [SOURCE_ID.不潔]: fuketsu,
    };
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // SOURCE:PLAYER:快Ｃ = 110 + 舌 補正 (master pleasure).
  buildMasterSources: (c): Record<number, number> => {
    let kaiC = 110;
    if (c.mAbl(ABL_ID.舌) >= 4) {
      kaiC += 100 + c.mAbl(ABL_ID.舌) * 25;
      kaiC = Math.trunc(kaiC * 1.25);
    }
    if (c.master.state.TALENT[TALENT_ID.舌使い]) kaiC = Math.trunc(kaiC * 1.25);
    if (c.master.state.TALENT[TALENT_ID.猫舌]) kaiC = Math.trunc(kaiC * 0.5);
    return { [SOURCE_ID.快Ｃ]: kaiC };
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 150;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;

    // EXP:口淫経験 ++ (target).
    c.t.state.EXP[EXP_ID.口淫経験] = (c.t.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    // 愛情経験 +1 if 恋慕 && 受虐属性 ≥ 5.
    if (c.tTalent(TALENT_ID.恋慕) && c.tAbl(ABL_ID.受虐属性) >= 5) {
      c.t.state.EXP[EXP_ID.愛情経験] = (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 94-95: STAIN swap — target 口 ⇔ master Ｐ.
    const tm = getStain(c.t, STAIN_PART.口);
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    c.t.state.STAIN[STAIN_PART.口] = tm | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用%CALLNAME:TARGET%的嘴深喉了 — イラマチオ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf140HandlerEntry: HandlerEntry = makeComfHandler(comf140Def);
