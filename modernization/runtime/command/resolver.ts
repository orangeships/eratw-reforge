/**
 * Phase 5A — `resolveCommand` skeleton.
 *
 * Single public entry point of the command runtime. Looks up the
 * handler for an `IssueCommandIntent`, optionally runs an
 * `ExecCheck`, then either invokes the handler or short-circuits with
 * a `StatusMessage` event + `noop`/`blocked` outcome.
 *
 * 5A behavior (locked by phase-5-plan.md §5A):
 *
 * 1. Look up the handler in the catalog.
 *    - **Not found** → emit `StatusMessage` (source: "system") event,
 *      return `outcome: "noop"`, `failReason: { kind:
 *      "unknown_command", commandNo }`. The state is returned
 *      unchanged (same reference; resolver does not clone on the noop
 *      path).
 * 2. If an `execCheck` is registered, run it.
 *    - `{ ok: false }` → emit `StatusMessage` carrying the reason,
 *      return `outcome: "blocked"`, `failReason: <reason>`. Handler
 *      is NOT called.
 *    - `{ ok: true }` → fall through.
 * 3. Otherwise call the handler with a built `CommandContext` and
 *    return the handler's `CommandResult` unchanged. The resolver
 *    does not wrap, intercept, or add events in the happy path —
 *    handlers are the single source of truth.
 *
 * **Why `noop` (not `blocked`) for unknown commands:** the 4.5 mock
 * fallback still owns `apply_intent` until 5F, so the resolver's
 * `noop` outcome is observable in tests only. Once 5F switches the
 * wire-up, `noop` means "the game did nothing AND the user knows
 * why" (via the `StatusMessage` in the narrative band) — distinct
 * from `blocked` which means "the user tried something the rules
 * forbid."
 *
 * **Why `target` defaults to `actor`:** `IssueCommandIntent` has no
 * `target` field at 5A (that's a separate schema change deferred out
 * of scope). Commands without an explicit target (e.g. `移動`) treat
 * the player as the implicit target. 5B `move.ts` will pass its own
 * target via the catalog entry if needed.
 *
 * **Why `StatusMessage` (not a new `WARN` event kind):** 5A is a
 * pure infrastructure slice — no schema changes. `StatusMessage` is
 * the existing channel for system-level signals, and its `source`
 * discriminator already covers the resolver's needs. A dedicated
 * `WARN` event kind is a future enhancement once the pattern
 * stabilizes across 5B–5E and a separate "settlement-level warning"
 * is genuinely distinct from system status text.
 *
 * **RNG seed:** when `deps.rng` is omitted, the resolver defaults to
 * `createRng(0)`. This makes 5A tests reproducible without forcing
 * every test to construct an `Rng`. 5B+ will pass an RNG seeded from
 * the save file's RNG seed + the commandNo.
 */

