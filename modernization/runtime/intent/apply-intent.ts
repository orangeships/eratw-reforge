/**
 * Phase 4 — `applyIntent` stub.
 *
 * Pure TS function: `(state, intent) -> newState`. The new state
 * always has the previous `eventLog` plus one or more new entries
 * describing what the intent would have done. No real settlement —
 * Phase 5+ `CommandResolver` and Phase 6 `DialogueRouter` will
 * replace the per-intent bodies.
 *
 * Pipeline (every intent):
 *   1. Run `validateIntent` (Phase 2.6). On `ok: false`, append a
 *      `STATUS_MESSAGE` with `source: "validator"` and return.
 *   2. Switch on `intent.kind`. Each branch appends an event
 *      describing what would have happened and returns.
 *
 * Why pure TS (not a Tauri command):
 *   Phase 5+ settlement is in TS per the audit. Going through IPC
 *   for a pure function would be a needless round-trip and would
 *   force us to mirror `GameState`/`AgentIntent` in Rust. The
 *   Tauri commands are reserved for the I/O that genuinely needs
 *   them: `load_state` / `save_state` (Phase 4B) and
 *   `get_initial_state` (manifest merge).
 *
 * JSON-safety:
 *   `GameState` is JSON-safe by construction (Phase 3.1). The
 *   returned state is a new object reference; input is not
 *   mutated.
 */

import { validateIntent, type ValidationResult } from "../../schemas/validator.js";
import type {
  AgentIntent,
  DialogueLine,
  Narration,
  ObservationEvent,
  StatusMessage,
} from "../../schemas/types.js";
import type { GameState } from "../state/index.js";
import { moveTargetFor, mockActionFor } from "./mock-commands.js";
import {
  CommandCatalog,
  resolveCommand,
  createRng,
  availableCommands,
  type CommandAvailabilityMode,
  type CommandAvailability,
  type ResolverDeps,
  type Outcome,
  type FailReason,
} from "../command/index.js";
import { registerDailyHandlers } from "../command/handlers/index.js";
import type { DialogueRouter } from "../kojo/types.js";
import { substituteKojoCallNames } from "../kojo/text-renderer.js";
import { clearTurnContext } from "../state/tflag.js";
import { recordCommandSignal, recordDialogueSignal } from "../agent/recorder.js";
import {
  detectDomainTransitions,
  hasCommandCompletedTransition,
  mergeDomainTransitions,
  type DomainTransition,
} from "../state/domain-transition.js";
import {
  NOOP_TRAIN_MESSAGE_ROUTER,
  type TrainMessageRouter,
} from "../command/train-message.js";
import { runSchedulerTick } from "../world/scheduler.js";
import {
  registerScheduleOverride,
  registerDialogueCandidate,
} from "../world/schedule-provider.js";
import { MS_PER_TICK } from "../world/clock.js";
import { finalizeElapsedAction } from "./finalize-elapsed-action.js";

/** Monotonic timestamp source. Injected so tests can pin the value. */
export type Now = () => number;

const defaultNow: Now = () => Date.now();

/**
 * Phase 5F — the live command catalog. Built once at module load;
 * holds the real ported handlers (移動/就寝/仕事/会話/頭撫). Phase
 * 6.4 promotes it to a module-level variable so `configureIntent`
 * (called at app boot) can wire in a `DialogueRouter` and the
 * per-call `applyIntent` resolver can pick it up.
 */
let liveCatalog: CommandCatalog = (() => {
  const c = new CommandCatalog();
  registerDailyHandlers(c);
  return c;
})();

/** Module-level router. Defaults to a no-op router (collects [])
 *  so unit tests that don't care about kojo still work. The app
 *  entry replaces it via `configureIntent` (browser: a bundle-backed
 *  router; Node runtime: `KojoCache`, see `runtime/kojo/node-index.ts`). */
let liveRouter: DialogueRouter = {
  collect() { return []; },
  resolveEventKojo() { return []; },
  resolveSpEventKojo() { return []; },
};

let liveTrainMessageRouter: TrainMessageRouter = NOOP_TRAIN_MESSAGE_ROUTER;

