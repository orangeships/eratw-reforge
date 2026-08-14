/**
 * Phase 7 — `COMF706 胸愛撫(慰)` (breast caress self-pleasure), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM706`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF706 胸愛撫(慰).ERB`).
 *
 * **Self-pleasure command — no target.** Master caresses their own breasts.
 * 快Ｂ base 100, scaled by ABL:指: if ABL:指 >= 4 → 快Ｂ += 70, else
 * 快Ｂ += ABL:指 * 15.
 *
 * **Faithful normal-mode core (ERB 14-51):**
 *   - DOWNBASE: master 体力 5 / 気力 50 (ERB 15-16)
 *   - SOURCE master: 快Ｂ 100, 情愛 50, 性行動 60, 露出 10, 不潔 20, 反感 20 (ERB 18-23)
 *   - ABL:指 >= 4 → 快Ｂ += 70; else 快Ｂ += ABL:指 * 15 (ERB 27-31)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 33-34)
 *   - Body: CFLAG[347]++, EXP[手淫経験]++ (ERB 49-50)
 *   - TIME += 5 (ERB 46-47)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker, deferred.
 *   - STAIN self-swap (ERB 40-41): STAIN:PLAYER:Ｂ ↔ STAIN:PLAYER:手 — wired (body).
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
import { STAIN_PART } from "../../../state/stain.js";

export const comf706Def: ComfDef = {
  commandNo: 706,
  label: "胸愛撫(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 46-47: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — self-pleasure command.
  requiresTarget: false,

  // ERB 15-16: master 体力 5 / 気力 50.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 18: 快Ｂ = 100.
    let kaiB = 100;
    const jouai = 50;
    const seiKodo = 60;
    const roshutsu = 10;
    const fuketsu = 20;
    const hankan = 20;

    // ERB 27-31: ABL:指 >= 4 → 快Ｂ += 70, else 快Ｂ += ABL:指 * 15.
    const fingerAbl = c.mAbl(ABL_ID.指);
    if (fingerAbl >= 4) {
      kaiB += 70;
    } else {
      kaiB += fingerAbl * 15;
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 33-34: 鬱屈 +20 if 自己愛<0 || 抵抗.
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
    // ERB 49: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 50: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 40-41: 汚れ移動 — self-swap master Ｂ ⇔ master 手 (mutual OR).
    const mb = c.master.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    c.master.state.STAIN[STAIN_PART.Ｂ] = mb | m1;
    c.master.state.STAIN[STAIN_PART.手] = m1 | mb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 爱抚了自己的胸部 — 胸愛撫(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf706HandlerEntry: HandlerEntry = makeComfHandler(comf706Def);
