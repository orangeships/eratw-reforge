/**
 * Phase 3.1 — GameState type + clone/diff helpers.
 *
 * The live in-memory state object that Phase 4–9 reads and writes.
 * JSON-safe by construction: no Map / Set / Date / class / function
 * — every property is a primitive or a plain object / array.
 *
 * - `cloneGameState` — deep clone via `structuredClone` (Node 17+).
 * - `diffGameState` — section-by-section diff, emits `StateDelta[]`.
 *   Excludes `eventLog` (append-only, diff is irrelevant) and
 *   `readOnlyMetadata` (immutable).
 *
 * Scope of 3.1 diff:
 *   - CharaSlot deltas (master + charas) only.
 *   - `time` excluded — Phase 8 WorldScheduler owns time diffs
 *     and emits proper TIME_TICK events.
 *   - `flagStore` excluded — Phase 5 extends this; 3.1 keeps the
 *     helper minimal.
 *
 * No upstream imports. No LLM. See ../README.md for subtree rules.
 */

import type { ObservationEvent, WorldSnapshot, StateDelta } from "../../schemas/types.js";
import type { DanmakuBattleSession } from "./danmaku-game.js";
import type { FishingGameSession, FishingSettlement } from "./fishing-game.js";
import type { FishingGearState } from "./fishing.js";
import type { StoneContestProgress, StoneContestSession } from "./stone-contest.js";

/**
 * Per-character numeric state. Each namespace is a sparse
 * `Record<id, number>`. Conversion to/from dense `number[]` (the
 * upstream ERA layout) is a future IO concern, not Phase 3.
 */
export interface CharaSlotState {
  CFLAG: Record<number, number>;
  TALENT: Record<number, number>;
  /** Abilities (`Abl.als`): 親密=9, 従順=10, 欲望=11, 技巧=12, …, 話術技能=41. */
  ABL: Record<number, number>;
  EXP: Record<number, number>;
  PALAM: Record<number, number>;
  BASE: Record<number, number>;
  /**
   * Stat caps (`MAXBASE:体力` etc.) — the ceiling `recoverPermil` restores
   * toward. eraTW initializes these from the chara CSV's 基礎 values (so a
   * freshly-loaded chara starts at full). An unset cap means "no max
   * known" and `recoverPermil` no-ops rather than zeroing current.
   */
  MAXBASE: Record<number, number>;
  TCVAR: Record<number, number>;
  /**
   * Per-character `BUFF:n` (16 slots, `Buff.als`) — temporary BASE/MAXBASE
   * modifiers. Set by `@BUFF_BASE` (e.g. `@BUFF_BASE(ARG, BASE_法力, 200)`).
   * Cleared on master wake by `@BUFF_RESET` (COMMON.ERB:765). Used by
   * upstream 魔法DLC + QOL_TEMP subsystems; the modern runtime models the
   * namespace so SET_SLEEP's BUFF_RESET call can be a no-op stub that
   * actually iterates the (currently empty) BUFF map.
   */
  BUFF: Record<number, number>;
  /**
   * Per-character `EX:n` (sized 100, `CSV/VariableSize.csv:101`) — day-scoped
   * accumulators read at day-end then reset, e.g. `EX:MASTER:今日的掃除回数`
   * (id 16) feeds the cleaning reward (`EVENTTURNEND.ERB:309`). Same sparse
   * `Record<id, number>` shape as the other namespaces.
   */
  EX: Record<number, number>;
  EQUIP: Record<number, number>;
  /**
   * Per-character `MARK:n` (`Mark.als`) — permanent "brands" earned through
   * training, e.g. `MARK:反発刻印` (rebellion brand, id 1) accumulated by
   * `MARK_GOT_CHECK` and read by FAVOR_CALC's 好感度 floor. Persisted (unlike
   * CUP/CDOWN). Sparse `Record<id, number>` like the other namespaces.
   */
  MARK: Record<number, number>;
  /**
   * Per-turn PALAM up/down accumulators (`palam.csv` index space, same
   * ids as PALAM). Settlement converters write here (`CUP:好意 += …`);
   * the settlement then applies `PALAM += CUP - CDOWN` and zeroes both.
   * Real Emuera variables (see memory `eratw-emuera-language-semantics`),
   * but **always 0 at rest** — they only hold values mid-settlement.
   */
  CUP: Record<number, number>;
  CDOWN: Record<number, number>;
  /**
   * Per-character `JUEL:n` (宝珠, `Palam.als` index space — same ids as
   * PALAM). The persistent currency the night flow banks PALAM into
   * (`@JUEL_CHECK`, AFTERTRA.ERB:690) and special events add to directly
   * (`@JUEL_UP_SPECIAL`, ABLUP.ERB:218); consumed by the auto ability
   * level-up (`@SHOW_ABLUP_SELECT`). Saves written before the night-
   * settlement port lack it at runtime — accessors use `?.`/`??=` (the
   * STAIN precedent).
   */
  JUEL: Record<number, number>;
  /**
   * Per-character `STAIN:n` body-soil bitmask array, indexed by body part
   * (`Stain.csv`: 0=口 1=手 2=Ｐ 3=Ｖ 4=Ａ 5=Ｂ 6=膣内 7=腸内). Each entry is
   * a bitset of soil types (1=愛液 2=陰茎 4=精液 8=肛門 16=母乳 32=黏液
   * 64=破瓜之血 128=巧克力). Drives the `不潔` SOURCE conditional on contact
   * commands + the STAIN_INFO display. See `runtime/state/stain.ts`.
   * Sparse `Record<partId, bitmask>` (8 parts); a missing part = clean (0).
   */
  STAIN: Record<number, number>;
  /**
   * Per-character `TEQUIP:n` (`Tequip.csv`) — the clothing/toy *state* bitmask
   * array, parallel to `EQUIP` (which holds the worn piece per slot). CLOTHES
   * uses `TEQUIP:0` = 下半身着衣状況 and `TEQUIP:1` = 上半身着衣状況
   * (exposure/displacement bitmasks read by `@SHOW_下半身内衣`/`@SHOW_TOP` to
   * pick the outermost visible layer); ids 3/5 = half-undress/top-stripped
   * flags; ids 11-20/25/29-35/45 = toggleable equipment (toys, PLAY modes,
   * 避孕套, 継続接吻 — see `runtime/state/tequip.ts`); ids 50/51 + 101-120 =
   * intercourse/contact history. **Never write a TEQUIP id into `EQUIP`**
   * (slots 11-22 are clothing pieces — namespace collision).
   * Sparse `Record<id, bitmask>`; a missing id = 0 (fully clothed / no state).
   * See `runtime/state/clothing.ts`.
   */
  TEQUIP: Record<number, number>;
}

export interface CharaSlot {
  charaNum: number;
  /** CSV `名前`, distinct from the display-oriented `呼び名`. */
  name?: string;
  /** Display name (callName from `CSV/Chara/*.csv`). Stable attribute —
   *  NOT part of `state`, so it's excluded from diffing (DIFFABLE only
   *  walks the `state` namespaces). Lets the UI render NPC names without
   *  a separate lookup (Phase 8.6 two-map interaction). Optional: the
   *  live data path (`buildCharaSlot`) always sets it; test fixtures may
   *  omit it, in which case the UI falls back to `#<charaNum>`. */
  callName?: string;
  location: string;
  /** Runtime location corresponding to CSV `CFLAG:初期位置`.
   *  The source stores a numeric P-id while the modern UI uses string room
   *  keys. This resolved adapter value lets the movement interpreter send a
   *  character home without inventing a destination. Optional for old saves
   *  and narrow test fixtures; an absent value makes that transition a no-op. */
  homeLocation?: string;
  state: CharaSlotState;
}

