import type { GameState } from "../../../modernization/runtime/state/index.js";
import { issueHookGrant } from "../../../modernization/runtime/story/dialogue-hook.js";
import type { DialogueActionInput } from "../../../modernization/runtime/ai-state/dialogue-action.js";
import type { AiSettings } from "./types.js";
import { createDialogueActionJudge, createJevDialogueActionJudge } from "./dialogue-action.js";
import type { Outcome } from "../../../modernization/runtime/command/types.js";
import type { PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import type { KojoResolution } from "../../../modernization/runtime/kojo/types.js";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { isKojoAiFallbackEligible } from "../../../modernization/runtime/kojo/ai-fallback.js";
import { readKojoResolveStats, resetKojoResolveStats } from "../../../modernization/runtime/kojo/stats.js";
import { hasRelationshipDialogueState } from "../../../modernization/runtime/state/dialogue-context.js";
import { CFLAG_ID, TALENT_ID } from "../../../modernization/runtime/state/settlement.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { afterAffairNarration } from "../../../modernization/runtime/world/after-affair.js";
import { compileAgentActionOffers } from "../../../modernization/runtime/agent/action-offers.js";
import type { AgentActionProposalV1 } from "../../../modernization/runtime/agent/action-offers.js";
import { counterActionById } from "../../../modernization/runtime/command/counter/counter-actions.js";
import commandsBundle from "../game/commands.bundle.json";
import { familyIdOf } from "../game/command-families.js";
import { buildAiKojoCompletion, commandLabel, visibleHistoryLines } from "./context.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { formatCompletionPrompt } from "./completion-messages.js";
import { parseAiKojoActionProposal, parseAiKojoDocument, parseAiKojoRelationshipProposal, validateAiKojoDocument, createAiKojoStreamParser } from "./response-validator.js";
import { storyInteractionGrants } from "../../../modernization/runtime/story/interaction-progress.js";
import { completeWithStateContext } from "./state-context.js";
import { issueRelationshipGrant } from "../../../modernization/runtime/ai-state/relationship.js";
import { currentAiCharacterProfile, currentAiSettings, useAiStore } from "./store.js";
import { currentSceneAmbientSession } from "./ambient-store.js";
import type {
  AiCommandHistoryEntry,
  AiGeneratedLine,
  AiProvider,
  AiRouteStatus,
  PreparedAiKojoRequest,
} from "./types.js";

const COMMANDS = commandsBundle as Record<string, { label?: string }>;
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
const dialogueActionControllers = new Map<string, AbortController>();
let serial = 0;
let providerOverride: AiProvider | null = null;

/** UI-only test command identity. It is never registered in CommandCatalog. */
export const AI_CHAT_COMMAND_NO = 19986;
export const AI_CHAT_SEMANTIC_MAX_LENGTH = 1_000;

function nextId(prefix: string): string {
  serial += 1;
  return `${prefix}:${Date.now()}:${serial}`;
}

/** P0 探针：准备窗口内的求值/clone 计数并入 debug entry timings。
 * 未知键不进 requestSegments 标签，诊断页原始数据可见。 */
function resolutionStatsTimings(prepared: PreparedAiKojoRequest): Record<string, number> {
  if (!prepared.resolutionStats) return {};
  return {
    resolutionCalls: prepared.resolutionStats.resolveCalls,
    resolveMs: Math.round(prepared.resolutionStats.resolveMs),
    cloneCalls: prepared.resolutionStats.cloneCalls,
  };
}

export function configureAiProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

export interface RecordCommandInput {
  target: number;
  commandNo: number;
  outcome: Outcome;
  state: Readonly<GameState>;
  /** Selected command identity before a toggle changes its next menu label. */
  beforeState?: Readonly<GameState>;
  events: readonly ObservationEvent[];
}

export function recordAiCommand(input: RecordCommandInput): AiCommandHistoryEntry {
  const visibleEvents = visibleHistoryLines(input.events, input.state);
  const sceneEpoch = currentSceneAmbientSession()?.sceneEpoch ?? 0;
  const entry: AiCommandHistoryEntry = {
    id: nextId("history"),
    source: "command",
    target: input.target,
    targetName: input.state.charas[input.target]?.callName ?? `角色${input.target}`,
    commandNo: input.commandNo,
    commandLabel: commandLabel(input.commandNo, input.beforeState, input.target),
    timestamp: Date.now(),
    location: input.state.master.location,
    sceneEpoch,
    gameTick: input.state.time.tickValue,
    participantIds: input.target > 0 ? [input.target] : [],
    witnessIds: Object.values(input.state.charas)
      .filter((slot) => slot.charaNum > 0 && slot.charaNum !== input.target && slot.location === input.state.master.location)
      .map((slot) => slot.charaNum),
    outcome: input.outcome,
    visibleEvents,
    aiLines: [],
    visibleLines: visibleEvents,
  };
  useAiStore.getState().addInteractionHistory(entry);
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
  /** C 切片：settle 段已求出的当前命令 resolution（collectCommandKojo 实际
   *  产出 transcript 的那份）。提供时 eligibility 直接复用，缺失时回退重算
   *  （bespoke handler 自采口上的命令走回退）。 */
  authoredResolution?: KojoResolution;
}

export interface PrepareAiDateInvitationInput {
  target: number;
  beforeState: Readonly<GameState>;
  afterState: Readonly<GameState>;
  events: readonly ObservationEvent[];
  router: DialogueRouter;
  seed: number;
}

export interface PrepareAiChatInput {
  target: number;
  state: Readonly<GameState>;
  semantic: string;
  router: DialogueRouter;
  seed: number;
}

export interface PreparedAiChatRequest extends PreparedAiKojoRequest {
  playerEvent: Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>;
}

export interface AiEligibility {
  eligible: boolean;
  reason: string;
  kojoStatus?: string;
}

export interface PrepareAiCounterKojoInput {
  target: number;
  action: number;
  commandNo: number;
  beforeState: Readonly<GameState>;
  afterState: Readonly<GameState>;
  events: readonly ObservationEvent[];
  router: DialogueRouter;
  historyEntryId: string;
  seed: number;
}

/** COM999's H finish is an EVENT15 sequence, not a COM999 personal route. */
function hFinishResolution(input: PrepareAiKojoInput): KojoResolution | null {
  if (input.commandNo !== 999 || !input.router.resolveEventKojoDetailed) return null;
  const fluidDetail = afterAffairNarration(input.afterState, input.target, 0).fluidKojoDetail;
  const details = [...(fluidDetail ? [fluidDetail] : []), 3, 4] as const;
  const resolutions = details.map((detail) => input.router.resolveEventKojoDetailed!(
    input.target,
    15,
    input.afterState,
    createRng(input.seed + detail),
    [3, detail],
  ));
  const ending = input.router.resolveEventKojoDetailed(
    input.target,
    15,
    input.afterState,
    createRng(input.seed + 99),
    [2, 0],
  );
  const all = [...resolutions, ending];
  const firstBlocking = all.find((route) => route.status === "gated" || route.status === "unsupported");
  if (firstBlocking) return firstBlocking;
  if (all.some((route) => route.status === "resolved" || route.status === "partial")) {
    return all.find((route) => route.status === "resolved" || route.status === "partial")!;
  }
  return all[0]!;
}

function routeResolution(input: PrepareAiKojoInput): KojoResolution {
  return hFinishResolution(input) ?? input.authoredResolution ?? input.router.collectDetailed!(
    input.target,
    input.commandNo,
    input.afterState,
    createRng(input.seed),
  );
}

export interface CollectAuthoredVoiceSamplesInput {
  sampleLimit?: number;
  scanLimit?: number;
  router: DialogueRouter;
  state: Readonly<GameState>;
  target: number;
  seed: number;
  excludeCommandNo?: number;
  /** Prefer authored examples from the same command family as the live route. */
  preferredFamilyId?: string;
  /** Avoid relationship-gated player-facing samples for NPC-public prompts. */
  publicOnly?: boolean;
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

function catalogCommandsForFamily(familyId: string): number[] {
  return Object.keys(COMMANDS)
    .map(Number)
    .filter((commandNo) => Number.isSafeInteger(commandNo) && familyIdOf(commandNo) === familyId);
}

/** Resolve complete authored interaction examples through the live router so
 * selectedKojoVariants is honored. Staged effects are intentionally ignored
 * and never committed. A too-long interaction is skipped as a whole rather
 * than cut into a misleading one-line fragment. */
export function collectAuthoredVoiceSamples(
  input: CollectAuthoredVoiceSamplesInput,
): string[] {
  return collectAuthoredVoiceSampleEntries(input)
    .map((entry) => formatAuthoredVoiceSample(entry, input.state, input.target));
}

interface AuthoredVoiceSampleEntry {
  commandNo: number;
  text: string;
}

/** Core scan (pure). Entries keep the authored interaction text plus the
 * source command so callers can format and filter per-request. */
function collectAuthoredVoiceSampleEntries(
  input: CollectAuthoredVoiceSamplesInput,
): AuthoredVoiceSampleEntry[] {
  if (!input.router.collectDetailed) return [];
  const relationshipFirst = !input.publicOnly && hasRelationshipVoiceState(input.state, input.target);
  const rng = createRng(input.seed ^ (input.target * 0x9e3779b9));
  const primaryCommands = relationshipFirst
    ? RELATION_VOICE_SAMPLE_COMMANDS
    : GENERAL_VOICE_SAMPLE_COMMANDS;
  const fallbackCommands = input.publicOnly
    ? []
    : relationshipFirst
    ? GENERAL_VOICE_SAMPLE_COMMANDS
    : RELATION_VOICE_SAMPLE_COMMANDS;
  const preferredCommands = input.preferredFamilyId
    ? catalogCommandsForFamily(input.preferredFamilyId)
    : [];
  const commands = [...new Set([
    ...shuffled(preferredCommands, rng),
    ...shuffled(primaryCommands, rng),
    ...shuffled(fallbackCommands, rng),
  ])];
  const entries: AuthoredVoiceSampleEntry[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  for (const sampleCommand of commands) {
    if (entries.length >= (input.sampleLimit ?? AUTHORED_SAMPLE_LIMIT) || scanned >= (input.scanLimit ?? commands.length)) break;
    if (sampleCommand === input.excludeCommandNo) continue;
    scanned++;
    const sample = input.router.collectDetailed(
      input.target,
      sampleCommand,
      input.state,
      createRng(input.seed + sampleCommand * 97 + rng.int(10_000)),
      { probeReadonly: true },
    );
    if (sample.status !== "resolved") continue;
    const lines = sample.lines
      .map((line) => line.text.trim())
      .filter((text) => text.length > 0 && text.length <= 180);
    if (lines.length === 0) continue;
    const interaction = lines.join(" / ");
    if (interaction.length > MAX_AUTHORED_SAMPLE_LENGTH || seen.has(interaction)) continue;
    seen.add(interaction);
    entries.push({ commandNo: sampleCommand, text: interaction });
  }
  return entries;
}

function formatAuthoredVoiceSample(
  entry: AuthoredVoiceSampleEntry,
  state: Readonly<GameState>,
  target: number,
): string {
  return `${state.charas[target]?.callName ?? `角色${target}`}（作者互动口上样例 [${entry.commandNo}]${commandLabel(entry.commandNo)}）：${entry.text}`;
}

/** B 切片（AI-PREPARE-PERF-PLAN.md §4.B）：声线样本缓存。采样目的是教语气，
 * 对请求间的微弱状态变化不敏感；命中窗口内样本不再随请求 seed 轮换，记为
 * 有意偏差（seed 轮换保留在 rhythm_hint 等创作信号处）。 */
const VOICE_SAMPLE_CACHE_LIMIT = 64;
const voiceSampleCache = new Map<string, AuthoredVoiceSampleEntry[]>();

/** 关系档位签名：与 hasRelationshipDialogueState 同一组 TALENT，决定
 * relationshipFirst 与各命令的关系分支真值。 */
const RELATIONSHIP_VOICE_TALENT_IDS = [
  TALENT_ID.思慕, TALENT_ID.恋慕, TALENT_ID.炮友, TALENT_ID.愛欲, TALENT_ID.恋人,
] as const;

function voiceSampleCacheKey(input: CollectAuthoredVoiceSamplesInput): string | null {
  const slot = input.state.charas[input.target];
  if (!slot) return null;
  const relSig = RELATIONSHIP_VOICE_TALENT_IDS
    .map((id) => ((slot.state.TALENT[id] ?? 0) !== 0 ? 1 : 0))
    .join("");
  const memory = input.state.kojoMemory?.[input.target];
  const memorySig = `${Object.keys(memory?.firstTime ?? {}).length}:${Object.keys(memory?.once ?? {}).length}`;
  return [
    input.target,
    input.preferredFamilyId ?? "",
    input.publicOnly ? 1 : 0,
    relSig,
    memorySig,
    input.state.time.dayIndex,
    input.sampleLimit ?? AUTHORED_SAMPLE_LIMIT,
    input.scanLimit ?? "",
  ].join("|");
}

/** Cached variant for the AI prepare paths: a cache hit skips the whole
 * command scan. `excludeCommandNo` is applied after retrieval so the cache
 * stays request-independent (a fresh scan would refill past the excluded
 * command — an accepted deviation for style examples). */
export function cachedAuthoredVoiceSamples(input: CollectAuthoredVoiceSamplesInput): string[] {
  const key = voiceSampleCacheKey(input);
  if (key === null) {
    return collectAuthoredVoiceSampleEntries(input)
      .filter((entry) => entry.commandNo !== input.excludeCommandNo)
      .map((entry) => formatAuthoredVoiceSample(entry, input.state, input.target));
  }
  const hit = voiceSampleCache.get(key);
  if (hit) {
    return hit
      .filter((entry) => entry.commandNo !== input.excludeCommandNo)
      .map((entry) => formatAuthoredVoiceSample(entry, input.state, input.target));
  }
  const entries = collectAuthoredVoiceSampleEntries(input);
  if (voiceSampleCache.size >= VOICE_SAMPLE_CACHE_LIMIT) voiceSampleCache.clear();
  voiceSampleCache.set(key, entries);
  return entries
    .filter((entry) => entry.commandNo !== input.excludeCommandNo)
    .map((entry) => formatAuthoredVoiceSample(entry, input.state, input.target));
}

const AMBIENT_SAMPLE_LIMIT = 3;
const AMBIENT_SAMPLE_ATTEMPT_LIMIT = 12;
const AMBIENT_SAMPLE_YIELD_BATCH = 4;

function yieldAmbientPreparation(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Ambient preparation cancelled"));
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Ambient preparation cancelled"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 0);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Scene ambience is optional presentation work. Resolve only a small bounded
 * sample set and yield between router batches so a player click can interrupt
 * preparation instead of waiting behind synchronous collectDetailed calls.
 */
export async function collectAuthoredVoiceSamplesAsync(
  input: CollectAuthoredVoiceSamplesInput,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!input.router.collectDetailed) return [];
  const relationshipFirst = !input.publicOnly && hasRelationshipVoiceState(input.state, input.target);
  const rng = createRng(input.seed ^ (input.target * 0x9e3779b9));
  const primaryCommands = relationshipFirst
    ? RELATION_VOICE_SAMPLE_COMMANDS
    : GENERAL_VOICE_SAMPLE_COMMANDS;
  const fallbackCommands = input.publicOnly
    ? []
    : relationshipFirst
    ? GENERAL_VOICE_SAMPLE_COMMANDS
    : RELATION_VOICE_SAMPLE_COMMANDS;
  const preferredCommands = input.preferredFamilyId
    ? catalogCommandsForFamily(input.preferredFamilyId)
    : [];
  const commands = [...new Set([
    ...shuffled(preferredCommands, rng),
    ...shuffled(primaryCommands, rng),
    ...shuffled(fallbackCommands, rng),
  ])];
  const samples: string[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  for (const sampleCommand of commands) {
    if (sampleCommand === input.excludeCommandNo || samples.length >= AMBIENT_SAMPLE_LIMIT) continue;
    if (attempts >= AMBIENT_SAMPLE_ATTEMPT_LIMIT) break;
    if (attempts > 0 && attempts % AMBIENT_SAMPLE_YIELD_BATCH === 0) {
      await yieldAmbientPreparation(signal);
    }
    if (signal?.aborted) throw new Error("Ambient preparation cancelled");
    attempts += 1;
    const sample = input.router.collectDetailed(
      input.target,
      sampleCommand,
      input.state,
      createRng(input.seed + sampleCommand * 97 + rng.int(10_000)),
      { probeReadonly: true },
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
  // Commission confirmation/refusal can be a successful presentation turn
  // without a gameplay delta, hence outcome="noop". Admit only those bespoke
  // routes that supplied their actual IRAI resolution; arbitrary no-op
  // commands remain ineligible.
  const successfulCommissionPresentation = input.outcome === "noop" &&
    (input.commandNo === 366 || input.commandNo === 367) && input.authoredResolution !== undefined;
  if (input.outcome !== "ok" && !successfulCommissionPresentation) {
    return { eligible: false, reason: `command outcome is ${input.outcome}` };
  }
  const authoredDialogueProduced = input.events.some((event) => event.kind === "DIALOGUE_LINE");
  if (authoredDialogueProduced) {
    if (!settings.fullAiKojoEnabled) {
      return { eligible: false, reason: "authored dialogue already produced output", kojoStatus: "resolved" };
    }
    if (!input.router.collectDetailed) {
      return { eligible: false, reason: "dialogue router cannot prove authored route status" };
    }
    const authoredResolution = routeResolution(input);
    if (authoredResolution.status !== "resolved"
      || authoredResolution.lines.length === 0
      || authoredResolution.unsupportedPredicates.length > 0
      || authoredResolution.unsupportedEffects.length > 0
      || authoredResolution.diagnostics.length > 0) {
      return {
        eligible: false,
        reason: `authored route status ${authoredResolution.status} is not replaceable`,
        kojoStatus: authoredResolution.status,
      };
    }
    return {
      eligible: true,
      reason: "full AI mode uses resolved authored dialogue as reference",
      kojoStatus: "authored-reference",
    };
  }
  if (!input.authoredResolution && !input.router.collectDetailed) {
    return { eligible: false, reason: "dialogue router cannot prove route status" };
  }
  const resolution = routeResolution(input);
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
  // A Runtime-owned story expression is separate from full-AI authored replacement.
  if (input.commandNo === 300 && input.afterState.narrativeHooks?.some(h => h.lastReceipt
    && h.lastReceipt.sessionId !== input.beforeState?.narrativeHooks?.find(old => old.id === h.id)?.lastReceipt?.sessionId
    && h.lastReceipt.expressedAtTick === input.afterState.time.tickValue
    && h.speakerId === input.target && h.lastReceipt.disposition === "raise")) return null;
  resetKojoResolveStats();
  const eligibility = inspectAiKojoEligibility(input);
  if (!eligibility.eligible) return null;
  const settings = currentAiSettings();
  const routeStatus: AiRouteStatus = eligibility.kojoStatus === "unsupported"
    ? "unsupported"
    : eligibility.kojoStatus === "authored-empty"
      ? "authored-empty"
      : eligibility.kojoStatus === "authored-reference"
        ? "authored-reference"
        : "not-authored";
  const presentationMode = routeStatus === "authored-reference" ? "replace-authored" : "supplement";
  const requestId = nextId("ai-kojo");
  const sessionId = `command:${requestId}`;
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.afterState,
    target: input.target,
    seed: input.seed,
    excludeCommandNo: input.commandNo,
    preferredFamilyId: familyIdOf(input.commandNo),
  });
  const currentAuthoredReferenceLines: string[] = [];
  let currentAuthoredReferenceLength = 0;
  for (const event of input.events) {
    if (event.kind !== "DIALOGUE_LINE" || currentAuthoredReferenceLines.length >= AUTHORED_SAMPLE_LIMIT) continue;
    const name = input.afterState.charas[event.charaNum]?.callName ?? `角色${event.charaNum}`;
    const line = `${name}：${event.text.trim()}`;
    if (line.length <= name.length + 1 || line.length > 180) continue;
    if (currentAuthoredReferenceLength + line.length > MAX_AUTHORED_SAMPLE_LENGTH) break;
    currentAuthoredReferenceLines.push(line);
    currentAuthoredReferenceLength += line.length;
  }
  const visibleEventsOnSuccess = visibleHistoryLines(
    presentationMode === "replace-authored"
      ? input.events.filter((event) => event.kind !== "DIALOGUE_LINE")
      : input.events,
    input.afterState,
  );
  const resolutionStats = readKojoResolveStats();
  return {
    storyGrants: settings.narrativeEnabled ? storyInteractionGrants(input.afterState, input.target) : [],
    storyEvidenceOrigin: { tick: input.afterState.time.tickValue, location: input.afterState.master.location },
    requestId,
    sessionId,
    target: input.target,
    commandNo: input.commandNo,
    routeStatus,
    presentationMode,
    visibleEventsOnSuccess,
    historyEntryId: input.historyEntryId,
    settings,
    resolutionStats,
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
      currentAuthoredReferenceLines,
    }),
  };
}

/** A dedicated story route, independent of authored fallback/full-AI replacement switches. */
export function prepareNarrativeHookDialogue(input: PrepareAiKojoInput): PreparedAiKojoRequest | null {
  const settings = currentAiSettings();
  if (input.commandNo !== 300 || input.outcome !== "ok" || !settings.enabled || !settings.baseUrl.trim()
    || !settings.model.trim() || !currentAiCharacterProfile(input.target).enabled) return null;
  const requestId = nextId("story-hook");
  const sessionId = `command:${requestId}`;
  const hookGrant = issueHookGrant(input.afterState, input.target, 300, sessionId);
  if (!hookGrant) return null;
  return { requestId, sessionId, target: input.target, commandNo: 300, hookGrant,
    storyGrants: settings.narrativeEnabled ? storyInteractionGrants(input.afterState, input.target) : [],
    storyEvidenceOrigin: { tick: input.afterState.time.tickValue, location: input.afterState.master.location },
    routeStatus: "story-hook", presentationMode: "supplement", historyEntryId: input.historyEntryId,
    visibleEventsOnSuccess: visibleHistoryLines(input.events, input.afterState), settings,
    completion: buildAiKojoCompletion({ requestId, historyEntryId: input.historyEntryId, target: input.target,
      commandNo: 300, beforeState: input.beforeState, afterState: input.afterState, events: input.events,
      settings, routeStatus: "story-hook", voiceSamples: [] }) };
}

/** Presentation-only expression for an already-settled EVENT_COUNTER action.
 * Normal AI-kojo mode fills a genuinely silent personal route; full-AI mode
 * replaces a clean resolved personal route while retaining shared narration.
 * Gated/partial/unsupported routes remain fail-closed unless the existing M3
 * unsupported opt-in is explicitly enabled. */
export function prepareRealtimeAiCounterKojo(
  input: PrepareAiCounterKojoInput,
): PreparedAiKojoRequest | null {
  resetKojoResolveStats();
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.kojoEnabled || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (input.target <= 0 || !input.afterState.charas[input.target]) return null;
  if (!currentAiCharacterProfile(input.target).enabled) return null;
  const action = counterActionById(input.action);
  if (!action || !input.router.resolveCounterKojoDetailed) return null;

  const resolution = input.router.resolveCounterKojoDetailed(
    input.target,
    input.action,
    input.afterState,
    createRng(input.seed ^ Math.imul(input.action, 0x45d9f3b)),
  );
  const authoredLines = input.events.filter(
    (event): event is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> =>
      event.kind === "DIALOGUE_LINE" && event.charaNum === input.target,
  );
  const clean = resolution.unsupportedPredicates.length === 0 &&
    resolution.unsupportedEffects.length === 0 && resolution.diagnostics.length === 0;
  let routeStatus: AiRouteStatus;
  let presentationMode: PreparedAiKojoRequest["presentationMode"];
  if (authoredLines.length > 0) {
    if (!settings.fullAiKojoEnabled || resolution.status !== "resolved" || !clean) return null;
    routeStatus = "authored-reference";
    presentationMode = "replace-authored";
  } else if (resolution.status === "not-authored") {
    routeStatus = "not-authored";
    presentationMode = "supplement";
  } else if (resolution.status === "resolved" && resolution.lines.length === 0 && resolution.effects.length === 0 && clean) {
    routeStatus = "authored-empty";
    presentationMode = "supplement";
  } else if (settings.allowUnsupportedAuthored && resolution.status === "unsupported" && resolution.lines.length === 0) {
    routeStatus = "unsupported";
    presentationMode = "supplement";
  } else {
    return null;
  }

  const requestId = nextId("ai-counter-kojo");
  const currentAuthoredReferenceLines = authoredLines
    .slice(0, AUTHORED_SAMPLE_LIMIT)
    .map((event) => `${input.afterState.charas[input.target]?.callName ?? `角色${input.target}`}：${event.text.trim()}`)
    .filter((line) => line.length <= 180);
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.afterState,
    target: input.target,
    seed: input.seed,
    preferredFamilyId: familyIdOf(input.commandNo),
  });
  const resolutionStats = readKojoResolveStats();
  return {
    requestId,
    sessionId: `event:${requestId}`,
    target: input.target,
    commandNo: input.commandNo,
    routeStatus,
    presentationMode,
    visibleEventsOnSuccess: visibleHistoryLines(
      presentationMode === "replace-authored"
        ? input.events.filter((event) => event.kind !== "DIALOGUE_LINE")
        : input.events,
      input.afterState,
    ),
    historyEntryId: input.historyEntryId,
    settings,
    resolutionStats,
    feature: "counter-kojo",
    recordHistory: false,
    completion: buildAiKojoCompletion({
      requestId,
      historyEntryId: input.historyEntryId,
      target: input.target,
      commandNo: input.commandNo,
      beforeState: input.beforeState,
      afterState: input.afterState,
      events: input.events,
      settings,
      routeStatus,
      voiceSamples,
      currentAuthoredReferenceLines,
      counterAction: { id: action.id, label: action.label },
    }),
  };
}

