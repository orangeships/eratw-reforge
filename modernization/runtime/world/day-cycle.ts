/**
 * DAY-CYCLE-PLAN §S1 — the morning-phase table.
 *
 * Historically the wake-morning subsystems (DAYEVENT-day / 来訪フラグ /
 * 遭遇判定 / 依頼刷新 / おはよう) were hand-inlined into
 * `finishPlayerSleep`'s function body, each with its own ad-hoc
 * `if (router && rng)` / `if (rng)` guard, and the order lived only in
 * the code's write order — with no test guarding it. This module makes
 * that order **data**: `MORNING_PHASES` is the single ordered list, each
 * phase carrying its upstream `BEFORETRAIN.ERB` anchor and a uniform
 * `needs` gate that replaces the three ad-hoc guard styles.
 *
 * S1 landed this as a pure move (zero behavior change): the phase order,
 * per-phase guards, and emitted-event order matched the pre-S1
 * `finishPlayerSleep`.
 *
 * **S2 additions (declared behavior changes):** `runMorning` gained a
 * pipeline-level same-day idempotency guard (`state.morningRanDay`), and
 * this module now owns `openEyes` — the single runtime entry for
 * `[100] 睁开眼睛` that the web store's `openEyesAction` delegates to. See
 * `runMorning` / `openEyes` docs below and DAY-CYCLE-PLAN §S2.
 *
 * **Scope split (DAY-CYCLE-PLAN §3.1):** the sleep-settlement segments
 * (daily-report diff, `advanceClock`, `reprojectSchedules`, DAYEVENT
 * *night*, wake recovery, `SleepSoundly`, NPC recovery, CFLAG/FLAG sets)
 * are NOT morning phases — they carry shared locals (`oldTick`,
 * `sleepMinutes`, `recovery`) and stay inline in `finishPlayerSleep`.
 * Only the post-wake subsystems, which each take just `(state, deps)`,
 * live here.
 *
 * **Module direction:** `sleep.ts` → `day-cycle.ts` (imports `runMorning`
 * + `stubRng`). `day-cycle.ts` imports dayevent/visit-flags/encounter/
 * commission/location-predicates + `clock` (`pinClockToMinute`) +
 * `game-state` (`snapshotCharaStates`) — none of which import `day-cycle`
 * or `sleep`, so there is no cycle.
 */

import type { GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { Rng } from "../command/rng.js";
import { CFLAG_ID, setMasterCflag, TALENT_ID } from "../state/settlement.js";
import { TFLAG_ID, getTflag, setTflag } from "../state/tflag.js";
import { snapshotCharaStates } from "../state/game-state.js";
import { mapKeyOf, chkDateNow } from "./location-predicates.js";
import { setSlotLocation } from "./room-id-location.js";
import { pinClockToMinute } from "./clock.js";
import { endDate } from "./date-session.js";
import { leaveOdekake } from "./odekake.js";
import { runOutingReturnEvents } from "./outing-events.js";
import { generateMorningDateIntentions } from "./date-appointments.js";
import { selectDayEvent, executeDayEvent } from "./dayevent.js";
import { computeVisitFlags } from "./visit-flags.js";
import { runEncounterMorning } from "./encounter.js";
import { runCommissionMorning, type CommissionGenerationHooks } from "../state/commission.js";
import { runPersonalHistoryReconciliation } from "../state/chara-info-state.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import { ensureWorkRuntime } from "./work/work-system.js";
import { projectScheduledLocations } from "./scheduler.js";
import { replenishPantyGap } from "../state/panty-collection.js";

/** Injected dependencies for the day-cycle phases. A phase whose `needs`
 *  aren't satisfied is skipped (silent) — the faithful equivalent of the
 *  old `if (router && rng)` guards. */
export interface DayCycleDeps {
  now: () => number;
  /** No router → kojo-emitting phases (DAYEVENT, おはよう) are skipped. */
  router?: DialogueRouter;
  /** No rng → random phases (DAYEVENT, 来訪/遭遇/依頼) are skipped. */
  rng?: Rng;
}

/** One morning-flow subsystem. `upstream` is the BEFORETRAIN.ERB anchor
 *  (required — new subsystems find their insertion slot against it). */
export interface MorningPhase {
  id: string;
  upstream: string;
  needs: ReadonlyArray<"router" | "rng">;
  run(state: GameState, deps: DayCycleDeps): ObservationEvent[];
}

/** Tiny stub RNG. Moved here from sleep.ts (also re-imported there for the
 *  SleepSoundly path). Only used when a caller didn't pass a real rng;
 *  arm-2 おはよう bodies are typically empty for a clean chara so the value
 *  rarely matters. */
export function stubRng(): Rng {
  return { next: () => 0.5, int: () => 0, pick: <T>(a: readonly T[]) => a[0]! };
}

/** Resolve a single EVENT-arm greeting for a target through the router →
 *  DIALOGUE_LINE[]. Moved verbatim from sleep.ts (only the おはよう phase
 *  used it). The `charaNum` on each line is the `target`. */
function greetingLinesFromRouter(
  router: DialogueRouter,
  state: GameState,
  rng: Rng,
  target: number,
  arm: number,
  args: number[],
  now: () => number,
): ObservationEvent[] {
  if (target <= 0) return [];
  const lines = resolveEventKojoAndApply(router, state, target, arm, rng, args);
  return lines.map((l) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: now(),
    charaNum: target,
    text: l.text,
    form: l.form,
  }));
}