/**
 * The "current dish" — `DISH_*` globals from `FOOD.ERH`. eraTW keeps ONE
 * dish at a time (a save holds a single `DISH_NAME`/`DISH_TASTE`/… set);
 * this mirrors that as an optional top-level slot. `null`/unset = no dish
 * (gates COMF414/415 via `DISH_NAME == ""`).
 *
 * Populated by COMF413 料理を作る (B7-cook, deferred) or — for the B7-eat
 * slice — by `seedDish()` (a test/operator helper that bypasses 413). The
 * eat path (414/415) only reads `name`/`taste`/`type`/`basepoint`; the
 * `drg`/`drg2`/`assi` fields are set only by 413's interactive picker and
 * stay 0/undefined for a seed dish (so the 仕込み/添加物 arms are dead code
 * in the eat-only slice — faithful, see `dish.ts` header).
 */
export interface Dish {
  /** DISH_NAME — dish display name. Empty string = no dish. */
  name: string;
  /** DISH_TASTE — slash-delimited taste tags, e.g. `"軽食/神力/できたて/"`. */
  taste: string;
  /** DISH_TYPE — `軽食` | `主食` | `甜点` (drives base recovery + EAT_TIME). */
  type: "軽食" | "主食" | "甜点";
  /** DISH_BASEPOINT — the dish's base quality (0-999); drives REVIEW_DISH 評価値. */
  basepoint: number;
  /** DISH_TIME — cooking time (set by 413; unused by the eat path's EAT_TIME). */
  time: number;
  /** DISH_DRG — 仕込み drug item id (set by 413 picker; 0 = none). */
  drg: number;
  /** DISH_DRG_2 — 添加物 item id (set by 413 picker; 0 = none). */
  drg2: number;
  /** DISH_ASSI — assistant charaNum (set by 413; 0 = none/master-alone). */
  assi: number;
  /** DISH_LIMIT — current 鮮度 (freshness); decays over time (Phase 8 tick). */
  limit: number;
  /** DISH_MAXLIMIT — 鮮度 ceiling. */
  maxLimit: number;
}

export interface TimeSlot {
  /** Monotonically increasing in-game clock value. Stub for Phase 8. */
  tickValue: number;
  /** 0-based day index from game start. */
  dayIndex: number;
  /** 0–23. */
  hourOfDay: number;
  /**
   * `DAY:2` 季節 (1=春 2=夏 3=秋 4=冬). Optional — unset defaults to
   * spring (NEWGAME seed). Advanced in `runDayEnd` via `advanceCalendarDay`.
   * See `runtime/world/calendar.ts` (Phase 7.1b).
   */
  season?: number;
  /**
   * `DAY:3` 日期 (1–31). Optional — unset defaults to 1 (NEWGAME seed).
   * Wraps on `>31` and bumps `season`. See `runtime/world/calendar.ts`.
   */
  date?: number;
}

export interface WorkRuntimeEntry {
  entryKey: string;
  charaNum: number;
  jobType: number;
  startMin: number;
  endMin: number;
  workRoomId: number;
  location: string;
  workload: number;
  wage: number;
  noHelp: 0 | 1 | 2;
  giftId: number;
  status: "ready" | "active" | "completed";
}

/** Serializable daily work instances. This prevents an early-completed shift
 * from being recreated on the next scheduler tick and preserves mid-shift
 * saves without duplicating BASE:仕事量. */
export interface WorkRuntimeState {
  dayIndex: number;
  entries: WorkRuntimeEntry[];
}

export interface SleepSession {
  /** Absolute tick when MASTER entered sleep (`DAY*1440+TIME`). */
  startedAtTick: number;
  /** Wake minute-of-day snapshotted from `TIME:3` / the residence menu. */
  requestedWakeMinute?: number;
  /** Forced by fatigue/exhaustion rather than voluntary COM402. The original
   *  `EVENTCOMEND` collapse routes into `@OYASUMI` → `BEFORETRAIN`; the modern
   *  UX extends that with a "sleep until stamina is full" floor, per user
   *  request, so forced sessions may sleep past the configured wake time. */
  forced: boolean;
  /** Event-log length before the command/EVENTCOMEND output that requested
   * sleep. The UI must present that tail completely before night settlement
   * may take over. Missing on legacy/new-game sessions means no pending
   * presentation boundary. */
  presentationEventLogIndex?: number;
}

/** Persisted continuation for a gameplay-affecting DAILY_EV prompt. */
export interface DailyEventSession {
  kind: "ev0-fairy-punishment" | "ev20-head-visit" | "ev5-oppai" | "ev23-visit-sales";
  eventId: 0 | 5 | 20 | 23;
  /** Day reached by the in-progress night settlement. */
  eventDay: number;
  /** Seed of the whole sleep settlement, used to replay every RAND exactly. */
  sleepSeed: number;
  phase: "punishment-choice" | "visit-choice" |
    "oppai-choice" | "oppai-futanari-choice" | "oppai-target" | "oppai-correction" |
    "sales-appearance" | "sales-listen" | "sales-offer" | "sales-bargain" |
    "sales-use" | "sales-return" | "sales-intimate" | "sales-intimate-payment";
  /** Primitive continuation data (upstream random rolls, bit flags, and selected ids). */
  data?: Record<string, number | string | boolean>;
}

/** Serializable child entity; CFLAG child counters remain compatibility mirrors. */
export interface ChildRecord {
  id: number;
  mother: number;
  father: number;
  sex: 1 | 2;
  name: string;
  birthdayDay: number;
  love: number;
  independent: boolean;
}

/** Temporary upstream DAILY_EV34 mob-race modifier. */
export interface MobRaceBuff {
  race: string;
  days: number;
}

/** Persisted continuation for `MOB.ERB @MAKANAI`'s ASK_YN prompt. */
export interface MobMealSession {
  kind: "mob-meal";
  offeredAtTick: number;
  location: string;
  /** Same-room eaters snapshotted when the immediate upstream prompt opened. */
  participants: number[];
  /** Pre-rolled `RAND:5` quality, retained so save/load cannot change the meal. */
  qualityRoll: number;
}

/**
 * Stable presentation recipe for a generated mob. The runtime stores sprite
 * names, while the resource layer resolves those names to upstream crops.
 * Keeping the selected layers in the save prevents a re-render or a later
 * manifest reorder from changing an already encountered character's face.
 */
export interface DynamicCharacterPortrait {
  template: "upstream-mob";
  normal: string[];
  smile: string[];
  angry: string[];
}

export interface GeneratedDynamicCharacterMeta {
  origin: "generated";
  lifecycle: "transient" | "remembered";
  active: boolean;
  seed: number;
  species: string;
  encounterRegion: string;
  encounterSummary: string;
  createdDay: number;
  portrait?: DynamicCharacterPortrait;
  rememberedSlot?: number;
}

/** Stable authored residents share the CharaSlot/state authorities used by
 * roster characters, but are allocated lazily by a subsystem. They are never
 * offered to the transient-mob day-end archive flow. */
export interface AuthoredDynamicCharacterMeta {
  origin: "authored";
  lifecycle: "resident";
  active: true;
  seed: number;
  role: string;
  adult: true;
  createdDay: number;
  homeLocation: string;
  /** Display-level species for authored residents that have no upstream Chara CSV row. */
  species?: string;
  encounterRegion?: undefined;
  encounterSummary?: undefined;
  rememberedSlot?: undefined;
}

