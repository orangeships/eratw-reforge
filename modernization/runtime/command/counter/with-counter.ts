/**
 * `withEventCounter` — the resolver onion wrapper that runs the EVENT_COUNTER
 * pipeline after a command settles. Placement: between `withPalamCngKojo` and
 * `withTrainingSessionLifecycle`, so the counter sees the settled PALAM/state
 * but still observes a live session before exit commands end it (850/999 are
 * hard-excluded inside the block reason anyway).
 *
 * S3 semantics: after selecting the action the wrapper dispatches the shared
 * counter narration (generated COUNTER_MESSAGE asset) plus the character's
 * personal counter kojo (`resolveCounterKojoDetailed`, TCVAR:20 contract),
 * applying composed effects through the transactional kojo applier. Text rolls
 * on the same derived counter stream *after* the single selection draw, so
 * narration RAND branches never perturb action selection.
 */

import type { CommandContext, CommandResult } from "../types.js";
import type { ResolverDeps } from "../resolver.js";
import { TCVAR_ID } from "../../state/settlement.js";
import {
  applySourceCheck,
  finalizeTrainingMarkAcquisitionChecks,
  settleSourcePalam,
} from "../source-check.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { collectCounterDialogue } from "../../kojo/counter-dispatch.js";
import {
  collectCounterCandidates,
  counterBlockReason,
  counterFired,
  counterSeed,
  markCounterFired,
  selectCounterAction,
  shouldTriggerCounter,
} from "./counter.js";
import { createRng } from "../rng.js";
import {
  createDeterministicCounterProvider,
  validateCounterSelection,
  type CounterSelection,
} from "./provider.js";
import { counterActionById } from "./counter-actions.js";
import {
  applyCounterUndressLate,
  clearCounterUndressMarkers,
} from "./counter-undress.js";

const deterministicProvider = createDeterministicCounterProvider();

