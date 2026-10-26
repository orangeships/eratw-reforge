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
 * - **COMF357 セフレ契約** (192 lines): ASK_YN, 欲望/理性判定, then a
 *   success contract or failed-proposal 反感 settlement. The common score
 *   formula and the audited Eiki/Kagerou mechanical route hooks are modeled;
 *   route dialogue and diary insertion remain outside this handler. Target
 *   139 is intentionally hidden: its authored route contains sexualized
 *   minor content and is not imported into the modern game.
 *
 * - **COMF358 他者変身** (112 lines): shape-shift picker (B9 INPUT over
 *   SHOW_CHALALIST) gated on action phase, `TALENT:変化 && (恋慕||愛欲)`,
 *   and time-stop CFLAG:344 exception. Non-insertion choices update 変化先 /
 *   変化元 and re-render the portrait without SOURCE or time. The detailed
 *   挿入不可 body gate is not modeled, so inserted use fails closed.
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
 * **DEFERRED (cluster-common):** the multi-target B9 picker (351 CASE
 * 97-100); COMF358 per-character kojo route and inserted body-size gate;
 * SET_PRANK/SET_TOGETHER/SET_SLEEP/SET_DERAY
 * helper bodies (we write the flag they ultimately set); 相合伞雨 gate;
 * Non-COMF357 KOJO reasonwalls (SHOW_REASONWALL/SF_REASON_MOD); COUNTER_SIKOU/
 * Counter行動/COUNTER_派生时记录 arrays (360/361); complex Activity_* source
 * arms (368); 性格傾向/童貞/処女 なだめ display arms (850); UFUFU_START_*
 * session envelope (Phase 8); MAGIC_DLC 神性 arms.
 */

import type { CommandContext, CommandResult, ExecCheck, HandlerEntry } from "../types.js";
import { blocksDialogueAccompany, carryDialogueConsentToOuting, clearDialogueAccompanyPermit, hasDialogueAccompanyPermit } from "../../ai-state/dialogue-action.js";
import {
  cloneGameState,
  type CharaSlot,
  type GameState,
} from "../../state/game-state.js";
import { selectPresentCharas } from "../../scene/presence.js";
import { canBringCommissionClient } from "../../state/commission.js";
import { isHMode } from "../h-mode.js";
import { applyOneMinuteHCommandTimeCorrection, applySourceCheck } from "../source-check.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  SOURCE_ID,
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
  isOtokoGirai,
} from "../../state/attitude.js";
import { TFLAG_ID, getTflag, isCommandActionPhase, setTflag } from "../../state/tflag.js";
import { getPalamLv } from "../../state/palam-level.js";
import { pickOne, requirePickOne } from "../prompt.js";
import { setSleep } from "../../world/set-sleep.js";
import {
  activeHInsertionSites,
  clearHInteractionState,
  clearTrainingMode,
  settleHInsertionHistory,
} from "../training-session.js";

type Precond = { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } };

function targetSlot(ctx: CommandContext) {
  return ctx.state.charas[ctx.target];
}

// ===========================================================================
// COMF351 連れ出す (toggle 同行 — single-target fast path)
// ===========================================================================

/**
 * Faithful port of `@COM_351_CONDITION` (COMF351:293-313). Return ladder:
 *   3 = まとめて連れ出せる ((態度>0 || 委托可带出) && !睡眠 && 行動!=5)
 *   2 = 个別選択で連れ出せる (already 同行 → release allowed; or default)
 *   1 = 連れ出せない・取り込み中 (行動==5 → busy message, no toggle)
 *   0 = 連れ出せない (態度<1 && !委托可带出, or 睡眠/陪睡中)
 *
 * `CAN_IRAI_CHARA_GO_TOGATHER` (FUNC_IRAI.ERB:227-256) is now modeled: the
 * client of an ACTIVE canTakeAlong commission passes both the 298 arm and the
 * 306 arm independently of 態度 (问题4). `TCVAR:烂醉` → 0, `CFLAG:败犬` → 0
 * remain unmodeled ERA-default collapses. The `態度>0` core arm (Parity QA
 * P-6) is what the user-reported "无条件能带人" bug was missing.
 */
