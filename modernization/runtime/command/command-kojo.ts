import type { ObservationEvent } from "../../schemas/types.js";
import type { CommandContext, CommandKojoChoiceSession } from "./types.js";
import { createRng } from "./rng.js";
import type { KojoHostEvent, KojoResolution, KojoStagedEffect } from "../kojo/types.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";

export interface CommandKojoCollection {
  events: ObservationEvent[];
  effects: KojoStagedEffect[];
  pendingKojoChoice?: CommandKojoChoiceSession;
  /** The actual route resolution that produced `events` (AI-PREPARE-PERF-PLAN
   *  §4.C)：eligibility 可直接复用，避免对同一命令做第二次完整求值。 */
  resolution?: KojoResolution;
}

/** Translate committed ERB presentation requests into session-owned events.
 * Keeping them distinct from DIALOGUE_LINE prevents visuals from becoming
 * quoted prose or escaping an ERB transaction that later rolls back. */
export function kojoHostEventsToObservationEvents(
  hostEvents: readonly KojoHostEvent[] | undefined,
  charaNum: number,
  now: () => number,
): ObservationEvent[] {
  return (hostEvents ?? []).map((event) => event.kind === "reset-color"
    ? { kind: "KOJO_HOST_EVENT" as const, timestamp: now(), charaNum, operation: "reset-color" as const }
    : {
      kind: "KOJO_HOST_EVENT" as const,
      timestamp: now(),
      charaNum,
      operation: "host-call" as const,
      name: event.name,
      args: [...event.args],
      stringArgs: [...event.stringArgs],
    });
}

export function collectCommandKojo(
  ctx: CommandContext,
  target: number = ctx.target,
  commandNo: number = ctx.commandNo,
  choices: readonly number[] = [],
): CommandKojoCollection {
  if (!ctx.dialogueRouter || target <= 0) return { events: [], effects: [] };
  const targetSlot = ctx.state.charas[target];
  // Frozen targets cannot speak or execute personal Kojo effects. Command
  // handlers still retain their own narration (for example, time-stop work).
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
    (targetSlot?.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return { events: [], effects: [] };
  const rng = createRng(commandKojoSeed(ctx));
  const continuation = choices.length === 0
    ? ctx.dialogueRouter.collectContinuation?.(target, commandNo, ctx.state, rng)
    : undefined;
  if (continuation) {
    const lines = continuation.resolution.lines;
    const events = lines.map((line) => ({
      kind: "DIALOGUE_LINE" as const,
      timestamp: ctx.now(),
      charaNum: target,
      text: line.text,
      form: line.form,
    }));
    if (continuation.pending && continuation.continuationId) {
      return {
        events,
        effects: [],
        resolution: continuation.resolution,
        pendingKojoChoice: {
          kind: "command",
          charaNum: target,
          commandNo,
          seed: commandKojoSeed(ctx),
          choices: [],
          options: continuation.pending.options,
          continuationId: continuation.continuationId,
          continuationValues: continuation.pending.values,
          continuationInputMode: continuation.pending.inputMode,
        },
      };
    }
    return {
      events: [...events, ...kojoHostEventsToObservationEvents(continuation.resolution.hostEvents, target, ctx.now)],
      effects: continuation.resolution.effects,
      resolution: continuation.resolution,
    };
  }
  const interactive = ctx.dialogueRouter.collectInteractive?.(
    target,
    commandNo,
    ctx.state,
    rng,
    choices,
  );
  const detailed = interactive
    ? null
    : ctx.dialogueRouter.collectDetailed?.(target, commandNo, ctx.state, rng);
  const lines = interactive?.lines ?? detailed?.lines ?? ctx.dialogueRouter.collect(target, commandNo, ctx.state, rng);
  const events = lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum: target,
    text: line.text,
    form: line.form,
  }));
  const hostEvents = interactive ? [] : kojoHostEventsToObservationEvents(detailed?.hostEvents, target, ctx.now);
  if (interactive?.pending) {
    return {
      events: [...events, ...hostEvents],
      effects: [],
      resolution: interactive,
      pendingKojoChoice: {
        kind: "command",
        charaNum: target,
        commandNo,
        seed: commandKojoSeed(ctx),
        choices,
        options: interactive.pending.options,
      },
    };
  }
  return {
    events: [...events, ...hostEvents],
    effects: interactive?.effects ?? detailed?.effects ?? [],
    resolution: interactive ?? detailed ?? undefined,
  };
}

export function collectCommandKojoEvents(
  ctx: CommandContext,
  target: number = ctx.target,
  commandNo: number = ctx.commandNo,
): ObservationEvent[] {
  return collectCommandKojo(ctx, target, commandNo).events;
}

export function commandKojoSeed(ctx: CommandContext): number {
  return ctx.rngSeed ?? ctx.commandNo * 100003 + ctx.state.time.tickValue;
}

export function commandKojoEventsFromSession(
  ctx: CommandContext,
  session: Pick<CommandKojoChoiceSession, "charaNum" | "commandNo" | "choices">,
): CommandKojoCollection {
  return collectCommandKojo(ctx, session.charaNum, session.commandNo, session.choices);
}