export type DynamicCharacterMeta = GeneratedDynamicCharacterMeta | AuthoredDynamicCharacterMeta;

/** Persisted day-end choice for a newly generated individual character. */
export interface MobGirlMemorySession {
  kind: "mob-girl-memory";
  charaNum: number;
  dayIndex: number;
}

/** A persisted AI ordering accepted for one deterministic event opportunity. */
export interface AcceptedEventRanking {
  setId: string;
  contextHash: string;
  channel: "daily" | "outing-departure" | "outing-return" | "banquet";
  dayIndex: number;
  candidateIds: number[];
  acceptedAtTick: number;
}

export type BanquetPhase =
  | "scheduled"
  | "preparing"
  | "active"
  | "cleanup"
  | "closing"
  | "resolved"
  | "cancelled";

/**
 * Deterministic story beats inside a banquet.  These are deliberately a
 * small, serializable vocabulary: a future AI provider may propose text or
 * optional branches, but the runtime always accepts and settles these beats
 * through this schema first.
 */
export type BanquetBeatKind =
  | "arrival"
  | "toast"
  | "social"
  | "performance"
  | "incident"
  | "feature"
  | "closing";

export type BanquetBeatStatus = "pending" | "completed" | "skipped";
export type BanquetBeatOutcome = "warmth" | "applause" | "tension" | "recovery" | "none";

export interface BanquetBeat {
  id: string;
  kind: BanquetBeatKind;
  title: string;
  /** Minutes relative to the scheduled start; arrival may be negative. */
  offsetMinutes: number;
  participants: number[];
  status: BanquetBeatStatus;
  outcome?: BanquetBeatOutcome;
}

/** Legacy persisted shape for the retired outing EV1 event. New runtime code
 * never creates this session; migration clears it without applying effects. */
export interface OutingEv1Session {
  kind: "outing-ev1";
  eventId: 1;
  channel: "outing-departure" | "outing-return";
  enemyRace: string;
  startedAtTick: number;
  stage: "approach" | "attack" | "dodge" | "result";
}

/** Authored upstream ASK_M-style choice exposed to the player. `decline` is the
 *  safe no-effect branch (上游「無視して立ち去る」/「今日は帰る」). For EV7
 *  the numeric/string value is the item id from `EV7_SHOP`. Numeric values
 *  other than the special markers follow upstream `RESULT` semantics, but the
 *  modern runtime only preserves the resolved `prompt.id` mapping; restated
 *  branches are deterministic and documented per event. */
export type OutingChoiceValue = number | "decline" | "accept" | "rescue";

/** One authored line shown before an interactive outing-event choice. It is
 *  persisted with the session so a save/load does not collapse a scene back
 *  into a bare one-line prompt. */
export interface OutingChoicePromptLine {
  kind: "narration" | "dialogue";
  speaker?: string;
  text: string;
}

/** Serializable prompt offered to the player while an outing event session is
 *  paused. Mirrors the command-layer `PromptSpec` shape so the UI can re-use
 *  `PromptMenu` without an extra adapter layer. Free-text prompts are not
 *  used by upstream `GO_OUT_EV*.ERB`. */
export interface OutingChoicePromptSpec {
  kind: "ask_yn" | "pick_one";
  question: string;
  options: { id: OutingChoiceValue; label: string; detail?: string; disabled?: boolean }[];
  /** Authored scene/口上 shown above the choices, when the event has one. */
  opening?: OutingChoicePromptLine[];
}

/** Paused outing event that requires a player decision before settlement can
 *  continue. Created by `runOutingDepartureEvents` / `runOutingReturnEvents`
 *  when an interactive event (EV2 / EV3 / EV5 / EV6 / EV7) is rolled. The UI
 *  surfaces the prompt; the choice flows back via `resolveOutingChoiceSession`
 *  which then applies the deterministic aftermath. */
export interface OutingChoiceSession {
  kind: "outing-choice";
  /** Upstream event id; only interactive events (2/3/5/6/7) produce sessions. */
  eventId: 2 | 3 | 5 | 6 | 7;
  channel: "outing-departure" | "outing-return";
  /** When the session was created — used for diagnostic fields and ordering. */
  startedAtTick: number;
  /** Snapshot of the prompt shown to the player (so the UI does not depend on
   *  the event registry to rebuild it). */
  prompt: OutingChoicePromptSpec;
}

/** Result of an answered outing choice. The events have already been settled
 *  (effect lines, advanceTimeTicks, TFLAG bit set) but the textual narration
 *  must be shown to the player inside the dedicated dark-frame event window
 *  (实玩反馈: 在路途中遇到的遭遇完整呈现给玩家) before being committed to the
 *  persistent eventLog. Created by `resolveOutingChoiceAction`; cleared by
 *  `closeOutingChoiceResultAction`. */
export interface OutingChoiceResultSession {
  kind: "outing-choice-result";
  eventId: 2 | 3 | 5 | 6 | 7;
  channel: "outing-departure" | "outing-return";
  startedAtTick: number;
  prompt: OutingChoicePromptSpec;
  /** The authored outcome lines (matches what would have been written to the
   *  eventLog before this split). Cleared when the player dismisses the
   *  result screen. */
  resultEvents: ReadonlyArray<ObservationEvent>;
}

export type OutingEventSession = OutingEv1Session | OutingChoiceSession | OutingChoiceResultSession;

/**
 * The long-event program is nested in the existing world-event instance so
 * old saves remain valid and the scheduler does not need another top-level
 * lifecycle.  `cursor` is the next beat to settle and `momentum` is the
 * deterministic score used by the closing beat.
 */
export interface BanquetProgram {
  version: 1;
  activeDurationMinutes: number;
  beats: BanquetBeat[];
  cursor: number;
  momentum: number;
}

export interface BanquetEventInstance {
  kind: "banquet";
  id: string;
  templateId: number;
  seed: number;
  venue: string;
  scheduledStartTick: number;
  forcedEndTick: number;
  phase: BanquetPhase;
  participants: number[];
  hosts: number[];
  guests: number[];
  excluded: number[];
  workRemaining: Record<number, number>;
  cleanupRemaining: Record<number, number>;
  initialScale: number;
  finalScale: number;
  /** Present for newly scheduled events; absent on legacy saves. */
  program?: BanquetProgram;
  /** Character position snapshots used to return everyone after cleanup. */
  originLocations?: Record<number, string>;
  originRoomIds?: Record<number, number>;
}

export type DateSessionPhase = "traveling" | "active" | "returning";

/** Authoritative single-partner date state. Legacy ERA flags are projections. */
export interface DateSession {
  partner: number;
  source: "player-405" | "local-992" | "appointment" | "legacy";
  initialFavor: number;
  startedAtTick: number;
  /** Compatibility MAPID mirrored to CFLAG:约会中 while the date is active. */
  mapId: number;
  forcedEndTick?: number;
  phase: DateSessionPhase;
  destination?: string;
  travelRemainingMinutes?: number;
}

export type DatePlanPhase =
  | "seeking-player"
  | "offered"
  | "scheduled"
  | "waiting"
  | "started"
  | "declined"
  | "cancelled"
  | "missed"
  | "resolved";

export interface DatePlanEvent {
  kind: "date-plan";
  id: string;
  partner: number;
  seed: number;
  phase: DatePlanPhase;
  createdAtTick: number;
  scheduledStartTick?: number;
  location?: string;
  arrivalTick?: number;
  waitUntilTick?: number;
  resolvedAtTick?: number;
}

export type WorldEventInstance = BanquetEventInstance | DatePlanEvent;

