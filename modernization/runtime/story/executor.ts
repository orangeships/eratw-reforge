import type { ObservationEvent } from "../../schemas/types.js";
import { acceptExperience, ACCEPTED_EXPERIENCE_SCHEMA_VERSION } from "../experience.js";
import { cloneGameState, type GameState } from "../state/game-state.js";
import { advanceTimeTicks } from "../state/settlement.js";
import { validateStoryProgram } from "./validator.js";
import { advanceStoryProgramV2 } from "./executor-v2.js";
import { cancelNarrativeHooks } from "./dialogue-hook.js";
import { isOpenStoryProgram, reconcileNarrativeState } from "./reconciliation.js";
import { STORY_PROGRAM_VERSION } from "./types.js";
import type {
  EndBeat,
  StoryBeat,
  StoryAutonomousChoicePrompt,
  StoryChoicePrompt,
  StoryExpressionRequest,
  StoryProgramV1,
} from "./types.js";
import { projectDaytimeAgentFacts } from "../agent/daytime-sync.js";

export interface StoryAdvanceResult {
  /** No fixed dialogue or later effects may run while this objective awaits L1. */
  pendingDialogueHookId?: string;
  state: GameState;
  events: ObservationEvent[];
  expressionRequests: StoryExpressionRequest[];
  pendingChoice?: StoryChoicePrompt;
  pendingAutonomousChoice?: StoryAutonomousChoicePrompt;
  diagnostics: string[];
}

function nextIndex(program: StoryProgramV1, beat: StoryBeat): number {
  if (beat.kind === "end") return program.beats.length;
  const nextId = beat.kind === "player-choice" ? undefined : beat.nextBeatId;
  if (!nextId) return program.cursor + 1;
  return program.beats.findIndex((candidate) => candidate.id === nextId);
}

function completeBeat(program: StoryProgramV1, beat: StoryBeat, index: number): void {
  if (!program.executedBeatIds.includes(beat.id)) program.executedBeatIds.push(beat.id);
  program.cursor = index;
}

function acceptEndExperience(state: GameState, program: StoryProgramV1, beat: EndBeat): string[] {
  const participants = [...new Set([state.master.charaNum, ...program.actorIds])];
  const result = acceptExperience(state.acceptedExperiences ?? [], {
    id: `${program.id}:${beat.id}`,
    schemaVersion: ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
    factClass: "story-runtime",
    kind: "story-beat",
    startTick: program.createdAtTick,
    endTick: state.time.tickValue,
    actorIds: [...program.actorIds],
    participantIds: participants,
    locationIds: [program.locationId],
    visibility: { participantIds: participants, witnessIds: [], public: false },
    sourceIds: [`${program.id}:${beat.id}`],
    contextHash: program.contextHash,
    payload: { summary: beat.summary, programId: program.id, beatId: beat.id, outcomeId: beat.outcomeId },
  });
  if (!result.accepted) return result.diagnostics;
  state.acceptedExperiences = result.experiences;
  projectDaytimeAgentFacts(state, { relatedCharacterIds: program.actorIds });
  return [];
}

/** Advance until a player choice or completion. All control flow and effects
 * are deterministic; AI expression requests are sideband presentation only. */
