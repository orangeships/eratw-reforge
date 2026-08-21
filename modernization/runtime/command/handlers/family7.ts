/**
 * Phase 7 (Wave 4e) — family 7 H-mode / mode-machine commands.
 *
 * The うふふ (诶嘿嘿) mode-control + social/ability cluster. Each is a
 * C-tier bespoke handler (the ComfDef factory's outcome-roll + SOURCE-settle
 * skeleton doesn't fit mode toggles / consent gates / counter subsystems).
 * 350 押し倒す (entry gate) is already ported in `oshitaoshi.ts`; these are
 * its siblings — they enter / re-route / exit the H-mode session and the
 * partner-led (诶嘿嘿==2) counter economy.
 *
 * Verified IDs (CFLAG.csv / FLAG.csv / TCVAR.csv / TFLAG.csv):
 *   诶嘿嘿=317 (alias うふふ)  睡眠=313  衰弱=316  同行=320  同行準備=329
 *   恶作剧=331  陪睡中=334  招待=336  溜まってる度(积攒度)=340  性格傾向=560
 *   潜伏状態=526  睡眠姦=527  変化先=950  変化元=951  初期位置=311
 *   FLAG: 時間停止=70  潜伏=99(bit0)  甲斐性無=1040
 *   TCVAR: 随便=320(bit0)  Counter行動=20  泥酔=145
 *   TFLAG: 抱住模式=107  泡風呂=227  口上成否判定=192  成功分岐=193
 *   合意_うふふ = 既成事実 bit1 (1<<1).  (DIM_als.ERH:100)
 *
 * Faithful core per command (ERB `@COM`/`@COM_ABLE`, single-target normal
 * branch — multi-target B9 pickers + kojo reasonwalls deferred):
 *
 * - **COMF351 連れ出す** (313 lines): toggle 同行 (CFLAG:同行=60 / 0) on the
 *   target + master. The full ERB is a multi-target ASK picker
 *   (CASE 97/98/99/100 + per-chara loop); the single-target fast path
 *   (ERB 33-58) just flips 同行. We model that fast path; the multi-target
 *   picker (B9) + 相合伞雨 gate (TIME:5 weather + OUTROOF + ITEM:36) defer.
 *   `COM_351_CONDITION` (態度>0, not sleeping, not working) → execCheck.
 *   `TIME += 1`. RETURN 1.
 *
 * - **COMF353 イタズラする** (60 lines): sleep-prank entry. Sets 恶作剧 mode
 *   (via SET_PRANK helper), floors 睡眠姦 at 1, clears master/target
 *   隠密中. execCheck: target sleeping, master in target's private room
 *   (`現在位置 == CFLAG:311`), not already 恶作剧, single target, no
 *   甲斐性無/衰弱. RETURN 1. (SET_PRANK's full body deferred; we set the
 *   恶作剧 flag the helper ultimately writes.)
 *
 * - **COMF354 添い寝する** (64 lines): sleep-together. SET_TOGETHER(陪睡中)
 *   + SET_SLEEP(0) + SET_DERAY(4). execCheck: target sleeping, 寝室許可,
 *   not already 陪睡中/恶作剧, no 潜伏, not dating. RETURN 1. (The three
 *   SET_* helpers write 陪睡中 / 睡眠 / a delay timestamp; we set 陪睡中.)
 *
 * - **COMF355 時間停止** (53 lines): time-stop entry. Clears 同行 on every
 *   chara not on a date, clears master 同行 if not dating, sets
 *   `FLAG:時間停止 = 1`. execCheck: not already 時停, not 诶嘿嘿/恶作剧/
 *   陪睡中, master 気力>0, TSP>0. RETURN 1. (The visual SETBGCOLOR defer.)
 *
 * - **COMF356 物陰に誘う** (102 lines): うふふ-into-ambush entry. Kojo
 *   force-success/fail (TFLAG:192) → gate. Gate: SHIRAHU && !無知 &&
 *   `ABL:露出癖 + TALENT:羞恥心 < 3` → refuse (TFLAG:193=-1, TFLAG:102=0,
 *   TIME+5, RETURN 0). Success: `CFLAG:诶嘿嘿 = 1` on master+target,
 *   SETBIT 潜伏状態 bit0, SETBIT FLAG:潜伏 bit0, `BASE:潜伏率 = 100`,
 *   TIME+5. RETURN 1. execCheck: !時停, not 诶嘿嘿, 合意_うふふ OR 泥酔,
 *   not 睡眠/添い寝, not already 潜伏, 気力>0, !甲斐性無, TARGET≥1.
 *
 * - **COMF357 セフレ契約** (192 lines): 理性 vs 欲望 reasonwall + ASK_YN.
 *   The whole body is a 欲望判定値/理性判定値 build over ~15 TALENT/MARK/
 *   BASE arms + KOJO reasonwall (`SHOW_REASONWALL`) then ASK_YN confirm.
 *   Faithful port needs the 理性 economy + MARK + 酒気 ratio subsystems
 *   (only partially modeled). DEFER to a faithful blocked stub: execCheck
 *   passes (so the resolver registers it reachable upstream-faithfully),
 *   the body returns blocked with the real reason — no empty shell. (ASK_YN
 *   + reasonwall would also need the B9 prompt + a 理性/欲望 model first.)
 *
 * - **COMF358 他者変身** (112 lines): shape-shift picker (B9 INPUT over
 *   SHOW_CHALALIST) gated on `TALENT:変化 && (恋慕||愛欲)`. The @COM body
 *   ends `RETURN 0` (a pure UI toggle that re-renders; no SOURCE). We model
 *   the faithful no-op (RETURN 0) — the picker itself (B9) + 挿入不可 body
 *   gate defer. execCheck: !時停(unless 344), TALENT:変化, 恋慕||愛欲.
 *
 * - **COMF360 身を任せる** (63 lines): partner-led (诶嘿嘿==2) "give in".
 *   Nudges `COUNTER_SIKOU:指令番号` by ±1 (±3 if reversed/extreme, ×2 if
 *   坦率/学習快), LIMIT -10..10. `TIME += 5`. The COUNTER_SIKOU /
 *   Counter行動 / COUNTER_派生时记录 arrays aren't modeled → we port the
 *   faithful TIME+5 (and 気力==0 early RETURN 1 with no change), defer the
 *   COUNTER nudge. execCheck: !時停, 诶嘿嘿==2, not おねだり (Counter行動
 *   40..49).
 *
 * - **COMF361 抵抗する** (49 lines): partner-led "resist". Mirror of 360:
 *   nudge COUNTER_SIKOU by ∓1, `TIME += 10`. Same COUNTER defer. execCheck:
 *   诶嘿嘿==2, 気力>0.
 *
 * - **COMF368 自由行動に付き合う** (100 lines): accompany a partner's active
 *   free action. Supported source arms settle in `free-action-companion.ts`;
 *   TIME then advances and WorldScheduler consumes Activity_Duration once.
 *   Object/multi-character-heavy arms remain fail-closed.
 *
 * - **COMF850 抜け出す** (124 lines): exit the partner-led (诶嘿嘿==2) /
 *   抱住模式 / 泡風呂 / 随便-struggle session. The exit primitive (`被逆推終了`):
 *   for each 诶嘿嘿==2 chara → `BASE:情緒 /= 2`, `BASE:理性 = MIN(理性+300,
 *   MAXBASE)`, SET_DERAY(5). The struggle (随便 bit0) arm + 抱住模式/泡風呂
 *   arms + 性格傾向 display + 童貞/処女 なだめ arms defer. Core exit:
 *   情緒/=2 + 理性+300 cap + TIME+5, RETURN 1.
 *
 * **DEFERRED (cluster-common):** the multi-target B9 pickers (351 CASE
 * 97-100, 358 SHOW_CHALALIST); SET_PRANK/SET_TOGETHER/SET_SLEEP/SET_DERAY
 * helper bodies (we write the flag they ultimately set); 相合伞雨 gate;
 * KOJO reasonwalls (SHOW_REASONWALL/SF_REASON_MOD); COUNTER_SIKOU/
 * Counter行動/COUNTER_派生时记录 arrays (360/361); complex Activity_* source
 * arms (368); 性格傾向/童貞/処女 なだめ display arms (850); UFUFU_START_*
 * session envelope (Phase 8); MAGIC_DLC 神性 arms.
 */

