import type { GameState } from "../state/game-state.js";
import {
  acceptEventRanking,
  compileEventOpportunitySet,
  consumeEventRanking,
  type EventOpportunitySet,
  type EventRankingProposal,
} from "../world/event-ranking.js";
import { validateStoryProgram } from "./validator.js";
import {
  STORY_PROGRAM_VERSION,
  type StoryBeat,
  type StoryProgramV1,
} from "./types.js";

export interface StoryTemplateDefinition {
  id: number;
  title: string;
  description: string;
}

export interface StorySelectionProposal extends EventRankingProposal {
  actorIds: number[];
  locationId: string;
}

export interface StorySelectionAcceptance {
  accepted: boolean;
  diagnostics: string[];
  program?: StoryProgramV1;
}

export const STORY_TEMPLATES: readonly StoryTemplateDefinition[] = [
  { id: 1, title: "片刻茶歇", description: "同场角色邀请主角在日常空隙里一起歇一会儿。" },
  { id: 2, title: "夹在书页里的旧叶", description: "同场角色发现一枚旧书签，并把是否追问交给玩家。" },
] as const;

function actorName(state: Readonly<GameState>, actorId: number): string {
  return state.charas[actorId]?.callName ?? state.charas[actorId]?.name ?? `角色#${actorId}`;
}

function programId(templateId: number, state: Readonly<GameState>, contextHash: string): string {
  return `story:${state.time.dayIndex}:${state.time.tickValue}:${templateId}:${contextHash}`;
}

function teaBreakBeats(name: string): StoryBeat[] {
  return [
    { id: "opening", kind: "narration", text: `短暂的空隙里，${name}把一只茶壶放到桌边。` },
    { id: "expression", kind: "ai-expression", actorId: -1, promptHint: "自然邀请主角一起短暂休息，不许承诺后续效果。", fallbackText: "正好歇一会儿。你要一起吗？" },
    { id: "choice", kind: "player-choice", question: "你打算怎么回应？", options: [
      { id: "help", label: "帮忙添水", nextBeatId: "help" },
      { id: "rest", label: "坐下休息", nextBeatId: "rest" },
    ] },
    { id: "help", kind: "narration", text: "你接过水壶添好热水，茶香很快在近处散开。", nextBeatId: "time" },
    { id: "rest", kind: "narration", text: "你在旁边坐下，没有急着打破这段安静。", nextBeatId: "time" },
    { id: "time", kind: "runtime-effect", handler: "advance-time", args: { minutes: 10 }, idempotencyKey: "tea-break-time" },
    { id: "end", kind: "end", outcomeId: "shared-break", summary: `你与${name}一起度过了一段短暂而平静的茶歇。` },
  ];
}

function oldLeafBeats(name: string): StoryBeat[] {
  return [
    { id: "opening", kind: "narration", text: `${name}翻动手边的书页时，一枚压得平整的旧叶滑了出来。` },
    { id: "expression", kind: "ai-expression", actorId: -1, promptHint: "对旧叶作一个克制的当下反应，不得宣称未发生的过去。", fallbackText: "原来还夹在这里……差点把它忘了。" },
    { id: "choice", kind: "player-choice", question: "要追问这枚旧叶吗？", options: [
      { id: "ask", label: "问问它的来历", nextBeatId: "ask" },
      { id: "leave", label: "不打扰这份回忆", nextBeatId: "leave" },
    ] },
    { id: "ask", kind: "narration", text: `${name}没有立刻回答，只把旧叶重新夹回了原来的那一页。`, nextBeatId: "time" },
    { id: "leave", kind: "narration", text: `你移开视线，${name}也安静地把旧叶收回书中。`, nextBeatId: "time" },
    { id: "time", kind: "runtime-effect", handler: "advance-time", args: { minutes: 5 }, idempotencyKey: "old-leaf-time" },
    { id: "end", kind: "end", outcomeId: "quiet-keepsake", summary: `你见到${name}收好了一枚夹在书页里的旧叶。` },
  ];
}

export function buildStoryProgram(
  state: Readonly<GameState>,
  templateId: number,
  actorIds: readonly number[],
  locationId: string,
  contextHash: string,
): StoryProgramV1 {
  const actorId = actorIds[0]!;
  const name = actorName(state, actorId);
  const beats = templateId === 1 ? teaBreakBeats(name) : templateId === 2 ? oldLeafBeats(name) : [];
  for (const beat of beats) if (beat.kind === "ai-expression") beat.actorId = actorId;
  const program: StoryProgramV1 = {
    version: STORY_PROGRAM_VERSION,
    id: programId(templateId, state, contextHash),
    templateId,
    contextHash,
    createdAtTick: state.time.tickValue,
    actorIds: [...actorIds],
    locationId,
    beats,
    cursor: 0,
    status: "active",
    executedBeatIds: [],
    executedEffectIds: [],
    selectedChoices: {},
  };
  const diagnostics = validateStoryProgram(program);
  if (diagnostics.length > 0) throw new Error(`invalid authored StoryProgram fixture: ${diagnostics.join("; ")}`);
  return program;
}

/** Deterministic two-template opportunity. The model may only rank these IDs
 * and choose one currently present actor plus the already fixed location. */
export function compileStoryOpportunity(state: Readonly<GameState>): EventOpportunitySet {
  const actorIds = Object.values(state.charas)
    .filter((slot) => slot.location === state.master.location)
    .map((slot) => slot.charaNum)
    .sort((left, right) => left - right)
    .slice(0, 4);
  const candidates = STORY_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.title,
    source: "modern" as const,
    characterIds: actorIds,
    locationIds: [state.master.location],
    safety: ["deterministic", "authored", "fail-closed"] as const,
  }));
  return compileEventOpportunitySet({
    channel: "story",
    dayIndex: state.time.dayIndex,
    contextKey: `${state.time.tickValue}:${state.master.location}`,
    candidates,
  });
}

export function acceptStorySelection(
  state: GameState,
  opportunity: EventOpportunitySet,
  proposal: StorySelectionProposal,
): StorySelectionAcceptance {
  if (state.storyProgram?.status === "active") return { accepted: false, diagnostics: ["another story program is active"] };
  const ranked = acceptEventRanking(state, opportunity, proposal);
  if (!ranked.accepted) return { accepted: false, diagnostics: ranked.diagnostics };
  const ranking = consumeEventRanking(state, opportunity);
  const templateId = ranking?.[0];
  const template = opportunity.candidates.find((candidate) => candidate.id === templateId);
  const diagnostics: string[] = [];
  if (!template) diagnostics.push("story template is unknown");
  if (proposal.locationId !== state.master.location || !template?.locationIds?.includes(proposal.locationId)) diagnostics.push("story location is unknown or stale");
  if (proposal.actorIds.length !== 1 || new Set(proposal.actorIds).size !== 1
    || proposal.actorIds.some((id) => !template?.characterIds?.includes(id) || !state.charas[id])) diagnostics.push("story actor is unknown or unavailable");
  if (diagnostics.length > 0 || templateId === undefined) return { accepted: false, diagnostics };
  const program = buildStoryProgram(state, templateId, proposal.actorIds, proposal.locationId, opportunity.contextHash);
  state.storyProgram = program;
  return { accepted: true, diagnostics: [], program };
}
