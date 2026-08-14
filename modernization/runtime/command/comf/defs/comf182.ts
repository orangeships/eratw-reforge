/**
 * Phase 7 — `COMF182 利尿剤` (diuretic), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM182`
 * (`ERB/コマンド関連/COMF/COMF182 利尿剤.ERB`).
 *
 * **特殊 family sibling (182 利尿剤).** Drug-application command with
 * a 調合知識 → DOWNBASE split (similar to comf181 媚薬) and a small
 * 逸脱/反感 SOURCE. The TCVAR:利尿剤 = 60 marker (which gates the
 * 放尿 / 利尿 effects in downstream commands) is deferred — we ship
 * the SOURCE settlement only.
 *
 * **Faithful normal-mode core (ERB 14-46):**
 *   - if 調合知識: master DOWNBASE 体力 100 / 気力 100, else 200/200
 *     (ERB 19-25)
 *   - SOURCE:逸脱 = 800 (ERB 27)
 *   - SOURCE:反感 = 150 (ERB 29)
 *   - HETEROSEX 同性愛 EXP: 1 target / 1 master (ERB 40-44)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:利尿剤 = 60 (ERB 8) — drug effect marker, downstream
 *     放尿 / 利尿 effects NOT modeled (we don't gate the SOURCE→PALAM
 *     conversion on a TCVAR marker).
 *   - ITEM:42 -= 1 (ERB 6) — ITEM subsystem deferred.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 13) — display-only.
 *   - HETEROSEX EXP writes (ERB 35-45) — gender-pair helper deferred.
 *   - 調合知識 TALENT id (ERB 19-25) — gate only; not modeled, so we
 *     default to the 200/200 (no-調合知識) branch. See "downbase split"
 *     note below.
 *   - DRUG gate, 薬毒耐性 gate, ITEM:42 gate, TEQUIP:33 gate
 *     (ERB 55-73) — COMABLE layer / TALENT id 薬毒耐性 deferred.
 *
 * **downbase split note**: ERB splits DOWNBASE on
 * `TALENT:PLAYER:調合知識`. Without that id modeled, we ship the
 * higher-cost (no-調合知識) default of 200/200.
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
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE182 menu gate: present target + 利尿剤 (ITEM:42) held, target not
 *  薬毒耐性, not time-stopped, not during 新妻PLAY. NOITEM/TFLAG:100/
 *  GLOBAL_COMABLE deferred; DRUG (inject-mode) == 0 assumed. */
const com182Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 42)) return block("没有利尿剂。");
  if ((target.state.TALENT[TALENT_ID.薬毒耐性] ?? 0) !== 0) return block("对象有药毒耐性，无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) return block("新妻PLAY中无法使用。");
  return { ok: true };
};

export const comf182Def: ComfDef = {
  commandNo: 182,
  label: "利尿剤",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice B: 消耗 利尿剤 (ITEM 42).
  consumeItem: { id: 42 },

  hModeMenuCheck: com182Check,

  // ERB 19-25 (no-調合知識 branch default): master 体力 200 / 気力 200.
  downbase: {
    [BASE_ID.体力]: 200,
    [BASE_ID.気力]: 200,
  },

  buildSources: (_c) => {
    // ERB 27: SOURCE:逸脱 = 800.
    // ERB 29: SOURCE:反感 = 150.
    return {
      [SOURCE_ID.逸脱]: 800,
      [SOURCE_ID.反感]: 150,
    };
  },

  body: (c) => {
    // ERB 8: TCVAR:利尿剤 = 60 (1hr 效果 timer).
    c.t.state.TCVAR[TCVAR_ID.利尿剤] = 60;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%下了利尿剂 — 利尿剤；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf182HandlerEntry: HandlerEntry = makeComfHandler(comf182Def);