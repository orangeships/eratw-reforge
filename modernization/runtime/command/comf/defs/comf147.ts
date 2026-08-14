/**
 * Phase 7 (Wave 4a) — `COMF147 拡張バルーン` (expansion balloon), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM147`
 * (`ERB/コマンド関連/COMF/COMF147 拡張バルーン.ERB`). Anal-expansion SM with an
 * inverted experience curve: an experienced anus feels *less* pain (pain
 * multiplier shrinks with EXP:Ａ経験, unlike the fisting commands), plus the
 * usual 潤滑 damping.
 *
 * **Faithful normal-mode core (ERB ELSE branch):**
 *   - DOWNBASE target 体力 150 / 気力 200.
 *   - SOURCE target: 快Ａ 200, 苦痛 800, 露出 300, 屈従 400, 逸脱 700, 反感 700.
 *   - 鬱屈 +700 if 自己愛<0 || 抵抗.
 *   - 苦痛/反感 EXP:Ａ経験 ladder: <1→×3/×3, <4→×1.2/×2, <20→×0.8/×1.5,
 *     <50→×0.6/×1.2, <200→×0.4/×1, ≥200→×0.2/×1.
 *   - 苦痛/反感 PALAM:潤滑 ladder: <100→×1.2/×2, <500→×1/×1.5, <3000→×0.6/×1,
 *     <10000→×0.3/×1, ≥10000→×0.2/×1.
 *   - EXP:Ａ経験 +4; 異常経験 +1 once (first 拡張); EXP:Ａ拡張経験 +1.
 *
 * **DEFERRED:** time-stop branch; STAIN 汚れ処理; HETEROSEX EXP; COMABLE gate;
 * 異常経験 CFLAG bit gate simplified.
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

/** Balloon EXP:Ａ経験 ladder (inverted): [painMul, hankanMul]. */
function balloonExpLadder(exp: number): [number, number] {
  if (exp < expLv(1)) return [3.0, 3.0];
  if (exp < expLv(2)) return [1.2, 2.0];
  if (exp < expLv(3)) return [0.8, 1.5];
  if (exp < expLv(4)) return [0.6, 1.2];
  if (exp < expLv(5)) return [0.4, 1.0];
  return [0.2, 1.0];
}

/** Balloon PALAM:潤滑 ladder: [painMul, hankanMul]. */
function balloonLubeLadder(lube: number): [number, number] {
  if (lube < 100) return [1.2, 2.0];
  if (lube < 500) return [1.0, 1.5];
  if (lube < 3000) return [0.6, 1.0];
  if (lube < 10000) return [0.3, 1.0];
  return [0.2, 1.0];
}

export const comf147Def: ComfDef = {
  commandNo: 147,
  label: "拡張バルーン",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    const kaiA = 200;
    let kutsuu = 800;
    const roshutsu = 300;
    const kujuu = 400;
    const itsudev = 700;
    let hankan = 700;

    const [e1, e2] = balloonExpLadder(c.t.state.EXP[EXP_ID.Ａ経験] ?? 0);
    kutsuu = Math.trunc(kutsuu * e1);
    hankan = Math.trunc(hankan * e2);
    const [l1, l2] = balloonLubeLadder(c.t.state.PALAM[PALAM_ID.潤滑] ?? 0);
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
      sources[SOURCE_ID.鬱屈] = 700;
    }
    return sources;
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 150;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;

    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 4;
    if (
      (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) === 0 &&
      (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) === 0
    ) {
      c.t.state.EXP[EXP_ID.異常経験] = (c.t.state.EXP[EXP_ID.異常経験] ?? 0) + 1;
    }
    c.t.state.EXP[EXP_ID.Ａ拡張経験] = (c.t.state.EXP[EXP_ID.Ａ拡張経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了拡張バルーン；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf147HandlerEntry: HandlerEntry = makeComfHandler(comf147Def);
