/**
 * Phase 7 (Wave 2b) — casino / gambling minigame command MVP stubs.
 *
 * Ports the **portable** parts of `@COM631/632/633/634` and defers the
 * minigame loops, per the approved plan's minigame posture: "MVP 结算桩
 * (faithful state-change + placeholder gameplay, NOT full interactive
 * port)". Read each `COMF<NNN>.ERB` (utf-8-sig) first.
 *
 * **Common shape.** Each command's `@COM_ABLE` gates on a **location not
 * yet built** in the runtime (红魔館 大廳 309 / 戦闘訓練可 spot / 三途之川 /
 * 秘天崖 739) plus portable gates (時間停止 / 睡眠 / 気力 / 行動 / 诶嘿嘿 /
 * time window). The location gate defers → all four are **live-
 * unreachable** (like 364/441); the MVP settlement is pinned by direct-
 * call tests bypassing execCheck.
 *
 * - **COMF631 紅魔カジノ** — `@COM631`: `TFLAG:赌场入場時筹码 = MONEY:2`
 *   (chips snapshot, DEFERRED — no MONEY:2/chips model) + `CALL
 *   CASINO_ENTRANCE` (the casino loop, DEFERRED) + `TIME += 10`. MVP:
 *   `TIME += 10` + NARRATION. execCheck: 時間停止 / CASINO_SPOT(309)
 *   location (defer) / `TFLAG:妄想中` (defer) / `NEMUKE() >= 700`
 *   (defer — 睡意 not modeled).
 * - **COMF632 組み手** — `@COM632`: `CALL ASK_M(...)` (B9 enemy-strength
 *   picker) + `CALL BATTLE_SYSTEM(RESULT)` (the battle, DEFERRED). The
 *   picker only feeds the deferred battle, so both defer. MVP: NARRATION
 *   (no portable state change — the body's only effect is the battle).
 *   execCheck: `TFLAG:100` / 時間停止 / `CFLAG:行動==5` / `戦闘訓練可`
 *   location (defer) / `気力<=0` / `诶嘿嘿==2`.
 * - **COMF633 積み石コンテスト** — `@COM633` is ~200 lines of `STONE_*`
 *   save-variable minigame (受付水子 pregnancy, 周回数 reset, ASK_YN
 *   称号 inheritance, `@Stone_Entry` contest). All `STONE_*` + the contest
 *   DEFERRED. MVP: NARRATION. execCheck: `INRANGE(TIME,480,1080)` time
 *   window (portable) / location 三途之川·602 (defer) / 約会中 target
 *   match (defer) / 睡眠 / 時間停止.
 * - **COMF634 賭場を探す** — `@COM634`: `CALL TOBA_SETUP` + `CALL
 *   賭場_導入` (the gambling loop, DEFERRED) + `TIME += 10`. MVP:
 *   `TIME += 10` + NARRATION. execCheck: `TOBA_PLACE(739)` location
 *   (defer) / `TFLAG:妄想中` (defer) / 時間停止 / `NEMUKE() >= 700`
 *   (defer).
 *
 * **DEFERRED (documented):** MONEY:2 chips namespace; `TFLAG:妄想中`;
 * `NEMUKE()` 睡意; `CASINO_ENTRANCE` / `BATTLE_SYSTEM` / `Stone_Entry`
 * contest / `TOBA_SETUP`·`賭場_導入` minigame loops; the four location
 * maps (红魔館/戦闘訓練可 spot/三途之川/秘天崖); `GLOBAL_COMABLE`.
 */
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { ensureStoneContestClerk } from "../../world/dynamic-characters.js";
import { ensureStoneContestProgress, openStoneContestLobby } from "../../state/stone-contest.js";

type Blocked = { ok: false; reason: { kind: "precondition"; message: string } };

/** TRUE if `tickValue` is in ERA `INRANGE(TIME, lo, hi)` = [lo, hi] inclusive. */
function timeInRange(tickValue: number, lo: number, hi: number): boolean {
  return tickValue >= lo && tickValue <= hi;
}

const LOC_DEFER = (spot: string): Blocked => ({
  ok: false,
  reason: { kind: "precondition", message: `${spot} は未実装の地図（赌场/积石场地未导入）。` },
});

// ---------------------------------------------------------------------------
// COMF631 紅魔カジノ
// ---------------------------------------------------------------------------

