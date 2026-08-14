/**
 * P1-#5 Slice B — `@CHARA_SLEEP(CHARA, メッセージ表示)` (SLEEP.ERB:8-296) port.
 *
 * Upstream: 290 lines, 5 mutually exclusive categories driven by
 *   - chara.location vs master.location
 *   - IN_HOME(master.location)
 *   - chara.location == chara.home
 *   - chara.location == chara.前一次的位置
 *   - chara 睡眠 / 陪睡中 / 延迟 / 衰弱 / 恋慕 / ブチギレ
 *
 * Each category branches to:
 *   - PRINTDATA / PRINTFORMW narro旁白 (modulo chara state)
 *   - `KOJO_MESSAGE_SEND("EVENT", 3, ARG, おやすみ口上)` — おやすみ口上
 *     arm index 1-9
 *   - `被从寝室赶了出来(CHARA)` (kick-out) for the "not-in-sleep-place"
 *     case
 *   - `SET_SNEAK` (stealth)
 *   - For "not in same room" → "对方回到自己的房间" → SLEEP_RESIDENT/VISITOR
 *
 * Modern port scope (per P1-PLAN §2.1.2): the **classification +
 * dispatch** is real; the PRINTDATA/PRINTFORMW prose is a 1-line
 * stub; the KOJO arm is wired through the interactive router; the
 * 寝室許可 / 被从寝室赶了出来 / 帰宅口上 / SLEEP_RESIDENT / SLEEP_VISITOR
 *  / 拠点から返回 hooks are deferred to P1-#5 Slice C/D.
 *
 * The classifier returns a category enum; the dispatcher fires:
 *   - `おやすみ口上` arm id (1-9) for kojo EVENT 3
 *   - `帰宅口上` arm id (1-2) for kojo EVENT 20 (when applicable)
 *   - the SET_SLEEP call (CASE 1, gated on 恋慕 × 寝室許可 etc.)
 *   - the kick-out hook (`kickOutOfBedroom`) before SET_SLEEP
 *
 * This file is a **P1-#5 Slice B foundation** — the 5 categories
 * are fully classified, the kojo arm ids are real, and the resident
 * kick-out side effect is wired through the shared bedroom helper.
 */

import type { GameState } from "../state/index.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { setSleep } from "./set-sleep.js";
import { locationToRoomId } from "./room-id-location.js";
import { kickOutOfBedroom } from "./kick-out.js";

/** The 5 mutually exclusive `CHARA_SLEEP` categories. */
export const CHARA_SLEEP_CATEGORY = {
  /** chara is in master's location + already 睡眠. */
  ALREADY_SLEEPING: "already_sleeping",
  /** chara is in master's location + 陪睡中 (set by COMF354). */
  TOGETHER_SLEEPING: "together_sleeping",
  /** chara is in master's location + 現位 == 前位置 (in sleeping spot). */
  IN_SLEEP_SPOT: "in_sleep_spot",
  /** chara is in master's location but NOT in their 初期位置. */
  KICKED_OUT: "kicked_out",
  /** chara is NOT in master's location. */
  RETURNING_HOME: "returning_home",
} as const;

export type CharaSleepCategory =
  (typeof CHARA_SLEEP_CATEGORY)[keyof typeof CHARA_SLEEP_CATEGORY];

/** おやすみ口上 arm id (KOJO EVENT 3, ARG:1, ARG:2=おやすみ口上). */
export const OYASUMI_ARM = {
  /** returning home (SLEEP_RESIDENT/VISITOR 帰宅口上) */
  RETURNING_HOME: 1,
  /** 眠そうにしている (drowsy-looking). */
  DROWSY: 2,
  /** 睡眠中 (already sleeping). */
  ALREADY_SLEEPING: 3,
  /** 疲れて寝る (exhausted → sleep). */
  EXHAUSTED_SLEEP: 5,
  /** 遅延中(別行動中) — kept as a separate arm for kojo arm pick. */
  DELAY_DROWSY: 2,
  /** 寝室にいる状態でその場で寝る (in bedroom, falls asleep on the spot). */
  FALL_ASLEEP_IN_BEDROOM: 9,
} as const;

