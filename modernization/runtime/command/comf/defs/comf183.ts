/**
 * Phase 7 — `COMF183 ビデオカメラ` (video camera), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM183`
 * (`ERB/コマンド関連/COMF/COMF183 ビデオカメラ.ERB`).
 *
 * **特殊 family sibling (183 ビデオカメラ).** Equip-toggle command —
 * starts or stops video recording. The initial application (turning ON)
 * has NO SOURCE settlement — it only toggles TEQUIP:视频拍摄, consumes
 * ITEM:43 (videotape), and sets TCVAR:116 marker. All SOURCE effects
 * live in the EQUIP_COM183 continuation (恐怖/逸脱/反感 + 受虐属性
 * scaling + 鬱屈 for 自己愛/抵抗), which runs every tick while recording.
 *
 * Because the initial @COM183 has no SOURCE or BASE writes, this def's
 * `buildSources` returns an empty map and `body` is a no-op. The
 * settlement is effectively a pass-through — the command's gameplay
 * impact is entirely in the continuation, which is deferred.
 *
 * **DEFERRED (documented):**
 *   - Entire EQUIP_COM183 continuation (ERB 61-152) — every-tick SOURCE
 *     (恐怖 1000, 逸脱 400, 反感 700 + 受虐属性 scaling on 露出/液体/欲情
 *     + 鬱屈 700 for 自己愛/抵抗 + 被写経験++).
 *   - INPUT photographer selection loop (ERB 8-28) — deferred.
 *   - ITEM:43 consumption / auto-replenish (ERB 30-35) — ITEM subsystem deferred.
 *   - TEQUIP:视频拍摄 toggle (ERB 40-50) — equip layer, deferred.
 *   - TCVAR:116 = PLAYER (ERB 55) — display-only.
 *   - TSTR video recording accumulation (ERB 138-141) — deferred.
 *   - 被写経験 EXP id not modeled.
 *   - 液体 SOURCE id not modeled.
 *   - COMABLE gates (ERB 157-176) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  CFLAG_ID,
  FLAG_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE183 menu gate: present target + 摄像机 (ITEM:18) & 录像带 (ITEM:43)
 *  both held, or 视频拍摄 (TEQUIP:28) already equipped (解除 arm), not
 *  time-stopped. NOITEM/TFLAG:100/GLOBAL_COMABLE deferred. */
const com183Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便停止录制 (上游 SIF TEQUIP:28 → RETURN 1).
  if (isEquipped(target, 28)) return { ok: true };
  if (!hasItem(ctx.state, 18) || !hasItem(ctx.state, 43)) return block("没有摄像机或录像带。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf183Def: ComfDef = {
  commandNo: 183,
  label: "ビデオカメラ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  hModeMenuCheck: com183Check,

  downbase: {},

  // Initial @COM183 has no SOURCE writes — all effects are in EQUIP_COM183 continuation.
  buildSources: (_c) => ({}),

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 架设了摄像机 — ビデオカメラ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf183HandlerEntry: HandlerEntry = makeComfHandler(comf183Def);
