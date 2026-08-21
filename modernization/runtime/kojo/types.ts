/**
 * Phase 6.3 / 神社闭环 v2 (刀一) — runtime DialogueRouter types.
 *
 * The runtime is decoupled from the parser: it loads a `KojoBundle`
 * (built by `build-reimu-kojo`) and resolves `(charaNum, commandNo,
 * state, rng) -> KojoLine[]` via a `DialogueRouter`. We MIRROR the
 * parser's tree types here so the runtime never imports the importer
 * package; the shapes must stay in lockstep with
 * `importer/kojo/parser-types.ts`.
 *
 * Why an interface (not just `StaticKojoRouter`):
 *   - A future LLM-backed or per-chara router can swap in.
 *   - Tests can pass a deterministic stub.
 *   - Phase 9 (玩法层) might want a different routing strategy per
 *     GameSystem — the interface keeps the door open.
 */

import type { Rng } from "../command/types.js";
import type { GameState } from "../state/index.js";

/** A line of dialogue the router chose. Same shape the parser
 *  produces — the runtime never has to look at the parser's types. */
export type KojoPrintForm =
  | "PRINT"
  | "PRINTW"
  | "PRINTD"
  | "PRINTDW"
  | "PRINTDL"
  | "PRINTFORM"
  | "PRINTFORMW"
  | "PRINTFORMDW"
  | "PRINTFORMDL"
  | "PRINTFORMD"
  | "PRINTFORML"
  | "PRINTL";

export interface KojoLine {
  text: string;
  form: KojoPrintForm;
  line: number;
}

export type KojoVarNs =
  | "TALENT"
  | "CFLAG"
  | "FLAG"
  | "ITEM"
  | "TFLAG"
  | "TCVAR"
  | "ABL"
  | "BASE"
  | "MAXBASE"
  | "EXP"
  | "PALAM"
  | "JUEL"
  | "CUP"
  | "CDOWN"
  | "SOURCE"
  | "EQUIP"
  | "STAIN"
  | "TEQUIP"
  | "MARK"
  | "EX"
  | "NOWEX"
  | "DOWNBASE";
/** A character variable can be indexed by a function-local numeric slot. */
export type KojoVarScope =
  | "TARGET"
  | "MASTER"
  | "GLOBAL"
  | number
  | { kind: "local"; index: number }
  | { kind: "arg"; index: number }
  | { kind: "alias"; name: string }
  | { kind: "value"; value: KojoValue };
export type KojoSubjectScope = "TARGET" | "MASTER" | number;
export type KojoCompareOp = "==" | "!=" | ">=" | "<=" | ">" | "<";
export type KojoStringValue =
  | { kind: "string"; value: string }
  | { kind: "string-local-ref"; index?: number; name?: string }
  | { kind: "string-result-ref"; index: number }
  | { kind: "character-name-string"; field: "NAME" | "CALLNAME"; subject: KojoValue }
  | { kind: "host-string"; name: string }
  | { kind: "cstr"; subject: KojoValue; key: string }
  /**
   * A literal text with embedded `%TOKEN%` and `%FUNC(args)%` placeholders.
   * Produced by the parser when the RHS of `LOCALS =` / `#DIMS =` contains
   * any `%` or `(`. Resolved at emit-time by
   * `runtime/kojo/static-router.ts::evaluateStringValue` against the
   * active host registry and a parallel real-string slot.
   */
  | { kind: "string-template"; parts: readonly StringTemplatePart[] };

/**
 * One segment of a parsed `string-template`. Mirrors the parser's
 * `StringTemplatePart` union — both sides segment identically so the
 * runtime evaluator can stay declarative.
 */
export type StringTemplatePart =
  | { kind: "literal"; text: string }
  | { kind: "callname"; scope: string }
  | { kind: "name"; scope: string }
  | { kind: "locals"; index: number }
  | { kind: "results"; index: number }
  | { kind: "string-arg"; index: number }
  | { kind: "formatter"; name: string; args: readonly string[] };
