/**
 * Phase 7.5 — `COMF436 読書` (read a book), a bespoke B9-picker command.
 *
 * Faithful port of `@COM436` / `@COM_ABLE436`
 * (`ERB/コマンド関連/COMF/日常系/COMF436 読書.ERB`).
 *
 * **B9 picker → outcome (ERB 14-63, non-DLC):** the player picks a book
 * type (0=文学 / 1=实用书 / 2=小黄书 / 3=中止). The type drives a `RAND:10`
 * (or `RAND:9` for 小黄书) roll that sets `TFLAG:193` (成功分岐) to a
 * specific book-tier:
 *   - 文学: 1=忍者杀手(1/10) / 2=失敗(3/10) / 3=文学(6/10)
 *   - 実用: 4=失敗(3/10) / 5=実用(7/10)
 *   - 小黄书: 6=小薄本(3/9) / 7=保健体育(3/9) / 8=印度爱经(3/9)
 * 中止 (3) → `outcome: "noop"` (RETURN -1).
 *
 * **EXP by TFLAG:193 (ERB 191-232):**
 *   - 1 (忍者杀手): `EXP:戦闘経験 += 5`
 *   - 3 (文学): `EXP:学習経験 += 1`
 *   - 5 (実用): `RAND:7` → one of 会話/撮影/料理/釣り/採集/調合/伐採経験 += 1
 *   - 6 (小薄本): `RECOVER 精力+100 / 勃起+100`
 * `READING_EXP` (DLC 等級重置) is 1 base; the `+ABL:教養` DLC arm is
 * deferred → READING_EXP stays 1.
 *
 * **SOURCE (TARGET present, ERB 322-357):** `SOURCE:歓楽 = 200` + 従順
 * ladder + 好感度 ladder (the SAME shape as 会話/摸頭); `TFLAG:信頼度管理
 * = 3` (non-DLC). Settled via `applySourceCheck` (PALAM + 好感度 + 信頼).
 *
 * **Cost (ERB 359-369):** `DOWNBASE:体力 = 50`, `DOWNBASE:気力 = 200`;
 * `TIME += 60` (or `+45` if `IS_WISEMAN` — 贤者タイム,精力 depleted).
 *
 * **execCheck (`@COM_ABLE436`, ERB 377-407):** `TFLAG:100` (deferred→set),
 * `GLOBAL_COMABLE` (deferred→pass), 约会道中 block, 陪睡中 block, 诶嘿嘿
 * block, `気力<=0` block, `!IS_LIBRARY(現在位置)` block, 睡眠 block,
 * 時間停止 block. IS_LIBRARY for the shrine = the 夢幻遺跡 3 資料/研究室
 * (PLACE_STUDY, ROOMSETTING_0:202-204 素通し).
 *
 * **DEFERRED (documented):**
 *   - MAGIC_DLC arms: 魔导书 picker option (RESULT==3→M_TFLAG:魔导书),
 *     禁断的知識 / BUFF_BASE 法力 / GACHAPON_MAGIC, COM_ALTER_436 preset.
 *   - 帕秋莉 (TARGET==54) 同室 bonus events (TFLAG:194=1/2, ERB 135-189).
 *   - 約會経験 (IS_DATING_WITH_PLAYER, ERB 353-356).
 *   - READING_EXP += ABL:教養 (DLC 等級重置, ERB 8-12).
 *   - 小薄本 RECOVER (ERB 230-232) — RECOVER helper deferred; modeled as
 *     direct BASE add (精力+100, 勃起+100) on the master.
 *   - IS_WISEMAN 祈願内容==201 arm (deferred); only the 精力-depleted arm.
 *   - HAS_PENIS gate on IS_WISEMAN (deferred → treated as false → TIME+60).
 *   - M_TFLAG:时间因子类型 (time-factor categorization, no consumer).
 *   - 図書館 (P310) + off-shrine IS_LIBRARY rooms (multi-map).
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  advanceTimeTicks,
  getMasterBase,
  getMasterCflag,
  setMasterBase,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Book-type picker (文学/实用书/小黄书/中止). */
function bookPrompt(): PromptSpec {
  return pickOne("要读什么？", [
    { id: 0, label: "文学", detail: "文学书（TIME+60）" },
    { id: 1, label: "实用书", detail: "实用书（TIME+60）" },
    { id: 2, label: "小黄书", detail: "小黄书（TIME+60）" },
    { id: 3, label: "中止", detail: "不读了" },
  ]);
}

