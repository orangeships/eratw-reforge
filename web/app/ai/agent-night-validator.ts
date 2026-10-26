import type {
  AgentCommissionSelection,
  AgentMindBeliefTopic,
  AgentMindItemUpdate,
  AgentMindUpdatesV1,
  AgentNightInterestingEvent,
  AgentNightResponseV3,
  AgentNightResponseV2,
  AgentPlanSelection,
  AgentStoryClaim,
  AgentSocialThreadKind,
  AgentSocialThreadUpdate,
} from "../../../modernization/runtime/agent/types.js";
import { jsonBody } from "./response-validator.js";

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length > 0) throw new Error(`${label} contains extra keys: ${extra.join(",")}`);
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  if (value.length > max) throw new Error(`${label} exceeds ${max} chars`);
  return value.trim();
}

function boundedDiaryText(value: unknown): string {
  const text = boundedText(value, "diaryText", 200);
  if (text.length < 50) throw new Error("diaryText must contain 50-200 chars");
  return text;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`);
  return Number(value);
}

function parseEvidence(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8
    || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 160)) {
    throw new Error(`${label} must contain up to 8 bounded ids`);
  }
  return [...new Set((value as string[]).map((entry) => entry.trim()))];
}

function parseMindItemUpdate(value: unknown, label: string): AgentMindItemUpdate {
  const obj = objectValue(value, label);
  exactKeys(obj, ["action", "id", "topic", "text", "evidenceIds"], label);
  if (obj.action !== "add" && obj.action !== "update" && obj.action !== "resolve") {
    throw new Error(`${label}.action must be add|update|resolve`);
  }
  const update: AgentMindItemUpdate = { action: obj.action };
  if (obj.id !== undefined) update.id = boundedText(obj.id, `${label}.id`, 160);
  if (obj.topic !== undefined) {
    if (obj.topic !== "self" && obj.topic !== "player" && obj.topic !== "relationship") throw new Error(`${label}.topic is invalid`);
    update.topic = obj.topic as AgentMindBeliefTopic;
  }
  if (obj.text !== undefined) update.text = boundedText(obj.text, `${label}.text`, 180);
  const evidenceIds = parseEvidence(obj.evidenceIds, `${label}.evidenceIds`);
  if (evidenceIds !== undefined) update.evidenceIds = evidenceIds;
  return update;
}

function parseThreadUpdate(value: unknown, label: string): AgentSocialThreadUpdate {
  const obj = objectValue(value, label);
  exactKeys(obj, ["action", "id", "kind", "text", "evidenceIds"], label);
  if (obj.action !== "add" && obj.action !== "update" && obj.action !== "resolve") {
    throw new Error(`${label}.action must be add|update|resolve`);
  }
  const update: AgentSocialThreadUpdate = { action: obj.action };
  if (obj.id !== undefined) update.id = boundedText(obj.id, `${label}.id`, 160);
  if (obj.kind !== undefined) {
    if (obj.kind !== "promise" && obj.kind !== "conflict" && obj.kind !== "secret" && obj.kind !== "question") throw new Error(`${label}.kind is invalid`);
    update.kind = obj.kind as AgentSocialThreadKind;
  }
  if (obj.text !== undefined) update.text = boundedText(obj.text, `${label}.text`, 300);
  const evidenceIds = parseEvidence(obj.evidenceIds, `${label}.evidenceIds`);
  if (evidenceIds !== undefined) update.evidenceIds = evidenceIds;
  return update;
}

function parseMindUpdates(value: unknown, diagnostics: string[]): AgentMindUpdatesV1 {
  const obj = objectValue(value, "mindUpdates");
  exactKeys(obj, ["relationshipToPlayer", "currentTendency", "beliefs", "goals", "threads"], "mindUpdates");
  const updates: AgentMindUpdatesV1 = {};
  if (obj.relationshipToPlayer !== undefined) {
    try { updates.relationshipToPlayer = boundedText(obj.relationshipToPlayer, "mindUpdates.relationshipToPlayer", 300); }
    catch { diagnostics.push("mindUpdates.relationshipToPlayer dropped: over-limit or invalid"); }
  }
  if (obj.currentTendency !== undefined) {
    try { updates.currentTendency = boundedText(obj.currentTendency, "mindUpdates.currentTendency", 300); }
    catch { diagnostics.push("mindUpdates.currentTendency dropped: over-limit or invalid"); }
  }
  const boundedUpdates = <T>(value: unknown, label: string, max: number, parse: (entry: unknown, entryLabel: string) => T): T[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    if (value.length > max) diagnostics.push(`${label}: dropped ${value.length - max} over-cap updates`);
    return value.slice(0, max).flatMap((entry, index) => {
      try { return [parse(entry, `${label}[${index}]`)]; }
      catch { diagnostics.push(`${label}[${index}] dropped: invalid or extra fields`); return []; }
    });
  };
  if (obj.beliefs !== undefined) {
    updates.beliefs = boundedUpdates(obj.beliefs, "mindUpdates.beliefs", 4, parseMindItemUpdate);
  }
  if (obj.goals !== undefined) {
    updates.goals = boundedUpdates(obj.goals, "mindUpdates.goals", 3, parseMindItemUpdate);
  }
  if (obj.threads !== undefined) {
    updates.threads = boundedUpdates(obj.threads, "mindUpdates.threads", 6, parseThreadUpdate);
  }
  return updates;
}

export function parseAgentStoryClaim(value: unknown, label = "claim"): AgentStoryClaim {
  const obj = objectValue(value, label);
  exactKeys(obj, ["startTick", "endTick", "location", "participants", "anchorIds"], label);
  const startTick = integer(obj.startTick, `${label}.startTick`);
  const endTick = integer(obj.endTick, `${label}.endTick`);
  if (startTick < 0 || endTick <= startTick) throw new Error(`${label} has invalid time window`);
  const location = boundedText(obj.location, `${label}.location`, 160);
  if (!Array.isArray(obj.participants) || obj.participants.length > 8
    || obj.participants.some((id) => !Number.isSafeInteger(id) || Number(id) < 0)) {
    throw new Error(`${label}.participants must be up to 8 nonnegative integers`);
  }
  if (!Array.isArray(obj.anchorIds) || obj.anchorIds.length === 0 || obj.anchorIds.length > 8
    || obj.anchorIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label}.anchorIds must contain 1-8 ids`);
  }
  return {
    startTick,
    endTick,
    location,
    participants: [...new Set(obj.participants.map(Number))].sort((a, b) => a - b),
    anchorIds: [...new Set(obj.anchorIds as string[])],
  };
}

