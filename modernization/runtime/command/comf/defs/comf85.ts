/**
 * Phase 7 — `COMF85 足コキ` (footjob), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM85`
 * (`ERB/コマンド関連/COMF/COMF85 足コキ.ERB`).
 *
 * **Oral/hand family (奉仕系 85).** Target uses feet to pleasure the
 * master. Master receives 快Ｃ; target takes social/psychological SOURCE
 * only (no erotic pleasure sources on target side).
 *
 * **Faithful normal-mode core (ERB normal ELSE branch 30-52):**
 *   - master SOURCE: 快Ｃ = 250
 *   - DOWNBASE: target 体力 10 / 気力 150
 *   - SOURCE target: 性行動 700, 達成 500, 屈従 500, 逸脱 400, 反感 400,
 *     征服 500
 *   - 鬱屈 +600 if 自己愛<0 || 抵抗
 *   - No body EXP with available IDs.
 *
 * **DEFERRED (documented):**
 *   - SOURCE:加虐=800 — 加虐 not in SOURCE_ID (deferred).
 *   - 不潔 — needs STAIN subsystem.
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - Time-stop branch — TSP drain, target no drain.
 *   - TALENT:美脚 master SOURCE bonus — needs talent reader.
 *   - EXP:足交経験 — no EXP_ID available (deferred).
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
 * `Y` for 足コキ (ERB 243-257), pure for tests. Y from master Ｐ soil bits,
 * /=3, ×(2-汚臭耐性)/2. 不潔 = Y*10 + 50 (ERB 45, note base 50 not 60).
 */
export function computeFootjobFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc(y / 3);
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 50;
}

export const comf85Def: ComfDef = {
  commandNo: 85,
  label: "足コキ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal ELSE (no erotic pleasure sources on target).
  buildSources: (c) => {
    const seiKodo = 700;   // 性行動
    const tasei = 500;      // 達成
    const kutsuju = 500;    // 屈従
    const itsudev = 400;    // 逸脱
    const hankan = 400;     // 反感
    const seifuku = 500;    // 征服

    // 不潔 = Y*10 + 50. Y from STAIN:PLAYER:2 (master Ｐ) + 汚臭耐性 (ERB 243-257).
    const fuketsu = computeFootjobFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));
    // SOURCE:加虐=800 deferred (not in SOURCE_ID).

    const sources: Record<number, number> = {
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.征服]: seifuku,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // 鬱屈 +600 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 600;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 250. TALENT:美脚 bonus deferred.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 250,
  }),

  body: (c) => {
    // target 体力 10 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // No body EXP with available IDs. EXP:足交経験 deferred.
    // HETEROSEX deferred.
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%足交 — 足コキ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf85HandlerEntry: HandlerEntry = makeComfHandler(comf85Def);
