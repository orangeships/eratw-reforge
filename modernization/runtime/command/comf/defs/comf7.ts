/**
 * Phase 7 — `COMF7 乳首責め` (nipple play — 快Ｂ focused), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM7`
 * (`ERB/コマンド関連/COMF/COMF7 乳首責め.ERB`, lines 24-50).
 *
 * **Faithful normal-mode core (ELSE branch):**
 *   - DOWNBASE: master 体力 5 / 気力 30 (ERB 24-25)
 *   - SOURCE target: 快Ｂ 80, 情愛 30, 苦痛 10, 露出 10, 不潔 10, 反感 10
 *     (ERB 28-33)
 *   - 器用な指 (master) → 快Ｂ += 15 (ERB 35-36)
 *   - ABL:受虐属性 > 2 (TARGET's ABL) → 快Ｂ += 受虐属性*5, 情愛 += 受虐属性*5
 *     (ERB 39-42)
 *   - 快Ｂ += ABL:PLAYER:指 * 12 (ERB 44)
 *   - 鬱屈 +10 if 自己愛<0 || 抵抗 (ERB 48-49)
 *   - body: 手淫経験 PLAYER++ (ERB 71)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 18-25) — TSP drain + reduced sources + STAIN.
 *   - STAIN 汚垢 handling (ERB 55-56) — entire subsystem deferred.
 *   - HETEROSEX 同性愛 EXP (ERB 61-70) — gender-pair helper deferred.
 *   - TCVAR markers (ERB 10-12) — H-scene action markers deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant (target-only SOURCE).
 * **No 舌使い/猫舌** — not present in this ERB.
 *
 * Key note: 受虐属性 is read from the TARGET, not the master.
 * Use `c.tAbl(ABL_ID.受虐属性)`.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf7Def: ComfDef = {
  commandNo: 7,
  label: "乳首責め",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 24-25: DOWNBASE:体力 += 5, DOWNBASE:気力 += 30.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 30 },

  buildSources: (c) => {
    // ERB 28-33: base SOURCE quanta.
    let kaiB = 80; // 快Ｂ
    let jouai = 30; // 情愛
    const kuutsu = 10; // 苦痛
    const roshutsu = 10; // 露出
    const fuketsu = 10; // 不潔
    const hankan = 10; // 反感

    // ERB 35-36: SIF TALENT:PLAYER:器用な指 → 快Ｂ += 15.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiB += 15;
    }

    // ERB 39-42: IF ABL:受虐属性 > 2 (TARGET's ABL) → bonus on 快Ｂ + 情愛.
    const jyugyaku = c.tAbl(ABL_ID.受虐属性);
    if (jyugyaku > 2) {
      kaiB += jyugyaku * 5;
      jouai += jyugyaku * 5;
    }

    // ERB 44: 快Ｂ += ABL:PLAYER:指 * 12.
    kaiB += c.mAbl(ABL_ID.指) * 12;

    // ERB 48-49: SIF TALENT:自己愛 < 0 || TALENT:抵抗 → 鬱屈 += 10.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 10 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.苦痛]: kuutsu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;

    return sources;
  },

  // No buildMasterSources — single-participant command.

  body: (c) => {
    // ERB 71: EXP:PLAYER:手淫経験 ++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    // ERB 55-56: STAIN swap — target Ｂ ⇔ master 手.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mh = getStain(c.master, STAIN_PART.手);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mh;
    c.master.state.STAIN[STAIN_PART.手] = mh | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%玩弄了%CALLNAME:TARGET%的乳头 — 乳首責め；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf7HandlerEntry: HandlerEntry = makeComfHandler(comf7Def);
