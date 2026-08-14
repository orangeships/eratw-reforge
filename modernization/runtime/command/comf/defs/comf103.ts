/**
 * Phase 7 — `COMF103 針` (needles), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM103`
 * (`ERB/コマンド関連/COMF/COMF103 針.ERB`).
 *
 * **SM family sibling (103 針).** Highest-magnitude SM action in the
 * 100-series (level 4): the most extreme 苦痛 (5000 base) and 恐怖
 * (4000) values, with proportional 逸脱 (500) and 反感 (1200), plus
 * the 苦痛 PALAM-level multiplicative scaling.
 *
 * **Faithful normal-mode core (ERB 14-51, ELSE branch):**
 *   - DOWNBASE: target 体力 120 / 気力 100 (ERB 22-23)
 *   - SOURCE target: 苦痛 5000, 恐怖 4000, 逸脱 500, 反感 1200 (ERB 25-28)
 *   - 特殊ソース処理: 苦痛 *= (10 + 5 * MAX(GETPALAMLV(PALAM:苦痛,5)-1, 0)) / 10
 *     (ERB 35) — multiplicative scale based on the target's PALAM:苦痛 level
 *   - HETEROSEX 同性愛 EXP: 2 target / 2 master (ERB 45-49)
 *   - EXP 嗜虐快楽経験 PLAYER++ (ERB 51)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 16-18) — TSP -120 drain, single 苦痛 2500 SOURCE.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 10) — display-only.
 *   - ITEM:14 / NOITEM gate, ASSI 従順/擅長用針/施虐狂 gate, TEQUIP:0/1 gate,
 *     TEQUIP:31/33 gate (ERB 62-83) — COMABLE layer.
 *   - HETEROSEX EXP writes (ERB 39-50) — gender-pair helper deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
} from "../../../state/settlement.js";
import { palamLevel } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf103Def: ComfDef = {
  commandNo: 103,
  label: "針",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 22-23: target 体力 120 / 気力 100 (factory downbase is master-only,
  // so target drain lives in body).
  downbase: {},

  buildSources: (c) => {
    let kutsuu = 5000; // 苦痛
    const kyoufu = 4000; // 恐怖
    const itsudev = 500; // 逸脱
    const hankan = 1200; // 反感

    // ERB 35: 特殊ソース処理 — 苦痛 scaling by PALAM:苦痛 level.
    const kutsuuLevel = palamLevel(c.t.state.PALAM[PALAM_ID.苦痛] ?? 0, 4);
    const scaled = (kutsuu * (10 + 5 * Math.max(kutsuuLevel - 1, 0))) / 10;
    kutsuu = Math.trunc(scaled);

    return {
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.恐怖]: kyoufu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
  },

  body: (c) => {
    // ERB 22-23: target 体力 120 / 気力 100 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 120;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    // ERB 51: 嗜虐快楽経験 PLAYER++.
    c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
      (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用针刺了%CALLNAME:TARGET% — 針；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf103HandlerEntry: HandlerEntry = makeComfHandler(comf103Def);