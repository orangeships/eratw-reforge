/**
 * Phase 7 — `COMF2 フェラする` (fellatio), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM2`
 * (`ERB/コマンド関連/COMF/COMF2 フェラする.ERB`).
 *
 * **H foreplay family (root 0-26) sibling.** Same shape as comf1
 * but no 液体 SOURCE and different coefficients.
 *
 * **Faithful normal-mode core (ERB 49-100, ELSE branch):**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 51-52, in `body`)
 *   - SOURCE:PLAYER:快Ｍ = 50 (ERB 53, `buildMasterSources`)
 *   - SOURCE target: 快Ｃ 110 (ERB 55), 露出 20 (56), 逸脱 20 (57),
 *     反感 20 (58)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 64-65)
 *   - 性技補正 (ERB 68-72): 舌 >= 4 → 快Ｃ +100;
 *     else 快Ｃ +ABL:舌*25
 *   - Common tail 舌使い (ERB 75-76): 快Ｃ ×1.5
 *   - Common tail 猫舌 (ERB 79-80, 97-98): 快Ｃ ×0.75,
 *     EXP:嗜虐快楽経験++ PLAYER
 *   - EXP:口淫経験 PLAYER++ (ERB 99)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 24-49) — TSP drain + reduced sources.
 *     (FLAG:70 == 1 && CFLAG:TARGET:344 == 0)
 *   - STAIN污垢 handling
 *   - HETEROSEX EXP (CALL ADD_EXP_LESNIAN / EXP:(50+HETEROSEX))
 *   - TCVAR markers
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

export const comf2Def: ComfDef = {
  commandNo: 2,
  label: "フェラする",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  buildSources: (c) => {
    // ERB 55-58: base sources.
    let kaiC = 110;
    const roshutsu = 20;
    const itsudev = 20;
    const hankan = 20;

    // ERB 68-72: 性技補正 (tongue ABL bonus to 快Ｃ).
    if (c.mAbl(ABL_ID.舌) >= 4) {
      kaiC += 100;
    } else {
      kaiC += c.mAbl(ABL_ID.舌) * 25;
    }

    // ERB 75-76: 舌使い ×1.5 on 快Ｃ (common tail).
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiC = Math.trunc(kaiC * 1.5);
    }

    // ERB 79-80: 猫舌 ×0.75 on 快Ｃ (common tail).
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiC = Math.trunc(kaiC * 0.75);
    }

    // ERB 64-65: 鬱屈 +20 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // ERB 53: SOURCE:PLAYER:快Ｍ = 50 (constant).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｍ]: 50,
  }),

  body: (c) => {
    // ERB 51-52: target 体力 5 / 気力 50 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 5;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 99: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;

    // ERB 97-98: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 为%CALLNAME:TARGET%口交；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf2HandlerEntry: HandlerEntry = makeComfHandler(comf2Def);
