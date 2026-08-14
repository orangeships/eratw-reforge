/**
 * Phase 7 — `COMF8 秘貝開帳` (labia spreading — 露出/屈従 focused), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM8`
 * (`ERB/コマンド関連/COMF/COMF8 秘貝開帳.ERB`, lines 22-54).
 *
 * **Faithful normal-mode core (ELSE branch):**
 *   - DOWNBASE: master 体力 50 / 気力 90 (ERB 22-23)
 *   - SOURCE target: 快Ｃ 43, 達成 20, 恐怖 120, 液体 10, 露出 300,
 *     屈従 450, 逸脱 150, 反感 150 (ERB 24-31)
 *   - 鬱屈 +150 if 自己愛<0 || 抵抗 (ERB 33-34)
 *   - 処女 gate (TALENT:処女 == 1 || == -1, ERB 44-53):
 *     - TIMES 恐怖 ×1.20, 屈従 ×1.20, 反感 ×1.20
 *     - 露出 += 300
 *     - IF TALENT:貞操 > 0: TIMES 露出 ×2.00, 逸脱 ×2.00
 *   - body: if ABL:露出癖 >= 3 → EXP:TARGET:自慰経験++ (ERB 69-74)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 1-21) — TSP drain + reduced sources + STAIN.
 *   - STAIN 汚垢 handling (ERB 63-65) — entire subsystem deferred.
 *   - HETEROSEX 同性愛 EXP (ERB 77-85) — gender-pair helper deferred.
 *   - TCVAR markers (ERB 10-12) — H-scene action markers deferred.
 *   - CAN_COM / 交互的 execution conditions — not ported.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant (target-only SOURCE).
 * **No 舌使い/猫舌** — not present in this ERB.
 *
 * TIMES note: all TIMES (× factors) use `Math.trunc(value * factor)` for
 * integer truncation, matching Emuera semantics.
 *
 * 処女 branch note: ERB `IF TALENT:処女 == 1 || TALENT:処女 == -1`.
 * Both strict-virgin (== 1) and 無自覚非処女 (== -1) trigger the
 * scaling. The 貞操 > 0 check is nested INSIDE the 処女 gate (ERB 49-52),
 * not applied to non-virgin targets.
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
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf8Def: ComfDef = {
  commandNo: 8,
  label: "秘貝開帳",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 22-23: DOWNBASE:体力 += 50, DOWNBASE:気力 += 90.
  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 90 },

  buildSources: (c) => {
    // ERB 24-31: base SOURCE quanta.
    const kaiC = 43; // 快Ｃ
    const tassei = 20; // 達成
    let kyofu = 120; // 恐怖
    const ekitai = 10; // 液体
    let roshutsu = 300; // 露出
    let kutsujyu = 450; // 屈従
    let itsudatsu = 150; // 逸脱
    let hankan = 150; // 反感

    // ERB 33-34: SIF TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 150.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 150 : 0;

    // ERB 44-53: 処女 gate.
    const shojo = c.tTalent(TALENT_ID.処女);
    if (shojo === 1 || shojo === -1) {
      kyofu = Math.trunc(kyofu * 1.2);
      kutsujyu = Math.trunc(kutsujyu * 1.2);
      hankan = Math.trunc(hankan * 1.2);
      roshutsu += 300;
      // ERB 49-52: IF TALENT:貞操 > 0 (nested inside 処女 gate).
      if (c.tTalent(TALENT_ID.貞操) > 0) {
        roshutsu = Math.trunc(roshutsu * 2.0);
        itsudatsu = Math.trunc(itsudatsu * 2.0);
      }
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.達成]: tassei,
      [SOURCE_ID.恐怖]: kyofu,
      [SOURCE_ID.液体]: ekitai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kutsujyu,
      [SOURCE_ID.逸脱]: itsudatsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — single-participant command.

  body: (c) => {
    // ERB 69-74: IF ABL:露出癖 >= 3 → EXP:自慰経験++.
    // NB: in the ERB, bare `EXP:自慰経験` (no :PLAYER prefix) writes to TARGET.
    if (c.tAbl(ABL_ID.露出癖) >= 3) {
      c.t.state.EXP[EXP_ID.自慰経験] =
        (c.t.state.EXP[EXP_ID.自慰経験] ?? 0) + 1;
    }
    // ERB 60-61: STAIN swap — target Ｖ ⇔ master 手.
    {
      const tv = getStain(c.t, STAIN_PART.Ｖ);
      const mh = getStain(c.master, STAIN_PART.手);
      c.t.state.STAIN[STAIN_PART.Ｖ] = tv | mh;
      c.master.state.STAIN[STAIN_PART.手] = mh | tv;
    }
    // ERB 63-64: STAIN swap — target Ｖ ⇔ target 手.
    {
      const tv = getStain(c.t, STAIN_PART.Ｖ);
      const th = getStain(c.t, STAIN_PART.手);
      c.t.state.STAIN[STAIN_PART.Ｖ] = tv | th;
      c.t.state.STAIN[STAIN_PART.手] = th | tv;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%掰开了%CALLNAME:TARGET%的阴唇 — 秘貝開帳；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf8HandlerEntry: HandlerEntry = makeComfHandler(comf8Def);
