import { create } from "zustand";
import {
  loadState as ipcLoadState,
  listSaveSlots as ipcListSaveSlots,
  mostRecentSlot as ipcMostRecentSlot,
  saveState as ipcSaveState,
  type SaveSlot,
  type SaveSummary,
  type SlotInfo,
} from "../ipc/tauri-bridge";
import {
  applyIntent,
  applyKojoEffects,
  configureIntent,
  finishPlayerSleep,
  finalizeElapsedAction,
  openEyes,
  setMasterWakeMinute,
  buildSeededMasterState,
  buildConfiguredCharaSlot,
  cloneGameState,
  clearTurnContext,
  TFLAG_ID,
  currentIntentDeps,
  dayEventKojoEventsFromSession,
  hydrateConfiguredCharaHomes,
  initializeConfiguredSchedules,
  GAME_STATE_SCHEMA_VERSION,
  migrateGameState,
  resolveDomainTransitionDialogue,
  resolveMobMeal,
  reprojectSchedules,
  resolveOutingEventSession,
  commitOutingChoiceResult,
  type OutingChoiceValue,
  runNewGameInitialLevelSync,
  seedScheduledLocations,
  snapshotCharaStates,
  settleDanmakuBattleCore,
  patternForTarget,
  setTflag,
  type BattleInput,
  toggleComFilter,
  type CharaStatsLike,
  type GameState,
  type DomainTransition,
  type TimeSlot,
  buyFishingGear,
  finishFishingSession,
  type FishingGearKind,
  type FishingLineId,
  type FishingRodId,
  type FishingSettlementOutcome,
} from "../../../modernization/runtime";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { seedInitialWeatherForecasts } from "../../../modernization/runtime/weather/prediction.js";
import {
  startSkipMove,
  resolveWalkEncounter,
  hasNpcAt,
  type WalkChoice,
} from "../../../modernization/runtime/world/skip-move.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID, getMasterTalent, setCharaCflag, setMasterCflag, setMasterTalent, setMasterAbl, setMasterBase, setMasterExp } from "../../../modernization/runtime/state/settlement.js";
import { SOURCE_ID, advanceTimeTicks } from "../../../modernization/runtime/state/settlement.js";
import { applySourceCheck } from "../../../modernization/runtime/command/source-check.js";
import { addItem } from "../../../modernization/runtime/state/items.js";
import { hasPlace, PLACE_GARDEN } from "../../../modernization/runtime/world/place-flags.js";
import { placeFlagsOf } from "../../../modernization/runtime/world/location-predicates.js";
import { togglePortraitKind } from "../../../modernization/runtime/state/portrait-kind.js";
import { resetAllCommissions } from "../../../modernization/runtime/state/commission.js";
import { resetAllClothes } from "../../../modernization/runtime/state/clothing-write.js";
import { materializeCaughtBug, releaseCaughtBug } from "../../../modernization/runtime/state/bug-catching.js";
import { ensureRinnosuke, resolveMobGirlMemory } from "../../../modernization/runtime/world/dynamic-characters.js";
import { runMultiAgentNightCycle } from "../ai/agent-night.js";
import {
  createAgentRuntimeState,
  compileObservations,
  eligibleAgentCharaNums,
  ensureAgentRuntime,
  type AgentSettings,
} from "../../../modernization/runtime/agent/index.js";
import {
  appendStoneContestPlacement,
  advanceStoneContestClock,
  advanceStoneClerkStory,
  commitStoneContestSettlement,
  continueStoneContest,
  forfeitStoneContestRound,
  leaveStoneContestLobby,
  renameStoneContestClerk,
  resolveSoloStoneRound,
  resolveStoneCouple,
  startStoneContest,
  withdrawStoneContest,
  type StoneContestStartOptions,
} from "../../../modernization/runtime/state/stone-contest.js";
import type { StonePlacementOperation } from "../../../modernization/runtime/state/stone-contest-physics.js";
import { applyMasterConsumable } from "../../../modernization/runtime/command/handlers/item-use.js";
import {
  readCharaGates,
  patchCharaGates,
  readMasterDebugAbilities,
  patchMasterDebugAbilities,
  type CharaGates,
  type MasterDebugAbilities,
} from "../../../modernization/runtime/debug/kojo-probe.js";
import type { NewGameDraft } from "../game/pre/newgame-draft.js";
import { normalizeMasterTalentByGender } from "../game/pre/newgame-talent.js";
import { normalizeMasterExpByGender } from "../game/pre/newgame-exp.js";
import {
  ITEM_STOCK_CODE,
  catalogEntry,
  shopBuy,
  type ShopBuyResult,
} from "../../../modernization/runtime/state/shop.js";
import charaBundle from "../game/charas.bundle.json";
import { mockEmptyWorldSnapshot } from "../../../modernization/schemas/mock.js";
import type {
  AgentIntent,
  ObservationEvent,
  StatusMessage,
} from "../../../modernization/schemas/types.js";
import type { PromptSpec, PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import type { CommandContext } from "../../../modernization/runtime/command/types.js";
import type { DialogueRouter, KojoLine, PendingKojoChoice } from "../../../modernization/runtime/kojo/types.js";
import {
  detectEncounterTransition,
  runFirstMeeting,
  runFirstMeetingsForTransition,
  type EncounterTransition,
  type FirstMeetingsForTransitionResult,
} from "../../../modernization/runtime/world/first-meeting.js";
import { commandKojoEventsFromSession } from "../../../modernization/runtime/command/command-kojo.js";
import { CONFIGURED_ROSTER_IDS } from "../../../modernization/runtime/world/configured-roster.js";
import { setSlotLocation } from "../../../modernization/runtime/world/room-id-location.js";
import {
  DIALOGUE_SESSION_PRIORITY,
  advanceDialogueSession,
  enqueueDialogueSession,
  mergeReplayedTranscript,
  replaceActiveDialogueSession,
  type DialogueChoiceSession,
  type DialogueSession,
  type DialogueSessionOwner,
} from "./dialogue-session.js";
import {
  cancelAllRealtimeAiKojo,
  cancelRealtimeAiKojo,
  generateRealtimeAiKojo,
  prepareRealtimeAiKojo,
  recordAiCommand,
} from "../ai/kojo-runtime.js";
import { useAiStore } from "../ai/store.js";

/**
 * Phase 4D — GameState store.
 *
 * Holds the live `GameState` and exposes actions to load/save it
 * via the Rust IPC commands (Phase 4B). The store is the single
 * place where the renderer's `GameState` is mutated; React
 * components read from the store and call `applyIntentAction` to
 * push new intents.
 *
 * Layering:
 *   - Tauri IPC (loadState / saveState) is the I/O boundary.
 *   - `applyIntent` (TS, Phase 4A) is the settlement stub.
 *   - The store is the React-side glue.
 *
 * Phase 4 scope: NO real settlement. applyIntent is the stub that
 * appends a STATUS_MESSAGE to eventLog. Real settlement lands in
 * Phase 5.
 *
 * Test strategy: `tauri-bridge.ts` is mocked in
 * `game-state-store.test.ts` so this file can be tested without
 * a Tauri runtime. The store's contract is "on load, fetch from
 * IPC; on null, build a fresh state; on applyIntent, mutate eventLog
 * only; on save, push to IPC".
 */

const NOW = () => Date.now();

function finalizeActivityState(
  state: GameState,
  oldTick: number,
  commandNo: number,
): GameState {
  const deps = currentIntentDeps();
  const post = finalizeElapsedAction(state, {
    oldTick,
    commandNo,
    now: NOW,
    rng: createRng(commandNo * 100003 + oldTick),
    dialogueRouter: deps.router,
    accrueMobDirt: true,
  });
  post.state.eventLog = [...post.state.eventLog, ...post.events];
  return post.state;
}
let agentNightController: AbortController | null = null;
let agentNightGeneration = 0;

function cancelAgentNightCycle(): void {
  agentNightGeneration++;
  agentNightController?.abort();
  agentNightController = null;
}
// Upstream @DEFAULT_OWNER_0 assigns the player P53 (倉庫) at Hakurei Shrine,
// then marks that room as the player's private bedroom. It is not Reimu's P15.
const DEFAULT_HAKUREI_HOME = "神社:倉庫";

const CONFIGURED_CHARA_IDS = CONFIGURED_ROSTER_IDS;
function buildConfiguredChara(charaNum: number) {
  const stats = charaBundle[String(charaNum) as keyof typeof charaBundle] as CharaStatsLike;
  return buildConfiguredCharaSlot(stats);
}

/**
 * Build a fresh default `GameState` for a project. Used when the
 * IPC load returns null (first boot, or the user cleared their
 * last project).
 *
 * Phase 4 stub: hardcoded. Phase 5+ will pull the master defaults
 * from `characters.json` and the readOnlyMetadata from the 9
 * manifests. For now the renderer's purpose is to prove the
 * pipeline works end-to-end.
 */
export function buildInitialState(now: number = NOW(), draft?: NewGameDraft): GameState {
  const time: TimeSlot = {
    tickValue: 480, // 08:00 = 8*60 minutes from midnight (L2: matches schedule)
    dayIndex: 0,
    hourOfDay: 8,
    season: 1, // DAY:2 季節 = 春 (NEWGAME seed, NEWGAME.ERB:16)
    date: 1, // DAY:3 日期 = 1 (NEWGAME seed, NEWGAME.ERB:17; = 元旦)
  };
  const bootEvent: StatusMessage = {
    kind: "STATUS_MESSAGE",
    timestamp: now,
    source: "system",
    text: "ready",
  };
  const eventLog: ReadonlyArray<ObservationEvent> = [bootEvent];
  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    time,
    homeLocation: DEFAULT_HAKUREI_HOME,
    // #13 6b — 起床时间 7 点（原版 @NEWGAME:73 TIME:3=420）替代现代 8 点.
    masterWakeMinute: 420,
    master: {
      charaNum: 0,
      callName: "主人公",
      // #13 6b — 主角睡在自宅卧室. 3a/3b/4 仅写 homeLocation 字段,
      // 主角 location 仍写死居間; 6b 修这个错位, 真正落在 home.
      location: DEFAULT_HAKUREI_HOME,
      state: buildSeededMasterState(),
    },
    // Current location starts at the imported initial room. Unsupported
    // activity events do not relocate anyone.
    charas: Object.fromEntries(
      CONFIGURED_CHARA_IDS.map((charaNum) => [charaNum, buildConfiguredChara(charaNum)]),
    ),
    dynamicCharacters: {},
    nextDynamicCharaNum: 10_000,
    mobGirlMemorySession: null,
    stoneContestProgress: undefined,
    stoneContestSession: null,
    flagStore: { 3: 1 },
    tflagStore: {
      // Parity QA Wave 7: TFLAG:あなた起床 (id 216) = TIME + 1440*DAY at the
      // new-game wake (BEFORETRAIN.ERB:219). tickValue 480 = 08:00 start
      // (modern 用 8 点; #13 6b 主角睡到 7 点即醒, 但时间推进仍以 8 点 seed
      // schedule). NEMUKE() subtracts this; seeding it makes sleepiness 0 at
      // wake so the 402 就寝 (NEMUKE≥720) / 417 昼寝 (180≤NEMUKE≤720) gates
      // behave from the first turn.
      [TFLAG_ID.あなた起床]: 480,
    },
    money: 99999, // NEWGAME default 特典 (NEWGAME_BONUS.ERB:70).
    dayEventsEnabled: 1,
    // Faithful to 原版: the base NEWGAME inventory carries no instrument, so
    // 演奏する (COMF416, @MUSIC_ABLE) is correctly blocked until one is bought.
    // A starter 電子琴 (Item.csv id 30) was briefly seeded for trial
    // convenience but removed per user — instruments come from the 隙间商店
    // (gap shop) instead. perform-music.ts + its tests still pin the engine.
    items: {},
    eventLog,
    readOnlyMetadata: mockEmptyWorldSnapshot(),
    agentRuntime: createAgentRuntimeState(),
  };
  // #13 原版开场流程 — apply the wizard draft (称呼 / 性別 / 居住地 / 扮演模式).
  // Faithful to @NEWGAME_MAKE_INIT (性別 = TALENT_ID.性別) + @SET_MAINHOME +
  // @NEWGAME_MAKE_SELECT_MODE (FLAG_ID.扮演). KojoCache enforces the matching
  // roleplay gate unless the target declares CFLAG_ID.扮演口上有. Gender goes
  // through the namespace-safe setMasterTalent accessor.
  if (draft) {
    if (draft.callName.trim().length > 0) state.master.callName = draft.callName.trim();
    setMasterTalent(state, TALENT_ID.性別, draft.gender);
    // ANATA 能力(ABL) editor (@CUSTOM_ABL) — apply each chosen level (0..2).
    for (const [id, level] of Object.entries(draft.abl)) {
      setMasterAbl(state, Number(id), level);
    }
    // ANATA 素质(性格档位) editor (@CUSTOM_TALENT, slice 3a+3b) — apply each pick.
    for (const [id, value] of Object.entries(draft.talent)) {
      setMasterTalent(state, Number(id), value);
    }
    // 性别/性器 归一化 (@CUSTOM_INIT, slice 3b) — AFTER talent write so clearing arms run.
    normalizeMasterTalentByGender(state, draft.gender);
    // `@NEWGAME_OPTION` calls `@TINKO_DECIDE` for a body with a male organ.
    // Its canonical shape result is consumed by body displays and text.
    if ((draft.gender & 2) !== 0) {
      setMasterTalent(state, TALENT_ID.形状, draft.penisShape ?? 3);
    }
    // ANATA 经验 editor (@CUSTOM_EXP, slice 4) — apply each preset pick.
    for (const [id, value] of Object.entries(draft.exp)) {
      setMasterExp(state, Number(id), value);
    }
    // 经验 性别/性器 归一化 (slice 4 顺手补) — AFTER 性格 normalize so 处女臂生效.
    normalizeMasterExpByGender(state, draft.gender);
    // ANATA 基础(体力/気力 MAXBASE) editor (@CUSTOM_BASE, slice 4) — clamp + apply.
    if (draft.maxHp !== undefined) {
      const v = Math.max(1000, Math.min(2500, draft.maxHp));
      setMasterBase(state, 0, v); // 体力
    }
    if (draft.maxMp !== undefined) {
      const v = Math.max(1000, Math.min(2500, draft.maxMp));
      setMasterBase(state, 1, v); // 気力
    }
    state.homeLocation = draft.homeLocation;
    state.flagStore[FLAG_ID.扮演] = draft.mode;
    state.flagStore[FLAG_ID.甲斐性無] = draft.noGuts ? 1 : 0;
    state.disabledKojo = { ...draft.disabledKojo };
    state.selectedKojoVariants = { ...(draft.selectedKojoVariants ?? {}) };
  }
  // A direct new game without a UI draft retains the upstream male-body
  // default: `PENIS_REFRESH` yields the ordinary shape.
  if ((getMasterTalent(state, TALENT_ID.性別) || 2) & 2) {
    setMasterTalent(state, TALENT_ID.形状, draft?.penisShape ?? 3);
  }
  state.flagStore[FLAG_ID.NEWGAME_OPTION初期化] =
    (state.flagStore[FLAG_ID.NEWGAME_OPTION初期化] ?? 0) | (1 << 1) | (1 << 2);
  addItem(state, 81, 10);
  // NEWGAME.ERB seeds the term/day forecast before the first SHOP. Keep this
  // fresh-game-only; save migration must preserve the saved weather timeline.
  seedInitialWeatherForecasts(
    state,
    createRng((state.time.tickValue + state.time.dayIndex * 31 + (state.time.season ?? 1) * 997) | 0),
  );
  // #13 6b — 主角睡在 home 卧室, 写 sleepSession + 睡眠 cflag.
  // Faithful to @NEWGAME:71-75 (各角色 初始位置 + TIME:3 = 420 +
  // SET_SLEEP(1,MASTER,0)). 起床时刻 = masterWakeMinute (7 点).
  setSlotLocation(state.master, state.homeLocation ?? DEFAULT_HAKUREI_HOME);
  const wake = state.masterWakeMinute ?? 420;
  state.sleepSession = {
    startedAtTick: state.time.tickValue,
    requestedWakeMinute: wake,
    forced: false,
  };
  setMasterCflag(state, CFLAG_ID.睡眠, 1);
  initializeConfiguredSchedules(state);
  // Place scheduled charas at the room their hand-authored agenda says they
  // occupy at the start tick (08:00), so 霊夢 begins in the 居間 rather than
  // her bedroom — the ambient world starts already "in motion".
  seedScheduledLocations(state);
  // Upstream does not provide a Chara CSV row for Rinnosuke. Materialize the
  // stable shopkeeper through the authored-resident compatibility seam so he
  // participates in normal same-room targeting at Kourindou.
  ensureRinnosuke(state);
  // Upstream @INIT_STARTINGLV runs once after the opening options and before
  // the first SHOP. Keep it out of load/migration: only a genuinely fresh
  // state receives initial progression reconciliation and its transcript.
  state.eventLog = [...state.eventLog, ...runNewGameInitialLevelSync(state, { now: () => now })];
  // Day-start NPC snapshot for the night-settlement daily report (the diff
  // baseline). Taken after the roster is built; NPC stats are untouched by the
  // master-only draft above.
  state.daySnapshot = snapshotCharaStates(state.charas);
  return state;
}

