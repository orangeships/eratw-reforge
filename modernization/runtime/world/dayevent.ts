/**
 * Phase DAYEVENT (Slice 1) — `@DAYEVENT_MAIN` + `@DAYEVENT_SELECTION` +
 * `@DAYEVENT_EXECUTE_EVENT` port (select-then-execute; one event per
 * night/dawn).
 *
 * Upstream: a modded addition to eraTW (a quality-of-life mod under a
 * non-core tier, gated by `ENABLE_DAYEVENTS`; default ON). Called
 * upstream from:
 *   - the AFTERTRA block → `CALL DAYEVENT_MAIN("night")` (end of day,
 *     before sleep).
 *   - the BEFORETRAIN block → `CALL DAYEVENT_MAIN("day")` (morning wake,
 *     before greeting).
 *
 * **Current scope** — all 13 scenario IDs have deterministic selection and a
 * mainline execution path. The remaining differences are deliberately local:
 * authored `DAYEVENT_COND` hooks, interactive ASK_YN continuation branches,
 * QOL_STAYOVER state, and several H-only namespaces such as STAIN/semen.
 *
 * The pipeline:
 *   `finishPlayerSleep` (or its successor, `runNightSettlement`) calls
 *   `selectDayEvent(state, "night", rng)` → if a (target, scenario) wins,
 *   call `executeDayEvent(state, target, scenario, rng, router, now)` →
 *   the returned `ObservationEvent[]` is appended to the event log.
 *
 * `EventPrompt` events for ASK_YN branches are not produced by the automatic
 * night/morning settlement yet; the deterministic default branch is used and
 * the prompt schema remains available for a later interactive continuation.
 */

import type {
  CharaSlot,
  CharaSlotState,
  GameState,
} from "../state/game-state.js";
import type { DialogueRouter, KojoFunctionResolution, KojoLine } from "../kojo/types.js";
import type { KojoStagedEffect, PendingKojoChoice } from "../kojo/types.js";
import { applyKojoEffects } from "../kojo/effects.js";
import type { Rng } from "../command/rng.js";
import type {
  ObservationEvent,
} from "../../schemas/types.js";
import { juelUpSpecial } from "../state/juel.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  TALENT_ID,
  recoverBase,
} from "../state/settlement.js";
import { getUwakiHistory } from "../state/uwaki.js";
import { relationOf } from "./relation.js";
import { atPlayerBase, mapIdOfLocation, placeFlagsOf } from "./location-predicates.js";
import { hasPlace, PLACE_MOON } from "./place-flags.js";
import { weatherIndexNow } from "../state/weather.js";
import { depositEjaculate } from "./semen-residue.js";
import { setStainBit, stainSwapInsertV, STAIN_BIT, STAIN_PART } from "../state/stain.js";
import { applyTemporaryStayover } from "./temporary-stay.js";

// =====================================================================
// Scenario enum (mirrors the modded DAYEVENTS constants header).
// =====================================================================

/** DAYEVENT_GENERAL — eligibility sentinel, not a scenario. */
export const DAYEVENT_GENERAL = 0;
/** Day lewd scenarios (arm 4 昼淫, subid 1-3). */
export const DAYEVENT_ORAL = 1;
export const DAYEVENT_PAIZURI = 2;
export const DAYEVENT_COWGIRL = 3;
/** Day normal scenarios (arm 5 昼普, subid 4-8). */
export const DAYEVENT_KISS = 4;
export const DAYEVENT_WAKEUP = 5;
export const DAYEVENT_COSLEEPING = 6;
export const DAYEVENT_STARE = 7;
export const DAYEVENT_PRANK = 8;
/** Night lewd scenarios (arm 6 夜淫, subid 1-2 → 9-10 global). */
export const NIGHTEVENT_KISS = 9;
export const NIGHTEVENT_YOBAI = 10;
/** Night normal scenarios (arm 7 夜普, subid 1-3 → 11-13 global). */
export const NIGHTEVENT_DRINK = 11;
export const NIGHTEVENT_MOONVIEWING = 12;
export const NIGHTEVENT_SLEEPOVER = 13;

export type DayEventScenario = number;
export type DayEventType = "day" | "night";

// =====================================================================
// SP_EVENT category arms + scenario → (arm, subid) for KOJO_MESSAGE_SEND
// upstream `KOJO_MESSAGE_SEND("SP_EVENT", arm, target, subid, ...)` —
// see ERB/口上・メッセージ関連/KOJO_MESSAGE.ERB:99.
// =====================================================================

/** Upstream SP_EVENT category arms. The per-scenario subid rides in
 *  `subidForScenario` below; the function call is
 *  `KOJO_MESSAGE_SEND("SP_EVENT", arm, target, subid, ARG:3, ARG:4)`. */
const SP_EVENT_ARM_DAY_LEWD = 4;
const SP_EVENT_ARM_DAY_NORMAL = 5;
const SP_EVENT_ARM_NIGHT_LEWD = 6;
const SP_EVENT_ARM_NIGHT_NORMAL = 7;

/** Return the (arm, subid) for `KOJO_MESSAGE_SEND("SP_EVENT", …)` for
 *  a given scenario. Mirrors ERB `DAYEVENT_EXECUTE_EVENT` per-CASE. */
function spEventForScenario(scenario: DayEventScenario): { arm: number; subid: number } | null {
  switch (scenario) {
    case DAYEVENT_ORAL: return { arm: SP_EVENT_ARM_DAY_LEWD, subid: 1 };
    case DAYEVENT_PAIZURI: return { arm: SP_EVENT_ARM_DAY_LEWD, subid: 2 };
    case DAYEVENT_COWGIRL: return { arm: SP_EVENT_ARM_DAY_LEWD, subid: 3 };
    case DAYEVENT_KISS: return { arm: SP_EVENT_ARM_DAY_NORMAL, subid: 1 };
    case DAYEVENT_WAKEUP: return { arm: SP_EVENT_ARM_DAY_NORMAL, subid: 2 };
    case DAYEVENT_COSLEEPING: return { arm: SP_EVENT_ARM_DAY_NORMAL, subid: 3 };
    case DAYEVENT_STARE: return { arm: SP_EVENT_ARM_DAY_NORMAL, subid: 4 };
    case DAYEVENT_PRANK: return { arm: SP_EVENT_ARM_DAY_NORMAL, subid: 5 };
    case NIGHTEVENT_KISS: return { arm: SP_EVENT_ARM_NIGHT_LEWD, subid: 1 };
    case NIGHTEVENT_YOBAI: return { arm: SP_EVENT_ARM_NIGHT_LEWD, subid: 2 };
    case NIGHTEVENT_DRINK: return { arm: SP_EVENT_ARM_NIGHT_NORMAL, subid: 1 };
    case NIGHTEVENT_MOONVIEWING: return { arm: SP_EVENT_ARM_NIGHT_NORMAL, subid: 2 };
    case NIGHTEVENT_SLEEPOVER: return { arm: SP_EVENT_ARM_NIGHT_NORMAL, subid: 3 };
    default: return null;
  }
}

// =====================================================================
// CD (cooldown) table — `DAYEVENT_CHECK_CHARA` ERB lines 88-101.
// 6 buckets by days-since-last-visit, indexed by `LastHomeVisit:TARGET:
// LAST_HOME_VISIT_NIGHT` (= 0) or `LAST_HOME_VISIT_DAY` (= 1).
// Each bucket is the PASS probability (0..1); <3 days → always blocked.
// =====================================================================

const CD_TABLE: readonly number[] = [
  0,    // < 3 days: never
  0,    // < 3 days: never
  0,    // < 3 days: never
  0.15, // 3 days
  0.30, // 4 days
  0.50, // 5 days
  0.65, // 6 days
  0.85, // 7 days
  // >= 8 days: always pass (no entry in the table)
];