import type {
  IssueCommandIntent,
  ObservationEvent,
} from "../../schemas/types.js";
import type { GameState } from "../state/index.js";
import { cloneGameState } from "../state/game-state.js";
import { beginKojoExecutionFrame, beginTurnContext } from "../state/tflag.js";
import {
  detectDomainTransitions,
  mergeDomainTransitions,
  type DomainTransition,
} from "../state/domain-transition.js";
import type {
  CommandContext,
  CommandResult,
  FailReason,
} from "./types.js";
import type { CommandCatalog } from "./catalog.js";
import { createRng, type Rng } from "./rng.js";
import {
  trainLinesToNarrationEvents,
  type TrainMessageRouter,
} from "./train-message.js";
import {
  clearTrainingMode,
  finishTrainingSession,
  prepareHInsertionBeforeSettlement,
  prepareHInsertionReleaseBeforeSettlement,
  withTrainingSessionLifecycle,
} from "./training-session.js";
import { runEventComEnd2 } from "./handlers/event-com-end.js";
import { prepareHCommandStimulus, withHCommandEjaculation } from "./h-ejaculation.js";
import { hasHInteractionProjection, prepareHInteraction } from "./h-interaction.js";
import { attachHSettlementReceipt } from "./h-settlement-receipt.js";
import { applyDailyBlessingExpBonus } from "../world/daily-event.js";
import { collectCommandKojo } from "./command-kojo.js";
import { applyKojoEffects, resolveEventKojoAndApply } from "../kojo/effects.js";
import { collectCommandPalamCng } from "../kojo/palam-dispatch.js";
import { finalizeTrainingMarkAcquisitionChecks } from "./source-check.js";
import { withEventCounter } from "./counter/with-counter.js";
import { resolveDomainTransitionDialogue } from "../kojo/domain-transition-dialogue.js";
import {
  hModeBlockReason,
  isCleanHModeBaselineCommand,
  isHMode,
  requiresHMode,
} from "./h-mode.js";
import { extractedGateAuditFor } from "./comf/comable-gate-audit.generated.js";
import { endDate, followDatePartner, syncDateMirrors, tryStartAppointmentOnArrival } from "../world/date-session.js";
import { applyDateTimeUp, dateTimeUpFlags } from "../world/date-timeup.js";
import { advanceDateAppointments, offeredDateInvitations, offerDateIntentionsOnEncounter } from "../world/date-appointments.js";
import { mapIdOfLocation } from "../world/location-predicates.js";
import { CFLAG_ID, TCVAR_ID, flushCommandTimeBatch } from "../state/settlement.js";
import {
  accrueMobDirt,
  clearMobInterruptedTargetEmotion,
  mobInterruptsHMode,
  mobInterruptionMessage,
  mobMessage,
  maybeOfferMobMeal,
} from "../world/mobs.js";

/** Injectable dependencies. `rng` and `now` default if omitted. */
export interface ResolverDeps {
  readonly catalog: CommandCatalog;
  /** Optional RNG; resolver defaults to `createRng(0)` when omitted. */
  readonly rng?: Rng;
  /** Seed corresponding to `rng`, retained for interactive kojo replay. */
  readonly rngSeed?: number;
  /**
   * Optional wall-clock source for `StatusMessage` timestamps.
   * Defaults to `Date.now`. Tests pass a fixed value for snapshot
   * stability.
   */
  readonly now?: () => number;
  /**
   * Optional kojo router (Phase 6.4). Forwarded to the
   * `CommandContext.dialogueRouter` so handlers can dispatch
   * dialogue via the real bundle. Undefined = no kojo (handlers
   * fall back to canned NARRATION).
   */
  readonly dialogueRouter?: import("../kojo/types.js").DialogueRouter;
  readonly narrativeHookGeneration?: boolean;
  /**
   * Original TRAIN_MESSAGE / MESSAGE_COMxxx layer. This is common action
   * prose, not personal kojo: when a command settles it is retained in the
   * event log and presented in the scene-description lane before the handler
   * or personal dialogue.
   */
  readonly trainMessageRouter?: TrainMessageRouter;
  /**
   * EVENT_COUNTER pipeline switch. Defaults to on; the golden-trace
   * comparison harness flips it off to reproduce pre-counter sequences.
   * The AI counter provider (S4) will arrive as a separate dep.
   */
  readonly counterEnabled?: boolean;
  /**
   * Generated shared counter narration asset (COUNTER_MESSAGE bodies).
   * Absent ⇒ counter actions fire silently (personal kojo only).
   */
  readonly counterSharedAssets?: import("../kojo/counter-dispatch.js").SharedCounterDialogueAssets;
  /**
   * Counter action-selection provider. Default = the deterministic weighted
   * draw; an AI provider may only pick pool members (validated) and abstains
   * to the deterministic fallback when unready.
   */
  readonly counterProvider?: import("./counter/provider.js").CounterActionProvider;
  /** Optional deterministic trigger stream override for focused tests/tools. */
  readonly counterTriggerRng?: Rng;
  /** Optional development-only counter route diagnostics. */
  readonly counterDiagnostics?: (entry: {
    charaNum: number;
    action: number;
    variantCode?: string;
    sourceFile?: string;
    functionName?: string;
    status: string;
    diagnostics: readonly string[];
  }) => void;
}

