/**
 * Phase D (实玩反馈 #9) — `@SKIP_MOVE` long-distance movement.
 *
 * Faithful port of the path-walking core of `@SKIP_MOVE`
 * (`COMF400 移動.ERB:387-677`): instead of teleporting, the master WALKS the
 * computed route and PASSES THROUGH each intermediate room, meeting whoever is
 * there. The relay/encounter loop is `COMF400.ERB:497-530`; the time cost is
 * `COMF400.ERB:631-648`.
 *
 * **Slice 1** — walk + per-room encounter NARRATION + faithful time cost.
 * **Slice 2** — the mid-walk INTERACTION: at each occupied relay the walk
 * PAUSES and the player chooses 无视 / 打招呼后继续 / 停下来
 * (`ASK_M`, `COMF400.ERB:514`). 停下来 ends the walk at that room (mid-path,
 * `経過時間 = RELAY_COUNT`, `GOTO STOP`); 打招呼/无视 continue. Modeled as a
 * pause/resume state machine over `GameState.walkSession`:
 *   `startSkipMove` walks until the first encounter that needs a choice (or
 *   concludes); the UI shows the 3 options; `resolveWalkEncounter` applies the
 *   choice and resumes until the next pause or arrival.
 * **Slice 3 (this file)** — DESTINATION events at the `$STOP` label
 * (`COMF400.ERB:537-625`), fired on FINAL arrival at the dest:
 *   - 廁所 `IN_TOILET` (`COMF400.ERB:537-540`): an occupied toilet bounces the
 *     master back to 直前位置 ("…好像在里面"); empty → enter.
 *   - 浴場 `BATHCHECK` (`COMF400.ERB:541-579`, alone path): empty → bathe;
 *     occupied → `風呂逐出条件` (`EVENTCOMEND2.ERB:410`) decides kicked-out
 *     (bounce to 直前位置) vs eye-contact (peek under 时停, else 对上视线).
 *
 * **Split with the UI.** The route is computed browser-side by
 * `web/app/game/pathfind.ts` (`findPath`, BFS over the scene-exit graph in the
 * web bundle). This engine takes the ordered ROOM list and runs the encounter
 * walk against `GameState`, staying pure/testable in the runtime.
 *
 * **Modeled encounter kojo:**
 *   - `KOJO_MESSAGE_SEND EVENT 4` real dialogue lines (greet=2 / ignore=3 /
 *     stop=1, `COMF400.ERB:516-524`) fire when a `DialogueRouter` is supplied
 *     to `resolveWalkEncounter`.
 *   - Arrival at an occupied non-special destination also emits the same
 *     encounter-greeting arm (EVENT 4, sub-code 3), so room-entry greetings are
 *     not lost just because the character was in the final room rather than on
 *     an intermediate relay.
 *
 * **Deferred (documented, not fabricated):**
 *   - `FLAG:停下脚步 == 1` (stop only if the chara has kojo) — needs the kojo
 *     lookup, so it currently behaves like mode 0 (always ask). Mode 0 (ask)
 *     and mode 2 (never stop) ARE faithful.
 *   - Remaining destination events (`$STOP`): 虫籠侵入 (RESULT==54, no modern
 *     room), 施錠房潜入 (`LOCK` + `ASK_YN`, lock subsystem not modeled), 宴会
 *     `ENKAI_SINKOU` (`TFLAG:宴会場`, event subsystem). The mid-walk-STOP
 *     `$STOP` quirk (RESULT = next relay, `COMF400.ERB:519`) — destination
 *     events run only on FINAL arrival, not when 停下来 ends a walk.
 *   - `KOJO_MESSAGE_SEND EVENT 11/23` real bath dialogue lines (peek/eye-
 *     contact/eject/invite); the 同行 invite branch (`COMF400.ERB:557-578`).
 *   - 風呂逐出条件 anatomy arm (`!扶她 && HETEROSEX`, `EVENTCOMEND2.ERB:414`):
 *     the gender-pair helper is deferred project-wide (see `comf/defs/comf0`).
 *     The disposition arms (態度/既成事実/诶嘿嘿/恋慕/羞恥心/無知/催眠/时停)
 *     ARE ported; the fresh-game 低態度 default path (= kicked) is faithful.
 *   - time-cost modifiers 小人/瞬間移動 (TSP); per-relay `MAP_CAN_MOVE`
 *     re-gate (findPath only routes over valid exits).
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import type { Rng } from "../command/types.js";
import { ABL_ID, CFLAG_ID, FLAG_ID, TALENT_ID, advanceTimeTicks } from "../state/settlement.js";
import { computeAttitude } from "../state/attitude.js";
import { setSlotLocation } from "./room-id-location.js";
import { followCompanions } from "../state/companion-follow.js";
import { bathCheck, inToilet } from "./location-predicates.js";
import { roomEnterKindsFor } from "./room-events.js";
import { checkHehai, type Kehai } from "./detection.js";
import { mapCanMove } from "./map-can-move.js";
import { lockedRoomOwner, lockedRoomMessage } from "./room-lock.js";
import { attemptSneakIn } from "./sneak-in.js";
import { pitfallArrivalEvents } from "./free-activity-events.js";

/** `FLAG:時間停止` (raw top-level FLAG id 70) — disables 打招呼 mid-walk. */
const TIMESTOP_FLAG = 70;

