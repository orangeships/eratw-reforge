/**
 * Phase 7 — `COMF92 Ａ正常位される` (anal missionary on master),
 * as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM92`
 * (`ERB/コマンド関連/COMF/COMF92 Ａ正常位される.ERB`).
 *
 * **される系 / reverse positions (92-94).** Master is the bottom in
 * anal missionary. Both master and target drain 体力/気力. Master
 * receives `快Ａ`, target receives `快Ｃ` + 情愛/性行動/達成/征服/
 * 逸脱/反感. Both gain EXP: master gets Ａ性交経験, target gets
 * 挿入経験 and 愛情経験 (scaled by 恋慕).
 *
 * **Faithful normal-mode core (ERB 39-60):**
 *   - DOWNBASE: target 体力 50 / 気力 150 (ERB 39-40)
 *   - DOWNBASE:PLAYER 体力 50 / 気力 150 (ERB 41-42) — master drain in body
 *   - master SOURCE: 快Ａ = 400 (ERB 43)
 *   - SOURCE target: 快Ｃ 400, 情愛 50, 性行動 500, 達成 50,
 *     征服 1000, 逸脱 500, 反感 500 (ERB 44-50)
 *   - 自己愛<0 || 抵抗 → 鬱屈 +500 (ERB 57-58)
 *   - EXP:PLAYER:Ａ性交経験 master++ (ERB 70-71)
 *   - EXP:挿入経験 target++ (ERB 72-73)
 *   - EXP愛情経験 target += 恋慕 if !ASSIPLAY (ERB 80-82)
 *
 * **DEFERRED (documented):**
 *   - 不潔 = Y*30+140 (ERB 52) — Y from STAIN; pinned 0.
 *   - STAIN:3 |= 4, STAIN:PLAYER:3 |= 4 (ERB 62-63) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes — gender-pair helper.
 *   - TCVAR:116/108, CSTR markers — H-scene chaining.
 *   - STR:0 text marker (ERB 17) — H-scene flags.
 *   - COM_ABLE92 — アナル开发性癖/ABL gates.
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
 * `Y` for Ａ正常位される (ERB 272-283), pure for tests. Y from master Ａ(4)
 * OR 腸内(7) soil bits — bit 32 (黏液, weight 15). No /=3,
 * ×(2-汚臭耐性)/2. 不潔 = Y*10 + 60 (ERB 54).
 */
export function computeAnalSexFuketsu(masterASoil: number, masterIntestinalSoil: number, tolerance: number): number {
  const soil = masterASoil | masterIntestinalSoil;
  let y = 0;
  if (soil & STAIN_BIT.愛液) y += 1;
  if (soil & STAIN_BIT.精液) y += 3;
  if (soil & STAIN_BIT.黏液) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf92Def: ComfDef = {
  commandNo: 92,
  label: "Ａ正常位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 39-42: target + master drain — both in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 44-50: fixed tail. 不潔 = Y*10+60 (ERB 54), Y from master Ａ+腸内.
    const fuketsu = computeAnalSexFuketsu(
      getStain(c.master, STAIN_PART.Ａ),
      getStain(c.master, STAIN_PART.腸内),
      c.tTalent(TALENT_ID.汚臭耐性),
    );
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.情愛]: 50,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.達成]: 50,
      [SOURCE_ID.征服]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
      [SOURCE_ID.不潔]: fuketsu,
    };
    // ERB 57-58: 鬱屈 +500 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE (ERB 43).
  buildMasterSources: () => ({
    [SOURCE_ID.快Ａ]: 400,
  }),

  body: (c) => {
    // ERB 39-40: target 体力 50 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 41-42: master 体力 50 / 気力 150 drain (DOWNBASE:PLAYER).
    c.master.state.BASE[BASE_ID.体力] =
      (c.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.master.state.BASE[BASE_ID.気力] =
      (c.master.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 70-71: Ａ性交経験 master++.
    c.master.state.EXP[EXP_ID.Ａ性交経験] =
      (c.master.state.EXP[EXP_ID.Ａ性交経験] ?? 0) + 1;

    // ERB 72-73: 挿入経験 target++.
    c.t.state.EXP[EXP_ID.挿入経験] =
      (c.t.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;

    // ERB 80-82: 愛情経験 target += 恋慕 if !ASSIPLAY.
    if (
      c.tTalent(TALENT_ID.恋慕) &&
      !(c.ctx as { ASSIPLAY?: number }).ASSIPLAY
    ) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + c.tTalent(TALENT_ID.恋慕);
    }

    // ERB 66-69: STAIN swap — target Ｐ ⇔ master Ａ+腸内 (target inserts master).
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    const mi = getStain(c.master, STAIN_PART.腸内);
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | ma | mi;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | tp;
    c.master.state.STAIN[STAIN_PART.腸内] = mi | tp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 把%CALLNAME:MASTER%用肛门正常位对待 — Ａ正常位される；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf92HandlerEntry: HandlerEntry = makeComfHandler(comf92Def);
