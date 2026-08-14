/**
 * Slice O3 — COMF699 外に出る (leave private room).
 *
 * Modern equivalent of `@COM699` (`ERB/コマンド関連/COMF/外出系/COMF699外に出る.ERB`).
 * Faithful to the gate + the no-GAP-GUEST / no-瞬移 single-target exit
 * branch (ERB 33-89).
 *
 * Reachability (`@COM_ABLE699`):
 *   - `!BASE:MASTER:気力 <= 0`
 *   - `!NEMUKE() >= 720 && IsRefreshed() && !M_FLAG:隙间标记` (no 終電)
 *   - `CFLAG:MASTER:現在位置 == OMANEKIBEYA()` (must be in the guest room)
 *   - `!CFLAG:MASTER:陪睡中` / `!恶作剧` / `!诶嘿嘿` / `!FLAG:70` (時停)
 *
 * **Execution**: `omanekiLeave(state)` — clears 招待 on both, moves them
 * back to home (master → `state.homeLocation`; target → master's choice
 * via `omanekiLeave`).
 *
 * **Deferred (faithful, not silent stubs)**:
 *   - `IS_GAP_GUEST(MASTER)` branch (ERB 8-32) — magic gap guest mode is a
 *     DLC-flagged feature; the MVP skip branch always wins.
 *   - `M_TFLAG:瞬移中` exit destination override.
 *   - `MOREDATES_HOUSE_EXIT(出口)` arm (多人约会).
 *   - `MAGIC_DLC` 隙间标记 + 連動角色 exit-per-chara loop (ERB 53-77).
 *   - RAND:9 fallback destination picker (ERB 37-45) — replaced with a
 *     single deterministic return to `state.homeLocation` so the trial
 *     is reproducible. The upstream randomised 出口 is upstream's
 *     "where do you pop out" model; the MVP chooses a stable home.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  getMasterCflag,
} from "../../state/settlement.js";
import { omanekiLeave, OMANEKI_PLACE } from "../../world/omaneki.js";
import { endOdekakeIfReturningHome } from "../../world/odekake.js";

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

function check699Eligible(
  state: Readonly<GameState>,
  actor: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("退室は主人公だけが実行できます。");
  if ((state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
    return block("気力が残っていません。");
  }
  // 終電 (NEMUKE() >= 720): 720 min = 12 h awake. MVP uses the master's
  // wake-minute (masterWakeMinute) as a stand-in for the upstream
  // @NEMUKE() sleep-stamp comparison; a missing masterWakeMinute = 8:00
  // wake → awake-window opens to 20:00. The MVP shortcut just blocks when
  // the master has been awake for >= 720 ticks since sleep.
  if (state.masterWakeMinute !== undefined) {
    const awakeMinutes = (state.time.tickValue % 1440) - state.masterWakeMinute;
    if (awakeMinutes >= 720) {
      return block("もう終電です。");
    }
  }
  if (state.master.location !== OMANEKI_PLACE) {
    return block("待客室にいません。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.陪睡中) !== 0) {
    return block("陪睡中です。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.恶作剧) !== 0) {
    return block("恶作剧中です。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) !== 0) {
    return block("诶嘿嘿中です。");
  }
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return block("時間停止中です。");
  }
  return { ok: true };
}

export const omaneki699HandlerEntry: HandlerEntry = {
  commandNo: 699,
  execCheck: (ctx) => check699Eligible(ctx.state, ctx.actor),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const r = omanekiLeave(next);
    // O4: omanekiLeave drops the master at `state.homeLocation`. If that
    // is a MAIN_MAP room (the typical "go home after the visit" path),
    // the in-progress date also ends — faithful to upstream 699's
    // `CFLAG:MASTER:约会中 = 出口/100` (出口=MAIN_MAP → 约会中=0).
    // When homeLocation is a date-map room (player lives in 人間の里), the
    // date continues, matching upstream.
    const endedDate = endOdekakeIfReturningHome(next, next.master.location);
    const partnerName = r.exitedFromTarget > 0
      ? next.charas[r.exitedFromTarget]?.callName ?? `#${r.exitedFromTarget}`
      : null;
    const base = partnerName
      ? `${partnerName}の部屋を後にした。`
      : "待客室を出た。";
    const text = endedDate ? `${base} 约会结束了。` : base;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }],
      outcome: "ok" as const,
    };
  },
};
