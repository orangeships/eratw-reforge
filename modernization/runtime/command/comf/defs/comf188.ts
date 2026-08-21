/**
 * Phase 7 — `COMF188 シャワー` (shower), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM188`
 * (`ERB/コマンド関連/COMF/COMF188 シャワー.ERB`).
 *
 * **特殊 family sibling (188 シャワー).** Equip-toggle command — turns
 * shower on/off. The initial @COM188 (ERB 6-14) is a pure TEQUIP toggle
 * with NO SOURCE writes. All gameplay effects live in the EQUIP_COM188
 * continuation: per-tick 恭順/鬱屈/反感 SOURCE, plus IS_VAMPIRE and
 * 動物耳 conditional amplification, STAIN reset, and 潤滑 reduction.
 *
 * Because the initial application has no settlement, this def's
 * `buildSources` returns an empty map. The EQUIP_COM188 continuation
 * is entirely deferred.
 *
 * **DEFERRED (documented):**
 *   - Entire EQUIP_COM188 continuation (ERB 18-74) — per-tick SOURCE
 *     (恭順 100, 鬱屈 100, 反感 50 + IS_VAMPIRE amp: +恐怖200/+屈従200/
 *     +不潔500/+逸脱500/+反感500 + 動物耳 amp: +恐怖100/+屈従100/
 *     +逸脱500/+反感500) + STAIN reset + 潤滑 -1000.
 *   - IS_VAMPIRE function — not modeled in settlement.
 *   - 動物耳 TALENT id — not modeled in TALENT_ID.
 *   - STAIN subsystem — deferred.
 *   - PALAM:潤滑 write — PALAM write outside SOURCE→PALAM converter deferred.
 *   - TEQUIP:淋浴 toggle (ERB 7) — equip layer.
 *   - TCVAR:116 = PLAYER (ERB 12) — display-only.
 *   - COMABLE gates (ERB 79-119) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  CFLAG_ID,
  FLAG_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { isEquipped } from "../../../state/tequip.js";
import { hasPlace, PLACE_BATH } from "../../../world/place-flags.js";
import { placeFlagsOf } from "../../../world/location-predicates.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE188 menu gate: present target + 淋浴 (TEQUIP:32) toggle 解除 arm,
 *  not while 陰蒂夾/乳頭夾/搾乳機/乳房電極 equipped, not time-stopped.
 *  BATHROOM() / 泳池淋浴设施 / IS_VAMPIRE·動物耳従順 / NOITEM / TFLAG:100 /
 *  GLOBAL_COMABLE deferred. */
const com188Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便关闭 (上游 SIF TEQUIP:32 → RETURN 1).
  if (isEquipped(target, 32)) return { ok: true };
  if (!hasPlace(placeFlagsOf(ctx.state.master.location), PLACE_BATH)) {
    return block("只有浴室或温泉中才能使用淋浴。");
  }
  // 上游 TEQUIP:11/16/17/24 → RETURN 0.
  if (isEquipped(target, TEQUIP_ID.陰蒂夾)) return block("阴蒂夹使用中无法使用。");
  if (isEquipped(target, TEQUIP_ID.乳頭夾)) return block("乳头夹使用中无法使用。");
  if (isEquipped(target, TEQUIP_ID.搾乳機)) return block("搾乳机使用中无法使用。");
  if (isEquipped(target, 24)) return block("乳房电极使用中无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf188Def: ComfDef = {
  commandNo: 188,
  label: "シャワー",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  toggleTequip: 32,

  hModeMenuCheck: com188Check,

  downbase: {},

  // Initial @COM188 has no SOURCE writes — all effects are in EQUIP_COM188 continuation.
  buildSources: (_c) => ({}),

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%打开了淋浴 — シャワー；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf188HandlerEntry: HandlerEntry = makeComfHandler(comf188Def);