export type KojoValue =
  | { kind: "number"; value: number }
  /** A literal text with embedded `%TOKEN%` and `%FUNC(args)%` placeholders.
   *  Resolved at emit-time by `static-router.ts::evaluateStringValue`.
   *  Used as the RHS of `LOCALS = 「...」` / `#DIMS = 「...」` assignments. */
  | { kind: "string-template"; parts: readonly StringTemplatePart[] }
  /** Stub for an unknown function call. Emitted by the parser so that
   *  assignments like `LOCAL = M_KOJO_K70_UFUFU()` stay supported at the
   *  AST level; the runtime resolves the stub to `0` with a non-fatal
   *  `function-stub:<name>` diagnostic. Task #15 will replace the stub
   *  with a real implementation when the helper is registered. */
  | { kind: "function-call-stub"; name: string; args: readonly string[] }
  /** RAND whose upper bound is evaluated from the current VM frame. */
  | { kind: "dynamic_rand"; max: KojoValue }
  /** Upstream LIMIT(value, min, max), inclusive clamp. */
  | { kind: "limit"; value: KojoValue; min: KojoValue; max: KojoValue }
  /** Upstream ITEMPRICE(item), resolved from the deterministic item table. */
  | { kind: "item_price"; item: KojoValue }
  /** String locals are represented by deterministic parse-time token ids. */
  | { kind: "string_local"; index: number }
  | { kind: "named_string_local"; name: string }
  | { kind: "named_local"; name: string }
  | { kind: "named_array"; name: string; index: KojoValue }
  | { kind: "subject"; scope: "TARGET" | "MASTER" }
  | { kind: "subject_alias"; name: string }
  | { kind: "var"; ns: KojoVarNs; scope: KojoVarScope; id: number }
  | { kind: "dynamic_var"; ns: KojoVarNs; scope: KojoVarScope; id: KojoValue }
  | { kind: "arg"; index: number }
  | {
      kind: "turn";
      field: "selectCom" | "prevCom" | "result" | "local";
      index: number;
    }
  | { kind: "activity"; field: "type" | "duration"; scope: KojoVarScope }
  | { kind: "day"; index: number }
  | { kind: "time"; index: number }
  /** A `"…"` quoted string literal that survived the comparison
   *  branch's `parseValue` parse. Used by task #15 helpers (K40/K79
   *  WHERE_ABOUT / DATENAME_PLACE / etc.) that return label strings
   *  compared against a literal in `WHERE_ABOUT() == "室外"`-shape
   *  predicates. Numeric compare value is always 0; the `compare`
   *  predicate branch reads `text` for string equality. */
  | { kind: "string_literal"; value: string }
  /** The string-valued ARGS/ARGS:N binding used by authored check hooks. */
  | { kind: "string_arg"; index: number }
  | { kind: "state"; field: "money" | "main_map" | "casino_chips" }
  | { kind: "room_owner" }
  | { kind: "line-count" }
  | { kind: "diary_max_page"; subject: KojoValue }
  | { kind: "diary_flag"; subject: KojoValue; page: KojoValue }
  | { kind: "diary_page_set"; subject: KojoValue; slot: KojoValue }
  | { kind: "host_array"; name: string; indices: KojoValue[] }
  /** String-valued CHARADATA/SAVEDATA array, e.g. CHILD_ACT. */
  | { kind: "host_string_array"; name: string; indices: KojoValue[] }
  | { kind: "room_data"; room: KojoValue }
  | { kind: "character_name"; field: "NAME" | "CALLNAME"; subject: KojoValue }
  | { kind: "dish_type" }
  | { kind: "dish_name" }
  | { kind: "dish_number"; field: "drg" | "drg2" | "assi" | "basepoint" | "time" }
  | { kind: "string_count"; source: KojoStringValue; pattern: KojoStringValue }
  | { kind: "string_find"; source: KojoStringValue; pattern: KojoStringValue }
  /** Upstream INRANGE(value, min, max), inclusive at both ends. */
  | { kind: "in_range"; value: KojoValue; min: KojoValue; max: KojoValue }
  /** Upstream YOUBI_MATCH(DAY, "月水"). */
  | { kind: "youbi_match"; day: KojoValue; weekdays: string }
  | { kind: "weekday_test"; day: KojoValue; weekend: boolean }
  /** Upstream GET_UWAKI_HISTORY(witness, partner). */
  | { kind: "uwaki_history"; witness: KojoValue; partner: KojoValue }
  | { kind: "abs"; value: KojoValue }
  /** Upstream numeric MIN/MAX functions. */
  | { kind: "minmax"; op: "min" | "max"; values: KojoValue[] }
  | { kind: "soaked_or_not"; mode: "V_SEMINAL" | "A_SEMINAL" | "SECRETIONAL"; subject: KojoValue }
  | { kind: "fishing_size"; fishId: KojoValue }
  | { kind: "fish_exp"; fishId: KojoValue }
  | { kind: "fishsize_record"; fishId: KojoValue }
  /** Upstream EXP_UP(expId, subject): current EXP minus the command-local
   * TCVAR 400+expId baseline. */
  | { kind: "exp_up"; expId: KojoValue; subject: KojoValue }
  /** Non-MAGIC-DLC `妊娠可否(subject)` fertility eligibility. */
  | { kind: "pregnancy_possible"; subject: KojoValue }
  | { kind: "conditional"; condition: KojoPredicate; whenTrue: KojoValue; whenFalse: KojoValue }
  | {
      kind: "k120_helper";
      helper: "insemination_possible" | "dangerous_days" | "ending_possible";
    }
  | { kind: "k60_attitude"; argument?: KojoValue }
  | { kind: "k49_relationship"; subject?: KojoValue }
  | { kind: "find_around"; speaker: number; acquaintances: readonly number[] }
  | { kind: "find_lover"; speaker: number }
  | { kind: "be_seen"; speaker: number }
  | { kind: "form_k113" }
  /** Source-backed common ERB helpers shared by authored static kojo. */
  | { kind: "nemuke" }
  | { kind: "lover_count" }
  | { kind: "get_month"; season?: KojoValue }
  | { kind: "moon_watch"; date: KojoValue; ignoreLocation?: KojoValue }
  | { kind: "name_moon"; date: KojoValue }
  | { kind: "date_name"; field: "place" | "spot"; untranslated?: KojoValue }
  | { kind: "cmatch"; ns: KojoVarNs; id: number; expected: KojoValue }
  | { kind: "taste_reaction"; tag: string }
  | { kind: "k17_master_alice_child" }
  | { kind: "k60_has_fucked_parsee" }
  | {
      kind: "k70_helper";
      helper: "fukigen" | "sadistic" | "ufufu" | "balance";
      subjects: KojoValue[];
    }
  | { kind: "k83_helper"; helper: "fukigen" | "yoidore" | "ufufu"; subject: KojoValue }
  | {
      kind: "authored_state_helper";
      name: "stellaris_falldown_k98" | "k78_excessive_stature_gap" | "k78_basic_condition_in_mating" |
        "k111_fukigen" | "k111_junko_kurashi" | "moon_watch_point" | "k17_grt" |
        "k70_suzunaan" | "get_map_replacement";
      args: KojoValue[];
    }
  | { kind: "where_about" }
  | {
      kind: "k15_helper";
      helper: "likes_player" | "hate" | "player_is_sdm_resident" | "player_in_sdm" | "lover_love" | "lust";
      argument?: KojoValue;
    }
  /** Source `IFRAND(value-spec, condition, ...)`: enabled specs form a
   * weighted candidate bag, with optional D-prefixed removals. */
  | {
      kind: "ifrand";
      groups: Array<{ spec: string; condition: KojoPredicate }>;
    }
  | { kind: "palam_level"; level: number }
  | { kind: "rand"; max: number }
  | { kind: "get_bit"; value: KojoValue; bit: KojoValue }
  | { kind: "map_id"; value: KojoValue }
  | { kind: "omaneki_beya" }
  | { kind: "in_room_number"; room: KojoValue }
  | { kind: "road_to"; mapId: KojoValue }
  | { kind: "open_place"; scope: KojoSubjectScope }
  | { kind: "get_charahome"; subject: KojoValue }
  | { kind: "yogore"; room: KojoValue }
  | { kind: "cannot_danmaku" }
  | { kind: "k30_check_hen_t" }
  | { kind: "k30_drunk" }
  | { kind: "k15_hate_anger" }
  /** Ruukoto's source-backed private helper family. The optional ERB ARG
   * defaults to TARGET when omitted or zero. */
  | {
      kind: "k2_helper";
      helper: "excessive_stature_gap" | "basic_condition_in_mating" | "sexual_frankness";
      subject: KojoValue;
    }
  | { kind: "estrus_cycle"; subject: KojoValue }
  | { kind: "is_drunk"; subject: KojoValue }
  | { kind: "alcohol_taste"; item: KojoValue }
  | { kind: "shirahu"; subject: KojoValue }
  /** `OTOKOGIRAI(subject)` — preference/gender compatibility helper. */
  | { kind: "otoko_girai"; subject: KojoValue }
  | { kind: "has_penis"; subject: KojoValue }
  | { kind: "gender_test"; test: "male" | "female" | "futa" | "vagina"; subject: KojoValue }
  | { kind: "same_sex"; left: KojoValue; right: KojoValue }
  | { kind: "virgin_test"; test: "virgin" | "doutei"; subject: KojoValue }
  | { kind: "fallen"; subject: KojoValue }
  | { kind: "angry"; subject: KojoValue }
  | { kind: "in_heat"; subject: KojoValue }
  | { kind: "is_lover"; subject: KojoValue }
  | { kind: "is_dating_with_player"; subject: KojoValue }
  | { kind: "is_sexing"; subject: KojoValue }
  | { kind: "is_master"; subjects: KojoValue[] }
  | { kind: "weather_test"; test: "bad_weather" | "storm" }
  | { kind: "is_nonhuman"; subject: KojoValue }
  | { kind: "is_library"; place: KojoValue; permission: KojoValue }
  | { kind: "is_standing_sex"; command: KojoValue }
  | { kind: "erect"; subject: KojoValue }
  | { kind: "working"; subject: KojoValue }
  | { kind: "is_here"; subjects: KojoValue[] }
  | { kind: "group_match"; value: KojoValue; candidates: KojoValue[] }
  | { kind: "in_room"; scope: KojoSubjectScope }
  | {
      kind: "location_test";
      test: "bath" | "bathroom" | "bedroom" | "out_roof" | "in_home";
      scope: KojoSubjectScope;
    }
  | { kind: "at_home"; subject: KojoValue }
  | { kind: "date_now"; mapId: KojoValue }
  | { kind: "target_count" }
  /** Upstream CHARANUM, normalized to the highest valid character id. */
  | { kind: "chara_count" }
  | {
      kind: "relationship_state";
      flavor: "fall" | "emotion";
      subject: KojoValue;
    }
  | {
      kind: "fill_rate";
      scope: KojoSubjectScope;
      bodyPart: 1 | 2 | 3 | 4 | 5;
      cumulative: boolean;
    }
  | { kind: "add"; parts: KojoValue[] }
  | { kind: "binary"; op: "&" | "|" | "*" | "/" | "%" | "-"; left: KojoValue; right: KojoValue };

