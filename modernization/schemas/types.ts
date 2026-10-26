/**
 * Phase 2.6 — Agent extension type definitions.
 *
 * Five type-only contracts for a future Generative Agents runtime.
 * No implementation, no LLM. See `modernization/docs/phase-2-6-survey.md`
 * for the data-source table and `phase-2-6-plan.md` §3 for the
 * shape rationale.
 *
 * Hard rule (from `AGENTs.md` and the survey §3): the only allowed
 * flow involving an LLM is
 *
 *   [deterministic core]  ──ObservationEvent──▶  [agent]
 *   [agent]                ──AgentIntent───────▶  [rule validator]  ──▶  [rule system]
 *   [agent]                ──DialogueCandidate─▶  [ui surface (sidecar only)]
 *
 * Concretely, no function in this file is exported that makes a
 * network call, mutates a snapshot, or calls into settlement code.
 * The 5 types are *contracts*. The stub validator in `validator.ts`
 * is the only function that *does* anything, and it's syntactic-only.
 */

// =====================================================================
// 1. ObservationEvent — emitted by the deterministic core on state change
// =====================================================================

/**
 * The deterministic core logs an ObservationEvent whenever something
 * observable happens. An agent (or future agent runtime) reads the
 * event bus. The core decides WHEN; this file just defines the shape.
 */
export type ObservationEvent =
  | CommandIssued
  | StateDelta
  | TimeTick
  | FlagChanged
  | DialogueDue
  | StatusMessage
  | Narration
  | DialogueLine
  | KojoHostEvent
  | EventPrompt;

export interface CommandIssued {
  kind: "COMMAND_ISSUED";
  /** ms-since-epoch when the core logged this. */
  timestamp: number;
  /** who acted: 0 = MASTER (player), else chara num from `characters.json`. */
  actor: number;
  /** command number from `commands.json` (e.g. 300 for "会話"). */
  commandNo: number;
}

export interface StateDelta {
  kind: "STATE_DELTA";
  timestamp: number;
  /** chara num whose state changed. */
  subject: number;
  /** which (namespace, id) pairs changed and by how much. Read-only. */
  fields: ReadonlyArray<{
    namespace:
      | "CFLAG"
      | "TALENT"
      | "ABL"
      | "EXP"
      | "PALAM"
      | "BASE"
      | "MAXBASE"
      | "TCVAR"
      | "EX"
      | "EQUIP"
      | "MARK"
      | "CUP"
      | "CDOWN"
      | "STAIN"
      | "JUEL"
      | "TEQUIP"
      | "BUFF";
    id: number;
    delta: number;
  }>;
}

export interface TimeTick {
  kind: "TIME_TICK";
  timestamp: number;
  /** in-game time units. Real mapping is Phase 8 WorldScheduler's. */
  tickValue: number;
}

export interface FlagChanged {
  kind: "FLAG_CHANGED";
  timestamp: number;
  /** top-level FLAG (not CFLAG). id is from `flags.json`. */
  flagId: number;
  newValue: number;
}

export interface DialogueDue {
  kind: "DIALOGUE_DUE";
  timestamp: number;
  /** chara num whose dialogue slot is due. Cross-ref `kojos.json`. */
  charaNum: number;
  /**
   * The event category, drawn from the upstream dispatch protocol
   * (`KOJO_MESSAGE.ERB` ARGS values). Cross-ref `event-messages.json`.
   * Examples: "EVENT", "COMMAND", "SP_EVENT", "ENCOUNTER", "DAILY",
   * "DIARY", "MARK", "PALAM", "COUNTER", "IRAI", etc.
   */
  eventCategory: string;
  /**
   * The event sub-id (e.g. commandNo for "COMMAND" events, eventNo
   * for "EVENT" events, spEventNo for "SP_EVENT"). Cross-ref
   * `event-messages.json` entries for the matching dispatch hub.
   */
  eventSubId: number;
}

/**
 * Phase 4 — system status line that should appear in the text
 * window. Not a game-state-changing event; purely a UI signal.
 *
 * Examples:
 *   - "no-op acknowledged" (CommandBar received a NOOP intent)
 *   - "intent rejected: ISSUE_COMMAND.actor must be a non-negative integer"
 *     (validator.ts failed)
 *   - "rebuild failed" (Phase 2.4 watcher error, surfaced in the same log)
 *
 * Persists into `eventLog` like any other event so it survives
 * save/load and replays in the text window. Phase 5+ settlement
 * still works against it (the diff helper already ignores eventLog).
 */
export interface StatusMessage {
  kind: "STATUS_MESSAGE";
  timestamp: number;
  /** Where this message came from. */
  source: "system" | "apply_intent" | "validator" | "watcher";
  /** The text to display in the TextWindow. */
  text: string;
  /** Explicit player feedback for a rejected command, separate from bookkeeping. */
  presentation?: "command-feedback";
}

