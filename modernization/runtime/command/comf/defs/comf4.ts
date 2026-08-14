/**
 * Phase 7 — `COMF4 アナル舐め` (anal licking), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM4`
 * (`ERB/コマンド関連/COMF/COMF4 アナル舐め.ERB`).
 *
 * **H foreplay family (root 0-26) sibling.** Same shape as comf1
 * but targets 快Ａ instead of 快Ｃ, has a stronger 鬱屈 penalty (50),
 * and different tail coefficients.
 *
 * **Faithful normal-mode core (ERB 50-96, ELSE branch):**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 52-53, in `body`)
 *   - SOURCE target: 快Ａ 50 (ERB 55), 液体 50 (56), 逸脱 40 (57),
 *     反感 30 (58)
 *   - 鬱屈 +50 if 自己愛<0 || 抵抗 (ERB 64-65) — stronger than
 *     COMF1/2's +20
 *   - ABL:PLAYER:舌*2 → +快Ａ (ERB 67)
 *   - Common tail 舌使い (ERB 70-71): 快Ａ ×1.5
 *   - Common tail 猫舌 (ERB 74-75, 92-94): 快Ａ ×0.75,
 *     EXP:嗜虐快楽経験++ PLAYER
 *   - EXP:口淫経験 PLAYER++ (ERB 95)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 24-49) — TSP drain + reduced sources.
 *     (FLAG:70 == 1 && CFLAG:TARGET:344 == 0)
 *   - STAIN污垢 handling
 *   - HETEROSEX EXP (CALL ADD_EXP_LESNIAN / EXP:(50+HETEROSEX))
 *   - TCVAR markers
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 *
 * **No buildMasterSources** — no SOURCE:PLAYER line in normal ELSE.
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

export const comf4Def: ComfDef = {
  commandNo: 4,
  label: "アナル舐め",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  buildSources: (c) => {
    // ERB 55-58: base sources.
    let kaiA = 50;
    const ekitai = 50;
    const itsudev = 40;
    const hankan = 30;

    // ERB 67: ABL:PLAYER:舌*2 → +快Ａ.
    kaiA += c.mAbl(ABL_ID.舌) * 2;

    // ERB 70-71: 舌使い ×1.5 on 快Ａ.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiA = Math.trunc(kaiA * 1.5);
    }

    // ERB 74-75: 猫舌 ×0.75 on 快Ａ.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiA = Math.trunc(kaiA * 0.75);
    }

    // ERB 64-65: 鬱屈 +50 if 自己愛<0 || 抵抗 (stronger than comf1/2).
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 50 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.液体]: ekitai,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — no SOURCE:PLAYER in normal ELSE.

  body: (c) => {
    // ERB 52-53: target 体力 5 / 気力 50 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 5;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 95: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;

    // ERB 92-94: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 舔舐了%CALLNAME:TARGET%的肛门 — アナル舐め；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf4HandlerEntry: HandlerEntry = makeComfHandler(comf4Def);