export function parseAgentInterestingEvent(value: unknown, label = "interestingEvent"): AgentNightInterestingEvent | null {
  if (value === null) return null;
  const obj = objectValue(value, label);
  exactKeys(obj, ["text", "claim"], label);
  return {
    text: boundedText(obj.text, `${label}.text`, 600),
    claim: parseAgentStoryClaim(obj.claim, `${label}.claim`),
  };
}

function parsePlanSelections(value: unknown): AgentPlanSelection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 6) throw new Error("nextTendency.planSelections must be an array of at most 6");
  return value.map((entry, index) => {
    const obj = objectValue(entry, `planSelections[${index}]`);
    exactKeys(obj, ["candidateId", "windowStart", "windowEnd"], `planSelections[${index}]`);
    return {
      candidateId: boundedText(obj.candidateId, `planSelections[${index}].candidateId`, 200),
      windowStart: integer(obj.windowStart, `planSelections[${index}].windowStart`),
      windowEnd: integer(obj.windowEnd, `planSelections[${index}].windowEnd`),
    };
  });
}

function parseCommissionSelection(value: unknown): AgentCommissionSelection | undefined {
  if (value === undefined) return undefined;
  const obj = objectValue(value, "nextTendency.commissionSelection");
  exactKeys(obj, ["candidateId", "action"], "nextTendency.commissionSelection");
  const action = obj.action;
  if (action !== "propose" && action !== "defer") throw new Error("commission action must be propose|defer");
  return {
    candidateId: boundedText(obj.candidateId, "commission candidateId", 200),
    action,
  };
}

export function parseAgentNightResponse(raw: string): AgentNightResponseV2 | AgentNightResponseV3 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("Agent night response is not valid JSON");
  }
  const obj = objectValue(parsed, "response");
  if (obj.schemaVersion !== 2 && obj.schemaVersion !== 3) throw new Error("schemaVersion must be 2 or 3");
  exactKeys(obj, obj.schemaVersion === 3
    ? ["schemaVersion", "charaNum", "dayIndex", "contextHash", "attitudeToPlayer", "interestingEvent", "nextTendency", "diaryText", "mindUpdates"]
    : ["schemaVersion", "charaNum", "dayIndex", "contextHash", "attitudeToPlayer", "interestingEvent", "nextTendency", "diaryText"], "response");
  const charaNum = integer(obj.charaNum, "charaNum");
  const dayIndex = integer(obj.dayIndex, "dayIndex");
  const contextHash = boundedText(obj.contextHash, "contextHash", 200);
  const attitude = objectValue(obj.attitudeToPlayer, "attitudeToPlayer");
  exactKeys(attitude, ["text"], "attitudeToPlayer");
  const tendency = objectValue(obj.nextTendency, "nextTendency");
  exactKeys(tendency, ["text", "planSelections", "commissionSelection"], "nextTendency");
  const common = {
    charaNum,
    dayIndex,
    contextHash,
    attitudeToPlayer: { text: boundedText(attitude.text, "attitudeToPlayer.text", 500) },
    interestingEvent: parseAgentInterestingEvent(obj.interestingEvent),
    nextTendency: {
      text: boundedText(tendency.text, "nextTendency.text", 500),
      planSelections: parsePlanSelections(tendency.planSelections),
      commissionSelection: parseCommissionSelection(tendency.commissionSelection),
    },
  };
  if (obj.schemaVersion === 3) {
    const validationDiagnostics: string[] = [];
    const mindUpdates = parseMindUpdates(obj.mindUpdates, validationDiagnostics);
    return {
      schemaVersion: 3,
      ...common,
      ...(obj.diaryText === undefined ? {} : { diaryText: boundedDiaryText(obj.diaryText) }),
      mindUpdates,
      ...(validationDiagnostics.length > 0 ? { validationDiagnostics } : {}),
    };
  }
  return {
    schemaVersion: 2,
    ...common,
    ...(obj.diaryText === undefined ? {} : { diaryText: boundedDiaryText(obj.diaryText) }),
  };
}

export function parseAgentNightResponseV3(raw: string): AgentNightResponseV3 {
  const parsed = parseAgentNightResponse(raw);
  if (parsed.schemaVersion !== 3) throw new Error("schemaVersion must be 3");
  return parsed;
}
