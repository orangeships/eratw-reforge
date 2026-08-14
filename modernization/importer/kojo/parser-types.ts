/**
 * Phase 6.1 / 神社闭环 v2 (刀一) — KojoParser type contracts.
 *
 * Named `parser-types.ts` (NOT `types.ts`) to avoid collision with the
 * Phase 2.3 kojo index types in this directory. The parser's runtime
 * surface (`parser.ts`, `extractor.ts`, `substitute.ts`) imports from
 * here; the bundle and the runtime `DialogueRouter` import from the
 * re-export in `index.ts`.
 *
 * ## Why a TREE (刀一 redesign)
 *
 * The earlier model flattened each @-func into `branches[] +
 * subBranches[] + fallback`, with a "first-matching" simplification
 * that dropped ELSEIF/ELSE and lifted every SELECTCASE to a flat,
 * function-global list. That could not represent eraTW KOJO's actual
 * shape, which is **sequential emission of a nested tree**:
 *
 * ```
 * IF LOCAL && !FLAG:時間停止          ; guard (true at game start)
 *   IF FLAG:時間停止                  ; time-stop special case
 *   ELSEIF TALENT:恋人                ; lover
 *     IF CFLAG:TARGET:睡眠 ...        ; asleep
 *     ELSE SELECTCASE RAND:2 ...      ; awake → random reaction
 *   ELSEIF TALENT:恋慕 ...
 *   ELSE                              ; stranger (default) → refuses
 *     IF CFLAG:TARGET:睡眠 ... ELSE SELECTCASE RAND:2 ...
 * ```
 *
 * The flat model made `FLAG:時間停止` parse as "always true" and made
 * the lover branch shadow the default — so a brand-new game showed the
 * lover/time-stop lines for every command. The tree below preserves
 * the real nesting; the runtime walks it (first-holding IF arm wins,
 * SELECTCASE → RNG pick, everything else emits in order), so at game
 * start (TALENT=0, 時間停止=0) the DEFAULT arm fires faithfully.
 *
 * CALL / CALLFORM / GOTO / WAIT / RETURN are still skipped — the @-func
 * body is the unit of dispatch, not its subroutines.
 */

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

/** A single line of dialogue text from a PRINT/PRINTFORM* line. */
export interface KojoLine {
  /** Cleaned text with `%CALLNAME:*%` and friends already substituted
   *  by `substitute.ts`. The caller may still see `[UNKNOWN:...]`
   *  tokens for things the substitute module doesn't know. */
  text: string;
  /** Era form discriminator. Kept as the verbatim string so the
   *  runtime doesn't have to branch; the UI is free to map them to
   *  CSS classes (italic / wait / log) later. */
  form: KojoPrintForm;
  /** 1-based line number in the original ERB file. Diagnostic only —
   *  the runtime never uses it. */
  line: number;
}

/** Variable namespaces a predicate can read. `FLAG` and `ITEM` are top-level
 *  game state; the remaining namespaces are per-chara `CharaSlotState`. */
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

/** Whose slot a `var_*` predicate reads. `FLAG` is always `GLOBAL`;
 *  bare `TALENT:X` / `CFLAG:X` default to `TARGET` (the speaking NPC). */
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

/** Read-only string values permitted inside numeric string helpers. */
export type KojoStringValue =
  | { kind: "string"; value: string }
  | { kind: "string-local-ref"; index?: number; name?: string }
  | { kind: "string-result-ref"; index: number }
  | { kind: "character-name-string"; field: "NAME" | "CALLNAME"; subject: KojoValue }
  | { kind: "host-string"; name: string }
  | { kind: "cstr"; subject: KojoValue; key: string }
  /**
   * A literal text with embedded `%TOKEN%` and `%FUNC(args)%` placeholders.
   * Resolved at emit-time by `evaluateStringValue` against the active
   * host registry. The parser only segments; it does not evaluate.
   *
   * Source examples:
   * - `「...%CALLNAME:MASTER%...」` (callname interpolation)
   * - `「...%M_KOJO_K70_AUTO("喘ぎ：挿入", "❤")%...」` (helper call)
   * - `「...%LOCALS:1%在%LOCALS:2%之间」` (nested string local refs)
   */
  | { kind: "string-template"; parts: readonly StringTemplatePart[] };

/**
 * One segment of a parsed `string-template`. The parser produces these
 * once per template; runtime evaluation walks the array and joins the
 * results. Each variant maps to a specific runtime substitution path so
 * the evaluator stays declarative.
 */