export interface MarketGift {
  adjectId: number;
  mainId: number;
  name: string;
  price: number;
}

/** Structured replacement for the mutable upstream CSTR first-kiss prose. */
export interface FirstKissRecord {
  dayIndex: number;
  location: string;
  partner:
    | { kind: "character"; charaNum: number }
    | { kind: "anonymous"; label: string };
  situation: "ordinary" | "penis";
}

/**
 * Modern mirror of eraTW's per-character `Activity_Type` /
 * `Activity_Duration` pair used by 自由行動処理.
 *
 * The concrete FREE_ACT side effects are intentionally not stored here; this
 * is the scheduler-visible action envelope that lets map sensing and EVENT-32
 * kojo see "this character is in the middle of a free action".
 */
/**
 * One 家庭菜園 plot (畝) — the parallel `PLANT_*`/`HATAKE_NAME` slot arrays
 * (`DIM.ERH:251-256`) folded into a struct. All ints except `name`.
 * Engine: `runtime/state/farm.ts` (COMF418 + YASAI).
 */
export interface FarmPlot {
  /** `PLANT_TYPE` — the planted 苗 (seedling) item id; 0 = empty plot. */
  type: number;
  /** `PLANT_DAYS` — days since planting (YASAI ++ nightly). >9 → harvest +2 grow. */
  days: number;
  /** `PLANT_GROW` — growth stage (10=ripe; >10 with dryness → withered). */
  grow: number;
  /** `PLANT_DRY` — days without water (0 = watered today; >4 → withered). */
  dry: number;
  /** `PLANT_FOOD` — fertilized flag (0/1). */
  food: number;
  /** `HATAKE_NAME` — the crop's display name (e.g. 卷心菜); "" when empty. */
  name: string;
}

export interface CharaFreeAction {
  /** FREE_ACT id, 0..19 in the original bundled free-action loop. */
  type: number;
  /** Remaining in-game minutes. Counts down by TIME_PROGRESS. */
  remainingMinutes: number;
}

export interface FreeActionMetaState {
  /** FREE_ACT_15 説教 chain: Eiki starts it, same-location targets can join. */
  sermon?: {
    preacher: number;
    location: string;
  };
  /** FREE_ACT_16 落とし穴 chain: pranksters prepare a trap, one victim can fall in. */
  pitfall?: {
    dayIndex: number;
    initiator: number;
    location: string;
    victim?: number;
    rank?: number;
    /** Set when the master avoids the trap on room arrival. */
    avoidedAtTick?: number;
    /** Set after COMF400's player-fall branch advances TIME by 3. */
    fallenAtTick?: number;
    /** True only for the player-arrival fall, not an NPC free-action victim. */
    masterFell?: boolean;
    records?: Record<number, 1 | 2>;
  };
  /** FREE_ACT_17 snow creations are room-scoped and reset with the day. */
  snow?: {
    dayIndex: number;
    objects: Record<string, {
      creator: number;
      completed?: boolean;
      /** FA17_EXIST-equivalent visible progress, in upstream +10 units. */
      visibilityUnits?: number;
      /** Snapshot of FA17_OBJNAME so old/dynamic creators remain displayable. */
      name?: string;
      suffix?: string;
    }>;
  };
}

export type CommissionProgress =
  | -1
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 103
  | 104
  | 105
  | 106;

export type CommissionKind = "common" | "unique";

/**
 * Weather system state. eraTW's full weather SAVEDATA mirror — 30+ fields
 * covering long/short/daily forecasts, low-pressure systems, regional weather,
 * abnormal weather, and crop damage. Defined in `runtime/state/weather-state.ts`.
 * Optional for old saves; `getWeatherState()` lazily initializes a default when
 * missing. Wired up by weather-system S1 (2026-07-02).
 */
export type WeatherState = import("./weather-state.js").WeatherState;

export type CommissionTaskKind =
  | "work"
  | "procure"
  | "deliver_person"
  | "deliver_place";

/** One accepted 委托 slot (`IRAI_SLOT`/`IRAI_DATA`/`IRAI_SUB`/deadline). */
export interface CommissionSlot {
  /** `MAKE_IRAI_ID(client, localId)` = client*1000 + localId. */
  iraiId: number;
  clientId: number;
  localId: number;
  kind: CommissionKind;
  task: CommissionTaskKind;
  targetCharaNum?: number;
  targetLocation?: string;
  itemId?: number;
  itemQty?: number;
  /** Absolute day index when the request expires. 0 = no deadline. */
  deadlineDay: number;
  acceptedDay: number;
}

/** JSON-safe modern mirror of eraTW's accepted request arrays. */
export interface CommissionState {
  slots: CommissionSlot[];
  /** Day index when IRAI_HAPPEN → IRAI_VANISH last ran. Prevents double-run
   *  across finishPlayerSleep + explicit [100] 睁开眼睛 in the same morning. */
  lastMorningDay?: number;
}

/**
 * A character met mid-walk, awaiting the player's 无视/打招呼/停下来 choice
 * (实玩反馈 #9, SKIP_MOVE relay loop `COMF400.ERB:497-526`).
 */
export interface WalkEncounter {
  /** The intermediate room where the walk paused. */
  location: string;
  charaNum: number;
  name: string;
  /** KEHAI activity tag (0 none / 1 idle / 2 work / 3 sleep / 4 free). */
  kehai: number;
  /** Whether 打招呼 is allowed (false during 時間停止, FLAG:70). */
  canGreet: boolean;
}

/**
 * A locked 私室 reached at the END of a walk, awaiting the player's 潜入/算了
 * choice (`@潜入房間`, 侵入.ERB). The master waits at `直前位置` until resolved.
 */
export interface LockedDoorPause {
  /** The locked destination room. */
  location: string;
  /** The sleeping resident owner. */
  ownerCharaNum: number;
  ownerName: string;
}

/** An in-flight SKIP_MOVE walk, paused for a player choice: either a mid-walk
 *  `encounter` (无视/打招呼/停下来) OR a `lockedDoor` at the destination
 *  (潜入/算了). Exactly one of the two is present. */
export interface WalkSession {
  /** Intermediate rooms still to pass after this encounter. */
  remaining: string[];
  /** Final destination room. */
  dest: string;
  /** 経過時間 accumulated so far (relays passed, incl. this encounter). */
  stepsTaken: number;
  /** 直前位置 — the room just before the destination (bounce target for a
   *  toilet/bath destination event, COMF400.ERB:540/548). */
  prevLocation: string;
  /** Mid-walk NPC encounter (present unless this is a `lockedDoor` pause). */
  encounter?: WalkEncounter;
  /** Locked-room pause at the destination (present unless mid-walk encounter). */
  lockedDoor?: LockedDoorPause;
}

export type TrainingMode = "h" | "partner-led" | "time-stop";

export interface TrainingCommandRecord {
  commandNo: number;
  target: number;
  tick: number;
  day: number;
  outcome: "ok" | "blocked" | "noop";
}

export interface TrainingSession {
  target: number;
  startedAtTick: number;
  startedDay: number;
  lastTick: number;
  lastCommandNo: number;
  commandCount: number;
  mode: TrainingMode;
  participants: number[];
  recentCommands: TrainingCommandRecord[];
}

export interface TrainingSummary {
  target: number;
  startedAtTick: number;
  endedAtTick: number;
  startedDay: number;
  endedDay: number;
  commandCount: number;
  mode: TrainingMode;
  lastCommandNo: number;
  reason: "exit-command" | "target-changed" | "manual";
}

