/**
 * Phase 7 — `COMF322 相手主導後背位` (target-led doggy-style), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM322`
 * (`ERB/コマンド関連/COMF/COMF322 相手主導後背位.ERB`).
 *
 * **相手主導 family (320/322/323).** 322 is the target-led twin of 61 後背位.
 * Differs from 320 in:
 *   - target SOURCE: 快Ｖ 500 (vs 320's 400), 情愛 200 (vs 300),
 *     苦痛 300 (vs 500), 露出 150 (vs 50), 反感 absent
 *   - master SOURCE: 快Ｃ 450 (vs 320's 400)
 *   - master DOWNBASE 体力 30/気力 40 (same as 320)
 *   - target DOWNBASE 体力 40/気力 50 (same as 320)
 *   - 露出 150→300 when standing (TFLAG:193) — outcomeMul
 *   - EXP: 愛情経験 += 恋慕*3 (+10 if 処女+恋慕, same as 320)
 *
 * **Faithful target-side core (ERB 40-81):**
 *   - master DOWNBASE 体力 30/気力 40 (ERB 40-41, always)
 *   - target DOWNBASE 体力 +40 / 気力 +50 (ERB 43-44)
 *   - master SOURCE 快Ｃ 450 (ERB 42) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 500, 情愛 200, 苦痛 300, 露出 150 (ERB 46-49)
 *   - 露出 150→300 when standing (ERB 50-51) — outcomeMul
 *   - 不潔 = Y*10+60 (ERB 54) — Y computed in display
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*3 (+10 if 処女+恋慕) (ERB 66-80)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 56/62/69).
 *   - 不潔 = Y*10+60 — Y computed in display (deferred).
 *   - 露出 150→300 standing-sex arm (TFLAG:193) — captured as outcomeMul.
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *   - TCVAR:20 != 43 entry gate (ERB 92) — handled at COM_ABLE level.
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

export const comf322Def: ComfDef = {
  commandNo: 322,
  label: "相手主導後背位",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 40-41: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 40 },

  buildSources: (): Record<number, number> => ({
    // ERB 46-49, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 500,
    [SOURCE_ID.情愛]: 200,
    [SOURCE_ID.苦痛]: 300,
    [SOURCE_ID.露出]: 150,
  }),

  // ERB 42: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 450,
  }),

  // Standing-sex arm: 露出 150→300 (TFLAG:193).
  outcomeMul: {
    [SOURCE_ID.露出]: { great: 300 / 150, fail: 1.0 },
  },

  body: (c) => {
    // ERB 43-44: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // EXP grants (ERB 66-80, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 66
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 67
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 74
    // ERB 75-80: 愛情経験 += 恋慕*3 (+10 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 3);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 10);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 相手主導後背位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf322HandlerEntry: HandlerEntry = makeComfHandler(comf322Def);
