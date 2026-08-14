/**
 * Phase 7 (Wave 4c) — `COMF9 自慰` (commanded masturbation), as a `ComfDef`.
 *
 * Ports the **base (no-toy, no-video) core** of `@COM9`
 * (`ERB/コマンド関連/COMF/COMF9 自慰.ERB`). A 調教 self-pleasure command: the
 * target masturbates on command, producing 快Ｃ/快Ｂ + a heavy 露出/屈従/恐怖
 * humiliation bundle.
 *
 * **Faithful base core (ERB, no TEQUIP arms):**
 *   - DOWNBASE target 体力 5 / 気力 50.
 *   - SOURCE target: 快Ｃ 80, 快Ｂ 80, 性行動 100, 恐怖 200, 露出 400,
 *     屈従 500, 逸脱 300, 反感 250.
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗.
 *   - EXP:自慰経験 +1, EXP:調教自慰経験 +1 (base ELSE path; the +2 path is
 *     TEQUIP:视频拍摄-gated, deferred).
 *
 * **DEFERRED:** all TEQUIP-gated arms — 振動棒/肛用振動棒 (快Ｖ/快Ａ +80,
 * 屈従/反感 bumps, 快Ｃ/快Ｂ ×0.7), 视频拍摄 (露出/欲情/反感 bumps + 異常経験),
 * 淋浴 STAIN reset; STAIN 污垢移動; CALL COM_ORDER (self-pleasure target
 * selection); HETEROSEX EXP; COMABLE gate.
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
import { canExecuteComf9 } from "../can-com.js";

export const comf9Def: ComfDef = {
  commandNo: 9,
  label: "自慰",
  canExecute: canExecuteComf9,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 80,
      [SOURCE_ID.快Ｂ]: 80,
      [SOURCE_ID.性行動]: 100,
      [SOURCE_ID.恐怖]: 200,
      [SOURCE_ID.露出]: 400,
      [SOURCE_ID.屈従]: 500,
      [SOURCE_ID.逸脱]: 300,
      [SOURCE_ID.反感]: 250,
    };
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  body: (c) => {
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 5;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // Base ELSE path: 自慰経験 +1, 調教自慰経験 +1 (TEQUIP video +2 deferred).
    c.t.state.EXP[EXP_ID.自慰経験] = (c.t.state.EXP[EXP_ID.自慰経験] ?? 0) + 1;
    c.t.state.EXP[EXP_ID.調教自慰経験] =
      (c.t.state.EXP[EXP_ID.調教自慰経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%命令%CALLNAME:TARGET%自慰 — 自慰；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf9HandlerEntry: HandlerEntry = makeComfHandler(comf9Def);
