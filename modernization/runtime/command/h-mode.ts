/**
 * Phase 8 (Slice 9) — H-mode (うふふ) command visibility.
 *
 * eraTW does NOT show sexual commands on the everyday command page. The
 * foreplay / toy / position / service / SM / solo families only surface once
 * the player has entered うふふ (CFLAG:诶嘿嘿) — typically via 350 押し倒す or
 * 356 物陰に誘う, which set the flag and have their own `@COM_ABLE` entry
 * gates. Even inside うふふ, individual acts carry their own gates (e.g.
 * 317/318 腰を動かす require an insertion flag) — so "enter 調教" does not
 * immediately unlock every position, faithfully.
 *
 * Most of these commands are `ComfDef`-factory ports that currently have no
 * `execCheck` (the per-command `@COM_ABLE` is backfilled family-by-family).
 * Without an H-mode guard they would show as usable whenever any target is
 * present — i.e. 正常位 (60) on the everyday page. That is the bug this
 * module fixes: a collective "is this a うふふ-only command?" predicate the
 * UI availability filter applies on top of each command's own gate.
 *
 * The H-mode *entry* commands (350 押し倒す / 356 物陰に誘う / the rest of the
 * 350-368 family7 cluster) are intentionally NOT うふふ-gated — they are how
 * you ENTER うふふ, so they must be reachable from the everyday page (their
 * own execCheck decides when). The 310-323 セクハラ/affection-touch range is
 * everyday-page except COM314, which the modern H page intentionally gates.
 *
 * **Partner-led (逆推) exception (P1-14 follow-up):** 317/318 腰を動かす,
 * 360 身を任せる / 361 抵抗する, and 850 抜け出す require the partner-led
 * 诶嘿嘿==2 flag and ARE うふふ-only — enumerated explicitly in
 * `requiresHMode` even though they sit inside otherwise-everyday ranges.
 */

import type { GameState } from "../state/game-state.js";
import { isPlayerDisabledCommand } from "./player-command-policy.js";
import { BASE_ID, CFLAG_ID, FLAG_ID, TALENT_ID } from "../state/settlement.js";

