/**
 * Phase 7 — `COMF108 乳スパンキング` (breast spanking), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM108`
 * (`ERB/コマンド関連/COMF/COMF108 乳スパンキング.ERB`).
 *
 * **SM family sibling (108 乳スパンキング).** A breast-zone spanking
 * variant: same source skeleton as `COMF100 スパンキング` (苦痛 450,
 * 恐怖 400, 逸脱 50, 反感 300 — 反感 is HALF of 100 because the impact
 * is on the breast, not the buttocks) plus the 特殊ソース処理 苦痛
 * scaling AND a 受虐属性 → 快Ｂ converter (the only SM command that
 * yields pleasure).
 *
 * **Faithful normal-mode core (ERB 14-63, ELSE branch):**
 *   - DOWNBASE: target 体力 60 / 気力 20 (ERB 22-23)
 *   - SOURCE target: 苦痛 450, 恐怖 400, 逸脱 50, 反感 300 (ERB 25-28)
 *   - if 幼稚: 苦痛+350, 恐怖+200, 逸脱+50 (ERB 29-33)
 *   - 特殊ソース処理 苦痛 scaling (ERB 39): 苦痛 *= (10 + 5 * MAX(GETPALAMLV(PALAM:苦痛,5)-1, 0)) / 10
 *   - SOURCE:快Ｂ += 30 * ABL:受虐属性 (ERB 41) — 受虐属性 → 快感 converter
 *   - STAIN swap: STAIN:5 |= STAIN:PLAYER:1; STAIN:PLAYER:1 |= STAIN:5
 *     (ERB 46-47) — deferred (STAIN not modeled in settlement scope).
 *   - HETEROSEX 同性愛 EXP: 2 target / 2 master (ERB 57-61)
 *   - EXP 嗜虐快楽経験 PLAYER++ (ERB 63)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 16-18) — TSP -60 drain, single 苦痛 450 SOURCE.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 10) — display-only.
 *   - STAIN:5 / STAIN:PLAYER:1 swap (ERB 46-47) — STAIN subsystem not modeled.
 *   - HETEROSEX EXP writes (ERB 51-62) — gender-pair helper deferred.
 *   - CFLAG:恶作剧 gate, ASSI 従順 gate (ERB 79-86) — COMABLE layer.
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
} from "../../../state/settlement.js";
import { palamLevel } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf108Def: ComfDef = {
  commandNo: 108,
  label: "乳スパンキング",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 22-23: target 体力 60 / 気力 20 (factory downbase is master-only,
  // so target drain lives in body).
  downbase: {},

  buildSources: (c) => {
    let kutsuu = 450; // 苦痛
    const kyoufu = 400; // 恐怖
    let itsudev = 50; // 逸脱
    const hankan = 300; // 反感 (HALF of comf100's 500 — breast zone)

    // ERB 29-33: 幼稚 amplification.
    if (c.tTalent(TALENT_ID.幼稚)) {
      kutsuu += 350;
      itsudev += 50;
    }

    // ERB 39: 特殊ソース処理 — 苦痛 scaling by PALAM:苦痛 level.
        // ERB's GETPALAMLV(PALAM:苦痛, 5) caps the level index at 5
        // (PALAMLV[5] = 30000) — matches palamLevel(value, 5).
        // Pre-fix bug (audit 2026-06-18): cap=4 truncated level 5 to 4,
        // under-scaling by ×2.5 vs ERB's ×3.0 for PALAM:苦痛 ≥ 30000.
        const kutsuuLevel = palamLevel(c.t.state.PALAM[PALAM_ID.苦痛] ?? 0, 5);
        const scaled = (kutsuu * (10 + 5 * Math.max(kutsuuLevel - 1, 0))) / 10;
        kutsuu = Math.trunc(scaled);

    // 恐怖 +200 on 幼稚 (after the base 400 is set; the ERB adds +200
    // inside the IF, so it scales with the amplification).
    const finalKyoufu =
      c.tTalent(TALENT_ID.幼稚) ? kyoufu + 200 : kyoufu;

    // ERB 41: SOURCE:快Ｂ += 30 * ABL:受虐属性 (受虐 → 快感 converter).
    const kaib = 30 * c.tAbl(ABL_ID.受虐属性);

    const sources: Record<number, number> = {
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.恐怖]: finalKyoufu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (kaib > 0) {
      sources[SOURCE_ID.快Ｂ] = kaib;
    }
    return sources;
  },

  body: (c) => {
    // ERB 22-23: target 体力 60 / 気力 20 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 60;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 20;

    // ERB 63: 嗜虐快楽経験 PLAYER++.
    c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
      (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;

    // ERB 46-47: STAIN swap — target Ｂ ⇔ master 口.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mm = getStain(c.master, STAIN_PART.口);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mm;
    c.master.state.STAIN[STAIN_PART.口] = mm | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用巴掌打了%CALLNAME:TARGET%的胸部 — 乳スパンキング；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf108HandlerEntry: HandlerEntry = makeComfHandler(comf108Def);