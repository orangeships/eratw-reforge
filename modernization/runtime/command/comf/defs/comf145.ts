/**
 * Phase 7 (Wave 4b) — `COMF145 アナル奉仕` (anal service), as a `ComfDef`.
 *
 * Ports the **core** of `@COM145` (`ERB/コマンド関連/COMF/COMF145 アナル奉仕.ERB`).
 * A 奉仕快楽 act where the target services the master's anus: the MASTER gets
 * 快Ａ, the target gets a heavy 屈従/逸脱/反感 submission bundle. (145 has no
 * separate time-stop branch — single body.)
 *
 * **Faithful core (ERB body):**
 *   - DOWNBASE target 体力 10 / 気力 100.
 *   - SOURCE:PLAYER:快Ａ = 100 (master pleasure).
 *   - SOURCE target: 性行動 300, 達成 300, 屈従 2500, 逸脱 1200, 反感 1200,
 *     不潔 = Y×80 + 50 (Y = STAIN 污垢, deferred → 0 → 50).
 *   - 鬱屈 +1200 if 自己愛<0 || 抵抗.
 *
 * **DEFERRED:** STAIN (Y → 不潔 base 50); HETEROSEX EXP (+6); 嗜虐快楽経験
 * if TARGET 猫舌; TCVAR markers (108 奉仕快楽 / PLAYER:2=12 / PLAYER:4=250);
 * COMABLE gate.
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
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";

/**
 * `Y` for アナルフィスト (ERB 195-208), pure for tests. Y from master Ｖ
 * soil bits, no /=, ×(2-汚臭耐性)/2. 不潔 = Y*80 + 50 (ERB 35).
 */
export function computeAnalFistFuketsu(masterVSoil: number, tolerance: number): number {
  let y = 0;
  if (masterVSoil & STAIN_BIT.愛液) y += 1;
  if (masterVSoil & STAIN_BIT.精液) y += 3;
  if (masterVSoil & STAIN_BIT.肛門) y += 7;
  if (masterVSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 80 + 50;
}

export const comf145Def: ComfDef = {
  commandNo: 145,
  label: "アナル奉仕",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    // 不潔 = Y*80 + 50. Y from STAIN:PLAYER:3 (master Ｖ) + 汚臭耐性 (ERB 195-208).
    const fuketsu = computeAnalFistFuketsu(getStain(c.master, STAIN_PART.Ｖ), c.tTalent(TALENT_ID.汚臭耐性));
    const sources: Record<number, number> = {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.達成]: 300,
      [SOURCE_ID.屈従]: 2500,
      [SOURCE_ID.逸脱]: 1200,
      [SOURCE_ID.反感]: 1200,
      [SOURCE_ID.不潔]: fuketsu,
    };
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 1200;
    }
    return sources;
  },

  // SOURCE:PLAYER:快Ａ = 100 (master receives anal service).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ａ]: 100,
  }),

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 48-49: STAIN swap — target 口 ⇔ master Ａ.
    const tm = getStain(c.t, STAIN_PART.口);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    c.t.state.STAIN[STAIN_PART.口] = tm | ma;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET%用肛门侍奉了%CALLNAME:MASTER% — アナル奉仕；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf145HandlerEntry: HandlerEntry = makeComfHandler(comf145Def);
