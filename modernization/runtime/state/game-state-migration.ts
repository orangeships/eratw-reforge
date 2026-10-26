import { normalizeMemoryArchive } from "../agent/memory-archive.js";
import { backfillStoryBackgrounds } from "../story/background.js";
import { normalizeNarrativeHooks } from "../story/dialogue-hook.js";
import { normalizeStorylets } from "../story/storylet-runtime.js";
import {
  cloneGameState,
  emptyCharaSlotState,
  type CharaSlot,
  type CharaSlotState,
  type ChildRecord,
  type CharaFreeAction,
  type FreeActionMetaState,
  type CommissionSlot,
  type CommissionState,
  type CommissionOffer,
  type CommissionSearchReveal,
  type GameState,
  type DailyEventSession,
  type FestivalEventSession,
  type EventPromptLine,
  type EventPromptSpec,
  type MobMealSession,
  type DynamicCharacterMeta,
  type DynamicCharacterPortrait,
  type MobGirlMemorySession,
  type AcceptedEventRanking,
  type BanquetBeat,
  type BanquetEventInstance,
  type BanquetProgram,
  type DatePlanEvent,
  type DateSession,
  type OutingChoicePromptLine,
  type OutingChoiceResultSession,
  type OutingChoiceSession,
  type OutingChoiceValue,
  type WorldEventInstance,
  type FirstKissRecord,
  type HSettlementEvent,
  type HSettlementReceipt,
  type KojoMemory,
  type SleepSession,
  type TrainingCommandRecord,
  type TrainingMode,
  type TrainingSession,
  type TrainingSummary,
  type WalkEncounter,
  type WalkSession,
  type LockedDoorPause,
  type WorkRuntimeEntry,
  type WorkRuntimeState,
} from "./game-state.js";
import type { StoryProgram } from "../story/types.js";
import { normalizeParkedStoryProgram, reconcileNarrativeState } from "../story/reconciliation.js";
import { recoverPrematurelyMissedNarrativeWindows } from "../story/legacy-window-recovery.js";
import type { StoryProgramV2 } from "../story/types.js";
import { isStoryProgram } from "../story/validator.js";
import { normalizeNarrativeEvents, normalizeNarrativeSituationSession, normalizeStoryArcs, normalizeStoryTemplateFavorites } from "../story/persistence.js";
import { isObservationEvent } from "../../schemas/validator.js";
import type { BattleInput, DanmakuBattleSession } from "./danmaku-game.js";
import type { FishingGameSession } from "./fishing-game.js";
import { defaultFishingGear, FISHING_LINES, FISHING_RODS, type FishingGearState, type FishingLineId, type FishingRodId } from "./fishing.js";
import {
  defaultStoneContestProgress,
  type StoneContestCoupleScore,
  type StoneContestPendingSettlement,
  type StoneContestProgress,
  type StoneContestSession,
} from "./stone-contest.js";
import {
  STONE_CONTEST_DURATION_FRAMES,
  normalizeStoneOperation,
  replayStoneOperations,
  type StonePlacementOperation,
} from "./stone-contest-physics.js";
import {
  clearTflag,
  setTflag,
  TFLAG_ID,
  tflagLifecycle,
} from "./tflag.js";
import { BASE_ID, CFLAG_ID, FLAG_ID, TALENT_ID, TCVAR_ID, TEQUIP_ID } from "./settlement.js";
import { restoreLegacyHInsertionSession } from "./h-interaction-state.js";
import { MAXPANTS, PANTS_MGMT_OFFSET } from "./panty-collection.js";
import { repairOrphanStealthSummary } from "./stealth.js";
import { JOB_ID } from "../world/work/work-manifest.js";
import {
  AGENT_RUNTIME_VERSION,
  COGNITIVE_CAPS,
  MAX_LAZY_REQUESTS_PER_DAY,
  createAgentMaterializationState,
  createAgentRuntimeState,
  pruneMaterializationTicks,
} from "../agent/init.js";
import {
  MAX_DAILY_ACTIVITIES,
  MAX_DAILY_ENCOUNTERS,
  MAX_DAILY_LOCATIONS,
  MAX_LEDGER_DAYS,
  createAgentDailyLedger,
  ensureCurrentAgentLedgerDay,
} from "../agent/daily-ledger.js";
import {
  createAgentMindState,
  normalizeAgentMindState,
  normalizeAgentPendingEpisodes,
} from "../agent/mind.js";
import {
  isAcceptedExperience,
  pruneAcceptedExperiences,
  type AcceptedExperience,
} from "../experience.js";
import { ensureRinnosuke } from "../world/dynamic-characters.js";

function normalizeAcceptedExperiences(value: unknown): AcceptedExperience[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  const accepted: AcceptedExperience[] = [];
  for (const candidate of value) {
    if (!isAcceptedExperience(candidate)
      || ids.has(candidate.id)
      || candidate.sourceIds.some((sourceId) => sourceIds.has(sourceId))) continue;
    ids.add(candidate.id);
    for (const sourceId of candidate.sourceIds) sourceIds.add(sourceId);
    accepted.push(candidate);
  }
  return pruneAcceptedExperiences(accepted);
}

/**
 * Version 27 adds the bounded L2 Agent mind and player-anchored pending
 * episodes. Version 26 adds the bounded deterministic Agent daily ledger.
 * Version 24 persists the resumable public-festival prompt and the
 * 大晦日 schedule restoration snapshot. Version 23 persists bounded
 * AcceptedExperience and Lazy materialization
 * bookkeeping. Earlier migrations also validate resumable continuations and
 * repair the legacy EQUIP/TEQUIP namespace collision, so the upgrade remains
 * safe for saves that predate any of these state shapes.
 */
import { normalizeRelationshipLedger } from "../ai-state/relationship.js";

// Version 31 adds the per-Arc cross-day maintenance record (StoryArcMaintenanceV1).
// Version 32 keeps missed opportunities alive and clears the known slot-2
// orphan residue instead of reviving it during reconciliation.
// Version 33 adds a separate named store for upstream #DIM SAVEDATA values.
// Version 34 repairs untouched narrative windows cancelled before their deadline.
// Version 35 retires the date road phase: `traveling` / `returning` sessions
// normalize to `active` and the leftover `travelRemainingMinutes` counter is
// dropped (upstream travel time is still charged, the road itself is not
// modeled).
// Version 41 admits L3 dialogue-hook nodes and optional actual L1 expression
// lines. Older programs keep their validated legacy nodes; absent hook lines
// stay absent, never reconstructed from a planned objective or fallback.
// Version 42 adds the optional diary trigger "jev"; existing command/cadence
// entries remain historical records and never schedule another diary.
// Version 43 adds published story-interaction evidence and optional Arc progress.
// Older saves start without inferred dialogue outcomes or reconstructed evidence.
export const GAME_STATE_SCHEMA_VERSION = 43;

const LEGACY_HAKUREI_HOME = "神社:自室";
const DEFAULT_HAKUREI_HOME = "神社:倉庫";
const MAX_WALK_REMAINING_ROOMS = 512;
const MAX_TRAINING_PARTICIPANTS = 32;
const MAX_TRAINING_RECENT_COMMANDS = 16;

export interface GameStateMigrationResult {
  state: GameState;
  valid: boolean;
  sourceVersion: number;
  warnings: string[];
}

type UnknownRecord = Record<string, unknown>;

const KNOWN_SLOT2_ARC_ID = "arc:free-story:14";
const KNOWN_SLOT2_EVENT_ID = "proposal-close-work-relationship-001";

/** Remove only the exact orphan shape observed in slot 2. This is deliberately
 * narrow: other expired events linked to a valid cast are migrated to `missed`
 * by narrative reconciliation and must not be erased. */
function clearKnownSlot2NarrativeResidue(state: GameState, warnings: string[]): void {
  const arc = state.storyArcs?.find((entry) => entry.id === KNOWN_SLOT2_ARC_ID);
  const event = state.narrativeEvents?.find((entry) => entry.id === KNOWN_SLOT2_EVENT_ID);
  if (!arc || !event || state.storyProgram || event.arcId !== KNOWN_SLOT2_ARC_ID
    || event.status !== "expired" || arc.status !== "active"
    || arc.participantRoles.some((role) => role.characterId !== 0)) return;
  state.storyArcs = (state.storyArcs ?? []).filter((entry) => entry.id !== KNOWN_SLOT2_ARC_ID);
  state.narrativeEvents = (state.narrativeEvents ?? []).filter((entry) => entry.id !== KNOWN_SLOT2_EVENT_ID && entry.arcId !== KNOWN_SLOT2_ARC_ID);
  state.narrativeSituationSession = null;
  if (state.activeEventContext?.arcId === KNOWN_SLOT2_ARC_ID) state.activeEventContext = null;
  warnings.push("cleared known slot-2 narrative orphan residue");
}

const CHARA_NAMESPACES = Object.keys(
  emptyCharaSlotState(),
) as (keyof CharaSlotState)[];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDynamicCharacterPortrait(value: unknown): DynamicCharacterPortrait | undefined {
  if (!isRecord(value) || value.template !== "upstream-mob") return undefined;
  const layers = (candidate: unknown): string[] | undefined => {
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.length > 32) return undefined;
    const normalized = candidate.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 160);
    return normalized.length === candidate.length ? normalized : undefined;
  };
  const normal = layers(value.normal);
  const smile = layers(value.smile);
  const angry = layers(value.angry);
  if (!normal || !smile || !angry) return undefined;
  return { template: "upstream-mob", normal, smile, angry };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberRecord(value: unknown): Record<number, number> {
  if (!isRecord(value)) return {};
  const out: Record<number, number> = {};
  for (const [rawId, rawValue] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      continue;
    }
    out[id] = rawValue;
  }
  return out;
}

function stringNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) out[key] = rawValue;
  }
  return out;
}

function normalizeCharaState(
  value: unknown,
  fallback: CharaSlotState = emptyCharaSlotState(),
): CharaSlotState {
  const source = isRecord(value) ? value : {};
  const next = { ...fallback } as CharaSlotState;
  for (const namespace of CHARA_NAMESPACES) {
    next[namespace] = {
      ...numberRecord(fallback[namespace]),
      ...numberRecord(source[namespace]),
    };
  }
  return next;
}

function normalizeLocation(
  value: unknown,
  fallback: string,
  homeLocation?: string,
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (value === "神社") {
    return homeLocation?.includes(":") ? homeLocation : fallback;
  }
  return value;
}

function normalizeSlot(
  value: unknown,
  fallback: CharaSlot,
  charaNum: number,
  homeLocation?: string,
): CharaSlot {
  const source = isRecord(value) ? value : {};
  return {
    ...fallback,
    ...source,
    charaNum,
    name: typeof source.name === "string" ? source.name : fallback.name,
    callName: typeof source.callName === "string" ? source.callName : fallback.callName,
    location: normalizeLocation(source.location, fallback.location, homeLocation),
    homeLocation:
      typeof source.homeLocation === "string"
        ? source.homeLocation
        : fallback.homeLocation,
    state: normalizeCharaState(source.state, fallback.state),
  };
}

function normalizeKojoMemory(value: unknown): Record<number, KojoMemory> {
  if (!isRecord(value)) return {};
  const out: Record<number, KojoMemory> = {};
  for (const [rawCharaNum, rawMemory] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isFinite(charaNum) || !isRecord(rawMemory)) continue;
    const firstTime: Record<string, true> = {};
    const once: Record<string, true> = {};
    if (isRecord(rawMemory.firstTime)) {
      for (const [key, seen] of Object.entries(rawMemory.firstTime)) {
        if (seen) firstTime[key] = true;
      }
    }
    if (isRecord(rawMemory.once)) {
      for (const [key, seen] of Object.entries(rawMemory.once)) {
        if (seen) once[key] = true;
      }
    }
    out[charaNum] = { firstTime, once };
  }
  return out;
}

function normalizeSelectedVariants(value: unknown): Record<number, string> {
  if (!isRecord(value)) return {};
  const out: Record<number, string> = {};
  for (const [rawCharaNum, variant] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (Number.isFinite(charaNum) && typeof variant === "string") {
      out[charaNum] = variant;
    }
  }
  return out;
}

function normalizeDisabledKojo(value: unknown): Record<number, true> {
  if (!isRecord(value)) return {};
  const out: Record<number, true> = {};
  for (const [rawCharaNum, disabled] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (Number.isFinite(charaNum) && disabled) out[charaNum] = true;
  }
  return out;
}

function normalizeSnapshot(
  value: unknown,
): Record<number, CharaSlotState> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<number, CharaSlotState> = {};
  for (const [rawCharaNum, rawState] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isFinite(charaNum)) continue;
    out[charaNum] = normalizeCharaState(rawState);
  }
  return out;
}

function normalizeSleepSession(value: unknown): SleepSession | null | undefined {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (!isRecord(value)) return undefined;
  const startedAtTick = finiteNumber(value.startedAtTick, NaN);
  if (!Number.isFinite(startedAtTick)) return undefined;
  const requestedWakeMinute = value.requestedWakeMinute === undefined
    ? undefined
    : finiteNumber(value.requestedWakeMinute, NaN);
  if (requestedWakeMinute !== undefined && !Number.isFinite(requestedWakeMinute)) return undefined;
  return {
    startedAtTick,
    requestedWakeMinute,
    forced: value.forced === true,
    ...(typeof value.presentationEventLogIndex === "number" && Number.isFinite(value.presentationEventLogIndex)
      ? { presentationEventLogIndex: Math.max(0, Math.trunc(value.presentationEventLogIndex)) }
      : {}),
  };
}

function normalizeDailyEventSession(value: unknown): DailyEventSession | undefined {
  if (!isRecord(value)) return undefined;
  const phaseByKind: Record<string, string[]> = {
    "ev0-fairy-punishment": ["punishment-choice"],
    "ev20-head-visit": ["visit-choice"],
    "ev5-oppai": ["oppai-choice", "oppai-futanari-choice", "oppai-target", "oppai-correction"],
    "ev23-visit-sales": ["sales-appearance", "sales-listen", "sales-offer", "sales-bargain", "sales-use", "sales-return", "sales-intimate", "sales-intimate-payment"],
    "daily-kojo": ["kojo-choice"],
  };
  if (typeof value.kind !== "string" || !phaseByKind[value.kind]?.includes(String(value.phase)) ||
    typeof value.eventDay !== "number" || !Number.isFinite(value.eventDay) ||
    typeof value.sleepSeed !== "number" || !Number.isFinite(value.sleepSeed)) return undefined;
  const kind = value.kind as DailyEventSession["kind"];
  const eventId = kind === "ev20-head-visit" ? 20
    : kind === "ev5-oppai" ? 5
      : kind === "ev23-visit-sales" ? 23
        : kind === "daily-kojo" && (value.eventId === 2 || value.eventId === 4) ? value.eventId
          : 0;
  const phase = value.phase as DailyEventSession["phase"];
  const data = isRecord(value.data)
    ? Object.fromEntries(Object.entries(value.data).filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")) as Record<string, number | string | boolean>
    : undefined;
  const prompt = normalizeDailyEventPrompt(value.prompt);
  return {
    kind,
    eventId,
    eventDay: Math.trunc(value.eventDay),
    sleepSeed: Math.trunc(value.sleepSeed),
    phase,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function normalizeDailyEventPrompt(value: unknown): EventPromptSpec | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  if (kind !== "ask_yn" && kind !== "pick_one" && kind !== "pick_many" && kind !== "free_text") return undefined;
  if (typeof value.question !== "string" || !Array.isArray(value.options)) return undefined;
  const options: EventPromptSpec["options"] = [];
  for (const rawOption of value.options) {
    if (!isRecord(rawOption)) continue;
    const id = rawOption.id;
    if (!(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))) continue;
    if (typeof rawOption.label !== "string") continue;
    const option: EventPromptSpec["options"][number] = { id, label: rawOption.label };
    if (typeof rawOption.detail === "string") option.detail = rawOption.detail;
    if (rawOption.disabled === true) option.disabled = true;
    options.push(option);
  }
  if (kind !== "free_text" && options.length === 0) return undefined;
  const opening = normalizeEventPromptOpening(value.opening);
  return {
    kind,
    question: value.question,
    options,
    ...(opening.length > 0 ? { opening } : {}),
  };
}

function normalizeFestivalEventSession(value: unknown): FestivalEventSession | undefined {
  if (!isRecord(value) || value.kind !== "new-year") return undefined;
  if (typeof value.dayIndex !== "number" || !Number.isFinite(value.dayIndex)) return undefined;
  const prompt = normalizeDailyEventPrompt(value.prompt);
  if (!prompt || prompt.kind !== "pick_one" || prompt.options.length !== 6) return undefined;
  const ids = prompt.options.map((option) => option.id);
  if (ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > 6)
    || new Set(ids).size !== 6) return undefined;
  return {
    kind: "new-year",
    dayIndex: Math.trunc(value.dayIndex),
    prompt,
  };
}

function normalizeFestivalScheduleSnapshots(
  value: unknown,
): Record<number, { returnTime: number; sleepTime: number }> {
  if (!isRecord(value)) return {};
  const out: Record<number, { returnTime: number; sleepTime: number }> = {};
  for (const [rawCharaNum, rawSnapshot] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isSafeInteger(charaNum) || charaNum < 0 || !isRecord(rawSnapshot)) continue;
    if (typeof rawSnapshot.returnTime !== "number" || !Number.isFinite(rawSnapshot.returnTime)
      || typeof rawSnapshot.sleepTime !== "number" || !Number.isFinite(rawSnapshot.sleepTime)) continue;
    out[charaNum] = {
      returnTime: Math.trunc(rawSnapshot.returnTime),
      sleepTime: Math.trunc(rawSnapshot.sleepTime),
    };
  }
  return out;
}

