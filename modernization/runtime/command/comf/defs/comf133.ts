/**
 * Phase 7 — `COMF133 背面座位される` (rear seated, target on top),
 * as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM133`
 * (`ERB/コマンド関連/COMF/COMF133 背面座位される.ERB`).
 *
 * **される系 family (130-133).** 133 is the される twin of 68 — same
 * rear position, same dual-SOURCE mapping. Differs from 132 in:
 *   - master SOURCE 快Ｖ 350 (same as 132)
 *   - master SOURCE 快Ｂ 250 (added on top of 快Ｖ)
 *   - target SOURCE 快Ｃ 400 (same as 132)
 *   - master DOWNBASE 体力 20/気力 50 (same as 132)
 *   - target DOWNBASE 体力 40/気力 220 (vs 132's 40/120)
 *
 * **Faithful core (ERB ELSE branch 37-73 + 88-96):**
 *   - master DOWNBASE 体力 20/気力 50 (ERB 27-28, always)
 *   - target DOWNBASE 体力 +40 / 気力 +220 (ERB 39-40)
 *   - master SOURCE 快Ｖ 350, 快Ｂ 250 (ERB 41-42) — via
 *     `buildMasterSources`
 *   - target SOURCE 快Ｃ 400, 性行動 500, 屈従 1000, 逸脱 500,
 *     反感 500 (ERB 44-48)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 57-58)
 *   - EXP: master Ｖ性交経験 +1 (ERB 89), target 挿入経験 +1 (ERB 90)
 *
 * **DEFERRED (documented):**
 *   - STAIN swap (target's Ｐ ↔ master's 膣内, ERB 77-83) — STAIN not
 *     modeled.
 *   - The 調教者 処女 loss block is `[SKIPSTART]`/`[SKIPEND]`'d (ERB
 *     60-72) — deferred.
 *   - 不潔 = Y*10+60 (ERB 51) — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 32-36).
 *   - HETEROSEX 同性愛 EXP, ASSIPLAY, TCVAR action markers.
 *   - No 愛情経験 grant (no `!ASSIPLAY` block).
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

export const comf133Def: ComfDef = {
  commandNo: 133,
  label: "背面座位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  // ERB 27-28: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 50 },

  buildSources: (c): Record<number, number> => {
    // ERB 44-48, normal branch (target / dominant party).
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 57-58: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // ERB 41-42: master's own pleasure (B1b — receiving party).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｖ]: 350,
    [SOURCE_ID.快Ｂ]: 250,
  }),

  body: (c) => {
    // ERB 39-40: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 220;

    // EXP grants (ERB 89-90, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.Ｖ性交経験, 1); // ERB 89
    grant(c.t, EXP_ID.挿入経験, 1); //         ERB 90
    // No 愛情経験 grant.
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% — 背面座位される；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf133HandlerEntry: HandlerEntry = makeComfHandler(comf133Def);
