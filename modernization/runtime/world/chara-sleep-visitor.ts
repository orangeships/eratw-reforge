/**
 * P1-#5 Slice D — `@SLEEP_VISITOR(ARG)` (SLEEP.ERB:359-411) +
 * `@拠点から返回(ARG)` (SLEEP.ERB:416-449) port.
 *
 * Upstream `@SLEEP_VISITOR` (53 lines): 4 mutually exclusive branches
 * for a 拠点来訪 (visiting) chara going to bed.
 *   1. CHK_DATENOW(约会中) && master.location != OMANEKIBEYA() →
 *      约会中帰宅 (mid-date return): clear 同行 + 约会中 + 旗 + 帰宅口上 arm 2
 *   2. TALENT:恋慕 && AT_HOME(MASTER) && same location → 恋慕疲倦帰
 *      (ASK_YN "送回门口 vs 歇会儿再走")
 *   3. master.location == OMANEKIBEYA() → OMANEKI 疲倦寝
 *   4. CASEELSE → 拠点から返回 (just go home, ASK_YN etc.)
 *
 * `@拠点から返回` (35 lines): 3 branches gated on
 *   - IN_HOME (already at home: clear 拠点来訪 + 休憩中=1, no move)
 *   - 拠点来訪 + 初期位置 home (the typical "going home" path:
 *     clear 拠点来訪, move to home, 休憩中=1, + ASK_YN if 恋慕+MAP_CAN_MOVE)
 *   - CASEELSE: just clear 拠点来訪 + 休憩中=1
 *
 * Modern port scope: the 4-branch SLEEP_VISITOR + 3-branch
 * 拠点から返回 classifier is real; the ASK_YN kojo-choice hook is
 * wired (P1-#7 will fill the actual UI dispatch); the
 * 拠点から返回 ASK_YN "送回门口" is a no-op stub that defaults to
 * "搬回去再返回" (the upstream RESULT==1 default).
 */

import type { GameState } from "../state/index.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { setSleep } from "./set-sleep.js";
import { setSlotLocation } from "./room-id-location.js";
import { atPlayerBase } from "./location-predicates.js";
import { OMANEKI_PLACE } from "./omaneki.js";

/** 4 mutually exclusive `@SLEEP_VISITOR` branches. */
export const VISITOR_SLEEP_BRANCH = {
  /** Branch 1 — 约会中帰宅 (mid-date return). KOJO EVENT 20, arm 2. */
  DATE_RETURN: "date_return",
  /** Branch 2 — 恋慕疲倦帰 (lover, home, same room → ASK_YN). */
  LOVER_TIRED: "lover_tired",
  /** Branch 3 — OMANEKI 疲倦寝 (in お招き部屋, exhausted → sleep). */
  OMANEKI_TIRED: "omaneki_tired",
  /** Branch 4 — CASEELSE → 拠点から返回 (just go home). */
  RETURN_HOME: "return_home",
} as const;

export type VisitorSleepBranch =
  (typeof VISITOR_SLEEP_BRANCH)[keyof typeof VISITOR_SLEEP_BRANCH];

export interface VisitorSleepPlan {
  readonly branch: VisitorSleepBranch;
  readonly oyasumiArm: number;
  readonly kitakuArm: number | null;
  readonly moveHome: boolean;
  readonly shouldAsk: boolean;
  readonly narration: string;
}

