/**
 * Phase 7 — `COMF705 アナル愛撫(慰)` (anal caress self-pleasure), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM705`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF705 アナル愛撫(慰).ERB`).
 *
 * **Self-pleasure command — no target.** Master stimulates their own anus.
 * Heavy 苦痛/屈従 baseline (100 each), moderate 快Ａ (100). 鬱屈 penalty
 * is also heavy at +100. 快Ａ is boosted by `器用な指` (+20).
 *
 * **Faithful normal-mode core (ERB 15-51):**
 *   - DOWNBASE: master 体力 40 / 気力 100 (ERB 16-17)
 *   - SOURCE master: 快Ａ 100, 苦痛 100, 屈従 100, 逸脱 80, 反感 60 (ERB 19-23)
 *   - 器用な指: 快Ａ += 20 (ERB 25-26)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 31-32)
 *   - Body: CFLAG[347]++, EXP[手淫経験]++ (ERB 50-51)
 *   - TIME += 5 (ERB 47-48)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker, deferred.
 *   - PAIN_CHECK_A (ERB 35) — pain check call, deferred sub-routine.
 *   - STAIN self-swap (ERB 40-43): STAIN:PLAYER:手/Ａ/腸内 — wired (body).
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

export const comf705Def: ComfDef = {
  commandNo: 705,
  label: "アナル愛撫(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 47-48: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — self-pleasure command.
  requiresTarget: false,

  // ERB 16-17: master 体力 40 / 気力 100.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    // ERB 19: 快Ａ = 100.
    let kaiA = 100;
    const kutsuu = 100;
    const kutzjuu = 100;
    const itsudev = 80;
    const hankan = 60;

    // ERB 25-26: 器用な指 → 快Ａ += 20.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiA += 20;
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.屈従]: kutzjuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 31-32: 鬱屈 +100 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 100;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 100;
    }

    return sources;
  },

  body: (c) => {
    // ERB 50: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 51: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 40-43: 汚れ移動 — self-swap master 手 ⇔ master Ａ + 腸内.
    // ERB runs the |= chain sequentially, so the updated 手 (now the union of
    // all three) is what Ａ/腸内 read back. Mirror that exactly.
    c.master.state.STAIN[STAIN_PART.手] =
      (c.master.state.STAIN[STAIN_PART.手] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.Ａ] ?? 0);
    c.master.state.STAIN[STAIN_PART.手] =
      (c.master.state.STAIN[STAIN_PART.手] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.腸内] ?? 0);
    c.master.state.STAIN[STAIN_PART.Ａ] =
      (c.master.state.STAIN[STAIN_PART.Ａ] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.手] ?? 0);
    c.master.state.STAIN[STAIN_PART.腸内] =
      (c.master.state.STAIN[STAIN_PART.腸内] ?? 0) |
      (c.master.state.STAIN[STAIN_PART.手] ?? 0);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 爱抚了自己的肛门 — アナル愛撫(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf705HandlerEntry: HandlerEntry = makeComfHandler(comf705Def);
