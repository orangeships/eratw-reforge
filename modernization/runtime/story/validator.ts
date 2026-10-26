import {
  STORY_PROGRAM_VERSION,
  type StoryBeat,
  type StoryProgram,
  type StoryProgramV1,
} from "./types.js";
import { validateStoryProgramV2 } from "./validator-v2.js";

const MAX_PROGRAM_ID = 160;
const MAX_TEXT = 300;
const MAX_BEATS = 24;
const MAX_ACTORS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, limit = MAX_PROGRAM_ID): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function beatKeys(beat: Record<string, unknown>): readonly string[] | null {
  switch (beat.kind) {
    case "narration": return ["id", "kind", "text", ...(beat.nextBeatId === undefined ? [] : ["nextBeatId"])];
    case "ai-expression": return ["id", "kind", "actorId", "promptHint", "fallbackText", ...(beat.nextBeatId === undefined ? [] : ["nextBeatId"])];
    case "player-choice": return ["id", "kind", "question", "options"];
    case "runtime-effect": return ["id", "kind", "handler", "args", "idempotencyKey", ...(beat.nextBeatId === undefined ? [] : ["nextBeatId"])];
    case "end": return ["id", "kind", "outcomeId", "summary"];
    default: return null;
  }
}

function validateBeat(beat: unknown, actorIds: readonly number[]): string[] {
  if (!isRecord(beat)) return ["story beat must be an object"];
  const diagnostics: string[] = [];
  const keys = beatKeys(beat);
  if (!keys) return ["story beat kind is unknown"];
  if (!hasExactKeys(beat, keys)) diagnostics.push(`story beat ${String(beat.id)} has unknown or missing fields`);
  if (!boundedString(beat.id)) diagnostics.push("story beat id is invalid");
  if (beat.nextBeatId !== undefined && !boundedString(beat.nextBeatId)) diagnostics.push(`story beat ${String(beat.id)} nextBeatId is invalid`);
  switch (beat.kind) {
    case "narration":
      if (!boundedString(beat.text, MAX_TEXT)) diagnostics.push(`story beat ${String(beat.id)} text is invalid`);
      break;
    case "ai-expression":
      if (!Number.isSafeInteger(beat.actorId) || !actorIds.includes(Number(beat.actorId))) diagnostics.push(`story beat ${String(beat.id)} actor is invalid`);
      if (!boundedString(beat.promptHint, MAX_TEXT) || !boundedString(beat.fallbackText, MAX_TEXT)) diagnostics.push(`story beat ${String(beat.id)} expression text is invalid`);
      break;
    case "player-choice":
      if (!boundedString(beat.question, 120)) diagnostics.push(`story beat ${String(beat.id)} question is invalid`);
      if (!Array.isArray(beat.options) || beat.options.length < 2 || beat.options.length > 3) {
        diagnostics.push(`story beat ${String(beat.id)} options are invalid`);
      } else {
        const optionIds = new Set<string>();
        for (const option of beat.options) {
          if (!isRecord(option) || !hasExactKeys(option, ["id", "label", "nextBeatId"])
            || !boundedString(option.id) || !boundedString(option.label, 60) || !boundedString(option.nextBeatId)) {
            diagnostics.push(`story beat ${String(beat.id)} has an invalid option`);
            continue;
          }
          if (optionIds.has(option.id)) diagnostics.push(`story beat ${String(beat.id)} has duplicate option ids`);
          optionIds.add(option.id);
        }
      }
      break;
    case "runtime-effect":
      if (beat.handler !== "advance-time") diagnostics.push(`story beat ${String(beat.id)} effect handler is not whitelisted`);
      if (!isRecord(beat.args) || !hasExactKeys(beat.args, ["minutes"])
        || !Number.isSafeInteger(beat.args.minutes) || Number(beat.args.minutes) < 1 || Number(beat.args.minutes) > 30) {
        diagnostics.push(`story beat ${String(beat.id)} effect args are invalid`);
      }
      if (!boundedString(beat.idempotencyKey)) diagnostics.push(`story beat ${String(beat.id)} idempotency key is invalid`);
      break;
    case "end":
      if (!boundedString(beat.outcomeId) || !boundedString(beat.summary, MAX_TEXT)) diagnostics.push(`story beat ${String(beat.id)} outcome is invalid`);
      break;
  }
  return diagnostics;
}