export function initializeHEjaculationGauge(
  state: GameState,
  target: number,
): void {
  const slots = [state.master, state.charas[target]].filter(
    (slot): slot is NonNullable<typeof slot> => Boolean(slot),
  );
  for (const slot of slots) {
    if (((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) continue;
    slot.state.MAXBASE ??= {};
    if ((slot.state.MAXBASE[BASE_ID.射精] ?? 0) <= 0) {
      slot.state.MAXBASE[BASE_ID.射精] =
        slot.charaNum === state.master.charaNum &&
        (slot.state.TALENT[TALENT_ID.精力超群] ?? 0) !== 0
          ? 5000
          : 10000;
    }
    slot.state.BASE[BASE_ID.射精] ??= 0;
  }
}

/**
 * Whether time-stop (時間停止, FLAG:70) is active. A global flag the player
 * enters via COMF355 時間停止. Exposed namespace-free so the UI status bar
 * can show a "時間停止中" indicator without spelling the FLAG token
 * (Parity QA P-4). Many `@COM_ABLE` gates also branch on it.
 */
export function isTimeStopped(state: Readonly<GameState>): boolean {
  return (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
}

/**
 * Command-number ranges that are うふふ-only sex acts. Mirrors the upstream
 * "only shown during 調教" families. Excludes the 350-368 entry cluster and
 * the 310-323 everyday-touch range (see module doc), with explicit H-only
 * exceptions: 314 肛門愛撫 by H-session routing, plus partner-led (逆推,
 * 诶嘿嘿==2) acts 317/318, 360/361, and 850.
 */
export function requiresHMode(commandNo: number): boolean {
  if (commandNo >= 0 && commandNo <= 26) return true; // foreplay sex acts (キス継続/ピロートーク/二穴愛撫/抜く…)
  if (commandNo >= 40 && commandNo <= 51) return true; // 玩具 (ローター/バイブ/避妊薬…)
  if (commandNo >= 60 && commandNo <= 79) return true; // 体位・性交 (正常位/後背位/腰を動かす/小人…)
  if (commandNo >= 80 && commandNo <= 96) return true; // 奉仕 (フェラ/パイズリ…)
  if (commandNo >= 100 && commandNo <= 150) return true; // ＳＭ (イラマチオ/フィスト/放尿/拡張…)
  if (commandNo >= 180 && commandNo <= 192) return true; // 特殊装備 (助手を犯す 等 SM-adjacent)
  if (commandNo >= 700 && commandNo <= 751) return true; // 自慰系
  // H-only commands inside otherwise-everyday ranges.
  if (commandNo === 314) return true; // H-session routing for COM314.
  if (commandNo === 317 || commandNo === 318) return true;
  if (commandNo === 360 || commandNo === 361 || commandNo === 850) return true;
  if (commandNo === 826) return true; // USERCOM.ERB:826 挑逗 toggle
  return false;
}

/** 433 owns a separate self-pleasure session.  Its 700–751 commands are
 *  still H-family commands in the catalogue, but the active CFLAG:346 latch
 *  is an independent legal entry path and does not require a partner slot. */
export function isSelfPleasureCommand(commandNo: number): boolean {
  return commandNo >= 700 && commandNo <= 751;
}

export function isSelfPleasureSessionActive(
  state: Readonly<GameState>,
): boolean {
  return (state.master.state.CFLAG[CFLAG_ID.现在忙得抽不出手] ?? 0) !== 0;
}

/** Commands exposed by upstream Act_COM in a clean H state. Commands outside
 * this set require an explicit command-level `hModeMenuCheck`; this prevents
 * unmodelled insertion/equipment/position predicates from failing open. */
export const H_MODE_CLEAN_BASELINE_COMMANDS: ReadonlySet<number> = new Set([
  0, 1, 6, 7, 9, 11, 12, 15, 20, 21, 22, 90, 127, 490, 820, 821, 999,
]);

export function isCleanHModeBaselineCommand(commandNo: number): boolean {
  return H_MODE_CLEAN_BASELINE_COMMANDS.has(commandNo);
}

/** Shared menu/execution gate for commands that upstream routes through the
 * `TFLAG:102 == 2` training branch. Keeping this in runtime prevents callers
 * from bypassing the Act_COM UI and executing an intimate command directly. */
export function hModeBlockReason(
  state: Readonly<GameState>,
  target: number,
  commandNo: number,
): string | undefined {
  if (isPlayerDisabledCommand(commandNo)) return "该指令已从玩家菜单停用。";
  if (isSelfPleasureCommand(commandNo) && target > 0 && isHMode(state, target)) {
    return "主角自我动作请在独立自我会话中使用。";
  }
  // Movement and sleep are everyday commands, so they do not belong to the
  // sex-command ranges above. They still must not bypass an active H session
  // through a direct intent while the UI is hiding them from Act_COM.
  if (commandNo === 400 || commandNo === 402) {
    const activeSession = state.training !== undefined && state.training !== null;
    const activeLegacyH = Object.values(state.charas).some((slot) => isHMode(state, slot.charaNum));
    if (activeSession || activeLegacyH) return "调教中不能移动或就寝。";
  }
  if (!requiresHMode(commandNo)) return undefined;
  if (isHMode(state, target)) return undefined;
  if (isSelfPleasureCommand(commandNo) && isSelfPleasureSessionActive(state)) {
    return undefined;
  }
  return "该指令只能在调教状态中使用。";
}

/**
 * Whether うふふ (H-mode) is currently active for the master + focused
 * target. eraTW sets `CFLAG:诶嘿嘿` on BOTH master and target when entering
 * うふふ (COMF356 ERB 40-41); we treat either being set as "in H-mode" so a
 * half-set state still surfaces the acts. `target <= 0` (no focused NPC) →
 * never H-mode (sex acts require a partner).
 */
export function isHMode(state: Readonly<GameState>, target: number): boolean {
  if (target <= 0) return false;
  const session = state.training;
  if (session && session.target !== target) return false;
  const slot = state.charas[target];
  if (!slot) return false;
  if (slot.location !== state.master.location) return false;
  if (session?.target === target) return true;
  return (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 &&
    (slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0;
}

/**
 * Enter うふふ (H-mode) on both master + target — the state write COMF356
 * 物陰に誘う / COMF350 押し倒す perform (ERB 40-41: set 诶嘿嘿 on both).
 * Exposed so tests / debug tooling can flip H-mode WITHOUT touching the
 * legacy namespace from the UI layer (the `web/app` forbidden-names guard
 * keeps `CFLAG` out of authored UI code). Real gameplay enters H-mode via
 * the 350/356 commands; this helper is for setup/verification only.
 */
export function enterHMode(state: GameState, target: number): void {
  if (target <= 0) return;
  const slot = state.charas[target];
  if (!slot || slot.location !== state.master.location) return;
  state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] = 1;
  slot.state.CFLAG[CFLAG_ID.诶嘿嘿] = 1;
  initializeHEjaculationGauge(state, target);
}
