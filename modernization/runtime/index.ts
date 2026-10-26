/**
 * Phase 3+ — `modernization/runtime` top-level barrel.
 *
 * Re-exports the deterministic-core types and helpers. Subtrees
 * (`state/`, `intent/`, future `settlement/`, `dialogue/`,
 * `world/`) each have their own barrel; this file just glues
 * them for callers who want one import path.
 *
 * No upstream imports. No LLM. See `modernization/README.md` for
 * the rules.
 */

export * from "./story/index.js";
export * from "./weather/narrative-incident.js";
export * from "./agent/action-offers.js";

export type {
  GameState,
  TimeSlot,
  CharaSlot,
  CharaSlotState,
  SleepSession,
  DailyEventSession,
  FestivalEventSession,
  EventPromptLine,
  EventPromptSpec,
  MobMealSession,
  DynamicCharacterMeta,
  GeneratedDynamicCharacterMeta,
  AuthoredDynamicCharacterMeta,
  MobGirlMemorySession,
  TrainingCommandRecord,
  TrainingMode,
  TrainingSession,
  TrainingSummary,
  DailySettlementEntry,
  CommissionKind,
  CommissionProgress,
  CommissionSlot,
  CommissionState,
  CommissionTaskKind,
  TurnContext,
  DomainTransition,
  MarkAcquisitionId,
} from "./state/index.js";
export {
  MAX_REMEMBERED_MOB_GIRLS,
  canSearchMobGirls,
  previewMobGirl,
  mobGirlCandidateProfile,
  mobGirlProfileForCharacter,
  rememberedMobGirls,
  materializeMobGirl,
  activateRememberedMobGirl,
  prepareMobGirlDayEnd,
  resolveMobGirlMemory,
  ensureStoneContestClerk,
  STONE_CONTEST_CLERK_ROLE,
  ensureRinnosuke,
  RINNOSUKE_ROLE,
  RINNOSUKE_HOME,
} from "./world/dynamic-characters.js";
export {
  cloneGameState,
  diffGameState,
  emptyCharaSlotState,
  snapshotCharaStates,
  buildDailySettlementReport,
  GAME_STATE_SCHEMA_VERSION,
  migrateGameState,
  EQUIPMENT_IDS,
  ensureTequipState,
  isEquipped,
  readTequip,
  readTequipOptional,
  setEquipped,
  toggleEquipped,
  writeTequip,
  TFLAG_ID,
  TFLAG_FIELD_REGISTRY,
  STATE_FIELD_REGISTRY,
  stateFieldDefinition,
  tflagLifecycle,
  createTurnContext,
  getTflag,
  setTflag,
  clearTflag,
  addTflag,
  setTflagBit,
  clearTflagsByLifecycle,
  beginTurnContext,
  clearTurnContext,
  detectCharaDomainTransitions,
  detectDomainTransitions,
  hasCommandCompletedTransition,
  mergeDomainTransitions,
  snapshotCharaDomainState,
  computeAttitude,
  computeConsentJudgement,
  computeShinchitsu,
  deriveRelationshipAuthority,
  hConsentAcquired,
  liftedConsentJudgement,
  deriveDialogueRelationshipStage,
  deriveSexualDialogueFacts,
  STONE_CONTEST_THEMES,
  STONE_CONTEST_FEE,
  STONE_CONTEST_RANK_TALENT_ID,
  STONE_ITEM_TALC,
  STONE_ITEM_MIRACLE,
  STONE_ITEM_LAMENT,
  defaultStoneContestProgress,
  ensureStoneContestProgress,
  openStoneContestLobby,
  startStoneContest,
  stonePlacementLimit,
  previewStoneContestReplay,
  stoneOpponentPrediction,
  stoneOpponentStatus,
  appendStoneContestPlacement,
  advanceStoneContestClock,
  stoneContestDifficulty,
  resolveSoloStoneRound,
  continueStoneContest,
  withdrawStoneContest,
  forfeitStoneContestRound,
  scoreStoneCouple,
  stoneAwardForScore,
  resolveStoneCouple,
  commitStoneContestSettlement,
  renameStoneContestClerk,
  stoneClerkStoryOpportunity,
  advanceStoneClerkStory,
  leaveStoneContestLobby,
  STONE_WORLD_WIDTH_Q,
  STONE_FLOOR_Y_Q,
  STONE_PLATFORM_LEFT_Q,
  STONE_PLATFORM_RIGHT_Q,
  STONE_SPAWN_Y_Q,
  STONE_FIXED_STEP_MS,
  STONE_CONTEST_DURATION_FRAMES,
  stoneCandidate,
  stoneCandidateQueue,
  createStoneSimulation,
  advanceStoneSimulation,
  stoneReplayFromSimulation,
  normalizeStoneOperation,
  stoneOperationFromPointer,
  stoneOperationFromKeyboard,
  replayStoneOperations,
} from "./state/index.js";
export type {
  StateFieldDefinition,
  StateFieldLifecycle,
  StateFieldNamespace,
  StoneContestProgress,
  StoneContestSession,
  StoneContestMode,
  StoneContestPhase,
  StoneContestPayer,
  StoneContestTheme,
  StoneContestStrategy,
  StoneContestItem,
  StoneContestStartOptions,
  StoneContestRoundResult,
  StoneContestCoupleScore,
  StoneOpponentStatus,
  StoneContestPendingSettlement,
  StoneThemeRecord,
  StoneClerkStoryOpportunity,
  StoneActor,
  StonePointQ,
  StoneCandidate,
  StoneSimulationState,
  StonePlacementOperation,
  StoneBody,
  StoneReplayConfig,
  StoneReplayResult,
} from "./state/index.js";
export type { DialogueRelationshipStage, SexualDialogueFacts } from "./state/index.js";
export {
  getNamedStat,
  getRelationStat,
  getFortune,
  getPalamStat,
  getAblStat,
  getBattleAbilityDisplay,
  getHudActionHints,
  getHudWorkInfo,
  getHBodyStats,
  estrusCategory,
  effectivePortraitCharaNum,
  portraitVariantOf,
  renderedPortraitVariant,
  clampPortraitVariant,
  setPortraitVariant,
  seedRelationStats,
  seedNamedStats,
  seedNamedStatMaxes,
  seedIntimacy,
  buildSeededMasterState,
  NAMED_STAT_KEYS,
  RELATION_STAT_KEYS,
  PALAM_STAT_KEYS,
  ABL_PARAM_GROUPS,
  ABL_DISPLAY_MAX,
  type NamedStat,
  type AblParam,
  type AblParamGroup,
  type HudActionHints,
  type HudWorkInfo,
  type PortraitVariantAvailability,
} from "./state/index.js";
export {
  charaStatsToSlotState,
  buildCharaSlot,
  type CharaStatsLike,
} from "./state/index.js";
export {
  getYogore,
  getCleanlinessLabel,
  cleanlinessLabel,
  getPalamLv,
  palamLvBar,
  PALAMLV,
  type PalamLvBar,
  describeStateDelta,
  firstWinBonusForBattleAbility,
  runDanmakuBattle,
  settleDanmakuBattle,
  settleDanmakuBattleCore,
  EMPTY_BATTLE_INPUT,
  createDanmakuBattleState,
  danmakuBossMeterVisible,
  danmakuPhaseCount,
  danmakuPhaseLabel,
  DANMAKU_PATTERNS,
  isRealtimeDanmakuTarget,
  patternForTarget,
  stepDanmakuBattle,
  type DanmakuBattleCore,
  type DanmakuBattleResult,
  type DanmakuRng,
  type BattleInput,
  type DanmakuBattleKojoLine,
  type DanmakuEmitter,
  type DanmakuEmitterKind,
  type DanmakuLaser,
  type DanmakuBattleConfig,
  type DanmakuBattleSession,
  type DanmakuBattleState,
  type DanmakuMode,
  type DanmakuPattern,
  type DanmakuPatternDefinition,
  type DanmakuPhaseDefinition,
  FISHING_SPOT,
  FISH_CATALOG,
  FISHING_RODS,
  FISHING_LINES,
  activityText,
  calcFishingActivity,
  calcFishingPower,
  fishingSpot,
  fishingSpotName,
  fishingCatchDescription,
  resolveFishCatch,
  defaultFishingGear,
  ensureFishingGear,
  buyFishingGear,
  EMPTY_FISHING_INPUT,
  createFishingGameState,
  stepFishingGame,
  type FishCatchResult,
  type FishDef,
  type FishingGearKind,
  type FishingGearPurchaseResult,
  type FishingGearState,
  type FishingLineDef,
  type FishingLineId,
  type FishingRodDef,
  type FishingRodId,
  type FishingGameInput,
  type FishingGamePhase,
  type FishingGameSession,
  type FishingGameState,
  type FishingKojoLine,
  type FishingShadow,
  type FishingSplash,
  type FishingStepResult,
  COMMISSION_MAX_SLOTS,
  COMMISSION_PROGRESS,
  ITEM_WOOD,
  ITEM_CHEAP_INGREDIENT,
  ITEM_AOJIRU,
  COMMISSION_DEFS,
  acceptCommission,
  canAcceptCommission,
  canExecuteCommissionSlot,
  clearCommissionSlot,
  commissionActName,
  commissionContent,
  commissionStatus,
  commissionTitleForTarget,
  defFromIraiId,
  describeCommission,
  ensureCommissionState,
  executeCommissionCore,
  findCommissionDef,
  findSlotByClient,
  makeIraiId,
  reportCommission,
  runCommissionMorning,
  searchActiveCommissionSlot,
  setCommissionExecutionResult,
  setCommissionProgress,
  setNewCommission,
  syncCommissionTargets,
  type CommissionExecutionResult,
  type CommissionScene,
} from "./state/index.js";