/** Pure classifier. Mirrors `@SLEEP_VISITOR(ARG)` (SLEEP.ERB:359-411). */
export function planVisitorSleep(
  state: GameState,
  charaNum: number,
): VisitorSleepPlan | null {
  if (charaNum === 0) return null;
  const slot = state.charas[charaNum];
  if (!slot) return null;
  // Branch 1 — mid-date return
  if (
    (slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0 &&
    state.master.location !== OMANEKI_PLACE
  ) {
    return {
      branch: VISITOR_SLEEP_BRANCH.DATE_RETURN,
      oyasumiArm: 0,
      kitakuArm: 2,
      moveHome: true,
      shouldAsk: false,
      narration: `${slot.callName ?? `#${charaNum}`} 说累了/困了然后回去。`,
    };
  }
  // Branch 2 — 恋慕疲倦帰 (in home, lover, with master)
  const isLover = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
  if (isLover && atPlayerBase(state, 0) && slot.location === state.master.location) {
    return {
      branch: VISITOR_SLEEP_BRANCH.LOVER_TIRED,
      oyasumiArm: 8,
      kitakuArm: 1,
      moveHome: true,
      shouldAsk: true,
      narration: `${slot.callName ?? `#${charaNum}`} 精疲力尽要回去。`,
    };
  }
  // Branch 3 — OMANEKI 疲倦寝
  if (state.master.location === OMANEKI_PLACE) {
    return {
      branch: VISITOR_SLEEP_BRANCH.OMANEKI_TIRED,
      oyasumiArm: 5,
      kitakuArm: null,
      moveHome: false,
      shouldAsk: false,
      narration: `${slot.callName ?? `#${charaNum}`} 在お招き部屋躺下来了。`,
    };
  }
  // Branch 4 — CASEELSE
  return {
    branch: VISITOR_SLEEP_BRANCH.RETURN_HOME,
    oyasumiArm: 0,
    kitakuArm: null,
    moveHome: true,
    shouldAsk: false,
    narration: `${slot.callName ?? `#${charaNum}`} 回到拠点。`,
  };
}

/** 3 mutually exclusive `@拠点から返回` branches. */
export const RETURN_HOME_BRANCH = {
  /** Branch 1 — IN_HOME (already at home, just clear 拠点来訪 + 休憩中=1). */
  ALREADY_HOME: "already_home",
  /** Branch 2 — 拠点来訪 going-home (move + 休憩中=1, ASK_YN if 恋慕). */
  VISITOR: "visitor",
  /** Branch 3 — CASEELSE (just clear 拠点来訪 + 休憩中=1). */
  CASEELSE: "caseelse",
} as const;

export type ReturnHomeBranch =
  (typeof RETURN_HOME_BRANCH)[keyof typeof RETURN_HOME_BRANCH];

export interface ReturnHomePlan {
  readonly branch: ReturnHomeBranch;
  readonly moveHome: boolean;
  readonly shouldAsk: boolean;
  readonly narration: string;
}

/** Pure classifier. Mirrors `@拠点から返回(ARG)` (SLEEP.ERB:416-449). */
export function planReturnHome(
  state: GameState,
  charaNum: number,
): ReturnHomePlan | null {
  if (charaNum === 0) return null;
  const slot = state.charas[charaNum];
  if (!slot) return null;
  // Branch 1 — already in homeLocation (the modern analog of IN_HOME;
  // upstream `IN_HOME` checks the P-id range within a base map, modern
  // uses the homeLocation string match — equivalent semantically since
  // every modern-built map is a base map).
  if (slot.homeLocation && slot.location === slot.homeLocation) {
    return {
      branch: RETURN_HOME_BRANCH.ALREADY_HOME,
      moveHome: false,
      shouldAsk: false,
      narration: `${slot.callName ?? `#${charaNum}`} 已经在拠点。`,
    };
  }
  // Branch 2 — 拠点来訪 + 初期位置 (the typical "going home")
  if ((slot.state.CFLAG[CFLAG_ID.拠点来訪] ?? 0) !== 0 && slot.homeLocation) {
    const isLover = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
    return {
      branch: RETURN_HOME_BRANCH.VISITOR,
      moveHome: true,
      shouldAsk: isLover,
      narration: `${slot.callName ?? `#${charaNum}`} 拠点から返回 ${slot.homeLocation}。`,
    };
  }
  // Branch 3 — CASEELSE
  return {
    branch: RETURN_HOME_BRANCH.CASEELSE,
    moveHome: false,
    shouldAsk: false,
    narration: `${slot.callName ?? `#${charaNum}`} 拠点来訪状态清。`,
  };
}

/** Apply a `@SLEEP_VISITOR(ARG)` plan: SET_SLEEP + (if moveHome) move.
 *
 * The Web game intentionally preserves manually selected companions across
 * sleep, so visible following does not disappear overnight.
 */
export function applyVisitorSleep(
  state: GameState,
  charaNum: number,
  plan: VisitorSleepPlan,
): void {
  if (charaNum === 0) return;
  const slot = state.charas[charaNum];
  if (!slot) return;
  if (plan.branch === VISITOR_SLEEP_BRANCH.DATE_RETURN) {
    // Preserve 同行; clear only date-specific state.
    slot.state.CFLAG[CFLAG_ID.约会中] = 0;
    state.flagStore[40] = 0; // FLAG:约会相手 ≈ id 40 (upstream variable alias)
  }
  if (plan.moveHome && slot.homeLocation) {
    setSlotLocation(slot, slot.homeLocation);
    slot.state.CFLAG[CFLAG_ID.現在位置] = slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
    slot.state.TCVAR[14] = 1; // 休憩中 = 1
  }
  setSleep(state, 1, charaNum);
  void plan.oyasumiArm;
}

/** Apply a `@拠点から返回(ARG)` plan: clear 拠点来訪 + 休憩中=1 +
 *  (if moveHome) move to homeLocation. */
export function applyReturnHome(
  state: GameState,
  charaNum: number,
  plan: ReturnHomePlan,
): void {
  if (charaNum === 0) return;
  const slot = state.charas[charaNum];
  if (!slot) return;
  slot.state.CFLAG[CFLAG_ID.拠点来訪] = 0;
  slot.state.TCVAR[14] = 1; // 休憩中 = 1
  if (plan.moveHome && slot.homeLocation) {
    setSlotLocation(slot, slot.homeLocation);
    slot.state.CFLAG[CFLAG_ID.現在位置] = slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
  }
}