const SYNTHETIC_ENGLISH_NARRATION_RE =
  /\b(chatted|gently|touched|studied|waited|used|performed|played|watched|read|worked|cleaned|rested|relaxed|foraged|prayed|learned|drank|ate|cooked|washed|bathed|hugged|kissed|caressed|talked|spoke|trained|training)\b/i;
const SYNTHETIC_CHINESE_NARRATION_RE =
  /(?:简短地说着话|说着话，度过了快乐的时光|会话停下后，气氛变得尴尬起来)/u;

function isSyntheticMigrationNarration(event: ObservationEvent): boolean {
  if (event.kind !== "NARRATION") return false;
  return (
    (/[A-Za-z]/.test(event.text) && SYNTHETIC_ENGLISH_NARRATION_RE.test(event.text)) ||
    SYNTHETIC_CHINESE_NARRATION_RE.test(event.text)
  );
}

const HANDLER_AUTHORED_MESSAGE_COMMANDS = new Set<number>([
  // Cooking/eating handlers already own the dish summary and per-eater prose.
  // The common template lacks EX_DISH_NAME and runs after meal reset.
  413, 414, 415,
  // COM445's modern handler owns the item/quantity/EXP result text. The legacy
  // TRAIN_MESSAGE line needs ERB TFLAG/ITEM expression evaluation, so using it
  // here leaks placeholders like `{TFLAG:194}` into the UI.
  445,
]);

/** A 303 handler fallback only used when TRAIN_MESSAGE has no authored text. */
function isApologyFallbackNarration(event: ObservationEvent, commandNo: number): boolean {
  return (
    commandNo === 303 &&
    event.kind === "NARRATION" &&
    event.text.includes("向 %CALLNAME:TARGET% 道歉；")
  );
}

function withTrainMessage(
  result: CommandResult,
  ctx: CommandContext,
  deps: ResolverDeps,
): CommandResult {
  if (result.outcome !== "ok") return result;
  if (HANDLER_AUTHORED_MESSAGE_COMMANDS.has(ctx.commandNo)) return result;
  const trainLines = deps.trainMessageRouter?.collect(
    ctx.commandNo,
    ctx.target,
    result.state,
    ctx.rng,
  ) ?? [];
  if (trainLines.length === 0) return result;

  const trainEvents = trainLinesToNarrationEvents(trainLines, ctx.now);
  const events = result.events.filter(
    (event) =>
      !(event.kind === "NARRATION" && event.origin === "comf-fallback") &&
      !isSyntheticMigrationNarration(event) &&
      !isApologyFallbackNarration(event, ctx.commandNo),
  );
  return {
    ...result,
    events: [...trainEvents, ...events],
  };
}

/** Central command-kojo fallback for bespoke handlers. Most coefficient
 * commands dispatch inside `makeComfHandler`; custom orchestrators can either
 * set `kojoHandled` or emit dialogue themselves. Everything else gets one
 * transaction-aware personal route after settlement, before TRAIN_MESSAGE is
 * prepended for display. */
