/**
 * Phase 7 — `COMF11 乳首吸い(継続)` (suck nipple, equip-toggle) settlement, as a `ComfDef`.
 *
 * Ports `@COM11` (`ERB/コマンド関連/COMF/COMF11 乳首吸い.ERB`), the
 * normal-mode (ELSE) core. The toggle is `TEQUIP:吸乳头 = !TEQUIP:吸乳头`
 * (line 7) — modeling the toggle is the @EQUIP_COM11 follow-up block
 * (ERB 83-126), which fires every turn while the equip is set.
 *
 * **H foreplay family (root 0-26) sibling.**
 *
 * **Faithful normal-mode core (ERB 25-78, ELSE branch) — initial @COM11 fire:**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 26-27)
 *   - SOURCE target: 快Ｂ 20, 情愛 30, 露出 20, 不潔 30, 反感 100
 *     (ERB 29-33) — note 反感 100 (heavier than comf10's 30)
 *   - ABL:PLAYER:舌*20 → +快Ｂ (ERB 35)
 *   - ABL:PLAYER:舌*5 → +情愛 (ERB 36)
 *   - 親密 >= 7 → 情愛 += 親密*20 (ERB 38-39) — different threshold (>=7)
 *   - 舌使い ×1.50 on 快Ｂ (ERB 42-43)
 *   - 猫舌 ×0.75 on 快Ｂ (ERB 46-47)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 52-53)
 *   - EXP 口淫経験 PLAYER++ (ERB 78) — exp.als id 25
 *   - HETEROSEX EXP both += 5 (ERB 65-73) — deferred
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 21-24) — TSP drain + reduced sources.
 *   - @EQUIP_COM11 continuation block (ERB 83-126) — fires every turn
 *     while TEQUIP:吸乳头 is on. The factory runs settlement ONCE per
 *     command; the equip follow-up is a separate mid-scene handler
 *     not modeled here. 継続 = the toggle's persistence is the
 *     responsibility of the @EQUIP_COM11 layer (deferred).
 *   - STAIN (B⇔口) swap (ERB 59-60) — STAIN subsystem deferred.
 *   - TCVAR:116 / TCVAR:PLAYER:108 (ERB 13-15) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 64-73) — gender-pair helper deferred.
 *   - TEQUIP:吸乳头 = !TEQUIP:吸乳头 toggle (ERB 7) — equipment state
 *     machine not modeled; the def captures the initial-fire only.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, EXP_ID, SOURCE_ID, TALENT_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf11Def: ComfDef = {
  commandNo: 11,
  label: "乳首吸い(継続)",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  buildSources: (c) => {
    // ERB 29-33: base — note 反感 100 (heavier than comf10's 30).
    let kaiB = 20;
    let jouai = 30;
    const roshutsu = 20;
    const fuketsu = 30;
    const hankan = 100;

    // ERB 35-36: ABL:PLAYER:舌.
    const shita = c.mAbl(ABL_ID.舌);
    kaiB += shita * 20; // ERB 35: ×20 on 快Ｂ
    jouai += shita * 5; // ERB 36: ×5 on 情愛

    // ERB 38-39: 親密 >= 7 → 情愛 += 親密*20.
    const shinmitsu = c.tAbl(ABL_ID.親密);
    if (shinmitsu >= 7) jouai += shinmitsu * 20;

    // ERB 42-43: 舌使い ×1.50 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiB = Math.trunc(kaiB * 1.5);
    }
    // ERB 46-47: 猫舌 ×0.75 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiB = Math.trunc(kaiB * 0.75);
    }

    // ERB 52-53: 鬱屈 +100 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 100 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  body: (c) => {
    // ERB 78: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    // ERB 76-77: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
    // ERB 59-60: STAIN swap — target Ｂ ⇔ master 口.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mm = getStain(c.master, STAIN_PART.口);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mm;
    c.master.state.STAIN[STAIN_PART.口] = mm | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 开始吮吸%CALLNAME:TARGET%的乳头；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf11HandlerEntry: HandlerEntry = makeComfHandler(comf11Def);