/** Presentation-only fallback for the NPC-initiated EVENT 27 opening arm.
 * Only a genuinely absent route is eligible; gated, unsupported and authored
 * empty branches retain the author's fail-closed decision. */
export function prepareRealtimeAiDateInvitation(
  input: PrepareAiDateInvitationInput,
): PreparedAiKojoRequest | null {
  resetKojoResolveStats();
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.kojoEnabled || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (input.target <= 0 || !input.afterState.charas[input.target]) return null;
  if (!currentAiCharacterProfile(input.target).enabled) return null;
  const resolution = input.router.resolveEventKojoDetailed?.(
    input.target,
    27,
    input.afterState,
    createRng(input.seed),
    [0, 0],
  );
  if (!resolution || resolution.status !== "not-authored") return null;

  const requestId = nextId("ai-date-invitation");
  const historyEntryId = nextId("history-date-invitation");
  const commandNo = 19987;
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.afterState,
    target: input.target,
    seed: input.seed,
    publicOnly: true,
  });
  const resolutionStats = readKojoResolveStats();
  return {
    requestId,
    sessionId: `event:${requestId}`,
    target: input.target,
    commandNo,
    routeStatus: "not-authored",
    presentationMode: "supplement",
    visibleEventsOnSuccess: visibleHistoryLines(input.events, input.afterState),
    historyEntryId,
    settings,
    resolutionStats,
    completion: buildAiKojoCompletion({
      requestId,
      historyEntryId,
      target: input.target,
      commandNo,
      beforeState: input.beforeState,
      afterState: input.afterState,
      events: input.events,
      settings,
      routeStatus: "not-authored",
      voiceSamples,
    }),
  };
}

