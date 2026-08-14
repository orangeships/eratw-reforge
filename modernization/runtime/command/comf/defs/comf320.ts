/**
 * Phase 7 — `COMF320 正常位（相手主導）` (target-led missionary), as a
 * `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM320`
 * (`ERB/コマンド関連/COMF/COMF320 正常位（相手主導）.ERB`).
 *
 * **相手主導 family (320/322/323).** 320 is the target-led twin of 60 正常位
 * — same positions, but the SOURCE reflects the target's active role
 * (TCVAR:116 = PLAYER, but the target initiates). Same dual-SOURCE
 * shape: target gets 快Ｖ/情愛/苦痛/露出/反感; master gets 快Ｃ.
 *
 * 320 differs from 60 in:
 *   - master DOWNBASE 体力 30/気力 40 (vs 60's 40/40)
 *   - target DOWNBASE 体力 40/気力 50 (vs 60's 50/60)
 *   - target SOURCE: 情愛 300 (vs 60's 150), 露出 50 (same), 反感 absent
 *   - master SOURCE: 快Ｃ 400 (same as 60)
 *   - EXP: 愛情経験 += 恋慕*3 (vs 60's *2), +10 if 処女+恋慕
 *     (vs 60's +5)
 *   - 正常位補正 (ERB 47-50, 67-70): BEDROOM → TCVAR:PLAYER:4 + 愛情経験*5;
 *     BEDROOM && !ASSIPLAY → SOURCE:快Ｖ += 愛情経験 (cap 1000) — DEFERRED
 *     (room + BEDROOM flag not modeled)
 *
 * **Faithful target-side core (ERB 52-99):**
 *   - master DOWNBASE 体力 30/気力 40 (ERB 52-53, always)
 *   - target DOWNBASE 体力 +40 / 気力 +50 (ERB 57-58)
 *   - master SOURCE 快Ｃ 400 (ERB 55) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 400, 情愛 300, 苦痛 500, 露出 50 (ERB 60-63)
 *   - 露出 50→300 when standing (TFLAG:193, ERB 64-65) — outcomeMul
 *   - 不潔 = Y*10+60 (ERB 73) — Y computed in display
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*3 (+10 if 処女+恋慕) (ERB 85-99)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 75/81/88).
 *   - 正常位補正 (ERB 47-50, 67-70): BEDROOM/TEQUIP:50/ASSIPLAY → TCVAR
 *     + 愛情経験*5, SOURCE:快Ｖ += 愛情経験 (cap 1000) — room + BEDROOM
 *     not modeled.
 *   - 不潔 = Y*10+60 — Y computed in CAN_COM320's display (deferred).
 *   - 露出 50→300 standing-sex arm (TFLAG:193) — captured as outcomeMul.
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *   - TCVAR:20 != 41 entry gate (ERB 111) — handled at COM_ABLE level
 *     (not in def).
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

export const comf320Def: ComfDef = {
  commandNo: 320,
  label: "正常位（相手主導）",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 52-53: master's own BASE drain.
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 40 },

  buildSources: (): Record<number, number> => ({
    // ERB 60-63, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 400,
    [SOURCE_ID.情愛]: 300,
    [SOURCE_ID.苦痛]: 500,
    [SOURCE_ID.露出]: 50,
  }),

  // ERB 55: the master's own pleasure (B1b).
    buildMasterSources: (): Record<number, number> => ({
      [SOURCE_ID.快Ｃ]: 400,
    }),

    // Standing-sex arm: ERB 64-65 sets SOURCE:露出 = 300 when TFLAG:193 == 1.
    // TFLAG:193 is set at @COM320 ENTRY (ERB 11-12) by IS_STANDING_SEX(SELECTCOM)
    // — a deterministic flag from room furniture, NOT a command-internal RAND
    // great/normal/fail outcome. outcomeMul is the WRONG mechanism here:
    //   - factory only fires it when outcome !== 0 (make-comf-handler.ts:94-101)
    //   - 320 pins outcome=0 (maxRoll:100, greatThreshold:0, failThreshold:101)
    //     so outcomeMul NEVER fires
    //   - even if it did, scaling by RAND outcome is the wrong model for an
    //     entry-decided flag
    // DEFERRED. Requires a flagStore-aware buildSources hook in the factory
    // (analogous to IS_STANDING_SEX(SELECTCOM)) — Phase 7 schema work.

  body: (c) => {
    // ERB 57-58: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // EXP grants (ERB 85-99, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 85
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 86
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 93
    // ERB 94-99: 愛情経験 += 恋慕*3 (+10 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 3);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 10);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 正常位（相手主導）；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf320HandlerEntry: HandlerEntry = makeComfHandler(comf320Def);