function normalizeEventPromptOpening(value: unknown): EventPromptLine[] {
  if (!Array.isArray(value)) return [];
  const lines: EventPromptLine[] = [];
  for (const rawLine of value) {
    if (!isRecord(rawLine) || (rawLine.kind !== "narration" && rawLine.kind !== "dialogue") || typeof rawLine.text !== "string") continue;
    const text = rawLine.text.trim();
    if (text.length === 0) continue;
    const line: EventPromptLine = { kind: rawLine.kind, text };
    if (rawLine.kind === "dialogue" && typeof rawLine.speaker === "string" && rawLine.speaker.trim().length > 0) {
      line.speaker = rawLine.speaker.trim();
    }
    lines.push(line);
  }
  return lines;
}

function normalizeMobMealSession(value: unknown): MobMealSession | undefined {
  if (!isRecord(value) || value.kind !== "mob-meal") return undefined;
  if (
    typeof value.offeredAtTick !== "number" || !Number.isFinite(value.offeredAtTick) ||
    typeof value.location !== "string" || !Array.isArray(value.participants) ||
    typeof value.qualityRoll !== "number" || !Number.isInteger(value.qualityRoll) ||
    value.qualityRoll < 0 || value.qualityRoll > 4
  ) return undefined;
  const participants = value.participants.filter(
    (id): id is number => typeof id === "number" && Number.isInteger(id) && id >= 0,
  );
  if (participants.length !== value.participants.length || new Set(participants).size !== participants.length) return undefined;
  return {
    kind: "mob-meal",
    offeredAtTick: Math.trunc(value.offeredAtTick),
    location: value.location,
    participants,
    qualityRoll: value.qualityRoll,
  };
}

function boundedNonemptyString(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  return value;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeWalkEncounter(
  value: unknown,
  charas: Readonly<Record<number, CharaSlot>>,
): WalkEncounter | undefined {
  if (!isRecord(value)) return undefined;
  const location = boundedNonemptyString(value.location);
  const charaNum = nonnegativeInteger(value.charaNum);
  const name = boundedNonemptyString(value.name, 128);
  const kehai = nonnegativeInteger(value.kehai);
  if (
    !location || !name || charaNum === undefined || charaNum <= 0 || !charas[charaNum] ||
    kehai === undefined || kehai > 4 || typeof value.canGreet !== "boolean"
  ) return undefined;
  return { location, charaNum, name, kehai, canGreet: value.canGreet };
}

function normalizeLockedDoorPause(
  value: unknown,
  charas: Readonly<Record<number, CharaSlot>>,
): LockedDoorPause | undefined {
  if (!isRecord(value)) return undefined;
  const location = boundedNonemptyString(value.location);
  const ownerCharaNum = nonnegativeInteger(value.ownerCharaNum);
  const ownerName = boundedNonemptyString(value.ownerName, 128);
  if (!location || !ownerName || ownerCharaNum === undefined || ownerCharaNum <= 0 || !charas[ownerCharaNum]) {
    return undefined;
  }
  return { location, ownerCharaNum, ownerName };
}

function normalizeWalkSession(
  value: unknown,
  charas: Readonly<Record<number, CharaSlot>>,
): WalkSession | null | undefined {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (!isRecord(value) || !Array.isArray(value.remaining) || value.remaining.length > MAX_WALK_REMAINING_ROOMS) {
    return undefined;
  }
  const remaining = value.remaining.map((room) => boundedNonemptyString(room));
  const dest = boundedNonemptyString(value.dest);
  const prevLocation = boundedNonemptyString(value.prevLocation);
  const stepsTaken = nonnegativeInteger(value.stepsTaken);
  if (remaining.some((room) => room === undefined) || !dest || !prevLocation || stepsTaken === undefined) {
    return undefined;
  }

  const encounter = normalizeWalkEncounter(value.encounter, charas);
  const lockedDoor = normalizeLockedDoorPause(value.lockedDoor, charas);
  const hasEncounterInput = value.encounter !== null && value.encounter !== undefined;
  const hasLockedDoorInput = value.lockedDoor !== null && value.lockedDoor !== undefined;
  if (hasEncounterInput === hasLockedDoorInput || (hasEncounterInput && !encounter) || (hasLockedDoorInput && !lockedDoor)) {
    return undefined;
  }
  return {
    remaining: remaining as string[],
    dest,
    stepsTaken,
    prevLocation,
    ...(encounter ? { encounter } : { lockedDoor: lockedDoor! }),
  };
}

function isTrainingMode(value: unknown): value is TrainingMode {
  return value === "h" || value === "partner-led" || value === "time-stop";
}

function normalizeTrainingCommandRecord(
  value: unknown,
  target: number,
  startedAtTick: number,
  lastTick: number,
  startedDay: number,
  currentDay: number,
): TrainingCommandRecord | undefined {
  if (!isRecord(value) || value.outcome !== "ok" && value.outcome !== "blocked" && value.outcome !== "noop") {
    return undefined;
  }
  const commandNo = nonnegativeInteger(value.commandNo);
  const recordTarget = nonnegativeInteger(value.target);
  const tick = nonnegativeInteger(value.tick);
  const day = nonnegativeInteger(value.day);
  if (
    commandNo === undefined || recordTarget !== target || tick === undefined || day === undefined ||
    tick < startedAtTick || tick > lastTick || day < startedDay || day > currentDay
  ) return undefined;
  return { commandNo, target: recordTarget, tick, day, outcome: value.outcome };
}

function normalizeTrainingSession(value: unknown, state: Readonly<GameState>): TrainingSession | null | undefined {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (!isRecord(value) || !isTrainingMode(value.mode) || !Array.isArray(value.participants) || !Array.isArray(value.recentCommands)) {
    return undefined;
  }
  const target = nonnegativeInteger(value.target);
  const startedAtTick = nonnegativeInteger(value.startedAtTick);
  const startedDay = nonnegativeInteger(value.startedDay);
  const lastTick = nonnegativeInteger(value.lastTick);
  const lastCommandNo = nonnegativeInteger(value.lastCommandNo);
  const commandCount = nonnegativeInteger(value.commandCount);
  if (
    target === undefined || target <= 0 || !state.charas[target] || startedAtTick === undefined ||
    startedDay === undefined || lastTick === undefined || lastCommandNo === undefined || commandCount === undefined ||
    startedAtTick > lastTick || lastTick > state.time.tickValue || startedDay > state.time.dayIndex ||
    value.participants.length === 0 || value.participants.length > MAX_TRAINING_PARTICIPANTS ||
    value.recentCommands.length > MAX_TRAINING_RECENT_COMMANDS
  ) return undefined;
  if (state.charas[target]!.location !== state.master.location) return undefined;

  const participants = value.participants.map(nonnegativeInteger);
  if (
    participants.some((participant) => participant === undefined) ||
    new Set(participants).size !== participants.length ||
    !participants.includes(target) ||
    participants.some((participant) => participant! > 0 && !state.charas[participant!])
  ) return undefined;

  const recentCommands = value.recentCommands.map((record) => normalizeTrainingCommandRecord(
    record,
    target,
    startedAtTick,
    lastTick,
    startedDay,
    state.time.dayIndex,
  ));
  if (recentCommands.some((record) => record === undefined) || commandCount < recentCommands.length) return undefined;
  for (let i = 1; i < recentCommands.length; i += 1) {
    if (recentCommands[i]!.tick < recentCommands[i - 1]!.tick) return undefined;
  }
  const lastRecord = recentCommands.at(-1);
  if (lastRecord && (lastRecord.commandNo !== lastCommandNo || lastRecord.tick !== lastTick)) return undefined;

  const hModeActive =
    (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 ||
    (state.charas[target]?.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0;
  const timeStopActive = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  if (value.mode === "time-stop" ? !timeStopActive : !hModeActive) return undefined;

  return {
    target,
    startedAtTick,
    startedDay,
    lastTick,
    lastCommandNo,
    commandCount,
    mode: value.mode,
    participants: participants as number[],
    recentCommands: recentCommands as TrainingCommandRecord[],
    ...(typeof value.vInserted === "boolean" ? { vInserted: value.vInserted } : {}),
    ...(typeof value.aInserted === "boolean" ? { aInserted: value.aInserted } : {}),
    ...(nonnegativeInteger(value.currentPositionCommandNo) !== undefined
      ? { currentPositionCommandNo: nonnegativeInteger(value.currentPositionCommandNo) }
      : {}),
  };
}

function normalizeTrainingSummary(value: unknown, state: Readonly<GameState>): TrainingSummary | null | undefined {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (
    !isRecord(value) || !isTrainingMode(value.mode) ||
    value.reason !== "exit-command" && value.reason !== "target-changed" && value.reason !== "manual"
  ) return undefined;
  const target = nonnegativeInteger(value.target);
  const startedAtTick = nonnegativeInteger(value.startedAtTick);
  const endedAtTick = nonnegativeInteger(value.endedAtTick);
  const startedDay = nonnegativeInteger(value.startedDay);
  const endedDay = nonnegativeInteger(value.endedDay);
  const commandCount = nonnegativeInteger(value.commandCount);
  const lastCommandNo = nonnegativeInteger(value.lastCommandNo);
  if (
    target === undefined || target <= 0 || !state.charas[target] || startedAtTick === undefined || endedAtTick === undefined ||
    startedDay === undefined || endedDay === undefined || commandCount === undefined || lastCommandNo === undefined ||
    startedAtTick > endedAtTick || endedAtTick > state.time.tickValue || startedDay > endedDay || endedDay > state.time.dayIndex
  ) return undefined;
  return {
    target,
    startedAtTick,
    endedAtTick,
    startedDay,
    endedDay,
    commandCount,
    mode: value.mode,
    lastCommandNo,
    reason: value.reason,
  };
}

const H_SETTLEMENT_CHANNELS = new Set(["Ｃ", "Ｖ", "Ａ", "Ｂ", "Ｍ"]);

function normalizeHSettlementEvent(value: unknown): HSettlementEvent | undefined {
  if (!isRecord(value)) return undefined;
  const subject = nonnegativeInteger(value.subject);
  if (subject === undefined || typeof value.amount !== "number" || !Number.isFinite(value.amount)) {
    return undefined;
  }
  if (value.kind !== "orgasm" && value.kind !== "unaware-orgasm" && value.kind !== "ejaculation") {
    return undefined;
  }
  const channel = value.channel;
  if (channel !== undefined && (typeof channel !== "string" || !H_SETTLEMENT_CHANNELS.has(channel))) {
    return undefined;
  }
  let site: HSettlementEvent["site"];
  if (value.site !== undefined) {
    if (!isRecord(value.site)) return undefined;
    const code = nonnegativeInteger(value.site.code);
    const kind = value.site.kind;
    if (
      code === undefined ||
      (kind !== "ejaculation-site" && kind !== "stimulated-side") ||
      typeof value.site.label !== "string"
    ) return undefined;
    site = { code, kind, label: value.site.label };
  }
  let markerLabels: string[] | undefined;
  if (value.markerLabels !== undefined) {
    if (!Array.isArray(value.markerLabels) || !value.markerLabels.every((label) => typeof label === "string")) {
      return undefined;
    }
    markerLabels = [...value.markerLabels];
  }
  return {
    subject,
    kind: value.kind,
    ...(channel === undefined ? {} : { channel: channel as HSettlementEvent["channel"] }),
    amount: value.amount,
    ...(site === undefined ? {} : { site }),
    ...(markerLabels === undefined ? {} : { markerLabels }),
  };
}

/**
 * The receipt is a shortcut for the L1 scene projection, not gameplay truth.
 * A malformed one is dropped **whole** rather than partially trusted: a
 * half-valid receipt would present invented events as settled ones. Dropping
 * degrades every consumer to "unknown", which they must already handle.
 */
function normalizeHSettlementReceipt(value: unknown): HSettlementReceipt | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value) || value.version !== 1) return undefined;

  const tick = nonnegativeInteger(value.tick);
  const day = nonnegativeInteger(value.day);
  const commandNo = nonnegativeInteger(value.commandNo);
  const actor = nonnegativeInteger(value.actor);
  if (tick === undefined || day === undefined || commandNo === undefined || actor === undefined) {
    return undefined;
  }

  if (!Array.isArray(value.events)) return undefined;
  const events: HSettlementEvent[] = [];
  for (const candidate of value.events) {
    const event = normalizeHSettlementEvent(candidate);
    if (!event) return undefined;
    events.push(event);
  }

  let deposits: HSettlementReceipt["deposits"];
  if (value.deposits !== undefined) {
    if (!Array.isArray(value.deposits)) return undefined;
    deposits = [];
    for (const candidate of value.deposits) {
      if (!isRecord(candidate)) return undefined;
      const subject = nonnegativeInteger(candidate.subject);
      const amount = finiteNumber(candidate.amount, Number.NaN);
      if (subject === undefined || !Number.isFinite(amount) || amount <= 0 || (candidate.site !== "v" && candidate.site !== "a")) return undefined;
      deposits.push({ subject, site: candidate.site, amount });
    }
  }

  let session: HSettlementReceipt["session"] = null;
  if (value.session !== null && value.session !== undefined) {
    if (!isRecord(value.session) || !isTrainingMode(value.session.mode)) return undefined;
    const target = nonnegativeInteger(value.session.target);
    if (target === undefined || target <= 0 || !Array.isArray(value.session.participants)) return undefined;
    const participants: number[] = [];
    for (const raw of value.session.participants) {
      const id = nonnegativeInteger(raw);
      if (id === undefined) return undefined;
      participants.push(id);
    }
    if (typeof value.session.exited !== "boolean" || typeof value.session.started !== "boolean") return undefined;
    const reason = value.session.exitReason;
    if (
      reason !== null &&
      reason !== "exit-command" && reason !== "target-changed" && reason !== "manual"
    ) return undefined;
    session = {
      target,
      mode: value.session.mode,
      participants,
      exited: value.session.exited,
      exitReason: reason,
      started: value.session.started,
    };
  }

  if (!isRecord(value.edging)) return undefined;
  const gained = finiteNumber(value.edging.gained, Number.NaN);
  const cleared = finiteNumber(value.edging.cleared, Number.NaN);
  if (!Number.isFinite(gained) || !Number.isFinite(cleared)) return undefined;

  if (!Array.isArray(value.marks) || !value.marks.every((mark) => typeof mark === "string")) {
    return undefined;
  }

  if (!isRecord(value.insertion)) return undefined;
  if (typeof value.insertion.v !== "boolean" || typeof value.insertion.a !== "boolean") return undefined;
  if (!isRecord(value.insertionBefore)) return undefined;
  if (typeof value.insertionBefore.v !== "boolean" || typeof value.insertionBefore.a !== "boolean") {
    return undefined;
  }

  if (!Array.isArray(value.vitality)) return undefined;
  const vitality: HSettlementReceipt["vitality"] = [];
  for (const candidate of value.vitality) {
    if (!isRecord(candidate)) return undefined;
    const subject = nonnegativeInteger(candidate.subject);
    const stamina = finiteNumber(candidate.stamina, Number.NaN);
    const will = finiteNumber(candidate.will, Number.NaN);
    if (subject === undefined || !Number.isFinite(stamina) || !Number.isFinite(will)) return undefined;
    vitality.push({ subject, stamina, will });
  }

  return {
    version: 1,
    tick,
    day,
    commandNo,
    actor,
    session,
    events,
    ...(deposits === undefined ? {} : { deposits }),
    edging: { gained, cleared },
    marks: [...value.marks] as string[],
    insertion: { v: value.insertion.v, a: value.insertion.a },
    insertionBefore: { v: value.insertionBefore.v, a: value.insertionBefore.a },
    vitality,
  };
}

