/**
 * Phase 7 — `COMF82 パイズリ` (titjob), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM82`
 * (`ERB/コマンド関連/COMF/COMF82 パイズリ.ERB`).
 *
 * **Oral/hand family (奉仕系 82).** Target uses breasts to pleasure the
 * master. Master `快Ｃ` scales with target ABL:胸 (capped at 100 bonus).
 *
 * **Faithful normal-mode core (ERB normal ELSE branch 37-62):**
 *   - master SOURCE: 快Ｃ = 110 + MIN(ABL:胸*25, 100)
 *   - DOWNBASE: target 体力 10 / 気力 100
 *   - SOURCE target: 快Ｂ 50, 情愛 150, 性行動 400, 達成 200, 屈従 1000,
 *     逸脱 500, 反感 500
 *   - 鬱屈 +600 if 自己愛<0 || 抵抗
 *   - EXP: 愛情経験 target++ if 恋慕>0
 *
 * **DEFERRED (documented):**
 *   - 不潔 — needs STAIN subsystem.
 *   - STAIN swap (Ｂ ↔ Ｐ) — STAIN not modeled.
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - Time-stop branch — TSP drain, target no drain.
 *   - EXP:乳交経験 — no EXP_ID available (deferred).
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
 * `Y` (汚れデータ) for パイズリ (ERB 231-244), pure for tests. Same shape as
 * フェラチオ (no /=3): Y from master Ｐ soil bits × (2-汚臭耐性)/2.
 * Returns 不潔 = Y*10 + 60 (ERB 53).
 */
export function computePaizuriFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf82Def: ComfDef = {
  commandNo: 82,
  label: "パイズリ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal ELSE.
  buildSources: (c) => {
    const kaiB = 50;       // 快Ｂ
    const jouai = 150;      // 情愛
    const seiKodo = 400;    // 性行動
    const tasei = 200;      // 達成
    const kutsuju = 1000;   // 屈従
    const itsudev = 500;    // 逸脱
    const hankan = 500;     // 反感

    // 不潔 = Y*10 + 60. Y from STAIN:PLAYER:2 (master Ｐ soil) + 汚臭耐性
    // scaling (ERB 231-244). STAIN subsystem now modeled.
    const fuketsu = computePaizuriFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // 鬱屈 +600 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 600;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 110 + MIN(ABL:胸*25, 100).
  buildMasterSources: (c) => {
    const mune = c.tAbl(ABL_ID.胸);
    const bonus = Math.min(mune * 25, 100);
    return {
      [SOURCE_ID.快Ｃ]: 110 + bonus,
    };
  },

  body: (c) => {
    // target 体力 10 / 気力 100 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // EXP:愛情経験 target++ if 恋慕>0.
    // EXP:乳交経験 deferred (no EXP_ID).
    if (c.tTalent(TALENT_ID.恋慕) > 0) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 67-68: STAIN swap — target Ｂ ⇔ master Ｐ.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%乳交 — パイズリ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf82HandlerEntry: HandlerEntry = makeComfHandler(comf82Def);
