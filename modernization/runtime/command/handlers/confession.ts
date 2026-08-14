/**
 * Phase 7 (Slice 5) — `COMF352 告白する` (confession / lover acquisition).
 *
 * MVP faithful port of `@COM352` (`ERB/コマンド関連/COMF/COMF352 告白する.ERB`),
 * WITHOUT the 告白女神 subsystem (SAVEDATA 全局变量 / INPUT loop / nested RAND
 * are not modeled — the 268-line goddess branch is deferred). The ordinary
 * success / failure path is ported:
 *
 * **execCheck (gates, `@COM_ABLE352`)**:
 *   - `FLAG:甲斐性無` ≠ 0 → block
 *   - `TFLAG:妄想中` == 1 → block
 *   - more than one present NPC (`presentNpcs` standing in for `GET_TARGETNUM`)
 *     → block (告白 is a private moment)
 *   - `TCVAR:MASTER:亲热 < 2` → block (`computeShinchitsu` — do NOT read the
 *     stored TCVAR, it's never refreshed; see compile-gate.ts precedent)
 *   - master already has a lover (`TALENT:MASTER:恋人 != 0`) → block
 *   - `!CAN_MAKE_恋人()` → block (lover-slot limit, see `canMakeLover`)
 *   - `TALENT:TARGET:路人` → block
 *   - `CFLAG:睡眠` / `CFLAG:陪睡中` → block
 *   - master 気力 <= 0 → block
 *
 * **prompt**: `ASK_YN("要向%CALLNAME:TARGET%告白吗？", "告白", "放弃")`.
 *
 * **handler**:
 *   - 放弃 → small NARRATION + noop (no state change).
 *   - 告白 success gate: `computeConsentJudgement(target) > 350 +
 *     TALENT:一線越えない * 100`.
 *     - Success: `CFLAG:既成事實 |= bit2(4)` on both; `TALENT:MASTER:恋人 =
 *       targetNum`; `TALENT:TARGET:恋人 = 1`; clear `TALENT:炮友` on both.
 *     - Failure: target 好感度 drops a little + NARRATION.
 *
 * The master stores the lover's chara num; the NPC stores boolean 1 (the
 * 2026-08-04 lover-normalization contract).
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
} from "../../state/settlement.js";
import { getTflag, TFLAG_ID } from "../../state/tflag.js";
import { presentNpcs } from "../../scene/presence.js";
import { computeConsentJudgement, computeShinchitsu } from "../../state/attitude.js";
import { askYn, requireYesNo } from "../prompt.js";

/** `CFLAG:既成事實` bit 2 = 恋人 (kojo-symbols 合意_恋人: 4). */
const LOVER_BIT = 1 << 2;