export {
  applyIntent,
  configureIntent,
  currentIntentDeps,
  finalizeElapsedAction,
  liveAvailableCommands,
  type ApplyIntentResult,
  type Now,
  type IntentDeps,
  type FinalizeElapsedActionOptions,
  type FinalizeElapsedActionResult,
  type CommandAvailability,
  type CommandAvailabilityMode,
} from "./intent/index.js";

// Import directly from the leaf modules instead of `./kojo/index.js` so the
// top-level browser runtime stays lean. `KojoCache` itself is now file-reader
// injected: Node wires `node:fs` through `kojo/node-index.ts`, while the Tauri
// app wires a sync asset reader from `web/app/game/tauri-kojo-cache.ts`.
// Plain browser/player builds still use `resolveKojoNode` against a baked
// fallback bundle.
export {
  resolveKojoNode,
  resolveKojoNodeDetailed,
  resolveKojoFunctionDetailed,
  resolveKojoNodeWithChoices,
  hasActionableKojoNode,
} from "./kojo/static-router.js";
export { applyKojoEffects } from "./kojo/effects.js";
export {
  listNewGameKojoUpdates,
  resolveNewGameKojoUpdate,
  type NewGameKojoUpdateCandidate,
  type NewGameKojoUpdateResult,
  type NewGameKojoUpdateStatus,
} from "./kojo/new-game-update.js";
export {
  createGameStateKojoHostRegistry,
  type KojoHostRegistry,
  type KojoHostResult,
  type KojoHostStatus,
  type KojoCstrRequest,
  type KojoFormatterRequest,
} from "./kojo/host-registry.js";
export {
  renderKojoText,
  selectTextrAlternatives,
  substituteKojoCallNames,
  type KojoNameReference,
  type KojoNameResolver,
  type KojoNameRenderOptions,
  type KojoTextRenderOptions,
} from "./kojo/text-renderer.js";
export {
  withMarkKojoContext,
  withRebellionMarkContext,
  type MarkKojoId,
  type RebellionMarkLevel,
} from "./kojo/mark-kojo.js";
export { palamKojoKey } from "./kojo/palam-kojo.js";
export { iraiKojoSelectorKeys, mergeIraiKojoResolutions } from "./kojo/irai-kojo.js";
export { isKojoAiFallbackEligible } from "./kojo/ai-fallback.js";
export {
  createNativeDialogueRouter,
  resolveNativeDialogue,
  type CharacterDialoguePack,
  type NativeDialogueContext,
  type NativeDialogueRule,
  type NativeDialogueTrigger,
} from "./kojo/native-dialogue.js";
export {
  resolveDomainTransitionDialogue,
  type DomainTransitionDialogueDeps,
  type DomainTransitionDialogueResult,
} from "./kojo/domain-transition-dialogue.js";
export {
  findKojoCategoryRoute,
  isStructuredKojoCategory,
  type KojoCategory,
  type KojoCategoryResolver,
  type KojoCategoryRoute,
} from "./kojo/category-routes.js";
export { KOJO_CATEGORY_ROUTES } from "./kojo/category-routes.generated.js";
export { resolveActiveKojoVariantCode } from "./kojo/variant-selection.js";
export type {
  DialogueRouter,
  DiaryHappenResolution,
  KojoBundle,
  KojoLine,
  KojoChoiceOption,
  PendingKojoChoice,
  InteractiveKojoResolution,
  KojoFunctionResolution,
  KojoResolution,
  KojoResolutionStatus,
  KojoDiagnostic,
  DiaryHookKind,
  PalamKojoKind,
} from "./kojo/types.js";
export {
  createTrainMessageRouter,
  NOOP_TRAIN_MESSAGE_ROUTER,
  type TrainMessageBundle,
  type TrainMessageRouter,
} from "./command/train-message.js";