import type { CommandContext, ExecCheck, HandlerEntry } from "../types.js";
import {
  cloneGameState,
  type CharaSlot,
  type GameState,
} from "../../state/game-state.js";
import { selectPresentCharas } from "../../scene/presence.js";
import { isHMode } from "../h-mode.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  TCVAR_ID,
  TALENT_ID,
  advanceTimeTicks,
  getMasterBase,
  getMasterCflag,
  setCharaBase,
  setCharaCflag,
  setMasterBase,
  setMasterCflag,
} from "../../state/settlement.js";
import {
  computeAttitude,
  computeShinchitsu,
  hConsentAcquired,
} from "../../state/attitude.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";
import { setSleep } from "../../world/set-sleep.js";

type Precond = { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } };

function targetSlot(ctx: CommandContext) {
  return ctx.state.charas[ctx.target];
}

// ===========================================================================
// COMF351 連れ出す (toggle 同行 — single-target fast path)
// ===========================================================================

/**
 * Faithful port of `@COM_351_CONDITION` (COMF351:293-313). Return ladder:
 *   3 = まとめて連れ出せる (態度>0 && !睡眠 && 行動!=5)
 *   2 = 个別選択で連れ出せる (already 同行 → release allowed; or default)
 *   1 = 連れ出せない・取り込み中 (行動==5 && 態度>0 → busy message, no toggle)
 *   0 = 連れ出せない (態度<1, or 睡眠/陪睡中)
 *
 * Unmodeled subsystems collapse to ERA defaults: `CAN_IRAI_CHARA_GO_TOGATHER`
 * (依頼) → false, `TCVAR:烂醉` → 0, `CFLAG:败犬` → 0. The `態度>0` core arm
 * (Parity QA P-6) is what the user-reported "无条件能带人" bug was missing.
 */
