import type { ObservationEvent } from "../../schemas/types.js";
import { acceptExperience, ACCEPTED_EXPERIENCE_SCHEMA_VERSION } from "../experience.js";
import { cloneGameState, type GameState } from "../state/game-state.js";
import { advanceTimeTicks } from "../state/settlement.js";
import { setSlotLocation } from "../world/room-id-location.js";
import { scheduleWeatherIncident } from "../weather/narrative-incident.js";
import type { StoryAdvanceResult } from "./executor.js";
import type { RuntimeCapabilityOption, StoryGraphNodeV2, StoryProgramV2 } from "./types.js";
import { validateStoryProgramV2 } from "./validator-v2.js";
import { reconcileNarrativeState } from "./reconciliation.js";
import { ensureArcMaintenance } from "./arc-maintenance.js";
import { buildStoryBeatExperience, recordArcScene } from "./story-beat.js";
import { projectDaytimeAgentFacts } from "../agent/daytime-sync.js";
import { advanceProgramDialogue, programDialogueHookId } from "./program-dialogue.js";
import { narrativeCastWaitReason } from "./attendance.js";
import { hasPendingStoryInteraction, recordStoryInteraction } from "./interaction-progress.js";
import { narrativeContextHash } from "./snapshot.js";

function nextNodeId(program: StoryProgramV2, node: StoryGraphNodeV2): string | null {
  if (node.kind === "end") return null;
  if (node.kind === "player-choice" || node.kind === "agent-choice" || node.kind === "director-choice") return null;
  if (node.nextNodeId) return node.nextNodeId;
  const index = program.nodes.findIndex((entry) => entry.id === node.id);
  return program.nodes[index + 1]?.id ?? null;
}

function markNode(program: StoryProgramV2, node: StoryGraphNodeV2, next: string | null): void {
  if (!program.executedNodeIds.includes(node.id)) program.executedNodeIds.push(node.id);
  program.cursorNodeId = next;
}

function arcFor(state: GameState, arcId: string | undefined) {
  return arcId ? state.storyArcs?.find((entry) => entry.id === arcId) : undefined;
}

function recordRelationshipExperience(state: GameState, program: StoryProgramV2, capability: Extract<RuntimeCapabilityOption, { kind: "relationship-event" }>): string[] {
  const participants = [...new Set(capability.participantIds)];
  const accepted = acceptExperience(state.acceptedExperiences ?? [], {
    id: `${program.id}:${capability.idempotencyKey}`,
    schemaVersion: ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
    factClass: "runtime-hard",
    kind: "relationship-event",
    startTick: state.time.tickValue,
    endTick: state.time.tickValue,
    actorIds: participants,
    participantIds: participants,
    locationIds: [state.master.location],
    visibility: { participantIds: participants, witnessIds: [], public: false },
    sourceIds: [`${program.id}:${capability.idempotencyKey}`],
    contextHash: program.contextHash,
    payload: { summary: capability.summary },
  });
  if (!accepted.accepted) return accepted.diagnostics;
  state.acceptedExperiences = accepted.experiences;
  projectDaytimeAgentFacts(state, { relatedCharacterIds: participants });
  return [];
}

/** Record a bounded fact for a capability that actually settled.  This keeps
 * mid-scene clues, choices, and scheduled follow-ups visible immediately;
 * the opening/end beat is no longer the only bridge into L1/L2/L3. */
function recordCapabilityExperience(
  state: GameState,
  program: StoryProgramV2,
  capability: RuntimeCapabilityOption,
): void {
  if (capability.kind === "relationship-event" || capability.kind === "advance-time") return;
  const summary = capability.kind === "record-clue"
    ? capability.summary
    : capability.kind === "reward-bundle"
      ? capability.summary
      : capability.kind === "schedule-weather-incident"
        ? `天气事件已安排：${capability.incident.label}`
        : capability.kind === "open-interaction-window"
          ? capability.directive.objective
          : capability.kind === "move"
            ? capability.label
            : capability.kind === "set-arc-variable"
              ? `${capability.label}（${capability.variableId}=${capability.valueId}）`
              : capability.kind === "schedule-next-window"
                ? capability.label
                : null;
  if (!summary?.trim()) return;
  const experience = buildStoryBeatExperience(program, {
    beatId: `capability:${capability.idempotencyKey}`,
    outcomeId: capability.idempotencyKey,
    summary,
    startTick: state.time.tickValue,
    endTick: state.time.tickValue,
    locationIds: [state.master.location],
  });
  const accepted = acceptExperience(state.acceptedExperiences ?? [], experience);
  if (!accepted.accepted) return;
  state.acceptedExperiences = accepted.experiences;
  projectDaytimeAgentFacts(state, { relatedCharacterIds: program.actorIds });
}

