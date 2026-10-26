/**
 * Phase 7 — `COMF15 クリ愛撫` (Clitoral Caress) settlement, as a `ComfDef`.
 *
 * Ports `@COM15` (`ERB/コマンド関連/COMF/COMF15 クリ愛撫.ERB`), the
 * normal-mode (ELSE) core.
 *
 * **H foreplay family (root 0-26) sibling.**
 *
 * **Faithful normal-mode core (ERB 59-110, ELSE branch):**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 60-61)
 *   - SOURCE target: 歓楽 100, 情愛 150, 欲情 150, 露出 100, 反感 370,
 *     快Ｃ 80 (ERB 63-68)
 *   - 受動 = 145 + 270 * ABL:従順 (reads TARGET's ABL) (ERB 69)
 *   - 性技補正 on 快Ｃ: ABL:PLAYER:指 >= 4 → +50, else +ABL*10
 *     (ERB 70-74)
 *   - 器用な指 (master) ×1.50 on 快Ｃ (ERB 107-108);
 *     液体 ×1.50 branch (ERB 109) deferred
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 91-92)
 *   - EXP 手淫経験 PLAYER++ (ERB 104)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 29-58) — TSP drain + reduced sources.
 *   - TEQUIP clothing/covering ×0.80/×0.90 reductions (ERB 75-85) —
 *     TEQUIP not modeled.
 *   - 液体 SOURCE ×1.50 (ERB 109) — liquid is not set in the normal
 *     branch; applying the multiplier to 0 has no effect. Defensively
 *     not applied.
 *   - STAIN (V⇔手) swap (ERB 114-116) — STAIN subsystem deferred.
 *   - TCVAR:116 / TCVAR:PLAYER:108 (ERB 18-20) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 53-55, 98-101) — gender-pair helper
 *     deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant foreplay.
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

export const comf15Def: ComfDef = {
  commandNo: 15,
  label: "クリ愛撫",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  targetDownbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 63-68: base SOURCE values.
    let kaiC = 80;            // 快Ｃ
    const kanraku = 100;      // 歓楽
    const jouai = 150;        // 情愛
    const yokujo = 150;       // 欲情
    const roshutsu = 100;     // 露出
    const hankan = 370;       // 反感 — very high 反感

    // ERB 69: 受動 = 145 + 270 * ABL:従順 (reads TARGET's ABL).
    const judo = 145 + 270 * c.tAbl(ABL_ID.従順);

    // ERB 70-74: 性技補正 on 快Ｃ.
    // ABL:PLAYER:指 >= 4 → +50, else +ABL*10.
    if (c.mAbl(ABL_ID.指) >= 4) {
      kaiC += 50;
    } else {
      kaiC += c.mAbl(ABL_ID.指) * 10;
    }

    // ERB 107-108: 器用な指 (master) ×1.50 on 快Ｃ.
    // ERB 109: 液体 ×1.50 — deferred (液体 is not set in normal branch,
    //   applying to 0 has no effect).
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiC = Math.trunc(kaiC * 1.5);
    }

    // ERB 91-92: 鬱屈 +20 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 20 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.欲情]: yokujo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: judo,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  body: (c) => {
    // ERB 104: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    // ERB 115-116: STAIN swap — target Ｖ ⇔ master 手.
    const tv = getStain(c.t, STAIN_PART.Ｖ);
    const mh = getStain(c.master, STAIN_PART.手);
    c.t.state.STAIN[STAIN_PART.Ｖ] = tv | mh;
    c.master.state.STAIN[STAIN_PART.手] = mh | tv;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 爱抚了%CALLNAME:TARGET%的阴蒂；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf15HandlerEntry: HandlerEntry = makeComfHandler(comf15Def);
