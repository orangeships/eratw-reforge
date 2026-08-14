/**
 * P1-#5 Slice C — `@SLEEP_RESIDENT(ARG)` (SLEEP.ERB:300-354) port.
 *
 * Upstream: 55 lines, 5 mutually exclusive branches for a 拠点住民
 * (shrine-resident) chara going to bed. The branches are gated on
 *   - IS_DATING_WITH_PLAYER (mid-date)
 *   - AT_HOME(MASTER) + 衰弱 + 現位 == master.現位 (exhausted, awake master)
 *   - 現位 != 初期位置 (away from home)
 *   - 恋慕 + AT_HOME(MASTER) + 現位 == master.現位 (mid-wake ASK_YN)
 *
 * Each branch fires its own おやすみ口上 arm + `回家` logic (move
 * chara to 神社在住 + 休憩中 = 1 + ASK_YN to keep master in their
 * room vs send them back).
 *
 * Modern port scope (per P1-PLAN §2.1.2): the **5-branch classifier**
 * is real; the PRINTFORMW prose is a 1-line stub; the ASK_YN
 * `pendingKojoChoice` hook is wired but defaults to "送回房间" (the
 * "搬回去" choice, faithful to the upstream default RESULT==1 → send
 * them back).
 */

import type { GameState } from "../state/index.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { setSleep } from "./set-sleep.js";
import { atPlayerBase } from "./location-predicates.js";
import { setSlotLocation } from "./room-id-location.js";

/** 5 mutually exclusive `@SLEEP_RESIDENT` branches. */
export const RESIDENT_SLEEP_BRANCH = {
  /** Branch 1 — 约会中帰: mid-date return (KOJO EVENT 3, arm 1, "因為困了回家去了"). */
  DATE_RETURN: "date_return",
  /** Branch 2 — 衰弱帰: exhausted with awake master → ASK_YN "搬回去再返回". */
  EXHAUSTED: "exhausted",
  /** Branch 3 — 帰路 (away from home): prints "X 從 Y 返回 Z", 帰宅口上 arm 1. */
  RETURN_FROM_AWAY: "return_from_away",
  /** Branch 4 — 恋慕 ASK_YN: in-home, lover, with master → ASK_YN (default: send home). */
  LOVER_ASK: "lover_ask",
  /** Branch 5 — 通常帰宅: chara is home (default case). */
  NORMAL_HOME: "normal_home",
} as const;

export type ResidentSleepBranch =
  (typeof RESIDENT_SLEEP_BRANCH)[keyof typeof RESIDENT_SLEEP_BRANCH];

export interface ResidentSleepPlan {
  readonly branch: ResidentSleepBranch;
  /** KOJO_EVENT 3 arm id (matches the おやすみ口上 arm). */
  readonly oyasumiArm: number;
  /** 帰宅口上 arm id (KOJO EVENT 20), when the branch fires 帰宅口上. */
  readonly kitakuArm: number | null;
  /** When true, the chara moves to their 神社在住 home. */
  readonly moveHome: boolean;
  /** When true, fires an ASK_YN kojo-choice for master (default: send back). */
  readonly pendingLoverAsk: boolean;
  readonly narration: string;
}

