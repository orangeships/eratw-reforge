import type { AcceptedExperience } from "../experience.js";
import { ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import type { NarrativeSnapshotV1 } from "./snapshot.js";
import {
  STORY_PROGRAM_V2_VERSION,
  NARRATIVE_MAX_PARTICIPANTS,
  type NarrativeSituationOptionV1,
  type RuntimeCapabilityOption,
  type StoryGraphNodeV2,
  type StoryGraphProposalV2,
  type StoryProgramV2,
} from "./types.js";

const MAX_NODES = 24;
const MAX_PARTICIPANTS = NARRATIVE_MAX_PARTICIPANTS;
const MAX_TEXT = 600;
const MAX_ID = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function optionalKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  return exactKeys(value, [...required, ...optional.filter((key) => value[key] !== undefined)]);
}

function boundedString(value: unknown, max = MAX_ID): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function uniqueIntegerArray(value: unknown, min: number, max: number): value is number[] {
  return Array.isArray(value) && value.length >= min && value.length <= max
    && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0)
    && new Set(value).size === value.length;
}

function uniqueStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max
    && value.every((entry) => boundedString(entry))
    && new Set(value).size === value.length;
}

function choiceOptions(value: unknown, nodeId: string, diagnostics: string[]): void {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    diagnostics.push(`story node ${nodeId} options must contain 2-3 branches`);
    return;
  }
  const ids = new Set<string>();
  for (const option of value) {
    if (!isRecord(option) || !exactKeys(option, ["id", "label", "nextNodeId"])
      || !boundedString(option.id) || !boundedString(option.label, 80) || !boundedString(option.nextNodeId)) {
      diagnostics.push(`story node ${nodeId} has an invalid option`);
      continue;
    }
    if (ids.has(option.id)) diagnostics.push(`story node ${nodeId} has duplicate option ids`);
    ids.add(option.id);
  }
}