function withCommandKojo(result: CommandResult, ctx: CommandContext): CommandResult {
  if (result.outcome === "ok") {
    // Custom handlers may make several SOURCE_CHECK passes before this shared
    // dialogue boundary. Commit their summed mark inputs once before kojo and
    // state-transition feedback read the final levels.
    finalizeTrainingMarkAcquisitionChecks(result.state);
  }
  if (
    result.outcome !== "ok" ||
    result.kojoHandled ||
    !ctx.dialogueRouter ||
    ctx.target <= 0 ||
    result.events.some((event) => event.kind === "DIALOGUE_LINE" || event.kind === "KOJO_HOST_EVENT")
  ) {
    return result;
  }
  // EVENTCOMEND2 resets the eaten dish after upstream command dialogue. The
  // handlers already clear it, so expose only the consumed dish to this read
  // context; effects still commit against the authoritative, cleared state.
  const kojoState = (ctx.commandNo === 414 || ctx.commandNo === 415) && ctx.state.dish && !result.state.dish
    ? { ...result.state, dish: ctx.state.dish }
    : result.state;
  const kojo = collectCommandKojo({ ...ctx, state: kojoState });
  return {
    ...result,
    state: kojo.effects.length > 0 ? applyKojoEffects(result.state, kojo.effects) : result.state,
    events: [...result.events, ...kojo.events],
    ...(kojo.pendingKojoChoice ? { pendingKojoChoice: kojo.pendingKojoChoice } : {}),
    ...(kojo.resolution ? { commandKojoResolution: kojo.resolution } : {}),
    kojoHandled: true,
  };
}

/** Post-settlement PALAMCNG layer (phase C — 調教後口上) for the command
 * target. Independent of `withCommandKojo`: the original fires both the
 * command route and SOURCE.ERB's PALAMCNG channels in the same settlement, so
 * a handler that already emitted command dialogue still gets its PALAMCNG
 * reactions. Skipped for interactive commands mid-choice (settlement is
 * incomplete until the pending choice resolves). */
function withPalamCngKojo(result: CommandResult, ctx: CommandContext): CommandResult {
  if (
    result.outcome !== "ok" ||
    ctx.commandNo === 433 ||
    result.pendingKojoChoice ||
    !ctx.dialogueRouter ||
    ctx.target <= 0
  ) {
    return result;
  }
  const palam = collectCommandPalamCng({ ...ctx, state: result.state }, ctx.target);
  if (palam.events.length === 0 && palam.effects.length === 0) return result;
  return {
    ...result,
    state: palam.effects.length > 0 ? applyKojoEffects(result.state, palam.effects) : result.state,
    events: [...result.events, ...palam.events],
  };
}

function orderCommandEvents(events: readonly ObservationEvent[]): ObservationEvent[] {
  // Preserve the runtime's append order for command prose, personal kojo,
  // and EVENT_COUNTER output. Only move world ambience ahead of the command
  // transcript so it cannot interrupt the active interaction surface.
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const aAmbient = a.event.kind === "NARRATION" && a.event.presentation === "ambient";
      const bAmbient = b.event.kind === "NARRATION" && b.event.presentation === "ambient";
      return Number(bAmbient) - Number(aAmbient) || a.index - b.index;
    })
    .map(({ event }) => event);
}

function withResolvedTransitions(
  before: Readonly<GameState>,
  result: CommandResult,
  ctx: CommandContext,
): CommandResult {
  const completed: readonly DomainTransition[] =
    result.outcome === "ok" && !result.pendingKojoChoice
      ? [
          {
            kind: "command-completed",
            commandNo: ctx.commandNo,
            target: ctx.target,
          },
        ]
      : [];
  return {
    ...result,
    transitions: mergeDomainTransitions(
      result.transitions,
      detectDomainTransitions(before, result.state),
      completed,
    ),
  };
}

/**
 * Resolve a single `ISSUE_COMMAND` intent against the registered
 * handler. Pure function: never mutates the input `state`, never
 * I/O's, never calls external services.
 */
export function resolveCommand(
  intent: IssueCommandIntent,
  state: Readonly<GameState>,
  deps: ResolverDeps,
): CommandResult {
  const result = resolveCommandInternal(intent, state, deps);
  if (!result.failReason || (!state.training && !isHMode(state, intent.target ?? intent.actor))) return result;
  return {
    ...result,
    events: result.events.map((event) => event.kind === "STATUS_MESSAGE"
      ? { ...event, presentation: "command-feedback" as const }
      : event),
  };
}