/**
 * Split an arrival event stream into `{ inline, popup }` so every arrival flow
 * surfaces first-meeting / encounter 口上 the SAME way: the地文 narration (the
 * 「X向初次见面的Y作了问候」 greeting line) stays in the scene band, and the
 * character's actual 口上 (DIALOGUE_LINE onward) is buffered into the modal
 * InteractionBox. Before this, only `walkPathAction` popped the kojo — arriving
 * via a move command or waking up left the kojo inline in the log, so it read
 * inconsistently (and looked like you had to click 对话 to see it). If there's
 * no DIALOGUE_LINE, everything stays inline (`popup` is null).
 */
export function splitArrivalKojo(events: readonly ObservationEvent[]): {
  inline: ObservationEvent[];
  popup: ObservationEvent[] | null;
} {
  const firstLine = events.findIndex((e) => e.kind === "DIALOGUE_LINE");
  if (firstLine === -1) return { inline: [...events], popup: null };
  return { inline: events.slice(0, firstLine), popup: events.slice(firstLine) };
}

function encounterSessionAvailable(
  ui: {
    dialogueQueue: readonly DialogueSession[];
    pendingPrompt: unknown | null;
  },
): boolean {
  return (
    ui.dialogueQueue.length === 0 &&
    ui.pendingPrompt === null
  );
}

function encounterChoiceSession(
  result: Pick<
    FirstMeetingsForTransitionResult,
    "pending" | "pendingCharaNum" | "pendingEventStart" | "remainingCandidateCharaNums"
    | "continuationId" | "continuationValues" | "continuationInputMode"
  >,
  transition: EncounterTransition,
  seed: number,
  transcriptPrefixLength = 0,
  resultEventOffset = 0,
): DialogueChoiceSession | null {
  if (!result.pending || result.pendingCharaNum === null) return null;
  return {
    kind: "encounter",
    charaNum: result.pendingCharaNum,
    seed,
    choices: [],
    options: [...result.pending.options],
    continuationId: result.continuationId,
    continuationValues: result.continuationValues ? [...result.continuationValues] : undefined,
    continuationInputMode: result.continuationInputMode,
    transcriptStart:
      transcriptPrefixLength +
      Math.max(0, (result.pendingEventStart ?? 0) - resultEventOffset),
    encounterContinuation: {
      kind: transition.kind,
      location: transition.location,
      candidateCharaNums: [...result.remainingCandidateCharaNums],
    },
  };
}

function delegateDialogueRouter(
  router: DialogueRouter,
  overrides: Partial<DialogueRouter>,
): DialogueRouter {
  const wrapped: DialogueRouter = {
    collect(...args) {
      return overrides.collect ? overrides.collect(...args) : router.collect(...args);
    },
    resolveEventKojo(...args) {
      return overrides.resolveEventKojo
        ? overrides.resolveEventKojo(...args)
        : router.resolveEventKojo(...args);
    },
    resolveSpEventKojo(...args) {
      return overrides.resolveSpEventKojo
        ? overrides.resolveSpEventKojo(...args)
        : router.resolveSpEventKojo(...args);
    },
  };

  const optionalKeys = [
    "collectDetailed",
    "collectInteractive",
    "collectContinuation",
    "resumeContinuation",
    "cancelContinuation",
    "resolveEventKojoDetailed",
    "resolveEventKojoInteractive",
    "resolveSpEventKojoDetailed",
    "resolveSpEventKojoInteractive",
    "resolveEncounterKojo",
    "resolveEncounterKojoDetailed",
    "resolveEncounterKojoInteractive",
    "resolveDiaryKojo",
    "resolveDiaryKojoDetailed",
    "resolveDiaryKojoInteractive",
    "hasDiaryKojo",
    "resolveDiaryHappen",
    "resolveIraiKojo",
    "resolveIraiBlocked",
  ] as const;

  const mutableWrapped = wrapped as unknown as Record<string, unknown>;
  for (const key of optionalKeys) {
    const override = overrides[key] as ((...args: unknown[]) => unknown) | undefined;
    const base = router[key] as ((...args: unknown[]) => unknown) | undefined;
    if (override) {
      mutableWrapped[key] = (...args: unknown[]) => override(...args);
    } else if (base) {
      mutableWrapped[key] = (...args: unknown[]) => base.apply(router, args);
    }
  }

  return wrapped;
}