export const comf631HandlerEntry: HandlerEntry = {
  commandNo: 631,
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "時間停止中はできない。" } };
    // CASINO_SPOT(309 红魔館 大廳) — location not built.
    return LOC_DEFER("紅魔館 大廳");
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // TFLAG:赌场入場時筹码 = MONEY:2 (chips snapshot) — DEFERRED (no MONEY:2).
    // CALL CASINO_ENTRANCE (casino loop) — DEFERRED.
    advanceTimeTicks(next, 10); // ERB: TIME += 10.
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: "%CALLNAME:MASTER%は紅魔CASINOへ足を運んだ（カジノ本体は未実装）。" },
      ],
      outcome: "ok",
    };
  },
};

// ---------------------------------------------------------------------------
// COMF632 組み手 (battle trial)
// ---------------------------------------------------------------------------

export const comf632HandlerEntry: HandlerEntry = {
  commandNo: 632,
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "時間停止中はできない。" } };
    const m = ctx.state.master;
    if ((m.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5)
      return { ok: false, reason: { kind: "precondition", message: "仕事中はできない。" } };
    if ((m.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2)
      return { ok: false, reason: { kind: "precondition", message: "诶嘿嘿中はできない。" } };
    if ((m.state.BASE[BASE_ID.気力] ?? 0) <= 0)
      return { ok: false, reason: { kind: "precondition", message: "気力が足りない。" } };
    // 戦闘訓練可(現在位置) — training-allowed spot not built.
    return LOC_DEFER("戦闘訓練可スポット");
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // CALL ASK_M (enemy-strength picker) + CALL BATTLE_SYSTEM — DEFERRED.
    // The body's only effect is the battle; no portable state change.
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: "戦闘体験版（BATTLE_SYSTEM は未実装）。" },
      ],
      outcome: "ok",
    };
  },
};

// ---------------------------------------------------------------------------
// COMF633 積み石コンテスト
// ---------------------------------------------------------------------------

export const comf633HandlerEntry: HandlerEntry = {
  commandNo: 633,
  gateStatus: "complete",
  gateDiagnostics: ["08:00-18:00", "彼岸/賽の河原", "date partner", "awake", "not time-stopped"],
  execCheck: (ctx) => {
    const minute = ((ctx.state.time.tickValue % 1440) + 1440) % 1440;
    if (!timeInRange(minute, 480, 1080))
      return { ok: false, reason: { kind: "precondition", message: "积石竞赛仅在 08:00–18:00 开放。" } };
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中不能参加积石竞赛。" } };
    if ((ctx.state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "睡眠中不能参加积石竞赛。" } };
    if (ctx.state.sleepSession)
      return { ok: false, reason: { kind: "precondition", message: "请先结束睡眠流程。" } };
    if (ctx.state.stoneContestSession)
      return { ok: false, reason: { kind: "precondition", message: "积石竞赛已经进行中。" } };
    if (!["彼岸", "彼岸:彼岸", "彼岸:賽の河原"].includes(ctx.state.master.location))
      return { ok: false, reason: { kind: "precondition", message: "只有在彼岸或賽之河原才能参加积石竞赛。" } };
    if (ctx.state.dateSession?.phase === "active" && ctx.target !== ctx.state.dateSession.partner)
      return { ok: false, reason: { kind: "precondition", message: "约会中必须与约会对象一起参加。" } };
    return { ok: true };
  },
  handler: (ctx) => {
    let next = cloneGameState(ctx.state);
    const clerk = ensureStoneContestClerk(next);
    const progress = ensureStoneContestProgress(next);
    progress.clerkCharaNum = clerk.charaNum;
    progress.clerkName = clerk.callName ?? progress.clerkName;
    const partner = next.dateSession?.phase === "active" ? next.dateSession.partner : 0;
    next = openStoneContestLobby(next, partner, ctx.rngSeed ?? ctx.rng.int(0x7fffffff));
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: "积石赛受付员拉开木牌门帘，左右两条积石赛道映入眼帘。" },
      ],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF634 賭場を探す
// ---------------------------------------------------------------------------

export const comf634HandlerEntry: HandlerEntry = {
  commandNo: 634,
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "時間停止中はできない。" } };
    // TOBA_PLACE(739 秘天崖) — location not built.
    return LOC_DEFER("秘天崖");
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    // CALL TOBA_SETUP + CALL 賭場_導入 (gambling loop) — DEFERRED.
    advanceTimeTicks(next, 10); // ERB: TIME += 10.
    return {
      state: next,
      events: [
        { kind: "NARRATION", timestamp: ctx.now(), text: "%CALLNAME:MASTER%は賭場に足を踏み入れた（賭場本体は未実装）。" },
      ],
      outcome: "ok",
    };
  },
};
