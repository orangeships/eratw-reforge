/**
 * Phase 7 — `COMF709 手淫(慰)` (self-pleasure: masturbate), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM709`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF709 手淫(慰).ERB`).
 *
 * **Self/auto family (自慰系).** Master masturbates — SOURCEs flow
 * entirely to the master. No target exists (`requiresTarget: false`).
 *
 * **Faithful normal-mode core:**
 *   - DOWNBASE: master 体力 10 / 気力 100
 *   - SOURCE master: 情愛 50, 性行動 250, 達成 50, 屈従 350,
 *     逸脱 100, 反感 100, 不潔 60 (Y*10+60, Y default 0 — STAIN deferred)
 *   - 鬱屈 +200 if 自己愛<0 || 抵抗
 *   - Body: CFLAG[347]++, EXP[手淫経験]++
 *   - TIME += 5
 *
 * **DEFERRED:**
 *   - TCVAR ops (display markers)
 *   - CSTR markers
 *   - STAIN self-swap (ERB 49-50): master 手 ⇔ master Ｐ — wired (body).
 *   - Y dirt calculation (不潔 fixed at base 60; @COM709 never computes Y)
 *   - TFLAG:30
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

export const comf709Def: ComfDef = {
  commandNo: 709,
  label: "手淫(慰)",

  // Always 通常 outcome — no roll.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,

  // Master-only self-pleasure — no target.
  requiresTarget: false,
  settleSourcesOnMaster: true,

  // DOWNBASE: master 体力 10 / 気力 100.
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: 50,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.達成]: 50,
      [SOURCE_ID.屈従]: 350,
      [SOURCE_ID.逸脱]: 100,
      [SOURCE_ID.反感]: 100,
      // 不潔 = Y*10 + 60; Y deferred (STAIN) → base 60.
      [SOURCE_ID.不潔]: 60,
    };

    // 鬱屈 +200 if 自己愛<0 || 抵抗
    if (
      (c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
        c.master.state.TALENT[TALENT_ID.自己愛] < 0) ||
      c.master.state.TALENT[TALENT_ID.抵抗]
    ) {
      sources[SOURCE_ID.鬱屈] = 200;
    }

    return sources;
  },

  body: (c) => {
    // CFLAG[347]++ (自慰过了)
    c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    // EXP[手淫経験]++
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 49-50: 汚れ移動 — self-swap master 手 ⇔ master Ｐ (mutual OR).
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    const mp = c.master.state.STAIN[STAIN_PART.Ｐ] ?? 0;
    c.master.state.STAIN[STAIN_PART.手] = m1 | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | m1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 自己手淫了 — 手淫(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf709HandlerEntry: HandlerEntry = makeComfHandler(comf709Def);
