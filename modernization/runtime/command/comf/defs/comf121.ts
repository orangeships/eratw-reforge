/**
 * Phase 7 — `COMF121 貝あわせ` (tribadism / scissoring), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM121`
 * (`ERB/コマンド関連/COMF/COMF121 貝あわせ.ERB`).
 *
 * **Oral/hand family.** Mutual tribadism / scissoring command: both
 * participants receive 快Ｃ, with the target taking heavy 屈従 (400),
 * 逸脱 (400), and 反感 (400) plus a large 鬱屈 penalty for self-loving
 * or resistant targets.
 *
 * **Faithful normal-mode core (ERB 27-45, ELSE branch):**
 *   - target DOWNBASE: 体力 30 / 気力 90 (ERB 27-28)
 *   - master SOURCE: 快Ｃ = 200 (ERB 29)
 *   - target SOURCE: 快Ｃ 200, 性行動 200, 達成 100, 露出 50,
 *     屈従 400, 逸脱 400, 反感 400 (ERB 30-36)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗 (ERB 37-39)
 *   - EXP: 愛情経験 target += 2*恋慕 if 恋慕>0 (ERB 44)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 23-26) — TSP drain, different SOURCE values.
 *   - STAIN swap (ERB 40) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 41) — gender-pair helper deferred.
 *   - COM_ABLE121 success-rate calculation — COMABLE layer.
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
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf121Def: ComfDef = {
  commandNo: 121,
  label: "貝あわせ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 200,
      [SOURCE_ID.性行動]: 200,
      [SOURCE_ID.達成]: 100,
      [SOURCE_ID.露出]: 50,
      [SOURCE_ID.屈従]: 400,
      [SOURCE_ID.逸脱]: 400,
      [SOURCE_ID.反感]: 400,
    };

    // ERB 37-39: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // ERB 29: master SOURCE:PLAYER:快Ｃ = 200.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 200,
  }),

  body: (c) => {
    // ERB 27-28: target 体力 30 / 気力 90 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 30;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 90;

    // ERB 44: EXP:愛情経験 target += 2*恋慕 if 恋慕>0.
    if (c.tTalent(TALENT_ID.恋慕) > 0) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) +
        2 * c.tTalent(TALENT_ID.恋慕);
    }

    // ERB 51-52: STAIN swap — target Ｖ ⇔ master Ｖ.
    const tv = getStain(c.t, STAIN_PART.Ｖ);
    const mv = getStain(c.master, STAIN_PART.Ｖ);
    c.t.state.STAIN[STAIN_PART.Ｖ] = tv | mv;
    c.master.state.STAIN[STAIN_PART.Ｖ] = mv | tv;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 与%CALLNAME:TARGET%互相贝合 — 貝あわせ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf121HandlerEntry: HandlerEntry = makeComfHandler(comf121Def);