export type StringTemplatePart =
  | { kind: "literal"; text: string }
  /** `%CALLNAME:MASTER%` / `%CALLNAME:TARGET%` / `%CALLNAME:N%` / `%CALLNAME:[[name]]%`. */
  | { kind: "callname"; scope: string }
  /** `%NAME:MASTER%` / `%NAME:TARGET%` / `%NAME:N%`. */
  | { kind: "name"; scope: string }
  /** `%LOCALS%` / `%LOCALS:N%` — reads the resolved real-string mirror. */
  | { kind: "locals"; index: number }
  /** `%RESULTS%` / `%RESULTS:N%` — reads KojoVM/host string results. */
  | { kind: "results"; index: number }
  /** `%ARGS%` / `%ARGS:N%` — reads the KojoResolveContext `stringArgs`. */
  | { kind: "string-arg"; index: number }
  /** `%NAME(args)%` — generic upper-case function/format call. Resolved
   *  via `text-renderer.ts::evaluateCommonFormatter` (single-source for
   *  the formatter table). */
  | { kind: "formatter"; name: string; args: readonly string[] };

export type KojoValue =
  | { kind: "number"; value: number }
  /** A literal text with embedded `%TOKEN%` and `%FUNC(args)%` placeholders.
   *  Resolved at emit-time by the runtime's `evaluateStringValue`. Used as
   *  the RHS of `LOCALS = 「...」` / `#DIMS = 「...」` assignments. */
  | { kind: "string-template"; parts: readonly StringTemplatePart[] }
  /** An unknown function call whose return value the modern runtime cannot
   *  evaluate (`LOCAL = M_KOJO_K70_UFUFU()` / `LOCAL = HATE_49()`). The
   *  parser accepts it as a stub so the surrounding assignment remains
   *  supported; the runtime resolves it to `0` with a non-fatal
   *  diagnostic. Function semantics — when implemented per task #15 —
   *  register under `hostRegistry.functions` and replace this stub. */
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
  /** A function-scoped numeric variable explicitly declared through #DIM. */
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
   *  predicates. Numeric compare value is always 0; the
   *  `compare` predicate branch reads `text` for string equality. */
  | { kind: "string_literal"; value: string }
  /** The string-valued ARGS/ARGS:N binding used by authored check hooks. */
  | { kind: "string_arg"; index: number }
  | { kind: "state"; field: "money" | "main_map" | "casino_chips" }
  | { kind: "room_owner" }
  | { kind: "line-count" }
  /** `MAX_DIARY_PAGE:CHARA:0`. */
  | { kind: "diary_max_page"; subject: KojoValue }
  /** `DIARY:CHARA:PAGE`. */
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
  /** `STRCOUNT(source, pattern)` with Emuera regular-expression semantics. */
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
  /** Non-MAGIC-DLC pregnancy eligibility helper. */
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