export interface KojoEffectTarget {
  /** State namespaces committed by the authored-kojo transaction. SOURCE
   * and NOWEX are frame-local and never become persisted character bags. */
  ns: "CFLAG" | "TFLAG" | "TCVAR" | "EXP" | "MARK" | "ABL" | "TALENT" | "BASE" | "MAXBASE" | "DOWNBASE" | "PALAM" | "FLAG" | "MONEY" | "ITEM" | "JUEL" | "EX" | "EQUIP" | "STAIN" | "TEQUIP" | "CUP" | "CDOWN" | "SOURCE" | "NOWEX" | "TIME" | "DIARY" | "MAX_DIARY_PAGE" | "PAGESET";
  scope: KojoVarScope;
  id: number;
}

export interface KojoStringEffectTarget {
  ns: "CSTR" | "NICKNAME";
  scope: KojoVarScope;
  id: number;
}

export type KojoEffect =
  | { kind: "set"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "add"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "or"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "and"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "multiply"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "divide"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "mod"; target: KojoEffectTarget; value: KojoValue; line: number }
  | { kind: "set-bit"; target: KojoEffectTarget; bit: KojoValue; line: number }
  | { kind: "clear-bit"; target: KojoEffectTarget; bit: KojoValue; line: number }
  | { kind: "display-name"; observer: number; subject: number; value: string | KojoStringValue; line: number }
  | { kind: "string-set"; target: KojoStringEffectTarget; value: KojoStringValue; line: number }
  | { kind: "fish-ledger"; field: "count" | "record"; fishId: KojoValue; op: "set" | "add"; value: KojoValue; line: number };

export type KojoStagedEffect =
  | {
      kind: "set" | "add" | "or" | "and" | "multiply" | "divide" | "mod" | "set-bit" | "clear-bit";
      target: KojoEffectTarget;
      value: number;
      line: number;
    }
  | { kind: "memory"; memory: "FIRSTTIME" | "ONCE"; charaNum: number; key: string }
  /** An authored observer's display name for a subject, e.g.
   * `MASTERNAME:42` means character 42's name for MASTER. */
  | { kind: "display-name"; observer: number; subject: number; value: string; line: number }
  | { kind: "string-set"; target: KojoStringEffectTarget; value: string; line: number }
  | { kind: "fish-ledger"; field: "count" | "record"; fishId: number; op: "set" | "add"; value: number; line: number }
  /** Set a per-target `DOUBLE_MESSAGE_BLOCKED` bit in the active command
   * frame's `doubleMessageBlockedByChara` map. Persisted effects are
   * committed via `applyKojoEffects`; the field is intentionally absent
   * from the save envelope so the bit is frame-local (it is rebuilt on
   * every command by `beginKojoExecutionFrame`). */
  | { kind: "frame-double-message-bit"; target: number; bit: number; line?: number };