function com351Condition(
  state: Readonly<GameState>,
  slot: CharaSlot,
): number {
  const cflag = slot.state.CFLAG;
  const 態度 = computeAttitude(slot, state.master, state);
  const 睡眠 = cflag[CFLAG_ID.睡眠] ?? 0;
  const 陪睡 = cflag[CFLAG_ID.陪睡中] ?? 0;
  const 行動 = cflag[CFLAG_ID.行动] ?? 0;
  const 同行 = cflag[CFLAG_ID.同行] ?? 0;
  // ERB 296-297: 態度>0 && !睡眠 && 行動!=5 → 3 (bulk-bringable).
  if (態度 > 0 && 睡眠 === 0 && 行動 !== 5) return 3;
  // ERB 300-301: already 同行 → 2 (allow manual release even if condition lapsed).
  if (同行 !== 0) return 2;
  // (ERB 302-303: 败犬 → 2 — unmodeled, skipped.)
  // ERB 304-305: 態度<1 && !烂醉 && !CAN_IRAI → 0 (the core "can't bring" gate).
  if (態度 < 1) return 0;
  // ERB 306-307: 睡眠 || 陪睡中 → 0.
  if (睡眠 !== 0 || 陪睡 !== 0) return 0;
  // ERB 308-309: 行動==5 && !烂醉 → 1 (取り込み中 busy message).
  if (行動 === 5) return 1;
  // ERB 313: default → 2.
  return 2;
}

function check351(ctx: CommandContext): Precond {
  if (ctx.target <= 0 || !targetSlot(ctx)) {
    return { ok: false, reason: { kind: "precondition", message: "带出去需要目标角色在场。" } };
  }
  // @COM_ABLE351 top-level arms (ERB 243-285). Subsystem-dependent arms
  // (TFLAG:100 帯出去実行判定, GLOBAL_COMABLE, 外出时可以带出去+大地图,
  // IN_HOME(現在位置)/IS_GAP_GUEST) are deferred — the home-location /
  // gap-guest subsystems aren't wired to our string locations.
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (getMasterBase(ctx.state, BASE_ID.気力) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足。" } };
  }
  const t = targetSlot(ctx)!;
  if ((t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "正在诶嘿嘿模式中。" } };
  }
  if ((ctx.state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "约会中。" } };
  }
  // ERB 267: COM_351_CONDITION == 0 → RETURN 0 (the core 態度>0 gate).
  if (com351Condition(ctx.state, t) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方态度不够，无法带走。" } };
  }
  return { ok: true };
}

