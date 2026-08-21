/**
 * Phase 8.3 / 8.4 — WorldScheduler entry point.
 *
 * `reprojectSchedules(state, oldMin, newMin, now)` is the turn-based core: a
 * command's `TIME += N` advances the clock, then we re-project every NPC to
 * where the **real eraTW movement model** says they should be at `newMin`. No
 * real-time tick, no `tickClock` — the caller owns time advancement (faithful
 * to upstream where only commands advance `TIME`, `BEFORETRAIN`→`CHARA_MOVEMENT`).
 *
 * **Work-driven model (replaces the fabricated 24h tables).** Upstream
 * `@CHARA_MOVEMENT` (`MOVEMENT.ERB`) orders per-character: 起床就寝 → 訪問帰宅 →
 * 休日移動. We port the portable core of that:
 *   1. `applyConfiguredSchedule` — the CSV 就寝/起床 overlay owns the 睡眠 flag
 *      + home relocation for EVERY chara (faithful `@起床就寝処理`).
 *   2. For each awake NPC: work window (`JOB_仕事内容.ERB`, real transcribed
 *      data) → work room; else activity window (`@VISIT` = `[来訪,帰宅)`) →
 *      遭遇位置 (picked by the `@遭遇判定` morning refresh, spot-level odekake
 *      points bridged to modern rooms); else → home (`@KITAKU`).
 *
 * This is real data, not the hand-authored hourly agendas it replaces. The
 * current scope ports the built-map part of `@遭遇判定` / `@TIMEZONE_MOVE`;
 * off-map destinations remain deferred instead of fabricated.
 */

import type { GameState } from "../state/index.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import type { Rng } from "../command/types.js";
import { BASE_ID, CFLAG_ID, FLAG_ID, TCVAR_ID } from "../state/settlement.js";
import { tickClock } from "./clock.js";
import { crossedTimeZone, TIME_ZONE_NARRATION } from "./time-of-day.js";
import { applyConfiguredSchedule, configuredEventsBetween } from "./configured-schedule.js";
import { roomIdToLocation, setSlotLocation } from "./room-id-location.js";
import { applyNaturalDrift } from "../state/base-natural-drift.js";
import { atOwnHome, atPlayerBase } from "./location-predicates.js";
import { applyWeatherExposure } from "../weather/effects.js";
import { syncDrunkenness } from "../state/alcohol.js";
import {
  JOB_ID,
  JOB_LABEL,
  resolveWorkEntry,
  WORK_MANIFEST,
} from "./work/work-manifest.js";
import { beginOrRefreshWork, ensureWorkRuntime, finishWork, isEventManagedWork, workRuntimeEntryAt } from "./work/work-system.js";
import { jobSceneProse, workloadRemainingProse } from "./work/job-prose.js";
import { isInVisitWindow } from "./work/visit.js";
import { advancedRoamStep, evictFromPrivateRoom } from "./work/roam-advanced.js";
import { getScheduleProvider } from "./schedule-provider.js";
import { encounterTargetLocation, runEncounterTimezoneMove } from "./encounter.js";
import { kickOutOfBedroom } from "./kick-out.js";
import {
  advanceFreeAction,
  canChainFreeActionType,
  canContinueFreeAction,
  canRunFreeAction,
  freeActionText,
  freeActionEvent,
  interruptFreeAction,
  maybeStartFreeAction,
} from "./free-action.js";
import { relationOf } from "./relation.js";
import type { CharaSlot } from "../state/index.js";

/** Optional kojo deps for `reprojectSchedules`. When present, an observable
 *  true `@KITAKU` transition fires 帰宅口上 (EVENT 20, arm 1 通常帰宅)
 *  before the move narration. Ordinary detailed-map room movement is not a
 *  return-home event. Absent ⇒ narration only. */
export interface ReprojectKojoDeps {
  dialogueRouter?: DialogueRouter;
  rng?: Rng;
}

/** Short room label for move narration: "神社:境内" → "境内"; "人間之里" → itself. */
function roomLabel(loc: string): string {
  const i = loc.indexOf(":");
  return i >= 0 ? loc.slice(i + 1) : loc;
}

/** Display name for a chara slot (callName, falling back to #charaNum). */
function charaName(slot: { charaNum: number; callName?: string }): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

const ACTION_WORKING = 5;

function minuteOfDay(tick: number): number {
  return ((tick % 1440) + 1440) % 1440;
}

function emitEventKojo(
  events: ObservationEvent[],
  deps: ReprojectKojoDeps | undefined,
  state: GameState,
  now: () => number,
  charaNum: number,
  arm: number,
  args: number[],
): void {
  if (!deps?.dialogueRouter || !deps.rng) return;
  const lines = resolveEventKojoAndApply(deps.dialogueRouter, state, charaNum, arm, deps.rng, args);
  for (const line of lines) {
    events.push({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum,
      text: line.text,
      form: line.form,
    });
  }
}

function workProgressBucket(slot: CharaSlot): number {
  const work = slot.state.BASE[13] ?? 0;
  const maxWork = slot.state.MAXBASE[13] ?? work;
  if (maxWork <= 0 || work <= 0) return 0;
  if (work >= Math.trunc((maxWork / 3) * 2)) return 3;
  if (work >= Math.trunc(maxWork / 3)) return 2;
  return 1;
}

