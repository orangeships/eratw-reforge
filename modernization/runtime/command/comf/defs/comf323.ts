/**
 * Phase 7 — `COMF323 相手主導後背位Ａ` (target-led doggy-style anal), as a
 * `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM323`
 * (`ERB/コマンド関連/COMF/COMF323 相手主導後背位Ａ.ERB`).
 *
 * **相手主導 family (320/322/323, anal twin of 322).** 323 differs from
 * 322 in:
 *   - target SOURCE: 快Ａ 500 (replaces 快Ｖ 500), 情愛 300 (vs 200),
 *     苦痛 900 (vs 300), 露出 100 (vs 150), 逸脱 200 (added)
 *   - master SOURCE: 快Ｃ 400 (vs 322's 450)
 *   - master DOWNBASE 体力 30/気力 50 (vs 322's 30/40)
 *   - target DOWNBASE 体力 60/気力 60 (vs 322's 40/50)
 *   - No standing-sex arm (TFLAG:193 absent)
 *   - EXP: target Ａ経験 +1 (replaces Ｖ経験), Ａ性交経験 +1 (replaces
 *     Ｖ性交経験), 愛情経験 += 恋慕 (×1, not ×2)
 *
 * **Faithful target-side core (ERB 38-82):**
 *   - master DOWNBASE 体力 30/気力 50 (ERB 40-41, always)
 *   - target DOWNBASE 体力 +60 / 気力 +60 (ERB 38-39)
 *   - master SOURCE 快Ｃ 400 (ERB 42) — via `buildMasterSources`
 *   - target SOURCE 快Ａ 500, 情愛 300, 苦痛 900, 露出 100, 逸脱 200
 *     (ERB 43-47)
 *   - 不潔 = Y*10+60 (ERB 50) — Y computed in display
 *   - EXP: master 挿入経験 +1, target Ａ経験 +1, Ａ性交経験 +1,
 *     愛情経験 += 恋慕 (ERB 65-81)
 *
 * **DEFERRED (documented):**
 *   - STAIN_肛門Ｐ挿入 / PAIN_CHECK_A (ERB 53/60).
 *   - 不潔 = Y*10+60 — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 68-72).
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *   - TCVAR:20 != 44 entry gate (ERB 94) — handled at COM_ABLE level.
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

export const comf323Def: ComfDef = {
  commandNo: 323,
  label: "相手主導後背位Ａ",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 40-41: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 50 },

  buildSources: (): Record<number, number> => ({
    // ERB 43-47, normal branch (target-side).
    [SOURCE_ID.快Ａ]: 500,
    [SOURCE_ID.情愛]: 300,
    [SOURCE_ID.苦痛]: 900,
    [SOURCE_ID.露出]: 100,
    [SOURCE_ID.逸脱]: 200,
  }),

  // ERB 42: the master's own pleasure (B1b).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 38-39: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 60;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 60;

    // EXP grants (ERB 65-81, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 66
    grant(c.t, EXP_ID.Ａ経験, 1); //         ERB 65
    grant(c.t, EXP_ID.Ａ性交経験, 1); //     ERB 78
    // ERB 80-81: 愛情経験 += 恋慕.
    grant(c.t, EXP_ID.愛情経験, c.tTalent(TALENT_ID.恋慕));
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 相手主導後背位Ａ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf323HandlerEntry: HandlerEntry = makeComfHandler(comf323Def);
