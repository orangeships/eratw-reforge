/**
 * Phase 7 — `COMF80 手淫` (target handjob on master), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM80`
 * (`ERB/コマンド関連/COMF/COMF80 手淫.ERB`).
 *
 * **Oral/hand family exemplar (奉仕系 root 80-96).** Handjob is the
 * simplest 奉仕 command: master receives `快Ｃ` (driven by target's
 * ABL:指), target takes a fixed 情愛/性行動/達成/屈従/逸脱/反感 tail plus
 * a small 鬱屈 penalty for `自己愛<0`/`抵抗` targets, and a STAIN swap
 * between target's hand and master's P. **Dual-participant** (B1b) —
 * the master's SOURCE:PLAYER:快Ｃ fires through `buildMasterSources`.
 *
 * **Faithful normal-mode core (ERB 23-81, ELSE branch):**
 *   - master SOURCE: 快Ｃ = (ABL:指<4 ? 80 : ABL:指*20) (ERB 23-27)
 *   - DOWNBASE: target 体力 10 / 気力 60 (ERB 35-36)
 *   - SOURCE target: 情愛 50, 性行動 250, 達成 50, 屈従 350,
 *     逸脱 100, 反感 100 (ERB 38-43)
 *   - SOURCE target: 不潔 = Y*10 + 60 (ERB 46) — Y is computed in the
 *     `CAN_COM` display function from STAIN:PLAYER:2 + 汚臭耐性; deferred.
 *   - 鬱屈 +200 if 自己愛<0 || 抵抗 (ERB 53-54)
 *   - STAIN swap: STAIN:1 |= STAIN:PLAYER:2, STAIN:PLAYER:2 |= STAIN:1
 *     (ERB 61-62) — STAIN subsystem deferred.
 *   - EXP: 手淫経験 target++ (ERB 68-69), HETEROSEX (4 target / 1 master,
 *     ERB 77-80).
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 23, 30-32) — TSP drain, target no drain.
 *   - 不潔 = Y*10 + 60 (ERB 46) — Y is per-display computed from STAIN; not
 *     available in the factory context. Pinned to 0 in body (no 不潔
 *     SOURCE). Documented drift: STAIN subsystem is B-tier work (deferred).
 *   - STAIN:1 ↔ STAIN:PLAYER:2 swap (ERB 61-62) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes (ERB 72-81) — gender-pair helper.
 *   - CAN_COM80 success-rate calculation (ERB 84-275) — extensive ABL/TALENT/
 *     PALAM/MARK/STAIN bracketing with 14 floor; COMABLE layer.
 *   - COM_ABLE80: 調教者が男/半人半妖/扶她 gate (ERB 289-298) — COMABLE.
 *   - TCVAR:116, TCVAR:108, TCVAR:PLAYER:2/4, CSTR (ERB 10-18) — H-scene
 *     action markers, mid-scene chaining.
 *   - 猫舌 → 嗜虐快楽経験 (no, this is on master cat-tongue giving
 *     EXP on kiss/foreplay; 手淫 doesn't fire it).
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
import { STAIN_PART, STAIN_BIT, getStain } from "../../../state/stain.js";

/**
 * `Y` (汚れデータ) for 手淫 (ERB 224-238), pure for tests. Y accumulates
 * weights from the master's Ｐ-part soil bits, then is scaled by the
 * target's 汚臭耐性:
 *   - 愛液 (1) → +1, 精液 (4) → +3, 肛門 (8) → +7, 母乳 (16) → +15
 *   - Y /= 3 (手扱きでは汚れがそれほど影響しない)
 *   - Y = Y * (2 - 汚臭耐性) / 2  (鈍感>0 shrinks, 敏感<0 grows)
 * Returns the `不潔` SOURCE value = Y*10 + 60 (ERB 46).
 */
export function computeHandjobFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc(y / 3);
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf80Def: ComfDef = {
  commandNo: 80,
  label: "手淫",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 35-36: target drain. Factory downbase is master-only → empty.
  downbase: {},

  buildSources: (c) => {
    const jouai = 50; // 情愛
    const seiKodo = 250; // 性行動
    const tasei = 50; // 達成
    const kutsuju = 350; // 屈従
    const itsudev = 100; // 逸脱
    const hankan = 100; // 反感
    // ERB 46: 不潔 = Y*10 + 60. Y from STAIN:PLAYER:2 (master Ｐ soil) +
    // 汚臭耐性 scaling (ERB 224-238).
    const fuketsu = computeHandjobFuketsu(c.master.state.STAIN[STAIN_PART.Ｐ] ?? 0, c.tTalent(TALENT_ID.汚臭耐性));

    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // ERB 53-54: 鬱屈 +200 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 200;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE (ERB 23-27).
  // SOURCE:PLAYER:快Ｃ = (ABL:指<4 ? 80 : ABL:指*20). 4 is the threshold.
  buildMasterSources: (c) => {
    const yubi = c.tAbl(ABL_ID.指);
    return {
      [SOURCE_ID.快Ｃ]: yubi < 4 ? 80 : yubi * 20,
    };
  },

  body: (c) => {
    // ERB 35-36: target 体力 10 / 気力 60 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 60;

    // ERB 68-69: 手淫経験 target++ (only on non-time-stop + non-恶作剧;
    // factory defaults to 0 on both gates).
    c.t.state.EXP[EXP_ID.手淫経験] =
      (c.t.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 61-62: STAIN swap — target's hand ⇔ master's Ｐ (mutual OR).
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    const th = getStain(c.t, STAIN_PART.手);
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | th;
    c.t.state.STAIN[STAIN_PART.手] = th | mp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%手淫 — 手淫；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf80HandlerEntry: HandlerEntry = makeComfHandler(comf80Def);
