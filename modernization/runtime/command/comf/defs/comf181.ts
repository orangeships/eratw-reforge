/**
 * Phase 7 — `COMF181 媚薬` (aphrodisiac), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM181`
 * (`ERB/コマンド関連/COMF/COMF181 媚薬.ERB`).
 *
 * **特殊 family sibling (181 媚薬).** Drug-application command. The
 * ERB writes a per-target TCVAR marker (`TCVAR:媚薬 = 180`) that
 * downstream commands (e.g. 媚薬効果 で 欲情 UP×2 in source-check) read
 * off. We faithfully apply UP:欲情 = 2500 + SOURCE:逸脱 = 1000 in the
 * non-time-stop branch. The TCVAR marker write is deferred (TCVAR
 * time-keyed accumulator not modeled in our settlement scope).
 *
 * **Faithful normal-mode core (ERB 14-49, ELSE branch):**
 *   - if 調合知識: master DOWNBASE 体力 150 / 気力 150, else 300/300
 *     (ERB 22-29)
 *   - UP:欲情 = 2500 (ERB 32) — note the ERB comment says
 *     "実際には+5000" because the 媚薬効果 doubling in source-check
 *     multiplies it. UP:欲情 is the PALAM increment, equivalent to a
 *     SOURCE:欲情 of 2500. (We model it as a SOURCE quanta on
 *     SOURCE_ID.欲情; the B1a converter handles the PALAM gain.)
 *   - SOURCE:逸脱 = 1000 (ERB 33)
 *   - HETEROSEX 同性愛 EXP: 1 target / 1 master (ERB 44-48)
 *
 * **DEFERRED (documented):**
 *   - TCVAR:媚薬 = 180 (ERB 7) — drug effect marker, downstream
 *     source-check doubling effect NOT modeled (we don't gate the
 *     欲情 conversion on a TCVAR marker).
 *   - Time-stop branch (ERB 17-19) — UP:欲情 = 2500 only, no 逸脱.
 *   - ITEM:41 -= 1 (ERB 6) — ITEM subsystem deferred.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 12) — display-only.
 *   - HETEROSEX EXP writes (ERB 39-49) — gender-pair helper deferred.
 *   - 調合知識 TALENT id (ERB 22-29) — gate only (the downbase split);
 *     調合知識 id not modeled yet, so we default to the 300/300
 *     (non-調合知識) branch. See "downbase split" note below.
 *   - DRUG gate, 薬毒耐性 gate, ITEM:41 gate, TEQUIP:33 gate
 *     (ERB 60-74) — COMABLE layer / TALENT id 薬毒耐性 deferred.
 *
 * **downbase split note**: ERB splits DOWNBASE on
 * `TALENT:PLAYER:調合知識` (调合知识). Without that id modeled, we
 * ship the higher-cost (no-調合知識) default of 300/300 — the
 * cheaper 150/150 branch is only reachable with the talent.
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

/** @COM_ABLE181 menu gate: present target + 媚薬 (ITEM:41) held, target not
 *  薬毒耐性, not time-stopped. NOITEM/TFLAG:100/GLOBAL_COMABLE deferred;
 *  DRUG (inject-mode) == 0 assumed → the 薬毒耐性/时停 gates apply. */
const com181Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 41)) return block("没有媚药。");
  if ((target.state.TALENT[TALENT_ID.薬毒耐性] ?? 0) !== 0) return block("对象有药毒耐性，无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf181Def: ComfDef = {
  commandNo: 181,
  label: "媚薬",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice B: 消耗 媚薬 (ITEM 41) + 效果 timer marker.
  consumeItem: { id: 41 },

  hModeMenuCheck: com181Check,

  // ERB 22-29 (no-調合知識 branch default): master 体力 300 / 気力 300.
  downbase: {
    [BASE_ID.体力]: 300,
    [BASE_ID.気力]: 300,
  },

  buildSources: (_c) => {
    // ERB 32: UP:欲情 = 2500 (modeled as SOURCE:欲情 — B1a converter path).
    // ERB 33: SOURCE:逸脱 = 1000.
    return {
      [SOURCE_ID.欲情]: 2500,
      [SOURCE_ID.逸脱]: 1000,
    };
  },

  body: (c) => {
    // ERB 7: TCVAR:媚薬 = 180 (3hr 效果 timer; 由 decrementEffectTimers 递减).
    c.t.state.TCVAR[TCVAR_ID.媚薬] = 180;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%下了媚药 — 媚薬；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf181HandlerEntry: HandlerEntry = makeComfHandler(comf181Def);