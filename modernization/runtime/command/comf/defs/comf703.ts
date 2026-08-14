/**
 * Phase 7 — `COMF703 指挿れ(慰)` (finger insertion self-pleasure), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM703`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF703 指挿れ(慰).ERB`).
 *
 * **Self-pleasure command — no target.** Master inserts fingers vaginally.
 * Sources branch on `TALENT:処女`: non-virgin (処女 != 1) gets higher 快Ｖ,
 * lower 露出/逸脱/反感; virgin (処女 == 1) gets lower 快Ｖ, higher
 * 露出/逸脱/反感. 快Ｖ also boosted by `器用な指` and `ABL:指*5`.
 * 鬱屈 penalty: +20 standard, +10 extra if virgin.
 *
 * **Faithful normal-mode core (ERB 19-68):**
 *   - DOWNBASE: master 体力 30 / 気力 80 (ERB 19-20)
 *   - Non-virgin (処女 != 1): 快Ｖ 120, 苦痛 15, 露出 10, 逸脱 20, 反感 20 (ERB 23-27)
 *   - Virgin (処女 == 1): 快Ｖ 60, 苦痛 10, 露出 30, 逸脱 30, 反感 30 (ERB 31-35)
 *   - 器用な指: 快Ｖ += 20 (ERB 38-39)
 *   - 快Ｖ += ABL:指 * 5 (ERB 40)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗, extra +10 if 処女 (ERB 45-49)
 *   - Body: CFLAG[347]++, EXP[Ｖ経験]++, EXP[手淫経験]++ (ERB 65-67)
 *   - TIME += 5 (ERB 62-63)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker, deferred.
 *   - TFLAG:2 = 1 (ERB 13) — 破瓜抑制 flag, deferred.
 *   - PAIN_CHECK_V (ERB 52) — pain check call, deferred sub-routine.
 *   - STAIN self-swap (ERB 57-58): STAIN:PLAYER:膣内 ↔ STAIN:PLAYER:手 — wired (body).
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

export const comf703Def: ComfDef = {
  commandNo: 703,
  label: "指挿れ(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 62-63: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — self-pleasure command.
  requiresTarget: false,

  // ERB 19-20: master 体力 30 / 気力 80.
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 80 },

  buildSources: (c) => {
    // ERB 22: IF !TALENT:PLAYER:処女 || TALENT:PLAYER:処女 == -1
    // → non-virgin branch when 処女 is not exactly 1.
    const isVirgin =
      c.master.state.TALENT[TALENT_ID.処女] !== undefined &&
      c.master.state.TALENT[TALENT_ID.処女] === 1;

    let kaiV: number;
    let kutsuu: number;
    let roshutsu: number;
    let itsudev: number;
    let hankan: number;

    if (!isVirgin) {
      // Non-virgin branch (ERB 23-27): !TALENT:処女 || 処女==-1.
      kaiV = 120;
      kutsuu = 15;
      roshutsu = 10;
      itsudev = 20;
      hankan = 20;
    } else {
      // Virgin branch (ERB 31-35): 処女==1.
      kaiV = 60;
      kutsuu = 10;
      roshutsu = 30;
      itsudev = 30;
      hankan = 30;
    }

    // ERB 38-39: 器用な指 → 快Ｖ += 20.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiV += 20;
    }

    // ERB 40: 快Ｖ += ABL:指 * 5.
    kaiV += c.mAbl(ABL_ID.指) * 5;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 45-49: 鬱屈 +20 if 自己愛<0 || 抵抗. Extra +10 if 処女.
    const hasUtsuTrigger =
      (c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
        c.master.state.TALENT[TALENT_ID.自己愛] < 0) ||
      c.master.state.TALENT[TALENT_ID.抵抗];
    if (hasUtsuTrigger) {
      let utsu = 20;
      // ERB 48: SIF TALENT:処女 → 鬱屈 += 10
      if (isVirgin) {
        utsu += 10;
      }
      sources[SOURCE_ID.鬱屈] = utsu;
    }

    return sources;
  },

  body: (c) => {
    // ERB 65: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 66: Ｖ経験 PLAYER++.
    c.master.state.EXP[EXP_ID.Ｖ経験] =
      (c.master.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;
    // ERB 67: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 57-58: 汚れ移動 — self-swap master 膣内 ⇔ master 手 (mutual OR).
    const mv = c.master.state.STAIN[STAIN_PART.膣内] ?? 0;
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    c.master.state.STAIN[STAIN_PART.膣内] = mv | m1;
    c.master.state.STAIN[STAIN_PART.手] = m1 | mv;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 将手指插入自己体内 — 指挿れ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf703HandlerEntry: HandlerEntry = makeComfHandler(comf703Def);
