/**
 * Small, state-backed CAN_COM implementation for the three H commands whose
 * upstream menu is visible before the final execution threshold is met.
 *
 * `@CAN_COM9/20/90` all use the same `COM_ORDER` score wall and then compare
 * against a command-specific value (33/15/18).  The full upstream score has
 * optional ASSI/TEQUIP/TCVAR arms that are not represented in GameState; the
 * live canonical namespaces below cover the ordinary shrine path and default
 * to zero when a save has no value.  Missing state therefore fails closed,
 * while high relationship/ability values can legitimately pass.
 */

import type { CommandContext, ExecCheck } from "../types.js";
import {
  ABL_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  palamLevel,
} from "../../state/settlement.js";
import { getStain, STAIN_PART } from "../../state/stain.js";

const block = (commandNo: number, threshold: number, score: number) => ({
  ok: false as const,
  reason: {
    kind: "com_able" as const,
    code: commandNo,
    message: `实行值不足（${score}/${threshold}）。`,
  },
});

function mark(slot: NonNullable<CommandContext["state"]["charas"][number]>, id: number): number {
  return slot.state.MARK[id] ?? 0;
}

/** The modelable portion of `CALL COM_ORDER` for the focused target. */
function comOrder(ctx: CommandContext): number {
  const target = ctx.state.charas[ctx.target];
  if (!target) return -Infinity;
  const t = target.state;
  const master = ctx.state.master.state;
  let score = 0;

  score += (t.ABL[ABL_ID.親密] ?? 0) * 1;
  score += (t.ABL[ABL_ID.従順] ?? 0) * 4;
  score += (t.ABL[ABL_ID.受虐属性] ?? 0) * 2;
  score += mark(target, MARK_ID.苦痛) * 5;
  const selfEsteem = t.TALENT[TALENT_ID.自尊心] ?? 0;
  const markMul = selfEsteem > 0 ? 4 : selfEsteem < 0 ? 1 : 2;
  score += mark(target, MARK_ID.不埒) * 3 * markMul;
  score -= mark(target, MARK_ID.反発刻印) * 2 * markMul;
  score += palamLevel(t.PALAM[PALAM_ID.恭順] ?? 0, 5) * 3;
  score += palamLevel(t.PALAM[PALAM_ID.恐怖] ?? 0, 5) * 3;

  score += (t.TALENT[TALENT_ID.服従] ?? 0) * 10;
  if ((t.TALENT[TALENT_ID.態度] ?? 0) > 0 && (t.TALENT[TALENT_ID.恋慕] ?? 0)) score -= 5;
  if ((t.TALENT[TALENT_ID.胆量] ?? 0) > 0) score -= 5;
  if ((t.TALENT[TALENT_ID.態度] ?? 0) < 0) score += 5;
  if (selfEsteem > 0) score -= 15;
  else if (selfEsteem < 0) score += 5;
  if ((t.TALENT[TALENT_ID.自己愛] ?? 0) < 0) score -= 10;
  if ((t.TALENT[TALENT_ID.抵抗] ?? 0) < 0) score -= 10;

  // The player-side sadism/attractiveness arms are part of COM_ORDER. Only
  // the canonical ability is represented in the modern state.
  score += (master.ABL[ABL_ID.施虐属性] ?? 0) * 2;
  return score;
}

function target(ctx: CommandContext) {
  return ctx.target > 0 ? ctx.state.charas[ctx.target] : undefined;
}

function canCom9(ctx: CommandContext): ReturnType<ExecCheck> {
  const slot = target(ctx);
  if (!slot) return block(9, 33, -Infinity);
  const t = slot.state;
  let score = comOrder(ctx);
  score += (t.ABL[ABL_ID.欲望] ?? 0) * 3;
  score += (t.ABL[ABL_ID.露出癖] ?? 0) * 4;
  score += (t.ABL[ABL_ID.自慰中毒] ?? 0) * 3;
  score += mark(slot, MARK_ID.快乐) * 3;
  if (t.TALENT[TALENT_ID.自制心]) score -= 5;
  if ((t.TALENT[TALENT_ID.羞恥心] ?? 0) > 0) score -= 5;
  if ((t.TALENT[TALENT_ID.羞恥心] ?? 0) < 0) score += 2;
  if (t.TALENT[TALENT_ID.自慰しやすい]) score += 5;
  if ((t.TALENT[TALENT_ID.快感応答] ?? 0) > 0) score += 5;
  if ((t.TALENT[TALENT_ID.快感応答] ?? 0) < 0 && !t.TALENT[TALENT_ID.淫乱]) score -= 5;
  const threshold = 33;
  return score >= threshold ? { ok: true } : block(9, threshold, score);
}

