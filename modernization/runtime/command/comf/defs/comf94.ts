/**
 * Phase 7 — `COMF94 Ａ騎乗位する` (anal cowgirl on master),
 * as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM94`
 * (`ERB/コマンド関連/COMF/COMF94 Ａ騎乗位する.ERB`).
 *
 * **される系 / reverse positions (92-94).** Target rides the master
 * anal cowgirl — target is the active partner. Compared to 92/93,
 * the master drain is heavier (体力 60 / 気力 180 vs 50/150) and
 * master enjoyment is slightly higher (快Ａ 500 vs 400). Target
 * drain is lighter (体力 40 / 気力 120 vs 50/150). Target receives
 * `快Ｃ` + 情愛/性行動/征服/逸脱/反感.
 *
 * **Faithful normal-mode core (ERB 44-65, ELSE branch):**
 *   - DOWNBASE: target 体力 40 / 気力 120 (ERB 44-45)
 *   - DOWNBASE:PLAYER 体力 60 / 気力 180 (ERB 46-47) — master drain in body
 *   - master SOURCE: 快Ａ = 500 (ERB 48)
 *   - SOURCE target: 快Ｃ 400, 情愛 100, 性行動 400, 征服 1000,
 *     逸脱 500, 反感 500 (ERB 49-54)
 *   - 自己愛<0 || 抵抗 → 鬱屈 +500 (ERB 62-63)
 *   - EXP:PLAYER:Ａ性交経験 master++ (ERB 76-77)
 *   - EXP:挿入経験 target++ (ERB 78-79)
 *   - EXP愛情経験 target += 恋慕 if !ASSIPLAY (ERB 86-88)
 *
 * **DEFERRED (documented):**
 *   - 不潔 = Y*30+140 (ERB 56) — Y from STAIN; pinned 0.
 *   - STAIN:3 |= 4, STAIN:PLAYER:3 |= 4 (ERB 67-68) — STAIN not modeled.
 *   - HETEROSEX 同性愛 EXP writes — gender-pair helper.
 *   - Time-stop branch (ERB 37-43) — TSP drain, no target drain.
 *   - TCVAR:116/108, CSTR markers — H-scene chaining.
 *   - STR:0 text marker (ERB 19) — H-scene flags.
 *   - COM_ABLE94 — アナル开发性癖/ABL gates.
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
import { STAIN_PART, getStain } from "../../../state/stain.js";
import { computeAnalSexFuketsu } from "./comf92.js";

export const comf94Def: ComfDef = {
  commandNo: 94,
  label: "Ａ騎乗位する",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 44-47: target + master drain — both in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 49-54: fixed tail. 不潔 = Y*10+60 (ERB 59), Y from master Ａ+腸内.
    const fuketsu = computeAnalSexFuketsu(
      getStain(c.master, STAIN_PART.Ａ),
      getStain(c.master, STAIN_PART.腸内),
      c.tTalent(TALENT_ID.汚臭耐性),
    );
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.情愛]: 100,
      [SOURCE_ID.性行動]: 400,
      [SOURCE_ID.征服]: 1000,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
      [SOURCE_ID.不潔]: fuketsu,
    };
    // ERB 62-63: 鬱屈 +500 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE (ERB 48).
  buildMasterSources: () => ({
    [SOURCE_ID.快Ａ]: 500,
  }),

  body: (c) => {
    // ERB 44-45: target 体力 40 / 気力 120 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 40;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 120;

    // ERB 46-47: master 体力 60 / 気力 180 drain (DOWNBASE:PLAYER).
    c.master.state.BASE[BASE_ID.体力] =
      (c.master.state.BASE[BASE_ID.体力] ?? 0) - 60;
    c.master.state.BASE[BASE_ID.気力] =
      (c.master.state.BASE[BASE_ID.気力] ?? 0) - 180;

    // ERB 76-77: Ａ性交経験 master++.
    c.master.state.EXP[EXP_ID.Ａ性交経験] =
      (c.master.state.EXP[EXP_ID.Ａ性交経験] ?? 0) + 1;

    // ERB 78-79: 挿入経験 target++.
    c.t.state.EXP[EXP_ID.挿入経験] =
      (c.t.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;

    // ERB 86-88: 愛情経験 target += 恋慕 if !ASSIPLAY.
    if (
      c.tTalent(TALENT_ID.恋慕) &&
      !(c.ctx as { ASSIPLAY?: number }).ASSIPLAY
    ) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + c.tTalent(TALENT_ID.恋慕);
    }

    // ERB 71-74: STAIN swap — target Ｐ ⇔ master Ａ+腸内 (same as comf92).
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    const ma = getStain(c.master, STAIN_PART.Ａ);
    const mi = getStain(c.master, STAIN_PART.腸内);
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | ma | mi;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | tp;
    c.master.state.STAIN[STAIN_PART.腸内] = mi | tp;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 把%CALLNAME:MASTER%用肛门骑乘位主动对待 — Ａ騎乗位する；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf94HandlerEntry: HandlerEntry = makeComfHandler(comf94Def);