/** Movement locks mirrored from the upstream `角色移動処理` gate.  Work is
 * intentionally excluded: the scheduler still has to advance a working
 * character's job, but must not apply the later free-roam projection while
 * one of these states is active. */
function movementProjectionLocked(state: GameState, slot: CharaSlot): boolean {
  return Boolean(
    state.flagStore[FLAG_ID.時間停止] ||
    slot.state.CFLAG[CFLAG_ID.衰弱] ||
    slot.state.CFLAG[CFLAG_ID.招待] ||
    slot.state.CFLAG[CFLAG_ID.睡眠] ||
    slot.state.CFLAG[CFLAG_ID.延迟] ||
    slot.state.CFLAG[CFLAG_ID.陪睡中] ||
    slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ||
    slot.state.CFLAG[CFLAG_ID.同行] ||
    slot.state.TCVAR[TCVAR_ID.泥酔],
  );
}

/**
 * The deterministic work/roam/home location decision for one awake NPC at
 * `tick` (the real eraTW `@CHARA_MOVEMENT` portable core). Extracted so the
 * schedule-provider seam can override it: `reprojectSchedules` asks the live
 * `ScheduleProvider` first, and falls back to THIS when it defers (null).
 *
 *   1. 仕事 window (real `JOB_仕事内容` data) → 職場. Priority over roaming/visit.
 *   2. 拠点来訪 visitor in their `@VISIT` window → the master's base
 *      (`@主人公物件へ向かう`); window closed → heads home (`@KITAKU`).
 *   3. `CFLAG:遭遇位置` during the activity window → spot representative room.
 *   4. Shrine resident not working → `@角色移動処理` roam (roam.ts); null = stayed.
 *   5. Off-shrine / no roam → `@KITAKU` (home).
 * Returns null when the chara should stay put (e.g. roam produced no move).
 */