function com351Condition(
  state: Readonly<GameState>,
  slot: CharaSlot,
): number {
  const cflag = slot.state.CFLAG;
  if (!(cflag[CFLAG_ID.同行] ?? 0) && blocksDialogueAccompany(state, slot.charaNum)) return 0;
  const 態度 = computeAttitude(slot, state.master, state);
  const iraiBringable = canBringCommissionClient(state, slot.charaNum);
  // Explicit opt-in deviation: accepted dialogue consent substitutes only the attitude gate.
  const dialogueConsent = hasDialogueAccompanyPermit(state, slot.charaNum);
  const 睡眠 = cflag[CFLAG_ID.睡眠] ?? 0;
  const 陪睡 = cflag[CFLAG_ID.陪睡中] ?? 0;
  const 行動 = cflag[CFLAG_ID.行动] ?? 0;
  const 同行 = cflag[CFLAG_ID.同行] ?? 0;
  // ERB 296-297: (態度>0 || CAN_IRAI) && !睡眠 && 行動!=5 → 3 (bulk-bringable).
  if ((態度 > 0 || iraiBringable || dialogueConsent) && 睡眠 === 0 && 行動 !== 5) return 3;
  // ERB 300-301: already 同行 → 2 (allow manual release even if condition lapsed).
  if (同行 !== 0) return 2;
  // (ERB 302-303: 败犬 → 2 — unmodeled, skipped.)
  // ERB 304-305: 態度<1 && !烂醉 && !CAN_IRAI → 0 (the core "can't bring" gate).
  if (態度 < 1 && !iraiBringable && !dialogueConsent) return 0;
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
  if (!(t.state.CFLAG[CFLAG_ID.同行] ?? 0) && blocksDialogueAccompany(ctx.state, t.charaNum)) {
    const phase = ctx.state.aiDialogueAccompany?.[t.charaNum]?.phase;
    return { ok: false, reason: { kind: "precondition", message: phase === "invited" ? "对方在等你的回应。"
      : phase === "rejected" ? "对方这次不愿意一起出门。" : "这次的同行约定已经取消。" } };
  }
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
    if (wasDoko) clearDialogueAccompanyPermit(next, ctx.target);
    else carryDialogueConsentToOuting(next, ctx.target);
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
    // ERB 55-56: TIME += 5, then the command's H post-check may subtract 4.
    // The target's うふふ flag is already set, matching TRACHECK_TIME's
    // post-command CFLAG:TARGET:诶嘿嘿 check.
    const timeCost = applyOneMinuteHCommandTimeCorrection(next, 356, ctx.target, 5);
    advanceTimeTicks(next, timeCost);
    return {
      state: next,
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `把 %CALLNAME:TARGET% 邀进了阴暗处……` }],
      outcome: "ok", // RETURN 1
    };
  },
};

// ===========================================================================
// COMF357 セフレ契約 (reasonwall + success/failure settlement)
// ===========================================================================

const SEX_FRIEND_SENSITIVE_ROUTE_TARGET = 139;

function sexFriendContractPrompt(ctx: CommandContext) {
  const name = ctx.state.charas[ctx.target]?.callName ?? "对方";
  // The upstream ASK_YN returns button index (0/1), and this command orders
  // its buttons as 放弃 then 告白. A pick-one prompt preserves that exact
  // order and those return values without reversing the player's choice.
  return pickOne(
    `向${name}提议成为炮友。每天只能进行一次，成功后【思慕】将会消失。可以吗？`,
    [
      { id: 0, label: "放弃" },
      { id: 1, label: "告白" },
    ],
  );
}

export interface SexFriendContractJudgement {
  desireValue: number;
  reasonValue: number;
  personalReasonModifier: number;
  resentmentSource: number;
  /** Eiki's authored TFLAG:193 route result, when this command sets it. */
  commandBranch?: number;
}

/**
 * Build the COMF357 `欲望判定値` and `理性判定値` from COMF357.ERB.
 * The route additions are limited to active, mechanically meaningful
 * `SEX_FRIEND` hooks: Eiki's refusal/experience branches and Kagerou's
 * resentment + reasonwall. Target 139 is rejected before this function runs.
 */
