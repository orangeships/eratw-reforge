import type { AcceptedExperience } from "../experience.js";
import { isExperienceVisibleTo } from "../experience.js";
import { resolveStateContext, type StateFact } from "../ai-state/context.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import type { GameState } from "../state/game-state.js";
import { projectCalendarAgenda, type CalendarAgendaDay } from "../world/calendar-agenda.js";
import { ROOM_CATALOG } from "../world/room-catalog.js";
import { relationOf } from "../world/relation.js";
import { compileWeatherIncidentOptions } from "../weather/narrative-incident.js";
import { weatherStatusShow } from "../weather/display.js";
import { narrativeCastWaitReason } from "./attendance.js";
import type { RuntimeCapabilityKind, RuntimeCapabilityOption, StoryArcInstanceV1, StoryRoundSummaryV1 } from "./types.js";
import { NARRATIVE_MAX_PARTICIPANTS } from "./types.js";

export const NARRATIVE_SNAPSHOT_VERSION = 1 as const;

/** A subjective belief held by one character. `subject` is who holds it, so a
 * model can never promote "she thinks he hates her" into a world fact. */
export interface NarrativeSubjectiveLineV1 {
  subject: number;
  kind: "belief" | "goal" | "thread";
  text: string;
  /** Only present for open social threads. */
  threadKind?: string;
}

export interface NarrativeCharacterSnapshotV1 {
  /** Live attendance only; a generated premise cannot override world activity. */
  attendance?: { available: boolean; waitReason: string | null };
  /** Director-owned plans and actual expression receipts; never canonical action facts. */
  dialogueHooks?: Array<Pick<import("./dialogue-hook.js").NarrativeHookV1, "id" | "storyId" | "sceneId" | "revision" | "status" | "objective" | "lastReceipt" | "playerResponse" | "completion" | "expressedLines">>;
  /** Immutable historical root; shell retrieves bounded subjective excerpts. */
  archiveHead?: string;
  id: number;
  name: string;
  locationId: string;
  knowledge: Array<{ id: string; tick: number; summary: string }>;
  goals: Array<{ id: string; summary: string }>;
  relationship: ReturnType<typeof deriveRelationshipAuthority> | null;
  /** Personality, voice, and boundaries. Shell-injected: the runtime layer has
   * no access to the character-card catalog. Empty when the caller omits it. */
  persona: string[];
  /** Open L2 social threads owned by this character. */
  threads: Array<{ id: string; kind: string; text: string; updatedTick: number }>;
  /** Only facts this character is allowed to know, from the Experience
   * visibility rules. Never the full world history. */
  knownExperiences: Array<{ id: string; kind: string; summary: string; endTick: number }>;
  /** Tick of this character's most recent recorded interaction with the player. */
  recentInteractionTick?: number;
}

export interface NarrativeCapabilityReferenceV1 {
  id: string;
  kind: RuntimeCapabilityKind;
  label: string;
  description: string;
}

export interface NarrativeSnapshotV1 {
  semanticFacts?: StateFact[];
  semanticQueryHash?: string;
  version: typeof NARRATIVE_SNAPSHOT_VERSION;
  createdAtTick: number;
  dayIndex: number;
  locationId: string;
  futureAgenda: CalendarAgendaDay[];
  acceptedExperiences: AcceptedExperience[];
  characters: NarrativeCharacterSnapshotV1[];
  compatibility: Array<{ fromId: number; toId: number; value: number }>;
  /** Subjective material, each line tagged with the character that holds it.
   * Kept separate from the objective fields so a prompt can label it. */
  subjective: NarrativeSubjectiveLineV1[];
  activeArcs: StoryArcInstanceV1[];
  rooms: Array<{ roomId: number; locationId: string; mapId: number }>;
  weather: {
    regionName: string;
    weatherName: string;
    warnings: string[];
    activeIncidentIds: string[];
  };
  capabilities: NarrativeCapabilityReferenceV1[];
  /** Accepted story receipts, separate from creative background and future plans. */
  storyContinuation?: {
    programId: string;
    arcId?: string;
    roundIndex: number;
    recentRounds: StoryRoundSummaryV1[];
    playerInteraction?: { id: string; targetId: number; commandNo: number; tick: number; roundIndex: number; summary?: string };
  };
  contextHash: string;
}