/** Save-compatible authored-kojo memory. Keys are explicit source-level
 * identifiers such as `SELECTCOM:300`, never transient cache state. */
export interface KojoMemory {
  firstTime: Record<string, true>;
  once: Record<string, true>;
}

/**
 * Non-persistent command data retained only while its authored kojo resolves.
 * Values are snapshots, never mirrors of long-lived gameplay state: in
 * particular SOURCE/NOWEX must be captured before their settlement pipeline
 * clears them. Missing per-chara maps mean the producer did not supply that
 * namespace and the router must fail closed.
 */
export interface KojoExecutionFrame {
  actor: number;
  target: number;
  participants: number[];
  commandNo: number;
  previousCommandNo?: number;
  outcome?: number;
  sourceByChara: Record<number, Record<number, number>>;
  nowExByChara: Record<number, Record<number, number>>;
  args: Array<number | string>;
  results: Array<number | string>;
  roleAliases: Record<string, number | string>;
  /**
   * Per-target `DOUBLE_MESSAGE_BLOCKED:TARGET` snapshot for the duration of
   * one command's kojo execution frame. Each bit corresponds to a single
   * shared message family (3=PALAM_MESSAGE_B, 6=PALAM_MESSAGE_E,
   * 7=PALAM_MESSAGE_F, 8=MARK_MESSAGE, …). The bit is set when the family
   * first emits in this frame, so re-entrant calls render no body until the
   * resolver rebuilds the frame on the next command. The field is intentionally
   * absent from `GameState.schemaVersion` and is reset on every save migration,
   * so it never survives a save/load round-trip.
   */
  doubleMessageBlockedByChara: Record<number, number>;
}

/** Command-local execution state. Never persisted as long-lived gameplay data. */
export interface TurnContext {
  tflags: Record<number, number>;
  selectCom?: number;
  prevCom?: number;
  result: number[];
  locals: number[];
  frame?: KojoExecutionFrame;
}