/** Pure classifier. Mirrors `@SLEEP_RESIDENT(ARG)` (SLEEP.ERB:300-354). */
export function planResidentSleep(
  state: GameState,
  charaNum: number,
): ResidentSleepPlan | null {
  if (charaNum === 0) return null;
  const slot = state.charas[charaNum];
  if (!slot) return null;
  const tgt = state.charas[charaNum]!;
  // Upstream's `IS_DATING_WITH_PLAYER(ARG)` — modern uses
  // `CFLAG:约会中 != 0` (the MAPID-encoding form, see
  // `runtime/world/odekake.ts`).
  const onDate = (tgt.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0;
  if (onDate) {
    return {
      branch: RESIDENT_SLEEP_BRANCH.DATE_RETURN,
      oyasumiArm: 1,
      kitakuArm: 2,
      moveHome: true,
      pendingLoverAsk: false,
      narration: `${slot.callName ?? `#${charaNum}`} 因为困了回家去了。`,
    };
  }

  // Upstream's `AT_HOME(MASTER) && 衰弱 && CFLAG:ARG:現在位置 == CFLAG:MASTER:現在位置`
  // Modern: `atPlayerBase(master, 0) && 衰弱 && slot.location === master.location`.
  const weak = (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0;
  if (weak && atPlayerBase(state, 0) && slot.location === state.master.location) {
    return {
      branch: RESIDENT_SLEEP_BRANCH.EXHAUSTED,
      oyasumiArm: 5,
      kitakuArm: null,
      moveHome: true,
      pendingLoverAsk: true,
      narration: `${slot.callName ?? `#${charaNum}`} 说累了、便躺下来了。`,
    };
  }

  // Upstream `CFLAG:ARG:現在位置 != CFLAG:ARG:初期位置` (away from home)
  // Modern: homeLocation !== current location
  if (slot.homeLocation && slot.location !== slot.homeLocation) {
    return {
      branch: RESIDENT_SLEEP_BRANCH.RETURN_FROM_AWAY,
      oyasumiArm: 1,
      kitakuArm: 1,
      moveHome: true,
      pendingLoverAsk: false,
      narration: `${slot.callName ?? `#${charaNum}`} 从 ${slot.location} 返回了 ${slot.homeLocation}。`,
    };
  }

  // Upstream `TALENT:恋慕 && AT_HOME(MASTER) && CFLAG:ARG:現在位置 == CFLAG:MASTER:現在位置`
  const isLover = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
  if (isLover && atPlayerBase(state, 0) && slot.location === state.master.location) {
    return {
      branch: RESIDENT_SLEEP_BRANCH.LOVER_ASK,
      oyasumiArm: 1,
      kitakuArm: 1,
      moveHome: true,
      pendingLoverAsk: true,
      narration: `${slot.callName ?? `#${charaNum}`} 在家里、要先回去再走。`,
    };
  }

  // Upstream CASEELSE — already in their 初期位置 (i.e. at home).
  return {
    branch: RESIDENT_SLEEP_BRANCH.NORMAL_HOME,
    oyasumiArm: 1,
    kitakuArm: null,
    moveHome: false,
    pendingLoverAsk: false,
    narration: `${slot.callName ?? `#${charaNum}`} 在自己的房间准备睡觉。`,
  };
}

/**
 * Apply a `@SLEEP_RESIDENT(ARG)` plan: moves the chara to their
 * 神社在住 home, marks 休憩中 = 1, fires SET_SLEEP(1, charaNum, 0).
 * The pending ASK_YN kojo choice is a no-op stub (P1-#5 Slice C
 * defers the full ASK_YN choice dispatch to P1-#7 / future work; the
 * default fallback is to send master back).
 */
export function applyResidentSleep(
  state: GameState,
  charaNum: number,
  plan: ResidentSleepPlan,
): void {
  if (charaNum === 0) return;
  const slot = state.charas[charaNum];
  if (!slot) return;
  if (plan.moveHome && slot.homeLocation) {
    setSlotLocation(slot, slot.homeLocation);
    slot.state.CFLAG[CFLAG_ID.現在位置] =
      slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
  }
  // 休憩中 = 1
  slot.state.TCVAR[14] = 1; // TCVAR.als id 14 = 休憩中 (modeled inline; constants table not yet)
  // SET_SLEEP(1, charaNum, 0)
  setSleep(state, 1, charaNum);
  // KOJO_EVENT 3 arm dispatch — fired through the interactive router
  // in the P0-1 pipeline (P1-#7 will use the `oyasumiArm` field).
  // The chara-sleep plan carries the arm id; the kojo dispatch lives
  // in the caller (the scheduler hook).
  void plan.oyasumiArm;
}
