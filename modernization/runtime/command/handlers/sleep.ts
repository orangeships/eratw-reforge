/**
 * Phase 5B — `COMF402 就寝` settlement tail.
 *
 * The full `@OYASUMI` ERB block is 23 lines and calls into a 50-line
 * `SET_SLEEP` helper at `ERB/SET_CMN.ERB:111-161`. This handler ports
 * **only the visible side-effects** of `@OYASUMI`:
 *
 *   - `CFLAG:MASTER:313 (睡眠) = 1`
 *   - `CFLAG:MASTER:354 (就寝時間) = DAY * 1440 + TIME`
 *   - If a TARGET is present (`ctx.target > 0`):
 *     - Clear `CFLAG:MASTER:334 (陪睡中)` and `CFLAG:MASTER:320 (同行)`
 *     - Clear `CFLAG:TARGET:334 (陪睡中)`, `CFLAG:TARGET:320 (同行)`,
 *       `CFLAG:TARGET:316 (衰弱)`
 *
 * 5B ids verified from `CSV/CFLAG.csv`:
 *   - 同行       = 320  (line 83)
 *   - 陪睡中     = 334  (line 97)
 *   - 睡眠       = 313  (line 76)
 *   - 衰弱       = 316  (line 79)
 *   - 就寝時間   = 354  (line 120)
 *
 * **`BEGIN AFTERTRAIN` — Phase 8 decoupled.** The ERB directive suspends
 * the current command and jumps to the AFTERTRAIN block (sleep recovery +
 * time advance to morning). Upstream (`BEFORETRAIN.ERB:117-121, 207-219,
 * 334-357`): sleep fast-forwards `TIME` through midnight to the wake time
 * — crossing midnight fires day-end settlement (`@INFO_GO_NEXTDAY`) — then
 * wake-recovery restores BASE toward MAXBASE. The modernized equivalent:
 * this handler fast-forwards the clock to the configured wake time via
 * `advanceClock` (which fires `runDayEnd` on the midnight cross → settles
 * wages TCVAR:315 → MONEY, resets the 1/day gates 祈願内容 / おみくじ
 * bit1), then runs `recoverFromSleep` for wake recovery. `dayIndex` is
 * owned by the clock authority (`floor(tickValue/1440)`), not bumped here.
 *
 * **Slice B/C1 wired into `finishPlayerSleep`** — between ONANISM and the
 * wake recovery we now also run `runJuelCheckNarrated`
 * (`runtime/world/juel-check-flow.ts`). Faithful to the upstream order
 * (AFTERTRA.ERB:665-680 `@JUEL_CHECK` + :811-851 `@DENIAL_CHECK`, per
 * chara). Each chara grants the per-JUEL `＋N（角色）` narration lines
 * the screen renders verbatim; the `@SHOW_ABLUP_SELECT` automatic
 * level-up + `@EVENTTURNEND` 陷落判定 (slices C2 / C3) follow in their
 * own commits.
 *
 * **Full `SET_SLEEP` is still partial** — the ~50-line helper also handles
 * sleep-drug depth, `FLAG/CFLAG:着替え実行` clothing bits, and conditional
 * `BUFF_RESET`. The visible `睡眠` flag is cleared on wake, and
 * `TCVAR:151 (疲労度)` / `TCVAR:149 (睡眠深度)` are reset by this slice; the
 * remaining clothing/BUFF details stay deferred.
 *
 * **`ctx.target > 0` is the 5A-resolver contract:** the resolver
 * defaults `target` to `actor` (0). The TARGET-branch test invokes
 * this handler directly with a fabricated `CommandContext` carrying
 * `target: 1`. 5F's `apply_intent` switchover is when real TARGET
 * propagation arrives.
 */

// ---------------------------------------------------------------------------
// Sleep-recovery — faithful port of `BEFORETRAIN.ERB:332-364`. Wake recovery
// belongs to the sleep command, not the day-end settlement (eraTW runs it in
// `@EVENTTRAIN` after the time fast-forward).
//
//   睡眠時間 = 你の起床時間 - CFLAG:MASTER:就寝時間 - 追加睡眠時間/2
//   快眠係数 = 480 - (60 * TALENT:回復速度) - 安眠補正
//   BASE:体力 += MAXBASE:体力 * 睡眠時間 / 2 / 快眠係数   (体力 is halved)
//   BASE:気力 += MAXBASE:気力 * 睡眠時間 / 快眠係数
//   BASE:精力 += MAXBASE:精力 * 睡眠時間 / 快眠係数
//   then MIN(MAXBASE, current) cap
//   BASE:勃起 = MIN(1000 * 体力 / MAX体力, 1000); CFLAG:徹夜 = 0
//
// `睡眠時間` here is the elapsed minutes from 就寝時間 to the wake tick.
// 追加睡眠時間 (被窝拖回 / wedding) remains deferred, but the core recovery
// modifiers are now wired: DAY==1(=480), 気絶中断(/5), 徹夜(/2), and
// SleepSoundly's pillow/bed 安眠補正.
// ---------------------------------------------------------------------------

/** The master's configured wake minute-of-day (`TIME:MASTERの起床予定時刻`,
 *  `TIME:3`; upstream NEWGAME default is 420 = 07:00. Existing modern saves
 *  default to 480 (08:00), matching the schedule seed; the 起床前主菜单 can
 *  change it for subsequent sleeps. */
export const DEFAULT_MASTER_WAKE_MINUTE = 480;
/** 快眠係数 base term (`480`) before 回復速度/安眠補正 adjustments. */
const KAIMIN_BASE = 480;
const ITEM_SWEET_SLEEP_PILLOW = 404;
const ITEM_KIRI_BED = 903;
const MINUTES_PER_DAY = 1440;

/** Faithful `快眠係数 = 480 - 60*回復速度 - 安眠補正` (`BEFORETRAIN.ERB:339`).
 *  `recovery` is TALENT:回復速度; `sleepSoundlyBonus` is `@SleepSoundly`. */
function kaiminCoeff(recoverySpeed: number, sleepSoundlyBonus = 0): number {
  return KAIMIN_BASE - 60 * recoverySpeed - sleepSoundlyBonus;
}