/** 帰宅口上 arm id (KOJO EVENT 20, ARG:1, ARG:2=帰宅口上). */
export const KITAKU_ARM = {
  /** 通常帰宅 (normal return home). */
  NORMAL: 1,
  /** 约会中帰宅 (mid-date return). */
  DATE_END: 2,
} as const;

/** Result of the upstream 整合性チェック early-return — we mirror
 *  the four skip-conditions at the top of `@CHARA_SLEEP`. */
export interface CharaSleepSkip {
  readonly skipped: true;
  readonly reason:
    | "妄想産物"
    | "烂醉"
    | "好きにして"
    | "拠点来訪で既就寢";
}

export interface CharaSleepPlan {
  readonly skipped: false;
  readonly category: CharaSleepCategory;
  readonly oyasumiArm: number;
  readonly kitakuArm: number | null;
  /** When true, fire the kick-out hook (deferred to P1-#5 Slice C). */
  readonly shouldKickOut: boolean;
  /** When true, the SET_SLEEP(1, charaNum) call should run. */
  readonly shouldSetSleep: boolean;
  /** 1-line narration stub (modern port defers the PRINTDATA catalog). */
  readonly narration: string;
}

/**
 * Classify + plan a single character's CHARA_SLEEP behavior. Mirrors
 * the 5-category @CHARA_SLEEP dispatch in SLEEP.ERB:30-118.
 *
 * Pure function: doesn't mutate `state`, doesn't fire kojo, doesn't
 * call SET_SLEEP. The caller (the per-character scheduler hook in
 * scheduler.ts) is responsible for executing the plan.
 */