// =====================================================================
// PALAM/ABL/TALENT/BASE/CFLAG id constants used by select + execute.
// These are the IDs we know exist in `modernization/runtime/state/
// settlement.ts` (Phase 7 ids). A few that don't exist yet
// (BASE:ムード, TALENT:機嫌, TCVAR:今日会ったか, EXP:奉仕快楽/パイズリ
// /精飲/Ｂ/絶頂) are read with `?? 0` so a clean chara evaluates the
// predicate faithfully (treated as 0 = not present).
// =====================================================================

// PALAM (from settlement.ts PALAM_ID — the jewel/favor accumulator ns).
// NOTE: 恭順/欲情 were previously 16/15 here, but those are SOURCE_ID
// values (SOURCE 恭順=16 / 欲情=15). The DAYEVENT upstream writes to the
// PALAM namespace (`PALAM:恭順 += …`), so the correct ids are PALAM
// 恭順=10 / 欲情=11 — otherwise the gain lands on PALAM 恐怖(16)/苦痛(15)
// and the day-end FAVOR_CALC/JUEL_CHECK never sees it. Fixed in #5.
const PALAM_好意 = 20;
const PALAM_恭順 = 10;
const PALAM_欲情 = 11;
const PALAM_恥情 = 14;
const PALAM_優越 = 21;
const PALAM_潤滑 = 9;
const PALAM_快Ｃ = 0;
const PALAM_快Ｖ = 1;
const PALAM_快Ｂ = 3;
const PALAM_快Ｍ = 4;

// ABL
const ABL_親密 = 9;
const ABL_従順 = 10;
const ABL_欲望 = 11;
const ABL_技巧 = 12;
const ABL_奉仕精神 = 13;
const ABL_Ｃ感覚 = 0;
const ABL_Ｖ感覚 = 1;
const ABL_Ｍ感覚 = 4;
const ABL_Ｂ感覚 = 3;
const ABL_胸 = 52;

// TALENT
const TALENT_キス未経験 = 6;
const TALENT_妊娠 = 153;
const TALENT_育児中 = 154;
const TALENT_反発刻印_ABSENT = 0;

// CFLAG
const CFLAG_溜まってる度 = 340;
const CFLAG_衰弱 = 316;
const CFLAG_初期位置 = 311;
const CFLAG_現在位置 = 300;
const CFLAG_自宅位置 = 358;
const CFLAG_MASTER現在位置 = 300;
const CFLAG_出禁 = 307;
const CFLAG_LAST_HOME_VISIT_NIGHT = 0; // offset slot 0
const CFLAG_LAST_HOME_VISIT_DAY = 1;   // offset slot 1
const CFLAG_10 = 10; // DAYEVENT_PRANK noise gate (eraTW: CFLAG:10 — one of the target-prank signals)
const CFLAG_不機嫌 = 322;
const CFLAG_キス経験 = 27;
const CFLAG_親密度累積 = 2; // CHANGE_CFLAG(2, ABL:親密×n) — running intimacy CFLAG.

// BASE (for DOWNBASE drains)
const BASE_体力 = 0;
const BASE_気力 = 1;
const BASE_酒気 = 15;

// TCVAR
const TCVAR_今日会ったか = 182;
/** Session-EXP mirror bank: upstream `TCVAR:(400+expId) += n` next to each
 *  `EXP:(expId) += n` (DAYEVENT.ERB 583-592/637-646). */
const TCVAR_SESSION_EXP_BASE = 400;

// EXP ids (settlement.ts EXP_ID) used by the lewd scenarios' nExp/mExp.
const EXP_Ｃ経験 = 0;
const EXP_Ｂ経験 = 3;
const EXP_Ｍ経験 = 4;
const EXP_Ｃ絶頂経験 = 5;
const EXP_Ｖ絶頂経験 = 6;
const EXP_Ｂ絶頂経験 = 8;
const EXP_絶頂経験 = 10;
const EXP_Ｖ経験 = 1;
const EXP_口淫経験 = 25;

// =====================================================================
// `selectDayEvent` — faithful port of `@DAYEVENT_MAIN` for one TYPE.
// Returns the chosen `(target charaNum, scenario)` or `null`.
// Pure function over state + rng; mutates nothing (state writes happen
// in `executeDayEvent` or the wake/sleep flow upstream).
// =====================================================================

/**
 * Fisher–Yates shuffle (a single draw of the array). Faithful port of
 * upstream `@FISHER_YATES_SHAFFLE` used in `@DAYEVENT_CHECK_RANGE` —
 * we don't call the upstream function; we just need a deterministic
 * shuffle so scenario checks are not biased by enum order. Returns a
 * new array (does not mutate input).
 */