function normalizeDynamicCharacters(
  value: unknown,
  charas: Readonly<Record<number, CharaSlot>>,
  warnings: string[],
): Record<number, DynamicCharacterMeta> {
  if (!isRecord(value)) return {};
  const out: Record<number, DynamicCharacterMeta> = {};
  for (const [rawId, rawMeta] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0 || !charas[id] || !isRecord(rawMeta)) continue;
    if (rawMeta.origin === "authored") {
      if (
        rawMeta.lifecycle !== "resident" || rawMeta.active !== true ||
        !Number.isFinite(rawMeta.seed) || typeof rawMeta.role !== "string" ||
        rawMeta.adult !== true || !Number.isFinite(rawMeta.createdDay) ||
        typeof rawMeta.homeLocation !== "string"
      ) {
        warnings.push(`discarded invalid authored dynamic character metadata for ${rawId}`);
        continue;
      }
      out[id] = {
        origin: "authored",
        lifecycle: "resident",
        active: true,
        seed: Math.trunc(rawMeta.seed as number),
        role: rawMeta.role,
        adult: true,
        createdDay: Math.trunc(rawMeta.createdDay as number),
        homeLocation: rawMeta.homeLocation,
        ...(typeof rawMeta.species === "string" ? { species: rawMeta.species } : {}),
      };
      continue;
    }
    if (
      rawMeta.origin !== "generated" ||
      (rawMeta.lifecycle !== "transient" && rawMeta.lifecycle !== "remembered") ||
      typeof rawMeta.active !== "boolean" ||
      !Number.isFinite(rawMeta.seed) ||
      typeof rawMeta.species !== "string" ||
      typeof rawMeta.encounterRegion !== "string" ||
      typeof rawMeta.encounterSummary !== "string" ||
      !Number.isFinite(rawMeta.createdDay)
    ) {
      warnings.push(`discarded invalid dynamic character metadata for ${rawId}`);
      continue;
    }
    const rememberedSlot = Number.isInteger(rawMeta.rememberedSlot)
      ? Math.trunc(rawMeta.rememberedSlot as number)
      : undefined;
    const portrait = normalizeDynamicCharacterPortrait(rawMeta.portrait);
    const raceBuffBattleBonus = Number.isFinite(rawMeta.raceBuffBattleBonus)
      ? Math.max(0, Math.trunc(rawMeta.raceBuffBattleBonus as number))
      : undefined;
    const raceBuffHandicapMultiplier = Number.isFinite(rawMeta.raceBuffHandicapMultiplier)
      ? Math.max(1, Number(rawMeta.raceBuffHandicapMultiplier))
      : undefined;
    out[id] = {
      origin: "generated",
      lifecycle: rawMeta.lifecycle,
      active: rawMeta.active,
      seed: Math.trunc(rawMeta.seed as number),
      species: rawMeta.species,
      encounterRegion: rawMeta.encounterRegion,
      encounterSummary: rawMeta.encounterSummary,
      createdDay: Math.trunc(rawMeta.createdDay as number),
      ...(portrait ? { portrait } : {}),
      ...(rememberedSlot !== undefined ? { rememberedSlot } : {}),
      ...(raceBuffBattleBonus !== undefined ? { raceBuffBattleBonus } : {}),
      ...(raceBuffHandicapMultiplier !== undefined ? { raceBuffHandicapMultiplier } : {}),
    };
  }
  return out;
}

function normalizeMobGirlMemorySession(
  value: unknown,
  dynamicCharacters: Readonly<Record<number, DynamicCharacterMeta>>,
): MobGirlMemorySession | undefined {
  if (!isRecord(value) || value.kind !== "mob-girl-memory") return undefined;
  if (!Number.isInteger(value.charaNum) || !Number.isFinite(value.dayIndex)) return undefined;
  const charaNum = Math.trunc(value.charaNum as number);
  if (dynamicCharacters[charaNum]?.lifecycle !== "transient") return undefined;
  return { kind: "mob-girl-memory", charaNum, dayIndex: Math.trunc(value.dayIndex as number) };
}

function normalizeOutingChoiceSession(value: unknown, warnings: string[] = []): OutingChoiceSession | null {
  if (!isRecord(value)) { warnings.push("discarded invalid outing-choice session"); return null; }
  const validEvents = [2, 3, 5, 6, 7] as const;
  const eventId = value.eventId;
  if (typeof eventId !== "number" || !(validEvents as readonly number[]).includes(eventId)) {
    warnings.push("discarded outing-choice session with invalid eventId");
    return null;
  }
  const channel = value.channel;
  if (channel !== "outing-departure" && channel !== "outing-return") {
    warnings.push("discarded outing-choice session with invalid channel");
    return null;
  }
  const startedAtTick = Number.isFinite(value.startedAtTick) ? Math.trunc(value.startedAtTick as number) : 0;
  const prompt = normalizeOutingChoicePrompt(value.prompt, warnings);
  if (!prompt) {
    warnings.push("discarded outing-choice session with malformed prompt");
    return null;
  }
  return {
    kind: "outing-choice",
    eventId: eventId as OutingChoiceSession["eventId"],
    channel,
    startedAtTick,
    prompt,
    ...(typeof value.rngSeed === "number" && Number.isFinite(value.rngSeed)
      ? { rngSeed: Math.trunc(value.rngSeed) }
      : {}),
  };
}

function normalizeOutingChoiceResultSession(value: unknown, warnings: string[] = []): OutingChoiceResultSession | null {
  if (!isRecord(value)) { warnings.push("discarded invalid outing-choice-result session"); return null; }
  const validEvents = [2, 3, 5, 6, 7] as const;
  if (typeof value.eventId !== "number" || !(validEvents as readonly number[]).includes(value.eventId)) {
    warnings.push("discarded outing-choice-result session with invalid eventId");
    return null;
  }
  if (value.channel !== "outing-departure" && value.channel !== "outing-return") {
    warnings.push("discarded outing-choice-result session with invalid channel");
    return null;
  }
  const prompt = normalizeOutingChoicePrompt(value.prompt, warnings);
  if (!prompt || !Array.isArray(value.resultEvents) || !value.resultEvents.every(isObservationEvent)) {
    warnings.push("discarded malformed outing-choice-result session");
    return null;
  }
  const answer = value.answer;
  const validAnswer = answer === "decline" || answer === "accept" || answer === "rescue" ||
    (typeof answer === "number" && Number.isInteger(answer))
    ? answer as OutingChoiceResultSession["answer"]
    : undefined;
  return {
    kind: "outing-choice-result",
    eventId: value.eventId as OutingChoiceResultSession["eventId"],
    channel: value.channel,
    startedAtTick: Number.isFinite(value.startedAtTick) ? Math.trunc(value.startedAtTick as number) : 0,
    prompt,
    ...(validAnswer !== undefined ? { answer: validAnswer } : {}),
    ...(typeof value.rngSeed === "number" && Number.isFinite(value.rngSeed)
      ? { rngSeed: Math.trunc(value.rngSeed) }
      : {}),
    resultEvents: value.resultEvents,
  };
}

function normalizeOutingChoicePrompt(value: unknown, warnings: string[] = []): OutingChoiceSession["prompt"] | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== "ask_yn" && kind !== "pick_one") { warnings.push("outing-choice prompt kind invalid"); return null; }
  const question = typeof value.question === "string" ? value.question : "";
  const rawOptions = value.options;
  if (!Array.isArray(rawOptions)) return null;
  const options: OutingChoiceSession["prompt"]["options"] = [];
  for (const opt of rawOptions) {
    if (!isRecord(opt)) continue;
    const id = opt.id;
    let validId: OutingChoiceValue | undefined;
    if (id === "decline" || id === "accept" || id === "rescue") validId = id;
    else if (typeof id === "number" && Number.isInteger(id)) validId = id;
    if (validId === undefined || typeof opt.label !== "string") continue;
    const option: OutingChoiceSession["prompt"]["options"][number] = { id: validId, label: opt.label };
    if (typeof opt.detail === "string") option.detail = opt.detail;
    if (opt.disabled === true) option.disabled = true;
    options.push(option);
  }
  if (options.length === 0) return null;
  const opening = normalizeOutingChoiceOpening(value.opening);
  return opening.length > 0 ? { kind, question, options, opening } : { kind, question, options };
}

function normalizeOutingChoiceOpening(value: unknown): OutingChoicePromptLine[] {
  if (!Array.isArray(value)) return [];
  const lines: OutingChoicePromptLine[] = [];
  for (const rawLine of value) {
    if (!isRecord(rawLine) || (rawLine.kind !== "narration" && rawLine.kind !== "dialogue") || typeof rawLine.text !== "string") continue;
    const text = rawLine.text.trim();
    if (text.length === 0) continue;
    const line: OutingChoicePromptLine = { kind: rawLine.kind, text };
    if (rawLine.kind === "dialogue" && typeof rawLine.speaker === "string" && rawLine.speaker.trim().length > 0) {
      line.speaker = rawLine.speaker.trim();
    }
    lines.push(line);
  }
  return lines;
}

function normalizeAcceptedEventRankings(value: unknown, warnings: string[] = []): AcceptedEventRanking[] {
  if (!Array.isArray(value)) return [];
  const channels = ["daily", "outing-departure", "outing-return", "banquet", "story"] as const;
  const out: AcceptedEventRanking[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.setId !== "string" || typeof item.contextHash !== "string") { warnings.push("discarded invalid event ranking"); continue; }
    if (!channels.includes(item.channel as typeof channels[number])) { warnings.push("discarded invalid event ranking"); continue; }
    if (!Number.isFinite(item.dayIndex) || !Number.isFinite(item.acceptedAtTick) || !Array.isArray(item.candidateIds)) { warnings.push("discarded invalid event ranking"); continue; }
    const ids = item.candidateIds.filter((id): id is number => typeof id === "number" && Number.isInteger(id));
    if (ids.length !== item.candidateIds.length || new Set(ids).size !== ids.length) { warnings.push("discarded invalid event ranking"); continue; }
    out.push({
      setId: item.setId,
      contextHash: item.contextHash,
      channel: item.channel as AcceptedEventRanking["channel"],
      dayIndex: Math.trunc(item.dayIndex as number),
      candidateIds: ids,
      acceptedAtTick: Math.trunc(item.acceptedAtTick as number),
    });
  }
  return out;
}

function normalizeMoriyaOmikujiBox(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<number>();
  const box: number[] = [];
  for (const raw of value) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 299 || seen.has(raw)) continue;
    seen.add(raw);
    box.push(raw);
  }
  return box;
}

function normalizeBanquetProgram(value: unknown, warnings: string[]): BanquetProgram | undefined {
  if (!isRecord(value)) return undefined;
  const kinds = ["arrival", "toast", "social", "performance", "incident", "feature", "closing"] as const;
  const statuses = ["pending", "completed", "skipped"] as const;
  const outcomes = ["warmth", "applause", "tension", "recovery", "none"] as const;
  const beats: BanquetBeat[] = [];
  if (Array.isArray(value.beats)) {
    for (const rawBeat of value.beats) {
      if (!isRecord(rawBeat) || typeof rawBeat.id !== "string" || typeof rawBeat.title !== "string" || !kinds.includes(rawBeat.kind as typeof kinds[number]) || !statuses.includes(rawBeat.status as typeof statuses[number])) continue;
      const beat: BanquetBeat = {
        id: rawBeat.id,
        kind: rawBeat.kind as BanquetBeat["kind"],
        title: rawBeat.title,
        offsetMinutes: Math.trunc(finiteNumber(rawBeat.offsetMinutes, 0)),
        participants: Array.isArray(rawBeat.participants) ? rawBeat.participants.filter((id): id is number => typeof id === "number" && Number.isInteger(id)) : [],
        status: rawBeat.status as BanquetBeat["status"],
      };
      if (outcomes.includes(rawBeat.outcome as typeof outcomes[number])) beat.outcome = rawBeat.outcome as BanquetBeat["outcome"];
      beats.push(beat);
    }
  }
  if (beats.length === 0) {
    warnings.push("discarded invalid banquet program; runtime will rebuild a deterministic fallback");
    return undefined;
  }
  const activeDurationMinutes = Math.max(1, Math.trunc(finiteNumber(value.activeDurationMinutes, 1)));
  return {
    version: 1,
    activeDurationMinutes,
    beats,
    cursor: Math.max(0, Math.min(beats.length, Math.trunc(finiteNumber(value.cursor, 0)))),
    momentum: Math.trunc(finiteNumber(value.momentum, 0)),
  };
}

function normalizeWorldEvents(value: unknown, warnings: string[]): WorldEventInstance[] {
  if (!Array.isArray(value)) return [];
  const phases = ["scheduled", "preparing", "active", "cleanup", "closing", "resolved", "cancelled"] as const;
  const nums = (v: unknown) => Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isInteger(n)) : [];
  const datePhases = ["seeking-player", "offered", "scheduled", "waiting", "started", "declined", "cancelled", "missed", "resolved"] as const;
  const out: WorldEventInstance[] = [];
  for (const item of value) {
    if (isRecord(item) && item.kind === "date-plan" && typeof item.id === "string" && Number.isInteger(item.partner) && datePhases.includes(item.phase as typeof datePhases[number])) {
      out.push({
        kind: "date-plan", id: item.id, partner: Math.trunc(item.partner as number),
        seed: Math.trunc(finiteNumber(item.seed, 0)), phase: item.phase as DatePlanEvent["phase"],
        createdAtTick: Math.trunc(finiteNumber(item.createdAtTick, 0)),
        scheduledStartTick: Number.isFinite(item.scheduledStartTick) ? Math.trunc(item.scheduledStartTick as number) : undefined,
        location: typeof item.location === "string" ? item.location : undefined,
        arrivalTick: Number.isFinite(item.arrivalTick) ? Math.trunc(item.arrivalTick as number) : undefined,
        waitUntilTick: Number.isFinite(item.waitUntilTick) ? Math.trunc(item.waitUntilTick as number) : undefined,
        resolvedAtTick: Number.isFinite(item.resolvedAtTick) ? Math.trunc(item.resolvedAtTick as number) : undefined,
        controller: item.controller === "partner" ? "partner" : item.controller === "player" ? "player" : undefined,
      });
      continue;
    }
    if (!isRecord(item) || item.kind !== "banquet" || typeof item.id !== "string" || typeof item.venue !== "string" || !Number.isFinite(item.templateId) || !phases.includes(item.phase as typeof phases[number])) {
      warnings.push("discarded invalid world event instance");
      continue;
    }
    const program = normalizeBanquetProgram(item.program, warnings);
    const originLocations = isRecord(item.originLocations)
      ? Object.fromEntries(Object.entries(item.originLocations).filter(([, location]) => typeof location === "string")) as Record<number, string>
      : undefined;
    out.push({
      kind: "banquet", id: item.id, templateId: Math.trunc(item.templateId as number),
      seed: Math.trunc(finiteNumber(item.seed, 0)), venue: item.venue,
      scheduledStartTick: Math.trunc(finiteNumber(item.scheduledStartTick, 0)),
      forcedEndTick: Math.trunc(finiteNumber(item.forcedEndTick, 0)),
      phase: item.phase as BanquetEventInstance["phase"], participants: nums(item.participants),
      hosts: nums(item.hosts), guests: nums(item.guests), excluded: nums(item.excluded),
      workRemaining: numberRecord(item.workRemaining), cleanupRemaining: numberRecord(item.cleanupRemaining),
      initialScale: Math.max(0, Math.trunc(finiteNumber(item.initialScale, 0))),
      finalScale: Math.max(0, Math.trunc(finiteNumber(item.finalScale, 0))),
      ...(program ? { program } : {}),
      ...(originLocations ? { originLocations } : {}),
      ...(isRecord(item.originRoomIds) ? { originRoomIds: numberRecord(item.originRoomIds) } : {}),
    });
  }
  return out;
}