/** CAN_MAKE_恋人 (DATE_CMN.ERB:294-302): 恋人 slot limit vs current count. */
export function canMakeLover(state: CommandContext["state"]): boolean {
  // 左拥右抱 (polyamory talent on MASTER) bypasses the limit.
  if ((state.master.state.TALENT[TALENT_ID.左拥右抱] ?? 0) !== 0) return true;
  const extra = state.flagStore[FLAG_ID.追加恋人枠] ?? 0;
  const limit = 1 + extra;
  let count = 0;
  for (const slot of Object.values(state.charas)) {
    if ((slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) count++;
  }
  return count < limit;
}

function check352(
  state: CommandContext["state"],
  targetNum: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const block = (message: string) => ({ ok: false as const, reason: { kind: "precondition" as const, message } });
  // FLAG:甲斐性無 (COM_ABLE352 line 428).
  if ((state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0) {
    return block("现在没有告白的勇气。");
  }
  // TFLAG:妄想中 (daydreaming — 352 line 429).
  if (getTflag(state, TFLAG_ID.妄想中) === 1) {
    return block("正处于妄想中，无法告白。");
  }
  // GET_TARGETNUM() > 1 — 独处 required (352 line 431-436).
  if (presentNpcs(state, state.master.location).length > 1) {
    return block("有其他人在场，不适合告白。");
  }
  const targetSlot = state.charas[targetNum];
  if (!targetSlot) {
    return block("目标角色不存在。");
  }
  // TCVAR:MASTER:亲热 < 2 — derived from the focused target (the per-turn
  // INFO pass that refreshes stored TCVAR:130 is unmodeled; computeShinchitsu
  // on the target collapses master 亲热 to it, like compile-gate.ts).
  if (computeShinchitsu(targetSlot, state.master, state) < 2) {
    return block("亲热程度还不够。");
  }
  // TALENT:MASTER:恋人 already set → already have a lover.
  if ((state.master.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) {
    return block("已经有过恋人了。");
  }
  // CAN_MAKE_恋人 — lover-slot limit.
  if (!canMakeLover(state)) {
    return block("恋人名额已满。");
  }
  // TALENT:TARGET:路人 (352 line 443).
  if ((targetSlot.state.TALENT[TALENT_ID.路人] ?? 0) !== 0) {
    return block("对方是路人，无法告白。");
  }
  // CFLAG:睡眠 / 陪睡中 (352 line 444-445).
  if ((targetSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return block("对方睡着了。");
  }
  if ((targetSlot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return block("对方正在陪睡。");
  }
  // BASE:MASTER:気力 <= 0 (352 line 446).
  if ((state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
    return block("気力不足，无法告白。");
  }
  return { ok: true };
}

export const confession352HandlerEntry: HandlerEntry = {
  commandNo: 352,
  execCheck: (ctx) => check352(ctx.state, ctx.target),
  prompt: (ctx) => {
    const name = ctx.state.charas[ctx.target]?.callName ?? "对方";
    return askYn(`要向${name}告白吗？`, "告白", "放弃");
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target];
    if (!target) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有可告白的对象。" }],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: "no target" },
      };
    }
    const answer = requireYesNo(ctx.promptAnswer);
    if (answer === null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "（需要选择是否告白。）" }],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: "告白 requires an ASK_YN answer" },
      };
    }
    if (answer === false) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "（放弃了告白。）" }],
        outcome: "noop" as const,
      };
    }

    // Success gate: 合意判定 > 350 + 一線越えない * 100.
    const judgement = computeConsentJudgement(target, next.master);
    const line = 350 + (target.state.TALENT[TALENT_ID.一線越えない] ?? 0) * 100;

    if (judgement > line) {
      // Success — lover established.
      const targetNum = ctx.target;
      // CFLAG:既成事實 |= bit2 (both).
      target.state.CFLAG[CFLAG_ID.既成事實] =
        (target.state.CFLAG[CFLAG_ID.既成事實] ?? 0) | LOVER_BIT;
      next.master.state.CFLAG[CFLAG_ID.既成事實] =
        (next.master.state.CFLAG[CFLAG_ID.既成事實] ?? 0) | LOVER_BIT;
      // TALENT:MASTER:恋人 = targetNum (lover chara num); TARGET:恋人 = 1.
      next.master.state.TALENT[TALENT_ID.恋人] = targetNum;
      target.state.TALENT[TALENT_ID.恋人] = 1;
      // Clear 炮友 on both.
      next.master.state.TALENT[TALENT_ID.炮友] = 0;
      target.state.TALENT[TALENT_ID.炮友] = 0;
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `告白成功！%CALLNAME:TARGET% 成为了你的恋人。` }],
        outcome: "ok" as const,
      };
    }

    // Failure — small 好感度 drop.
    target.state.CFLAG[CFLAG_ID.好感度] =
      Math.max(0, (target.state.CFLAG[CFLAG_ID.好感度] ?? 0) - 50);
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `告白被拒绝了…… %CALLNAME:TARGET% 的好感度略有下降。` }],
      outcome: "ok" as const,
    };
  },
};