/** Module-level `charaNum → callName` map, used to resolve the
 *  `%CALLNAME:TARGET%` / `%CALLNAME:N%` tokens that handler-emitted
 *  NARRATION/STATUS text still carries (kojo DIALOGUE_LINE text is
 *  already substituted upstream by the router). Wired at boot from
 *  `charas.bundle.json`; empty by default. */
let liveCallNames: Record<number, string> = {};

/** Master/player callName for `%CALLNAME:MASTER%`. */
let liveMasterName = "玩家";

export interface IntentDeps {
  catalog?: CommandCatalog;
  dialogueRouter?: DialogueRouter;
  trainMessageRouter?: TrainMessageRouter;
  /** `charaNum → callName` for event-text `%CALLNAME%` resolution. */
  callNames?: Record<number, string>;
  /** Override the player callName (default "玩家"). */
  masterName?: string;
}

/** Wire the live runtime deps. Idempotent: calling twice replaces
 *  whatever fields are passed. Use this at app boot to inject the real
 *  router + the chara callName map. Tests can call it with stubs. */
export function configureIntent(deps: IntentDeps): void {
  if (deps.catalog) liveCatalog = deps.catalog;
  if (deps.dialogueRouter) liveRouter = deps.dialogueRouter;
  if (deps.trainMessageRouter) liveTrainMessageRouter = deps.trainMessageRouter;
  if (deps.callNames) liveCallNames = deps.callNames;
  if (deps.masterName) liveMasterName = deps.masterName;
}

/** Read-only access for tests / debug. */
export function currentIntentDeps(): {
  catalog: CommandCatalog;
  router: DialogueRouter;
  trainMessageRouter: TrainMessageRouter;
  callNames: Record<number, string>;
} {
  return {
    catalog: liveCatalog,
    router: liveRouter,
    trainMessageRouter: liveTrainMessageRouter,
    callNames: liveCallNames,
  };
}

/**
 * Phase 8 (Slice 6) — the live command-menu query for the UI.
 *
 * Runs `availableCommands` against the *live* catalog (the same one
 * `applyIntent` settles through), so the command grid reflects exactly the
 * registered handlers and their `@COM_ABLE`/`execCheck` gates. The UI calls
 * this each render with the current state + focused target to decide which
 * commands are clickable. Pure read — never mutates state.
 */
export function liveAvailableCommands(
  state: Readonly<GameState>,
  target: number,
  mode: CommandAvailabilityMode = "normal",
): CommandAvailability[] {
  return availableCommands(liveCatalog, state, target, () => 0, mode);
}

/** Result of an applyIntent call. Mirrors the eventLog delta for callers. */
export interface ApplyIntentResult {
  state: GameState;
  /** Events appended to `state.eventLog` by this call. */
  appended: ReadonlyArray<ObservationEvent>;
  /** Validated intent (echoes the input on success, mirrors what settlement saw). */
  validation: ValidationResult;
  pendingKojoChoice?: import("../command/types.js").CommandKojoChoiceSession;
  transitions: readonly DomainTransition[];
  /** Authoritative settlement outcome for ISSUE_COMMAND. Shell integrations
   *  may observe this after the pure reducer returns; it never changes rules. */
  commandOutcome?: Outcome;
  /** Why a command was blocked/no-op. Kept out of presentation heuristics. */
  commandFailReason?: FailReason;
}

/**
 * Apply an `AgentIntent` to a `GameState`, returning a new state
 * with the resulting events appended to `eventLog`. The input
 * state is never mutated.
 *
 * Phase 4 stub: no real settlement. Each intent kind just
 * appends a `STATUS_MESSAGE` (and a `COMMAND_ISSUED` for
 * `ISSUE_COMMAND`) describing what would have happened. Phase 5+
 * replaces the per-kind branches.
 */
