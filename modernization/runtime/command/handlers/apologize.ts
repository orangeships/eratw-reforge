/**
 * Phase 7 — `COMF303 謝る` (apologize), the first mood/anger C-tier command.
 *
 * Faithful core ported (`ERB/コマンド関連/COMF/日常系/COMF303 謝る.ERB`,
 * the normal-branch path: TFLAG:192 == 0 / CASE 0, no DLC, no item arm):
 *
 *   1. `@COM_ABLE303` core (ERB 135-156), simplified to what we model:
 *        - target present (resolver contract; `ctx.target > 0`)
 *        - target is angry — `CFLAG:勃然大怒 != 0` (ERB 145, via `isAngry`)
 *        - target not sleeping (`CFLAG:313`, ERB 148)
 *        - master 気力 > 0 (ERB 151)
 *        - not time-stopped (`FLAG:70`, ERB 154 — we read the modeled flag)
 *
 *   2. Outcome roll (ERB CASE 0, lines 12-28):
 *        `roll = RAND:100`; `L1 = ABL:MASTER:話術技能*2 + ABL:TARGET:親密`.
 *        roll < L1        → 大成功 (great)
 *        roll < L1 + 30   → 成功   (success)
 *        else             → 失敗   (fail)
 *
 *   3. Settlement (ERB 56-130):
 *        - DOWNBASE master 体力 50 / 気力 200 (ERB 56-57, always)
 *        - if target angry (always true past execCheck) & not sleeping:
 *          `SOURCE:征服` bracket (ERB 60-93 → `apologySubjugation`)
 *        - success  (great=false) → `clearAnger(target, false)` (憤怒 /= 2)
 *        - 大成功 (great=true)     → `clearAnger(target, true)`  (憤怒 = 0)
 *        - fail                    → no anger change
 *        - TIME += 90 / 60 / 45 by ABL:TARGET:従順 (ERB 119-128)
 *        - `applySourceCheck` settles 征服 → PALAM → 好感度.
 *
 * **DEFERRED (documented — same posture as oshitaoshi.ts):**
 *   - **败犬 + 反発刻印 irredeemable arm** (ERB 6-9) — `CFLAG:败犬` not in
 *     any .als; `MARK:反発刻印` MARK namespace not modeled. Never fires.
 *   - **點心盒 / 反発刻印 item-reconcile arm** (ERB 109-117) — ITEM + MARK
 *     namespaces not modeled. Deferred.
 *   - **TFLAG:192 force-success/fail/terminate arms** (CASE 1/-1/-2) — the
 *     resolver does not pass TFLAG:192, so we always take CASE 0.
 *   - **MAGIC_DLC_大成功相关 / M_TFLAG:成功 / APLOGIZEDLC** — DLC, deferred.
 *   - **TFLAG:信頼度管理** (ERB 21/38) — TRUST_CALC trust subsystem deferred
 *     (same as every prior port).
 *   - **CFLAG:心情不快 cleared on success** — handled inside `clearAnger`.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { apologySubjugation, clearAnger, isAngry } from "../../state/mood.js";
import { applySourceCheck } from "../source-check.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE303` core
// ---------------------------------------------------------------------------

function checkApologizeEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (ctx.target <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "謝る需要目标角色在场。" } };
  }
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false, reason: { kind: "precondition", message: "目标角色不存在。" } };
  }
  // ERB 145: only apologize to an angry target. (The OR'd 點心盒/反発刻印
  // item arm is deferred — MARK/ITEM not modeled.)
  if (!isAngry(target)) {
    return { ok: false, reason: { kind: "precondition", message: "对方并没有在生气。" } };
  }
  // ERB 148: target must not be sleeping.
  if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
  }
  // ERB 151: master 気力 > 0.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法行动。" } };
  }
  // ERB 154: not time-stopped.
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法谢罪。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM303` core (CASE 0)
// ---------------------------------------------------------------------------

export const apologizeHandlerEntry: HandlerEntry = {
  commandNo: 303,
  execCheck: (ctx) => {
    const r = checkApologizeEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    let next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;

    // ----- Outcome roll (ERB CASE 0, lines 12-28) -----
    // L1 = ABL:MASTER:話術技能*2 + ABL:TARGET:親密.
    const wajutsu = next.master.state.ABL[ABL_ID.話術技能] ?? 0;
    const shinmitsu = target.state.ABL[ABL_ID.親密] ?? 0;
    const juujun = target.state.ABL[ABL_ID.従順] ?? 0;
    const l1 = wajutsu * 2 + shinmitsu;
    const roll = ctx.rng.int(100); // RAND:100 → [0, 100)

    let great = false;
    let success = false;
    if (roll < l1) {
      great = true;
      success = true;
    } else if (roll < l1 + 30) {
      success = true;
    }
    // Every authored COM303 route branches on TFLAG:193.  Write it before
    // collecting dialogue so a failed apology cannot say that it was accepted.
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, great ? 1 : success ? 0 : -1);

    // ----- DOWNBASE master 体力 50 / 気力 200 (ERB 56-57, always) -----
    setMasterBase(next, BASE_ID.体力, (getMasterBase(next, BASE_ID.体力) ?? 0) - 50);
    setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 200);

    // ----- SOURCE:征服 bracket (ERB 60-93) -----
    // execCheck guarantees the target is angry (CFLAG:勃然大怒) and not
    // sleeping, so the ERB's `IF TARGET>0 && ブチギレ && !睡眠` block fires.
    const sources: Record<number, number> = {
      [SOURCE_ID.征服]: apologySubjugation(juujun, shinmitsu),
    };

    // ----- Anger resolution (ERB 96-106) -----
    if (great) {
      clearAnger(target, true); // 憤怒 = 0
    } else if (success) {
      clearAnger(target, false); // 憤怒 /= 2
    }
    // fail → no change.

    // ----- TIME by 従順 (ERB 119-128) -----
    let timeCost: number;
    if (juujun <= 5) timeCost = 90;
    else if (juujun <= 10) timeCost = 60;
    else timeCost = 45;
    advanceTimeTicks(next, timeCost);

    // ----- Settle 征服 → PALAM → 好感度 (ERB routes SOURCE via SOURCE_CHECK) -----
    const settled = applySourceCheck(next, ctx.target, sources, 0);

    const kojo = collectCommandKojo({ ...ctx, state: next });
    if (kojo.effects.length > 0) next = applyKojoEffects(next, kojo.effects);

    const word = great ? "诚心诚意地" : success ? "" : "勉强地";
    const tail = success ? "对方的怒气消解了。" : "但对方并没有原谅。";
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% ${word}向 %CALLNAME:TARGET% 道歉；${tail}好感度 ${
            settled.favorDelta >= 0 ? "+" : ""
          }${settled.favorDelta}。`,
        },
        ...settled.events,
        ...kojo.events,
      ],
      outcome: "ok" as const,
      kojoHandled: true,
    };
  },
};