/**
 * Phase 4.5 — in-world narrative prose for the current moment (scene
 * intro, action描述). Rides the same `eventLog` as everything else
 * (spec S3: one color-coded stream) and is rendered plain in the
 * narrative band / interaction box. Distinct from `STATUS_MESSAGE`,
 * which is meta/system text.
 */
export interface Narration {
  kind: "NARRATION";
  timestamp: number;
  /** The narrative line to display. */
  text: string;
  /**
   * Presentation lane for player-facing prose. `inline` is command
   * transcript prose (including legacy events where this field is absent);
   * `ambient` is scene-description prose retained in the scene/history but
   * not allowed to interrupt the command interaction transcript.
   */
  presentation?: "inline" | "ambient";
  /**
   * Optional rich result card. `omikuji` is the shrine fortune draw;
   * `gather` is the 採集 find + 说明文 pair (`@MESSAGE_COM445`, which prints
   * the count-delta line in green via `SETCOLOR 0x00FF00` then the item's
   * 地文 introduction after a `DRAWLINE`).
   */
  surface?: "omikuji" | "gather" | "diary" | "item-use" | "stall";
  /**
   * Structured COM406 page data. The fallback `text` remains printable in
   * minimal/history views; the immersive client uses this payload to render
   * the dedicated diary book without parsing decorated prose.
   */
  diary?: {
    bookTitle: string;
    pageId: string;
    body: string;
    kind: "dated" | "record" | "authored";
    /** 0-based game day. Present only when the source actually records it. */
    dayIndex?: number;
    /** Stable display order for sources that have no trustworthy date. */
    sequence?: number;
    /** Authored DIARY slot, distinct from the source page number. */
    authoredSlot?: number;
    unread?: boolean;
  };
  tone?: "plain" | "auspicious" | "ominous" | "notice";
  /**
   * Optional attribution: which chara this narration is about (0 = master /
   * global). Set by the night-settlement producers (ABLUP level-ups, ONANISM,
   * fall-states) so the night screen can group a day's lines into one
   * per-character block. Absent ⇒ a global line (DAYEVENT / farm / clock).
   */
  charaNum?: number;
  /** Presentation hint for authored world events that need a special image. */
  portrait?: "onanism";
  /**
   * Marks a ComfDef migration-fallback narration (`def.narration`). When the
   * command has an authored TRAIN_MESSAGE route that produced text, the
   * resolver drops these so the upstream common prose is the only narration —
   * mirroring the 411 precedent of retiring English placeholders once the
   * authored text is wired.
   * `train-message` identifies common command prose for selective L1 context;
   * it does not change the display lane or the already-settled game result.
   * `world-movement` keeps witnessed NPC arrivals/departures in AI fact context
   * even when they use the ambient display lane.
   */
  origin?: "comf-fallback" | "counter" | "train-message" | "banquet" | "mark" | "world-movement";
}

/**
 * Phase 4.5 — a character's spoken line (kojo). `charaNum` drives the
 * per-character color in the UI (0 = MASTER). In the 4.5 mock the text
 * is canned; Phase 6 `DialogueRouter` replaces the source with real
 * KOJO dispatch. This is the *rendered* line, unlike `DIALOGUE_DUE`
 * (a "a line is due" signal for the agent bus).
 */
export interface DialogueLine {
  kind: "DIALOGUE_LINE";
  timestamp: number;
  /** Whose mouth this comes from. 0 = MASTER; else chara num. */
  charaNum: number;
  /**
   * The rendered text from a kojo / event-message PRINTFORM* line.
   * Historically the UI treated every DIALOGUE_LINE as spoken text and added
   * 「」 around it, but eraTW uses PRINTFORMDW / PRINTFORMDL for plain prose
   * 地文 inside the same dispatch stream. `form` preserves that distinction.
   */
  text: string;
  /** Original ERB print form, when the line came from a parsed kojo body. */
  form?: string;
  /** Shell-only provenance marker. Authored lines omit it; AI text never
   *  changes state and remains distinguishable in UI/debug surfaces. */
  origin?: "ai" | "counter" | "mark";
  /** Validated AI continuation. A bound selection may supply narrative evidence;
   * it never enters the gameplay intent path or directly settles world effects. */
  aiChoice?: {
    /** The current story this optional response addresses; not an execution grant. */
    storyArcId?: string;
    options: Array<{
      label: string;
      lines: Array<{ text: string; form: "PRINTFORML" | "PRINTFORMDL" }>;
    }>;
  };
  /** Presentation hint; the deterministic event remains the authority. */
  portrait?: "onanism";
}

/** A committed presentation request from an authored ERB kojo path. It has no
 * text payload: the session UI consumes supported requests without rendering
 * them as dialogue or silently dropping them. */
