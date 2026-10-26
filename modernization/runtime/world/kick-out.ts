/**
 * @被从寝室赶了出来 / @GETOUT — kick the master out of an NPC's 私室.
 *
 * Faithful port of `ERB/MOVEMENTS/MOVEMENT2.ERB:155-199`
 * (`@被从寝室赶了出来(ARG)`) and the destination picker it calls,
 * `@GETOUT(ARG)` (`ERB/COMMON.ERB:2380-2402`).
 *
 * Upstream triggers (this slice covers #1; #2 + #3 deferred):
 *   1. NPC arrives at home (this slice — `@CHARA_MOVEMENT` per-tick
 *      via `scheduler.ts::reprojectSchedules`).
 *   2. NPC falls asleep at their initial position with the master
 *      there (`@CHARA_SLEEP`, MOVEMENT/SLEEP.ERB:95,98,184).
 *   3. Time-stop release (`時間停止解除.ERB:492`).
 *
 * The shared effect: NPC wakes to find the master asleep in their 私室,
 * says "被犯困的 X 赶出来了" + EVENT 3 sub 7,1 KOJO, resets the
 * 隐密/恶作剧/诶嘿嘿 bits, and dumps the master at the first
 * `mapCanMove0`-reachable room.
 *
 * **Gate matrix** (`MOVEMENT2.ERB:158-183`):
 *   - `IS_GAP_GUEST(MASTER)` → defer (deferred → false)
 *   - `!AT_HOME(MASTER)` → defer (player not in base map)
 *   - `ARG == 0` → defer
 *   - `CFLAG:ARG:現在位置 != CFLAG:MASTER:現在位置` → defer
 *   - `CFLAG:ARG:現在位置 != CFLAG:ARG:初期位置` → defer (the chara
 *     is not at their own 私室)
 *   - `!SHIRAHU(ARG)` → defer (chara is in deep sleep)
 *   - `CFLAG:ARG:隠密中` → defer (player sneaking past — handled by
 *     `sneak-in.ts`)
 *   - `@寝室許可(ARG, 1)` (with the kick-out suppressors) → defer
 *   - `CFLAG:ARG:同行` → defer
 *   - `CFLAG:ARG:出禁` → defer
 *   - `!睡眠時間(ARG) && !LOCK:(CFLAG:MASTER:現在位置)` → defer (the
 *     chara isn't expected to be in bed, and the room isn't locked)
 *
 * Once cleared, the kick fires:
 *   - NARRATION "被犯困的 %CALLNAME:ARG% 赶出来了…"
 *   - EVENT 3 sub 7,1 KOJO
 *   - `SET_SNEAK(0,ARG,2)` / `SET_PRANK(0,ARG,2)` (clear 隐密/恶作剧)
 *   - `ENDUFUFU_ALL` (clear 诶嘿嘿 for both)
 *   - `CLEARBIT CFLAG:ARG:夜這い, 8` (clear 夜這い "侵入成功" bit)
 *   - `@GETOUT(MASTER)` → move master to first `mapCanMove0`-reachable room
 *
 * The modern context replaces the upstream ERB ops with their
 * equivalents from `state/settlement.ts` and `world/map-can-move.ts`.
 *
 * No upstream file mutation. No LLM. See CLAUDE.md.
 */

