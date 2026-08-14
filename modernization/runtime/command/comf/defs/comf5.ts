/**
 * Phase 7 — `COMF5 アナル愛撫` (anal caress — 快Ａ focused), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM5`
 * (`ERB/コマンド関連/COMF/COMF5 アナル愛撫.ERB`, lines 30-48).
 *
 * **Faithful normal-mode core (ELSE branch):**
 *   - DOWNBASE: master 体力 40 / 気力 100 (ERB 30-31)
 *   - SOURCE target: 快Ａ 100, 苦痛 100, 屈従 100, 逸脱 80, 反感 60
 *     (ERB 32-36)
 *   - 器用な指 (master) → 快Ａ +20 (ERB 37-38)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 44-45)
 *   - body: 手淫経験 PLAYER++ (ERB 74)
 *
 * **DEFERRED (documented):**
 *   - PAIN_CHECK_A(TARGET) call after ELSE (ERB 48) — anal pain gating.
 *     Pain subsystem not yet modeled.
 *   - Time-stop branch (ERB 1-29) — TSP drain + reduced sources + STAIN.
 *   - STAIN 汚垢 handling (ERB 56-59) — entire subsystem deferred.
 *   - HETEROSEX 同性愛 EXP (ERB 64-72) — gender-pair helper deferred.
 *   - TCVAR markers (ERB 10-18) — H-scene action markers deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant (target-only SOURCE).
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
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf5Def: ComfDef = {
  commandNo: 5,
  label: "アナル愛撫",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 30-31: DOWNBASE:体力 += 40, DOWNBASE:気力 += 100.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    // ERB 32-36: base SOURCE quanta.
    let kaiA = 100; // 快Ａ
    const kuutsu = 100; // 苦痛
    const kutsujyu = 100; // 屈従
    const itsudatsu = 80; // 逸脱
    const hankan = 60; // 反感

    // ERB 37-38: SIF TALENT:PLAYER:器用な指 → 快Ａ += 20.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiA += 20;
    }

    // ERB 44-45: SIF TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 100.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 100 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kuutsu,
      [SOURCE_ID.屈従]: kutsujyu,
      [SOURCE_ID.逸脱]: itsudatsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — single-participant command.

  body: (c) => {
    // ERB 74: EXP:PLAYER:手淫経験 ++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    // ERB 56-59: STAIN swap — target 手 ⇔ master Ａ+腸内.
    const th = getStain(c.t, STAIN_PART.手);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    const mi = getStain(c.master, STAIN_PART.腸内);
    c.t.state.STAIN[STAIN_PART.手] = th | ma | mi;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | th;
    c.master.state.STAIN[STAIN_PART.腸内] = mi | th;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%爱抚了%CALLNAME:TARGET%的肛门 — アナル愛撫；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf5HandlerEntry: HandlerEntry = makeComfHandler(comf5Def);