export function calculateSexFriendContractJudgement(
  state: Readonly<GameState>,
  target: CharaSlot,
): SexFriendContractJudgement {
  const targetState = target.state;
  const targetAbl = targetState.ABL;
  const targetExp = targetState.EXP;
  const targetTalent = targetState.TALENT;
  const targetMark = targetState.MARK;
  const targetTvar = targetState.TCVAR;

  let desireValue =
    Math.min(targetAbl[ABL_ID.欲望] ?? 0, 10) * 50 +
    Math.min(targetAbl[ABL_ID.従順] ?? 0, 10) * 20 +
    Math.trunc(Math.min(targetExp[EXP_ID.絶頂経験] ?? 0, 5000) / 10) +
    getPalamLv(targetState.PALAM[PALAM_ID.欲情] ?? 0, 15) *
      (30 + (targetTalent[TALENT_ID.快感応答] ?? 0) * 10) +
    Math.max(targetMark[MARK_ID.快楽刻印] ?? 0, targetMark[MARK_ID.時姦刻印] ?? 0) * 200;
  if ((targetTvar[TCVAR_ID.発情] ?? 0) !== 0 || (targetTvar[TCVAR_ID.媚薬] ?? 0) !== 0) {
    desireValue += 300;
  }

  const master = state.master;
  const masterBase = master.state.BASE;
  const alcoholMax = master.state.MAXBASE[BASE_ID.酒気] ?? 0;
  let drunkenness = alcoholMax > 0
    ? Math.trunc(((masterBase[BASE_ID.酒気] ?? 0) * 100) / alcoholMax)
    : 0;
  if (drunkenness > 70) drunkenness *= 2;

  const consensualH = 1 << 1; // DIM_als.ERH: 合意_诶嘿嘿
  let reasonValue =
    1000 + Math.trunc((targetState.BASE[BASE_ID.理性] ?? 0) / 2) - drunkenness;
  if (((targetState.CFLAG[CFLAG_ID.既成事実] ?? 0) & consensualH) === 0) reasonValue += 300;
  if ((targetTalent[TALENT_ID.無知] ?? 0) !== 0) reasonValue -= 500;
  if ((targetTalent[TALENT_ID.自尊心] ?? 0) !== 0) {
    reasonValue += (targetTalent[TALENT_ID.自尊心] ?? 0) * 150;
  }
  if ((targetTalent[TALENT_ID.貞操] ?? 0) > 0) reasonValue += 200;
  if ((targetTalent[TALENT_ID.貞操] ?? 0) < 0) reasonValue -= 200;
  reasonValue += (targetMark[MARK_ID.反発刻印] ?? 0) * 100;
  if ((targetTalent[TALENT_ID.心情] ?? 0) < 0) reasonValue += 300;
  if ((targetTalent[TALENT_ID.処女] ?? 0) !== 0) reasonValue += 300;
  if ((targetTalent[TALENT_ID.倒錯的] ?? 0) !== 0) reasonValue -= 200;
  if ((master.state.TALENT[TALENT_ID.謎之魅力] ?? 0) !== 0) reasonValue -= 150;
  if ((master.state.TALENT[TALENT_ID.魅力] ?? 0) !== 0) reasonValue -= 150;
  if ((targetTalent[TALENT_ID.一線越えない] ?? 0) !== 0) reasonValue += 200;
  if (isOtokoGirai(target, master)) reasonValue += 300;
  if ((targetState.CFLAG[CFLAG_ID.体目当て] ?? 0) !== 0) reasonValue -= 400;

  let personalReasonModifier = 0;
  let resentmentSource = 0;
  let commandBranch: number | undefined;
  if (target.charaNum === 30) {
    // K30_CHECK_HEN_T(): DAY % 7 == 5, global fashion 62, or temporary outfit 62.
    const unusualTshirt =
      state.time.dayIndex % 7 === 5 ||
      (state.flagStore[FLAG_ID.ファッション] ?? 0) === 62 ||
      (targetState.CFLAG[CFLAG_ID.衣装一時変更] ?? 0) === 62;
    if (unusualTshirt) {
      personalReasonModifier = 9999;
      commandBranch = -1;
    } else if (
      (targetTalent[TALENT_ID.風騷] ?? 0) !== 0 ||
      (targetTalent[TALENT_ID.容易高潮] ?? 0) !== 0
    ) {
      personalReasonModifier = -5000;
      commandBranch = 3;
    } else if ((targetExp[EXP_ID.Ａ経験] ?? 0) >= 50) {
      personalReasonModifier = -200;
      commandBranch = 2;
    } else if ((targetExp[EXP_ID.無自覚Ａ経験] ?? 0) >= 50) {
      personalReasonModifier = -100;
      commandBranch = 1;
    } else {
      personalReasonModifier = 9999;
      commandBranch = -2;
    }
  } else if (target.charaNum === 63) {
    // Kagerou's authored correction also adds SOURCE:反感 += 5000.
    personalReasonModifier = 5000;
    resentmentSource = 5000;
  }

  if (personalReasonModifier !== 0) {
    reasonValue = Math.max(reasonValue + personalReasonModifier, 0);
  }
  return {
    desireValue,
    reasonValue,
    personalReasonModifier,
    resentmentSource,
    ...(commandBranch === undefined ? {} : { commandBranch }),
  };
}

