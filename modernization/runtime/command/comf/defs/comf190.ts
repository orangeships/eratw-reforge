/**
 * Phase 7 — `COMF190 エプロン` (apron), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM190`
 * (`ERB/コマンド関連/COMF/COMF190 エプロンを着ける.ERB`).
 *
 * **特殊 family sibling (190 エプロン).** Equip-toggle command — puts on
 * or removes an apron. The initial @COM190 (ERB 5-8) is a pure TEQUIP
 * toggle with NO SOURCE writes. All gameplay effects live in the
 * EQUIP_COM190 continuation: per-tick 情愛/恭順/逸脱 SOURCE + 愛情経験++.
 * Nearly identical to 189 新妻プレイ in settlement pattern.
 *
 * **DEFERRED (documented):**
 *   - Entire EQUIP_COM190 continuation (ERB 12-39) — per-tick SOURCE
 *     (情愛 1000, 恭順 5000, 逸脱 500 + 愛情経験 += RAND:2).
 *   - ASSIPLAY gate in continuation (ERB 16-19) — deferred.
 *   - TEQUIP:圍裙 toggle (ERB 7) — equip layer.
 *   - COMABLE gates (ERB 44-80) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE190 menu gate: present target, 恋慕, 圍裙 (ITEM:23) held/equipped
 *  (解除 arm), 従順 >= 3, not during 野外/羞恥/浴室PLAY, not time-stopped.
 *  ASSIPLAY / NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com190Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 上游 SIF !TALENT:恋慕 → RETURN 0 (无条件, 在解除 arm 之前).
  if ((target.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0) return block("需要对象处于恋慕状态。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:圍裙 → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.圍裙)) return { ok: true };
  if (!hasItem(ctx.state, 23)) return block("没有围裙。");
  if ((target.state.ABL[ABL_ID.従順] ?? 0) < 3) return block("需要顺从达到 3。");
  if (isEquipped(target, TEQUIP_ID.野外PLAY)) return block("野外PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.羞耻PLAY)) return block("羞耻PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.浴室PLAY)) return block("浴室PLAY中无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf190Def: ComfDef = {
  commandNo: 190,
  label: "エプロン",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice D: 需要道具 23 + toggle TEQUIP 槽.
  requiresItem: 23,
  toggleTequip: TEQUIP_ID.圍裙,

  hModeMenuCheck: com190Check,

  downbase: {},

  // Initial @COM190 has no SOURCE writes — all effects are in EQUIP_COM190 continuation.
  buildSources: (_c) => ({}),

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%系上了围裙 — エプロン；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf190HandlerEntry: HandlerEntry = makeComfHandler(comf190Def);