function createInteractiveDayEventRouter(
  router: DialogueRouter | undefined,
  onPending: (session: {
    charaNum: number;
    subid: number;
    args?: number[];
    pending: PendingKojoChoice;
  }) => void,
): DialogueRouter | undefined {
  if (!router?.resolveSpEventKojoInteractive) return router;
  return delegateDialogueRouter(router, {
    resolveSpEventKojo(
      charaNum: number,
      subid: number,
      state: Readonly<GameState>,
      rng: Parameters<DialogueRouter["resolveSpEventKojo"]>[3],
      args: Parameters<DialogueRouter["resolveSpEventKojo"]>[4],
    ): KojoLine[] {
      const r = router.resolveSpEventKojoInteractive!(
        charaNum,
        subid,
        state,
        rng,
        args,
        [],
      );
      if (r.pending) {
        onPending({
          charaNum,
          subid,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
  });
}

type EventKojoPendingCapture =
  | {
      kind: "event";
      charaNum: number;
      arm: number;
      args?: number[];
      pending: PendingKojoChoice;
    }
  | {
      kind: "diary";
      charaNum: number;
      page: number;
      args?: number[];
      pending: PendingKojoChoice;
    };

function createInteractiveEventRouter(
  router: DialogueRouter | undefined,
  onPending: (session: EventKojoPendingCapture) => void,
): DialogueRouter | undefined {
  if (!router?.resolveEventKojoInteractive && !router?.resolveDiaryKojoInteractive) return router;
  return delegateDialogueRouter(router, {
    resolveEventKojo(
      charaNum: number,
      arm: number,
      state: Readonly<GameState>,
      rng: Parameters<DialogueRouter["resolveEventKojo"]>[3],
      args: Parameters<DialogueRouter["resolveEventKojo"]>[4],
    ): KojoLine[] {
      if (!router.resolveEventKojoInteractive) {
        return router.resolveEventKojo(charaNum, arm, state, rng, args);
      }
      const r = router.resolveEventKojoInteractive(charaNum, arm, state, rng, args, []);
      if (r.pending) {
        onPending({
          kind: "event",
          charaNum,
          arm,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
    resolveDiaryKojo(
      charaNum: number,
      page: number,
      state: Readonly<GameState>,
      rng: Parameters<NonNullable<DialogueRouter["resolveDiaryKojo"]>>[3],
      args: Parameters<NonNullable<DialogueRouter["resolveDiaryKojo"]>>[4],
    ): KojoLine[] {
      if (!router.resolveDiaryKojo) return [];
      if (!router.resolveDiaryKojoInteractive) {
        return router.resolveDiaryKojo(charaNum, page, state, rng, args);
      }
      const r = router.resolveDiaryKojoInteractive(charaNum, page, state, rng, args, []);
      if (r.pending) {
        onPending({
          kind: "diary",
          charaNum,
          page,
          args: args ? [...args] : undefined,
          pending: r.pending,
        });
      }
      return r.lines;
    },
  });
}

function kojoLinesToEvents(
  lines: readonly KojoLine[],
  charaNum: number,
): ObservationEvent[] {
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: NOW(),
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

let dialogueSessionSerial = 0;

function nextDialogueSessionId(owner: DialogueSessionOwner): string {
  dialogueSessionSerial += 1;
  return `${owner}:${dialogueSessionSerial}`;
}

function firstDialogueIndex(events: readonly ObservationEvent[]): number {
  const index = events.findIndex((event) => event.kind === "DIALOGUE_LINE");
  return index === -1 ? events.length : index;
}

interface DialogueUiSnapshot {
  dialogueQueue: readonly DialogueSession[];
}

interface DialogueEnqueueRequest {
  id?: string;
  owner: DialogueSessionOwner;
  transcript: readonly ObservationEvent[] | null;
  choice?: DialogueChoiceSession | null;
  aiRequestId?: string;
  aiCharaNum?: number;
}

function dialogueQueueMirrors(queue: readonly DialogueSession[]) {
  const active = queue[0] ?? null;
  return {
    dialogueQueue: [...queue],
    pendingArrivalEvents: active ? [...active.transcript] : null,
    pendingKojoChoice: active?.choice ?? null,
  };
}

/** VM continuations are live call stacks, not save data. Cancel every stack
 * owned by a dialogue queue before that queue is discarded or made stale. */
function cancelVmDialogueContinuations(queue: readonly DialogueSession[]): void {
  const router = currentIntentDeps().router;
  for (const session of queue) {
    const continuationId = session.choice?.continuationId;
    if (continuationId) router?.cancelContinuation?.(continuationId);
  }
}

function enqueueDialoguePatch(
  ui: DialogueUiSnapshot,
  owner: DialogueSessionOwner,
  transcript: readonly ObservationEvent[] | null,
  choice: DialogueChoiceSession | null = null,
) {
  return enqueueDialogueRequestsPatch(ui, [{ owner, transcript, choice }]);
}

function enqueueDialogueRequestsPatch(
  ui: DialogueUiSnapshot,
  requests: readonly DialogueEnqueueRequest[],
) {
  let queue = [...ui.dialogueQueue];
  for (const request of requests) {
    const choice = request.choice ?? null;
    if (
      (!request.transcript || request.transcript.length === 0) &&
      choice === null &&
      request.aiRequestId === undefined
    ) {
      continue;
    }
    const session: DialogueSession = {
      id: request.id ?? nextDialogueSessionId(request.owner),
      owner: request.owner,
      priority: DIALOGUE_SESSION_PRIORITY[request.owner],
      interruptible: false,
      transcript: request.transcript ? [...request.transcript] : [],
      choice,
      ...(request.aiRequestId ? { aiRequestId: request.aiRequestId } : {}),
      ...(request.aiCharaNum !== undefined ? { aiCharaNum: request.aiCharaNum } : {}),
    };
    queue = enqueueDialogueSession(queue, session);
  }
  return queue.length === ui.dialogueQueue.length &&
    queue.every((session, index) => session === ui.dialogueQueue[index])
    ? {}
    : dialogueQueueMirrors(queue);
}

function resolveTransitionDialogues(
  state: GameState,
  transitions: readonly DomainTransition[],
  router: DialogueRouter,
  seed: number,
): { state: GameState; requests: DialogueEnqueueRequest[] } {
  let next = state;
  const requests: DialogueEnqueueRequest[] = [];
  let index = 0;
  for (const transition of transitions) {
    const resolved = resolveDomainTransitionDialogue(next, transition, {
      router,
      rng: createRng(seed + index * 104729),
      now: NOW,
    });
    index += 1;
    next = resolved.state;
    if (resolved.events.length === 0) continue;
    next = {
      ...next,
      eventLog: [...next.eventLog, ...resolved.events],
    };
    requests.push({
      owner:
        transition.kind === "rebellion-mark-acquired" ||
        transition.kind === "mark-acquired"
          ? "mark"
          : "state",
      transcript: resolved.events,
    });
  }
  return { state: next, requests };
}

function replaceActiveDialoguePatch(
  ui: DialogueUiSnapshot,
  transcript: readonly ObservationEvent[],
  choice: DialogueChoiceSession | null,
) {
  return dialogueQueueMirrors(
    replaceActiveDialogueSession(ui.dialogueQueue, transcript, choice),
  );
}

function advanceDialoguePatch(ui: DialogueUiSnapshot) {
  return dialogueQueueMirrors(advanceDialogueSession(ui.dialogueQueue));
}

interface GameStateStore {
  state: GameState | null;
  loading: boolean;
  error: string | null;
  lastSavedAt: number | null;
  saveSlots: SlotInfo[] | null;
  /** Typed owner-aware FIFO. The first entry is the active InteractionBox. */
  dialogueQueue: DialogueSession[];
  /** Compatibility projection of `dialogueQueue[0].transcript`. */
  pendingArrivalEvents: ObservationEvent[] | null;
  /** P2-02 — the dedicated 家庭菜園 (kitchen garden) surface is open. The
   *  FarmScreen stays mounted across multiple per-plot actions (water /
   *  harvest / plant / fertilize / uproot / harvest-all) and only closes
   *  when the player picks the explicit 退出 button. Toggled by the
   *  GameClient when a COM418 intent fires in a PLACE_GARDEN room, and by
   *  FarmScreen when the player exits. Cleared on load / newGame. */
  farmScreenOpen: boolean;
  /** B9 prompt queued by applyIntentAction when a command has a PromptSpec
   *  but the intent carries no promptAnswer. The GameClient renders the
   *  corresponding menu; on pick it calls resolvePromptAnswer which re-issues
   *  the intent WITH the answer. Cleared on cancel / load / newGame. */
  pendingPrompt: {
    spec: PromptSpec;
    commandNo: number;
    target: number;
    /** Ephemeral selections for a HandlerEntry.stagedPrompt session. */
    selections?: readonly (number | string)[];
    staged?: boolean;
  } | null;
  /** Mid-kojo player choice paused (KOJO-CHOICE-PLAN P3). When a first-meeting
   *  ENCOUNTER kojo contains a `PRINTBUTTON`+`INPUT`+`SELECTCASE RESULT(S)`
   *  option, the run stops here until the player picks. The option labels
   *  live here so the UI can render buttons; `seed` is the same RNG seed
   *  used at the original encounter call so resume replays are stable.
   *  Cleared on resolve / load. */
  pendingKojoChoice: DialogueChoiceSession | null;
  /** P2-02 — toggle the dedicated farm surface. GameClient sets this when a
   *  COM418 intent arrives in a garden room; FarmScreen sets it back to
   *  false when the player exits. The store never sets it autonomously. */
  setFarmScreenOpen: (open: boolean) => void;

  /** Fetch the persisted state from Rust. On null, build a fresh one. */
  load: (projectRoot: string) => Promise<void>;
  /** Restore an existing manual save. On null, keep the current state. */
  restore: (projectRoot: string, slot?: SaveSlot) => Promise<boolean>;
  /** Persist the current state to Rust. No-op if state is null. */
  save: (projectRoot: string, slot?: SaveSlot) => Promise<boolean>;
  /** Refresh SAVE/LOAD slot metadata for the current project/save key. */
  refreshSaveSlots: (projectRoot: string) => Promise<void>;
  /** Apply an intent to the current state. No-op if state is null. */
  applyIntentAction: (intent: AgentIntent) => void;
  /** Start the dedicated full-screen battle surface after the command grid
   * already established its normal availability gates. */
  startDanmakuBattleAction: (commandNo: 411 | 480, target?: number) => boolean;
  appendDanmakuInputsAction: (frames: readonly BattleInput[]) => void;
  finishDanmakuBattleAction: (result: "victory" | "defeat" | "complete" | "aborted", playerLives: number) => void;
  finishFishingAction: (result: FishingSettlementOutcome, remainingLine: number) => void;
  /** Commit the in-flight fishing settlement kojo to the persistent eventLog
   *  and clear the terminal phase card. */
  commitFishingSettlementAction: () => void;
  startStoneContestAction: (options: StoneContestStartOptions) => boolean;
  appendStoneContestPlacementAction: (operation: StonePlacementOperation) => void;
  advanceStoneContestClockAction: (targetFrame: number) => void;
  resolveStoneContestRoundAction: () => void;
  continueStoneContestAction: () => void;
  withdrawStoneContestAction: () => void;
  forfeitStoneContestAction: () => void;
  commitStoneContestSettlementAction: () => void;
  renameStoneContestClerkAction: (name: string) => void;
  advanceStoneClerkStoryAction: () => void;
  leaveStoneContestLobbyAction: () => void;
  buyFishingGearAction: (kind: FishingGearKind, id: FishingRodId | FishingLineId) => { ok: boolean; message: string; spent: number };
  /** Resolve the pending B9 prompt with the player's answer (re-issue intent). */
  resolvePromptAnswer: (answer: PromptAnswer) => void;
  /** Cancel the pending B9 prompt (no intent issued). */
  cancelPrompt: () => void;
  /** Phase D (实玩反馈 #9): walk a multi-hop path (SKIP_MOVE) — narrate each
   *  pass-through encounter + cost time instead of teleporting. `rooms` is the
   *  ordered [first hop … destination] room list (findPath toLocations). The
   *  walk PAUSES at the first occupied relay (sets `state.walkSession`). */
  walkPathAction: (rooms: string[]) => void;
  /** Close the active dialogue session and advance to the next queued one.
   *  The legacy name remains while GameClient callers migrate. */
  clearArrivalPopup: () => void;
  /** Resolve the active mid-kojo choice with a deterministic replay. The
   *  replay replaces that session's transcript segment and never re-settles
   *  the owning command/event. */
  resolveKojoChoiceAction: (optionIndex: number | string) => void;
  /** Phase D slice 2: resolve the current mid-walk encounter with the player's
   *  无视/打招呼/停下来 choice; the walk resumes (or stops). */
  resolveWalkEncounterAction: (choice: WalkChoice) => void;
  /** Resolve the pending sleep session and run morning settlement. */
  finishSleepAction: (dailyEventAnswer?: boolean | PromptAnswer) => void;
  /** Resume a gameplay-affecting DAILY_EV prompt by replaying the settlement. */
  resolveDailyEventPromptAction: (answer: boolean | PromptAnswer) => void;
  /** Resolve the persisted world-level `@MAKANAI` prompt. */
  resolveMobMealAction: (answer: boolean) => void;
  /** Clear a legacy outing EV1 session without inventing a battle result. */
  resolveOutingEventAction: () => void;
  /** Commit the player's choice for a paused `outing-choice` session (P1-04). */
  resolveOutingChoiceAction: (answer: OutingChoiceValue | number) => void;
  /** Commit the resolved `outing-choice-result` lines into the persistent
   *  eventLog and clear the dedicated dark-frame result panel. */
  closeOutingChoiceResultAction: () => void;
  /** Cancel a paused `outing-choice` session without applying effects. */
  cancelOutingChoiceAction: () => void;
  /** Resolve the day-end generated-character remember/forget choice. */
  resolveMobGirlMemoryAction: (remember: boolean, replaceSlot?: number) => void;
  /** Commit the explicit [100] 睁开眼睛 menu action. */
  openEyesAction: () => void;
  /** Buy one catalog item through the 起床前主菜单's 隙间商店 page. */
  buyCatalogItemAction: (itemId: number, qty?: number) => ShopBuyResult;
  /** SHOP [104] — run the same authoritative effect as COMF490. */
  useInventoryItemAction: (itemId: number) => { ok: boolean; message: string };
  setWakeMinuteAction: (minute: number) => void;
  /** Set the player's home (自宅) location string. The home is a room *inside*
   *  the player's home region (e.g. 神社:自室), not a standalone scene — this
   *  is the modern form of upstream `@SET_MAINHOME` (NEWGAME.ERB:181). */
  setHomeLocationAction: (homeLocation: string) => void;
  /** SHOP [160] 重置委托 — clear active commission slots + per-chara 委托状況/内容状态. */
  resetCommissionsAction: () => { resetSlots: number; resetFlags: number };
  /** SHOP [161] 重置服装 — restore NPC default outfits + clear coordinate 1-99 (master excluded). */
  resetClothesAction: () => { resetNpcs: number; resetCoords: number };
  /** SHOP [110] — release a selected caged insect. */
  releaseBugAction: (id: string) => boolean;
  /** SHOP [110] — turn a selected caged insect into its material class. */
  materializeBugAction: (id: string) => boolean;
  /** Toggle an Act_COM filter (Parity QA P-1) for the focused target. A pure
   *  preference write (the per-target 過濾器 flags / global 家事過濾器), not a
   *  settlement intent, so it goes through its own action, not `applyIntent`. */
  toggleFilterAction: (toggleId: number, target: number) => void;
  /** Flip `FLAG:立絵種類` (立絵↔顔絵 global toggle, eraTW OPTION [3]). A pure
   *  preference write, not a settlement intent. */
  togglePortraitKindAction: () => void;
  /** Update persisted Agent Runtime settings through the authoritative store. */
  updateAgentSettingsAction: (patch: Partial<AgentSettings>) => void;
  /** Build a fresh game state. With a `draft` (from the opening wizard,
   *  #13) it applies 称呼 / 性別 / 居住地 / 游戏模式; without one it uses the
   *  faithful NEWGAME defaults. */
  newGame: (draft?: NewGameDraft) => void;
  /** Drop the in-memory state (e.g. user cleared their last project). */
  reset: () => void;

  // --- 角色数值调试 (debug panel) ---
  /** Read a chara's 5 relationship stats (信頼度/好感度/親密/従順/欲望). */
  debugReadCharaGates: (charaNum: number) => CharaGates;
  /** Patch a chara's relationship stats (only the keys present). */
  debugPatchChara: (charaNum: number, patch: Partial<CharaGates>) => void;
  /** Read the master-only daily abilities exposed by the in-game debug popup. */
  debugReadMasterAbilities: () => MasterDebugAbilities;
  /** Patch only whitelisted master daily abilities (clamped to 0..5). */
  debugPatchMasterAbilities: (patch: Partial<MasterDebugAbilities>) => void;
}

export const useGameStateStore = create<GameStateStore>((set, get) => ({
  state: null,
  loading: false,
  error: null,
  lastSavedAt: null,
  saveSlots: null,
  dialogueQueue: [],
  pendingArrivalEvents: null,
  farmScreenOpen: false,
  pendingPrompt: null,
  pendingKojoChoice: null,

  async load(projectRoot) {
    cancelAgentNightCycle();
    cancelAllRealtimeAiKojo();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({ loading: true, error: null });
    try {
      const slots = await ipcListSaveSlots(projectRoot);
      const recentSlot = await ipcMostRecentSlot(projectRoot);
      const loaded = recentSlot === null ? null : await ipcLoadState(projectRoot, recentSlot);
      const loadedSlotInfo =
        recentSlot === null ? null : slots.find((slot) => slot.slot === recentSlot) ?? null;
      const baseline = buildInitialState();
      const migration =
        loaded === null || loaded === undefined
          ? null
          : migrateGameState(loaded, baseline);
      const next = migration?.state ?? baseline;
      setMasterWakeMinute(next, next.masterWakeMinute ?? 420);
      hydrateConfiguredCharaHomes(next);
      setSlotLocation(next.master, next.master.location);
      set({
        state: next,
        loading: false,
        error: null,
        lastSavedAt: loadedSlotInfo?.savedAt ?? null,
        saveSlots: slots,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingPrompt: null,
        pendingKojoChoice: null,
      });
    } catch (e) {
      set({
        state: buildInitialState(),
        loading: false,
        error: `load failed: ${String(e)}`,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingKojoChoice: null,
      });
    }
  },

  async restore(projectRoot, slot = 1) {
    cancelAgentNightCycle();
    cancelAllRealtimeAiKojo();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({ loading: true, error: null });
    try {
      const loaded = await ipcLoadState(projectRoot, slot);
      if (loaded === null || loaded === undefined) {
        set({ loading: false, error: "没有可读取的存档。", lastSavedAt: null });
        return false;
      }
      const migration = migrateGameState(loaded, buildInitialState());
      if (!migration.valid) {
        set({ loading: false, error: "存档内容损坏，无法读取。", lastSavedAt: null });
        return false;
      }
      const next = migration.state;
      setMasterWakeMinute(next, next.masterWakeMinute ?? 420);
      hydrateConfiguredCharaHomes(next);
      setSlotLocation(next.master, next.master.location);
      const slots = await ipcListSaveSlots(projectRoot);
      const info = slots.find((candidate) => candidate.slot === slot) ?? null;
      set({
        state: next,
        loading: false,
        error: null,
        lastSavedAt: info?.savedAt ?? null,
        saveSlots: slots,
        dialogueQueue: [],
        pendingArrivalEvents: null,
        farmScreenOpen: false,
        pendingPrompt: null,
        pendingKojoChoice: null,
      });
      return true;
    } catch (e) {
      set({
        loading: false,
        error: `load failed: ${String(e)}`,
      });
      return false;
    }
  },

  async save(projectRoot, slot = 1) {
    const s = get().state;
    if (s === null) return false;
    cancelVmDialogueContinuations(get().dialogueQueue);
    if (get().dialogueQueue.some((session) => session.choice?.continuationId)) {
      const queue = get().dialogueQueue.map((session) => session.choice?.continuationId
        ? { ...session, choice: null }
        : session);
      set(dialogueQueueMirrors(queue));
    }
    try {
      const savedAt = Date.now();
      await ipcSaveState(projectRoot, slot, s, saveSummary(s));
      const slots = await ipcListSaveSlots(projectRoot);
      set({ lastSavedAt: savedAt, saveSlots: slots, error: null });
      return true;
    } catch (e) {
      set({ error: `save failed: ${String(e)}` });
      return false;
    }
  },

  async refreshSaveSlots(projectRoot) {
    try {
      const slots = await ipcListSaveSlots(projectRoot);
      set({ saveSlots: slots, error: null });
    } catch (e) {
      set({ error: `save slot refresh failed: ${String(e)}` });
    }
  },

  applyIntentAction(intent) {
    const s = get().state;
    if (s === null) return;

    // B9 prompt intercept: if an ISSUE_COMMAND has no promptAnswer but the
    // handler declares a prompt, build a CommandContext, call entry.prompt(),
    // and surface the PromptSpec through pendingPrompt. The GameClient renders
    // the menu; on pick it calls resolvePromptAnswer which re-issues the
    // intent WITH the answer. This unblocks all B9 picker commands (413 做饭,
    // 418 菜園, 436 読書, 445 採集, 450 酒虫, 604 散歩, 617 甘味, 626 土産 etc.).
    if (intent.kind === "ISSUE_COMMAND" && (!intent.promptAnswer || currentIntentDeps().catalog.get(intent.commandNo)?.stagedPrompt)) {
      const { catalog, router } = currentIntentDeps();
      const entry = catalog.get(intent.commandNo);
      if (entry?.prompt) {
        const rng = createRng(intent.commandNo * 100003 + s.time.tickValue);
        const ctx: CommandContext = {
          state: s,
          actor: intent.actor,
          target: intent.target ?? intent.actor,
          commandNo: intent.commandNo,
          rng,
          now: NOW,
          dialogueRouter: router,
          promptAnswer: intent.promptAnswer,
        };
        const spec = entry.prompt(ctx);
        if (spec) {
          const selections =
            intent.promptAnswer?.kind === "pick_sequence"
              ? intent.promptAnswer.values
              : undefined;
          // P2-02 — open the dedicated 家庭菜園 surface when COM418 fires
          // its B9 picker in a PLACE_GARDEN room. The spec itself is
          // unchanged (the FarmScreen reads `pendingPrompt` and re-renders
          // the same option list as a 5-plot grid). We never auto-open
          // outside a garden — that mirrors `@COM_ABLE418`'s `家庭菜園可`
          // gate, so a stray keystroke in the wrong room falls through to
          // the standard handler execCheck and gets the same "这里没有…
          // 菜园" rejection as before.
          const openFarm =
            intent.commandNo === 418 &&
            !intent.promptAnswer &&
            hasPlace(placeFlagsOf(s.master.location), PLACE_GARDEN);
          set({
            farmScreenOpen: openFarm || get().farmScreenOpen,
            pendingPrompt: {
              spec,
              commandNo: intent.commandNo,
              target: intent.target ?? intent.actor,
              ...(selections ? { selections } : {}),
              ...(entry.stagedPrompt ? { staged: true } : {}),
            },
          });
          return; // Don't settle yet — wait for the player's answer.
        }
        // prompt returned null → the handler has a prompt but decided it's not
        // needed for current state (e.g. already cooking) — fall through and
        // let applyIntent settle normally.
      }
    }

    const intentDeps = currentIntentDeps();
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(intentDeps.router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const intentRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    let result: ReturnType<typeof applyIntent>;
    if (intentRouter && intentRouter !== intentDeps.router) {
      configureIntent({ dialogueRouter: intentRouter });
      try {
        result = applyIntent(s, intent);
      } finally {
        configureIntent({ dialogueRouter: intentDeps.router });
      }
    } else {
      result = applyIntent(s, intent);
    }
    const intentSeed =
      (intent.kind === "ISSUE_COMMAND" ? intent.commandNo : 0) * 100003 +
      s.time.tickValue;
    const transitionDialogue = resolveTransitionDialogues(
      result.state,
      result.transitions,
      intentDeps.router,
      intentSeed,
    );
    let next = transitionDialogue.state;
    const transitionRequests = transitionDialogue.requests;
    // Fishing kojo is fired at settlement, not command start. The
    // game-state-store keeps the in-flight session clean so the screen's
    // terminal phase card can render the per-outcome branch instead of
    // dumping it straight to the eventLog. A 621 command whose result still
    // carries dialogue lines must not open the command box either — those
    // lines belong to the settlement card.
    const fishingCommandActive =
      intent.kind === "ISSUE_COMMAND" && intent.commandNo === 621 && next.fishingGame !== null;
    const aiHistoryEntry =
      intent.kind === "ISSUE_COMMAND" &&
      intent.commandNo !== 621 &&
      (intent.target ?? intent.actor) > 0 &&
      result.commandOutcome !== undefined
        ? recordAiCommand({
            target: intent.target ?? intent.actor,
            commandNo: intent.commandNo,
            outcome: result.commandOutcome,
            state: next,
            events: result.appended,
          })
        : null;

    if (result.pendingKojoChoice) {
      const choice: DialogueChoiceSession = {
        kind: "command",
        charaNum: result.pendingKojoChoice.charaNum,
        commandNo: result.pendingKojoChoice.commandNo,
        seed: result.pendingKojoChoice.seed,
        choices: [...result.pendingKojoChoice.choices],
        options: [...result.pendingKojoChoice.options],
        continuationId: result.pendingKojoChoice.continuationId,
        continuationValues: result.pendingKojoChoice.continuationValues
          ? [...result.pendingKojoChoice.continuationValues]
          : undefined,
        continuationInputMode: result.pendingKojoChoice.continuationInputMode,
        transcriptStart: firstDialogueIndex(result.appended),
      };
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [
          {
            owner: "command",
            transcript: result.appended,
            choice,
          },
          ...transitionRequests,
        ]),
        error: null,
      });
      return;
    }

    // First-meeting hook — after every intent that may have changed master.location,
    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const choice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: intentSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [
          {
            owner: "event",
            transcript: result.appended.filter((e) => e.kind === "DIALOGUE_LINE"),
            choice,
          },
          ...transitionRequests,
        ]),
        error: null,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const choice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: intentSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: intentSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: next,
        ...enqueueDialogueRequestsPatch(get(), [
          {
            owner: capturedEventKojo.kind === "event" ? "event" : "diary",
            transcript: result.appended.filter((e) => e.kind === "DIALOGUE_LINE"),
            choice,
          },
          ...transitionRequests,
        ]),
        error: null,
      });
      return;
    }

    // First-meeting is transition-owned: master/NPC arrival or wake only.
    // An ordinary command that leaves everyone in place cannot rediscover an
    // old shared-room state.
    const { router } = currentIntentDeps();
    const transition = detectEncounterTransition(s, next);
    if (transition) {
      const fmSeed = (intent.kind === "ISSUE_COMMAND" ? intent.commandNo : 0) * 100003 + s.time.tickValue;
      const fmRng = createRng(fmSeed);
      const r = runFirstMeetingsForTransition(
        next,
        transition,
        { now: NOW, router, rng: fmRng },
        {
          dialogueSessionAvailable: encounterSessionAvailable(get()),
        },
      );
      if (r.events.length > 0) {
        // Unified with walkPathAction/openEyesAction: greeting地文 → band,
        // the encounter 口上 → InteractionBox modal (never open a fresh popup
        // on top of a prompt or an already-open box).
        const { inline, popup } = splitArrivalKojo(r.events);
        next = { ...next, eventLog: [...next.eventLog, ...inline] };
        if (popup && !get().pendingPrompt) {
          const choice = encounterChoiceSession(
            r,
            transition,
            fmSeed,
            0,
            inline.length,
          );
          const commandRequest: DialogueEnqueueRequest[] =
            intent.kind === "ISSUE_COMMAND" && !fishingCommandActive && result.appended.some((event) => event.kind === "DIALOGUE_LINE")
              ? [{ owner: "command", transcript: result.appended }]
              : [];
          set({
            state: next,
            ...enqueueDialogueRequestsPatch(get(), [
              ...commandRequest,
              { owner: "encounter", transcript: popup, choice },
              ...transitionRequests,
            ]),
            error: null,
          });
          return;
        }
      }
    }

    const preparedAi =
      intent.kind === "ISSUE_COMMAND" &&
      intent.commandNo !== 621 &&
      aiHistoryEntry &&
      result.commandOutcome !== undefined
        ? prepareRealtimeAiKojo({
            target: intent.target ?? intent.actor,
            commandNo: intent.commandNo,
            outcome: result.commandOutcome,
            beforeState: s,
            afterState: next,
            events: result.appended,
            promptAnswer: intent.promptAnswer,
            router: intentDeps.router,
            historyEntryId: aiHistoryEntry.id,
            seed: intentSeed,
          })
        : null;
    const normalCommandRequest: DialogueEnqueueRequest[] = preparedAi
      ? [
          {
            id: preparedAi.sessionId,
            owner: "command",
            // AI-first presentation: keep deterministic output projected but
            // undisplayed until this request finishes or fails.
            transcript: [],
            aiRequestId: preparedAi.requestId,
            aiCharaNum: preparedAi.target,
          },
        ]
      : intent.kind === "ISSUE_COMMAND" && !fishingCommandActive && (
        transitionRequests.length > 0 || result.appended.some((event) => event.kind === "DIALOGUE_LINE")
      )
        ? [
            {
              owner: "command",
              transcript: result.appended,
            },
          ]
        : [];
    const dialoguePatch = enqueueDialogueRequestsPatch(get(), [
      ...normalCommandRequest,
      ...transitionRequests,
    ]);
    if (preparedAi) {
      // `next` is the deterministic projected result used by the prompt. Do
      // not publish it until the streamed reaction finishes, so presentation
      // remains kojo first -> settlement second.
      set({ ...dialoguePatch, error: null });
	    } else {
	      set({ state: next, ...dialoguePatch, error: null });
	    }
    if (preparedAi) {
      let settlementCommitted = false;
      const commitProjectedSettlement = (): void => {
        if (settlementCommitted) return;
        settlementCommitted = true;
        // A load/reset replaces the state object and cancels AI. Never let an
        // obsolete request overwrite that newer authoritative state.
        if (get().state === s) set({ state: next, error: null });
      };
      const replaceStreamingAiLines = (
        lines: ReadonlyArray<{ text: string; form: "PRINTFORML" | "PRINTFORMDL" }>,
        pending: boolean,
        includeSettlement = false,
      ): void => {
        const ui = get();
        const index = ui.dialogueQueue.findIndex(
          (session) => session.id === preparedAi.sessionId &&
            session.aiRequestId === preparedAi.requestId,
        );
        if (index === -1) return; // Session was closed; never attach late text elsewhere.
        const transcript: ObservationEvent[] = [
          ...lines.map((line) => ({
            kind: "DIALOGUE_LINE" as const,
            timestamp: NOW(),
            charaNum: preparedAi.target,
            text: line.text,
            form: line.form,
            origin: "ai" as const,
          })),
          ...(includeSettlement ? result.appended : []),
        ];
        const queue = ui.dialogueQueue.map((session, sessionIndex) =>
          sessionIndex === index
            ? {
                ...session,
                transcript,
                aiRequestId: pending ? preparedAi.requestId : undefined,
              }
            : session);
        set(dialogueQueueMirrors(queue));
      };
      void generateRealtimeAiKojo(
        preparedAi,
        (partialLines) => replaceStreamingAiLines(partialLines, true),
      )
        .then((lines) => {
          replaceStreamingAiLines(lines, false, true);
          commitProjectedSettlement();
        })
        .catch(() => {
          // A provisional stream is presentation-only. If the final strict
          // validator rejects it, remove it, publish deterministic output and
          // settle the already-computed authoritative result.
          const ui = get();
          const index = ui.dialogueQueue.findIndex(
            (session) => session.id === preparedAi.sessionId &&
              session.aiRequestId === preparedAi.requestId,
          );
          if (index !== -1) {
            const queue = result.appended.length === 0
              ? ui.dialogueQueue.filter((_, sessionIndex) => sessionIndex !== index)
              : ui.dialogueQueue.map((session, sessionIndex) =>
                  sessionIndex === index
                    ? { ...session, transcript: [...result.appended], aiRequestId: undefined }
                    : session);
            set(dialogueQueueMirrors(queue));
          }
          commitProjectedSettlement();
        });
    }
  },

  startDanmakuBattleAction(commandNo, target) {
    const state = get().state;
    if (!state || state.danmakuBattle) return false;
    const battleTarget = target ?? 0;
    const targetName = battleTarget === 0 ? "训练弹幕" : state.charas[battleTarget]?.callName;
    if (!targetName) return false;
    const mode = commandNo === 411 ? "training" as const : "duel" as const;
    if (mode === "duel" && ![10, 120].includes(battleTarget)) return false;
    const seed = commandNo * 100003 + state.time.tickValue;
    const router = currentIntentDeps().router;
    const kojoLines = mode === "training" && battleTarget > 0 && router
      ? router.collect(battleTarget, commandNo, state, createRng(seed))
          .map((line) => ({ text: line.text }))
          .filter((line) => line.text.trim().length > 0)
      : [];
    const next = cloneGameState(state);
    next.danmakuBattle = {
      id: `danmaku-${seed}-${battleTarget}`,
      commandNo,
      config: { mode, target: battleTarget, targetName, pattern: patternForTarget(battleTarget, mode), seed },
      startedAtTick: state.time.tickValue,
      inputFrames: [],
      ...(kojoLines.length > 0 ? { kojoLines } : {}),
    };
    set({ state: next, error: null });
    return true;
  },

  appendDanmakuInputsAction(frames) {
    if (frames.length === 0) return;
    const state = get().state;
    if (!state?.danmakuBattle) return;
    const next = cloneGameState(state);
    next.danmakuBattle = { ...next.danmakuBattle!, inputFrames: [...next.danmakuBattle!.inputFrames, ...frames] };
    set({ state: next });
  },

  finishDanmakuBattleAction(outcome, playerLives) {
    const state = get().state;
    const session = state?.danmakuBattle;
    if (!state || !session) return;
    if (session.config.mode === "training") {
      const withoutSession = cloneGameState(state);
      withoutSession.danmakuBattle = null;
      if (outcome === "aborted") { set({ state: withoutSession }); return; }
      const eventLogLengthBeforeSettlement = withoutSession.eventLog.length;
      const settled = applyIntent(withoutSession, { kind: "ISSUE_COMMAND", actor: 0, commandNo: 411, ...(session.config.target > 0 ? { target: session.config.target } : {}) });
      if (session.kojoLines?.length) {
        settled.state.eventLog = [
          ...settled.state.eventLog.slice(0, eventLogLengthBeforeSettlement),
          ...settled.state.eventLog.slice(eventLogLengthBeforeSettlement).filter((event) => event.kind !== "DIALOGUE_LINE"),
        ];
      }
      set({ state: settled.state, error: null });
      return;
    }
    const next = cloneGameState(state);
    next.danmakuBattle = null;
    const won = outcome === "victory";
    const battle = settleDanmakuBattleCore(next, session.config.target, {
      won,
      opponentRemaining: won ? 0 : 1,
      masterRemaining: won ? Math.max(1, playerLives) : 0,
      turns: session.inputFrames.length,
      log: [],
    });
    if (battle.favorBonus !== 0) setTflag(next, TFLAG_ID.好感度BONUS, battle.favorBonus);
    const name = session.config.targetName;
    const events: ObservationEvent[] = [
      { kind: "NARRATION", timestamp: NOW(), text: won ? `你赢得了和${name}的胜负！` : `你输给了${name}……` },
      ...(battle.firstWin ? [{ kind: "NARRATION" as const, timestamp: NOW(), text: `【第一次战胜${name}】` }] : []),
      ...(battle.strongEnemyBonus ? [{ kind: "NARRATION" as const, timestamp: NOW(), text: "【强敌BONUS！所获经验提高】" }] : []),
      ...applySourceCheck(next, session.config.target, { [SOURCE_ID.歓楽]: battle.sourcePleasure }, 0, battle.trustSeed).events.map((event) => ({ ...event, timestamp: NOW() })),
      ...advanceTimeTicks(next, 60).map((event) => ({ ...event, timestamp: NOW() })),
    ];
    next.eventLog = [...next.eventLog, ...events];
    set({ state: finalizeActivityState(next, state.time.tickValue, 480), error: null });
  },

  finishFishingAction(outcome, remainingLine) {
    const state = get().state;
    if (!state?.fishingGame) return;
    const settled = finishFishingSession(state, outcome, remainingLine, NOW, {
      dialogueRouter: currentIntentDeps().router,
    });
    // Non-kojo events go straight into the persistent eventLog. The kojo
    // branch stays on the settlement payload until the player dismisses
    // the in-scene terminal phase card.
    const next: GameState = { ...settled.state, eventLog: [...settled.state.eventLog, ...settled.events], fishingSettlement: settled.settlement };
    set({ state: finalizeActivityState(next, state.time.tickValue, 621), error: null });
  },

  commitFishingSettlementAction() {
    const state = get().state;
    if (!state?.fishingSettlement) return;
    const settlement = state.fishingSettlement;
    const kojoEvents: ObservationEvent[] = settlement.settlementKojo.map((entry) => ({
      kind: "DIALOGUE_LINE" as const,
      charaNum: entry.charaNum,
      text: entry.text,
      timestamp: NOW(),
      ...(entry.form ? { form: entry.form } : {}),
    }));
    const next: GameState = {
      ...state,
      eventLog: [...state.eventLog, ...kojoEvents],
      fishingSettlement: null,
    };
    set({ state: next, error: null });
  },

  startStoneContestAction(options) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "lobby") return false;
    const next = startStoneContest(state, options);
    if (next.stoneContestSession?.phase !== "round") return false;
    set({ state: next, error: null });
    return true;
  },

  appendStoneContestPlacementAction(operation) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "round") return;
    set({ state: appendStoneContestPlacement(state, operation) });
  },

  advanceStoneContestClockAction(targetFrame) {
    const state = get().state;
    if (!state?.stoneContestSession || state.stoneContestSession.phase !== "round") return;
    set({ state: advanceStoneContestClock(state, targetFrame), error: null });
  },

  resolveStoneContestRoundAction() {
    const state = get().state;
    const session = state?.stoneContestSession;
    if (!state || !session || session.phase !== "round") return;
    const next = session.mode === "couple" ? resolveStoneCouple(state) : resolveSoloStoneRound(state);
    set({ state: next, error: null });
  },

  continueStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: continueStoneContest(state), error: null });
  },

  withdrawStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: withdrawStoneContest(state), error: null });
  },

  forfeitStoneContestAction() {
    const state = get().state;
    if (!state) return;
    set({ state: forfeitStoneContestRound(state), error: null });
  },

  commitStoneContestSettlementAction() {
    const state = get().state;
    if (!state) return;
    const settled = commitStoneContestSettlement(state, NOW);
    set({ state: finalizeActivityState(settled, state.time.tickValue, 633), error: null });
  },

  renameStoneContestClerkAction(name) {
    const state = get().state;
    if (!state) return;
    set({ state: renameStoneContestClerk(state, name), error: null });
  },

  advanceStoneClerkStoryAction() {
    const state = get().state;
    if (!state) return;
    set({ state: advanceStoneClerkStory(state), error: null });
  },

  leaveStoneContestLobbyAction() {
    const state = get().state;
    if (!state) return;
    set({ state: leaveStoneContestLobby(state), error: null });
  },

  buyFishingGearAction(kind, id) {
    const state = get().state;
    if (!state) return { ok: false, message: "尚未载入游戏状态。", spent: 0 };
    if (state.master.location !== "魔法之森:香霖堂") return { ok: false, message: "只有在香霖堂才能购买钓具。", spent: 0 };
    const next = cloneGameState(state);
    const result = buyFishingGear(next, kind, id);
    if (result.ok) {
      const event: ObservationEvent = { kind: "NARRATION", timestamp: NOW(), text: `香霖堂：${result.message}` };
      next.eventLog = [...next.eventLog, event];
      set({ state: next, error: null });
    }
    return result;
  },

  resolvePromptAnswer(answer) {
    const pp = get().pendingPrompt;
    if (!pp) return;
    set({ pendingPrompt: null });
    const choice =
      answer.kind === "pick_one"
        ? answer.value
        : answer.kind === "ask_yn"
          ? (answer.value ? 1 : 0)
          : null;
    const promptAnswer: PromptAnswer =
      pp.staged && choice !== null
        ? { kind: "pick_sequence", values: [...(pp.selections ?? []), choice] }
        : answer;
    // Re-issue with the answer. Staged handlers are intercepted again until
    // their prompt returns null; ordinary B9 handlers settle immediately.
    get().applyIntentAction({
      kind: "ISSUE_COMMAND",
      actor: 0,
      commandNo: pp.commandNo,
      target: pp.target,
      promptAnswer,
    });
  },

  cancelPrompt() {
    set({ pendingPrompt: null });
  },

  // P2-02 — toggle the dedicated 家庭菜園 surface. Closing also drops any
  // pending B9 prompt (so a stray option from the prior picker can't
  // resurrect in the next command); opening does NOT clear it because the
  // 418 prompt is the spec the FarmScreen renders.
  setFarmScreenOpen(open) {
    if (open) {
      set({ farmScreenOpen: true });
      return;
    }
    const pp = get().pendingPrompt;
    if (pp && pp.commandNo === 418) {
      set({ farmScreenOpen: false, pendingPrompt: null });
    } else {
      set({ farmScreenOpen: false });
    }
  },

  resolveMobMealAction(answer) {
    const state = get().state;
    if (!state?.mobMealSession) return;
    const next = cloneGameState(state);
    const oldTick = next.time.tickValue;
    const events = resolveMobMeal(next, answer, NOW);
    const rng = createRng(oldTick * 1009 + 202);
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng,
    });
    next.eventLog = [...next.eventLog, ...events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  resolveOutingEventAction() {
    const state = get().state;
    const session = state?.outingEventSession;
    if (!state || !session) return;
    // The legacy outing-ev1 modal is retired; clear it without settlement.
    if (session.kind === "outing-ev1") {
      const nextResult = resolveOutingEventSession(state);
      const next = nextResult.state;
      next.eventLog = [...next.eventLog, ...nextResult.events];
      set({ state: next, error: null });
      return;
    }
    // outing-choice sessions should be answered via resolveOutingChoiceAction;
    // calling the legacy resolver without an answer is a no-op.
    if (session.kind === "outing-choice") {
      return;
    }
    const nextResult = resolveOutingEventSession(state);
    const next = nextResult.state;
    const oldTick = state.time.tickValue;
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 301),
    });
    next.eventLog = [...next.eventLog, ...nextResult.events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  resolveOutingChoiceAction(answer) {
    const state = get().state;
    const session = state?.outingEventSession;
    if (!state || !session) return;
    if (session.kind !== "outing-choice") return;
    // The runtime hands the result events + final TFLAG bits + tick advance to
    // the `outing-choice-result` session. The popup persists; the events stay
    // inside the dark event-frame (实玩反馈: 路上遭遇完整呈现) until the player
    // explicitly dismisses via `closeOutingChoiceResultAction`.
    const nextResult = resolveOutingEventSession(state, { eventId: session.eventId, value: answer });
    const next = nextResult.state;
    const oldTick = state.time.tickValue;
    // The tick advanced inside the runtime; reproject schedules across the
    // delta so NPC positions move with the player while the result panel is
    // still up. Do NOT push result events to the eventLog yet — that happens
    // on close, so the popup stays the single source of truth for the
    // outcome text.
    reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 311),
    });
    set({ state: next, error: null });
  },

  closeOutingChoiceResultAction() {
    const state = get().state;
    if (!state || !state.outingEventSession) return;
    if (state.outingEventSession.kind !== "outing-choice-result") return;
    const { state: next, events } = commitOutingChoiceResult(state);
    const oldTick = state.time.tickValue;
    const scheduleEvents = reprojectSchedules(next, oldTick, next.time.tickValue, NOW, {
      dialogueRouter: currentIntentDeps().router,
      rng: createRng(oldTick * 1009 + 311),
    });
    next.eventLog = [...next.eventLog, ...events, ...scheduleEvents];
    set({ state: next, error: null });
  },

  cancelOutingChoiceAction() {
    const state = get().state;
    if (!state?.outingEventSession || state.outingEventSession.kind !== "outing-choice") return;
    const next = cloneGameState(state);
    next.outingEventSession = null;
    set({ state: next, error: null });
  },

  resolveMobGirlMemoryAction(remember, replaceSlot) {
    const state = get().state;
    if (!state?.mobGirlMemorySession) return;
    const next = cloneGameState(state);
    const message = resolveMobGirlMemory(next, remember, replaceSlot);
    if (!message) return;
    next.eventLog = [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: message }];
    set({ state: next, error: null });
    get().finishSleepAction();
  },

  walkPathAction(rooms) {
    const s = get().state;
    if (s === null || rooms.length === 0) return;
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const routeSalt = rooms.reduce((acc, room) => {
      let value = acc;
      for (let i = 0; i < room.length; i += 1) value = (value * 31 + room.charCodeAt(i)) >>> 0;
      return value;
    }, rooms.length);
    const rng = createRng(next.time.tickValue * 31 + routeSalt);
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const walkRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const { events } = startSkipMove(next, rooms, NOW, 0, { dialogueRouter: walkRouter, rng });

    const fmSeed = next.time.tickValue * 31 + routeSalt;
    const transition = detectEncounterTransition(s, next);
    const first = transition
      ? runFirstMeetingsForTransition(
          next,
          transition,
          { now: NOW, router, rng },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const allEvents = first.events.length > 0 ? [...events, ...first.events] : events;
    // Use a deterministic seed keyed on the route so a replay always produces
    // the same choice-encounter sequence.

    // Arrival-popup wiring (2026-07-04): if the destination has a present
    // NPC, the player reached an occupied room — pull the destination-
    // encounter kojo out of the eventLog tail and surface it via the
    // InteractionBox modal instead of the scene band. Without a present
    // NPC, the band handles narration as before.
    const dest = rooms[rooms.length - 1]!;
    let pendingArrivalEvents: ObservationEvent[] | null = null;
    let logEvents = allEvents;
    if (hasNpcAt(next, dest)) {
      const arrivalStart = allEvents.findIndex(
        (e) => e.kind === "DIALOGUE_LINE",
      );
      if (arrivalStart !== -1) {
        pendingArrivalEvents = allEvents.slice(arrivalStart);
        logEvents = allEvents.slice(0, arrivalStart);
      }
    }

    const capturedEventKojo = pendingEventKojo.current;
    const pendingChoice: DialogueChoiceSession | null = capturedEventKojo
      ? capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: fmSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: fmSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
      : transition
        ? encounterChoiceSession(
            first,
            transition,
            fmSeed,
            0,
            Math.max(0, logEvents.length - events.length),
          )
        : null;
    const owner: DialogueSessionOwner = capturedEventKojo
      ? capturedEventKojo.kind === "event" ? "event" : "diary"
      : first.pending ? "encounter" : "arrival";
    set({
      state: { ...next, eventLog: [...next.eventLog, ...logEvents] },
      ...enqueueDialoguePatch(get(), owner, pendingArrivalEvents, pendingChoice),
      error: null,
    });
  },

  clearArrivalPopup() {
    const continuationId = get().dialogueQueue[0]?.choice?.continuationId;
    if (continuationId) currentIntentDeps().router?.cancelContinuation?.(continuationId);
    const requestId = get().dialogueQueue[0]?.aiRequestId;
    if (requestId) cancelRealtimeAiKojo(requestId);
    set(advanceDialoguePatch(get()));
  },

  // KOJO-CHOICE-PLAN P3 — resume a paused first-meeting ENCOUNTER kojo.
  // Appends the picked option index to the session and replays the kojo
  // with the same seed. If it runs to completion, `pendingKojoChoice` is
  // cleared; if it pauses again, the new options replace the buffer.
  resolveKojoChoiceAction(optionIndex) {
    const s = get().state;
    const session = get().pendingKojoChoice;
    if (s === null || session === null) return;
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const legacyOptionIndex = typeof optionIndex === "number" ? optionIndex : null;
    const choices = legacyOptionIndex === null ? [] : [...session.choices, legacyOptionIndex];
    const rng = createRng(session.seed);
    if (session.kind === "command" && session.commandNo !== undefined) {
      if (session.continuationId && router?.resumeContinuation) {
        const value = session.continuationInputMode
          ? optionIndex
          : typeof optionIndex === "number" ? session.continuationValues?.[optionIndex] : undefined;
        if ((session.continuationInputMode === "number" && typeof value !== "number")
          || (session.continuationInputMode === "string" && typeof value !== "string")) {
          set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], session), error: "invalid VM kojo input" });
          return;
        }
        if (value === undefined) {
          router.cancelContinuation?.(session.continuationId);
          set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], null), error: "invalid VM kojo choice" });
          return;
        }
        const vm = router.resumeContinuation(session.continuationId, value);
        const baseEvents = mergeReplayedTranscript(
          get().pendingArrivalEvents ?? [],
          session.transcriptStart,
          kojoLinesToEvents(vm.resolution.lines, session.charaNum),
        );
        if (vm.pending && vm.continuationId) {
          const nextChoice: DialogueChoiceSession = {
            ...session,
            options: [...vm.pending.options],
            continuationId: vm.continuationId,
            continuationValues: vm.pending.values ? [...vm.pending.values] : undefined,
            continuationInputMode: vm.pending.inputMode,
          };
          set({ state: next, ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice), error: null });
          return;
        }
        set({
          state: (() => {
            const settled = vm.resolution.effects.length > 0 ? applyKojoEffects(next, vm.resolution.effects) : next;
            clearTurnContext(settled);
            return settled;
          })(),
          ...replaceActiveDialoguePatch(get(), baseEvents, null),
          error: vm.resolution.status === "unsupported" ? "VM kojo continuation failed" : null,
        });
        return;
      }
      if (legacyOptionIndex === null) return;
      // IMPORTANT: the seed must be the same as the first call so the
      // replay deterministically retraces the pre-choice lines.
      const kojo = commandKojoEventsFromSession(
        {
          state: next,
          actor: 0,
          target: session.charaNum,
          commandNo: session.commandNo,
          rng,
          rngSeed: session.seed,
          now: NOW,
          dialogueRouter: router,
        },
        { charaNum: session.charaNum, commandNo: session.commandNo, choices },
      );
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojo.events,
      );
      if (kojo.pendingKojoChoice) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...kojo.pendingKojoChoice.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: (() => {
          const settled = kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next;
          clearTurnContext(settled);
          return settled;
        })(),
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind === "dayevent" && session.subid !== undefined) {
      if (legacyOptionIndex === null) return;
      const kojo = dayEventKojoEventsFromSession(
        next,
        {
          charaNum: session.charaNum,
          subid: session.subid,
          args: session.args,
          choices,
        },
        router,
        rng,
        NOW,
      );
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojo.events,
      );
      if (kojo.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...kojo.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind === "event" && session.arm !== undefined) {
      if (legacyOptionIndex === null) return;
      const r = router?.resolveEventKojoInteractive
        ? router.resolveEventKojoInteractive(
          session.charaNum,
          session.arm,
          next,
          rng,
          session.args,
          choices,
        )
        : (() => {
            const detailed = router?.resolveEventKojoDetailed?.(
              session.charaNum,
              session.arm,
              next,
              rng,
              session.args ? [...session.args] : undefined,
            );
            return {
              status: detailed?.status ?? "not-authored",
              lines: detailed?.lines ??
                router?.resolveEventKojo(session.charaNum, session.arm, next, rng, session.args) ??
                [],
              pending: null,
              effects: detailed?.effects ?? [],
              unsupportedPredicates: detailed?.unsupportedPredicates ?? [],
              unsupportedEffects: detailed?.unsupportedEffects ?? [],
              diagnostics: detailed?.diagnostics ?? [],
            };
          })();
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojoLinesToEvents(r.lines, session.charaNum),
      );
      if (r.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...r.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: r.effects?.length ? applyKojoEffects(next, r.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind === "diary" && session.page !== undefined) {
      if (legacyOptionIndex === null) return;
      const r = router?.resolveDiaryKojoInteractive
        ? router.resolveDiaryKojoInteractive(
          session.charaNum,
          session.page,
          next,
          rng,
          session.args,
          choices,
        )
        : (() => {
            const detailed = router?.resolveDiaryKojoDetailed?.(
              session.charaNum,
              session.page,
              next,
              rng,
              session.args ? [...session.args] : undefined,
            );
            return {
              status: detailed?.status ?? "not-authored",
              lines: detailed?.lines ??
                router?.resolveDiaryKojo?.(session.charaNum, session.page, next, rng, session.args) ??
                [],
              pending: null,
              effects: detailed?.effects ?? [],
              unsupportedPredicates: detailed?.unsupportedPredicates ?? [],
              unsupportedEffects: detailed?.unsupportedEffects ?? [],
              diagnostics: detailed?.diagnostics ?? [],
            };
          })();
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [],
        session.transcriptStart,
        kojoLinesToEvents(r.lines, session.charaNum),
      );
      if (r.pending) {
        const nextChoice: DialogueChoiceSession = {
          ...session,
          choices,
          options: [...r.pending.options],
        };
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, nextChoice),
          error: null,
        });
        return;
      }
      set({
        state: r.effects?.length ? applyKojoEffects(next, r.effects) : next,
        ...replaceActiveDialoguePatch(get(), baseEvents, null),
        error: null,
      });
      return;
    }
    if (session.kind !== "encounter") return;
    if (session.continuationId && router?.resumeContinuation) {
      const value = session.continuationInputMode
        ? optionIndex
        : typeof optionIndex === "number" ? session.continuationValues?.[optionIndex] : undefined;
      if ((session.continuationInputMode === "number" && typeof value !== "number")
        || (session.continuationInputMode === "string" && typeof value !== "string") || value === undefined) {
        router.cancelContinuation?.(session.continuationId);
        set({ ...replaceActiveDialoguePatch(get(), get().pendingArrivalEvents ?? [], null), error: "invalid VM encounter input" });
        return;
      }
      const vm = router.resumeContinuation(session.continuationId, value);
      const baseEvents = mergeReplayedTranscript(
        get().pendingArrivalEvents ?? [], session.transcriptStart,
        kojoLinesToEvents(vm.resolution.lines, session.charaNum),
      );
      if (vm.pending && vm.continuationId) {
        set({
          state: next,
          ...replaceActiveDialoguePatch(get(), baseEvents, {
            ...session, options: [...vm.pending.options], continuationId: vm.continuationId,
            continuationValues: vm.pending.values ? [...vm.pending.values] : undefined,
            continuationInputMode: vm.pending.inputMode,
          }),
          error: null,
        });
        return;
      }
      if (vm.resolution.status === "unsupported") {
        set({ state: next, ...replaceActiveDialoguePatch(get(), baseEvents, null), error: "VM encounter continuation failed" });
        return;
      }
      const settled = vm.resolution.effects.length > 0 ? applyKojoEffects(next, vm.resolution.effects) : next;
      const met = settled.charas[session.charaNum];
      if (met) setCharaCflag(settled, session.charaNum, CFLAG_ID.认识, 1);
      const continuation = session.encounterContinuation;
      if (continuation && continuation.candidateCharaNums.length > 0) {
        const transition: EncounterTransition = { kind: continuation.kind, location: continuation.location, candidateCharaNums: [...continuation.candidateCharaNums] };
        const continued = runFirstMeetingsForTransition(settled, transition, { now: NOW, router, rng });
        const nextChoice = encounterChoiceSession(continued, transition, session.seed, baseEvents.length);
        set({ state: settled, ...replaceActiveDialoguePatch(get(), [...baseEvents, ...continued.events], nextChoice), error: null });
        return;
      }
      set({ state: settled, ...replaceActiveDialoguePatch(get(), baseEvents, null), error: null });
      return;
    }
    const r = runFirstMeeting(
      next,
      session.charaNum,
      { now: NOW, router, rng },
      choices,
      { replaying: true },
    );
    const baseEvents = mergeReplayedTranscript(
      get().pendingArrivalEvents ?? [],
      session.transcriptStart,
      r.events,
    );
    if (r.pending) {
      // Still paused — refresh the buffer with the cumulative lines and
      // keep the session growing; the player will pick again.
      set({
        state: next,
        ...replaceActiveDialoguePatch(
          get(),
          baseEvents,
          { ...session, choices, options: r.pending.options },
        ),
        error: null,
      });
      return;
    }
    const continuation = session.encounterContinuation;
    if (continuation && continuation.candidateCharaNums.length > 0) {
      const transition: EncounterTransition = {
        kind: continuation.kind,
        location: continuation.location,
        candidateCharaNums: [...continuation.candidateCharaNums],
      };
      const continued = runFirstMeetingsForTransition(
        next,
        transition,
        { now: NOW, router, rng },
      );
      const continuationStart = baseEvents.length;
      const completedEvents = [...baseEvents, ...continued.events];
      const nextChoice = encounterChoiceSession(
        continued,
        transition,
        session.seed,
        continuationStart,
      );
      set({
        state: next,
        ...replaceActiveDialoguePatch(get(), completedEvents, nextChoice),
        error: null,
      });
      return;
    }

    // Kojo finished and there are no remaining scene candidates.
    set({
      state: next,
      ...replaceActiveDialoguePatch(get(), baseEvents, null),
      error: null,
    });
  },

  resolveWalkEncounterAction(choice) {
    const s = get().state;
    if (s === null || !s.walkSession) return;
    const next = cloneGameState(s);
    const { router } = currentIntentDeps();
    const ws = next.walkSession;
    if (!ws) return;
    // The pause is either a mid-walk encounter or a locked-door (潜入/算了);
    // seed the RNG from whichever owner is present so 潜入's wake roll is stable.
    const owner = ws.lockedDoor?.ownerCharaNum ?? ws.encounter?.charaNum ?? 0;
    const choiceSalt =
      choice === "stop" ? 1 : choice === "ignore" ? 2 : choice === "sneak" ? 4 : choice === "giveup" ? 5 : 3;
    const seed = next.time.tickValue * 31 + owner * 7 + choiceSalt;
    const rng = createRng(seed);
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const walkRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const { events } = resolveWalkEncounter(next, choice, NOW, 0, { dialogueRouter: walkRouter, rng });
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...events] },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: null,
      });
      return;
    }
    const transition = detectEncounterTransition(s, next);
    const first = transition
      ? runFirstMeetingsForTransition(
          next,
          transition,
          { now: NOW, router, rng: createRng(seed + 17) },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const { inline, popup } = splitArrivalKojo(first.events);
    const pendingChoice = transition
      ? encounterChoiceSession(first, transition, seed + 17, 0, inline.length)
      : null;
    set({
      state: {
        ...next,
        eventLog: [...next.eventLog, ...events, ...inline],
      },
      ...enqueueDialoguePatch(get(), "encounter", popup, pendingChoice),
      error: null,
    });
  },

  finishSleepAction(dailyEventAnswer) {
    const s = get().state;
    if (s === null) return;
    if (s.mobGirlMemorySession) return;
    const activeDailyEvent = s.dailyEventSession ?? null;
    if (activeDailyEvent && dailyEventAnswer === undefined) return;
    if (!activeDailyEvent && dailyEventAnswer !== undefined) return;
    const next = cloneGameState(s);
    // DAYEVENT (Slice 1) — pass the live router + a seeded RNG so
    // night/morning subevents can fire SP_EVENT kojo and write the
    // MVP source-derived effects. RNG seed = dayIndex × 31 + a salt so
    // each night/morning has its own deterministic draw. Without
    // currentIntentDeps() (e.g. before App.tsx has wired a router),
    // the call falls back to undefined → DAYEVENT is silently skipped.
    const { router } = currentIntentDeps();
    const sleepSeed = activeDailyEvent?.sleepSeed ?? ((next.time.dayIndex + 1) * 31 + 7 + Math.floor(Math.random() * 1000000));
    const rng = createRng(sleepSeed);
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const dayEventRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    // P0-1 (实玩反馈 #12): finishPlayerSleep runs advanceClock /
    // reprojectSchedules / executeDayEvent / greetingLinesFromRouter — any
    // throw here used to skip the set() below, leaving sleepSession set and
    // the NightSettlementScreen permanently pending (the auto-settlement
    // step looked dead). Wrap it so a settlement error can NEVER lock the
    // UI: on failure we roll back every partial settlement write, then clear
    // only the UI-blocking sleep state on a fresh clone of the pre-settlement
    // save. A failed DAYEVENT/router must never leave a half-advanced day that
    // cannot be safely retried or reasoned about.
    let events = [] as ReturnType<typeof finishPlayerSleep>;
    try {
      events = finishPlayerSleep(next, NOW, dayEventRouter, rng, {
        sleepSeed,
        ...(dailyEventAnswer === undefined
          ? {}
          : {
              answer: typeof dailyEventAnswer === "boolean"
                ? { kind: "ask_yn", value: dailyEventAnswer } as const
                : dailyEventAnswer,
            }),
      });
    } catch (e) {
      const recovered = cloneGameState(s);
      recovered.sleepSession = null;
      // Clear the 睡眠 flag through the namespace-safe accessor (the UI layer
      // must not reach into the legacy per-chara namespaces directly — see the
      // forbidden-names guard test).
      setMasterCflag(recovered, CFLAG_ID.睡眠, 0);
      events = [
        {
          kind: "NARRATION",
          timestamp: NOW(),
          text: "夜间结算出现异常，已跳过夜事件并强制醒来。",
        },
      ];
      set({
        state: { ...recovered, eventLog: [...recovered.eventLog, ...events] },
        error: `sleep settlement failed: ${String(e)}`,
      });
      return;
    }
    if (events.pendingDailyEvent) {
      const paused = cloneGameState(s);
      paused.dailyEventSession = events.pendingDailyEvent.session;
      set({ state: paused, error: null });
      return;
    }
    // A4 — fire multi-agent night cognitive cycle asynchronously.
    // The deterministic settlement MUST complete and display immediately;
    // agent results append later via the .then() callback. This avoids
    // blocking the player on LLM latency (up to 60s per batch).
    // Each dirty active-roster character is processed independently;
    // per-character failures are isolated.
    const aiSettings = useAiStore.getState().settings;
    cancelAgentNightCycle();
    const generation = agentNightGeneration;
    const requestDay = next.time.dayIndex;
    const observationDay = Math.max(0, requestDay - 1);
    for (const charaNum of eligibleAgentCharaNums(next)) {
      compileObservations(next, charaNum, observationDay);
    }
    const agentSnapshot = cloneGameState(next);
    const controller = new AbortController();
    agentNightController = controller;
    runMultiAgentNightCycle(agentSnapshot, aiSettings, {
      signal: controller.signal,
      observationDayIndex: observationDay,
    }).then((allResults) => {
      if (generation !== agentNightGeneration || controller.signal.aborted) return;
      if (!allResults || allResults.length === 0) return;
      const s = get();
      if (!s.state || s.state.time.dayIndex !== requestDay) return;
      const committed = cloneGameState(s.state);
      const currentRuntime = ensureAgentRuntime(committed);
      const snapshotRuntime = agentSnapshot.agentRuntime;
      if (!snapshotRuntime) return;
      for (const charaNum of Object.keys(snapshotRuntime.cognitions).map(Number)) {
        currentRuntime.cognitions[charaNum] = structuredClone(snapshotRuntime.cognitions[charaNum]);
      }
      currentRuntime.acceptedDecisions = structuredClone(snapshotRuntime.acceptedDecisions);
      currentRuntime.decisionSeq = snapshotRuntime.decisionSeq;
      const log = [...s.state.eventLog];
      for (const result of allResults) {
        for (const e of result.events) {
          log.push({ kind: e.kind, text: e.text, timestamp: NOW(), charaNum: e.charaNum } as typeof log[number]);
        }
      }
      committed.eventLog = log;
      set({ state: committed });
    }).catch(() => {
      // Agent failures are silent during night settlement.
    }).finally(() => {
      if (generation === agentNightGeneration) agentNightController = null;
    });
    const dailyEventError = events.dailyEventDiagnostics?.length
      ? `daily event failed closed: ${events.dailyEventDiagnostics.map((entry) =>
          `${entry.eventId ?? "?"}/${entry.phase}: ${entry.message}`).join("; ")}`
      : null;
    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const pendingChoice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: sleepSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...events] },
        ...enqueueDialoguePatch(
          get(),
          "event",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: dailyEventError,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: sleepSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: sleepSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: [...next.eventLog, ...events] },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: dailyEventError,
      });
      return;
    }
    const wakeTransition = detectEncounterTransition(s, next);
    const firstSeed = sleepSeed + 11;
    const first = wakeTransition
      ? runFirstMeetingsForTransition(
          next,
          wakeTransition,
          { now: NOW, router, rng: createRng(firstSeed) },
          {
            dialogueSessionAvailable: encounterSessionAvailable(get()),
          },
        )
      : {
          events: [],
          pending: null,
          pendingCharaNum: null,
          pendingEventStart: null,
          remainingCandidateCharaNums: [],
        };
    const { inline, popup } = splitArrivalKojo(first.events);
    const pendingChoice = wakeTransition
      ? encounterChoiceSession(first, wakeTransition, firstSeed, 0, inline.length)
      : null;
    set({
      state: { ...next, eventLog: [...next.eventLog, ...events, ...inline] },
      // Ordinary EVENT 2 morning lines are returned by the runtime as
      // DIALOGUE_LINE events.  Keep them in the owner-aware dialogue queue;
      // eventLog alone is only the audit trail and is not rendered by the
      // InteractionBox.  Encounter popup lines follow them when present.
      ...enqueueDialoguePatch(
        get(),
        popup && popup.length > 0 ? "encounter" : "event",
        [...events.filter((e) => e.kind === "DIALOGUE_LINE"), ...(popup ?? [])],
        pendingChoice,
      ),
      error: dailyEventError,
    });
  },

  resolveDailyEventPromptAction(answer) {
    const state = get().state;
    if (!state?.dailyEventSession) return;
    get().finishSleepAction(answer);
  },

  openEyesAction() {
    const s = get().state;
    if (s === null) return;
    // Night settlement dialogue belongs to the night report. Do not let a
    // queued EVENT/DAYEVENT session reappear over the next day's first command.
    // New morning encounter dialogue is enqueued below after this boundary.
    cancelVmDialogueContinuations(get().dialogueQueue);
    for (const session of get().dialogueQueue) {
      if (session.aiRequestId) cancelRealtimeAiKojo(session.aiRequestId);
    }
    set(dialogueQueueMirrors([]));
    const next = cloneGameState(s);
    // DAY-CYCLE-PLAN §S2 — delegate the whole [100] 睁开眼睛 body to the
    // runtime `openEyes`: pin the clock forward (monotonic — no more 08:00→
    // 07:00 rewind), wake the master in their 私室, run the shared morning
    // pipeline (visit/encounter/commission; DAYEVENT-day / おはよう stay
    // skipped because no router is passed on this path), re-baseline the
    // daily-report snapshot. Seed unified with finishSleepAction:
    // (dayIndex+1)*31+7.
    const openEyesSeed = (next.time.dayIndex + 1) * 31 + 7 + Math.floor(Math.random() * 1000000);
    const rng = createRng(openEyesSeed);
    const { router } = currentIntentDeps();
    const pendingDayEventKojo: { current: {
      charaNum: number;
      subid: number;
      args?: number[];
      pending: PendingKojoChoice;
    } | null } = { current: null };
    const pendingEventKojo: { current: EventKojoPendingCapture | null } = { current: null };
    const eventRouter = createInteractiveEventRouter(router, (session) => {
      if (!pendingEventKojo.current) pendingEventKojo.current = session;
    });
    const openEyesRouter = createInteractiveDayEventRouter(eventRouter, (session) => {
      if (!pendingDayEventKojo.current) pendingDayEventKojo.current = session;
    });
    const events = openEyes(next, { now: NOW, rng, router: openEyesRouter });
    let logEvents = [...next.eventLog, ...events];

    const capturedDayEventKojo = pendingDayEventKojo.current;
    if (capturedDayEventKojo) {
      const pendingChoice: DialogueChoiceSession = {
        kind: "dayevent",
        charaNum: capturedDayEventKojo.charaNum,
        subid: capturedDayEventKojo.subid,
        args: capturedDayEventKojo.args ? [...capturedDayEventKojo.args] : undefined,
        seed: openEyesSeed,
        choices: [],
        options: [...capturedDayEventKojo.pending.options],
        transcriptStart: 0,
      };
      set({
        state: { ...next, eventLog: logEvents },
        ...enqueueDialoguePatch(
          get(),
          "event",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: null,
      });
      return;
    }
    const capturedEventKojo = pendingEventKojo.current;
    if (capturedEventKojo) {
      const pendingChoice: DialogueChoiceSession = capturedEventKojo.kind === "event"
        ? {
            kind: "event",
            charaNum: capturedEventKojo.charaNum,
            arm: capturedEventKojo.arm,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: openEyesSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          }
        : {
            kind: "diary",
            charaNum: capturedEventKojo.charaNum,
            page: capturedEventKojo.page,
            args: capturedEventKojo.args ? [...capturedEventKojo.args] : undefined,
            seed: openEyesSeed,
            choices: [],
            options: [...capturedEventKojo.pending.options],
            transcriptStart: 0,
          };
      set({
        state: { ...next, eventLog: logEvents },
        ...enqueueDialoguePatch(
          get(),
          capturedEventKojo.kind === "event" ? "event" : "diary",
          events.filter((e) => e.kind === "DIALOGUE_LINE"),
          pendingChoice,
        ),
        error: null,
      });
      return;
    }

    const wakeTransition = detectEncounterTransition(s, next);
    if (wakeTransition) {
      const fmSeed = openEyesSeed + 11;
      const first = runFirstMeetingsForTransition(
        next,
        wakeTransition,
        { now: NOW, router, rng: createRng(fmSeed) },
        {
          dialogueSessionAvailable: encounterSessionAvailable(get()),
        },
      );
      if (first.events.length > 0) {
        // Same split as applyIntentAction/walkPathAction: greeting地文 → band,
        // encounter 口上 → InteractionBox modal, so waking up next to an unmet
        // NPC pops the kojo consistently instead of burying it in the log.
        const { inline, popup } = splitArrivalKojo(first.events);
        logEvents = [...logEvents, ...inline];
        if (popup) {
          const pendingChoice = encounterChoiceSession(
            first,
            wakeTransition,
            fmSeed,
            0,
            inline.length,
          );
          set({
            state: { ...next, eventLog: logEvents },
            ...enqueueDialoguePatch(get(), "encounter", popup, pendingChoice),
            error: null,
          });
          return;
        }
      }
    }

    set({ state: { ...next, eventLog: logEvents }, error: null });
  },

  buyCatalogItemAction(itemId, qty = 1) {
    const s = get().state;
    const entry = catalogEntry(itemId);
    if (s === null || entry === undefined) {
      return {
        ok: false,
        code: ITEM_STOCK_CODE.NO_ITEM,
        unitPrice: 0,
        total: 0,
        qty,
      };
    }
    const next = cloneGameState(s);
    const result = shopBuy(next, itemId, qty);
    if (result.ok) {
      const event: ObservationEvent = {
        kind: "NARRATION",
        timestamp: NOW(),
        text: `在隙间商店买了${entry.name} ×${qty}（${result.total.toLocaleString()} 円）。`,
      };
      set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
    }
    return result;
  },

  useInventoryItemAction(itemId) {
    const s = get().state;
    if (s === null) return { ok: false, message: "尚未载入游戏状态。" };
    const next = cloneGameState(s);
    const result = applyMasterConsumable(next, itemId);
    if (!result.ok) return { ok: false, message: result.message };
    const timestamp = NOW();
    const clockEvents = result.clockEvents.map((event) => ({ ...event, timestamp }));
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp,
      text: result.message,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, ...clockEvents, event] }, error: null });
    return { ok: true, message: result.message };
  },

  setWakeMinuteAction(minute) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    const normalized = setMasterWakeMinute(next, minute);
    const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mm = String(normalized % 60).padStart(2, "0");
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `起床预定时刻设定为 ${hh}:${mm}。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
  },

  setHomeLocationAction(homeLocation) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    next.homeLocation = homeLocation;
    // 搬家 while still asleep (起床前菜单): move the sleeping master to the new
    // 私室 so [当前位置] / 睁眼 落点 stay consistent.
    if (next.sleepSession) {
    setSlotLocation(next.master, homeLocation);
    }
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `自宅位置设定为 ${homeLocation}。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
  },

  /** SHOP [160] 重置委托 — clear all active commission slots + per-chara 委托状況/内容状态. */
  resetCommissionsAction() {
    const s = get().state;
    if (s === null) return { resetSlots: 0, resetFlags: 0 };
    const next = cloneGameState(s);
    const result = resetAllCommissions(next);
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `重置委托：清空 ${result.resetSlots} 个进行中委托, 归零 ${result.resetFlags} 个角色状态。`,
    };
    set({ state: { ...next, eventLog: [...next.eventLog, event] }, error: null });
    return result;
  },

  /** SHOP [161] 重置服装 — restore all NPC default outfits + clear coordinate 1-99 snapshots (master excluded). */
  resetClothesAction() {
    const s = get().state;
    if (s === null) return { resetNpcs: 0, resetCoords: 0 };
    // resetAllClothes already clones the state internally; pass `s` directly.
    const result = resetAllClothes(s);
    const event: ObservationEvent = {
      kind: "NARRATION",
      timestamp: NOW(),
      text: `重置服装：恢复 ${result.resetNpcs} 名角色的默认便装, 清空 ${result.resetCoords} 个自定义套装。`,
    };
    set({ state: { ...result.next, eventLog: [...result.next.eventLog, event] }, error: null });
    return { resetNpcs: result.resetNpcs, resetCoords: result.resetCoords };
  },

  releaseBugAction(id) {
    const s = get().state;
    if (s === null) return false;
    const next = cloneGameState(s);
    const released = releaseCaughtBug(next, id);
    if (!released) return false;
    set({
      state: { ...next, eventLog: [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: "放生了虫笼中的昆虫。" }] },
      error: null,
    });
    return true;
  },

  materializeBugAction(id) {
    const s = get().state;
    if (s === null) return false;
    const next = cloneGameState(s);
    const materialized = materializeCaughtBug(next, id);
    if (!materialized) return false;
    set({
      state: { ...next, eventLog: [...next.eventLog, { kind: "NARRATION", timestamp: NOW(), text: "将虫笼中的昆虫制成了素材。" }] },
      error: null,
    });
    return true;
  },

  toggleFilterAction(toggleId, target) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    toggleComFilter(toggleId, target, next);
    set({ state: next, error: null });
  },

  togglePortraitKindAction() {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    togglePortraitKind(next);
    set({ state: next, error: null });
  },

  updateAgentSettingsAction(patch) {
    const state = get().state;
    if (!state) return;
    const next = cloneGameState(state);
    const runtime = ensureAgentRuntime(next);
    const maxActiveAgents = patch.maxActiveAgents === undefined
      ? runtime.settings.maxActiveAgents
      : Math.max(1, Math.min(10, Math.trunc(patch.maxActiveAgents)));
    const validCharaNums = new Set(Object.keys(next.charas).map(Number).filter((id) => id > 0));
    const normalizeList = (values: readonly number[] | undefined, fallback: number[]): number[] =>
      values === undefined
        ? fallback
        : [...new Set(values.filter((id) => validCharaNums.has(id)))].slice(0, 10);
    runtime.settings = {
      ...runtime.settings,
      ...patch,
      maxActiveAgents,
      pinnedCharaNums: normalizeList(patch.pinnedCharaNums, runtime.settings.pinnedCharaNums),
      excludedCharaNums: normalizeList(patch.excludedCharaNums, runtime.settings.excludedCharaNums),
    };
    runtime.settings.pinnedCharaNums = runtime.settings.pinnedCharaNums
      .filter((id) => !runtime.settings.excludedCharaNums.includes(id))
      .slice(0, maxActiveAgents);
    if (!runtime.settings.masterEnabled) cancelAgentNightCycle();
    set({ state: next, error: null });
  },

  newGame(draft) {
    cancelAgentNightCycle();
    cancelAllRealtimeAiKojo();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({
      state: buildInitialState(NOW(), draft),
      loading: false,
      error: null,
      farmScreenOpen: false,
      pendingPrompt: null,
      dialogueQueue: [],
      pendingArrivalEvents: null,
      pendingKojoChoice: null,
    });
  },

  reset() {
    cancelAgentNightCycle();
    cancelAllRealtimeAiKojo();
    cancelVmDialogueContinuations(get().dialogueQueue);
    useAiStore.getState().resetEphemeral();
    set({
      state: null,
      loading: false,
      error: null,
      lastSavedAt: null,
      saveSlots: null,
      farmScreenOpen: false,
      pendingPrompt: null,
      dialogueQueue: [],
      pendingArrivalEvents: null,
      pendingKojoChoice: null,
    });
  },

  // --- 角色数值调试 (debug panel) ---
  debugReadCharaGates(charaNum) {
    const s = get().state;
    if (s === null) return { 信頼度: 0, 好感度: 0, 親密: 0, 従順: 0, 欲望: 0 };
    return readCharaGates(s, charaNum);
  },

  debugPatchChara(charaNum, patch) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    patchCharaGates(next, charaNum, patch);
    set({ state: next, error: null });
  },


  debugReadMasterAbilities() {
    const s = get().state;
    if (s === null) {
      return {
        清扫技能: 0,
        话术技能: 0,
        战斗能力: 0,
        教养: 0,
        料理技能: 0,
        音乐技能: 0,
        采集Lv: 0,
      };
    }
    return readMasterDebugAbilities(s);
  },

  debugPatchMasterAbilities(patch) {
    const s = get().state;
    if (s === null) return;
    const next = cloneGameState(s);
    patchMasterDebugAbilities(next, patch);
    set({ state: next, error: null });
  },
}));

function saveSummary(state: GameState): SaveSummary {
  return {
    day: state.time.dayIndex + 1,
    place: state.master.location,
    name: state.master.callName ?? "主人公",
  };
}