/** Predicate guarding an IF arm (mirror of the importer's type). */
export type KojoPredicate =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "var_nonzero"; ns: KojoVarNs; scope: KojoVarScope; id: number }
  | { kind: "var_eq"; ns: KojoVarNs; scope: KojoVarScope; id: number; value: number }
  | { kind: "rand_nonzero"; max: number }
  | { kind: "rand_eq"; max: number; value: number }
  | { kind: "arg_nonzero"; index: number }
  | { kind: "arg_eq"; index: number; value: number }
  | { kind: "truthy"; value: KojoValue }
  | {
      kind: "alcohol_face_compare";
      subject: KojoValue;
      op: "==" | "!=";
      expected: "清醒" | "微醺" | "醉酒" | "不省人事";
    }
  /** String comparison against ARGS/ARGS:N; numeric ARG remains arg_eq. */
  | { kind: "string_arg_compare"; index: number; op: "==" | "!="; expected: string }
  | { kind: "festival_compare"; op: "==" | "!="; expected: string }
  | {
      kind: "memory_first";
      memory: "FIRSTTIME" | "ONCE";
      key: string;
      /** Safe numeric event-key expression, when the source does not use a string literal. */
      keyValue?: KojoValue;
      /** False when upstream ARG requests a read-only first-time check. */
      update?: boolean;
      /** Upstream ARG:1 memory owner; omitted legacy nodes mean TARGET. */
      scope?: KojoSubjectScope;
    }
  | { kind: "compare"; left: KojoValue; op: KojoCompareOp; right: KojoValue }
  | { kind: "not"; inner: KojoPredicate }
  | { kind: "and"; parts: KojoPredicate[] }
  | { kind: "or"; parts: KojoPredicate[] }
  /**
   * Variable reference with a non-numeric identifier that the modern
   * symbol table cannot resolve. Runtime treats it as `false` without
   * emitting a diagnostic so the route stays supported.
   */
  | {
      kind: "unknown_var_nonzero";
      ns: KojoVarNs;
      scope: string;
      id: string;
    }
  /**
   * `NAME(args...)` function call predicate. Parser recognises unknown
   * function-call shapes as structured nodes (task #3) instead of
   * falling through to `kind:"unknown"`. Runtime calls
   * `evaluateFunctionCallPredicate`; if a registry implementation exists
   * (task #15) it runs that, otherwise returns `false` with a non-fatal
   * `unknown-function:<name>` diagnostic. The route stays supported.
   */
  | { kind: "function-call"; name: string; args: readonly string[] }
  /**
   * A bare-identifier comparison (task #4). Captures `MODE == "指令"`,
   * `NAME:MASTER != "你"`, `iRT >= K17C_恋慕`, `前面指令 == "V挿入"`,
   * `DISH_TYPE == "甜点"`, `CALLNAME:MASTER != "你"`, `LOCALS == ""`,
   * etc. — predicates whose LHS and/or RHS the modern symbol table
   * cannot resolve as a typed `var` / `arg` / `rand` reference. Mirrors
   * the parser-side `KojoPredicate` member added in parser-types.ts.
   *
   * Runtime evaluates this best-effort: each side resolves through the
   * same `systemVarAccessor` table (MODE → current menu phase, LOCALS →
   * resolved string mirror, etc.). When a side has no binding the
   * whole comparison returns `false` without an `unsupported`
   * diagnostic, so the route stays supported and the ELSE arm fires.
   */
  | {
      kind: "system_var_compare";
      left: string;
      op: "==" | "!=" | ">=" | "<=" | ">" | "<";
      right: string;
    }
  | { kind: "unknown"; raw: string };

export interface KojoArm {
  predicate: KojoPredicate;
  body: KojoNode;
}

/** The nested AST of a kojo @-func body (mirror of the importer type). */
export type KojoNode =
  | { type: "lines"; lines: KojoLine[] }
  | { type: "seq"; children: KojoNode[] }
  | { type: "if"; arms: KojoArm[] }
  | { type: "rand"; cases: KojoNode[] }
  | { type: "select"; selector: KojoValue; cases: KojoSelectCase[]; defaultCase: KojoNode | null; line: number }
  | { type: "choice"; options: KojoChoiceOption[]; line: number }
  | { type: "input"; inputMode: "number" | "string"; values?: readonly (number | string)[]; options: KojoInputOption[]; line: number }
  | { type: "for"; target: KojoLocalTarget; start: KojoValue; end: KojoValue; step: KojoValue; body: KojoNode; line: number }
  | { type: "repeat"; count: KojoValue; body: KojoNode; line: number }
  | { type: "while"; predicate: KojoPredicate; body: KojoNode; line: number; doWhile?: boolean }
  | { type: "break" }
  | { type: "continue" }
  | { type: "local-set"; target: KojoLocalTarget; op: "set" | "add" | "divide"; value: KojoValue; line: number }
  | { type: "result-set"; index: number; op: "set" | "add"; value: KojoValue; line: number }
  | { type: "return"; value: KojoValue; line: number }
  /** Static lowering of the upstream CHARA_DIARY_PAGESETTING helper. */
  | { type: "diary-page-setting"; chara: KojoValue; page: KojoValue; line: number }
  | { type: "effect"; effect: KojoEffect }
  | { type: "unsupported-effect"; raw: string; line: number; reason: string };

export type KojoLocalTarget =
  | { kind: "slot"; index: number }
  | { kind: "named"; name: string }
  | { kind: "named-index"; name: string; index: KojoValue }
  | { kind: "string-slot"; index: number }
  | { kind: "named-string"; name: string };

/** One selectable option of a `choice` node (mirror of the importer type).
 *  `value` = the `PRINTBUTTON` value its `CASE "value"` branches on;
 *  `label` is shown to the player; `body` is emitted when picked. */
export interface KojoChoiceOption {
  label: string;
  value: string;
  body: KojoNode;
}

/** How a single `input` option matches the post-INPUT `RESULT`. Either a
 *  truthy check (`IF RESULT`, where any non-zero RESULT wins) or an
 *  equality check (`IF RESULT == N`). Mirror of the importer type. */
export type KojoInputMatcher =
  | { kind: "truthy" }
  | { kind: "equals"; value: number };

/** One selectable option of an `input` node. The `matcher` records which
 *  RESULT value this branch consumes; `label` is shown to the player;
 *  `value` is the optional authored numeric/string pick; `body` is
 *  emitted when picked. An ELSE arm carries no matcher — it is the
 *  fall-through branch when no other arm matches the actual RESULT.
 *  Mirror of the importer type. */
export interface KojoInputOption {
  label: string;
  value?: string;
  matcher?: KojoInputMatcher;
  body: KojoNode;
}

export interface KojoSelectCase {
  values: number[] | null;
  ranges: KojoSelectRange[];
  raw: string;
  body: KojoNode;
}

export interface KojoSelectRange {
  min: number | null;
  max: number | null;
  minInclusive: boolean;
  maxInclusive: boolean;
}

/** A paused mid-kojo choice: the interactive router returns this when it
 *  reaches a `choice` node with no pre-supplied pick. The UI renders
 *  `options[].label` and re-invokes with the chosen index appended. */
export interface PendingKojoChoice {
  options: { label: string }[];
  /** VM INPUT values are not necessarily zero-based UI option indexes. */
  values?: readonly (number | string)[];
  /** A VM INPUT without PRINTBUTTONs requires a direct, session-owned value. */
  inputMode?: "number" | "string";
  /** Source line of the `SELECTCASE` (for diagnostics/stable keys). */
  line: number;
}

export type KojoResolutionStatus =
  | "not-authored"
  | "resolved"
  | "partial"
  | "gated"
  | "unsupported";

export interface KojoDiagnostic {
  code: "unsupported-predicate" | "unsupported-effect" | "unresolved-text";
  detail: string;
  line?: number;
}