export interface GameState {
  /** Runtime state schema, distinct from the outer save-envelope version. */
  schemaVersion?: number;
  time: TimeSlot;
  workRuntime?: WorkRuntimeState;
  /** Canonical room used by COMF402's `CFLAG:MASTER:初期位置` sleep gate. */
  homeLocation?: string;
  /** `TIME:MASTERの起床予定時刻` / `TIME:3`, minute-of-day. Existing saves
   *  default to 480 (08:00), matching the modern schedule seed; the 起床前
   *  menu can change it for subsequent sleep sessions. */
  masterWakeMinute?: number;
  /** Player. `charaNum === 0`. */
  master: CharaSlot;
  /** NPCs. Sparse: contains only entries that currently exist. */
  charas: Record<number, CharaSlot>;
  /** Top-level FLAG store (not per-chara CFLAG). Phase 5 extends. */
  flagStore: Record<number, number>;
  /**
   * Legacy flat `TFLAG` namespace. Schema migration always initializes this
   * independently from `flagStore`; numeric overlap makes copying between the
   * two stores unsafe. P0-B moves command-local fields into TurnContext.
   */
  tflagStore?: Record<number, number>;
  /** Active command context. Cleared after its authoritative dialogue ends. */
  turnContext?: TurnContext;
  /**
   * Player's yen pool — `MONEY:0` in ERB (a 64-bit int, no cap). Seeded to
   * 99999 at NEWGAME (`NEWGAME_BONUS.ERB:70`, default 特典). Written by the
   * money helpers (`runtime/state/money.ts` pay/grant/lose) which floor at 0
   * to match `@PAY_MONEY_YEN`/`@LOST_MONEY_YEN` (`COMMON.ERB:2900-2930`).
   * `MONEY:1` (MAGIC_DLC 法力) and `MONEY:2` (casino chips, CM_LIMIT cap) are
   * NOT modeled here — they belong to DLC / minigame subsystems.
  */
  money: number;
  /** `MONEY:2`, kept separate from yen and capped by the casino subsystem. */
  casinoChips?: number;
  /** Remaining values in the 300-slip 守矢神社 lottery box (COMF435). */
  moriyaOmikujiBox?: number[];
  /** `CHILD_SEX_PREG:child:slot`, a small explicit compatibility array. */
  childSexPreg?: Record<number, Record<number, number>>;
  /** Authoritative born-child records, keyed by mother chara number. */
  children?: Record<number, ChildRecord[]>;
  /** Pending sleep flow. Present after MASTER goes to bed / collapses and
   *  cleared only when the night-settlement screen runs the morning settlement. */
  sleepSession?: SleepSession | null;
  /** Last day on which the home-only modular DAILYEVENT table was evaluated. */
  dailyEventLastRunDay?: number;
  /** Numeric SAVEDATA bitfields used by authored daily events (e.g. EV23's
   * travelling-shop stock). Missing fields are treated as zero. */
  dailyEventFlags?: Record<number, number>;
  /** Numeric SAVEDATA values owned by authored daily events (for example
   * EV23's selected travelling-salesperson appearance). */
  dailyEventValues?: Record<number, number>;
  /** Gameplay prompt that paused the whole sleep settlement before commit. */
  dailyEventSession?: DailyEventSession | null;
  /** Pending world-level `@MAKANAI` yes/no prompt. */
  mobMealSession?: MobMealSession | null;
  /** Generated individual-character metadata, keyed by the normal CharaSlot id. */
  dynamicCharacters?: Record<number, DynamicCharacterMeta>;
  /** Monotonic allocator for generated CharaSlot ids. */
  nextDynamicCharaNum?: number;
  /** Pending upstream EVENTTURNEND "忘记/记得很清楚" choice. */
  mobGirlMemorySession?: MobGirlMemorySession | null;
  /** Accepted read-only event orderings. Cleared after their opportunity settles. */
  acceptedEventRankings?: AcceptedEventRanking[];
  /** Persisted world-event instances; the instance is authoritative over mirrors. */
  worldEvents?: WorldEventInstance[];
  /** Ordinary solo outing, independent of an active date. */
  outing?: { startedAtTick: number; mapId: number } | null;
  /** Active multi-stage outing event; null/absent means no event modal. */
  outingEventSession?: OutingEventSession | null;
  /** Single-partner date authority. Missing/null means no date. */
  dateSession?: DateSession | null;
  dailyBlessingExpId?: number;
  dailyBlessingDay?: number;
  marketGifts?: MarketGift[];
  /** `GatheringSeason` - temporary season override set by DAILY_EV24. */
  gatheringSeason?: 1 | 2 | 3 | 4;
  /** `RACEBUFF_DAYS` / `BUFFED_RACE` from DAILY_EV34. */
  mobRaceBuff?: MobRaceBuff;
  /** Per-character first-kiss history details used when no concrete NPC exists. */
  firstKissHistory?: Record<number, FirstKissRecord>;
  /** Active full-screen danmaku session. The visual frame state is rebuilt
   * from its input stream, keeping the save payload compact. */
  danmakuBattle?: DanmakuBattleSession | null;
  /** Persistent tackle ownership, equipped gear and catch records. */
  fishingGear?: FishingGearState;
  /** Active full-screen fishing session. Null/absent means ordinary play. */
  fishingGame?: FishingGameSession | null;
  /** Settled fishing result awaiting player dismissal. The kojo branch is
   *  rendered on the in-scene terminal phase card and only committed to
   *  the eventLog after the player clicks 继续. */
  fishingSettlement?: FishingSettlement | null;
  /** Persistent COM633 records and authored clerk identity. */
  stoneContestProgress?: StoneContestProgress;
  /** Active full-screen COM633 continuation. Null/absent means ordinary play. */
  stoneContestSession?: StoneContestSession | null;
  /**
   * `ENABLE_DAYEVENTS` — upstream DAYEVENT toggle (0=off, 1=authored-only,
   * 2=allow every eligible character). Missing legacy values default to 1.
   * The authored `DAYEVENT_COND` return-value hook is still a separate
   * router capability; this field must nevertheless be persisted so a save
   * does not silently lose the user's global setting.
   */
  dayEventsEnabled?: 0 | 1 | 2;
  /** Pending SKIP_MOVE walk paused at an encounter (实玩反馈 #9 slice 2).
   *  Present while the player chooses 无视/打招呼/停下来; cleared when the walk
   *  concludes (arrival or stop). */
  walkSession?: WalkSession | null;
  /** Active H/training command session. Optional for older saves; null = idle. */
  training?: TrainingSession | null;
  /** Last completed training session, kept for UI/debug summaries. */
  lastTrainingSummary?: TrainingSummary | null;
  /** Selected personal-kojo variant per character. Missing = the bundled
   *  default, mirroring upstream `CFLAG:口上セレクタ == 0`. */
  selectedKojoVariants?: Record<number, string>;
  /** Per-target memory used by FIRSTTIME/ONCE in authored kojo. Optional for
   * existing saves; missing entries behave as unread. */
  kojoMemory?: Record<number, KojoMemory>;
  /** Authored display-name relations, keyed observer then subject. This is
   * distinct from immutable roster callName metadata. */
  displayNames?: Record<number, Record<number, string>>;
  /** Explicit mutable string slots used by source-backed static kojo writes. */
  kojoStrings?: {
    cstr?: Record<number, Record<number, string>>;
    nickname?: Record<number, string>;
  };
  /**
   * Per-location dirt level (`YOGORE:位置` in ERB — a top-level
   * `#DIM SAVEDATA YOGORE, 2000` array keyed by room id). Modeled here
   * keyed by the canonical location STRING (e.g. `"神社:本堂"`) to match
   * our `CharaSlot.location` convention. Read/written by the cleaning
   * subsystem (`COMF410 掃除`). Optional: a missing key reads as 0 dirt,
   * and pre-existing GameState construction sites need not initialize it.
   * The WorldScheduler (Phase 8) will accumulate dirt over time; for now
   * it is seeded by tests / save data.
   */
  yogore?: Record<string, number>;
  /**
   * Player's item inventory — `ITEM:n` in ERB (a 1-D int array sized 1000,
   * `CSV/VariableSize.csv:17`, indexed by item id, value = count owned).
   * Modeled as a sparse `Record<id, count>`. Optional: a missing key (or a
   * missing `items` map) reads as 0 owned, so pre-existing construction
   * sites need not initialize it. Read/written by the item helpers
   * (`runtime/state/items.ts` hasItem/addItem/removeItem/buyItem). The
   * shop-stock companion `ITEMSALES:n` lives in `itemSales` below.
   * `NOITEM` (debug no-item flag) is deferred.
   */
  items?: Record<number, number>;
  /**
   * Captured insects (`MUSHI_CAGE`, max eight).  Kept separate from ordinary
   * material items because they are later selectable for insect battles.
   */
  bugCage?: import("./bug-catching.js").CaughtBug[];
  /** `MUSHI_COLLECT`: species seen at least once, keyed by MUSHI_NUM. */
  bugCollection?: Record<number, true>;
  /** Monotonic capture sequence used to create deterministic, JSON-safe IDs. */
  bugCaptureCount?: number;
  /** `MUSHI_TRAP`: one baited insect trap, progressed by the game clock. */
  bugTrap?: import("./bug-catching.js").BugTrap;
  /**
   * Shop stock — `ITEMSALES:n` in ERB (a 1-D int array sized 1000,
   * `CSV/VariableSize.csv:18`, indexed by item id). Per-item values:
   *   - `99`  : infinite (restockable consumables; never depletes — the
   *             shop refreshes SALES to 99 each view, `SHOP_ITEM.ERB:12-15`).
   *   - `>0`  : limited stock count (食材/酒/苗/野菜 — restocked at day-end,
   *             `SHOP_EVENTTURNEND` / `お店に入荷`).
   *   - `0`   : not stocked / not purchasable here (default for an empty slot).
   *   - `-1`  : sold out (a unique item already owned, or a limited item
   *             depleted — `ITEMDATA "SALES"` returns -1 in both cases).
   *   - `-2`  : sealed /条件不満 (e.g. 媚薬 when `ABL:教養 < 2`, `【技巧UP】`
   *             when `ABL:技巧 ≥ 5`; `ITEMDATA.ERB` returns -2).
   * Modeled as a sparse `Record<id, number>`. Optional + missing-key-reads-0
   * so pre-existing construction sites need not initialize it. Read/written
   * by the shop helpers (`runtime/state/shop.ts` itemStock/shopBuy/restock).
   * Infinite-stock items need not be stored (the catalog carries that flag);
   * only limited counts + sold-out (-1) + sealed (-2) markers are persisted.
   */
  itemSales?: Record<number, number>;
  /**
   * Opening-flow kojo opt-out list. Keyed by charaNum; a truthy entry means the
   * pre-game selection screen disabled that character's personal dialogue pack.
   * Optional for old saves; missing map = all enabled.
   */
  disabledKojo?: Record<number, true>;
  /** Accepted 委托 slots (`IRAI_SLOT` et al). Pending/unaccepted requests live
   *  on the original per-chara `CFLAG:依頼状況/依頼内容` pair. Optional for old
   *  saves; commission helpers default this to `{ slots: [] }`. */
  commissions?: CommissionState;
  /**
   * Weather system state (see `WeatherState`). Optional for old saves;
   * `getWeatherState(state)` lazily initializes a default. Set by
   * `WEATHER_FORECAST_1YEAR/1TERM/1DAY` (Phase 7.5 weather-system S3+).
   */
  weather?: WeatherState;
  /**
   * Per-character 自由行動 state (`Activity_Type`/`Activity_Duration`).
   * Optional for old saves; missing = nobody is in a free action.
   */
  freeActions?: Record<number, CharaFreeAction>;
  /** Small global state for chained FREE_ACT entries such as 説教/落とし穴. */
  freeActionMeta?: FreeActionMetaState;
  /**
   * Day index when the original `@遭遇判定` morning refresh last ran. Optional
   * for old saves; prevents duplicate refresh when a wake path also passes
   * through the explicit `[100] 睁开眼睛` menu.
   */
  encounterMorningDay?: number;
  /**
   * Day index when the morning subsystem pipeline (`runMorning`) last ran
   * (DAY-CYCLE-PLAN §S2). Pipeline-level same-day idempotency guard: both the
   * sleep-wake path (`finishPlayerSleep`) and the explicit `[100] 睁开眼睛`
   * (`openEyes`) funnel through `runMorning`, which no-ops when this equals
   * `time.dayIndex`. The per-subsystem guards (`commissions.lastMorningDay`,
   * `encounterMorningDay`) stay as double-insurance. Optional for old saves
   * (missing = never ran → next wake runs it).
   */
  morningRanDay?: number;
  /**
   * 家庭菜園 plots — `PLANT_TYPE/PLANT_DAYS/PLANT_GROW/PLANT_DRY/PLANT_FOOD/
   * HATAKE_NAME` (each 5 slots, `DIM.ERH:251-256`, all SAVEDATA). Fixed
   * 5-element array once initialized (the usable prefix is gated by
   * `TALENT:採集Lv` — `@GETUNELENGTH418`). Optional for old saves; missing =
   * nothing planted (`getFarm` lazily initializes). See `runtime/state/farm.ts`.
   */
  farm?: FarmPlot[];
  /**
   * `VAR_WATER` (`DIM.ERH:768`, str SAVEDATA) — the water the master is
   * carrying (set by COMF419 水汲み, consumed as a gate by COMF418 watering
   * and swapped into the brewing jar by COMF450). Empty/missing = no water.
   * FARM-BREW declared behavior change ①: 419 used to surface this only in
   * narration; it now persists here.
   */
  varWater?: string;
  /**
   * `VAR_FERMENT` (`DIM.ERH:767`, str SAVEDATA) — the 酒虫's brewing jar
   * contents. Starts "普通的水" (NEWGAME.ERB:19). COMF450 swaps water in /
   * extracts brew out; the nightly `@酒造` tick ferments it to its 変化先.
   * Missing/empty defaults to "普通的水". See `runtime/state/brewing.ts`.
   */
  varFerment?: string;
  /**
   * `DAY:10` — the brew-day counter (`@酒造` DAY:10++, resets to 0 on a
   * fermentation transition / water swap). Optional; missing = 0.
   */
  brewDays?: number;
  /**
   * `BREWING_KNOWN_DRINKS` (`SAKE_BREWING_GUIDE`) — the brewing-guide 图鉴:
   * drink names the player has seen in the jar. A name→true set (the
   * upstream is a per-id bit array; the modern keys by name for the
   * name-first brewing registry). Optional for old saves.
   */
  brewKnown?: Record<string, true>;
  /**
   * P4 — PANTS_TEMP (`DIM.ERH:413`). Per-chara, per-panty-piece-id count of
   * freshly acquired panties that have NOT yet been transferred to permanent
   * collection via COMF401. `pantsTemp[charaNum]` is lazily initialised;
   * absent/empty = nothing held. JSON-safe (keys are numbers-as-strings).
   * Panty piece ids range 0..MAXPANTS (33).
   */
  pantsTemp?: Record<number, Record<number, number>>;
  /**
   * P2-d — Coordinate outfit presets. Per-chara map of slot→EQUIP snapshots.
   * `outfitSets[charaNum][slotId]` = `Record<slotId, pieceId>`.
   * slotId is 1-99 (matching upstream COORDINATE numbering). Slots store
   * only the non-zero EQUIP entries (sparse). JSON-safe via structuredClone.
   */
  outfitSets?: Record<number, Record<number, Record<number, number>>>;
  /**
   * The current dish (`DISH_*` globals, `FOOD.ERH`). `null`/unset = no dish.
   * Populated by COMF413 (B7-cook, deferred) or `seedDish()` (B7-eat slice).
   * Read by COMF414 食事を取る / COMF415 食事をふるまう. Optional so
   * pre-existing construction sites need not initialize it.
   */
  dish?: Dish | null;
  /**
   * `LEARNED_MENU:CHARA` — per-chara 固有料理 practice progress (COMF413 練習
   * モード). 0..99 = practicing; ≥100 = learned (set to `100 + DAY` by
   * `@LEARNING_SP_DISH`), which unlocks that chara's SP dish (dish no 400+N)
   * in the normal menu. Keyed by charaNum. JSON-safe via structuredClone.
   */
  learnedMenu?: Record<number, number>;
  /** Append-only event log. */
  eventLog: ReadonlyArray<ObservationEvent>;
  /**
   * NPC stat snapshot captured at day-start (`openEyes` / new-game). Keyed by
   * charaNum → a deep copy of that chara's `CharaSlotState`. Diffed against the
   * live state at sleep to produce the night-settlement daily report. Optional
   * for old saves / fixtures (missing = no report).
   */
  daySnapshot?: Record<number, CharaSlotState>;
  /**
   * Personal History 时间戳（首次发生日期 dayIndex）— charaNum → 长度 = HISTORY_CATEGORY_COUNT
   * 的 `number[]`。`0` 未发生；`>0` 首次发生的 dayIndex（不可变）；`-1` lock validator
   * 失败（已 reset）。由 `recordPersonalHistory` 写入；由 `runPersonalHistoryReconciliation`
   * (morning pipeline) 自动回填 lock-hold 类。
   */
  charasInfo?: Record<number, number[]>;
  /**
   * 浮気把握 (UWAKI_KNOWN/UWAKI_ACCEPTED, 情事発覚.ERB) — per WITNESS charaNum,
   * the partner charaNums she knows MASTER has been intimate with (`known`),
   * and the publicly acknowledged subset (`accepted`, 公认 — rendered yellow).
   * Written by `runUwakiWitnessCheck` (per-command 同室 disclosure hook) /
   * `uwakiRecord`; read by PAGE 5 浮気把握状況. Optional for old saves.
   */
  uwaki?: Record<number, { known: number[]; accepted: number[] }>;
  /**
   * 礼物 records (GIFT_GOT + CFLAG:礼物保管库/获得的礼物 companions) — per
   * RECIPIENT charaNum, the ordered list of gifts received from MASTER. The
   * upstream packs 回数/得点/日期/場所/形容詞/本体 into one 18-digit int
   * (GIFT_ID, `@GET_GIFTDATA` 贈り物.ERB:584) which exceeds JS safe integers;
   * the modern stores the SAME six fields as a struct (informationally
   * identical, JSON-safe). `favoriteIdx`/`latestIdx` mirror CFLAG:获得的礼物 /
   * 礼物保管库 as indexes into the list. See `runtime/state/gifts.ts`.
   */
  gifts?: Record<number, import("./gifts.js").CharaGiftState>;
  /**
   * Player's diary (`SAVESTR:1`, DIM.ERH top-level `STR SAVEDATA` slot 1).
   * Entries are joined with `//` (upstream's separator, `STRCOUNT >=
   * 100` = "diary full" gate in COMF406). Stored as an ORDERED list of
   * entries — modern equivalent of the SAVESTR string, JSON-safe and
   * diff-friendly (vs the upstream monolithic string). Optional for old
   * saves; missing = empty diary. Read/written by `runtime/state/diary.ts`
   * and consumed by `runtime/command/handlers/diary-406.ts` (COMF406
   * 日記を読む). Per-page NPC diaries are stored separately on each
   * chara via CFLAG/TCVAR — see `charaDiaries` below.
   */
  masterDiary?: string[];
  /**
   * Per-chara diary pages (the NPC-side of `CHARA_DIARY_COM`, upstream
   * stores diary text in each chara's TCVAR/CFLAG). Keyed by charaNum →
   * ordered list of diary entries (one per milestone/page). Faithful
   * shape: a chara has a diary iff this array is non-empty. Optional
   * for old saves.
   */
  charaDiaries?: Record<number, string[]>;
  /**
   * DIARY status state machine — `DIARY:CHARA:DCOUNT` (上游). Per-chara
   * 2-D map: `charaNum → pageNum → 0|1|2|3` (`0`=未解锁, `1`=已读,
   * `2`=夜结算待显示, `3`=新解锁未读). Pages addressed 1..N (page 0
   * unused upstream). Updated by `@CHARA_DIARY_BEFORE_CHECK_K{N}` which
   * iterates pages, calls the author's `_HAPPEN` body, and sets this
   * to `2` (auto-fire) or `3` (player-only) per upstream semantics.
   * Consumed by `@CHARA_DIARY_AFTERTRAIN` (AFTERTRA.ERB:650) which
   * finds the first page==2 each night and renders the TEXT kojo.
   * Optional for old saves; missing map = no diary state.
   */
  diaryFlags?: Record<number, Record<number, 0 | 1 | 2 | 3>>;
  /**
   * PAGESET — `PAGESET:CHARA:SLOT` (上游). Maps compact slot index (1..N)
   * to the page number that fills it. Populated by `CHARA_DIARY_PAGESETTING`
   * (upstream @CHARA_DIARY.ERB:241) which finds the first empty slot.
   * Used by AFTERTRAIN to translate "slot 1" → "page 5" for TEXT render.
   * Optional for old saves.
   */
  diaryPageSet?: Record<number, Record<number, number>>;
  /**
   * MAX_DIARY_PAGE — `MAX_DIARY_PAGE:CHARA:0` (上游). Per-chara max page
   * count the author assigned (灵梦少女之梦 = 100, 大多数角色 = 1-30).
   * Drives the BEFORE_CHECK iteration bound. Optional for old saves;
   * missing map = 0 pages (no diary).
   */
  diaryMaxPage?: Record<number, number>;
  /**
   * The night-settlement daily report — per-NPC 好感度/信頼度/能力/経験 changes
   * accumulated since `daySnapshot`. Computed once at sleep (`finishPlayerSleep`)
   * and shown on the night screen instead of replaying the day's commands.
   * Faithful to eraTW's per-command result display (`TRACHECK` 好感度＋N / ABLUP
   * / 経験), aggregated to one report. Optional/empty when nothing changed.
   */
  daySettlementReport?: DailySettlementEntry[];
  /**
   * The ordered display stream of the most recent night settlement. This is
   * the upstream-like settlement body printed by the night screen
   * (DAYEVENT night → ONANISM → JUEL_CHECK → ABLUP → EVENTTURNEND fall-states
   * → RANK_POINT money). Wake recovery and morning-pipeline events still
   * return from `finishPlayerSleep` for the event log, but are not part of the
   * night-settlement screen. Overwritten on every sleep.
   */
  nightReport?: ObservationEvent[];
  /**
   * Joined from the 9 frozen manifests. Treated as immutable.
   * `diffGameState` skips this section.
   */
  readOnlyMetadata: WorldSnapshot;
  /**
   * Agent Runtime v2 state. Fresh saves always initialize this section with
   * masterEnabled=false. The optional marker remains only for lightweight
   * runtime fixtures that do not build a complete save.
   *
   * Persists interaction scores, dynamic top-N roster, per-character
   * cognitive state (observations / memories / reflections / goals /
   * diaries), and runtime settings.  No LLM calls are made in the
   * persistence-foundation slice — this is pure data.
   */
  agentRuntime?: import("../agent/types.js").AgentRuntimeState;
}