function shuffleInts(arr: readonly number[], rng: Rng): number[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    // Rng.int returns [0, max); for uniform [0, i] we use int(i+1).
    const j = rng.int(i + 1);
    if (j < 0 || j > i) continue; // safety: rng must respect bounds
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface DayEventSelection {
  target: number;
  scenario: DayEventScenario;
}

/** Check whether the target is "at home" (their `初期位置` equals the
 *  master's `現在位置`, the modern equivalent of upstream `AT_HOME`).
 *  Mirrors eraTW's `@AT_HOME` — a chara only counts as at-home when
 *  their `初期位置` resolves to a room currently the master's. We read
 *  CFLAG directly (the modern canonical marker; `master.location` is
 *  the string-form alias but tests may omit it). */
function hasPenis(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
}

function hasVagina(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
}

/** Upstream `!TALENT:処女`: zero is the non-virgin state. */
function isNonVirgin(slot: CharaSlot): boolean {
  return (slot.state.TALENT[TALENT_ID.処女] ?? 0) === 0;
}

/** `IS_DOUTEI` is true while the male `非童貞` bitfield is still zero. */
function isDoutei(slot: CharaSlot): boolean {
  return (slot.state.TALENT[TALENT_ID.非童貞] ?? 0) === 0;
}

function minuteOfDay(state: GameState): number {
  const raw = Math.trunc(state.time.tickValue) % 1440;
  return raw < 0 ? raw + 1440 : raw;
}

function scheduleMinute(slot: CharaSlot, id: number, fallback: number): number {
  const value = slot.state.CFLAG[id];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const minute = Math.trunc(value) % 1440;
  return minute < 0 ? minute + 1440 : minute;
}

/** `BETWEENTIME(START, END)` with the upstream midnight-wrap semantics. */
function betweenClockMinutes(start: number, end: number, current: number): boolean {
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

/** Exact modern equivalent of `@DAYEVENT_VISIT`. */
function dayEventVisitAllowed(
  state: GameState,
  target: CharaSlot,
  type: DayEventType,
): boolean {
  const current = minuteOfDay(state);
  const wake = scheduleMinute(target, CFLAG_ID.起床時間, 420);
  const sleep = scheduleMinute(target, CFLAG_ID.就寝時間, 1320);
  if (atPlayerBase(state, target.charaNum)) {
    return betweenClockMinutes(wake, sleep, current);
  }
  if (type === "day") {
    const returnTime = scheduleMinute(target, CFLAG_ID.帰宅時間, 1080);
    return betweenClockMinutes(wake, returnTime, current);
  }
  const visit = scheduleMinute(target, CFLAG_ID.来訪時間, 1080);
  return betweenClockMinutes(visit, (sleep + 120) % 1440, current);
}

/** `DAYEVENT_ALLOWED_IN_ROOM` for the modern string-location authority. */
function dayEventAllowedInRoom(
  state: GameState,
  target: CharaSlot,
  lewd = false,
): boolean {
  const room = state.master.location;
  const targetIsSpouse =
    (target.state.TALENT[TALENT_ID.妻] ?? 0) === 2 ||
    (target.state.TALENT[TALENT_ID.妾] ?? 0) !== 0;
  const affinityReq = targetIsSpouse ? 100 : 150;
  for (const roommate of Object.values(state.charas)) {
    if (roommate.charaNum === target.charaNum || roommate.location !== room) continue;
    if (lewd && getUwakiHistory(state, roommate.charaNum, target.charaNum) < 2) {
      return false;
    }
    const compatibility = relationOf(roommate.charaNum, target.charaNum);
    const affinity = compatibility === 0 ? 100 : compatibility;
    if (affinity < affinityReq) return false;
  }
  return true;
}

/** `@DAYEVENT_CHECK_RANGE` ERB lines 188-198 — shuffle the candidate
 *  range and run `@DAYEVENT_CONDITION_CHECK` on each until one passes.
 *  Returns the first passing scenario or 0. */
function checkRange(
  start: number,
  end: number,
  t: CharaSlot,
  master: CharaSlot,
  type: DayEventType,
  state: GameState,
  rng: Rng,
  router: DialogueRouter | undefined,
): DayEventScenario {
  const options: number[] = [];
  for (let i = start; i <= end; i++) options.push(i);
  const shuffled = shuffleInts(options, rng);
  for (const scenario of shuffled) {
    if (scenarioPassesConditions(scenario, t, master, type, state, rng, router)) {
      return scenario;
    }
  }
  return 0;
}

/** Faithful port of `@DAYEVENT_CONDITION_CHECK` (ERB 200-276). Returns
 *  `true` iff the scenario is allowed for this target+type. The authored
 *  `DAYEVENT_COND` return hook runs after unconditional safety checks and
 *  before the built-in fallback, matching `@DAYEVENT_CONDITION_CHECK`. */
function scenarioPassesConditions(
  scenario: DayEventScenario,
  t: CharaSlot,
  master: CharaSlot,
  type: DayEventType,
  state: GameState,
  rng: Rng,
  router: DialogueRouter | undefined,
): boolean {
  const st = t.state;
  // Always-on pre-checks (ERB 206-226).
  switch (scenario) {
    case NIGHTEVENT_DRINK:
      // ERB 208-211: blocked if 妊娠 or 育児中.
      if ((st.TALENT[TALENT_妊娠] ?? 0) !== 0 || (st.TALENT[TALENT_育児中] ?? 0) !== 0) {
        return false;
      }
      break;
    case NIGHTEVENT_SLEEPOVER:
      // ERB 213-215: blocked if already in the same room.
      if (
        st.CFLAG[CFLAG_現在位置] !== 0 &&
        st.CFLAG[CFLAG_現在位置] === st.CFLAG[CFLAG_MASTER現在位置]
      ) {
        return false;
      }
      break;
    case NIGHTEVENT_MOONVIEWING:
      // ERB 219-225: 20:00-06:00, unless the master is weakened.
      if (
        (state.master.state.CFLAG[CFLAG_ID.衰弱] ?? 0) === 0 &&
        !(minuteOfDay(state) >= 1200 || minuteOfDay(state) <= 360)
      ) return false;
      break;
  }

  // -1 blocks, 0 falls through to the generic condition, and a positive
  // value authorizes the scenario. Unsupported authored paths fail closed.
  const hook = router?.resolveDayEventCondition?.(
    t.charaNum,
    type,
    scenario,
    state,
    rng,
  );
  if (hook && isUnsupportedDayEventHook(hook)) return false;
  if (hook && hook.returnValue < 0) return false;
  if (hook && hook.returnValue > 0) return true;

  // Built-in per-scenario conds (ERB 231-267).
  switch (scenario) {
    case DAYEVENT_ORAL:
      return st.ABL[ABL_欲望]! >= 3
        && st.ABL[ABL_技巧]! >= 3
        && (st.EXP[3] ?? 0) >= 50   // EXP:奉仕快楽経験 (deferred id) — read 0 in MVP
        && (st.EXP[25] ?? 0) >= 20; // EXP:口淫経験 (id 25)
    case DAYEVENT_PAIZURI:
      return hasPenis(master)
        && st.ABL[ABL_欲望]! >= 3
        && st.ABL[ABL_技巧]! >= 5
        && (st.EXP[3] ?? 0) >= 50
        && (st.EXP[26] ?? 0) >= 10; // EXP:パイズリ経験 (deferred id) — read 0
    case DAYEVENT_COWGIRL:
      // ERB 236-239: base = ABL:欲望>=5 + EXP:奉仕快楽>=50; if has-penis
      // add non-virgin + V-sex EXP>=50.
      if (st.ABL[ABL_欲望]! < 5) return false;
      if ((st.EXP[3] ?? 0) < 50) return false;
      if (!hasPenis(master)) return true;
      return isNonVirgin(t)
        && !isDoutei(master)
        && (master.state.EXP[EXP_ID.Ｖ経験] ?? 0) >= 50;
    case DAYEVENT_KISS:
      return (st.TALENT[TALENT_キス未経験] ?? 0) === 0
        && (master.state.TALENT[TALENT_キス未経験] ?? 0) === 0
        && st.ABL[ABL_親密]! >= 10
        && (st.EXP[CFLAG_キス経験] ?? 0) >= 50;
    case DAYEVENT_WAKEUP:
      return st.ABL[ABL_親密]! >= 7 && st.ABL[ABL_奉仕精神]! >= 3;
    case DAYEVENT_COSLEEPING:
      return st.ABL[ABL_親密]! >= 10
        && st.ABL[ABL_欲望]! >= 3
        && (st.EXP[41] ?? 0) >= 50; // EXP:愛情経験 (id 41)
    case DAYEVENT_STARE:
      return st.ABL[ABL_親密]! >= 10
        && st.ABL[ABL_従順]! >= 7
        && (st.EXP[41] ?? 0) >= 50;
    case DAYEVENT_PRANK:
      return st.ABL[ABL_親密]! >= 5
        && st.ABL[ABL_欲望]! >= 5
        && (
          (st.MARK[1] ?? 0) > 0
          || (st.CFLAG[CFLAG_10] ?? 0) !== 0
          || ((st.TALENT[TALENT_反発刻印_ABSENT] ?? 0) < 0)
          || (st.CFLAG[CFLAG_不機嫌] ?? 0) !== 0
        );
    case NIGHTEVENT_KISS:
      return (st.TALENT[TALENT_キス未経験] ?? 0) === 0
        && (master.state.TALENT[TALENT_キス未経験] ?? 0) === 0
        && st.ABL[ABL_親密]! >= 10
        && (st.EXP[CFLAG_キス経験] ?? 0) >= 30;
    case NIGHTEVENT_YOBAI:
      if (st.ABL[ABL_欲望]! < 5 || (st.CFLAG[CFLAG_溜まってる度] ?? 0) <= 300) return false;
      if (hasVagina(t) && !hasVagina(master)) {
        return isNonVirgin(t)
          && !isDoutei(master)
          && (master.state.EXP[EXP_ID.Ｖ経験] ?? 0) >= 50;
      }
      if (hasPenis(t) && hasVagina(master)) {
        return isNonVirgin(master)
          && !isDoutei(t)
          && (master.state.EXP[EXP_ID.Ｖ経験] ?? 0) >= 50
          && (t.state.EXP[EXP_ID.挿入経験] ?? 0) >= 10;
      }
      return true;
    case NIGHTEVENT_DRINK:
      return st.ABL[ABL_奉仕精神]! >= 3 && (st.EXP[3] ?? 0) >= 50;
    case NIGHTEVENT_MOONVIEWING:
      if (st.ABL[ABL_親密]! < 10) return false;
      if (!hasPlace(placeFlagsOf(state.master.location), PLACE_MOON)) return false;
      const region = mapIdOfLocation(state.master.location);
      const weather = region !== null
        ? state.weather?.gensokyoWeatherSystem[region]
        : undefined;
      const weatherIndex = typeof weather === "number" && Number.isFinite(weather)
        ? weather
        : weatherIndexNow(state.time);
      return weatherIndex <= 4 || weatherIndex === 8;
    case NIGHTEVENT_SLEEPOVER:
      return st.ABL[ABL_親密]! >= 10
        && st.ABL[ABL_欲望]! >= 3
        && (st.EXP[41] ?? 0) >= 10;
    default:
      return false;
  }
}

/** `@DAYEVENT_CHECK_CHARA` ERB 56-128 — per-character eligibility.
 *  Returns the upstream eligibility decision and whether the authored
 *  general hook requested the RETURN 2 bypass. */
function charaEligible(
  charaNum: number,
  t: CharaSlot,
  type: DayEventType,
  state: GameState,
  rng: Rng,
  router: DialogueRouter | undefined,
): CharaEligibility {
  // 1. 出禁 block (ERB 62).
  if ((t.state.CFLAG[CFLAG_出禁] ?? 0) !== 0) {
    return { allowed: false, bypassVisitAndCooldown: false };
  }

  // A real router exposes the authored-only discriminator. Missing content
  // returns 0: ENABLE=1 excludes it, while ENABLE=2 falls through to the
  // generic visit rules. Callers without this optional hook keep the legacy
  // fixture behavior until they opt into authored routing.
  let bypassVisitAndCooldown = false;
  const generalHook = router?.resolveDayEventCondition?.(
    charaNum,
    type,
    DAYEVENT_GENERAL,
    state,
    rng,
  );
  if (generalHook) {
    if (isUnsupportedDayEventHook(generalHook)) {
      return { allowed: false, bypassVisitAndCooldown: false };
    }
    if (generalHook.returnValue < 0) {
      return { allowed: false, bypassVisitAndCooldown: false };
    }
    bypassVisitAndCooldown = generalHook.returnValue === 2;
    if (!bypassVisitAndCooldown
      && generalHook.returnValue === 0
      && (state.dayEventsEnabled ?? 1) !== 2) {
      return { allowed: false, bypassVisitAndCooldown: false };
    }
  }

  // 2. Exact `DAYEVENT_VISIT` wake/return/bed window (ERB 708-725).
  if (!bypassVisitAndCooldown && !dayEventVisitAllowed(state, t, type)) {
    return { allowed: false, bypassVisitAndCooldown: false };
  }

  if (bypassVisitAndCooldown) {
    return { allowed: true, bypassVisitAndCooldown: true };
  }

  // 3. CD table (ERB 88-101). Read days-since-last-visit.
  // We model `LastHomeVisit` as `CFLAG: {charaNum * 2} + {0/1}` for
  // night/day respectively. The CFLAG index space is large enough; this
  // isolates the DAYEVENT cooldowns from per-chara CFLAG ids we don't
  // want to renumber. (Documented in DEBUG-BOARD.)
  const visitSlotKey = type === "day"
    ? CFLAG_LAST_HOME_VISIT_DAY
    : CFLAG_LAST_HOME_VISIT_NIGHT;
  const visitSlot = state.flagStore[visitSlotKey + charaNum * 2];
  const lastVisit = typeof visitSlot === "number" ? visitSlot : 0;
  const daysSince = state.time.dayIndex - lastVisit;
  // Upstream applies the two-sided recent-event guard only to non-roommates,
  // then applies the selected type's probability table to every target.
  const masterInitial = state.master.state.CFLAG[CFLAG_初期位置] ?? 0;
  const targetInitial = t.state.CFLAG[CFLAG_初期位置] ?? 0;
  if (targetInitial !== masterInitial) {
    const lastNight = state.flagStore[CFLAG_LAST_HOME_VISIT_NIGHT + charaNum * 2];
    const lastDay = state.flagStore[CFLAG_LAST_HOME_VISIT_DAY + charaNum * 2];
    const safeLastNight = typeof lastNight === "number"
      ? Math.min(lastNight, state.time.dayIndex)
      : 0;
    const safeLastDay = typeof lastDay === "number"
      ? Math.min(lastDay, state.time.dayIndex)
      : 0;
    if (state.time.dayIndex - safeLastNight < 3 || state.time.dayIndex - safeLastDay < 3) {
      return { allowed: false, bypassVisitAndCooldown: false };
    }
  }
  if (daysSince < 3) return { allowed: false, bypassVisitAndCooldown: false };
  if (daysSince >= CD_TABLE.length) {
    // 8+ days: always pass the CD check.
  } else {
    const passProb = CD_TABLE[daysSince]!;
    if (passProb <= 0) return { allowed: false, bypassVisitAndCooldown: false };
    if (rng.next() >= passProb) return { allowed: false, bypassVisitAndCooldown: false };
  }

  // 4. Non-homeowner 70% gate (ERB 106-112).
  if (!atPlayerBase(state, charaNum) && rng.next() < 0.70) {
    return { allowed: false, bypassVisitAndCooldown: false };
  }

  // 5. Falls through to the type-specific scenario pick. We do the
  //    selection *here* (rather than in a second pass) so the candidate
  //    arrays contain only winning scenario entries. Faithful enough —
  //    upstream's two-pass shape is for DEBUGPRINTFORML output.
  return { allowed: true, bypassVisitAndCooldown: false };
}

/** `@DAYEVENT_SELECTION` (ERB 131-180) — returns the picked scenario
 *  for one chara+type or 0. */
function pickScenarioForChara(
  t: CharaSlot,
  master: CharaSlot,
  type: DayEventType,
  state: GameState,
  rng: Rng,
  router: DialogueRouter | undefined,
): DayEventScenario {
  // Exhaustion gate for night (ERB 156-159).
  if (type === "night") {
    const hp = t.state.BASE[0] ?? 0; // 体力
    const mp = t.state.BASE[1] ?? 0; // 気力
    if (hp < 1000 || mp <= 0 || (t.state.CFLAG[CFLAG_衰弱] ?? 0) !== 0) {
      return 0;
    }
  }

  // Lewd-first, then normal — with the upstream room/privacy gate.
  let pick: DayEventScenario = 0;
  if (type === "day") {
    const lewd = rng.int(2) === 0
      && ((t.state.CFLAG[CFLAG_溜まってる度] ?? 0) > 300 || (t.state.ABL[ABL_欲望] ?? 0) > 10);
    if (lewd && dayEventAllowedInRoom(state, t, true)) {
      pick = checkRange(DAYEVENT_ORAL, DAYEVENT_COWGIRL, t, master, type, state, rng, router);
    }
    if (!pick && dayEventAllowedInRoom(state, t)) {
      pick = checkRange(DAYEVENT_KISS, DAYEVENT_PRANK, t, master, type, state, rng, router);
    }
  } else {
    const lewd = rng.int(2) === 0
      && ((t.state.ABL[ABL_欲望] ?? 0) > 6 || (t.state.PALAM[PALAM_欲情] ?? 0) > 10000);
    if (lewd && dayEventAllowedInRoom(state, t, true)) {
      pick = checkRange(NIGHTEVENT_KISS, NIGHTEVENT_YOBAI, t, master, type, state, rng, router);
    }
    if (!pick && dayEventAllowedInRoom(state, t)) {
      pick = checkRange(NIGHTEVENT_DRINK, NIGHTEVENT_SLEEPOVER, t, master, type, state, rng, router);
    }
  }
  return pick;
}

/** The main entry. One day or night event per call. Returns null when
 *  no candidate clears the gates (faithful: upstream silent skip). */
export function selectDayEvent(
  state: GameState,
  type: DayEventType,
  rng: Rng,
  router?: DialogueRouter,
): DayEventSelection | null {
  // Upstream gates 18-23: only fire when player is sleeping at their
  // own base spot and the dayevents toggle is on.
  const masterHome = state.master.state.CFLAG[CFLAG_自宅位置];
  const masterNow = state.master.state.CFLAG[CFLAG_現在位置];
  if (masterHome !== masterNow) return null;
  // `ENABLE_DAYEVENTS=0` is the global hard-off switch. Values 1/2 retain the
  // upstream distinction between authored-only and all eligible characters;
  // the per-character DAYEVENT_COND return hook is a later router capability.
  const enabled = state.dayEventsEnabled ?? 1;
  if (enabled !== 1 && enabled !== 2) return null;

  // Build the candidate pool via chara eligibility + scenario pick.
  const candidates: DayEventSelection[] = [];
  for (const [numStr, slot] of Object.entries(state.charas)) {
    const num = Number(numStr);
    if (!Number.isFinite(num) || num <= 0) continue;
    const eligibility = charaEligible(num, slot, type, state, rng, router);
    if (!eligibility.allowed) continue;
    const scenario = pickScenarioForChara(slot, state.master, type, state, rng, router);
    if (scenario > 0) candidates.push({ target: num, scenario });
  }

  if (candidates.length === 0) return null;

  // Weighted pick (ERB 121-124). Roommates x4 for day events; for night
  // weight is `MAX(daysSince, 1)`. We use `1` flat in MVP — the
  // weighting is a tie-break that doesn't matter when the pool is
  // usually 0-1 entries.
  const weights = candidates.map((_c, i) => (i === 0 ? 1 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let pick = rng.next() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

// =====================================================================
// `executeDayEvent` — apply the selected scenario's effects + emit
// SP_EVENT kojo (DIALOGUE_LINE events).
// =====================================================================

/** Stamp the last-visit cooldown for the chara so the CD table resets
 *  for the chosen type. ERB lines 651-665. */
function stampLastHomeVisit(
  state: GameState,
  charaNum: number,
  type: DayEventType,
): void {
  const slot = type === "day"
    ? CFLAG_LAST_HOME_VISIT_DAY
    : CFLAG_LAST_HOME_VISIT_NIGHT;
  state.flagStore[slot + charaNum * 2] = state.time.dayIndex;
}

/** Fire SP_EVENT kojo and return the resulting KojoLine events
 *  (empty array when the router has no body for this chara+subid). */
function fireSpEvent(
  router: DialogueRouter | undefined,
  charaNum: number,
  arm: number,
  subid: number,
  state: GameState,
  rng: Rng,
): KojoLine[] {
  if (!router) return [];
  const detailed = router.resolveSpEventKojoDetailed?.(
    charaNum,
    subid,
    state,
    rng,
    [arm, subid],
  );
  if (detailed) {
    if (detailed.effects.length > 0) {
      Object.assign(state, applyKojoEffects(state, detailed.effects));
    }
    return detailed.lines;
  }
  return router.resolveSpEventKojo(charaNum, subid, state, rng, [arm, subid]);
}

function isUnsupportedDayEventHook(
  hook: KojoFunctionResolution,
): boolean {
  return hook.status === "unsupported" || hook.status === "partial"
    || hook.unsupportedPredicates.length > 0
    || hook.unsupportedEffects.length > 0;
}

interface CharaEligibility {
  allowed: boolean;
  /** Authored RETURN 2 skips visit-window and cooldown/random gates. */
  bypassVisitAndCooldown: boolean;
}

export interface DayEventKojoSession {
  charaNum: number;
  subid: number;
  args?: readonly number[];
  choices: readonly number[];
}

export function dayEventKojoEventsFromSession(
  state: GameState,
  session: DayEventKojoSession,
  router: DialogueRouter,
  rng: Rng,
  now: () => number,
): { events: ObservationEvent[]; pending: PendingKojoChoice | null; effects: KojoStagedEffect[] } {
  const interactive = router.resolveSpEventKojoInteractive?.(
    session.charaNum,
    session.subid,
    state,
    rng,
    session.args,
    session.choices,
  );
  const detailed = interactive
    ? undefined
    : router.resolveSpEventKojoDetailed?.(
        session.charaNum,
        session.subid,
        state,
        rng,
        session.args ? [...session.args] : undefined,
      );
  const lines =
    interactive?.lines ??
    detailed?.lines ??
    router.resolveSpEventKojo(
      session.charaNum,
      session.subid,
      state,
      rng,
      session.args ? [...session.args] : undefined,
    );
  return {
    events: lines.map((line) => ({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum: session.charaNum,
      text: line.text,
      form: line.form,
    })),
    pending: interactive?.pending ?? null,
    effects: interactive?.pending ? [] : (interactive?.effects ?? detailed?.effects ?? []),
  };
}

function addPalam(st: CharaSlotState, id: number, delta: number): void {
  st.PALAM[id] = (st.PALAM[id] ?? 0) + delta;
}

/** Increment キス経験 EXP. (Not a separate `BASE/MAXBASE` namespace.) */
function addKissExp(st: CharaSlotState): void {
  st.EXP[CFLAG_キス経験] = (st.EXP[CFLAG_キス経験] ?? 0) + 1;
}

function recordFirstKiss(state: GameState, slot: CharaSlot, partner: number): void {
  if ((slot.state.TALENT[TALENT_ID.キス未経験] ?? 0) <= 0) return;
  slot.state.TALENT[TALENT_ID.キス未経験] = 0;
  slot.state.CFLAG[CFLAG_ID.初吻喪失記念日] = state.time.dayIndex;
  slot.state.CFLAG[CFLAG_ID.初吻喪失对手] = partner;
  slot.state.CFLAG[CFLAG_ID.初吻喪失対象] = 0;
  state.firstKissHistory ??= {};
  state.firstKissHistory[slot.charaNum] = {
    dayIndex: state.time.dayIndex,
    location: slot.location,
    partner: { kind: "character", charaNum: partner },
    situation: "ordinary",
  };
}

/** `MUTUAL_KISS`: both participants receive the same kiss count. */
function mutualKiss(state: GameState, target: CharaSlot, count = 1): void {
  recordFirstKiss(state, state.master, target.charaNum);
  recordFirstKiss(state, target, 0);
  grantExp(state.master.state, EXP_ID.キス経験, count);
  grantExp(target.state, EXP_ID.キス経験, count);
  target.state.CFLAG[CFLAG_ID.既成事実] = (target.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | 1;
}

/** `ADD_EXP_LESNIAN`: female/female -> 51, male/male -> 52, mixed -> none. */
function addSameSexExp(state: GameState, target: CharaSlot, amount: number): void {
  const masterFemale = hasVagina(state.master);
  if (masterFemale !== hasVagina(target)) return;
  const id = masterFemale ? 51 : 52;
  grantExp(state.master.state, id, amount);
  grantExp(target.state, id, amount);
}

/** Faithful mainline slice for NIGHTEVENT_KISS (ERB 478-482) + post-tail. */
function executeNightKiss(
  state: GameState,
  t: CharaSlot,
  router: DialogueRouter | undefined,
  rng: Rng,
  now: () => number,
): ObservationEvent[] {
  addSameSexExp(state, t, 5);
  mutualKiss(state, t);
  const spEvent = spEventForScenario(NIGHTEVENT_KISS);
  const kojoLines: KojoLine[] = spEvent
    ? fireSpEvent(router, t.charaNum, spEvent.arm, spEvent.subid, state, rng)
    : [];
  applyDayEventTail(state, t, NIGHTEVENT_KISS);
  return [
    ...kojoLines.map<ObservationEvent>((l) => ({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum: t.charaNum,
      text: l.text,
      form: l.form,
    })),
    {
      kind: "NARRATION",
      timestamp: now(),
      text: `【夜事件】${state.master.callName ?? "主人公"} 与 ${t.callName ?? `角色${t.charaNum}`} 的夜之吻。`,
    },
  ];
}

/** Faithful slice for DAYEVENT_STARE (ERB 461-468) + post-tail
 *  (ERB 654-657). Writes PALAM 好意/恥情/優越 + 恭順, plus 理性/ム
 *  ード BASE (ムード BASE id deferred — use BASE:11=理性 as proxy
 *  0-write in MVP). */
function executeDayStare(
  state: GameState,
  t: CharaSlot,
  router: DialogueRouter | undefined,
  rng: Rng,
  now: () => number,
): ObservationEvent[] {
  addPalam(t.state, PALAM_好意, 2700);
  addPalam(t.state, PALAM_恥情, 3000);
  addPalam(t.state, PALAM_優越, 700);
  addPalam(t.state, PALAM_恭順, 500);
  const spEvent = spEventForScenario(DAYEVENT_STARE);
  const kojoLines: KojoLine[] = spEvent
    ? fireSpEvent(router, t.charaNum, spEvent.arm, spEvent.subid, state, rng)
    : [];
  stampLastHomeVisit(state, t.charaNum, "day");
  return [
    ...kojoLines.map<ObservationEvent>((l) => ({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum: t.charaNum,
      text: l.text,
      form: l.form,
    })),
    {
      kind: "NARRATION",
      timestamp: now(),
      text: `【晨事件】${state.master.callName ?? "主人公"} 注视着 ${t.callName ?? `角色${t.charaNum}`}。`,
    },
  ];
}

// =====================================================================
// #5 — the remaining 11 scenarios. Faithful port of the per-CASE
// `@DAYEVENT_EXECUTE_EVENT` bodies (DAYEVENT.ERB 326-666), porting the
// **persistent settlement** (PALAM/EXP/JUEL/DOWNBASE/溜まってる度 +
// 親密/今日会ったか/LastHomeVisit tail). Deferred (documented, not
// fabricated): BASE:ムード/理性 & CFLAG:ディレイ & TALENT:機嫌 (volatile
// per-turn gauges — TURN_RESET wipes them; executeDayStare already
// defers them), STAIN 汚れ marks (cosmetic), ADD_SAMEN_V/SAMEN_SHOOT3/
// EX:膣内精液 semen volume, ADD_EXP_LESNIAN (HETEROSEX exp — deferred
// elsewhere too), QOL_STAYOVER (留宿状态机), and the ASK_YN escalation
// branches (COWGIRL うふふ续战 / YOBAI organ-specific 追加性交) — the
// night/dawn settlement flow is non-interactive so RESULT=0 (default
// branch) is taken, consistent with the upstream 默认支.
// =====================================================================

const master名 = (state: GameState): string => state.master.callName ?? "主人公";
const 角色名 = (t: CharaSlot): string => t.callName ?? `角色${t.charaNum}`;

/** DOWNBASE: reduce a BASE gauge by `amt`, floored at 0. */
function downBase(st: CharaSlotState, id: number, amt: number): void {
  st.BASE[id] = Math.max(0, (st.BASE[id] ?? 0) - amt);
}

/** Grant EXP + mirror the session tracker `TCVAR:(400+id)` (DAYEVENT.ERB
 *  583-592 / 637-646). `st` is the recipient slot state. */
function grantExp(st: CharaSlotState, expId: number, amt: number): void {
  if (amt === 0) return;
  st.EXP[expId] = (st.EXP[expId] ?? 0) + amt;
  const tc = TCVAR_SESSION_EXP_BASE + expId;
  st.TCVAR[tc] = (st.TCVAR[tc] ?? 0) + amt;
}

/** Category tail (DAYEVENT.ERB 615-666): CFLAG:2 親密 bump, 今日会ったか
 *  (night), LastHomeVisit stamp, plus the 昼淫 body drains. */
function applyDayEventTail(state: GameState, t: CharaSlot, scenario: DayEventScenario): void {
  const intimacy = t.state.ABL[ABL_親密] ?? 0;
  const bump = (mult: number): void => {
    t.state.CFLAG[CFLAG_親密度累積] = (t.state.CFLAG[CFLAG_親密度累積] ?? 0) + intimacy * mult;
  };
  if (scenario >= DAYEVENT_ORAL && scenario <= DAYEVENT_COWGIRL) {
    // 昼淫 body (ERB 615-653).
    downBase(state.master.state, BASE_体力, 100);
    downBase(state.master.state, BASE_気力, 150);
    t.state.CFLAG[CFLAG_溜まってる度] = Math.trunc((t.state.CFLAG[CFLAG_溜まってる度] ?? 0) / 2);
    grantExp(state.master.state, EXP_絶頂経験, 1);
    juelUpSpecial(t.state, false, PALAM_欲情, ABL_欲望, 20);
    bump(3);
    stampLastHomeVisit(state, t.charaNum, "day");
  } else if (scenario >= DAYEVENT_KISS && scenario <= DAYEVENT_PRANK) {
    bump(5);
    stampLastHomeVisit(state, t.charaNum, "day");
  } else if (scenario >= NIGHTEVENT_KISS && scenario <= NIGHTEVENT_YOBAI) {
    t.state.TCVAR[TCVAR_今日会ったか] = state.time.dayIndex + 1; // 1-based DAY (truthy on day0)
    bump(3);
    stampLastHomeVisit(state, t.charaNum, "night");
  } else {
    t.state.TCVAR[TCVAR_今日会ったか] = state.time.dayIndex + 1;
    bump(5);
    stampLastHomeVisit(state, t.charaNum, "night");
  }
}

/** Fire the scenario's SP_EVENT kojo and build the event stream. */
function scenarioEvents(
  state: GameState,
  t: CharaSlot,
  scenario: DayEventScenario,
  router: DialogueRouter | undefined,
  rng: Rng,
  now: () => number,
  narration: string,
): ObservationEvent[] {
  const sp = spEventForScenario(scenario);
  const kojoLines: KojoLine[] = sp
    ? fireSpEvent(router, t.charaNum, sp.arm, sp.subid, state, rng)
    : [];
  return [
    ...kojoLines.map<ObservationEvent>((l) => ({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum: t.charaNum,
      text: l.text,
      form: l.form,
    })),
    { kind: "NARRATION", timestamp: now(), text: narration },
  ];
}

/** DAYEVENT_ORAL (ERB 326-349). */
function executeDayOral(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_欲情, 1000);
  addPalam(t.state, PALAM_恭順, 500);
  addPalam(t.state, PALAM_優越, 300);
  const m = 3 + (t.state.ABL[ABL_Ｍ感覚] ?? 0) * 2;
  grantExp(t.state, EXP_Ｍ経験, m);
  grantExp(t.state, EXP_口淫経験, m); // nExp:25 = nExp:4
  juelUpSpecial(t.state, false, PALAM_快Ｍ, ABL_Ｍ感覚, 20);
  juelUpSpecial(state.master.state, true, PALAM_快Ｃ, ABL_Ｃ感覚, 10);
  applyDayEventTail(state, t, DAYEVENT_ORAL);
  return scenarioEvents(state, t, DAYEVENT_ORAL, router, rng, now, `【昼事件】${角色名(t)} 为 ${master名(state)} 口交奉仕。`);
}

/** DAYEVENT_PAIZURI (ERB 350-370). nExp:26=nExp:4(=0) is faithful (upstream
 *  copy-paste — 乳交経験 gains 0). */
function executePaizuri(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_恭順, 1000);
  addPalam(t.state, PALAM_快Ｂ, 500);
  addPalam(t.state, PALAM_潤滑, 500);
  addPalam(t.state, PALAM_欲情, 300);
  const b = 3 + (t.state.ABL[ABL_Ｂ感覚] ?? 0) * 2;
  grantExp(t.state, EXP_Ｂ経験, b);
  grantExp(t.state, EXP_Ｂ絶頂経験, Math.trunc(b / 2));
  grantExp(t.state, EXP_絶頂経験, Math.trunc(b / 2));
  juelUpSpecial(t.state, false, PALAM_快Ｂ, ABL_Ｂ感覚, 20);
  juelUpSpecial(state.master.state, true, PALAM_快Ｃ, ABL_Ｃ感覚, 10);
  applyDayEventTail(state, t, DAYEVENT_PAIZURI);
  return scenarioEvents(state, t, DAYEVENT_PAIZURI, router, rng, now, `【昼事件】${角色名(t)} 用胸部为 ${master名(state)} 服侍。`);
}

/** DAYEVENT_COWGIRL (ERB 371-432). ASK_YN 407 → default (整理衣服起身);
 *  nSexCount from the SP_EVENT RESULT deferred → base once (0 extra). */
function executeCowgirl(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_潤滑, 2300);
  addPalam(t.state, PALAM_快Ｖ, 800);
  addPalam(t.state, PALAM_欲情, 700);
  addPalam(t.state, PALAM_恭順, 500);
  downBase(t.state, BASE_体力, 100);
  downBase(t.state, BASE_気力, 150);
  grantExp(t.state, EXP_絶頂経験, 2);
  grantExp(t.state, EXP_Ｖ絶頂経験, 2);
  grantExp(t.state, EXP_Ｖ経験, 6);
  // HAS_PENIS(MASTER) V-sex/creampie + master 挿入/射精 + ADD_SAMEN_V 精液量 deferred.
  juelUpSpecial(t.state, false, PALAM_快Ｖ, ABL_Ｖ感覚, 15);
  juelUpSpecial(state.master.state, true, PALAM_快Ｃ, ABL_Ｃ感覚, 10);
  applyDayEventTail(state, t, DAYEVENT_COWGIRL);
  return scenarioEvents(state, t, DAYEVENT_COWGIRL, router, rng, now, `【昼事件】${角色名(t)} 骑在 ${master名(state)} 身上索求。`);
}

/** DAYEVENT_KISS (ERB 433-444). MUTUAL_KISS → キス経験; ADD_EXP_LESNIAN defer. */
function executeDayKiss(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_好意, 3000);
  addPalam(t.state, PALAM_恥情, 1000);
  addPalam(t.state, PALAM_優越, 700);
  addPalam(t.state, PALAM_恭順, 500);
  addKissExp(t.state);
  applyDayEventTail(state, t, DAYEVENT_KISS);
  return scenarioEvents(state, t, DAYEVENT_KISS, router, rng, now, `【晨事件】${master名(state)} 与 ${角色名(t)} 相拥而吻。`);
}

/** DAYEVENT_WAKEUP (ERB 445-452). */
function executeDayWakeup(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_好意, 1000);
  addPalam(t.state, PALAM_優越, 1300);
  addPalam(t.state, PALAM_恭順, 700);
  applyDayEventTail(state, t, DAYEVENT_WAKEUP);
  return scenarioEvents(state, t, DAYEVENT_WAKEUP, router, rng, now, `【晨事件】${角色名(t)} 唤醒了熟睡的 ${master名(state)}。`);
}

/** DAYEVENT_COSLEEPING (ERB 453-460). */
function executeCosleeping(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_好意, 4000);
  addPalam(t.state, PALAM_恥情, 2000);
  addPalam(t.state, PALAM_恭順, 1400);
  applyDayEventTail(state, t, DAYEVENT_COSLEEPING);
  return scenarioEvents(state, t, DAYEVENT_COSLEEPING, router, rng, now, `【晨事件】${角色名(t)} 睡在 ${master名(state)} 身旁醒来。`);
}

