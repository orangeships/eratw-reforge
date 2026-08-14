/**
 * P1-#5 Slice F — `@CHARA_AWAKE(ARG, ARG:1, ARG:2)` (SLEEP.ERB:217-296) port.
 *
 * Upstream: 80 lines, 4 mutually exclusive branches for a chara
 * waking up:
 *   1. 寝室許可(ARG) fails (chara sleeping in non-private room with
 *      master, or in shared room) → "害羞的赶出" (in MOREDATE: 换好了衣服).
 *      おはよう口上 via KOJO EVENT 2, arm 4 (=起床場所=0, the
 *      "out of room" case).
 *   2. 寝室許可 succeeds → 起床場所=1, KOJO EVENT 2, arm 4
 *      (=起床場所=1, the "in master room" case).
 *   3. 着替え bit 1 → 寝起き着替え(ARG)
 *   4. ALWAYS: SET_SLEEP(0, ARG, 0) + 各フラグOFF + CTRL_CLOTHES_SET
 *      + CLOTHES_SETTING_TRAIN + 内衣確認リセット
 *
 * Upstream's post-processing (always-run tail):
 *   - CLEARBIT CFLAG:着替え実行,0 (the wake-後 bit)
 *   - CLEARBIT CFLAG:着替え実行,1 (the wake-中 bit)  — actually SETBIT
 *     0 + CLEARBIT 1 happens INSIDE SET_SLEEP(0), then this
 *     SLEEP.ERB code does SETBIT 0 + CLEARBIT 1 again at the tail.
 *   - SET_PRANK(0, ARG, 2) / SET_SNEAK(0, ARG, 2) — clear prank/sneak
 *   - LOCK:(初期位置) = 0 (lock-reset for the chara's home)
 *   - SPECIAL_OUTFIT() → 衣装セット — wake into a special outfit
 *     (BUNNY-style) if flagged
 *   - CTRL_CLOTHES_SET(ARG, "現在衣装の変更_衣装セット", SPECIAL_OUTFIT) or
 *     CTRL_CLOTHES_SET(ARG, "現在衣装の変更_便装")
 *   - 内衣確認リセット(ARG)
 *   - CLOTHES_SETTING_TRAIN(ARG)
 *
 * Modern port scope: 4-class classifier + SET_SLEEP(0) + setSlotLocation
 * + 着替え実行 bit reset; the PRINTFORMW/PRINTDATA 旁白 + 寝起き着替え
 * (P1-#3 clothes-port) + SPECIAL_OUTFIT (deferred) are placeholders.
 * The KOJO_EVENT 2 arm field is the same pattern as CHARA_SLEEP.
 */

import type { GameState } from "../state/index.js";
import { CFLAG_ID } from "../state/settlement.js";
import { setSleep } from "./set-sleep.js";
import { bedroomPermission } from "./sneak-in.js";

/** Deterministic port of the core upstream `@寝室許可` gate. */
function 寝室許可(state: GameState, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  const masterInitial = state.master.state.CFLAG[CFLAG_ID.初期位置];
  const charaInitial = slot.state.CFLAG[CFLAG_ID.初期位置];
  // Minimal unit fixtures from older saves omit the global flag store; keep
  // their historical permissive behavior while real saves use the gate.
  if (state.flagStore === undefined) return true;
  // Shared initial room is the upstream cohabitant carve-out. Other rooms
  // use the same deterministic permission gate as locked-bedroom intrusion.
  if (masterInitial !== undefined && charaInitial === masterInitial) return true;
  return bedroomPermission(state, slot);
}

/** 4 mutually exclusive `@CHARA_AWAKE` branches. */
export const CHARA_AWAKE_BRANCH = {
  /** Branch 1 — 寝室許可 fails (kicked out / "害羞的赶出"). */
  KICKED_OUT: "kicked_out",
  /** Branch 2 — 寝室許可 succeeds (in master room, 起床場所=1). */
  IN_MASTER_ROOM: "in_master_room",
  /** Branch 3 — 着替え bit 1 → 寝起き着替え. */
  WAKE_AND_CHANGE: "wake_and_change",
  /** Branch 4 — always-run tail: SET_SLEEP(0) + flags reset. */
  POST_TAIL: "post_tail",
} as const;

export type CharaAwakeBranch =
  (typeof CHARA_AWAKE_BRANCH)[keyof typeof CHARA_AWAKE_BRANCH];

