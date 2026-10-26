/**
 * GameClient — the player-facing 3-zone shell.
 *
 * The default surface (per spec): top status / middle scene+portraits /
 * bottom command grid, with the action interaction box (S4) as an
 * overlay. Renders for `screen === "mainGame"`; pre-game and developer
 * screens are other surfaces (4.5E/4.5F).
 *
 * Data flow:
 *   - location = GameState.master.location (changed only via intents, S1).
 *   - scene = SCENES_BY_LOCATION[location]; present立绘 = selectPresentCharas.
 *   - exit button → ISSUE_COMMAND(moveNo) → applyIntent sets location →
 *     this component re-renders the new scene.
 *   - action button → opens the box (UI-only, S4) AND dispatches
 *     ISSUE_COMMAND; the action's events render inside the box.
 *   - escape → closeInteraction (UI-only, never an intent).
 *
 * This component reads the scene-store for the interaction state and
 * the GameState via props; it dispatches intents through `onIntent`
 * (the parent owns the game-state store).
 */

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { useSceneStore } from "../state/scene-store.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { SCENES_BY_LOCATION } from "./scenes.js";
import SceneView from "./SceneView.js";
import ColoredMapView from "./ColoredMapView.js";
import WorldMapView from "./WorldMapView.js";
import { currentMapIdForLocation, REGIONS } from "./regions.js";
import CommandGrid from "./CommandGrid.js";
import InteractionBox, { buildRadioCharacterEntry } from "./InteractionBox.js";
import SceneDialogueOverlay from "./SceneDialogueOverlay.js";
import HSessionView from "./HSessionView.js";
import DiaryBook, { diaryPages } from "./DiaryBook.js";
import GameStatusBar, { TextGameInfoPanel, type NarrativePursuitSummary } from "./GameStatusBar.js";
import { SceneAmbientPanel, SceneHistoryPanel } from "./SceneSidebar.js";
import ExComPanel, { type ExComTool } from "./ExComPanel.js";
import CommissionPopup from "./CommissionPopup.js";
import CharacterInfoPopup from "./CharacterInfoPopup.js";
import KojoDebugPopup from "./KojoDebugPopup.js";
import AiSettingsPopup from "../ai/AiSettingsPopup.js";
import OptionsDialog from "./OptionsDialog.js";
import { currentAiCharacterProfile, useAiStore } from "../ai/store.js";
import { AI_CHAT_COMMAND_NO } from "../ai/kojo-runtime.js";
import { useSceneAmbient } from "../ai/use-scene-ambient.js";
import { dismissSceneAmbientForParticipant } from "../ai/ambient-runtime.js";
import { describeNarrativeDirectorStatus } from "../ai/narrative-status.js";
import portraits from "./portraits.bundle.json";
import SpriteCrop from "./SpriteCrop.js";
import {
  dimensionForKind,
  portraitForClothing,
  portraitForState,
  portraitKind,
  portraitSourceForState,
  type PortraitSource,
} from "./portrait-expression.js";
import { portraitWithOutfit } from "./portrait-special-outfit-runtime.js";
import { checkNude } from "../../../modernization/runtime/state/portrait-outfit-context.js";
import { kojoColor } from "./kojo-colors.js";
import { selectPresentCharas } from "../../../modernization/runtime/scene/presence.js";
import { canOpenWhereabouts } from "../../../modernization/runtime/world/whereabouts.js";
import { canStartPlayerDate } from "../../../modernization/runtime/world/date-session.js";
import { datePlanScheduleLabel, offeredDateInvitations } from "../../../modernization/runtime/world/date-appointments.js";
import { hasPlace, PLACE_GARDEN } from "../../../modernization/runtime/world/place-flags.js";
import { placeFlagsOf } from "../../../modernization/runtime/world/location-predicates.js";
import {
  liveAvailableCommands,
  isHMode,
  COM_FILTERS,
  filterOn,
  quickFilterHidden,
  type CommandAvailabilityMode,
} from "../../../modernization/runtime/index.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type {
  DatePlanEvent,
  OutingChoicePromptLine,
  OutingChoiceValue,
  TrainingSession,
} from "../../../modernization/runtime/state/game-state.js";
import { ABL_ID, CFLAG_ID, getCharaCflag } from "../../../modernization/runtime/state/settlement.js";
import {
  mobGirlCandidateProfile,
  mobGirlProfileForCharacter,
} from "../../../modernization/runtime/world/dynamic-characters.js";
import type { WalkChoice } from "../../../modernization/runtime/world/skip-move.js";
import { askYn, pickOne, pickOneAnswer, yesNoAnswer, type PromptAnswer, type PromptSpec } from "../../../modernization/runtime/command/prompt.js";
import type { AgentIntent, IssueCommandIntent, ObservationEvent } from "../../../modernization/schemas/types.js";
import type { CommandGridAction } from "./CommandGrid.js";
import { commandLabel } from "./command-label.js";
import { comFilterClassOf } from "./com-filter-class.js";

/** Sentinel option value for "decline every offered situation". */
const DISMISS_SITUATIONS = "__dismiss__";
import { COMMAND_FAMILIES, familyOf, visibleOnCommandGrid } from "./command-families.js";
import { weatherBackgroundStyle } from "../../../modernization/runtime/weather/background-color.js";
import { formatGameEvent } from "./event-format.js";
import { EventChoicePanel, EventResultLines } from "./EventChoicePanel.js";
import { findPath } from "./pathfind.js";
import FishingTackleShop from "./FishingTackleShop.js";
import GatheringProgress from "./GatheringProgress.js";
import { sceneForPresentation } from "./scene-intro.js";
import { privateRoomDescriptionProse } from "./room-description.js";
import { isNarrativePresentationEvent } from "./player-visible-events.js";
import { eventInstanceKey, eventKey, mergeCommandTranscript, trimSuffixOverlap } from "./event-merge.js";
import { currentIntentDeps } from "../../../modernization/runtime/intent/apply-intent.js";
import MobGirlCandidatePanel from "./MobGirlCandidatePanel.js";
import MobPortrait from "./MobPortrait.js";
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import {
  fallbackMobGirlBasePersona,
  generateMobGirlBasePersona,
  mobGirlPersonaKey,
} from "../ai/mob-girl-profile.js";
import { PLAYER_BUILD } from "../player-build.js";
import MinimalTextStream from "./minimal/MinimalTextStream.js";
import MinimalChoiceBar from "./minimal/MinimalChoiceBar.js";
import DialogueAccompanyChoices from "./DialogueAccompanyChoices.js";
import { dialogueAccompanyInvitations, hasDialogueAccompanyPermit } from "../../../modernization/runtime/ai-state/dialogue-action.js";
import MinimalAiChatBar from "./minimal/MinimalAiChatBar.js";
import MinimalOutingList from "./minimal/MinimalOutingList.js";
import "./immersive.css";
import "./minimal.css";
import "./h-session.css";

export type GamePresentationMode = "immersive" | "minimal";

export interface GameClientProps {
  state: GameState;
  /** `immersive` is the three-column text-game surface; `minimal` is the
   * phone-portrait ultra-slim mode (text stream + Act_COM only). */
  presentationMode?: GamePresentationMode;
  /** Presentation experiment enabled only by the development shell. */
  sceneDialogue?: boolean;
  onIntent: (intent: AgentIntent) => void;
  /** Phase D (实玩反馈 #9): walk a multi-hop map path (SKIP_MOVE) with
   *  pass-through encounters + time cost instead of teleporting. Optional:
   *  when absent, the map walk is a no-op. */
  onWalkPath?: (rooms: string[]) => void | Promise<void>;
  /** Player-build chunk preflight. Movement waits for every character that can
   *  be encountered along these locations so first-meeting remains one-shot. */
  onPrepareKojoForLocations?: (locations: readonly string[]) => Promise<void>;
  /** Phase D slice 2: resolve the current mid-walk encounter (无视/打招呼/停下来). */
  onResolveWalkEncounter?: (choice: WalkChoice) => void;
  /** Toggle an Act_COM filter (Parity QA P-1) for the focused target. */
  onToggleFilter?: (toggleId: number, target: number) => void;
  /**
   * Diagnostic tooling may inspect commands with incomplete upstream gates.
   * Player-facing callers must use the default `normal` fail-closed mode.
   */
  commandAvailabilityMode?: CommandAvailabilityMode;
}

/** KEHAI → activity tag for the mid-walk encounter prompt (mirrors the
 *  SKIP_MOVE narration suffix; idle has no tag). */
const WALK_ACTIVITY: Record<number, string> = {
  2: "（工作中）",
  3: "（睡眠中）",
  4: "（自由行动中）",
};

/**
 * Live target-directed commands the resolver can settle. These issue real
 * command IDs on the present NPC; the dialogue reaction (kojo) is real too.
 * Movement and sleep stay on the scene-exit model.
 */
/** commands.bundle.json shape: commandNo → { label, category }. The tracked
 *  label source (built by `scripts/build-commands.ts`); availability is decided
 *  at runtime by `liveAvailableCommands` (= the `@COM_ABLE` gates). */
type WalkEncounterInfo = NonNullable<NonNullable<GameState["walkSession"]>["encounter"]>;
type WalkEncounterLine = Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>;

interface ClosingWalkEncounter {
  key: number;
  encounter: WalkEncounterInfo;
  eventLogIndexAtChoice: number;
  /**
   * Records whether more encounters were queued behind this one. UX is
   * identical for both — the card waits for a click either way (no more
   * auto-fade for the last character, see 2026-07-07 实玩反馈). Kept for
   * analytics/debugging only.
   *   - `single` — this was the only/last encounter in the walk.
   *   - `multi` — more encounters queued behind this one.
   * Detection: `state.walkSession.remaining.length` before resolving.
   */
  phase: "single" | "multi";
}

interface SuppressedWalkKojoRange {
  key: number;
  start: number;
  end: number;
  charaNum: number;
}

function isWalkEncounterKojo(
  event: ObservationEvent,
  charaNum: number,
): event is WalkEncounterLine {
  return event.kind === "DIALOGUE_LINE" && event.charaNum === charaNum;
}

function rangeSuppressesWalkKojo(
  range: SuppressedWalkKojoRange,
  event: ObservationEvent,
  index: number,
): boolean {
  return index >= range.start && index < range.end && isWalkEncounterKojo(event, range.charaNum);
}

const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;

/**
 * 神社闭环 v2 (刀二) — focused single-map / single-character TRIAL RUN.
 *
 * **Phase 8 Slice 6 (2026-06-20): flipped to `false`.** The trial-run
 * narrowing has served its purpose. The data-driven menu now considers the
 * registered catalog, but normal play surfaces only commands whose generated
 * `@COM_ABLE` audit is complete. Unsupported or missing gates stay hidden;
 * explicit diagnostic callers can still inspect them. Set back to `true` to
 * restore the focused 4-command single-map试运行.
 *
 * With TRIAL_RUN = false:
 *   - complete audited commands are clickable or dynamically blocked;
 *     incomplete commands are omitted from the player-facing grid;
 *   - exits to every built map remain available through the map surfaces;
 *   - the autonomous WorldScheduler tick is driven by SCHEDULER_ON (also
 *     already decoupled + on).
 */
const TRIAL_RUN = false;

/**
 * Parity QA P-9 — faithful TURN-BASED time. The original eraTW advances time
 * ONLY when the player issues a command (`TIME += N` in each command body);
 * there is no real-time autonomous clock. `SCHEDULER_ON = false` keeps the
 * 1500ms NOOP interval OFF, so the clock does NOT drift while the player is
 * idle and does NOT conflict with the player's own actions (a global real-time
 * tick would advance time + move NPCs while the player is reading/deciding,
 * racing the turn-based command path).
 *
 * NPC schedules advance on the COMMAND tick instead: `applyIntent`'s
 * ISSUE_COMMAND path calls `reprojectSchedules` after each time-advancing
 * command, moving every scheduled NPC (霊夢/留琴) to the slot their 24h
 * schedule puts them in at the new in-game time, and emitting the time-of-day
 * band narration + day-end settlement on midnight crossings. So the world
 * "catches up" as the player acts — faithful to the upstream 回合制 model. If
 * an NPC appears frozen, the cause is a command NOT advancing time (a
 * zero-timeCost action), not a missing real-time tick.
 *
 * Set to `true` only for an optional real-time "live world" ambient demo
 * (the autonomous tick path in `runSchedulerTick` is retained).
 */
const SCHEDULER_ON = false;

/**
 * Multi-map travel is driven by the data-backed `REGIONS` catalog and the
 * registered move handlers. Map IDs 0–10 currently have scenes and handlers;
 * map ID 11 remains rendered but disabled until its scene data is authored.
 * This is independent of the two `TRIAL_RUN` gates (autonomous scheduler tick
 * and intimate-action menu).
 */
const OPEN_MULTI_MAP = true;

/** True for a move whose destination is still inside the shrine map. */
function staysInShrine(toLocation: string): boolean {
  return toLocation === "神社" || toLocation.startsWith("神社:");
}

function issueCommand(
  commandNo: number,
  target?: number,
  promptAnswer?: PromptAnswer,
): AgentIntent {
  const intent: IssueCommandIntent = { kind: "ISSUE_COMMAND", actor: 0, commandNo };
  if (target !== undefined) intent.target = target;
  if (promptAnswer !== undefined) intent.promptAnswer = promptAnswer;
  return intent;
}

/**
 * Commands the upstream Act_COM grid does NOT show (faithful to
 * `QOL_USERCOM.ERB`):
 *   - 400 移动 / 405 外出 / 604 散步 — `GROUPMATCH(LOCAL,400,405,604) CONTINUE`
 *     (QOL_USERCOM.ERB:38). They live in the Ex_COM utility row / the map.
 *     In our UI cross-map travel is the scene-exit row + the map page, so
 *     these never belong in the command grid (a "日常[400]移动" button is wrong).
 *   - 650 git — a joke command (`@COM650` RETURN -1), resolver-only.
 *   - 201 / 999 / 270 — disabled / dummy / kojo-dispatch sentinels.
 *   - 355 時間停止 — its enter/release controls live in the top TSP row
 *     (GameStatusBar), not the Act_COM grid.
 *
 * **Ex_COM utility row (Parity QA P-1)** — the upstream Ex_COM
 * (`USERCOM_コマンド表示処理.ERB:108-279`) is a long row of TOOL buttons.
 * We render the ones backed by an existing modern feature:
 *   - 移动[400]  → the colored-map toggle (room navigation).
 *   - 变更对象[802] → cycle the focused target (also clickable in the scene).
 *   - 日历[993]  → already shown in the status bar (Parity QA P-2).
 * **Deferred Ex_COM members** (depend on subsystems not yet built, faithful
 * to "tool exists only when its system does"): 外出[405]/散步[604]
 * (odekake/movement-loop state machine), 能力显示[803/804] (full ability
 * screen), 道具确认[805], CONFIG[810], 采集列表[818]/钓鱼列表[890]
 * (gather/fish subsystems), 摄像[770]/相册[771] (camera), 自动时停移动[995]/
 * 瞬間移動 (teleport), 锁门[991], DLC 幻想乡之主[777], the 自动避孕套/自动喘息/
 * 逆推/地图模式 preference toggles. Re-add each as its system lands.
 */
const MENU_EXCLUDED_COMMANDS: ReadonlySet<number> = new Set([
  400, 405, 499, 604, 650, 201, 697, 698, 699, 270, 355, 448,
  // Keep registered H commands out while their menu gates or action routes
  // are still unsupported. 187 has an explicit gate and bounded toggle route.
  122, 141, 142, 143, 148, 190, 511,
]);
const L3_NARRATIVE_OPENING_COMMAND_NO = -30_003;

/**
 * A queued command session can be opened after another owner has finished.
 * Recover its root command from the session transcript instead of opening
 * every queued session as command 0. This keeps command-specific surfaces
 * (notably COM496's radio page) owner-aware across queue transitions.
 */
function commandNoFromDialogueTranscript(
  events: readonly ObservationEvent[] | null,
): number | null {
  const command = events?.find((event) => event.kind === "COMMAND_ISSUED");
  return command?.kind === "COMMAND_ISSUED" ? command.commandNo : null;
}

function dialogueTranscriptContainsCommand(
  transcript: readonly ObservationEvent[] | null,
  command: Extract<ObservationEvent, { kind: "COMMAND_ISSUED" }>,
): boolean {
  return transcript?.some((event) =>
    event.kind === "COMMAND_ISSUED" &&
    event.timestamp === command.timestamp &&
    event.actor === command.actor &&
    event.commandNo === command.commandNo) ?? false;
}