export const comf357HandlerEntry: HandlerEntry = {
  commandNo: 357,
  displayCheck: (ctx) => ctx.target === SEX_FRIEND_SENSITIVE_ROUTE_TARGET
    ? { shown: false, tone: "hidden" }
    : { shown: true },
  prompt: sexFriendContractPrompt,
  execCheck: (ctx) => {
    if (ctx.target <= 0 || !targetSlot(ctx))
      return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if (!isCommandActionPhase(ctx.state))
      return { ok: false, reason: { kind: "precondition", message: "当前不在命令选择阶段。" } };
    const menuMode = getTflag(ctx.state, TFLAG_ID.COMABLE管理);
    if (menuMode !== 0 && menuMode !== 1)
      return { ok: false, reason: { kind: "precondition", message: "该命令只在日常命令页可用。" } };
    if (isHMode(ctx.state, ctx.target))
      return { ok: false, reason: { kind: "precondition", message: "调教中无法提出这项日常提议。" } };
    if ((ctx.state.flagStore[FLAG_ID.潜伏] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "潜伏中无法提出这项公开命令。" } };
    // The authored target-139 route contains sexualized minor content; keep
    // that character fail-closed instead of importing the route.
    if (ctx.target === SEX_FRIEND_SENSITIVE_ROUTE_TARGET)
      return { ok: false, reason: { kind: "precondition", message: "该角色的专属路线暂不支持此契约。" } };
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
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target];
    if (!target || ctx.target === SEX_FRIEND_SENSITIVE_ROUTE_TARGET) {
      const message = target
        ? "该角色的专属路线暂不支持此契约。"
        : "需要目标角色在场。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }
    const answer = requirePickOne(sexFriendContractPrompt(ctx), ctx.promptAnswer);
    if (answer === null) {
      const message = "需要先确认是否提出炮友契约。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }
    if (answer !== 1) return { state: next, events: [], outcome: "noop" };

    const judgement = calculateSexFriendContractJudgement(next, target);
    if (judgement.commandBranch !== undefined) {
      setTflag(next, TFLAG_ID.SELECTCOM的分岐, judgement.commandBranch);
    }
    const accepted = judgement.desireValue > judgement.reasonValue;
    const events: CommandResult["events"][number][] = [];
    if (judgement.personalReasonModifier !== 0) {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `评估结果：欲望 ${judgement.desireValue}，理性 ${judgement.reasonValue}。`,
      });
    }

    if (accepted) {
      target.state.TALENT[TALENT_ID.炮友] = 1;
      if ((next.flagStore[FLAG_ID.陥落路線変化] ?? 0) === 0) {
        target.state.TALENT[TALENT_ID.思慕] = 0;
      }
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${target.callName ?? "对方"}接受了这份炮友契约。`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${target.callName ?? "对方"}拒绝了这份提议……`,
      });
    }

    const resentment = judgement.resentmentSource + (accepted ? 0 : 1000);
    if (resentment > 0) {
      const settled = applySourceCheck(next, ctx.target, { [SOURCE_ID.反感]: resentment });
      events.push(...settled.events.map((event) => ({ ...event, timestamp: ctx.now() })));
    }
    // TRACHECK_TIME's −4 is folded into the COMF357 +10 before advancing, so
    // the clock sees one net movement and cannot emit a false day transition.
    advanceTimeTicks(next, applyOneMinuteHCommandTimeCorrection(next, 357, ctx.target, 10));
    return { state: next, events, outcome: "ok" };
  },
};

// ===========================================================================
// COMF358 他者変身 (shape-shift picker — RETURN 0 portrait toggle)
// ===========================================================================

function shapeShiftPrompt(ctx: CommandContext) {
  const target = targetSlot(ctx);
  const current = target?.state.CFLAG[CFLAG_ID.変化先] ?? 0;
  const currentName = current === 0
    ? "原来的样子"
    : ctx.state.charas[current]?.callName ?? `#${current}`;
  const characterOptions = Object.values(ctx.state.charas)
    .filter((chara) => Number.isInteger(chara.charaNum) && chara.charaNum > 0)
    .sort((a, b) => a.charaNum - b.charaNum)
    .map((chara) => ({ id: chara.charaNum, label: chara.callName ?? chara.name ?? `#${chara.charaNum}` }));
  return pickOne(
    `要变成谁？（现在：${currentName}）`,
    [
      ...characterOptions,
      { id: 998, label: "变回原样" },
      { id: 999, label: "果然还是算了" },
    ],
  );
}