function executeCapability(state: GameState, program: StoryProgramV2, capability: RuntimeCapabilityOption): { events: ObservationEvent[]; diagnostics: string[] } {
  if (program.executedCapabilityIds.includes(capability.idempotencyKey)) return { events: [], diagnostics: [] };
  const arc = state.storyArcs?.find(a => a.id === program.arcId);
  const ledger = arc?.maintenance?.executedCapabilityIds;
  if (ledger?.includes(capability.idempotencyKey)) {
    program.executedCapabilityIds.push(capability.idempotencyKey);
    return { events: [], diagnostics: [] };
  }
  if (ledger && ledger.length >= 512) return { events: [], diagnostics: ["story capability ledger is full"] };
  const events: ObservationEvent[] = [];
  const diagnostics: string[] = [];
  switch (capability.kind) {
    case "advance-time":
      events.push(...advanceTimeTicks(state, capability.minutes));
      break;
    case "move": {
      const waitReason = narrativeCastWaitReason(state, capability.actorIds, capability.locationId);
      if (waitReason) {
        diagnostics.push(waitReason);
        break;
      }
      for (const actorId of capability.actorIds) {
        const slot = actorId === 0 ? state.master : state.charas[actorId];
        if (!slot) {
          diagnostics.push(`capability ${capability.id} actor is unavailable`);
          continue;
        }
        setSlotLocation(slot, capability.locationId);
      }
      if (diagnostics.length === 0) events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: `一行人来到${capability.locationId}。` });
      break;
    }
    case "record-clue": {
      const arc = arcFor(state, capability.arcId);
      if (!arc) diagnostics.push(`capability ${capability.id} arc is unavailable`);
      else {
        const factId = `clue:${capability.clueId}`;
        if (!arc.acceptedFactIds.includes(factId)) arc.acceptedFactIds.push(factId);
        arc.variables[`clue:${capability.clueId}`] = "accepted";
        // The clue is now evidence this Arc has spent, so a later day does not
        // hand the same clue to the director again.
        const maintenance = ensureArcMaintenance(arc);
        const evidenceId = capability.clueId;
        if (!maintenance.consumedEvidenceIds.includes(evidenceId)) maintenance.consumedEvidenceIds.push(evidenceId);
        events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: capability.summary });
      }
      break;
    }
    case "set-arc-variable": {
      const arc = arcFor(state, capability.arcId);
      if (!arc) diagnostics.push(`capability ${capability.id} arc is unavailable`);
      else arc.variables[capability.variableId] = capability.valueId;
      break;
    }
    case "schedule-next-window": {
      const arc = arcFor(state, capability.arcId);
      if (!arc) diagnostics.push(`capability ${capability.id} arc is unavailable`);
      else if (!arc.nextOpportunities.some((entry) => entry.earliestTick === capability.earliestTick && entry.latestTick === capability.latestTick)) {
        arc.nextOpportunities.push({ earliestTick: capability.earliestTick, latestTick: capability.latestTick, locationIds: [capability.locationId] });
        arc.nextOpportunities = arc.nextOpportunities.slice(-8);
        // The Arc is now explicitly waiting on a future window, and says what
        // happens if that window passes unused.
        const maintenance = ensureArcMaintenance(arc);
        maintenance.disposition = "wait";
        maintenance.waitOn = { kind: "time", latestTick: capability.latestTick };
        maintenance.nextChance = {
          earliestTick: capability.earliestTick,
          latestTick: capability.latestTick,
          locationIds: [capability.locationId],
          onMiss: "defer",
        };
      }
      break;
    }
    case "reward-bundle":
      state.money += capability.money;
      events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: capability.summary });
      break;
    case "relationship-event":
      diagnostics.push(...recordRelationshipExperience(state, program, capability));
      if (diagnostics.length === 0) events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: capability.summary });
      break;
    case "schedule-weather-incident": {
      const scheduled = scheduleWeatherIncident(state, capability.incident, program.eventId);
      diagnostics.push(...scheduled.diagnostics);
      if (scheduled.accepted) {
        events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: `天气系统已接受事件：${capability.incident.label}。` });
      }
      break;
    }
    case "open-interaction-window":
      state.activeEventContext = structuredClone(capability.directive);
      events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: "事件互动窗口已经开放；现在可以通过普通行动或“对话（AI）”推进线索。" });
      break;
  }
  if (diagnostics.length === 0) {
    recordCapabilityExperience(state, program, capability);
    program.executedCapabilityIds.push(capability.idempotencyKey);
    if (arc) (ensureArcMaintenance(arc).executedCapabilityIds ??= []).push(capability.idempotencyKey);
  }
  return { events, diagnostics };
}

