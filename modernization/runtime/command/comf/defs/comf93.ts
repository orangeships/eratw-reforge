/**
 * Phase 7 — `COMF93 Ａ後背位される` (anal doggy on master),
 * as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM93`
 * (`ERB/コマンド関連/COMF/COMF93 Ａ後背位される.ERB`).
 *
 * **される系 / reverse positions (92-94).** Master is the bottom in
 * anal doggy-style. Compared to 92 (missionary), this has no 情愛 or
 * 達成 SOURCE (purely physical/degrading) and higher 征服 (1200 vs
 * 1000). Both master and target drain 体力/気力. Master receives
 * `快Ａ`, target receives `快Ｃ` + 性行動/征服/逸脱/反感.
 *
 * **Faithful normal-mode core (ERB 41-60):**
 *   - DOWNBASE: target 体力 50 / 気力 150 (ERB 41-42)
 *   - DOWNBASE:PLAYER 体力 50 / 気力 150 (ERB 43-44) — master drain in body
 *   - master SOURCE: 快Ａ = 400 (ERB 45)
 *   - SOURCE target: 快Ｃ 400, 性行動 500, 征服 1200, 逸脱 500,
 *     反感 500 (ERB 46-51) — no 情愛, no 達成
 *   - 自己愛<0 || 抵抗 → 鬱屈 +500 (ERB 58-59)
 *   - EXP:PLAYER:Ａ性交経験 master++ (ERB 71-72)
 *   - EXP:挿入経験 target++ (ERB 73-74)
 *   - EXP愛情経験 target += 恋慕 if !ASSIPLAY (ERB 81-83)
 *
 * **DEFERRED (documented):**
 *   - 不潔 = Y*30+140 (ERB 53) — Y from STAIN; pinned 0.
 *   - STAIN:3 |= 4, STAIN:PLAYER:3 |= 4 (ERB 63-64) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes — gender-pair helper.
 *   - TCVAR:116/108, CSTR markers — H-scene chaining.
 *   - STR:0 text marker (ERB 17) — H-scene flags.
 *   - COM_ABLE93 — アナル开发性癖/ABL gates.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
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
import { STAIN_PART, getStain } from "../../../state/stain.js";
import { computeAnalSexFuketsu } from "./comf92.js";

export const comf93Def: ComfDef = {
  commandNo: 93,
  label: "Ａ後背位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 41-44: target + master drain — both in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 46-51: fixed tail. No 情愛/達成 (unlike 92 missionary).
    // 不潔 = Y*10+60 (ERB 54), Y from master Ａ+腸内 (same as comf92).
    const fuketsu = computeAnalSexFuketsu(
      getStain(c.master, STAIN_PART.Ａ),
      getStain(c.master, STAIN_PART.腸内),
      c.tTalent(TALENT_ID.汚臭耐性),
    );
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.征服]: 1200,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
      [SOURCE_ID.不潔]: fuketsu,
    };
    // ERB 58-59: 鬱屈 +500 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE (ERB 45).
  buildMasterSources: () => ({
    [SOURCE_ID.快Ａ]: 400,
  }),

  body: (c) => {
    // ERB 41-42: target 体力 50 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 43-44: master 体力 50 / 気力 150 drain (DOWNBASE:PLAYER).
    c.master.state.BASE[BASE_ID.体力] =
      (c.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.master.state.BASE[BASE_ID.気力] =
      (c.master.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 71-72: Ａ性交経験 master++.
    c.master.state.EXP[EXP_ID.Ａ性交経験] =
      (c.master.state.EXP[EXP_ID.Ａ性交経験] ?? 0) + 1;

    // ERB 73-74: 挿入経験 target++.
    c.t.state.EXP[EXP_ID.挿入経験] =
      (c.t.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;

    // ERB 81-83: 愛情経験 target += 恋慕 if !ASSIPLAY.
    if (
      c.tTalent(TALENT_ID.恋慕) &&
      !(c.ctx as { ASSIPLAY?: number }).ASSIPLAY
    ) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + c.tTalent(TALENT_ID.恋慕);
    }

    // ERB 66-69: STAIN swap — target Ｐ ⇔ master Ａ+腸内 (same as comf92).
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    const mi = getStain(c.master, STAIN_PART.腸内);
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | ma | mi;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | tp;
    c.master.state.STAIN[STAIN_PART.腸内] = mi | tp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 把%CALLNAME:MASTER%用肛门后背位对待 — Ａ後背位される；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf93HandlerEntry: HandlerEntry = makeComfHandler(comf93Def);