/** DAYEVENT_PRANK (ERB 469-477). TALENT:機嫌=1 mood talent deferred. */
function executeDayPrank(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  addPalam(t.state, PALAM_好意, 1700);
  addPalam(t.state, PALAM_恥情, 1500);
  addPalam(t.state, PALAM_優越, 3000);
  applyDayEventTail(state, t, DAYEVENT_PRANK);
  return scenarioEvents(state, t, DAYEVENT_PRANK, router, rng, now, `【晨事件】${角色名(t)} 对 ${master名(state)} 恶作剧。`);
}

function yobaiSemenAmount(rng: Rng, vaginalAbl: number, energy: number, count: number): number {
  const each = Math.max((vaginalAbl + 1) * 20 + Math.trunc(energy / 25), 1);
  let amount = 0;
  for (let i = 1; i < count; i += 1) amount += each + rng.int(each);
  return Math.min(amount, Math.max(0, energy));
}

/** NIGHTEVENT_YOBAI (ERB 483-600), including all three anatomy branches,
 * semen/stain settlement, same-sex EXP, and QOL_STAYOVER. */
function executeNightYobai(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  const n = Math.max(
    Math.min(Math.trunc((t.state.ABL[ABL_欲望] ?? 0) / 2), 5)
      + Math.trunc((t.state.CFLAG[CFLAG_溜まってる度] ?? 0) / 200),
    1,
  );
  if (hasVagina(t) && !hasVagina(state.master) && hasPenis(state.master)) {
    grantExp(t.state, EXP_絶頂経験, 2 * n);
    grantExp(t.state, EXP_Ｖ絶頂経験, 2 * n);
    grantExp(t.state, EXP_Ｖ経験, 2 * n);
    grantExp(t.state, EXP_ID.Ｖ性交経験, n);
    grantExp(t.state, EXP_ID.膣射経験, n);
    grantExp(state.master.state, EXP_ID.挿入経験, n);
    grantExp(state.master.state, EXP_ID.射精経験, n);
    grantExp(state.master.state, EXP_絶頂経験, n);
    const amount = yobaiSemenAmount(rng, t.state.ABL[ABL_ID.膣] ?? 0, state.master.state.BASE[BASE_ID.精力] ?? 0, n);
    depositEjaculate(state, { sender: 0, receiver: t.charaNum, site: 1, amount });
    stainSwapInsertV(t, state.master);
    setStainBit(t, STAIN_PART.Ｖ, STAIN_BIT.精液);
    setStainBit(t, STAIN_PART.膣内, STAIN_BIT.精液);
    juelUpSpecial(t.state, false, PALAM_快Ｖ, ABL_Ｖ感覚, 15);
    juelUpSpecial(state.master.state, true, PALAM_快Ｃ, ABL_Ｃ感覚, 10);
    state.master.state.BASE[BASE_ID.勃起] = 0;
  } else if (hasPenis(t) && hasVagina(state.master)) {
    grantExp(t.state, EXP_絶頂経験, 2 * n);
    grantExp(t.state, EXP_ID.挿入経験, 2 * n);
    grantExp(t.state, EXP_ID.射精経験, 2 * n);
    grantExp(state.master.state, EXP_Ｖ経験, n);
    grantExp(state.master.state, EXP_Ｖ絶頂経験, n);
    grantExp(state.master.state, EXP_ID.Ｖ性交経験, n);
    grantExp(state.master.state, EXP_ID.膣射経験, n);
    grantExp(state.master.state, EXP_絶頂経験, n);
    const energy = t.state.BASE[BASE_ID.精力] ?? 0;
    const amount = yobaiSemenAmount(rng, state.master.state.ABL[ABL_ID.膣] ?? 0, energy, n);
    depositEjaculate(state, { sender: t.charaNum, receiver: 0, site: 1, amount });
    t.state.BASE[BASE_ID.精力] = Math.max(0, energy - amount);
    stainSwapInsertV(state.master, t);
    setStainBit(state.master, STAIN_PART.Ｖ, STAIN_BIT.精液);
    setStainBit(state.master, STAIN_PART.膣内, STAIN_BIT.精液);
    setStainBit(t, STAIN_PART.Ｐ, STAIN_BIT.愛液);
    setStainBit(t, STAIN_PART.Ｐ, STAIN_BIT.精液);
    juelUpSpecial(state.master.state, true, PALAM_快Ｖ, ABL_Ｖ感覚, 15);
    juelUpSpecial(t.state, false, PALAM_快Ｃ, ABL_Ｃ感覚, 10);
    t.state.BASE[BASE_ID.勃起] = 0;
  } else {
    grantExp(t.state, EXP_絶頂経験, 2 * n);
    grantExp(t.state, EXP_Ｃ絶頂経験, 2 * n);
    grantExp(t.state, EXP_Ｃ経験, 2 * n);
    grantExp(state.master.state, EXP_絶頂経験, n);
    grantExp(state.master.state, EXP_Ｃ絶頂経験, n);
    grantExp(state.master.state, EXP_Ｃ経験, n);
    if (hasPenis(state.master)) grantExp(state.master.state, EXP_ID.射精経験, n);
    if (hasPenis(t)) grantExp(t.state, EXP_ID.射精経験, n);
    mutualKiss(state, t, n);
    juelUpSpecial(t.state, false, PALAM_快Ｃ, ABL_Ｃ感覚, 15);
    juelUpSpecial(state.master.state, true, PALAM_快Ｃ, ABL_Ｃ感覚, 15);
  }
  // common (ERB 568-577).
  juelUpSpecial(t.state, false, PALAM_欲情, ABL_欲望, 20);
  downBase(state.master.state, BASE_体力, 100);
  downBase(state.master.state, BASE_気力, 150);
  downBase(t.state, BASE_体力, 100);
  downBase(t.state, BASE_気力, 150);
  t.state.CFLAG[CFLAG_溜まってる度] = 0;
  addSameSexExp(state, t, 5);
  const stayed = applyTemporaryStayover(state, t.charaNum, true, true);
  applyDayEventTail(state, t, NIGHTEVENT_YOBAI);
  return scenarioEvents(state, t, NIGHTEVENT_YOBAI, router, rng, now,
    stayed
      ? `【夜事件】${角色名(t)} 夜爬到了 ${master名(state)} 的床上，并决定留下过夜。`
      : `【夜事件】${角色名(t)} 夜爬到了 ${master名(state)} 的床上，之后决定离开。`);
}

