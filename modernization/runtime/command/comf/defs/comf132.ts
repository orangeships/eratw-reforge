/**
 * Phase 7 — `COMF132 対面座位される` (face-to-face seated, target on top),
 * as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM132`
 * (`ERB/コマンド関連/COMF/COMF132 対面座位される.ERB`).
 *
 * **される系 family (130-133).** 132 is the される twin of 67 — same
 * facing position, same dual-SOURCE mapping (target gets 快Ｃ +
 * 性行動 + 屈従 + 逸脱 + 反感; master gets 快Ｖ). Differs from 130 in:
 *   - master SOURCE 快Ｖ 350 (vs 130's 300)
 *   - target SOURCE 快Ｃ 250 (added on top of 400)
 *   - master DOWNBASE 体力 20/気力 50 (vs 130's 40/60)
 *   - target DOWNBASE 体力 40/気力 120 (vs 130's 80/120)
 *
 * **Faithful core (ERB ELSE branch 36-72 + 87-95):**
 *   - master DOWNBASE 体力 20/気力 50 (ERB 27-28, always)
 *   - target DOWNBASE 体力 +40 / 気力 +120 (ERB 38-39)
 *   - master SOURCE 快Ｖ 350 (ERB 40) — via `buildMasterSources`
 *   - target SOURCE 快Ｃ 250, 性行動 500, 屈従 1000, 逸脱 500,
 *     反感 500 (ERB 41-47) [ERB 43 has `SOURCE:快Ｃ = 400`, which
 *     OVERWRITES the 250 set on ERB 41 — so the final value is 400.]
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 56-57)
 *   - EXP: master Ｖ性交経験 +1 (ERB 88), target 挿入経験 +1 (ERB 89)
 *
 * **DEFERRED (documented):**
 *   - STAIN swap (target's Ｐ ↔ master's 膣内, ERB 76-82) — STAIN not
 *     modeled.
 *   - The 調教者 処女 loss block is `[SKIPSTART]`/`[SKIPEND]`'d (ERB
 *     59-71) — deferred.
 *   - 不潔 = Y*10+60 (ERB 50) — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 32-35).
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

export const comf132Def: ComfDef = {
  commandNo: 132,
  label: "対面座位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  // ERB 27-28: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 20, [BASE_ID.気力]: 50 },

  buildSources: (c): Record<number, number> => {
    // ERB 41-47, normal branch (target / dominant party).
    // Note: ERB 43 has `SOURCE:快Ｃ = 400` which OVERWRITES the 250 set
    // on ERB 41 — the final value is 400. This matches the upstream
    // Emuera behavior (last assignment wins).
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 56-57: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // ERB 40: master's own pleasure (B1b — receiving party).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｖ]: 350,
  }),

  body: (c) => {
    // ERB 38-39: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 120;

    // EXP grants (ERB 88-89, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.Ｖ性交経験, 1); // ERB 88
    grant(c.t, EXP_ID.挿入経験, 1); //         ERB 89
    // No 愛情経験 grant.
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET%主导了与%CALLNAME:MASTER%的对面座位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf132HandlerEntry: HandlerEntry = makeComfHandler(comf132Def);