// 相性 (RELATION) table for the 拠点来訪 来訪連鎖. Injected at app init from
// `relation.bundle.json`; pure data, no Node deps (safe in the browser barrel).
export { setRelationTable, relationOf, type RelationTable } from "./world/relation.js";
export {
  dayEventKojoEventsFromSession,
  type DayEventKojoSession,
} from "./world/dayevent.js";

// H-mode (うふふ) command visibility — sex-act families only surface during
// 調教. Used by the UI availability filter on top of each command's own gate.
export { requiresHMode, isHMode, enterHMode, isTimeStopped } from "./command/h-mode.js";
export { finishFishingSession, type FishingSettlementOutcome } from "./command/handlers/fishing.js";
export {
  clearTrainingMode,
  finishTrainingSession,
  isTrainingCommand,
  isTrainingTarget,
} from "./command/training-session.js";
// H settlement receipt — the persisted snapshot of one H command's NOWEX /
// edging / marks, taken before the resolver's frame is cleared.
export {
  attachHSettlementReceipt,
  buildHSettlementReceipt,
  isHSettlementCommand,
} from "./command/h-settlement-receipt.js";

// Act_COM 过滤器 (Parity QA P-1) — the faithful single-grid filter toggles.
// The UI renders COM_FILTERS as the toggle row and applies quickFilterHidden
// per command (class resolved UI-side from command-tags); toggleComFilter
// writes the real per-target CFLAG.
export {
  COM_FILTERS,
  filterOn,
  quickFilterHidden,
  toggleComFilter,
  type ComFilterClass,
  type ComFilterDef,
} from "./command/com-filter.js";