/** 停下脚步 mode (`FLAG:停下脚步`): 0 ask each / 1 only-if-kojo / 2 never stop. */
export type StopWalkingMode = 0 | 1 | 2;

/** The player's choice at a mid-walk encounter (`ASK_M`, COMF400.ERB:514) OR at
 *  a locked door (`ASK_YN` 潜入/算了, COMF400.ERB:614 → `@潜入房間`). */
export type WalkChoice = "ignore" | "greet" | "stop" | "sneak" | "giveup";

/** Readable room name (strip the "区域:" prefix), as the UI shows it. */
function roomName(loc: string): string {
  const i = loc.indexOf(":");
  return i >= 0 ? loc.slice(i + 1) : loc;
}

/** Activity suffix when passing someone (CHECK_HEHAI → `@SET_KEHAI_COLOR` tag). */
const ENCOUNTER_VERB: Record<Kehai, string> = {
  0: "",
  1: "",
  2: "（工作中）",
  3: "（睡眠中）",
  4: "（自由行动中）",
};

export interface SkipMoveEncounter {
  location: string;
  charaNum: number | null;
  name: string | null;
  kehai: Kehai;
}

/** First NPC (ascending charaNum) at a room (COMF400.ERB:499-504). */
function firstNpcAt(state: GameState, location: string): CharaSlot | null {
  let best: CharaSlot | null = null;
  for (const key of Object.keys(state.charas)) {
    const slot = state.charas[Number(key)];
    if (!slot || slot.location !== location) continue;
    if (best === null || slot.charaNum < best.charaNum) best = slot;
  }
  return best;
}

/** Exported for the arrival-popup wiring in `game-state-store.ts`: a room
 *  "has a present NPC" iff at least one chara slot is currently located
 *  there (master excluded by charaNum filter on the consumer side if needed). */
export function hasNpcAt(state: GameState, location: string): boolean {
  return firstNpcAt(state, location) !== null;
}

/** Encounters at each intermediate room (walk order), faithful to the relay
 *  loop `COMF400.ERB:497-530`. Pure inspection helper (no mutation). */
export function planSkipMoveEncounters(
  state: GameState,
  intermediateRooms: string[],
): SkipMoveEncounter[] {
  return intermediateRooms.map((loc) => {
    const slot = firstNpcAt(state, loc);
    if (!slot) {
      return { location: loc, charaNum: null, name: null, kehai: 0 as Kehai };
    }
    return {
      location: loc,
      charaNum: slot.charaNum,
      name: slot.callName ?? `#${slot.charaNum}`,
      kehai: checkHehai(slot, state),
    };
  });
}