/** A presentation-side request selected by a resolved authored path. It is
 * data, rather than an imperative UI operation, so its consumer remains the
 * owner/session-aware dialogue layer. */
export type KojoHostEvent =
  | { kind: "reset-color" }
  | {
    kind: "host-call";
    name: string;
    args: readonly number[];
    stringArgs: readonly string[];
  };

export interface KojoResolution {
  status: KojoResolutionStatus;
  lines: KojoLine[];
  /** Authored function RETURN when this resolution directly owns a function
   * body. Routers that combine or synthesize results may leave it absent. */
  returnValue?: number;
  /** Effects selected by this path but not yet applied to GameState. */
  effects: KojoStagedEffect[];
  /** Raw predicates that could not be evaluated faithfully. */
  unsupportedPredicates: string[];
  /** Authored writes/calls outside the approved effect subset. */
  unsupportedEffects: string[];
  /** Structured reasons for a partial or terminal unsupported result. */
  diagnostics: KojoDiagnostic[];
  /** Committed presentation requests. Unsupported paths never expose them. */
  hostEvents?: readonly KojoHostEvent[];
}

export interface KojoFunctionResolution extends KojoResolution {
  /** Bare `RESULT` returned by the function. Missing RETURN defaults to 0. */
  returnValue: number;
  /** Authored RESULT:N assignments selected by the resolved control path. */
  resultSlots: Record<number, number>;
}

export interface InteractiveKojoResolution {
  status: KojoResolutionStatus;
  lines: KojoLine[];
  pending: PendingKojoChoice | null;
  effects: KojoStagedEffect[];
  unsupportedPredicates: string[];
  unsupportedEffects: string[];
  diagnostics: KojoDiagnostic[];
  /** Presentation requests accumulated before/after an interactive choice. */
  hostEvents?: readonly KojoHostEvent[];
}

/** A non-replayable VM pause exposed to the session layer. `continuationId`
 * is an opaque, in-memory token owned by one DialogueSession; it must never
 * be persisted in GameState or reused by another owner. */
export interface KojoContinuationResolution {
  resolution: KojoResolution;
  pending: PendingKojoChoice | null;
  continuationId?: string;
}

export interface DiaryHappenResolution {
  fired: boolean;
  resultSlot1: 0 | 1 | 2 | 3;
  resultSlot2: 0 | 1;
  /** State effects selected before the RETURN on the supported path. */
  effects?: KojoStagedEffect[];
  status?: KojoResolutionStatus;
  diagnostics?: KojoDiagnostic[];
}

/** Function-level hooks dispatched by the upstream CHARA_DIARY lifecycle. */
export type DiaryHookKind = "exist" | "before-check" | "after-check";

export interface ParsedKojoFunc {
  name: string;
  declLine: number;
  body: KojoNode;
}

export interface BundleEntry {
  body: ParsedKojoFunc | null;
  dispatcher: ParsedKojoFunc | null;
  found: boolean;
}

/** The committed bundle shape for ONE (chara, variant) — matches the
 *  legacy `kojo-reimu-bundle.json`. Kept for backward compatibility
 *  with existing tests; new code should use `KojoCommandIndex` + `KojoCache`.
 *
 *  @deprecated Phase 6A — replaced by `KojoCommandIndex` for per-command
 *  lazy loading. Will be removed in Phase 7. */
export interface KojoBundle {
  generatedAt: string;
  sourceFile: string;
  charaNum: number;
  /** "" = default variant; "1"/"2"/"3" = the `CFLAG:口上セレクタ` value. */
  variantCode: string;
  /** Human label of the variant (e.g. "霊夢" / "灵梦-少女之梦"). */
  variantLabel?: string;
  display: { callerName: string; calleeName: string; calleeCharaNum: number };
  byCommand: Record<number, BundleEntry>;
  /** Per-(chara,variant) catch-all `..._COM_K{n}_00` — the 2nd fallback
   *  level when a specific command body is missing. */
  catchAll?: ParsedKojoFunc | null;
  stats: { targetCommandNos: number[]; parsed: number; hit: number; unparseable: string[] };
}

// ── Phase 6A: index types for lazy on-demand kojo loading ──────────

/** One @-func's location in an ERB file (for offset-based reading). */
export interface FuncLocation {
  /** Path relative to the eraTW project root. */
  filePath: string;
  /** Full @-func name, e.g. `@M_KOJO_MESSAGE_COM_K1_300_1`. */
  funcName: string;
  /** 1-based line number of the `@FUNC` declaration. */
  lineStart: number;
  /** 1-based line number of the next `@` or EOF (exclusive). */
  lineEnd: number;
  /** COM type: "COM" | "SCOM" | "CUSTOM_COM" | "CUSTOM_SCOM". */
  comType: string;
}

/** One string-selected scene branch inside a commission (`IRAI`) function.
 * The enclosing function is selected by the commission name/local id, then
 * upstream `SELECTCASE ROLE` and `SELECTCASE SCENE` select this exact body.
 * The branch bounds are 1-based; `sceneLineEnd` is the CASE/ENDSELECT line
 * immediately after the branch and is therefore exclusive. */
export interface IraiSceneLocation extends FuncLocation {
  sceneLineStart: number;
  sceneLineEnd: number;
}

