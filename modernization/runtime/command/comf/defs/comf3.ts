/**
 * Phase 7 — `COMF3 指挿れ` (finger insertion), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) non-virgin core** of `@COM3`
 * (`ERB/コマンド関連/COMF/COMF3 指挿れ.ERB`).
 *
 * **H foreplay family (root 0-26) sibling.** Unlike COMF1/2/4 this
 * command has a virgin/non-virgin branch. Only the non-virgin path is
 * ported here (see deferred note below).
 *
 * **Faithful normal-mode core (ERB 43-96, ELSE branch, non-virgin path):**
 *   - DOWNBASE: target 体力 30 / 気力 80 (ERB 45-46, in `body`)
 *   - SOURCE target (非処女, ERB 48-53): 快Ｖ 120, 苦痛 15, 露出 10,
 *     逸脱 20, 反感 20
 *   - 器用な指 → +20 快Ｖ (ERB 64-65)
 *   - ABL:PLAYER:指*5 → +快Ｖ (ERB 66)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 70-76; no extra +10 for
 *     non-virgin)
 *   - EXP:Ｖ経験 TARGET++ (ERB 94)
 *   - EXP:手淫経験 PLAYER++ (ERB 95)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 21-42) — TSP drain + reduced sources.
 *     (FLAG:70 == 1 && CFLAG:TARGET:344 == 0)
 *   - 処女 (virgin) branch (ERB 56-62): 快Ｖ 60, 苦痛 10, 露出 30,
 *     逸脱 30, 反感 30 + 鬱屈 +10 extra on 自己愛/抵抗. The 破瓜
 *     suppression flag (TFLAG:2) and PAIN_CHECK_V callback are
 *     deferred as part of the broader 処女 gate.
 *   - STAIN污垢 handling
 *   - HETEROSEX EXP (CALL ADD_EXP_LESNIAN / EXP:(50+HETEROSEX))
 *   - TCVAR markers
 *   - PAIN_CHECK_V call
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

export const comf3Def: ComfDef = {
  commandNo: 3,
  label: "指挿れ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  buildSources: (c) => {
    // ERB 48-53: non-virgin path (only path ported).
    let kaiV = 120;
    const kutsutsu = 15;
    const roshutsu = 10;
    const itsudev = 20;
    const hankan = 20;

    // ERB 64-65: 器用な指 → +20 快Ｖ.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiV += 20;
    }

    // ERB 66: ABL:PLAYER:指*5 → +快Ｖ.
    kaiV += c.mAbl(ABL_ID.指) * 5;

    // ERB 70-76: 鬱屈 +20 if 自己愛<0 || 抵抗 (non-virgin: no extra +10).
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.苦痛]: kutsutsu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — no SOURCE:PLAYER in normal ELSE.

  body: (c) => {
    // ERB 45-46: target 体力 30 / 気力 80 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 30;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 80;

    // ERB 94: Ｖ経験 TARGET++.
    c.t.state.EXP[EXP_ID.Ｖ経験] = (c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;

    // ERB 95: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用手指抚慰了%CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf3HandlerEntry: HandlerEntry = makeComfHandler(comf3Def);
