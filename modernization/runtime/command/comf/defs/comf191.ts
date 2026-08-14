/**
 * Phase 7 — `COMF191 睡眠薬` (sleeping pill), as a `ComfDef`.
 *
 * Ports the **core** of `@COM191`
 * (`ERB/コマンド関連/COMF/COMF191 睡眠薬.ERB`).
 *
 * **特殊 family sibling (191 睡眠薬).** Drug-application command that
 * deepens the target's sleep. The ERB has no SOURCE writes — it is a pure
 * state-marker command: ITEM:252 -= 1, TCVAR:睡眠薬強度 = 3, TCVAR:睡眠深度
 * += 10000. No DOWNBASE, no EXP, no SOURCE. The settlement is a pass-through.
 *
 * **DEFERRED (documented):**
 *   - ITEM:252 -= 1 (ERB 6) — ITEM subsystem deferred.
 *   - TCVAR:睡眠薬強度 = 3 (ERB 7) — TCVAR markers deferred.
 *   - TCVAR:睡眠深度 += 10000 (ERB 8) — TCVAR markers deferred.
 *   - TCVAR:116 = PLAYER (ERB 13) — display-only.
 *   - COMABLE gates (ERB 25-47) — COMABLE layer (requires time-stop or
 *     恶作剧 + 禁断的知識 + 睡眠薬強度 gate).
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE191 menu gate: present target + 睡眠薬 (ITEM:252) held, target's
 *  睡眠薬強度 not maxed, time-stopped OR 睡眠恶作剧 active, master has 禁断的知識.
 *  NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com191Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 252)) return block("没有睡眠药。");
  // 上游 TCVAR:睡眠薬強度 > 2 → RETURN 0 (target slot).
  if ((target.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0) > 2) return block("睡眠药强度已满。");
  // 上游 FLAG:70 == 0 && !CFLAG:恶作剧 → RETURN 0: 需时停或睡眠恶作剧中.
  const timeStopped = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1;
  const pranking = (target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0;
  if (!timeStopped && !pranking) return block("需要在时停或睡眠恶作剧中。");
  // 上游 TALENT:MASTER:禁断的知識 == 0 → RETURN 0.
  if ((ctx.state.master.state.TALENT[TALENT_ID.禁断的知識] ?? 0) === 0) return block("需要禁断的知识。");
  return { ok: true };
};

export const comf191Def: ComfDef = {
  commandNo: 191,
  label: "睡眠薬",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice B: 消耗 睡眠薬 (ITEM 252).
  consumeItem: { id: 252 },

  hModeMenuCheck: com191Check,

  downbase: {},

  // ERB 191 has no SOURCE writes — pure state-marker command.
  buildSources: (_c) => ({}),

  body: (c) => {
    // ERB 7-8: 睡眠薬強度=3 + 睡眠深度 += 10000.
    c.t.state.TCVAR[TCVAR_ID.睡眠薬強度] = 3;
    c.t.state.TCVAR[TCVAR_ID.睡眠深度] = (c.t.state.TCVAR[TCVAR_ID.睡眠深度] ?? 0) + 10000;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%下了安眠药 — 睡眠薬；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf191HandlerEntry: HandlerEntry = makeComfHandler(comf191Def);
