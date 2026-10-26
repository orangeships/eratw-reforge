/**
 * Phase 7 — `COMF700 愛撫(慰)` (target's self-pleasure caress), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM700`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF700 愛撫(慰).ERB`).
 *
 * **Self/auto family exemplar (自慰系 root 700-751).** 700 is the simplest
 * self-pleasure command: master only, master applies a couple of 快感
 * SOURCEs (C & B) modulated by `ABL:PLAYER:指` and the master's
 * `TALENT:PLAYER:器用な指` / `TALENT:PLAYER:舌使い`, plus a fixed
 * 情愛/性行動/露出/不潔/逸脱/反感 tail, plus a 鬱屈 penalty for
 * `自己愛<0`/`抵抗` masters (not targets!), plus 汚臭条件 scaling on
 * 不潔. There is no target SOURCE; the master acts on themselves.
 *
 * **No "target" exists** in this command — `hasTarget: false`. The
 * factory's "self" path runs (deferred in many places, but explicit here
 * per the spec).
 *
 * **Faithful normal-mode core (ERB 17-80):**
 *   - DOWNBASE: master 体力 5 / 気力 50 (ERB 17-18)
 *   - SOURCE master: 快Ｃ 80, 快Ｂ 80, 情愛 50, 性行動 60, 露出 20,
 *     不潔 30, 逸脱 20, 反感 20 (ERB 20-27)
 *   - 快Ｃ += ABL:PLAYER:指*5, 快Ｂ += ABL:PLAYER:指*5 (ERB 30-31)
 *   - 器用な指: 快Ｃ ×1.5, 快Ｂ ×1.5 (ERB 34-37)
 *   - 舌使い: 情愛 ×1.5 (ERB 39-40)
 *   - 鬱屈 +20 if 自己愛<0 || 抵抗 (ERB 45-46) — PLAYER scope.
 *   - 汚臭条件 (ERB 50-66): no 接吻 EXP → 不潔=0, 情愛/=4, 液体/=2;
 *     汚臭鈍感 /=4; 汚臭敏感 *=3; 自尊心 *=2.
 *   - EXP: 嗜虐快楽経験 (PLAYER, 猫舌, ERB 73-74), 手淫経験 PLAYER++ (76),
 *     自慰过了 PLAYER++ (78), TIME += 5 (non-time-stop, ERB 79-80).
 *
 * **DEFERRED (documented):**
 *   - 接吻 check (ERB 50) — the 接吻 条件 reads 既成事實 bit 0 and STAIN.
 *     The factory doesn't model STAIN; we apply the no-接吻 arm (不潔=0,
 *     情愛/=4) by default.
 *   - HETEROSEX EXP not in this file.
 *   - TCVAR:116 = PLAYER (ERB 11) — display marker, deferred.
 *   - The 接吻 EXP / STAIN swap on the 接吻 arm (ERB 50 onward) — STAIN
 *     subsystem deferred.
 *   - 液体 /= 2 (ERB 55) — 液体 SOURCE id not in our enum (would be
 *     `液体` = 22 in source.als but unmodeled).
 *   - 調教自慰経験 (a parallel EXP id) — not in this file's BODY writes,
 *     but `EXP:PLAYER:調教自慰経験` may be added by parent (family 13
 *     受け側 tracking) — deferred.
 *
 * **TIME += 5** (ERB 79-80). Modeled as `timeCost: 5`.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf700Def: ComfDef = {
  commandNo: 700,
  label: "愛撫(慰)",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 79-80: TIME += 5 when not in time-stop.
  timeCost: 5,

  // No target — this is a self-pleasure command. `hasTarget: false` lets the
  // factory skip target gates; the master acts alone.
  requiresTarget: false,
  settleSourcesOnMaster: true,

  // ERB 17-18: master 体力 5 / 気力 50.
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    // ERB 30-31: ABL:PLAYER:指 contributes to C/B 快感.
    let kaiC = 80 + c.mAbl(50 /*指*/) * 5;
    let kaiB = 80 + c.mAbl(50 /*指*/) * 5;
    // ERB 34-37: 器用な指 ×1.5 on C/B.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiC = Math.trunc(kaiC * 1.5);
      kaiB = Math.trunc(kaiB * 1.5);
    }
    // ERB 39-40: 情愛 50, ×1.5 if 舌使い.
    let jouai = 50;
    if (c.master.state.TALENT[TALENT_ID.舌使い]) jouai = Math.trunc(jouai * 1.5);

    const seiKodo = 60;
    const roshutsu = 20;
    let fuketsu = 30;
    const itsudev = 20;
    const hankan = 20;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };

    // ERB 45-46: 鬱屈 +20 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 20;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 20;
    }

    // ERB 50-66: 接吻条件 (no 接吻 path) — 不潔 = 0, 情愛 /= 4. (液体 /= 2
    // deferred.) Faithful under default (no kiss consent bit set):
    sources[SOURCE_ID.不潔] = 0;
    sources[SOURCE_ID.情愛] = Math.trunc(sources[SOURCE_ID.情愛]! / 4);

    return sources;
  },

  body: (c) => {
    // ERB 73-74: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
    // ERB 76: 手淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.手淫経験] =
      (c.master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    // ERB 78: 自慰过了 PLAYER++.
    c.master.state.CFLAG[CFLAG_ID.自慰过了] =
      (c.master.state.CFLAG[CFLAG_ID.自慰过了] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 自慰式爱抚自己 — 愛撫(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf700HandlerEntry: HandlerEntry = makeComfHandler(comf700Def);
