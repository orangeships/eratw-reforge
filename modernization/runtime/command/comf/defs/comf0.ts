/**
 * Phase 7 — `COMF0 愛撫` (generic caress — C & B), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM0`
 * (`ERB/コマンド関連/COMF/COMF0 愛撫.ERB`).
 *
 * **H foreplay family exemplar (愛撫系 root 0-26).** All root foreplay
 * commands share the same shape: target gets a couple of 快感 SOURCEs
 * (C and/or B and/or M) modulated by `ABL:PLAYER:指` / `ABL:PLAYER:舌`
 * and the target's `TALENT:PLAYER:器用な指` / `TALENT:PLAYER:舌使い`,
 * plus a fixed 情愛/性行動/露出/不潔/逸脱/反感 tail, plus a 鬱屈 penalty
 * for `自己愛<0` or `抵抗` targets, plus 接吻 dual-write (target+master
 * 快Ｍ) when 既成事實 bit 0 is set.
 *
 * **Faithful normal-mode core (ERB 68-150, ELSE branch):**
 *   - DOWNBASE: target 体力 10 / 気力 40, master 体力 20 / 気力 20
 *     (ERB 70-73)
 *   - SOURCE target: 快Ｃ 40 + ABL:PLAYER:指*4, 快Ｂ 40 + ABL:PLAYER:指*4
 *     (ERB 75-76, 90-91); 器用な指 ×1.5 on both (ERB 93-96)
 *   - SOURCE target: 情愛 50 [×1.5 if 舌使い] (ERB 82, 100-101), 性行動 60
 *     (83), 露出 20 (84), 不潔 30 (85), 逸脱 20 (86), 反感 20 (87)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 106-107)
 *   - 接吻 (gated on 既成事實 bit 0):
 *     - target 快Ｍ = 20 + ABL:PLAYER:舌*3 [×1.5 if 舌使い] (ERB 78, 97-98)
 *     - master 快Ｍ = 20 + ABL:TARGET:舌*3 (ERB 79) — B1b dual-write
 *     - EXP キス経験 both (ERB 117-118)
 *   - EXP 嗜虐快楽経験 PLAYER++ if 猫舌 (ERB 64-65, 146-147)
 *   - EXP 手淫経験 PLAYER++ (ERB 67, 149)
 *   - 接吻 NOT set: 情愛 /=4, 不潔 = 0, 液体 /= 2 (ERB 111-114)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 35-67) — TSP drain + reduced sources + STAIN.
 *   - 汚臭条件 (ERB 120-132): 不潔 /=4 (鈍感) / *=3 (敏感) / *=2 (自尊心)
 *     / master STAIN ×3/2. STAIN not modeled.
 *   - 接吻 STAIN swap (ERB 134-135) — STAIN subsystem deferred.
 *   - HETEROSEX 同性愛 EXP (ERB 59-61, 142-143 — `CALL ADD_EXP_LESNIAN(5)`)
 *     — gender-pair helper deferred.
 *   - TCVAR:116, TCVAR:PLAYER:108, TCVAR:TARGET:2, TCVAR:TARGET:4
 *     (ERB 20-29) — H-scene action markers, mid-scene chaining.
 *   - 接吻経験 alias (ERB writes `EXP:接吻経験` which is exp.als id=27
 *     `キス経験` — same slot, different label).
 *   - 接吻 not-set override: `液体 /= 2` (ERB 114) — 液体 SOURCE id not
 *     modeled; the `情愛 /= 4` and `不潔 = 0` parts ARE applied below.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART } from "../../../state/stain.js";

/** 既成事實 bit 0 = 接吻合意 (kiss consent). ATTITUDE.ERB reference. */
const KISS_CONSENT_BIT = 1 << 0;

