/**
 * Phase 7 — `COMF333 愚痴を聞く` (listen to complaints), mood/anger C-tier.
 *
 * Faithful core ported (`ERB/コマンド関連/COMF/日常系/COMF333 愚痴を聞く.ERB`,
 * the CASE 0 path: TFLAG:192 == 0, no DLC):
 *
 *   1. `@COM_ABLE333` core (ERB 86-111), simplified to what we model:
 *        - not time-stopped (`FLAG:70`, ERB 95)
 *        - `ABL:TARGET:親密 >= 3` (ERB 97)
 *        - `TALENT:TARGET:心情 < 0` (ERB 103) — only vents when in a bad mood
 *        - master 気力 > 0 (ERB 106)
 *        - target not sleeping (`CFLAG:313`, ERB 109)
 *
 *   2. Roll setup (ERB 9-17):
 *        `SOURCE:歓楽 = 400` base.
 *        `L = 50 + ABL:MASTER:話術技能*5 + ABL:TARGET:親密*2`.
 *        if `BASE:TARGET:酒気 > MAXBASE:酒気 / 2` → `L -= 15` (drunk penalty).
 *
 *   3. Outcome roll (ERB CASE 0, lines 20-28):
 *        `r = RAND:L`; r < 20 → TFLAG:193 = 1; 20..49 → 2; else → 3.
 *        Then if drunk (酒気 > MAXBASE/2): `TFLAG:193 += 3` (ERB 46-47) →
 *        moves into the 4/5/6 drunk arms.
 *
 *   4. Settlement by TFLAG:193 (ERB 49-78):
 *        1: SOURCE:反感 = 100
 *        2: 歓楽 += 親密*30; 心情++; 憤怒 /= 2; 不機嫌 = 0
 *        3: 歓楽 += 親密*50; 情愛 = 200; 心情++; 憤怒 /= 2; 不機嫌 = 0
 *        4: 反感 = 1000; 歓楽 += 親密*30
 *        5: 歓楽 += 親密*50
 *        6: 歓楽 += 親密*75; 情愛 = 300; 心情 = 1; 憤怒 /= 2; 不機嫌 = 0
 *        TIME += 20 (ERB 80). `applySourceCheck` settles → PALAM → 好感度.
 *
 * **DEFERRED (documented — same posture as oshitaoshi.ts / apologize.ts):**
 *   - **TFLAG:192 force-success/terminate arms** (CASE 1/-1/-2) — resolver
 *     does not pass TFLAG:192; we always take CASE 0.
 *   - **MARK:反発刻印 gate** (ERB 99) — MARK namespace not modeled. We treat
 *     it as 0 (the gate passes), matching the clean-state default.
 *   - **CFLAG:诶嘿嘿 gate** (ERB 101) — modeled id; we honor it (can't vent
 *     mid-H-scene).
 *   - **MAGIC_DLC_大成功相关 / M_TFLAG / TimeFactor** (ERB 12,52,65,81) — DLC.
 *   - **TALENT:心情 cap at +1** (CASE 6 sets 心情 = 1, not ++) — modeled.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterBase,
} from "../../state/settlement.js";
import { clearAnger } from "../../state/mood.js";
import { applySourceCheck } from "../source-check.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE333` core
// ---------------------------------------------------------------------------

function checkListenEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (ctx.target <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "愚痴を聞く需要目标角色在场。" } };
  }
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false, reason: { kind: "precondition", message: "目标角色不存在。" } };
  }
  // ERB 95: not time-stopped.
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法倾听。" } };
  }
  // ERB 97: ABL:TARGET:親密 >= 3.
  if ((target.state.ABL[ABL_ID.親密] ?? 0) < 3) {
    return { ok: false, reason: { kind: "precondition", message: "关系还不够亲密。" } };
  }
  // ERB 103: TALENT:TARGET:心情 < 0 — only vents when in a bad mood.
  if ((target.state.TALENT[TALENT_ID.心情] ?? 0) >= 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方现在心情不错，没什么好抱怨的。" } };
  }
  // ERB 101: CFLAG:诶嘿嘿 (mid-H-scene) blocks venting.
  if ((target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是倾诉的氛围。" } };
  }
  // ERB 109: target not sleeping.
  if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
  }
  // ERB 106: master 気力 > 0.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法行动。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM333` core (CASE 0)
// ---------------------------------------------------------------------------

export const listenComplaintsHandlerEntry: HandlerEntry = {
  commandNo: 333,
  execCheck: (ctx) => {
    const r = checkListenEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;

    const wajutsu = next.master.state.ABL[ABL_ID.話術技能] ?? 0;
    const shinmitsu = target.state.ABL[ABL_ID.親密] ?? 0;

    // ----- Drunk check (ERB 15, 46): 酒気 > MAXBASE:酒気 / 2 -----
    const sake = target.state.BASE[BASE_ID.酒気] ?? 0;
    const sakeMax = target.state.MAXBASE[BASE_ID.酒気] ?? 0;
    const drunk = sake > Math.trunc(sakeMax / 2);

    // ----- Roll bound L (ERB 11-16) -----
    let l = 50 + wajutsu * 5 + shinmitsu * 2;
    if (drunk) l -= 15; // ERB 16

    // ----- Outcome roll (ERB CASE 0, lines 21-28) -----
    const r = ctx.rng.int(l); // RAND:L → [0, L)
    let tf193: number;
    if (r < 20) tf193 = 1;
    else if (r <= 50) tf193 = 2;
    else tf193 = 3;
    // ERB 46-47: drunk shifts into the 4/5/6 arms.
    if (drunk) tf193 += 3;

    // ----- Settlement by TFLAG:193 (ERB 49-78) -----
    const sources: Record<number, number> = { [SOURCE_ID.歓楽]: 400 };
    switch (tf193) {
      case 1:
        sources[SOURCE_ID.反感] = 100;
        break;
      case 2:
        sources[SOURCE_ID.歓楽] = 400 + shinmitsu * 30;
        target.state.TALENT[TALENT_ID.心情] = (target.state.TALENT[TALENT_ID.心情] ?? 0) + 1;
        clearAnger(target, false); // 憤怒 /= 2, 不機嫌 = 0
        break;
      case 3:
        sources[SOURCE_ID.歓楽] = 400 + shinmitsu * 50;
        sources[SOURCE_ID.情愛] = 200;
        target.state.TALENT[TALENT_ID.心情] = (target.state.TALENT[TALENT_ID.心情] ?? 0) + 1;
        clearAnger(target, false);
        break;
      case 4:
        sources[SOURCE_ID.反感] = 1000;
        sources[SOURCE_ID.歓楽] = 400 + shinmitsu * 30;
        break;
      case 5:
        sources[SOURCE_ID.歓楽] = 400 + shinmitsu * 50;
        break;
      case 6:
        sources[SOURCE_ID.歓楽] = 400 + shinmitsu * 75;
        sources[SOURCE_ID.情愛] = 300;
        target.state.TALENT[TALENT_ID.心情] = 1; // ERB 75: set to 1, not ++
        clearAnger(target, false);
        break;
    }

    // ----- TIME += 20 (ERB 80) -----
    advanceTimeTicks(next, 20);

    // ----- Settle → PALAM → 好感度 -----
    const settled = applySourceCheck(next, ctx.target, sources, 0);

    const good = tf193 === 2 || tf193 === 3 || tf193 === 6;
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 倾听了 %CALLNAME:TARGET% 的抱怨；${
            good ? "对方的心情舒畅了不少。" : "气氛有些尴尬。"
          }好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`,
        },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};