function acceptEndExperience(state: GameState, program: StoryProgramV2, node: Extract<StoryGraphNodeV2, { kind: "end" }>): string[] {
  const accepted = acceptExperience(state.acceptedExperiences ?? [], buildStoryBeatExperience(program, {
    beatId: node.id,
    outcomeId: node.outcomeId,
    summary: node.summary,
    startTick: program.createdAtTick,
    endTick: state.time.tickValue,
  }));
  if (!accepted.accepted) return accepted.diagnostics;
  state.acceptedExperiences = accepted.experiences;
  projectDaytimeAgentFacts(state, { relatedCharacterIds: program.actorIds });
  return [];
}

function settleCompletion(state: GameState, program: StoryProgramV2, outcomeId: string, summary: string): void {
  const event = program.eventId ? state.narrativeEvents?.find((entry) => entry.id === program.eventId) : undefined;
  if (event) {
    event.status = "resolved";
    event.program = structuredClone(program);
  }
  const arc = arcFor(state, program.arcId);
  if (!arc || arc.beatHistory.some((entry) => entry.programId === program.id)) return;
  arc.beatHistory.push({ eventId: program.eventId ?? program.id, programId: program.id, outcomeId, resolvedAtTick: state.time.tickValue });
  arc.beatHistory = arc.beatHistory.slice(-64);
  recordArcScene(state, program, outcomeId, summary);
  const maintenance = ensureArcMaintenance(arc);
  if (arc.templateId === "weather-anomaly") {
    if (arc.phase >= 3) {
      arc.status = "completed";
      arc.unresolvedThreads = [];
      arc.nextOpportunities = [];
      maintenance.disposition = "conclude";
    } else {
      // The phase closed but the investigation stays open across days. If this
      // phase arranged a future window, the Arc is waiting on it, not merely
      // continuing.
      arc.phase += 1;
      maintenance.disposition = maintenance.nextChance ? "wait" : "continue";
    }
  } else {
    arc.status = "completed";
    arc.unresolvedThreads = [];
    arc.nextOpportunities = [];
    maintenance.disposition = "conclude";
  }
  if (maintenance.disposition === "conclude") {
    maintenance.waitOn = null;
    maintenance.nextChance = null;
  }
}

function syncEventProgram(state: GameState, program: StoryProgramV2): void {
  if (!program.eventId) return;
  const event = state.narrativeEvents?.find((entry) => entry.id === program.eventId);
  if (event) event.program = structuredClone(program);
}

/** Hard ceiling on archived rounds. Chosen well above any plausible session so
 * it never truncates a real story, while still bounding a runaway loop. */
export const MAX_STORY_ROUNDS = 64;

/** Close the current round: archive a compact summary, drop the finished nodes
 * from the live frontier, and park the program until the player acts.
 *
 * Pruning is safe only because `normalizeExplicitLinks` removed every implicit
 * next-index link at compile time; without it, removing nodes here would
 * silently re-point surviving edges. */
function archiveStoryRound(
  state: GameState,
  program: StoryProgramV2,
  node: Extract<StoryGraphNodeV2, { kind: "end" }>,
): void {
  const index = (program.roundIndex ?? 0) + 1;
  const roundNodeIds = [...program.executedNodeIds];
  const narration = roundNodeIds.flatMap((id) => {
    const entry = program.nodes.find((candidate) => candidate.id === id);
    if (entry?.kind === "narration") return [entry.text];
    if (entry?.kind === "expression") return [entry.fallbackText];
    if (entry?.kind === "bounded-talk") return entry.fallbackLines;
    if (entry?.kind === "dialogue-hook") return state.narrativeHooks?.find(hook => hook.id === programDialogueHookId(program, entry.id)
      && hook.lastReceipt?.disposition === "raise")?.expressedLines ?? [];
    if (entry?.kind === "player-choice" || entry?.kind === "agent-choice" || entry?.kind === "director-choice") {
      const selected = entry.options.find(option => option.id === program.selectedChoices[entry.id]);
      return selected ? [`${entry.kind === "player-choice" ? "玩家" : "运行时"}选择（${entry.question}）：${selected.label}`] : [];
    }
    if (entry?.kind === "end") return [entry.summary];
    return [];
  });
  program.rounds = [...(program.rounds ?? []), {
    index,
    outcomeId: node.outcomeId,
    summary: node.summary,
    resolvedAtTick: state.time.tickValue,
    nodeIds: [...roundNodeIds],
    narration: narration.slice(-8),
    selectedChoices: { ...program.selectedChoices },
  }].slice(-MAX_STORY_ROUNDS);
  program.roundIndex = index;
  // Everything the finished round touched leaves the frontier.
  program.nodes = [];
  program.executedNodeIds = [];
  program.executedCapabilityIds = [];
  program.selectedChoices = {};
  program.capabilities = [];
  program.cursorNodeId = null;
  program.startNodeId = "";
  program.status = "awaiting-player";
  delete program.continuationEvidence;
  delete program.continuationAttemptId;
}

