/**
 * Phase 7 — `COMF189 新妻プレイ` (newlywed play), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM189`
 * (`ERB/コマンド関連/COMF/COMF189 新妻プレイ.ERB`).
 *
 * **特殊 family sibling (189 新妻プレイ).** Equip-toggle command — starts
 * or ends newlywed roleplay. The initial @COM189 (ERB 5-8) is a pure
 * TEQUIP toggle with NO SOURCE writes. All gameplay effects live in the
 * EQUIP_COM189 continuation: per-tick 情愛/恭順/逸脱 SOURCE + 愛情経験++.
 * ASSIPLAY gate removes the equip on continuation.
 *
 * Because the initial application has no settlement, this def's
 * `buildSources` returns an empty map.
 *
 * **DEFERRED (documented):**
 *   - Entire EQUIP_COM189 continuation (ERB 12-41) — per-tick SOURCE
 *     (情愛 1000, 恭順 5000, 逸脱 500 + 愛情経験 += RAND:2).
 *   - ASSIPLAY gate in continuation (ERB 16-19) — deferred.
 *   - TEQUIP:新妻PLAY toggle (ERB 7) — equip layer.
 *   - COMABLE gates (ERB 45-87) — COMABLE layer.
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

/** @COM_ABLE189 menu gate: present target, 恋慕 when not currently 新妻PLAY,
 *  圍裙 (ITEM:23) held/equipped (解除 arm), 従順 >= 3, not during 野外/羞恥/
 *  浴室PLAY, not 睡眠恶作剧, not time-stopped. NEWWIFE≈新妻PLAY equipped;
 *  ASSIPLAY / NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com189Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  const equipped = isEquipped(target, TEQUIP_ID.新妻PLAY);
  // 上游 IF NEWWIFE == 0; SIF !TALENT:恋慕 → RETURN 0; ENDIF.
  if (!equipped && (target.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0) {
    return block("需要对象处于恋慕状态。");
  }
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:新妻PLAY → RETURN 1).
  if (equipped) return { ok: true };
  if (!hasItem(ctx.state, 23)) return block("没有围裙。");
  if ((target.state.ABL[ABL_ID.従順] ?? 0) < 3) return block("需要顺从达到 3。");
  if (isEquipped(target, TEQUIP_ID.野外PLAY)) return block("野外PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.羞耻PLAY)) return block("羞耻PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.浴室PLAY)) return block("浴室PLAY中无法使用。");
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) return block("睡眠侵犯中无法进行。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf189Def: ComfDef = {
  commandNo: 189,
  label: "新妻プレイ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice D: 需要道具 23 + toggle TEQUIP 槽.
  requiresItem: 23,
  toggleTequip: TEQUIP_ID.新妻PLAY,

  hModeMenuCheck: com189Check,

  downbase: {},

  // Initial @COM189 has no SOURCE writes — all effects are in EQUIP_COM189 continuation.
  buildSources: (_c) => ({}),

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 与%CALLNAME:TARGET%开始了新妻PLAY — 新妻プレイ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf189HandlerEntry: HandlerEntry = makeComfHandler(comf189Def);
