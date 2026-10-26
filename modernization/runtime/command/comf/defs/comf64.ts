/**
 * Phase 7 — `COMF64 逆レイプ` (reverse-rape / target-on-top penetrating
 * master), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM64`
 * (`ERB/コマンド関連/COMF/COMF64 逆レイプ.ERB`).
 *
 * **Positions family special case (体位系 60-71).** 64 is the **only**
 * command in 60-71 where the TARGET is the active party (the target
 * penetrates the master). The factory's `buildSources` /
 * `buildMasterSources` map to TARGET's SOURCE / MASTER's SOURCE, but
 * the active party swapped. This file pins the values as the ERB
 * literally writes them — TARGET's SOURCE quanta on `buildSources` and
 * MASTER's SOURCE quanta on `buildMasterSources` — so the SOURCE
 * settlement dispatches to the right slot.
 *
 * 64 differs from 60 in:
 *   - master DOWNBASE 体力 +50 / 気力 +80 (vs 60's 40/40) — ERB 27-28
 *   - target DOWNBASE 体力 +80 / 気力 +40 (vs 60's 50/60) — ERB 38-39
 *   - master SOURCE 快Ｖ 500 (target penetrates master's Ｖ) + 快Ｃ 400
 *     (master's own pleasure from the act) — ERB 40, 42
 *   - target SOURCE: 性行動 500, 屈従 1000, 逸脱 500, 反感 500
 *     (the dominant party) — ERB 43-46
 *   - 不潔 = Y*10+60 (ERB 49) — Y is computed in display
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 55-56)
 *   - EXP: master Ｖ性交経験 +1 (replaces target Ｖ経験), target
 *     挿入経験 +1 (replaces master 挿入経験), no Ｖ経験/Ｖ性交経験
 *     bonuses for the target; the target is the penetrator
 *   - No 愛情経験 grant (no !ASSIPLAY block; line 141 absent)
 *
 * **Faithful core (ERB ELSE branch 36-77 + 93-103):**
 *   - master DOWNBASE 体力/気力 +50/+80 (ERB 27-28, always)
 *   - target DOWNBASE 体力 +80 / 気力 +40 (ERB 38-39)
 *   - master SOURCE 快Ｖ 500 (ERB 40) — on `buildMasterSources` (the
 *     master is the receiving party here; the factory passes the
 *     master as `subject`)
 *   - master SOURCE 快Ｃ 400 (ERB 42) — also on `buildMasterSources`
 *   - target SOURCE 性行動 500, 屈従 1000, 逸脱 500, 反感 500 (ERB 43-46)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 55-56)
 *   - EXP: master Ｖ性交経験 +1 (ERB 95), target 挿入経験 +1 (ERB 96)
 *
 * **DEFERRED (documented):**
 *   - STAIN swap (target's Ｐ ↔ master's 膣内, ERB 81-87) — STAIN not
 *     modeled in `state`.
 *   - The 調教者 処女 loss block is `[SKIPSTART]`/`[SKIPEND]`'d in the
 *     upstream (ERB 57-76) — deferred (no settlement effect).
 *   - 不潔 = Y*10+60 — Y is computed in CAN_COM64's display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 32-35).
 *   - HETEROSEX 同性愛 EXP, ASSIPLAY, TCVAR action markers.
 *   - No 愛情経験 grant (no `!ASSIPLAY` block; ERB 141 absent).
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 *
 * **Note on SOURCE subject mapping**: unlike comf60 (master penetrates
 * target), in 64 the target penetrates the master. The factory's
 * `applySourceCheck(sources)` writes the SOURCE quanta to the
 * **target's** PALAM (the `t` slot), and `buildMasterSources` writes
 * to the **master's** PALAM. So:
 *   - `buildSources` carries the DOMINANT (target) party's
 *     性行動/屈従/逸脱/反感 — applied to the target's PALAM via
 *     `applySourceCheck` (this fires the 好感度 delta).
 *   - `buildMasterSources` carries the RECEIVING (master) party's
 *     快Ｖ/快Ｃ — applied to the master's PALAM via
 *     `settleSourcePalam`. This is what B1b was built for.
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

export const comf64Def: ComfDef = {
  commandNo: 64,
  label: "逆レイプ",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 27-28: master's own BASE drain (the receiving party).
  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    // ERB 43-46, normal branch (target / dominant party).
    const sources: Record<number, number> = {
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 55-56: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // ERB 40, 42: master's own pleasure (B1b — receiving party).
  // The target penetrates master → master gets 快Ｖ + 快Ｃ.
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｖ]: 500,
    [SOURCE_ID.快Ｃ]: 400,
  }),

  body: (c) => {
    // ERB 38-39: target (dominant party) shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 80;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 40;

    // EXP grants (ERB 94-96, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.Ｖ性交経験, 1); // ERB 95
    grant(c.t, EXP_ID.挿入経験, 1); //         ERB 96
    // Note: 64 has NO 愛情経験 grant (no `!ASSIPLAY` block; ERB 141 absent).
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET%主导了与%CALLNAME:MASTER%的交合；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf64HandlerEntry: HandlerEntry = makeComfHandler(comf64Def);