function validateNode(node: unknown, participantIds: readonly number[], capabilityIds: ReadonlySet<string>): string[] {
  if (!isRecord(node)) return ["story node must be an object"];
  const diagnostics: string[] = [];
  const id = String(node.id);
  if (!boundedString(node.id)) diagnostics.push("story node id is invalid");
  const linear = ["id", "kind"];
  const withNext = (fields: string[]) => optionalKeys(node, [...linear, ...fields], ["nextNodeId"]);
  if (node.nextNodeId !== undefined && !boundedString(node.nextNodeId)) diagnostics.push(`story node ${id} nextNodeId is invalid`);
  switch (node.kind) {
    case "dialogue-hook":
      if (!withNext(["actorId", "objective"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!Number.isSafeInteger(node.actorId) || Number(node.actorId) <= 0 || !participantIds.includes(Number(node.actorId))) diagnostics.push(`story node ${id} hook actor is outside NPC participants`);
      if (!boundedString(node.objective, 800)) diagnostics.push(`story node ${id} hook objective is invalid`);
      break;
    case "narration":
      if (!withNext(["text"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.text, MAX_TEXT)) diagnostics.push(`story node ${id} text is invalid`);
      break;
    case "expression":
      if (!withNext(["actorId", "objective", "fallbackText"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!Number.isSafeInteger(node.actorId) || !participantIds.includes(Number(node.actorId))) diagnostics.push(`story node ${id} actor is outside participants`);
      if (!boundedString(node.objective, 300) || !boundedString(node.fallbackText, 300)) diagnostics.push(`story node ${id} expression is invalid`);
      break;
    case "bounded-talk":
      if (!withNext(["participantIds", "topicGoal", "exitCondition", "fallbackLines"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!uniqueIntegerArray(node.participantIds, 1, MAX_PARTICIPANTS)
        || (node.participantIds as number[]).some((entry) => !participantIds.includes(entry))) diagnostics.push(`story node ${id} talk participants are invalid`);
      if (!boundedString(node.topicGoal, 300) || !boundedString(node.exitCondition, 200)) diagnostics.push(`story node ${id} talk goal is invalid`);
      if (!Array.isArray(node.fallbackLines) || node.fallbackLines.length < 2 || node.fallbackLines.length > 8
        || node.fallbackLines.some((line) => !boundedString(line, 240))) diagnostics.push(`story node ${id} fallback lines must contain 2-8 bounded lines`);
      break;
    case "player-choice":
      if (!exactKeys(node, ["id", "kind", "question", "options"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.question, 160)) diagnostics.push(`story node ${id} question is invalid`);
      choiceOptions(node.options, id, diagnostics);
      break;
    case "agent-choice":
      if (!exactKeys(node, ["id", "kind", "actorId", "question", "options", "fallbackOptionId"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!Number.isSafeInteger(node.actorId) || !participantIds.includes(Number(node.actorId))) diagnostics.push(`story node ${id} agent is outside participants`);
      if (!boundedString(node.question, 160) || !boundedString(node.fallbackOptionId)) diagnostics.push(`story node ${id} decision fields are invalid`);
      choiceOptions(node.options, id, diagnostics);
      if (Array.isArray(node.options) && !node.options.some((option) => isRecord(option) && option.id === node.fallbackOptionId)) diagnostics.push(`story node ${id} fallback option is unknown`);
      break;
    case "director-choice":
      if (!exactKeys(node, ["id", "kind", "question", "options", "fallbackOptionId"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.question, 160) || !boundedString(node.fallbackOptionId)) diagnostics.push(`story node ${id} decision fields are invalid`);
      choiceOptions(node.options, id, diagnostics);
      if (Array.isArray(node.options) && !node.options.some((option) => isRecord(option) && option.id === node.fallbackOptionId)) diagnostics.push(`story node ${id} fallback option is unknown`);
      break;
    case "capability":
      if (!withNext(["capabilityId"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.capabilityId) || !capabilityIds.has(String(node.capabilityId))) diagnostics.push(`story node ${id} capability is not in the runtime catalog`);
      break;
    case "checkpoint":
      if (!withNext(["label"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.label, 160)) diagnostics.push(`story node ${id} checkpoint is invalid`);
      break;
    case "end":
      if (!optionalKeys(node, ["id", "kind", "outcomeId", "summary"], ["continues"])) diagnostics.push(`story node ${id} has unknown or missing fields`);
      if (!boundedString(node.outcomeId) || !boundedString(node.summary, MAX_TEXT)) diagnostics.push(`story node ${id} outcome is invalid`);
      if (node.continues !== undefined && typeof node.continues !== "boolean") diagnostics.push(`story node ${id} continues flag is invalid`);
      break;
    default:
      diagnostics.push(`story node ${id} kind is unknown`);
  }
  return diagnostics;
}

function outgoing(node: StoryGraphNodeV2, index: number, nodes: readonly StoryGraphNodeV2[]): string[] {
  if (node.kind === "end") return [];
  if (node.kind === "player-choice" || node.kind === "agent-choice" || node.kind === "director-choice") {
    return node.options.map((option) => option.nextNodeId);
  }
  return node.nextNodeId ? [node.nextNodeId] : index + 1 < nodes.length ? [nodes[index + 1]!.id] : [];
}

function graphDiagnostics(nodes: readonly StoryGraphNodeV2[], startNodeId: string): string[] {
  const diagnostics: string[] = [];
  const ids = nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) diagnostics.push("story node ids must be unique");
  const indexById = new Map(ids.map((id, index) => [id, index]));
  if (!indexById.has(startNodeId)) diagnostics.push("story start node is unknown");
  const edges = new Map<string, string[]>();
  for (let index = 0; index < nodes.length; index += 1) {
    const targets = outgoing(nodes[index]!, index, nodes);
    edges.set(nodes[index]!.id, targets);
    if (nodes[index]!.kind !== "end" && targets.length === 0) diagnostics.push(`story node ${nodes[index]!.id} is a dead end`);
    for (const target of targets) if (!indexById.has(target)) diagnostics.push(`story branch ${target} is unknown`);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      diagnostics.push("story graph must be acyclic");
      return;
    }
    if (visited.has(id) || !indexById.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const target of edges.get(id) ?? []) visit(target);
    active.delete(id);
  };
  visit(startNodeId);
  for (const id of ids) if (!visited.has(id)) diagnostics.push(`story node ${id} is unreachable`);
  if (![...visited].some((id) => nodes[indexById.get(id)!]?.kind === "end")) diagnostics.push("story graph needs a reachable end node");
  return diagnostics;
}

export function validateStoryGraphStructureV2(
  nodesValue: unknown,
  startNodeId: string,
  participantIds: readonly number[],
  capabilityIds: ReadonlySet<string>,
): string[] {
  const diagnostics: string[] = [];
  const nodes = Array.isArray(nodesValue) ? nodesValue : [];
  if (nodes.length < 2 || nodes.length > MAX_NODES) diagnostics.push("story graph must contain 2-24 nodes");
  for (const node of nodes) diagnostics.push(...validateNode(node, participantIds, capabilityIds));
  diagnostics.push(...graphDiagnostics(nodes.filter(isRecord) as unknown as StoryGraphNodeV2[], startNodeId));
  return diagnostics;
}

function factVisibleTo(experience: AcceptedExperience, participantId: number): boolean {
  return experience.visibility.public
    || experience.visibility.participantIds.includes(participantId)
    || experience.visibility.witnessIds.includes(participantId);
}

export interface StoryProposalValidationContextV2 {
  snapshot: Readonly<NarrativeSnapshotV1>;
  capabilities: readonly RuntimeCapabilityOption[];
  windowStartTick?: number;
  windowEndTick?: number;
}

export function validateStoryGraphProposalV2(value: unknown, context: StoryProposalValidationContextV2): string[] {
  if (!isRecord(value)) return ["story graph proposal must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, ["version", "proposalId", "title", "contextHash", "participantIds", "locationIds", "factIds", "startNodeId", "nodes"])) diagnostics.push("story graph proposal has unknown or missing fields");
  if (value.version !== STORY_PROGRAM_V2_VERSION) diagnostics.push("story graph proposal version is unsupported");
  if (!boundedString(value.proposalId) || !boundedString(value.title, 160) || !boundedString(value.startNodeId)) diagnostics.push("story graph proposal identity is invalid");
  if (value.contextHash !== context.snapshot.contextHash) diagnostics.push("story graph context hash is stale");
  if (!uniqueIntegerArray(value.participantIds, 1, MAX_PARTICIPANTS)) diagnostics.push("story participants are invalid");
  const knownCharacters = new Set(context.snapshot.characters.map((character) => character.id));
  const participantIds = Array.isArray(value.participantIds) ? value.participantIds as number[] : [];
  if (participantIds.some((id) => !knownCharacters.has(id))) diagnostics.push("story participants contain an unknown character");
  if (!uniqueStringArray(value.locationIds, 8) || value.locationIds.length < 1) diagnostics.push("story locations are invalid");
  const locationIds = Array.isArray(value.locationIds) ? value.locationIds as string[] : [];
  if (locationIds.some((id) => !ROOM_CATALOG_BY_LOCATION[id])) diagnostics.push("story locations must come from RoomCatalog");
  if (!uniqueStringArray(value.factIds, 32)) diagnostics.push("story fact ids are invalid");
  const experiences = new Map(context.snapshot.acceptedExperiences.map((entry) => [entry.id, entry]));
  const arcFactIds = new Set(context.snapshot.activeArcs.flatMap((arc) => arc.acceptedFactIds));
  for (const factId of Array.isArray(value.factIds) ? value.factIds as string[] : []) {
    const experience = experiences.get(factId);
    if ((!experience && !arcFactIds.has(factId)) || (experience && participantIds.some((id) => !factVisibleTo(experience, id)))) diagnostics.push(`story fact ${factId} is outside participant knowledge`);
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const capabilityIds = new Set(context.capabilities.map((capability) => capability.id));
  diagnostics.push(...validateStoryGraphStructureV2(nodes, String(value.startNodeId), participantIds, capabilityIds));

  if (context.windowStartTick !== undefined && context.windowEndTick !== undefined) {
    const startDay = Math.floor(context.windowStartTick / 1440);
    const startMinute = context.windowStartTick % 1440;
    const endMinute = context.windowEndTick % 1440;
    const day = context.snapshot.futureAgenda.find((entry) => entry.dayIndex === startDay);
    const conflict = day?.items.some((item) => {
      if (!item.participantIds.some((id) => participantIds.includes(id))) return false;
      if (item.startMinute === undefined) return false;
      const itemEnd = item.endMinute ?? item.startMinute + 60;
      return startMinute < itemEnd && endMinute > item.startMinute;
    });
    if (conflict) diagnostics.push("story event window conflicts with an accepted schedule");
  }
  return [...new Set(diagnostics)];
}

/** L3's player-facing route needs an actual social participant. This is kept
 * separate from the generic graph validator because authored weather phases
 * and saved compatibility fixtures may intentionally contain non-dialogue
 * graphs. */
/** The chosen situation, not the graph stage, owns the cast and the scene.
 *
 * Stage B is a second provider call and can legitimately invent a scene — it
 * has to, in order to write the opening. What it may NOT do is cast different
 * people or move the situation somewhere else: the situation is the thing the
 * player picked, and `acceptNarrativeSituationChoice` stages the cast into
 * `locationIds[0]` on the strength of it. A drifted proposal would stage the
 * wrong people into the wrong room and then describe it as fact.
 *
 * This is a generation-drift guard of the same class as the stale-context and
 * forged-graph checks, not a staging failure mode: the only correct answer to
 * a drifted graph is to refuse it and let the player pick again. */
export function validateSituationProposalAgreementV2(value: unknown, situation: NarrativeSituationOptionV1): string[] {
  if (!isRecord(value)) return ["story graph proposal must be an object"];
  const diagnostics: string[] = [];
  const participantIds = Array.isArray(value.participantIds) ? value.participantIds as number[] : [];
  if (participantIds.length !== situation.participantIds.length
    || participantIds.some((id) => !situation.participantIds.includes(id))) {
    diagnostics.push("story cast drifted from the chosen situation");
  }
  const locationIds = Array.isArray(value.locationIds) ? value.locationIds as string[] : [];
  if (locationIds[0] !== situation.locationIds[0]) {
    diagnostics.push("story scene drifted from the chosen situation");
  }
  return diagnostics;
}

export function validateStoryGraphPlayerParticipationV2(value: unknown): string[] {
  if (!isRecord(value)) return ["story graph proposal must be an object"];
  const diagnostics: string[] = [];
  const participantIds = Array.isArray(value.participantIds) ? value.participantIds : [];
  if (!participantIds.some((id) => Number.isSafeInteger(id) && Number(id) > 0)) {
    diagnostics.push("story graph needs at least one non-player participant");
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const hasNpcInteraction = nodes.some((node) => {
    if (!isRecord(node)) return false;
    if (node.kind === "expression" || node.kind === "dialogue-hook") return Number.isSafeInteger(node.actorId) && Number(node.actorId) > 0;
    if (node.kind === "bounded-talk") {
      return Array.isArray(node.participantIds)
        && node.participantIds.some((id) => Number.isSafeInteger(id) && Number(id) > 0);
    }
    return false;
  });
  if (!hasNpcInteraction) diagnostics.push("story graph needs an NPC interaction node");
  return diagnostics;
}

function validateCapabilityOption(value: unknown): string[] {
  if (!isRecord(value)) return ["runtime capability must be an object"];
  const common = ["id", "kind", "label", "description", "idempotencyKey"];
  const extra: Record<string, string[]> = {
    "advance-time": ["minutes"],
    move: ["actorIds", "locationId"],
    "record-clue": ["arcId", "clueId", "summary"],
    "set-arc-variable": ["arcId", "variableId", "valueId"],
    "schedule-next-window": ["arcId", "earliestTick", "latestTick", "locationId"],
    "reward-bundle": ["rewardId", "money", "summary"],
    "relationship-event": ["eventId", "participantIds", "summary"],
    "schedule-weather-incident": ["incident"],
    "open-interaction-window": ["directive"],
  };
  if (!extra[String(value.kind)] || !exactKeys(value, [...common, ...extra[String(value.kind)]!])) return ["runtime capability has unknown or missing fields"];
  if (!boundedString(value.id) || !boundedString(value.label, 160) || !boundedString(value.description, 300) || !boundedString(value.idempotencyKey)) return ["runtime capability identity is invalid"];
  if (value.kind === "advance-time" && (!Number.isSafeInteger(value.minutes) || Number(value.minutes) < 1 || Number(value.minutes) > 30)) return ["advance-time capability is invalid"];
  if (value.kind === "move" && (!uniqueIntegerArray(value.actorIds, 1, MAX_PARTICIPANTS) || !boundedString(value.locationId) || !ROOM_CATALOG_BY_LOCATION[String(value.locationId)])) return ["move capability is invalid"];
  if (value.kind === "schedule-next-window" && (!Number.isSafeInteger(value.earliestTick) || !Number.isSafeInteger(value.latestTick) || Number(value.latestTick) <= Number(value.earliestTick) || !ROOM_CATALOG_BY_LOCATION[String(value.locationId)])) return ["schedule capability is invalid"];
  if (value.kind === "reward-bundle" && (!Number.isSafeInteger(value.money) || Number(value.money) < 0 || Number(value.money) > 100000)) return ["reward capability is invalid"];
  if (value.kind === "schedule-weather-incident") {
    const incident = value.incident;
    if (!isRecord(incident) || incident.version !== 1 || !boundedString(incident.id) ||
        !Number.isSafeInteger(incident.startTick) || !Number.isSafeInteger(incident.endTick) || Number(incident.endTick) <= Number(incident.startTick) ||
        !Number.isSafeInteger(incident.weatherId) || !Number.isSafeInteger(incident.windId) || !boundedString(incident.idempotencyKey)) {
      return ["weather incident capability is invalid"];
    }
  }
  if (value.kind === "open-interaction-window") {
    const directive = value.directive;
    if (!isRecord(directive) || directive.version !== 1 || !boundedString(directive.eventId) || !boundedString(directive.beatId) ||
        !uniqueIntegerArray(directive.participantIds, 1, MAX_PARTICIPANTS) || !Array.isArray(directive.allowedIntentIds) ||
        !Number.isSafeInteger(directive.openedAtTick) || !Number.isSafeInteger(directive.expiresAtTick) || Number(directive.expiresAtTick) <= Number(directive.openedAtTick)) {
      return ["interaction window capability is invalid"];
    }
  }
  return [];
}

/** Strict persisted V2 validation. Freshness is checked when accepting a
 * proposal; an accepted program remains resumable across save/load. */
export function validateStoryProgramV2(value: unknown): string[] {
  if (!isRecord(value)) return ["story program must be an object"];
  const diagnostics: string[] = [];
  const required = ["version", "id", "title", "contextHash", "createdAtTick", "actorIds", "locationIds", "acceptedFactIds", "startNodeId", "nodes", "cursorNodeId", "status", "executedNodeIds", "executedCapabilityIds", "selectedChoices", "capabilities"];
  if (!optionalKeys(value, required, ["eventId", "arcId", "rounds", "roundIndex", "continuationEvidence", "continuationAttemptId", "pausedStatus", "lifecycleReason"])) diagnostics.push("story program V2 has unknown or missing fields");
  if (value.version !== STORY_PROGRAM_V2_VERSION) diagnostics.push("story program V2 version is unsupported");
  if (!boundedString(value.id) || !boundedString(value.title, 160) || !boundedString(value.contextHash) || (value.startNodeId !== "" && !boundedString(value.startNodeId))) diagnostics.push("story program V2 identity is invalid");
  if (!Number.isSafeInteger(value.createdAtTick) || Number(value.createdAtTick) < 0) diagnostics.push("story program V2 createdAtTick is invalid");
  if (!uniqueIntegerArray(value.actorIds, 1, MAX_PARTICIPANTS)) diagnostics.push("story program V2 actors are invalid");
  if (!uniqueStringArray(value.locationIds, 8) || value.locationIds.length < 1 || (value.locationIds as string[]).some((id) => !ROOM_CATALOG_BY_LOCATION[id])) diagnostics.push("story program V2 locations are invalid");
  if (!uniqueStringArray(value.acceptedFactIds, 32)) diagnostics.push("story program V2 facts are invalid");
  const capabilities = Array.isArray(value.capabilities) ? value.capabilities : [];
  for (const capability of capabilities) diagnostics.push(...validateCapabilityOption(capability));
  const capabilityIds = new Set(capabilities.filter(isRecord).map((capability) => String(capability.id)));
  if (capabilityIds.size !== capabilities.length) diagnostics.push("story program V2 capability ids must be unique");
  const capabilityEffectIds = new Set(capabilities.filter(isRecord).map((capability) => String(capability.idempotencyKey)));
  if (capabilityEffectIds.size !== capabilities.length) diagnostics.push("story program V2 capability idempotency keys must be unique");
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  // A program waiting on the player has no live frontier: the finished round
  // was archived and pruned, so there is nothing to walk or point at.
  const awaitingPlayer = value.status === "awaiting-player" || (value.status === "paused" && value.pausedStatus === "awaiting-player");
  const closedFrontier = awaitingPlayer || (value.status === "aborted" && nodes.length === 0);
  if (!closedFrontier) {
    diagnostics.push(...validateStoryGraphStructureV2(nodes, String(value.startNodeId), Array.isArray(value.actorIds) ? value.actorIds as number[] : [], capabilityIds));
    if (value.cursorNodeId !== null && (!boundedString(value.cursorNodeId) || !nodes.some((node) => isRecord(node) && node.id === value.cursorNodeId))) diagnostics.push("story program V2 cursor is invalid");
  } else if (value.cursorNodeId !== null) {
    diagnostics.push("story program V2 cursor must be null while awaiting the player");
  }
  if (!(["active", "awaiting-player", "paused", "completed", "aborted"] as unknown[]).includes(value.status)) diagnostics.push("story program V2 status is invalid");
  if (value.status === "paused" ? !["active", "awaiting-player"].includes(String(value.pausedStatus)) : value.pausedStatus !== undefined) diagnostics.push("story program V2 paused status is invalid");
  if (value.lifecycleReason !== undefined && !boundedString(value.lifecycleReason, 240)) diagnostics.push("story program V2 lifecycle reason is invalid");
  if (value.continuationAttemptId !== undefined && !boundedString(value.continuationAttemptId)) diagnostics.push("story program V2 continuation attempt is invalid");
  if (value.continuationEvidence !== undefined) {
    const evidence = value.continuationEvidence;
    if (!isRecord(evidence) || !optionalKeys(evidence, ["id", "targetId", "commandNo", "tick", "roundIndex"], ["summary"])
      || !boundedString(evidence.id) || !Number.isSafeInteger(evidence.targetId) || Number(evidence.targetId) <= 0
      || !Array.isArray(value.actorIds) || !value.actorIds.includes(evidence.targetId)
      || !Number.isSafeInteger(evidence.commandNo) || Number(evidence.commandNo) < 0
      || !Number.isSafeInteger(evidence.tick) || Number(evidence.tick) < 0
      || !Number.isSafeInteger(evidence.roundIndex) || evidence.roundIndex !== (value.roundIndex ?? 0)
      || (evidence.summary !== undefined && !boundedString(evidence.summary, 1_000))) diagnostics.push("story program V2 continuation evidence is invalid");
  }
  if (value.roundIndex !== undefined && (!Number.isSafeInteger(value.roundIndex) || Number(value.roundIndex) < 0)) diagnostics.push("story program V2 roundIndex is invalid");
  if (value.rounds !== undefined) {
    if (!Array.isArray(value.rounds) || value.rounds.length > 64) diagnostics.push("story program V2 rounds are invalid");
    else for (const round of value.rounds) {
      if (!isRecord(round)
        || !optionalKeys(round, ["index", "outcomeId", "summary", "resolvedAtTick", "nodeIds", "narration"], ["selectedChoices"])
        || !Number.isSafeInteger(round.index) || Number(round.index) < 1
        || !boundedString(round.outcomeId) || !boundedString(round.summary, MAX_TEXT)
        || !Number.isSafeInteger(round.resolvedAtTick) || Number(round.resolvedAtTick) < 0
        || !uniqueStringArray(round.nodeIds, MAX_NODES * 2)
        || !Array.isArray(round.narration) || round.narration.length > 8
        || round.narration.some((line) => !boundedString(line, MAX_TEXT))
        || (round.selectedChoices !== undefined && (!isRecord(round.selectedChoices) || Object.entries(round.selectedChoices).length > MAX_NODES
          || Object.entries(round.selectedChoices).some(([key, option]) => !boundedString(key) || !boundedString(option))))) {
        diagnostics.push("story program V2 round summary is invalid");
        break;
      }
    }
  }
  for (const key of ["executedNodeIds", "executedCapabilityIds"] as const) if (!uniqueStringArray(value[key], MAX_NODES * 2)) diagnostics.push(`story program V2 ${key} is invalid`);
  const nodeIds = new Set(nodes.filter(isRecord).map((node) => String(node.id)));
  if (Array.isArray(value.executedNodeIds) && value.executedNodeIds.some((id) => !nodeIds.has(String(id)))) diagnostics.push("story program V2 executed nodes contain an unknown id");
  const effectIds = new Set(capabilities.filter(isRecord).map((capability) => String(capability.idempotencyKey)));
  if (Array.isArray(value.executedCapabilityIds) && value.executedCapabilityIds.some((id) => !effectIds.has(String(id)))) diagnostics.push("story program V2 executed capabilities contain an unknown id");
  if (!isRecord(value.selectedChoices) || Object.entries(value.selectedChoices).some(([nodeId, optionId]) => {
    if (!boundedString(nodeId) || !boundedString(optionId)) return true;
    const node = nodes.find((entry) => isRecord(entry) && entry.id === nodeId) as StoryGraphNodeV2 | undefined;
    return !node || (node.kind !== "player-choice" && node.kind !== "agent-choice" && node.kind !== "director-choice") || !node.options.some((option) => option.id === optionId);
  })) diagnostics.push("story program V2 selectedChoices are invalid");
  return [...new Set(diagnostics)];
}

export function isStoryGraphProposalV2(value: unknown, context: StoryProposalValidationContextV2): value is StoryGraphProposalV2 {
  return validateStoryGraphProposalV2(value, context).length === 0;
}

export function isStoryProgramV2(value: unknown): value is StoryProgramV2 {
  return validateStoryProgramV2(value).length === 0;
}