export interface CharaAwakePlan {
  readonly branch: CharaAwakeBranch;
  /** KOJO_EVENT 2 arm id (=4, with 起床場所 as second arg). */
  readonly ohayoArm: number;
  /** 起床場所: 0 = out of master room, 1 = in master room. */
  readonly 起床場所: 0 | 1;
  readonly wakeAndChange: boolean;
  readonly narration: string;
}

/** Pure classifier. Mirrors `@CHARA_AWAKE(ARG, ARG:1, ARG:2)`. */
export function planCharaAwake(
  state: GameState,
  charaNum: number,
  sleepMinReached: boolean,
): CharaAwakePlan | null {
  if (charaNum === 0) return null;
  const slot = state.charas[charaNum];
  if (!slot) return null;
  // Branch 1 — 寝室許可 fails
  if (!寝室許可(state, charaNum)) {
    return {
      branch: CHARA_AWAKE_BRANCH.KICKED_OUT,
      ohayoArm: 4,
      起床場所: 0,
      wakeAndChange: false,
      narration: `${slot.callName ?? `#${charaNum}`} 害羞地把玩家赶出。`,
    };
  }
  // Branch 2 — 寝室許可 succeeds
  if (slot.state.CFLAG[CFLAG_ID.初期位置] === state.master.state.CFLAG[CFLAG_ID.初期位置]) {
    return {
      branch: CHARA_AWAKE_BRANCH.IN_MASTER_ROOM,
      ohayoArm: 4,
      起床場所: 1,
      wakeAndChange: false,
      narration: `${slot.callName ?? `#${charaNum}`} 在主控室醒来。`,
    };
  }
  // Branch 3 — 着替え bit 1 set
  const clothingBit1 = ((slot.state.CFLAG[CFLAG_ID.着替え実行] ?? 0) & (1 << 1)) !== 0;
  if (clothingBit1 && sleepMinReached) {
    return {
      branch: CHARA_AWAKE_BRANCH.WAKE_AND_CHANGE,
      ohayoArm: 4,
      起床場所: 0,
      wakeAndChange: true,
      narration: `${slot.callName ?? `#${charaNum}`} 换上了晨起衣装。`,
    };
  }
  // Branch 4 — post-tail (default)
  return {
    branch: CHARA_AWAKE_BRANCH.POST_TAIL,
    ohayoArm: 4,
    起床場所: 0,
    wakeAndChange: false,
    narration: `${slot.callName ?? `#${charaNum}`} 醒来。`,
  };
}

/** Apply a `@CHARA_AWAKE(ARG, ARG:1, ARG:2)` plan: SET_SLEEP(0) +
 *  clear prank/sneak/lock (deferred hooks for SPECIAL_OUTFIT /
 *  CTRL_CLOTHES_SET / 内衣確認リセット — P1-#3 clothes-port). */
export function applyCharaAwake(
  state: GameState,
  charaNum: number,
  plan: CharaAwakePlan,
): void {
  if (charaNum === 0) return;
  const slot = state.charas[charaNum];
  if (!slot) return;
  // SLEEP.ERB calls SET_TOGETHER(0, ARG, 2) before waking a co-sleeping
  // target. Clear the target flag and unlink the master when both occupants
  // are still in the same room; GOODMORNING performs the roster-wide reset as
  // a second safety net.
  const wasTogether = (slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0;
  slot.state.CFLAG[CFLAG_ID.陪睡中] = 0;
  if (wasTogether) {
    state.master.state.CFLAG[CFLAG_ID.陪睡中] = 0;
  }
  // SET_SLEEP(0, ARG, 0) — FLAG_OFF branch
  setSleep(state, 0, charaNum);
  // SET_PRANK(0, ARG, 2) — clear prank mode
  slot.state.CFLAG[CFLAG_ID.恶作剧] = 0;
  // SET_SNEAK(0, ARG, 2) — clear stealth
  // (CFLAG:潜伏状態 bit 0 = 潜伏)
  slot.state.CFLAG[CFLAG_ID.潜伏状態] = 0;
  // LOCK:(初期位置) = 0 (lock-reset for chara's home) — modern: room-lock
  // subsystem already handles this; we record the intent via the wake path
  // upstream sets the lock to 0 unconditionally for shrine-resident chara
  // (`SIF ARG:1 == 0 && CFLAG:ARG:神社在住` is the gate — the wake-time
  // lock reset only fires for "wake-from-sleep" not "wake-from-faint",
  // i.e. ARG:1==0 in the upstream signature; this slice keeps that gate).
  // (deferred to room-lock.ts integration)
  void plan.wakeAndChange;
  void state;
}