function outgoing(beat: StoryBeat, index: number, beats: readonly StoryBeat[]): string[] {
  if (beat.kind === "end") return [];
  if (beat.kind === "player-choice") return beat.options.map((option) => option.nextBeatId);
  if (beat.nextBeatId) return [beat.nextBeatId];
  return index + 1 < beats.length ? [beats[index + 1]!.id] : [];
}

/** Strict validation for persisted/authored StoryProgram V1. */
export function validateStoryProgramV1(value: unknown): string[] {
  if (!isRecord(value)) return ["story program must be an object"];
  const diagnostics: string[] = [];
  const programKeys = ["version", "id", "templateId", "contextHash", "createdAtTick", "actorIds", "locationId", "beats", "cursor", "status", "executedBeatIds", "executedEffectIds", "selectedChoices"];
  if (!hasExactKeys(value, programKeys)) diagnostics.push("story program has unknown or missing fields");
  if (value.version !== STORY_PROGRAM_VERSION) diagnostics.push("story program version is unsupported");
  if (!boundedString(value.id) || !boundedString(value.contextHash) || !boundedString(value.locationId)) diagnostics.push("story program identity is invalid");
  if (!Number.isSafeInteger(value.templateId) || Number(value.templateId) <= 0) diagnostics.push("story template id is invalid");
  if (!Number.isSafeInteger(value.createdAtTick) || Number(value.createdAtTick) < 0) diagnostics.push("story createdAtTick is invalid");
  const actorIds = Array.isArray(value.actorIds) ? value.actorIds : [];
  if (actorIds.length < 1 || actorIds.length > MAX_ACTORS || actorIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0) || new Set(actorIds).size !== actorIds.length) diagnostics.push("story actorIds are invalid");
  if (!Array.isArray(value.beats) || value.beats.length < 2 || value.beats.length > MAX_BEATS) diagnostics.push("story beats are invalid");
  const beats = Array.isArray(value.beats) ? value.beats : [];
  for (const beat of beats) diagnostics.push(...validateBeat(beat, actorIds as number[]));
  const typedBeats = beats.filter(isRecord) as unknown as StoryBeat[];
  const ids = typedBeats.map((beat) => beat.id);
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) diagnostics.push("story beat ids must be unique");
  const idToIndex = new Map(ids.map((id, index) => [id, index]));
  for (let index = 0; index < typedBeats.length; index += 1) {
    for (const target of outgoing(typedBeats[index]!, index, typedBeats)) {
      const targetIndex = idToIndex.get(target);
      if (targetIndex === undefined) diagnostics.push(`story branch ${target} is unknown`);
      else if (targetIndex <= index) diagnostics.push(`story branch ${target} must move forward`);
    }
  }
  if (!typedBeats.some((beat) => beat.kind === "end")) diagnostics.push("story program needs an end beat");
  if (!Number.isSafeInteger(value.cursor) || Number(value.cursor) < 0 || Number(value.cursor) > beats.length) diagnostics.push("story cursor is invalid");
  if (value.status !== "active" && value.status !== "completed" && value.status !== "aborted") diagnostics.push("story status is invalid");
  for (const key of ["executedBeatIds", "executedEffectIds"] as const) {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.some((entry) => !boundedString(entry)) || new Set(entries).size !== entries.length) diagnostics.push(`story ${key} is invalid`);
  }
  if (!isRecord(value.selectedChoices) || Object.entries(value.selectedChoices).some(([beatId, optionId]) => !boundedString(beatId) || !boundedString(optionId))) diagnostics.push("story selectedChoices are invalid");
  return diagnostics;
}

export function isStoryProgram(value: unknown): value is StoryProgram {
  return validateStoryProgram(value).length === 0;
}

/** Dispatch persisted saves by their explicit version. V1 remains supported
 * for completion/recovery; newly accepted events compile as V2. */
export function validateStoryProgram(value: unknown): string[] {
  if (isRecord(value) && value.version === 2) return validateStoryProgramV2(value);
  return validateStoryProgramV1(value);
}

export function isStoryProgramV1(value: unknown): value is StoryProgramV1 {
  return validateStoryProgramV1(value).length === 0;
}