/** 経過時間 for a completed walk = 中継回数 + 1 (COMF400.ERB:532). */
export function skipMoveSteps(intermediateRooms: string[]): number {
  return intermediateRooms.length + 1;
}

export interface WalkStepResult {
  /** Narration produced this call (pass-throughs / dialogue / arrival). */
  events: ObservationEvent[];
  /** True when the walk concluded (arrived or stopped) this call. When false,
   *  `state.walkSession` holds the encounter awaiting a choice. */
  done: boolean;
}

export interface WalkKojoDeps {
  dialogueRouter?: DialogueRouter;
  rng?: Rng;
}

type ActiveWalkEncounter = NonNullable<NonNullable<GameState["walkSession"]>["encounter"]>;

function narr(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

function encounterKojoEvents(
  state: GameState,
  enc: ActiveWalkEncounter,
  subCode: 1 | 2 | 3,
  now: () => number,
  deps?: WalkKojoDeps,
): ObservationEvent[] {
  if (!enc.charaNum || !deps?.dialogueRouter || !deps.rng) return [];
  const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, enc.charaNum, 4, deps.rng, [subCode, 0]);
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now(),
    charaNum: enc.charaNum!,
    text: line.text,
    form: line.form,
  }));
}

function charaName(slot: CharaSlot): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

/** A destination is "special" when the room-enter registry routes it (P1-03):
 *  toilet / bath dispatch their own destination event; every other modeled
 *  special (locked private room) is handled by `concludeWalk` before this
 *  predicate runs. Keeping the check in the registry makes the dispatch and
 *  the room-enter audit share one source of truth. */
function isModeledDestinationSpecial(state: GameState, dest: string): boolean {
  const kinds = roomEnterKindsFor(state, dest);
  return kinds.includes("toilet") || kinds.includes("bath");
}

function pushDestinationEncounterEvents(
  state: GameState,
  dest: string,
  now: () => number,
  events: ObservationEvent[],
  deps?: WalkKojoDeps,
): void {
  const npc = firstNpcAt(state, dest);
  if (!npc) return;
  const kehai = checkHehai(npc, state);
  const name = charaName(npc);
  const enc: ActiveWalkEncounter = {
    location: dest,
    charaNum: npc.charaNum,
    name,
    kehai,
    canGreet: (state.flagStore[TIMESTOP_FLAG] ?? 0) === 0,
  };
  events.push(narr(now, `到达${roomName(dest)}时遇到了${name}${ENCOUNTER_VERB[kehai]}`));
  events.push(...encounterKojoEvents(state, enc, 3, now, deps));
}

/** `合意_うふふ = 1p1` — bit 1 of `CFLAG:既成事実` (DIM_als.ERH:100). */
const CONSENT_UFUFU_BIT = 1 << 1;

/**
 * `@風呂逐出条件(ARG)` (`EVENTCOMEND2.ERB:410-432`) — does the bathing chara
 * eject the master. `true` = kicked out, `false` = stays (eye-contact). The
 * disposition arms are ported faithfully; the anatomy arm (`!扶她 &&
 * HETEROSEX`) is deferred (gender-pair helper, see file header), and セフレ is
 * absent from base-game `Talent.csv` (→ 0). The fresh-game 低態度 path = kicked.
 */