export default function GameClient(props: GameClientProps) {
  const {
    state,
    onIntent,
    onWalkPath,
    onPrepareKojoForLocations,
    onResolveWalkEncounter,
    onToggleFilter,
    commandAvailabilityMode = "normal",
  } = props;
  const presentationMode = props.presentationMode ?? "immersive";
  const sceneDialogue = props.sceneDialogue === true && !PLAYER_BUILD && presentationMode !== "minimal";
  const [closingHSession, setClosingHSession] = useState<Pick<TrainingSession, "target" | "mode" | "startedAtTick"> | null>(null);
  const [hTranscriptStartIndex, setHTranscriptStartIndex] = useState<number | null>(null);
  const [hPortraitCommandNo, setHPortraitCommandNo] = useState<number | null>(null);
  const [hHistoryEvents, setHHistoryEvents] = useState<ObservationEvent[]>([]);
  const hHistoryOwnerRef = useRef<{ target: number; logLength: number } | null>(null);
  const interaction = useSceneStore((s) => s.interaction);
  const openInteraction = useSceneStore((s) => s.openInteraction);
  const closeInteraction = useSceneStore((s) => s.closeInteraction);
  const setScreen = useSceneStore((s) => s.setScreen);
  const battleReturn = useSceneStore((s) => s.battleReturn);
  const finishBattleReturn = useSceneStore((s) => s.finishBattleReturn);
  // P2-02 — dedicated 家庭菜園 surface flag. GameClient only opens it (the
  // store flips it when COM418 fires in a garden); FarmScreen owns the
  // close path because the player must explicitly confirm 退出.
  const farmScreenOpen = useGameStateStore((s) => s.farmScreenOpen);
  const setFarmScreenOpen = useGameStateStore((s) => s.setFarmScreenOpen);

  // P1 typed dialogue queue: the first session owns the active modal.
  // Closing advances the queue; a later arrival/event cannot replace it.
  const dialogueQueue = useGameStateStore((s) => s.dialogueQueue);
  const clearCompletedDialogueBeforeNavigation = useGameStateStore((s) => s.clearCompletedDialogueBeforeNavigationAction);
  const [minimalNavigationPending, setMinimalNavigationPending] = useState(false);
  // 问题1 — author DIALOGUE_LINE instance keys whose realtime AI replace succeeded;
  // the immersive history hides them in favour of the AI lines.
  const replacedAuthorLineKeys = useGameStateStore((s) => s.replacedAuthorLineKeys);
  const aiSettings = useAiStore((s) => s.settings);
  const aiDebugEntries = useAiStore((s) => s.debugEntries);
  const narrativeDirectorStatus = useGameStateStore((s) => s.narrativeDirectorStatus);
  const updateAiCharacterProfile = useAiStore((s) => s.updateCharacterProfile);
  const aiEnabled = aiSettings.enabled;
  const generatedPersonaKey = Object.entries(state.dynamicCharacters ?? {})
    .filter(([, meta]) => meta.origin === "generated")
    .map(([id, meta]) => `${id}:${meta.seed}:${meta.species}:${meta.encounterRegion}:${meta.lifecycle}:${meta.active ? 1 : 0}`)
    .join("|");

  // Dynamic roles get a deterministic persona immediately, then an optional
  // AI rewrite. The profile lives in the AI sidecar, so it never becomes a
  // second source of truth for character state or settlement.
  useEffect(() => {
    const controllers: Array<{ controller: AbortController; timer: number }> = [];
    for (const [idText, meta] of Object.entries(state.dynamicCharacters ?? {})) {
      if (meta.origin !== "generated") continue;
      const charaNum = Number(idText);
      const candidate = mobGirlProfileForCharacter(state, charaNum);
      if (!candidate) continue;
      const fallback = fallbackMobGirlBasePersona(candidate);
      const personaKey = mobGirlPersonaKey(candidate);
      const existing = currentAiCharacterProfile(charaNum);
      const profileMatches = existing.generatedPersonaKey === personaKey && Boolean(existing.generatedPersona);
      if (!profileMatches) {
        updateAiCharacterProfile(charaNum, {
          generatedPersona: fallback.persona,
          generatedPersonaSource: "fallback",
          generatedPersonaKey: personaKey,
        });
      }
      if (
        !aiSettings.enabled ||
        !aiSettings.kojoEnabled ||
        !aiSettings.baseUrl.trim() ||
        !aiSettings.model.trim() ||
        (profileMatches && existing.generatedPersonaSource === "ai") ||
        (profileMatches && existing.generatedPersonaSource !== "fallback")
      ) continue;

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort("timeout"), aiSettings.timeoutMs);
      controllers.push({ controller, timer });
      void generateMobGirlBasePersona(candidate, aiSettings, controller.signal)
        .then((generated) => {
          if (controller.signal.aborted) return;
          const liveState = useGameStateStore.getState().state;
          if (liveState?.dynamicCharacters?.[charaNum]?.seed !== candidate.seed) return;
          const latest = currentAiCharacterProfile(charaNum);
          if (
            latest.generatedPersonaKey !== personaKey ||
            latest.generatedPersona !== fallback.persona ||
            latest.generatedPersonaSource === "ai"
          ) return;
          updateAiCharacterProfile(charaNum, {
            generatedPersona: generated.persona,
            generatedPersonaSource: "ai",
            generatedPersonaKey: personaKey,
          });
        })
        .catch(() => {
          // The deterministic fallback is already persisted and usable.
        })
        .finally(() => window.clearTimeout(timer));
    }
    return () => {
      for (const { controller, timer } of controllers) {
        window.clearTimeout(timer);
        controller.abort("dynamic character changed");
      }
    };
  }, [
    generatedPersonaKey,
    aiSettings.enabled,
    aiSettings.kojoEnabled,
    aiSettings.baseUrl,
    aiSettings.model,
    aiSettings.apiKey,
    aiSettings.temperature,
    aiSettings.maxTokens,
    aiSettings.timeoutMs,
    updateAiCharacterProfile,
  ]);
  const activeDialogueSession = dialogueQueue[0] ?? null;
  // 问题1 — cross-session buffer for transcript lines that never enter the
  // eventLog (AI chat turns, AI-replaced kojo lines, kojo choice branches), so
  // the immersive history keeps them after the session closes. Mirrors the
  // minimal stream's extras buffer but WITHOUT the per-command chapter cutoff:
  // the immersive history is the full conversation/action record.
  const [aiHistoryExtras, setAiHistoryExtras] = useState<ObservationEvent[]>([]);
  const prevHistoryLogLengthRef = useRef(state.eventLog.length);
  useEffect(() => {
    if (state.eventLog.length < prevHistoryLogLengthRef.current) {
      // 读档/重置: drop stale lines from a previous save.
      setAiHistoryExtras([]);
    }
    prevHistoryLogLengthRef.current = state.eventLog.length;
  }, [state.eventLog.length]);
  useEffect(() => {
    if (presentationMode !== "immersive") return;
    if (sceneDialogue && activeDialogueSession?.aiRequestId !== undefined) return;
    const sessionLines = (activeDialogueSession?.transcript ?? [])
      .filter(isNarrativePresentationEvent);
    if (sessionLines.length === 0) return;
    const bandSet = new Set(sceneBandEventsForPresentation.map(eventKey));
    setAiHistoryExtras((prev) => {
      const existing = new Set(prev.map(eventKey));
      const additions = sessionLines.filter(
        (event) => !bandSet.has(eventKey(event)) && !existing.has(eventKey(event)),
      );
      return additions.length === 0 ? prev : [...prev, ...additions].slice(-200);
    });
    // sceneBandEventsForPresentation derives from state.eventLog; the length
    // keeps this effect from re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationMode, sceneDialogue, activeDialogueSession?.id, activeDialogueSession?.transcript, activeDialogueSession?.aiRequestId, state.eventLog.length]);
  const pendingArrivalEvents = activeDialogueSession?.transcript ?? null;
  const activeDialogueCommandNo = commandNoFromDialogueTranscript(pendingArrivalEvents);
  const offeredDates = offeredDateInvitations(state);
  const offeredDate = offeredDates[0];
  const accompanyInvitation = dialogueAccompanyInvitations(state)[0];
  const scheduledDate = (state.worldEvents ?? [])
    .filter((event): event is DatePlanEvent => event.kind === "date-plan" && ["scheduled", "waiting"].includes(event.phase) && event.scheduledStartTick != null)
    .sort((a, b) => (a.scheduledStartTick ?? Infinity) - (b.scheduledStartTick ?? Infinity) || a.partner - b.partner)[0];
  const clearArrivalPopup = useGameStateStore((s) => s.clearArrivalPopup);
  const pendingKojoChoice = activeDialogueSession?.choice ?? null;
  const resolveKojoChoice = useGameStateStore((s) => s.resolveKojoChoiceAction);
  const resolveStoryChoice = useGameStateStore((s) => s.resolveStoryChoiceAction);
  const recoverStoryProgram = useGameStateStore((s) => s.recoverStoryProgramAction);
  const abortStoryProgram = useGameStateStore((s) => s.abortStoryProgramAction);
  const skipStoryProgram = useGameStateStore((s) => s.skipStoryProgramAction);
  const favoriteNarrativeEvent = useGameStateStore((s) => s.favoriteNarrativeEventAction);
  const setStoryArcStatus = useGameStateStore((s) => s.setStoryArcStatusAction);
  const startNarrativeEvent = useGameStateStore((s) => s.startNarrativeEventAction);
  const startAiChat = useGameStateStore((s) => s.startAiChatAction);
  const respondAccompany = useGameStateStore((s) => s.respondDialogueAccompanyAction);
  const advancePartnerLedDate = useGameStateStore((s) => s.advancePartnerLedDateAction);
  const appendAiChatBranch = useGameStateStore((s) => s.appendAiChatBranchAction);
  const pendingPrompt = useGameStateStore((s) => s.pendingPrompt);
  const resolvePromptAnswer = useGameStateStore((s) => s.resolvePromptAnswer);
  const cancelPrompt = useGameStateStore((s) => s.cancelPrompt);
  const resolveMobMeal = useGameStateStore((s) => s.resolveMobMealAction);
  const resolveFestivalEvent = useGameStateStore((s) => s.resolveFestivalEventAction);
  const chooseNarrativeSituation = useGameStateStore((s) => s.chooseNarrativeSituationAction);
  const dismissNarrativeSituations = useGameStateStore((s) => s.dismissNarrativeSituationsAction);
  // The overnight situation menu, rendered only while a set is outstanding.
  // Option values are situation ids plus the DISMISS sentinel, so the pick
  // handler never has to infer intent from an index.
  const situationPrompt = useMemo<PromptSpec | null>(() => {
    const session = state.narrativeSituationSession;
    // A runtime-picked set is never a question for the player: it exists only
    // long enough for the runtime to open one of them.
    if (session?.autoSelect) return null;
    const situations = session?.situations;
    if (!situations || situations.length === 0) return null;
    return pickOne("有几件事正在发生。要插手哪一件？", [
      ...situations.map((situation) => ({ id: situation.id, label: situation.premise })),
      { id: DISMISS_SITUATIONS, label: "先不管" },
    ]);
  }, [state.narrativeSituationSession]);
  const resolveMobGirlMemory = useGameStateStore((s) => s.resolveMobGirlMemoryAction);
  const resolveOutingChoice = useGameStateStore((s) => s.resolveOutingChoiceAction);
  const cancelOutingChoice = useGameStateStore((s) => s.cancelOutingChoiceAction);
  const closeOutingChoiceResult = useGameStateStore((s) => s.closeOutingChoiceResultAction);
  const startDanmakuBattle = useGameStateStore((s) => s.startDanmakuBattleAction);
  const togglePortraitKind = useGameStateStore((s) => s.togglePortraitKindAction);
  const setPortraitVariant = useGameStateStore((s) => s.setPortraitVariantAction);
  const updateAgentSettings = useGameStateStore((s) => s.updateAgentSettingsAction);
  // 问题3 — manual wipe of AI-generated persisted content.
  const clearAiGeneratedContent = useGameStateStore((s) => s.clearAiGeneratedContentAction);
  const prepareCharacterForEncounter = useGameStateStore((s) => s.prepareCharacterForEncounterAction);
  const cancelLazyMaterialization = useGameStateStore((s) => s.cancelLazyMaterializationAction);
  const startStoryProgram = useGameStateStore((s) => s.startStoryProgramAction);
  useEffect(() => {
    const session = state.dateSession;
    if (!session || session.controller !== "partner" || !session.autoAdvance || session.phase !== "active") return;
    if (dialogueQueue.length > 0 || pendingPrompt) return;
    const timer = window.setTimeout(() => { advancePartnerLedDate(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    state.dateSession?.eventId,
    state.dateSession?.phase,
    state.dateSession?.itineraryCursor,
    state.dateSession?.autoAdvance,
    dialogueQueue.length,
    pendingPrompt,
    advancePartnerLedDate,
  ]);
  const sleepPresentationRef = useRef<string | null>(null);
  // Minimal mode has no popup to close, so an arrival kojo session (first
  // meeting 口上 etc.) would sit in the queue forever and its transcript
  // would linger in the text stream. The player's FIRST command advances the
  // arrival queue (the same clearArrivalPopup the popup exit used).
  const prevArrivalLogLength = useRef(state.eventLog.length);
  useEffect(() => {
    if (presentationMode !== "minimal") {
      prevArrivalLogLength.current = state.eventLog.length;
      return;
    }
    const newCommands = state.eventLog.slice(prevArrivalLogLength.current)
      .filter((event): event is Extract<ObservationEvent, { kind: "COMMAND_ISSUED" }> =>
        event.kind === "COMMAND_ISSUED");
    if (newCommands.length > 0) {
      // An in-flight AI reply owns the queue head: don't pop its session
      // while `aiRequestId` is set — the late reply must still land in the
      // stream instead of being swallowed by clearArrivalPopup.
      // A completed AI command publishes its deterministic COMMAND_ISSUED in
      // the same update as the final transcript. That command is part of this
      // session, not the player's next command, so it must not immediately
      // clear the AI line that just arrived.
      const sessionOwnsPublishedCommand = newCommands.some((command) =>
        dialogueTranscriptContainsCommand(pendingArrivalEvents, command));
      if (pendingArrivalEvents && pendingArrivalEvents.length > 0
        && activeDialogueSession?.aiRequestId === undefined
        && !sessionOwnsPublishedCommand) {
        clearArrivalPopup();
      }
    }
    prevArrivalLogLength.current = state.eventLog.length;
  }, [presentationMode, state.eventLog.length, pendingArrivalEvents, clearArrivalPopup, activeDialogueSession?.aiRequestId]);
  useEffect(() => {
    if (state.storyProgram?.status === "active"
      && !dialogueQueue.some((session) => session.owner === "story")) {
      recoverStoryProgram();
    }
  }, [dialogueQueue, recoverStoryProgram, state.storyProgram?.id, state.storyProgram?.status]);
  const activeStoryArcId = state.storyProgram?.version === 2 ? state.storyProgram.arcId : undefined;
  const activeStoryEventId = state.storyProgram?.version === 2 ? state.storyProgram.eventId : undefined;
  const activeStoryArcPhase = activeStoryArcId
    ? state.storyArcs?.find((arc) => arc.id === activeStoryArcId)?.phase
    : undefined;
  const onArrivalExit = useCallback(() => {
    closeInteraction();
    clearArrivalPopup();
  }, [closeInteraction, clearArrivalPopup]);

  // Phase 8.4 — drive the WorldScheduler. We dispatch a NOOP every
  // 1500ms (matches `MS_PER_TICK` in `runtime/world/clock.ts`); the
  // NOOP path in `apply-intent.ts` calls `runSchedulerTick` which
  // advances the in-game clock and crosses 霊夢's schedule
  // boundaries. We deliberately don't tick while the interaction
  // box is open (the player is reading).
  useEffect(() => {
    // 刀二→Phase 8: the autonomous scheduler tick is now driven by
    // SCHEDULER_ON (decoupled from TRIAL_RUN). We deliberately don't tick
    // while the interaction box is open (the player is reading).
    if (!SCHEDULER_ON || interaction.open || offeredDate || accompanyInvitation || state.festivalEventSession) return;
    const id = setInterval(() => {
      onIntent({ kind: "NOOP", reason: "tick" });
    }, 1500);
    return () => clearInterval(id);
  }, [interaction.open, offeredDate?.id, accompanyInvitation?.requestId, onIntent, state.festivalEventSession]);

  // A sleep request is a queued screen transition, never permission to tear
  // down the command UI. The command/event tail and every owner-aware kojo
  // session must be acknowledged first. Forced exhaustion can be produced by
  // EVENTCOMEND without an already-open box, so its persisted log boundary is
  // used to create one presentation pass before settlement.
  useEffect(() => {
    const session = state.sleepSession;
    if (!session) {
      sleepPresentationRef.current = null;
      return;
    }
    const key = `${session.startedAtTick}:${session.forced ? 1 : 0}:${session.presentationEventLogIndex ?? "legacy"}`;
    const hasBlockingDialogue = dialogueQueue.some((queued) =>
      queued.choice !== null || queued.aiRequestId !== undefined,
    );
    if (interaction.open || pendingPrompt !== null ||
      (presentationMode !== "minimal" && dialogueQueue.length > 0) ||
      hasBlockingDialogue) {
      sleepPresentationRef.current = key;
      return;
    }
    if (presentationMode === "minimal") {
      // No kojo popup surface in minimal mode: the sleep narration already
      // streamed into the text log; jump straight to nightly settlement.
      if (dialogueQueue.length > 0) clearCompletedDialogueBeforeNavigation();
      sleepPresentationRef.current = key;
      setScreen("nightSettlement");
      return;
    }
    if (sleepPresentationRef.current !== key && session.presentationEventLogIndex !== undefined) {
      sleepPresentationRef.current = key;
      openInteraction(402, Math.min(session.presentationEventLogIndex, state.eventLog.length));
      return;
    }
    setScreen("nightSettlement");
  }, [state.sleepSession, state.eventLog.length, interaction.open, dialogueQueue, pendingPrompt, presentationMode, openInteraction, clearCompletedDialogueBeforeNavigation, setScreen]);

  // A persisted battle session resumes as its own surface after a save/load
  // just as a persisted sleep session resumes at nightly settlement.
  useEffect(() => {
    if (state.danmakuBattle) {
      closeInteraction();
      setScreen("danmakuBattle");
    }
  }, [state.danmakuBattle, closeInteraction, setScreen]);

  useEffect(() => {
    if (state.fishingGame) {
      closeInteraction();
      setScreen("fishingGame");
    }
  }, [state.fishingGame, closeInteraction, setScreen]);

  useEffect(() => {
    if (state.stoneContestSession) {
      closeInteraction();
      setScreen("stoneContest");
    }
  }, [state.stoneContestSession, closeInteraction, setScreen]);

  // P2-02 — open the dedicated 家庭菜園 surface when the store flipped the
  // farm flag (COM418 + PLACE_GARDEN). Close it explicitly when the player
  // walks away from the garden so the screen can't outlive its plot state.
  useEffect(() => {
    if (!farmScreenOpen) return;
    closeInteraction();
    setScreen("farm");
  }, [farmScreenOpen, closeInteraction, setScreen]);

  useEffect(() => {
    if (farmScreenOpen) {
      const flags = hasPlace(placeFlagsOf(state.master.location), PLACE_GARDEN);
      if (!flags) setFarmScreenOpen(false);
    }
  }, [farmScreenOpen, state.master.location, setFarmScreenOpen]);

  useEffect(() => {
    if (!battleReturn) return;
    const timer = window.setTimeout(finishBattleReturn, 560);
    return () => window.clearTimeout(timer);
  }, [battleReturn, finishBattleReturn]);

  const location = state.master.location;
  const scene = SCENES_BY_LOCATION[location] ?? null;
  const present = useMemo(() => selectPresentCharas(state, location), [state, location]);
  const renderedScene = useMemo(() => sceneForPresentation(scene, state, present), [scene, state, present]);
  // `_ROOM_DESCRIPTION` personal kojo — when standing inside a chara's own
  // room, append the owner's room-description prose to the ambient layer
  // (upstream `@情景描写` → `K{n}_ROOM_DESCRIPTION`, ANOTHER_TALK.ERB:1023).
  const sceneRouter = currentIntentDeps().router;
  const sceneRouterRevision = "preparationRevision" in sceneRouter ? sceneRouter.preparationRevision : undefined;
  const roomDesc = useMemo(() => renderedScene
    ? privateRoomDescriptionProse(state, location, sceneRouter)
    : null, [renderedScene, state, location, sceneRouter, sceneRouterRevision]);
  const finalScene =
    renderedScene && roomDesc
      ? {
          ...renderedScene,
          ambientProse: [renderedScene.ambientProse, roomDesc].filter(Boolean).join("\n"),
        }
      : renderedScene;
  const allExits = scene?.exits ?? [];
  const exits =
    TRIAL_RUN && !OPEN_MULTI_MAP ? allExits.filter((e) => staysInShrine(e.toLocation)) : allExits;
  // Multi-map interaction. The action menu is shown whenever
  // ANY NPC (charaNum > 0) is present, not just 霊夢: village residents
  // (慧音/阿求/小鈴/…) become interactable in their own map. The player
  // picks the active target by clicking a portrait; we auto-default to
  // the first present NPC and fall back when the current target leaves.
  const presentNpcs = present.filter((c) => c.charaNum > 0);
  const hasNpc = presentNpcs.length > 0;
  // Slice 8 — the colored map exists for shrine, village, temple, koumakan,
  // and the 竹林 field map (mapId=4: 永遠亭 / 迷途竹林 / 夢幻館). The 竹林
  // prefixes were missing here (2026-07-04), so inside 竹林 the player had no
  // map button AND no 外出 button (canUseGoOut = hasMap), which
  // trapped them in the field — they could only walk back to the entrance
  // room by room.
  const hasMap = currentMapIdForLocation(location) !== null;
  const [showMap, setShowMap] = useState(false);
  const [danmakuExit, setDanmakuExit] = useState(false);
  // 外出 (COM405 → @OTHERREGIONS) — the global world-map hub. Mutually
  // exclusive with the region colored map: opening the world map closes the
  // region map. Opened either from the Ex_COM 「外出」button (region entrance
  // only) or from 「移動至其他地域」(COM604[99]) inside a region map page.
  const [showWorldMap, setShowWorldMap] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<number | undefined>(undefined);
  // Parity QA P-1 — the Ex_COM utility row collapse (upstream `▼[－] Ex_COM`,
  // toggle id 3002). Expanded by default; holds the tool buttons (移动/变更
  // 对象/…), NOT settlement commands.
  const [showExCom, setShowExCom] = useState(true);
  // Commission popup state — clicking a portrait's "?" badge sets this to
  // the charaNum; the popup is rendered above the rest of the screen and
  // clears this on close.
  const [commissionPopupChara, setCommissionPopupChara] = useState<number | null>(null);
  // Ex_COM display tool currently open (能力显示/日历/污渍显示), or null. These
  // are read-only modals over the live GameState — see ExComPanel.
  const [excomPanel, setExcomPanel] = useState<ExComTool | null>(null);
  const whereaboutsGate = canOpenWhereabouts(state);
  const [characterInfoChara, setCharacterInfoChara] = useState<number | null>(null);
  const [showKojoDebug, setShowKojoDebug] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [aiChatDraftOpen, setAiChatDraftOpen] = useState(false);
  // The story panel lives on the status bar's circled ! and is closed until
  // asked for — an always-open version of this is the banner it replaced.
  const [narrativePanelOpen, setNarrativePanelOpen] = useState(false);
  // Presentation-only AI-branch lines picked in the minimal choice bar; they
  // stream into the text log but never enter the eventLog/GameState. Cleared
  // on 移动 (new location chapter, mirroring MinimalTextStream's history reset).
  const [minimalAiBranchLines, setMinimalAiBranchLines] = useState<ObservationEvent[]>([]);
  const prevBranchResetLocation = useRef(location);
  useEffect(() => {
    if (location !== prevBranchResetLocation.current) {
      setMinimalAiBranchLines([]);
      // A command transcript belongs to the room where it was produced.
      // Minimal mode has no popup exit to advance it, so moving must close the
      // old command owner explicitly. A newly queued destination encounter has
      // its own owner and remains available after this queue advance.
      if (presentationMode === "minimal" && activeDialogueSession?.owner === "command") {
        clearArrivalPopup();
      }
    }
    prevBranchResetLocation.current = location;
  }, [location, presentationMode, activeDialogueSession?.owner, clearArrivalPopup]);
  const [showBugCatchingMenu, setShowBugCatchingMenu] = useState(false);
  const [showTackleShop, setShowTackleShop] = useState(false);
  /**
   * COMF445 採集 pre-phase. Upstream shows five `采集中.`→`采集中.....` frames
   * (COMF445.ERB:81-84) before drawing. The resolver is synchronous, so the
   * command is not issued until the overlay finishes; this holds the pending
   * command number meanwhile.
   */
  const [gatheringProgress, setGatheringProgress] = useState<number | null>(null);
  const walkEncounterCloseSeq = useRef(0);
  const [closingWalkEncounter, setClosingWalkEncounter] =
    useState<ClosingWalkEncounter | null>(null);
  const [suppressedWalkKojoRanges, setSuppressedWalkKojoRanges] =
    useState<SuppressedWalkKojoRange[]>([]);

  // Auto-default + stale fallback: if there's no selection, or the
  // selected NPC is no longer present (they walked away / we moved),
  // fall back to the first present NPC. `selectedTarget` persists when
  // the player navigates the action menu so the chosen NPC stays target.
  const presentNpcIds = new Set(presentNpcs.map((c) => c.charaNum));
  const targetStale =
    selectedTarget === undefined || !presentNpcIds.has(selectedTarget);
  // A persisted H session owns its target. Do not wait for the ephemeral
  // React selection to be rebuilt after a save/load or browser refresh: the
  // H controls, status panel, and portrait highlight must all recover from
  // the authoritative TrainingSession.
  const persistedTrainingTarget = state.training?.target;
  const trainingTargetPresent = persistedTrainingTarget !== undefined &&
    state.charas[persistedTrainingTarget]?.location === state.master.location
    ? persistedTrainingTarget
    : undefined;
  const actionTarget = trainingTargetPresent ?? (targetStale
    ? presentNpcs[0]?.charaNum
    : selectedTarget);
  const walkEncounter = state.walkSession?.encounter;
  // A locked 私室 reached at the end of a walk → 潜入/算了 prompt (@潜入房間).
  const lockedDoor = state.walkSession?.lockedDoor;
  // Any open walk encounter (choice OR result card), locked-door prompt, or
  // NPC date invitation blocks commands until the player resolves it.
  const minimalDialogueNavigationBlocked = presentationMode === "minimal" && dialogueQueue.some(
    (session) => session.choice !== null || session.aiRequestId !== undefined,
  );
  const movementBlocked =
    (sceneDialogue && interaction.open) ||
    walkEncounter !== undefined ||
    closingWalkEncounter !== null ||
    lockedDoor !== undefined ||
    offeredDate !== undefined ||
    accompanyInvitation !== undefined ||
    minimalNavigationPending ||
    minimalDialogueNavigationBlocked;
  const trainingMovementLocked = state.training !== undefined && state.training !== null;
  const effectiveRootCommandNo = activeDialogueCommandNo ?? interaction.rootCommandNo;
  const radioInteractionActive =
    interaction.open &&
    effectiveRootCommandNo === 496;
  const aiChatInteractionActive =
    interaction.open &&
    effectiveRootCommandNo === AI_CHAT_COMMAND_NO;
  const radioUnderstood = (state.master.state.ABL[ABL_ID.教養] ?? 0) >= 2;
  const formalAmbientBlock =
    interaction.open || dialogueQueue.length > 0 || pendingPrompt !== null || pendingKojoChoice !== null || Boolean(state.festivalEventSession);
  const exclusiveAmbientBlock =
    showMap ||
    showWorldMap ||
    movementBlocked ||
    commissionPopupChara !== null ||
    excomPanel !== null ||
    characterInfoChara !== null ||
    showKojoDebug ||
    showAiSettings ||
    showOptions ||
    showBugCatchingMenu ||
    showTackleShop ||
    gatheringProgress !== null ||
    danmakuExit ||
    Boolean(
      state.outingEventSession ||
      state.mobGirlMemorySession ||
      state.mobMealSession ||
      state.festivalEventSession ||
      state.sleepSession ||
      state.danmakuBattle ||
      state.fishingGame ||
      state.stoneContestSession ||
      farmScreenOpen,
    );
  const ambientEntry = useSceneAmbient({
    state,
    router: currentIntentDeps().router,
    formalInteractionActive: formalAmbientBlock,
    exclusiveSurfaceActive: exclusiveAmbientBlock,
    preserveEntryWhileFormal: radioInteractionActive,
  });
  const resultWalkEncounter = closingWalkEncounter;
  const visibleWalkEncounter = resultWalkEncounter?.encounter ?? walkEncounter;
  const showWalkEncounterChoices = walkEncounter !== undefined && resultWalkEncounter === null;
  const walkEncounterChara =
    visibleWalkEncounter !== undefined ? state.charas[visibleWalkEncounter.charaNum] : undefined;
  const sceneBandEventsForPresentation = useMemo(() => {
    const activeSuppressionRanges = [
      ...suppressedWalkKojoRanges,
      ...(closingWalkEncounter
        ? [{
            key: closingWalkEncounter.key,
            start: closingWalkEncounter.eventLogIndexAtChoice,
            end: state.eventLog.length,
            charaNum: closingWalkEncounter.encounter.charaNum,
          }]
        : []),
    ];
    const sceneBandEvents =
      activeSuppressionRanges.length === 0
        ? state.eventLog
        : state.eventLog.filter(
            (event, index) =>
              !activeSuppressionRanges.some((range) =>
                rangeSuppressesWalkKojo(range, event, index),
              ),
            );
    // Player surfaces keep narrative/dialogue/movement prose and remove
    // internal bookkeeping rows that are useful to creators but distracting
    // to players.
    return sceneBandEvents.filter(isNarrativePresentationEvent);
  }, [state.eventLog, suppressedWalkKojoRanges, closingWalkEncounter]);
  // 问题1 — immersive history merge: the full eventLog narrative stream plus
  // transcript-only lines (AI chat / AI-replaced kojo / choice branches).
  // fullAiKojo replace-authored successes hide their author DIALOGUE_LINEs so
  // the history shows the AI output instead of the original kojo.
  const immersiveHistoryEvents = useMemo(() => {
    const suppressed = new Set(replacedAuthorLineKeys);
    const band = sceneBandEventsForPresentation.filter(
      (event) =>
        !(event.kind === "DIALOGUE_LINE" && event.origin !== "ai" && suppressed.has(eventInstanceKey(event))),
    );
    const sessionPart = (sceneDialogue && activeDialogueSession?.aiRequestId !== undefined ? [] : activeDialogueSession?.transcript ?? [])
      .filter(isNarrativePresentationEvent);
    const trimmedBand = trimSuffixOverlap(band, sessionPart);
    const sessionKeys = new Set(sessionPart.map(eventKey));
    const bandKeys = new Set(trimmedBand.map(eventKey));
    const extras = aiHistoryExtras.filter(
      (event) => !bandKeys.has(eventKey(event)) && !sessionKeys.has(eventKey(event)),
    );
    // Transcript-only lines are captured after the owning event is published.
    // Appending them blindly made an earlier movement line appear at the very
    // bottom of history. Reconstruct chronological order before the panel's
    // rolling window is applied; stable index order preserves same-tick prose.
    return [...trimmedBand, ...extras, ...sessionPart]
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index)
      .map(({ event }) => event);
  }, [sceneBandEventsForPresentation, sceneDialogue, activeDialogueSession?.transcript, activeDialogueSession?.aiRequestId, aiHistoryExtras, replacedAuthorLineKeys]);
  const walkEncounterKojoLines =
    closingWalkEncounter === null
      ? []
      : state.eventLog
          .slice(closingWalkEncounter.eventLogIndexAtChoice)
          .filter((event): event is WalkEncounterLine =>
            isWalkEncounterKojo(event, closingWalkEncounter.encounter.charaNum),
          );

  // Result-card UX (2026-07-07 实玩反馈): BOTH single and multi cards
  // wait for the player to click them. The earlier auto-fade timer for
  // `single` (the last encounter) was jarring — the last character
  // disappeared after ~1s while the player was still reading. Now the
  // card sticks until clicked (handleAdvanceWalkEncounterResult) for
  // either phase.

  useEffect(() => {
    if (!closingWalkEncounter) return;
    if (state.eventLog.length <= closingWalkEncounter.eventLogIndexAtChoice) return;
    const range: SuppressedWalkKojoRange = {
      key: closingWalkEncounter.key,
      start: closingWalkEncounter.eventLogIndexAtChoice,
      end: state.eventLog.length,
      charaNum: closingWalkEncounter.encounter.charaNum,
    };
    setSuppressedWalkKojoRanges((ranges) => {
      const existing = ranges.find((r) => r.key === range.key);
      if (
        existing &&
        existing.start === range.start &&
        existing.end === range.end &&
        existing.charaNum === range.charaNum
      ) {
        return ranges;
      }
      return [...ranges.filter((r) => r.key !== range.key), range].slice(-12);
    });
  }, [
    closingWalkEncounter?.key,
    closingWalkEncounter?.eventLogIndexAtChoice,
    closingWalkEncounter?.encounter.charaNum,
    state.eventLog.length,
  ]);

  // Faithful USERCOM menu (Act_COM). Enumerate the live catalog, keep only the
  // commands whose @COM_ABLE (execCheck) passes (= upstream "only show usable",
  // NOT a flat list of all 185), drop the Ex_COM/utility/sentinel ids, then
  // GROUP by the COM_TAGS family (交流/日常/家务/性骚扰 core; 收藏/V/A/SM/侍奉/
  // 道具/H/自慰 under the ▼更多 collapse, like the upstream Ex_COM toggle).
  //
  // H-mode guard: eraTW does NOT show sex acts (正常位/玩具/SM/自慰…) on the
  // everyday page; they only surface during うふふ (the 诶嘿嘿 flag), entered via
  // 350 押し倒す / 356 物陰に誘う. Most are ComfDef ports with no per-command
  // execCheck yet, so without this guard 正常位 (60) would show whenever an NPC
  // is present. Drop うふふ-only commands unless H-mode is active.
  // Parity QA P-1 — the faithful single Act_COM grid. Enumerate the live
  // catalog, keep only `@COM_ABLE`-passing commands, drop Ex_COM/utility ids
  // and うふふ-only acts outside H-mode, then apply the per-target filter
  // toggles (`@QUICKFILTER`: a command is hidden iff its filter class is OFF
  // for this target). NO family grouping — one grid, like upstream.
  // Parity QA P-10 — query with target 0 when no NPC is focused (not skip),
  // so master-only commands (休憩/做饭/风吕, requiresTarget:false) still show.
  // The upstream loop (QOL_USERCOM.ERB:13-50) runs regardless of TARGET; only
  // the per-command @COM_ABLE decides. target-directed commands block on
  // target<=0 via their own execCheck.
  const filterTarget = actionTarget ?? 0;
  const availability = liveAvailableCommands(
    state,
    filterTarget,
    commandAvailabilityMode,
  );
  const hMode = actionTarget !== undefined ? isHMode(state, actionTarget) : false;
  // A legacy/just-entered H state can have the authoritative H flag before the
  // first command creates TrainingSession. Keep that real runtime mode visible.
  const hPresentationSession = state.training ?? (hMode && actionTarget !== undefined
    ? { target: actionTarget, mode: "h" as const, startedAtTick: state.time.tickValue }
    : closingHSession);
  const hPresentationClosing = !state.training && !hMode && closingHSession !== null;
  // H owns queued dialogue inline. Opening the modal here would fight the
  // H effect below, repeatedly opening/closing it until React tears down.
  useEffect(() => {
    if (hPresentationSession || presentationMode !== "immersive" || interaction.open) return;
    if (activeDialogueSession?.owner !== "story" || !activeDialogueSession.id.startsWith("narrative-intro:")) return;
    openInteraction(L3_NARRATIVE_OPENING_COMMAND_NO, state.eventLog.length);
  }, [hPresentationSession, activeDialogueSession?.id, activeDialogueSession?.owner, interaction.open, openInteraction, presentationMode, state.eventLog.length]);
  useEffect(() => {
    if (hPresentationSession || presentationMode === "minimal" || interaction.open) return;
    if (pendingArrivalEvents && pendingArrivalEvents.length > 0) {
      openInteraction(activeDialogueCommandNo ?? 0, state.eventLog.length);
    }
  }, [hPresentationSession, presentationMode, pendingArrivalEvents, activeDialogueCommandNo, interaction.open, openInteraction, state.eventLog.length]);
  const dialoguePresentationOwner = useRef<{ id: string; interaction: typeof interaction } | null>(null);
  useEffect(() => {
    const previousOwner = dialoguePresentationOwner.current;
    dialoguePresentationOwner.current = activeDialogueSession && interaction.open
      ? { id: activeDialogueSession.id, interaction } : null;
    // Cancellation/load/owner withdrawal can clear the queue without going
    // through this component's onArrivalExit. Its UI shell must end as well.
    // An unbound shell may still be preparing a command or AI-chat draft.
    if (previousOwner !== null && activeDialogueSession === null && interaction.open
      && previousOwner.interaction === interaction && !aiChatDraftOpen && pendingPrompt === null) {
      closeInteraction();
    }
  }, [activeDialogueSession, interaction, aiChatDraftOpen, pendingPrompt, closeInteraction]);
  useEffect(() => {
    if (!hPresentationSession) {
      setHTranscriptStartIndex(null);
      setHPortraitCommandNo(null);
      setHHistoryEvents((history) => history.length ? [] : history);
      hHistoryOwnerRef.current = null;
      return;
    }
    const previousOwner = hHistoryOwnerRef.current;
    if (previousOwner && (previousOwner.target !== hPresentationSession.target || state.eventLog.length < previousOwner.logLength)) {
      setHHistoryEvents([]);
      setHTranscriptStartIndex(state.eventLog.length);
      setHPortraitCommandNo(null);
    }
    hHistoryOwnerRef.current = { target: hPresentationSession.target, logLength: state.eventLog.length };
    const initialIndex = interaction.open
      ? Math.min(interaction.eventLogIndexAtOpen, state.eventLog.length)
      : state.eventLog.length;
    if (hTranscriptStartIndex === null) setHTranscriptStartIndex(initialIndex);
    if (hPortraitCommandNo === null) {
      const transcriptIndex = hTranscriptStartIndex ?? initialIndex;
      const issued = [...state.eventLog.slice(transcriptIndex)].reverse().find(
        (event): event is Extract<ObservationEvent, { kind: "COMMAND_ISSUED" }> => event.kind === "COMMAND_ISSUED",
      );
      if (issued) setHPortraitCommandNo(issued.commandNo);
    }
    // A legacy command can have opened the modal just before the H session
    // flag committed. H owns the display now, so discard only that UI shell.
    if (interaction.open) closeInteraction();
  }, [
    hPresentationSession?.target,
    hPresentationSession?.startedAtTick,
    hTranscriptStartIndex,
    hPortraitCommandNo,
    interaction.open,
    interaction.eventLogIndexAtOpen,
    closeInteraction,
    state.eventLog,
  ]);
  const aiChatAvailable = aiEnabled && filterTarget > 0 && currentAiCharacterProfile(filterTarget).enabled;
  const readyNarrativeEvent = (state.narrativeEvents ?? [])
    .filter((event) => event.status === "ready")
    .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id))
    .find((event) => event.locationIds.includes(state.master.location)
      || (actionTarget !== undefined && event.participantIds.includes(actionTarget)));
  // The story the status bar reports on. A resolved or cancelled story is over
  // and says nothing; an expired one is still worth showing once, so the player
  // learns the scene they were told about has passed rather than watching it
  // silently disappear.
  const narrativePursuit = useMemo<NarrativePursuitSummary | null>(() => {
    const tracked = (state.narrativeEvents ?? [])
      .filter((event) => event.status === "scheduled" || event.status === "ready" || event.status === "active" || event.status === "missed" || event.status === "expired")
      .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id));
    // A live story outranks a missed one: the player can still act on it.
    const live = tracked.filter((event) => event.status !== "expired" && event.status !== "missed");
    const chosen = live[0] ?? tracked[tracked.length - 1];
    if (!chosen) return null;
    const speaker = chosen.participantIds
      .filter((id) => id !== 0)
      .map((id) => state.charas[id])
      .find((slot) => slot !== undefined);
    const name = speaker?.callName || speaker?.name;
    return {
      id: chosen.id,
      hint: chosen.status === "expired" || chosen.status === "missed"
        ? "好像已经错过了什么，之后再留意一下吧。"
        : name
          ? `好像${name}要找你，不妨留意一下。`
          : "好像附近有些事件，不妨留意一下。",
      state: chosen.status === "active" ? "active" : chosen.status === "expired" || chosen.status === "missed" ? "missed" : "waiting",
      count: Math.max(1, live.length),
    };
  }, [state.narrativeEvents, state.charas]);
  // What the L3 director is doing right now. During pre-authoring there is no
  // event yet — this readout is the only way the player can tell "the director
  // is working" or "a window is promised, go there" apart from silence.
  const narrativeDirector = useMemo(
    () => describeNarrativeDirectorStatus(state, narrativeDirectorStatus, aiDebugEntries),
    [state, narrativeDirectorStatus, aiDebugEntries],
  );
  const gridActions: CommandGridAction[] = availability
    .filter((a) => a.usable)
    .filter((a) => !MENU_EXCLUDED_COMMANDS.has(a.commandNo))
    // H exits are pinned in a fixed control strip below; keeping them out of
    // the scrollable Act_COM groups prevents an exit from disappearing below
    // a long H command list or being rendered twice.
    .filter((a) => !(hMode && (a.commandNo === 850 || a.commandNo === 999)))
    // Upstream shows ONE grid: `@QOL_SHOW_USERCOM` walks every command and
    // keeps whatever passes `@COM_ABLE` + `@QUICKFILTER`. Only the everyday
    // page hides the うふふ-only acts (they need a partner in H state).
    .filter((a) => visibleOnCommandGrid(a.commandNo, hMode))
    .filter((a) => !quickFilterHidden(comFilterClassOf(a.commandNo), filterTarget, state))
    .map((a) => {
      return {
        commandNo: a.commandNo,
        label: a.labelOverride ?? commandLabel(a.commandNo, state, filterTarget),
        usable: true as const,
        highlighted: a.commandNo === 351 && filterTarget > 0 &&
          getCharaCflag(state, filterTarget, CFLAG_ID.同行) === 0,
        ...(a.deferred ? { deferred: true as const } : {}),
      };
    })
    .sort((x, y) => x.commandNo - y.commandNo);
  if (readyNarrativeEvent && !hMode) {
    gridActions.push({
      commandNo: L3_NARRATIVE_OPENING_COMMAND_NO,
      label: readyNarrativeEvent.startCommandLabel ?? readyNarrativeEvent.title,
      usable: true,
      narrativeOpening: true,
    });
  }
  const hActionGroups = hMode
    ? COMMAND_FAMILIES.map((family) => ({
        id: family.id,
        label: family.id === "hmode" ? "H 控制" : family.label,
        items: gridActions.filter((action) => familyOf(action.commandNo).id === family.id),
      })).filter((group) => group.items.length > 0)
    : undefined;
  // The exit strip reads its labels from the same runtime authority as every
  // other button. 999's label is state-dependent (结束幽会 / 解除时间停止), so a
  // hard-coded string here would disagree with the command grid. The fallbacks
  // only apply when the command's own gate hides it.
  const exitLabel = (commandNo: number, fallback: string) =>
    availability.find((a) => a.commandNo === commandNo)?.labelOverride ?? fallback;
  const hExitControls = hMode && filterTarget > 0
    ? [
        { commandNo: 999, label: exitLabel(999, "结束幽会"), detail: "结束当前 H 会话并清理插入状态" },
        ...(getCharaCflag(state, filterTarget, CFLAG_ID.诶嘿嘿) === 2
          ? [{ commandNo: 850, label: exitLabel(850, "退出逆推"), detail: "结束对方主导的逆推会话" }]
          : []),
      ]
    : [];

  const bugTrapAvailable = availability.some((action) => action.commandNo === 448 && action.usable);

  // The filter toggle row (`@过滤器表示`): sex filters (Ｖ/Ａ/ＳＭ/侍奉) only
  // appear during うふふ; the rest always show. Each button's "pressed" state
  // mirrors upstream `!過濾器flag` (pressed = filter OFF = class hidden).
  const filterButtons = COM_FILTERS
    .filter((f) => !f.sexOnly || hMode)
    .map((f) => ({
      toggleId: f.toggleId,
      label: f.label,
      on: filterOn(f, filterTarget, state),
    }));

  // Collect available room-move commands from scene exits for the map view
  // (same trial-run filtering as the on-screen exits).
  // Parity QA P-22 — when a colored map exists, WITHIN-MAP destinations are
  // reached by clicking map cells (not flat-listed as buttons). Only CROSS-MAP
  // 外出 destinations (a different map root the map can't render as a cell)
  // stay as buttons. The map root is the part before ":" (神社 / 人間之里).
  const mapRoot = location.split(":")[0]!;
  const withinMapExits = exits.filter((e) => e.toLocation.split(":")[0] === mapRoot);
  // 外出 (P-22 follow-up): cross-map destinations no longer render as inline
  // Ex_COM buttons — they're reached through the global world map (the 外出
  // button below, faithful to COM405 → @OTHERREGIONS). The grid keeps only
  // within-map rooms the colored map can't render as a clickable cell
  // (神社:自室 has no upstream colored-map number). Unmapped areas have no
  // such rooms, so their grid is empty — their cross-map exit is covered by
  // 外出 too.
  const unnumberedRoomExits = withinMapExits.filter((e) => e.toLocation === "神社:自室");
  const gridExits = hasMap ? unnumberedRoomExits : [];
  // P1-2 (实玩反馈 #6): 外出 is always available in a built region (it opens
  // the global world map = @OTHERREGIONS, where the player picks another
  // region). Previously gated to the home region only, so the player in
  // 人間の里 couldn't find 外出. Now常驻 — the world map itself disables the
  // current region, so 外出 is always meaningful.
  const canUseGoOut = hasMap;
  const actualCompanions = Object.values(state.charas).filter((slot) => getCharaCflag(state, slot.charaNum, CFLAG_ID.同行) > 0);
  const dateEntry = actualCompanions.length === 1 && canStartPlayerDate(state, actualCompanions[0]!.charaNum).ok;
  const moveCommands = withinMapExits.map((e) => ({
    commandNo: e.commandNo,
    toLocation: e.toLocation,
    label: e.label,
  }));

  const beginMinimalNavigation = (): boolean => {
    if (presentationMode !== "minimal") return true;
    if (minimalNavigationPending || !clearCompletedDialogueBeforeNavigation()) return false;
    setMinimalNavigationPending(true);
    return true;
  };

  const finishMinimalNavigation = (): void => {
    if (presentationMode === "minimal") setMinimalNavigationPending(false);
  };

  const handleExit = (commandNo: number): void => {
    if (movementBlocked || trainingMovementLocked) return;
    if (!beginMinimalNavigation()) return;
    const destination = exits.find((exit) => exit.commandNo === commandNo)?.toLocation;
    const move = (): void => {
      onIntent(issueCommand(commandNo));
      finishMinimalNavigation();
    };
    if (!destination || !onPrepareKojoForLocations) move();
    else void onPrepareKojoForLocations([destination]).then(move).catch((error) => {
      console.warn("[eraTW] movement kojo preflight failed:", error);
      finishMinimalNavigation();
    });
  };

  // Map click → move, then auto-return to the scene view (the player asked
  // for "click a spot and go there" — not "click then manually close the map").
  const handleMapMove = (commandNo: number): void => {
    if (movementBlocked || trainingMovementLocked) return;
    if (!beginMinimalNavigation()) return;
    const destination = commandNo === 10703
      ? state.homeLocation
      : moveCommands.find((move) => move.commandNo === commandNo)?.toLocation;
    const move = (): void => {
      onIntent(issueCommand(commandNo));
      finishMinimalNavigation();
    };
    if (!destination || !onPrepareKojoForLocations) move();
    else void onPrepareKojoForLocations([destination]).then(move).catch((error) => {
      console.warn("[eraTW] map kojo preflight failed:", error);
      finishMinimalNavigation();
    });
    setShowMap(false);
  };

  // Map click → walk a full multi-hop path to a clicked room (实玩反馈 #9,
  // Phase D). Instead of teleporting (or silently issuing N per-hop intents),
  // run ONE faithful SKIP_MOVE: walk the route, narrate who you pass in each
  // intermediate room, and pay the time cost once. `rooms` is the ordered
  // [first hop … destination] room list from ColoredMapView's pathfind.
  const handleMapPath = (rooms: string[]): void => {
    if (movementBlocked || trainingMovementLocked) return;
    if (!beginMinimalNavigation()) return;
    if (onWalkPath) {
      try {
        const result = onWalkPath(rooms);
        if (result && typeof result.then === "function") {
          void result.catch((error) => {
            console.warn("[eraTW] map path kojo preflight failed:", error);
          }).finally(finishMinimalNavigation);
        } else {
          finishMinimalNavigation();
        }
      } catch (error) {
        finishMinimalNavigation();
        console.warn("[eraTW] map path failed:", error);
      }
    } else {
      finishMinimalNavigation();
    }
    setShowMap(false);
  };

  // 外出 / 移動至其他地域 → pick a region on the world map → cross-map move
  // (10701/10702/10703). The handler deposits the master at the region
  // entrance, then we return to the scene view.
  const handleWorldTravel = (commandNo: number): void => {
    if (movementBlocked || trainingMovementLocked) return;
    if (!beginMinimalNavigation()) return;
    const region = REGIONS.find((item) => item.commandNo === commandNo);
    const travel = (): void => {
      if (state.dateSession?.phase === "active" && region) {
        onIntent(issueCommand(19997, state.dateSession.partner, pickOneAnswer(region.mapId)));
      } else if (!state.outing && !state.dateSession && region) {
        onIntent(issueCommand(405, dateEntry ? actualCompanions[0]!.charaNum : 0, pickOneAnswer(region.mapId)));
      } else {
        onIntent(issueCommand(commandNo));
      }
      finishMinimalNavigation();
    };
    const regionLocations = region
      ? [...new Set(Object.values(state.charas)
          .filter((chara) => currentMapIdForLocation(chara.location) === region.mapId)
          .map((chara) => chara.location))]
      : [];
    if (regionLocations.length === 0 || !onPrepareKojoForLocations) travel();
    else void onPrepareKojoForLocations(regionLocations).then(travel).catch((error) => {
      console.warn("[eraTW] travel kojo preflight failed:", error);
      finishMinimalNavigation();
    });
    setShowWorldMap(false);
  };
  const openWorldMap = (): void => {
    if (movementBlocked || trainingMovementLocked) return;
    setShowMap(false);
    setShowWorldMap(true);
  };

  const handleResolveWalkEncounter = (choice: WalkChoice): void => {
    if (!walkEncounter || !onResolveWalkEncounter) return;
    walkEncounterCloseSeq.current += 1;
    // Phase detection: a `stop` always ends the walk → single. For
    // greet/ignore, the walk continues into the queued rooms; if
    // `walkSession.remaining` is empty this was the last encounter →
    // single, otherwise the walk pauses at the next person → multi.
    const capturedEventLogIndex = state.eventLog.length;
    const capturedEncounter = walkEncounter;
    const hasMore = state.walkSession && state.walkSession.remaining.length > 0;
    const phase: ClosingWalkEncounter["phase"] =
      choice === "stop" || !hasMore ? "single" : "multi";
    onResolveWalkEncounter(choice);
    setClosingWalkEncounter({
      key: walkEncounterCloseSeq.current,
      encounter: capturedEncounter,
      eventLogIndexAtChoice: capturedEventLogIndex,
      phase,
    });
  };

  // Locked door (潜入/算了) — simpler than the encounter card: just forward the
  // choice; the @潜入房間 narration lands in the scene band.
  const handleResolveLockedDoor = (choice: WalkChoice): void => {
    if (!lockedDoor || !onResolveWalkEncounter) return;
    onResolveWalkEncounter(choice);
  };

  const handleAdvanceWalkEncounterResult = (): void => {
    // 2026-07-07: both `single` and `multi` wait for a click. Clearing
    // here surfaces the next encounter's choice UI (multi) or just
    // dismisses the card (single).
    setClosingWalkEncounter(null);
  };

  const handleDateInvitationResponse = (commandNo: 19989 | 19988, invitation: DatePlanEvent): void => {
    if (presentationMode !== "minimal" && !interaction.open) {
      openInteraction(commandNo, state.eventLog.length);
    }
    dismissSceneAmbientForParticipant(invitation.partner);
    onIntent(issueCommand(commandNo, invitation.partner));
  };

  /**
   * Open the interaction box (if not already open) and issue `commandNo` on the
   * present NPC. Split out of {@link handleAction} so a pre-phase overlay (e.g.
   * the 採集中 progress frames) can defer the issue until it finishes without
   * duplicating the box/ambient bookkeeping.
   */
  const issueActionCommand = (commandNo: number): void => {
    // Open the box on the first action of a sub-loop, capturing the
    // eventLog length BEFORE the action's events are appended (S4). If
    // the box is already open we keep accumulating, index unchanged.
    // Minimal mode skips the box entirely — kojo streams inline.
    if (presentationMode !== "minimal" && !interaction.open) {
      openInteraction(commandNo, state.eventLog.length);
    }
    // Real COMF command on the present NPC. The resolver
    // settles it for real; with no NPC present `target` is omitted and
    // the handler blocks gracefully.
    if (actionTarget !== undefined) dismissSceneAmbientForParticipant(actionTarget);
    onIntent(issueCommand(commandNo, actionTarget));
  };

  const handleAction = (commandNo: number, directHSession = false): void => {
    if (movementBlocked) return;
    if (!directHSession && commandNo === 350 && !hPresentationSession) {
      // COM350 may create the H session during this intent. Keep its first
      // result, rather than starting the center transcript after settlement.
      setHTranscriptStartIndex(state.eventLog.length);
      setHPortraitCommandNo(commandNo);
    }
    if (!directHSession && (commandNo === 999 || commandNo === 850) && hPresentationSession) {
      setClosingHSession(hPresentationSession);
    }
    if (commandNo === L3_NARRATIVE_OPENING_COMMAND_NO && readyNarrativeEvent) {
      if (startNarrativeEvent(readyNarrativeEvent.id) && presentationMode !== "minimal" && !interaction.open) {
        openInteraction(L3_NARRATIVE_OPENING_COMMAND_NO, state.eventLog.length);
      }
      return;
    }
    // Only the explicit practice course owns the full-screen danmaku surface.
    // COM480 remains the upstream-style deterministic text settlement.
    if (commandNo === 411) {
      if (startDanmakuBattle(commandNo, actionTarget)) {
        if (actionTarget !== undefined) dismissSceneAmbientForParticipant(actionTarget);
        closeInteraction();
        setDanmakuExit(true);
        window.setTimeout(() => setScreen("danmakuBattle"), 760);
      }
      return;
    }
    if (commandNo === 449) {
      setShowBugCatchingMenu(true);
      return;
    }
    // COMF445 採集: run the upstream 采集中 dot frames (COMF445.ERB:81-84)
    // before the draw. Minimal mode has no overlay surface, so it issues
    // straight through.
    if (commandNo === 445 && presentationMode !== "minimal") {
      setGatheringProgress(commandNo);
      return;
    }
    // Open the box on the first action of a sub-loop, capturing the
    // eventLog length BEFORE the action's events are appended (S4). If
    // the box is already open we keep accumulating, index unchanged.
    // Minimal mode skips the box entirely — kojo streams inline.
    if (!directHSession && (presentationMode !== "minimal" || hMode || [350, 351, 353, 354, 355, 356, 357, 358].includes(commandNo)) && !interaction.open) {
      openInteraction(commandNo, state.eventLog.length);
    }
    // Real COMF command on the present NPC. The resolver
    // settles it for real; with no NPC present `target` is omitted and
    // the handler blocks gracefully.
    if (actionTarget !== undefined) dismissSceneAmbientForParticipant(actionTarget);
    onIntent(issueCommand(commandNo, actionTarget));
  };

  const handleHAction = (commandNo: number): void => {
    if (!clearCompletedDialogueBeforeNavigation()) return;
    // Archive the final transcript once, at the command boundary. Streaming
    // and choice replay continue to replace only the live tail above it.
    setHHistoryEvents((history) => [...history, ...hCurrentEvents]);
    setHTranscriptStartIndex(state.eventLog.length);
    setHPortraitCommandNo(commandNo);
    if ((commandNo === 999 || commandNo === 850) && hPresentationSession) {
      setClosingHSession(hPresentationSession);
    }
    if (interaction.open) closeInteraction();
    handleAction(commandNo, true);
  };

  const handleAiChatSubmit = (semantic: string): boolean => {
    if (!aiChatAvailable) return false;
    const started = startAiChat(filterTarget, semantic);
    if (started) {
      dismissSceneAmbientForParticipant(filterTarget);
      setAiChatDraftOpen(false);
    }
    return started;
  };

  const handleTrackChara = (charaNum: number): void => {
    if (movementBlocked || trainingMovementLocked) return;
    const target = state.charas[charaNum];
    if (!target) return;
    const path = findPath(state.master.location, target.location);
    if (!path) return;
    if (!beginMinimalNavigation()) return;
    setSelectedTarget(charaNum);
    setExcomPanel(null);
    if (path.length > 0 && onWalkPath) {
      const result = onWalkPath(path.map((step) => step.toLocation));
      if (result && typeof result.then === "function") {
        void result.catch((error) => {
          console.warn("[eraTW] character tracking kojo preflight failed:", error);
        }).finally(finishMinimalNavigation);
      }
      else finishMinimalNavigation();
    } else {
      finishMinimalNavigation();
    }
  };

  const handleBugCatchingAction = (commandNo: 448 | 449): void => {
    if (movementBlocked) return;
    setShowBugCatchingMenu(false);
    if (presentationMode !== "minimal" && !interaction.open) {
      openInteraction(commandNo, state.eventLog.length);
    }
    if (actionTarget !== undefined) dismissSceneAmbientForParticipant(actionTarget);
    onIntent(issueCommand(commandNo, actionTarget));
  };

  const handleDateReturn = (): void => {
    if (!state.dateSession || movementBlocked || trainingMovementLocked) return;
    if (!beginMinimalNavigation()) return;
    onIntent(issueCommand(19998, state.dateSession.partner));
    finishMinimalNavigation();
  };

  const boxEvents = interaction.open
    ? pendingArrivalEvents && pendingArrivalEvents.length > 0
      ? pendingArrivalEvents
      : state.eventLog.slice(interaction.eventLogIndexAtOpen)
    : [];
  const hLogEvents = hPresentationSession
    ? state.eventLog.slice(Math.min(hTranscriptStartIndex ?? state.eventLog.length, state.eventLog.length))
      .filter((event) => !(event.kind === "DIALOGUE_LINE" && event.origin !== "ai"
        && replacedAuthorLineKeys.includes(eventInstanceKey(event))))
    : [];
  const hTranscriptEvents = hPresentationSession ? activeDialogueSession?.transcript ?? [] : [];
  const hCurrentEvents = mergeCommandTranscript(hLogEvents, hTranscriptEvents);
  const hSessionEvents = [...hHistoryEvents, ...hCurrentEvents];
  const boxSessionId =
    activeDialogueSession?.id ?? `command:${interaction.eventLogIndexAtOpen}`;
  const diaryBookActive =
    interaction.open &&
    effectiveRootCommandNo === 406 &&
    diaryPages(boxEvents).length > 0;
  const radioBroadcast = effectiveRootCommandNo === 496
    ? boxEvents.find((event): event is Extract<ObservationEvent, { kind: "NARRATION" }> =>
      event.kind === "NARRATION" && event.text.includes("收音机"),
    )?.text
    : undefined;
  const radioCharacterEntry = radioInteractionActive
    ? buildRadioCharacterEntry(boxEvents, boxSessionId)
    : null;
  // COM496 owns the same formal InteractionBox surface as command dialogue.
  // Suppress any stale scene-ambient entry from the first radio render so the
  // radio page always has presentation priority; ambient resumes only after
  // the modal closes and useSceneAmbient's post-paint delay elapses.
  const weatherStyle = weatherBackgroundStyle(state) as CSSProperties;

  // Ex_COM tool buttons (能力显示/日历/污渍/所在地/角色情报/道具/钓具).
  // Shared by the full Ex_COM row and the minimal-mode [▸ 工具] fold-out.
  const excomToolButtons = (
    <>
      {actionTarget !== undefined && (
        <button
          type="button"
          className="excom-row__btn"
          data-testid="excom-ability-target"
          onClick={() => setExcomPanel("ability-target")}
        >
          [能力显示]
        </button>
      )}
      <button
        type="button"
        className="excom-row__btn"
        data-testid="excom-ability-master"
        onClick={() => setExcomPanel("ability-master")}
      >
        [能力显示(主角)]
      </button>
      <button
        type="button"
        className="excom-row__btn"
        data-testid="excom-calendar"
        onClick={() => setExcomPanel("calendar")}
      >
        [日历]
      </button>
      <button
        type="button"
        className="excom-row__btn"
        data-testid="excom-yogore"
        onClick={() => setExcomPanel("yogore")}
      >
        [污渍显示]
      </button>
      <button
        type="button"
        className={`excom-row__btn${whereaboutsGate.ok ? "" : " excom-row__btn--disabled"}`}
        data-testid="excom-whereabouts"
        disabled={!whereaboutsGate.ok}
        title={whereaboutsGate.reason}
        onClick={() => setExcomPanel("whereabouts")}
      >
        [所在地察觉]
      </button>
      <button
        type="button"
        className={`excom-row__btn${actionTarget === undefined ? " excom-row__btn--disabled" : ""}`}
        disabled={actionTarget === undefined}
        title={actionTarget === undefined ? "请先选择目标角色" : `查看 ${state.charas[actionTarget]?.callName ?? actionTarget} 的详细情报`}
        data-testid="excom-char-info"
        onClick={() => { const t = actionTarget; if (t !== undefined) setCharacterInfoChara(t); }}
      >
        {actionTarget !== undefined ? `[角色情报 → ${state.charas[actionTarget]?.callName ?? `#${actionTarget}`}]` : "[角色情报]"}
      </button>
      {/* Honest stub (upstream Ex_COM has 道具确认; item-name table not
          wired yet — disabled + reason, NOT a fake working button). */}
      <button
        type="button"
        className="excom-row__btn"
        title="道具名称表尚未接入"
        data-testid="excom-items"
        onClick={() => setExcomPanel("living")}
      >
        [道具确认]
      </button>
      {location === "魔法之森:香霖堂" && (
        <button type="button" className="excom-row__btn" data-testid="kourindou-tackle" onClick={() => setShowTackleShop(true)}>
          [钓具柜台]
        </button>
      )}
    </>
  );

  const interactionBoxProps = {
      sessionId: boxSessionId,
      events: boxEvents,
      state,
      onExit: () => {
        if (activeDialogueSession) onArrivalExit();
        else closeInteraction();
        setAiChatDraftOpen(false);
        if (!state.training) setClosingHSession(null);
      },
      pendingChoice: pendingKojoChoice
        ? {
            options: pendingKojoChoice.options,
            ...(pendingKojoChoice.continuationInputMode
              ? { inputMode: pendingKojoChoice.continuationInputMode }
              : {}),
          }
        : null,
      onPickChoice: (idx: number | string) => {
        if (pendingKojoChoice?.kind === "story") {
          const choiceId = pendingKojoChoice.storyChoiceIds?.[Number(idx)];
          if (choiceId) resolveStoryChoice(choiceId);
          return;
        }
        resolveKojoChoice(idx);
      },
      aiPending: activeDialogueSession?.aiRequestId !== undefined,
      aiCharaNum: activeDialogueSession?.aiCharaNum ?? (aiChatInteractionActive ? filterTarget : undefined),
      aiChatMode: aiChatInteractionActive,
      aiChatInput: aiChatInteractionActive && aiChatDraftOpen,
      onSubmitAiChat: handleAiChatSubmit,
      onRespondAccompany: respondAccompany,
      onPickAiBranch: (choiceLabel: string, lines: ObservationEvent[]) => {
        if (boxSessionId) return appendAiChatBranch(boxSessionId, choiceLabel, lines);
      },
      radioActive: radioInteractionActive,
      radioBroadcast,
      radioUnderstood,
      radioCharacterEntry,
  };
  const sceneDialogueActive = sceneDialogue && !hPresentationSession
    && !diaryBookActive && !radioInteractionActive && !state.sleepSession
    && activeDialogueSession?.owner !== "story";

  return (
    <div className={`game-client${presentationMode === "immersive" ? " game-client--immersive" : ""}${presentationMode === "minimal" ? " game-client--minimal" : ""}${sceneDialogueActive ? " game-client--scene-dialogue" : ""}${hPresentationSession ? " game-client--h-session" : ""}${danmakuExit ? " game-client--battle-exit" : ""}${battleReturn ? " game-client--battle-return" : ""}`} data-testid="game-client" style={weatherStyle}>
      <div className="game-client__top">
        <GameStatusBar
          state={state}
          target={actionTarget}
          showHSessionStatus={!hPresentationSession}
          layout={presentationMode === "immersive" ? "world-only" : presentationMode === "minimal" ? "minimal" : "full"}
          onReleaseTimeStop={() => handleAction(999)}
          onTimeStop={() => handleAction(355)}
          onOpenCharaInfo={(charaNum) => setCharacterInfoChara(charaNum)}
          onSelectChara={presentationMode === "minimal" ? setSelectedTarget : undefined}
          narrativePursuit={narrativePursuit}
          narrativeDirector={narrativeDirector}
          narrativePanelOpen={narrativePanelOpen}
          onToggleNarrativePanel={() => setNarrativePanelOpen((open) => !open)}
        />
      </div>

      {hPresentationSession && (
        <HSessionView
          key={hPresentationSession.target}
          state={state}
          session={hPresentationSession}
          closing={hPresentationClosing}
          actions={hPresentationClosing ? [] : gridActions}
          filters={hPresentationClosing ? [] : filterButtons}
          exitControls={hExitControls}
          onAction={handleHAction}
          onToggleFilter={onToggleFilter}
          events={hSessionEvents}
          currentEvents={hCurrentEvents}
          commandNo={hPortraitCommandNo}
          onOpenAiSettings={() => setShowAiSettings(true)}
          onClose={() => {
            setClosingHSession(null);
            closeInteraction();
          }}
          choices={pendingKojoChoice?.options ?? null}
          onPickChoice={(index) => {
            if (pendingKojoChoice?.kind === "story") {
              const choiceId = pendingKojoChoice.storyChoiceIds?.[index];
              if (choiceId) resolveStoryChoice(choiceId);
              return;
            }
            resolveKojoChoice(index);
          }}
          reading={pendingPrompt !== null || activeDialogueSession?.aiRequestId !== undefined}
        />
      )}

      <div className="game-client__middle">
        {presentationMode === "immersive" && (
          <TextGameInfoPanel
            state={state}
            target={actionTarget}
            onOpenCharaInfo={(charaNum) => setCharacterInfoChara(charaNum)}
            onSetPortraitVariant={setPortraitVariant}
          />
        )}
        <div className={`game-client__scene-slot${sceneDialogueActive ? " game-client__scene-slot--dialogue" : ""}`}>
        {lockedDoor ? (
          <div className="walk-encounter-layer" data-testid="locked-door-layer">
            {presentationMode !== "minimal" && (
            <SceneView
              asciiShell={presentationMode === "immersive"}
              scene={finalScene}
              present={present}
              bandEvents={state.eventLog}
              ambientEntry={radioInteractionActive ? null : ambientEntry}
              showInlineHistory={false}
              showInlineAmbient={false}
              showSceneContext
              showPortraitAmbient
              selectedChara={actionTarget}
              state={state}
            />
            )}
            <div className="walk-encounter-stack" data-testid="locked-door-stack">
              <div className="walk-encounter" role="dialog" aria-label="上锁的房间">
                <div className="walk-encounter__portrait">
                  {portraitForDynamicCharacter(state, lockedDoor.ownerCharaNum) ? (
                    <MobPortrait
                      className="walk-encounter__portrait-img walk-encounter__portrait-img--mob"
                      portrait={portraitForDynamicCharacter(state, lockedDoor.ownerCharaNum)!}
                      alt={lockedDoor.ownerName}
                      testId="locked-door-mob-portrait"
                    />
                  ) : (() => {
                    // Guard on the SAME resolution that is rendered. A numeric
                    // `PORTRAITS[charaNum]` probe disagrees with the draw for
                    // authored residents (`role:` keys) and disguised
                    // characters (変化先), which produced a blank silhouette
                    // where art actually existed.
                    const owner = lockedDoor.ownerCharaNum;
                    const ownerSource = portraitForState(
                      state,
                      owner,
                      portraitSourceForState(state, owner, PORTRAITS),
                    );
                    const ownerKind = portraitKind(state);
                    const ownerDimension = dimensionForKind(ownerSource, ownerKind);
                    // 裸/服分支。`checkNude` 是上游 `CHECK_NUDE` 的口径
                    // （`IMAGE.ERB:898-910`），**不看内衣**；与换装判定同源，
                    // 避免底图取 `服` 分支而 token 取 `_裸_` 分支的错配。
                    const ownerNaked = checkNude(state, owner);
                    const dim = portraitWithOutfit(
                      state,
                      owner,
                      ownerSource,
                      portraitForClothing(ownerDimension, ownerNaked),
                      ownerNaked,
                      ownerKind,
                    );
                    return dim ? (
                      <SpriteCrop
                        className="walk-encounter__portrait-img"
                        source={dim}
                        alt={lockedDoor.ownerName}
                        frameWidth={112}
                        frameHeight={172}
                      />
                    ) : (
                      <span className="walk-encounter__portrait-fallback" aria-hidden="true" />
                    );
                  })()}
                  <span className="walk-encounter__name">{lockedDoor.ownerName}</span>
                </div>
                <div className="walk-encounter__body">
                  <p className="walk-encounter__text">
                    {lockedDoor.location.split(":").pop()}的门锁着，
                    {lockedDoor.ownerName}似乎正在里面睡觉。
                  </p>
                  <p className="walk-encounter__hint">要潜入房间吗？</p>
                  <div className="walk-encounter__choices">
                    <button
                      type="button"
                      data-testid="locked-door-sneak"
                      onClick={() => handleResolveLockedDoor("sneak")}
                    >
                      潜入房间
                    </button>
                    <button
                      type="button"
                      data-testid="locked-door-giveup"
                      onClick={() => handleResolveLockedDoor("giveup")}
                    >
                      算了吧
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : visibleWalkEncounter ? (
          <div className="walk-encounter-layer" data-testid="walk-encounter-layer">
            {presentationMode !== "minimal" && (
            <SceneView
              asciiShell={presentationMode === "immersive"}
              scene={finalScene}
              present={present}
              bandEvents={sceneBandEventsForPresentation}
              ambientEntry={radioInteractionActive ? null : ambientEntry}
              showInlineHistory={false}
              showInlineAmbient={false}
              showSceneContext
              showPortraitAmbient
              selectedChara={actionTarget}
              state={state}
            />
            )}
            <div
              className={
                "walk-encounter-stack" +
                (resultWalkEncounter ? " walk-encounter-stack--result" : "")
              }
              data-testid="walk-encounter-stack"
            >
            <div
              className={
                "walk-encounter" +
                (resultWalkEncounter
                  ? " walk-encounter--advance"
                  : "")
              }
              data-testid="walk-encounter"
              role="button"
              tabIndex={resultWalkEncounter ? 0 : undefined}
              aria-label={
                resultWalkEncounter?.phase === "multi"
                  ? "下一个路过的人"
                  : "移动中遭遇"
              }
              onClick={
                resultWalkEncounter
                  ? handleAdvanceWalkEncounterResult
                  : undefined
              }
              onKeyDown={(event) => {
                if (!resultWalkEncounter) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                handleAdvanceWalkEncounterResult();
              }}
            >
              <div className="walk-encounter__portrait" data-testid="walk-encounter-portrait">
                {portraitForDynamicCharacter(state, visibleWalkEncounter.charaNum) ? (
                  <MobPortrait
                    className="walk-encounter__portrait-img walk-encounter__portrait-img--mob"
                    portrait={portraitForDynamicCharacter(state, visibleWalkEncounter.charaNum)!}
                    alt={visibleWalkEncounter.name}
                    testId="walk-encounter-mob-portrait"
                  />
                ) : (() => {
                  // Guard on the SAME resolution that is rendered — see the
                  // locked-door card above.
                  const enc = visibleWalkEncounter.charaNum;
                  const encSource = portraitForState(
                    state,
                    enc,
                    portraitSourceForState(state, enc, PORTRAITS),
                  );
                  const encKind = portraitKind(state);
                  const encDimension = dimensionForKind(encSource, encKind);
                  const encNaked = checkNude(state, enc);
                  const dim = portraitWithOutfit(
                    state,
                    enc,
                    encSource,
                    portraitForClothing(encDimension, encNaked),
                    encNaked,
                    encKind,
                  );
                  return dim ? (
                    <SpriteCrop
                      className="walk-encounter__portrait-img"
                      source={dim}
                      alt={visibleWalkEncounter.name}
                      frameWidth={112}
                      frameHeight={172}
                      cropTestId="walk-encounter-crop"
                      imageTestId="walk-encounter-img"
                    />
                  ) : (
                    <span className="walk-encounter__portrait-fallback" aria-hidden="true" />
                  );
                })()}
                <span className="walk-encounter__name">
                  {walkEncounterChara?.callName ?? visibleWalkEncounter.name}
                </span>
              </div>
              <div className="walk-encounter__body">
                <p className="walk-encounter__text">
                  在{visibleWalkEncounter.location.split(":").pop()}
                  遇上了 {visibleWalkEncounter.name}
                  {WALK_ACTIVITY[visibleWalkEncounter.kehai] ?? ""}。
                </p>
                {showWalkEncounterChoices && (
                  <>
                    <div className="walk-encounter__choices">
                      <button
                        type="button"
                        data-testid="walk-ignore"
                        onClick={() => handleResolveWalkEncounter("ignore")}
                      >
                        无视
                      </button>
                      <button
                        type="button"
                        data-testid="walk-greet"
                        disabled={!visibleWalkEncounter.canGreet}
                        title={visibleWalkEncounter.canGreet ? "" : "时间停止中无法打招呼"}
                        onClick={() => handleResolveWalkEncounter("greet")}
                      >
                        打声招呼后继续
                      </button>
                      <button
                        type="button"
                        data-testid="walk-stop"
                        onClick={() => handleResolveWalkEncounter("stop")}
                      >
                        停下来
                      </button>
                    </div>
                  </>
                )}
                {/* 2026-07-07: the whole encounter card is clickable for BOTH
                    single and multi — the last character no longer auto-
                    fades. No on-screen hint text; cursor: pointer in CSS. */}
              </div>
            </div>
            {walkEncounterKojoLines.length > 0 && (
              <div className="walk-encounter__kojo" data-testid="walk-encounter-kojo">
                {walkEncounterKojoLines.map((event, i) => (
                  <p
                    key={i}
                    className="walk-encounter__kojo-line"
                    style={{ color: kojoColor(event.charaNum) }}
                  >
                    {formatGameEvent(event, state)}
                  </p>
                ))}
              </div>
            )}
            </div>
          </div>
        ) : showWorldMap ? (
          presentationMode === "minimal" ? (
            <MinimalOutingList
              currentLocation={location}
              onTravel={handleWorldTravel}
              onClose={() => setShowWorldMap(false)}
              blocked={movementBlocked || trainingMovementLocked}
            />
          ) : (
          <WorldMapView
            currentLocation={location}
            onTravel={handleWorldTravel}
            onClose={() => setShowWorldMap(false)}
            season={state.time.season}
          />
          )
        ) : hasMap && showMap ? (
          <ColoredMapView
            currentLocation={location}
            onMove={handleMapMove}
            onMovePath={handleMapPath}
            moveCommands={moveCommands}
            onClose={() => setShowMap(false)}
            onOpenWorldMap={openWorldMap}
            onReturnHome={() => handleMapMove(10703)}
            canReturnHome={location !== (state.homeLocation ?? "")}
            season={state.time.season}
            gameState={state}
          />
        ) : hasNpc ? (
          presentationMode === "minimal" ? (
            <MinimalTextStream
              scene={finalScene}
              bandEvents={sceneBandEventsForPresentation}
              ambientEntry={radioInteractionActive ? null : ambientEntry}
              liveSession={activeDialogueSession}
              aiPending={activeDialogueSession?.aiRequestId !== undefined}
              extraLines={minimalAiBranchLines}
              suppressedEventKeys={replacedAuthorLineKeys}
              state={state}
            />
          ) : (
          <SceneView
            asciiShell={presentationMode === "immersive"}
            scene={finalScene}
            present={present}
            bandEvents={sceneBandEventsForPresentation}
            ambientEntry={radioInteractionActive ? null : ambientEntry}
            showInlineHistory={false}
            showInlineAmbient={false}
            showSceneContext
            showPortraitAmbient
            selectedChara={actionTarget}
            onSelectChara={sceneDialogue && movementBlocked ? undefined : setSelectedTarget}
            state={state}
            onCommissionClick={setCommissionPopupChara}
            onTogglePortraitKind={togglePortraitKind}
          />
          )
        ) : (
          presentationMode === "minimal" ? (
            <MinimalTextStream
              scene={finalScene}
              bandEvents={sceneBandEventsForPresentation}
              ambientEntry={radioInteractionActive ? null : ambientEntry}
              liveSession={activeDialogueSession}
              aiPending={activeDialogueSession?.aiRequestId !== undefined}
              extraLines={minimalAiBranchLines}
              suppressedEventKeys={replacedAuthorLineKeys}
              state={state}
            />
          ) : (
          <SceneView
            asciiShell={presentationMode === "immersive"}
            scene={finalScene}
            present={present}
            bandEvents={sceneBandEventsForPresentation}
            ambientEntry={radioInteractionActive ? null : ambientEntry}
            showInlineHistory={false}
            showInlineAmbient={false}
            showSceneContext
            // 问题1 — the dynamic scene prose (pitfall clues etc.) renders in
            // the right-hand 场景 panel in immersive mode instead of sitting
            // frozen in the middle of the scene column.
            showAmbientProse={false}
            showPortraitAmbient
            state={state}
          />
          )
        )}
        {sceneDialogueActive && (
          <SceneDialogueOverlay
            key={`${location}:${state.time.dayIndex}`}
            state={state}
            live={interaction.open ? interactionBoxProps : null}
            canComplete={pendingPrompt === null}
            onSkipReply={interaction.open && activeDialogueSession?.aiRequestId !== undefined
              && !activeDialogueSession.aiSettlesCommand && !pendingKojoChoice
              ? interactionBoxProps.onExit : undefined}
          />
        )}
        </div>
        {presentationMode === "immersive" && (
          <aside className="text-game-right" data-testid="text-game-right-column" aria-label="AI 场景对话与历史">
            <SceneAmbientPanel
              entry={radioInteractionActive ? null : ambientEntry}
              sceneEvents={sceneBandEventsForPresentation}
              dynamicProse={finalScene?.ambientProse ?? ""}
              state={state}
              enabled={aiSettings.enabled && !radioInteractionActive}
            />
            <section className="text-game-history-panel" data-testid="text-game-history-panel">
              <h2 className="text-game-panel__heading">┌ 历史 ┐</h2>
              <SceneHistoryPanel
                events={immersiveHistoryEvents}
                state={state}
                placement="sidebar"
                animateNewLines={!sceneDialogue}
                // The immersive history is the complete player-visible event
                // stream. Keep the bounded default for inline scene bands,
                // but do not silently drop older command prose from this
                // dedicated history column (large imported saves can exceed
                // 500 events).
                max={Math.max(1, immersiveHistoryEvents.length)}
              />
            </section>
          </aside>
        )}
      </div>

      {offeredDate && !interaction.open && (
        <section className="date-invitation-card" data-testid="date-invitation-card" role="dialog" aria-live="assertive" aria-labelledby="date-invitation-title">
          <div className="date-invitation-card__heading">约会邀约</div>
          <strong id="date-invitation-title">
            {state.charas[offeredDate.partner]?.callName ?? `#${offeredDate.partner}`}想和你约个时间一起出门。
          </strong>
          <p>提案：{datePlanScheduleLabel(offeredDate)}</p>
          {offeredDates.length > 1 && <p>另有 {offeredDates.length - 1} 份邀约，回应后会依次显示。</p>}
          <div className="date-invitation-card__actions">
            <button type="button" data-testid="accept-date-invitation" onClick={() => handleDateInvitationResponse(19989, offeredDate)}>
              [接受{state.charas[offeredDate.partner]?.callName ?? `#${offeredDate.partner}`}的邀约]
            </button>
            <button type="button" data-testid="decline-date-invitation" onClick={() => handleDateInvitationResponse(19988, offeredDate)}>
              [婉拒{state.charas[offeredDate.partner]?.callName ?? `#${offeredDate.partner}`}]
            </button>
          </div>
        </section>
      )}

      {scheduledDate && (
        <div className="date-appointment-status" data-testid="date-appointment-status" role="status">
          已预约：与{state.charas[scheduledDate.partner]?.callName ?? `#${scheduledDate.partner}`} · {datePlanScheduleLabel(scheduledDate)}
        </div>
      )}

      {/* Minimal mode: inline kojo-choice bar + AI chat input (replaces the
          InteractionBox popup surface; DOM order handled by CSS). */}
      {presentationMode === "minimal" && (
        <div className="game-client__docks" data-testid="minimal-docks">
          <DialogueAccompanyChoices state={state} target={accompanyInvitation?.target ?? actionTarget}
            pending={dialogueQueue.some(session => !!session.aiRequestId || !!session.choice) || pendingPrompt !== null}
            onRespond={respondAccompany} />
          <MinimalChoiceBar
            pendingChoice={pendingKojoChoice}
            liveSession={activeDialogueSession}
            state={state}
            onPickChoice={(value) => {
              if (pendingKojoChoice?.kind === "story") {
                const choiceId = pendingKojoChoice.storyChoiceIds?.[Number(value)];
                if (choiceId) resolveStoryChoice(choiceId);
                return;
              }
              resolveKojoChoice(value);
            }}
            onAppendAiBranch={async (lines, choiceLabel) => {
              if (choiceLabel && activeDialogueSession?.id) {
                return await appendAiChatBranch(activeDialogueSession.id, choiceLabel, lines);
              }
              setMinimalAiBranchLines((prev) => [...prev, ...lines]);
              return true;
            }}
          />
          <MinimalAiChatBar
            open={aiChatDraftOpen}
            aiChatAvailable={aiChatAvailable}
            targetName={actionTarget !== undefined ? state.charas[actionTarget]?.callName : undefined}
            onSubmit={handleAiChatSubmit}
            onClose={() => setAiChatDraftOpen(false)}
          />
        </div>
      )}

      {/* Parity QA P-1 — the Ex_COM utility row (`▼[－] Ex_COM`). Tool
          buttons (变更对象→cycle target), NOT settlement commands.
          Collapsible like upstream; many upstream members (能力显示/道具/
          采集/钓鱼/摄影/CONFIG/瞬間移動 …) depend on subsystems not yet
          built — deferred, see GameClient header.
          Parity QA P-22 — 移动 moved OUT of this row into the CommandGrid 移動
          group (a single "🗺 移动" entry that opens the map menu), so it's no
          longer a buried Ex_COM tool. */}
      <div className="excom-row" data-testid="excom-row">
        {presentationMode === "minimal" ? (
          <>
            {/* minimal: the three mandated entries (移动/外出/AI辅助) stay
                always-visible, plus the gameplay-required 踏上归途 + grid
                exits; every other tool folds behind [▸ 工具]. */}
            <span
              className={"excom-row__tools" + (movementBlocked ? " excom-row__tools--blocked" : "")}
              data-testid="excom-tools"
              aria-disabled={movementBlocked ? "true" : undefined}
              title={movementBlocked ? "移动遭遇处理完毕前无法使用其他指令" : undefined}
            >
              {hasMap && (
                <button
                  type="button"
                  className="excom-row__btn"
                  data-testid="excom-move"
                  disabled={trainingMovementLocked || movementBlocked}
                  title={trainingMovementLocked ? "H 进行中不能移动；信息与设置仍可使用" : movementBlocked ? "当前口上处理完成前不能移动" : undefined}
                  onClick={() => setShowMap((s) => !s)}
                >
                  {showMap ? "[返回场景]" : "[移动]"}
                </button>
              )}
              {canUseGoOut && (
                <button
                  type="button"
                  className="excom-row__btn"
                  data-testid="excom-go-out"
                  disabled={trainingMovementLocked || movementBlocked}
                  title={trainingMovementLocked ? "H 进行中不能外出" : movementBlocked ? "当前口上处理完成前不能外出" : undefined}
                  onClick={openWorldMap}
                >
                  [{dateEntry ? "约会" : "外出"}]
                </button>
              )}
              {state.dateSession && (
                <button type="button" className="excom-row__btn" data-testid="date-return" disabled={trainingMovementLocked || movementBlocked} title={trainingMovementLocked ? "H 进行中不能离开" : undefined} onClick={handleDateReturn}>
                  [踏上归途]
                </button>
              )}
              {gridExits.map((exit) => (
                <button
                  key={exit.commandNo}
                  type="button"
                  className="excom-row__btn"
                  data-testid="exit-button"
                  data-command-no={exit.commandNo}
                  disabled={trainingMovementLocked || movementBlocked}
                  title={trainingMovementLocked ? "H 进行中不能离开当前房间" : movementBlocked ? "当前口上处理完成前不能离开当前房间" : undefined}
                  onClick={() => handleExit(exit.commandNo)}
                >
                  {exit.label}
                </button>
              ))}
              <button
                type="button"
                className="excom-row__btn"
                data-testid="excom-ai-kojo"
                onClick={() => setShowAiSettings(true)}
              >
                [AI辅助{aiEnabled ? "：开" : ""}]
              </button>
            </span>
            {/* No [▸ 工具] fold in minimal mode — the tool buttons add nothing
                on the phone surface. */}
          </>
        ) : (
          <>
          <button
            type="button"
            className="excom-row__collapse"
            data-testid="excom-collapse"
            onClick={() => setShowExCom((s) => !s)}
          >
            {showExCom ? "▾ Ex_COM" : "▸ Ex_COM"}
          </button>
          {showExCom && (
            <span
              className={"excom-row__tools" + (movementBlocked ? " excom-row__tools--blocked" : "")}
              data-testid="excom-tools"
              aria-disabled={movementBlocked ? "true" : undefined}
              title={offeredDate ? `请先回应${state.charas[offeredDate.partner]?.callName ?? `#${offeredDate.partner}`}的邀约` : movementBlocked ? "移动遭遇处理完毕前无法使用其他指令" : undefined}
            >
              {/* 移动 (faithful to the original Ex_COM placement): clicking it
                  opens the colored map page where the player picks a destination
                  cell. Shown only where a map exists. The CommandGrid 「🗺 移动」
                  entry remains as the in-grid affordance — both toggle the map. */}
              {hasMap && (
                <button
                  type="button"
                  className="excom-row__btn"
                  data-testid="excom-move"
                  disabled={trainingMovementLocked}
                  title={trainingMovementLocked ? "H 进行中不能移动；信息与设置仍可使用" : undefined}
                  onClick={() => setShowMap((s) => !s)}
                >
                  {showMap ? "[返回场景]" : "[移动]"}
                </button>
              )}
              {/* 外出 (COM405 → @OTHERREGIONS): cross-map travel is gated behind
                  the global world map. Shown only at a region entrance (where
                  cross-map exits exist), faithful to the upstream AT_HOME gate.
                  Within-map rooms the colored map can't render stay as buttons
                  below (gridExits = 神社:自室 etc.). */}
              {canUseGoOut && (
                <button
                  type="button"
                  className="excom-row__btn"
                  data-testid="excom-go-out"
                  disabled={trainingMovementLocked}
                  title={trainingMovementLocked ? "H 进行中不能外出" : undefined}
                  onClick={openWorldMap}
                >
                  [{dateEntry ? "约会" : "外出"}]
                </button>
              )}
              {state.dateSession && (
                <button type="button" className="excom-row__btn" data-testid="date-return" disabled={trainingMovementLocked || movementBlocked} title={trainingMovementLocked ? "H 进行中不能离开" : undefined} onClick={handleDateReturn}>
                  [踏上归途]
                </button>
              )}
              {gridExits.map((exit) => (
                <button
                  key={exit.commandNo}
                  type="button"
                  className="excom-row__btn"
                  data-testid="exit-button"
                  data-command-no={exit.commandNo}
                  disabled={trainingMovementLocked}
                  title={trainingMovementLocked ? "H 进行中不能离开当前房间" : undefined}
                  onClick={() => handleExit(exit.commandNo)}
                >
                  {exit.label}
                </button>
              ))}
              {excomToolButtons}
              <button
                type="button"
                className="excom-row__btn"
                data-testid="excom-ai-kojo"
                onClick={() => setShowAiSettings(true)}
              >
                [AI辅助{aiEnabled ? "：开" : ""}]
              </button>
            </span>
          )}
          </>
        )}
        <button type="button" className="excom-row__btn" data-testid="excom-options" onClick={() => setShowOptions(true)}>[OPTION 设置]</button>
        <button type="button" className="excom-row__btn" data-testid="excom-l3-status" onClick={() => setExcomPanel("l3-status")}>
          [L3 剧情状态 / 调试]
        </button>
      </div>

      {!hPresentationSession && <div className="game-client__bottom">
        <fieldset className="game-client__command-surface" disabled={sceneDialogueActive && movementBlocked} aria-label="行动指令">
        {/* Parity QA P-1 — the Act_COM filter toggle row (`@过滤器表示`).
            Each button subtracts its class from the grid when pressed
            (pressed = filter OFF). Sex filters only appear in うふふ.
            P-10: the row needs a focused target (per-target filter CFLAGs);
            with no NPC there's nothing target-directed to filter, so hide it
            — but the command grid below still shows master-only commands. */}
        {hasNpc && (!movementBlocked || sceneDialogueActive) && (
          <div className="command-filter-row" data-testid="command-filter-row">
            <span className="command-filter-row__label">过滤</span>
            {filterButtons.map((f) => (
              <button
                key={f.toggleId}
                type="button"
                className={
                  "command-filter-row__btn" +
                  (f.on ? "" : " command-filter-row__btn--off")
                }
                data-testid="filter-toggle"
                data-toggle-id={f.toggleId}
                data-on={f.on}
                aria-pressed={f.on}
                title={f.on ? `显示${f.label}指令；点击隐藏` : `已隐藏${f.label}指令；点击显示`}
                onClick={() => onToggleFilter?.(f.toggleId, filterTarget)}
              >
                [{f.label}]
              </button>
            ))}
          </div>
        )}
        {hExitControls.length > 0 && !movementBlocked && (
          <div className="h-exit-controls" data-testid="h-exit-controls" role="group" aria-label="H 会话控制">
            <span className="h-exit-controls__label">H 会话</span>
            {hExitControls.map((control) => (
              <button
                key={control.commandNo}
                type="button"
                className="h-exit-controls__button"
                data-testid={`h-exit-${control.commandNo}`}
                data-command-no={control.commandNo}
                title={control.detail}
                onClick={() => handleAction(control.commandNo)}
              >
                [{control.label}]
              </button>
            ))}
          </div>
        )}
        {/* P-10: the grid always renders — master-only commands (休憩/做饭/
            风吕) show even with no NPC present (upstream loop doesn't gate on
            TARGET; each command's @COM_ABLE decides).
            The bottom zone is PURE Act_COM now: 移动/外出 live in the Ex_COM row
            (showExits=false), faithful to the original Act_COM/Ex_COM split. */}
        {(presentationMode !== "minimal" || (!showMap && !showWorldMap)) && (
        <CommandGrid
          exits={[]}
          actions={movementBlocked && !sceneDialogueActive ? [] : gridActions}
          actionGroups={
            movementBlocked && !sceneDialogueActive
              ? []
              : (hActionGroups ?? (
                  presentationMode === "minimal" && gridActions.length > 0
                    ? [{ id: "actcom", label: "行动", items: gridActions }]
                    : undefined
                ))
          }
          onExit={handleExit}
          onAction={handleAction}
          aiChatEnabled={aiChatAvailable}
          onAiChat={() => {
            if (movementBlocked) return;
            if (presentationMode === "minimal") {
              // No popup surface: the inline chat bar opens instead.
              setAiChatDraftOpen(true);
              return;
            }
            setAiChatDraftOpen(true);
            if (!interaction.open) openInteraction(AI_CHAT_COMMAND_NO, state.eventLog.length);
          }}
          showExits={false}
        />
        )}
        </fieldset>
      </div>}

      {showBugCatchingMenu && (
        <BugCatchingMenu
          canUseTrap={bugTrapAvailable}
          onCatch={() => handleBugCatchingAction(449)}
          onTrap={() => handleBugCatchingAction(448)}
          onClose={() => setShowBugCatchingMenu(false)}
        />
      )}

      {gatheringProgress !== null && (
        <GatheringProgress
          {...(actionTarget !== undefined
            ? { companionName: state.charas[actionTarget]?.callName ?? undefined }
            : {})}
          onDone={() => {
            const commandNo = gatheringProgress;
            setGatheringProgress(null);
            issueActionCommand(commandNo);
          }}
        />
      )}

      {activeDialogueSession?.owner === "story" && state.storyProgram?.version === 2 && (
        <div className="story-session-header" data-testid="story-session-header">
          <div>
            <strong>{state.storyProgram.title}</strong>
            <span>{state.storyProgram.actorIds.map((id) => id === 0 ? state.master.callName ?? "主人公" : state.charas[id]?.callName ?? `#${id}`).join(" · ")}</span>
            {state.storyProgram.arcId && <span>剧情线 · 阶段 {activeStoryArcPhase ?? "-"}</span>}
            <span>AI 失败时保留确定性回退</span>
          </div>
          <div>
            <button type="button" onClick={skipStoryProgram}>跳过</button>
            <button type="button" onClick={abortStoryProgram}>中止</button>
            {state.storyProgram.status === "completed" && activeStoryEventId && (
              <button type="button" onClick={() => favoriteNarrativeEvent(activeStoryEventId)}>收藏为模板</button>
            )}
          </div>
        </div>
      )}

      {presentationMode !== "minimal" && diaryBookActive && (
        <DiaryBook
          key={`diary:${boxSessionId}`}
          events={boxEvents}
          onClose={pendingArrivalEvents && pendingArrivalEvents.length > 0
            ? onArrivalExit
            : closeInteraction}
        />
      )}

      {!hPresentationSession && presentationMode !== "minimal" && interaction.open && !diaryBookActive && !sceneDialogueActive && (
        <InteractionBox key={boxSessionId} {...interactionBoxProps} />
      )}
      {presentationMode !== "minimal" && !interaction.open && (accompanyInvitation
        || (actionTarget !== undefined && hasDialogueAccompanyPermit(state, actionTarget))) && (
        <div className="date-invitation-card">
          {accompanyInvitation && <span>{state.charas[accompanyInvitation.target]?.callName ?? "对方"}邀你一起出门。</span>}
          <DialogueAccompanyChoices state={state} target={accompanyInvitation?.target ?? actionTarget}
            pending={dialogueQueue.some(session => !!session.aiRequestId || !!session.choice) || pendingPrompt !== null}
            onRespond={respondAccompany} />
        </div>
      )}

      {pendingPrompt && (
        <PromptMenu
          spec={pendingPrompt.spec}
          commandNo={pendingPrompt.commandNo}
          selections={pendingPrompt.selections}
          state={state}
          onPick={(answer) => resolvePromptAnswer(answer)}
          onCancel={() => {
            // A staged prompt (做饭 413 / 酿酒 450 / 菜園 418 / …) opens the
            // interaction box as an empty shell BEFORE the prompt intercepts
            // settlement. Cancel/点遮罩 must close BOTH the prompt and the
            // empty box so the player does not have to click 关闭 twice.
            cancelPrompt();
            if (interaction.open && boxEvents.length === 0) {
              closeInteraction();
            }
          }}
        />
      )}

      {state.mobGirlMemorySession && !pendingPrompt && (() => {
        const current = state.charas[state.mobGirlMemorySession.charaNum];
        const remembered = Object.entries(state.dynamicCharacters ?? {})
          .filter(([, meta]) => meta.lifecycle === "remembered" && meta.rememberedSlot !== undefined)
          .sort(([, a], [, b]) => (a.rememberedSlot ?? 99) - (b.rememberedSlot ?? 99));
        const full = remembered.length >= 20;
        const spec = full
          ? pickOne(
              `路人档案已经满了。要忘掉谁，改为记住${current?.callName ?? "今天遇到的女孩"}？`,
              [
                ...remembered.map(([id, meta]) => ({
                  id: `slot:${meta.rememberedSlot}`,
                  label: state.charas[Number(id)]?.callName ?? `档案${meta.rememberedSlot! + 1}`,
                  detail: meta.encounterSummary,
                })),
                { id: "forget", label: "忘记今天遇到的女孩" },
              ],
            )
          : askYn(
              `要把今天遇到的${current?.callName ?? "那个女孩"}忘掉，还是记得很清楚？`,
              "记得很清楚",
              "忘记了",
            );
        return (
          <PromptMenu
            spec={spec}
            onPick={(answer) => {
              if (answer.kind === "ask_yn") resolveMobGirlMemory(answer.value);
              if (answer.kind === "pick_one") {
                if (answer.value === "forget") resolveMobGirlMemory(false);
                else if (typeof answer.value === "string" && answer.value.startsWith("slot:")) {
                  resolveMobGirlMemory(true, Number(answer.value.slice(5)));
                }
              }
            }}
          />
        );
      })()}

      {state.mobMealSession && !state.mobGirlMemorySession && !pendingPrompt && (
        <PromptMenu
          spec={askYn("被推荐了由哥布林制作的料理。要吃么？", "吃", "拒绝")}
          onPick={(answer) => {
            if (answer.kind === "ask_yn") resolveMobMeal(answer.value);
          }}
        />
      )}

      {state.festivalEventSession && !pendingPrompt && !state.mobGirlMemorySession && !state.mobMealSession && (
        <PromptMenu
          spec={state.festivalEventSession.prompt}
          onPick={(answer) => resolveFestivalEvent(answer)}
        />
      )}

      {/* L3 局势菜单 — 夜间生成、醒来弹出。玩家选定后才生成引子与首幕；
          点「先不管」只是丢掉这组局势，不产生任何事件。 */}
      {situationPrompt && !pendingPrompt && !state.mobGirlMemorySession && !state.mobMealSession
        && !state.festivalEventSession && !state.outingEventSession && (
        <PromptMenu
          spec={situationPrompt}
          onPick={(answer) => {
            if (answer.kind !== "pick_one") return;
            const picked = String(answer.value);
            if (picked === DISMISS_SITUATIONS) dismissNarrativeSituations();
            else void chooseNarrativeSituation(picked);
          }}
        />
      )}

      {/* 路途中遭遇的选择阶段 — 与结局阶段同一个黑色全屏 frame(实玩反馈:
        外出事件要从选择到结局都在独立黑框中完整呈现,不叠加在主场景之上)。
        因幡流动商贩(EV7)/妖怪狸(EV2)/陌生女人(EV5)/救助动物(EV6)/可疑男人(EV3)
        的选项直接在此结算;点击后由下面的 `outing-choice-result` 分支在同一
        frame 中呈现结局。背景不再透出主页面,点击分支后也不会突兀地蹦出新框。 */}
      {state.outingEventSession && state.outingEventSession.kind === "outing-choice" && !pendingPrompt && (() => {
        const session = state.outingEventSession;
        if (session.kind !== "outing-choice") return null;
        return (
          <div className="outing-event-frame outing-event-frame--choice" data-testid="outing-event-choice">
            <div className="outing-event-frame__panel" role="dialog" aria-label="路上遭遇">
              <div className="outing-event-frame__title">
                {session.channel === "outing-departure" ? "出门时遇到的遭遇" : "归途中遇到的遭遇"}
              </div>
              <EventChoicePanel
                prompt={session.prompt}
                testId="outing-event-choice-panel"
                openingTestId="outing-event-intro"
                className="event-choice-panel--outing"
                onPick={(value) => resolveOutingChoice(value as OutingChoiceValue)}
                buttonTestId={(value) => `outing-event-option-${String(value)}`}
              />
              <button
                type="button"
                className="outing-event-frame__btn"
                onClick={() => cancelOutingChoice()}
              >
                取消
              </button>
            </div>
          </div>
        );
      })()}

      {/* 路途中遭遇的完整结局 — 黑色全屏 frame,所有事件行(玩家选的分支 + 后续旁白)
       都在这里完整呈现,只有点「继续」后才写入 eventLog 并关闭面板。
       实玩反馈: 这是「在路上遇到的遭遇」,不应叠加在主场景之上。 */}
      {state.outingEventSession?.kind === "outing-choice-result" && (() => {
        const session = state.outingEventSession;
        if (session.kind !== "outing-choice-result") return null;
        return (
          <div className="outing-event-frame" data-testid="outing-event-result">
            <div className="outing-event-frame__panel" role="dialog" aria-label="路上遭遇">
              <div className="outing-event-frame__title">
                {session.channel === "outing-departure" ? "出门时遇到的遭遇" : "归途中遇到的遭遇"}
              </div>
              {session.answer !== undefined && (
                <div className="outing-event-frame__answer" data-testid="outing-event-answer">
                  你的选择：{session.prompt.options.find((option) => option.id === session.answer)?.label ?? String(session.answer)}
                </div>
              )}
              <EventResultLines events={session.resultEvents} state={state} testId="outing-event-result-lines" />
              <button
                type="button"
                className="outing-event-frame__btn"
                onClick={() => closeOutingChoiceResult()}
                autoFocus
              >
                继续
              </button>
            </div>
          </div>
        );
      })()}

      {commissionPopupChara !== null && (
        <CommissionPopup
          state={state}
          charaNum={commissionPopupChara}
          onIntent={(intent) => {
            if (intent.kind === "ISSUE_COMMAND" && presentationMode !== "minimal" && !interaction.open) {
              openInteraction(intent.commandNo, state.eventLog.length);
            }
            onIntent(intent);
          }}
          onClose={() => setCommissionPopupChara(null)}
        />
      )}

      {excomPanel && (
        <ExComPanel
          state={state}
          tool={excomPanel}
          target={actionTarget}
          onClose={() => setExcomPanel(null)}
          onTrackChara={handleTrackChara}
          onCancelAppointment={(eventId) => onIntent(issueCommand(19996, 0, pickOneAnswer(eventId)))}
        />
      )}

      {characterInfoChara !== null && (
        <CharacterInfoPopup
          state={state}
          charaNum={characterInfoChara}
          onClose={() => setCharacterInfoChara(null)}
        />
      )}

      {/* 🐛 口上调试面板 — creator tool to check personal-dialogue coverage. */}
      {!PLAYER_BUILD && (
        <button
          type="button"
          className="kojo-debug__launch"
          title="口上调试面板"
          onClick={() => setShowKojoDebug(true)}
        >
          🐛
        </button>
      )}
      {!PLAYER_BUILD && showKojoDebug && (
        <KojoDebugPopup onClose={() => setShowKojoDebug(false)} />
      )}
      {showAiSettings && (
        <AiSettingsPopup
          state={state}
          currentCharaNum={actionTarget}
          onUpdateAgentSettings={updateAgentSettings}
          onPrepareCharacterForEncounter={(charaNum) => prepareCharacterForEncounter(charaNum, "debug")}
          onCancelLazyMaterialization={cancelLazyMaterialization}
          onStartStoryProgram={startStoryProgram}
          onSetStoryArcStatus={setStoryArcStatus}
          onFavoriteNarrativeEvent={favoriteNarrativeEvent}
          onClearAiGeneratedContent={clearAiGeneratedContent}
          onClose={() => setShowAiSettings(false)}
        />
      )}
      {showOptions && <OptionsDialog state={state} onClose={() => setShowOptions(false)} onTogglePortraitKind={() => useGameStateStore.getState().togglePortraitKindAction()} />}
      {showTackleShop && <FishingTackleShop state={state} onClose={() => setShowTackleShop(false)} />}

      {/* Parity QA P-31 (Wave 7) — footer 上回指令 (PREVCOM). eraTW's
          USERCOM sets `PREVCOM = SELECTCOM` on each command selection; the
          footer shows the label of the most recently issued command. We read
          the last COMMAND_ISSUED event from the append-only eventLog (NOOP /
          scheduler ticks emit TIME_TICK, not COMMAND_ISSUED, so the last one
          stays the last real command until the next action). */}
      <PrevCommandFooter eventLog={state.eventLog} />
    </div>
  );
}

/** Renders the `<上回指令:LABEL>` footer line from the last issued command. */
function PrevCommandFooter({
  eventLog,
}: {
  eventLog: ReadonlyArray<ObservationEvent>;
}) {
  // Backward scan for the most recent COMMAND_ISSUED (O(n) but stops early;
  // eventLog is bounded by the UI's slice window in practice).
  let prevNo: number | undefined;
  for (let i = eventLog.length - 1; i >= 0; i--) {
    const e = eventLog[i]!;
    if (e.kind === "COMMAND_ISSUED") {
      prevNo = e.commandNo;
      break;
    }
  }
  if (prevNo === undefined) return null;
  const label = commandLabel(prevNo);
  return (
    <div className="game-client__footer" data-testid="prev-command-footer">
      <span className="game-client__prev">＜上回指令:{label}＞</span>
    </div>
  );
}

/** B9 prompt menu — rendered by GameClient as a modal when a command needs
 *  player input (pick_one / ask_yn / pick_many). The player's answer is sent
 *  back to the store via `resolvePromptAnswer` which re-issues the intent WITH
 *  the promptAnswer; the handler then reads it via requirePickOne/requireYesNo. */
function PromptMenu({
  spec,
  intro,
  commandNo,
  selections,
  state,
  onPick,
  onCancel,
}: {
  spec: PromptSpec;
  intro?: readonly OutingChoicePromptLine[];
  commandNo?: number;
  selections?: readonly (number | string)[];
  state?: GameState;
  onPick: (answer: PromptAnswer) => void;
  onCancel?: () => void;
}) {
  const cooking = commandNo === 413;
  const souvenir = commandNo === 626;
  const shopSurface = spec.surface === "shop";
  const hasAuthoredCancel = spec.kind === "pick_one" && spec.options.some(
    (option) => option.id === "cancel" || option.id === -1,
  );
  const cookStage = selections?.find((value) => typeof value === "string" && value.startsWith("type:"));
  const mobGirlAiSettings = useAiStore((aiState) => aiState.settings);
  const mobGirlCandidateIndex = selections?.filter((value) => value === "next").length ?? 0;
  const mobGirlCandidate = commandNo === 444 &&
    state !== undefined &&
    spec.kind === "pick_one" &&
    spec.options.some((option) => typeof option.id === "string" && option.id.startsWith("accept:"))
    ? mobGirlCandidateProfile(
        state,
        mobGirlCandidateIndex,
      )
    : null;
  const mobGirlAiRequested = Boolean(
    mobGirlCandidate &&
    mobGirlAiSettings.enabled &&
    mobGirlAiSettings.baseUrl.trim() &&
    mobGirlAiSettings.model.trim(),
  );
  const [mobGirlLoading, setMobGirlLoading] = useState(mobGirlAiRequested);
  useEffect(() => {
    setMobGirlLoading(mobGirlAiRequested);
  }, [mobGirlAiRequested, mobGirlCandidateIndex]);
  return (
    <div
      className="interaction-box__scrim interaction-box__scrim--prompt"
      data-testid="prompt-menu"
      onClick={onCancel}
    >
      <div
        className={cooking
          ? "prompt-menu prompt-menu--cooking"
          : mobGirlCandidate
            ? "prompt-menu prompt-menu--mob-girl"
            : souvenir
              ? "prompt-menu prompt-menu--souvenir"
              : shopSurface
                ? "prompt-menu prompt-menu--shop-grid"
                : "prompt-menu"}
        onClick={(e) => e.stopPropagation()}
      >
        {cooking && (
          <aside className="cooking-workbench__sidebar" aria-label="料理分类">
            <strong>料理工作台</strong>
            <span className={spec.question === "选择料理类别" ? "is-active" : ""}>类别</span>
            <span className={spec.question === "选择料理" ? "is-active" : ""}>菜谱</span>
            <span className={spec.question === "选择食材" ? "is-active" : ""}>食材</span>
            <span className={spec.question.includes("仕込み") || spec.question.includes("下药") ? "is-active" : ""}>下药</span>
            <span className={spec.question === "选择添加物" ? "is-active" : ""}>添加物</span>
            <small>{typeof cookStage === "string" ? `已选 ${cookStage.replace("type:", "类别 ")}` : "请选择分类"}</small>
          </aside>
        )}
        <div className="cooking-workbench__main">
          {mobGirlCandidate && (
            <MobGirlCandidatePanel profile={mobGirlCandidate} onLoadingChange={setMobGirlLoading} />
          )}
          {(!mobGirlCandidate || !mobGirlLoading) && (
            <>
              {intro && intro.length > 0 && (
                <div className="prompt-menu__intro" data-testid="outing-event-intro">
                  {intro.map((line, index) => (
                    <p
                      key={`${line.kind}-${index}`}
                      className={line.kind === "dialogue" ? "prompt-menu__intro-line prompt-menu__intro-line--dialogue" : "prompt-menu__intro-line"}
                    >
                      {line.speaker && <span className="prompt-menu__intro-speaker">{line.speaker}</span>}
                      {line.text}
                    </p>
                  ))}
                </div>
              )}
              <div className="prompt-menu__question">{spec.question}</div>
              {spec.kind === "pick_one" && (
                <div className="prompt-menu__options">
                  {spec.options
                    .map((o) => (
                      <button
                        key={String(o.id)}
                        type="button"
                        className={`prompt-menu__btn${souvenir && o.id === -1 ? " prompt-menu__btn--souvenir-cancel" : ""}`}
                        disabled={o.disabled}
                        title={o.disabled ? o.detail ?? "当前条件不足" : undefined}
                        onClick={() => onPick(pickOneAnswer(o.id))}
                      >
                        <span className="prompt-menu__label">{o.label}</span>
                        {o.detail && (
                          <span className="prompt-menu__detail">{o.detail}</span>
                        )}
                      </button>
                    ))}
                </div>
              )}
              {spec.kind === "ask_yn" && (
                <div className="prompt-menu__options">
                  <button
                    type="button"
                    className="prompt-menu__btn"
                    onClick={() => onPick(yesNoAnswer(true))}
                  >
                    {spec.options.find((o) => o.id === 1)?.label ?? "是"}
                  </button>
                  <button
                    type="button"
                    className="prompt-menu__btn"
                    onClick={() => onPick(yesNoAnswer(false))}
                  >
                    {spec.options.find((o) => o.id === 0)?.label ?? "否"}
                  </button>
                </div>
              )}
              {onCancel && !hasAuthoredCancel && (
                <button
                  type="button"
                  className="prompt-menu__btn prompt-menu__btn--cancel"
                  onClick={onCancel}
                >
                  取消
                </button>
              )}
            </>
          )}
        </div>
        {cooking && (
          <aside className="cooking-workbench__preview" aria-label="料理预览">
            <strong>制作预览</strong>
            <span>类别、菜谱、食材、下药与添加物将依次确认。</span>
            <span>随机制作、委托与助手数据仍由运行时菜单结算。</span>
          </aside>
        )}
      </div>
    </div>
  );
}

/** The Act_COM entry is 449 捕虫. Trap configuration (448) is deliberately
 * nested here, rather than presented as a second top-level action. */
function BugCatchingMenu({
  canUseTrap,
  onCatch,
  onTrap,
  onClose,
}: {
  canUseTrap: boolean;
  onCatch: () => void;
  onTrap: () => void;
  onClose: () => void;
}) {
  return (
    <div className="interaction-box__scrim" data-testid="bug-catching-menu">
      <div className="prompt-menu" role="dialog" aria-label="捕虫">
        <div className="prompt-menu__question">捕虫</div>
        <div className="prompt-menu__options">
          <button type="button" className="prompt-menu__btn" onClick={onCatch}>
            <span className="prompt-menu__label">主动捕虫</span>
          </button>
          <button
            type="button"
            className="prompt-menu__btn"
            disabled={!canUseTrap}
            title={canUseTrap ? undefined : "当前无法设置或查看诱捕装置"}
            onClick={onTrap}
          >
            <span className="prompt-menu__label">诱捕装置</span>
          </button>
        </div>
        <button type="button" className="prompt-menu__btn prompt-menu__btn--cancel" onClick={onClose}>
          返回
        </button>
      </div>
    </div>
  );
}
