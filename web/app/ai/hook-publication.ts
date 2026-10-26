import { cloneGameState, type GameState } from "../../../modernization/runtime/state/game-state.js";
import { commitHookReceipt, deferUnprocessedProgramHook } from "../../../modernization/runtime/story/dialogue-hook.js";
import { importLegacyMemories, prepareMemoryRecords } from "./memory-archive.js";
import type { AiGeneratedLine, PreparedAiKojoRequest } from "./types.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { recordStoryInteraction } from "../../../modernization/runtime/story/interaction-progress.js";

/** Formal choices come from accepted Runtime content, never a model-invented branch. */
export function hookReplyChoice(state: GameState, sessionId: string): AiGeneratedLine["aiChoice"] | undefined {
  const h = state.narrativeHooks?.find(h => h.status === "offered" && !h.playerResponse
    && h.lastReceipt?.disposition === "raise" && h.lastReceipt.sessionId === sessionId);
  return h?.responses ? { options: h.responses.map(r => ({ label: r.label,
    lines: r.lines.map(text => ({ text, form: "PRINTFORML" as const })) })) } : undefined;
}

export function attachHookChoice(state: GameState, sessionId: string, actor: number, transcript: readonly ObservationEvent[]): ObservationEvent[] {
  const choice = hookReplyChoice(state, sessionId);
  const last = transcript.reduce((found, event, index) => event.kind === "DIALOGUE_LINE" && event.charaNum === actor ? index : found, -1);
  return transcript.map((event, index) => choice && index === last && event.kind === "DIALOGUE_LINE" ? { ...event, aiChoice: choice } : event);
}

/** An already accepted Runtime fallback needs no provider or fabricated AI request. */
export async function prepareAcceptedHookPublication(state: GameState, hookId: string, isCurrent: () => boolean): Promise<GameState | null> {
  if (!isCurrent()) return null;
  const candidate = cloneGameState(state);
  const hook = candidate.narrativeHooks?.find(h => h.id === hookId);
  if (!hook?.lastReceipt || !hook.fallback) return null;
  recordStoryInteraction(candidate, { id: `accepted:${hook.lastReceipt.sessionId}`, sessionId: hook.lastReceipt.sessionId,
    speakerId: hook.speakerId, commandNo: 300, lines: hook.fallback.map(text => ({ text })) });
  if (candidate.agentRuntime?.settings.masterEnabled) {
    await importLegacyMemories(candidate);
    candidate.agentRuntime.memoryArchive = await prepareMemoryRecords(candidate.agentRuntime, [{
      kind: "ai-dialogue", charaNum: hook.speakerId, sourceId: `story-dialogue:${hook.lastReceipt.sessionId}`,
      sessionId: hook.lastReceipt.sessionId, dayIndex: candidate.time.dayIndex, tick: candidate.time.tickValue,
      location: candidate.master.location, lines: hook.fallback.map(text => ({ speaker: "character", text })),
      details: { origin: "accepted-fallback", hookReceipt: hook.lastReceipt },
    }]);
  }
  return isCurrent() ? candidate : null;
}

/** Prepare a detached story expression transaction. The caller publishes state and owner together. */
export async function prepareHookPublication(input: {
  state: GameState;
  prepared: PreparedAiKojoRequest;
  lines: readonly AiGeneratedLine[];
  result: unknown;
  isCurrent: () => boolean;
}): Promise<GameState | null> {
  if (!input.prepared.hookGrant || !input.isCurrent()) return null;
  const candidate = cloneGameState(input.state);
  const committed = commitHookReceipt(candidate, input.prepared.hookGrant, input.result,
    input.lines.map((line, index) => ({ id: `reply:${index}`, text: line.text })));
  if (!committed) deferUnprocessedProgramHook(candidate, input.prepared.hookGrant, "本次回复没有形成有效剧情表达");
  const hookReceipt = candidate.narrativeHooks?.find(h => h.id === input.prepared.hookGrant!.hookId)?.lastReceipt;
  if (candidate.agentRuntime?.settings.masterEnabled) {
    await importLegacyMemories(candidate);
    candidate.agentRuntime.memoryArchive = await prepareMemoryRecords(candidate.agentRuntime, [{
      kind: "ai-dialogue", charaNum: input.prepared.target, sourceId: `story-dialogue:${input.prepared.requestId}`,
      sessionId: input.prepared.sessionId, dayIndex: candidate.time.dayIndex, tick: candidate.time.tickValue,
      location: candidate.master.location, lines: input.lines.map(line => ({ speaker: "character", text: line.text })),
      details: { responseForms: input.lines.map(line => line.form),
        ...(hookReceipt?.sessionId === input.prepared.sessionId ? { hookReceipt } : {}) },
    }]);
  }
  return input.isCurrent() ? candidate : null;
}
