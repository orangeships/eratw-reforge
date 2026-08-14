/**
 * Phase 7 — `COMF84 泡踊り` (bubble dance / body wash), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM84`
 * (`ERB/コマンド関連/COMF/COMF84 泡踊り.ERB`).
 *
 * **Oral/hand family (奉仕系 84).** Target performs a body wash / bubble
 * dance service on the master. Both participants receive 快Ｃ and 快Ｂ.
 * The master's 快Ｂ when female-gendered is deferred (no `mTalent` reader
 * on ComfCtx).
 *
 * **Faithful normal-mode core (ERB normal branch 30-52):**
 *   - master SOURCE: 快Ｃ = 200 (快Ｂ for female master deferred)
 *   - DOWNBASE: target 体力 50 / 気力 180
 *   - SOURCE target: 快Ｃ 200, 快Ｂ 200, 情愛 150, 性行動 450, 達成 250,
 *     屈従 1200, 逸脱 600, 反感 600
 *   - 鬱屈 +1000 if 自己愛<0 || 抵抗
 *   - EXP: 愛情経験 target++ if 恋慕>0
 *
 * **DEFERRED (documented):**
 *   - STAIN full reset (target + master) now wired (body, ERB 57-73); the
 *     ASSI branch (STAIN:ASSI:*) is deferred (no ASSI concept).
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - master female-gender 快Ｂ bonus (needs `mTalent` reader).
 *   - TCVAR action markers.
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
import { STAIN_PART } from "../../../state/stain.js";

export const comf84Def: ComfDef = {
  commandNo: 84,
  label: "泡踊り",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal branch.
  buildSources: (c) => {
    const kaiC = 200;       // 快Ｃ
    const kaiB = 200;       // 快Ｂ
    const jouai = 150;       // 情愛
    const seiKodo = 450;     // 性行動
    const tasei = 250;       // 達成
    const kutsuju = 1200;    // 屈従
    const itsudev = 600;     // 逸脱
    const hankan = 600;      // 反感

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // 鬱屈 +1000 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 1000;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 200. 快Ｂ for female master deferred (no mTalent reader).
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 200,
  }),

  body: (c) => {
    // target 体力 50 / 気力 180 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 180;

    // EXP:愛情経験 target++ if 恋慕>0.
    if (c.tTalent(TALENT_ID.恋慕) > 0) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 57-63: 汚れリセット — body-wash resets the TARGET's soil to the
    // bathed baseline (口/手/Ｂ=0, Ｐ=2, Ｖ=1, Ａ=8, 膣内=0). Direct assignment.
    c.t.state.STAIN[STAIN_PART.口] = 0;
    c.t.state.STAIN[STAIN_PART.手] = 0;
    c.t.state.STAIN[STAIN_PART.Ｐ] = 2;
    c.t.state.STAIN[STAIN_PART.Ｖ] = 1;
    c.t.state.STAIN[STAIN_PART.Ａ] = 8;
    c.t.state.STAIN[STAIN_PART.Ｂ] = 0;
    c.t.state.STAIN[STAIN_PART.膣内] = 0;

    // ERB 66-73: ASSIPLAY==0 → master also reset to the same baseline. The
    // ASSI branch (STAIN:ASSI:*) is deferred (no ASSI concept in runtime).
    c.master.state.STAIN[STAIN_PART.口] = 0;
    c.master.state.STAIN[STAIN_PART.手] = 0;
    c.master.state.STAIN[STAIN_PART.Ｐ] = 2;
    c.master.state.STAIN[STAIN_PART.Ｖ] = 1;
    c.master.state.STAIN[STAIN_PART.Ａ] = 8;
    c.master.state.STAIN[STAIN_PART.Ｂ] = 0;
    c.master.state.STAIN[STAIN_PART.膣内] = 0;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%跳了泡沫舞 — 泡踊り；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf84HandlerEntry: HandlerEntry = makeComfHandler(comf84Def);
