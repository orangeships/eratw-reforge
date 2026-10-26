import type { GameState } from "../state/game-state.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { deriveDialogueRelationshipStage } from "../state/dialogue-context.js";
import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { eligibleAgentCharaNums } from "./roster.js";
import type {
  AgentDailyActivity,
  AgentDailyActivityKind,
  AgentDailyCharacterRecord,
  AgentDailyEncounter,
  AgentDailyLedgerDay,
  AgentDailyLedgerV1,
  AgentRelationshipChangeEvidence,
  AgentRelationshipEvidenceSnapshot,
  AgentStoryClaim,
} from "./types.js";

export const AGENT_DAILY_LEDGER_VERSION = 1 as const;
export const MAX_LEDGER_DAYS = 3;
export const MAX_DAILY_ACTIVITIES = 24;
export const MAX_DAILY_LOCATIONS = 16;
export const MAX_DAILY_ENCOUNTERS = 24;

export function createAgentDailyLedger(): AgentDailyLedgerV1 {
  return { version: AGENT_DAILY_LEDGER_VERSION, days: [] };
}

function enabledRuntime(state: GameState) {
  const runtime = state.agentRuntime;
  return runtime?.settings.masterEnabled ? runtime : undefined;
}

export function captureRelationshipEvidence(
  state: Readonly<GameState>,
  charaNum: number,
  tick = state.time.tickValue,
): AgentRelationshipEvidenceSnapshot | null {
  const slot = state.charas[charaNum];
  if (!slot) return null;
  const authority = deriveRelationshipAuthority(slot, state.master, state);
  return {
    tick,
    favor: authority.favor,
    trust: authority.trust,
    intimacy: authority.intimacy,
    attitude: authority.attitude,
    stage: deriveDialogueRelationshipStage(slot),
    traits: {
      affection: (slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0,
      love: (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0,
      lover: (slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0,
      desire: (slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0,
      sexFriend: (slot.state.TALENT[TALENT_ID.炮友] ?? 0) !== 0,
    },
  };
}

function ledgerDay(ledger: AgentDailyLedgerV1, dayIndex: number): AgentDailyLedgerDay {
  let day = ledger.days.find((entry) => entry.dayIndex === dayIndex);
  if (!day) {
    day = { dayIndex, characters: {} };
    ledger.days.push(day);
    ledger.days.sort((a, b) => a.dayIndex - b.dayIndex);
    if (ledger.days.length > MAX_LEDGER_DAYS) {
      ledger.days = ledger.days.slice(-MAX_LEDGER_DAYS);
    }
  }
  return day;
}

function ensureCharacterRecord(
  state: GameState,
  charaNum: number,
  dayIndex: number,
  tick: number,
): AgentDailyCharacterRecord | null {
  const runtime = enabledRuntime(state);
  const slot = state.charas[charaNum];
  if (!runtime || !slot || !eligibleAgentCharaNums(state).includes(charaNum)) return null;
  const day = ledgerDay(runtime.dailyLedger, dayIndex);
  let record = day.characters[charaNum];
  if (record) return record;
  const relationshipStart = captureRelationshipEvidence(state, charaNum, tick);
  if (!relationshipStart) return null;
  record = {
    charaNum,
    dayIndex,
    startedAtTick: tick,
    initialLocation: slot.location,
    lastKnownLocation: slot.location,
    activities: [],
    visitedLocations: [],
    encounters: [],
    relationshipStart,
    relationshipChanges: [],
    sequence: 0,
  };
  day.characters[charaNum] = record;
  return record;
}

/** Start today's ledger at the current load/enable moment. No earlier facts are inferred. */
export function ensureCurrentAgentLedgerDay(state: GameState): void {
  if (!enabledRuntime(state)) return;
  for (const charaNum of eligibleAgentCharaNums(state)) {
    ensureCharacterRecord(state, charaNum, state.time.dayIndex, state.time.tickValue);
  }
}

function nextId(record: AgentDailyCharacterRecord, prefix: string): string {
  return `ledger:${record.dayIndex}:${record.charaNum}:${prefix}:${record.sequence++}`;
}

function sortedParticipants(values: readonly number[], owner: number): number[] {
  return [...new Set(values.filter((id) => Number.isSafeInteger(id) && id >= 0 && id !== owner))]
    .sort((a, b) => a - b);
}

export function recordAgentDailyActivity(
  state: GameState,
  charaNum: number,
  activity: {
    kind: AgentDailyActivityKind;
    startTick: number;
    endTick: number;
    location: string;
    label: string;
    participants?: readonly number[];
  },
): void {
  if (activity.endTick < activity.startTick) return;
  const dayIndex = Math.floor(activity.startTick / 1440);
  const endDayIndex = Math.floor(Math.max(activity.startTick, activity.endTick - 1) / 1440);
  if (endDayIndex !== dayIndex) {
    let cursor = activity.startTick;
    while (cursor < activity.endTick) {
      const segmentEnd = Math.min(activity.endTick, (Math.floor(cursor / 1440) + 1) * 1440);
      recordAgentDailyActivity(state, charaNum, {
        ...activity,
        startTick: cursor,
        endTick: segmentEnd,
      });
      cursor = segmentEnd;
    }
    return;
  }
  const record = ensureCharacterRecord(state, charaNum, dayIndex, activity.startTick);
  if (!record) return;
  const participants = sortedParticipants(activity.participants ?? [], charaNum);
  const previous = record.activities.at(-1);
  if (previous && previous.kind === activity.kind && previous.label === activity.label
    && previous.location === activity.location
    && previous.endTick === activity.startTick
    && previous.participants.join(",") === participants.join(",")) {
    previous.endTick = activity.endTick;
    return;
  }
  const entry: AgentDailyActivity = {
    id: nextId(record, "activity"),
    kind: activity.kind,
    startTick: activity.startTick,
    endTick: activity.endTick,
    location: activity.location,
    label: activity.label.slice(0, 180),
    participants,
  };
  record.activities.push(entry);
  if (record.activities.length > MAX_DAILY_ACTIVITIES) {
    record.activities = record.activities.slice(0, MAX_DAILY_ACTIVITIES);
  }
}

export function recordAgentDailyLocationVisit(
  state: GameState,
  charaNum: number,
  location: string,
  tick = state.time.tickValue,
): void {
  const dayIndex = Math.floor(tick / 1440);
  const record = ensureCharacterRecord(state, charaNum, dayIndex, tick);
  if (!record || !location || record.lastKnownLocation === location) return;
  const previous = record.visitedLocations.at(-1);
  if (previous && previous.leftAtTick === undefined) previous.leftAtTick = tick;
  record.lastKnownLocation = location;
  if (record.visitedLocations.some((entry) => entry.location === location)) return;
  if (record.visitedLocations.length >= MAX_DAILY_LOCATIONS) return;
  record.visitedLocations.push({
    id: nextId(record, "location"),
    location,
    arrivedAtTick: tick,
  });
}

function appendEncounter(
  record: AgentDailyCharacterRecord,
  startTick: number,
  endTick: number,
  location: string,
  participants: number[],
): void {
  if (endTick <= startTick || participants.length === 0) return;
  const previous = record.encounters.at(-1);
  if (previous && previous.endTick === startTick && previous.location === location
    && previous.participants.join(",") === participants.join(",")) {
    previous.endTick = endTick;
    return;
  }
  if (record.encounters.length >= MAX_DAILY_ENCOUNTERS) return;
  const encounter: AgentDailyEncounter = {
    id: nextId(record, "encounter"),
    startTick,
    endTick,
    location,
    participants,
  };
  record.encounters.push(encounter);
}

/**
 * Record the authoritative world layout over an elapsed schedule interval.
 * The caller supplies boundary-sliced absolute ticks, so work, free action and
 * co-location windows remain deterministic and positive-duration only.
 */
export function recordAgentDailyWorldInterval(
  state: GameState,
  startTick: number,
  endTick: number,
): void {
  if (!enabledRuntime(state) || endTick <= startTick) return;
  let cursor = startTick;
  while (cursor < endTick) {
    const segmentEnd = Math.min(endTick, (Math.floor(cursor / 1440) + 1) * 1440);
    const dayIndex = Math.floor(cursor / 1440);
    const eligible = eligibleAgentCharaNums(state);
    const occupants = new Map<string, number[]>();
    const addOccupant = (location: string, id: number) => {
      const values = occupants.get(location) ?? [];
      values.push(id);
      occupants.set(location, values);
    };
    addOccupant(state.master.location, 0);
    for (const charaNum of eligible) {
      const slot = state.charas[charaNum];
      if (!slot) continue;
      addOccupant(slot.location, charaNum);
      const record = ensureCharacterRecord(state, charaNum, dayIndex, cursor);
      if (!record) continue;
      if (record.lastKnownLocation !== slot.location) {
        recordAgentDailyLocationVisit(state, charaNum, slot.location, cursor);
      }
      const freeAction = state.freeActions?.[charaNum];
      if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) {
        recordAgentDailyActivity(state, charaNum, {
          kind: "work",
          startTick: cursor,
          endTick: segmentEnd,
          location: slot.location,
          label: `工作:${slot.state.CFLAG[CFLAG_ID.职种] ?? 0}`,
        });
      } else if (freeAction) {
        recordAgentDailyActivity(state, charaNum, {
          kind: "roam",
          startTick: cursor,
          endTick: segmentEnd,
          location: slot.location,
          label: `自由行动:${freeAction.type}`,
        });
      }
    }
    for (const charaNum of eligible) {
      const slot = state.charas[charaNum];
      if (!slot) continue;
      const record = ensureCharacterRecord(state, charaNum, dayIndex, cursor);
      if (!record) continue;
      const participants = sortedParticipants(occupants.get(slot.location) ?? [], charaNum);
      appendEncounter(record, cursor, segmentEnd, slot.location, participants);
    }
    cursor = segmentEnd;
  }
}

function relationshipChanges(
  before: AgentRelationshipEvidenceSnapshot,
  after: AgentRelationshipEvidenceSnapshot,
): AgentRelationshipChangeEvidence[] {
  const changes: AgentRelationshipChangeEvidence[] = [];
  const add = (field: AgentRelationshipChangeEvidence["field"], left: number | string | boolean, right: number | string | boolean) => {
    if (left !== right) changes.push({ field, before: left, after: right });
  };
  add("favor", before.favor, after.favor);
  add("trust", before.trust, after.trust);
  add("intimacy", before.intimacy, after.intimacy);
  add("attitude", before.attitude, after.attitude);
  add("stage", before.stage, after.stage);
  add("affection", before.traits.affection, after.traits.affection);
  add("love", before.traits.love, after.traits.love);
  add("lover", before.traits.lover, after.traits.lover);
  add("desire", before.traits.desire, after.traits.desire);
  add("sexFriend", before.traits.sexFriend, after.traits.sexFriend);
  return changes;
}

export function finalizeAgentDailyLedgerDay(
  state: GameState,
  dayIndex: number,
  closedAtTick = state.time.tickValue,
): void {
  const runtime = enabledRuntime(state);
  const day = runtime?.dailyLedger.days.find((entry) => entry.dayIndex === dayIndex);
  if (!runtime || !day) return;
  for (const [rawCharaNum, record] of Object.entries(day.characters)) {
    const charaNum = Number(rawCharaNum);
    const end = captureRelationshipEvidence(state, charaNum, closedAtTick);
    if (!end) continue;
    record.closedAtTick = closedAtTick;
    const currentVisit = record.visitedLocations.at(-1);
    if (currentVisit && currentVisit.leftAtTick === undefined) currentVisit.leftAtTick = closedAtTick;
    record.relationshipEnd = end;
    record.relationshipChanges = relationshipChanges(record.relationshipStart, end);
  }
}

export function getAgentDailyCharacterRecord(
  state: Readonly<GameState>,
  dayIndex: number,
  charaNum: number,
): Readonly<AgentDailyCharacterRecord> | undefined {
  return state.agentRuntime?.dailyLedger.days
    .find((day) => day.dayIndex === dayIndex)?.characters[charaNum];
}

export function hasInterestingEventAnchor(record: Readonly<AgentDailyCharacterRecord>): boolean {
  return record.activities.some((entry) => entry.endTick > entry.startTick)
    || record.visitedLocations.some((entry) => (entry.leftAtTick ?? entry.arrivedAtTick) > entry.arrivedAtTick)
    || record.encounters.some((entry) => entry.endTick > entry.startTick);
}

/** Deterministic semantic validation; audit prose never overrides these facts. */
export function validateAgentStoryClaim(
  state: Readonly<GameState>,
  record: Readonly<AgentDailyCharacterRecord>,
  claim: Readonly<AgentStoryClaim>,
): { valid: true } | { valid: false; reason: string } {
  if (!Number.isSafeInteger(claim.startTick) || !Number.isSafeInteger(claim.endTick)
    || claim.endTick <= claim.startTick) return { valid: false, reason: "invalid time window" };
  if (Math.floor(claim.startTick / 1440) !== record.dayIndex
    || Math.floor((claim.endTick - 1) / 1440) !== record.dayIndex) {
    return { valid: false, reason: "claim is outside ledger day" };
  }
  const participants = sortedParticipants(claim.participants, record.charaNum);
  if (participants.some((id) => id > 0 && !state.charas[id])) {
    return { valid: false, reason: "claim references an unknown character" };
  }
  const anchors = [
    ...record.activities,
    ...record.visitedLocations,
    ...record.encounters,
  ].filter((entry) => claim.anchorIds.includes(entry.id));
  if (anchors.length !== claim.anchorIds.length || anchors.length === 0) {
    return { valid: false, reason: "claim references missing anchors" };
  }
  const overlaps = (start: number, end: number) => start < claim.endTick && end > claim.startTick;
  const locationSupported = anchors.some((entry) => {
    if ("startTick" in entry) return entry.location === claim.location && overlaps(entry.startTick, entry.endTick);
    return entry.location === claim.location
      && overlaps(entry.arrivedAtTick, entry.leftAtTick ?? entry.arrivedAtTick);
  });
  if (!locationSupported) return { valid: false, reason: "location/time is not supported" };
  if (participants.length > 0) {
    const coLocated = record.encounters.some((entry) => entry.location === claim.location
      && overlaps(entry.startTick, entry.endTick)
      && participants.every((id) => entry.participants.includes(id)));
    if (!coLocated) return { valid: false, reason: "participants were not co-located" };
  }
  return { valid: true };
}