export const comf351HandlerEntry: HandlerEntry = {
  commandNo: 351,
  displayCheck: (ctx) => ({
    shown: true,
    labelOverride: (targetSlot(ctx)?.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0
      ? "解除同行"
      : "带出去",
  }),
  execCheck: (ctx) => {
    const r = check351(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const t0 = targetSlot(ctx);
    // ERB 34-39: COM_351_CONDITION == 1 → 取り込み中 busy message, RETURN -1
    // (no toggle, no time advance). execCheck already blocked == 0.
    if (t0 && com351Condition(ctx.state, t0) === 1) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "%CALLNAME:TARGET%正在忙碌中。" }],
        outcome: "ok",
      };
    }
    const next = cloneGameState(ctx.state);
    const t = next.charas[ctx.target]!;
    const wasDoko = (t.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0;
    let text: string;
    if (wasDoko) {
      // ERB 42-44: release.
      setCharaCflag(next, ctx.target, CFLAG_ID.同行, 0);
      setMasterCflag(next, CFLAG_ID.同行, 0);
      text = "同行解除了。";
    } else {
      // ERB 46-52: bring along. 同行 = 60 (timer; WorldScheduler decrements).
      setCharaCflag(next, ctx.target, CFLAG_ID.同行, 60);
      setMasterCflag(next, CFLAG_ID.同行, 60);
      text = `%CALLNAME:TARGET%跟着来了。`;
    }
    advanceTimeTicks(next, 1); // ERB 54.
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text }],
      outcome: "ok",
    };
  },
};

// ===========================================================================
// COMF353 イタズラする (sleep-prank entry)
// ===========================================================================

export const comf353HandlerEntry: HandlerEntry = {
  commandNo: 353,
  execCheck: (ctx) => {
    const t = targetSlot(ctx);
    if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "恶作剧只能在目标睡着时进行。" } };
    if ((t.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "已经处于恶作剧模式。" } };
    if ((t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "陪睡中无法恶作剧。" } };
    if ((getMasterCflag(ctx.state, FLAG_ID.甲斐性無)) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "甲斐性無，不敢下手。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // ERB 7-15: SET_PRANK(1) sets 恶作剧; floor 睡眠姦 at 1; clear 隠密中.
    setCharaCflag(next, ctx.target, CFLAG_ID.恶作剧, 1);
    const sj = next.charas[ctx.target]!.state.CFLAG[CFLAG_ID.睡眠姦] ?? 0;
    if (sj < 1) setCharaCflag(next, ctx.target, CFLAG_ID.睡眠姦, 1);
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "开始了恶作剧。" }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF354 添い寝する (sleep-together)
// ===========================================================================

