/**
 * Phase 7 (Wave 4a) — `COMF142 アナルフィスト` (anal fisting), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM142`
 * (`ERB/コマンド関連/COMF/COMF142 アナルフィスト.ERB`). The anal twin of 141:
 * same shape, keyed on `EXP:Ａ経験` + `PALAM:潤滑`, granting 快Ａ instead of 快Ｖ.
 *
 * **Faithful normal-mode core (ERB ELSE branch):**
 *   - DOWNBASE target 体力 300 / 気力 150.
 *   - SOURCE target: 快Ａ 200, 苦痛 1500, 露出 100, 屈従 1200, 逸脱 1200, 反感 1200.
 *   - 苦痛/反感 EXP:Ａ経験 ladder: <1→×3/×4, <4→×2.5/×3.5, <20→×2.4/×3,
 *     <50→×2/×2.5, <200→×1.8/×2, ≥200→×1.6/×1.5.
 *   - 苦痛/反感 PALAM:潤滑 ladder: <100→×3/×2, <500→×2.5/×1.5, <3000→×2/×1.2,
 *     <10000→×1.5/×1, ≥10000→×1/×1.
 *   - EXP:Ａ経験 +24; 異常経験 +1 once (first 拡張); EXP:Ａ拡張経験 +5.
 *
 * **DEFERRED:** time-stop branch; HETEROSEX EXP; STAIN; TCVAR markers
 * (射精部位=13 → wait, 142 sets it per anal); COMABLE gate; 異常経験 CFLAG
 * bit gate simplified.
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

/** Anal-fist EXP:Ａ経験 ladder: [painMul, hankanMul]. */
export function analFistExpLadder(exp: number): [number, number] {
  if (exp < expLv(1)) return [3.0, 4.0];
  if (exp < expLv(2)) return [2.5, 3.5];
  if (exp < expLv(3)) return [2.4, 3.0];
  if (exp < expLv(4)) return [2.0, 2.5];
  if (exp < expLv(5)) return [1.8, 2.0];
  return [1.6, 1.5];
}

/** PALAM:潤滑 ladder (same as 141): [painMul, hankanMul]. */
function fistLubeLadder(lube: number): [number, number] {
  if (lube < 100) return [3.0, 2.0];
  if (lube < 500) return [2.5, 1.5];
  if (lube < 3000) return [2.0, 1.2];
  if (lube < 10000) return [1.5, 1.0];
  return [1.0, 1.0];
}

export const comf142Def: ComfDef = {
  commandNo: 142,
  label: "アナルフィスト",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  buildSources: (c) => {
    const kaiA = 200;
    let kutsuu = 1500;
    const roshutsu = 100;
    const kujuu = 1200;
    const itsudev = 1200;
    let hankan = 1200;

    const [e1, e2] = analFistExpLadder(c.t.state.EXP[EXP_ID.Ａ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * e1);
    hankan = Math.trunc(hankan * e2);
    const [l1, l2] = fistLubeLadder(c.t.state.PALAM[PALAM_ID.潤滑] ?? 0);
    kutsuu = Math.trunc(kutsuu * l1);
    hankan = Math.trunc(hankan * l2);

    return {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kujuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 300;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;

    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 24;
    if (
      (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) === 0 &&
      (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) === 0
    ) {
      c.t.state.EXP[EXP_ID.異常経験] = (c.t.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
    }
    c.t.state.EXP[EXP_ID.Ａ拡張経験] = (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) + 5;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%进行了肛门拳交；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf142HandlerEntry: HandlerEntry = makeComfHandler(comf142Def);