/** One variant's command→func mappings for a given character. */
export interface VariantIndex {
  /** "" = default (selector 0), "1".."4" = `CFLAG:口上セレクタ` value.
   *  This is the NUMERIC variant-selector index, derived authoritatively
   *  from the dispatch func name `@M_KOJO_K{n}_{i}` (UpdateMenus.ERB
   *  UPDATE_PAGE_2 `TRYCALLFORM M_KOJO_K{n}_{i}`), NOT from the file name. */
  variantCode: string;
  /** Variant label = `RESULTS:1` set in the dispatch func body (e.g.
   *  "《少女之梦》版"). "初始" for a default variant that sets no RESULTS:1. */
  label: string;
  /** Variant description = `RESULTS:2` set in the dispatch func body. */
  description: string;
  /** The RESULTS suffix (name infix) this variant injects into its body
   *  @-func names, e.g. "" (default) or "_少女之梦". This is the `RESULTS`
   *  (slot 0) value set in the dispatch func body — the key that routes
   *  command/event funcs `@M_KOJO{suffix}_MESSAGE_..._K{n}_...`. Decoupled
   *  from `variantCode` (the numeric selector). */
  resultsSuffix: string;
  /** Files scanned to build this index (relative paths). */
  files: string[];
  /** Command key → func location. Key format: "COM:300" or "SCOM:60". */
  commands: Record<string, FuncLocation>;
  /** Catch-all `_00` func location, if any. */
  catchAll?: FuncLocation;
  /** EVENT-arm kojo funcs (`M_KOJO[_suffix]_EVENT_K{n}_{arm}`), keyed
   *  `"EVENT:{arm}"`. arm 1=encounter, 2=おはよう(morning), 3=おやすみ
   *  (night). Dispatched upstream by `KOJO_MESSAGE_SEND("EVENT",arm,...)`.
   *  Phase 8 朝夜挨拶 — the scheduler fires arm 2/3 on sleep↔wake. */
  events?: Record<string, FuncLocation>;
  /** SP_EVENT kojo funcs (`M_KOJO[_suffix]_SPEVENT_K{n}_{subid}`), keyed
   *  `"SP_EVENT:{subid}"`. Dispatched upstream by
   *  `KOJO_MESSAGE_SEND("SP_EVENT", subid, target, …)` →
   *  `M_KOJO{suffix}_SPEVENT_K{n}_{subid}(ARG:3,ARG:4)` (KOJO_MESSAGE.ERB:99).
   *  subid = DAYEVENT scenario enum (1..13). DAYEVENT slice. */
  spEvents?: Record<string, FuncLocation>;
  /** Authored `DAYEVENT_COND` return hook for this character/variant. */
  dayEventCondition?: FuncLocation;
  /** Authored `IRAI_BLOCKED` return hook for this character/variant. */
  iraiBlocked?: FuncLocation;
  /** First-meeting (初対面) greeting func (`M_KOJO[_suffix]_ENCOUNTER_K{n}`).
   *  Dispatched upstream by `KOJO_MESSAGE_SEND("ENCOUNTER",0,C_ID,1,0)` →
   *  `M_KOJO%RESULTS%_ENCOUNTER_K{n}` (KOJO_MESSAGE.ERB:63), played once from
   *  `@SYOTAIMEN` when `CFLAG:面識 == 0`. One func per variant, no arm. */
  encounter?: FuncLocation;
  /** Private-room description func (`@K{n}{infix}_ROOM_DESCRIPTION`, no
   *  M_KOJO prefix). Dispatched upstream by `@情景描写` →
   *  `TRYCCALLFORM K{NO:KROOM_DESC}%RESULTS%_ROOM_DESCRIPTION`
   *  (ANOTHER_TALK.ERB:1023) when the player is inside the chara's own room.
   *  The body builds the room's ambient description in `LOCALS`. */
  roomDescription?: FuncLocation;
  /** MARK acquisition personal kojo (`M_KOJO[_suffix]_MESSAGE_MARKCNG_K{n}`).
   *  The selected acquired level is bound through `TFLAG:反発刻印取得`. */
  mark?: FuncLocation;
  /** Author setup hook fired from the shop UPDATE menu. Upstream:
   *  `qol_update.ERB@UPDATE_OF_KOJO_ORIGIN` walks all TARGETs and calls
   *  `M_KOJO%RESULTS%_UPDATE_K{LOCAL}` via TRYCALLFORM. The body is usually
   *  guarded by a `CFLAG:VERSION` check so it fires once per save. */
  update?: FuncLocation;
  /** COUNTER reaction bodies keyed by upstream `TCVAR:20` action id. The
   *  index resolves a pure CALL wrapper to its direct `_1` body when present,
   *  so callers receive authored personal dialogue without emulating CALL. */
  counters?: Record<number, FuncLocation>;
  /** PALAM reaction bodies keyed by source-verified `phase:detail`. A/A2
   *  detail strings remain verbatim (`A:00` and `A:0` are distinct); B/B2/C/
   *  D/E/F use an empty detail (`B:`). */
  palams?: Record<string, FuncLocation>;
  /** Commission dialogue branches. First key is the source function selector
   * (`id:<localId>` or `name:<commissionName>`), followed by the upstream
   * role (`CLIENT`/`TARGET`/`NO_REPORT`) and exact scene string. */
  irai?: Record<string, Record<string, Record<string, IraiSceneLocation>>>;
  /** Diary (日記) personal-kojo slice. Upstream `KOJO_MESSAGE_SEND("DIARY",chara,...)` →
   *  `TRYCALLFORM DIARY%RESULTS%_K{n}_EXIST` (gate) → `CALLFORM
   *  DIARY%RESULTS%_TEXT_K{n}(ARG:3, ARGS:2, ARG:4)` (text). Faithful to
   *  COMF406 日記を読む.ERB → CHARA_DIARY_COM dispatch.
   *  - `diaryExist`: the EXIST gate func (returns non-zero RESULT → has diary)
   *  - `diaryText`: TEXT funcs keyed by page number (1-based; missing page → no
   *    diary text). TEXT func takes (ARG:int, ARGS:string, ARG:int).
   *  - `diaryBeforeCheck` / `diaryAfterCheck`: optional before/after hooks
   *    that upstream calls separately (rare; preserved for faithfulness). */
  diaryExist?: FuncLocation;
  diaryText?: Record<number, FuncLocation>;
  diaryBeforeCheck?: FuncLocation;
  diaryAfterCheck?: FuncLocation;
  /** Per-page HAPPEN triggers (pageNum → func loc). BEFORE_CHECK iterates
   *  pages 1..MAX and TRYCALLs each `_HAPPEN` to decide if that page
   *  should be queued (RESULT:1=2 auto, =3 player-only, RESULT:2=1 repeat).
   *  Faithful to 灵梦 M_KOJO_K1_2_日記（簡易版）.ERB:12-26. */
  diaryHappens?: Record<number, FuncLocation>;
}

/** Global generic dialogue fallback (from EVENT_MESSAGE_COM*.ERB). */
export interface EventMsgIndex {
  filePath: string;
  funcName: string;
  lineStart: number;
  lineEnd: number;
}

/**
 * The lightweight build artifact (`kojo-index.json`): maps every
 * (chara, variant, command) to the ERB file offset where its @-func
 * body lives. ~50-150KB, built once, loaded at boot by `KojoCache`.
 */
export interface KojoCommandIndex {
  generatedAt: string;
  projectRoot: string;
  charaNums: number[];
  variants: Record<number, VariantIndex[]>;
  eventMessages: Record<number, EventMsgIndex>;
}

/** Source phases dispatched by `KOJO_MESSAGE_SEND("PALAM", ...)`. */
export type PalamKojoKind = "A" | "A2" | "B" | "B2" | "C" | "D" | "E" | "F";

