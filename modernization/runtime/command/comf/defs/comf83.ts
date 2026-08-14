/**
 * Phase 7 — `COMF83 素股` (thigh sex), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM83`
 * (`ERB/コマンド関連/COMF/COMF83 素股.ERB`).
 *
 * **Oral/hand family (奉仕系 83).** Target uses thighs (intercrural) to
 * pleasure the master. Both participants receive 快Ｃ.
 *
 * **Faithful normal-mode core (ERB normal ELSE branch 37-58):**
 *   - master SOURCE: 快Ｃ = 150
 *   - DOWNBASE: target 体力 40 / 気力 130
 *   - SOURCE target: 快Ｃ 150, 情愛 80, 性行動 250, 達成 50, 屈従 500,
 *     逸脱 120, 反感 120
 *   - 鬱屈 +300 if 自己愛<0 || 抵抗
 *   - No body EXP (only HETEROSEX which is deferred).
 *
 * **DEFERRED (documented):**
 *   - 不潔 — needs STAIN subsystem.
 *   - STAIN swap — STAIN not modeled.
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - Time-stop branch — TSP drain, target no drain.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` for 素股 (ERB 210-223), pure for tests. Y from master Ｐ soil bits,
 * no /=3, ×(2-汚臭耐性)/2. 不潔 = Y*10 + 60 (ERB 51).
 */
export function computeSumataFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf83Def: ComfDef = {
  commandNo: 83,
  label: "素股",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal ELSE.
  buildSources: (c) => {
    const kaiC = 150;      // 快Ｃ
    const jouai = 80;       // 情愛
    const seiKodo = 250;    // 性行動
    const tasei = 50;       // 達成
    const kutsuju = 500;    // 屈従
    const itsudev = 120;    // 逸脱
    const hankan = 120;     // 反感

    // 不潔 = Y*10 + 60. Y from STAIN:PLAYER:2 (master Ｐ) + 汚臭耐性 (ERB 210-223).
    const fuketsu = computeSumataFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // 鬱屈 +300 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 300;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 150.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 150,
  }),

  body: (c) => {
    // target 体力 40 / 気力 130 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 130;

    // No body EXP with available IDs. HETEROSEX deferred.

    // ERB 65-66: STAIN swap — target Ｖ ⇔ master Ｐ.
    const tv = getStain(c.t, STAIN_PART.Ｖ);
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    c.t.state.STAIN[STAIN_PART.Ｖ] = tv | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tv;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%素股 — 素股；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf83HandlerEntry: HandlerEntry = makeComfHandler(comf83Def);
