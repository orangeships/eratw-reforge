/**
 * Phase 7 — `COMF702 セルフフェラ(慰)` (self-fellatio), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM702`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF702 セルフフェラ(慰).ERB`).
 *
 * **Self-pleasure command — no target.** Master performs oral
 * self-stimulation (requires penis). 快Ｃ is modulated by `TALENT:舌使い`
 * (×1.5) and `TALENT:猫舌` (×0.75). Standard 鬱屈 penalty for
 * `自己愛<0` / `抵抗` masters.
 *
 * **Faithful normal-mode core (ERB 19-59):**
 *   - DOWNBASE: master 体力 5 / 気力 50 (ERB 23-24)
 *   - SOURCE master: 快Ｃ 110, 露出 20, 逸脱 20, 反感 20 (ERB 26-29)
 *   - 舌使い: 快Ｃ *= 1.5 (ERB 39-40)
 *   - 猫舌: 快Ｃ *= 0.75 (ERB 43-44)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 35-36) — PLAYER scope.
 *   - Body: CFLAG[347]++ (自慰过了), EXP[口淫経験]++ (ERB 58-59)
 *   - TIME += 5 (non-time-stop, ERB 55-56)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker, deferred.
 *   - CSTR:PLAYER:10 += LOCALS (ERB 14) — narrative string, deferred.
 *   - TCVAR:PLAYER:2 = 4 (ERB 15) — ejaculation-site flag, deferred.
 *   - TCVAR:PLAYER:4 = 1500 (ERB 17) — intensity, deferred.
 *   - STAIN self-swap (ERB 49-50): STAIN:PLAYER:Ｐ ↔ STAIN:PLAYER:口 — wired (body).
 *
 * **TIME += 5** (ERB 55-56). Modeled as `timeCost: 5`.
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
import { STAIN_PART } from "../../../state/stain.js";

export const comf702Def: ComfDef = {
  commandNo: 702,
  label: "セルフフェラ(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 55-56: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — this is a self-pleasure command.
  requiresTarget: false,

  // ERB 23-24: master 体力 5 / 気力 50.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 26: 快Ｃ = 110.
    let kaiC = 110;
    const roshutsu = 20;
    const itsudev = 20;
    const hankan = 20;

    // ERB 39-40: 舌使い ×1.5 on 快Ｃ.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiC = Math.trunc(kaiC * 1.5);
    }
    // ERB 43-44: 猫舌 ×0.75 on 快Ｃ.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiC = Math.trunc(kaiC * 0.75);
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 35-36: 鬱屈 +20 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 20;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 20;
    }

    return sources;
  },

  body: (c) => {
    // ERB 58: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 59: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;

    // ERB 49-50: 汚れ移動 — self-swap master Ｐ ⇔ master 口 (mutual OR).
    const mp = c.master.state.STAIN[STAIN_PART.Ｐ] ?? 0;
    const mk = c.master.state.STAIN[STAIN_PART.口] ?? 0;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | mk;
    c.master.state.STAIN[STAIN_PART.口] = mk | mp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己深喉 — セルフフェラ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf702HandlerEntry: HandlerEntry = makeComfHandler(comf702Def);