/**
 * The morning subsystems in faithful `BEFORETRAIN.ERB` order. **Order is
 * the contract** — `day-cycle.test.ts` pins `MORNING_PHASES.map(p => p.id)`.
 *
 * Order follows `BEFORETRAIN.ERB`: visitor flags and encounter/commission
 * refresh happen before `@GOODMORNING`, whose first substantive call is
 * `DAYEVENT_MAIN("day")`. This matters because a DAYEVENT is allowed to read
 * the morning's freshly selected visitors, encounter target and requests.
 */
export const MORNING_PHASES: readonly MorningPhase[] = [
  {
    id: "panty-gap-replenish",
    upstream: "BEFORETRAIN.ERB:443-456 收藏隙間日次補充",
    needs: [],
    run(state, deps) {
      const refill = replenishPantyGap(state);
      if (refill.amount <= 0) return [];
      return [{
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `☆多多的补充了收藏隙间（现在：${refill.total}个）`,
      }];
    },
  },
  {
    id: "work-setup",
    upstream: "BEFORETRAIN.ERB:242 BASE:工作量 = MAXBASE:工作量; JOB_仕事内容.ERB",
    needs: [],
    run(state, deps) {
      ensureWorkRuntime(state, deps.rng);
      return [];
    },
  },
  {
    id: "estrus-cycle",
    upstream: "BEFORETRAIN.ERB:135-157 乙女の身体周期の進行",
    needs: [],
    run(state, deps) {
      const charaNums = [0, ...Object.keys(state.charas).map(Number)]
        .sort((a, b) => a - b);
      for (const num of charaNums) {
        const slot = num === 0 ? state.master : state.charas[num];
        if (!slot) continue;
        const st = slot.state;
        // 无女性器官(性別 bit0=0) 或 幼女未初潮 → 周期清零不推进
        // (BEFORETRAIN.ERB:144-147)。
        const hasVagina = ((st.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
        const infant =
          (st.TALENT[TALENT_ID["幼児／幼児退行"]] ?? 0) !== 0 ||
          (st.TALENT[TALENT_ID.幼稚] ?? 0) !== 0;
        if (!hasVagina || (infant && (st.TALENT[TALENT_ID.初潮] ?? 0) === 0)) {
          st.CFLAG[CFLAG_ID.生理周期] = 0;
          continue;
        }
        // 周期未设定/越界 → 首设 RAND:10 (BEFORETRAIN:150-151)。无 rng 时
        // 确定性兜底 1（与上游 RAND 语义只差在取值，周期仍会逐日推进）。
        if ((st.CFLAG[CFLAG_ID.生理周期] ?? 0) === 0 || (st.CFLAG[CFLAG_ID.生理周期] ?? 0) > 11) {
          st.CFLAG[CFLAG_ID.生理周期] = deps.rng ? deps.rng.int(10) : 1;
        }
        st.CFLAG[CFLAG_ID.生理周期] = (st.CFLAG[CFLAG_ID.生理周期] ?? 0) + 1;
        if ((st.CFLAG[CFLAG_ID.生理周期] ?? 0) > 10) {
          st.CFLAG[CFLAG_ID.生理周期] = (st.CFLAG[CFLAG_ID.生理周期] ?? 0) % 10;
        }
        // 上游 TALENT:妊娠 += 1 (BEFORETRAIN:157) 跳过：妊娠系统未建模，恒 0。
      }
      return [];
    },
  },
  {
    id: "date-intentions",
    upstream: "BEFORETRAIN.ERB morning extension; JOB_仕事開始終了処理.ERB EVENT 27",
    needs: ["rng"],
    run(state, deps) {
      generateMorningDateIntentions(state, deps.rng!);
      return [];
    },
  },
  {
    id: "visit-flags",
    upstream: "BEFORETRAIN.ERB:157 CALL 来訪フラグ",
    needs: ["rng"],
    run(state, deps) {
      const visit = computeVisitFlags(state, deps.rng!);
      // `IF 来訪者数>0 && AT_HOME(MASTER)` — the master wakes at base so
      // AT_HOME holds; emit the heads-up overview narration.
      if (!visit.anyVisitor) return [];
      return [
        {
          kind: "NARRATION",
          timestamp: deps.now(),
          text: `${mapKeyOf(state.master.location)}好像有来访者的样子。`,
        },
      ];
    },
  },
  {
    id: "encounter",
    upstream: "BEFORETRAIN.ERB:160 CALL 遭遇判定",
    needs: ["rng"],
    run(state, deps) {
      return runEncounterMorning(state, deps.rng!, deps.now);
    },
  },
  {
    id: "commission",
    upstream: "BEFORETRAIN.ERB:418-420 IRAI_HAPPEN / IRAI_VANISH",
    needs: ["rng"],
    run(state, deps) {
      const hooks: CommissionGenerationHooks = deps.router?.resolveIraiBlocked
        ? {
            isIraiBlocked(clientId, localId, currentState, _rng) {
              const resolved = deps.router!.resolveIraiBlocked!(
                clientId,
                localId,
                currentState,
                deps.rng!,
              );
              return (
                resolved.status === "unsupported" ||
                resolved.status === "partial" ||
                resolved.unsupportedPredicates.length > 0 ||
                resolved.unsupportedEffects.length > 0 ||
                resolved.returnValue !== 0
              );
            },
          }
        : {};
      return runCommissionMorning(state, deps.rng!, deps.now, hooks);
    },
  },
  {
    id: "dayevent-day",
    upstream: 'BEFORETRAIN.ERB:585 DAYEVENT_MAIN("day")',
    needs: ["router", "rng"],
    run(state, deps) {
      const sel = selectDayEvent(state, "day", deps.rng!, deps.router);
      return sel ? executeDayEvent(state, sel, deps.router!, deps.rng!, deps.now) : [];
    },
  },
  {
    id: "ohayo",
    upstream: "BEFORETRAIN.ERB:647-653 KOJO EVENT 2 おはよう (per present awake target)",
    needs: ["router"],
    run(state, deps) {
      const router = deps.router!;
      const here = state.master.location;
      const out: ObservationEvent[] = [];
      const masterInitial = state.master.state.CFLAG[CFLAG_ID.初期位置];
      for (const slot of Object.values(state.charas)) {
        if (slot.location !== here) continue;
        const targetInitial = slot.state.CFLAG[CFLAG_ID.初期位置];
        const cohabiting = Number.isFinite(masterInitial) &&
          Number.isFinite(targetInitial) && masterInitial === targetInitial;
        const sleeping = !!slot.state.CFLAG[CFLAG_ID.睡眠];
        const status = sleeping ? (cohabiting ? 3 : 0) : (cohabiting ? 2 : 1);
        if (status === 0) continue;

        // Upstream GOODMORNING supplies the wake location separately: 1 when
        // the target wakes in the master's room, 0 when the master is in the
        // target's room, and -1 for an inconsistent/off-site state.  The
        // latter is deliberately suppressed instead of inventing a greeting.
        const wakePlace: -1 | 0 | 1 = masterInitial === state.master.state.CFLAG[CFLAG_ID.現在位置]
          ? 1
          : targetInitial === state.master.state.CFLAG[CFLAG_ID.現在位置]
            ? 0
            : (masterInitial === undefined || targetInitial === undefined ? 1 : -1);
        if (wakePlace === -1) continue;
        out.push(
          ...greetingLinesFromRouter(
            router,
            state,
            deps.rng ?? stubRng(),
            slot.charaNum,
            2, // arm 2 おはよう
            [status, wakePlace],
            deps.now,
          ),
        );
      }
      return out;
    },
  },
];

/** True when every dependency the phase declares is present. */
function phaseReady(phase: MorningPhase, deps: DayCycleDeps): boolean {
  return phase.needs.every((n) => (n === "router" ? !!deps.router : !!deps.rng));
}

/**
 * Run the morning subsystems in `MORNING_PHASES` order, concatenating
 * their events. A phase whose `needs` aren't satisfied is skipped.
 *
 * **Pipeline-level same-day idempotency (S2):** if `state.morningRanDay`
 * already equals today's `dayIndex`, the whole pipeline is a no-op — both
 * `finishPlayerSleep` (sleep-wake) and `openEyes` (`[100] 睁开眼睛`) funnel
 * through here, and the morning must run at most once per day. The
 * per-subsystem guards (`commissions.lastMorningDay`, `encounterMorningDay`)
 * stay as double-insurance. The mark is set BEFORE running the phases so a
 * throwing phase can't leave the day half-run and re-runnable.
 */
export function runMorning(state: GameState, deps: DayCycleDeps): ObservationEvent[] {
  if (state.morningRanDay === state.time.dayIndex) return [];
  state.morningRanDay = state.time.dayIndex;
  // GOODMORNING starts with SET_TOGETHER(0) for the whole roster. Without
  // this reset an imported or interrupted co-sleep flag survives wake-up,
  // keeping the movement lock and sleep-only command visible after waking.
  setMasterCflag(state, CFLAG_ID.陪睡中, 0);
  for (const slot of Object.values(state.charas)) {
    slot.state.CFLAG[CFLAG_ID.陪睡中] = 0;
  }
  const events: ObservationEvent[] = [];
  for (const phase of MORNING_PHASES) {
    if (!phaseReady(phase, deps)) continue;
    events.push(...phase.run(state, deps));
  }
  // Personal History 对账（DAY-CYCLE-PLAN §P9 / QoL_DetailedInfo）— not a
  // router/rng-gated MORNING_PHASE: it takes no deps and emits no events, it
  // just stamps `charasInfo[chara][cat] = 今日` the first morning each milestone's
  // lock validator holds (初次见面/思慕/恋慕/习得… — see personal-history.ts).
  // Upstream writes these timestamps scattered across commands + EVENTCOMEND at
  // the exact event day; the modern reconciliation records "first morning the
  // condition holds" instead (≤1-day lag, first-write-wins so monotonic). Runs
  // once per day via the same-day idempotency guard above.
  runPersonalHistoryReconciliation(state);
  // Upstream GOODMORNING invokes CHARA_MOVEMENT after personal morning lines.
  // Re-project at the same tick so stale imported occupants leave the room
  // and awake NPCs begin the day at their deterministic work/home location.
  projectScheduledLocations(state);
  return events;
}

/**
 * DAY-CYCLE-PLAN §S2 — the runtime entry for `[100] 睁开眼睛` (open your
 * eyes / start the day from the 起床前 morning menu). Replaces the web
 * store's hand-written `openEyesAction` body: it pins the clock forward,
 * wakes the master in their 私室, then runs the shared morning pipeline.
 *
 * Behavior changes from the old store body (all declared in §S2):
 *  - **Clock never rewinds** — `pinClockToMinute` is monotonic, so a
 *    new-game state seeded at 08:00 with a 07:00 wake minute stays at 08:00
 *    instead of rewinding (§3.2).
 *  - **Time advance fires weather / day-end hooks** — going through
 *    `advanceClock` (via `pinClockToMinute`) instead of a raw `time =` write.
 *  - **Day-0 first morning rolls 来訪フラグ** — the openEyes path now runs
 *    `runMorning`, whose `visit-flags` phase rolls visitors (P3 fix).
 *
 * **Called WITHOUT a router on the openEyes path** (the store passes only
 * `rng`): the DAYEVENT-day / おはよう phases (`needs: ["router"]`) stay
 * skipped, so those greetings remain a sleep-wake-path concern
 * (`finishPlayerSleep`) — new-game first morning still has no DAYEVENT/
 * おはよう, recorded as deferred in the plan. With `rng`, the visit-flags /
 * encounter / commission phases run.
 *
 * Mutates `state` in place; returns the events for the caller to append.
 */
export function openEyes(state: GameState, deps: DayCycleDeps): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  // Pin forward to the master's configured wake minute (`TIME:3`; new-game
  // seed 420 = 07:00). Monotonic — a no-op when the clock already sits later.
  const wake = (((Math.trunc(state.masterWakeMinute ?? 420) % 1440) + 1440) % 1440);
  const clock = pinClockToMinute(state, wake, deps.now);
  // Match finishPlayerSleep: surface only NARRATION from the clock advance
  // (drop TIME_TICK); the weather/day-end STATE effects already mutated state.
  events.push(...clock.events.filter((e) => e.kind === "NARRATION"));
  // Master wakes in the chosen 私室 (covers a 搬家 done from the morning menu).
  const wakeLocation = state.homeLocation ?? state.master.location;
  setSlotLocation(state.master, wakeLocation);
  state.sleepSession = null;
  setMasterCflag(state, CFLAG_ID.睡眠, 0);
  // Waking up ends any date that was still "active" — you're back at your base,
  // not out on an outing. Without this a date interrupted by sleep leaves
  // `CFLAG:约会中` + `FLAG:约会道中` stuck set, so date-only commands (603 手を繋ぐ,
  // 626) keep showing in the everyday menu (`chkDateNow` / the mid-stroll gate
  // stay true forever). leaveOdekake also sends any date-partner home.
  const ordinaryOuting = state.outing != null && state.dateSession == null;
  if (ordinaryOuting && deps.rng) {
    // COM405 outings have no date mirrors. Run the return channel while the
    // outing context is still present, then apply its cloned state in place.
    // The morning ritual has no UI to surface an interactive-event choice
    // prompt, so we synthesize an "accept" choice to keep the time-advance
    // and authored aftermath path deterministic. The web store handles the
    // explicit pause-and-resolve flow separately via `outingEventSession`.
    const returned = runOutingReturnEvents(state, deps.rng, { eventId: 2, value: "accept" });
    Object.assign(state, returned.state);
    events.push(...returned.events);
  }
  if (state.dateSession) {
    endDate(state, { returnHome: true });
  } else if (chkDateNow(state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) || getTflag(state, TFLAG_ID.约会道中) !== 0) {
    leaveOdekake(state, state.homeLocation ?? state.master.location);
  }
  if (ordinaryOuting && state.outing) {
    leaveOdekake(state, state.homeLocation ?? state.master.location);
  }
  // NEMUKE() authority: anchor the last-wake stamp to this wake tick so the
  // 402 就寝 / 417 昼寝 sleepiness gates read correctly on the [100] 睁开眼睛 path
  // too (finishPlayerSleep already does this on the sleep-through path).
  setTflag(state, TFLAG_ID.あなた起床, state.time.tickValue);
  // Shared morning pipeline (same-day idempotent).
  events.push(...runMorning(state, deps));
  // Re-baseline the night-settlement diff for the new day.
  state.daySnapshot = snapshotCharaStates(state.charas);
  state.daySettlementReport = [];
  // Player-facing narration uses the custom name (opening wizard →
  // `state.master.callName`), not a hardcoded "主人公". This event is emitted
  // on the store path (openEyesAction), which does NOT pass through the
  // applyIntent `%CALLNAME%` boundary, so resolve the name here directly.
  const masterName = state.master.callName ?? "主人公";
  events.push({
    kind: "NARRATION",
    timestamp: deps.now(),
    text: `${masterName}睁开眼睛，新的一天开始了。`,
  });
  return events;
}
