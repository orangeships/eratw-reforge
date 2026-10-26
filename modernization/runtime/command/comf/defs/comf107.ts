/**
 * Phase 7 — `COMF107 拘束プレイ` (restraint play), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM107`
 * (`ERB/コマンド関連/COMF/COMF107 拘束プレイ.ERB`).
 *
 * **SM family sibling (107 拘束プレイ).** Equip-toggle SM command —
 * physically restrains the target. The ERB has extensive 强行 guard
 * dialogue (ERB 6-65) that is purely COMABLE-gate logic — we ship
 * the settlement core only. SOURCE is lighter than 縄 with 苦痛 60 +
 * 恐怖/屈従/反感 tail. No 露出 or 逸脱.
 *
 * **Faithful normal-mode core (ERB 84-104, after guards + toggle):**
 *   - DOWNBASE: target 体力 10 / 気力 80 (ERB 84-85)
 *   - SOURCE: 苦痛 60, 恐怖 180, 屈従 100, 反感 350 (ERB 87-90)
 *   - 緊縛経験 scales target DOWNBASE: ×1.0 → 0.9 → 0.7 (ERB 95-104)
 *   - 緊縛経験 (target) += 1 (ERB 108)
 *
 * **DEFERRED (documented):**
 *   - 强行 guard dialogue tree (ERB 6-65) — COMABLE layer, deferred.
 *   - EQUIP_COM107 continuation (ERB 118-149) — per-tick while equipped;
 *     includes 嗜虐快楽経験 PLAYER++ in continuation, deferred.
 *   - TCVAR:116 = PLAYER (ERB 79) — display-only.
 *   - TEQUIP:拘束 toggle (ERB 68-73) — equip layer, deferred.
 *   - HETEROSEX EXP writes (ERB 110-113) — commented out, not active.
 *   - COMABLE gates (ERB 154-178) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  times,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { kinbakuDrainMul } from "../source-brackets.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE107 menu gate: present target, not bound by 縄 / not 睡眠恶作剧 /
 *  not time-stopped, then 拘束 (ITEM:27) held or equipped. NOITEM/TFLAG:100/
 *  GLOBAL_COMABLE deferred. */
const com107Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 上游前置阻塞 (在解除 arm 之前): TEQUIP:縄 / CFLAG:恶作剧>1 / 时停.
  if (isEquipped(target, TEQUIP_ID.縄)) return block("绳索使用中无法进行。");
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) return block("睡眠侵犯中无法进行。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:拘束 → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.拘束)) return { ok: true };
  if (!hasItem(ctx.state, 27)) return block("没有拘束用具。");
  return { ok: true };
};

export const comf107Def: ComfDef = {
  commandNo: 107,
  label: "拘束プレイ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice C: 需要道具 27 + toggle TEQUIP 槽.
  requiresItem: 27,
  toggleTequip: TEQUIP_ID.拘束,

  hModeMenuCheck: com107Check,

  // ERB 84-85: target drain is shared with the resource preflight.
  downbase: {},
  targetDownbase: (c) => {
    const mul = kinbakuDrainMul(c.t.state.EXP[EXP_ID.緊縛経験] ?? 0);
    return {
      [BASE_ID.体力]: times(10, mul),
      [BASE_ID.気力]: times(80, mul),
    };
  },

  buildSources: (_c) => {
    // ERB 87-90: 苦痛 60, 恐怖 180, 屈従 100, 反感 350.
    // No 露出 or 逸脱 in this command.
    return {
      [SOURCE_ID.苦痛]: 60,
      [SOURCE_ID.恐怖]: 180,
      [SOURCE_ID.屈従]: 100,
      [SOURCE_ID.反感]: 350,
    };
  },

  body: (c) => {
    // ERB 108: 緊縛経験 (target) += 1.
    c.t.state.EXP[EXP_ID.緊縛経験] = (c.t.state.EXP[EXP_ID.緊縛経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 拘束了%CALLNAME:TARGET% — 拘束プレイ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf107HandlerEntry: HandlerEntry = makeComfHandler(comf107Def);