export interface KojoHostEvent {
  kind: "KOJO_HOST_EVENT";
  timestamp: number;
  charaNum: number;
  operation: "reset-color" | "host-call";
  name?: string;
  args?: readonly number[];
  stringArgs?: readonly string[];
}

/**
 * A player-choice prompt emitted mid-flow (e.g. DAYEVENT night-event
 * branches like `ASK_YN("整理衣服起身", "把她压倒索要更多")`,
 * `ERB/fromEN/DAYEVENT.ERB:407`). Mirrors the existing B9 `PromptSpec`
 * shape (see `runtime/command/prompt.ts`) but lives in the event stream
 * because DAYEVENT is a sub-flow (not a `HandlerEntry`), so the UI
 * discovers it via the event log, not via `entry.prompt`.
 *
 * The runtime HALTS further settlement until the player answers (or
 * the front-end `resolveDayEventPrompt` action calls back into the
 * sub-flow with `answer`). `runtimeSettlement` (when set) hints that
 * the flow can resume — most prompts just need the spec rendered.
 *
 * The handler-side continuation reads `answer` and decides what state
 * writes (and what further events) to emit. The prompt itself is a pure
 * presentation concern.
 */
export interface EventPrompt {
  kind: "EVENT_PROMPT";
  timestamp: number;
  /** The chara the prompt is about (0 = master, e.g. self-prompt). */
  charaNum: number;
  /** The DAYEVENT scenario this prompt belongs to (1..13 enum). Lets
   *  the continuation map back to the right scenario branch. */
  scenario: number;
  /** The question + options the UI must render. Same shape as the B9
   *  `PromptSpec` (see `runtime/command/prompt.ts`). */
  spec: import("../runtime/command/prompt.js").PromptSpec;
  /** Filled by the UI when the player answers (so the continuation can
   *  read it without round-tripping through state). Empty until then. */
  answer?: import("../runtime/command/prompt.js").PromptAnswer;
}

/** The closed enum of `ObservationEvent.kind` values, useful for runtime guards. */
export const OBSERVATION_EVENT_KINDS = [
  "COMMAND_ISSUED",
  "STATE_DELTA",
  "TIME_TICK",
  "FLAG_CHANGED",
  "DIALOGUE_DUE",
  "STATUS_MESSAGE",
  "NARRATION",
  "DIALOGUE_LINE",
  "KOJO_HOST_EVENT",
  "EVENT_PROMPT",
] as const;

export type ObservationEventKind = (typeof OBSERVATION_EVENT_KINDS)[number];

// =====================================================================
// 2. WorldSnapshot — read-only state for agents
// =====================================================================

/**
 * What an agent can see. Always derivable from the 9 manifests plus
 * the live game state. The deterministic core publishes a fresh one
 * whenever an agent asks.
 *
 * `ReadonlyArray<...>` + `as const` is the structural guard; the
 * `validator.ts` `assertSnapshotReadonly` is the runtime guard.
 */
export interface WorldSnapshot {
  /** ms-since-epoch of when this snapshot was taken. */
  takenAt: number;

  /** Joined from `characters.json` (id, 名前, 呼び名). */
  charas: ReadonlyArray<{
    charaNum: number;
    name: string;
    callName: string;
  }>;

  /**
   * Joined from `flags.json` — IDs and names. Values are NOT
   * included; this is a structural map, not a runtime state.
   */
  flagUniverse: ReadonlyArray<{
    id: number;
    names: ReadonlyArray<string>;
  }>;

  /** Joined from `commands.json` — what the agent could possibly do. */
  commandCatalog: ReadonlyArray<{
    commandNo: number;
    kind: "COMF" | "SCOMF" | "IRAI" | "IRAI_IPPAN" | "IRAI_KOYU";
    displayName: string;
  }>;

  /** Joined from `functions.json` — what already exists in the code. */
  functionIndex: ReadonlyArray<{
    name: string;
    file: string;
    line: number;
  }>;

  /** Joined from `kojos.json` — which chara × which event has dialogue. */
  kojoMap: ReadonlyArray<{
    charaNum: number;
    variants: ReadonlyArray<{
      variantCode: string | null;
      files: ReadonlyArray<{
        topic: string;
        relPath: string;
        atFuncCount: number;
      }>;
    }>;
  }>;

  /** Joined from `event-messages.json` — the generic dispatch hub. */
  genericHandlers: ReadonlyArray<{
    relPath: string;
    category: string;
    atFuncs: ReadonlyArray<{ name: string; line: number }>;
  }>;

  /** Phase 8 WorldScheduler's territory. Stub in 2.6: `null` = unknown. */
  timeOfDay: number | null;

  /** Phase 8 WorldScheduler's territory. Stub in 2.6: `null` = unknown. */
  locationMap: ReadonlyArray<{ charaNum: number; location: string }> | null;
}