/**
 * Phase 6D — resolve player-visible `%CALLNAME%` tokens.
 *
 * Handler NARRATION / STATUS_MESSAGE text still carries the legacy
 * `%CALLNAME:MASTER%` / `%CALLNAME:TARGET%` / `%CALLNAME:N%` renderer
 * tokens (kojo DIALOGUE_LINE text was already substituted by the
 * router). We resolve them HERE — the one boundary every emitted event
 * passes through — so the player never sees a raw token.
 *
 * `%CALLNAME:TARGET%` resolves against the intent's target chara; the
 * 神社闭环 v2 hardcoded "灵梦" is gone — names come from the injected
 * `liveCallNames` map (`configureIntent({ callNames })`).
 */

function substituteEventText(
  text: string,
  state: Readonly<GameState>,
  targetCharaNum?: number,
): string {
  // Prefer the live per-save player name over the module default. The player
  // customizes their name in the opening wizard (`draft.callName` →
  // `state.master.callName`); `applyIntent` threads it in so command-path
  // NARRATION/STATUS shows the custom name — same state-first rule that
  // `kojo-cache.ts` / `train-message.ts` already use for dialogue text.
  const target = targetCharaNum ?? 0;
  return substituteKojoCallNames(text, {
    state,
    charaNum: target,
    nameResolver: (reference) =>
      typeof reference === "number" ? liveCallNames[reference] : undefined,
    masterName: state.master.callName ?? liveMasterName,
    targetName: targetCharaNum === undefined
      ? "对方"
      : liveCallNames[targetCharaNum] ?? state.charas[targetCharaNum]?.callName,
  });
}

/** Substitute `.text` on events that carry it; pass others through. */
function subEvent(
  e: ObservationEvent,
  state: Readonly<GameState>,
  targetCharaNum?: number,
): ObservationEvent {
  const maybe = e as { text?: unknown };
  if (typeof maybe.text === "string") {
    return {
      ...e,
      text: substituteEventText(maybe.text, state, targetCharaNum),
    } as ObservationEvent;
  }
  return e;
}

/** The chara a `%CALLNAME:TARGET%` token should resolve to for an intent. */
function intentTargetOf(intent: AgentIntent): number | undefined {
  switch (intent.kind) {
    case "ISSUE_COMMAND":
      return intent.target ?? intent.actor;
    case "PROPOSE_DIALOGUE":
    case "OVERRIDE_SCHEDULE":
      return intent.charaNum;
    default:
      return undefined;
  }
}

/**
 * Apply an `AgentIntent`, then run the appended events through
 * `subEvent` so the eventLog tail (and the `appended` mirror) is
 * token-clean. The appended events are always the tail of
 * `state.eventLog` in every core path, so we splice the cleaned copies
 * back in place.
 */
export function applyIntent(
  state: GameState,
  intent: AgentIntent,
  now: Now = defaultNow,
): ApplyIntentResult {
  const raw = applyIntentCore(state, intent, now);
  const transitions = mergeDomainTransitions(
    raw.transitions,
    detectDomainTransitions(state, raw.state),
  );
  if (raw.appended.length === 0) return { ...raw, transitions };
  const target = intentTargetOf(intent);
  const appended = raw.appended.map((e) => subEvent(e, state, target));
  const log = raw.state.eventLog;
  const head = log.slice(0, log.length - raw.appended.length);
  return {
    ...raw,
    state: { ...raw.state, eventLog: [...head, ...appended] },
    appended,
    transitions,
  };
}

