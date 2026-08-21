import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import type { AmbientInitiativeOpportunity } from "../../../modernization/runtime/world/ambient-initiative.js";
import { buildSceneAmbientCompletion } from "./ambient-context.js";
import { useSceneAmbientStore } from "./ambient-store.js";
import { parsePartialSceneAmbientResponse, parseSceneAmbientResponse } from "./ambient-validator.js";
import { collectAuthoredVoiceSamples } from "./kojo-runtime.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { currentAiCharacterProfile, currentAiSettings, useAiStore } from "./store.js";
import type {
  AiAmbientHistoryEntry,
  AiProvider,
  PreparedSceneAmbientRequest,
  SceneAmbientLine,
} from "./types.js";

let activeRequest: { requestId: string; controller: AbortController } | null = null;
let providerOverride: AiProvider | null = null;
let serial = 0;

export interface PrepareSceneAmbientInput {
  sceneEpoch: number;
  state: Readonly<GameState>;
  opportunity: AmbientInitiativeOpportunity;
  router: DialogueRouter;
  seed: number;
  visibleFacts?: readonly string[];
}

export function configureSceneAmbientProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

export function prepareSceneAmbientRequest(
  input: PrepareSceneAmbientInput,
): PreparedSceneAmbientRequest | null {
  const settings = currentAiSettings();
  if (!settings.enabled || !settings.ambientEnabled) return null;
  if (!settings.baseUrl.trim() || !settings.model.trim()) return null;
  if (activeRequest) return null;
  if (input.state.master.location !== input.opportunity.location) return null;
  if (!input.opportunity.participantIds.every((participantId) => {
    const slot = input.state.charas[participantId];
    return slot?.location === input.state.master.location && currentAiCharacterProfile(participantId).enabled;
  })) return null;

  serial += 1;
  const requestId = `ambient:${Date.now()}:${serial}`;
  const publicOnly = input.opportunity.kind === "npc-exchange";
  const voiceSamples = Object.fromEntries(input.opportunity.participantIds.map((participantId) => [
    participantId,
    publicOnly ? [] : collectAuthoredVoiceSamples({
      router: input.router,
      state: input.state,
      target: participantId,
      seed: input.seed ^ (participantId * 7919),
    }),
  ]));
  return {
    requestId,
    sceneEpoch: input.sceneEpoch,
    opportunity: input.opportunity,
    settings,
    completion: buildSceneAmbientCompletion({
      requestId,
      sceneEpoch: input.sceneEpoch,
      state: input.state,
      opportunity: input.opportunity,
      settings,
      voiceSamples,
      visibleFacts: input.visibleFacts,
    }),
  };
}

export async function generateSceneAmbient(
  prepared: PreparedSceneAmbientRequest,
  onPartialLines?: (lines: SceneAmbientLine[]) => void,
): Promise<SceneAmbientLine[]> {
  if (activeRequest) throw new Error("An ambient request is already active");
  const startedAt = Date.now();
  const controller = new AbortController();
  activeRequest = { requestId: prepared.requestId, controller };
  const timeout = setTimeout(() => controller.abort("timeout"), prepared.settings.timeoutMs);
  useAiStore.getState().addDebugEntry({
    requestId: prepared.requestId,
    createdAt: startedAt,
    feature: "ambient-initiative",
    participants: [...prepared.opportunity.participantIds],
    mode: prepared.opportunity.mode,
    trigger: prepared.opportunity.trigger,
    status: "pending",
    prompt: `${prepared.completion.system}\n\n${prepared.completion.user}`,
  });
  try {
    const provider = providerOverride ?? createOpenAiCompatibleProvider(prepared.settings);
    const raw = await provider.complete(prepared.completion, controller.signal, (partialRaw) => {
      if (controller.signal.aborted) return;
      const lines = parsePartialSceneAmbientResponse(partialRaw, prepared.opportunity);
      if (lines.length > 0) onPartialLines?.(lines);
    });
    if (controller.signal.aborted) throw new Error("Ambient request cancelled");
    const lines = parseSceneAmbientResponse(raw, prepared.opportunity);
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
        ? controller.signal.reason === "timeout" ? "Ambient request timed out" : "Ambient request cancelled"
        : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeRequest?.requestId === prepared.requestId) activeRequest = null;
  }
}

export function recordSceneAmbientHistory(input: {
  prepared: PreparedSceneAmbientRequest;
  state: Readonly<GameState>;
  lines: readonly SceneAmbientLine[];
}): AiAmbientHistoryEntry {
  const visibleLines = input.lines.map((line) => {
    const name = input.state.charas[line.participantId]?.callName ?? `#${line.participantId}`;
    return line.form === "speech" ? `${name}：${line.text}` : line.text;
  });
  const participantSet = new Set(input.prepared.opportunity.participantIds);
  const entry: AiAmbientHistoryEntry = {
    id: `ambient-history:${input.prepared.requestId}`,
    source: "ambient",
    timestamp: Date.now(),
    location: input.prepared.opportunity.location,
    sceneEpoch: input.prepared.sceneEpoch,
    gameTick: input.state.time.tickValue,
    participantIds: [...input.prepared.opportunity.participantIds],
    witnessIds: Object.values(input.state.charas)
      .filter((slot) =>
        slot.charaNum > 0 &&
        !participantSet.has(slot.charaNum) &&
        slot.location === input.state.master.location,
      )
      .map((slot) => slot.charaNum),
    visibleLines,
    mode: input.prepared.opportunity.mode,
    trigger: input.prepared.opportunity.trigger,
    initiativeKind: input.prepared.opportunity.kind,
  };
  useAiStore.getState().addInteractionHistory(entry);
  return entry;
}

export function cancelSceneAmbientRequest(requestId?: string): void {
  if (!activeRequest) return;
  if (requestId && activeRequest.requestId !== requestId) return;
  activeRequest.controller.abort("cancelled");
}

export function resetSceneAmbientRuntime(): void {
  activeRequest?.controller.abort("reset");
  activeRequest = null;
  providerOverride = null;
  serial = 0;
  useSceneAmbientStore.getState().resetSession();
}