/** One NPC's line in the night-settlement daily report. */
export interface DailySettlementEntry {
  /** Whose changes these are. */
  charaNum: number;
  /** Display name (callName) at report time. */
  name: string;
  /** Human-readable change phrases, e.g. ["好感度 +120", "親密 Lv 2→3", "奉仕経験 +3"]. */
  changes: string[];
}

/**
 * Deep-clone a `GameState` via `structuredClone`. Returns a
 * structurally independent copy; mutations on the result do not
 * affect the input.
 *
 * Throws if any field violates JSON-safety (e.g. a function slipped
 * in through a loose `any`). Callers should keep all fields JSON-safe.
 */
export function cloneGameState(state: GameState): GameState {
  return structuredClone(state);
}

/**
 * Deep-copy every chara's `CharaSlotState` into a charaNum-keyed map. Used to
 * snapshot the NPC roster at day-start so the night settlement can diff the
 * day's changes (`runtime/state/daily-report.ts`).
 */
export function snapshotCharaStates(
  charas: Record<number, CharaSlot>,
): Record<number, CharaSlotState> {
  const out: Record<number, CharaSlotState> = {};
  for (const [num, slot] of Object.entries(charas)) {
    out[Number(num)] = structuredClone(slot.state);
  }
  return out;
}

/**
 * Build an all-empty `CharaSlotState`. Used by the 4D wiring layer
 * (`web/app/state/game-state-store.ts::buildInitialState`) so the
 * legacy namespace names do not appear in `web/app/` source code
 * (see `modernization/tests/unit/forbidden-names.test.ts`).
 *
 * If `CharaSlotState` grows a new namespace, TypeScript will fail
 * to compile here — that's a desirable failure mode.
 */