export const comf0Def: ComfDef = {
  commandNo: 0,
  label: "愛撫",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 70-73: master and target DOWNBASE share preflight and settlement.
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 20 },
  targetDownbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 40 },

  buildSources: (c) => {
    // ERB 90-91: ABL:PLAYER:指 contributes to C/B 快感.
    const yubi = c.mAbl(ABL_ID.指) * 4;
    const deft = c.mAbl(ABL_ID.指) * 4;

    let kaiC = 40 + yubi;
    let kaiB = 40 + deft;

    // ERB 93-96: 器用な指 ×1.5 on C/B.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiC = Math.trunc(kaiC * 1.5);
      kaiB = Math.trunc(kaiB * 1.5);
    }

    // ERB 82, 100-101: 情愛 50; 舌使い ×1.5.
    let jouai = 50;
    if (c.master.state.TALENT[TALENT_ID.舌使い]) jouai = Math.trunc(jouai * 1.5);

    // ERB 83-87: fixed tail.
    const seiKodo = 60; // 性行動
    const roshutsu = 20; // 露出
    let fuketsu = 30; // 不潔
    const itsudev = 20; // 逸脱
    const hankan = 20; // 反感

    // ERB 106-107: 鬱屈 +20 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    // ERB 11-15: 接吻 gated on 既成事實 bit 0.
    const kissConsented =
      ((c.tCflag(CFLAG_ID.既成事実) ?? 0) & KISS_CONSENT_BIT) !== 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    if (kissConsented) {
      // ERB 78: target 快Ｍ = 20 + ABL:PLAYER:舌*3 (×1.5 if 舌使い).
      let targetKM = 20 + c.mAbl(ABL_ID.舌) * 3;
      if (c.master.state.TALENT[TALENT_ID.舌使い])
        targetKM = Math.trunc(targetKM * 1.5);
      sources[SOURCE_ID.快Ｍ] = targetKM;
      // ERB 79: master 快Ｍ (dual-write, B1b — no 好感度 path; settled into
      // master PALAM via buildMasterSources below).
      // ERB 120-132: 不潔 conditional chain (STAIN subsystem now modeled).
      //   汚臭耐性 > 0 → /=4; < 0 → *=3; 自尊心 > 0 → *=2;
      //   STAIN:PLAYER:0 (master mouth soiled) → *=3/2.
      const tolerance = c.tTalent(TALENT_ID.汚臭耐性);
      if (tolerance > 0) fuketsu = Math.trunc(fuketsu / 4);
      else if (tolerance < 0) fuketsu = fuketsu * 3;
      if (c.tTalent(TALENT_ID.自尊心) > 0) fuketsu = fuketsu * 2;
      if (c.master.state.STAIN[STAIN_PART.口] ?? 0) {
        fuketsu = Math.trunc((fuketsu * 3) / 2);
      }
      sources[SOURCE_ID.不潔] = fuketsu;
    } else {
      // ERB 111-114: no 接吻 → 不潔 = 0, 情愛 /= 4. (液体 /= 2 deferred.)
      sources[SOURCE_ID.不潔] = 0;
      sources[SOURCE_ID.情愛] = Math.trunc(jouai / 4);
    }

    return sources;
  },

  // B1b — dual-participant master SOURCE: only on 接吻.
  // ERB 79: SOURCE:PLAYER:快Ｍ = 20 + ABL:TARGET:舌*3.
  buildMasterSources: (c): Record<number, number> => {
    const kissConsented =
      ((c.tCflag(CFLAG_ID.既成事実) ?? 0) & KISS_CONSENT_BIT) !== 0;
    if (!kissConsented) return {};
    return {
      [SOURCE_ID.快Ｍ]: 20 + c.tAbl(ABL_ID.舌) * 3,
    };
  },

  body: (c) => {
    const kissConsented =
      ((c.tCflag(CFLAG_ID.既成事実) ?? 0) & KISS_CONSENT_BIT) !== 0;

    // ERB 117-118: 接吻経験 both (only on 接吻).
    if (kissConsented) {
      c.t.state.EXP[EXP_ID.キス経験] = (c.t.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
      c.master.state.EXP[EXP_ID.キス経験] =
        (c.master.state.EXP[EXP_ID.キス経験] ?? 0) + 1;
      // ERB 134-135: 接吻 STAIN swap — target's mouth ⇔ master's mouth.
      const tm = c.t.state.STAIN[STAIN_PART.口] ?? 0;
      const mm = c.master.state.STAIN[STAIN_PART.口] ?? 0;
      c.t.state.STAIN[STAIN_PART.口] = tm | mm;
      c.master.state.STAIN[STAIN_PART.口] = mm | tm;
    }

    // ERB 64-65, 146-147: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 67, 149: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 爱抚了 %CALLNAME:TARGET% — 愛撫；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf0HandlerEntry: HandlerEntry = makeComfHandler(comf0Def);
