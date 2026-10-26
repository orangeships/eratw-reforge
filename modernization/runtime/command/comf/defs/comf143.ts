/**
 * Phase 7 (Wave 4b) — `COMF143 両穴フィスト` (double-hole fisting), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM143`
 * (`ERB/コマンド関連/COMF/COMF143 両穴フィスト.ERB`). Combines BOTH the vaginal
 * (141) and anal (142) pain curves: 苦痛/反感 pass through **four** ladders in
 * sequence — Ｖ経験, 潤滑, Ａ経験, 潤滑 again — so a fresh, dry target takes
 * catastrophic pain. Reuses the exact ladder functions from 141/142.
 *
 * **Faithful normal-mode core (ERB outer ELSE branch):**
 *   - DOWNBASE target 体力 500 / 気力 300.
 *   - SOURCE target: 快Ｖ 200, 快Ａ 200, 苦痛 1800, 露出 100, 屈従 2000,
 *     逸脱 2000, 反感 2000.
 *   - 苦痛/反感 ladders (applied in order, truncating each step):
 *       Ｖ経験 (141 fistExpLadder) → 潤滑 (fistLubeLadder) →
 *       Ａ経験 (142 analFistExpLadder) → 潤滑 (fistLubeLadder).
 *   - EXP:Ｖ経験 +24, EXP:Ａ経験 +24; 異常経験 +1 once (first 拡張);
 *     EXP:Ａ拡張経験 +5, EXP:Ｖ拡張経験 +5.
 *
 * **DEFERRED:** time-stop branch (TSP -500); HETEROSEX EXP; STAIN; TCVAR
 * markers (TCVAR:TARGET:2 = 12 or 13 by Ｖ/Ａ感覚; 強度 1800); COMABLE gate;
 * 異常経験 CFLAG bit-5 gate simplified.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { fistExpLadder, fistLubeLadder } from "./comf141.js";
import { analFistExpLadder } from "./comf142.js";

export const comf143Def: ComfDef = {
  commandNo: 143,
  label: "両穴フィスト",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  // 浴室PLAY 中需塑料地墊 (ITEM 20), 原版 ERB 286-288.
  bathMatRequired: true,

  buildSources: (c) => {
    const kaiV = 200;
    const kaiA = 200;
    let kutsuu = 1800;
    const roshutsu = 100;
    const kujuu = 2000;
    const itsudev = 2000;
    let hankan = 2000;

    const lube = c.t.state.PALAM[PALAM_ID.潤滑] ?? 0;
    // Ladder 1: Ｖ経験.
    let [p, h] = fistExpLadder(c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * p);
    hankan = Math.trunc(hankan * h);
    // Ladder 2: 潤滑.
    [p, h] = fistLubeLadder(lube);
    kutsuu = Math.trunc(kutsuu * p);
    hankan = Math.trunc(hankan * h);
    // Ladder 3: Ａ経験.
    [p, h] = analFistExpLadder(c.t.state.EXP[EXP_ID.Ａ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * p);
    hankan = Math.trunc(hankan * h);
    // Ladder 4: 潤滑 again.
    [p, h] = fistLubeLadder(lube);
    kutsuu = Math.trunc(kutsuu * p);
    hankan = Math.trunc(hankan * h);

    return {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kujuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 500;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 300;

    c.t.state.EXP[EXP_ID.Ｖ経験] = (c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 24;
    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 24;
    if (
      (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) === 0 &&
      (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) === 0
    ) {
      c.t.state.EXP[EXP_ID.異常経験] = (c.t.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
    }
    c.t.state.EXP[EXP_ID.Ａ拡張経験] = (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) + 5;
    c.t.state.EXP[EXP_ID.Ｖ拡張経験] = (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) + 5;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%进行了双穴拳交；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf143HandlerEntry: HandlerEntry = makeComfHandler(comf143Def);
