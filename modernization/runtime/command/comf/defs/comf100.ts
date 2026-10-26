/**
 * Phase 7 — `COMF100 スパンキング` (spanking), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM100`
 * (`ERB/コマンド関連/COMF/COMF100 スパンキング.ERB`).
 *
 * **SM family exemplar (SM系 root 100-192).** Spank is the simplest SM
 * action: a single 苦痛-dominant SOURCE fire on the target with a small
 * 恐怖/逸脱/反感 tail and an 幼稚 amplification. The 特殊ソース処理
 * (PALAM:苦痛 level scaling) and TCVAR 指令Ｖ/Ａ補正 (受虐属性 → V/A
 * 快感) are mid-scene chaining signals; the 苦痛 scaling IS modeled
 * (it's a multiplicative Q-source change, not state).
 *
 * **Faithful normal-mode core (ERB 27-66, ELSE branch):**
 *   - DOWNBASE: target 体力 60 / 気力 20 (ERB 29-30)
 *   - SOURCE target: 苦痛 450, 恐怖 400, 逸脱 50, 反感 500 (ERB 32-35)
 *   - if 幼稚: 苦痛+350, 恐怖+200, 逸脱+50 (ERB 36-40)
 *   - 特殊ソース処理: 苦痛 *= (10 + 5 * MAX(GETPALAMLV(PALAM:苦痛,5)-1, 0)) / 10
 *     (ERB 46) — multiplicative scale based on the target's PALAM:苦痛 level
 *   - EXP 嗜虐快楽経験 PLAYER++ (ERB 65)
 *   - HETEROSEX 同性愛 EXP: 4 target / 2 master (ERB 60-62)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 23-26) — TSP drain, single 苦痛 SOURCE.
 *   - Other commands' TCVAR 指令Ｃ/Ｖ/Ａ/Ｂ/Ｍ correction producers and their
 *     command-specific branches remain to be audited. This command's V/A
 *     producer is wired into the shared SOURCE_CHECK consumer.
 *   - HETEROSEX EXP writes (ERB 54-63) — gender-pair helper deferred.
 *   - 下半身着衣 / 睡眠姦中 / ASSI:従順 gates (ERB 81-91) — COMABLE layer.
 *   - COM100_DISPLAY swaps label to "お尻ぺんぺん" if 幼稚 (ERB 5-10) — display
 *     layer, not settlement.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../../state/settlement.js";
import { palamLevel } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf100Def: ComfDef = {
  commandNo: 100,
  label: "スパンキング",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 29-30: target 体力 60 / 気力 20 (factory downbase is master-only,
  // so target drain lives in body).
  downbase: {},

  buildSources: (c) => {
    let kutsuu = 450; // 苦痛
    const kyoufu = 400; // 恐怖
    let itsudev = 50; // 逸脱
    const hankan = 500; // 反感

    // ERB 36-40: 幼稚 amplification.
    if (c.tTalent(TALENT_ID.幼稚)) {
      kutsuu += 350;
      itsudev += 50;
    }

    // ERB 46: 特殊ソース処理 — 苦痛 scaling by PALAM:苦痛 level.
    // GETPALAMLV(PALAM:苦痛, 5) returns level 0..4 such that PALAMLV[level] ≤
    // value; the 5-cap is the highest meaningful level for PALAM:苦痛.
    const kutsuuLevel = palamLevel(c.t.state.PALAM[PALAM_ID.苦痛] ?? 0, 4);
    const scaled = (kutsuu * (10 + 5 * Math.max(kutsuuLevel - 1, 0))) / 10;
    kutsuu = Math.trunc(scaled);

    // 恐怖 +200 on 幼稚 (after the base 400 is set; the ERB adds +200 inside
    // the IF, so it scales with the amplification).
    const finalKyoufu =
      c.tTalent(TALENT_ID.幼稚) ? kyoufu + 200 : kyoufu;

    return {
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.恐怖]: finalKyoufu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
  },

  body: (c) => {
    // ERB 29-30: target 体力 60 / 気力 20 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 60;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 20;

    // ERB 65: 嗜虐快楽経験 PLAYER++.
    c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
      (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    // ERB 48-49: command-local V/A pleasure correction. SOURCE_CHECK
    // consumes these transient slots after the ordinary converters and
    // before ORGASM_ADD, matching SOURCE_CBVA.ERB:749-753.
    const masochism = c.tAbl(ABL_ID.受虐属性);
    c.t.state.TCVAR[TCVAR_ID.指令Ｖ補正] = 2 * (masochism - 1);
    c.t.state.TCVAR[TCVAR_ID.指令Ａ補正] = 4 * (masochism - 1);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用巴掌打了%CALLNAME:TARGET% — スパンキング；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf100HandlerEntry: HandlerEntry = makeComfHandler(comf100Def);
