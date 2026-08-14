/**
 * Phase 7 — `COMF124 手淫する` (give handjob to target), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM124`
 * (`ERB/コマンド関連/COMF/COMF124 手淫する.ERB`).
 *
 * **Oral/hand family.** Master gives a handjob to the target. Target
 * receives 快Ｃ (fixed 80 — the pre-block ABL:PLAYER:指 scaling is
 * overridden by the ELSE branch), plus the standard oral/hand tail
 * (情愛 50, 性行動 250, 達成 50, 屈従 350, 逸脱 100, 反感 100). Master
 * receives EXP:手淫経験.
 *
 * **Faithful normal-mode core (ERB 35-56, ELSE branch):**
 *   - target DOWNBASE: 気力 50 (ERB 37)
 *   - master DOWNBASE: 体力 10 / 気力 50 (ERB 35-36)
 *   - target SOURCE: 快Ｃ 80, 情愛 50, 性行動 250, 達成 50, 屈従 350,
 *     逸脱 100, 反感 100 (ERB 38-43)
 *   - 鬱屈 +200 if 自己愛<0 || 抵抗 (ERB 49-50)
 *   - EXP: 手淫経験 master++ (ERB 51-52)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 31-32) — TSP drain, target no drain.
 *   - ABL:PLAYER:指 dead-code scaling (ERB 24-28) — always overridden
 *     by the ELSE block at ERB 38; retained as documentation.
 *   - 不潔 SOURCE calculation (ERB 44) — depends on STAIN state.
 *   - STAIN swap (ERB 46-47) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 53-56) — gender-pair helper deferred.
 *   - COM_ABLE124 success-rate calculation — COMABLE layer.
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
 * `Y` for 触手クリ責め (ERB 184-198), pure for tests. Y from master Ｐ
 * soil bits, /=3, ×(2-汚臭耐性)/2. 不潔 = Y*10 + 60 (ERB 49).
 */
export function computeTentacleClitFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc(y / 3);
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf124Def: ComfDef = {
  commandNo: 124,
  label: "手淫する",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target/master drain handled in body().
  downbase: {},

  buildSources: (c) => {
    // 不潔 = Y*10+60. Y from STAIN:PLAYER:2 (master Ｐ) + 汚臭耐性, /=3 (ERB 184-198).
    const fuketsu = computeTentacleClitFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 80,
      [SOURCE_ID.情愛]: 50,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.達成]: 50,
      [SOURCE_ID.屈従]: 350,
      [SOURCE_ID.逸脱]: 100,
      [SOURCE_ID.反感]: 100,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // ERB 49-50: 鬱屈 +200 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 200;
    }
    return sources;
  },

  body: (c) => {
    // ERB 37: target 気力 50 drain.
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 35-36: master 体力 10 / 気力 50 drain.
    c.master.state.BASE[BASE_ID.体力] =
      (c.master.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.master.state.BASE[BASE_ID.気力] =
      (c.master.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 51-52: EXP:手淫経験 master++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 63-64: STAIN swap — master 手 ⇔ target Ｐ.
    const mh = getStain(c.master, STAIN_PART.手);
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    c.master.state.STAIN[STAIN_PART.手] = mh | tp;
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | mh;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 为%CALLNAME:TARGET%手淫 — 手淫する；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf124HandlerEntry: HandlerEntry = makeComfHandler(comf124Def);
