/**
 * Phase 7 — `COMF90 アナル愛撫される` (anal caress on master), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM90`
 * (`ERB/コマンド関連/COMF/COMF90 アナル愛撫される.ERB`).
 *
 * **される系 / reverse (90-96).** Master is the recipient of anal
 * caressing by the target. Master receives `快Ａ`, target takes a
 * 情愛/性行動/達成/征服/不潔/反感 tail plus a 鬱屈 penalty for
 * `自己愛<0`/`抵抗` targets.
 *
 * **Faithful normal-mode core (ERB 23-42):**
 *   - DOWNBASE: target 体力 10 / 気力 100 (ERB 23-24)
 *   - master SOURCE: 快Ａ = 100 (ERB 25)
 *   - SOURCE target: 情愛 100, 性行動 300, 達成 150, 征服 700,
 *     不潔 200, 反感 200 (ERB 26-31)
 *   - 自己愛<0 || 抵抗 → 鬱屈 +400 (ERB 39-40)
 *   - No body EXP; HETEROSEX only (deferred).
 *
 * **DEFERRED (documented):**
 *   - 不潔 = Y*10+60 (ERB 33) — Y from STAIN; explicit 200 pinned.
 *   - STAIN:1 ↔ STAIN:PLAYER:3 swap (ERB 44-45) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes — gender-pair helper.
 *   - STR:0 text marker (ERB 9) — H-scene flags.
 *   - COM_ABLE90 — アナル开发性癖/ABL:アナル/ABL:PLAYER:アナル gates.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { canExecuteComf90 } from "../can-com.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` for アナル愛撫される (ERB 202-216), pure for tests. Y from master Ｐ
 * soil bits, divided by 3 (手での愛撫なので汚れがそれほど影響しない),
 * ×(2-汚臭耐性)/2. 不潔 = Y*10 + 60 (ERB 35, overrides the line-31 200).
 */
export function computeAnalCaressFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc(y / 3);
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf90Def: ComfDef = {
  commandNo: 90,
  label: "アナル愛撫される",
  canExecute: canExecuteComf90,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 23-24: target drain — in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 26-31: fixed tail. 不潔 line-31 200 is overridden by line-35 Y*10+60.
    const fuketsu = computeAnalCaressFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.達成]: 150,
      [SOURCE_ID.征服]: 700,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: 200,
    };
    // ERB 39-40: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
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

    // No body EXP; HETEROSEX deferred.

    // ERB 48-49: STAIN swap — target 手 ⇔ master Ａ.
    const th = getStain(c.t, STAIN_PART.手);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    c.t.state.STAIN[STAIN_PART.手] = th | ma;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | th;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 爱抚了 %CALLNAME:MASTER%'s anus — アナル愛撫される；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf90HandlerEntry: HandlerEntry = makeComfHandler(comf90Def);