function normalizeDateSession(value: unknown, state: GameState, sourceVersion: number, warnings: string[]): DateSession | null {
  // `traveling` / `returning` are retired phases (upstream `TFLAG:约会道中` road
  // stage is not modeled). Legacy saves that still carry them are normalized to
  // `active` so the date simply resumes at its destination.
  const phases = ["traveling", "active", "returning"] as const;
  if (isRecord(value) && Number.isInteger(value.partner) && state.charas[value.partner as number] && phases.includes(value.phase as typeof phases[number])) {
    if (value.phase !== "active") {
      warnings.push("normalized retired date phase (traveling/returning) to active");
    }
    return {
      partner: Math.trunc(value.partner as number),
      source: ["player-405", "local-992", "appointment", "legacy"].includes(String(value.source)) ? value.source as DateSession["source"] : "legacy",
      initialFavor: Math.trunc(finiteNumber(value.initialFavor, 0)),
      startedAtTick: Math.trunc(finiteNumber(value.startedAtTick, state.time.tickValue)),
      mapId: Math.max(0, Math.trunc(finiteNumber(value.mapId, 0))),
      forcedEndTick: Number.isFinite(value.forcedEndTick) ? Math.trunc(value.forcedEndTick as number) : undefined,
      phase: "active",
      destination: typeof value.destination === "string" ? value.destination : undefined,
      controller: value.controller === "partner" ? "partner" : "player",
      leaderId: Number.isInteger(value.leaderId) ? Math.trunc(value.leaderId as number) : undefined,
      eventId: boundedNonemptyString(value.eventId),
      autoAdvance: value.controller === "partner" && value.autoAdvance === true,
      itinerary: Array.isArray(value.itinerary) ? value.itinerary.slice(0, 8).flatMap((step, index) => {
        if (!isRecord(step) || typeof step.location !== "string" || typeof step.label !== "string") return [];
        const status = ["pending", "completed", "skipped"].includes(String(step.status)) ? step.status as "pending" | "completed" | "skipped" : "pending";
        return [{
          id: boundedNonemptyString(step.id) ?? `legacy-date-step:${index}`,
          location: step.location.slice(0, 256),
          label: step.label.slice(0, 120),
          travelMinutes: Math.max(1, Math.min(240, Math.trunc(finiteNumber(step.travelMinutes, 30)))),
          status,
        }];
      }) : undefined,
      itineraryCursor: Number.isFinite(value.itineraryCursor) ? Math.max(0, Math.trunc(value.itineraryCursor as number)) : undefined,
      executedActionIds: Array.isArray(value.executedActionIds)
        ? [...new Set(value.executedActionIds.filter((id): id is string => typeof id === "string" && id.length > 0).map((id) => id.slice(0, 256)))].slice(-32)
        : undefined,
    };
  }
  if (value != null) warnings.push("discarded invalid date session");
  if (sourceVersion >= 6) return null;
  const masterMap = state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0;
  const matches = Object.entries(state.charas).filter(([, slot]) => masterMap !== 0 && (slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) === masterMap);
  if (matches.length === 1) {
    const partner = Number(matches[0]![0]);
    return { partner, source: "legacy", initialFavor: state.charas[partner]!.state.CFLAG[CFLAG_ID.好感度] ?? 0, startedAtTick: state.time.tickValue, mapId: masterMap, phase: "active" };
  }
  if (masterMap !== 0 || Object.values(state.charas).some((slot) => (slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0)) {
    warnings.push("cleared isolated or conflicting legacy date flags");
  }
  return null;
}

function reprojectDateMirrors(state: GameState): void {
  const session = state.dateSession;
  const mapId = session?.mapId ?? 0;
  state.master.state.CFLAG[CFLAG_ID.约会中] = mapId;
  state.flagStore[FLAG_ID.デート相手] = session?.partner ?? 0;
  state.tflagStore ??= {};
  state.tflagStore[215] = session?.initialFavor ?? 0;
  // `TFLAG:约会道中` — the road stage is retired, so the upstream road marker
  // always reprojects to 0 (the party is never between two places).
  state.tflagStore[229] = 0;
  for (const [idText, slot] of Object.entries(state.charas)) {
    slot.state.CFLAG[CFLAG_ID.约会中] = Number(idText) === session?.partner ? mapId : 0;
  }
}

function reprojectBanquetMirrors(state: GameState): void {
  const venueRoomId = (venue: string): number => venue.includes("中央広場") ? 202 : venue.includes("小料理屋") ? 218 : venue.includes("走廊") ? 409 : venue.includes("庭") ? 11 : venue.includes("境内") ? 2 : venue.includes("本殿の裏") ? 20 : venue.includes("分社") ? 21 : venue.includes("居間") ? 9 : 0;
  const active = (state.worldEvents ?? []).find((event): event is BanquetEventInstance => event.kind === "banquet" && !["resolved", "cancelled"].includes(event.phase));
  if (active) {
    state.flagStore[30] = active.templateId;
    state.flagStore[31] = active.initialScale;
    state.flagStore[32] = venueRoomId(active.venue);
    state.flagStore[33] = active.scheduledStartTick % 1440;
    state.flagStore[34] = Math.floor(active.scheduledStartTick / 1440);
    state.flagStore[35] = active.participants.length;
    state.flagStore[36] = 0;
    state.flagStore[38] = Math.floor(active.forcedEndTick / 1440);
    state.flagStore[39] = active.forcedEndTick % 1440;
  } else {
    for (const id of [30, 31, 32, 33, 34, 35, 36, 38, 39]) state.flagStore[id] = 0;
  }
  for (const instance of state.worldEvents ?? []) {
    if (instance.kind !== "banquet" || ["resolved", "cancelled"].includes(instance.phase)) continue;
    const preparationStart = instance.scheduledStartTick - Math.floor(instance.initialScale / 30) - 15;
    const prep = instance.phase === "preparing" || (instance.phase === "scheduled" && state.time.tickValue >= preparationStart);
    const cleanup = instance.phase === "cleanup" || instance.phase === "closing";
    // A scheduled event is an agenda entry, not a movement command. Only
    // re-project a legacy save once its preparation window has actually begun.
    const beforePreparation = instance.phase === "scheduled" && state.time.tickValue < preparationStart;
    const clearStaleProjection = (slot: CharaSlot, restoreAwakeLocation = true): void => {
      const job = slot.state.CFLAG[CFLAG_ID.职种] ?? 0;
      const workplace = slot.state.CFLAG[CFLAG_ID.职场] ?? 0;
      const action = slot.state.CFLAG[CFLAG_ID.行动] ?? 0;
      const hasBanquetProjection =
        job === JOB_ID.宴会準備 || job === JOB_ID.宴会参加 || job === JOB_ID.宴会片づけ ||
        (workplace === venueRoomId(instance.venue) && action === 5) ||
        (slot.state.CFLAG[CFLAG_ID.宴会参加] ?? 0) !== 0;
      if (!hasBanquetProjection) return;
      const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
      const originLocation = instance.originLocations?.[slot.charaNum];
      if (!sleeping && restoreAwakeLocation && originLocation !== undefined) {
        slot.location = originLocation;
      } else if (sleeping && slot.location === instance.venue && slot.homeLocation) {
        // Legacy saves created by the old implementation could have a sleeper
        // already teleported to the venue without an origin snapshot. Sleep
        // owns the home location, so repair that specific stale projection.
        slot.location = slot.homeLocation;
      }
      const originRoomId = instance.originRoomIds?.[slot.charaNum];
      if (!sleeping && restoreAwakeLocation && originRoomId !== undefined) {
        slot.state.CFLAG[CFLAG_ID.現在位置] = originRoomId;
      } else if (sleeping && slot.homeLocation) {
        const homeRoomId = slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
        if (homeRoomId > 0) slot.state.CFLAG[CFLAG_ID.現在位置] = homeRoomId;
      }
      slot.state.CFLAG[CFLAG_ID.宴会参加] = 0;
      slot.state.CFLAG[CFLAG_ID.职种] = 0;
      slot.state.CFLAG[CFLAG_ID.职场] = 0;
      slot.state.CFLAG[CFLAG_ID.行动] = 0;
      slot.state.BASE[BASE_ID.仕事量] = 0;
      slot.state.MAXBASE[BASE_ID.仕事量] = 0;
    };
    if (beforePreparation) {
      for (const id of instance.participants) {
        const slot = state.charas[id];
        if (slot) clearStaleProjection(slot);
      }
      continue;
    }
    for (const id of instance.participants) {
      const slot = state.charas[id];
      if (!slot) continue;
      const host = instance.hosts.includes(id);
      if (prep && !host) {
        clearStaleProjection(slot);
        continue;
      }
      if (cleanup && !host) {
        // Runtime cleanup clears the guest's job immediately but leaves the
        // room until the closing transition; preserve that visible timing on
        // migration while still repairing a sleeping guest at the venue.
        clearStaleProjection(slot, false);
        continue;
      }
      const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
      if (sleeping && !prep && !cleanup) clearStaleProjection(slot);
      slot.state.CFLAG[CFLAG_ID.宴会参加] = sleeping ? 0 : host ? 2 : 1;
      slot.state.CFLAG[CFLAG_ID.职种] = cleanup ? JOB_ID.宴会片づけ : prep ? JOB_ID.宴会準備 : JOB_ID.宴会参加;
      slot.state.CFLAG[CFLAG_ID.职场] = venueRoomId(instance.venue);
      slot.state.CFLAG[CFLAG_ID.行动] = 5;
      slot.state.BASE[BASE_ID.仕事量] = cleanup ? (instance.cleanupRemaining[id] ?? 0) : prep ? (instance.workRemaining[id] ?? 0) : (instance.workRemaining[id] ?? 0);
      slot.state.MAXBASE[BASE_ID.仕事量] = cleanup ? Math.max(...Object.values(instance.cleanupRemaining), 0) : Math.max(...Object.values(instance.workRemaining), 0);
      instance.originLocations ??= {};
      instance.originRoomIds ??= {};
      if (!(id in instance.originLocations)) instance.originLocations[id] = slot.location;
      if (!(id in instance.originRoomIds)) instance.originRoomIds[id] = slot.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
      if (sleeping) continue;
      slot.location = instance.venue;
      slot.state.CFLAG[CFLAG_ID.現在位置] = venueRoomId(instance.venue);
    }
  }
}

function normalizeFirstKissHistory(value: unknown): Record<number, FirstKissRecord> {
  if (!isRecord(value)) return {};
  const out: Record<number, FirstKissRecord> = {};
  for (const [rawCharaNum, rawRecord] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isFinite(charaNum) || !isRecord(rawRecord) || !isRecord(rawRecord.partner)) continue;
    if (
      typeof rawRecord.dayIndex !== "number" ||
      !Number.isFinite(rawRecord.dayIndex) ||
      typeof rawRecord.location !== "string" ||
      (rawRecord.situation !== "ordinary" && rawRecord.situation !== "penis")
    ) continue;
    let partner: FirstKissRecord["partner"] | undefined;
    if (
      rawRecord.partner.kind === "character" &&
      typeof rawRecord.partner.charaNum === "number" &&
      Number.isFinite(rawRecord.partner.charaNum)
    ) {
      partner = { kind: "character", charaNum: Math.trunc(rawRecord.partner.charaNum) };
    } else if (
      rawRecord.partner.kind === "anonymous" &&
      typeof rawRecord.partner.label === "string" &&
      rawRecord.partner.label.trim().length > 0
    ) {
      partner = { kind: "anonymous", label: rawRecord.partner.label };
    }
    if (!partner) continue;
    out[Math.trunc(charaNum)] = {
      dayIndex: Math.trunc(rawRecord.dayIndex),
      location: rawRecord.location,
      partner,
      situation: rawRecord.situation,
    };
  }
  return out;
}

function normalizeDayEventsEnabled(value: unknown, fallback: 0 | 1 | 2 = 1): 0 | 1 | 2 {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function normalizeFreeActions(value: unknown): Record<number, CharaFreeAction> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return {};
  const out: Record<number, CharaFreeAction> = {};
  for (const [rawCharaNum, rawAction] of Object.entries(value)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isInteger(charaNum) || charaNum <= 0 || !isRecord(rawAction)) continue;
    const type = Math.trunc(finiteNumber(rawAction.type, NaN));
    const remainingMinutes = finiteNumber(rawAction.remainingMinutes, NaN);
    if (!Number.isInteger(type) || type < 0 || type > 19 || !Number.isFinite(remainingMinutes)) continue;
    out[charaNum] = { type, remainingMinutes: Math.max(0, remainingMinutes) };
  }
  return out;
}

function normalizeFreeActionMeta(value: unknown): FreeActionMetaState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return {};
  const out: FreeActionMetaState = {};
  if (isRecord(value.sermon)) {
    const preacher = Math.trunc(finiteNumber(value.sermon.preacher, NaN));
    if (Number.isInteger(preacher) && preacher > 0 && typeof value.sermon.location === "string") {
      out.sermon = { preacher, location: value.sermon.location };
    }
  }
  if (isRecord(value.pitfall)) {
    const dayIndex = Math.trunc(finiteNumber(value.pitfall.dayIndex, NaN));
    const initiator = Math.trunc(finiteNumber(value.pitfall.initiator, NaN));
    if (
      Number.isInteger(dayIndex) &&
      Number.isInteger(initiator) && initiator > 0 &&
      typeof value.pitfall.location === "string"
    ) {
      const records: Record<number, 1 | 2> = {};
      if (isRecord(value.pitfall.records)) {
        for (const [rawCharaNum, rawRecord] of Object.entries(value.pitfall.records)) {
          const charaNum = Number(rawCharaNum);
          if (Number.isInteger(charaNum) && (rawRecord === 1 || rawRecord === 2)) {
            records[charaNum] = rawRecord;
          }
        }
      }
      const victim = Math.trunc(finiteNumber(value.pitfall.victim, 0));
      const rank = Math.trunc(finiteNumber(value.pitfall.rank, 0));
      const avoidedAtTick = Math.trunc(finiteNumber(value.pitfall.avoidedAtTick, NaN));
      const fallenAtTick = Math.trunc(finiteNumber(value.pitfall.fallenAtTick, NaN));
      out.pitfall = {
        dayIndex,
        initiator,
        location: value.pitfall.location,
        ...(victim > 0 ? { victim } : {}),
        ...(rank > 0 ? { rank } : {}),
        ...(Number.isFinite(avoidedAtTick) ? { avoidedAtTick } : {}),
        ...(Number.isFinite(fallenAtTick) ? { fallenAtTick } : {}),
        ...(value.pitfall.masterFell === true ? { masterFell: true } : {}),
        records,
      };
    }
  }
  if (isRecord(value.snow)) {
    const dayIndex = Math.trunc(finiteNumber(value.snow.dayIndex, NaN));
    if (Number.isInteger(dayIndex) && isRecord(value.snow.objects)) {
      const objects: NonNullable<FreeActionMetaState["snow"]>["objects"] = {};
      for (const [location, rawObject] of Object.entries(value.snow.objects)) {
        if (!isRecord(rawObject)) continue;
        const creator = Math.trunc(finiteNumber(rawObject.creator, NaN));
        if (!Number.isInteger(creator) || creator <= 0) continue;
        const visibilityUnits = Math.trunc(finiteNumber(rawObject.visibilityUnits, NaN));
        objects[location] = {
          creator,
          ...(rawObject.completed === true ? { completed: true } : {}),
          ...(Number.isFinite(visibilityUnits) ? { visibilityUnits: Math.max(0, visibilityUnits) } : {}),
          ...(typeof rawObject.name === "string" && rawObject.name.trim() ? { name: rawObject.name } : {}),
          ...(typeof rawObject.suffix === "string" && rawObject.suffix.trim() ? { suffix: rawObject.suffix } : {}),
        };
      }
      out.snow = { dayIndex, objects };
    }
  }
  return out;
}

function normalizeCommissionState(value: unknown): CommissionState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return { slots: [], offers: {} };
  const slots: CommissionSlot[] = [];
  if (Array.isArray(value.slots)) {
    for (const rawSlot of value.slots) {
      if (!isRecord(rawSlot)) continue;
      const iraiId = Math.trunc(finiteNumber(rawSlot.iraiId, NaN));
      const clientId = Math.trunc(finiteNumber(rawSlot.clientId, NaN));
      const localId = Math.trunc(finiteNumber(rawSlot.localId, NaN));
      const deadlineDay = Math.trunc(finiteNumber(rawSlot.deadlineDay, NaN));
      const acceptedDay = Math.trunc(finiteNumber(rawSlot.acceptedDay, NaN));
      if (![iraiId, clientId, localId, deadlineDay, acceptedDay].every(Number.isFinite)) continue;
      if (clientId <= 0 || localId <= 0) continue;
      if (rawSlot.kind !== "common" && rawSlot.kind !== "unique") continue;
      if (!["work", "procure", "deliver_person", "deliver_place"].includes(String(rawSlot.task))) continue;
      const slot: CommissionSlot = {
        iraiId,
        clientId,
        localId,
        kind: rawSlot.kind,
        task: rawSlot.task as CommissionSlot["task"],
        deadlineDay: Math.max(0, deadlineDay),
        acceptedDay,
      };
      if (typeof rawSlot.targetCharaNum === "number" && Number.isFinite(rawSlot.targetCharaNum)) {
        slot.targetCharaNum = Math.trunc(rawSlot.targetCharaNum);
      }
      if (typeof rawSlot.targetLocation === "string") slot.targetLocation = rawSlot.targetLocation;
      if (typeof rawSlot.sub === "number" && Number.isFinite(rawSlot.sub)) slot.sub = Math.trunc(rawSlot.sub);
      if (["hidden", "person", "map", "place"].includes(String(rawSlot.searchReveal))) {
        slot.searchReveal = rawSlot.searchReveal as CommissionSearchReveal;
      }
      if (typeof rawSlot.revealedLocation === "string" && rawSlot.revealedLocation.length > 0) {
        slot.revealedLocation = rawSlot.revealedLocation;
      }
      if (typeof rawSlot.itemId === "number" && Number.isFinite(rawSlot.itemId)) slot.itemId = Math.trunc(rawSlot.itemId);
      if (typeof rawSlot.itemQty === "number" && Number.isFinite(rawSlot.itemQty)) slot.itemQty = Math.max(0, Math.trunc(rawSlot.itemQty));
      slots.push(slot);
    }
  }
  const lastMorningDay = typeof value.lastMorningDay === "number" && Number.isFinite(value.lastMorningDay)
    ? Math.trunc(value.lastMorningDay)
    : undefined;
  const offers: Record<number, CommissionOffer> = {};
  if (isRecord(value.offers)) {
    for (const [rawClientId, rawOffer] of Object.entries(value.offers)) {
      const clientId = Math.trunc(Number(rawClientId));
      if (!Number.isInteger(clientId) || clientId <= 0 || !isRecord(rawOffer)) continue;
      const offer: CommissionOffer = {};
      if (typeof rawOffer.targetCharaNum === "number" && Number.isFinite(rawOffer.targetCharaNum)) {
        offer.targetCharaNum = Math.trunc(rawOffer.targetCharaNum);
      }
      if (typeof rawOffer.targetLocation === "string" && rawOffer.targetLocation.length > 0) {
        offer.targetLocation = rawOffer.targetLocation;
      }
      if (typeof rawOffer.sub === "number" && Number.isFinite(rawOffer.sub)) offer.sub = Math.trunc(rawOffer.sub);
      if (["hidden", "person", "map", "place"].includes(String(rawOffer.searchReveal))) {
        offer.searchReveal = rawOffer.searchReveal as CommissionSearchReveal;
      }
      if (typeof rawOffer.revealedLocation === "string" && rawOffer.revealedLocation.length > 0) {
        offer.revealedLocation = rawOffer.revealedLocation;
      }
      offers[clientId] = offer;
    }
  }
  return { slots, offers, lastMorningDay };
}

function normalizeInsectForagingContract(value: unknown): GameState["insectForaging"] {
  if (!isRecord(value)) return undefined;
  const region = Math.trunc(finiteNumber(value.region, NaN));
  const fee = Math.trunc(finiteNumber(value.fee, NaN));
  const startedDay = Math.trunc(finiteNumber(value.startedDay, NaN));
  const expiresDay = Math.trunc(finiteNumber(value.expiresDay, 0));
  const nextCollectionDay = Math.trunc(finiteNumber(value.nextCollectionDay, NaN));
  if (![region, fee, startedDay, nextCollectionDay].every(Number.isFinite)) return undefined;
  if (region < 0 || region > 10 || region === 2) return undefined;
  const contract: NonNullable<GameState["insectForaging"]> = {
    region,
    fee: Math.max(0, fee),
    startedDay,
    expiresDay: Math.max(0, expiresDay),
    nextCollectionDay,
  };
  if (isRecord(value.lastCollection)) {
    const day = Math.trunc(finiteNumber(value.lastCollection.day, NaN));
    const quantity = Math.max(0, Math.trunc(finiteNumber(value.lastCollection.quantity, NaN)));
    if (Number.isFinite(day) && Number.isFinite(quantity)) {
      const itemId = Math.trunc(finiteNumber(value.lastCollection.itemId, NaN));
      contract.lastCollection = {
        day,
        quantity,
        failed: value.lastCollection.failed === true,
        ...(Number.isFinite(itemId) ? { itemId } : {}),
      };
    }
  }
  return contract;
}

