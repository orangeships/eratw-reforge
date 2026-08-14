/**
 * Phase 7 — `COMF102 蝋燭` (candle wax), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM102`
 * (`ERB/コマンド関連/COMF/COMF102 蝋燭.ERB`).
 *
 * **SM family sibling (102 蝋燭).** Highest-magnitude SM action in the
 * 100-series (level 3): single 苦痛-dominant SOURCE fire with a 恐怖
 * tail (3000) and a 逸脱/反感 bottom, plus the 苦痛 PALAM-level
 * multiplicative scaling.
 *
 * **Faithful normal-mode core (ERB 20-56, ELSE branch):**
 *   - DOWNBASE: target 体力 40 / 気力 30 (ERB 27-28)
 *   - SOURCE target: 苦痛 2000, 恐怖 3000, 逸脱 150, 反感 700 (ERB 30-33)
 *   - 特殊ソース処理: 苦痛 *= (10 + 5 * MAX(GETPALAMLV(PALAM:苦痛,5)-1, 0)) / 10
 *     (ERB 39) — multiplicative scale based on the target's PALAM:苦痛 level
 *   - HETEROSEX 同性愛 EXP: 2 target / 2 master (ERB 49-53)
 *   - EXP 嗜虐快楽経験 PLAYER++ (ERB 56)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 21-23) — TSP -40 drain, single 苦痛 1000 SOURCE.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 10) — display-only.
 *   - ITEM:46 / NOITEM gate, ITEM:46 auto-replenish with MONEY (ERB 11-16)
 *     — ITEM/MONEY subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 44-54) — gender-pair helper deferred.
 *   - ASSI 従順 gate, TEQUIP:0/1 gate, TEQUIP:31/33 gate,
 *     BEDROOM(CFLAG) gate (ERB 75-91) — COMABLE layer.
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

export const comf102Def: ComfDef = {
  commandNo: 102,
  label: "蝋燭",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 27-28: target 体力 40 / 気力 30 (factory downbase is master-only,
  // so target drain lives in body).
  downbase: {},

  buildSources: (c) => {
    let kutsuu = 2000; // 苦痛
    const kyoufu = 3000; // 恐怖
    const itsudev = 150; // 逸脱
    const hankan = 700; // 反感

    // ERB 39: 特殊ソース処理 — 苦痛 scaling by PALAM:苦痛 level.
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
    // ERB 27-28: target 体力 40 / 気力 30 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 30;

    // ERB 56: 嗜虐快楽経験 PLAYER++.
    c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
      (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 把蜡油滴在了%CALLNAME:TARGET%身上 — 蝋燭；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf102HandlerEntry: HandlerEntry = makeComfHandler(comf102Def);