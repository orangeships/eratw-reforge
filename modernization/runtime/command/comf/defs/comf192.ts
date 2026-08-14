/**
 * Phase 7 — `COMF192 排卵誘発剤` (ovulation inducer), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM192`
 * (`ERB/コマンド関連/COMF/COMF192 排卵誘発剤.ERB`).
 *
 * **特殊 family sibling (192 排卵誘発剤).** Drug-application command
 * with a 調合知識 → DOWNBASE split. Note the ERB SPLITS THE BRANCHES
 * THE OTHER WAY: with 調合知識 = 200/200, without = 100/100 (the
 * 調合知識 branch is HARDER on the master here). The TCVAR:強制排卵
 * = 180 marker (which gates downstream 排卵 effects) is deferred.
 * The CAN_COM192 ABL/MARK/PALAM/OTOKOGIRAI order-eval block
 * (ERB 56-202) drives no SOURCE writes and is purely the
 * 合意判定 / command-availability gate — COMABLE layer, deferred.
 *
 * **Faithful normal-mode core (ERB 14-50, ELSE branch):**
 *   - if 調合知識: master DOWNBASE 体力 200 / 気力 200, else 100/100
 *     (ERB 25-31) — NOTE: inverted vs comf181/182
 *   - SOURCE:逸脱 = 1000 (ERB 33)
 *   - HETEROSEX 同性愛 EXP: 1 target / 1 master (ERB 44-48)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:強制排卵 = 180 (ERB 11) — drug effect marker.
 *   - TCVAR:強制排卵 already-set "已吃过了" early RETURN -1
 *     (ERB 6-9) — state-machine guard, COMABLE layer.
 *   - ITEM:排卵誘発剤 -= 1 (ERB 10) — ITEM subsystem deferred.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 16) — display-only.
 *   - HETEROSEX EXP writes (ERB 39-49) — gender-pair helper deferred.
 *   - 調合知識 TALENT id (ERB 25-31) — gate only; not modeled, so we
 *     default to the LOWER-cost (no-調合知識) 100/100 branch. See
 *     "downbase split" note below.
 *   - CAN_COM192 order-evaluation block (ERB 56-202) — COMABLE layer.
 *   - DRUG gate, 薬毒耐性 gate, ITEM gate, SHIRAHU gate,
 *     允许无套 gate (ERB 211-229) — COMABLE layer / TALENT id 薬毒耐性
 *     deferred.
 *
 * **downbase split note**: ERB splits DOWNBASE on
 * `TALENT:PLAYER:調合知識`. Without that id modeled, we ship the
 * LOWER-cost (no-調合知識) 100/100 default. Note this is INVERTED
 * vs comf181/182 (where 調合知識 is the cheap branch); the
 * downstream call must respect this inversion when 調合知識 ships.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE192 menu gate: present target + 排卵誘発剤 (ITEM:91) held, target
 *  not 薬毒耐性, not time-stopped. DRUG (inject-mode) == 0 assumed;
 *  SHIRAHU / 允许无套 / NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com192Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 91)) return block("没有排卵诱发剂。");
  if ((target.state.TALENT[TALENT_ID.薬毒耐性] ?? 0) !== 0) return block("对象有药毒耐性，无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf192Def: ComfDef = {
  commandNo: 192,
  label: "排卵誘発剤",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice B: 消耗 排卵誘発剤 (ITEM 91).
  consumeItem: { id: 91 },

  hModeMenuCheck: com192Check,

  // ERB 25-31 (no-調合知識 branch default): master 体力 100 / 気力 100.
  // NOTE: INVERTED vs comf181/182 — the 調合知識 branch is the costlier
  // one here.
  downbase: {
    [BASE_ID.体力]: 100,
    [BASE_ID.気力]: 100,
  },

  buildSources: (_c) => {
    // ERB 33: SOURCE:逸脱 = 1000.
    return {
      [SOURCE_ID.逸脱]: 1000,
    };
  },

  body: (c) => {
    // ERB 11: TCVAR:強制排卵 = 180 (3hr 效果 timer).
    c.t.state.TCVAR[TCVAR_ID.強制排卵] = 180;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%下了排卵诱发剂 — 排卵誘発剤；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf192HandlerEntry: HandlerEntry = makeComfHandler(comf192Def);