function bathEjectCondition(state: GameState, slot: CharaSlot): boolean {
  const cf = slot.state.CFLAG;
  const tal = slot.state.TALENT;
  const abl = slot.state.ABL;
  // 时停 (CFLAG:TARGET:344==0 default) → not ejected; the peek branch handles it.
  if ((state.flagStore[TIMESTOP_FLAG] ?? 0) !== 0) return false;
  // anatomy arm (!扶她 && HETEROSEX) — DEFERRED.
  if ((tal[TALENT_ID.羞恥心] ?? 0) < 0 && (abl[ABL_ID.親密] ?? 0) >= 5) return false;
  if ((tal[TALENT_ID.無知] ?? 0) !== 0 && (abl[ABL_ID.親密] ?? 0) >= 5) return false;
  if ((cf[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return false;
  // FLAG:催眠強度 is a GLOBAL flag (FLAG_ID 9021), not per-chara; defaults to 0.
  if ((state.flagStore[FLAG_ID.催眠強度] ?? 0) > 50) return false;
  if (computeAttitude(slot, state.master, state) < 2) return true;
  if ((cf[CFLAG_ID.既成事実] ?? 0) < 1) return true;
  // !((既成事実 & 合意_うふふ) || 恋慕 || セフレ) → ejected (セフレ → 0).
  const established = cf[CFLAG_ID.既成事実] ?? 0;
  const consented = (established & CONSENT_UFUFU_BIT) !== 0;
  const renbo = (tal[TALENT_ID.恋慕] ?? 0) !== 0;
  if (!(consented || renbo)) return true;
  return false;
}

/** Occupant with MIN `CFLAG:態度` at a room (`IN_ROOM_MEMBER "MIN"`, COMF400.ERB:542).
 *  態度 is derived on-demand (no persisted INFO refresh) via `computeAttitude`. */
function minAttitudeNpcAt(state: GameState, location: string): CharaSlot | null {
  let best: CharaSlot | null = null;
  let bestAtt = 0;
  for (const key of Object.keys(state.charas)) {
    const slot = state.charas[Number(key)];
    if (!slot || slot.location !== location) continue;
    const att = computeAttitude(slot, state.master, state);
    if (best === null || att < bestAtt) {
      best = slot;
      bestAtt = att;
    }
  }
  return best;
}

/** Is the master escorting any 同行 companion (`CFLAG:MASTER:同行`, COMF400.ERB:543). */
function masterHasCompanion(state: GameState): boolean {
  return Object.keys(state.charas).some(
    (k) => (state.charas[Number(k)]?.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0,
  );
}

function companions(state: GameState): CharaSlot[] {
  return Object.values(state.charas)
    .filter((slot): slot is CharaSlot => Boolean(slot) && (slot.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0)
    .sort((a, b) => a.charaNum - b.charaNum);
}

/**
 * `$STOP` destination event for FINAL arrival at `dest` (COMF400.ERB:537-625).
 * Returns the bounce-back location (直前位置) when the master cannot enter
 * (occupied toilet / kicked out of the bath), else `null` (stays at dest).
 * Pushes faithful narration. Only the 廁所 / 浴場 (alone) arms are modeled.
 */
function runDestinationEvent(
  state: GameState,
  dest: string,
  prevLocation: string,
  now: () => number,
  events: ObservationEvent[],
  deps?: WalkKojoDeps,
): string | null {
  const masterName = state.master.callName ?? "主人";
  const timestop = (state.flagStore[TIMESTOP_FLAG] ?? 0) !== 0;

  if (inToilet(dest)) {
    // 廁所侵入 (侵入.ERB:76). Occupied (non-时停) → can't enter, bounce back.
    const occupant = firstNpcAt(state, dest);
    if (occupant && !timestop) {
      events.push(narr(now, `${charaName(occupant)}好像在里面。`));
      return prevLocation;
    }
    // empty (or 时停 announce-and-enter, loop deferred) → enter.
    return null;
  }

  if (bathCheck(state, dest)) {
    if (masterHasCompanion(state)) {
      // COMF400.ERB:557-578: companion refusal precedes the bath occupant
      // check; the first willing companion supplies EVENT 23's invite arm.
      const following = companions(state);
      const refusing = following.find((slot) => bathEjectCondition(state, slot));
      if (refusing) {
        events.push(narr(now, `共同入浴的邀请被${charaName(refusing)}拒绝了。`));
        events.push(...bathCompanionKojoEvents(state, refusing, 1, now, deps));
        return prevLocation;
      }
      const occupant = minAttitudeNpcAt(state, dest);
      if (occupant && bathEjectCondition(state, occupant)) {
        events.push(narr(now, `被在浴场里的${charaName(occupant)}赶了出来…`));
        events.push(...bathKojoEvents(state, occupant, 1, now, deps));
        return prevLocation;
      }
      const companion = following[0];
      if (companion) {
        events.push(narr(now, `${charaName(companion)}好像想一起进入浴场的样子。`));
        events.push(...bathCompanionKojoEvents(state, companion, 2, now, deps));
      }
      return null;
    }
    const occupant = minAttitudeNpcAt(state, dest);
    if (!occupant) {
      events.push(narr(now, `进入浴场的${masterName}泡在了浴池里。`));
      return null;
    }
    if (bathEjectCondition(state, occupant)) {
      events.push(narr(now, `被在浴场里的${charaName(occupant)}赶了出来…`));
      events.push(...bathKojoEvents(state, occupant, 1, now, deps));
      return prevLocation;
    }
    // eye-contact (COMF400.ERB:549-556).
    if (timestop) {
      events.push(narr(now, `${charaName(occupant)}正在入浴中的样子…`));
    } else {
      events.push(narr(now, `与在浴场里的${charaName(occupant)}对上了视线…`));
      events.push(...bathKojoEvents(state, occupant, 2, now, deps));
    }
    return null;
  }

  // 私室施錠 is handled by concludeWalk as a PAUSE (潜入/算了), not here.
  return null;
}

/** `COMF400:547/554` — bath encounter reactions are EVENT 11, with the
 * branch code passed in ARG:0.  Keep the normal narration as the shared
 * fallback; authored text is additive and owner-aware. */
function bathKojoEvents(
  state: GameState,
  occupant: CharaSlot,
  arm: 1 | 2,
  now: () => number,
  deps?: WalkKojoDeps,
): ObservationEvent[] {
  if (!deps?.dialogueRouter || !deps.rng) return [];
  return resolveEventKojoAndApply(deps.dialogueRouter, state, occupant.charaNum, 11, deps.rng, [arm, 0])
    .map((line) => ({
      kind: "DIALOGUE_LINE" as const,
      timestamp: now(),
      charaNum: occupant.charaNum,
      text: line.text,
      form: line.form,
    }));
}

function bathCompanionKojoEvents(
  state: GameState,
  companion: CharaSlot,
  arm: 1 | 2,
  now: () => number,
  deps?: WalkKojoDeps,
): ObservationEvent[] {
  if (!deps?.dialogueRouter || !deps.rng) return [];
  return resolveEventKojoAndApply(deps.dialogueRouter, state, companion.charaNum, 23, deps.rng, [arm, 0])
    .map((line) => ({
      kind: "DIALOGUE_LINE" as const,
      timestamp: now(),
      charaNum: companion.charaNum,
      text: line.text,
      form: line.form,
    }));
}

/**
 * Conclude the walk at `dest` with `経過時間 = keika`: sync the master's room,
 * run the `$STOP` destination event when `runDestEvent` (final arrival only —
 * it may bounce the master back to `prevLocation`), pay time once
 * (`TIME += 2 * 経過時間`, COMF400.ERB:642-643, paid regardless of a bounce),
 * companions follow, the CFLAG[300] bridge syncs, `walkSession` clears, and we
 * narrate the final position.
 */
function concludeWalk(
  state: GameState,
  dest: string,
  keika: number,
  prevLocation: string,
  runDestEvent: boolean,
  now: () => number,
  events: ObservationEvent[],
  kojo?: WalkKojoDeps,
): boolean {
  const minutes = 2 * keika;
  // COMF400 pays the walk time at the $STOP label regardless of the event
  // outcome (bounce / sneak-pause), so pay it up front.
  advanceTimeTicks(state, minutes);

  // 私室施錠 (COMF400.ERB:586-605): a locked 私室 whose resident is asleep
  // PAUSES the walk for the 潜入/算了 choice. The master waits at 直前位置.
  if (runDestEvent) {
    const owner = lockedRoomOwner(state, dest);
    if (owner) {
      setSlotLocation(state.master, prevLocation);
      state.walkSession = {
        remaining: [],
        dest,
        stepsTaken: keika,
        prevLocation,
        lockedDoor: {
          location: dest,
          ownerCharaNum: owner.charaNum,
          ownerName: owner.callName ?? `#${owner.charaNum}`,
        },
      };
      events.push(narr(now, lockedRoomMessage(owner)));
      return true; // paused for 潜入/算了
    }
  }

  setSlotLocation(state.master, dest);
  let finalLoc = dest;
  const handledSpecialDestination = runDestEvent && isModeledDestinationSpecial(state, dest);
  if (runDestEvent) {
    const bounced = runDestinationEvent(state, dest, prevLocation, now, events, kojo);
    if (bounced !== null) {
      setSlotLocation(state.master, bounced);
      finalLoc = bounced;
    }
  }
  if (runDestEvent && finalLoc === dest && !handledSpecialDestination) {
    pushDestinationEncounterEvents(state, dest, now, events, kojo);
  }
  if (finalLoc === dest) {
    events.push(...pitfallArrivalEvents(state, dest, now()));
  }
  // Synchronize only after the master's final location is known. The previous
  // ordering synced followers to prevLocation and then left them behind.
  followCompanions(state, minutes);
  state.walkSession = null;
  events.push(narr(now, `移动到了${roomName(finalLoc)}。`));
  return false; // concluded
}

/**
 * Walk the remaining `queue` of intermediate rooms toward `dest`, narrating
 * each pass-through. Pauses (sets `state.walkSession`, returns `done:false`) at
 * the first occupied room that needs a choice (mode 0/1); under mode 2 it walks
 * through silently. When the queue empties, arrives at `dest` (経過時間 = total
 * relays + 1).
 */
function walkRemaining(
  state: GameState,
  queue: string[],
  dest: string,
  stepsTaken: number,
  prevLocation: string,
  mode: StopWalkingMode,
  now: () => number,
  events: ObservationEvent[],
  kojo?: WalkKojoDeps,
): WalkStepResult {
  const rest = [...queue];
  let steps = stepsTaken;
  while (rest.length > 0) {
    const room = rest.shift()!;
    steps += 1;
    const npc = firstNpcAt(state, room);
    if (!npc) {
      events.push(narr(now, `经过${roomName(room)}，谁也不在`));
      continue;
    }
    const kehai = checkHehai(npc, state);
    const name = npc.callName ?? `#${npc.charaNum}`;
    events.push(narr(now, `经过${roomName(room)}时遇上了${name}${ENCOUNTER_VERB[kehai]}`));
    if (mode === 2) {
      // 立ち止まらない — walk through, no dialogue (COMF400.ERB:509-510).
      continue;
    }
    // Pause for the player's 无视/打招呼/停下来 choice (COMF400.ERB:514).
    state.walkSession = {
      remaining: rest,
      dest,
      stepsTaken: steps,
      prevLocation,
      encounter: {
        location: room,
        charaNum: npc.charaNum,
        name,
        kehai,
        canGreet: (state.flagStore[TIMESTOP_FLAG] ?? 0) === 0,
      },
    };
    return { events, done: false };
  }
  // Queue empty → arrive at the destination (経過時間 = relays + 1) + $STOP event.
  // concludeWalk returns true when it PAUSED at a locked door (潜入/算了).
  const paused = concludeWalk(state, dest, steps + 1, prevLocation, true, now, events, kojo);
  return { events, done: !paused };
}

/**
 * Begin a SKIP_MOVE walk along `rooms` (ordered `[first hop … destination]`,
 * the `findPath` toLocations). Mutates `state`. Returns the narration so far +
 * whether it concluded; if it paused, `state.walkSession` holds the encounter.
 * No-op (empty events, done) when `rooms` is empty.
 */
export function startSkipMove(
  state: GameState,
  rooms: string[],
  now: () => number,
  mode: StopWalkingMode = 0,
  kojo?: WalkKojoDeps,
): WalkStepResult {
  const events: ObservationEvent[] = [];
  if (rooms.length === 0) return { events, done: true };
  const dest = rooms[rooms.length - 1]!;
  // `@MAP_CAN_MOVE_0` destination entry gate — the colored-map walk must honor
  // the same room-entry permission the SceneView exit handler does
  // (`room-move.ts`). Without this the player could path-walk into rooms barred
  // to them (e.g. 針妙丸's 小人の虫籠 needs 小人体型, 三妖精之家 needs 妖精/恋慕/
  // 教養). The refusal message mirrors `@MAP_CANNOT_WORD_0`; no move, no time.
  const gate = mapCanMove(state, dest, state.master);
  if (!gate.can) {
    const message =
      gate.message ??
      (gate.reason === 2
        ? "无论如何也进不去" // 虫籠 — 小人 only
        : gate.reason === 1
          ? "没有找到路" // 三妖精之家
          : "进不去"); // reason 3 (大別墅 DLC) / fallback
    events.push(narr(now, message));
    return { events, done: true };
  }
  const intermediate = rooms.slice(0, -1);
  // 直前位置 — room just before the dest (bounce target), or the start when direct.
  const prevLocation = rooms.length >= 2 ? rooms[rooms.length - 2]! : state.master.location;
  return walkRemaining(state, intermediate, dest, 0, prevLocation, mode, now, events, kojo);
}

/**
 * Resume a paused walk with the player's choice at the current encounter
 * (`COMF400.ERB:514-526`):
 *   - `stop`  停下来 — narrate, end the walk AT the encounter room
 *     (経過時間 = relays passed so far), `GOTO STOP`.
 *   - `greet` 打招呼后继续 — narrate, keep walking.
 *   - `ignore` 无视 — narrate, keep walking.
 * No-op (done) when there is no pending `walkSession`.
 */
export function resolveWalkEncounter(
  state: GameState,
  choice: WalkChoice,
  now: () => number,
  mode: StopWalkingMode = 0,
  kojo?: WalkKojoDeps,
): WalkStepResult {
  const ws = state.walkSession;
  if (!ws) return { events: [], done: true };
  const events: ObservationEvent[] = [];

  // Locked-door pause (潜入/算了, COMF400.ERB:614 → @潜入房間).
  if (ws.lockedDoor) {
    const ld = ws.lockedDoor;
    if (choice === "sneak") {
      // @潜入房間 resolves the final position (entered dest / kicked back).
      const res = attemptSneakIn(state, ld.location, ws.prevLocation, now, kojo);
      events.push(...res.events);
    } else {
      // 算了 — stay at 直前位置 (already set when the walk paused).
      events.push(narr(now, `还是算了，没有潜入${ld.ownerName}的房间。`));
    }
    state.walkSession = null;
    return { events, done: true };
  }

  if (!ws.encounter) {
    state.walkSession = null;
    return { events, done: true };
  }
  const enc = ws.encounter;

  if (choice === "stop") {
    // EVENT 4 sub-code 1. Mid-walk stop: no $STOP destination event (the
    // upstream RESULT=next-relay quirk is deferred — see header), so
    // `runDestEvent = false`.
    events.push(narr(now, `停下脚步，陪在了${enc.name}身边。`));
    events.push(...encounterKojoEvents(state, enc, 1, now, kojo));
    concludeWalk(state, enc.location, ws.stepsTaken, ws.prevLocation, false, now, events, kojo);
    return { events, done: true };
  }

  if (choice === "greet") {
    // EVENT 4 sub-code 2.
    events.push(narr(now, `向${enc.name}打了声招呼，继续赶路。`));
    events.push(...encounterKojoEvents(state, enc, 2, now, kojo));
  } else {
    // ignore — EVENT 4 sub-code 3.
    events.push(narr(now, `没有理会${enc.name}，径直走了过去。`));
    events.push(...encounterKojoEvents(state, enc, 3, now, kojo));
  }
  // Continue from the rooms recorded after the encounter.
  return walkRemaining(state, ws.remaining, ws.dest, ws.stepsTaken, ws.prevLocation, mode, now, events, kojo);
}