/** Safe, direct state effect extracted from an authored kojo body. */
export interface KojoEffectTarget {
  /**
   * State namespaces whose direct authored writes can use the shared
   * transaction. SOURCE/NOWEX writes stay in the active command frame and
   * are never persisted into character state; MONEY and ITEM are global
   * rather than character bags.
   */
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

/** A predicate guarding an IF arm. Faithful subset of the boolean
 *  expressions eraTW KOJO functions actually emit:
 *    - `IF LOCAL` / `IF RESULT` / `IF 1`        → `always`
 *    - `IF TALENT:恋人`                         → `var_nonzero` (eraTW `IF X` = `X != 0`)
 *    - `IF TALENT:恋人 == 1`                    → `var_eq`
 *    - `IF CFLAG:TARGET:睡眠`                   → `var_nonzero` scope TARGET
 *    - `IF FLAG:時間停止`                       → `var_nonzero` ns FLAG scope GLOBAL
 *    - `IF !FLAG:時間停止`                      → `not`
 *    - `IF LOCAL && !FLAG:時間停止`             → `and`
 *    - `IF CHK_DATENOW(...)` / `IF BATHROOM()`  → `unknown` (a runtime
 *      function call we don't model; the runtime treats it as FALSE so
 *      the surrounding ELSE arm fires — faithful for the start state).
 *    - `IF ARG == 2` / `IF ARG:1 == 1`           → `arg_eq` (the EVENT-arm
 *      sub-id passed by `KOJO_MESSAGE_SEND`; bound per-call via the
 *      `args` resolution context — Phase 8 朝夜挨拶). */
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
   * A variable reference whose `id` is a non-numeric identifier that the
   * modern symbol table does not resolve. Replaces the older `kind:"unknown"`
   * fallback so the AST stays structured (and the validator counts these
   * as supported predicates rather than unknown-symbol ones). Runtime
   * evaluates this as `false` without emitting a diagnostic, so the
   * ELSE arm fires and the route stays supported. Real bindings are
   * added per task #15.
   */
  | {
      kind: "unknown_var_nonzero";
      ns: KojoVarNs;
      scope: string;
      id: string;
    }
  /**
   * A `NAME(args...)` function call whose semantics the modern runtime
   * does not yet implement. Replaces the older `kind:"unknown"` fallback
   * for function-call predicates (task #3, replaces `unknown-function`
   * unsupported bucket). The parser emits this when `parseValue` falls
   * back to `function-call-stub` and the predicate is a bare function
   * call (not a `==` / `>=` / `<` comparison — those still go through
   * `truthy { value: function-call-stub }`).
   *
   * Runtime evaluates this via `evaluateFunctionCallPredicate`: if a
   * registry implementation exists (task #15 slots K70 helpers here), it
   * runs that; otherwise returns `false` with a non-fatal
   * `unknown-function:<name>` diagnostic. The route stays supported
   * because the predicate is structurally recognised.
   */
  | { kind: "function-call"; name: string; args: readonly string[] }
  /**
   * A bare-identifier comparison (task #4). Captures `MODE == "指令"`,
   * `NAME:MASTER != "你"`, `iRT >= K17C_恋慕`, `前面指令 == "V挿入"`,
   * `DISH_TYPE == "甜点"`, `CALLNAME:MASTER != "你"`, `LOCALS == ""`,
   * etc. — predicates whose LHS and/or RHS the modern symbol table
   * cannot resolve as a typed `var` / `arg` / `rand` reference.
   *
   * Runtime evaluates this best-effort against the deterministic game
   * state and per-character memory (e.g. `MODE` reads the current menu
   * phase, `LOCALS` reads the resolved string mirror, `CALLNAME:MASTER`
   * reads the player's nickname). When no binding exists, the predicate
   * resolves to `false` without an `unsupported` diagnostic — the route
   * stays supported and the ELSE arm fires.
   */
  | {
      kind: "system_var_compare";
      left: string;
      op: "==" | "!=" | ">=" | "<=" | ">" | "<";
      right: string;
    }
  | { kind: "unknown"; raw: string };

/** One arm of an `IF / ELSEIF / ELSE` chain. `ELSE` is modelled as an
 *  arm whose predicate is `{ kind: "always" }`. */
export interface KojoArm {
  predicate: KojoPredicate;
  body: KojoNode;
}

/**
 * The nested AST of one @-func body. The runtime emits it sequentially:
 *   - `lines`  → emit each line in order
 *   - `seq`    → emit each child in order
 *   - `if`     → emit the body of the FIRST arm whose predicate holds
 *   - `rand`   → emit one case picked via `rng.int(cases.length)` for
 *                legacy generated assets. Newly parsed `SELECTCASE RAND:N`
 *                uses `select`, preserving literal CASE values, CASEELSE,
 *                and the original RAND:N probability distribution.
 *   - `choice` → a mid-kojo PLAYER choice (`PRINTBUTTON`+`INPUT`+
 *                `SELECTCASE RESULT(S)`): the interactive router pauses,
 *                presents the option labels, and descends the picked
 *                option's body. `resolveKojoNode` (non-interactive) auto-
 *                picks option 0 to stay a pure `KojoLine[]` producer.
 *   - `for` → a bounded numeric `FOR LOCAL[:N], start, end[, step]` loop.
 *   - `repeat` → a bounded numeric `REPEAT count` loop.
 *   - `while` → a bounded predicate `WHILE ... WEND` loop with
 *                `BREAK`/`CONTINUE` control nodes.
 */
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

/** Numeric LOCAL slot or an explicitly declared `#DIM` function local. */
export type KojoLocalTarget =
  | { kind: "slot"; index: number }
  | { kind: "named"; name: string }
  | { kind: "named-index"; name: string; index: KojoValue }
  | { kind: "string-slot"; index: number }
  | { kind: "named-string"; name: string };

/** One selectable option of a `choice` node. `value` = the `PRINTBUTTON`
 *  value string that its `CASE "value"` branches on; `label` is shown to
 *  the player; `body` is the branch emitted when picked. */
export interface KojoChoiceOption {
  label: string;
  value: string;
  body: KojoNode;
}

/** How a single `input` option matches the post-INPUT `RESULT`. Either a
 *  truthy check (`IF RESULT`, where any non-zero RESULT wins) or an
 *  equality check (`IF RESULT == N`). */
export type KojoInputMatcher =
  | { kind: "truthy" }
  | { kind: "equals"; value: number };

/** One selectable option of an `input` node. The `matcher` records which
 *  RESULT value this branch consumes; `label` is shown to the player;
 *  `value` is the optional authored numeric/string pick (often implicit
 *  from the option's index in the menu); `body` is the branch emitted
 *  when picked. An ELSE arm carries no matcher — it is the fall-through
 *  branch when no other arm matches the actual RESULT. */
export interface KojoInputOption {
  label: string;
  value?: string;
  matcher?: KojoInputMatcher;
  body: KojoNode;
}

export interface KojoSelectCase {
  /** Exact numeric selector values; null means the case syntax is deferred. */
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

/** A single `@M_KOJO_*` function parsed into a dispatch tree. */
export interface ParsedKojoFunc {
  /** Full function name including the leading `@`. */
  name: string;
  /** 1-based line number of the `@` declaration. */
  declLine: number;
  /** The function body as a sequential tree (always a `seq` root). */
  body: KojoNode;
}

/** Result of parsing one ERB file. */
export interface ParsedKojoFile {
  /** Relative path of the source file (from project root). */
  relPath: string;
  /** Every @-func we successfully located (even if body is empty). */
  funcs: ParsedKojoFunc[];
  /** Names we matched but could not turn into a `ParsedKojoFunc`. */
  unparseable: string[];
}
