/**
 * Phase 7 — `COMF88 バキュームフェラ` (vacuum fellatio), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM88`
 * (`ERB/コマンド関連/COMF/COMF88 バキュームフェラ.ERB`).
 *
 * **Oral/hand family (奉仕系 88).** Target performs intense vacuum-
 * pressure fellatio on the master. Master receives flat 快Ｃ=110;
 * target takes heavy psychological SOURCE. If the target has 猫舌
 * (cat tongue), the master gains 嗜虐快楽経験 from the unusual sensation.
 *
 * **Faithful normal-mode core (ERB normal ELSE branch 29-48):**
 *   - master SOURCE: 快Ｃ = 110
 *   - DOWNBASE: target 体力 30 / 気力 150
 *   - SOURCE target: 快Ｍ 80, 情愛 100, 性行動 350, 達成 150, 屈従 800,
 *     逸脱 300, 反感 650
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗
 *   - EXP: 愛情経験 target++ if 恋慕>0
 *   - EXP: 嗜虐快楽経験 master++ if target has 猫舌
 *
 * **DEFERRED (documented):**
 *   - 不潔 — needs STAIN subsystem.
 *   - STAIN swap — STAIN not modeled.
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - Time-stop branch — TSP drain, target no drain.
 *   - EXP:精飲経験 — deferred (no ID in our enum).
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
 * `Y` for バキュームフェラ (ERB 236-249), pure for tests. Y from master Ｐ
 * soil bits, no /=3, ×(2-汚臭耐性)/2. 不潔 = Y*10 + 60 (ERB 41).
 */
export function computeVacuumFellatioFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf88Def: ComfDef = {
  commandNo: 88,
  label: "バキュームフェラ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal ELSE.
  buildSources: (c) => {
    const kaiM = 80;       // 快Ｍ
    const jouai = 100;      // 情愛
    const seiKodo = 350;    // 性行動
    const tasei = 150;      // 達成
    const kutsuju = 800;    // 屈従
    const itsudev = 300;    // 逸脱
    const hankan = 650;     // 反感

    // 不潔 = Y*10 + 60. Y from STAIN:PLAYER:2 (master Ｐ) + 汚臭耐性 (ERB 236-249).
    const fuketsu = computeVacuumFellatioFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: kaiM,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 110.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 110,
  }),

  body: (c) => {
    // target 体力 30 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 30;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 63: EXP:口淫経験 += 3 (target). An earlier port marked this
    // "no ID" and dropped it — the id exists (exp.als 25).
    c.t.state.EXP[EXP_ID.口淫経験] =
      (c.t.state.EXP[EXP_ID.口淫経験] ?? 0) + 3;

    // ERB 80-81: EXP:愛情経験 += 1 (target) if 恋慕 (&& ASSIPLAY==0,
    // ASSIPLAY deferred).
    if (c.tTalent(TALENT_ID.恋慕) > 0) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 84-85: EXP:嗜虐快楽経験 master++ if target has 猫舌.
    // EXP:精飲経験 deferred (no id in our enum).
    if (c.tTalent(TALENT_ID.猫舌)) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 56-57: STAIN swap — target 口 ⇔ master Ｐ.
    const tm = getStain(c.t, STAIN_PART.口);
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    c.t.state.STAIN[STAIN_PART.口] = tm | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%深喉口交 — バキュームフェラ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf88HandlerEntry: HandlerEntry = makeComfHandler(comf88Def);