function applyIntentCore(
  state: GameState,
  intent: AgentIntent,
  now: Now = defaultNow,
): ApplyIntentResult {
  const validation = validateIntent(intent);
  const ts = now();

  if (!validation.ok) {
    const msg: StatusMessage = {
      kind: "STATUS_MESSAGE",
      timestamp: ts,
      source: "validator",
      text: `intent rejected: ${validation.reason}`,
    };
    return appendAndReturn(state, [msg], validation);
  }

  switch (intent.kind) {
    case "NOOP": {
      // Phase 8.4 — NOOP is now the "world tick" carrier. The
      // Game Client's setInterval dispatches a NOOP every 1500ms
      // (matching `MS_PER_TICK`); we route it through the
      // WorldScheduler so autonomous time + 灵梦's schedule
      // actually advance. The 4.5 behaviour (ack-only STATUS_MESSAGE)
      // is gone — `intent.reason` is a debug-only field the
      // scheduler ignores.
      const schedulerResult = runSchedulerTick(state, MS_PER_TICK, now);
      if (schedulerResult.events.length === 0) {
        // Sub-tick interval (the interval ran faster than 1500ms)
        // — emit a noop acknowledgement so the eventLog still has
        // a heartbeat, otherwise the UI looks frozen.
        const msg: StatusMessage = {
          kind: "STATUS_MESSAGE",
          timestamp: ts,
          source: "apply_intent",
          text: "no-op acknowledged",
        };
        return appendAndReturn(state, [msg], validation);
      }
      return {
        state: {
          ...schedulerResult.state,
          eventLog: [...schedulerResult.state.eventLog, ...schedulerResult.events],
        },
        appended: schedulerResult.events,
        validation,
        transitions: [],
      };
    }
    case "ISSUE_COMMAND": {
      const evt: ObservationEvent = {
        kind: "COMMAND_ISSUED",
        timestamp: ts,
        actor: intent.actor,
        commandNo: intent.commandNo,
      };

      // Phase 5F — real settlement: if a handler is registered for this
      // commandNo, the resolver is the authority. Un-ported commands
      // fall through to the 4.5 mock tables below (no regression).
      if (liveCatalog.has(intent.commandNo)) {
        // Deterministic per-(command, clock) seed so replays reproduce.
        const rng = createRng(intent.commandNo * 100003 + state.time.tickValue);
        // Phase 6.4 — wire DialogueRouter into the resolver deps so
        // handlers can call `ctx.dialogueRouter.collect(target, ...)`.
        const resolverDeps: ResolverDeps = {
          catalog: liveCatalog,
          rng,
          rngSeed: intent.commandNo * 100003 + state.time.tickValue,
          now,
          dialogueRouter: liveRouter,
          trainMessageRouter: liveTrainMessageRouter,
        };
        const oldTick = state.time.tickValue;
        const result = resolveCommand(intent, state, resolverDeps);
        // Parity QA P-9 — turn-based schedule projection. A command that
        // advanced the in-game clock (TIME += N) applies each NPC's imported
        // CSV boundaries whose original branch is implemented, and emits the
        // time-of-day band narration. This replaces the autonomous
        // real-time tick: time only moves when the player acts, and the world
        // catches up on each action (faithful to the upstream model).
        const post = finalizeElapsedAction(result.state, {
          oldTick,
          commandNo: intent.commandNo,
          now,
          rng,
          dialogueRouter: liveRouter,
        });
        const postState = post.state;
        // A1 — record agent interaction signal for successful commands.
        if (result.outcome === "ok") {
          const targetNum = intent.target ?? intent.actor;
          if (targetNum > 0) {
            const label = `COM#${intent.commandNo}`;
            recordCommandSignal(postState, targetNum, intent.commandNo, label);
          }
          const dialogueEvent = result.events.find(
            (event) => event.kind === "DIALOGUE_LINE" && event.charaNum > 0,
          );
          if (dialogueEvent?.kind === "DIALOGUE_LINE") {
            recordDialogueSignal(postState, dialogueEvent.charaNum, `COM#${intent.commandNo} dialogue`);
          }
        }
        const appended = [evt, ...result.events, ...post.events];
        const transitions = mergeDomainTransitions(
          result.transitions,
          post.transitions,
        );
        if (hasCommandCompletedTransition(transitions)) clearTurnContext(postState);
        return {
          state: { ...postState, eventLog: [...postState.eventLog, ...appended] },
          appended,
          validation,
          pendingKojoChoice: result.pendingKojoChoice,
          transitions,
          commandOutcome: result.outcome,
          commandFailReason: result.failReason,
        };
      }

      // Phase 4.5B mock MOVE table (disposable; Phase 5 deletes it).
      // A move is the only ISSUE_COMMAND that changes GameState in the
      // 4.5 prototype: it sets master.location (S1) so the SceneRouter
      // re-projects. The path UI→intent→applyIntent→location survives
      // into Phase 5; only this table is thrown away.
      const moveTo = moveTargetFor(intent.commandNo);
      if (moveTo !== undefined) {
        const narration: Narration = {
          kind: "NARRATION",
          timestamp: ts,
          text: `移动到 ${moveTo}。`,
        };
        return {
          state: {
            ...state,
            master: { ...state.master, location: moveTo },
            eventLog: [...state.eventLog, evt, narration],
          },
          appended: [evt, narration],
          validation,
          transitions: [],
          commandOutcome: "ok",
        };
      }

      // Phase 4.5B mock ACTION table (disposable). Action commands
      // (COMF/SCOMF, S4) emit canned narration + one kojo line into the
      // same eventLog; the UI routes them into the interaction box.
      // No GameState mutation in the mock (master ref is preserved).
      const action = mockActionFor(intent.commandNo);
      if (action !== undefined) {
        const narration: Narration = {
          kind: "NARRATION",
          timestamp: ts,
          text: action.narration,
        };
        const line: DialogueLine = {
          kind: "DIALOGUE_LINE",
          timestamp: ts,
          charaNum: action.dialogue.charaNum,
          text: action.dialogue.text,
        };
        return {
          ...appendAndReturn(state, [evt, narration, line], validation),
          commandOutcome: "ok",
        };
      }

      // Fallback: Phase 4 behavior — generic "queued, no resolver" line.
      const status: StatusMessage = {
        kind: "STATUS_MESSAGE",
        timestamp: ts,
        source: "apply_intent",
        text: `command ${intent.commandNo} queued, no resolver yet (Phase 5)`,
      };
      return {
        ...appendAndReturn(state, [evt, status], validation),
        commandOutcome: "noop",
        commandFailReason: { kind: "unknown_command", commandNo: intent.commandNo },
      };
    }
    case "PROPOSE_DIALOGUE": {
      // Agent dialogue candidate — registered (sideband only, NEVER
      // auto-applied; see schemas/types.ts DialogueCandidate). A future side
      // UI / the DialogueRouter may surface it as a hint. The router itself
      // already exists (liveRouter); this stores the agent's proposal for it.
      registerDialogueCandidate(intent.charaNum, intent.candidate);
      const status: StatusMessage = {
        kind: "STATUS_MESSAGE",
        timestamp: ts,
        source: "apply_intent",
        text: `dialogue candidate registered for chara ${intent.charaNum}`,
      };
      return appendAndReturn(state, [status], validation);
    }
    case "OVERRIDE_SCHEDULE": {
      // Agent schedule override — registered into the schedule-provider seam.
      // The default agentOverrideProvider honors active source:"agent" slots
      // (location = slot.activity, gated by @MAP_CAN_MOVE_0). No invented
      // behavior: it only forwards a stated location the agent runtime chose.
      registerScheduleOverride(intent.charaNum, intent.schedule);
      const status: StatusMessage = {
        kind: "STATUS_MESSAGE",
        timestamp: ts,
        source: "apply_intent",
        text: `schedule override registered for chara ${intent.charaNum} (${intent.schedule.slots.length} slot(s))`,
      };
      return appendAndReturn(state, [status], validation);
    }
    default: {
      // validateIntent's closed-enum guard already rejected this.
      // Reaching here is a type-system gap (e.g. someone added a
      // new AgentIntent variant and forgot to update this switch).
      const _exhaustive: never = intent;
      void _exhaustive;
      const msg: StatusMessage = {
        kind: "STATUS_MESSAGE",
        timestamp: ts,
        source: "validator",
        text: "unreachable: intent.kind not in closed enum (type drift)",
      };
      return appendAndReturn(state, [msg], validation);
    }
  }
}

function appendAndReturn(
  state: GameState,
  appended: ReadonlyArray<ObservationEvent>,
  validation: ValidationResult,
  transitions: readonly DomainTransition[] = [],
): ApplyIntentResult {
  return {
    state: {
      ...state,
      eventLog: [...state.eventLog, ...appended],
    },
    appended,
    validation,
    transitions,
  };
}