/** NIGHTEVENT_DRINK (ERB 601-604). RECOVER 酒気 +500 on both. */
function executeNightDrink(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  recoverBase(t, BASE_酒気, 500);
  recoverBase(state.master, BASE_酒気, 500);
  applyDayEventTail(state, t, NIGHTEVENT_DRINK);
  return scenarioEvents(state, t, NIGHTEVENT_DRINK, router, rng, now, `【夜事件】${master名(state)} 与 ${角色名(t)} 对酌到深夜。`);
}

/** NIGHTEVENT_MOONVIEWING (ERB 605-606). Pure kojo. */
function executeNightMoonviewing(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  applyDayEventTail(state, t, NIGHTEVENT_MOONVIEWING);
  return scenarioEvents(state, t, NIGHTEVENT_MOONVIEWING, router, rng, now, `【夜事件】${master名(state)} 与 ${角色名(t)} 一同赏月。`);
}

/** NIGHTEVENT_SLEEPOVER (ERB 607-612), including QOL_STAYOVER. */
function executeNightSleepover(state: GameState, t: CharaSlot, router: DialogueRouter | undefined, rng: Rng, now: () => number): ObservationEvent[] {
  const stayed = applyTemporaryStayover(state, t.charaNum, false, true);
  applyDayEventTail(state, t, NIGHTEVENT_SLEEPOVER);
  return scenarioEvents(state, t, NIGHTEVENT_SLEEPOVER, router, rng, now,
    stayed
      ? `【夜事件】${角色名(t)} 在 ${master名(state)} 身边留宿。`
      : `【夜事件】${角色名(t)} 本想留下，不久后却又躲开离去了。`);
}