function runCounterForTarget(
  result: CommandResult,
  ctx: CommandContext,
  deps: ResolverDeps,
  target: number,
): CommandResult {
  if (deps.counterEnabled === false) return result;
  if (result.outcome !== "ok") return result;
  if (target <= 0 || !result.state.charas[target]) return result;
  const frame = result.state.turnContext?.frame;
  if (counterFired(frame, target)) return result;
  const block = counterBlockReason(result.state, target, ctx.commandNo);
  if (block) return result;

  const pool = collectCounterCandidates(result.state, target);
  if (pool.length === 0) return result;
  // Trigger frequency is independent from both ARRAY_HIT action selection and
  // the dialogue branch stream. This preserves which action/text a given
  // command would choose when the frequency rule changes.
  const triggerRng = deps.counterTriggerRng ?? createRng(
    (counterSeed(ctx) ^ Math.imul(target, 0x27d4eb2d) ^ 0x51ed270b) | 0,
  );
  if (!shouldTriggerCounter(result.state, target, triggerRng)) return result;
  // Keep each target's ARRAY_HIT and dialogue on an independent stream.
  const rng = createRng((counterSeed(ctx) ^ Math.imul(target, 0x45d9f3b)) | 0);
  const snapshots = pool.map((candidate) => ({
    id: candidate.def.id,
    label: candidate.def.label,
    family: candidate.def.family,
    weight: candidate.weight,
  }));
  // Provider seam: an AI provider may pick a pool member (validated against
  // the pool and a fresh able re-check); null abstains to the deterministic
  // weighted draw. The deterministic provider consumes exactly the one
  // ARRAY_HIT draw; an AI selection comes from the shell-side pre-request
  // cache and consumes none — either way the stream stays shape-stable.
  const provider = deps.counterProvider ?? deterministicProvider;
  let provided: CounterSelection | null = null;
  try {
    provided = provider.select(snapshots, rng);
  } catch {
    // Provider failures are an abstention. Runtime owns selection and state;
    // a failed optional provider must not interrupt a committed command.
  }
  const validated = provided
    ? validateCounterSelection(provided, snapshots, (id) => {
        const def = counterActionById(id);
        return Boolean(def && (!def.able || def.able(result.state, target)));
      })
    : null;
  const picked = validated
    ? { ...validated, origin: provider.kind }
    : null;
  const selection: CounterSelection | null =
    picked ??
    (() => {
      const candidate = selectCounterAction(pool, rng);
      return candidate ? { actionId: candidate.def.id, origin: "deterministic" as const } : null;
    })();
  if (!selection) return result;
  const chosenDef = counterActionById(selection.actionId)!;
  const kojoMetadata = deps.dialogueRouter?.getCounterKojoMetadata?.(
    target,
    chosenDef.id,
    result.state,
  );

  markCounterFired(frame, target);
  const slot = result.state.charas[target]!;
  // TCVAR:22–25 are command-local DATUI intents in the upstream COUNTER
  // sequence. Discard stale/imported values before the selected action writes
  // the intents for this encounter.
  clearCounterUndressMarkers(result.state, target);
  slot.state.TCVAR[TCVAR_ID.Counter行動] = chosenDef.id;
  const session = result.state.training;
  if (session) session.lastCounterAction = chosenDef.id;
  const applied = chosenDef.apply(result.state, target, rng);
  if (applied.masterSources && Object.keys(applied.masterSources).length > 0) {
    if (frame) frame.sourceByChara[0] = { ...frame.sourceByChara[0], ...applied.masterSources };
    // Dual-participant counter actions use the same master-side SOURCE owner
    // as ordinary H commands: PALAM/CUP settle without a target favor write.
    settleSourcePalam(result.state, result.state.master, result.state.master, applied.masterSources);
  }
  if (applied.sources && Object.keys(applied.sources).length > 0) {
    if (frame) frame.sourceByChara[target] = { ...frame.sourceByChara[target], ...applied.sources };
    // Counter actions are real command SOURCE producers. Reuse the same
    // settlement owner as ordinary H commands so cross-participant CUP,
    // PALAM, favor, and fatigue ordering cannot diverge. The frame guard in
    // SOURCE_CHECK prevents a second time advance for this command.
    applySourceCheck(result.state, target, applied.sources);
    finalizeTrainingMarkAcquisitionChecks(result.state, target);
  }

  // Dialogue: shared narration + personal counter kojo. The same derived
  // stream continues past the selection draw (one draw consumed above).
  const dialogue = collectCounterDialogue(
    result.state,
    target,
    chosenDef.id,
    (state) =>
      deps.dialogueRouter?.resolveCounterKojoDetailed?.(target, chosenDef.id, state, rng) ?? {
        status: "not-authored" as const,
        lines: [],
        effects: [],
        unsupportedPredicates: [],
        unsupportedEffects: [],
        diagnostics: [],
        returnValue: 0,
        resultSlots: {},
      },
    rng,
    deps.counterSharedAssets,
    {
      targetName: slot.callName,
      masterName: result.state.master.callName,
    },
  );
  deps.counterDiagnostics?.({
    charaNum: target,
    action: chosenDef.id,
    variantCode: kojoMetadata?.variantCode,
    sourceFile: kojoMetadata?.sourceFile,
    functionName: kojoMetadata?.functionName,
    status: dialogue.status,
    diagnostics: dialogue.diagnostics,
  });
  let settled: CommandResult = {
    ...result,
    state: applyCounterUndressLate(result.state, target, chosenDef.id),
  };
  if (dialogue.effects.length > 0) {
    // Staged effects from the composed resolution land on the working state
    // through the same transactional applier the pack path uses.
    settled = { ...settled, state: applyKojoEffects(settled.state, dialogue.effects) };
  }

  const timestamp = ctx.now();
  const narrationEvents = dialogue.narration.map((text) => ({
    kind: "NARRATION" as const,
    timestamp,
    text,
    origin: "counter" as const,
  }));
  const dialogueEvents = dialogue.personal.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp,
    charaNum: target,
    text: line.text,
    form: line.form,
    origin: "counter" as const,
  }));
  if (narrationEvents.length === 0 && dialogueEvents.length === 0) return settled;
  return {
    ...settled,
    events: [...settled.events, ...narrationEvents, ...dialogueEvents],
  };
}

/**
 * Upstream EVENT_COUNTER consumes the command's TARGET[] list. The room roster
 * is only a validation/presence read; it must never widen that list. A normal
 * command frame contains [actor, target], while explicit multi-target
 * handlers append their additional participants before this wrapper runs.
 */
export function withEventCounter(
  result: CommandResult,
  ctx: CommandContext,
  deps: ResolverDeps,
): CommandResult {
  if (deps.counterEnabled === false || result.outcome !== "ok") return result;
  const frameParticipants = result.state.turnContext?.frame?.participants ?? [];
  const explicit = [...new Set(frameParticipants)]
    .filter((charaNum) => charaNum > 0 && charaNum !== ctx.actor && Boolean(result.state.charas[charaNum]));
  const targets = explicit.length > 0
    ? explicit
    : (ctx.target > 0 && ctx.target !== ctx.actor && result.state.charas[ctx.target] ? [ctx.target] : []);
  let settled = result;
  for (const target of targets) {
    // Counter kojo evaluates TARGET-scoped predicates against the character
    // currently being iterated, while the command frame still records the
    // player's original focus in `frame.target`.
    const currentFrame = settled.state.turnContext?.frame;
    if (currentFrame) currentFrame.roleAliases.TARGET = target;
    settled = runCounterForTarget(settled, ctx, deps, target);
  }
  const finalFrame = settled.state.turnContext?.frame;
  if (finalFrame) finalFrame.roleAliases.TARGET = ctx.target;
  return settled;
}
