/**
 * Phase 7 (Wave 4a) — `COMF146 浣腸器＋プラグ` (enema + plug), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM146`
 * (`ERB/コマンド関連/COMF/COMF146 浣腸器＋プラグ.ERB`). Lower-magnitude anal SM:
 * moderate 苦痛/不潔 with the standard 鬱屈 penalty for 圧抑/抵抗 chars. No
 * EXP/PALAM pain ladder in the body (the ERB delegates anal pain to
 * `PAIN_CHECK_A` — deferred).
 *
 * **Faithful normal-mode core (ERB ELSE branch):**
 *   - DOWNBASE target 体力 60 / 気力 150.
 *   - SOURCE target: 快Ａ 300, 苦痛 500, 露出 300, 屈従 200, 不潔 500,
 *     逸脱 500, 反感 500.
 *   - 鬱屈 +500 if 自己愛<0 || 抵抗.
 *   - EXP:Ａ経験 +4.
 *
 * **DEFERRED:** time-stop branch; `PAIN_CHECK_A(TARGET)` (anal pain settle —
 * deferred subsystem); HETEROSEX EXP; COMABLE gate. STAIN 汚れ移動
 * (target 腸内 ⇔ target Ａ, ERB 53-54) now wired (body).
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
import { STAIN_PART } from "../../../state/stain.js";

export const comf146Def: ComfDef = {
  commandNo: 146,
  label: "浣腸器＋プラグ",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: 300,
      [SOURCE_ID.苦痛]: 500,
      [SOURCE_ID.露出]: 300,
      [SOURCE_ID.屈従]: 200,
      [SOURCE_ID.不潔]: 500,
      [SOURCE_ID.逸脱]: 500,
      [SOURCE_ID.反感]: 500,
    };
    // 鬱屈 +500 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 500;
    }
    return sources;
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 60;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;
    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 4;

    // ERB 53-54: 汚れ移動 — target 腸内 ⇔ target Ａ (self-swap, mutual OR).
    const tc = c.t.state.STAIN[STAIN_PART.腸内] ?? 0;
    const ta = c.t.state.STAIN[STAIN_PART.Ａ] ?? 0;
    c.t.state.STAIN[STAIN_PART.腸内] = tc | ta;
    c.t.state.STAIN[STAIN_PART.Ａ] = ta | tc;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了浣肠器和肛塞；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf146HandlerEntry: HandlerEntry = makeComfHandler(comf146Def);