/** Runtime-validate an L2/director option before a paused or restored graph
 * uses it. Invalid/late ids are ignored and deterministic fallback remains. */
export function acceptAutonomousStoryChoice(
  input: Readonly<GameState>,
  nodeId: string,
  optionId: string,
  owner: "agent" | "director",
): GameState {
  const state = cloneGameState(input);
  const program = state.storyProgram;
  if (!program || program.version !== 2 || program.status !== "active" || program.cursorNodeId !== nodeId) return state;
  const node = program.nodes.find((entry) => entry.id === nodeId);
  if (!node) return state;
  if (owner === "agent" && node.kind !== "agent-choice") return state;
  if (owner === "director" && node.kind !== "director-choice") return state;
  if (node.kind !== "agent-choice" && node.kind !== "director-choice") return state;
  if (!node.options.some((option) => option.id === optionId)) return state;
  program.selectedChoices[node.id] = optionId;
  return state;
}

export function advanceStoryProgramV2(input: Readonly<GameState>, choiceId?: string): StoryAdvanceResult {
  const state = reconcileNarrativeState(input).state;
  const program = state.storyProgram;
  const events: ObservationEvent[] = [];
  const expressionRequests: StoryAdvanceResult["expressionRequests"] = [];
  const diagnostics: string[] = [];
  if (!program || program.version !== 2) return { state, events, expressionRequests, diagnostics: ["no active StoryProgram V2"] };
  diagnostics.push(...validateStoryProgramV2(program));
  if (diagnostics.length > 0) {
    program.status = "aborted";
    return { state, events, expressionRequests, diagnostics };
  }
  if (program.status !== "active") return { state, events, expressionRequests, diagnostics };
  if (state.storyArcs?.some(a => a.id === program.arcId && hasPendingStoryInteraction(a))) return { state, events, expressionRequests, diagnostics };
  let suppliedChoice = choiceId;
  let guard = program.nodes.length + 1;
  while (program.cursorNodeId && guard-- > 0) {
    const node = program.nodes.find((entry) => entry.id === program.cursorNodeId)!;
    if (program.executedNodeIds.includes(node.id)) {
      program.cursorNodeId = nextNodeId(program, node);
      continue;
    }
    if (node.kind === "player-choice") {
      const selected = suppliedChoice ?? program.selectedChoices[node.id];
      if (!selected) {
        syncEventProgram(state, program);
        return { state, events, expressionRequests, pendingChoice: { beatId: node.id, question: node.question, options: node.options.map(({ id, label }) => ({ id, label })) }, diagnostics };
      }
      const option = node.options.find((entry) => entry.id === selected);
      if (!option) return { state, events, expressionRequests, diagnostics: ["story choice is unknown"] };
      program.selectedChoices[node.id] = option.id;
      if (state.storyArcs?.some(a => a.id === program.arcId && a.maintenance?.interaction)) {
        const previousSpeaker = [...program.executedNodeIds].reverse().map(id => program.nodes.find(n => n.id === id)).find(n => n?.kind === "dialogue-hook");
        const speakerId = previousSpeaker?.kind === "dialogue-hook" ? previousSpeaker.actorId : program.actorIds.find(id => id > 0);
        if (speakerId) {
          const id = `story-choice:${narrativeContextHash({ programId: program.id, nodeId: node.id, optionId: option.id })}`;
          recordStoryInteraction(state, { id, sessionId: id, speakerId, commandNo: 0, runtime: true, choice: true,
            playerText: option.label, lines: [{ text: `玩家回答「${node.question}」时选择了「${option.label}」。只确认该项选择，不补造后续行动。` }] });
        }
      }
      suppliedChoice = undefined;
      markNode(program, node, option.nextNodeId);
      continue;
    }
    if (node.kind === "agent-choice" || node.kind === "director-choice") {
      const selected = suppliedChoice ?? program.selectedChoices[node.id];
      if (!selected) {
        syncEventProgram(state, program);
        return {
          state,
          events,
          expressionRequests,
          pendingAutonomousChoice: {
            programId: program.id,
            nodeId: node.id,
            owner: node.kind === "agent-choice" ? "agent" : "director",
            ...(node.kind === "agent-choice" ? { actorId: node.actorId } : {}),
            question: node.question,
            options: node.options.map(({ id, label }) => ({ id, label })),
            fallbackOptionId: node.fallbackOptionId,
            contextHash: program.contextHash,
          },
          diagnostics,
        };
      }
      const option = node.options.find((entry) => entry.id === selected);
      if (!option) return { state, events, expressionRequests, diagnostics: ["autonomous story choice is unknown"] };
      program.selectedChoices[node.id] = option.id;
      suppliedChoice = undefined;
      markNode(program, node, option.nextNodeId);
      continue;
    }
    if (suppliedChoice) return { state, events, expressionRequests, diagnostics: ["story choice was supplied outside a choice node"] };
    if (node.kind === "dialogue-hook") {
      const dialogue = advanceProgramDialogue(state, program, node);
      if (!dialogue.expressed) {
        syncEventProgram(state, program);
        return { state, events, expressionRequests, pendingDialogueHookId: dialogue.hookId, diagnostics };
      }
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    if (node.kind === "narration") {
      events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: node.text });
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    if (node.kind === "expression") {
      expressionRequests.push({ programId: program.id, beatId: node.id, actorId: node.actorId, locationId: program.locationIds[0]!, promptHint: node.objective, fallbackText: node.fallbackText, contextHash: program.contextHash, requestKind: "expression", participantIds: [node.actorId], maxLines: 2 });
      events.push({ kind: "DIALOGUE_LINE", timestamp: state.time.tickValue, charaNum: node.actorId, text: node.fallbackText, form: "PRINTFORML" });
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    if (node.kind === "bounded-talk") {
      expressionRequests.push({ programId: program.id, beatId: node.id, actorId: node.participantIds[0]!, locationId: program.locationIds[0]!, promptHint: `${node.topicGoal}\n退出条件：${node.exitCondition}`, fallbackText: node.fallbackLines.join("\n"), contextHash: program.contextHash, requestKind: "bounded-talk", participantIds: [...node.participantIds], maxLines: 8 });
      node.fallbackLines.forEach((text, index) => events.push({ kind: "DIALOGUE_LINE", timestamp: state.time.tickValue, charaNum: node.participantIds[index % node.participantIds.length]!, text, form: "PRINTFORML" }));
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    if (node.kind === "checkpoint") {
      events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: node.label });
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    if (node.kind === "capability") {
      const capability = program.capabilities.find((entry) => entry.id === node.capabilityId);
      if (!capability) {
        program.status = "aborted";
        return { state, events, expressionRequests, diagnostics: [`story capability ${node.capabilityId} is unavailable`] };
      }
      const settled = executeCapability(state, program, capability);
      events.push(...settled.events);
      diagnostics.push(...settled.diagnostics);
      if (diagnostics.length > 0) {
        program.status = "aborted";
        return { state, events, expressionRequests, diagnostics };
      }
      markNode(program, node, nextNodeId(program, node));
      continue;
    }
    diagnostics.push(...acceptEndExperience(state, program, node));
    if (diagnostics.length > 0) {
      program.status = "aborted";
      return { state, events, expressionRequests, diagnostics };
    }
    events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: node.summary });
    markNode(program, node, null);
    if (node.continues && (program.roundIndex ?? 0) < MAX_STORY_ROUNDS) {
      // Round boundary: archive, prune, and wait for the player to act. The
      // event deliberately stays `active` so no other story can start while
      // this one is suspended mid-conversation.
      recordArcScene(state, program, node.outcomeId, node.summary);
      archiveStoryRound(state, program, node);
    } else {
      program.status = "completed";
      settleCompletion(state, program, node.outcomeId, node.summary);
    }
  }
  if (guard <= 0 && program.status === "active") {
    program.status = "aborted";
    diagnostics.push("story program exceeded its bounded step count");
  }
  syncEventProgram(state, program);
  return { state, events, expressionRequests, diagnostics };
}
