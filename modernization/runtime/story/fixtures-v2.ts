import type { GameState } from "../state/game-state.js";
import { activeWeatherWarnings } from "../weather/warnings.js";
import { dateOf, seasonOf } from "../world/calendar.js";
import { ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import { NARRATIVE_MAX_PARTICIPANTS } from "./types.js";
import { compileStoryGraphProposalV2 } from "./compiler.js";
import { scheduleNarrativeEvent, type NarrativeMutationResult } from "./lifecycle.js";
import { compileNarrativeSnapshot, compileRuntimeCapabilityOptions, type NarrativeContextV1 } from "./snapshot.js";
import { createArcMaintenance } from "./arc-maintenance.js";
import { STORY_PROGRAM_V2_VERSION, type StoryArcInstanceV1, type StoryGraphNodeV2, type StoryGraphProposalV2 } from "./types.js";

function participantIds(state: Readonly<GameState>): number[] {
  return [
    0,
    ...Object.values(state.charas)
      .filter((slot) => slot.location === state.master.location)
      .sort((left, right) => left.charaNum - right.charaNum)
      .map((slot) => slot.charaNum),
  ].slice(0, NARRATIVE_MAX_PARTICIPANTS);
}

function proposal(
  id: string,
  title: string,
  context: NarrativeContextV1,
  participants: number[],
  locations: string[],
  startNodeId: string,
  nodes: StoryGraphNodeV2[],
  factIds: string[] = [],
): StoryGraphProposalV2 {
  return {
    version: STORY_PROGRAM_V2_VERSION,
    proposalId: id,
    title,
    contextHash: context.snapshot.contextHash,
    participantIds: participants,
    locationIds: locations,
    factIds,
    startNodeId,
    nodes,
  };
}

function capabilityId(context: NarrativeContextV1, predicate: (id: string) => boolean): string {
  const found = context.capabilities.find((entry) => predicate(entry.id));
  if (!found) throw new Error("authored narrative fixture capability is unavailable");
  return found.id;
}

/** Deterministic fixture for tests/dev tooling. Automatic Director code must
 * not use it as a provider-failure fallback. */
export function buildTanabataFixture(state: Readonly<GameState>): { context: NarrativeContextV1; proposal: StoryGraphProposalV2; windowStartTick: number; windowEndTick: number } | null {
  if (seasonOf(state.time) !== 2 || dateOf(state.time) !== 7) return null;
  if (!ROOM_CATALOG_BY_LOCATION[state.master.location]) return null;
  const participants = participantIds(state);
  if (participants.length < 2) return null;
  const context = compileNarrativeSnapshot(state, compileRuntimeCapabilityOptions(state, participants));
  const time = capabilityId(context, (id) => id === "time:10");
  const actorId = participants.find((id) => id !== 0)!;
  const graph = proposal(
    `tanabata:${state.time.dayIndex}`,
    "七夕星愿插曲",
    context,
    participants,
    [state.master.location],
    "opening",
    [
      { id: "opening", kind: "narration", text: "七夕的日常庆祝仍在继续，近旁有人留意到了夜空与短笺。" },
      { id: "talk", kind: "bounded-talk", participantIds: [actorId], topicGoal: "围绕当下可见的七夕景象进行简短交流", exitCondition: "玩家作出选择后结束话题", fallbackLines: ["今晚的星光很适合写下一件小小的愿望。", "要不要也留一张短笺？"] },
      { id: "choice", kind: "player-choice", question: "要怎样回应这份七夕邀请？", options: [
        { id: "write", label: "一起写下短笺", nextNodeId: "write" },
        { id: "watch", label: "先安静看星星", nextNodeId: "watch" },
      ] },
      { id: "write", kind: "narration", text: "你们把短笺系好，让它在夜风中轻轻晃动。", nextNodeId: "time" },
      { id: "watch", kind: "narration", text: "你们没有急着许愿，只一起看了一会儿夜空。", nextNodeId: "time" },
      { id: "time", kind: "capability", capabilityId: time },
      { id: "end", kind: "end", outcomeId: "tanabata-shared-moment", summary: "你与同伴在七夕留下了一段共同的星夜回忆。" },
    ],
  );
  const dayStart = state.time.dayIndex * 1440;
  return { context, proposal: graph, windowStartTick: Math.max(state.time.tickValue, dayStart + 18 * 60), windowEndTick: dayStart + 23 * 60 };
}

export function scheduleTanabataFixture(state: Readonly<GameState>): NarrativeMutationResult {
  const fixture = buildTanabataFixture(state);
  if (!fixture) return { state: structuredClone(state) as GameState, accepted: false, diagnostics: ["tanabata anchor is not active"] };
  const compiled = compileStoryGraphProposalV2(fixture.proposal, fixture.context, {
    createdAtTick: state.time.tickValue,
    eventId: fixture.proposal.proposalId,
    windowStartTick: fixture.windowStartTick,
    windowEndTick: fixture.windowEndTick,
  });
  if (!compiled.accepted) return { state: structuredClone(state) as GameState, accepted: false, diagnostics: compiled.diagnostics };
  return scheduleNarrativeEvent(state, {
    id: fixture.proposal.proposalId,
    title: fixture.proposal.title,
    windowStartTick: fixture.windowStartTick,
    windowEndTick: fixture.windowEndTick,
    program: compiled.program,
    anchor: "tanabata",
  });
}
export function weatherAnomalyAnchorActive(state: GameState): boolean {
  try {
    return activeWeatherWarnings(state).length > 0;
  } catch {
    return false;
  }
}

export function createWeatherArcFixture(state: Readonly<GameState>, force = false, selectedParticipants?: readonly number[]): StoryArcInstanceV1 | null {
  if (!force && !weatherAnomalyAnchorActive(state as GameState)) return null;
  const participants = selectedParticipants ? [...selectedParticipants] : participantIds(state);
  if (participants.length < 2) return null;
  const id = `arc:weather-anomaly:${state.time.dayIndex}`;
  return {
    version: 1,
    id,
    templateId: "weather-anomaly",
    title: "异常天气调查",
    status: "active",
    phase: 1,
    participantRoles: participants.map((characterId, index) => ({ characterId, roleId: index === 0 ? "player-investigator" : "investigator" })),
    goals: ["确认异常天气的可观察征兆", "收集两处调查线索", "在五日内形成解释并收束"],
    acceptedFactIds: [],
    unresolvedThreads: ["异常天气的来源尚未解释"],
    deadlineTick: state.time.tickValue + 5 * 1440,
    variables: {},
    beatHistory: [],
    nextOpportunities: [],
    providerFailureDays: 0,
    maintenance: createArcMaintenance(),
  };
}

export function addWeatherArcFixture(state: Readonly<GameState>, force = false): GameState {
  const next = structuredClone(state) as GameState;
  const active = (next.storyArcs ?? []).filter((arc) => arc.status === "active" || arc.status === "paused");
  if (active.length >= 3 || active.some((arc) => arc.templateId === "weather-anomaly")) return next;
  const arc = createWeatherArcFixture(next, force);
  if (arc) next.storyArcs = [...(next.storyArcs ?? []), arc];
  return next;
}

export function createFreeStoryArcFixture(state: Readonly<GameState>, selectedParticipants?: readonly number[]): StoryArcInstanceV1 | null {
  const participants = selectedParticipants ? [...selectedParticipants] : participantIds(state);
  // Allow solo narrative (主角独自一人也可以有故事：梦境、回忆、独处事件等)
  return {
    version: 1,
    id: `arc:free-story:${state.time.dayIndex}:${state.time.tickValue}:${state.storyArcs?.length ?? 0}`,
    templateId: "free-story",
    title: "待命名故事",
    status: "active",
    phase: 1,
    participantRoles: participants.map((characterId, index) => ({ characterId, roleId: index === 0 ? "player-entry" : "story-candidate" })),
    goals: [],
    acceptedFactIds: [],
    unresolvedThreads: [],
    deadlineTick: state.time.tickValue + 3 * 1440,
    variables: {},
    beatHistory: [],
    nextOpportunities: [],
    providerFailureDays: 0,
    maintenance: createArcMaintenance(),
  };
}

function phaseOneProposal(state: Readonly<GameState>, arc: StoryArcInstanceV1, context: NarrativeContextV1, participants: number[]): StoryGraphProposalV2 {
  const actorId = participants.find((id) => id !== 0)!;
  const weatherCapabilityId = capabilityId(context, (id) => id.startsWith("weather-incident:"));
  const interactionCapabilityId = capabilityId(context, (id) => id.startsWith("interaction:"));
  return proposal(`weather:${arc.id}:phase:1`, "异常天气：征兆", context, participants, [state.master.location], "opening", [
    { id: "opening", kind: "narration", text: "天气警报之外，空气里还残留着一段难以解释的异样。" },
    { id: "weather", kind: "capability", capabilityId: weatherCapabilityId },
    { id: "notice", kind: "expression", actorId, objective: "指出一个与当前真实天气变化相符、可继续调查的异常征兆", fallbackText: "这阵风的方向……和刚才的警报对不上。" },
    { id: "interaction", kind: "capability", capabilityId: interactionCapabilityId },
    { id: "schedule", kind: "capability", capabilityId: capabilityId(context, (id) => id === "arc-window:tomorrow") },
    { id: "end", kind: "end", outcomeId: "weather-omen-noticed", summary: "调查者确认了异常征兆，并决定在次日继续寻找线索。" },
  ]);
}

function phaseTwoProposal(arc: StoryArcInstanceV1, context: NarrativeContextV1, participants: number[]): StoryGraphProposalV2 {
  const actorId = participants.find((id) => id !== 0)!;
  const shrineMove = capabilityId(context, (id) => id.startsWith("move:") && (context.capabilities.find((capability) => capability.id === id) as { locationId?: string }).locationId === "神社:境内");
  const villageMove = capabilityId(context, (id) => id.startsWith("move:") && (context.capabilities.find((capability) => capability.id === id) as { locationId?: string }).locationId === "人間之里:中央広場");
  return proposal(`weather:${arc.id}:phase:2`, "异常天气：线索调查", context, participants, ["神社:境内", "人間之里:中央広場"], "route", [
    { id: "route", kind: "player-choice", question: "先从哪里开始调查？", options: [
      { id: "shrine", label: "神社境内", nextNodeId: "move-shrine" },
      { id: "village", label: "人间之里中央广场", nextNodeId: "move-village" },
    ] },
    { id: "move-shrine", kind: "capability", capabilityId: shrineMove, nextNodeId: "clue-shrine" },
    { id: "clue-shrine", kind: "capability", capabilityId: "clue:shrine-trace", nextNodeId: "agent" },
    { id: "move-village", kind: "capability", capabilityId: villageMove, nextNodeId: "clue-village" },
    { id: "clue-village", kind: "capability", capabilityId: "clue:village-report", nextNodeId: "agent" },
    { id: "agent", kind: "agent-choice", actorId, question: "接下来采用哪种调查方式？", options: [
      { id: "careful", label: "谨慎比对记录", nextNodeId: "careful" },
      { id: "direct", label: "直接追查来源", nextNodeId: "direct" },
    ], fallbackOptionId: "careful" },
    { id: "careful", kind: "capability", capabilityId: "arc-variable:approach:careful", nextNodeId: "schedule" },
    { id: "direct", kind: "capability", capabilityId: "arc-variable:approach:direct", nextNodeId: "schedule" },
    { id: "schedule", kind: "capability", capabilityId: "arc-window:tomorrow" },
    { id: "end", kind: "end", outcomeId: "weather-clue-collected", summary: "调查者取得了一条可核对的线索，并选定了继续调查的方法。" },
  ]);
}

function phaseThreeProposal(arc: StoryArcInstanceV1, context: NarrativeContextV1, participants: number[]): StoryGraphProposalV2 {
  const fallback = arc.variables.approach === "direct" ? "reward" : "teamwork";
  return proposal(`weather:${arc.id}:phase:3`, "异常天气：调查收束", context, participants, ["神社:境内", "人間之里:中央広場"], "summary", [
    { id: "summary", kind: "narration", text: "已经接受的线索拼出了一个不完整却足以说明异样的轮廓；调查没有改写天气本身。" },
    { id: "conclusion", kind: "director-choice", question: "在已有分支中选择收束重点", options: [
      { id: "reward", label: "形成报告并领取报酬", nextNodeId: "reward" },
      { id: "teamwork", label: "强调共同调查的经历", nextNodeId: "teamwork" },
    ], fallbackOptionId: fallback },
    { id: "reward", kind: "capability", capabilityId: "reward:weather-investigation", nextNodeId: "end" },
    { id: "teamwork", kind: "capability", capabilityId: "relationship:weather-teamwork", nextNodeId: "end" },
    { id: "end", kind: "end", outcomeId: `weather-resolved:${fallback}`, summary: "异常天气的征兆得到了解释，线索和调查结果被正式记录。" },
  ], [...arc.acceptedFactIds]);
}

export function buildWeatherArcPhaseFixture(state: Readonly<GameState>, arcId: string): { context: NarrativeContextV1; proposal: StoryGraphProposalV2; windowStartTick: number; windowEndTick: number } | null {
  const arc = state.storyArcs?.find((entry) => entry.id === arcId && entry.status === "active");
  if (!arc || state.time.tickValue > arc.deadlineTick) return null;
  const participants = arc.participantRoles.map((entry) => entry.characterId);
  const capabilities = compileRuntimeCapabilityOptions(state, participants, { arcId, includeWeatherLocations: true });
  const context = compileNarrativeSnapshot(state, capabilities);
  const opportunity = arc.nextOpportunities.find((entry) => state.time.tickValue <= entry.latestTick);
  const windowStartTick = Math.max(state.time.tickValue, opportunity?.earliestTick ?? state.time.tickValue);
  const windowEndTick = Math.min(arc.deadlineTick, opportunity?.latestTick ?? state.time.tickValue + 6 * 60);
  const graph = arc.phase === 1
    ? phaseOneProposal(state, arc, context, participants)
    : arc.phase === 2
      ? phaseTwoProposal(arc, context, participants)
      : phaseThreeProposal(arc, context, participants);
  return { context, proposal: graph, windowStartTick, windowEndTick };
}

export function scheduleWeatherArcPhaseFixture(state: Readonly<GameState>, arcId: string): NarrativeMutationResult {
  const fixture = buildWeatherArcPhaseFixture(state, arcId);
  if (!fixture) return { state: structuredClone(state) as GameState, accepted: false, diagnostics: ["weather arc phase is unavailable"] };
  const compiled = compileStoryGraphProposalV2(fixture.proposal, fixture.context, {
    createdAtTick: state.time.tickValue,
    eventId: fixture.proposal.proposalId,
    arcId,
    windowStartTick: fixture.windowStartTick,
    windowEndTick: fixture.windowEndTick,
  });
  if (!compiled.accepted) return { state: structuredClone(state) as GameState, accepted: false, diagnostics: compiled.diagnostics };
  return scheduleNarrativeEvent(state, {
    id: fixture.proposal.proposalId,
    title: fixture.proposal.title,
    windowStartTick: fixture.windowStartTick,
    windowEndTick: fixture.windowEndTick,
    program: compiled.program,
    arcId,
    anchor: "weather-anomaly",
  });
}