/**
 * Repair only legacy equipment ids that cannot be valid clothing slots.
 *
 * TEQUIP ids 11–20 overlap real clothing slot numbers and are intentionally
 * left untouched: a value in `EQUIP[11]`, for example, may be a legitimate
 * pair of trousers or a stale toy write, and guessing would destroy clothing.
 * The ids below are outside the current EQUIP slot range (1–22), so a
 * non-zero value there is an unambiguous write from the old bug.
 */
const UNAMBIGUOUS_LEGACY_TEQUIP_IDS = [
  TEQUIP_ID.拘束,
  TEQUIP_ID.野外PLAY,
  TEQUIP_ID.羞耻PLAY,
  TEQUIP_ID.浴室PLAY,
  TEQUIP_ID.新妻PLAY,
  TEQUIP_ID.圍裙,
  TEQUIP_ID.避孕套,
  TEQUIP_ID.継続接吻,
] as const;

function repairLegacyTequipWrites(
  slot: CharaSlot,
  sourceVersion: number,
  warnings: string[],
): void {
  if (sourceVersion >= 33) return;
  const moved: number[] = [];
  for (const id of UNAMBIGUOUS_LEGACY_TEQUIP_IDS) {
    const legacy = slot.state.EQUIP[id];
    if (typeof legacy !== "number" || !Number.isFinite(legacy) || legacy === 0) continue;
    if (slot.state.TEQUIP[id] === undefined) slot.state.TEQUIP[id] = legacy;
    delete slot.state.EQUIP[id];
    moved.push(id);
  }
  if (moved.length > 0) {
    warnings.push(`migrated legacy TEQUIP writes for chara ${slot.charaNum}: ${moved.join(",")}`);
  }
}

function normalizeActiveEventContext(value: unknown, state: GameState): GameState["activeEventContext"] {
  if (!isRecord(value) || value.version !== 1) return null;
  const eventId = boundedNonemptyString(value.eventId);
  const beatId = boundedNonemptyString(value.beatId);
  const objective = boundedNonemptyString(value.objective, 600);
  const actorRole = boundedNonemptyString(value.actorRole, 120);
  if (!eventId || !beatId || !objective || !actorRole) return null;
  const strings = (input: unknown, limit: number) => Array.isArray(input)
    ? [...new Set(input.filter((entry): entry is string => typeof entry === "string" && entry.length > 0).map((entry) => entry.slice(0, 256)))].slice(0, limit)
    : [];
  const participantIds = Array.isArray(value.participantIds)
    ? [...new Set(value.participantIds.filter((id): id is number => Number.isInteger(id) && (id === 0 || Boolean(state.charas[id]))))].slice(0, 4)
    : [];
  if (participantIds.length === 0) return null;
  return {
    version: 1,
    eventId,
    arcId: boundedNonemptyString(value.arcId),
    beatId,
    participantIds,
    objective,
    actorRole,
    visibleFactIds: strings(value.visibleFactIds, 32),
    revealableFactIds: strings(value.revealableFactIds, 32),
    forbiddenClaims: strings(value.forbiddenClaims, 24),
    allowedIntentIds: strings(value.allowedIntentIds, 16),
    completionFactIds: strings(value.completionFactIds, 16),
    openedAtTick: Math.trunc(finiteNumber(value.openedAtTick, state.time.tickValue)),
    expiresAtTick: Math.trunc(finiteNumber(value.expiresAtTick, state.time.tickValue)),
  };
}

function normalizeScheduledWeatherIncidents(value: unknown): NonNullable<GameState["scheduledWeatherIncidents"]> {
  if (!Array.isArray(value)) return [];
  const statuses = ["scheduled", "active", "completed", "cancelled"] as const;
  return value.slice(-32).flatMap((entry) => {
    if (!isRecord(entry) || entry.version !== 1 || !statuses.includes(entry.status as typeof statuses[number])) return [];
    const id = boundedNonemptyString(entry.id);
    const optionId = boundedNonemptyString(entry.optionId);
    const label = boundedNonemptyString(entry.label, 120);
    const idempotencyKey = boundedNonemptyString(entry.idempotencyKey);
    const startTick = Math.trunc(finiteNumber(entry.startTick, -1));
    const endTick = Math.trunc(finiteNumber(entry.endTick, -1));
    const weatherId = Math.trunc(finiteNumber(entry.weatherId, -1));
    const windId = Math.trunc(finiteNumber(entry.windId, -1));
    if (!id || !optionId || !label || !idempotencyKey || startTick < 0 || endTick <= startTick || weatherId < 0 || windId < 0) return [];
    return [{
      version: 1 as const, id, optionId, label, startTick, endTick, weatherId, windId,
      status: entry.status as typeof statuses[number],
      sourceEventId: boundedNonemptyString(entry.sourceEventId),
      idempotencyKey,
    }];
  });
}

function normalizeStoryProgram(value: unknown): StoryProgram | undefined {
  const copy = structuredClone(value);
  if (isRecord(copy) && copy.version === 2) normalizeParkedStoryProgram(copy as unknown as StoryProgramV2);
  return isStoryProgram(copy) ? copy : undefined;
}

const H_INSERTION_TEQUIP_IDS = [TEQUIP_ID.Ｖ性交, TEQUIP_ID.Ａ性交] as const;
const H_INSERTION_TCVAR_IDS = [TCVAR_ID.V挿入管理, TCVAR_ID.A挿入管理] as const;

/**
 * A save without a resumable TrainingSession cannot safely continue an
 * insertion pose. Do not let its sparse TEQUIP/TCVAR links turn the next
 * ordinary command into an invisible H continuation.
 */
function clearUnresumableHInsertionLinks(state: GameState, warnings: string[]): void {
  let cleared = 0;
  const slots = [state.master, ...Object.values(state.charas)];
  for (const slot of slots) {
    for (const id of H_INSERTION_TEQUIP_IDS) {
      if (slot.state.TEQUIP[id] !== undefined) {
        delete slot.state.TEQUIP[id];
        cleared += 1;
      }
    }
    for (const id of H_INSERTION_TCVAR_IDS) {
      if (slot.state.TCVAR[id] !== undefined && slot.state.TCVAR[id] !== -1) {
        slot.state.TCVAR[id] = -1;
        cleared += 1;
      }
    }
  }
  if (cleared > 0) warnings.push(`cleared ${cleared} unresumable H insertion links`);
}

function nestedNumberRecord(value: unknown): Record<number, Record<number, number>> {
  if (!isRecord(value)) return {};
  const out: Record<number, Record<number, number>> = {};
  for (const [rawId, rawSlots] of Object.entries(value)) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    out[id] = numberRecord(rawSlots);
  }
  return out;
}

function normalizeChildren(value: unknown, charas: Readonly<Record<number, CharaSlot>>): Record<number, ChildRecord[]> {
  if (!isRecord(value)) return {};
  const out: Record<number, ChildRecord[]> = {};
  for (const [rawMother, rawChildren] of Object.entries(value)) {
    const mother = Number(rawMother);
    if (!Number.isSafeInteger(mother) || mother < 0 || !Array.isArray(rawChildren) || (mother !== 0 && !charas[mother])) continue;
    const seen = new Set<number>();
    const children: ChildRecord[] = [];
    for (const raw of rawChildren) {
      if (!isRecord(raw)) continue;
      const id = Math.trunc(finiteNumber(raw.id, 0));
      const father = Math.trunc(finiteNumber(raw.father, -1));
      const sex = Math.trunc(finiteNumber(raw.sex, 0));
      const birthdayDay = Math.trunc(finiteNumber(raw.birthdayDay, -1));
      if (id <= 0 || seen.has(id) || father < 0 || (father !== 0 && !charas[father]) || (sex !== 1 && sex !== 2) || birthdayDay < 0 || typeof raw.name !== "string" || raw.name.length === 0) continue;
      seen.add(id);
      children.push({ id, mother, father, sex, name: raw.name, birthdayDay, love: Math.trunc(finiteNumber(raw.love, 0)), independent: raw.independent === true });
    }
    if (children.length > 0) out[mother] = children.sort((a, b) => a.id - b.id);
  }
  return out;
}

function normalizeWorkRuntime(value: unknown, dayIndex: number): WorkRuntimeState | undefined {
  if (!isRecord(value) || !Array.isArray(value.entries)) return undefined;
  const runtimeDay = Math.trunc(finiteNumber(value.dayIndex, NaN));
  if (!Number.isFinite(runtimeDay) || runtimeDay !== Math.trunc(dayIndex)) return undefined;
  const entries: WorkRuntimeEntry[] = [];
  for (const rawEntry of value.entries) {
    if (!isRecord(rawEntry) || typeof rawEntry.entryKey !== "string" ||
        typeof rawEntry.location !== "string" ||
        !["ready", "active", "completed"].includes(String(rawEntry.status))) continue;
    const numbers = ["charaNum", "jobType", "startMin", "endMin", "workRoomId", "workload", "wage", "noHelp", "giftId"] as const;
    if (!numbers.every((key) => typeof rawEntry[key] === "number" && Number.isFinite(rawEntry[key]))) continue;
    const noHelp = Math.trunc(rawEntry.noHelp as number);
    if (noHelp < 0 || noHelp > 2) continue;
    entries.push({
      entryKey: rawEntry.entryKey,
      charaNum: Math.trunc(rawEntry.charaNum as number),
      jobType: Math.trunc(rawEntry.jobType as number),
      startMin: Math.trunc(rawEntry.startMin as number),
      endMin: Math.trunc(rawEntry.endMin as number),
      workRoomId: Math.trunc(rawEntry.workRoomId as number),
      location: rawEntry.location,
      workload: Math.max(0, Math.trunc(rawEntry.workload as number)),
      wage: Math.trunc(rawEntry.wage as number),
      noHelp: noHelp as 0 | 1 | 2,
      giftId: Math.max(0, Math.trunc(rawEntry.giftId as number)),
      status: rawEntry.status as WorkRuntimeEntry["status"],
    });
  }
  return { dayIndex: runtimeDay, entries };
}

function normalizeBattleInput(value: unknown): BattleInput | null {
  if (!isRecord(value)) return null;
  if (!["up", "down", "left", "right", "focus"].every((key) => typeof value[key] === "boolean")) return null;
  return { up: value.up as boolean, down: value.down as boolean, left: value.left as boolean, right: value.right as boolean, focus: value.focus as boolean };
}

function normalizeDanmakuBattle(value: unknown): DanmakuBattleSession | null {
  if (!isRecord(value) || !isRecord(value.config)) return null;
  const config = value.config;
  if ((value.commandNo !== 411 && value.commandNo !== 480) || (config.mode !== "training" && config.mode !== "duel")) return null;
  if (!["training", "aunn", "suika"].includes(String(config.pattern)) || typeof config.targetName !== "string") return null;
  const target = Math.trunc(finiteNumber(config.target, NaN));
  const seed = Math.trunc(finiteNumber(config.seed, NaN));
  const startedAtTick = Math.trunc(finiteNumber(value.startedAtTick, NaN));
  if (![target, seed, startedAtTick].every(Number.isFinite)) return null;
  const inputFrames = Array.isArray(value.inputFrames) ? value.inputFrames.map(normalizeBattleInput).filter((input): input is BattleInput => input !== null) : [];
  const kojoLines = Array.isArray(value.kojoLines)
    ? value.kojoLines
        .filter((line): line is Record<string, unknown> => isRecord(line) && typeof line.text === "string")
        .map((line) => ({ text: line.text as string }))
        .filter((line) => line.text.trim().length > 0)
    : [];
  return { id: typeof value.id === "string" ? value.id : `battle-${seed}`, commandNo: value.commandNo, config: { mode: config.mode, target, targetName: config.targetName, pattern: config.pattern as DanmakuBattleSession["config"]["pattern"], seed }, startedAtTick, inputFrames, ...(kojoLines.length > 0 ? { kojoLines } : {}) };
}

function normalizeFishingGear(value: unknown, legacyRod: boolean): FishingGearState {
  const fallback = defaultFishingGear(legacyRod);
  if (!isRecord(value)) return fallback;
  const rodIds = new Set(FISHING_RODS.map((entry) => entry.id));
  const lineIds = new Set(FISHING_LINES.map((entry) => entry.id));
  const ownedRods: FishingGearState["ownedRods"] = {};
  const lineSpools: FishingGearState["lineSpools"] = {};
  if (isRecord(value.ownedRods)) for (const [id, owned] of Object.entries(value.ownedRods)) if (rodIds.has(id as FishingRodId) && owned) ownedRods[id as FishingRodId] = true;
  if (isRecord(value.lineSpools)) for (const [id, amount] of Object.entries(value.lineSpools)) if (lineIds.has(id as FishingLineId) && typeof amount === "number" && Number.isFinite(amount)) lineSpools[id as FishingLineId] = Math.max(0, Math.floor(amount));
  if (legacyRod && !ownedRods.bamboo) ownedRods.bamboo = true;
  if (legacyRod && Object.keys(lineSpools).length === 0) lineSpools.cotton = 100;
  const equippedRod = rodIds.has(value.equippedRod as FishingRodId) && ownedRods[value.equippedRod as FishingRodId] ? value.equippedRod as FishingRodId : "bamboo";
  const equippedLine = lineIds.has(value.equippedLine as FishingLineId) ? value.equippedLine as FishingLineId : "cotton";
  return {
    ownedRods,
    lineSpools,
    equippedRod,
    equippedLine,
    catches: Math.max(0, Math.floor(finiteNumber(value.catches, 0))),
    catchCounts: numberRecord(value.catchCounts),
    bestSizes: numberRecord(value.bestSizes),
  };
}

function normalizeFishingGame(value: unknown): FishingGameSession | null {
  if (!isRecord(value) || !isRecord(value.catch)) return null;
  const rod = FISHING_RODS.find((entry) => entry.id === value.rodId);
  const line = FISHING_LINES.find((entry) => entry.id === value.lineId);
  if (!rod || !line || typeof value.id !== "string" || typeof value.spotName !== "string" || typeof value.catch.name !== "string") return null;
  const numeric = ["seed", "spotId", "partner", "startedAtTick", "rodControl", "lineTension", "lineDurability", "biteDelayMs", "hookWindowMs", "difficulty"] as const;
  if (numeric.some((key) => !Number.isFinite(value[key]))) return null;
  const rawCatch = value.catch;
  const catchResult: FishingGameSession["catch"] = {
    itemId: Math.trunc(finiteNumber(rawCatch.itemId, 707)),
    name: rawCatch.name as string,
    isLegendary: rawCatch.isLegendary === true,
    rank: Math.max(0, Math.trunc(finiteNumber(rawCatch.rank, 20))),
  };
  if (typeof rawCatch.sizeCm === "number" && Number.isFinite(rawCatch.sizeCm)) catchResult.sizeCm = rawCatch.sizeCm;
  if (isRecord(rawCatch.fish) && typeof rawCatch.fish.name === "string") catchResult.fish = rawCatch.fish as unknown as NonNullable<FishingGameSession["catch"]["fish"]>;
    return {
      id: value.id, seed: Math.trunc(value.seed as number), spotId: Math.trunc(value.spotId as number), spotName: value.spotName as string,
      partner: Math.trunc(value.partner as number), startedAtTick: Math.trunc(value.startedAtTick as number), rodId: rod.id, lineId: line.id,
      rodControl: value.rodControl as number, lineTension: value.lineTension as number, lineDurability: value.lineDurability as number,
      catch: catchResult, biteDelayMs: value.biteDelayMs as number, hookWindowMs: value.hookWindowMs as number, difficulty: value.difficulty as number,
      fishDensity: Math.max(12, Math.min(38, Math.round(finiteNumber(value.fishDensity, 20)))),
      kojoLines: Array.isArray(value.kojoLines)
        ? value.kojoLines.flatMap((line) => {
            if (!isRecord(line) || !Number.isFinite(line.charaNum) || typeof line.text !== "string" || line.text.trim().length === 0) return [];
            return [{
              charaNum: Math.trunc(line.charaNum as number),
              text: line.text,
              ...(typeof line.form === "string" ? { form: line.form } : {}),
            }];
          })
        : undefined,
    };
  }