export const comf354HandlerEntry: HandlerEntry = {
  commandNo: 354,
  execCheck: (ctx) => {
    const t = targetSlot(ctx);
    if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "陪睡需要目标已经睡着。" } };
    if (!hConsentAcquired(t))
      return { ok: false, reason: { kind: "precondition", message: "未取得寝室许可（合意）。" } };
    if (t.location !== ctx.state.master.location)
      return { ok: false, reason: { kind: "precondition", message: "目标不在同一房间。" } };
    if ((t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "已经处于陪睡模式。" } };
    if ((t.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "恶作剧模式中无法陪睡。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // COMF354: SET_TOGETHER(1, TARGET, 1) links both sides, then wakes the
    // target unless weak/invited, and SET_DERAY(4) makes the pair briefly
    // unavailable to ordinary movement/commands.
    setCharaCflag(next, ctx.target, CFLAG_ID.陪睡中, 1);
    setMasterCflag(next, CFLAG_ID.陪睡中, 1);
    const target = next.charas[ctx.target]!;
    if ((target.state.CFLAG[CFLAG_ID.衰弱] ?? 0) === 0 &&
        (target.state.CFLAG[CFLAG_ID.招待] ?? 0) === 0) {
      setSleep(next, 0, ctx.target, 0);
    }
    if ((target.state.CFLAG[CFLAG_ID.延迟] ?? 0) === 0) {
      target.state.CFLAG[CFLAG_ID.延迟] = 60;
    }
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "和 %CALLNAME:TARGET% 一起睡下了。" }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF355 時間停止 (time-stop entry)
// ===========================================================================

export const comf355HandlerEntry: HandlerEntry = {
  commandNo: 355,
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "已在时间停止中。" } };
    if ((getMasterCflag(ctx.state, CFLAG_ID.诶嘿嘿)) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "诶嘿嘿中无法时间停止。" } };
    if ((getMasterCflag(ctx.state, CFLAG_ID.恶作剧)) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "恶作剧中无法时间停止。" } };
    if ((getMasterCflag(ctx.state, CFLAG_ID.陪睡中)) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "陪睡中无法时间停止。" } };
    if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0)
      return { ok: false, reason: { kind: "precondition", message: "気力不足。" } };
    if ((getMasterBase(ctx.state, BASE_ID.TSP) ?? 0) <= 0)
      return { ok: false, reason: { kind: "precondition", message: "TSP不足。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // ERB 6-14: clear 同行 on every chara not on a date; clear master 同行
    // if not dating.
    for (const slot of Object.values(next.charas)) {
      if (!slot || slot.charaNum === 0) continue;
      slot.state.CFLAG[CFLAG_ID.同行] = 0;
    }
    next.master.state.CFLAG[CFLAG_ID.同行] = 0;
    // ERB 15: FLAG:時間停止 = 1.
    next.flagStore[FLAG_ID.時間停止] = 1;
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "时间停止了。" }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF356 物陰に誘う (うふふ-into-ambush entry)
// ===========================================================================

function check356(ctx: CommandContext): Precond {
  if (ctx.target <= 0 || !targetSlot(ctx))
    return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法邀去阴暗处。" } };
  const t = targetSlot(ctx)!;
  if ((t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "已在诶嘿嘿中。" } };
  // ERB 83: 合意_うふふ (既成事實 bit1) OR 泥酔.
  const consent = (t.state.CFLAG[CFLAG_ID.既成事実] ?? 0) & (1 << 1);
  const drunk = (t.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0;
  if (!consent && !drunk)
    return { ok: false, reason: { kind: "precondition", message: "未取得合意且未烂醉。" } };
  if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
  if ((t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "陪睡中无法邀去阴暗处。" } };
  if ((ctx.state.flagStore[FLAG_ID.潜伏] ?? 0) & 1)
    return { ok: false, reason: { kind: "precondition", message: "已在潜伏模式中。" } };
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0)
    return { ok: false, reason: { kind: "precondition", message: "気力不足。" } };
  if ((ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "甲斐性無，不敢下手。" } };
  return { ok: true };
}

export const comf356HandlerEntry: HandlerEntry = {
  commandNo: 356,
  execCheck: (ctx) => {
    const r = check356(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const t = next.charas[ctx.target]!;
    // ERB 10-14: kojo force-success/fail (TFLAG:192). Defer (no kojo).
    // ERB 16-24: refusal — SHIRAHU && !無知 && 露出癖+羞恥心 < 3 → refuse.
    // 露出癖 = ABL:14, 羞恥心 = TALENT:33. SHIRAHU (conscious) defer (assume true).
    const isIgnorant = (t.state.TALENT[TALENT_ID.無知] ?? 0) !== 0;
    // COMMON.ERB:SHIRAHU is true only while the target is awake, not陪睡中,
    // not烂醉, and not衰弱. 烂醉 is the explicit COM_ABLE356 escape hatch,
    // so it must bypass this conscious-target refusal branch.
    const isShirahu =
      (t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0 &&
      (t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) === 0 &&
      (t.state.TCVAR[TCVAR_ID.泥酔] ?? 0) === 0 &&
      (t.state.CFLAG[CFLAG_ID.衰弱] ?? 0) === 0;
    const exposure = (t.state.ABL[/* 露出癖 */ 14] ?? 0);
    const shame = (t.state.TALENT[TALENT_ID.羞恥心] ?? 0);
    if (isShirahu && !isIgnorant && exposure + shame < 3) {
      // ERB 19-22: refuse.
      setTflag(next, TFLAG_ID.SELECTCOM的分岐, -1);
      next.flagStore[102] = 0; // TFLAG:COMABLE管理 = 0
      advanceTimeTicks(next, 5);
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "%CALLNAME:TARGET% 似乎对在外面做的事情还很抵触。" }],
        outcome: "noop", // RETURN 0
      };
    }
    // ERB 40-41: enter うふふ on both.
    setMasterCflag(next, CFLAG_ID.诶嘿嘿, 1);
    setCharaCflag(next, ctx.target, CFLAG_ID.诶嘿嘿, 1);
    // ERB 49-50: SETBIT 潜伏状態 bit0 (target) + FLAG:潜伏 bit0.
    t.state.CFLAG[CFLAG_ID.潜伏状態] = (t.state.CFLAG[CFLAG_ID.潜伏状態] ?? 0) | 1;
    next.flagStore[FLAG_ID.潜伏] = (next.flagStore[FLAG_ID.潜伏] ?? 0) | 1;
    // ERB 53: BASE:潜伏率 = 100.
    setMasterBase(next, BASE_ID.潜伏率, 100);
    // ERB 55-56: TIME += 5 (unless 時停; not 時停 here).
    advanceTimeTicks(next, 5);
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `把 %CALLNAME:TARGET% 邀进了阴暗处……` }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF357 セフレ契約 (理性/欲望 reasonwall — faithful blocked stub)
// ===========================================================================

export const comf357HandlerEntry: HandlerEntry = {
  commandNo: 357,
  // Parity QA P-7 — @COM_ABLE passes (faithfully usable upstream) but the
  // @COM body is a deferred reasonwall stub (理性/欲望 economy + MARK + 酒気
  // + B9 ASK_YN unmodeled). Mark `deferred` so the UI greys + labels it
  // 「未实现」 instead of presenting a clickable-but-ineffective button.
  deferred: true,
  execCheck: (ctx) => {
    if (ctx.target <= 0 || !targetSlot(ctx))
      return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法提出。" } };
    // @COM_ABLE357 line 148 — 妄想中は不可 (Parity QA P-23: was missing).
    if (getTflag(ctx.state, TFLAG_ID.妄想中) === 1)
      return { ok: false, reason: { kind: "precondition", message: "妄想中无法提出。" } };
    const t = targetSlot(ctx)!;
    if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
    if ((t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "陪睡中无法提出。" } };
    // @COM_ABLE357 line 160 — 亲热強度2 (`TCVAR:MASTER:亲热 < 2`). 亲热 is a
    // per-turn INFO.ERB derivation with no persisted refresh in our runtime, so
    // read it on-demand from the target's 態度 (single-target collapse, like
    // COMF350/compile-gate) instead of the stale stored master TCVAR:130.
    if (computeShinchitsu(t, ctx.state.master, ctx.state) < 2)
      return { ok: false, reason: { kind: "precondition", message: "亲热强度不足（需要2以上）。" } };
    // @COM_ABLE357 line 163-167 — 既に炮友/愛欲/恋慕/恋人 はだめ. The target is
    // already in one of the social-contract states; proposing again is pointless.
    // (P-23: was missing — the command showed even when already contracted.)
    if (
      (t.state.TALENT[TALENT_ID.炮友] ?? 0) !== 0 ||
      (t.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0 ||
      (t.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0
    )
      return { ok: false, reason: { kind: "precondition", message: "已是炮友/爱欲/恋慕，无需再订契约。" } };
    if ((t.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "已是恋人，无需炮友契约。" } };
    // @COM_ABLE357 line 170 — 路人 (汎用角色) はだめ. Faceless NPCs can't contract.
    // (P-23: was missing.)
    if ((t.state.TALENT[TALENT_ID.路人] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "无法与路人订立炮友契约。" } };
    if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0)
      return { ok: false, reason: { kind: "precondition", message: "気力不足。" } };
    if ((ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "甲斐性無，不敢提出。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    // FAITHFUL DEFER: the @COM body is a 理性判定値/欲望判定値 reasonwall over
    // ~15 TALENT/MARK/BASE arms + KOJO SHOW_REASONWALL + ASK_YN confirm, then
    // sets TALENT:炮友 (and clears 思慕) on success / SOURCE:反感 += 1000 on
    // fail, TIME+10. Needs the 理性 economy + MARK + 酒気-ratio subsystems
    // (only partially modeled) + B9 ASK_YN. Blocked — no empty shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（炮友契约的理性/欲望判定尚未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "炮友契约的理性／刻印／酒意判定与确认流程尚未实现" },
    };
  },
};

// ===========================================================================
// COMF358 他者変身 (shape-shift picker — faithful RETURN 0 noop)
// ===========================================================================

export const comf358HandlerEntry: HandlerEntry = {
  commandNo: 358,
  execCheck: (ctx) => {
    const t = targetSlot(ctx);
    if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法变身。" } };
    if ((t.state.TALENT[TALENT_ID.変化] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "目标没有变身能力。" } };
    if ((t.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0 && (t.state.TALENT[TALENT_ID.愛欲] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "需要恋慕或爱欲。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    // ERB @COM358 ends `RETURN 0` — a pure UI shape-shift picker (B9 INPUT
    // over SHOW_CHALALIST) that re-renders; no SOURCE. The picker + 挿入不可
    // body gate defer. Faithful no-op.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（变身对象选择尚未建模。）" }],
      outcome: "noop", // RETURN 0
    };
  },
};

// ===========================================================================
// COMF360 身を任せる (partner-led "give in" — TIME+5, COUNTER nudge defer)
// ===========================================================================

/** @COM_ABLE360 partner-led gate (诶嘿嘿==2 + not 時停 + not おねだり). */
const comf360Check: ExecCheck = (ctx) => {
  const t = targetSlot(ctx);
  if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法行动。" } };
  if ((t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 2)
    return { ok: false, reason: { kind: "precondition", message: "需要攻守交替（诶嘿嘿==2）状态。" } };
  // ERB 61: not おねだり (Counter行動 in 40..49).
  const counter = t.state.TCVAR[TCVAR_ID.Counter行動] ?? 0;
  if (counter >= 40 && counter <= 49)
    return { ok: false, reason: { kind: "precondition", message: "对方正在央求时无法任其摆布。" } };
  return { ok: true };
};

export const comf360HandlerEntry: HandlerEntry = {
  commandNo: 360,
  // P1-14 逆推: 360 身を任せる is partner-led (诶嘿嘿==2); the check doubles
  // as the menu gate (requiresHMode now marks 360 as H-only).
  execCheck: comf360Check,
  hModeMenuCheck: comf360Check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    advanceTimeTicks(next, 5); // ERB 14.
    // ERB 16-17: 気力==0 → RETURN 1 (no change). COUNTER_SIKOU nudge deferred.
    if ((getMasterBase(next, BASE_ID.気力) ?? 0) <= 0) {
      return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "任凭摆布。" }], outcome: "ok" };
    }
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "任凭摆布。（COUNTER_SIKOU 影响度调整未建模）" }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF361 抵抗する (partner-led "resist" — TIME+10, COUNTER nudge defer)
// ===========================================================================

/** @COM_ABLE361 partner-led gate (诶嘿嘿==2 + master 気力 > 0). */
const comf361Check: ExecCheck = (ctx) => {
  const t = targetSlot(ctx);
  if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
  if ((t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 2)
    return { ok: false, reason: { kind: "precondition", message: "需要攻守交替（诶嘿嘿==2）状态。" } };
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0)
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法抵抗。" } };
  return { ok: true };
};

export const comf361HandlerEntry: HandlerEntry = {
  commandNo: 361,
  // P1-14 逆推: 361 抵抗する is partner-led (诶嘿嘿==2); menu gate = check.
  execCheck: comf361Check,
  hModeMenuCheck: comf361Check,
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    advanceTimeTicks(next, 10); // ERB 7.
    // COUNTER_SIKOU nudge (mirror of 360) deferred.
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "抵抗了。（COUNTER_SIKOU 影响度调整未建模）" }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF368 自由行動に付き合う (free-action companion — 17/20 types wired)
// ===========================================================================
//
// ERB `COMF368 自由行動に付き合う.ERB`: requires Activity_Duration:TARGET
// (NPC in mid free action) and dispatches per Activity_Type:
//   0/1/2/3/4/5/6/7/8/9/10/12/13/14/16/17/18.
// In the port, `state.freeActions[target] = { type, remainingMinutes }` is
// the scheduler's analogue; the companion settle lives in
// `runtime/world/free-action-companion.ts`.

import { companionActionAvailable, companionActionName, runCompanionSettle } from "../../world/free-action-companion.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";

export const comf368HandlerEntry: HandlerEntry = {
  commandNo: 368,
  displayCheck: (ctx) => {
    const action = ctx.state.freeActions?.[ctx.target];
    const target = targetSlot(ctx);
    const label = action ? companionActionName(action.type, action.remainingMinutes, target) : null;
    return { shown: true, ...(label ? { labelOverride: label } : {}) };
  },
  execCheck: (ctx) => {
    const t = targetSlot(ctx);
    if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法行动。" } };
    if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0)
      return { ok: false, reason: { kind: "precondition", message: "気力不足。" } };
    if (t.location !== ctx.state.master.location)
      return { ok: false, reason: { kind: "precondition", message: "目标角色不在同一地点。" } };
    const action = ctx.state.freeActions?.[t.charaNum];
    if (!action) {
      return { ok: false, reason: { kind: "precondition", message: "目标没有进行中的自由行动。" } };
    }
    if (!companionActionAvailable(ctx.state, t.charaNum))
      return { ok: false, reason: { kind: "precondition", message: "这种自由行动尚未支持陪同结算。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    let next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const t = next.charas[target];
    if (!t) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有目标角色。" }],
        outcome: "noop" as const,
      };
    }
    const outcome = runCompanionSettle(next, target, ctx.rng);
    // ERB 28: TIME += 経過時間. apply-intent subsequently projects this
    // interval through WorldScheduler, which alone consumes Activity_Duration.
    if (outcome.elapsedMinutes > 0) advanceTimeTicks(next, outcome.elapsedMinutes);
    if (!outcome.ok) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: outcome.text }],
        outcome: "noop" as const,
        failReason: { kind: "precondition", message: outcome.text },
      };
    }
    const kojo = collectCommandKojo({ ...ctx, state: next });
    if (kojo.effects.length > 0) next = applyKojoEffects(next, kojo.effects);
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: outcome.text },
        ...kojo.events,
      ],
      outcome: outcome.completed ? ("ok" as const) : ("ok" as const),
      pendingKojoChoice: kojo.pendingKojoChoice,
      kojoHandled: true,
    };
  },
};