export function emptyCharaSlotState(): CharaSlotState {
  return {
    CFLAG: {},
    TALENT: {},
    ABL: {},
    EXP: {},
    PALAM: {},
    BASE: {},
    MAXBASE: {},
    TCVAR: {},
    BUFF: {},
    EX: {},
    EQUIP: {},
    MARK: {},
    CUP: {},
    CDOWN: {},
    STAIN: {},
    JUEL: {},
    TEQUIP: {},
  };
}

const DIFFABLE_NAMESPACES = [
  "CFLAG",
  "TALENT",
  "ABL",
  "EXP",
  "PALAM",
  "BASE",
  "MAXBASE",
  "TCVAR",
  "BUFF",
  "EX",
  "EQUIP",
  "MARK",
  // CUP/CDOWN are settlement-transient (0 at rest); included for
  // exhaustiveness symmetry — diffs of persisted states see 0→0.
  "CUP",
  "CDOWN",
  "STAIN",
  "JUEL",
  "TEQUIP",
] as const;

/** Diff a single CharaSlot's `state`, emitting one StateDelta per changed (namespace, id). */
function diffCharaState(
  subject: number,
  prev: CharaSlotState,
  next: CharaSlotState,
  out: StateDelta[],
): void {
  for (const namespace of DIFFABLE_NAMESPACES) {
    // `?? {}` tolerates CharaSlotStates built before a namespace existed
    // (older fixtures) — a missing namespace diffs as "no change".
    const prevMap = prev[namespace] ?? {};
    const nextMap = next[namespace] ?? {};
    const ids = new Set<number>([
      ...Object.keys(prevMap).map(Number),
      ...Object.keys(nextMap).map(Number),
    ]);
    for (const id of ids) {
      const pv = prevMap[id] ?? 0;
      const nv = nextMap[id] ?? 0;
      if (pv !== nv) {
        out.push({
          kind: "STATE_DELTA",
          timestamp: 0,
          subject,
          fields: [{ namespace, id, delta: nv - pv }],
        });
      }
    }
  }
}

/**
 * Compute the per-`(subject, namespace, id)` deltas between two
 * `GameState`s. Excludes `eventLog` and `readOnlyMetadata`.
 *
 * 3.1 scope: only CharaSlot deltas (master + charas). `time` and
 * `flagStore` are deferred to Phase 5+.
 *
 * Returned `StateDelta.timestamp` is always `0`. Callers that need
 * wall-clock timestamps should wrap and stamp.
 */
export function diffGameState(prev: GameState, next: GameState): StateDelta[] {
  const out: StateDelta[] = [];
  diffCharaState(0, prev.master.state, next.master.state, out);
  const charaIds = new Set<number>([
    ...Object.keys(prev.charas).map(Number),
    ...Object.keys(next.charas).map(Number),
  ]);
  for (const charaNum of charaIds) {
    const p = prev.charas[charaNum];
    const n = next.charas[charaNum];
    if (p && n) {
      diffCharaState(charaNum, p.state, n.state, out);
    }
    // "appeared" / "disappeared" chars are silently skipped in 3.1.
    // Phase 5+ will surface presence changes via separate channels.
  }
  return out;
}