/**
 * `IS_LIBRARY(現在位置)` — a dedicated library-room predicate (NOT the same
 * as 勉強可/場所_学习). Upstream `@IS_LIBRARY` (COMF436:413-591) whitelists
 * specific 資料室/書斎 rooms per map; the shrine trial-reachable set is the
 * 夢幻遺跡 three (P48/P49/P50, all 素通し). 居間 has 場所_学习 (so 412 勉強
 * works there) but is NOT a library → 436 読書 blocks there, faithful.
 */
const SHRINE_LIBRARY_ROOMS = new Set([
  "神社:夢幻遺跡・第一資料室",
  "神社:夢幻遺跡・研究室",
  "神社:夢幻遺跡・第二資料室",
]);

function isLibrary(location: string): boolean {
  return SHRINE_LIBRARY_ROOMS.has(location);
}

/** `IS_WISEMAN()` (ERB 184-190) — 精力 depleted (×10 ≤ MAX). HAS_PENIS +
 *  祈願内容==201 arms deferred → only the 精力 arm, gated on HAS_PENIS
 *  (deferred → false → never wise in trial, faithful to a non-DLC start). */
function isWiseman(state: GameState): boolean {
  // HAS_PENIS deferred → return false (a fresh trial master is not 贤者).
  // Kept as a function so the DLC arm can plug in later.
  void state;
  return false;
}

/**
 * The RAND:10/9 book-tier roll (ERB 22-60). Returns the TFLAG:193 tier.
 * `rng.int(n)` models `RAND:n` ∈ [0,n).
 */
export function rollBookTier(
  bookType: 0 | 1 | 2,
  rng: { int: (n: number) => number },
): number {
  if (bookType === 0) {
    // 文学: 0→1(忍殺) / 1-3→2(失敗) / else→3(文学)
    const r = rng.int(10);
    if (r === 0) return 1;
    if (r <= 3) return 2;
    return 3;
  }
  if (bookType === 1) {
    // 実用: 0-2→4(失敗) / else→5(実用)
    const r = rng.int(10);
    if (r <= 2) return 4;
    return 5;
  }
  // 小黄书: RAND:9 → 6/7/8 (each 3/9)
  const r = rng.int(9);
  if (r <= 2) return 6;
  if (r <= 5) return 7;
  return 8;
}

/** Book title for narration by TFLAG:193 tier (ERB 144-159). */
function bookTitle(tier: number): string {
  switch (tier) {
    case 1: return "『忍者杀手』";
    case 2: case 3: return "文艺书";
    case 4: case 5: return "实用书";
    case 6: return "小薄本";
    case 7: return "保健体育课本";
    case 8: return "『印度爱经』";
    default: return "书";
  }
}

/** 実用书 RAND:7 EXP pick (ERB 199-228). Returns the EXP_ID to grant. */
function practicalExpPick(rng: { int: (n: number) => number }): number {
  const r = rng.int(7);
  switch (r) {
    case 0: return EXP_ID.会話経験;
    case 1: return EXP_ID.撮影経験;
    case 2: return EXP_ID.料理経験;
    case 3: return EXP_ID.釣り経験;
    case 4: return EXP_ID.採集経験;
    case 5: return EXP_ID.調合経験;
    default: return EXP_ID.伐採経験;
  }
}

/**
 * SOURCE:歓楽 build (ERB 322-357) — 200 + 従順 ladder + 好感度 ladder.
 * (親密 is NOT in the 436 ladder — only 従順 + 好感度; distinct from 会話/摸頭.)
 * Pure for tests.
 */
export function buildReadingSources(
  juju: number,
  favor: number,
): Record<number, number> {
  let kanraku = 200;
  // 従順 ladder (ERB 329-341).
  if (juju <= 1) kanraku += juju * 80;
  else if (juju <= 3) kanraku += 300 + juju * 80;
  else if (juju <= 5) kanraku += 700 + juju * 80;
  else if (juju <= 8) kanraku += 950 + juju * 100;
  else if (juju <= 11) kanraku += 1200 + juju * 90;
  else kanraku += 2000 + juju * 50;
  // 好感度 ladder (ERB 344-350).
  if (favor <= 500) kanraku += favor * 2;
  else if (favor <= 5000) kanraku += 1000 + Math.trunc((favor - 500) / 2);
  else kanraku += 5000 + Math.trunc((favor - 5000) / 3);
  kanraku = clamp(kanraku, 0, Number.MAX_SAFE_INTEGER);
  return { [SOURCE_ID.歓楽]: kanraku };
}

function checkEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 387: 约会道中 → block. TFLAG:约会道中 deferred → 0 → pass.
  // ERB 390: 陪睡中 → block.
  if (getMasterCflag(state, CFLAG_ID.陪睡中) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "陪睡中不能读书。" } };
  }
  // ERB 393: 诶嘿嘿 → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是读书的时候。" } };
  }
  // ERB 396: 気力 <= 0 → block.
  if (getMasterBase(state, BASE_ID.気力) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有气力读书。" } };
  }
  // ERB 399: !IS_LIBRARY(現在位置) → block.
  if (!isLibrary(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有可读的书。" } };
  }
  // ERB 402: 睡眠 → block.
  if (getMasterCflag(state, CFLAG_ID.睡眠) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡觉中不能读书。" } };
  }
  // ERB 405: 時間停止 → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能读书。" } };
  }
  return { ok: true };
}

export const readingHandlerEntry: HandlerEntry = {
  commandNo: 436,
  prompt: (_ctx) => bookPrompt(),
  execCheck: (ctx) => {
    const r = checkEligible(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);

    // B9: read the book-type pick.
    const spec = bookPrompt();
    const picked = requirePickOne(spec, ctx.promptAnswer);
    const bookType = typeof picked === "number" ? (picked as 0 | 1 | 2 | 3) : undefined;
    // 中止 (3) or no pick → RETURN -1 (noop).
    if (bookType === undefined || bookType === 3) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有读书。" }],
        outcome: "noop" as const,
      };
    }

    // RAND book-tier → TFLAG:193 (ERB 22-60).
    const tier = rollBookTier(bookType, ctx.rng);
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, tier);

    // EXP / recovery by tier (ERB 191-232).
    const master = next.master;
    const addExp = (id: number, n: number) => {
      master.state.EXP[id] = (master.state.EXP[id] ?? 0) + n;
    };
    if (tier === 1) {
      addExp(EXP_ID.戦闘経験, 5); // 忍者杀手
    } else if (tier === 3) {
      addExp(EXP_ID.学習経験, 1); // 文学
    } else if (tier === 5) {
      addExp(practicalExpPick(ctx.rng), 1); // 実用 → one of 7
    } else if (tier === 6) {
      // 小薄本: RECOVER 精力+100 / 勃起+100 (ERB 230-232). RECOVER helper
      // deferred → direct BASE add (no MAXBASE clamp; faithful to RECOVER's
      // clamping which we approximate—deferred cap).
      setMasterBase(next, BASE_ID.精力, getMasterBase(next, BASE_ID.精力) + 100);
      setMasterBase(next, BASE_ID.勃起, getMasterBase(next, BASE_ID.勃起) + 100);
    }

    // DOWNBASE 体力 50 / 気力 200 (ERB 359-360).
    setMasterBase(next, BASE_ID.体力, getMasterBase(next, BASE_ID.体力) - 50);
    setMasterBase(next, BASE_ID.気力, getMasterBase(next, BASE_ID.気力) - 200);

    // SOURCE:歓楽 + 信頼 (TARGET present, ERB 322-357).
    let favorDelta = 0;
    const target = ctx.target > 0 ? next.charas[ctx.target] : undefined;
    if (target && (getMasterCflag(next, CFLAG_ID.行动) ?? 0) !== 5) {
      const juju = target.state.ABL[ABL_ID.従順] ?? 0;
      const favor = target.state.CFLAG[CFLAG_ID.好感度] ?? 0;
      const sources = buildReadingSources(juju, favor);
      // TFLAG:信頼度管理 = 3 (non-DLC, ERB 326) → trustSeed.
      setTflag(next, TFLAG_ID.信頼度管理, 3);
      const settled = applySourceCheck(next, ctx.target, sources, 0, 3);
      favorDelta = settled.favorDelta;
    }

    // TIME += 60 (or +45 if 贤者タイム, ERB 362-369).
    const wise = isWiseman(next);
    advanceTimeTicks(next, wise ? 45 : 60);

    const wiseNote = wise ? "（烦恼消失，学习效率提高）" : "";
    const favorNote = favorDelta !== 0 ? `（好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}）` : "";
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `${master.callName ?? "主人公"}把书架上的${bookTitle(tier)}拿下读了起来。${wiseNote}${favorNote}`.trim(),
        },
      ],
      outcome: "ok" as const,
    };
  },
};