// Calendar / season / weekday (Phase 7.1b) — faithful eraTW date helpers so
// the status bar shows the real 月/日/曜日 instead of a mock anchor (Parity
// QA P-2). `weekdayName` = `(dayIndex+1)%7` 日/月/火/水/木/金/土; `seasonOf`/
// `dateOf` read the (season, date) pair off `time`; `monthName` = 春之月…
export {
  weekdayName,
  weekdayLabelZh,
  isWeekday,
  isWeekend,
  youbiMatch,
  seasonOf,
  dateOf,
  monthName,
  seasonName,
  festivalOf,
} from "./world/calendar.js";
export {
  applyNewYearEveSchedule,
  restoreFestivalSchedule,
  runFestivalMorning,
  resolveFestivalEvent,
  newYearFestivalPrompt,
} from "./world/festival-events.js";
export {
  projectCalendarAgenda,
  type CalendarAgendaDay,
  type CalendarAgendaItem,
  type CalendarAgendaKind,
} from "./world/calendar-agenda.js";

export {
  applyConfiguredSchedule,
  configuredEventsBetween,
  initializeConfiguredSchedules,
  isConfiguredSleepTime,
  type ConfiguredScheduleEvent,
  type ConfiguredScheduleEventKind,
} from "./world/configured-schedule.js";
export {
  buildConfiguredCharaSlot,
  CONFIGURED_ROOM_IDS,
  hydrateConfiguredCharaHomes,
  resolveConfiguredHomeLocation,
  resolveConfiguredRoomLocation,
} from "./world/configured-room-locations.js";
export {
  ROOM_CATALOG,
  ROOM_CATALOG_BY_ID,
  ROOM_CATALOG_BY_LOCATION,
  ROOM_CATALOG_COUNT,
  roomCatalogEntryForId,
  roomCatalogEntryForLocation,
  roomCatalogLocationForId,
  roomCatalogIdForLocation,
  type RoomCatalogEntry,
  type RoomMapKey,
  type RoomMapPlacement,
} from "./world/room-catalog.js";
export {
  encounterBaseRate,
  encounterLocationForSpot,
  encounterTargetLocation,
  runEncounterMorning,
  runEncounterTimezoneMove,
  spotMapId,
  type EncounterSpotId,
} from "./world/encounter.js";
export {
  reprojectSchedules,
  runSchedulerTick,
  seedScheduledLocations,
  seedRoomNeighbors,
} from "./world/scheduler.js";
export { runTsubuyaki, type TsubuyakiDeps } from "./world/tsubuyaki.js";
export {
  maybeOfferMobMeal,
  resolveMobMeal,
} from "./world/mobs.js";
export {
  runNewGameInitialLevelSync,
  runSourceAblup,
  setMinimumStartingExperience,
} from "./world/new-game-initialization.js";

