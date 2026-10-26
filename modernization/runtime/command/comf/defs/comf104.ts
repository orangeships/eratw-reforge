/**
 * Phase 7 — `COMF104 アイマスク` (blindfold), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM104`
 * (`ERB/コマンド関連/COMF/COMF104 アイマスク.ERB`).
 *
 * **SM family sibling (104 アイマスク).** Equip-toggle SM command —
 * applies a blindfold. Initial application: 恐怖/逸脱/反感 SOURCE
 * with a 露出 tail. The EQUIP_COM104 continuation (every-tick while
 * equipped) is deferred. 緊縛経験 scaling on 気力 cost is deferred
 * (EXP id not modeled — default to full cost).
 *
 * **Faithful normal-mode core (ERB 21-42, ELSE branch):**
 *   - DOWNBASE: target 体力 0 / 気力 80 (ERB 23-24)
 *   - SOURCE: 恐怖 700, 露出 100, 逸脱 300, 反感 600 (ERB 26-29)
 *   - 緊縛経験 scales target 気力 cost: ×1.0 → 0.9 → 0.7 (ERB 35-41)
 *   - 緊縛経験 (target) += 2 (ERB 51)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 18-19) — TSP drain only.
 *   - EQUIP_COM104 continuation (ERB 62-99) — per-tick while equipped.
 *   - TCVAR:116 = PLAYER (ERB 13) — display-only.
 *   - HETEROSEX EXP writes (ERB 47-57) — gender-pair helper deferred.
 *   - TEQUIP:眼罩 toggle, ITEM:15/NOITEM gate, TFLAG:100 gate,
 *     GLOBAL_COMABLE gate (ERB 104-119) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
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

/** @COM_ABLE104 menu gate: present target + 眼罩 (ITEM:15) held or equipped.
 *  NOITEM 道具無設定 / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com104Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:18 → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.眼罩)) return { ok: true };
  if (!hasItem(ctx.state, 15)) return block("没有眼罩。");
  return { ok: true };
};

export const comf104Def: ComfDef = {
  commandNo: 104,
  label: "アイマスク",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice C: 需要道具 15 (眼罩) + toggle TEQUIP 眼罩 (18).
  requiresItem: 15,
  toggleTequip: TEQUIP_ID.眼罩,

  hModeMenuCheck: com104Check,

  // ERB 23-24: target 気力 drain is shared with the resource preflight.
  downbase: {},
  targetDownbase: (c) => ({
    [BASE_ID.気力]: times(
      80,
      kinbakuDrainMul(c.t.state.EXP[EXP_ID.緊縛経験] ?? 0),
    ),
  }),

  buildSources: (_c) => {
    // ERB 26-29: 恐怖 700, 露出 100, 逸脱 300, 反感 600.
    return {
      [SOURCE_ID.恐怖]: 700,
      [SOURCE_ID.露出]: 100,
      [SOURCE_ID.逸脱]: 300,
      [SOURCE_ID.反感]: 600,
    };
  },

  body: (c) => {
    // ERB 51: 緊縛経験 (target) += 2.
    c.t.state.EXP[EXP_ID.緊縛経験] = (c.t.state.EXP[EXP_ID.緊縛経験] ?? 0) + 2;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%戴上了眼罩 — アイマスク；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf104HandlerEntry: HandlerEntry = makeComfHandler(comf104Def);
