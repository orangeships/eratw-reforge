/**
 * @潜入房間 — sneaking into a locked 私室 whose owner is asleep, faithful to
 * `コマンド関連/COMF/日常系/侵入.ERB @潜入房間(ARG, 直前位置)` (the branch run
 * when the player answers 潜入 at a locked door, COMF400.ERB:586-620).
 *
 * The owner is the sleeping resident of `dest` (from `lockedRoomOwner`). The
 * outcome:
 *   - **ブチギレ (勃然大怒)**: can't be snuck in on — bounced back, room re-locks
 *     (KOJO EVENT 12 sub 2,1 / under 時間停止 the rage freeze line).
 *   - **otherwise, a wake roll** (`RAND:3 == 0 || !睡眠`, gated by `!時間停止 &&
 *     !出禁 && !睡眠薬 && 睡眠姦経験 < 300`):
 *       - **woke**: `@CHARA_AWAKE`; then `@寝室許可` decides
 *           · allowed → the master is let in (EVENT 12 sub 1,2; move to dest)
 *           · refused → kicked out (EVENT 12 sub 1,4; bounce, re-lock)
 *       - **didn't wake**: a quiet successful sneak — move in, set the 夜這い
 *         "侵入成功" bit (`SETBIT CFLAG:夜這い, 8`), EVENT 12 sub 1,1.
 *
 * `@寝室許可(owner)` (SLEEP.ERB:448): 催眠強度>50 → yes; ブチギレ → no; 恋人
 * (恋慕/愛欲) → yes; 睡眠姦経験>300 → yes; else (fresh/low-affinity) → no
 * (kicked). 共用寝室 (shared bedroom) is deferred (the modern home model has no
 * shared-bedroom roster).
 *
 * **Deferred (documented, not fabricated):** 衰弱 re-sleep variants (sub 1,3 /
 * 1,5), 隠密中, the commented-out 恋慕 "let in but don't sleep" path, 睡眠薬 /
 * 睡眠姦経験 writers (no modern source → always 0). `CHARA_AWAKE` is modeled as
 * clearing `CFLAG:睡眠` (the modern wake state); the fuller @CHARA_AWAKE side
 * effects (relocation, prank reset) are not needed here.
 *
 * RAND uses the supplied `Rng` (the walk-resolve path carries one, unlike the
 * rng-free day-end). No upstream file mutation. No LLM. See CLAUDE.md.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import type { Rng } from "../command/types.js";
import { CFLAG_ID, EXP_ID, FLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { setSlotLocation } from "./room-id-location.js";
import { lockedRoomOwner } from "./room-lock.js";

/** `FLAG:時間停止` (raw top-level FLAG id 70). */
const TIMESTOP_FLAG = 70;
/** `CFLAG:夜這い` bit 8 — the "侵入成功" (sneak succeeded) flag. */
const SNEAK_SUCCESS_BIT = 1 << 8;

function charaName(slot: CharaSlot): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

/** `@寝室許可(owner)` (SLEEP.ERB:448-466 subset) — does the woken owner let the
 *  master stay. 共用寝室 deferred. */
export function bedroomPermission(state: GameState, owner: CharaSlot): boolean {
  if ((state.flagStore?.[FLAG_ID.催眠強度] ?? 0) > 50) return true;
  if (owner.state.CFLAG[CFLAG_ID.勃然大怒]) return false;
  if (owner.state.TALENT[TALENT_ID.恋慕] || owner.state.TALENT[TALENT_ID.愛欲]) return true;
  if ((owner.state.EXP[EXP_ID.睡眠姦経験] ?? 0) > 300) return true;
  return false; // fresh / low-affinity → kicked out
}

export interface SneakResult {
  /** Narration + EVENT-12 dialogue lines produced. */
  events: ObservationEvent[];
  /** Final location: `dest` on a successful entry, else the bounce-back. */
  finalLocation: string;
  /** True when the master ended up inside `dest`. */
  entered: boolean;
  /** Shell-layer hint: when true, no authored EVENT 12 kojo was found and L1
   * AI completion is eligible (if AI is enabled). */
  needsAiKojo?: boolean;
  /** When needsAiKojo is true, provides the EVENT arm and sub for AI prompt. */
  eventArm?: number;
  eventSub?: number[];
}

export interface SneakKojoDeps {
  dialogueRouter?: DialogueRouter;
  rng?: Rng;
}

function narr(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

/** EVENT 12 dialogue lines for `owner`, args `[a, b]` (KOJO_MESSAGE_SEND
 *  "EVENT",12,owner,a,b). Empty when no router/rng supplied. */
function event12(
  state: GameState,
  owner: CharaSlot,
  a: number,
  b: number,
  now: () => number,
  deps?: SneakKojoDeps,
): ObservationEvent[] {
  if (!deps?.dialogueRouter || !deps.rng) return [];
  const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, owner.charaNum, 12, deps.rng, [a, b]);
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now(),
    charaNum: owner.charaNum,
    text: line.text,
    form: line.form,
  }));
}

