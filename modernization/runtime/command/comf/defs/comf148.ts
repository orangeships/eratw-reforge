/**
 * Phase 7 (Wave 4a) — `COMF148 アナル電極` (anal electrode), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM148`
 * (`ERB/コマンド関連/COMF/COMF148 アナル電極.ERB`). High-magnitude anal SM with
 * the same 苦痛/反感 EXP:Ａ経験 + 潤滑 ladders as the anal fist (142).
 *
 * **Faithful normal-mode core (ERB 58-117, ELSE branch):**
 *   - DOWNBASE target 体力 300 / 気力 450.
 *   - SOURCE target: 快Ａ 500, 苦痛 1500, 露出 300, 屈従 800, 逸脱 1200, 反感 1200.
 *   - 鬱屈 +1200 if 自己愛<0 || 抵抗.
 *   - 苦痛/反感 EXP:Ａ経験 ladder: <1→×3/×4, <4→×2.5/×3.5, <20→×2.4/×3,
 *     <50→×2/×2.5, <200→×1.8/×2, ≥200→×1.6/×1.5.
 *   - 苦痛/反感 PALAM:潤滑 ladder: <100→×3/×2, <500→×2.5/×1.5, <3000→×2/×1.2,
 *     <10000→×1.5/×1, ≥10000→×1/×1.
 *   - EXP:Ａ経験 +4; 異常経験 +1 once (CFLAG bit 8 gate simplified).
 *
 * **DEFERRED:** TEQUIP:肛門電極 着脱 toggle (equipment subsystem); time-stop
 * branch; HETEROSEX EXP; STAIN; COMABLE gate; 異常経験 CFLAG bit-8 gate
 * simplified (granted once via 拡張経験 check).
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  expLv,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** Electrode EXP:Ａ経験 ladder (== anal-fist): [painMul, hankanMul]. */
function electrodeExpLadder(exp: number): [number, number] {
  if (exp < expLv(1)) return [3.0, 4.0];
  if (exp < expLv(2)) return [2.5, 3.5];
  if (exp < expLv(3)) return [2.4, 3.0];
  if (exp < expLv(4)) return [2.0, 2.5];
  if (exp < expLv(5)) return [1.8, 2.0];
  return [1.6, 1.5];
}

/** Electrode PALAM:潤滑 ladder (== anal-fist): [painMul, hankanMul]. */
function electrodeLubeLadder(lube: number): [number, number] {
  if (lube < 100) return [3.0, 2.0];
  if (lube < 500) return [2.5, 1.5];
  if (lube < 3000) return [2.0, 1.2];
  if (lube < 10000) return [1.5, 1.0];
  return [1.0, 1.0];
}

export const comf148Def: ComfDef = {
  commandNo: 148,
  label: "アナル電極",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    const kaiA = 500;
    let kutsuu = 1500;
    const roshutsu = 300;
    const kujuu = 800;
    const itsudev = 1200;
    let hankan = 1200;

    const [e1, e2] = electrodeExpLadder(c.t.state.EXP[EXP_ID.Ａ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * e1);
    hankan = Math.trunc(hankan * e2);
    const [l1, l2] = electrodeLubeLadder(c.t.state.PALAM[PALAM_ID.潤滑] ?? 0);
    kutsuu = Math.trunc(kutsuu * l1);
    hankan = Math.trunc(hankan * l2);

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: kaiA,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.屈従]: kujuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 1200;
    }
    return sources;
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 300;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 450;

    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 4;
    // ERB: 異常経験 +1 if !GETBIT(CFLAG:3,8). Simplified to first-expansion check.
    if (
      (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) === 0 &&
      (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) === 0
    ) {
      c.t.state.EXP[EXP_ID.異常経験] = (c.t.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
    }
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了肛门电极；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf148HandlerEntry: HandlerEntry = makeComfHandler(comf148Def);