/** Presentation-only fallback for world EVENT kojo (潜入/被赶出等场景).
 * These events fire from runtime world logic (sneak-in, kick-out, scheduler)
 * rather than command settlement, so they need a separate preparation path.
 * Only genuinely not-authored routes are eligible; gated/unsupported routes
 * remain fail-closed. */
export function prepareRealtimeAiEventKojo(
  input: import("./types.js").PrepareAiEventKojoInput,
): PreparedAiKojoRequest | null {
  resetKojoResolveStats();
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.kojoEnabled || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (input.target <= 0 || !input.state.charas[input.target]) return null;
  if (!currentAiCharacterProfile(input.target).enabled) return null;

  // Check if authored kojo exists for this EVENT
  const resolution = input.router.resolveEventKojoDetailed?.(
    input.target,
    input.eventArm,
    input.state,
    createRng(input.seed),
    input.eventSub,
  );
  if (!resolution || resolution.status !== "not-authored") return null;

  const requestId = nextId(`ai-event-${input.context}`);
  const historyEntryId = nextId(`history-event-${input.context}`);
  // Use a pseudo command number to distinguish event types in history
  const commandNo = 19900 + input.eventArm;
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.state,
    target: input.target,
    seed: input.seed,
    publicOnly: false, // 事件口上可以包含关系相关的语气
  });
  const resolutionStats = readKojoResolveStats();

  // Build events list for context (typically empty for EVENT kojo)
  const events: ObservationEvent[] = [];

  return {
    requestId,
    sessionId: `event:${requestId}`,
    target: input.target,
    commandNo,
    routeStatus: "not-authored",
    presentationMode: "supplement",
    visibleEventsOnSuccess: [],
    historyEntryId,
    settings,
    resolutionStats,
    completion: buildAiKojoCompletion({
      requestId,
      historyEntryId,
      target: input.target,
      commandNo,
      beforeState: input.state,
      afterState: input.state,
      events,
      settings,
      routeStatus: "not-authored",
      voiceSamples,
      // Add event context description to help AI understand the situation
      contextOverride: input.contextDescription,
    }),
  };
}