export const comf358HandlerEntry: HandlerEntry = {
  commandNo: 358,
  prompt: shapeShiftPrompt,
  execCheck: (ctx) => {
    const t = targetSlot(ctx);
    if (!t) return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
    if (!isCommandActionPhase(ctx.state))
      return { ok: false, reason: { kind: "precondition", message: "当前不是指令选择阶段。" } };
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
      (t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法变身。" } };
    if ((t.state.TALENT[TALENT_ID.変化] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "目标没有变身能力。" } };
    if ((t.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0 && (t.state.TALENT[TALENT_ID.愛欲] ?? 0) === 0)
      return { ok: false, reason: { kind: "precondition", message: "需要恋慕或爱欲。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const selection = requirePickOne(shapeShiftPrompt(ctx), ctx.promptAnswer);
    if (selection === null) {
      const message = "需要先选择变身对象或取消。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }
    if (typeof selection !== "number") {
      const message = "变身对象编号无效。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }

    const target = next.charas[ctx.target];
    if (!target) {
      const message = "需要目标角色在场。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }

    const playerTcvar = next.master.state.TCVAR;
    const inserted = playerTcvar[TCVAR_ID.V挿入管理] === ctx.target ||
      playerTcvar[TCVAR_ID.A挿入管理] === ctx.target;
    if (inserted) {
      // Upstream calls 挿入不可(TARGET) before applying any selection. Its
      // size/knowledge formula is not modeled yet; fail closed so this picker
      // cannot bypass a real body-compatibility rejection.
      setTflag(next, TFLAG_ID.SELECTCOM的分岐, -1);
      const message = "插入状态下的体格差判断尚未移植，暂不执行变身。";
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: message }],
        outcome: "blocked",
        failReason: { kind: "precondition", message },
      };
    }

    const current = target.state.CFLAG[CFLAG_ID.変化先] ?? 0;
    const cancel = () => ({
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "取消了。" }],
      outcome: "noop" as const,
    });

    if (selection === 999) {
      return cancel();
    }

    if (selection === 998 || selection === ctx.target) {
      if (current === 0) return cancel();
      target.state.CFLAG[CFLAG_ID.変化元] = current;
      target.state.CFLAG[CFLAG_ID.変化先] = 0;
      setTflag(next, TFLAG_ID.COMABLE管理, 0);
      return {
        state: next,
        events: [{
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: `${target.callName ?? "目标角色"}恢复了原本的样貌。`,
        }],
        outcome: "noop",
      };
    }

    if (current === selection) return cancel();
    const newShape = next.charas[selection];
    if (!newShape || selection >= 998) return cancel();
    target.state.CFLAG[CFLAG_ID.変化元] = current;
    target.state.CFLAG[CFLAG_ID.変化先] = selection;
    setTflag(next, TFLAG_ID.COMABLE管理, 0);
    return {
      state: next,
      events: [{
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${target.callName ?? "目标角色"}化身为${newShape.callName ?? newShape.name ?? `#${selection}`}！`,
      }],
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
    const timeCost = applyOneMinuteHCommandTimeCorrection(next, 360, ctx.target, 5);
    advanceTimeTicks(next, timeCost); // ERB 14, then TRACHECK_TIME's −4.
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
    const timeCost = applyOneMinuteHCommandTimeCorrection(next, 361, ctx.target, 10);
    advanceTimeTicks(next, timeCost); // ERB 7, then TRACHECK_TIME's −9.
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
    // COM26/317/318 own the active insertion links, but 850 is the explicit
    // reverse-push exit. Settle history before removing those links, then
    // clear all transient H pose/clothing markers so 850 cannot leave a
    // hidden session behind for the next command.
    for (const slot of Object.values(next.charas)) {
      for (const site of activeHInsertionSites(next, slot.charaNum)) {
        settleHInsertionHistory(next, slot.charaNum, site);
      }
    }
    const clearedEdging = clearHInteractionState(next);
    clearTrainingMode(next);
    // ERB 123: TIME += 5.
    advanceTimeTicks(next, 5);
    const who = affected.length > 1 ? "她们" : "%CALLNAME:TARGET%";
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: `一边抚慰着${who}一边拔了出来。` },
        ...(clearedEdging > 0
          ? [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "训练结束，未吸收的寸止积累已清除。" }]
          : []),
      ],
      outcome: "ok", // RETURN 1
    };
  },
};