export function advanceStoryProgram(input: Readonly<GameState>, choiceId?: string): StoryAdvanceResult {
  if (input.storyProgram?.version === 2) return advanceStoryProgramV2(input, choiceId);
  const state = cloneGameState(input);
  const program = state.storyProgram;
  const events: ObservationEvent[] = [];
  const expressionRequests: StoryExpressionRequest[] = [];
  const diagnostics: string[] = [];
  if (!program || program.version !== STORY_PROGRAM_VERSION) return { state, events, expressionRequests, diagnostics: ["no active story program"] };
  diagnostics.push(...validateStoryProgram(program));
  if (diagnostics.length > 0) {
    program.status = "aborted";
    return { state, events, expressionRequests, diagnostics };
  }
  if (program.status !== "active") return { state, events, expressionRequests, diagnostics };
  let pendingChoiceId = choiceId;
  let guard = program.beats.length + 1;
  while (program.cursor < program.beats.length && guard-- > 0) {
    const beat = program.beats[program.cursor]!;
    if (program.executedBeatIds.includes(beat.id)) {
      program.cursor = nextIndex(program, beat);
      continue;
    }
    if (beat.kind === "player-choice") {
      const selected = pendingChoiceId ?? program.selectedChoices[beat.id];
      if (!selected) {
        return {
          state,
          events,
          expressionRequests,
          pendingChoice: { beatId: beat.id, question: beat.question, options: beat.options.map(({ id, label }) => ({ id, label })) },
          diagnostics,
        };
      }
      const option = beat.options.find((candidate) => candidate.id === selected);
      if (!option) return { state, events, expressionRequests, diagnostics: ["story choice is unknown"] };
      program.selectedChoices[beat.id] = option.id;
      pendingChoiceId = undefined;
      completeBeat(program, beat, program.beats.findIndex((candidate) => candidate.id === option.nextBeatId));
      continue;
    }
    if (pendingChoiceId) return { state, events, expressionRequests, diagnostics: ["story choice was supplied outside a pending choice"] };
    if (beat.kind === "narration") {
      events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: beat.text });
      completeBeat(program, beat, nextIndex(program, beat));
      continue;
    }
    if (beat.kind === "ai-expression") {
      expressionRequests.push({ programId: program.id, beatId: beat.id, actorId: beat.actorId, locationId: program.locationId, promptHint: beat.promptHint, fallbackText: beat.fallbackText, contextHash: program.contextHash });
      events.push({ kind: "DIALOGUE_LINE", timestamp: state.time.tickValue, charaNum: beat.actorId, text: beat.fallbackText, form: "PRINTFORML" });
      completeBeat(program, beat, nextIndex(program, beat));
      continue;
    }
    if (beat.kind === "runtime-effect") {
      if (!program.executedEffectIds.includes(beat.idempotencyKey)) {
        events.push(...advanceTimeTicks(state, beat.args.minutes));
        program.executedEffectIds.push(beat.idempotencyKey);
      }
      completeBeat(program, beat, nextIndex(program, beat));
      continue;
    }
    diagnostics.push(...acceptEndExperience(state, program, beat));
    if (diagnostics.length > 0) {
      program.status = "aborted";
      return { state, events, expressionRequests, diagnostics };
    }
    events.push({ kind: "NARRATION", timestamp: state.time.tickValue, text: beat.summary });
    completeBeat(program, beat, program.beats.length);
    program.status = "completed";
  }
  if (guard <= 0 && program.status === "active") {
    program.status = "aborted";
    diagnostics.push("story program exceeded its bounded step count");
  }
  return { state, events, expressionRequests, diagnostics };
}

export function abortStoryProgram(input: Readonly<GameState>): GameState {
  const state = cloneGameState(input);
  const program = state.storyProgram;
  if (program && isOpenStoryProgram(program)) {
    cancelNarrativeHooks(state, program.id);
    if (program.version === 2 && program.arcId) cancelNarrativeHooks(state, program.arcId);
    program.status = "aborted";
    if (program.version === 2) {
      delete program.pausedStatus;
      program.lifecycleReason = "player aborted story";
      const arc = state.storyArcs?.find((entry) => entry.id === program.arcId);
      if (arc && ["active", "paused"].includes(arc.status)) arc.status = "abandoned";
    }
    if (program.version === 2 && program.eventId) {
      const event = state.narrativeEvents?.find((entry) => entry.id === program.eventId);
      if (event) {
        event.status = "cancelled";
        event.program = structuredClone(program);
      }
    }
  }
  return reconcileNarrativeState(state).state;
}