export interface NarrativeContextV1 {
  /** Only this Arc's premise governs the request; other Arcs remain context. */
  storyArcId?: string;
  /** Informational names only; they grant no participant or state-write authority. */
  unavailableIntentCharacterNames?: readonly string[];
  semanticQueries?: { topics: Array<{ id: string; label: string }>; answers: Record<string, StateFact[]> };
  snapshot: Readonly<NarrativeSnapshotV1>;
  capabilities: readonly RuntimeCapabilityOption[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Browser-safe stable hash shared by snapshot freshness checks and tests. */
export function narrativeContextHash(value: unknown): string {
  const text = canonical(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function capabilityReferences(capabilities: readonly RuntimeCapabilityOption[]): NarrativeCapabilityReferenceV1[] {
  return capabilities.map(({ id, kind, label, description }) => ({ id, kind, label, description }));
}

export function compileRuntimeCapabilityOptions(
  state: Readonly<GameState>,
  participantIds: readonly number[],
  options: { arcId?: string; includeWeatherLocations?: boolean; sceneLocationId?: string } = {},
): RuntimeCapabilityOption[] {
  const tick = state.time.tickValue;
  const ids = [...new Set(participantIds)].filter((id) => id === 0 || !!state.charas[id]).slice(0, NARRATIVE_MAX_PARTICIPANTS);
  const arcId = options.arcId;
  const arc = state.storyArcs?.find(entry => entry.id === arcId);
  const weatherArc = arc?.templateId === "weather-anomaly";
  const result: RuntimeCapabilityOption[] = [5, 10, 20].map((minutes) => ({
    id: `time:${minutes}`,
    kind: "advance-time" as const,
    label: `推进 ${minutes} 分钟`,
    description: "由运行时推进有限游戏时间。",
    idempotencyKey: `time:${tick}:${minutes}`,
    minutes,
  }));

  const locations = new Set<string>([state.master.location]);
  if (options.sceneLocationId && ROOM_CATALOG.some(room => room.location === options.sceneLocationId)) locations.add(options.sceneLocationId);
  if (options.includeWeatherLocations) {
    locations.add("神社:境内");
    locations.add("人間之里:中央広場");
  }
  for (const locationId of [...locations].filter((value) => ROOM_CATALOG.some((room) => room.location === value))) {
    result.push({
      id: `move:${narrativeContextHash({ ids, locationId })}`,
      kind: "move",
      label: `前往 ${locationId}`,
      description: "运行时移动已列出的参与者到合法 RoomCatalog 地点。",
      idempotencyKey: `move:${tick}:${narrativeContextHash({ ids, locationId })}`,
      actorIds: ids,
      locationId,
    });
  }

  if (options.includeWeatherLocations) {
    for (const incident of compileWeatherIncidentOptions(state)) {
      result.push({
        id: `weather-incident:${incident.id}`,
        kind: "schedule-weather-incident",
        label: incident.label,
        description: incident.description,
        idempotencyKey: incident.idempotencyKey,
        incident,
      });
    }
  }

  if (arcId) {
    for (const clueId of weatherArc ? ["shrine-trace", "village-report", "weather-pattern"] as const : []) {
      result.push({
        id: `clue:${clueId}`,
        kind: "record-clue",
        label: `记录线索：${clueId}`,
        description: "只记录当前 StoryArc 的已接受线索。",
        idempotencyKey: `${arcId}:clue:${clueId}`,
        arcId,
        clueId,
        summary: `调查记录了线索 ${clueId}。`,
      });
    }
    result.push(
      {
        id: `interaction:${arcId}:${state.time.dayIndex}`,
        kind: "open-interaction-window",
        label: "开放角色互动窗口",
        description: "让事件参与者在当前阶段通过普通命令和对话形成可验证事实。",
        idempotencyKey: `${arcId}:interaction:${state.time.dayIndex}`,
        directive: {
          version: 1,
          eventId: `interaction:${arcId}:${state.time.dayIndex}`,
          arcId,
          beatId: `${weatherArc ? "weather-investigation" : "story-interaction"}:phase:${arc?.phase ?? 1}`,
          participantIds: ids,
          objective: weatherArc ? "围绕当前事件阶段交流，并通过合法行动取得下一条真实线索。" : "沿用当前故事背景和已发生的互动，回应本幕尚未解决的问题；不另起无关调查。",
          actorRole: "事件参与者",
          visibleFactIds: [...(state.storyArcs?.find((entry) => entry.id === arcId)?.acceptedFactIds ?? [])],
          revealableFactIds: [...(state.storyArcs?.find((entry) => entry.id === arcId)?.acceptedFactIds ?? [])],
          forbiddenClaims: weatherArc ? ["尚未结算的天气变化", "尚未取得的线索", "尚未完成的后续事件"] : ["尚未作出的玩家选择", "尚未完成的后续事件"],
          allowedIntentIds: weatherArc ? ["investigate-current-location", "follow-character-lead", "change-destination", "leave-event"] : ["follow-character-lead", "change-destination", "leave-event"],
          completionFactIds: weatherArc ? ["event-intent:investigate-current-location", "event-intent:follow-character-lead"] : ["event-intent:follow-character-lead"],
          openedAtTick: tick,
          expiresAtTick: Math.min(tick + 1440, state.storyArcs?.find((entry) => entry.id === arcId)?.deadlineTick ?? tick + 1440),
        },
      },
    );
    if (weatherArc) result.push(
      {
        id: "arc-variable:approach:careful",
        kind: "set-arc-variable",
        label: "采用谨慎调查方式",
        description: "设置受限的 Arc 局部选项，不写游戏字段。",
        idempotencyKey: `${arcId}:approach:careful`,
        arcId,
        variableId: "approach",
        valueId: "careful",
      },
      {
        id: "arc-variable:approach:direct",
        kind: "set-arc-variable",
        label: "采用直接调查方式",
        description: "设置受限的 Arc 局部选项，不写游戏字段。",
        idempotencyKey: `${arcId}:approach:direct`,
        arcId,
        variableId: "approach",
        valueId: "direct",
      },
    );
    result.push(
      {
        id: "arc-window:tomorrow",
        kind: "schedule-next-window",
        label: weatherArc ? "安排次日调查窗口" : "安排次日故事互动机会",
        description: "由运行时在允许期限内安排下一次机会。",
        idempotencyKey: `${arcId}:window:${state.time.dayIndex + 1}`,
        arcId,
        earliestTick: (state.time.dayIndex + 1) * 1440 + 9 * 60,
        latestTick: (state.time.dayIndex + 1) * 1440 + 18 * 60,
        locationId: weatherArc ? "人間之里:中央広場" : options.sceneLocationId
          ?? state.charas[arc?.participantRoles.find(role => role.characterId > 0)?.characterId ?? -1]?.location ?? state.master.location,
      },
    );
    if (weatherArc) result.push(
      {
        id: "reward:weather-investigation",
        kind: "reward-bundle",
        label: "调查报酬",
        description: "运行时预生成的小额调查报酬。",
        idempotencyKey: `${arcId}:reward:weather-investigation`,
        rewardId: "weather-investigation",
        money: 500,
        summary: "因完成异常天气调查获得了报酬。",
      },
      {
        id: "relationship:weather-teamwork",
        kind: "relationship-event",
        label: "共同调查的经历",
        description: "记录一次确定性关系事件，不提供数值差分。",
        idempotencyKey: `${arcId}:relationship:weather-teamwork`,
        eventId: "weather-teamwork",
        participantIds: ids,
        summary: "大家共同完成了异常天气调查。",
      },
    );
  }
  return result;
}

/** Most recent experiences a bounded character view carries. */
const NARRATIVE_KNOWN_EXPERIENCES = 6;
/** Related-experience cap for the shared snapshot pool. */
const NARRATIVE_RELEVANT_EXPERIENCES = 24;
/** Lookback window for experience relevance, matching the L1 route. */
const NARRATIVE_EXPERIENCE_LOOKBACK_TICKS = 7 * 24 * 60;

/** Experiences this cast can plausibly act on: tied to a participant or the
 * current location, unresolved by any active Arc, and recent. Falls back to
 * the newest entries so a quiet week still gives the model some continuity. */
function selectNarrativeExperiences(
  state: Readonly<GameState>,
  participantIds: readonly number[],
): AcceptedExperience[] {
  const nowTick = state.time.tickValue;
  const oldestTick = nowTick - NARRATIVE_EXPERIENCE_LOOKBACK_TICKS;
  const related = new Set(participantIds);
  const resolvedFactIds = new Set((state.storyArcs ?? []).flatMap((arc) => arc.acceptedFactIds));
  const pool = (state.acceptedExperiences ?? [])
    .filter((experience) => experience.endTick <= nowTick);
  const scored = pool
    .map((experience) => {
      const characterRelevant = experience.actorIds.some((id) => related.has(id))
        || experience.participantIds.some((id) => related.has(id));
      const locationRelevant = experience.locationIds.includes(state.master.location);
      // Unresolved material outranks already-explained material, so the model
      // continues open threads instead of replaying settled ones.
      const unresolved = experience.contextHash && !resolvedFactIds.has(experience.id);
      const recent = experience.endTick >= oldestTick;
      return {
        experience,
        score: (characterRelevant ? 4 : 0)
          + (unresolved ? 2 : 0)
          + (locationRelevant ? 1 : 0)
          + (recent ? 1 : 0),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || right.experience.endTick - left.experience.endTick
      || left.experience.id.localeCompare(right.experience.id))
    .slice(0, NARRATIVE_RELEVANT_EXPERIENCES);
  const selected = scored.length > 0 ? scored : pool.slice(-NARRATIVE_RELEVANT_EXPERIENCES).map((experience) => ({ experience }));
  return selected.map((entry) => entry.experience);
}

/** Facts one character is allowed to know, honouring Experience visibility. */
function knownExperiencesFor(
  experiences: readonly AcceptedExperience[],
  charaNum: number,
): NarrativeCharacterSnapshotV1["knownExperiences"] {
  return experiences
    .filter((experience) => isExperienceVisibleTo(experience, charaNum))
    .slice(-NARRATIVE_KNOWN_EXPERIENCES)
    .map((experience) => ({
      id: experience.id,
      kind: experience.kind,
      summary: experience.payload.summary,
      endTick: experience.endTick,
    }));
}

/** Most recent tick at which this character was observed interacting with the
 * player, used to ground "how well do these two actually know each other". */
function recentInteractionTick(state: Readonly<GameState>, charaNum: number): number | undefined {
  const ticks = (state.agentRuntime?.cognitions[charaNum]?.observations ?? [])
    .filter((observation) => observation.participants.includes(0))
    .map((observation) => observation.tick);
  const signals = (state.agentRuntime?.engagements?.[charaNum]?.signals ?? []).map((signal) => signal.tick);
  const all = [...ticks, ...signals];
  return all.length > 0 ? Math.max(...all) : undefined;
}

export function compileNarrativeSnapshot(
  state: Readonly<GameState>,
  capabilities: readonly RuntimeCapabilityOption[] = compileRuntimeCapabilityOptions(
    state,
    [0, ...Object.values(state.charas).filter((slot) => slot.location === state.master.location).map((slot) => slot.charaNum)].slice(0, NARRATIVE_MAX_PARTICIPANTS),
  ),
  participantIds?: readonly number[],
  personaFor?: (charaNum: number) => readonly string[],
): NarrativeContextV1 {
  const master = state.master;
  const weather = weatherStatusShow(state);
  const castIds = participantIds ?? Object.values(state.charas).map((slot) => slot.charaNum);
  const experiences = selectNarrativeExperiences(state, castIds);
  const characters: NarrativeCharacterSnapshotV1[] = [
    {
      id: 0,
      name: master.callName ?? master.name ?? "主人公",
      locationId: master.location,
      attendance: { available: narrativeCastWaitReason(state, [0]) === null, waitReason: narrativeCastWaitReason(state, [0]) },
      knowledge: [],
      goals: [],
      relationship: null,
      persona: [],
      threads: [],
      knownExperiences: [],
    },
    ...Object.values(state.charas)
      .filter((slot) => !participantIds || participantIds.includes(slot.charaNum))
      .sort((left, right) => left.charaNum - right.charaNum)
      .map((slot) => {
        const cognition = state.agentRuntime?.cognitions[slot.charaNum];
        const interactionTick = recentInteractionTick(state, slot.charaNum);
        return {
          id: slot.charaNum,
          name: slot.callName ?? slot.name ?? `角色#${slot.charaNum}`,
          locationId: slot.location,
          attendance: { available: narrativeCastWaitReason(state, [slot.charaNum]) === null, waitReason: narrativeCastWaitReason(state, [slot.charaNum]) },
          knowledge: (cognition?.observations ?? []).slice(-24).map((entry) => ({ id: entry.id, tick: entry.tick, summary: entry.text })),
          goals: (cognition?.mind?.goals?.length
            ? cognition.mind.goals.filter((entry) => entry.status !== "resolved").slice(0, 3).map((entry) => ({ id: entry.id, summary: entry.text }))
            : (cognition?.goals ?? []).filter((entry) => entry.status === "active").slice(0, 8).map((entry) => ({ id: entry.id, summary: entry.text }))),
          relationship: deriveRelationshipAuthority(slot, master, state),
          ...(state.narrativeHooks?.some(h => h.speakerId === slot.charaNum) ? { dialogueHooks: state.narrativeHooks
            .filter(h => h.speakerId === slot.charaNum).map(h => structuredClone({ id: h.id, storyId: h.storyId,
              sceneId: h.sceneId, revision: h.revision, status: h.status, objective: h.objective,
              ...(h.completion ? { completion: h.completion } : {}),
              ...(h.playerResponse ? { playerResponse: h.playerResponse } : {}),
              ...(h.lastReceipt ? { lastReceipt: h.lastReceipt } : {}),
              ...(h.expressedLines ? { expressedLines: h.expressedLines } : {}) })) } : {}),
          persona: [...(personaFor?.(slot.charaNum) ?? [])],
          threads: (cognition?.mind?.threads ?? [])
            .filter((thread) => thread.status === "open")
            .slice(0, 6)
            .map((thread) => ({ id: thread.id, kind: thread.kind, text: thread.text, updatedTick: thread.updatedTick })),
          knownExperiences: knownExperiencesFor(experiences, slot.charaNum),
          ...(state.agentRuntime?.memoryArchive?.heads[slot.charaNum]
            ? { archiveHead: state.agentRuntime.memoryArchive.heads[slot.charaNum] } : {}),
          ...(interactionTick === undefined ? {} : { recentInteractionTick: interactionTick }),
        };
      }),
  ];
  const compatibility = characters.flatMap((from) => characters
    .filter((to) => to.id !== from.id)
    .map((to) => ({ fromId: from.id, toId: to.id, value: relationOf(from.id, to.id) }))
    .filter((entry) => entry.value !== 0));
  // Subjective material is collected separately and tagged with its holder so
  // a prompt can present it as belief rather than fact.
  const subjective: NarrativeSubjectiveLineV1[] = Object.values(state.charas)
    .filter((slot) => !participantIds || participantIds.includes(slot.charaNum))
    .flatMap((slot) => {
      const mind = state.agentRuntime?.cognitions[slot.charaNum]?.mind;
      if (!mind) return [];
      const lines: NarrativeSubjectiveLineV1[] = [];
      for (const belief of mind.beliefs.filter((entry) => entry.status !== "resolved").slice(0, 3)) {
        lines.push({ subject: slot.charaNum, kind: "belief", text: belief.text });
      }
      for (const goal of mind.goals.filter((entry) => entry.status !== "resolved").slice(0, 3)) {
        lines.push({ subject: slot.charaNum, kind: "goal", text: goal.text });
      }
      for (const thread of mind.threads.filter((entry) => entry.status === "open").slice(0, 4)) {
        lines.push({ subject: slot.charaNum, kind: "thread", text: thread.text, threadKind: thread.kind });
      }
      return lines;
    });
  const semanticInput = { state, route: "l3" as const, observer: master.charaNum,
    subjects: [master.charaNum, ...characters.filter(c => c.id > 0 && c.locationId === master.location).slice(0, 3).map(c => c.id)],
    cue: characters.flatMap(c => c.goals.map(g => g.summary)).slice(0, 8).join(" "),
    excludeFields: ["favor", "trust", "calendar", "weather"],
  };
  const semantic = resolveStateContext(semanticInput);
  const semanticQueries = { topics: semantic.topics, answers: Object.fromEntries(semantic.topics.map(t =>
    [t.id, resolveStateContext({ ...semanticInput, cue: "", topics: [t.id] }).facts])) };
  const withoutHash = {
    semanticFacts: semantic.facts,
    semanticQueryHash: narrativeContextHash(semanticQueries),
    version: NARRATIVE_SNAPSHOT_VERSION,
    createdAtTick: state.time.tickValue,
    dayIndex: state.time.dayIndex,
    locationId: state.master.location,
    futureAgenda: projectCalendarAgenda(state, 7),
    // The shared pool is director-visible public history only. Character
    // private/witness facts remain available solely in that character's
    // `knownExperiences` projection, so one cast member's secret cannot become
    // an unlabelled global fact in an L3 prompt.
    acceptedExperiences: experiences
      .filter((entry) => entry.visibility.public)
      .map((entry) => structuredClone(entry)),
    characters,
    compatibility,
    subjective,
    ...(state.storyProgram?.version === 2 ? { storyContinuation: {
      programId: state.storyProgram.id,
      ...(state.storyProgram.arcId ? { arcId: state.storyProgram.arcId } : {}),
      roundIndex: state.storyProgram.roundIndex ?? 0,
      recentRounds: structuredClone((state.storyProgram.rounds ?? []).slice(-4)),
      ...(state.storyProgram.continuationEvidence ? { playerInteraction: structuredClone(state.storyProgram.continuationEvidence) } : {}),
    } } : {}),
    activeArcs: (state.storyArcs ?? []).filter((arc) => arc.status === "active" || arc.status === "paused").slice(0, 3).map((arc) => structuredClone(arc)),
    rooms: ROOM_CATALOG.map((room) => ({ roomId: room.roomId, locationId: room.location, mapId: room.mapId })),
    weather: {
      regionName: weather.regionName,
      weatherName: weather.weatherName,
      warnings: [...weather.warnings],
      activeIncidentIds: (state.scheduledWeatherIncidents ?? [])
        .filter((entry) => entry.status === "scheduled" || entry.status === "active")
        .map((entry) => entry.id),
    },
    capabilities: capabilityReferences(capabilities),
  };
  const snapshot: NarrativeSnapshotV1 = { ...withoutHash, contextHash: narrativeContextHash(withoutHash) };
  return { snapshot: freezeDeep(snapshot), capabilities: freezeDeep(capabilities.map((entry) => structuredClone(entry))), semanticQueries: freezeDeep(semanticQueries) };
}