function deterministicNpcLocation(
  state: GameState,
  slot: CharaSlot,
  tick: number,
  elapsed: number,
): string | null {
  // `@VISIT` / work windows are minutes-of-day; `tick` is absolute tickValue.
  const tickMin = minuteOfDay(tick);

  const workLoc = (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING
    ? roomIdToLocation(slot.state.CFLAG[CFLAG_ID.职场] ?? 0)
    : null;
  if (workLoc) return workLoc; // 仕事中 takes priority over 拠点来訪 (`!仕事中チェック`)

  // `角色移動処理` only operates on characters that are in a base map and
  // explicitly returns for sleep/companion/intimate/drunk/time-stop states.
  // Keep this guard after the work branch so job progression remains alive,
  // but stop the modern roam fallback from making these states run away.
  if (movementProjectionLocked(state, slot)) return null;

  // 拠点来訪: a chara flagged by `@来訪フラグ` (visit-flags.ts) spends their
  // activity window at the master's base — faithful `@主人公物件へ向かう`
  // (MOVEMENT_SUB.ERB:211-214). Note: a flagged visitor is never a 神社在住
  // resident (`@来訪可能` excludes them), so this block fully owns their motion
  // — when their window closes they head home (`@KITAKU`), NOT the resident roam.
  // The upstream per-map landing room CFLAG:(450+map) / `@QOL_VISITOR_LOCATION_
  // SELECTION` random pick is deferred (no CSV import); the MVP lands them at the
  // master's base room.
  if (slot.state.CFLAG[CFLAG_ID.拠点来訪]) {
    if (isInVisitWindow(slot, tickMin)) {
      return state.homeLocation ?? state.master.location;
    }
    return slot.homeLocation ?? slot.location;
  }

  // `@休日移動処理`: a morning `@遭遇判定` target is consumed during the
  // character's activity window. It must survive UNTIL the window closes —
  // clearing it before the window OPENS was a bug (2026-07-04): 61/73 charas
  // open their `[来訪時間, 帰宅時間)` window after 09:00, so the very first
  // time-advancing command after an 08:00 wake wiped every not-yet-active
  // encounter and no cross-map visitor ever appeared. The morning
  // `@遭遇判定` already zeroes every spot at day start, so the flag naturally
  // lives exactly one day; here we only drop it once the chara has gone home
  // (past 帰宅時間), keeping it (but staying home/roaming) before the window.
  const encounterLoc = encounterTargetLocation(state, slot);
  if (encounterLoc) {
    if (isInVisitWindow(slot, tickMin)) return encounterLoc;
    const visit = slot.state.CFLAG[CFLAG_ID.来訪時間] ?? 0;
    const ret = slot.state.CFLAG[CFLAG_ID.帰宅時間] ?? 0;
    if (visit > 0 && ret > 0 && visitWindowHasClosed(visit, ret, tickMin)) {
      delete slot.state.CFLAG[CFLAG_ID.遭遇位置];
    }
    // else: window not yet opened → keep the flag, fall through to home/roam.
  }

  // Visitor/encounter transitions above are allowed to bring an NPC back to
  // the master's room or to its selected encounter room.  Once those
  // explicit transitions are exhausted, an NPC that is still outside its
  // resolved home must be projected home; the original movement pass does
  // not start a free-roam step from an arbitrary off-map room.  This also
  // removes stale imported occupants from the master's room on the morning
  // movement pass without touching an active companion/sleep state (guarded
  // above).
  if (!atPlayerBase(state, slot.charaNum) && !atOwnHome(state, slot.charaNum)) {
    return slot.homeLocation ?? null;
  }

  const runningFreeAction = state.freeActions?.[slot.charaNum];
  if (runningFreeAction && runningFreeAction.remainingMinutes > 0 && canContinueFreeAction(state, slot, runningFreeAction)) {
    return null; // Activity_Duration active → TCVAR:なるべく動かない equivalent.
  }

  // `@角色移動処理` is map-agnostic in upstream eraTW — every awake chara
  // whose 仕事/拠点来訪/遭遇 slots aren't active gets a roam step. The
  // earlier `slot.location.startsWith("神社:")` gate here (Bug fix
  // 2026-07-04 user report: 命蓮寺/紅魔館/竹林 residents frozen at
  // home) was a narrowed-scoped artifact from when only the 神社 map was
  // built.
  //
  // `advancedRoamStep` is currently shrine-specific (shrineNeighbors +
  // findNextHop only know the 神社 map). For non-shrine chara locations,
  // we fall back to a single-step random neighbor in the chara's home
  // map using the committed scenes bundle (a faithful mirror of each
  // generated {map}-move.ts handler table). This is the bare-minimum
  // multi-map roam so a 永琳 (永遠亭 resident) actually walks around
  // inside 永遠亭 rather than being pinned to her room. Full multi-map
  // roam (停留率/weather/引力点) lands with the upcoming generic rewrite.
  const roamStep = advancedRoamStep(state, slot, elapsed);
  if (roamStep !== null) return roamStep;
  if (slot.location.startsWith("神社:")) return null; // null = stayed (shrine behavior)
  return roamInHomeMap(slot, tick);
}

/** Small integer avalanche hash (splitmix32-style finalizer) so the ambient
 *  roam spreads a chara's hourly positions evenly across their neighbour set
 *  instead of clumping on one phase (a plain XOR-then-mod distributed poorly
 *  for small cycles). Deterministic; returns a non-negative 32-bit int. */
function hashInt(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}

/** Is `t` past the (possibly midnight-wrapping) activity window `[visit, ret)`?
 *  Non-wrap window (visit < ret): closed once `t >= ret`. Wrap window
 *  (visit >= ret, spans midnight): closed only in the daytime gap
 *  `[ret, visit)`. Used to drop a stale 遭遇位置 after the chara heads home. */
function visitWindowHasClosed(visit: number, ret: number, t: number): boolean {
  if (visit < ret) return t >= ret;
  return t >= ret && t < visit;
}

/** Deterministic ambient position for a non-shrine resident: at each hour of
 *  the day they are at one of their home room's walkable neighbours, or home
 *  itself. This makes 命蓮寺/紅魔館/竹林 residents visibly move around their
 *  map over the day instead of teleporting once to a fixed neighbour and
 *  freezing (the old seed had no time term and read the same home room every
 *  call). Stays near home (1 hop) so it can never wander into an unbuilt room;
 *  the full 停留率/引力点 roam engine lands with the generic multi-map rewrite. */
function roamInHomeMap(slot: CharaSlot, tick: number): string | null {
  const home = slot.homeLocation ?? slot.location;
  const homeColon = home.indexOf(":");
  const prefix = homeColon === -1 ? home : home.slice(0, homeColon);
  const current = slot.location === prefix || slot.location.startsWith(`${prefix}:`)
    ? slot.location
    : home;
  const currentColon = current.indexOf(":");
  const currentRoom = currentColon === -1 ? "" : current.slice(currentColon + 1);
  const neighbors = _ROOM_NEIGHBORS.get(prefix)?.get(currentRoom);
  if (!neighbors || neighbors.length === 0) return current === home ? null : home;
  const hourBucket = Math.floor((((tick % 1440) + 1440) % 1440) / 60);
  // +1 phase = stay in the current room; stable within the
  // hour (turn-based re-projection runs many times per band → no jitter).
  const cycle = neighbors.length + 1;
  const idx = hashInt(slot.charaNum * 131 + hourBucket) % cycle;
  if (idx === neighbors.length) return current;
  return neighbors[idx]!;
}

/** Map prefix → room-name → outgoing `full location strings` (1 hop, faithful
 *  to the generated {map}-move.ts handler tables). Seeded by `registerMoveEdge`
 *  from the handler modules at app init; fallback static table from the committed
 *  scenes bundle when init hasn't been called yet. */
/** Seed the multi-map roam neighbor table from the committed scenes bundle.
 *  Call once at app startup (from App.tsx) and once per test (from helpers). */
const _ROOM_NEIGHBORS = new Map<string, Map<string, string[]>>();

export function seedRoomNeighbors(
  scenes: ReadonlyArray<{ location: string; exits: ReadonlyArray<{ toLocation: string }> }>,
): void {
  _ROOM_NEIGHBORS.clear();
  for (const scene of scenes) {
    if (!scene || typeof scene.location !== "string") continue;
    const colon = scene.location.indexOf(":");
    const prefix = colon === -1 ? scene.location : scene.location.slice(0, colon);
    const room = colon === -1 ? "" : scene.location.slice(colon + 1);
    let roomMap = _ROOM_NEIGHBORS.get(prefix);
    if (!roomMap) { roomMap = new Map(); _ROOM_NEIGHBORS.set(prefix, roomMap); }
    for (const ex of scene.exits ?? []) {
      const exColon = ex.toLocation.indexOf(":");
      if (exColon === -1) continue;
      const exPrefix = ex.toLocation.slice(0, exColon);
      if (exPrefix !== prefix) continue;
      const exRoom = ex.toLocation.slice(exColon + 1);
      if (exRoom === room) continue;
      let bucket = roomMap.get(room);
      if (!bucket) { bucket = []; roomMap.set(room, bucket); }
      if (!bucket.includes(ex.toLocation)) bucket.push(ex.toLocation);
    }
  }
}

/**
 * Seed every NPC to the location the work/home model says they should be in at
 * the current `tickValue`. Called once at new-game (after the CSV-home init +
 * `initializeConfiguredSchedules`) so a character starts where they belong NOW
 * rather than frozen at 初期位置 until the next slot boundary.
 * Asleep characters are left to the configured overlay (already home + 睡眠).
 * Mutates in place.
 */
export function seedScheduledLocations(state: GameState): void {
  const t = state.time.tickValue;
  const minute = minuteOfDay(t);
  ensureWorkRuntime(state);
  for (const slot of Object.values(state.charas)) {
    if (slot.state.CFLAG[CFLAG_ID.睡眠]) continue;
    const work = workRuntimeEntryAt(state, slot.charaNum, minute);
    if (work) beginOrRefreshWork(state, slot, work, minute);
    // Faithful subset: a character at their work window/room is there; everyone
    // else is at home (@KITAKU). 拠点来訪 (NPC visits the player) and the
    // @角色移動処理 in-base roaming are separate upstream subsystems, deferred.
    const toLoc = deterministicNpcLocation(state, slot, t, 0);
    if (toLoc && toLoc !== slot.location) setSlotLocation(slot, toLoc);
  }
}

/** Re-run the deterministic location projection at the current clock without
 * advancing time.  The upstream GOODMORNING path calls CHARA_MOVEMENT after
 * its personal greetings; the modern morning pipeline uses this same pass to
 * clear stale imported room occupants and place awake NPCs for the new day. */
export function projectScheduledLocations(state: GameState): void {
  seedScheduledLocations(state);
}

/**
 * Parity QA P-9 — re-project NPCs for a clock advance that has ALREADY
 * happened (the in-game clock moved from `oldMin` to `newMin`).
 *
 * Turn-based: a command's `TIME += N` advances the clock, then we move every
 * NPC per the work/visit/home model, drive the CSV sleep/wake flag, and emit
 * the band-crossing ambient narration. No real-time tick, no `tickClock` — the
 * caller owns time advancement.
 *
 * Mutates `state.charas[*].location` (+ `CFLAG:睡眠`) in place and returns the
 * NARRATION events for the boundaries crossed. When `oldMin === newMin` (a
 * command that costs no time), nothing crosses and `events` is empty.
 */
function chainFreeActionFollowers(
  state: GameState,
  leader: CharaSlot,
  action: { type: number; remainingMinutes: number },
  here: string,
  events: ObservationEvent[],
  now: () => number,
  rng?: Rng,
): void {
  if (!state.freeActions || !canChainFreeActionType(state, leader, action.type)) return;
  for (const follower of Object.values(state.charas)) {
    if (follower.charaNum === leader.charaNum || follower.location !== leader.location) continue;
    if (state.freeActions[follower.charaNum]) continue;
    if (relationOf(follower.charaNum, leader.charaNum) <= 100) continue;
    if (!canRunFreeAction(state, follower)) continue;
    if (!canChainFreeActionType(state, follower, action.type)) continue;

    if (action.type === 15) {
      const followerDuration = 30 + (rng?.int(60) ?? 0) + (follower.charaNum === 76 ? 90 : 0);
      action.remainingMinutes = Math.max(action.remainingMinutes, followerDuration);
    }
    state.freeActions[follower.charaNum] = {
      type: action.type,
      remainingMinutes: action.remainingMinutes,
    };
    follower.state.TCVAR[TCVAR_ID.なるべく動かない] = 1;
    if (follower.location === here) {
      const text = freeActionText(follower, action.type, "start");
      if (text) events.push(freeActionEvent(now, text));
    }
  }
}

/**
 * Common visible work prose — now ported to `@仕事情景描写` in
 * `work/job-prose.ts` (`jobSceneProse` per-job/per-chara prose +
 * `workloadRemainingProse` for the remaining-workload bucket). The old
 * free-action-based `workProgressText` became the CASEELSE fallback there.
 *
 * Upstream `@CHARA_JOBSTR` always calls `@仕事情景描写` before EVENT 13 while
 * a working character is visible. `JOB_お酒` is also used for the women's
 * gathering; Suika's Monday drinking job keeps the ordinary drinking prose
 * (display-only, schedule state unchanged).
 */
function reprojectScheduleInterval(
  state: GameState,
  oldMin: number,
  newMin: number,
  now: () => number,
  deps?: ReprojectKojoDeps,
  emitProgressKojo = true,
): ObservationEvent[] {
  if (newMin === oldMin) return [];
  const events: ObservationEvent[] = [];

  // Time-of-day band crossing (upstream `IF LOCAL != TIME:2` in
  // 日時天候管理.ERB:170). When the 7-band 時間帯 changes, emit one ambient
  // world NARRATION. Per-chara KOJO greetings are deferred (time-of-day.ts).
  const newZone = crossedTimeZone(oldMin, newMin);
  if (newZone !== null) {
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      text: TIME_ZONE_NARRATION[newZone],
      presentation: "ambient",
    });
    if (deps?.rng) runEncounterTimezoneMove(state, deps.rng);
  }

  // Snapshot 睡眠 BEFORE the CSV overlay flips it, so we can spot the 就寝
  // transition (0→1) that drives the kick-out-on-sleep hook below.
  const wasAsleep = new Map<number, boolean>();
  for (const slot of Object.values(state.charas)) {
    wasAsleep.set(slot.charaNum, !!(slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0));
  }

  // CSV sleep/wake overlay (every chara). Owns the 睡眠 flag + the home
  // relocation on sleep. Awake charas fall through to the work/visit/home
  // projection below; asleep charas stay where the overlay put them (home).
  applyConfiguredSchedule(state, oldMin, newMin);

  // @CHARA_MOVEMENT projection for each awake NPC. Narrate a move ONLY when
  // it's relevant to the player — the chara left the master's room or arrived
  // at it (upstream only announces 来訪/退室 around the player, not every step).
  // `here` may change mid-pass when a kick-out relocates the master, so it is
  // reassigned (not const) after each kick.
  let here = state.master.location;

  // Path #2 of `@被从寝室赶了出来` (`@CHARA_SLEEP`, SLEEP.ERB:90-98): an NPC
  // just fell asleep at their OWN 私室 while the AWAKE master is standing in
  // that same room → the woken chara throws the master out. Upstream fires
  // this the tick the chara goes to sleep, gated on メッセージ表示 =
  // `!CFLAG:MASTER:睡眠` (master awake — MOVEMENT_SUB.ERB:166). A master who
  // walks into an ALREADY-sleeping NPC's room is the 侵入/room-lock path
  // (handled elsewhere), NOT a kick — so we only act on the 0→1 transition.
  if (!(state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0)) {
    for (const slot of Object.values(state.charas)) {
      const nowAsleep = !!(slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0);
      if (!nowAsleep || wasAsleep.get(slot.charaNum)) continue; // not a 0→1 flip
      if (!slot.homeLocation || slot.location !== slot.homeLocation) continue;
      if (slot.location !== here) continue; // master not in the chara's 私室
      const kick = kickOutOfBedroom(state, slot, now, { ...deps, ownerFallingAsleep: true });
      if (kick.kicked) {
        events.push(...kick.events);
        here = state.master.location; // master relocated — refresh the layout
      }
    }
  }
  const elapsed = newMin - oldMin;
  ensureWorkRuntime(state, deps?.rng);
  const actionBeforeProjection = new Map<number, number>();
  for (const slot of Object.values(state.charas)) {
    actionBeforeProjection.set(slot.charaNum, slot.state.CFLAG[CFLAG_ID.行动] ?? 0);
  }
  for (const slot of Object.values(state.charas)) {
    if (slot.state.CFLAG[CFLAG_ID.睡眠]) continue;
    const tickMin = minuteOfDay(newMin);
    let work = workRuntimeEntryAt(state, slot.charaNum, tickMin);
    const wasWorking = (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING;
    if (work?.status === "active" && (slot.state.BASE[BASE_ID.仕事量] ?? 0) <= 0) {
      work = null;
    }
    let workStartText: string | null = null;
    if (work) {
      beginOrRefreshWork(state, slot, work, tickMin);
      // `@仕事宴会処理` ends ordinary accompaniment before moving the NPC
      // to a real workplace (JOB_仕事開始終了処理.ERB:171-181). Leaving this
      // flag set made the schedule move a companion away, then the next
      // player room-step forcibly snapped them back to the master.
      if (
        work.jobType !== JOB_ID.酔いつぶれる &&
        (slot.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0
      ) {
        slot.state.CFLAG[CFLAG_ID.同行] = 0;
        if ((slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) {
          slot.state.CFLAG[CFLAG_ID.约会中] = 0;
          if ((state.flagStore[FLAG_ID.デート相手] ?? 0) === slot.charaNum) {
            state.flagStore[FLAG_ID.デート相手] = 0;
          }
        }
        const anotherCompanion = Object.values(state.charas).some(
          (candidate) => candidate.charaNum !== slot.charaNum &&
            (candidate.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0,
        );
        if (!anotherCompanion) state.master.state.CFLAG[CFLAG_ID.同行] = 0;
      }
      const interrupted = state.freeActions?.[slot.charaNum];
      if (interrupted) {
        interruptFreeAction(state, slot, interrupted);
        delete state.freeActions?.[slot.charaNum];
      }
      if (!wasWorking) {
        if (slot.location === here || work.location === here) {
          const label = JOB_LABEL[work.jobType] ?? "仕事";
          workStartText = `${charaName(slot)}为了${label}，往${roomLabel(work.location)}去了。`;
          emitEventKojo(events, deps, state, now, slot.charaNum, 13, [1, 0]);
        }
      // Long command advances are projected through internal boundaries for
      // state accuracy. A working NPC's ambient progress kojo must remain one
      // player-visible reaction for the command, not one per internal slice.
      } else if (emitProgressKojo && slot.location === here && elapsed > 0) {
        const sceneText = jobSceneProse(state, slot, work.jobType);
        if (sceneText) {
          events.push({
            kind: "NARRATION",
            timestamp: now(),
            text: sceneText,
            presentation: "ambient",
          });
        }
        // 工作量三档 progress prose (`@CHARA_JOBSTR` branch B) — only when
        // work remains (`bucket > 0`); same tier feeds the EVENT 13 arm2 arg.
        const bucket = workProgressBucket(slot);
        if (bucket > 0) {
          const remaining = workloadRemainingProse(work.jobType, bucket);
          if (remaining) {
            events.push({
              kind: "NARRATION",
              timestamp: now(),
              text: remaining,
              presentation: "ambient",
            });
          }
        }
        // Suika's authored EVENT 13 / ARG=2 line says the work has already
        // ended and invites the player out for drinks. During her Monday
        // JOB_お酒 window that contradicts the authoritative active-work state
        // and the common "正在喝酒" prose above, so suppress only that broken
        // personal progress arm. Start/end phases and every other job remain
        // routed normally.
        if (!(slot.charaNum === 10 && work.jobType === JOB_ID.お酒)) {
          emitEventKojo(events, deps, state, now, slot.charaNum, 13, [2, bucket]);
        }
      }
    } else if (wasWorking && !isEventManagedWork(slot.state.CFLAG[CFLAG_ID.职种] ?? 0)) {
      const finished = finishWork(state, slot, now);
      events.push(...finished.events);
      if (slot.location === here) {
        events.push({
          kind: "NARRATION",
          timestamp: now(),
          text: `${charaName(slot)}的工作结束了。`,
          presentation: "ambient",
        });
        emitEventKojo(events, deps, state, now, slot.charaNum, 13, [3, 0]);
      }
    }
    // Work has been started/advanced above.  The original movement pass then
    // applies the same state gate before visitor/roam movement; honour it here
    // so an NPC in a companion/sleep/醉酒/etc. state is not projected to a
    // random room after its dialogue or job update.
    if (movementProjectionLocked(state, slot)) continue;
    // Schedule-provider seam: a registered provider (default =
    // agentOverrideProvider, honoring OVERRIDE_SCHEDULE intents) may override
    // the chara's location; null ⇒ defer to the deterministic work/roam/home
    // model. The provider is responsible for the @MAP_CAN_MOVE_0 gate.
    const provider = getScheduleProvider();
    const override = provider ? provider.decideLocation(state, slot.charaNum, newMin) : null;
    const toLoc = override ?? deterministicNpcLocation(state, slot, newMin, elapsed);
    const fromLoc = slot.location;
    if (!toLoc || toLoc === fromLoc) continue;
    const visitWindowEnded = isInVisitWindow(slot, minuteOfDay(oldMin)) &&
      !isInVisitWindow(slot, tickMin);
    const evicted = evictFromPrivateRoom(state, slot, toLoc);
    if (evicted.length > 0 && fromLoc === here) {
      events.push({
        kind: "NARRATION",
        timestamp: now(),
        text: `${evicted.join("、")}被${charaName(slot)}催着离开了房间。`,
        presentation: "ambient",
      });
    }
    setSlotLocation(slot, toLoc);

    // Path #1 of `@被从寝室赶了出来` (`@CHARA_SLEEP` Block B, SLEEP.ERB:159-184):
    // an awake NPC returns to their own 私室 and finds the AWAKE master
    // lingering there → throws them out. Upstream gate is `!睡眠時間(MASTER)`
    // (the master isn't in their own sleep window) AND メッセージ表示 =
    // `!CFLAG:MASTER:睡眠` (master awake). A SLEEPING master is instead the
    // 陪睡/sneak path, not a kick — so this requires the master AWAKE.
    // (Trigger #2 above covers the NPC-falls-asleep-in-place case; time-stop
    // release is the third path, deferred to its own subsystem.)
    if (
      toLoc === slot.homeLocation &&
      toLoc === here &&
      !(state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0)
    ) {
      const kick = kickOutOfBedroom(state, slot, now, deps);
      if (kick.kicked) {
        events.push(...kick.events);
        // Master just got moved out; refresh `here` so the 来訪 / 退室
        // narration below sees the post-kick layout (the master's room is
        // no longer `here`, so the "chara LEFT / arrived at master"
        // narration correctly does not fire for this NPC).
        here = state.master.location;
      }
    }

    let text: string | null = null;
    if (fromLoc === here && toLoc !== here) {
      // EVENT 20 arm 1 belongs to @KITAKU: the character actually ends their
      // activity window and returns home. It is not a generic room-leave hook.
      // Modern detailed maps create many within-map room transitions, and
      // treating each as KITAKU played full authored farewells for one step.
      const actuallyReturningHome = visitWindowEnded && toLoc === slot.homeLocation;
      if (actuallyReturningHome && deps?.dialogueRouter && deps.rng) {
        emitEventKojo(events, deps, state, now, slot.charaNum, 20, [1]);
      }
      text = workStartText ?? `${charaName(slot)}往${roomLabel(toLoc)}去了。`;
    } else if (toLoc === here && fromLoc !== here) {
      // 来訪 (arrival into the player's room). A 拠点来訪 visitor greets on
      // arrival — faithful 遭遇 greet `KOJO_MESSAGE_SEND("EVENT",4,…,3,0)` (the
      // same meet arm skip-move uses). Non-visitor arrivals (e.g. a worker
      // passing through to a job in the player's room) stay narration-only.
      if (slot.state.CFLAG[CFLAG_ID.拠点来訪] && deps?.dialogueRouter && deps.rng) {
        emitEventKojo(events, deps, state, now, slot.charaNum, 4, [3, 0]);
      }
      text = workStartText ?? `${charaName(slot)}来到了这里。`;
    }
    // Both rooms away from the player → silent (远处的移动不播报).
    if (text !== null) {
      events.push({ kind: "NARRATION", timestamp: now(), text, presentation: "ambient" });
    }
  }

  // @BASE自然変動 — per-tick natural drift for every chara over the elapsed
  // interval (情緒 decays / 理性 recovers while away from the master; 仕事量
  // drains while working). Runs after the projection so it sees each chara's
  // final position this tick. The master's own drift (勃起 etc.) is DLC/H-centric.
  const lapse = newMin - oldMin;
  applyNaturalDrift(state.master, here, lapse);
  applyWeatherExposure(state, state.master, lapse);
  for (const slot of Object.values(state.charas)) {
    const currentAction = slot.state.CFLAG[CFLAG_ID.行动] ?? 0;
    slot.state.CFLAG[CFLAG_ID.行动] = actionBeforeProjection.get(slot.charaNum) ?? currentAction;
    // NPC sleep recovery is settled once from each character's configured
    // sleep-window overlap by finishPlayerSleep. Do not stack ordinary idle
    // recovery over the same overnight interval.
    applyNaturalDrift(slot, here, lapse, { ordinaryRest: !state.sleepSession });
    applyWeatherExposure(state, slot, lapse);
    slot.state.CFLAG[CFLAG_ID.行动] = currentAction;
  }

  // `@CHARA_ACTION_DRUNK` runs after movement in the upstream pass. Keep the
  // transient TCVAR gate synchronized with the live 酒气 gauge here so NPCs
  // who cross 80% become immobile on the next interval and recover below 40%.
  for (const transition of syncDrunkenness(state)) {
    const slot = state.charas[transition.charaNum];
    if (!slot || slot.location !== here) continue;
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      text: transition.kind === "became-drunk"
        ? `${charaName(slot)}喝得酩酊大醉的样子。`
        : `烂醉的${charaName(slot)}酒醒了的样子。`,
      presentation: "ambient",
    });
  }

  if (lapse > 0) {
    state.freeActions ??= {};
    for (const slot of Object.values(state.charas)) {
      const current = state.freeActions[slot.charaNum];
      if (current && !canContinueFreeAction(state, slot, current)) {
        interruptFreeAction(state, slot, current);
        delete state.freeActions[slot.charaNum];
        continue;
      }
      if (current) {
        const advanced = advanceFreeAction(state, slot, current, lapse, deps?.rng);
        if (advanced.text) events.push(freeActionEvent(now, advanced.text));
        if (slot.location === here) {
          emitEventKojo(events, deps, state, now, slot.charaNum, 32, [current.type, advanced.event32Phase]);
        }
        if (!advanced.completed) {
          chainFreeActionFollowers(state, slot, current, here, events, now, deps?.rng);
        }
        if (advanced.completed) delete state.freeActions[slot.charaNum];
        continue;
      }
      if (!deps?.rng || !canRunFreeAction(state, slot)) continue;
      const started = maybeStartFreeAction(state, slot, lapse, deps.rng);
      if (!started) continue;
      state.freeActions[slot.charaNum] = started.action;
      if (started.text) events.push(freeActionEvent(now, started.text));
    }
  }

  return events;
}

/** Return the calendar fields for `tick` while replaying an interval backwards
 * from its already-settled final clock. `advanceClock` owns calendar mutation;
 * this is a temporary projection view so weekday/date-gated jobs are evaluated
 * against the day on which they actually occurred. */
function calendarAtProjectionTick(
  finalTime: GameState["time"],
  tick: number,
): { season: number; date: number } {
  let season = finalTime.season ?? 1;
  let date = finalTime.date ?? 1;
  const daysBack = Math.max(0, Math.floor(finalTime.tickValue / 1440) - Math.floor(tick / 1440));
  for (let i = 0; i < daysBack; i++) {
    date -= 1;
    if (date <= 0) {
      date = 31;
      season -= 1;
      if (season <= 0) season = 4;
    }
  }
  return { season, date };
}

function projectionBoundaryTicks(state: GameState, oldTick: number, newTick: number): number[] {
  const boundaries = new Set<number>([newTick]);

  // Non-shrine ambient roaming is an hourly deterministic snapshot. Crossing
  // each hour lets natural drift observe the room the NPC was actually in,
  // instead of attributing a whole long wait to the endpoint room.
  for (let tick = (Math.floor(oldTick / 60) + 1) * 60; tick < newTick; tick += 60) {
    boundaries.add(tick);
  }

  // CSV sleep/wake/visit/return transitions can occur off the hour.
  for (const slot of Object.values(state.charas)) {
    for (const event of configuredEventsBetween(slot, oldTick, newTick)) {
      boundaries.add(event.at);
    }
  }

  // Jobs contain a few :10/:30 transitions. Add every manifest boundary even
  // when today's condition is false: a false boundary is harmless, while
  // omitting a condition-changing start/end makes long waits non-associative.
  const firstDay = Math.floor(oldTick / 1440);
  const lastDay = Math.floor(newTick / 1440);
  for (let dayIndex = firstDay; dayIndex <= lastDay; dayIndex++) {
    const ctx = { state, dayIndex };
    for (const entry of WORK_MANIFEST) {
      const resolved = resolveWorkEntry(entry, ctx);
      if (!resolved) continue;
      for (const minute of [resolved.startMin, resolved.endMin]) {
        const tick = dayIndex * 1440 + minute;
        if (tick > oldTick && tick <= newTick) boundaries.add(tick);
      }
    }
  }

  return [...boundaries].sort((a, b) => a - b);
}

/**
 * Re-project an elapsed world interval in chronological slices.
 *
 * This is deliberately the only public schedule entry point. The old endpoint
 * projection made `wait 5h` differ from five one-hour waits: work could never
 * start and finish, CSV sleep/wake transitions were collapsed, free actions
 * lost their interruptions, and natural drift used the wrong action/location.
 * Slices are limited to actual world boundaries (hourly roam, configured CSV
 * events and imported job starts/ends), not arbitrary polling intervals.
 */
export function reprojectSchedules(
  state: GameState,
  oldMin: number,
  newMin: number,
  now: () => number,
  deps?: ReprojectKojoDeps,
): ObservationEvent[] {
  if (newMin <= oldMin) return [];

  const finalTime = {
    tickValue: state.time.tickValue,
    hourOfDay: state.time.hourOfDay,
    dayIndex: state.time.dayIndex,
    season: state.time.season,
    date: state.time.date,
  };
  const events: ObservationEvent[] = [];
  let cursor = oldMin;

  try {
    for (const boundary of projectionBoundaryTicks(state, oldMin, newMin)) {
      const calendar = calendarAtProjectionTick(finalTime, boundary);
      state.time.tickValue = boundary;
      state.time.hourOfDay = Math.floor((((boundary % 1440) + 1440) % 1440) / 60);
      state.time.dayIndex = Math.floor(boundary / 1440);
      state.time.season = calendar.season;
      state.time.date = calendar.date;
      events.push(
        ...reprojectScheduleInterval(
          state,
          cursor,
          boundary,
          now,
          deps,
          boundary === newMin,
        ),
      );
      cursor = boundary;
    }
  } finally {
    state.time.tickValue = finalTime.tickValue;
    state.time.hourOfDay = finalTime.hourOfDay;
    state.time.dayIndex = finalTime.dayIndex;
    state.time.season = finalTime.season;
    state.time.date = finalTime.date;
  }

  return events;
}

/**
 * Autonomous real-time tick (legacy "live world" path). Advances the clock
 * by a wall-clock delta then re-projects schedules. Retained for the
 * optional `SCHEDULER_ON` ambient-world mode; the faithful turn-based model
 * (Parity QA P-9) does NOT use this — it calls `reprojectSchedules` directly
 * from the command path after a command advances `TIME`.
 */
export function runSchedulerTick(
  prev: GameState,
  realDeltaMs: number,
  now: () => number,
): { state: GameState; events: ObservationEvent[] } {
  // Snapshot the old tick BEFORE the clock mutates `prev` (per tickClock's
  // contract: it mutates in place). Without this, `oldMin` would equal
  // `newMin` and slot-boundary NARRATIONs would never fire.
  const oldMin = prev.time.tickValue;
  // 1. Advance time.
  const { state, events: tickEvents } = tickClock(prev, realDeltaMs, now);
  if (tickEvents.length === 0) {
    return { state, events: [] };
  }
  const newMin = state.time.tickValue;
  // 2. Re-project schedules + band narration for the crossed interval.
  const events: ObservationEvent[] = [
    ...tickEvents,
    ...reprojectSchedules(state, oldMin, newMin, now),
  ];
  return { state, events };
}