// ---------------------------------------------------------------------------
// Witness kojo — 在场者对无 target 命令的即兴反应（Fix 3 / 2026-09-17）
// ---------------------------------------------------------------------------

/** Per-character daily cap: witness reactions must not inflate provider load
 * on target-less command spam (prayer/omikuji/stall loops). */
const WITNESS_DAILY_LIMIT = 3;
const witnessDailyCounts = new Map<number, Map<number, number>>();

export function resetWitnessDailyCountsForTests(): void {
  witnessDailyCounts.clear();
}

/**
 * Deterministically pick the bystander who reacts to a target-less command:
 * awake co-located NPCs with an enabled AI profile, 同行 (follower) first,
 * then by charaNum ascending. Deliberately RNG-free — the selection must be
 * reproducible from the state alone, and no 好感 seam exists in this module
 * (affinity ordering is a documented defer, see the plan).
 */
export function selectWitnessSpeaker(state: Readonly<GameState>): number | null {
  const location = state.master.location;
  const candidates = Object.values(state.charas)
    .filter((slot) => slot && slot.charaNum > 0 && slot.location === location)
    .filter((slot) => (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0)
    .filter((slot) => currentAiCharacterProfile(slot.charaNum).enabled)
    .sort((left, right) => {
      const leftFollowing = (left.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0 ? 0 : 1;
      const rightFollowing = (right.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0 ? 0 : 1;
      return leftFollowing - rightFollowing || left.charaNum - right.charaNum;
    });
  return candidates[0]?.charaNum ?? null;
}

/** Presentation-only witness reaction to a target-less command (神签/摆摊/
 * 道具自用 …). Authored routes are skipped entirely: collectDetailed(witness,
 * commandNo) would mis-parse the command as one aimed AT the witness, so the
 * route status is pinned to not-authored/supplement. No history entry is
 * recorded (the command's own transcript is the context; a pseudo commandNo
 * would pollute the history stream). */
export function prepareRealtimeAiWitnessKojo(
  input: import("./types.js").PrepareAiWitnessKojoInput,
): PreparedAiKojoRequest | null {
  resetKojoResolveStats();
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.kojoEnabled || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (input.commandNo === 621) return null;

  const target = selectWitnessSpeaker(input.afterState);
  if (target === null || !input.afterState.charas[target]) return null;

  const dayIndex = input.afterState.time.dayIndex;
  // Bound the counter's growth: older days can never count again.
  for (const key of witnessDailyCounts.keys()) {
    if (key < dayIndex - 1) witnessDailyCounts.delete(key);
  }
  const perDay = witnessDailyCounts.get(dayIndex) ?? new Map<number, number>();
  if ((perDay.get(target) ?? 0) >= WITNESS_DAILY_LIMIT) return null;

  const requestId = nextId("ai-witness-kojo");
  const historyEntryId = nextId("history-witness");
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.afterState,
    target,
    seed: input.seed,
    publicOnly: true,
  });
  const resolutionStats = readKojoResolveStats();
  const speaker = input.afterState.charas[target]!;
  const location = input.afterState.master.location;
  const contextDescription =
    `命令【${commandLabel(input.commandNo)}】（COM${input.commandNo}）刚刚在${location}发生，` +
    `你（${speaker.callName ?? `角色${target}`}）全程在旁边看到了。` +
    "对眼前所见做即兴反应：符合你性格的一句话，不要复述事件经过，不要替对方做决定。";

  perDay.set(target, (perDay.get(target) ?? 0) + 1);
  witnessDailyCounts.set(dayIndex, perDay);

  return {
    requestId,
    sessionId: `event:${requestId}`,
    target,
    commandNo: input.commandNo,
    routeStatus: "not-authored",
    presentationMode: "supplement",
    visibleEventsOnSuccess: [],
    historyEntryId,
    settings,
    resolutionStats,
    feature: "witness-kojo",
    recordHistory: false,
    completion: buildAiKojoCompletion({
      requestId,
      historyEntryId,
      target,
      commandNo: input.commandNo,
      beforeState: input.beforeState,
      afterState: input.afterState,
      events: input.events,
      settings,
      routeStatus: "not-authored",
      voiceSamples,
      contextOverride: contextDescription,
    }),
  };
}

/** Prepare an explicit player-authored AI chat turn. Unlike ordinary command
 * completion this route has no CommandCatalog entry, authored-route gate or
 * deterministic settlement. The text is bounded, then passed verbatim as the
 * semantic target of the character response. */
export function prepareRealtimeAiChat(input: PrepareAiChatInput): PreparedAiChatRequest | null {
  const preparationStarted = performance.now();
  resetKojoResolveStats();
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (input.target <= 0 || !input.state.charas[input.target]) return null;
  if (!currentAiCharacterProfile(input.target).enabled) return null;
  const semantic = input.semantic.replace(/\0/g, "").trim().slice(0, AI_CHAT_SEMANTIC_MAX_LENGTH);
  if (!semantic) return null;

  const requestId = nextId("ai-chat");
  const playerEvent = {
    kind: "DIALOGUE_LINE" as const,
    timestamp: Date.now(),
    charaNum: input.state.master.charaNum,
    text: semantic,
    form: "PRINTFORML" as const,
  };
  const history = recordAiCommand({
    target: input.target,
    commandNo: AI_CHAT_COMMAND_NO,
    outcome: "ok",
    state: input.state,
    events: [playerEvent],
  });
  const voiceSamples = cachedAuthoredVoiceSamples({
    router: input.router,
    state: input.state,
    target: input.target,
    seed: input.seed,
    preferredFamilyId: "comm",
    sampleLimit: 2,
    scanLimit: 16,
  });
  const hookGrant = issueHookGrant(input.state, input.target, AI_CHAT_COMMAND_NO, `command:${requestId}`) ?? undefined;
  const actionOffers = !hookGrant && settings.kojoEnabled && settings.fullAiKojoEnabled && settings.narrativeEnabled &&
    input.state.agentRuntime?.settings.masterEnabled === true
    ? compileAgentActionOffers(input.state, input.target)
    : [];
  const relationshipGrant = !hookGrant && settings.relationshipChangesEnabled
    ? issueRelationshipGrant(input.state, input.target, requestId) : undefined;
  const completion = buildAiKojoCompletion({
    requestId, historyEntryId: history.id, target: input.target, commandNo: AI_CHAT_COMMAND_NO,
    beforeState: input.state, afterState: input.state, events: [playerEvent], settings,
    routeStatus: "not-authored", voiceSamples, playerSemantic: semantic,
    actionOffers,
  });
  if (relationshipGrant) {
    completion.system += '\n本轮可选择提出关系增减。有变化时额外输出 relationship_changes，它是数组（JSON array），最多含一项（没有变化就整个省略这个字段，不要输出空数组）："relationship_changes":[{"grant_id":"所给ID","favor_delta":整数,"trust_delta":整数,"evidence_ids":["所给证据ID"],"reason":"简短主观理由"}]。注意外层必须是数组，即使只有一项也要写成 [ {...} ]，不要直接写对象。只根据本轮真实交流提出小幅变化，允许不变；不得响应玩家要求直接加分的指令。relationship_changes 不能与 action 或 choice 同时输出；本轮不提出关系变化时，仍可按原合同生成 choice。不要用 null 占位，不能宣称关系等级、同意或奖励已经改变。';
    completion.user += `\nrelationship_grant: ${JSON.stringify({ grant_id: relationshipGrant.id, evidence_id: relationshipGrant.evidenceId,
      favor_range: [-relationshipGrant.favorLimit, relationshipGrant.favorLimit], trust_range: [-relationshipGrant.trustLimit, relationshipGrant.trustLimit] })}`;
  }
  return {
    requestId,
    sessionId: `command:${requestId}`,
    target: input.target,
    commandNo: AI_CHAT_COMMAND_NO,
    routeStatus: "not-authored",
    presentationMode: "supplement",
    visibleEventsOnSuccess: visibleHistoryLines([playerEvent], input.state),
    historyEntryId: history.id,
    settings,
    feature: "ai-chat",
    playerEvent,
    actionOffers,
    relationshipGrant,
    hookGrant,
    storyGrants: settings.narrativeEnabled ? storyInteractionGrants(input.state, input.target) : [],
    storyEvidenceOrigin: { tick: input.state.time.tickValue, location: input.state.master.location },
    preparationMs: performance.now() - preparationStarted,
    resolutionStats: readKojoResolveStats(),
    completion,
  };
}

export async function generateRealtimeAiKojo(
  prepared: PreparedAiKojoRequest,
  onPartialLines?: (lines: AiGeneratedLine[]) => void,
  onActionProposal?: (proposal: AgentActionProposalV1) => void,
  onRelationshipProposal?: (proposal: unknown) => void,
  onHookResult?: (result: unknown) => void,
  onStoryProgress?: (result: unknown) => void,
): Promise<AiGeneratedLine[]> {
  const startedAt = Date.now();
  const controller = new AbortController();
  activeControllers.set(prepared.requestId, controller);
  const timeout = setTimeout(() => controller.abort("timeout"), prepared.settings.timeoutMs);
  useAiStore.getState().addDebugEntry({
    requestId: prepared.requestId,
    createdAt: startedAt,
    feature: prepared.feature ?? "command-kojo",
    target: prepared.target,
    commandNo: prepared.commandNo,
    routeStatus: prepared.routeStatus,
    status: "pending",
    prompt: formatCompletionPrompt(prepared.completion),
    stateTrace: prepared.completion.stateContext?.trace,
    timings: { preparationMs: prepared.preparationMs ?? 0, stateContextMs: prepared.completion.stateContext?.durationMs ?? 0, ...resolutionStatsTimings(prepared) },
  });
  let rawResponse: string | undefined;
  let relationshipSkipReason: string | undefined;
  try {
    const provider = providerOverride ?? createOpenAiCompatibleProvider(prepared.settings);
    const streamParser = createAiKojoStreamParser();
    let lastPartialKey = "";
    let metrics: Record<string, number> = {};
    const raw = await completeWithStateContext(provider, prepared.completion, controller.signal, {
      onPartial: (partialRaw) => {
        if (controller.signal.aborted) return;
        const partialLines = streamParser(partialRaw);
        const last = partialLines.at(-1);
        const key = `${partialLines.length}:${last?.form}:${last?.text}`;
        if (last && key !== lastPartialKey) { lastPartialKey = key; onPartialLines?.(partialLines); }
      },
      onMetrics: value => { metrics = value; },
    });
    rawResponse = raw;
    if (controller.signal.aborted) throw new Error("AI request cancelled");
    const parseStarted = performance.now();
    const document = parseAiKojoDocument(raw);
    // Several JSON-mode providers emit optional fields as null despite being
    // told to omit them. Null carries no proposal, choice, or relationship
    // effect, so normalize it to absence before strict validation.
    for (const key of ["action", "choice", "relationship_changes"] as const) {
      if (document[key] === null) delete document[key];
    }
    const lines = validateAiKojoDocument(document);
    if (prepared.hookGrant && document.hookResult !== undefined) onHookResult?.(document.hookResult);
    if (prepared.storyGrants?.length && document.storyProgress !== undefined) onStoryProgress?.(document.storyProgress);
    // 关系提案是建议：形状不合规只丢弃提案，不连累已经通过校验的台词。
    // 真正的状态裁决在 settleRelationshipProposal（fail-closed）。
    const relationship = parseAiKojoRelationshipProposal(document, prepared.relationshipGrant !== undefined);
    if (relationship.status === "accepted") onRelationshipProposal?.(relationship.item);
    if (relationship.status === "skipped") relationshipSkipReason = relationship.reason;
    if (prepared.feature === "ai-chat" && prepared.actionOffers?.length) {
      const proposal = parseAiKojoActionProposal(raw, prepared.actionOffers, document);
      if (proposal) onActionProposal?.(proposal);
    }
    const aiLines = lines.map((line) => line.text);
    if (prepared.recordHistory !== false) {
      const historyEntry = useAiStore.getState().interactionHistory.find(
        (entry): entry is AiCommandHistoryEntry =>
          entry.id === prepared.historyEntryId && entry.source === "command",
      );
      useAiStore.getState().patchCommandHistory(prepared.historyEntryId, {
        aiLines,
        visibleLines: historyEntry
          ? prepared.presentationMode === "replace-authored"
            ? [...aiLines, ...prepared.visibleEventsOnSuccess]
            : [...historyEntry.visibleEvents, ...aiLines]
          : aiLines,
      });
    }
    useAiStore.getState().patchDebugEntry(prepared.requestId, {
      status: "success",
      durationMs: Date.now() - startedAt,
      response: raw,
      ...(relationshipSkipReason ? { skipReason: relationshipSkipReason } : {}),
      timings: { preparationMs: prepared.preparationMs ?? 0, stateContextMs: prepared.completion.stateContext?.durationMs ?? 0,
        ...metrics, ...resolutionStatsTimings(prepared), parseMs: performance.now() - parseStarted },
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
      ...(rawResponse !== undefined ? { response: rawResponse } : {}),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(prepared.requestId);
  }
}

/** Shares cancellation and provider injection with the owning free-chat request. */
export async function judgeRealtimeDialogueAction(
  input: DialogueActionInput, settings: AiSettings,
): Promise<unknown> {
  const controller = new AbortController();
  activeControllers.set(input.requestId, controller);
  dialogueActionControllers.set(input.requestId, controller);
  const timeout = setTimeout(() => controller.abort("action-judge-timeout"), Math.min(settings.timeoutMs, 12_000));
  let onAbort!: () => void;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("action judge cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const provider = providerOverride ?? createOpenAiCompatibleProvider({ ...settings, reasoningEffort: "off" });
    const judge = settings.dialogueActionProvider === "jev"
      ? createJevDialogueActionJudge(settings) : createDialogueActionJudge(provider);
    return await Promise.race([judge.judge(input, controller.signal), aborted]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener("abort", onAbort);
    if (activeControllers.get(input.requestId) === controller) activeControllers.delete(input.requestId);
    dialogueActionControllers.delete(input.requestId);
  }
}

export function cancelDialogueActionJudge(requestId: string): void {
  dialogueActionControllers.get(requestId)?.abort("action judge disabled");
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
  voiceSampleCache.clear();
  providerOverride = null;
  serial = 0;
  useAiStore.getState().resetEphemeral();
}
