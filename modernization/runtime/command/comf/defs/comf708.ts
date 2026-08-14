/**
 * Phase 7 — `COMF708 秘貝開帳(慰)` (self-pleasure: display vulva), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM708`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF708 秘貝開帳(慰).ERB`).
 *
 * **Self/auto family (自慰系).** Master exposes themselves — SOURCEs flow
 * entirely to the master. No target exists (`requiresTarget: false`).
 *
 * **Faithful normal-mode core:**
 *   - DOWNBASE: master 体力 50 / 気力 90
 *   - SOURCE master: 快Ｃ 43, 達成 20, 恐怖 120, 露出 300, 屈従 450,
 *     逸脱 150, 反感 150
 *   - 鬱屈 +150 if 自己愛<0 || 抵抗
 *   - VIRGIN branch (処女 == 1 || 処女 == -1):
 *       恐怖 *= 1.20, 屈従 *= 1.20, 反感 *= 1.20, 露出 += 300.
 *       If ALSO 貞操 > 0: 露出 *= 2.0, 逸脱 *= 2.0
 *   - Body: CFLAG[347]++ ONLY if ABL:露出癖 >= 3
 *   - TIME += 5
 *
 * **DEFERRED:**
 *   - 液体 SOURCE (id 22, not in our enum)
 *   - STAIN ops
 *   - CAN_COM section / ABLE gates
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf708Def: ComfDef = {
  commandNo: 708,
  label: "秘貝開帳(慰)",

  // Always 通常 outcome — no roll.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,

  // Master-only self-pleasure — no target.
  requiresTarget: false,

  // DOWNBASE: master 体力 50 / 気力 90.
  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 90 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 43,
      [SOURCE_ID.達成]: 20,
      [SOURCE_ID.恐怖]: 120,
      [SOURCE_ID.露出]: 300,
      [SOURCE_ID.屈従]: 450,
      [SOURCE_ID.逸脱]: 150,
      [SOURCE_ID.反感]: 150,
    };

    // 鬱屈 +150 if 自己愛<0 || 抵抗
    if (
      (c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
        c.master.state.TALENT[TALENT_ID.自己愛] < 0) ||
      c.master.state.TALENT[TALENT_ID.抵抗]
    ) {
      sources[SOURCE_ID.鬱屈] = 150;
    }

    // VIRGIN branch: 処女 == 1 || 処女 == -1
    const seijo = c.master.state.TALENT[TALENT_ID.処女];
    if (seijo === 1 || seijo === -1) {
      sources[SOURCE_ID.恐怖] = Math.trunc(sources[SOURCE_ID.恐怖]! * 1.2);
      sources[SOURCE_ID.屈従] = Math.trunc(sources[SOURCE_ID.屈従]! * 1.2);
      sources[SOURCE_ID.反感] = Math.trunc(sources[SOURCE_ID.反感]! * 1.2);
      sources[SOURCE_ID.露出] = sources[SOURCE_ID.露出]! + 300;

      // 貞操 > 0 nested inside virgin
      if (
        c.master.state.TALENT[TALENT_ID.貞操] !== undefined &&
        c.master.state.TALENT[TALENT_ID.貞操] > 0
      ) {
        sources[SOURCE_ID.露出] = Math.trunc(sources[SOURCE_ID.露出]! * 2.0);
        sources[SOURCE_ID.逸脱] = Math.trunc(sources[SOURCE_ID.逸脱]! * 2.0);
      }
    }

    return sources;
  },

  body: (c) => {
    // CFLAG[347]++ ONLY if ABL:露出癖 >= 3
    if (c.mAbl(ABL_ID.露出癖) >= 3) {
      c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 自己掰开了阴唇 — 秘貝開帳(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf708HandlerEntry: HandlerEntry = makeComfHandler(comf708Def);
