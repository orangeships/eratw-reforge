/**
 * Phase 7 (Wave 4a) — `COMF141 フィストファック` (vaginal fisting), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM141`
 * (`ERB/コマンド関連/COMF/COMF141 フィストファック.ERB`). SM family (level 4):
 * extreme 苦痛 driven by two multiplicative ladders — `EXP:Ｖ経験`
 * (inexperience → more pain) and `PALAM:潤滑` (less lubrication → more pain) —
 * with proportional 反感 scaling on the experience ladder.
 *
 * **Faithful normal-mode core (ERB 56-135, ELSE branch):**
 *   - DOWNBASE target 体力 300 / 気力 150 (ERB 58-59).
 *   - SOURCE target: 快Ｖ 200, 苦痛 1500, 露出 100, 屈従 1200, 逸脱 1200,
 *     反感 1200 (ERB 61-67).
 *   - 苦痛/反感 EXP:Ｖ経験 ladder (ERB 73-92): <1→×2.5/×4, <4→×2/×3.5,
 *     <20→×1.8/×3, <50→×1.6/×2.5, <200→×1.4/×2, ≥200→×1.2/×2.
 *   - 苦痛/反感 PALAM:潤滑 ladder (ERB 95-110): <100→×3/×2, <500→×2.5/×1.5,
 *     <3000→×2/×1.2, <10000→×1.5/×1, ≥10000→×1/×1.
 *   - EXP:Ｖ経験 +24 (ERB 116); 異常経験 +1 once if no Ｖ/Ａ拡張経験 (ERB 119);
 *     EXP:Ｖ拡張経験 +5 (ERB 124).
 *
 * **DEFERRED:** time-stop branch (ERB 24-55, TSP -300); HETEROSEX 同性愛 EXP
 * (ERB 126-135); STAIN; TCVAR:116/TCVAR:TARGET:2(=13 射精部位)/TCVAR:TARGET:4
 * (強度 1600) display markers; CSTR 行為者 log; the @COM_ABLE141 gate
 * (TFLAG:100, 男人 talent, Ｖ経験≥150, 体型, BEDROOM, TEQUIP) — COMABLE layer.
 * 異常経験/CFLAG bit-4 first-time gate simplified (granted once via flag check).
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
  expLv,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** EXP-experience ladder for vaginal/anal fisting: [painMul, hankanMul]. */
export function fistExpLadder(exp: number): [number, number] {
  if (exp < expLv(1)) return [2.5, 4.0];
  if (exp < expLv(2)) return [2.0, 3.5];
  if (exp < expLv(3)) return [1.8, 3.0];
  if (exp < expLv(4)) return [1.6, 2.5];
  if (exp < expLv(5)) return [1.4, 2.0];
  return [1.2, 2.0];
}

/** PALAM:潤滑 ladder for fisting: [painMul, hankanMul]. */
export function fistLubeLadder(lube: number): [number, number] {
  // PALAMLV cap 5; thresholds 100/500/3000/10000.
  if (lube < 100) return [3.0, 2.0];
  if (lube < 500) return [2.5, 1.5];
  if (lube < 3000) return [2.0, 1.2];
  if (lube < 10000) return [1.5, 1.0];
  return [1.0, 1.0];
}

export const comf141Def: ComfDef = {
  commandNo: 141,
  label: "フィストファック",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  buildSources: (c) => {
    const kaiV = 200;
    let kutsuu = 1500;
    const roshutsu = 100;
    const kujuu = 1200;
    const itsudev = 1200;
    let hankan = 1200;

    // ERB 73-110: EXP:Ｖ経験 + PALAM:潤滑 ladders (multiplicative, truncating).
    const [e1, e2] = fistExpLadder(c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * e1);
    hankan = Math.trunc(hankan * e2);
    const [l1, l2] = fistLubeLadder(c.t.state.PALAM[PALAM_ID.潤滑] ?? 0);
    kutsuu = Math.trunc(kutsuu * l1);
    hankan = Math.trunc(hankan * l2);

    return {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kujuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
  },

  body: (c) => {
    // ERB 58-59: target 体力 300 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 300;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    // ERB 116: Ｖ経験 +24.
    c.t.state.EXP[EXP_ID.Ｖ経験] = (c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 24;
    // ERB 119-122: 異常経験 +1 once (first 拡張). Simplified: grant when neither
    // Ｖ/Ａ拡張経験 yet recorded (CFLAG bit gate deferred).
    if (
      (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) === 0 &&
      (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) === 0
    ) {
      c.t.state.EXP[EXP_ID.異常経験] = (c.t.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
    }
    // ERB 124: Ｖ拡張経験 +5.
    c.t.state.EXP[EXP_ID.Ｖ拡張経験] = (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) + 5;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% フィストファック %CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf141HandlerEntry: HandlerEntry = makeComfHandler(comf141Def);
