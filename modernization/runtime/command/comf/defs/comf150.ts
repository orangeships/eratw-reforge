/**
 * Phase 7 (Wave 4b) — `COMF150 胸の谷間を犯す` (titfuck), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM150`
 * (`ERB/コマンド関連/COMF/COMF150 胸の谷間を犯す.ERB`). A 奉仕快楽 act: the
 * MASTER gets the pleasure (`SOURCE:PLAYER:快Ｃ`, scaled by ABL:胸), the target
 * gets 快Ｂ + a service/submission/transgression source bundle.
 *
 * **Faithful normal-mode core (ERB ELSE branch):**
 *   - DOWNBASE target 体力 10 / 気力 100.
 *   - SOURCE:PLAYER:快Ｃ = 110 + MIN(ABL:胸 × 25, 100) (master pleasure).
 *   - SOURCE target: 快Ｂ 150, 情愛 150, 性行動 400, 達成 200, 屈従 1000,
 *     逸脱 400, 反感 400, 不潔 = Y×10 + 60 (Y = master-Ｐ soil weight,
 *     ×(2-汚臭耐性)/2 — clean master → 60).
 *   - 鬱屈 +600 if 自己愛<0 || 抵抗.
 *   - EXP:乳交経験 ++ (target); 愛情経験 ++ if 恋慕 (target).
 *   - STAIN 汚れ移動 (ERB 62-63): target Ｂ ⇔ master Ｐ (mutual OR).
 *
 * **DEFERRED:** time-stop branch (TSP -60); HETEROSEX EXP; TCVAR markers
 * (108 奉仕快楽 / PLAYER:2=5 射精部位 / PLAYER:4=1200 強度); ASSIPLAY 恋慕
 * gate (assumed direct, not assistant); COMABLE gate.
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
import { STAIN_BIT, STAIN_PART } from "../../../state/stain.js";

/**
 * `SOURCE:不潔 = Y*10 + 60` where Y is the master-Ｐ soil weight
 * (`@CAN_COM150` ERB 226-239): 愛液→1, 精液→3, 肛門→7, 母乳→15, then
 * `Y = Y*(2-汚臭耐性)/2` (no extra division). Pure function over the
 * master-Ｐ soil bitmask and the target's 汚臭耐性 tolerance. Clean master
 * (Y=0) → 60.
 */
export function computeTitfuckFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf150Def: ComfDef = {
  commandNo: 150,
  label: "胸の谷間を犯す",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 150,
      [SOURCE_ID.情愛]: 150,
      [SOURCE_ID.性行動]: 400,
      [SOURCE_ID.達成]: 200,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 400,
      [SOURCE_ID.反感]: 400,
      // ERB 48: 不潔 = Y*10 + 60; Y = master-Ｐ soil weight (×(2-汚臭耐性)/2).
      [SOURCE_ID.不潔]: computeTitfuckFuketsu(
        c.master.state.STAIN[STAIN_PART.Ｐ] ?? 0,
        c.tTalent(TALENT_ID.汚臭耐性),
      ),
    };
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 600;
    }
    return sources;
  },

  // SOURCE:PLAYER:快Ｃ = 110 + MIN(ABL:胸 × 25, 100) (master gets the pleasure).
  buildMasterSources: (c): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 110 + Math.min(c.mAbl(ABL_ID.胸) * 25, 100),
  }),

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 62-63: 汚れ移動 — target Ｂ ⇔ master Ｐ (mutual OR).
    const tb = c.t.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    const mp = c.master.state.STAIN[STAIN_PART.Ｐ] ?? 0;
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tb;

    // EXP:乳交経験 ++ (target).
    c.t.state.EXP[EXP_ID.乳交経験] = (c.t.state.EXP[EXP_ID.乳交経験] ?? 0) + 1;
    // 愛情経験 ++ if 恋慕.
    if (c.tTalent(TALENT_ID.恋慕)) {
      c.t.state.EXP[EXP_ID.愛情経験] = (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 在%CALLNAME:TARGET%的乳沟间抽插了 — 胸の谷間；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf150HandlerEntry: HandlerEntry = makeComfHandler(comf150Def);