// =====================================================================
// 3. AgentIntent — what an agent wants to do
// =====================================================================

/**
 * An agent's stated intent. MUST pass `validateIntent` from
 * `validator.ts` before any settlement code looks at it.
 */
export type AgentIntent =
  | IssueCommandIntent
  | ProposeDialogueIntent
  | OverrideScheduleIntent
  | NoopIntent;

export interface IssueCommandIntent {
  kind: "ISSUE_COMMAND";
  /** chara num (0 = MASTER). Cross-ref `characters.json`. */
  actor: number;
  /** command number. Cross-ref `commands.json`. */
  commandNo: number;
  /**
   * Focused chara for target-directed commands (COMF act on a TARGET,
   * e.g. 会話/COMF300 raises 好感度 on the chara you talk *to*).
   * Omitted ⇒ the actor is the implicit target (added Phase 5D; the
   * resolver does `target: intent.target ?? intent.actor`).
   */
  target?: number;
  /**
   * Optional variant selector — equivalent to the upstream
   * `CFLAG:口上セレクタ`. The settlement pipeline (Phase 5+) reads
   * this and the static variant table from `kojos.json`.
   */
  variant?: { charaNum: number; code: string };
  /**
   * Optional B9 prompt answer (Phase 7 Wave 2c). When the target command's
   * `HandlerEntry` declares a `prompt`, the UI renders the `PromptSpec`,
   * captures the player's choice, and attaches it here. The resolver
   * forwards it to `CommandContext.promptAnswer`. See `runtime/command/prompt.ts`.
   */
  promptAnswer?: import("../runtime/command/prompt.js").PromptAnswer;
}

export interface ProposeDialogueIntent {
  kind: "PROPOSE_DIALOGUE";
  /** chara num whose mouth this comes from. */
  charaNum: number;
  /** The proposed alternative. See `DialogueCandidate` for the rules. */
  candidate: DialogueCandidate;
}

export interface OverrideScheduleIntent {
  kind: "OVERRIDE_SCHEDULE";
  charaNum: number;
  /** the proposed schedule. */
  schedule: CharacterSchedule;
}

export interface NoopIntent {
  kind: "NOOP";
  /** For the audit log — why the agent chose to do nothing. */
  reason: string;
}

export const AGENT_INTENT_KINDS = [
  "ISSUE_COMMAND",
  "PROPOSE_DIALOGUE",
  "OVERRIDE_SCHEDULE",
  "NOOP",
] as const;
export type AgentIntentKind = (typeof AGENT_INTENT_KINDS)[number];

// =====================================================================
// 4. DialogueCandidate — alternative dialogue lines an agent proposes
// =====================================================================

/**
 * Alternative dialogue lines an agent can propose. NEVER auto-applied.
 * These are *candidates*. The settlement pipeline (Phase 5+ /
 * `DialogueRouter` in Phase 6) may surface them in a side UI, or use
 * them as a hint when picking between two equally-valid deterministic
 * lines, but they do not replace the deterministic baseline.
 */
export interface DialogueCandidate {
  /** chara num. Cross-ref `kojos.json`. */
  charaNum: number;
  /**
   * The proposed alternatives. May diverge from what's actually in
   * `kojoFile` — that's the point. The settlement pipeline may
   * reject, surface, or de-prioritize them.
   */
  alternatives: ReadonlyArray<{
    /** The proposed text. */
    text: string;
    /**
     * The kojo file the agent claims drew from. The settlement
     * pipeline checks this exists in `kojos.json`. The `lineRange`
     * is advisory; with 2.3-kojo not yet parsing inside-file
     * @-func bodies, the lineRange may be `null` (= "I just
     * know this came from somewhere in that file").
     */
    kojoFile: string;
    lineRange: [number, number] | null;
  }>;
}

// =====================================================================
// 5. CharacterSchedule — a chara's schedule for one in-game day
// =====================================================================

/**
 * A chara's schedule for one in-game day. `source: 'agent'` proposals
 * are what 2.6 ships. The deterministic version (Phase 8
 * `WorldScheduler`) is the production path until then. A mixed
 * schedule (some slots deterministic, some agent-proposed) is
 * valid — the settlement pipeline merges them by startTime.
 */
export interface CharacterSchedule {
  charaNum: number;
  slots: ReadonlyArray<{
    startTime: number;
    endTime: number;
    activity: string;
    source: "deterministic" | "agent";
  }>;
}

/**
 * The runtime-side interface that lets an agent runtime hand a
 * schedule to the deterministic core. NOT implemented in 2.6 — Phase
 * 8 `WorldScheduler` will provide the production implementation.
 */
export interface CharacterScheduleProvider {
  forChara(charaNum: number, dayIndex: number): CharacterSchedule | null;
}