// 角色情报硬骨头批 seam (PAGE 0 尺寸 / 素质 / PAGE 2 介绍文 + 相性表 / PAGE 3 感性 + 礼物 / PAGE 4 肉体情報)
export {
  setCharaCstrTable,
  setCharaDataTable,
  charaDataOf,
  charaCstrOf,
  charaIntroParagraphs,
  foldTasteTags,
  specialtyOf,
  type CharaDataEntry,
  type TasteTag,
} from "./state/chara-data.js";
export {
  buildSizePanel,
  somatometry,
  ensureSizeCoefficients,
  makeSize,
  cupSize,
  type SizePanel,
} from "./state/make-size.js";
export {
  setTalentCatalog,
  talentCatalogLoaded,
  buildTalentCategories,
  talentDisplayName,
  CATEGORY_LABELS,
  type TalentCatalog,
  type TalentCategoryRow,
  type TalentTag,
} from "./state/talent-categories.js";
export {
  setGiftCatalog,
  giftCatalogLoaded,
  recordGiftPurchase,
  reviewGift,
  createGift,
  runGiftFavorite,
  buildGiftHistory,
  giftStateOf,
  type GiftCatalog,
  type GiftCatalogItem,
  type GiftRecord,
  type CharaGiftState,
  type GiftReview,
  type GiftFavoriteEvent,
  type DrawnGift,
  type GiftHistoryRow,
} from "./state/gifts.js";
export {
  setItemExplanations,
  itemExplanationsLoaded,
  itemExplanation,
  type ItemExplanationTable,
  type ItemExplanationEntry,
  type ItemExplanationCondition,
} from "./state/item-explanation.js";
export {
  setFortuneCatalog,
  fortuneCatalogLoaded,
  fortuneSlip,
  fortuneCharacterId,
  fortuneMaxNum,
  type FortuneCatalog,
  type FortuneSlip,
} from "./state/fortune.js";
export {
  uwakiRecord,
  getUwakiHistory,
  runUwakiWitnessCheck,
  buildUwakiRows,
  type UwakiEntry,
  type UwakiRow,
} from "./state/uwaki.js";
export { buildCompatTable, type CompatRow } from "./state/chara-info-state.js";
export { buildExBoard, buildPregnancyInfo, type ExEntry, type PregnancyInfo } from "./state/chara-info-state.js";
export {
  buildBodyInfo,
  type BodyInfo,
  type BodyLine,
  type BodySection,
  type BodyTone,
} from "./state/body-info.js";