export function planCharaSleep(
  state: GameState,
  charaNum: number,
): CharaSleepSkip | CharaSleepPlan {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) {
    return { skipped: true, reason: "妄想産物" };
  }
  // 上游 整合性チェック (SLEEP.ERB:18-25)
  // 妄想的産物 — 灵梦-灵梦-灵梦-灵梦 placeholder chara (Talent.csv id not
  //   pinned yet; defer to future — assume absent).
  // 烂醉 (TCVAR:145) — drunken chara can't fall asleep
  const drunk = (slot.state.TCVAR[145] ?? 0) !== 0;
  if (drunk) {
    return { skipped: true, reason: "烂醉" };
  }
  // 好きにして (TCVAR:20 bit0) — raping-you → don't get drowsy
  // (no-op for the modern runtime; the flag is set during H-mode
  // partner-led; defer)
  // 拠点来訪で既就寢 — visitor already in master's room sleeping
  const visitorSleeping =
    (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 &&
    state.master.state.CFLAG[CFLAG_ID.初期位置] != null &&
    slot.location === state.master.location &&
    (slot.state.CFLAG[CFLAG_ID.拠点来訪] ?? 0) !== 0;
  if (visitorSleeping) {
    return { skipped: true, reason: "拠点来訪で既就寢" };
  }

  // The 5 categories — mutual exclusion is by if/else-if order:
  //   1. 同室 + 睡眠
  //   2. 同室 + 恋慕 + 陪睡中
  //   3. 同室 + 現位 == 前位置 (sleeping spot)
  //   4. 同室 (其他) → 寝室から赶出
  //   5. 不同室 → 帰宅
  const sameRoom =
    state.master.location !== undefined &&
    slot.location === state.master.location;
  const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
  const togetherSleeping = (slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0;
  const isLover = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
  const isAngry = (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0;
  // CFLAG:前一次的位置 is a room id (1..71) per upstream. The modern
  // `slot.location` is a string ("人間之里:鈴奈庵" etc.). We compare
  // by room id — faithful to the upstream.
  const currentRoomId = locationToRoomId(slot.location);
  const previousRoomId = slot.state.CFLAG[CFLAG_ID.前一次的位置] ?? 0;
  const inSleepSpot = currentRoomId !== null && currentRoomId === previousRoomId;

  if (!sameRoom) {
    // 5. 帰宅
    return {
      skipped: false,
      category: CHARA_SLEEP_CATEGORY.RETURNING_HOME,
      oyasumiArm: OYASUMI_ARM.RETURNING_HOME,
      kitakuArm: KITAKU_ARM.NORMAL,
      shouldKickOut: false,
      shouldSetSleep: true,
      narration: `${slot.callName ?? `#${charaNum}`} 回到自己的房间准备睡觉。`,
    };
  }

  if (sleeping) {
    // 1. 同室 睡眠中
    return {
      skipped: false,
      category: CHARA_SLEEP_CATEGORY.ALREADY_SLEEPING,
      oyasumiArm: OYASUMI_ARM.ALREADY_SLEEPING,
      kitakuArm: null,
      shouldKickOut: false,
      shouldSetSleep: false,
      narration: `${slot.callName ?? `#${charaNum}`} 已经在睡。`,
    };
  }

  if (isLover && togetherSleeping) {
    // 2. 同室 恋慕 × 陪睡中
    return {
      skipped: false,
      category: CHARA_SLEEP_CATEGORY.TOGETHER_SLEEPING,
      oyasumiArm: isAngry ? OYASUMI_ARM.RETURNING_HOME : OYASUMI_ARM.FALL_ASLEEP_IN_BEDROOM,
      kitakuArm: null,
      shouldKickOut: false,
      shouldSetSleep: true,
      narration: `${slot.callName ?? `#${charaNum}`} 偎依着准备入睡。`,
    };
  }

  if (inSleepSpot) {
    // 3. 同室 現位 == 前位置
    return {
      skipped: false,
      category: CHARA_SLEEP_CATEGORY.IN_SLEEP_SPOT,
      oyasumiArm: OYASUMI_ARM.FALL_ASLEEP_IN_BEDROOM,
      kitakuArm: null,
      shouldKickOut: true, // if 寝室許可(ARG) fails, fire kick-out
      shouldSetSleep: true,
      narration: `${slot.callName ?? `#${charaNum}`} 在卧室就地躺下睡觉。`,
    };
  }

  // 4. 同室 (其他) — 不在睡处, kick out
  // Upstream SLEEP.ERB:96-100 — KICKED_OUT prints "drowsy" and calls
  // `被从寝室赶了出来(CHARA)`, but does NOT call SET_SLEEP(1).
  // (The chara is moved to a corridor/廊下, then the next-day wake
  // path runs CHARA_AWAKE if they're still in their own room.)
  return {
    skipped: false,
    category: CHARA_SLEEP_CATEGORY.KICKED_OUT,
    oyasumiArm: OYASUMI_ARM.DROWSY,
    kitakuArm: null,
    shouldKickOut: true,
    shouldSetSleep: false,
    narration: `${slot.callName ?? `#${charaNum}`} 正在犯困被请出了卧室。`,
  };
}

/**
 * Apply a `CharaSleepPlan` to `state`, including the real bedroom kick-out
 * path before SET_SLEEP (the ordering used by the upstream SLEEP.ERB).
 */
export function applyCharaSleepPlan(
  state: GameState,
  charaNum: number,
  plan: CharaSleepPlan,
): void {
  if (plan.skipped) return;
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  if (plan.shouldKickOut) {
    kickOutOfBedroom(state, slot, () => state.time.tickValue, {
      ownerFallingAsleep: plan.category === CHARA_SLEEP_CATEGORY.IN_SLEEP_SPOT,
    });
  }
  if (plan.shouldSetSleep) {
    // SET_SLEEP(1, charaNum, 0): the no-masterLink form. For 恋慕+陪睡中
    // (TOGETHER_SLEEPING) we'd use masterLink=1 to also set master 睡眠,
    // but that's only meaningful when charaNum === 0 (master) which the
    // upstream guards via `SIF ARG:1 == MASTER`. For non-master TARGETs
    // this is the right form.
    setSleep(state, 1, charaNum);
  }
}

/**
 * Batch helper: walk every chara and apply CHARA_SLEEP to those sharing
 * a location with master. This is the per-night hook (P1-#5 Slice B
 * entry point) that P1-#5 Slice C/D will further specialize by
 * routing kicked-out / returning-home characters into SLEEP_RESIDENT
 * / SLEEP_VISITOR.
 */
export function runCharaSleepSweep(state: GameState): CharaSleepPlan[] {
  const out: CharaSleepPlan[] = [];
  for (const key of Object.keys(state.charas)) {
    const plan = planCharaSleep(state, Number(key));
    if (plan.skipped) continue;
    out.push(plan);
  }
  return out;
}
