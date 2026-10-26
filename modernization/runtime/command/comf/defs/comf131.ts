/**
 * Phase 7 — `COMF131 後背位される` (rear missionary, target on top), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM131`
 * (`ERB/コマンド関連/COMF/COMF131 後背位される.ERB`).
 *
 * **される系 family (130-133).** 131 is the される twin of 130 — same
 * shape, same 2 BASE-drain split, same dual-SOURCE mapping. Differs
 * from 130 in:
 *   - master SOURCE 快Ｖ 450 (vs 130's 300)
 *   - target DOWNBASE 体力 40/気力 120 (vs 130's 80/120)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (same as 130)
 *   - EXP: master Ｖ性交経験 +1, target 挿入経験 +1 (same as 130)
 *
 * **Faithful core (ERB ELSE branch 44-79 + 95-103):**
 *   - master DOWNBASE 体力 40/気力 60 (ERB 34-35, always)
 *   - target DOWNBASE 体力 +40 / 気力 +120 (ERB 46-47)
 *   - master SOURCE 快Ｖ 450 (ERB 48) — via `buildMasterSources`
 *   - target SOURCE 快Ｃ 400, 性行動 500, 屈従 1000, 逸脱 500,
 *     反感 500 (ERB 50-54)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 63-64)
 *   - EXP: master Ｖ性交経験 +1 (ERB 96), target 挿入経験 +1 (ERB 97)
 *
 * **DEFERRED (documented):**
 *   - STAIN swap (target's Ｐ ↔ master's 膣内, ERB 83-89) — STAIN not
 *     modeled.
 *   - The 調教者 処女 loss block is `[SKIPSTART]`/`[SKIPEND]`'d (ERB
 *     66-79) — deferred.
 *   - 不潔 = Y*10+60 (ERB 57) — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 40-43).
 *   - HETEROSEX 同性愛 EXP, ASSIPLAY, TCVAR action markers.
 *   - No 愛情経験 grant (no `!ASSIPLAY` block; ERB 98+ has none).
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

export const comf131Def: ComfDef = {
  commandNo: 131,
  label: "後背位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  // ERB 34-35: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 60 },

  buildSources: (c): Record<number, number> => {
    // ERB 50-54, normal branch (target / dominant party).
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 63-64: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // ERB 48: master's own pleasure (B1b — receiving party).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｖ]: 450,
  }),

  body: (c) => {
    // ERB 46-47: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 120;

    // EXP grants (ERB 96-97, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.Ｖ性交経験, 1); // ERB 96
    grant(c.t, EXP_ID.挿入経験, 1); //         ERB 97
    // No 愛情経験 grant.
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET%主导了与%CALLNAME:MASTER%的后背位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf131HandlerEntry: HandlerEntry = makeComfHandler(comf131Def);
