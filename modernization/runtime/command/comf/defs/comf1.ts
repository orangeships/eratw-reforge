/**
 * Phase 7 — `COMF1 クンニ` (cunnilingus), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM1`
 * (`ERB/コマンド関連/COMF/COMF1 クンニ.ERB`).
 *
 * **H foreplay family (root 0-26) sibling.** Same shape as comf0:
 * target gets 快感 SOURCEs modulated by player ABL/talent plus a
 * fixed tail of 露出/逸脱/反感, plus 鬱屈 penalty for resistant chars,
 * plus 快Ｍ dual-write (master), plus body-side EXP increments.
 *
 * **Faithful normal-mode core (ERB 47-97, ELSE branch):**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 48-49, in `body`)
 *   - SOURCE:PLAYER:快Ｍ = 50 (ERB 50, `buildMasterSources`)
 *   - SOURCE target: 快Ｃ 80 (ERB 51), 液体 1000 (52), 露出 10 (53),
 *     逸脱 15 (54), 反感 15 (55)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 56-57)
 *   - 性技補正 (ERB 62-66): 舌 >= 4 → 快Ｃ +100, 液体 +400;
 *     else 快Ｃ +ABL:舌*20, 液体 +ABL:舌*80
 *   - Common tail 舌使い (ERB 89-91): 快Ｃ ×1.5, 液体 ×1.5
 *   - Common tail 猫舌 (ERB 94-96): 快Ｃ ×0.75, EXP:嗜虐快楽経験++ PLAYER
 *   - EXP:口淫経験 PLAYER++ (ERB 97)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 24-46) — TSP drain + reduced sources +
 *     STAIN. (FLAG:70 == 1 && CFLAG:TARGET:344 == 0)
 *   - STAIN污垢 handling
 *   - HETEROSEX EXP (CALL ADD_EXP_LESNIAN / EXP:(50+HETEROSEX))
 *   - TCVAR markers (TCVAR:116, TCVAR:PLAYER:108, TCVAR:TARGET:2,
 *     TCVAR:TARGET:4)
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
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

export const comf1Def: ComfDef = {
  commandNo: 1,
  label: "クンニ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  targetDownbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 51-55: base sources.
    let kaiC = 80;
    let ekitai = 1000;
    const roshutsu = 10;
    const itsudev = 15;
    const hankan = 15;

    // ERB 62-66: 性技補正 (tongue ABL bonus to 快Ｃ and 液体).
    if (c.mAbl(ABL_ID.舌) >= 4) {
      kaiC += 100;
      ekitai += 400;
    } else {
      kaiC += c.mAbl(ABL_ID.舌) * 20;
      ekitai += c.mAbl(ABL_ID.舌) * 80;
    }

    // ERB 89-91: 舌使い ×1.5 on 快Ｃ and 液体 (common tail).
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiC = Math.trunc(kaiC * 1.5);
      ekitai = Math.trunc(ekitai * 1.5);
    }

    // ERB 94-95: 猫舌 ×0.75 on 快Ｃ (common tail).
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiC = Math.trunc(kaiC * 0.75);
    }

    // ERB 56-57: 鬱屈 +20 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.液体]: ekitai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // ERB 50: SOURCE:PLAYER:快Ｍ = 50 (constant, no master-ABL scaling).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｍ]: 50,
  }),

  body: (c) => {
    // ERB 97: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;

    // ERB 95-96: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 舐弄了%CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf1HandlerEntry: HandlerEntry = makeComfHandler(comf1Def);
