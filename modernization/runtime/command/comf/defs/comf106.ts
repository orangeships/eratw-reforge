/**
 * Phase 7 — `COMF106 ボールギャグ` (ball gag), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM106`
 * (`ERB/コマンド関連/COMF/COMF106 ボールギャグ.ERB`).
 *
 * **SM family sibling (106 ボールギャグ).** Equip-toggle SM command —
 * applies a ball gag. SOURCE leans 恐怖/露出 with 屈従 tail.
 * 緊縛経験 scaling on DOWNBASE is deferred.
 *
 * **Faithful normal-mode core (ERB 20-49, ELSE branch):**
 *   - DOWNBASE: target 体力 0 / 気力 50 (ERB 22-23)
 *   - SOURCE: 恐怖 500, 露出 200, 屈従 150, 逸脱 100, 反感 300 (ERB 25-29)
 *   - 緊縛経験 scales target DOWNBASE: ×1.0 → 0.9 → 0.7 (ERB 35-44)
 *   - 緊縛経験 (target) += 2 (ERB 49)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 17-18) — TSP -50 only.
 *   - EQUIP_COM106 continuation (ERB 55-93) — per-tick while equipped.
 *   - TCVAR:116 = PLAYER (ERB 12) — display-only.
 *   - HETEROSEX EXP writes not present in this command.
 *   - COMABLE gates (ERB 98-116) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TEQUIP_ID,
  times,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { kinbakuDrainMul } from "../source-brackets.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE106 menu gate: present target + 口球 (ITEM:17) held/equipped,
 *  not during 新妻PLAY. NOITEM/TFLAG:100/GLOBAL_COMABLE deferred. */
const com106Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:口球 → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.口球)) return { ok: true };
  if (!hasItem(ctx.state, 17)) return block("没有口球。");
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) return block("新妻PLAY中无法使用。");
  return { ok: true };
};

export const comf106Def: ComfDef = {
  commandNo: 106,
  label: "ボールギャグ",

  // Equip-toggle core (COMF106.ERB:12 `TEQUIP:口球 = !TEQUIP:口球`). Requires
  // 口球 (ITEM:17, COMF106.ERB:111 `SIF ITEM:17 == 0 → RETURN 0`). Note
  // Item.csv:106 is actually 紙芝居; the ball-gag item is 17. The 新妻PLAY
  // (TEQUIP:33) conflict gate stays on the COMABLE layer (deferred).
  toggleTequip: TEQUIP_ID.口球,
  requiresItem: 17,

  hModeMenuCheck: com106Check,

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain lives in body (factory downbase is master-only).
  downbase: {},

  buildSources: (_c) => {
    // ERB 25-29: 恐怖 500, 露出 200, 屈従 150, 逸脱 100, 反感 300.
    return {
      [SOURCE_ID.恐怖]: 500,
      [SOURCE_ID.露出]: 200,
      [SOURCE_ID.屈従]: 150,
      [SOURCE_ID.逸脱]: 100,
      [SOURCE_ID.反感]: 300,
    };
  },

  body: (c) => {
    // ERB 22-23: target 気力 50 drain (体力 0), scaled by 緊縛経験 (ERB 35-44).
    const mul = kinbakuDrainMul(c.t.state.EXP[EXP_ID.緊縛経験] ?? 0);
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - times(50, mul);

    // ERB 49: 緊縛経験 (target) += 2.
    c.t.state.EXP[EXP_ID.緊縛経験] = (c.t.state.EXP[EXP_ID.緊縛経験] ?? 0) + 2;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%戴上了口球 — ボールギャグ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf106HandlerEntry: HandlerEntry = makeComfHandler(comf106Def);