function normalizeStoneProgress(value: unknown, charas: Readonly<Record<number, CharaSlot>>): StoneContestProgress {
  const fallback = defaultStoneContestProgress();
  if (!isRecord(value)) return fallback;
  const themeRecords: StoneContestProgress["themeRecords"] = {};
  if (isRecord(value.themeRecords)) {
    for (const [rawTheme, rawRecord] of Object.entries(value.themeRecords)) {
      const theme = Number(rawTheme);
      if (!Number.isInteger(theme) || theme < 1 || theme > 30 || !isRecord(rawRecord)) continue;
      const partnerBest = numberRecord(rawRecord.partnerBest);
      themeRecords[theme] = {
        bestScore: Math.max(0, Math.min(100, Math.trunc(finiteNumber(rawRecord.bestScore, 0)))),
        bestPartner: Math.max(0, Math.trunc(finiteNumber(rawRecord.bestPartner, 0))),
        partnerBest,
        trophy: rawRecord.trophy === true,
      };
    }
  }
  const tutorialRead: Record<string, true> = {};
  if (isRecord(value.tutorialRead)) for (const [key, read] of Object.entries(value.tutorialRead)) if (read === true) tutorialRead[key] = true;
  const clerkId = Number.isInteger(value.clerkCharaNum) && charas[Math.trunc(value.clerkCharaNum as number)]
    ? Math.trunc(value.clerkCharaNum as number)
    : undefined;
  return {
    visitDays: Math.max(0, Math.trunc(finiteNumber(value.visitDays, 0))),
    lastVisitDay: Math.trunc(finiteNumber(value.lastVisitDay, -1)),
    soloMatches: Math.max(0, Math.trunc(finiteNumber(value.soloMatches, 0))),
    soloWins: Math.max(0, Math.trunc(finiteNumber(value.soloWins, 0))),
    soloChampionships: Math.max(0, Math.trunc(finiteNumber(value.soloChampionships, 0))),
    coupleMatches: Math.max(0, Math.trunc(finiteNumber(value.coupleMatches, 0))),
    coupleWins: Math.max(0, Math.trunc(finiteNumber(value.coupleWins, 0))),
    rank: Math.max(0, Math.min(6, Math.trunc(finiteNumber(value.rank, 0)))),
    tutorialRead,
    itemLevel: Math.max(1, Math.min(4, Math.trunc(finiteNumber(value.itemLevel, 1)))),
    themeRecords,
    trophyCount: Object.values(themeRecords).filter((record) => record.trophy).length,
    allClearRewardClaimed: value.allClearRewardClaimed === true,
    ...(clerkId !== undefined ? { clerkCharaNum: clerkId } : {}),
    clerkName: typeof value.clerkName === "string" && value.clerkName.trim() ? value.clerkName.slice(0, 24) : fallback.clerkName,
    clerkStoryStage: Math.max(0, Math.min(9, Math.trunc(finiteNumber(value.clerkStoryStage, 0)))),
    namingStatus: value.namingStatus === "pending" || value.namingStatus === "named" ? value.namingStatus : "default",
    settledSessionIds: Array.isArray(value.settledSessionIds) ? value.settledSessionIds.filter((id): id is string => typeof id === "string").slice(-24) : [],
    history: Array.isArray(value.history) ? value.history.filter((line): line is string => typeof line === "string").slice(-500) : [],
  };
}

function normalizeStoneCoupleScore(value: unknown): StoneContestCoupleScore | undefined {
  if (!isRecord(value)) return undefined;
  const awards = ["champion-perfect", "champion", "runner-up", "third", "none"] as const;
  if (![value.technique, value.cooperation, value.theme, value.total].every((entry) => typeof entry === "number" && Number.isFinite(entry))) return undefined;
  if (!awards.includes(value.award as typeof awards[number])) return undefined;
  return {
    technique: Math.trunc(value.technique as number),
    cooperation: Math.trunc(value.cooperation as number),
    theme: Math.trunc(value.theme as number),
    total: Math.max(0, Math.min(100, Math.trunc(value.total as number))),
    award: value.award as StoneContestCoupleScore["award"],
  };
}

function normalizeStonePending(value: unknown): StoneContestPendingSettlement | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const outcomes = ["champion", "defeat", "withdraw", "forfeit", "couple"] as const;
  const payers = ["free", "player", "clerk", "partner"] as const;
  if (!outcomes.includes(value.outcome as typeof outcomes[number]) || !payers.includes(value.payer as typeof payers[number])) return undefined;
  if (![value.fee, value.prize].every((entry) => typeof entry === "number" && Number.isFinite(entry)) || (value.timeMinutes !== 50 && value.timeMinutes !== 60)) return undefined;
  const coupleScore = normalizeStoneCoupleScore(value.coupleScore);
  return {
    id: value.id,
    outcome: value.outcome as StoneContestPendingSettlement["outcome"],
    fee: Math.max(0, Math.trunc(value.fee as number)),
    payer: value.payer as StoneContestPendingSettlement["payer"],
    prize: Math.max(0, Math.trunc(value.prize as number)),
    timeMinutes: value.timeMinutes,
    ...(coupleScore ? { coupleScore } : {}),
  };
}

function normalizeStoneSession(value: unknown, state: Readonly<GameState>, warnings: string[]): StoneContestSession | null {
  if (!isRecord(value)) return null;
  const modes = ["lobby", "solo", "couple"] as const;
  const phases = ["lobby", "round", "between-rounds", "settlement"] as const;
  const strategies = ["quick", "normal", "careful", "wait"] as const;
  const items = ["small-hat", "strength-jizo", "carefree", "honest-sign", "none"] as const;
  const payers = ["free", "player", "clerk", "partner"] as const;
  if (typeof value.id !== "string" || !modes.includes(value.mode as typeof modes[number]) || !phases.includes(value.phase as typeof phases[number])) return null;
  if (!strategies.includes(value.strategy as typeof strategies[number]) || !items.includes(value.item as typeof items[number]) || !payers.includes(value.payer as typeof payers[number])) return null;
  const numericKeys = ["seed", "startedAtTick", "opponent", "partner", "rank", "round", "maxRounds", "prize", "theme"] as const;
  if (numericKeys.some((key) => !Number.isFinite(value[key]))) return null;
  const mode = value.mode as StoneContestSession["mode"];
  const phase = value.phase as StoneContestSession["phase"];
  const partner = Math.trunc(value.partner as number);
  const rank = Math.trunc(value.rank as number);
  const round = Math.trunc(value.round as number);
  const maxRounds = Math.trunc(value.maxRounds as number);
  const theme = Math.trunc(value.theme as number);
  if ((mode === "lobby") !== (phase === "lobby")) return null;
  if (mode === "couple" && (partner <= 0 || !state.charas[partner])) return null;
  if (rank < 0 || rank > 4 || round < 0 || round > maxRounds || maxRounds < 0 || maxRounds > 5 || theme < 1 || theme > 30) return null;
  const operations: StonePlacementOperation[] = Array.isArray(value.operations)
    ? value.operations.flatMap((operation) => {
        if (!isRecord(operation) || operation.kind !== "place" || (operation.actor !== "player" && operation.actor !== "partner")) return [];
        if (![operation.frame, operation.xQ, operation.rotationQ, operation.sizeQ, operation.motifQ].every((entry) => typeof entry === "number" && Number.isFinite(entry))) return [];
        return [normalizeStoneOperation(operation as unknown as StonePlacementOperation)];
      }).slice(0, 512)
    : [];
  const pendingSettlement = normalizeStonePending(value.pendingSettlement);
  if (phase === "settlement" && !pendingSettlement) return null;
  if (phase !== "settlement" && pendingSettlement) return null;
  const session: StoneContestSession = {
    id: value.id,
    mode,
    phase,
    seed: Math.trunc(value.seed as number),
    startedAtTick: Math.trunc(value.startedAtTick as number),
    opponent: Math.max(0, Math.trunc(value.opponent as number)),
    partner,
    rank,
    round,
    maxRounds,
    prize: Math.max(0, Math.trunc(value.prize as number)),
    theme,
    strategy: value.strategy as StoneContestSession["strategy"],
    item: value.item as StoneContestSession["item"],
    elapsedFrames: Math.max(0, Math.min(
      STONE_CONTEST_DURATION_FRAMES,
      Math.trunc(finiteNumber(value.elapsedFrames, operations.reduce((max, operation) => Math.max(max, operation.frame), 0))),
    )),
    bout: Math.max(0, Math.trunc(finiteNumber(value.bout, 0))),
    operations,
    subtitles: Array.isArray(value.subtitles) ? value.subtitles.filter((line): line is string => typeof line === "string").slice(-500) : [],
    payer: value.payer as StoneContestSession["payer"],
    ...(pendingSettlement ? { pendingSettlement } : {}),
  };
  if (pendingSettlement && isRecord(value.pendingSettlement) && isRecord(value.pendingSettlement.roundResult)) {
    const rawRound = value.pendingSettlement.roundResult;
    const outcomes = ["win", "lose", "tie"] as const;
    if (
      Number.isFinite(rawRound.playerTotal) &&
      Number.isFinite(rawRound.opponentTotal) &&
      outcomes.includes(rawRound.outcome as typeof outcomes[number])
    ) {
      pendingSettlement.roundResult = {
        playerTotal: Math.max(0, Math.trunc(rawRound.playerTotal as number)),
        opponentTotal: Math.max(0, Math.trunc(rawRound.opponentTotal as number)),
        outcome: rawRound.outcome as "win" | "lose" | "tie",
        opponentCollapsed: rawRound.opponentCollapsed === true,
        replay: replayStoneOperations(operations, {
          seed: session.seed,
          difficulty: session.rank,
          untilFrame: STONE_CONTEST_DURATION_FRAMES,
          rescueCollapse: session.item === "small-hat",
        }),
      };
    }
  }
  if (value.lastRound != null) warnings.push("rebuilt stone-contest round preview from the authoritative operation stream");
  return session;
}

function normalizeAgentRelationshipSnapshot(value: unknown): import("../agent/types.js").AgentRelationshipEvidenceSnapshot | undefined {
  if (!isRecord(value) || !isRecord(value.traits)) return undefined;
  const stage = value.stage;
  const attitude = finiteNumber(value.attitude, -1);
  if (!(stage === "ordinary" || stage === "affection" || stage === "love" || stage === "lover")
    || ![0, 1, 2, 3].includes(attitude)) return undefined;
  return {
    tick: Math.max(0, Math.trunc(finiteNumber(value.tick, 0))),
    favor: Math.trunc(finiteNumber(value.favor, 0)),
    trust: Math.trunc(finiteNumber(value.trust, 0)),
    intimacy: Math.trunc(finiteNumber(value.intimacy, 0)),
    attitude: attitude as 0 | 1 | 2 | 3,
    stage,
    traits: {
      affection: value.traits.affection === true,
      love: value.traits.love === true,
      lover: value.traits.lover === true,
      desire: value.traits.desire === true,
      sexFriend: value.traits.sexFriend === true,
    },
  };
}

function normalizeAgentDailyLedger(value: unknown): import("../agent/types.js").AgentDailyLedgerV1 {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.days)) {
    return createAgentDailyLedger();
  }
  const days = value.days.filter(isRecord)
    .filter((day) => Number.isSafeInteger(day.dayIndex) && isRecord(day.characters))
    .sort((a, b) => Number(a.dayIndex) - Number(b.dayIndex))
    .slice(-MAX_LEDGER_DAYS)
    .map((day) => {
      const dayIndex = Number(day.dayIndex);
      const rawCharacters = isRecord(day.characters) ? day.characters : {};
      const characters: Record<number, import("../agent/types.js").AgentDailyCharacterRecord> = {};
      for (const [rawId, candidate] of Object.entries(rawCharacters)) {
        const charaNum = Number(rawId);
        if (!Number.isSafeInteger(charaNum) || charaNum <= 0 || !isRecord(candidate)) continue;
        const relationshipStart = normalizeAgentRelationshipSnapshot(candidate.relationshipStart);
        if (!relationshipStart || typeof candidate.initialLocation !== "string"
          || typeof candidate.lastKnownLocation !== "string") continue;
        const activities = Array.isArray(candidate.activities) ? candidate.activities
          .filter((entry): entry is UnknownRecord => isRecord(entry)
            && typeof entry.id === "string"
            && (entry.kind === "work" || entry.kind === "roam" || entry.kind === "player-command-dialogue")
            && Number.isSafeInteger(entry.startTick) && Number.isSafeInteger(entry.endTick)
            && Number(entry.endTick) >= Number(entry.startTick)
            && typeof entry.location === "string" && typeof entry.label === "string"
            && Array.isArray(entry.participants))
          .slice(0, MAX_DAILY_ACTIVITIES) as unknown as import("../agent/types.js").AgentDailyActivity[] : [];
        const visitedLocations = Array.isArray(candidate.visitedLocations) ? candidate.visitedLocations
          .filter((entry): entry is UnknownRecord => isRecord(entry) && typeof entry.id === "string"
            && typeof entry.location === "string" && Number.isSafeInteger(entry.arrivedAtTick)
            && (entry.leftAtTick === undefined || Number.isSafeInteger(entry.leftAtTick)))
          .slice(0, MAX_DAILY_LOCATIONS) as unknown as import("../agent/types.js").AgentDailyVisitedLocation[] : [];
        const encounters = Array.isArray(candidate.encounters) ? candidate.encounters
          .filter((entry): entry is UnknownRecord => isRecord(entry) && typeof entry.id === "string"
            && Number.isSafeInteger(entry.startTick) && Number.isSafeInteger(entry.endTick)
            && Number(entry.endTick) > Number(entry.startTick) && typeof entry.location === "string"
            && Array.isArray(entry.participants))
          .slice(0, MAX_DAILY_ENCOUNTERS) as unknown as import("../agent/types.js").AgentDailyEncounter[] : [];
        const relationshipEnd = normalizeAgentRelationshipSnapshot(candidate.relationshipEnd);
        const relationshipChanges = Array.isArray(candidate.relationshipChanges)
          ? candidate.relationshipChanges.filter((entry): boolean => isRecord(entry)
            && typeof entry.field === "string" && "before" in entry && "after" in entry)
            .slice(0, 10) as import("../agent/types.js").AgentRelationshipChangeEvidence[]
          : [];
        characters[charaNum] = {
          charaNum,
          dayIndex,
          startedAtTick: Math.max(dayIndex * 1440, Math.trunc(finiteNumber(candidate.startedAtTick, dayIndex * 1440))),
          ...(Number.isSafeInteger(candidate.closedAtTick) ? { closedAtTick: Number(candidate.closedAtTick) } : {}),
          initialLocation: candidate.initialLocation,
          lastKnownLocation: candidate.lastKnownLocation,
          activities,
          visitedLocations,
          encounters,
          relationshipStart,
          ...(relationshipEnd ? { relationshipEnd } : {}),
          relationshipChanges,
          sequence: Math.max(0, Math.trunc(finiteNumber(candidate.sequence, 0))),
        };
      }
      return { dayIndex, characters };
    });
  return { version: 1, days };
}

function normalizeMigratedAgentMind(rawCog: UnknownRecord): import("../agent/types.js").AgentMindStateV1 {
  if (rawCog.mind !== undefined) return normalizeAgentMindState(rawCog.mind);
  const mind = createAgentMindState();
  const reflections = Array.isArray(rawCog.reflections) ? rawCog.reflections : [];
  const latest = reflections.slice().reverse().find((entry): entry is UnknownRecord => isRecord(entry));
  const parts = latest && isRecord(latest.parts) ? latest.parts : undefined;
  if (parts) {
    if (typeof parts.attitudeToPlayer === "string") mind.relationshipToPlayer = parts.attitudeToPlayer.slice(0, 300);
    if (typeof parts.nextTendency === "string") mind.currentTendency = parts.nextTendency.slice(0, 300);
  }
  const oldGoals = Array.isArray(rawCog.goals) ? rawCog.goals : [];
  mind.goals = oldGoals
    .filter((entry): entry is UnknownRecord => isRecord(entry)
      && typeof entry.id === "string" && entry.id.trim().length > 0
      && typeof entry.text === "string" && entry.text.trim().length > 0)
    .filter((entry) => entry.status === undefined || entry.status === "active")
    .slice(-3)
    .map((entry, index) => ({
      id: `legacy-goal:${String(entry.id).slice(0, 120)}`,
      topic: "relationship" as const,
      text: String(entry.text).slice(0, 180),
      createdTick: Math.max(0, finiteNumber(entry.createdTick, index)),
      updatedTick: Math.max(0, finiteNumber(entry.createdTick, index)),
      evidenceIds: [],
      status: "active" as const,
    }));
  return mind;
}

function normalizeMigratedDaytimeSync(
  rawCog: UnknownRecord,
): import("../agent/types.js").AgentDaytimeSyncState {
  const raw = isRecord(rawCog.daytimeSync) ? rawCog.daytimeSync : {};
  const ids = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim().slice(0, 180)))]
    : [];
  const revision = Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0
    ? Number(raw.revision)
    : 0;
  const lastProjectedTick = Number.isSafeInteger(raw.lastProjectedTick) && Number(raw.lastProjectedTick) >= 0
    ? Number(raw.lastProjectedTick)
    : 0;
  const lastReactionTick = Number.isSafeInteger(raw.lastReactionTick) && Number(raw.lastReactionTick) >= 0
    ? Number(raw.lastReactionTick)
    : undefined;
  return {
    version: 1,
    pendingObservationIds: ids(raw.pendingObservationIds).slice(-COGNITIVE_CAPS.daytimePendingObservations),
    consumedObservationIds: ids(raw.consumedObservationIds).slice(-COGNITIVE_CAPS.daytimeConsumedObservations),
    revision,
    lastProjectedTick,
    ...(lastReactionTick === undefined ? {} : { lastReactionTick }),
  };
}

/**
 * Validate and repair an unknown `agentRuntime` payload.  Returns `undefined`
 * for absent or irreparably broken data, letting the migration fall back to
 * the baseline (which may itself be `undefined` — that's fine for optional
 * fields on `GameState`).
 */