/** The single point of contact handlers use to ask for chara reaction. */
export interface DialogueRouter {
  /**
   * Return the lines a chara would say in response to a command, emitted
   * in source order. Empty array = no reaction (unknown chara, no bundle
   * loaded, no matching path).
   *
   * `state` is the post-settlement `GameState`; the router reads
   * TALENT/CFLAG/FLAG predicates off it. `rng` is a per-(command, clock)
   * seeded RNG for deterministic `SELECTCASE RAND:N` selection.
   */
  collect(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];

  /**
   * Diagnostic command resolution. Unlike `collect()`, this distinguishes
   * missing authored content from a gated branch and an unsupported
   * predicate. AI fallback must only use `not-authored`.
   */
  collectDetailed?(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution;

  collectInteractive?(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** VM-only interactive path. Unlike collectInteractive this retains the
   * real ERB stack and must not be resumed via deterministic replay. */
  collectContinuation?(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoContinuationResolution;

  resumeContinuation?(
    continuationId: string,
    value: number | string,
  ): KojoContinuationResolution;

  cancelContinuation?(continuationId: string): void;

  /**
   * Return the lines a chara says for an EVENT-arm kojo
   * (`M_KOJO[_suffix]_EVENT_K{n}_{arm}`), the 朝/夜挨拶 personal dialogue.
   * `arm`: 1=encounter, 2=おはよう(morning), 3=おやすみ(night). Empty array
   * = no personal kojo for that arm, or the body couldn't be resolved
   * (e.g. a `LOCAL:1 = 0` 记入チェック gate disabled every branch).
   *
   * `args` — the `ARG` sub-id bindings passed by upstream's
   * `KOJO_MESSAGE_SEND("EVENT", arm, chara, ARG:3, ARG:4)`: `args[0]` =
   * ARG:3, `args[1]` = ARG:4. The arm-2/3 bodies branch on these
   * (e.g. reimu's `IF ARG == 2` 眠そう arm-3 branch). The caller picks the
   * faithful value — arm 2 master-wake passes 起床状况 (1=非同居/2=同居),
   * arm 3 bed-down passes おやすみ口上 (2=同床). Unbound → 0.
   *
   * Phase 8 朝夜挨拶 — the sleep handler (402) fires arm 3 at bed-down and
   * arm 2 on wake for the 陪睡中 companion. NPC-schedule-driven greetings
   * (each villager's own SLEEP.ERB cycle) stay deferred.
   */
  resolveEventKojo(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoLine[];

  resolveEventKojoDetailed?(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoResolution;

  resolveEventKojoInteractive?(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** VM-only EVENT continuation. This retains the dispatcher stack and must
   * not be substituted with the replay-oriented interactive route. */
  resolveEventKojoContinuation?(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: readonly number[],
  ): KojoContinuationResolution;

  /**
   * Return the lines a chara says for an SP_EVENT kojo
   * (`M_KOJO[_suffix]_SPEVENT_K{n}_{subid}`), the DAYEVENT subevent personal
   * dialogue. `subid` = the DAYEVENT scenario enum (1..13: day lewd 1-3,
   * day normal 4-8, night lewd 9-10, night normal 11-13). Empty array = no
   * personal kojo for that subid, or the body couldn't be resolved.
   *
   * Upstream category arms (KOJO_MESSAGE.ERB docs): arm 4=昼淫 / 5=昼普 /
   * 6=夜淫 / 7=夜普 — but the dispatch func name carries only `subid`
   * (`ARG:1`), so this method keys on subid, not arm.
   *
   * `args` — `ARG:3`/`ARG:4` bindings from
   * `KOJO_MESSAGE_SEND("SP_EVENT", subid, target, ARG:3, ARG:4)`: `args[0]`
   * = ARG:3, `args[1]` = ARG:4 (per-scenario sub-ids). Unbound → 0.
   *
   * DAYEVENT slice — the night/morning subevent executor fires this for the
   * selected target+scenario.
   */
  resolveSpEventKojo(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoLine[];

  resolveSpEventKojoDetailed?(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoResolution;

  resolveSpEventKojoInteractive?(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** VM-only SP_EVENT continuation, preserving the original dispatcher. */
  resolveSpEventKojoContinuation?(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: readonly number[],
  ): KojoContinuationResolution;

  /**
   * Evaluate the authored `M_KOJO[_variant]_CHECK_K{n}_DAYEVENT_COND` hook.
   * `scenario` is passed as numeric `ARG`; `type` is the string `ARGS` value
   * (`"day"`/`"night"`). The returned function resolution preserves the
   * upstream `RETURN -1/0/1/2` value and fail-closed diagnostics.
   */
  resolveDayEventCondition?(
    charaNum: number,
    type: "day" | "night",
    scenario: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution;

  /**
   * Evaluate the authored `M_KOJO[_variant]_CHECK_K{n}_IRAI_BLOCKED` hook.
   * `localId` is the upstream request number passed as bare `ARG`.
   * Return value 1 blocks generation; 0 allows it. Unsupported authored
   * logic fails closed and therefore also blocks generation.
   */
  resolveIraiBlocked?(
    charaNum: number,
    localId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution;

  /**
   * Return the first-meeting (初対面) greeting lines a chara says the first
   * time master meets them (`M_KOJO[_suffix]_ENCOUNTER_K{n}`). Dispatched
   * upstream by `KOJO_MESSAGE_SEND("ENCOUNTER",0,C_ID,1,0)` from `@SYOTAIMEN`
   * when `CFLAG:面識 == 0`. Empty array = no ENCOUNTER kojo for this chara,
   * disabled kojo, or the body could not be resolved. Optional so legacy test
   * routers do not need to implement it until they exercise first-meeting.
   */
  resolveEncounterKojo?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];

  resolveEncounterKojoDetailed?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution;

  /**
   * Personal private-room description (`@K{n}{infix}_ROOM_DESCRIPTION`).
   * Dispatched upstream by `@情景描写` (ANOTHER_TALK.ERB:1023) when the
   * player is inside the room owned by `charaNum`. Returns the ambient prose
   * lines; empty array = not authored for this chara/variant, disabled kojo,
   * or the body could not be resolved. Optional so legacy routers keep
   * working until they exercise private-room descriptions.
   */
  resolveRoomDescriptionKojo?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];

  resolveRoomDescriptionKojoDetailed?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution;

  /**
   * Interactive variant of `resolveEncounterKojo` for first-meeting kojo
   * that contains mid-dialogue player choices (`PRINTBUTTON`+`INPUT`+
   * `SELECTCASE RESULT(S)`, see KOJO-CHOICE-PLAN P3). When the walk
   * reaches a `choice` node with no remaining pick, the call returns
   * `pending.options` for the UI to render and re-invokes with the chosen
   * index appended to `choices` (replay-with-choice-path; same seed =
   * deterministic). Optional so legacy routers (Node tests, simple
   * stand-ins) can keep using the flatten-only `resolveEncounterKojo`.
   */
  resolveEncounterKojoInteractive?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** VM-only ENCOUNTER continuation. Unlike the established interactive
   * method, this owns a live ERB stack and staged transaction. */
  resolveEncounterKojoContinuation?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoContinuationResolution;

  /** Personal reaction to acquiring a mark level. `markId` defaults to 3
   *  (rebellion/dislike) for backward compatibility. */
  resolveMarkKojo?(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    markId?: 0 | 1 | 2 | 3 | 5,
  ): KojoLine[];

  resolveMarkKojoDetailed?(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    markId?: 0 | 1 | 2 | 3 | 5,
  ): KojoResolution;

  resolveMarkKojoInteractive?(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
    markId?: 0 | 1 | 2 | 3 | 5,
  ): InteractiveKojoResolution;

  /** Personal reaction to the shop UPDATE menu (upstream
   *  `qol_update.ERB@UPDATE_OF_KOJO_ORIGIN` calls each author's
   *  `@M_KOJO_UPDATE_K{XX}` via `TRYCALLFORM`). Resolves the body
   *  interactively so INPUT/choice pause for the player. */
  hasUpdateKojo?(charaNum: number, state: Readonly<GameState>): boolean;

  resolveUpdateKojoInteractive?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** Personal reaction for an upstream COUNTER action. `counterAction` is
   *  exactly `TCVAR:20`, the key used by `KOJO_MESSAGE_SEND_COUNTER` before
   *  it calls `M_KOJO{suffix}_MESSAGE_COUNTER_K{target}_{TCVAR:20}`. */
  resolveCounterKojo?(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];

  resolveCounterKojoDetailed?(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution;

  resolveCounterKojoInteractive?(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /** Personal PALAM reaction for a source-verified phase/detail key. A/A2
   *  require the exact upstream detail spelling; B/B2/C/D/E/F pass
   *  `undefined`. `args` binds the authored PALAM function's ARG parameter. */
  resolvePalamKojo?(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoLine[];

  resolvePalamKojoDetailed?(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
  ): KojoResolution;

  resolvePalamKojoInteractive?(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution;

  /**
   * Return diary-page text for a chara (`M_KOJO[_suffix]_DIARY_K{n}_TEXT`).
   * Dispatched upstream by `KOJO_MESSAGE_SEND("DIARY",chara,"TEXT",page,"",flag)`
   * → calls `DIARY_K{n}_EXIST` gate first; if RESULT!=0 then calls
   * `DIARY_K{n}_TEXT_K{n}(ARG:3, ARGS:2, ARG:4)`. Empty array = no diary for
   * this chara/page, EXIST gate failed, or the body could not be resolved.
   *
   * The compact runtime call uses `[PAGENUM, PAGECOUNT]`; the optional
   * `mode` argument carries the authored `MODE` string (`"デイリー"` for the
   * nightly diary and `"コマンド"` for the diary screen). The adapter
   * materialises the named `#DIM PAGENUM`, `#DIMS MODE`, and `#DIM PAGECOUNT`
   * frame before walking the static tree. `args[0]` overrides the requested
   * page and `args[1]` is the visible PAGESET slot when supplied.
   * The faithful resolver does NOT pre-check EXIST — the caller does
   * (use `hasDiaryKojo` first). Faithful to COMF406 日記を読む.
   */
  resolveDiaryKojo?(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
    mode?: string,
  ): KojoLine[];

  resolveDiaryKojoDetailed?(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
    args?: number[],
    mode?: string,
  ): KojoResolution;

  resolveDiaryKojoInteractive?(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
    mode?: string,
  ): InteractiveKojoResolution;

  /**
   * Resolve one of the function-valued diary lifecycle hooks. `exist` uses
   * the authored RETURN value (normally `RETURN 1`) rather than printed text;
   * the other hooks expose staged effects for the deterministic runtime to
   * commit. This is the static KojoNode/KojoCache path, not KojoVM.
   */
  resolveDiaryHook?(
    charaNum: number,
    kind: DiaryHookKind,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution;

  /**
   * Quick existence check for a chara's diary (EXIST gate). Returns true iff
   * the chara has a personal DIARY kojo for ANY page. Faithful mirror of
   * upstream's `TRYCALLFORM DIARY%RESULTS%_K{N}_EXIST` — we evaluate the EXIST
   * body and treat a non-zero function RETURN as "exists". This preserves
   * authored EXIST bodies such as Parsee's `RETURN 1` with no PRINT line.
   * Cheap pre-check before resolving `resolveDiaryKojo`.
   */
  hasDiaryKojo?(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): boolean;

  /**
   * Evaluate a chara's per-page HAPPEN body (`DIARY_K{n}_{page}_HAPPEN`).
   * Faithful to upstream `@CHARA_DIARY_BEFORE_CHECK` line 18: it
   * `TRYCALLFORM DIARY_K{CHARA}_{LOCAL}_HAPPEN` and inspects RESULT
   * (fire=1, RESULT:1=2 auto/=3 player-only, RESULT:2=1 repeat). The
   * modern runtime exposes the `RESULT`-equivalent as `fired`, alongside
   * typed RESULT:1 / RESULT:2 slots and any supported effects selected before
   * RETURN.
   *
   * The caller (`runCharaDiaryBeforeCheck`) is responsible for stitching
   * these into the DIARY state machine.
   */
  resolveDiaryHappen?(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): DiaryHappenResolution;

  /**
   * Return personal dialogue for the commission subsystem
   * (`SHOW_IRAI_MESSAGE` / `M_KOJO_IRAI_K*` family). `scene` mirrors the
   * upstream scene strings such as `依頼提示時`, `依頼受託時`,
   * `依頼実行直前`, `成功報告時`. Empty array = no matching personal kojo,
   * disabled kojo, or source body could not be resolved. Optional so legacy
   * test routers do not need to implement it until they exercise IRAI.
   */
  resolveIraiKojo?(
    charaNum: number,
    role: string,
    scene: string,
    iraiId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];
}
