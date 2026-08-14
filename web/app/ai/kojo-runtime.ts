import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { Outcome } from "../../../modernization/runtime/command/types.js";
import type { PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { isKojoAiFallbackEligible } from "../../../modernization/runtime/kojo/ai-fallback.js";
import { hasRelationshipDialogueState } from "../../../modernization/runtime/state/dialogue-context.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { familyIdOf } from "../game/command-families.js";
import { buildAiKojoCompletion, commandLabel, visibleHistoryLines } from "./context.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { parseAiKojoResponse, parsePartialAiKojoResponse } from "./response-validator.js";
import { currentAiCharacterProfile, currentAiSettings, useAiStore } from "./store.js";
import type {
  AiCommandHistoryEntry,
  AiGeneratedLine,
  AiProvider,
  AiRouteStatus,
  PreparedAiKojoRequest,
} from "./types.js";

function allowedKojoFamilies(): Set<string> {
  return new Set(currentAiSettings().kojoFamilies);
}
const AUTHORED_SAMPLE_LIMIT = 10;
const MAX_AUTHORED_SAMPLE_LENGTH = 900;
// These are ordinary command routes where authored kojo commonly branches by
// relationship. The router evaluates the selected ERB variant against the
// live state, so only a branch currently true for the character can surface.
const RELATION_VOICE_SAMPLE_COMMANDS = [
  302, 305, 306, 307, 308, 309, 311, 312, 313, 314, 315, 316, 317, 318,
  330, 331, 332, 333, 334, 335, 336, 350, 351, 352, 353, 354, 360, 361,
] as const;
const GENERAL_VOICE_SAMPLE_COMMANDS = [
  300, 301, 303, 304, 400, 401, 402, 403, 405, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 429, 430,
  431, 432, 434, 436, 440, 441, 445, 446, 447, 449, 450, 480, 490, 495,
  496,
] as const;
const activeControllers = new Map<string, AbortController>();
let serial = 0;
let providerOverride: AiProvider | null = null;

function nextId(prefix: string): string {
  serial += 1;
  return `${prefix}:${Date.now()}:${serial}`;
}

export function configureAiProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

export interface RecordCommandInput {
  target: number;
  commandNo: number;
  outcome: Outcome;
  state: Readonly<GameState>;
  events: readonly ObservationEvent[];
}

export function recordAiCommand(input: RecordCommandInput): AiCommandHistoryEntry {
  const entry: AiCommandHistoryEntry = {
    id: nextId("history"),
    target: input.target,
    targetName: input.state.charas[input.target]?.callName ?? `角色${input.target}`,
    commandNo: input.commandNo,
    commandLabel: commandLabel(input.commandNo),
    timestamp: Date.now(),
    location: input.state.master.location,
    outcome: input.outcome,
    visibleEvents: visibleHistoryLines(input.events, input.state),
    aiLines: [],
  };
  // H/sexual routes are intentionally not retained as prompt context. This
  // prevents a later everyday request from indirectly uploading adult text.
  if (allowedKojoFamilies().has(familyIdOf(input.commandNo))) {
    useAiStore.getState().addCommandHistory(entry);
  }
  return entry;
}

export interface PrepareAiKojoInput {
  target: number;
  commandNo: number;
  outcome: Outcome;
  beforeState: Readonly<GameState>;
  afterState: Readonly<GameState>;
  events: readonly ObservationEvent[];
  promptAnswer?: PromptAnswer;
  router: DialogueRouter;
  historyEntryId: string;
  seed: number;
}

export interface AiEligibility {
  eligible: boolean;
  reason: string;
  kojoStatus?: string;
}

export interface CollectAuthoredVoiceSamplesInput {
  router: DialogueRouter;
  state: Readonly<GameState>;
  target: number;
  seed: number;
  excludeCommandNo?: number;
}

function shuffled<T>(items: readonly T[], rng: ReturnType<typeof createRng>): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = rng.int(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function hasRelationshipVoiceState(state: Readonly<GameState>, target: number): boolean {
  const slot = state.charas[target];
  return slot ? hasRelationshipDialogueState(slot) : false;
}

/** Resolve complete authored interaction examples through the live router so
 * selectedKojoVariants is honored. Staged effects are intentionally ignored
 * and never committed. A too-long interaction is skipped as a whole rather
 * than cut into a misleading one-line fragment. */
export function collectAuthoredVoiceSamples(
  input: CollectAuthoredVoiceSamplesInput,
): string[] {
  if (!input.router.collectDetailed) return [];
  const relationshipFirst = hasRelationshipVoiceState(input.state, input.target);
  const rng = createRng(input.seed ^ (input.target * 0x9e3779b9));
  const primaryCommands = relationshipFirst
    ? RELATION_VOICE_SAMPLE_COMMANDS
    : GENERAL_VOICE_SAMPLE_COMMANDS;
  const fallbackCommands = relationshipFirst
    ? GENERAL_VOICE_SAMPLE_COMMANDS
    : RELATION_VOICE_SAMPLE_COMMANDS;
  const commands = [...shuffled(primaryCommands, rng), ...shuffled(fallbackCommands, rng)];
  const samples: string[] = [];
  const seen = new Set<string>();
  for (const sampleCommand of commands) {
    if (sampleCommand === input.excludeCommandNo || samples.length >= AUTHORED_SAMPLE_LIMIT) continue;
    const sample = input.router.collectDetailed(
      input.target,
      sampleCommand,
      input.state,
      createRng(input.seed + sampleCommand * 97 + rng.int(10_000)),
    );
    if (sample.status !== "resolved") continue;
    const lines = sample.lines
      .map((line) => line.text.trim())
      .filter((text) => text.length > 0 && text.length <= 180);
    if (lines.length === 0) continue;
    const interaction = lines.join(" / ");
    if (interaction.length > MAX_AUTHORED_SAMPLE_LENGTH || seen.has(interaction)) continue;
    seen.add(interaction);
    samples.push(
      `${input.state.charas[input.target]?.callName ?? `角色${input.target}`}（作者互动口上样例 [${sampleCommand}]${commandLabel(sampleCommand)}）：${interaction}`,
    );
  }
  return samples;
}

export function inspectAiKojoEligibility(input: PrepareAiKojoInput): AiEligibility {
  const settings = currentAiSettings();
  if (!settings.enabled) return { eligible: false, reason: "AI disabled" };
  if (!settings.kojoEnabled) return { eligible: false, reason: "AI kojo completion disabled" };
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    return { eligible: false, reason: "AI endpoint/model is not configured" };
  }
  if (input.target <= 0 || !input.afterState.charas[input.target]) {
    return { eligible: false, reason: "command has no NPC target" };
  }
  if (!currentAiCharacterProfile(input.target).enabled) {
    return { eligible: false, reason: "AI is disabled for this character" };
  }
  if (input.outcome !== "ok") return { eligible: false, reason: `command outcome is ${input.outcome}` };
  if (input.events.some((event) => event.kind === "DIALOGUE_LINE")) {
    return { eligible: false, reason: "authored dialogue already produced output", kojoStatus: "resolved" };
  }
  if (!allowedKojoFamilies().has(familyIdOf(input.commandNo))) {
    return { eligible: false, reason: "command is outside the everyday AI whitelist" };
  }
  if (!input.router.collectDetailed) {
    return { eligible: false, reason: "dialogue router cannot prove route status" };
  }
  const resolution = input.router.collectDetailed(
    input.target,
    input.commandNo,
    input.afterState,
    createRng(input.seed),
  );
  const m3Unsupported = settings.allowUnsupportedAuthored &&
    resolution.status === "unsupported" && resolution.lines.length === 0;
  // An authored route is safe to supplement only when the selected template
  // is provably empty. Any effects or diagnostics mean it is not a blank
  // template and must retain the normal fail-closed behavior.
  const authoredEmpty = resolution.status === "resolved" &&
    resolution.lines.length === 0 &&
    resolution.effects.length === 0 &&
    resolution.unsupportedPredicates.length === 0 &&
    resolution.unsupportedEffects.length === 0 &&
    resolution.diagnostics.length === 0;
  if (!isKojoAiFallbackEligible(resolution.status) && !m3Unsupported && !authoredEmpty) {
    return {
      eligible: false,
      reason: `authored route status ${resolution.status} is not AI-eligible`,
      kojoStatus: resolution.status,
    };
  }
  return {
    eligible: true,
    reason: authoredEmpty
      ? "authored empty template fallback"
      : m3Unsupported
        ? "M3 unsupported authored fallback"
        : "genuinely not-authored",
    kojoStatus: authoredEmpty ? "authored-empty" : resolution.status,
  };
}

export function prepareRealtimeAiKojo(input: PrepareAiKojoInput): PreparedAiKojoRequest | null {
  const eligibility = inspectAiKojoEligibility(input);
  if (!eligibility.eligible) return null;
  const settings = currentAiSettings();
  const routeStatus: AiRouteStatus = eligibility.kojoStatus === "unsupported"
    ? "unsupported"
    : eligibility.kojoStatus === "authored-empty"
      ? "authored-empty"
      : "not-authored";
  const requestId = nextId("ai-kojo");
  const sessionId = `command:${requestId}`;
  const voiceSamples = collectAuthoredVoiceSamples({
    router: input.router,
    state: input.afterState,
    target: input.target,
    seed: input.seed,
    excludeCommandNo: input.commandNo,
  });
  return {
    requestId,
    sessionId,
    target: input.target,
    commandNo: input.commandNo,
    routeStatus,
    historyEntryId: input.historyEntryId,
    settings,
    completion: buildAiKojoCompletion({
      requestId,
      historyEntryId: input.historyEntryId,
      target: input.target,
      commandNo: input.commandNo,
      beforeState: input.beforeState,
      afterState: input.afterState,
      events: input.events,
      promptAnswer: input.promptAnswer,
      settings,
      routeStatus,
      voiceSamples,
    }),
  };
}

export async function generateRealtimeAiKojo(
  prepared: PreparedAiKojoRequest,
  onPartialLines?: (lines: AiGeneratedLine[]) => void,
): Promise<AiGeneratedLine[]> {
  const startedAt = Date.now();
  const controller = new AbortController();
  activeControllers.set(prepared.requestId, controller);
  const timeout = setTimeout(() => controller.abort("timeout"), prepared.settings.timeoutMs);
  useAiStore.getState().addDebugEntry({
    requestId: prepared.requestId,
    createdAt: startedAt,
    target: prepared.target,
    commandNo: prepared.commandNo,
    routeStatus: prepared.routeStatus,
    status: "pending",
    prompt: `${prepared.completion.system}\n\n${prepared.completion.user}`,
  });
  try {
    const provider = providerOverride ?? createOpenAiCompatibleProvider(prepared.settings);
    const raw = await provider.complete(prepared.completion, controller.signal, (partialRaw) => {
      if (controller.signal.aborted) return;
      const partialLines = parsePartialAiKojoResponse(partialRaw);
      if (partialLines.length > 0) onPartialLines?.(partialLines);
    });
    if (controller.signal.aborted) throw new Error("AI request cancelled");
    const lines = parseAiKojoResponse(raw);
    useAiStore.getState().patchCommandHistory(prepared.historyEntryId, {
      aiLines: lines.map((line) => line.text),
    });
    useAiStore.getState().patchDebugEntry(prepared.requestId, {
      status: "success",
      durationMs: Date.now() - startedAt,
      response: raw,
    });
    return lines;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    useAiStore.getState().patchDebugEntry(prepared.requestId, {
      status: cancelled ? "cancelled" : "error",
      durationMs: Date.now() - startedAt,
      error: cancelled
        ? controller.signal.reason === "timeout" ? "AI request timed out" : "AI request cancelled"
        : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(prepared.requestId);
  }
}

export function cancelRealtimeAiKojo(requestId: string): void {
  activeControllers.get(requestId)?.abort("cancelled");
}

export function cancelAllRealtimeAiKojo(): void {
  for (const controller of activeControllers.values()) controller.abort("cancelled");
  activeControllers.clear();
}

export function resetAiKojoRuntimeForTests(): void {
  for (const controller of activeControllers.values()) controller.abort("test-reset");
  activeControllers.clear();
  providerOverride = null;
  serial = 0;
  useAiStore.getState().resetEphemeral();
}
