import type { GameState, WorkRuntimeEntry } from "../state/game-state.js";
import { cloneGameState } from "../state/game-state.js";
import { createRng } from "../command/rng.js";
import { canEnterRoom } from "../world/map-can-move.js";
import { roomPathDistance } from "../world/map-distance.js";
import { ROOM_CATALOG, ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import { relationOf } from "../world/relation.js";
import { setSlotLocation } from "../world/room-id-location.js";
import {
  canCharacterInitiateDate,
  deterministicDateProposalProvider,
  PUBLIC_DATE_LOCATIONS,
  scheduleAcceptedDate,
} from "../world/date-appointments.js";
import { ensureWorkRuntime } from "../world/work/work-system.js";

export type AgentActionKind =
  | "move-self"
  | "visit-character"
  | "work-decision"
  | "request-partner-led-date"
  | "event-intent";

export interface AgentActionParameterOptionV1 {
  id: string;
  label: string;
}

export interface AgentActionParameterV1 {
  id: string;
  label: string;
  required: true;
  options: AgentActionParameterOptionV1[];
}

/** A runtime-authored menu. The model may select IDs, never invent handlers or values. */
export interface AgentActionOfferV1 {
  version: 1;
  id: string;
  kind: AgentActionKind;
  actorId: number;
  label: string;
  contextHash: string;
  idempotencyKey: string;
  parameters: AgentActionParameterV1[];
}

export interface AgentActionProposalV1 {
  version: 1;
  offerId: string;
  contextHash: string;
  parameters: Record<string, string>;
}

export interface ApplyAgentActionResult {
  state: GameState;
  status: "applied" | "rejected" | "duplicate";
  lines: string[];
  offer?: AgentActionOfferV1;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function actionContextHash(state: Readonly<GameState>, actorId: number): string {
  const actor = state.charas[actorId];
  const work = state.workRuntime?.entries.filter((entry) => entry.charaNum === actorId)
    .map((entry) => `${entry.entryKey}:${entry.status}`).join("|") ?? "";
  const date = state.dateSession ? `${state.dateSession.partner}:${state.dateSession.phase}:${state.dateSession.controller ?? "player"}` : "";
  const event = state.activeEventContext ? `${state.activeEventContext.eventId}:${state.activeEventContext.beatId}:${state.activeEventContext.expiresAtTick}` : "";
  return hashText(`${state.time.tickValue}|${actorId}|${actor?.location ?? "missing"}|${state.master.location}|${work}|${date}|${event}`);
}

function option(id: string, label: string): AgentActionParameterOptionV1 {
  return { id, label };
}

/** Replay-stable sampling for a prompt menu. The menu may look random from one
 * interaction to the next, but retrying the same state/request never changes
 * the ids which the Runtime will later validate. */
function sample<T>(values: readonly T[], limit: number, seedText: string): T[] {
  const shuffled = [...values];
  const rng = createRng(Number.parseInt(hashText(seedText), 36));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = rng.int(index + 1);
    [shuffled[index], shuffled[selected]] = [shuffled[selected]!, shuffled[index]!];
  }
  return shuffled.slice(0, limit);
}

function offer(
  actorId: number,
  kind: AgentActionKind,
  label: string,
  contextHash: string,
  parameters: AgentActionParameterV1[],
): AgentActionOfferV1 {
  const id = `agent-action:${actorId}:${kind}`;
  return { version: 1, id, kind, actorId, label, contextHash, idempotencyKey: `${id}:${contextHash}`, parameters };
}

function currentWorkEntry(state: GameState, actorId: number): WorkRuntimeEntry | undefined {
  ensureWorkRuntime(state);
  return state.workRuntime?.entries.find((entry) => entry.charaNum === actorId && entry.status !== "completed");
}

export function compileAgentActionOffers(state: Readonly<GameState>, actorId: number): AgentActionOfferV1[] {
  const working = cloneGameState(state as GameState);
  const actor = working.charas[actorId];
  if (!actor || actorId <= 0) return [];
  const contextHash = actionContextHash(working, actorId);
  const offers: AgentActionOfferV1[] = [];

  const currentSceneRoom = ROOM_CATALOG_BY_LOCATION[working.master.location];
  const enterableOnCurrentMap = currentSceneRoom
    ? ROOM_CATALOG.filter((room) => room.mapId === currentSceneRoom.mapId
      && room.location !== actor.location
      && canEnterRoom(working, room.location, actor))
    : [];
  const nearby = sample(
    enterableOnCurrentMap.filter((room) => {
      const distance = roomPathDistance(actor.location, room.location);
      return distance !== null && distance > 0 && distance <= 2;
    }),
    5,
    `${contextHash}:nearby`,
  );
  const nearbyLocations = new Set(nearby.map((room) => room.location));
  const elsewhereOnMap = sample(
    enterableOnCurrentMap.filter((room) => !nearbyLocations.has(room.location)),
    5,
    `${contextHash}:same-map`,
  );
  const destinations = [...nearby, ...elsewhereOnMap]
    .map((room) => option(room.location, room.displayName));
  if (destinations.length > 0) {
    offers.push(offer(actorId, "move-self", "前往一个可到达地点", contextHash, [
      { id: "destination", label: "目的地", required: true, options: destinations },
    ]));
  }

  const sameMapCharacters = currentSceneRoom ? Object.values(working.charas)
    .filter((candidate) => candidate.charaNum !== actorId
      && candidate.location !== actor.location
      && ROOM_CATALOG_BY_LOCATION[candidate.location]?.mapId === currentSceneRoom.mapId
      && canEnterRoom(working, candidate.location, actor))
    .sort((left, right) => left.charaNum - right.charaNum)
    : [];
  // RELATION is directional: this is the acting character's compatibility
  // toward the possible visit target. Fall back to the same-map population
  // only when no >100 relationship candidate exists at all.
  const compatibleCharacters = sameMapCharacters.filter((candidate) => relationOf(actorId, candidate.charaNum) > 100);
  const characters = sample(
    compatibleCharacters.length > 0 ? compatibleCharacters : sameMapCharacters,
    10,
    `${contextHash}:characters:${compatibleCharacters.length > 0 ? "compatible" : "fallback"}`,
  )
    .map((candidate) => option(String(candidate.charaNum), candidate.callName ?? candidate.name ?? `#${candidate.charaNum}`));
  if (characters.length > 0) {
    offers.push(offer(actorId, "visit-character", "主动去找一个角色", contextHash, [
      { id: "characterId", label: "角色", required: true, options: characters },
    ]));
  }

  const work = currentWorkEntry(working, actorId);
  if (work) {
    offers.push(offer(actorId, "work-decision", "决定今天的工作安排", contextHash, [
      { id: "decision", label: "决定", required: true, options: [option("attend", "去上班"), option("skip", "缺勤")] },
    ]));
  }

  if (canCharacterInitiateDate(working, actorId)) {
    offers.push(offer(actorId, "request-partner-led-date", "主动邀请玩家约会并带领行程", contextHash, [
      {
        id: "destination",
        label: "约会地点",
        required: true,
        options: PUBLIC_DATE_LOCATIONS.map((location) => option(location, location)),
      },
    ]));
  }

  const directive = working.activeEventContext;
  if (directive && directive.expiresAtTick >= working.time.tickValue && directive.participantIds.includes(actorId)) {
    offers.push(offer(actorId, "event-intent", "推进当前开放事件", contextHash, [
      { id: "intentId", label: "事件行动", required: true, options: directive.allowedIntentIds.map((id) => option(id, id)) },
    ]));
  }
  return offers;
}

function selectedParameter(offerValue: AgentActionOfferV1, proposal: AgentActionProposalV1, id: string): string | null {
  const parameter = offerValue.parameters.find((entry) => entry.id === id);
  const value = proposal.parameters[id];
  if (!parameter || typeof value !== "string" || !parameter.options.some((entry) => entry.id === value)) return null;
  return value;
}

function reject(state: Readonly<GameState>, line: string): ApplyAgentActionResult {
  return { state: cloneGameState(state as GameState), status: "rejected", lines: [line] };
}

export function applyAgentActionProposal(state: Readonly<GameState>, actorId: number, proposal: AgentActionProposalV1): ApplyAgentActionResult {
  const next = cloneGameState(state as GameState);
  if (proposal.version !== 1 || proposal.contextHash !== actionContextHash(next, actorId)) return reject(state, "行动条件已经变化，本次提议未执行。");
  const selected = compileAgentActionOffers(next, actorId).find((candidate) => candidate.id === proposal.offerId && candidate.contextHash === proposal.contextHash);
  if (!selected) return reject(state, "这个行动不在当前运行时允许的范围内。");
  if ((next.acceptedAgentActionIds ?? []).includes(selected.idempotencyKey)) {
    return { state: next, status: "duplicate", lines: ["这个行动已经执行过了。"], offer: selected };
  }
  const actor = next.charas[actorId]!;
  const lines: string[] = [];

  if (selected.kind === "move-self") {
    const destination = selectedParameter(selected, proposal, "destination");
    if (!destination || !canEnterRoom(next, destination, actor)) return reject(state, "目的地已不可到达，行动未执行。");
    setSlotLocation(actor, destination);
    lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}前往了${destination}。`);
  } else if (selected.kind === "visit-character") {
    const targetId = Number(selectedParameter(selected, proposal, "characterId"));
    const target = next.charas[targetId];
    if (!target || !canEnterRoom(next, target.location, actor)) return reject(state, "拜访目标已经不在可到达地点。");
    setSlotLocation(actor, target.location);
    lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}主动去找${target.callName ?? target.name ?? `#${targetId}`}。`);
  } else if (selected.kind === "work-decision") {
    const decision = selectedParameter(selected, proposal, "decision");
    const entry = currentWorkEntry(next, actorId);
    if (!decision || !entry) return reject(state, "当前没有可处理的工作安排。");
    if (decision === "skip") {
      entry.status = "completed";
      lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}决定缺勤；这次班次不会获得工作结算。`);
    } else {
      setSlotLocation(actor, entry.location);
      lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}按自己的决定前往工作地点。`);
    }
  } else if (selected.kind === "request-partner-led-date") {
    if (!canCharacterInitiateDate(next, actorId)) return reject(state, "当前不满足发起约会的条件。");
    const destination = selectedParameter(selected, proposal, "destination");
    if (!destination) return reject(state, "约会地点无效。");
    const id = `ai-date-${next.time.dayIndex}-${actorId}-${next.time.tickValue}`;
    (next.worldEvents ??= []).push({ kind: "date-plan", id, partner: actorId, seed: Number.parseInt(hashText(id), 36) >>> 0, phase: "offered", createdAtTick: next.time.tickValue, controller: "partner" });
    const scheduled = scheduleAcceptedDate(next, id, {
      propose(proposalState, partner, seed) {
        const runtimeProposal = deterministicDateProposalProvider.propose(proposalState, partner, seed);
        return runtimeProposal ? { ...runtimeProposal, location: destination } : null;
      },
    });
    if (!scheduled) return reject(state, "暂时找不到不冲突的约会时间。");
    lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}发起了去${destination}的约会；玩家已在本轮对话中接受，届时由她带领完整行程。`);
  } else {
    const intentId = selectedParameter(selected, proposal, "intentId");
    const directive = next.activeEventContext;
    if (!intentId || !directive || !directive.allowedIntentIds.includes(intentId)) return reject(state, "事件行动已经失效。");
    const factId = `event-intent:${intentId}`;
    const arc = directive.arcId ? (next.storyArcs ?? []).find((entry) => entry.id === directive.arcId) : undefined;
    if (arc && !arc.acceptedFactIds.includes(factId)) arc.acceptedFactIds.push(factId);
    if (!directive.visibleFactIds.includes(factId)) directive.visibleFactIds.push(factId);
    lines.push(`${actor.callName ?? actor.name ?? `#${actorId}`}采取了事件行动：${intentId}。`);
  }

  next.acceptedAgentActionIds = [...(next.acceptedAgentActionIds ?? []), selected.idempotencyKey].slice(-128);
  return { state: next, status: "applied", lines, offer: selected };
}