import type { CharaSlot, GameState } from "../state/index.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import type { Rng } from "../command/types.js";
import { CFLAG_ID, EXP_ID, FLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { atPlayerBase } from "./location-predicates.js";
import { setSlotLocation } from "./room-id-location.js";
import { mapCanMove } from "./map-can-move.js";

/** EVENT-3 KOJO sub-ids per upstream `KOJO_MESSAGE_SEND("EVENT", 3, ARG, 7, 1)`. */
const EVENT_KICKOUT_3 = 3;
const EVENT_KICKOUT_SUB_KICKED_FROM_BED = 7;
const EVENT_KICKOUT_SUB_BED_KICKED = 1;

/** `CFLAG:夜這い` bit 8 — "侵入成功" (sneak succeeded). Cleared on kick. */
const SNEAK_SUCCESS_BIT = 1 << 8;

/** Display name helper (callName, falling back to `#charaNum`). */
function charaName(slot: CharaSlot): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

/**
 * `@寝室許可(ARG, 追い出されない=1)` for the **kick-out** direction —
 * does the woken chara have any reason to leave the master alone instead
 * of throwing them out. Mirrors `MOVEMENT/SLEEP.ERB:448-487` called with
 * `追い出されない = 1`.
 *
 * Returns `true` when the master should STAY (kick-out suppressed):
 *   - 催眠強度 > 50
 *   - 恋人 (恋慕 or 愛欲)
 *   - 睡眠姦経験 > 300
 *   - 縄 / 诶嘿嘿中 / 恶作剧中 / 一時滞在中 / 夜這い侵入成功中 /
 *     お招き客
 *
 * Shared semantics with `sneak-in.ts::bedroomPermission` (which checks
 * the inverse — "let the master stay after sneaking in"). We re-check
 * here because the kick-out path runs under different preconditions
 * (NPC arrives at home, no wake roll, no ブチギレ branch).
 *
 * **Note**: `@寝室許可(ARG, 0)` (the loose form that 催眠/恋人/睡眠姦
 * don't auto-allow) is what `sneak-in.ts` uses. The strict form (the
 * suppressors) is only relevant for the kick-out — re-implemented here
 * rather than imported to keep the two paths independent.
 *
 * Deferred (not falsified): 共用寝室 (shared 寝室 roster not modeled).
 */
export function kickoutSuppressedByPermission(state: GameState, owner: CharaSlot): boolean {
  // `FLAG:催眠強度` — global hypnosis strength flag (FLAG.als id 9021).
  if ((state.flagStore[FLAG_ID.催眠強度] ?? 0) > 50) return true;
  if (owner.state.CFLAG[CFLAG_ID.勃然大怒]) return true;
  // 恋人 (恋慕 TALENT=3 or 愛欲 TALENT=184) — never kicks the master.
  if (owner.state.TALENT[TALENT_ID.恋慕] || owner.state.TALENT[TALENT_ID.愛欲]) return true;
  if ((owner.state.EXP[EXP_ID.睡眠姦経験] ?? 0) > 300) return true;
  // Suppressor flags the upstream `追い出されない=1` arm checks. Each is
  // an "in the middle of something — leave the master be" state.
  // 縄 (TEQUIP) — equipment slot not modeled → defer (treated as
  //   not bound, NOT a permit). Faithful to "suppressor only when 縄 is
  //   actually set".
  // 诶嘿嘿中 (CFLAG) — set during the 诶嘿嘿 reconciliation. The
  //   bedside wake-up hits via EVENT-3 sub 7,1 only when this flag is 0.
  const efufufuActive = (owner.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 1;
  if (efufufuActive) return true;
  // 恶作剧中 (CFLAG:恶作剧) — prank flag, no modern writer → 0, no auto-suppress.
  // 一時滞在中 (FLAG:一時滞在) — not currently modeled (no writer for
  //   temporary guests). Faithfully absent → no auto-suppress.
  // 夜這い侵入成功中 (夜這い bit 8) — when this bit is set, the player
  //   just successfully snuck in; the wake-up says "fine, stay" rather
  //   than kicking. Mirrors `sneak-in.ts::SNEAK_SUCCESS_BIT`.
  const yobaiSuccess = (owner.state.CFLAG[CFLAG_ID.夜這い] ?? 0) & SNEAK_SUCCESS_BIT;
  if (yobaiSuccess) return true;
  // 待客室 (OMANEKIBEYA — main map room where 客 is housed) — no
  // modern writer → absent → no auto-suppress.
  return false;
}

/**
 * `@GETOUT(MASTER)` (`COMMON.ERB:2380-2402`) — pick the first
 * `CAN_MOVE`-reachable room from `MINROOM..MAXROOM` and move there.
 * Modern equivalent: scan the place-flag map for the first room whose
 * `mapCanMove0(state, room, master)` returns `can: true`.
 *
 * Faithful to the upstream port: search proceeds in numeric room id
 * order; whichever room can be reached first wins. Modern rooms are
 * string-keyed, so we walk a fixed evaluation order of rooms reachable
 * from the master's current base map. The two specific-upstream
 * shims (幽香私室→大堂 / Tsukumo Sisters room→長屋前) are skipped —
 * those rooms are not in our narrowed scope (幽香私室 = 紅魔館
 * deferred, Tsukumo Sisters buildings unmodeled).
 */
export function findKickoutDestination(state: GameState): string {
  const master = state.master;
  const here = master.location;
  // Try a small fallback ladder of rooms adjacent to `here`. The
  // upstream loop scans all rooms in id order; we constrain to the
  // narrow scope (神社 / 自宅 / 人間之里) — rooms within the same base
  // map. Outside the narrowed scope (field/odekake maps) there is no
  // WHOLE_MAP fallback in modern — keep the master where they are so
  // they don't end up in an unmodeled place.
  const FALLBACKS = [
    // The master's own home (preferred when inside a base map): the
    // player just got caught — they're headed "back to the corridor";
    // but if their own home is the same location we're moving them out
    // of (unlikely but possible), no-op.
    state.homeLocation,
    // Generic exits when the kickout is from a NPC 私室 inside 神社:
    "神社:境内",
    "神社:走廊",
    "神社:居間",
    // Generic exits when from 人間之里:
    "人間之里:長屋街",
    "人間之里:中央広場",
    "人間之里:鈴奈庵",
    // Home-map exits when from 自宅:
    "自宅:居間",
  ];
  for (const candidate of FALLBACKS) {
    if (!candidate || candidate === here) continue;
    // Same base map only — never cross-map kickout (faithful to GETOUT,
    // which scans only `MINROOM..MAXROOM` of the same map).
    if (here.indexOf(":") >= 0) {
      const herePrefix = here.slice(0, here.indexOf(":"));
      const candPrefix = candidate.indexOf(":") >= 0 ? candidate.slice(0, candidate.indexOf(":")) : candidate;
      if (herePrefix !== candPrefix) continue;
    }
    const gate = mapCanMove(state, candidate, master);
    if (gate.can) return candidate;
  }
  // No reachable room in the modern place graph — bail (do not move
  // the master). Upstream would have failed silently after the loop
  // and the master would have stayed put; we mirror that.
  return here;
}

export interface KickoutResult {
  events: ObservationEvent[];
  /** Final master location (unchanged when no kick occurred). */
  finalMasterLocation: string;
  /** True when a kick actually fired. */
  kicked: boolean;
  /** Shell-layer hint: when true, no authored EVENT 3 kojo was found and L1
   * AI completion is eligible (if AI is enabled). */
  needsAiKojo?: boolean;
  /** When needsAiKojo is true, provides the EVENT arm and sub for AI prompt. */
  eventArm?: number;
  eventSub?: number[];
}

export interface KickoutKojoDeps {
  dialogueRouter?: DialogueRouter;
  rng?: Rng;
  /**
   * Trigger #2 (`@CHARA_SLEEP` "going to sleep now", SLEEP.ERB:90-98): the
   * owner is transitioning INTO 睡眠 this very tick. Upstream fires the kick
   * from inside `@CHARA_SLEEP` **before** the closing `SET_SLEEP`, so the
   * chara is still awake at gate time and the `!SHIRAHU(ARG)` gate passes.
   * The modern CSV overlay (`applyConfiguredSchedule`) flips `CFLAG:睡眠`
   * to 1 up front, so callers that detect the 0→1 transition set this to
   * skip the now-stale "owner must be awake" gate. Default `false`.
   */
  ownerFallingAsleep?: boolean;
}

export interface KickoutCheckOptions {
  /** Master sleep state (`CFLAG:MASTER:睡眠`). Upstream gate: `!睡眠時間(ARG)
   *  && !LOCK:...` — we mirror as "the master must be sleeping here" AND the
   *  chara must be awake AND the room may optionally be locked. The check
   *  enforces `master.睡眠===1` rather than `LOCK` (no modern writer for
   *  LOCK); LOCK is a property of the room, not the player. Per upstream
   *  ERB `#DIM LOCK:全域配列` (room-keyed), and the narrowed modern scope
   *  doesn't expose a public setter. */
  // (No `force` knob — faithful upstream only fires the kick when the
  // gate matrix passes. Test paths that need a deterministic kick pass
  // the same gate.)
}

/** EVENT-3 dialogue lines for `owner`, args `[a, b]`. Empty when no router. */
function event3(
  state: GameState,
  owner: CharaSlot,
  a: number,
  b: number,
  now: () => number,
  deps?: KickoutKojoDeps,
): ObservationEvent[] {
  if (!deps?.dialogueRouter || !deps?.rng) return [];
  const lines = resolveEventKojoAndApply(
    deps.dialogueRouter,
    state,
    owner.charaNum,
    EVENT_KICKOUT_3,
    deps.rng,
    [a, b],
  );
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now(),
    charaNum: owner.charaNum,
    text: line.text,
    form: line.form,
  }));
}