// ===========================================================================
// COMF850 抜け出す (exit partner-led / 抱住模式 / 泡風呂 session)
// ===========================================================================

/** 850 抜け出す has NO upstream @COM_ABLE850 — it is always executable.
 *  The execCheck only requires a present target. */
const comf850Check: ExecCheck = (ctx) => {
  if (!ctx.state.charas[ctx.target]) {
    return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
  }
  return { ok: true };
};

export const comf850HandlerEntry: HandlerEntry = {
  commandNo: 850,
  execCheck: comf850Check,
  // P1-14 逆推: 850 is an H-only command (requiresHMode) — the MENU gate is
  // "somebody is in うふふ", while execution stays ungated like upstream.
  hModeMenuCheck: (ctx) => {
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    }
    if (!isHMode(ctx.state, ctx.target)) {
      return { ok: false, reason: { kind: "precondition", message: "需要先进入调教状态。" } };
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // ERB 39-77: the no-struggle / no-hold exit path. For every 诶嘿嘿==2
    // chara (or the target), the exit primitive (被逆推終了, ERB 82-107):
    //   BASE:情緒 /= 2, BASE:理性 = MIN(理性+300, MAXBASE), (诶嘿嘿→0 deferred
    //   — left commented in ERB line 105). We apply 情緒/=2 + 理性+300 cap to
    //   all 诶嘿嘿==2 co-located charas + the target.
    const affected: number[] = [];
    for (const slot of selectPresentCharas(next, next.master.location)) {
      if (slot.charaNum === 0) continue;
      const ufufu = slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0;
      if (ufufu === 2 || slot.charaNum === ctx.target) {
        const emo = slot.state.BASE[BASE_ID.情緒] ?? 0;
        setCharaBase(next, slot.charaNum, BASE_ID.情緒, Math.trunc(emo / 2));
        const reason = slot.state.BASE[BASE_ID.理性] ?? 0;
        const maxR = slot.state.MAXBASE?.[BASE_ID.理性] ?? 0;
        const capped = maxR > 0 ? Math.min(reason + 300, maxR) : reason + 300;
        setCharaBase(next, slot.charaNum, BASE_ID.理性, capped);
        affected.push(slot.charaNum);
      }
    }
    // ERB 123: TIME += 5.
    advanceTimeTicks(next, 5);
    const who = affected.length > 1 ? "她们" : "%CALLNAME:TARGET%";
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `一边抚慰着${who}一边拔了出来。` }],
      outcome: "ok", // RETURN 1
    };
  },
};
