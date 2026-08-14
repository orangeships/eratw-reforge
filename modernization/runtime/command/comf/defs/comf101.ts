/**
 * Phase 7 — `COMF101 鞭` (whip), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM101`
 * (`ERB/コマンド関連/COMF/COMF101 鞭.ERB`).
 *
 * **SM family sibling (101 鞭).** Higher-magnitude version of the
 * `COMF100 スパンキング` pattern: single 苦痛-dominant SOURCE fire with
 * a 恐怖/逸脱/反感 tail, plus the 苦痛 PALAM-level multiplicative
 * scaling (`特殊ソース処理`).
 *
 * **Faithful normal-mode core (ERB 14-49, ELSE branch):**
 *   - DOWNBASE: target 体力 80 / 気力 50 (ERB 21-22)
 *   - SOURCE target: 苦痛 1500, 恐怖 1200, 逸脱 100, 反感 600 (ERB 24-27)
 *   - 特殊ソース処理: 苦痛 *= (10 + 5 * MAX(GETPALAMLV(PALAM:苦痛,5)-1, 0)) / 10
 *     (ERB 33) — multiplicative scale based on the target's PALAM:苦痛 level
 *   - HETEROSEX 同性愛 EXP: 2 target / 2 master (ERB 43-46)
 *   - EXP 嗜虐快楽経験 PLAYER++ (ERB 49)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 15-18) — TSP -80 drain, single 苦痛 750 SOURCE.
 *   - HETEROSEX EXP writes (ERB 38-47) — gender-pair helper deferred.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 10) — display-only.
 *   - ITEM:13 / NOITEM gate, ASSI 従順 gate, TEQUIP:0/1 gate, TEQUIP:31/33
 *     gate, BEDROOM(CFLAG) gate (ERB 60-82) — COMABLE layer.
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

export const comf101Def: ComfDef = {
  commandNo: 101,
  label: "鞭",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 21-22: target 体力 80 / 気力 50 (factory downbase is master-only,
  // so target drain lives in body).
  downbase: {},

  buildSources: (c) => {
    let kutsuu = 1500; // 苦痛
    const kyoufu = 1200; // 恐怖
    const itsudev = 100; // 逸脱
    const hankan = 600; // 反感

    // ERB 33: 特殊ソース処理 — 苦痛 scaling by PALAM:苦痛 level.
    // GETPALAMLV(PALAM:苦痛, 5) returns level 0..4; the 5-cap is the
    // highest meaningful level for PALAM:苦痛.
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
    // ERB 21-22: target 体力 80 / 気力 50 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 80;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 49: 嗜虐快楽経験 PLAYER++.
    c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
      (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用鞭子抽了%CALLNAME:TARGET% — 鞭；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf101HandlerEntry: HandlerEntry = makeComfHandler(comf101Def);