/**
 * Run `@潜入房間` for the master walking into locked `dest` from `prevLocation`.
 * Mutates `state` (the owner's wake/lock bits, the master's location). The
 * caller (skip-move) already paid time + cleared `walkSession`.
 */
export function attemptSneakIn(
  state: GameState,
  dest: string,
  prevLocation: string,
  now: () => number,
  deps?: SneakKojoDeps,
): SneakResult {
  const owner = lockedRoomOwner(state, dest);
  // Defensive: caller only reaches here for a locked room. No owner → just enter.
  if (!owner) {
    setSlotLocation(state.master, dest);
    return { events: [], finalLocation: dest, entered: true };
  }

  const events: ObservationEvent[] = [];
  const timestop = (state.flagStore[TIMESTOP_FLAG] ?? 0) !== 0;
  const name = charaName(owner);

  // ── ブチギレ: never sneakable. ──────────────────────────────────────────
  if (owner.state.CFLAG[CFLAG_ID.勃然大怒]) {
    if (timestop) {
      events.push(narr(now, `潜入了房间，但一打开门就看到${name}摆着副愤怒的表情定在那里，在难以言喻的迫力下放弃了潜入…`));
    } else {
      events.push(narr(now, `潜入熟睡的${name}的房间打开门，却见${name}正瞪大眼睛睨视着这边，只好放弃了潜入…`));
    }
    const kojoEvents = event12(state, owner, 2, 1, now, deps);
    events.push(...kojoEvents);
    setSlotLocation(state.master, prevLocation);
    const hasAuthoredKojo = kojoEvents.length > 0;
    return {
      events,
      finalLocation: prevLocation,
      entered: false,
      needsAiKojo: !hasAuthoredKojo && deps?.dialogueRouter !== undefined,
      eventArm: !hasAuthoredKojo ? 12 : undefined,
      eventSub: !hasAuthoredKojo ? [2, 1] : undefined,
    };
  }

  // ── wake roll (owner is asleep & not 出禁 by lockedRoomOwner). ───────────
  const drugged = (owner.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0) !== 0;
  const developed = (owner.state.EXP[EXP_ID.睡眠姦経験] ?? 0) >= 300;
  const rolledAwake = deps?.rng ? deps.rng.int(3) === 0 : true; // RAND:3 == 0
  const woke = rolledAwake && !timestop && !drugged && !developed;

  if (woke) {
    owner.state.CFLAG[CFLAG_ID.睡眠] = 0; // @CHARA_AWAKE (modern wake)
    if (bedroomPermission(state, owner)) {
      events.push(narr(now, `${name}确认来访者是主人后，露出了安心的表情…`));
      const kojoEvents = event12(state, owner, 1, 2, now, deps);
      events.push(...kojoEvents);
      setSlotLocation(state.master, dest);
      const hasAuthoredKojo = kojoEvents.length > 0;
      return {
        events,
        finalLocation: dest,
        entered: true,
        needsAiKojo: !hasAuthoredKojo && deps?.dialogueRouter !== undefined,
        eventArm: !hasAuthoredKojo ? 12 : undefined,
        eventSub: !hasAuthoredKojo ? [1, 2] : undefined,
      };
    }
    events.push(narr(now, `被${name}赶出了房间…`));
    const kojoEvents = event12(state, owner, 1, 4, now, deps);
    events.push(...kojoEvents);
    setSlotLocation(state.master, prevLocation);
    const hasAuthoredKojo = kojoEvents.length > 0;
    return {
      events,
      finalLocation: prevLocation,
      entered: false,
      needsAiKojo: !hasAuthoredKojo && deps?.dialogueRouter !== undefined,
      eventArm: !hasAuthoredKojo ? 12 : undefined,
      eventSub: !hasAuthoredKojo ? [1, 4] : undefined,
    };
  }

  // ── quiet sneak success. ────────────────────────────────────────────────
  events.push(narr(now, `悄悄潜入了熟睡的${name}的房间。`));
  const kojoEvents = event12(state, owner, 1, 1, now, deps);
  events.push(...kojoEvents);
  owner.state.CFLAG[CFLAG_ID.夜這い] = (owner.state.CFLAG[CFLAG_ID.夜這い] ?? 0) | SNEAK_SUCCESS_BIT;
  setSlotLocation(state.master, dest);
  const hasAuthoredKojo = kojoEvents.length > 0;
  return {
    events,
    finalLocation: dest,
    entered: true,
    needsAiKojo: !hasAuthoredKojo && deps?.dialogueRouter !== undefined,
    eventArm: !hasAuthoredKojo ? 12 : undefined,
    eventSub: !hasAuthoredKojo ? [1, 1] : undefined,
  };
}
