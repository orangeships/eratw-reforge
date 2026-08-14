/**
 * Phase 7 — `COMF130 正常位される` (missionary, target on top), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM130`
 * (`ERB/コマンド関連/COMF/COMF130 正常位される.ERB`).
 *
 * **される系 family (130-133).** 130 differs from COMF64 逆レイプ in that
 * the target is the one penetrating master, and the SOURCE reflects the
 * master's own state — but unlike 64, the master's SOURCE is on the
 * `buildSources` (TARGET slot) because the master's V-source is the
 * dominant settlement that drives 好感度; the master's own pleasure
 * (`SOURCE:PLAYER:快Ｃ`) is on `buildMasterSources`.
 *
 * **Wait** — re-reading 130 carefully: lines 41-46 set `SOURCE:PLAYER:快Ｖ
 * = 300`, `SOURCE:快Ｃ = 400`, `SOURCE:性行動 = 500`, `SOURCE:屈従 =
 * 1000`, `SOURCE:逸脱 = 500`, `SOURCE:反感 = 500`. The bare `SOURCE:快Ｃ`
 * (without `:PLAYER:`) writes to the **target's** SOURCE — so the
 * target gets 性行動/屈従/逸脱/反感/快Ｃ, and the master gets 快Ｖ.
 *
 * In factory terms:
 *   - `buildSources` carries the TARGET's quanta: 快Ｃ + 性行動 + 屈従 +
 *     逸脱 + 反感 (ERB 48-52)
 *   - `buildMasterSources` carries the MASTER's quanta: 快Ｖ (ERB 46)
 *     — the master is the receiving party.
 *
 * 130 differs from 64 逆レイプ in:
 *   - master DOWNBASE 体力 40/気力 60 (vs 64's 50/80)
 *   - target DOWNBASE 体力 80/気力 120 (vs 64's 80/40)
 *   - master SOURCE 快Ｖ 300 (vs 64's 500)
 *   - target SOURCE: 快Ｃ 400 (not in 64's target — 64's target had
 *     性行動/屈従/逸脱/反感 only)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 61-62)
 *   - EXP: master Ｖ性交経験 +1 (ERB 93), target 挿入経験 +1 (ERB 94)
 *   - No 愛情経験 grant (no `!ASSIPLAY` block; ERB 95+ has none)
 *
 * **Faithful core (ERB ELSE branch 42-77 + 92-99):**
 *   - master DOWNBASE 体力 40/気力 60 (ERB 33-34, always)
 *   - target DOWNBASE 体力 +80 / 気力 +120 (ERB 44-45)
 *   - master SOURCE 快Ｖ 300 (ERB 46) — via `buildMasterSources`
 *   - target SOURCE 快Ｃ 400, 性行動 500, 屈従 1000, 逸脱 500,
 *     反感 500 (ERB 48-52)
 *   - 自己愛<0 / 抵抗 → 鬱屈 +700 (ERB 61-62)
 *   - EXP: master Ｖ性交経験 +1 (ERB 93), target 挿入経験 +1 (ERB 94)
 *
 * **DEFERRED (documented):**
 *   - STAIN swap (target's Ｐ ↔ master's 膣内, ERB 81-87) — STAIN not
 *     modeled in `state`.
 *   - The 調教者 処女 loss block is `[SKIPSTART]`/`[SKIPEND]`'d in the
 *     upstream (ERB 63-76) — deferred (no settlement effect).
 *   - 不潔 = Y*10+60 (ERB 55) — Y computed in display (deferred).
 *   - Time-stop branch (FLAG:70) (ERB 38-41).
 *   - HETEROSEX 同性愛 EXP, ASSIPLAY, TCVAR action markers.
 *   - No 愛情経験 grant (no `!ASSIPLAY` block; ERB 95+ has none).
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

export const comf130Def: ComfDef = {
  commandNo: 130,
  label: "正常位される",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  // ERB 33-34: master's own BASE drain (the receiving party).
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 60 },

  buildSources: (c): Record<number, number> => {
    // ERB 48-52, normal branch (target / dominant party).
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.屈従]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // ERB 61-62: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  // ERB 46: master's own pleasure (B1b — receiving party).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｖ]: 300,
  }),

  body: (c) => {
    // ERB 44-45: target (dominant party) shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 80;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 120;

    // EXP grants (ERB 93-94, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.Ｖ性交経験, 1); // ERB 93
    grant(c.t, EXP_ID.挿入経験, 1); //         ERB 94
    // No 愛情経験 grant.
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% — 正常位される；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf130HandlerEntry: HandlerEntry = makeComfHandler(comf130Def);