function normalizeMinuteOfDay(minute: number | undefined): number {
  if (!Number.isFinite(minute ?? NaN)) return DEFAULT_MASTER_WAKE_MINUTE;
  return (((Math.trunc(minute!) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

/** Compare the string and numeric room representations used by old saves and
 * the modern movement bridge. Cohabitation can update the master's private
 * room while a legacy top-level home string is still one step behind. */
function sameRoom(left: string, right: string): boolean {
  if (left === right) return true;
  const leftId = locationToRoomId(left);
  const rightId = locationToRoomId(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function masterAtHome(state: Readonly<GameState>): boolean {
  const current = state.master.location;
  const initialRoom = roomIdToLocation(state.master.state.CFLAG[CFLAG_ID.初期位置] ?? 0);
  const homes = [state.homeLocation, state.master.homeLocation, initialRoom]
    .filter((location): location is string => typeof location === "string" && location.length > 0);
  if (homes.length === 0) return current === "自宅";
  return homes.some((home) => sameRoom(home, current));
}

export function masterWakeMinute(state: Readonly<GameState>): number {
  return normalizeMinuteOfDay(state.masterWakeMinute);
}

export function setMasterWakeMinute(state: GameState, minute: number): number {
  const next = normalizeMinuteOfDay(minute);
  state.masterWakeMinute = next;
  return next;
}

function absoluteWakeTickAfter(currentTick: number, wakeMinute: number): number {
  const dayStart = Math.floor(currentTick / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  let target = dayStart + normalizeMinuteOfDay(wakeMinute);
  if (target <= currentTick) target += MINUTES_PER_DAY;
  return target;
}

function minutesToConfiguredWake(state: GameState, session: GameState["sleepSession"]): number {
  const currentTick = state.time.tickValue;
  const wakeMinute = normalizeMinuteOfDay(session?.requestedWakeMinute ?? state.masterWakeMinute);
  return Math.max(1, absoluteWakeTickAfter(currentTick, wakeMinute) - currentTick);
}

function minutesUntilStaminaFull(state: GameState): number {
  const master = state.master.state;
  const max = master.MAXBASE[BASE_ID.体力] ?? 0;
  const cur = master.BASE[BASE_ID.体力] ?? 0;
  if (max <= 0 || cur >= max) return 1;
  const recovery = master.TALENT[TALENT_ID.回復速度] ?? 0;
  const kaimin = kaiminCoeff(recovery);
  if (kaimin <= 0) return 1;
  return Math.max(1, Math.ceil(((max - Math.max(0, cur)) * 2 * kaimin) / max));
}

/**
 * Apply the eraTW wake-recovery formula to one chara's 体力/気力/精力
 * (`BEFORETRAIN.ERB:343-353`). Pure over the slot state; mutates `slot.BASE`
 * in place. 体力 gains at half the rate of 気力/精力 (the extra `/2`). Each is
 * capped at its MAXBASE; a stat with no ceiling (unset/≤0) is left untouched
 * — the `recoverPermil` no-op-on-missing-ceiling rule (a 0 cap must never
 * zero a positive current value).
 */
function recoverCharaOvernight(
  slot: GameState["master"]["state"],
  sleepMinutes: number,
  kaimin: number,
): void {
  for (const { id, halve } of [
    { id: BASE_ID.体力, halve: true },
    { id: BASE_ID.気力, halve: false },
    { id: BASE_ID.精力, halve: false },
  ]) {
    const max = slot.MAXBASE[id] ?? 0;
    if (max <= 0) continue; // no ceiling known → don't touch (recoverPermil rule)
    const denom = (halve ? 2 : 1) * kaimin;
    if (denom <= 0) continue;
    const gain = Math.trunc((max * sleepMinutes) / denom);
    const cur = slot.BASE[id] ?? 0;
    slot.BASE[id] = Math.min(max, cur + gain);
  }
}

/**
 * Restore the master's 体力/気力/精力 on wake, then recompute 勃起 and clear
 * 徹夜 (`BEFORETRAIN.ERB:343-362`). 快眠係数 reads `TALENT:回復速度` (130)
 * plus the item-driven `SleepSoundly` 安眠補正. Mutates
 * `state.master.state` in place.
 */
function recoverFromSleep(state: GameState, sleepMinutes: number, sleepSoundlyBonus: number): void {
  const master = state.master.state;
  const recovery = master.TALENT[TALENT_ID.回復速度] ?? 0;
  recoverCharaOvernight(master, sleepMinutes, kaiminCoeff(recovery, sleepSoundlyBonus));
  // 勃起 = MIN(1000 * 体力 / MAX体力, 1000) (`BEFORETRAIN.ERB:356`).
  const hpMax = master.MAXBASE[BASE_ID.体力] ?? 0;
  const hp = master.BASE[BASE_ID.体力] ?? 0;
  if (hpMax > 0) {
    master.BASE[BASE_ID.勃起] = Math.min(1000, Math.trunc((1000 * hp) / hpMax));
  }
  setMasterCflag(state, CFLAG_ID.徹夜, 0);
  clearSleepTransient(master);
}

/**
 * Apply overnight 体力/気力/精力 recovery to every NPC. If a chara has real CSV
 * 起床/就寝 CFLAGs, only the overlap between the player's slept interval and
 * that chara's own sleep window is recovered; narrow fixtures without those
 * flags fall back to the full player sleep duration. NPC sleep flag clearing
 * is handled by `applyConfiguredSchedule` inside `reprojectSchedules`.
 */
function recoverNpcsOvernight(state: GameState, startTick: number, endTick: number): void {
  const fallbackMinutes = Math.max(0, endTick - startTick);
  for (const slot of Object.values(state.charas)) {
    const sleepMinutes = npcSleepOverlapMinutes(slot, startTick, endTick) ?? fallbackMinutes;
    if (sleepMinutes <= 0) continue;
    const recovery = slot.state.TALENT[TALENT_ID.回復速度] ?? 0;
    recoverCharaOvernight(slot.state, sleepMinutes, kaiminCoeff(recovery));
    clearSleepTransient(slot.state);
  }
}

function overlapMinutes(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function npcSleepOverlapMinutes(
  slot: GameState["master"],
  startTick: number,
  endTick: number,
): number | null {
  const sleepRaw = slot.state.CFLAG[CFLAG_ID.就寝時間];
  const wakeRaw = slot.state.CFLAG[CFLAG_ID.起床時間];
  if (!Number.isFinite(sleepRaw ?? NaN) || !Number.isFinite(wakeRaw ?? NaN)) return null;
  const sleep = normalizeMinuteOfDay(sleepRaw);
  const wake = normalizeMinuteOfDay(wakeRaw);
  let total = 0;
  const firstDay = Math.floor(startTick / MINUTES_PER_DAY) - 1;
  const lastDay = Math.floor(endTick / MINUTES_PER_DAY) + 1;
  for (let day = firstDay; day <= lastDay; day++) {
    const base = day * MINUTES_PER_DAY;
    const winStart = base + sleep;
    const winEnd = base + wake + (wake <= sleep ? MINUTES_PER_DAY : 0);
    total += overlapMinutes(startTick, endTick, winStart, winEnd);
  }
  return total;
}

function clearSleepTransient(slot: GameState["master"]["state"]): void {
  slot.TCVAR[TCVAR_ID.疲労度] = 0;
  slot.TCVAR[TCVAR_ID.睡眠深度] = 0;
}

function sleepSoundly(
  state: GameState,
  rng: Rng,
  opts: { interrupted: boolean; allNighter: boolean },
  now: () => number,
): { bonus: number; events: ObservationEvent[] } {
  if (
    opts.interrupted ||
    opts.allNighter ||
    (state.master.state.CFLAG[CFLAG_ID.招待] ?? 0) !== 0
  ) {
    return { bonus: 0, events: [] };
  }

  let bonus = 0;
  const events: ObservationEvent[] = [];

  if (itemCount(state, ITEM_SWEET_SLEEP_PILLOW) > 0) {
    const tutorialCount = Math.max(0, state.flagStore[FLAG_ID.チュート文累計] ?? 0);
    const randMax = Math.max(1, Math.trunc(Math.sqrt(tutorialCount + 1)));
    bonus = Math.min(rng.int(randMax), 40);
    if (bonus > 30) {
      events.push({
        kind: "NARRATION" as const,
        timestamp: now(),
        text: "幸好有安眠枕，真是畅快的早晨啊！",
      });
    } else if (bonus > 20) {
      events.push({
        kind: "NARRATION" as const,
        timestamp: now(),
        text: "多亏了安眠枕，睡得舒舒服服的疲惫都没了……",
      });
    }
  }

  const bedTier = Math.min(3, Math.max(0, itemCount(state, ITEM_KIRI_BED)));
  if (bedTier === 1) {
    bonus += 10 + rng.int(11) + rng.int(21);
  } else if (bedTier === 2) {
    bonus += 15 + rng.int(16) + rng.int(31);
  } else if (bedTier >= 3) {
    bonus += 20 + rng.int(21) + rng.int(41);
  }

  return { bonus, events };
}

function recoverySleepMinutes(
  state: GameState,
  elapsedMinutes: number,
  session: NonNullable<GameState["sleepSession"]>,
  now: () => number,
): { minutes: number; interrupted: boolean; allNighter: boolean; events: ObservationEvent[] } {
  const events: ObservationEvent[] = [];
  const interrupted = (state.flagStore[FLAG_ID.気絶中断] ?? 0) !== 0;
  const allNighter = (state.master.state.CFLAG[CFLAG_ID.徹夜] ?? 0) !== 0;
  // BEFORETRAIN.ERB:333-336 — the first-day edge uses exactly 480 minutes.
  // Forced collapse is the modern exception: the user specifically asked that
  // collapse sleeps until stamina is full, so use the real elapsed duration.
  let minutes = !session.forced && Math.floor(session.startedAtTick / MINUTES_PER_DAY) === 0
    ? 480
    : elapsedMinutes;

  if (interrupted) {
    state.flagStore[FLAG_ID.気絶中断] = 0;
    minutes = Math.trunc(minutes / 5);
    events.push({
      kind: "NARRATION" as const,
      timestamp: now(),
      text: "因为在奇怪的地方睡着了，醒来后腰酸背痛……",
    });
  } else if (allNighter) {
    minutes = Math.trunc(minutes / 2);
    events.push({
      kind: "NARRATION" as const,
      timestamp: now(),
      text: "昨晚没有好好睡觉……",
    });
  } else {
    events.push({
      kind: "NARRATION" as const,
      timestamp: now(),
      text: `睡了 ${Math.floor(minutes / 60)} 个小时。`,
    });
  }

  return { minutes: Math.max(1, minutes), interrupted, allNighter, events };
}

export function finishPlayerSleep(
  state: GameState,
  now: () => number,
  router?: DialogueRouter,
  rng?: Rng,
  dailyEvent?: { sleepSeed: number; answer?: PromptAnswer },
): SleepSettlementEvents {
  const session = state.sleepSession;
  if (!session) return createSleepSettlementEvents();
  // A DAILYEVENT prompt is a continuation boundary, not a partially-complete
  // settlement. Preserve the caller's state so direct runtime consumers have
  // the same transactional contract as the Zustand adapter.
  const rollbackSnapshot = dailyEvent ? cloneGameState(state) : null;
  // Night-settlement daily report — compute BEFORE any mutation (overnight
  // recovery / day-end resets) so the diff reflects the day's training. Faithful
  // to eraTW's per-command 好感度/能力/経験 display, aggregated. See daily-report.ts.
  state.daySettlementReport = buildDailySettlementReport(
    state.daySnapshot ?? {},
    state.charas,
  );
  // Faithful `BEFORETRAIN.ERB:204-223`: fast-forward TIME to the master's
  // configured wake minute. For fatigue collapse, the modern UX additionally
  // floors the duration at "long enough to refill 体力".
  const toWake = minutesToConfiguredWake(state, session);
  const sleepMinutes = session.forced ? Math.max(toWake, minutesUntilStaminaFull(state)) : toWake;
  // YASAI weather sample (FARM-BREW A2): upstream `@EVENTEND` (and its
  // `CALL YASAI`, AFTERTRA.ERB:366) runs BEFORE the BEFORETRAIN morning
  // clock advance, so TIME:5 is the weather AT BEDTIME. advanceClock below
  // re-simulates weather across hour bands — capture the index first.
  const weatherAtBedtime = getWeatherState(state);
  const yasaiWeatherIdx =
    weatherAtBedtime.gensokyoWeatherSystem[masterRegionId(state)] ??
    weatherAtBedtime.gensokyoWeatherSystem[0] ??
    0;
  const oldTick = state.time.tickValue;
  // Preserve who was actually in the sleeping room. Schedule projection can
  // move unrelated characters into a newly selected home before おはよう;
  // those overnight arrivals must not retroactively become wake witnesses.
  const morningGreetingCandidates = Object.values(state.charas)
    .filter((slot) => sameRoom(slot.location, state.master.location))
    .map((slot) => slot.charaNum);
  // P1-#5 Slice E: snapshot the day index before `advanceClock` so the
  // post-midnight InitializeBeforeTrain can be gated on the day-tick.
  const oldDayIndex = state.time.dayIndex;
  // 浓厚精液机制:当日(睡前)是否射精。`advanceClock` 跨午夜会清掉 day 生命
  // 周期的 TFLAG(含一日一回 bit 8),所以必须在 clock advance 之前捕获——
  // 否则禁欲块永远读不到「今天射过」,射精次日消失会失效。夜里的梦遗/自慰
  // 在 advanceClock 之后仍会置位,禁欲块里再 OR 一次。
  const ejaculatedBeforeClock = (getTflag(state, TFLAG_ID.一日一回) & (1 << 8)) !== 0;
  // Conception owns the pre-cleanup donor/EX snapshot. The modern morning
  // initializer clears day-scoped EX, so this must precede advanceClock and
  // runInitializeBeforeTrain even though its narration is displayed later.
  const settlementDay = Math.max(
    state.time.dayIndex,
    Math.floor((state.time.tickValue + sleepMinutes) / MINUTES_PER_DAY),
  );
  const pregnancyEvents: ObservationEvent[] = rng && settlementDay > oldDayIndex
    ? runPregnancySettlement(state, { now, rng, settlementDay })
    : [];
  const { events: clockEvents } = advanceClock(state, sleepMinutes, now, { runDayEnd: true });
  // The player is unconscious during this fast-forward.  Keep the RNG wired
  // so work runtimes, free actions, encounter moves and natural drift settle
  // normally, but short-circuit player-visible EVENT kojo at the upstream
  // `CAN_SEE` boundary. Morning owns the first visible greeting after wake.
  reprojectSchedules(
    state,
    oldTick,
    state.time.tickValue,
    now,
    {
      ...(router ? { dialogueRouter: router } : {}),
      ...(rng ? { rng } : {}),
      observationMode: "unobserved",
    },
  );

  // DAYEVENT (Slice 1) — night subevent fires AFTER day-end (which ran
  // inside advanceClock via the runDayEnd hook) and BEFORE wake recovery.
  // The selection + execution are no-ops without a router/rng (tests can
  // call this with undefined to skip DAYEVENT). All 13 scenario constants
  // have mainline execution; remaining gaps are subsystem sub-branches in
  // runtime/world/dayevent.ts.
  const nightEvents: ObservationEvent[] = [];
  const modularDailyEvents: ObservationEvent[] = [];
  let dailyEventDiagnostics: DailyEventDiagnostic[] = [];

  // P1-#5 Slice E — `@InitializeBeforeTrain` per-chara day-start reset
  // (BEFORETRAIN.ERB:829-1015). Sits AFTER `advanceClock` (which fired the
  // day-end hook on midnight cross) and BEFORE DAYEVENT-night (upstream
  // order: `:829` InitializeBeforeTrain → `:540` AFTERTRA.ERB tail →
  // `:540` DAYEVENT). Always runs; the function is a no-op when `oldTick`
  // and the new `dayIndex` are the same (within-day sleep).
  //
  // NOTE (P1-#5B/C/D regression fix): `runCharaSleepDispatch` was originally
  // wired here, but it unconditionally called `SET_SLEEP(1, charaNum)` for
  // every character — overriding the scheduler's CSV wake events that already
  // cleared `CFLAG:睡眠` during the overnight `reprojectSchedules` pass.
  // The CHARA_SLEEP / SLEEP_RESIDENT / SLEEP_VISITOR classifiers (commits
  // d731ddc/a24e0bd/c7d40b7) remain available as pure functions; they
  // should be wired into the per-character scheduler hook (configured-schedule
  // or scheduler's sleep-transition arm) rather than as a bulk post-facto
  // pass that re-sleeps everyone after the scheduler woke them.
  if (oldDayIndex !== state.time.dayIndex) {
    runInitializeBeforeTrain(state);
  }
  if (router && rng) {
    const sel = selectDayEvent(state, "night", rng, router);
    if (sel) {
      nightEvents.push(...executeDayEvent(state, sel, router, rng, now));
    }
  }

  // Upstream AFTERTRA calls DAILYEVENT only when MASTER is at the initial
  // residence, after DAYEVENT and before YASAI/@酒造. A pending gameplay
  // choice returns immediately; the web store discards this partially-mutated
  // settlement clone and persists only the continuation session.
  const home = state.homeLocation ?? state.master.homeLocation;
  const atInitialResidence = typeof home === "string" && state.master.location === home;
  if (rng && dailyEvent && (atInitialResidence || state.dailyEventSession)) {
    const resolved = runDailyEventTick(state, rng, {
      sleepSeed: dailyEvent.sleepSeed,
      now,
      answer: dailyEvent.answer,
      router,
    });
    dailyEventDiagnostics = resolved.diagnostics;
    if (resolved.pending) {
      if (rollbackSnapshot) {
        const mutableState = state as unknown as Record<string, unknown>;
        for (const key of Object.keys(mutableState)) delete mutableState[key];
        Object.assign(mutableState, rollbackSnapshot);
      }
      const paused = createSleepSettlementEvents();
      paused.pendingDailyEvent = resolved.pending;
      if (dailyEventDiagnostics.length > 0) paused.dailyEventDiagnostics = dailyEventDiagnostics;
      return paused;
    }
    modularDailyEvents.push(...resolved.events);
  }

  // YASAI (FARM-BREW A2) — upstream `@EVENTEND` runs `CALL YASAI`
  // (AFTERTRA.ERB:366) after the DAILYEVENT roll and before the rest of the
  // settlement tail: nightly kitchen-garden growth. `TIME:5` is the real
  // regional weather (gensokyoWeatherSystem[masterRegionId] — the simulated
  // value, NOT the display approximation); the 地底 constant-growth arm
  // (MAIN_MAP==9) is keyed off the home map (unbuilt today → false). The
  // RAND-driven growth needs an rng; tests that pass none skip it — the
  // same policy as DAYEVENT above.
  const yasaiEvents: ObservationEvent[] = [];
  // 酒造 (FARM-BREW B2) — upstream `@EVENTEND` runs `CALL 酒造`
  // (AFTERTRA.ERB:371) right after `CALL YASAI` (:366): nightly brew
  // fermentation (+ the DAILY_EV30 醸造快調 1/15 roll). Gated on rng like
  // YASAI (gameplay always has one); tests without rng skip both.
  const brewEvents: ObservationEvent[] = [];
  if (rng) {
    const underground =
      mapIdOfLocation(state.homeLocation ?? state.master.location) === 9;
    for (const text of runYasaiTick(state, yasaiWeatherIdx, rng, underground)) {
      yasaiEvents.push({ kind: "NARRATION" as const, timestamp: now(), text });
    }
    for (const text of runBrewTick(state, rng)) {
      brewEvents.push({ kind: "NARRATION" as const, timestamp: now(), text });
    }
  }

  // ONANISM (slice B) — upstream `@EVENTEND` runs `CALL ONANISM`
  // (AFTERTRA.ERB:538-539, gated only by the 魔改 NO_ONANISM switch, default
  // off) after the DAYEVENT/per-chara loop and before the ABLUP tail. The
  // RAND-driven branches need an rng; tests that pass none skip it — the
  // same policy as DAYEVENT above.
  const onanismEvents: ObservationEvent[] = rng
    ? runOnanism(state, { now, rng, router })
    : [];

  // 精液残留夜结算 (AFTERTRA.ERB:44-260 per-chara) — 残留精液 JUEL 伤害 + 精液中毒
  // 升级 + 精愛味覚 + 膣射/肛射中毒 + 射精 flag 清理。必须跑在下方禁欲块（清 MASTER
  // 濃厚精液）之前：SEMEN_POISON_PLUS 双倍检测要读到捐赠者当夜尚未被清的 trait。
  // 不依赖 rng（上游该块无 RAND 分支）。
  const semenResidueEvents: ObservationEvent[] = runSemenResidueSettlement(state, { now });

  // 禁欲 + 浓厚精液 (AFTERTRA.ERB — MASTER 有阴茎)。浓厚精液的核心机制:
  // 「禁欲3日获得、射精次日消失」。上游(精力 == MAX && !GETBIT(一日一回,8)):
  //   - 精力满 && 今天没射精 → 禁自慰++;第3天 `TALENT:濃厚精液 = 1`。
  //   - 否则(射精/自慰过或精力不满)→ 禁自慰=0 + 浓厚精液=0。
  // 读的是当日(睡前)精力,与上游 AFTERTRA 顺序一致(ONANISM 之后、JUEL 之前;
  // 清晨的精力恢复发生在 BEFORETRAIN,不在此处)。「今日射精」由各射精结算点
  // 置 `TFLAG:一日一回 bit 8`(见 hip-thrust / onanism / DAILY_EV0 / DAILY_EV2)。
  const kinjiEvents: ObservationEvent[] = [];
  const hasPenis = ((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
  if (hasPenis) {
    const energyMax = state.master.state.MAXBASE[BASE_ID.精力] ?? 0;
    const energyCur = state.master.state.BASE[BASE_ID.精力] ?? 0;
    const ejaculatedToday =
      ejaculatedBeforeClock || (getTflag(state, TFLAG_ID.一日一回) & (1 << 8)) !== 0;
    if (energyMax > 0 && energyCur >= energyMax && !ejaculatedToday) {
      const kinji = (state.flagStore[FLAG_ID.オナ禁] ?? 0) + 1;
      state.flagStore[FLAG_ID.オナ禁] = kinji;
      if (kinji >= 5 && (rng ? rng.int(3) === 0 : false)) {
        // 烦躁分支(禁欲≥5、1/3 概率):気力 MAX 暂时下降,精力 MAX +10。
        // BUFF_BASE 的「暂时」恢复在上游另有结算,此处按 BUFF 直接影响
        // MAX+BASE(与 prayer.ts 的 BUFF 处理一致)。
        const kijiryoMax = state.master.state.MAXBASE[BASE_ID.気力] ?? 0;
        const delta = Math.min(Math.trunc(kijiryoMax * 20 / 100), 500);
        state.master.state.MAXBASE[BASE_ID.気力] = Math.max(0, kijiryoMax - delta);
        state.master.state.BASE[BASE_ID.気力] = Math.max(0, (state.master.state.BASE[BASE_ID.気力] ?? 0) - delta);
        state.master.state.MAXBASE[BASE_ID.精力] = (state.master.state.MAXBASE[BASE_ID.精力] ?? 0) + 10;
        kinjiEvents.push({ kind: "NARRATION" as const, timestamp: now(), text: "因为最近没有做过、所以感到烦躁……" });
      } else if (kinji >= 3) {
        // 禁欲第3天:获得【浓厚精液】。
        state.master.state.TALENT[TALENT_ID.濃厚精液] = 1;
        state.master.state.MAXBASE[BASE_ID.精力] = (state.master.state.MAXBASE[BASE_ID.精力] ?? 0) + 5;
        kinjiEvents.push({ kind: "NARRATION" as const, timestamp: now(), text: "话说这边的小兄弟也蓄势已久了呢…" });
        kinjiEvents.push({ kind: "NARRATION" as const, timestamp: now(), text: `${state.master.callName ?? "主人公"}获得了【浓厚精液】。` });
      }
    } else {
      // 射精/自慰过(或精力不满):禁欲归零,浓厚精液消失。
      const hadThick = (state.master.state.TALENT[TALENT_ID.濃厚精液] ?? 0) !== 0;
      state.flagStore[FLAG_ID.オナ禁] = 0;
      state.master.state.TALENT[TALENT_ID.濃厚精液] = 0;
      if (hadThick) {
        kinjiEvents.push({ kind: "NARRATION" as const, timestamp: now(), text: "因为射精了,【浓厚精液】消失了。" });
      }
    }
  }

  // JUEL_CHECK + DENIAL_CHECK (slice C1) — upstream `AFTERTRA.ERB:665-670`
  // runs them per-chara at the very tail of `@EVENTEND` (after `@ONANISM`,
  // before `BEGIN ABLUP`). The PALAM → JUEL convert MUST run (ABLUP consumes
  // the freshly-banked jewels below), but its "宝珠 ＋N" per-grant lines are
  // deliberately NOT shown on the night screen (实玩反馈 2026-07-04: the raw
  // 珠玉/EXP deltas read like a daytime ledger; only the *resulting* ABLUP
  // level-up lines are kept). We discard the returned narration, keep the
  // mutation.
  runJuelCheckNarrated(state, { now, rng });

  // 夜间小剧场「呢喃」(EVENT 31) — upstream `@EVENTEND` per-chara loop
  // (AFTERTRA.ERB:267-273). The day-end monologue for every 面識 character,
  // tagged with charaNum so the night screen folds it into that character's
  // block as the leading `▼〜的呢喃` section. No-op without router/rng.
  const tsubuyakiEvents: ObservationEvent[] = runTsubuyaki(state, { now, router, rng, settlementDayIndex: oldDayIndex });

  // CHARA_DIARY_AFTERTRAIN (AFTERTRA.ERB:650) — nightly diary render. The
  // modern runtime models the upstream per-chara loop: BEFORE_CHECK iterates
  // pages 1..MAX, TRYCALLs `_HAPPEN` bodies via the router, and writes
  // DIARY:CHARA:DCOUNT = 2 (auto-fire). AFTERTRAIN then finds the FIRST page
  // flagged 2, calls the TEXT kojo in デイリー mode, marks it 1 (read),
  // and resets other queued pages to 0. Renders into the night stream so
  // the night screen groups the diary entry into the same per-character
  // 小剧场 block as 呢喃/ONANISM/升级. No-op without router/rng.
  const activeCharaNums = Object.keys(state.charas).map(Number);
  let diaryEvents: ObservationEvent[] = [];
  if (router && rng) {
    // Keep the complete immutable diary result. The previous call site only
    // consumed `.events`, so DIARY/PAGESET writes were lost during sleep.
    const beforeState = runCharaDiaryBeforeCheck(state, router, rng, activeCharaNums);
    Object.assign(state, beforeState);
    const diaryResult = runCharaDiaryAfterTrain(state, router, rng, activeCharaNums, now);
    Object.assign(state, diaryResult.state);
    diaryEvents = diaryResult.events;
  }

  // GIFT_FAVORITE (AFTERTRA.ERB:647) — nightly gift disposition. Clears
  // `CFLAG:每日礼物` (the 626 土产屋 latch) so a chara can receive gifts
  // again next day, and emits 珍藏/保管/典当 prose per gifted chara. Upstream
  // order is :647 GIFT_FAVORITE → :650 CHARA_DIARY_AFTERTRAIN; the night
  // screen groups by charaNum so rendering after diary (same block) is
  // visually identical. Tagged charaNum so it folds into that chara's 小剧场.
  const giftFavoriteEvents: ObservationEvent[] = runGiftFavorite(state).map((e) => ({
    kind: "NARRATION" as const,
    timestamp: now(),
    charaNum: e.charaNum,
    text: e.text,
  }));

  // ABL auto-level-up (slice C2-P2) — upstream `BEGIN ABLUP` runs
  // `@SHOW_ABLUP_SELECT` (ABL.ERB:3-136), a 21-ABL loop that consumes
  // JUEL/EXP and emits "霊夢 … 親密 LVUP (E 3 → D 4)" lines. We emit
  // one NARRATION per level; the night screen renders verbatim.
  // Upstream AFTERTRA runs SOURCE_ABLUP before SHOW_ABLUP_SELECT. The former
  // derives life-skill levels directly from EXP; the latter spends jewels on
  // relationship/sense ABL. They are distinct and both recur every night.
  const sourceAblupEvents: ObservationEvent[] = runSourceAblup(state, { now });
  const ablupEvents: ObservationEvent[] = runAblupAutoSelect(state, { now, includeMaster: true });

  // Talent / fall-state acquisition (slice C3) — upstream `@EVENTTURNEND`
  // (lines 19-199) fires the per-chara loop after `BEGIN ABLUP`: 4
  // one-shot talents (接吻魔/自慰狂/子宮口性感/漏尿癖), 2 skill-acq
  // talents (音楽知識/音感), the 5-stage fall-state FSM (思慕→恋慕→愛
  // 恋→愛欲→炮友), 心情不快 rebound, and the 仲間追加 フラグ.
  // Each emits EVENT-21 / EVENT-34 kojo via `resolveEventKojo` plus the
  // upstream prose lines.
  const fallEvents: ObservationEvent[] = runFallStates({
    now,
    rng: rng ?? createRng(0),
    router,
    state,
  });

  const recovery = recoverySleepMinutes(state, sleepMinutes, session, now);
  const soundly = sleepSoundly(state, rng ?? stubRng(), recovery, now);
  recoverFromSleep(state, recovery.minutes, soundly.bonus);
  recoverNpcsOvernight(state, oldTick, state.time.tickValue);
  setMasterCflag(state, CFLAG_ID.睡眠, 0);
  setTflag(state, TFLAG_ID.あなた起床, state.time.tickValue);
  state.sleepSession = null;

  // DAY-CYCLE-PLAN §S1 — the post-wake morning subsystems (DAYEVENT-day /
  // 来訪フラグ / 遭遇判定 / 依頼刷新 / おはよう) are now an ordered table in
  // day-cycle.ts. `runMorning` runs them in `MORNING_PHASES` order, each with
  // its own `needs` gate (router/rng), and returns the concatenated events in
  // exactly the pre-S1 order. Zero behavior change.
  const morningEvents = runMorning(state, { now, router, rng, morningGreetingCandidates });

  // Night-settlement DISPLAY stream (实玩反馈 2026-07-04 重构). Flat order is
  // still the upstream `@EVENTEND` settlement order — DAYEVENT → 呢喃 →
  // ONANISM → ABLUP → EVENTTURNEND fall-states → RANK_POINT day-end money —
  // but the night screen re-groups it into per-character 小剧场 blocks by
  // `charaNum` (0/undefined = the global "今夜" block: DAYEVENT scene, farm/
  // brew, day-end money), revealing one block per click. Within a character
  // the block reads 呢喃 → 自慰 → 升级. The 珠玉+N per-grant ledger is the ONE
  // thing dropped from the display (the PALAM→JUEL convert still ran above; we
  // just don't print the deltas — only the resulting ABLUP level-ups show).
  const nightReportEvents: ObservationEvent[] = [
    ...nightEvents,
    ...modularDailyEvents,
    ...yasaiEvents,
    ...brewEvents,
    ...tsubuyakiEvents,
    ...diaryEvents,
    ...giftFavoriteEvents,
    ...pregnancyEvents,
    ...semenResidueEvents,
    ...onanismEvents,
    ...kinjiEvents,
    ...sourceAblupEvents,
    ...ablupEvents,
    ...fallEvents,
    // Sleep still advances banquet state, but its offscreen program beats
    // belong to the world clock, not the player's night settlement report.
    ...clockEvents.filter((event) => event.kind !== "NARRATION" || event.origin !== "banquet"),
  ];

  // Compatibility callers historically received this marker in the flat
  // result.  The NightSettlementScreen already owns the same heading, so keep
  // it out of `nightReportOnly` to avoid showing it twice.
  const dayEndSummary: ObservationEvent = {
    kind: "NARRATION",
    timestamp: now(),
    text: "一天结束了。",
  };

  const nightSettlementEvents: ObservationEvent[] = [
    dayEndSummary,
    ...nightReportEvents,
    ...recovery.events,
    ...soundly.events,
    ...morningEvents,
  ];

  const allEvents = [
    ...nightSettlementEvents,
  ];
  // Night-screen DISPLAY set: keep the 小剧场 (narrative + 呢喃 + fall-state
  // prose + day-end money) and the ABLUP level-up lines, but drop ONANISM's
  // per-grant numeric ledger (`自慰经验＋N` / `〜之珠 ＋N`) — 实玩反馈
  // 2026-07-04: only 升级行 should show for numeric changes. The full ledger
  // stays in the dedicated night report; it is not copied into the next
  // morning's persistent event log. Direct runtime callers still receive the
  // compatibility `allEvents` array, while the structured categories below
  // decide which UI/history surface owns each event.
  const nightDisplayEvents = nightReportEvents.filter(
    (e) => !(e.kind === "NARRATION" && isNumericLedgerLine(e.text)),
  );
  const morningDialogue = morningEvents.filter((event) => event.kind === "DIALOGUE_LINE");
  const persistentHistory = [
    ...recovery.events,
    ...soundly.events,
    ...morningEvents.filter((event) => event.kind !== "DIALOGUE_LINE"),
  ];
  // Night-report stream: the night screen renders the upstream-like settlement
  // stream, ending at RANK_POINT money before the UI enters SHOP. Wake recovery
  // / morning pipeline events are returned in separate structured categories;
  // the store appends only `persistentHistory` and queues `morningDialogue`.
  state.nightReport = nightDisplayEvents;
  const result = createSleepSettlementEvents(allEvents, {
    nightReportOnly: nightDisplayEvents,
    morningDialogue,
    persistentHistory,
  });
  if (dailyEventDiagnostics.length > 0) result.dailyEventDiagnostics = dailyEventDiagnostics;
  // EVENT 31 and nightly frustration have consumed the previous day's
  // encounter marker. The wake state starts a fresh day.
  if (oldDayIndex !== state.time.dayIndex) {
    for (const slot of Object.values(state.charas)) slot.state.TCVAR[TCVAR_ID.今天有否见面] = 0;
  }
  return result;
}

/**
/**
 * EVENTCOMEND fatigue-forced sleep (`EVENTCOMEND.ERB:44-81`). The post-command
 * hook: when the master's 体力 (stamina) drops to 500 or below, the day is
 * forcibly ended via `$OYASUMI`; when it is 0 or below, the extra fainting
 * narration ("体力不支晕过去了…") is shown first. This is stamina-driven, not
 * sleepiness-driven (NEMUKE gates the *voluntary* 就寝). 時間停止 suspends it
 * (no time passes while the world is frozen).
 *
 * The collapse routes into the normal wake-recovery path, with the modern UX
 * addition requested by the user: forced sleep cannot wake until 体力 is full.
 * This hook only sets the session + emits the fainting narration; the duration
 * floor is applied by `finishPlayerSleep`.
 *
 * Mutates `state` in place. Returns the fatigue/faint NARRATION when it fires,
 * or `[]` when the master is still standing.
 */
export function forceSleepFromExhaustion(state: GameState, now: () => number): ObservationEvent[] {
  // Only a master with a real stamina pool can collapse. An unset MAXBASE:体力
  // (≤0) means no ceiling is known — a bare test fixture, not an exhausted
  // player; treat 体力 0 there as uninitialized, not fainted (the recoverPermil
  // "no ceiling → don't touch" rule). The live game always seeds 体力 2000/2000.
  if ((state.master.state.MAXBASE?.[BASE_ID.体力] ?? 0) <= 0) return [];
  const stamina = state.master.state.BASE?.[BASE_ID.体力] ?? 0;
  if (stamina > 500) return [];
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return [];
  // 就寝時間 = 1440*DAY+TIME = tickValue (absolute minute). Old
  // `dayIndex*1440 + tickValue` double-counted the day (see comf302 / oracle 9912).
  setMasterCflag(state, CFLAG_ID.就寝時間, state.time.tickValue);
  setMasterCflag(state, CFLAG_ID.睡眠, 1);
  prepareMobGirlDayEnd(state);
  state.sleepSession = {
    startedAtTick: state.time.tickValue,
    requestedWakeMinute: masterWakeMinute(state),
    forced: true,
    presentationEventLogIndex: state.eventLog.length,
  };
  const fatigueText =
    stamina <= 0
      ? "%CALLNAME:MASTER% 体力不支，晕了过去……一天就这样过去了。"
      : "（体力濒临极限）%CALLNAME:MASTER% 已经撑不住了……一天就这样过去了。";
  return [
    {
      kind: "NARRATION" as const,
      timestamp: now(),
      text: fatigueText,
    },
  ];
}

import type { HandlerEntry } from "../types.js";
import type { PromptAnswer } from "../prompt.js";
import type { DialogueRouter } from "../../kojo/types.js";
import type { Rng } from "../rng.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import { buildDailySettlementReport } from "../../state/daily-report.js";
import { BASE_ID, CFLAG_ID, FLAG_ID, TALENT_ID, TCVAR_ID, setMasterCflag } from "../../state/settlement.js";
import { nemuke } from "../../state/nemuke.js";
import { itemCount } from "../../state/items.js";
import { advanceClock } from "../../world/clock.js";
import { reprojectSchedules } from "../../world/scheduler.js";
import { selectDayEvent, executeDayEvent } from "../../world/dayevent.js";
import { runOnanism } from "../../world/onanism.js";
import { runSemenResidueSettlement } from "../../world/semen-residue.js";
import { runPregnancySettlement } from "../../world/pregnancy.js";
import { runJuelCheckNarrated } from "../../world/juel-check-flow.js";
import { runAblupAutoSelect } from "../../world/ablup.js";
import { runSourceAblup } from "../../world/new-game-initialization.js";
import { runFallStates } from "../../world/fall-states.js";
import { runTsubuyaki } from "../../world/tsubuyaki.js";
import {
  runDailyEventTick,
  type DailyEventDiagnostic,
  type DailyEventPending,
} from "../../world/daily-event.js";
import { runCharaDiaryAfterTrain, runCharaDiaryBeforeCheck } from "../../world/chara-diary.js";
import { runGiftFavorite } from "../../state/gifts.js";
import { runYasaiTick } from "../../state/farm.js";
import { runBrewTick } from "../../state/brewing.js";
import { getWeatherState } from "../../state/weather-state.js";
import { masterRegionId } from "../../weather/region-system.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { locationToRoomId, roomIdToLocation } from "../../world/room-id-location.js";
import { createRng } from "../../command/rng.js";
// DAY-CYCLE-PLAN §S1: the post-wake morning subsystems (DAYEVENT-day /
// 来訪フラグ / 遭遇判定 / 依頼刷新 / おはよう) now live in day-cycle.ts as an
// ordered table; `stubRng` moved there too (re-imported here for SleepSoundly).
import { runMorning, stubRng } from "../../world/day-cycle.js";
// P1-#5 Slice E: per-chara day-start reset (BEFORETRAIN.ERB:829-1015).
import { runInitializeBeforeTrain } from "../../world/initialize-before-train.js";
// P1-#5 Slice A: full SET_SLEEP (SET_CMN.ERB:111-161).
import { setSleep } from "../../world/set-sleep.js";
import { prepareMobGirlDayEnd } from "../../world/dynamic-characters.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { resolveEventKojoAndApply } from "../../kojo/effects.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";

export type SleepSettlementEvents = ObservationEvent[] & {
  /** Events owned by the dedicated night-report surface only. */
  nightReportOnly?: ObservationEvent[];
  /** Morning dialogue that belongs in the owner-aware dialogue queue. */
  morningDialogue?: ObservationEvent[];
  /** Non-report history events safe to append to the persistent event log. */
  persistentHistory?: ObservationEvent[];
  pendingDailyEvent?: DailyEventPending;
  dailyEventDiagnostics?: DailyEventDiagnostic[];
};

function createSleepSettlementEvents(
  events: ObservationEvent[] = [],
  categories: Partial<Pick<SleepSettlementEvents, "nightReportOnly" | "morningDialogue" | "persistentHistory">> = {},
): SleepSettlementEvents {
  const result = events as SleepSettlementEvents;
  result.nightReportOnly = categories.nightReportOnly ?? [];
  result.morningDialogue = categories.morningDialogue ?? [];
  result.persistentHistory = categories.persistentHistory ?? [];
  return result;
}

/**
 * Is this a per-grant numeric ledger line that the night SCREEN should hide
 * (实玩反馈 2026-07-04: only 升级行 show for numeric changes)? Matches the two
 * ONANISM settlement lines `自慰经验＋N（…）` and `〜之珠 ＋N（…）` by their
 * fixed literal tokens + the fullwidth `＋`. Narrative prose, 呢喃, ABLUP
 * `… LVUP …` and day-end 円 money lines never contain this combination, so
 * they pass through. Applied to the night display only; the eventLog keeps the
 * full ledger.
 */
function isNumericLedgerLine(text: string): boolean {
  return text.includes("＋") && (text.includes("之珠") || text.includes("经验") || text.includes("経験"));
}

// ── Phase 8 朝夜挨拶 ────────────────────────────────────────────────
// Upstream fires the personal EVENT-arm kojo on the sleep↔wake cycle:
//   - arm 3 (おやすみ) — `SLEEP.ERB:122` `KOJO_MESSAGE_SEND("EVENT",3,CHARA,…)`
//     when the companion is put to bed.
//   - arm 2 (おはよう) — `BEFORETRAIN.ERB:653`
//     `KOJO_MESSAGE_SEND("EVENT",2,TARGET,起床状况,起床場所)` on wake.
// Both fire for the TARGET that sleeps alongside master (the `陪睡中`
// companion). The modern sleep handler collapses sleep+wake into one
// command (fast-forward to the configured wake time), so we emit arm 3 at bed-down
// and arm 2 at wake. NPC-schedule-driven greetings (each villager's own
// SLEEP.ERB cycle) stay deferred — this slice covers the master+TARGET
// companion path, which is the BEFORETRAIN wake-greeting faithful point.
//
// `resolveEventKojo` returns [] when the active variant has no
// personal kojo for that arm (or the body's ARG sub-id predicates can't
// resolve) — silent, same fallback policy as `collect`.
const GREETING_ARM_OYASUMI = 3; // おやすみ (night, at bed-down)
// Morning (おはよう) greeting is emitted by the explicit wake flow; the old
// immediate-sleep path used arm 2 here, but sleep is now a pending session.

// Faithful `ARG` sub-ids (the ARG:3/ARG:4 upstream passes to
// KOJO_MESSAGE_SEND for the master+companion sleep path):
//   - arm 3 (SLEEP.ERB:122): ARG = おやすみ口上. 2 = 同床 (co-located
//     sleep, the 陪睡中 companion case). (1 = 帰宅, which upstream routes
//     to arm 20 instead, so 2 is the faithful value here.)
//   - arm 2 (BEFORETRAIN.ERB:653): ARG = 起床状况, ARG:1 = 起床場所.
//     1 = 非同居 相手先起き (the visitor-companion wake; the trial roster
//     has no 同居/初期位置 tracking — deferred). 起床場所 0.
// Bodies whose matching branch is a `LOCAL:1 = 0` 記入チェック gate or
// needs an unseeded TALENT (恋慕/恋人) resolve to [] — faithful silence.
const OYASUMI_ARGS = [2];

/** Collect a greeting arm for the sleeping companion → DIALOGUE_LINE[]. */
function greetingLines(
  ctx: { target: number; state: Readonly<GameState>; rng: import("../types.js").Rng; now: () => number; dialogueRouter?: import("../../kojo/types.js").DialogueRouter },
  state: Readonly<GameState>,
  arm: number,
  args: number[],
): ObservationEvent[] {
  if (ctx.target <= 0 || !ctx.dialogueRouter) return [];
  const kojo = resolveEventKojoAndApply(ctx.dialogueRouter, state, ctx.target, arm, ctx.rng, args);
  return kojo.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum: ctx.target,
    text: line.text,
    form: line.form,
  }));
}

export const sleepHandlerEntry: HandlerEntry = {
  commandNo: 402,
  execCheck: (ctx) => {
    // Parity QA Wave 7 (P-24): @COM_ABLE402 faithful gates.
    //   - 現在位置 == CFLAG:MASTER:311(初期位置) || OMANEKIBEYA || 陪睡中.
    //     `homeLocation` is the modern canonical form of CFLAG:311. Older
    //     saves fall back to the legacy standalone 自宅 scene.
    //   - NEMUKE() < 720 → RETURN 0 (line 99, under FLAG:1005==0): must be
    //     ~12h past wake — blocks the noon-sleep the old gate allowed.
    //   - CFLAG:诶嘿嘿 == 2 → RETURN 0 (line 102, target-led H).
    const coSleeping = (ctx.state.master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0;
    if (!coSleeping) {
      if (!masterAtHome(ctx.state)) {
        return {
          ok: false,
          reason: { kind: "com_able", code: 402, message: "这里只能休息，必须回到自己的房间（自室）才能就寝。" },
        };
      }
    }
    if (nemuke(ctx.state) < 720) {
      return {
        ok: false,
        reason: { kind: "com_able", code: 402, message: "还不困（需清醒满12小时才能就寝）。" },
      };
    }
    const tgt = ctx.state.charas[ctx.target];
    if (tgt && (tgt.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2) {
      return {
        ok: false,
        reason: { kind: "com_able", code: 402, message: "对方正主导中。" },
      };
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);

    // TARGET branch: clear companion / sleep-state flags on both
    // master and target. ERA's `@OYASUMI` does this when `TARGET > 0`.
    if (ctx.target > 0) {
      setMasterCflag(next, CFLAG_ID.陪睡中, 0);
      setMasterCflag(next, CFLAG_ID.同行, 0);
      const tgt = next.charas[ctx.target];
      if (tgt) {
        tgt.state.CFLAG[CFLAG_ID.陪睡中] = 0;
        tgt.state.CFLAG[CFLAG_ID.同行] = 0;
        tgt.state.CFLAG[CFLAG_ID.衰弱] = 0;
      }
    }

    // SET_SLEEP(1, MASTER, 0) — full P1-#5 Slice A port.
    // SET_CMN.ERB:111-161: CFLAG:睡眠=1 + CFLAG:约会中=MAIN_MAP + 着替え実行
    // bit 0 CLEAR / bit 1 SET + 睡眠薬深度 = 1200×(睡眠薬強度+1) + 疲労度/3
    // + BUFF_RESET (master only). Replaces the previous "minimal: just
    // set the 睡眠 flag" stub.
    setSleep(next, 1, 0);

    // CFLAG:MASTER:就寝時間 = DAY * 1440 + TIME.
    // tickValue IS the absolute minute (= dayIndex*1440 + minute-of-day), so it
    // already equals DAY*1440+TIME. The old `dayIndex*1440 + tickValue`
    // double-counted the day (see comf302 / oracle 9912).
    setMasterCflag(next, CFLAG_ID.就寝時間, next.time.tickValue);

    // ---- Phase 8 朝夜挨拶: arm 3 (おやすみ) at bed-down ----
    // Fires for the sleeping companion (TARGET) before the time advance,
    // mirroring SLEEP.ERB:122. Uses the pre-advance state; the variant
    // selector (CFLAG:998) and TALENT/CFLAG greeting predicates don't
    // depend on tickValue.
    const oyasumiLines = greetingLines(ctx, next, GREETING_ARM_OYASUMI, OYASUMI_ARGS);

    prepareMobGirlDayEnd(next);
    next.sleepSession = {
      startedAtTick: next.time.tickValue,
      requestedWakeMinute: masterWakeMinute(next),
      forced: false,
      presentationEventLogIndex: ctx.state.eventLog.length,
    };

    return {
      state: next,
      events: [
        ...oyasumiLines,
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 入睡了……`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
