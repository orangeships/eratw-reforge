/**
 * Phase 7 — `COMF105 縄` (rope / bondage), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM105`
 * (`ERB/コマンド関連/COMF/COMF105 縄.ERB`).
 *
 * **SM family sibling (105 縄).** Equip-toggle SM command — applies rope
 * bondage. Higher-magnitude than 104 アイマスク with 苦痛/屈従 added.
 * The 緊縛経験 scaling on DOWNBASE is deferred (EXP id not modeled —
 * default to full cost). The 强行 guard (ERB 7-12) is COMABLE layer.
 *
 * **Faithful normal-mode core (ERB 26-52, ELSE branch):**
 *   - DOWNBASE: target 体力 30 / 気力 120 (ERB 28-29)
 *   - SOURCE: 苦痛 300, 恐怖 900, 露出 200, 屈従 250, 逸脱 300, 反感 700
 *     (ERB 31-36)
 *   - 緊縛経験 scales target DOWNBASE: ×1.0 → 0.9 → 0.7 (ERB 42-51)
 *   - 緊縛経験 (target) += 5 (ERB 61)
 *
 * **DEFERRED (documented):**
 *   - 强行 guard (ERB 7-12) — COMABLE layer, deferred.
 *   - Time-stop branch (ERB 22-24) — TSP -120, 苦痛 150 only.
 *   - EQUIP_COM105 continuation (ERB 72-112) — per-tick while equipped.
 *   - TCVAR:116 = PLAYER (ERB 17) — display-only.
 *   - HETEROSEX EXP writes (ERB 57-67) — gender-pair helper deferred.
 *   - COMABLE gates (ERB 117-140) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  times,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { kinbakuDrainMul } from "../source-brackets.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE105 menu gate: present target + 縄 (ITEM:16) held/equipped +
 *  master 技巧 >= 1. 助手技巧/NOITEM/TFLAG:100/GLOBAL_COMABLE deferred. */
const com105Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:縄 → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.縄)) return { ok: true };
  if (!hasItem(ctx.state, 16)) return block("没有绳索。");
  // 上游 ABL:PLAYER:技巧 < 1 → RETURN 0.
  if ((ctx.state.master.state.ABL[ABL_ID.技巧] ?? 0) < 1) {
    return block("调教师的技巧不足 1。");
  }
  return { ok: true };
};

export const comf105Def: ComfDef = {
  commandNo: 105,
  label: "縄",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice C: 需要道具 16 + toggle TEQUIP 槽.
  requiresItem: 16,
  toggleTequip: TEQUIP_ID.縄,

  hModeMenuCheck: com105Check,

  // Target drain lives in body (factory downbase is master-only).
  downbase: {},

  buildSources: (_c) => {
    // ERB 31-36: 苦痛 300, 恐怖 900, 露出 200, 屈従 250, 逸脱 300, 反感 700.
    return {
      [SOURCE_ID.苦痛]: 300,
      [SOURCE_ID.恐怖]: 900,
      [SOURCE_ID.露出]: 200,
      [SOURCE_ID.屈従]: 250,
      [SOURCE_ID.逸脱]: 300,
      [SOURCE_ID.反感]: 700,
    };
  },

  body: (c) => {
    // ERB 28-29: target 体力 30 / 気力 120 drain, scaled by the target's
    // 緊縛経験 (ERB 42-51). TIMES truncates per-step (Emuera semantics).
    const mul = kinbakuDrainMul(c.t.state.EXP[EXP_ID.緊縛経験] ?? 0);
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - times(30, mul);
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - times(120, mul);

    // ERB 61: 緊縛経験 (target) += 5.
    c.t.state.EXP[EXP_ID.緊縛経験] = (c.t.state.EXP[EXP_ID.緊縛経験] ?? 0) + 5;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 用绳子捆住了%CALLNAME:TARGET% — 縄；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf105HandlerEntry: HandlerEntry = makeComfHandler(comf105Def);
