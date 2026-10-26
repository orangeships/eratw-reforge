import { cloneGameState, type GameState } from "../state/game-state.js";
import { ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import type { StoryTemplateDocumentV2, StoryTemplateFavoriteRequest } from "./types.js";
import { NARRATIVE_MAX_PARTICIPANTS } from "./types.js";
import { isStoryProgramV2, validateStoryGraphStructureV2 } from "./validator-v2.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const expected = [...required, ...optional.filter((key) => value[key] !== undefined)].sort();
  const actual = Object.keys(value).sort();
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

function text(value: unknown, max = 240): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function validateStoryTemplateDocumentV2(value: unknown): string[] {
  if (!isRecord(value)) return ["story template must be an object"];
  const diagnostics: string[] = [];
  if (!exactKeys(value, ["version", "id", "title", "characterSlots", "locationConstraints", "triggerAnchors", "graph", "fallback", "requiredCapabilityKinds", "provenance"])) diagnostics.push("story template has unknown or missing fields");
  if (value.version !== 2 || !text(value.id, 120) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value.id)) || !text(value.title)) diagnostics.push("story template identity is invalid");
  if (!Array.isArray(value.characterSlots) || value.characterSlots.length < 1 || value.characterSlots.length > NARRATIVE_MAX_PARTICIPANTS || value.characterSlots.some((slot) => !isRecord(slot) || !exactKeys(slot, ["id", "min", "max"]) || !text(slot.id, 80) || !Number.isSafeInteger(slot.min) || !Number.isSafeInteger(slot.max) || Number(slot.min) < 0 || Number(slot.max) < Number(slot.min) || Number(slot.max) > NARRATIVE_MAX_PARTICIPANTS)) diagnostics.push("story template character slots are invalid");
  if (!Array.isArray(value.locationConstraints) || value.locationConstraints.length < 1 || value.locationConstraints.length > 8 || value.locationConstraints.some((location) => !text(location) || !ROOM_CATALOG_BY_LOCATION[String(location)])) diagnostics.push("story template locations are invalid");
  if (!Array.isArray(value.triggerAnchors) || value.triggerAnchors.length < 1 || value.triggerAnchors.length > 8 || value.triggerAnchors.some((anchor) => !text(anchor, 80))) diagnostics.push("story template trigger anchors are invalid");
  if (!isRecord(value.graph)
    || !exactKeys(value.graph, ["version", "proposalId", "title", "contextHash", "participantIds", "locationIds", "factIds", "startNodeId", "nodes"])
    || value.graph.version !== 2
    || !text(value.graph.proposalId)
    || !text(value.graph.title)
    || !text(value.graph.contextHash)
    || !text(value.graph.startNodeId)
    || !Array.isArray(value.graph.participantIds)
    || !Array.isArray(value.graph.locationIds)
    || !Array.isArray(value.graph.factIds)
    || !Array.isArray(value.graph.nodes)) {
    diagnostics.push("story template graph is invalid");
  } else {
    const graphParticipants = Array.isArray(value.graph.participantIds) ? value.graph.participantIds.filter((entry): entry is number => Number.isSafeInteger(entry)) : [];
    const capabilityIds = new Set(value.graph.nodes
      .filter((node): node is Record<string, unknown> => isRecord(node) && node.kind === "capability" && typeof node.capabilityId === "string")
      .map((node) => String(node.capabilityId)));
    diagnostics.push(...validateStoryGraphStructureV2(value.graph.nodes, String(value.graph.startNodeId), graphParticipants, capabilityIds));
    if (Array.isArray(value.characterSlots) && graphParticipants.length !== value.characterSlots.length) diagnostics.push("story template graph participants do not match character slots");
  }
  if (!isRecord(value.fallback) || !exactKeys(value.fallback, ["deterministic", "abortSummary"]) || value.fallback.deterministic !== true || !text(value.fallback.abortSummary, 300)) diagnostics.push("story template fallback is invalid");
  const kinds = ["advance-time", "move", "record-clue", "set-arc-variable", "schedule-next-window", "reward-bundle", "relationship-event"];
  if (!Array.isArray(value.requiredCapabilityKinds) || value.requiredCapabilityKinds.length > kinds.length || value.requiredCapabilityKinds.some((kind) => !kinds.includes(String(kind))) || new Set(value.requiredCapabilityKinds).size !== value.requiredCapabilityKinds.length) diagnostics.push("story template capability requirements are invalid");
  if (!isRecord(value.provenance) || !exactKeys(value.provenance, ["source", "createdAt"], ["sourceEventId"]) || !["authored", "ai-favorite"].includes(String(value.provenance.source)) || !text(value.provenance.createdAt, 80) || (value.provenance.sourceEventId !== undefined && !text(value.provenance.sourceEventId))) diagnostics.push("story template provenance is invalid");
  return diagnostics;
}

export function isStoryTemplateDocumentV2(value: unknown): value is StoryTemplateDocumentV2 {
  return validateStoryTemplateDocumentV2(value).length === 0;
}

/** Record player intent only. Project filesystem export belongs to explicit
 * Mod Studio tooling and is never performed by the runtime. */
export function recordStoryTemplateFavorite(input: Readonly<GameState>, eventId: string): GameState {
  const state = cloneGameState(input);
  const event = state.narrativeEvents?.find((entry) => entry.id === eventId && entry.status === "resolved");
  if (!event || !isStoryProgramV2(event.program)) return state;
  if (state.storyTemplateFavorites?.some((entry) => entry.eventId === eventId && entry.status !== "cancelled")) return state;
  const request: StoryTemplateFavoriteRequest = {
    version: 1,
    id: `favorite:${eventId}`,
    eventId,
    requestedAtTick: state.time.tickValue,
    suggestedTitle: event.title,
    sourceProgram: structuredClone(event.program),
    status: "pending-export",
  };
  state.storyTemplateFavorites = [...(state.storyTemplateFavorites ?? []), request].slice(-32);
  return state;
}

export function storyTemplateDocumentFromFavorite(
  favorite: Readonly<StoryTemplateFavoriteRequest>,
  slug: string,
  title: string,
  createdAt: string,
): StoryTemplateDocumentV2 {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("template slug is unsafe");
  const program = favorite.sourceProgram;
  const requiredCapabilityKinds = [...new Set(program.capabilities.map((entry) => entry.kind))];
  return {
    version: 2,
    id: slug,
    title: title.trim().slice(0, 240),
    characterSlots: program.actorIds.map((_, index) => ({ id: index === 0 ? "lead" : `participant-${index + 1}`, min: 1, max: 1 })),
    locationConstraints: [...program.locationIds],
    triggerAnchors: ["manual"],
    graph: {
      version: 2,
      proposalId: `template:${slug}`,
      title: title.trim().slice(0, 240),
      contextHash: "template-preview",
      participantIds: [...program.actorIds],
      locationIds: [...program.locationIds],
      factIds: [],
      startNodeId: program.startNodeId,
      nodes: program.nodes.map((node) => structuredClone(node)),
    },
    fallback: { deterministic: true, abortSummary: "该事件未能在当前上下文中安全启动。" },
    requiredCapabilityKinds,
    provenance: { source: "ai-favorite", createdAt, sourceEventId: favorite.eventId },
  };
}
