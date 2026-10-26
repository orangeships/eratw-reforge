/**
 * Phase 7 — `COMF712 胸揉み(慰)` (self-pleasure: breast-rub), as a `ComfDef`.
 *
 * Ports the **initial activation** of `COMF712 胸揉み(慰).ERB`.
 * The full command is a TEQUIP toggle; we model only the first press
 * (equipping) here.
 *
 * **Self/auto family (自慰系).** Master fondles own breasts —
 * SOURCEs flow entirely to the master. No target (`requiresTarget: false`).
 *
 * **Faithful normal-mode core:**
 *   - DOWNBASE: master 体力 10 / 気力 50
 *   - SOURCE master: 快Ｂ = ABL:指 * 20 + 30 (×1.50 if 器用な指),
 *     情愛 15, 露出 20, 逸脱 30, 反感 50
 *   - If ABL:親密 >= 7: 情愛 += ABL:親密 * 10
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗
 *   - Body: CFLAG[347]++, EXP[手淫経験]++
 *
 * **DEFERRED:**
 *   - TEQUIP toggle management
 *   - EQUIP_COM712 continuation effects
 *   - 着脱 handling
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

export const comf712Def: ComfDef = {
  commandNo: 712,
  label: "胸揉み(慰)",

  // Always 通常 outcome — no roll.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB: TIME += 5.
  timeCost: 5,

  // Master-only self-pleasure — no target.
  requiresTarget: false,
  settleSourcesOnMaster: true,

  // DOWNBASE: master 体力 10 / 気力 50.
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // 快Ｂ = ABL:指 * 20 + 30
    let kaiB = c.mAbl(ABL_ID.指) * 20 + 30;
    // ×1.50 if 器用な指
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiB = Math.trunc(kaiB * 1.5);
    }

    let jouai = 15;
    // If ABL:親密 >= 7: 情愛 += ABL:親密 * 10
    const shinmitsu = c.mAbl(ABL_ID.親密);
    if (shinmitsu >= 7) {
      jouai += shinmitsu * 10;
    }

    const roshutsu = 20;
    const itsudev = 30;
    const hankan = 50;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // 鬱屈 +100 if 自己愛<0 || 抵抗
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
    // CFLAG[347]++ (自慰过了)
    c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    // EXP[手淫経験]++
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 揉弄了自己的胸部 — 胸揉み(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf712HandlerEntry: HandlerEntry = makeComfHandler(comf712Def);