function normalizeAgentRuntime(value: unknown): import("../agent/types.js").AgentRuntimeState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  if (value.version !== AGENT_RUNTIME_VERSION) return undefined;
  if (!isRecord(value.cognitions) || !isRecord(value.engagements)) return undefined;
  if (!Array.isArray(value.activeRoster)) return undefined;
  if (!isRecord(value.settings)) return undefined;

  const rawSettings = value.settings as UnknownRecord;
  const settings = {
    masterEnabled: rawSettings.masterEnabled === true,
    maxActiveAgents: Math.max(1, Math.min(20, Math.trunc(finiteNumber(rawSettings.maxActiveAgents, 10)))),
    pinnedCharaNums: Array.isArray(rawSettings.pinnedCharaNums)
      ? [...new Set((rawSettings.pinnedCharaNums as unknown[]).filter((n): boolean => typeof n === "number" && Number.isInteger(n as number) && (n as number) > 0) as number[])]
      : [],
    excludedCharaNums: Array.isArray(rawSettings.excludedCharaNums)
      ? [...new Set((rawSettings.excludedCharaNums as unknown[]).filter((n): boolean => typeof n === "number" && Number.isInteger(n as number) && (n as number) > 0) as number[])]
      : [],
  };

  // Normalise cognitions — validate each entry and trim capped arrays.
  const cognitions: Record<number, unknown> = {};
  for (const [rawId, rawCog] of Object.entries(value.cognitions)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0 || !isRecord(rawCog)) continue;
    const currentPlan = isRecord(rawCog.currentPlan) &&
      Number.isInteger(rawCog.currentPlan.dayIndex) &&
      typeof rawCog.currentPlan.contextHash === "string" &&
      Number.isFinite(rawCog.currentPlan.acceptedAtTick) &&
      Array.isArray(rawCog.currentPlan.selections)
      ? {
          dayIndex: Math.trunc(rawCog.currentPlan.dayIndex as number),
          contextHash: rawCog.currentPlan.contextHash,
          acceptedAtTick: Math.trunc(rawCog.currentPlan.acceptedAtTick as number),
          selections: rawCog.currentPlan.selections.filter((selection): boolean =>
            isRecord(selection) &&
            typeof selection.candidateId === "string" &&
            typeof selection.location === "string" &&
            (selection.kind === "stay" || selection.kind === "room" || selection.kind === "visit") &&
            Number.isFinite(selection.windowStart) &&
            Number.isFinite(selection.windowEnd)),
        }
      : undefined;
    const commissionDecision = isRecord(rawCog.commissionDecision) &&
      (rawCog.commissionDecision.action === "propose" || rawCog.commissionDecision.action === "defer") &&
      Number.isFinite(rawCog.commissionDecision.decidedAtTick) &&
      Number.isInteger(rawCog.commissionDecision.decidedAtDay)
      ? {
          action: rawCog.commissionDecision.action,
          ...(typeof rawCog.commissionDecision.candidateId === "string"
            ? { candidateId: rawCog.commissionDecision.candidateId }
            : {}),
          decidedAtTick: Math.trunc(rawCog.commissionDecision.decidedAtTick as number),
          decidedAtDay: Math.trunc(rawCog.commissionDecision.decidedAtDay as number),
        }
      : undefined;
    cognitions[id] = {
      observations: Array.isArray(rawCog.observations)
        ? (rawCog.observations as unknown[]).filter((o): boolean => isRecord(o) && typeof (o as Record<string,unknown>).id === "string").slice(-96)
        : [],
      memories: Array.isArray(rawCog.memories)
        ? (rawCog.memories as unknown[]).filter((m): boolean => isRecord(m) && typeof (m as Record<string,unknown>).id === "string").slice(-64)
        : [],
      reflections: Array.isArray(rawCog.reflections)
        ? (rawCog.reflections as unknown[]).filter((r): boolean => isRecord(r) && typeof (r as Record<string,unknown>).id === "string").slice(-12)
        : [],
      goals: Array.isArray(rawCog.goals)
        ? (rawCog.goals as unknown[]).filter((g): boolean => isRecord(g) && typeof (g as Record<string,unknown>).id === "string").slice(-8)
        : [],
      mind: normalizeMigratedAgentMind(rawCog),
      pendingEpisodes: normalizeAgentPendingEpisodes(rawCog.pendingEpisodes),
      daytimeSync: normalizeMigratedDaytimeSync(rawCog),
      diaries: Array.isArray(rawCog.diaries)
        ? (rawCog.diaries as unknown[]).filter((d): boolean => isRecord(d) && typeof (d as Record<string,unknown>).id === "string").slice(-30)
        : [],
      lastUpdatedTick: finiteNumber((rawCog as UnknownRecord).lastUpdatedTick, 0),
      ...(currentPlan ? { currentPlan } : {}),
      ...(commissionDecision ? { commissionDecision } : {}),
    };
  }

  // Normalise engagements — validate signal arrays.
  const engagements: Record<number, unknown> = {};
  for (const [rawId, rawEng] of Object.entries(value.engagements)) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0 || !isRecord(rawEng)) continue;
    const e = rawEng as UnknownRecord;
    engagements[id] = {
      score: finiteNumber(e.score, 0),
      lastDecayTick: finiteNumber(e.lastDecayTick, 0),
      signals: Array.isArray(e.signals)
        ? (e.signals as unknown[]).filter((s): boolean =>
            isRecord(s) && typeof (s as UnknownRecord).kind === "string"
            && typeof (s as UnknownRecord).points === "number"
            && typeof (s as UnknownRecord).charaNum === "number")
          .slice(-96)
        : [],
    };
  }

  const raw = value as UnknownRecord;
  const rawMaterialization = isRecord(raw.materialization) ? raw.materialization : {};
  const defaultMaterialization = createAgentMaterializationState();
  const normalizeTickRecord = (candidate: unknown): Record<number, number> =>
    pruneMaterializationTicks(isRecord(candidate)
      ? Object.fromEntries(Object.entries(candidate)
          .filter(([key, tick]) => Number.isSafeInteger(Number(key)) && Number(key) > 0
            && Number.isSafeInteger(tick) && Number(tick) >= 0)
          .map(([key, tick]) => [Number(key), Number(tick)]))
      : {});
  const materialization = {
    lastSeenTicks: normalizeTickRecord(
      rawMaterialization.lastSeenTicks ?? defaultMaterialization.lastSeenTicks,
    ),
    materializedThroughTicks: normalizeTickRecord(
      rawMaterialization.materializedThroughTicks ?? defaultMaterialization.materializedThroughTicks,
    ),
    budgetDay: Number.isSafeInteger(rawMaterialization.budgetDay)
      ? Number(rawMaterialization.budgetDay)
      : -1,
    requestCount: Math.max(0, Math.min(
      MAX_LAZY_REQUESTS_PER_DAY,
      Math.trunc(finiteNumber(rawMaterialization.requestCount, 0)),
    )),
    requestedCharaNums: Array.isArray(rawMaterialization.requestedCharaNums)
      ? [...new Set(rawMaterialization.requestedCharaNums
          .filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0))]
          .slice(0, MAX_LAZY_REQUESTS_PER_DAY)
      : [],
    requestKeys: Array.isArray(rawMaterialization.requestKeys)
      ? [...new Set(rawMaterialization.requestKeys
          .filter((key): key is string => typeof key === "string" && key.length > 0 && key.length <= 240))]
          .slice(0, MAX_LAZY_REQUESTS_PER_DAY)
      : [],
  };
  const dailyLedger = normalizeAgentDailyLedger(raw.dailyLedger);
  return {
    version: AGENT_RUNTIME_VERSION,
    cognitions,
    engagements,
    activeRoster: Array.isArray(raw.activeRoster)
      ? [...new Set((raw.activeRoster as unknown[]).filter((n): boolean => typeof n === "number" && Number.isInteger(n as number) && (n as number) > 0) as number[])].slice(0, settings.maxActiveAgents)
      : [],
    previousRoster: Array.isArray(raw.previousRoster)
      ? [...new Set((raw.previousRoster as unknown[]).filter((n): boolean => typeof n === "number" && Number.isInteger(n as number) && (n as number) > 0) as number[])]
      : [],
    rosterSelectedDay: finiteNumber(raw.rosterSelectedDay, -1),
    settings,
    acceptedDecisions: Array.isArray(raw.acceptedDecisions)
      ? (raw.acceptedDecisions as unknown[]).filter((d): boolean => isRecord(d) && typeof (d as UnknownRecord).id === "string").slice(-30) as import("../agent/types.js").AcceptedAgentDecision[]
      : [],
    decisionSeq: finiteNumber(raw.decisionSeq, 0),
    materialization,
    dailyLedger,
    memoryArchive: normalizeMemoryArchive(raw.memoryArchive),
  } as import("../agent/types.js").AgentRuntimeState;
}

/**
 * Upgrade an unknown save payload against a fresh current-state baseline.
 *
 * The baseline supplies current roster metadata and defaults. Persisted
 * gameplay values win after shape validation. FLAG and TFLAG are deliberately
 * normalized independently; ambiguous numeric slots are never copied between
 * namespaces.
 */
