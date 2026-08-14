/**
 * Phase 7 — `COMF13 アナル開帳` (Anal Spreading) settlement, as a `ComfDef`.
 *
 * Ports `@COM13` (`ERB/コマンド関連/COMF/COMF13 アナル開帳.ERB`), the
 * normal-mode (ELSE) core.
 *
 * **H foreplay family (root 0-26) sibling.** Like COMF8, this is a
 * TARGET-driven command — SOURCE quanta fire on the target who spreads
 * her own anus on command.
 *
 * **Faithful normal-mode core (ERB 23-86, ELSE branch):**
 *   - DOWNBASE: target 体力 50 / 気力 90 (ERB 25-26)
 *   - SOURCE target: 快Ａ 43, 達成 20, 恐怖 120, 液体 10,
 *     露出 300, 屈従 450, 逸脱 150, 反感 150 (ERB 28-35)
 *   - 鬱屈 +150 if 自己愛<0 || 抵抗 (ERB 40-41)
 *   - 処女 (==1 or ==-1) → 恐怖/屈従/反感 ×1.20, 露出 +300
 *     (ERB 44-48) — same shape as comf8
 *   - 貞操 (>0) → 露出/逸脱 ×2.00 (ERB 49-52)
 *   - EXP 自慰経験 target++ if 露出癖 >= 3 (ERB 69-73)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 18-22) — TSP drain + reduced sources.
 *   - STAIN (A⇔指) swap (ERB 63-65) — STAIN subsystem deferred.
 *   - TCVAR:116 = TARGET / TCVAR:PLAYER:108 = 1 (ERB 10-12) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 78-85) — gender-pair helper deferred.
 *   - CAN_COM13 interactive show-and-ask flow — not a settlement path.
 *   - 加虐 SOURCE — defer entirely.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant foreplay.
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

export const comf13Def: ComfDef = {
  commandNo: 13,
  label: "アナル開帳",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  buildSources: (c) => {
    // ERB 28-35: base SOURCE values.
    const kaiA = 43;       // 快Ａ
    const tassei = 20;     // 達成
    let kyoufu = 120;      // 恐怖
    let roshutsu = 300;    // 露出
    let kutsuju = 450;     // 屈従
    let itsudev = 150;     // 逸脱
    let hankan = 150;      // 反感
    const ekitai = 10;     // 液体 (ERB 31, flat base)

    // ERB 40-41: 鬱屈 +150 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 150 : 0;

    // ERB 44-48: 処女 (==1 or ==-1) → 恐怖/屈従/反感 ×1.20, 露出 +300.
    const shojo = c.tTalent(TALENT_ID.処女);
    const isVirginLike = shojo === 1 || shojo === -1;
    if (isVirginLike) {
      kyoufu = Math.trunc(kyoufu * 1.2);
      kutsuju = Math.trunc(kutsuju * 1.2);
      hankan = Math.trunc(hankan * 1.2);
      roshutsu += 300;
    }

    // ERB 49-52: 貞操 (>0) → 露出/逸脱 ×2.00.
    if (c.tTalent(TALENT_ID.貞操) > 0) {
      roshutsu = Math.trunc(roshutsu * 2);
      itsudev = Math.trunc(itsudev * 2);
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.達成]: tassei,
      [SOURCE_ID.恐怖]: kyoufu,
      [SOURCE_ID.液体]: ekitai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  body: (c) => {
    // ERB 25-26: DOWNBASE target 体力 50 / 気力 90.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 90;

    // ERB 69-73: 自慰経験 target++ if 露出癖 >= 3.
    if (c.tAbl(ABL_ID.露出癖) >= 3) {
      c.t.state.EXP[EXP_ID.自慰経験] =
        (c.t.state.EXP[EXP_ID.自慰経験] ?? 0) + 1;
    }
    // ERB 60-61: STAIN swap — target Ａ ⇔ master 手.
    {
      const ta = getStain(c.t, STAIN_PART.Ａ);
      const mh = getStain(c.master, STAIN_PART.手);
      c.t.state.STAIN[STAIN_PART.Ａ] = ta | mh;
      c.master.state.STAIN[STAIN_PART.手] = mh | ta;
    }
    // ERB 63-64: STAIN swap — target Ａ ⇔ target 手.
    {
      const ta = getStain(c.t, STAIN_PART.Ａ);
      const th = getStain(c.t, STAIN_PART.手);
      c.t.state.STAIN[STAIN_PART.Ａ] = ta | th;
      c.t.state.STAIN[STAIN_PART.手] = th | ta;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 奉命掰开了自己的肛门；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf13HandlerEntry: HandlerEntry = makeComfHandler(comf13Def);
