import { cloneGameState, type GameState } from "../state/game-state.js";
import { ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import { relationOf } from "../world/relation.js";
import { compileStoryGraphContinuation, compileStoryGraphProposalV2 } from "./compiler.js";
import { createFreeStoryArcFixture } from "./fixtures-v2.js";
import { NARRATIVE_FREQUENCY_POLICIES, NARRATIVE_MAX_ACTIVE_ARCS, activeNarrativeStoryCount, countsAgainstForegroundBudget, replacePendingNarrativeEvents, scheduleNarrativeEvent, type NarrativeFrequencyPolicy, type NarrativeMutationResult } from "./lifecycle.js";
import { normalizeNarrativeSituationSession } from "./persistence.js";
import { compileNarrativeSnapshot, compileRuntimeCapabilityOptions, narrativeContextHash, type NarrativeContextV1 } from "./snapshot.js";
import type { NarrativeSituationOptionV1, StoryGraphProposalV2 } from "./types.js";
import { NARRATIVE_PLAYER_INTENT_MAX_LENGTH, NARRATIVE_MAX_PARTICIPANTS, NARRATIVE_MAX_NPCS } from "./types.js";
import { validateSituationProposalAgreementV2, validateStoryGraphPlayerParticipationV2 } from "./validator-v2.js";
import { isOpenStoryProgram, reconcileNarrativeState } from "./reconciliation.js";
import { backfillStoryBackgrounds, bindStoryBackground } from "./background.js";

export interface NarrativeDirectorRequestV1 {
  version: 1;
  owner: "narrative";
  requestId: string;
  dayIndex: number;
  generation: number;
  anchor: "tanabata" | "weather-anomaly" | "free";
  phaseGoal: string;
  windowStartTick: number;
  windowEndTick: number;
  context: NarrativeContextV1;
  workingState: GameState;
  arcId?: string;
  /** Existing Arc ownership, distinct from a newly compiled draft Arc. */
  continuingArc?: boolean;
  /** The places the pinned Arc's promise names (maintenance.nextChance only —
   * a fallback to nextOpportunities means there is no live promise, and the
   * field stays unset). Consumers must treat an interaction-window session
   * without these as broken: the promise cannot name a scene to serve. */
  promisedLocationIds?: string[];
  playerIntent?: string;
  /** The request was compiled with `replacePending`, so a previous unchosen
   * situation menu was cleared. Accepted events and Arcs remain untouched. */
  replacePending?: boolean;
  /** The player asked for this story by hand. Carried forward so the accepted
   * event keeps the same budget exemption as the request. */
  manual?: boolean;
}

export interface NarrativeEventPresentationV1 {
  introText: string;
  objectiveText: string;
  startCommandLabel: string;
}

function narrativeTieKey(charaNum: number, tick: number): number {
  let value = Math.imul(charaNum, 0x45d9f3b) ^ tick;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

/** `RELATION:A:B` is A's compatibility toward B. 0 means "no record", NOT
 * hostility; 100 is the neutral baseline. Only 0 is excluded from the
 * directional classification below — a recorded 10 is genuinely distant. */
export const RELATION_NEUTRAL = 100;
/** Preferred automatic cast size, with one optional entangled NPC beyond it. */
export const NARRATIVE_NPC_LIMIT = 3;
/** Chance that the cast opens with two core NPCs instead of one, in percent. */
export const NARRATIVE_DUAL_CORE_PERCENT = 25;
/** A character featured this many ticks back is de-prioritised as "just used". */
export const NARRATIVE_RECENT_CENTER_TICKS = 2 * 1440;

export type NarrativeRelationDirection =
  | "close"          // both directions above neutral — cooperation, or disappointed expectations
  | "friction"       // both directions below neutral — friction, or forced cooperation
  | "asymmetric"     // one side warm, the other cold — misunderstanding, one-sided expectation
  | "unrecorded"     // at least one direction has no record at all
  | "shared-thread"; // L2 records an open social thread regardless of static compatibility

export interface NarrativeCastMember {
  charaNum: number;
  named: boolean;
  weight: number;
}

/** Compatibility classification between two characters. A 0 on either side
 * falls into `unrecorded` and must never be read as hostility. */
export function classifyRelation(fromId: number, toId: number): NarrativeRelationDirection {
  const outward = relationOf(fromId, toId);
  const inward = relationOf(toId, fromId);
  if (outward === 0 || inward === 0) return "unrecorded";
  if (outward > RELATION_NEUTRAL && inward > RELATION_NEUTRAL) return "close";
  if (outward < RELATION_NEUTRAL && inward < RELATION_NEUTRAL) return "friction";
  return "asymmetric";
}

function namedCharacters(state: Readonly<GameState>, active: readonly number[], playerIntent?: string): Set<number> {
  return new Set(active.filter((charaNum) => {
    const slot = state.charas[charaNum]!;
    return [slot.callName, slot.name].some((name) => {
      if (typeof name !== "string" || !name || !playerIntent) return false;
      if (name.length > 1) return playerIntent.includes(name);
      // Short aliases such as 星 must not turn ordinary words like 星光 into
      // a request for an extra character when searching the entire world.
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[\\s、，,；;：“「『]|和|与|跟)${escaped}(?=$|[\\s、，,；;。：”」』]|一起|参加|出现|说|来|去|在)`).test(playerIntent);
    });
  }));
}

/** Existing world characters may be named even without an active L2 cognition. */
export function unavailableNarrativeIntentCharacters(_state: Readonly<GameState>, _playerIntent?: string): string[] {
  return [];
}

/** Open L2 social threads owned by `charaNum`, if the runtime has a mind for it. */
function openThreads(state: Readonly<GameState>, charaNum: number) {
  return (state.agentRuntime?.cognitions[charaNum]?.mind?.threads ?? []).filter((thread) => thread.status === "open");
}

/** True when `charaNum`'s open threads reference `otherId` — through the
 * evidence chain when available, otherwise through the thread text. A shared
 * thread outweighs a merely average static compatibility. */
function sharesThread(state: Readonly<GameState>, charaNum: number, otherId: number): boolean {
  const name = state.charas[otherId]?.callName ?? state.charas[otherId]?.name;
  const cognition = state.agentRuntime?.cognitions[charaNum];
  const evidenceIds = new Set(openThreads(state, charaNum).flatMap((thread) => thread.evidenceIds));
  if (evidenceIds.size > 0) {
    const mentions = (cognition?.observations ?? []).some((observation) =>
      evidenceIds.has(observation.id) && observation.participants.includes(otherId));
    if (mentions) return true;
  }
  return typeof name === "string" && name.length > 0
    && openThreads(state, charaNum).some((thread) => thread.text.includes(name));
}

/** Characters that already carried a narrative event (or an active Arc) very
 * recently are de-prioritised so the same faces do not lead every night. */
function recentlyCentered(state: Readonly<GameState>, charaNum: number, nowTick: number): boolean {
  const recentEvent = (state.narrativeEvents ?? []).some((event) =>
    event.status !== "cancelled"
    && nowTick - event.createdAtTick <= NARRATIVE_RECENT_CENTER_TICKS
    && event.participantIds.includes(charaNum));
  if (recentEvent) return true;
  return (state.storyArcs ?? []).some((arc) =>
    (arc.status === "active" || arc.status === "paused")
    && arc.participantRoles.some((role) => role.characterId === charaNum));
}

/** How much narrative attention a character deserves right now. Higher wins.
 * Every signal is derived from existing runtime data; nothing is persisted.
 *
 * A character that just carried a story drops to 0, which parks it outside
 * every draw's preferred pool — it can still be picked when nobody else is
 * available, but it never leads two rounds in a row while fresh faces remain. */
function narrativeWeight(state: Readonly<GameState>, charaNum: number, nowTick: number): number {
  if (recentlyCentered(state, charaNum, nowTick)) return 0;
  const cognition = state.agentRuntime?.cognitions[charaNum];
  const goals = cognition?.mind?.goals?.length
    ? cognition.mind.goals.filter((goal) => goal.status !== "resolved")
    : (cognition?.goals ?? []).filter((goal) => goal.status === "active");
  const recentObservations = (cognition?.observations ?? [])
    .filter((observation) => nowTick - observation.tick <= NARRATIVE_RECENT_CENTER_TICKS).length;
  const threads = openThreads(state, charaNum);
  const threadWeight = threads.reduce((sum, thread) =>
    sum + (thread.kind === "promise" || thread.kind === "conflict" ? 3 : 2), 0);
  const recentSignals = (state.agentRuntime?.engagements?.[charaNum]?.signals ?? [])
    .filter((signal) => { const age = nowTick - signal.tick; return age >= 0 && age <= 1440; }).length;
  return 12
    + Math.min(3, goals.length)
    + Math.min(3, recentObservations)
    + Math.min(6, threadWeight)
    + Math.min(3, recentSignals);
}

/** Weight below which a character only joins as a last resort. A character
 * that just led a story is pushed under this line, so it is not dragged back
 * in as a mere partner while anyone fresher is available. */
const NARRATIVE_FRESH_WEIGHT = 8;

/** Deterministic weighted draw over the active roster. The tie key decides the
 * ordering, so the same tick and roster always produce the same pick.
 * Characters under NARRATIVE_FRESH_WEIGHT are only considered when the pool
 * offers nobody else — otherwise a single stale candidate would always win. */
function drawWeighted(pool: readonly NarrativeCastMember[], nowTick: number, salt: number): number | undefined {
  if (pool.length === 0) return undefined;
  const fresh = pool.filter((entry) => entry.weight >= NARRATIVE_FRESH_WEIGHT);
  const eligible = fresh.length > 0 ? fresh : pool;
  const tickets = eligible.flatMap((entry) =>
    Array.from({ length: Math.max(1, Math.min(16, entry.weight)) }, (_, index) =>
      ({ charaNum: entry.charaNum, key: narrativeTieKey(entry.charaNum + salt + index * 0x9e3779b9, nowTick) })));
  tickets.sort((left, right) => left.key - right.key || left.charaNum - right.charaNum);
  return tickets[0]?.charaNum;
}

/** Select a small L3 cast from the active Agent roster.
 *
 * Two steps: draw a core character with weighted randomness, then follow its
 * relationship directions to find someone plausibly entangled with it. The
 * protagonist is always first and never consumes an NPC slot. */
export function selectNarrativeParticipants(state: Readonly<GameState>, playerIntent?: string): number[] {
  const nowTick = state.time.tickValue;
  const active = [...new Set(state.agentRuntime?.activeRoster ?? [])]
    .filter((charaNum) => charaNum > 0 && state.charas[charaNum] !== undefined);
  const known = Object.keys(state.charas).map(Number).filter(id => id > 0);
  const named = namedCharacters(state, known, playerIntent);
  // A specified cast is not a seed for the ambient relationship lottery.
  if (named.size > 0) return [0, ...[...named].slice(0, NARRATIVE_MAX_NPCS)];
  if (active.length === 0) active.push(...known);
  if (active.length === 0) return [0];

  const members: NarrativeCastMember[] = active.map((charaNum) => {
    const base = narrativeWeight(state, charaNum, nowTick);
    // Explicit naming outranks every ambient signal.
    return { charaNum, named: named.has(charaNum), weight: named.has(charaNum) ? base + 12 : base };
  });

  const chosen: number[] = [];
  const take = (charaNum: number | undefined): void => {
    if (charaNum !== undefined && !chosen.includes(charaNum)) chosen.push(charaNum);
  };
  // A named character is not a suggestion — it is the cast.
  for (const member of members) if (member.named) take(member.charaNum);
  const remaining = (): NarrativeCastMember[] => members.filter((member) => !chosen.includes(member.charaNum));

  // 1. Core: one, occasionally two.
  const corePool = remaining();
  const dualCore = corePool.length > 1 && narrativeTieKey(nowTick, nowTick) % 100 < NARRATIVE_DUAL_CORE_PERCENT;
  take(drawWeighted(corePool, nowTick, 0));
  if (dualCore && chosen.length < NARRATIVE_NPC_LIMIT) take(drawWeighted(remaining(), nowTick, 0x51ed270b));
  const core = chosen[0];

  // 2. Follow the core's relationships to find an entangled partner.
  if (core !== undefined) {
    // Prefer anyone not just used; only fall back to stale faces when the
    // roster genuinely offers no fresh alternative.
    const rest = remaining();
    const freshRest = rest.filter((member) => member.weight >= NARRATIVE_FRESH_WEIGHT);
    const candidates = freshRest.length > 0 ? freshRest : rest;
    const threaded = candidates.filter((member) => sharesThread(state, core, member.charaNum));
    const byDirection = new Map<NarrativeRelationDirection, NarrativeCastMember[]>(
      [["close", []], ["friction", []], ["asymmetric", []], ["unrecorded", []]]);
    for (const member of candidates) byDirection.get(classifyRelation(core, member.charaNum))!.push(member);
    // A shared L2 thread beats a merely average static compatibility.
    const preferred = threaded.length > 0
      ? threaded
      : (() => {
          const directions: NarrativeRelationDirection[] = ["close", "friction", "asymmetric", "unrecorded"];
          const available = directions.filter((direction) => byDirection.get(direction)!.length > 0);
          if (available.length === 0) return [];
          const picked = available[narrativeTieKey(nowTick + 0x2545f491, nowTick) % available.length]!;
          return byDirection.get(picked)!;
        })();
    take(drawWeighted(preferred, nowTick, 0x27d4eb2f));
  }

  // 3. An extra NPC joins only when it adds a distinct stance or entanglement:
  //    friction or a one-sided affinity toward an anchor, or an independent L2
  //    thread. A merely unrelated (or uniformly friendly) character adds
  //    nobody, so the default cast stays at two.
  if (chosen.length < NARRATIVE_NPC_LIMIT + 1) {
    const eligible = remaining().filter((member) =>
      chosen.some((anchor) => bringsDistinctStance(anchor, member.charaNum))
      || chosen.some((anchor) => sharesThread(state, member.charaNum, anchor)));
    take(drawWeighted(eligible, nowTick, 0x165667b1));
  }

  return [0, ...chosen.slice(0, NARRATIVE_NPC_LIMIT + 1)];
}

/** True when the pair carries actual tension — friction, or one side warm
 * while the other is not. Pairs that are uniformly warm or have no record at
 * all do not qualify; a third friendly face is not a new stance. */
function bringsDistinctStance(anchorId: number, memberId: number): boolean {
  const relation = classifyRelation(anchorId, memberId);
  return relation === "friction" || relation === "asymmetric";
}

function budgetAvailable(state: Readonly<GameState>, policy: NarrativeFrequencyPolicy): boolean {
  const day = state.time.dayIndex;
  const events = (state.narrativeEvents ?? []).filter(countsAgainstForegroundBudget);
  return events.filter((event) => Math.floor(event.windowStartTick / 1440) === day).length < policy.maxForegroundPerDay
    // Bounded on both ends, matching scheduleNarrativeEvent's seven-day check
    // (lifecycle.ts): an unbounded lower window would also count future
    // events, and pre-authoring makes cross-day windows routine.
    && events.filter((event) => {
      const eventDay = Math.floor(event.windowStartTick / 1440);
      return eventDay >= day - 6 && eventDay <= day;
    }).length < policy.maxForegroundPerSevenDays;
}

/** Providers are asked for a stable proposal id, but a second manual request
 * may legitimately describe another event while a previous event with that
 * id is still alive. Namespace only the persisted identity on collision so
 * retries remain idempotent while multiple live Arcs can coexist. */
function acceptedEventId(
  state: Readonly<GameState>,
  proposalId: string,
  contextHash: string,
  arcId?: string,
): string {
  const occupied = (state.narrativeEvents ?? []).some((event) => event.id === proposalId || event.program.id === proposalId);
  if (!occupied) return proposalId;
  return `${proposalId}:instance:${narrativeContextHash({ proposalId, contextHash, arcId: arcId ?? null })}`;
}

/** Compile one immutable sidecar request after deterministic day settlement.
 * It does not persist a candidate arc or event; only acceptance commits. */
export function compileNarrativeDirectorRequest(
  input: Readonly<GameState>,
  options: {
    generation: number;
    frequency?: NarrativeFrequencyPolicy["id"];
    /** Legacy caller flags, retained for API compatibility; generation no longer selects fixtures. */
    allowFree?: boolean;
    forceWeather?: boolean;
    playerIntent?: string;
    /** Stage B binds an automatic story's validated direction as its stable premise. */
    chosenSituation?: NarrativeSituationOptionV1;
    replacePending?: boolean;
    /** Pin the request to one active Arc (the interaction-window handoff).
     * When set, the Arc branch considers only that id and a missing or
     * non-active Arc returns null — the weather/free-arc branches are never
     * reached, so a pinned pass cannot silently invent a different story. */
    pinArcId?: string;
    /** The player opened this from the manual entry. The foreground frequency
     * budget does not apply: an explicit request is never refused because the
     * automatic pass already spent today's slot, and the story it opens does
     * not spend one either. */
    manual?: boolean;
    /** Personality, voice, and boundary lines for one character. The runtime
     * layer cannot reach the character-card catalog, so the shell supplies
     * this. Omitted ⇒ characters carry no persona and behaviour is unchanged. */
    personaFor?: (charaNum: number) => readonly string[];
  },
): NarrativeDirectorRequestV1 | null {
  const policy = NARRATIVE_FREQUENCY_POLICIES[options.frequency ?? "moderate"];
  const reconciled = reconcileNarrativeState(input).state;
  // A manual L3 request may append a background Arc while the current
  // foreground story is open. Automatic overnight generation still waits for
  // the foreground owner to finish.
  if (isOpenStoryProgram(reconciled.storyProgram) && !options.manual) return null;
  const baseState = options.replacePending ? replacePendingNarrativeEvents(reconciled) : reconciled;
  if (!options.manual && !budgetAvailable(baseState, policy)) return null;
  const workingState = cloneGameState(baseState);
  backfillStoryBackgrounds(workingState);
  const now = workingState.time.tickValue;
  const playerIntent = options.playerIntent?.trim().slice(0, NARRATIVE_PLAYER_INTENT_MAX_LENGTH) || undefined;
  const authoredPremise = options.manual === true && !!playerIntent && options.pinArcId === undefined;
  const participants = options.chosenSituation ? [...options.chosenSituation.participantIds] : selectNarrativeParticipants(workingState, playerIntent);
  if (authoredPremise && namedCharacters(workingState, Object.keys(workingState.charas).map(Number), playerIntent).size > NARRATIVE_MAX_NPCS) return null;
  if (options.chosenSituation && (participants[0] !== 0 || participants.length < 2 || participants.length > NARRATIVE_MAX_PARTICIPANTS
    || new Set(participants).size !== participants.length
    || participants.some(id => id !== 0 && !workingState.charas[id])
    || !ROOM_CATALOG_BY_LOCATION[options.chosenSituation.locationIds[0] ?? ""])) return null;
  if (!ROOM_CATALOG_BY_LOCATION[workingState.master.location]) return null;
  if (participants.length < 2) return null;

  let anchor: NarrativeDirectorRequestV1["anchor"] = "free";
  let phaseGoal = "根据玩家意图与当前世界提出故事局势，只生成当前幕；题材、标题和矛盾由具体内容决定，不预设调查、节日或结局。";
  let arcId: string | undefined;
  let promisedLocationIds: string[] | undefined;
  let windowStartTick = now + 30;
  let windowEndTick = now + 6 * 60;
  const activeArc = (!options.manual ? (workingState.storyArcs ?? []) : [])
    .filter((arc) => arc.status === "active" && now <= arc.deadlineTick)
    .filter((arc) => options.pinArcId === undefined || arc.id === options.pinArcId)
    .sort((left, right) => left.deadlineTick - right.deadlineTick || left.id.localeCompare(right.id))[0];
  if (options.pinArcId !== undefined && !activeArc) return null;
  const activeArcHasNpc = activeArc?.participantRoles.some((entry) => entry.characterId > 0) ?? false;
  // Allow solo narrative (主角独自一人也可以触发故事：梦境、回忆、突发事件等)
  // Only block if there's an active arc without NPC participants
  if (activeArc && !activeArcHasNpc) return null;
  if (activeArc) {
    anchor = activeArc?.templateId === "weather-anomaly" ? "weather-anomaly" : "free";
    arcId = activeArc.id;
    phaseGoal = "沿用当前故事线的稳定背景、实际选择和已确认事实推进当前幕，不预设题材、阶段剧情或结局。";
    // maintenance.nextChance wins over nextOpportunities: markNarrativeEventMissed
    // rewrites only nextChance, so the two records can diverge after a miss.
    const chance = activeArc.maintenance?.nextChance;
    const opportunity = activeArc.nextOpportunities.find((entry) => now <= entry.latestTick);
    windowStartTick = Math.max(now, chance?.earliestTick ?? opportunity?.earliestTick ?? now + 30);
    windowEndTick = Math.min(activeArc.deadlineTick, chance?.latestTick ?? opportunity?.latestTick ?? now + 6 * 60);
    // Only a live nextChance names the promised places. Falling back to an
    // opportunity leaves the field unset, which stage B treats as "no promise".
    if (chance) promisedLocationIds = [...chance.locationIds];
  } else if (activeNarrativeStoryCount(workingState) < NARRATIVE_MAX_ACTIVE_ARCS) {
    const arc = createFreeStoryArcFixture(workingState, participants);
    if (!arc) return null;
    if (playerIntent) {
      arc.goals = [playerIntent.slice(0, 240)];
    }
    workingState.storyArcs = [...(workingState.storyArcs ?? []), arc];
    arcId = arc.id;
  } else {
    // `allowFree` does not mean "return a detached event" when all three
    // Arc slots are occupied. A fourth live line would bypass the capacity
    // gate above and could never be serviced by the background controller.
    return null;
  }

  if (playerIntent) phaseGoal = "沿用已绑定的稳定故事背景；本次 playerIntent 是该背景内的互动请求。新手动故事的明确要求须作为必要信息，只调整与 Runtime 事实或合法能力冲突的细节。";
  const boundArc = workingState.storyArcs?.find(arc => arc.id === arcId);
  if (boundArc) bindStoryBackground(boundArc, workingState, {
    ...(options.manual && playerIntent ? { playerIntent } : {}),
    ...(options.chosenSituation ? { situation: options.chosenSituation } : {}),
  });
  if (windowEndTick <= windowStartTick) return null;
  const contextParticipants = arcId
    ? workingState.storyArcs?.find((arc) => arc.id === arcId)?.participantRoles.map((entry) => entry.characterId) ?? participants
    : participants;
  const capabilities = compileRuntimeCapabilityOptions(workingState, contextParticipants, {
    ...(arcId ? { arcId } : {}),
    includeWeatherLocations: anchor === "weather-anomaly",
    ...(options.chosenSituation ? { sceneLocationId: options.chosenSituation.locationIds[0] } : {}),
  });
  const context = { ...compileNarrativeSnapshot(workingState, capabilities, contextParticipants, options.personaFor),
    ...(arcId ? { storyArcId: arcId } : {}),
    ...(authoredPremise ? { unavailableIntentCharacterNames: unavailableNarrativeIntentCharacters(workingState, playerIntent) } : {}) };
  return {
    version: 1,
    owner: "narrative",
    requestId: `narrative:${options.generation}:${workingState.time.dayIndex}:${context.snapshot.contextHash}`,
    dayIndex: workingState.time.dayIndex,
    generation: options.generation,
    anchor,
    phaseGoal,
    windowStartTick,
    windowEndTick,
    context,
    workingState,
    ...(playerIntent ? { playerIntent } : {}),
    ...(arcId ? { arcId } : {}),
    ...(activeArc && activeArc.id === arcId ? { continuingArc: true } : {}),
    ...(promisedLocationIds ? { promisedLocationIds } : {}),
    ...(options.replacePending ? { replacePending: true } : {}),
    ...(options.manual ? { manual: true } : {}),
  };
}

export function acceptNarrativeDirectorProposal(
  request: NarrativeDirectorRequestV1,
  proposal: StoryGraphProposalV2,
  frequency: NarrativeFrequencyPolicy["id"] = "moderate",
  presentation?: NarrativeEventPresentationV1,
): NarrativeMutationResult {
  const participationDiagnostics = validateStoryGraphPlayerParticipationV2(proposal);
  if (participationDiagnostics.length > 0) {
    return { state: cloneGameState(request.workingState), accepted: false, diagnostics: participationDiagnostics };
  }
  const eventId = acceptedEventId(request.workingState, proposal.proposalId, request.context.snapshot.contextHash, request.arcId);
  const compiled = compileStoryGraphProposalV2(proposal, request.context, {
    createdAtTick: request.workingState.time.tickValue,
    eventId,
    ...(request.arcId ? { arcId: request.arcId } : {}),
    windowStartTick: request.windowStartTick,
    windowEndTick: request.windowEndTick,
  });
  if (!compiled.accepted) return { state: cloneGameState(request.workingState), accepted: false, diagnostics: compiled.diagnostics };
  return scheduleNarrativeEvent(request.workingState, {
    id: eventId,
    title: proposal.title,
    windowStartTick: request.windowStartTick,
    windowEndTick: request.windowEndTick,
    program: compiled.program,
    ...(presentation ? presentation : {}),
    ...(request.arcId ? { arcId: request.arcId } : {}),
    anchor: request.anchor,
    policy: NARRATIVE_FREQUENCY_POLICIES[frequency],
    ...(request.manual ? { manual: true } : {}),
  });
}

/** Recompile a request for the next round of a story parked mid-conversation.
 *
 * Unlike the first act, a continuation is compiled from the world as it stands
 * now, and its cast is fixed by the story: the participants do not get redrawn,
 * because the player is already invested in these people. Returns null when the
 * story is not parked or the current location is unusable. */
export function compileNarrativeContinuationRequest(
  input: Readonly<GameState>,
  options: {
    generation: number;
    personaFor?: (charaNum: number) => readonly string[];
  },
): NarrativeDirectorRequestV1 | null {
  const program = input.storyProgram;
  if (!program || program.version !== 2 || program.status !== "awaiting-player") return null;
  if (program.arcId && !input.storyArcs?.some((arc) => arc.id === program.arcId && arc.status === "active" && input.time.tickValue <= arc.deadlineTick)) return null;
  if (!ROOM_CATALOG_BY_LOCATION[input.master.location]) return null;
  const workingState = cloneGameState(input);
  backfillStoryBackgrounds(workingState);
  const now = workingState.time.tickValue;
  const participants = [...new Set([0, ...program.actorIds])].filter((id) => id === 0 || workingState.charas[id]);
  if (participants.length < 2) return null;
  const capabilities = compileRuntimeCapabilityOptions(workingState, participants, {
    ...(program.arcId ? { arcId: program.arcId } : {}),
    includeWeatherLocations: workingState.storyArcs?.some((arc) => arc.id === program.arcId && arc.templateId === "weather-anomaly"),
  });
  const context = { ...compileNarrativeSnapshot(workingState, capabilities, participants, options.personaFor),
    ...(program.arcId ? { storyArcId: program.arcId } : {}) };
  const rounds = program.rounds ?? [];
  const latest = rounds[rounds.length - 1];
  // The next beat names the round it follows, so the model continues rather
  // than restarts, and never re-resolves something already settled.
  const phaseGoal = latest
    ? `这是同一段故事的第 ${latest.index + 1} 轮。上一轮以「${latest.outcomeId}」结束：${latest.summary}。`
      + `接着玩家实际做过的事继续发展；不要重复上一轮已经结算的内容，也不要重新介绍人物。`
      + (latest.narration.length > 0 ? `上一轮玩家看到的经过：${latest.narration.join(" / ")}` : "")
    : "继续这段故事的下一轮；不要重新介绍人物，也不要重复已经结算的内容。";
  return {
    version: 1,
    owner: "narrative",
    requestId: `narrative-continuation:${options.generation}:${program.id}:${context.snapshot.contextHash}`,
    dayIndex: workingState.time.dayIndex,
    generation: options.generation,
    anchor: "free",
    phaseGoal,
    windowStartTick: now + 1,
    windowEndTick: now + 6 * 60,
    context,
    workingState,
    ...(program.arcId ? { arcId: program.arcId } : {}),
  };
}

/** Runtime-side ranking of the situations the model offered.
 *
 * The runtime, not the player, decides which single opportunity is pursued:
 * legal ones only, then continuing an already-open line, then what the player
 * can actually walk into, then what this story has not just used. Deterministic
 * and RNG-free, so the same world plus the same proposal always picks the same
 * situation. This is not a judge model and never calls a provider.
 *
 * When `options.promisedLocationIds` is set (interaction-window handoff), a
 * situation that ignores the promise is NOT merely deprioritized — it is
 * illegal. A scene outside the promised places would wait for a player who
 * walks into the promise and finds nothing, and that failure is silent.
 *
 * The frequency budget is not re-checked here: `compileNarrativeDirectorRequest`
 * already refuses to build a request once the budget is spent, so anything that
 * reaches this function is within budget. */
export function selectNarrativeSituation(
  state: Readonly<GameState>,
  situations: readonly NarrativeSituationOptionV1[],
  options: { promisedLocationIds?: ReadonlySet<string> } = {},
): { selected: NarrativeSituationOptionV1 | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const legal = situations.filter((situation) => {
    const locationsOk = situation.locationIds.every((locationId) => ROOM_CATALOG_BY_LOCATION[locationId]);
    const castOk = situation.participantIds.every((id) => id === 0 || state.charas[id] !== undefined);
    if (!locationsOk || !castOk) diagnostics.push(`situation ${situation.id} is no longer reachable`);
    return locationsOk && castOk;
  });
  if (legal.length === 0) return { selected: null, diagnostics };
  if (options.promisedLocationIds && options.promisedLocationIds.size > 0) {
    const inside = legal.filter((situation) => options.promisedLocationIds!.has(situation.locationIds[0] ?? ""));
    if (inside.length === 0) {
      diagnostics.push("promised window location is not served by any situation");
      return { selected: null, diagnostics };
    }
    return selectNarrativeSituation(state, inside);
  }
  const arcs = state.storyArcs ?? [];
  const usedLocations = new Set(arcs.flatMap((arc) => arc.nextOpportunities.flatMap((entry) => entry.locationIds)));
  // The protagonist (0) is in every situation, so only an NPC overlap says
  // anything about continuing the same line with the same people.
  const usedCast = new Set(arcs.flatMap((arc) => arc.participantRoles.map((role) => role.characterId)).filter((id) => id > 0));
  const scored = legal.map((situation) => {
    const continuesOpenLine = arcs.some((arc) => arc.status === "active"
      && arc.participantRoles.some((role) => role.characterId > 0 && situation.participantIds.includes(role.characterId)));
    const reachableNow = situation.locationIds.includes(state.master.location);
    const justUsed = situation.participantIds.every((id) => id === 0 || usedCast.has(id))
      && situation.locationIds.every((locationId) => usedLocations.has(locationId));
    return {
      situation,
      score: (continuesOpenLine ? 8 : 0) + (reachableNow ? 4 : 0) + (justUsed ? -3 : 0),
    };
  }).sort((left, right) => right.score - left.score || left.situation.id.localeCompare(right.situation.id));
  return { selected: scored[0]!.situation, diagnostics };
}

/** Publish a stage-A situation set for the player to choose from once they
 * wake. No event and no program exist yet — those are produced only after a
 * choice, so an unchosen set costs nothing but the one generation call. */
export function scheduleNarrativeSituations(
  request: NarrativeDirectorRequestV1,
  situations: readonly NarrativeSituationOptionV1[],
  options: { autoSelect?: boolean } = {},
): NarrativeMutationResult {
  const state = cloneGameState(request.workingState);
  // A menu is not an accepted Arc. Only already-existing ownership survives stage A.
  if (request.arcId && !request.continuingArc && !request.promisedLocationIds) {
    state.storyArcs = (state.storyArcs ?? []).filter(arc => arc.id !== request.arcId);
  }
  const session = normalizeNarrativeSituationSession({
    version: 1,
    id: `situation:${request.dayIndex}:${request.context.snapshot.contextHash}`,
    createdAtTick: state.time.tickValue,
    dayIndex: request.dayIndex,
    contextHash: request.context.snapshot.contextHash,
    ...(request.playerIntent ? { playerIntent: request.playerIntent } : {}),
    ...(request.replacePending ? { replacePending: true } : {}),
    ...(request.manual ? { manual: true } : {}),
    ...(options.autoSelect ? { autoSelect: true } : {}),
    // Interaction-window handoff: carry the pin across to stage B so the
    // recompile serves the same Arc, and the promise's places for diagnostics.
    // Every existing Arc keeps its owner, even without a location promise.
    // Manual/new premises must recompile through their path.
    ...(request.arcId && (request.continuingArc || request.promisedLocationIds) ? { arcId: request.arcId } : {}),
    ...(request.promisedLocationIds ? { promisedLocationIds: [...request.promisedLocationIds] } : {}),
    situations: situations.map((situation) => structuredClone(situation)),
  });
  if (!session) return { state, accepted: false, diagnostics: ["narrative situations are invalid"] };
  state.narrativeSituationSession = session;
  return { state, accepted: true, diagnostics: [] };
}

/** Append a validated round to the story the player is in the middle of.
 * The program keeps its id and archives its own rounds; only the new segment
 * is validated, against the snapshot it was actually generated from. */
export function acceptNarrativeContinuation(
  request: NarrativeDirectorRequestV1,
  proposal: unknown,
  current: Readonly<GameState> = request.workingState,
): NarrativeMutationResult {
  const state = cloneGameState(current);
  const program = state.storyProgram;
  const expected = request.workingState.storyProgram;
  if (!program || program.version !== 2 || !expected || expected.version !== 2
    || program.id !== expected.id || program.status !== "awaiting-player"
    || program.contextHash !== expected.contextHash || program.roundIndex !== expected.roundIndex
    || program.continuationEvidence?.id !== expected.continuationEvidence?.id) {
    return { state, accepted: false, diagnostics: ["no story program to continue"] };
  }
  const compiled = compileStoryGraphContinuation(program, proposal, request.context, {
    createdAtTick: state.time.tickValue,
    windowStartTick: request.windowStartTick,
    windowEndTick: request.windowEndTick,
  });
  if (!compiled.accepted) return { state, accepted: false, diagnostics: compiled.diagnostics };
  state.storyProgram = compiled.program;
  const event = program.eventId ? state.narrativeEvents?.find((entry) => entry.id === program.eventId) : undefined;
  if (event) {
    event.program = structuredClone(compiled.program);
    // Carry the new round's window onto the event. The event is what holds the
    // cast at the scene (`heldAtNarrativeScene`), and `refreshNarrativeEvents`
    // never re-times an `active` event, so a round that did not move the
    // window forward would quietly release the cast mid-story.
    event.windowStartTick = request.windowStartTick;
    event.windowEndTick = request.windowEndTick;
  }
  return { state, accepted: true, diagnostics: [] };
}

/** Turn the player's chosen situation into the accepted event and opening act.
 *
 * The chosen situation — not the graph stage — owns the cast and the scene.
 * Stage B has to invent prose, and it may name anyone or anywhere; this
 * function is where that stops. `validateSituationProposalAgreementV2` refuses
 * a drifted graph, then stores the pinned cast and scene as a pending event.
 * Acceptance owns no character movement and publishes no opening facts.
 * The runtime checks attendance and stages the cast atomically at activation.
 */
export function acceptNarrativeSituationChoice(
  request: NarrativeDirectorRequestV1,
  situation: NarrativeSituationOptionV1,
  proposal: StoryGraphProposalV2,
  frequency: NarrativeFrequencyPolicy["id"] = "moderate",
  presentation?: NarrativeEventPresentationV1,
  _options: { background?: boolean } = {},
): NarrativeMutationResult {
  const diagnostics = [
    ...validateStoryGraphPlayerParticipationV2(proposal),
    ...validateSituationProposalAgreementV2(proposal, situation),
  ];
  if (diagnostics.length > 0) {
    return { state: cloneGameState(request.workingState), accepted: false, diagnostics };
  }
  // Persistence-boundary guard for the interaction-window handoff: even if a
  // future call path bypasses selectNarrativeSituation's filter, an
  // interaction-window event must never land outside the promised places —
  // the player would walk into the promise and find nothing, silently.
  if (request.promisedLocationIds && request.promisedLocationIds.length > 0
    && !request.promisedLocationIds.includes(situation.locationIds[0] ?? "")) {
    return {
      state: cloneGameState(request.workingState),
      accepted: false,
      diagnostics: ["situation scene is outside the promised interaction window"],
    };
  }
  // One room. The situation may list several, but the first is the scene the
  // cast is staged into and the place the player walks to.
  const sceneLocation = situation.locationIds[0]!;
  const eventId = acceptedEventId(request.workingState, proposal.proposalId, request.context.snapshot.contextHash, request.arcId);
  const compiled = compileStoryGraphProposalV2({ ...proposal, locationIds: [sceneLocation] }, request.context, {
    createdAtTick: request.workingState.time.tickValue,
    eventId,
    ...(request.arcId ? { arcId: request.arcId } : {}),
    windowStartTick: request.windowStartTick,
    windowEndTick: request.windowEndTick,
  });
  if (!compiled.accepted) return { state: cloneGameState(request.workingState), accepted: false, diagnostics: compiled.diagnostics };
  const scheduled = scheduleNarrativeEvent(request.workingState, {
    id: eventId,
    title: proposal.title || situation.premise.slice(0, 160),
    windowStartTick: request.windowStartTick,
    windowEndTick: request.windowEndTick,
    program: compiled.program,
    ...(presentation ? presentation : {}),
    ...(request.arcId ? { arcId: request.arcId } : {}),
    anchor: request.anchor,
    policy: NARRATIVE_FREQUENCY_POLICIES[frequency],
    ...(request.manual ? { manual: true } : {}),
  });
  if (!scheduled.accepted) return scheduled;
  const next = cloneGameState(scheduled.state);
  const acceptedArc = next.storyArcs?.find(arc => arc.id === request.arcId);
  if (acceptedArc) {
    bindStoryBackground(acceptedArc, next, { ...(request.manual && request.playerIntent ? { playerIntent: request.playerIntent } : {}), situation });
    if (acceptedArc.background?.source !== "legacy" && !(request.workingState.narrativeEvents ?? []).some(event => event.arcId === acceptedArc.id)) acceptedArc.title = proposal.title || situation.premise.slice(0, 160);
  }
  // The menu has been resolved; it must not survive into the running story.
  next.narrativeSituationSession = null;
  return { ...scheduled, state: next };
}

export { recordStoryOpening } from "./opening.js";