/** Top-level entry. Unknown scenario IDs fail closed without effects. */
export function executeDayEvent(
  state: GameState,
  selection: DayEventSelection,
  router: DialogueRouter | undefined,
  rng: Rng,
  now: () => number,
): ObservationEvent[] {
  const t = state.charas[selection.target];
  if (!t) return [];
  // ERB 318-319: swap TARGET = DAYEVENT_TARGET (the executor runs as
  // TARGET=dayevent-target so PALAM/BASE writes target the right slot).
  // The modern runtime uses `t = state.charas[target]` directly; no
  // global swap needed.
  switch (selection.scenario) {
    case DAYEVENT_ORAL:
      return executeDayOral(state, t, router, rng, now);
    case DAYEVENT_PAIZURI:
      return executePaizuri(state, t, router, rng, now);
    case DAYEVENT_COWGIRL:
      return executeCowgirl(state, t, router, rng, now);
    case DAYEVENT_KISS:
      return executeDayKiss(state, t, router, rng, now);
    case DAYEVENT_WAKEUP:
      return executeDayWakeup(state, t, router, rng, now);
    case DAYEVENT_COSLEEPING:
      return executeCosleeping(state, t, router, rng, now);
    case DAYEVENT_STARE:
      return executeDayStare(state, t, router, rng, now);
    case DAYEVENT_PRANK:
      return executeDayPrank(state, t, router, rng, now);
    case NIGHTEVENT_KISS:
      return executeNightKiss(state, t, router, rng, now);
    case NIGHTEVENT_YOBAI:
      return executeNightYobai(state, t, router, rng, now);
    case NIGHTEVENT_DRINK:
      return executeNightDrink(state, t, router, rng, now);
    case NIGHTEVENT_MOONVIEWING:
      return executeNightMoonviewing(state, t, router, rng, now);
    case NIGHTEVENT_SLEEPOVER:
      return executeNightSleepover(state, t, router, rng, now);
    default:
      // Unsupported authored scenarios fail closed: no kojo, narration, or
      // settlement is committed for an ID the deterministic router cannot
      // prove it understands.
      return [];
  }
}

// Exposed for the next slice / DEBUG-BOARD documentation.
export { PALAM_好意, PALAM_恭順, PALAM_欲情, PALAM_恥情, PALAM_優越 };
export {
  ABL_親密, ABL_従順, ABL_欲望, ABL_技巧, ABL_奉仕精神,
  ABL_Ｍ感覚, ABL_Ｂ感覚, ABL_胸,
};
export { CFLAG_溜まってる度, CFLAG_衰弱, CFLAG_初期位置, CFLAG_現在位置 };

// Touched-only stubs so unused-export linters don't flag the helpers.
void addPalam;
void addKissExp;
