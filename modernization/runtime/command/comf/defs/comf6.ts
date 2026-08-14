/**
 * Phase 7 — `COMF6 胸愛撫` (breast caress — 快Ｂ focused), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM6`
 * (`ERB/コマンド関連/COMF/COMF6 胸愛撫.ERB`, lines 26-51, excluding the
 * deferred tongue-use block 52-62).
 *
 * **Faithful normal-mode core (ELSE branch):**
 *   - DOWNBASE: master 体力 5 / 気力 50 (ERB 26-27)
 *   - SOURCE target: 快Ｂ 100, 情愛 50, 性行動 60, 露出 10, 不潔 20, 反感 20
 *     (ERB 28-33)
 *   - ABL:PLAYER:指 >= 4 → 快Ｂ += 70; ELSE 快Ｂ += ABL:PLAYER:指 * 15
 *     (ERB 37-41)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 49-50)
 *   - body: 手淫経験 PLAYER++ (ERB 82)
 *
 * **DEFERRED (documented):**
 *   - Tongue-use block (ERB 52-62): gated on 胸汚垢 (STAIN:5) cleanliness
 *     level + TALENT:PLAYER:汚臭耐性. Conditionally applies 不潔 ×1.4,
 *     舌使い→快Ｂ ×1.4, 鬱屈 += floor(不潔/20), STAIN 口⇔Ｂ swap,
 *     口淫経験 PLAYER++. Entirely deferred — depends on STAIN model.
 *   - Time-stop branch (ERB 18-26) — TSP drain + reduced sources + STAIN.
 *   - STAIN 汚垢 handling (ERB 65-66) — entire subsystem deferred.
 *   - HETEROSEX 同性愛 EXP (ERB 71-80) — gender-pair helper deferred.
 *   - TCVAR markers (ERB 10-12) — H-scene action markers deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant (target-only SOURCE).
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
 * Whether the "tongue-use" arm of 胸愛撫 (ERB 52-62) fires, per the
 * 胸-cleanliness gate + ASSIPLAY + 汚臭耐性==2 escape (ERB 52).
 * `STAIN:5` (target 胸) must be < 2 (i.e. 0=clean or 1=愛液 only — the
 * "OK to use mouth" condition per ERB 52's comment), OR exactly 16
 * (愛液+母乳) or 17 (愛液+母乳+肛門), OR ASSIPLAY, OR master has
 * 汚臭耐性==2 (smell-blind). ASSIPLAY is a global flag not modeled in
 * the factory context → treated as 0 (the arm's normal-mode path).
 */
export function shouldUseMouth(breastSoil: number, masterSmellTolerance: number, assplay: boolean): boolean {
  if (assplay) return true;
  if (masterSmellTolerance === 2) return true;
  if (breastSoil < 2) return true;
  if (breastSoil === STAIN_BIT.愛液 + STAIN_BIT.母乳) return true; // 16
  if (breastSoil === STAIN_BIT.愛液 + STAIN_BIT.母乳 + STAIN_BIT.肛門) return true; // 17
  return false;
}

export const comf6Def: ComfDef = {
  commandNo: 6,
  label: "胸愛撫",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 26-27: DOWNBASE:体力 += 5, DOWNBASE:気力 += 50.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 28-33: base SOURCE quanta.
    let kaiB = 100; // 快Ｂ
    const jouai = 50; // 情愛
    const seiKodo = 60; // 性行動
    const roshutsu = 10; // 露出
    // ERB 52-62: tongue-use arm gates on 胸-cleanliness + ASSIPLAY +
    // 汚臭耐性==2. If it fires, 不潔 × 1.40. ASSIPLAY not modeled in factory
    // context → assplay=false. STAIN subsystem now modeled.
    const breastSoil = getStain(c.t, STAIN_PART.Ｂ);
    const masterSmell = c.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0;
    const fuketsu = shouldUseMouth(breastSoil, masterSmell, false)
      ? Math.trunc(20 * 1.4)
      : 20;
    const hankan = 20; // 反感

    // ERB 37-41: ABL:PLAYER:指 bonus on 快Ｂ.
    const yubi = c.mAbl(ABL_ID.指);
    if (yubi >= 4) {
      kaiB += 70;
    } else {
      kaiB += yubi * 15;
    }

    // ERB 49-50: SIF TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 20.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — single-participant command.

  body: (c) => {
    // ERB 82: EXP:PLAYER:手淫経験 ++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 59-60 (tongue-use arm only): STAIN swap — target Ｂ ⇔ master 口.
    const breastSoil = getStain(c.t, STAIN_PART.Ｂ);
    const masterSmell = c.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0;
    if (shouldUseMouth(breastSoil, masterSmell, false)) {
      const tb = breastSoil;
      const mm = getStain(c.master, STAIN_PART.口);
      c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mm;
      c.master.state.STAIN[STAIN_PART.口] = mm | tb;
      // ERB 62: EXP:PLAYER:口淫経験 ++.
      c.master.state.EXP[EXP_ID.口淫経験] =
        (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    }

    // ERB 65-66: unconditional STAIN swap — target Ｂ ⇔ master 手.
    const tb2 = getStain(c.t, STAIN_PART.Ｂ);
    const mh = getStain(c.master, STAIN_PART.手);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb2 | mh;
    c.master.state.STAIN[STAIN_PART.手] = mh | tb2;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 爱抚了 %CALLNAME:TARGET%'s breasts — 胸愛撫；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf6HandlerEntry: HandlerEntry = makeComfHandler(comf6Def);