export function migrateGameState(
  raw: unknown,
  baseline: GameState,
): GameStateMigrationResult {
  const base = cloneGameState(baseline);
  base.acceptedExperiences = normalizeAcceptedExperiences(base.acceptedExperiences);
  base.casinoChips ??= 0;
  base.childSexPreg ??= {};
  base.children ??= {};
  base.dlcSavedata = stringNumberRecord(base.dlcSavedata);
  const warnings: string[] = [];
  if (!isRecord(raw) || !isRecord(raw.master) || !isRecord(raw.charas)) {
    base.schemaVersion = GAME_STATE_SCHEMA_VERSION;
    base.tflagStore = numberRecord(base.tflagStore);
    base.turnContext = undefined;
    return {
      state: base,
      valid: false,
      sourceVersion: 0,
      warnings: ["save payload is missing master or charas"],
    };
  }

  const sourceVersion = Math.max(0, Math.trunc(finiteNumber(raw.schemaVersion, 0)));
  const next = { ...base, ...raw } as unknown as GameState;
  next.schemaVersion = GAME_STATE_SCHEMA_VERSION;
  next.aiRelationshipLedger = normalizeRelationshipLedger(raw.aiRelationshipLedger);
  // A dialogue agreement belongs to the live session, never to a loaded save.
  delete next.aiDialogueAccompany;

  const sourceTime = isRecord(raw.time) ? raw.time : {};
  next.time = {
    ...base.time,
    ...sourceTime,
    tickValue: finiteNumber(sourceTime.tickValue, base.time.tickValue),
    dayIndex: finiteNumber(sourceTime.dayIndex, base.time.dayIndex),
    hourOfDay: finiteNumber(sourceTime.hourOfDay, base.time.hourOfDay),
    season: finiteNumber(sourceTime.season, base.time.season ?? 1),
    date: finiteNumber(sourceTime.date, base.time.date ?? 1),
  };

  const persistedHomeLocation =
    typeof raw.homeLocation === "string" ? raw.homeLocation : base.homeLocation;
  next.homeLocation = persistedHomeLocation === LEGACY_HAKUREI_HOME
    ? DEFAULT_HAKUREI_HOME
    : persistedHomeLocation;
  next.masterWakeMinute = finiteNumber(
    raw.masterWakeMinute,
    base.masterWakeMinute ?? 420,
  );
  next.dayEventsEnabled = normalizeDayEventsEnabled(
    raw.dayEventsEnabled,
    base.dayEventsEnabled ?? 1,
  );
  next.master = normalizeSlot(raw.master, base.master, 0, next.homeLocation);
  // The top-level home is the master's canonical residence. Backfill the
  // slot mirror so sleep/return-home gates cannot disagree after cohabitation
  // or when loading a save written before the mirror was persisted.
  next.master.homeLocation = next.homeLocation ?? next.master.homeLocation;
  repairLegacyTequipWrites(next.master, sourceVersion, warnings);
  if (next.master.location === LEGACY_HAKUREI_HOME) {
    next.master.location = next.homeLocation ?? DEFAULT_HAKUREI_HOME;
  }
  // A save's sleep state is authoritative; do NOT fall back to the baseline.
  // `buildInitialState` seeds `sleepSession` for the new-game first morning
  // (主角睡在自宅卧室), and inheriting that phantom "still asleep" session into
  // every load made it re-enter night settlement on boot / 读档 / dev-tools
  // return even from an awake morning-menu save. Absent/malformed → awake (null).
  next.sleepSession = normalizeSleepSession(raw.sleepSession) ?? null;
  next.dailyEventLastRunDay = typeof raw.dailyEventLastRunDay === "number" && Number.isFinite(raw.dailyEventLastRunDay)
    ? Math.trunc(raw.dailyEventLastRunDay)
    : base.dailyEventLastRunDay;
  next.dailyEventFlags = numberRecord(raw.dailyEventFlags);
  next.dailyEventValues = numberRecord(raw.dailyEventValues);
  const normalizedDailyEventSession = normalizeDailyEventSession(raw.dailyEventSession);
  next.dailyEventSession = normalizedDailyEventSession ?? null;
  if (raw.dailyEventSession != null && !normalizedDailyEventSession) {
    warnings.push("discarded invalid daily-event session");
  }
  const normalizedFestivalEventSession = normalizeFestivalEventSession(raw.festivalEventSession);
  next.festivalEventSession = normalizedFestivalEventSession ?? null;
  if (raw.festivalEventSession != null && !normalizedFestivalEventSession) {
    warnings.push("discarded invalid festival-event session");
  }
  const normalizedMobMealSession = normalizeMobMealSession(raw.mobMealSession);
  next.mobMealSession = normalizedMobMealSession ?? null;
  if (raw.mobMealSession != null && !normalizedMobMealSession) {
    warnings.push("discarded invalid mob-meal session");
  }
  next.acceptedEventRankings = normalizeAcceptedEventRankings(raw.acceptedEventRankings, warnings);
  if (raw.acceptedEventRankings != null && !Array.isArray(raw.acceptedEventRankings)) {
    warnings.push("discarded invalid event rankings");
  }
  const normalizedStoryProgram = normalizeStoryProgram(raw.storyProgram);
  next.storyProgram = normalizedStoryProgram ?? null;
  if (raw.storyProgram != null && !normalizedStoryProgram) {
    warnings.push("discarded invalid story program");
  }
  next.narrativeEvents = normalizeNarrativeEvents(raw.narrativeEvents, warnings);
  try { next.narrativeHooks = normalizeNarrativeHooks(raw.narrativeHooks); }
  catch { next.narrativeHooks = []; warnings.push("discarded invalid narrative dialogue hooks"); }
  try { next.storylets = normalizeStorylets(raw.storylets); }
  catch { next.storylets = []; warnings.push("discarded invalid storylet instances"); }
  const storyletSerial = finiteNumber(raw.nextStoryletSerial, 0);
  next.nextStoryletSerial = Math.max(Number.isSafeInteger(storyletSerial) && storyletSerial >= 0 ? storyletSerial : 0,
    ...(next.storylets ?? []).map(s => Number(s.id.split(":").at(-1)) + 1).filter(Number.isSafeInteger));
  next.narrativeSituationSession = normalizeNarrativeSituationSession(raw.narrativeSituationSession);
  if (raw.narrativeSituationSession != null && !next.narrativeSituationSession) {
    warnings.push("discarded invalid narrative situation session");
  }
  if (next.narrativeSituationSession?.autoSelect) {
    // Its provider owner was lost on reload, and no player can answer this
    // automatic menu. Re-author from the Arc promise through normal pacing.
    next.narrativeSituationSession = null;
    warnings.push("cleared interrupted automatic narrative situation session");
  }
  next.storyArcs = normalizeStoryArcs(raw.storyArcs, warnings);
  next.storyTemplateFavorites = normalizeStoryTemplateFavorites(raw.storyTemplateFavorites, warnings);
  clearKnownSlot2NarrativeResidue(next, warnings);
  next.worldEvents = normalizeWorldEvents(raw.worldEvents, warnings);
  next.activeEventContext = normalizeActiveEventContext(raw.activeEventContext, next);
  next.scheduledWeatherIncidents = normalizeScheduledWeatherIncidents(raw.scheduledWeatherIncidents);
  next.acceptedAgentActionIds = Array.isArray(raw.acceptedAgentActionIds)
    ? [...new Set(raw.acceptedAgentActionIds.filter((id): id is string => typeof id === "string" && id.length > 0).map((id) => id.slice(0, 256)))].slice(-128)
    : [];
  next.outing = isRecord(raw.outing) && Number.isInteger(raw.outing.mapId)
    ? { startedAtTick: Math.trunc(finiteNumber(raw.outing.startedAtTick, next.time.tickValue)), mapId: Math.max(0, Math.trunc(raw.outing.mapId as number)) }
    : null;
  next.outingEventSession = null;
  if (raw.outingEventSession != null) {
    const rawSession = raw.outingEventSession as { kind?: unknown };
    if (rawSession.kind === "outing-choice") {
      // Preserve interactive-event sessions across migration so an unresolved
      // prompt survives load/restore. The EV1 legacy kind is retired.
      next.outingEventSession = normalizeOutingChoiceSession(rawSession, warnings);
    } else if (rawSession.kind === "outing-choice-result") {
      // A result frame is also a resumable boundary: closing the browser or
      // saving here must not re-run the branch or silently lose its feedback.
      next.outingEventSession = normalizeOutingChoiceResultSession(rawSession, warnings);
    } else {
      warnings.push("discarded retired outing-event session");
    }
  }
  next.dateSession = normalizeDateSession(raw.dateSession, next, sourceVersion, warnings);
  reprojectDateMirrors(next);
  next.dailyBlessingExpId = typeof raw.dailyBlessingExpId === "number" && Number.isInteger(raw.dailyBlessingExpId) ? raw.dailyBlessingExpId : undefined;
  next.dailyBlessingDay = typeof raw.dailyBlessingDay === "number" && Number.isFinite(raw.dailyBlessingDay) ? Math.trunc(raw.dailyBlessingDay) : undefined;
  next.marketGifts = Array.isArray(raw.marketGifts)
    ? raw.marketGifts.filter((gift): gift is NonNullable<GameState["marketGifts"]>[number] => isRecord(gift) && Number.isFinite(gift.adjectId) && Number.isFinite(gift.mainId) && typeof gift.name === "string" && Number.isFinite(gift.price)).map((gift) => ({ adjectId: Math.trunc(gift.adjectId), mainId: Math.trunc(gift.mainId), name: gift.name, price: Math.trunc(gift.price) }))
    : undefined;
  const rawGatheringSeason = raw.gatheringSeason;
  next.gatheringSeason = typeof rawGatheringSeason === "number" &&
    Number.isInteger(rawGatheringSeason) && rawGatheringSeason >= 1 && rawGatheringSeason <= 4
    ? rawGatheringSeason as 1 | 2 | 3 | 4
    : undefined;
  next.mobRaceBuff = isRecord(raw.mobRaceBuff) && typeof raw.mobRaceBuff.race === "string" &&
    Number.isFinite(finiteNumber(raw.mobRaceBuff.days, NaN)) && finiteNumber(raw.mobRaceBuff.days, 0) > 0
    ? { race: raw.mobRaceBuff.race, days: Math.trunc(finiteNumber(raw.mobRaceBuff.days, 0)) }
    : undefined;
  next.firstKissHistory = normalizeFirstKissHistory(raw.firstKissHistory);
  // Slice-G accidentally wrote an untyped marker. It was never authoritative.
  delete (next as GameState & { dailyearnEventDay?: number }).dailyearnEventDay;
  next.danmakuBattle = normalizeDanmakuBattle(raw.danmakuBattle);
  next.fishingGear = normalizeFishingGear(raw.fishingGear, (isRecord(raw.items) ? finiteNumber(raw.items[37], 0) : 0) > 0);
  next.fishingGame = normalizeFishingGame(raw.fishingGame);
  next.freeActions = normalizeFreeActions(raw.freeActions) ?? base.freeActions;
  next.freeActionMeta = normalizeFreeActionMeta(raw.freeActionMeta) ?? base.freeActionMeta;
  next.commissions = normalizeCommissionState(raw.commissions) ?? base.commissions;
  next.insectForaging = normalizeInsectForagingContract(raw.insectForaging);
  next.encounterMorningDay = typeof raw.encounterMorningDay === "number" && Number.isFinite(raw.encounterMorningDay)
    ? Math.trunc(raw.encounterMorningDay)
    : base.encounterMorningDay;
  next.morningRanDay = typeof raw.morningRanDay === "number" && Number.isFinite(raw.morningRanDay)
    ? Math.trunc(raw.morningRanDay)
    : base.morningRanDay;
  next.workRuntime = sourceVersion >= 9
    ? normalizeWorkRuntime(raw.workRuntime, next.time.dayIndex)
    : undefined;
  if (raw.workRuntime != null && !next.workRuntime) {
    warnings.push("discarded invalid or stale work runtime");
  }

  const sourceCharas = raw.charas;
  const charaNums = new Set<number>([
    ...Object.keys(base.charas).map(Number),
    ...Object.keys(sourceCharas).map(Number),
  ]);
  const charas: Record<number, CharaSlot> = {};
  for (const charaNum of charaNums) {
    if (!Number.isFinite(charaNum) || charaNum <= 0) continue;
    const fallback =
      base.charas[charaNum] ?? {
        charaNum,
        location: next.master.location,
        state: emptyCharaSlotState(),
      };
    charas[charaNum] = normalizeSlot(
      sourceCharas[String(charaNum)],
      fallback,
      charaNum,
      fallback.homeLocation,
    );
    repairLegacyTequipWrites(charas[charaNum]!, sourceVersion, warnings);
  }
  next.charas = charas;
  for (const slot of Object.values(next.charas)) {
    const lover = slot.state.TALENT[TALENT_ID.恋人] ?? 0;
    if (lover !== 0 && lover !== 1) {
      slot.state.TALENT[TALENT_ID.恋人] = 1;
      warnings.push(`normalized NPC ${slot.charaNum} TALENT:恋人 from ${lover} to 1`);
    }
  }
  next.dynamicCharacters = normalizeDynamicCharacters(raw.dynamicCharacters, next.charas, warnings);
  const highestDynamicId = Math.max(9_999, ...Object.keys(next.dynamicCharacters).map(Number));
  next.nextDynamicCharaNum = Math.max(
    10_000,
    Math.trunc(finiteNumber(raw.nextDynamicCharaNum, highestDynamicId + 1)),
    highestDynamicId + 1,
  );
  // Rinnosuke did not have an upstream Chara CSV row. Keep old saves aligned
  // with fresh games by materializing/adopting his authored resident slot.
  ensureRinnosuke(next);
  const normalizedMobGirlMemory = normalizeMobGirlMemorySession(raw.mobGirlMemorySession, next.dynamicCharacters);
  next.mobGirlMemorySession = normalizedMobGirlMemory ?? null;
  if (raw.mobGirlMemorySession != null && !normalizedMobGirlMemory) {
    warnings.push("discarded invalid mob-girl memory session");
  }
  next.stoneContestProgress = normalizeStoneProgress(raw.stoneContestProgress, next.charas);
  const normalizedStoneSession = normalizeStoneSession(raw.stoneContestSession, next, warnings);
  next.stoneContestSession = normalizedStoneSession;
  if (raw.stoneContestSession != null && !normalizedStoneSession) {
    // Fees/rewards are reserved inside a valid session and committed only by
    // its settlement id, so discarding malformed data cannot double-charge or
    // duplicate a prize.
    warnings.push("discarded invalid stone-contest session without settlement");
  }
  reprojectBanquetMirrors(next);

  next.flagStore = numberRecord(raw.flagStore);
  next.dlcSavedata = stringNumberRecord(raw.dlcSavedata);
  if (!(3 in next.flagStore)) next.flagStore[3] = 1;
  if (repairOrphanStealthSummary(next)) {
    warnings.push("cleared orphan global stealth bit");
  }
  // PANTS_TEMP and the two collection counters are a persisted state boundary:
  // normalize carried buckets and rebuild their derived FLAG mirrors instead
  // of trusting a stale/hand-edited save value.
  next.pantsTemp = nestedNumberRecord(raw.pantsTemp);
  next.festivalOutfitSnapshots = nestedNumberRecord(raw.festivalOutfitSnapshots);
  next.festivalScheduleSnapshots = normalizeFestivalScheduleSnapshots(raw.festivalScheduleSnapshots);
  let pantySpecies = 0;
  for (const slot of Object.values(next.charas)) {
    for (let pieceId = 0; pieceId < MAXPANTS; pieceId++) {
      if ((slot.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0) > 0) pantySpecies++;
    }
  }
  next.flagStore[FLAG_ID.獲得胖次種数] = pantySpecies;
  const pantsInTransit = Object.values(next.pantsTemp).some((bucket) =>
    Object.values(bucket).some((count) => count > 0),
  );
  next.flagStore[FLAG_ID.胖次輸送] = pantsInTransit ? 1 : 0;
  // Reproject once more after the raw flag bag is normalized so a mid-banquet
  // save cannot retain stale FLAG 30/31/32/33/34/35/36 mirrors.
  reprojectBanquetMirrors(next);

  const normalizedWalkSession = normalizeWalkSession(raw.walkSession, next.charas);
  next.walkSession = normalizedWalkSession ?? null;
  if (raw.walkSession != null && !normalizedWalkSession) {
    warnings.push("discarded invalid walk session");
  }

  const normalizedTraining = normalizeTrainingSession(raw.training, next);
  next.training = normalizedTraining ?? null;
  const discardedTraining = raw.training != null && !normalizedTraining;
  if (discardedTraining) {
    warnings.push("discarded invalid training session");
    // A malformed continuation cannot safely retain the H-mode mirror that
    // would make the next ordinary command adopt it as a fresh session.
    next.master.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
    for (const slot of Object.values(next.charas)) slot.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
  }
  if (!next.training) {
    next.master.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
    for (const slot of Object.values(next.charas)) slot.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
    clearUnresumableHInsertionLinks(next, warnings);
  } else {
    restoreLegacyHInsertionSession(next);
    for (const slot of Object.values(next.charas)) {
      if (slot.charaNum !== next.training.target) slot.state.CFLAG[CFLAG_ID.诶嘿嘿] = 0;
    }
  }
  const normalizedTrainingSummary = normalizeTrainingSummary(raw.lastTrainingSummary, next);
  next.lastTrainingSummary = normalizedTrainingSummary ?? null;
  if (raw.lastTrainingSummary != null && !normalizedTrainingSummary) {
    warnings.push("discarded invalid training summary");
  }
  // Left absent when there is nothing valid to carry: the L1 scene projection
  // reads a missing receipt as "unknown", which is the honest answer for a
  // save that predates this field. Never seed it with an empty receipt.
  //
  // `next` was built as `{ ...base, ...raw }`, so an unvalidated receipt is
  // already sitting on it — the invalid branch has to *remove* it, not just
  // skip the assignment.
  const normalizedHSettlement = normalizeHSettlementReceipt(raw.lastHSettlement);
  if (normalizedHSettlement) {
    next.lastHSettlement = normalizedHSettlement;
  } else {
    delete next.lastHSettlement;
    if (raw.lastHSettlement != null) {
      warnings.push("discarded invalid H settlement receipt");
    }
  }

  const sourceTurnContext = isRecord(raw.turnContext) ? raw.turnContext : {};
  const persistentTflags: Record<number, number> = {};
  let discardedTurnTflags = Object.keys(numberRecord(sourceTurnContext.tflags)).length;
  for (const [rawId, value] of Object.entries(numberRecord(raw.tflagStore))) {
    const id = Number(rawId);
    if (tflagLifecycle(id) === "turn") {
      discardedTurnTflags += 1;
    } else {
      persistentTflags[id] = value;
    }
  }
  next.tflagStore = persistentTflags;
  if (discardedTraining) {
    clearTflag(next, TFLAG_ID.抱住模式);
    clearTflag(next, TFLAG_ID.套套内);
    clearTflag(next, TFLAG_ID.妄想中);
  }
  // Save/load is a deterministic command boundary. RESULT/LOCAL, SELECTCOM,
  // the kojo frame and turn-scoped TFLAG must never resume into a later turn.
  next.turnContext = undefined;
  if (Object.keys(sourceTurnContext).length > 0 || discardedTurnTflags > 0) {
    warnings.push("discarded transient turn context at load boundary");
  }
  // DateSession is authoritative. Its CFLAG mirrors were projected before
  // slot normalization; rebuild only the global mirrors here so a raw TFLAG
  // bag cannot win (and do not rewrite unrelated sparse CFLAG ids).
  next.flagStore[FLAG_ID.デート相手] = next.dateSession?.partner ?? 0;
  if (next.dateSession) {
    setTflag(next, TFLAG_ID.约会前好感度, next.dateSession.initialFavor);
    // `TFLAG:约会道中` — the road stage is retired; always 0.
    setTflag(next, TFLAG_ID.约会道中, 0);
  } else {
    clearTflag(next, TFLAG_ID.约会前好感度);
    clearTflag(next, TFLAG_ID.约会道中);
  }
  if (!isRecord(raw.tflagStore)) {
    warnings.push("initialized missing TFLAG namespace without copying FLAG");
  }
  next.money = finiteNumber(raw.money, base.money);
  next.casinoChips = Math.max(
    0,
    Math.trunc(finiteNumber(raw.casinoChips, base.casinoChips ?? 0)),
  );
  next.moriyaOmikujiBox = normalizeMoriyaOmikujiBox(raw.moriyaOmikujiBox);
  next.childSexPreg = nestedNumberRecord(raw.childSexPreg);
  next.children = normalizeChildren(raw.children, next.charas);
  next.eventLog = Array.isArray(raw.eventLog) ? raw.eventLog as GameState["eventLog"] : base.eventLog;
  next.readOnlyMetadata = isRecord(raw.readOnlyMetadata)
    ? raw.readOnlyMetadata as unknown as GameState["readOnlyMetadata"]
    : base.readOnlyMetadata;

  next.items = numberRecord(raw.items);
  next.bugCage = Array.isArray(raw.bugCage)
    ? raw.bugCage.filter((entry): entry is import("./bug-catching.js").CaughtBug => (
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.bugNum === "number" &&
        typeof entry.rank === "number" &&
        typeof entry.gType === "boolean" &&
        typeof entry.xType === "boolean" &&
        typeof entry.caughtDay === "number" &&
        typeof entry.location === "string"
      )).slice(0, 8)
    : [];
  next.bugCollection = isRecord(raw.bugCollection)
    ? Object.fromEntries(Object.entries(raw.bugCollection)
        .filter(([rawNum, value]) => Number.isFinite(Number(rawNum)) && Boolean(value))
        .map(([rawNum]) => [Number(rawNum), true] as const))
    : {};
  next.bugCaptureCount = Math.max(0, Math.trunc(finiteNumber(raw.bugCaptureCount, 0)));
  next.bugTrap = isRecord(raw.bugTrap) &&
    typeof raw.bugTrap.location === "string" &&
    typeof raw.bugTrap.baitItemId === "number" &&
    typeof raw.bugTrap.baitName === "string" &&
    typeof raw.bugTrap.baitTypes === "string" &&
    typeof raw.bugTrap.baitQuality === "number" &&
    typeof raw.bugTrap.placedTick === "number" &&
    (raw.bugTrap.caughtBugNum === undefined || typeof raw.bugTrap.caughtBugNum === "number") &&
    (raw.bugTrap.caughtPower === undefined || typeof raw.bugTrap.caughtPower === "number")
    ? raw.bugTrap as unknown as import("./bug-catching.js").BugTrap
    : undefined;
  next.itemSales = numberRecord(raw.itemSales);
  next.yogore = stringNumberRecord(raw.yogore);
  next.selectedKojoVariants = normalizeSelectedVariants(raw.selectedKojoVariants);
  next.disabledKojo = normalizeDisabledKojo(raw.disabledKojo);
  next.kojoMemory = normalizeKojoMemory(raw.kojoMemory);
  next.displayNames = (isRecord(raw.displayNames)
    ? Object.fromEntries(Object.entries(raw.displayNames).flatMap(([observer, names]) => {
        if (!Number.isFinite(Number(observer)) || !isRecord(names)) return [];
        const normalized = Object.fromEntries(Object.entries(names)
          .filter(([subject, value]) => Number.isFinite(Number(subject)) && typeof value === "string")
          .map(([subject, value]) => [Number(subject), value]));
        return Object.keys(normalized).length > 0 ? [[Number(observer), normalized]] : [];
      }))
    : {}) as Record<number, Record<number, string>>;
  next.kojoStrings = (isRecord(raw.kojoStrings)
    ? {
        cstr: isRecord(raw.kojoStrings.cstr)
          ? Object.fromEntries(Object.entries(raw.kojoStrings.cstr).flatMap(([subject, values]) => {
              if (!Number.isFinite(Number(subject)) || !isRecord(values)) return [];
              const normalized = Object.fromEntries(Object.entries(values)
                .filter(([key, value]) => Number.isFinite(Number(key)) && typeof value === "string")
                .map(([key, value]) => [Number(key), value]));
              return Object.keys(normalized).length > 0 ? [[Number(subject), normalized]] : [];
            }))
          : {},
        nickname: isRecord(raw.kojoStrings.nickname)
          ? Object.fromEntries(Object.entries(raw.kojoStrings.nickname)
              .filter(([chara, value]) => Number.isFinite(Number(chara)) && typeof value === "string")
              .map(([chara, value]) => [Number(chara), value]))
          : {},
      }
    : undefined) as GameState["kojoStrings"];
  next.daySnapshot = normalizeSnapshot(raw.daySnapshot) ?? base.daySnapshot;
  // Agent Runtime v2 is the only supported persisted shape. Older or invalid
  // agent payloads are intentionally reset while the deterministic save loads.
  next.agentRuntime = normalizeAgentRuntime(raw.agentRuntime) ?? createAgentRuntimeState();
  // Schema 25 (and older) saves have no daily ledger. If Agent Runtime was
  // already enabled, begin the current record at the load tick only; never
  // invent movements or encounters from earlier in the day.
  ensureCurrentAgentLedgerDay(next);
  next.acceptedExperiences = normalizeAcceptedExperiences(raw.acceptedExperiences);
  if (sourceVersion < 34) warnings.push(...recoverPrematurelyMissedNarrativeWindows(next));
  // Schema 39 binds only surviving evidence for old Arcs; lost player input cannot be invented.
  backfillStoryBackgrounds(next);
  // Schema 40 accepts optional bounded continuation receipt text. Older receipts
  // remain valid without it: never invent missing player words during migration.
  const narrative = reconcileNarrativeState(next);
  warnings.push(...narrative.diagnostics);

  if (sourceVersion < GAME_STATE_SCHEMA_VERSION) {
    warnings.push(`migrated state schema ${sourceVersion} -> ${GAME_STATE_SCHEMA_VERSION}`);
  }

  return {
    state: narrative.state,
    valid: true,
    sourceVersion,
    warnings,
  };
}