function resolveCommandInternal(
  intent: IssueCommandIntent,
  state: Readonly<GameState>,
  deps: ResolverDeps,
): CommandResult {
  const now = deps.now ?? (() => Date.now());
  const rng = deps.rng ?? createRng(0);

  const entry = deps.catalog.get(intent.commandNo);
  if (!entry) {
    const events: ObservationEvent[] = [
      {
        kind: "STATUS_MESSAGE",
        timestamp: now(),
        source: "system",
        text: `unknown commandNo ${intent.commandNo}`,
      },
    ];
    const failReason: FailReason = {
      kind: "unknown_command",
      commandNo: intent.commandNo,
    };
    // Resolver does not mutate on the noop path — return the input
    // reference. The cast strips `Readonly` since `CommandResult.state`
    // is `GameState` (mutable contract); the resolver promises not
    // to mutate.
    return {
      state: state as GameState,
      events,
      outcome: "noop",
      failReason,
      transitions: [],
    };
  }

  // A persisted COM633 session owns the whole interaction surface. Commands
  // cannot mutate the world behind it; the contest store actions are the only
  // legal continuation until settlement or a forfeit has committed.
  if (state.stoneContestSession) {
    const message = "积石竞赛进行中，其他命令暂时锁定。";
    const failReason: FailReason = { kind: "precondition", message };
    return {
      state: state as GameState,
      events: [{ kind: "STATUS_MESSAGE", timestamp: now(), source: "system", text: message }],
      outcome: "blocked",
      failReason,
      transitions: [],
    };
  }

  // Upstream JOB end EVENT 27 uses a blocking ASK_YN. Once an invitation is
  // offered, no unrelated command may silently walk past it; only the two
  // synthetic response commands can resolve the persisted choice.
  const pendingDateInvitation = offeredDateInvitations(state)[0];
  if (pendingDateInvitation && intent.commandNo !== 19989 && intent.commandNo !== 19988) {
    const name = state.charas[pendingDateInvitation.partner]?.callName ?? `#${pendingDateInvitation.partner}`;
    const message = `请先回应${name}的约会邀约。`;
    const failReason: FailReason = { kind: "precondition", message };
    return {
      state: state as GameState,
      events: [{ kind: "STATUS_MESSAGE", timestamp: now(), source: "system", text: message }],
      outcome: "blocked",
      failReason,
      transitions: [],
    };
  }

  // Build the context. `target` carries the intent's focused chara for
  // target-directed COMF commands (5D); absent ⇒ actor is the implicit
  // target (e.g. 移動 acts on the player). See header note.
  const commandState = beginTurnContext(state, intent.commandNo);
  const commandFrame = beginKojoExecutionFrame(
    commandState,
    intent.actor,
    intent.target ?? intent.actor,
    intent.commandNo,
  );
  commandFrame.batchCommandTime =
    intent.commandNo < 200 || (intent.commandNo >= 312 && intent.commandNo <= 361);
  let ctx: CommandContext = {
    state: commandState,
    actor: intent.actor,
    target: intent.target ?? intent.actor,
    commandNo: intent.commandNo,
    rng,
    rngSeed: deps.rngSeed,
    now,
    dialogueRouter: deps.dialogueRouter,
    narrativeHookGeneration: deps.narrativeHookGeneration,
    // Phase 7 Wave 2c: forward the B9 prompt answer (absent for non-B9
    // commands or when the UI skipped the picker).
    promptAnswer: intent.promptAnswer,
  };
  const blessingExpBefore = { ...commandState.master.state.EXP };

  const modeBlock = hModeBlockReason(commandState, ctx.target, ctx.commandNo);
  if (modeBlock) {
    const failReason: FailReason = {
      kind: "precondition",
      message: modeBlock,
    };
    return {
      state: state as GameState,
      events: [{
        kind: "STATUS_MESSAGE",
        timestamp: now(),
        source: "system",
        text: modeBlock,
      }],
      outcome: "blocked",
      failReason,
      transitions: [],
    };
  }

  // Direct intents must obey the same Act_COM state wall as the player menu.
  // A complete extracted @COM_ABLE can stand on its own; an incomplete gate
  // needs an explicit command-level H check or remains fail-closed.
  if (
    isHMode(commandState, ctx.target) &&
    requiresHMode(ctx.commandNo) &&
    !isCleanHModeBaselineCommand(ctx.commandNo)
  ) {
    const gateAudit = entry.gateStatus
      ? { status: entry.gateStatus }
      : extractedGateAuditFor(entry.commandNo);
    const stateCheck = entry.hModeMenuCheck?.(ctx);
    const missingTrustedGate = !entry.hModeMenuCheck && gateAudit.status !== "complete";
    if ((stateCheck && !stateCheck.ok) || missingTrustedGate) {
      const failReason: FailReason = stateCheck && !stateCheck.ok
        ? stateCheck.reason
        : {
            kind: "precondition",
            message: "该调教指令的装备、插入或姿势条件尚未满足。",
          };
      const message = "message" in failReason
        ? failReason.message
        : `unknown command ${failReason.commandNo}`;
      return {
        state: state as GameState,
        events: [{ kind: "STATUS_MESSAGE", timestamp: now(), source: "system", text: message }],
        outcome: "blocked",
        failReason,
        transitions: [],
      };
    }
  }

  if (entry.execCheck) {
    const check = entry.execCheck(ctx);
    if (!check.ok) {
      const events: ObservationEvent[] = [
        {
          kind: "STATUS_MESSAGE",
          timestamp: now(),
          source: "system",
          text:
            "message" in check.reason
              ? check.reason.message
              : `unknown command ${check.reason.commandNo}`,
        },
      ];
      return {
        state: state as GameState,
        events,
        outcome: "blocked",
        failReason: check.reason,
        transitions: [],
      };
    }
  }

  // The upstream command loop separates @COM_ABLE (menu reachability) from
  // CAN_COM (the final execution threshold). Keep the latter visible in the
  // menu but fail closed before invoking the handler when it does not pass.
  if (entry.canExecute) {
    const check = entry.canExecute(ctx);
    if (!check.ok) {
      const events: ObservationEvent[] = [
        {
          kind: "STATUS_MESSAGE",
          timestamp: now(),
          source: "system",
          text:
            "message" in check.reason
              ? check.reason.message
              : `unknown command ${check.reason.commandNo}`,
        },
      ];
      return {
        state: state as GameState,
        events,
        outcome: "blocked",
        failReason: check.reason,
        transitions: [],
      };
    }
  }

  // Project the upstream TEQUIP contact/pose write before SOURCE settlement.
  // The command context received a shallow turn clone, so clone the state
  // again only on this accepted H path and keep the public input untouched.
  let insertionReleaseMessages: string[] = [];
  if (hasHInteractionProjection(ctx.commandNo)) {
    const preparedState = cloneGameState(ctx.state);
    insertionReleaseMessages = prepareHInsertionReleaseBeforeSettlement(preparedState, ctx.target, ctx.commandNo);
    const interactionChanged = prepareHInteraction(preparedState, ctx.actor, ctx.target, ctx.commandNo);
    const insertionPrepared = prepareHInsertionBeforeSettlement(
      preparedState,
      ctx.target,
      ctx.actor,
      ctx.commandNo,
    );
    if (interactionChanged || insertionPrepared) {
      ctx = { ...ctx, state: preparedState };
    }
  }

  prepareHCommandStimulus(ctx);

  const handlerResult = entry.handler(ctx);
  const handled = handlerResult.outcome === "ok" && insertionReleaseMessages.length > 0
    ? { ...handlerResult, events: [...insertionReleaseMessages.map((text) => ({
        kind: "NARRATION" as const, timestamp: ctx.now(), text,
      })), ...handlerResult.events] }
    : handlerResult;

  // Happy path: handler settles state; then the original common
  // TRAIN_MESSAGE layer emits its action prose before personal kojo, the
  // EVENT_COUNTER pipeline may add the target's own reaction, and the
  // training lifecycle finalizes session bookkeeping.
  let settled = withTrainingSessionLifecycle(
    withEventCounter(
      withPalamCngKojo(
        withTrainMessage(withCommandKojo(withHCommandEjaculation(handled, ctx), ctx), ctx, deps),
        ctx,
      ),
      ctx,
      deps,
    ),
    ctx,
  );
  const commandTimeEvents = flushCommandTimeBatch(settled.state, now);
  if (commandTimeEvents.length > 0) {
    settled = { ...settled, events: [...settled.events, ...commandTimeEvents] };
  }
  if (settled.outcome === "ok") {
    // Upstream FirstMeetToday records a same-room interaction for EVENT 31.
    const target = settled.state.charas[ctx.target];
    if (target && target.location === settled.state.master.location) {
      // Normal handlers already own a deep copy. Preserve the defensive copy
      // for handlers that return shared slots, without recopying the entire
      // save/history before the all-character EVENTCOMEND2 bookkeeping.
      const ownsSlotState = (slot: typeof settled.state.master, original: typeof slot | undefined) =>
        !original || (slot.state !== original.state && Object.entries(slot.state).every(([key, value]) =>
          value === null || typeof value !== "object"
          || value !== (original.state as unknown as Record<string, unknown>)[key],
        ));
      const ownsCharacterState = ownsSlotState(settled.state.master, state.master)
        && Object.entries(settled.state.charas).every(([id, slot]) =>
          ownsSlotState(slot, state.charas[Number(id)]),
        );
      if (!ownsCharacterState) {
        settled = { ...settled, state: cloneGameState(settled.state) };
      }
      const met = settled.state.charas[ctx.target]!;
      met.state.CFLAG[CFLAG_ID.最后见面的日子] = settled.state.time.dayIndex;
      met.state.TCVAR[TCVAR_ID.今天有否见面] = 1;
    }
    // EVENTCOMEND2 is an authoritative post-command hook, not a UI-only
    // afterthought. Run its silent per-character bookkeeping for resolver
    // callers too (the elapsed-time finalizer may run the same hook later
    // with a non-zero fatigue delta).
    runEventComEnd2(settled.state, 0);
    // `EVENTCOMEND.ERB` applies the MOB room's per-minute dirt and then
    // allows that room's `MOB_TURNENDEVENT` to interrupt public H activity.
    // Keep this in the command authority so generated move handlers remain
    // simple adapters and every successful time-advancing command shares it.
    accrueMobDirt(settled.state, state.time.tickValue, settled.state.time.tickValue);
    if (settled.state.master.location !== state.master.location) {
      const message = mobMessage(settled.state, ctx.rng);
      if (message) {
        settled = {
          ...settled,
          events: [...settled.events, { kind: "NARRATION", timestamp: now(), text: message, presentation: "ambient" }],
        };
      }
    }
    const mobInterrupted = mobInterruptsHMode(settled.state);
    if (mobInterrupted) {
      const message = mobInterruptionMessage(settled.state);
      clearMobInterruptedTargetEmotion(settled.state, ctx.target);
      clearTrainingMode(settled.state, ctx.target);
      const clearedEdging = finishTrainingSession(settled.state, "manual");
      const interruptionMessages = [
        message,
        ...(clearedEdging > 0 ? ["训练中断，未吸收的寸止积累已清除。"] : []),
      ].filter((text): text is string => Boolean(text));
      if (interruptionMessages.length > 0) {
        settled = {
          ...settled,
          events: [
            ...settled.events,
            ...interruptionMessages.map((text) => ({ kind: "NARRATION" as const, timestamp: now(), text })),
          ],
        };
      }
    }
    if (!mobInterrupted && maybeOfferMobMeal(settled.state, ctx.rng)) {
      settled = {
        ...settled,
        events: [...settled.events, {
          kind: "NARRATION",
          timestamp: now(),
          text: "被推荐了由哥布林制作的料理。",
        }],
      };
    }
    const session = settled.state.dateSession;
    if (session && (settled.state.time.dayIndex !== state.time.dayIndex || (session.forcedEndTick != null && settled.state.time.tickValue >= session.forcedEndTick))) {
      endDate(settled.state, { returnHome: true });
    } else if (session) {
      // Upstream `@约会終了タイムアップ処理` runs after every turn. It ends the
      // date on 気力 0 / NEMUKE>=720 / blackout drunk / partner weakened, and
      // offers a stay-over when the partner invited the master. It calls
      // `SET_DATE` WITHOUT `DATE_EVENT`, so no date settlement runs here.
      const timeUp = dateTimeUpFlags(settled.state);
      if (timeUp?.anyAffected) {
        const result = applyDateTimeUp(settled.state, timeUp, { now });
        if (result.events.length > 0) {
          settled = {
            ...settled,
            events: [...settled.events, ...result.events],
          };
        }
      } else {
        // The date is always in its single `active` phase: the road stage is
        // retired, so the master may walk and the partner follows.
        session.mapId = mapIdOfLocation(settled.state.master.location) ?? session.mapId;
        followDatePartner(settled.state);
        syncDateMirrors(settled.state);
        tryStartAppointmentOnArrival(settled.state);
      }
    } else {
      tryStartAppointmentOnArrival(settled.state);
    }
    advanceDateAppointments(settled.state);
    const offeredInvitations = offerDateIntentionsOnEncounter(settled.state);
    if (offeredInvitations.length > 0) {
      const invitationEvents: ObservationEvent[] = [];
      for (const invitation of offeredInvitations) {
        const name = settled.state.charas[invitation.partner]?.callName ?? `#${invitation.partner}`;
        invitationEvents.push({
          kind: "NARRATION",
          timestamp: now(),
          text: `${name}似乎想邀请你去${invitation.location ?? "某处"}约会。`,
        });
        if (deps.dialogueRouter) {
          for (const line of resolveEventKojoAndApply(
            deps.dialogueRouter,
            settled.state,
            invitation.partner,
            27,
            ctx.rng,
            [0, 0],
          )) {
            invitationEvents.push({
              kind: "DIALOGUE_LINE",
              timestamp: now(),
              charaNum: invitation.partner,
              text: line.text,
              form: line.form,
            });
          }
        }
      }
      settled = { ...settled, events: [...settled.events, ...invitationEvents] };
    }
  }
  if (settled.outcome === "ok") {
    const bonus = applyDailyBlessingExpBonus(settled.state, blessingExpBefore, true);
    if (bonus > 0) {
      settled = {
        ...settled,
        events: [...settled.events, { kind: "NARRATION", timestamp: now(), text: "神の加護でさらに経験が1増えた。" }],
      };
    }
  }
  settled = withResolvedTransitions(state, settled, ctx);
  if (settled.outcome === "ok" && deps.dialogueRouter && settled.transitions?.length) {
    for (const transition of settled.transitions) {
      if (transition.kind !== "rebellion-mark-acquired" && transition.kind !== "mark-acquired") continue;
      const reaction = resolveDomainTransitionDialogue(settled.state, transition, {
        router: deps.dialogueRouter,
        rng: ctx.rng,
        now,
      });
      settled = {
        ...settled,
        state: reaction.state,
        events: [...settled.events, ...reaction.events.map((event) => ({ ...event, origin: "mark" as const }))],
      };
    }
  }
  // Last point where the command's `KojoExecutionFrame` still exists: snapshot
  // this turn's NOWEX / edging / marks into a persisted receipt so the L1
  // scene projection can read them long after `clearTurnContext` runs.
  return attachHSettlementReceipt(
    { ...settled, events: orderCommandEvents(settled.events) },
    { before: state, ctx },
  );
}