function canCom20(ctx: CommandContext): ReturnType<ExecCheck> {
  const slot = target(ctx);
  if (!slot) return block(20, 15, -Infinity);
  const t = slot.state;
  let score = comOrder(ctx);
  score += (t.ABL[ABL_ID.欲望] ?? 0) * 1;
  score += (t.ABL[ABL_ID.奉仕精神] ?? 0) * 4;
  score += mark(slot, MARK_ID.快乐) * 2;
  score += palamLevel(t.PALAM[PALAM_ID.欲情] ?? 0, 5);
  if ((t.TALENT[TALENT_ID.羞恥心] ?? 0) > 0) score -= 1;
  if ((t.TALENT[TALENT_ID.汚臭耐性] ?? 0) > 0) score += 1;
  if ((t.TALENT[TALENT_ID.汚臭耐性] ?? 0) < 0) score -= 1;
  if (t.TALENT[TALENT_ID.献身的]) score += 6;
  if ((t.TALENT[TALENT_ID.快感応答] ?? 0) < 0 && !t.TALENT[TALENT_ID.淫乱]) score -= 1;
  if (t.TALENT[TALENT_ID.恋慕]) score += 5;
  if ((t.TALENT[TALENT_ID.恋慕] ?? 0) > 1) score += 10;
  const soil = getStain(ctx.state.master, STAIN_PART.口);
  let y = 0;
  if (soil & 1) y += 1;
  if (soil & 4) y += 3;
  if (soil & 8) y += 7;
  if (soil & 16) y += 15;
  y = Math.trunc(y / 2);
  y = Math.trunc((y * (2 - (t.TALENT[TALENT_ID.汚臭耐性] ?? 0))) / 2);
  score -= y;
  const threshold = 15;
  return score >= threshold ? { ok: true } : block(20, threshold, score);
}

function canCom90(ctx: CommandContext): ReturnType<ExecCheck> {
  const slot = target(ctx);
  if (!slot) return block(90, 18, -Infinity);
  const t = slot.state;
  let score = comOrder(ctx);
  score += (t.ABL[ABL_ID.欲望] ?? 0) * 1;
  score += (t.ABL[ABL_ID.奉仕精神] ?? 0) * 4;
  score += (t.ABL[ABL_ID.施虐属性] ?? 0) * 4;
  score += mark(slot, MARK_ID.快乐);
  score += palamLevel(t.PALAM[PALAM_ID.欲情] ?? 0, 5);
  if ((t.TALENT[TALENT_ID.羞恥心] ?? 0) > 0) score -= 1;
  if ((t.TALENT[TALENT_ID.汚臭耐性] ?? 0) > 0) score += 1;
  if ((t.TALENT[TALENT_ID.汚臭耐性] ?? 0) < 0) score -= 3;
  if (t.TALENT[TALENT_ID.献身的]) score += 6;
  if ((t.TALENT[TALENT_ID.快感応答] ?? 0) < 0 && !t.TALENT[TALENT_ID.淫乱]) score -= 1;
  if (t.TALENT[TALENT_ID.恋慕]) score += 5;
  if ((t.TALENT[TALENT_ID.恋慕] ?? 0) > 1) score += 5;
  const soil = getStain(ctx.state.master, STAIN_PART.Ｐ);
  let y = 0;
  if (soil & 1) y += 1;
  if (soil & 4) y += 3;
  if (soil & 8) y += 7;
  if (soil & 16) y += 15;
  y = Math.trunc(y / 3);
  y = Math.trunc((y * (2 - (t.TALENT[TALENT_ID.汚臭耐性] ?? 0))) / 2);
  score -= y;
  const threshold = 18;
  return score >= threshold ? { ok: true } : block(90, threshold, score);
}

export const canExecuteComf9 = canCom9;
export const canExecuteComf20 = canCom20;
export const canExecuteComf90 = canCom90;
