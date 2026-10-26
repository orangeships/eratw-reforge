/**
 * Phase 7 — `COMF707 乳首責め(慰)` (nipple torment self-pleasure), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM707`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF707 乳首責め(慰).ERB`).
 *
 * **Self-pleasure command — no target.** Master stimulates their own
 * nipples. 快Ｂ scaled by `器用な指` (+15), `ABL:受虐属性*5` (when >2),
 * and `ABL:指*12`. 情愛 also boosted by `ABL:受虐属性*5` when >2.
 *
 * **Faithful normal-mode core (ERB 14-51):**
 *   - DOWNBASE: master 体力 5 / 気力 30 (ERB 15-16)
 *   - SOURCE master: 快Ｂ 80, 情愛 30, 苦痛 10, 露出 10, 不潔 10, 反感 10 (ERB 18-23)
 *   - 器用な指: 快Ｂ += 15 (ERB 25-26)
 *   - ABL:受虐属性 > 2: 快Ｂ += 受虐属性 * 5, 情愛 += 受虐属性 * 5 (ERB 27-30)
 *   - 快Ｂ += ABL:指 * 12 (ERB 31)
 *   - 鬱屈 +10 if 自己愛<0 || 抵抗 (ERB 36-37)
 *   - Body: CFLAG[347]++, EXP[手淫経験]++ (ERB 49-50)
 *   - TIME += 5 (ERB 47-48)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker, deferred.
 *   - STAIN self-swap (ERB 42-43): STAIN:PLAYER:Ｂ ↔ STAIN:PLAYER:手 — wired (body).
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
import { STAIN_PART } from "../../../state/stain.js";

export const comf707Def: ComfDef = {
  commandNo: 707,
  label: "乳首責め(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 47-48: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — self-pleasure command.
  requiresTarget: false,
  settleSourcesOnMaster: true,

  // ERB 15-16: master 体力 5 / 気力 30.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 30 },

  buildSources: (c) => {
    // ERB 18: 快Ｂ = 80.
    let kaiB = 80;
    let jouai = 30;
    const kutsuu = 10;
    const roshutsu = 10;
    const fuketsu = 10;
    const hankan = 10;

    // ERB 25-26: 器用な指 → 快Ｂ += 15.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiB += 15;
    }

    // ERB 27-30: ABL:受虐属性 > 2 → 快Ｂ += 受虐属性 * 5, 情愛 += 受虐属性 * 5.
    const mJutaku = c.mAbl(ABL_ID.受虐属性);
    if (mJutaku > 2) {
      kaiB += mJutaku * 5;
      jouai += mJutaku * 5;
    }

    // ERB 31: 快Ｂ += ABL:指 * 12.
    kaiB += c.mAbl(ABL_ID.指) * 12;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 36-37: 鬱屈 +10 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 10;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 10;
    }

    return sources;
  },

  body: (c) => {
    // ERB 49: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 50: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    // ERB 42-43: 汚れ移動 — self-swap master Ｂ ⇔ master 手 (mutual OR).
    const mb = c.master.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    c.master.state.STAIN[STAIN_PART.Ｂ] = mb | m1;
    c.master.state.STAIN[STAIN_PART.手] = m1 | mb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 玩弄了自己的乳头 — 乳首責め(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf707HandlerEntry: HandlerEntry = makeComfHandler(comf707Def);