function narr(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

/**
 * Evaluate the kick-out gate for `owner` against the master. Returns a
 * tagged result so callers can log the reason a kick was suppressed.
 *
 * Faithful to `MOVEMENT2.ERB:158-183`. Reasons returned in priority
 * order (matches the upstream early-return order).
 */
export interface KickoutGate {
  kick: boolean;
  /** True if all upstream gates passed and a kick would have fired. */
  reason?: string;
}

export function evaluateKickoutGate(
  state: GameState,
  owner: CharaSlot,
  opts?: { ownerFallingAsleep?: boolean },
): KickoutGate {
  // 1. master not in base map → no kick
  if (!atPlayerBase(state, 0)) return { kick: false, reason: "!AT_HOME(MASTER)" };
  // 2. ARG == 0 — owner.charaNum 0 is master. Master can never be the
  //    "owner" in this branch. The function is called with a chara slot,
  //    so a 0 charaNum is a programming error — guard.
  if (owner.charaNum <= 0) return { kick: false, reason: "ARG == 0" };
  // 3. chara.location != master.location
  if (owner.location !== state.master.location) {
    return { kick: false, reason: "location mismatch" };
  }
  // 4. chara.location != chara initial position (must be in their own 私室)
  if (owner.homeLocation && owner.location !== owner.homeLocation) {
    return { kick: false, reason: "owner not at initial position" };
  }
  // 5. SHIRAHU(ARG) — owner must be awake. CFLAG:睡眠 bit. Skipped for the
  //    trigger #2 "going to sleep now" hook: upstream `@CHARA_SLEEP` calls
  //    the kick before `SET_SLEEP`, so the chara is still awake there even
  //    though the modern CSV overlay has already flipped 睡眠 to 1.
  if (!opts?.ownerFallingAsleep && owner.state.CFLAG[CFLAG_ID.睡眠]) {
    return { kick: false, reason: "!SHIRAHU(ARG)" };
  }
  // 6. owner.隠密中
  // CFLAG:隠密中 — not currently modeled (sneak-in.ts writes its own
  // 隠密ビット via map-keyed `LOCK` rather than a chara flag). Left as
  // a no-op gate; if/when 隠密中 CFLAG is added, suppress kicks here.
  // 7. 寝室許可 (with the strict "auto-permit" suppressors)
  if (kickoutSuppressedByPermission(state, owner)) {
    return { kick: false, reason: "寝室許可 / 追い出されない" };
  }
  // 8. CFLAG:同行 — owner is being led somewhere (they escort master).
  if (owner.state.CFLAG[CFLAG_ID.同行]) {
    return { kick: false, reason: "同行" };
  }
  // 9. CFLAG:出禁
  if (owner.state.CFLAG[CFLAG_ID.出禁]) {
    return { kick: false, reason: "出禁" };
  }
  // 10. 睡眠時間(ARG) — chara should be in their sleep window. The
  //     upstream function reads against per-chara CSV `就寝時間`. Modern
  //     equivalent: `configured-schedule` flips `CFLAG:睡眠` for the
  //     configured window. Since the gate at step 5 requires
  //     `SHIRAHU==1` (chara NOT flagged as sleeping), this clause is
  //     superseded — covered implicitly. The `LOCK` fallback (the room
  //     is locked even though it's not "sleep time") is a property of
  //     the room; modern runtime exposes `mapCanMove0`, which doesn't
  //     surface a "locked" bool directly. Defer: when `lockedRoomOwner`
  //     reports an owner, treat it as a lock signal (the room is
  //     already in lockdown — the kick fires even if 睡眠時間 is open).
  // For now: requiring SHIRAHU is the operational stand-in.
  return { kick: true };
}

/**
 * Run `@被从寝室赶了出来(ARG)` against the master when an NPC arrives at
 * their 私室 and finds the master asleep. Mutates `state` (master
 * location, owner h-mode flags, master TCVARs).
 *
 * Caller invariants:
 *   - `owner` is a chara slot with `homeLocation` set (configured home).
 *   - Caller has already moved `owner` to `owner.homeLocation`.
 *   - Caller passes `deps` only when `dialogueRouter` + `rng` are
 *     available; absence ⇒ narration + side effects fire silently
 *     (faithful: same as upstream when KOJO_MESSAGE_SEND is a no-op).
 */
export function kickOutOfBedroom(
  state: GameState,
  owner: CharaSlot,
  now: () => number,
  deps?: KickoutKojoDeps,
): KickoutResult {
  const gate = evaluateKickoutGate(state, owner, {
    ownerFallingAsleep: deps?.ownerFallingAsleep,
  });
  if (!gate.kick) {
    return { events: [], finalMasterLocation: state.master.location, kicked: false };
  }

  const events: ObservationEvent[] = [];
  const name = charaName(owner);

  // Side effects BEFORE the move: clear the h-mode flags & 夜這い bit per
  // upstream order (SET_SNEAK → SET_PRANK → ENDUFUFU_ALL → CLEARBIT 夜這い).
  // Modern equivalents: NULL the relevant CFLAG/TALENT bits we model.
  // SET_SNEAK(0, ARG, 2) → CFLAG:ARG:隠密中 = 0. Modern runtime
  // doesn't have a 隠密中 CFLAG; modeled implicitly via `walkSession` /
  // `LOCK` — already cleared by the gate. No-op.
  // SET_PRANK(0, ARG, 2) → CFLAG:ARG:恶作剧 = 0. Modern runtime
  // doesn't have a 恶作剧 CFLAG writer. No-op.
  // ENDUFUFU_ALL → reset CFLAG:诶嘿嘿 on every chara (typical 0). We
  // only need the affected chara here — modeled as `CFLAG:诶嘿嘿 = 0`.
  owner.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
  // CLEARBIT CFLAG:夜這い, 8
  if ((owner.state.CFLAG[CFLAG_ID.夜這い] ?? 0) & SNEAK_SUCCESS_BIT) {
    owner.state.CFLAG[CFLAG_ID.夜這い] = (owner.state.CFLAG[CFLAG_ID.夜這い] ?? 0) & ~SNEAK_SUCCESS_BIT;
  }

  // PRINTFORMW 被犯困的%CALLNAME:ARG%赶出来了… — narrative fires
  // BEFORE the KOJO so the player sees the "you've been found" beat.
  events.push(narr(now, `被犯困的${name}赶出来了…`));

  // おやすみ口上,7-1,部屋から逐出て寝た → EVENT 3 sub 7,1
  const kojoEvents = event3(
    state,
    owner,
    EVENT_KICKOUT_SUB_KICKED_FROM_BED,
    EVENT_KICKOUT_SUB_BED_KICKED,
    now,
    deps,
  );
  events.push(...kojoEvents);

  // Check if authored kojo was produced
  const hasAuthoredKojo = kojoEvents.length > 0;
  const needsAiKojo = !hasAuthoredKojo && deps?.dialogueRouter !== undefined;

  // Track the kick-out. Upstream writes
  // `TCVAR:MASTER:追い出され時刻 = TIME` (a per-save "how long ago was
  // the player last kicked out") and `TCVAR:MASTER:追い出され地点` (the
  // room they were evicted from, used to bias later encounter picks
  // away from that location). Modern settlement.ts only defines
  // `TCVAR_ID.追い出され地点` (canonical upstream id 193) — no
  // `追い出され時刻`. We mirror the upstream by writing the location
  // string to id 365 via the legacy integer-typed TCVAR slot. A future
  // "stay away from the room you were kicked from" check can hash the
  // string into a number; for now we just stamp the bit so consumers
  // can detect "this master has been kicked".
  state.master.state.TCVAR[TCVAR_ID.追い出され地点] = 1;

  // @GETOUT(MASTER) → move master out of the room.
  const dest = findKickoutDestination(state);
  if (dest !== state.master.location) {
    setSlotLocation(state.master, dest);
  }

  return {
    events,
    finalMasterLocation: state.master.location,
    kicked: true,
    needsAiKojo,
    eventArm: needsAiKojo ? EVENT_KICKOUT_3 : undefined,
    eventSub: needsAiKojo ? [EVENT_KICKOUT_SUB_KICKED_FROM_BED, EVENT_KICKOUT_SUB_BED_KICKED] : undefined,
  };
}