export {
  finishPlayerSleep,
  masterWakeMinute,
  setMasterWakeMinute,
  DEFAULT_MASTER_WAKE_MINUTE,
} from "./command/handlers/sleep.js";

export {
  DAILY_EVENT_SLOT_COUNT,
  dailyEventPromptView,
  registerDailyEvent,
  runDailyEventTick,
  runDailyearnEventTick,
  shuffleDailyEventSlots,
  dailyEventOpportunitySet,
  prepareDailyEventMarkers,
  finalizeDailyEventMarkers,
  applyDailyBlessingExpBonus,
  type DailyEventDefinition,
  type DailyEventDiagnostic,
  type DailyEventDispatchResult,
} from "./world/daily-event.js";
export {
  runOutingDepartureEvents,
  runOutingReturnEvents,
  resolveOutingEventSession,
  commitOutingChoiceResult,
  outingEventOpportunitySet,
  type OutingEventResult,
  type OutingEventChoice,
  type OutingChoiceValue,
} from "./world/outing-events.js";
export {
  endOdekakeIfReturningHome,
  endOdekakeIfReturningHomeDetailed,
  cleanGroupDates,
} from "./world/odekake.js";
export {
  ROOM_ENTER_ROUTES,
  UNMODELED_ROOM_ENTER_KINDS,
  ROUTED_ROOM_ENTER_KINDS,
  roomEnterKindsFor,
  auditRoomEnter,
  type RoomEnterKind,
  type RoomEnterRoute,
  type RoomEnterStatus,
  type RoomEnterAudit,
  type RoomEnterAuditEntry,
} from "./world/room-events.js";
export {
  compileEventOpportunitySet,
  acceptEventRanking,
  consumeEventRanking,
  eventContextHash,
  type EventChannel,
  type EventCandidate,
  type EventOpportunitySet,
  type EventRankingProposal,
  type EventRankingAcceptance,
} from "./world/event-ranking.js";
export {
  BANQUET_TEMPLATES,
  banquetOpportunitySet,
  chooseBanquetTemplate,
  buildBanquetProgram,
  scheduleBanquet,
  advanceBanquets,
  advanceBanquetsInPlace,
  applyBanquetStateProjection,
  type BanquetTemplate,
  type BanquetResult,
} from "./world/banquet.js";

export {
  openEyes,
  runMorning,
  MORNING_PHASES,
  type DayCycleDeps,
  type MorningPhase,
} from "./world/day-cycle.js";

export {
  ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
  MAX_ACCEPTED_EXPERIENCES,
  MAX_SELECTED_EXPERIENCES,
  MAX_L1_EXPERIENCES,
  L1_EXPERIENCE_LOOKBACK_TICKS,
  validateAcceptedExperience,
  isAcceptedExperience,
  pruneAcceptedExperiences,
  acceptExperience,
  getVisibleExperiences,
  selectRelevantExperiencesForL1,
  formatExperiencesForL1,
  type AcceptedExperienceFactClass,
  type AcceptedExperienceKind,
  type RuntimeHardExperienceKind,
  type CharacterSoftExperienceKind,
  type StoryRuntimeExperienceKind,
  type AcceptedExperienceVisibility,
  type AcceptedExperiencePayload,
  type AcceptedExperience,
  type AcceptedExperienceAcceptance,
  type L1ExperienceQuery,
} from "./experience.js";
