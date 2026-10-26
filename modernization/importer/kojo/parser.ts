/**
 * Phase 6.1 / 神社闭环 v2 (刀一) — KojoParser.
 *
 * Pure function: `ExtractedFunc → ParsedKojoFunc` (a nested tree).
 *
 * ## Algorithm
 *
 * Walk the body lines once, maintaining a stack of open containers
 * (the root `seq`, plus one frame per open `IF` and `SELECTCASE`):
 *
 *   - `IF <expr>`     → push an `if` node (arm 0 = parsePredicate(expr));
 *                       subsequent lines flow into that arm's body.
 *   - `ELSEIF <expr>` → close the current arm, open a new arm.
 *   - `ELSE`          → open a new arm with predicate `{ always }`.
 *   - `ENDIF`         → pop the `if` frame.
 *   - `SELECTCASE`    → push a `rand` node.
 *   - `CASE <…>`      → start a new case body (the `CASE` value is
 *                       ignored — the runtime picks uniformly).
 *   - `ENDSELECT`     → pop the `rand` frame.
 *   - `PRINTFORM*`    → append a `KojoLine` to the current container
 *                       (consecutive lines coalesce into one `lines`
 *                       node).
 *   - `FOR LOCAL[:N], start, end[, step]` → a bounded loop node; unsupported
 *     loop headers fail closed and discard their body.
 *   - `REPEAT count` → a bounded repeat node; unsupported counts fail closed.
 *   - `WHILE predicate` → a bounded while node with BREAK/CONTINUE support.
 *   - anything else   → skipped (CALL / WAIT / …).
 *
 * Nesting falls out naturally: an `IF` inside an arm body appends an
 * `if` node to that arm's `seq`, then opens a new frame, so its lines
 * land one level deeper. This preserves the real eraTW structure
 * (relationship IF-chain → asleep/awake IF → RAND), which the runtime
 * then walks faithfully (see `runtime/kojo/static-router.ts`).
 *
 * The parser is forgiving of unbalanced control flow (a missing ENDIF
 * just leaves the frame open until end-of-body); the appended nodes are
 * already attached, so nothing is lost.
 *
 * **Encoding**: input is the `body` string array from `extractor.ts`;
 * we don't read files here.
 */

import type {
  KojoArm,
  KojoChoiceOption,
  KojoEffect,
  KojoEffectTarget,
  KojoStringEffectTarget,
  KojoInputMatcher,
  KojoInputOption,
  KojoLine,
  KojoLocalTarget,
  KojoNode,
  KojoSelectCase,
  KojoSelectRange,
  KojoStringValue,
  KojoPredicate,
  KojoValue,
  KojoSubjectScope,
  KojoVarNs,
  KojoVarScope,
  ParsedKojoFunc,
  StringTemplatePart,
} from "./parser-types.js";
import { substitute, DEFAULT_CONTEXT, type SubstituteContext } from "./substitute.js";
import type { ExtractedFunc } from "./extractor.js";
import {
  DEFAULT_KOJO_SYMBOLS,
  resolveKojoSymbol,
  type KojoSymbolNamespace,
  type KojoSymbolTables,
} from "../../runtime/kojo/symbol-table.js";

const PRINTFORM_RE =
  /^(HTML_PRINT|PRINTFORMW|PRINTFORMDW|PRINTFORMDL|PRINTFORMD|PRINTFORML|PRINTFORM|PRINTDW|PRINTDL|PRINTW|PRINTD|PRINTL|PRINT)\b\s*(.*)$/;

const IF_RE = /^IF\s+(.+)$/;
const ELSEIF_RE = /^ELSEIF\s+(.+)$/;
const ELSE_RE = /^ELSE$/;
const ENDIF_RE = /^ENDIF$/;

// `LOCAL[:N] = <int>` — the eraTW 記入チェック authoring convention. Kojo
// authors set `LOCAL:1 = 1` to enable a branch then gate it with
// `IF LOCAL:1 && ARG == N`; `LOCAL:1 = 0` disables. We track these literal
// assignments during the walk and substitute the current value into IF
// conditions so the gate resolves (without it `LOCAL:1` is `unknown`→false
// and every gated greeting body branch stays silent). Phase 8 朝夜挨拶.
const LOCAL_ASSIGN_RE = /^LOCAL(?::(\d+))?\s*(\/=|=\/|=|\+=|-=|\+\+|--)\s*(.*)$/;
const STRING_LOCAL_ASSIGN_RE = /^LOCALS(?::(\d+))?\s*(\+=|=)\s*(.*)$/;
const NAMED_LOCAL_ASSIGN_RE = /^([\p{L}_][\p{L}\p{N}_]*)(?::(.+?))?\s*(\/=|=\/|=|\+=|-=|\+\+|--)\s*(.*)$/u;
const CALL_RE = /^CALL\s+([^\s(]+)(?:\s*\((.*)\))?\s*$/;
const ASK_YN_CALL_RE = /^CALL\s+ASK_YN(?:(?:\s*\((.*)\))|(?:\s*,\s*(.*)))?\s*$/i;
const ASK_M_CALL_RE = /^CALL\s+ASK_M(?:(?:\s*\((.*)\))|(?:\s*,\s*(.*)))?\s*$/i;
const RESULT_ASSIGN_RE = /^RESULT(?::(\d+))?\s*(=|\+=|-=)\s*(.+)$/;
const RETURN_RE = /^RETURN(?:\s+(.+))?$/;
// Emuera accepts both C-like `+=`/`-=` and the compact ERA spelling
// `=+`/`=-` for read-modify-write effects. Keep the longer operators first so
// a compact increment is not misread as a plain assignment with `+N` RHS.
const ASSIGNMENT_RE = /^(.+?)\s*(\+=|-=|\|=|&=|\*=|\/=|%=|=\+|=-|=\*|=\/|=%|=)\s*(.+)$/;
const BIT_EFFECT_RE = /^(SETBIT|CLEARBIT)\s+(.+?)\s*,\s*(.+)$/;
// #DIM/#DIMS declarations are compile-time function-local storage metadata.
// They do not execute when a kojo route is called, so treating their `=` as an
// unsupported runtime write suppresses otherwise valid authored dialogue.
const COMPILE_TIME_DECLARATION_RE = /^#DIMS?(?:\b|(?=CONST\b|DYNAMIC\b|SAVEDATA\b|GLOBAL\b|LOCAL\b))/i;

const SELECTCASE_RE = /^SELECTCASE\b/;
const CASE_RE = /^CASE\b/;
const CASEELSE_RE = /^CASEELSE$/;
const ENDSELECT_RE = /^ENDSELECT$/;
const FOR_RE = /^FOR\s+(.+)$/;
const NEXT_RE = /^NEXT\b/;
const REPEAT_RE = /^REPEAT\s+(.+)$/;
const REND_RE = /^REND$/;
const WHILE_RE = /^WHILE\s+(.+)$/;
const WEND_RE = /^WEND$/;
const DO_RE = /^DO$/;
const LOOP_RE = /^LOOP(?:\s+(.+))?$/;
const BREAK_RE = /^BREAK$/;
const CONTINUE_RE = /^CONTINUE$/;

/** Control-flow lines must be handled by the tree builder before the generic
 * assignment fallback.  In particular, `CASE IS >= 3` contains `=` and
 * HTML_PRINT text commonly contains an HTML attribute such as `color=`. */
const CONTROL_FLOW_RE = /^(?:IF|ELSEIF|SIF|ELSE|ENDIF|WHILE|WEND|DO|LOOP|BREAK|CONTINUE|REPEAT|REND|FOR|NEXT|SELECTCASE|CASE(?:ELSE)?|ENDSELECT)\b/;

function delimiterBalance(raw: string): number {
  let balance = 0;
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') { index++; continue; }
      quoted = !quoted;
    } else if (!quoted && (char === "(" || char === "{")) balance++;
    else if (!quoted && (char === ")" || char === "}")) balance--;
  }
  return balance;
}

/** Remove Emuera `[SKIPSTART]` source-disabled regions while retaining line
 * slots. This must happen before predicate continuation folding: disabled
 * drafts sometimes end an incomplete `IF ... &&`, which must not absorb the
 * following skipped `CALL` into an unsupported live predicate. */
function stripKojoSkipBlocks(lines: readonly string[]): string[] {
  let depth = 0;
  return lines.map((line) => {
    const directive = line.trim().toUpperCase();
    if (directive === "[SKIPSTART]") {
      depth += 1;
      return "";
    }
    if (directive === "[SKIPEND]") {
      depth = Math.max(0, depth - 1);
      return "";
    }
    return depth > 0 ? "" : line;
  });
}

/** Join ERB predicate continuation lines while retaining original line slots. */
export function mergeKojoPredicateContinuations(lines: readonly string[]): string[] {
  const merged = [...lines];
  for (let index = 0; index < merged.length; index++) {
    if (!/^\s*(?:IF|ELSEIF|SIF|WHILE)\b/.test(merged[index]!)) continue;
    let balance = delimiterBalance(merged[index]!);
    let cursor = index;
    while (cursor + 1 < merged.length) {
      const next = merged[cursor + 1]!;
      const currentNeedsContinuation =
        balance > 0 || /(?:&&|\|\|)\s*$/.test(merged[index]!.trim());
      const nextStartsContinuation = /^\s*(?:&&|\|\|)/.test(next);
      if (!currentNeedsContinuation && !nextStartsContinuation) break;
      merged[index] += ` ${next.trim()}`;
      balance += delimiterBalance(next);
      merged[cursor + 1] = "";
      cursor++;
    }
    index = cursor;
  }
  return merged;
}

/**
 * Join brace-wrapped multiline `%TEXTR(@".../..." )%` assignments.
 *
 * A handful of personal kojo functions use Emuera's standalone `{ ... }`
 * block only to make a long string assignment readable.  The continuation
 * lines are string content, not ERB statements; walking them independently
 * makes the parser classify the prose (often containing `>=` or `=`) as an
 * unsupported condition/effect.  Preserve the original line slots while
 * folding the content into the assignment that owns it.  The source uses `/`
 * as the TEXTR alternative separator, so no synthetic whitespace is added.
 */
export function mergeKojoMultilineStringAssignments(lines: readonly string[]): string[] {
  const merged = [...lines];
  const startsMultilineTextr = (line: string): boolean =>
    /^\s*(?:LOCALS(?::\d+)?|[\p{L}_][\p{L}\p{N}_]*)\s*=\s*%TEXTR\(\s*@?"/iu.test(line) &&
    !/\)\s*%\s*$/.test(line);

  for (let index = 0; index < merged.length; index++) {
    if (!startsMultilineTextr(merged[index]!)) continue;
    let cursor = index;
    while (cursor + 1 < merged.length) {
      const next = merged[cursor + 1]!;
      merged[index] += next.trim();
      merged[cursor + 1] = "";
      cursor++;
      if (/\)\s*%\s*$/.test(merged[index]!)) break;
    }
    index = cursor;
  }
  return merged;
}

// Player-choice idiom (KOJO-CHOICE-PLAN P1): a run of
//   PRINTBUTTON "label", "value"   (spacer PRINTL允许夹在其间)
//   INPUT / INPUTS / $INPUT
//   SELECTCASE RESULT(S) / CASE "value" … ENDSELECT
// becomes a `choice` node instead of the button lines being dropped +
// the SELECTCASE mis-modelled as a random pick.
const PRINTBUTTON_RE = /^PRINTBUTTONC?\s+"(.*)"\s*,\s*"?([^",]*?)"?\s*$/;
const INPUT_RE = /^(INPUTS?|\$INPUT[A-Z]*|INPUTSTR)\b/;
const WAIT_RE = /^(WAIT|WAITANYKEY|FORCEWAIT)\b/;
const SELECTCASE_RESULT_RE = /^SELECTCASE\s+RESULTS?\b/;
const PRINTED_OPTION_RE = /^\s*(PRINT(?:FORM)?D?[LW])\s+\[([^\]]+)\]\s*[-－—:：]?\s*(.+)$/;
const LABEL_RE = /^\$[^\s]+$/;
/** First value of a `CASE "v"[, "w"…]` / `CASE v` line (choice matching). */
const CASE_VALUE_RE = /^CASE\s+"?([^",]*?)"?\s*(?:,|$)/;

function parseStaticStringArgument(raw: string): string | null {
  const quoted = /^"((?:[^"]|"")*)"$/.exec(raw.trim());
  return quoted ? quoted[1]!.replace(/""/g, '"') : null;
}

type AskYnLabel = string | {
  predicate: KojoPredicate;
  whenTrue: string;
  whenFalse: string;
};

function parseAskYnLabel(raw: string, symbols: KojoSymbolTables): AskYnLabel | null {
  const literal = parseStaticStringArgument(raw);
  if (literal !== null) return literal;

  // Emuera also permits `@"plain text"` for a string-expression argument.
  // Accept it only when it is genuinely static; strings containing formatter
  // markers must continue through the structured parser below or fail closed.
  const expressionLiteral = /^@"((?:[^"]|"")*)"$/.exec(raw.trim());
  if (expressionLiteral && !/[%\\@]/.test(expressionLiteral[1]!)) {
    return expressionLiteral[1]!.replace(/""/g, '"');
  }

  // Emuera's formatted string form can choose a button label at runtime:
  // @"%\@ condition ? yes # no \@%". Lower it to an IF around the choice
  // instead of exposing the formatter source to the player.
  const formatted = /^@"%\\@\s*(.*?)\s*\\@%"$/s.exec(raw.trim());
  const conditional = formatted ? splitTopLevelTernary(formatted[1]!) : null;
  if (!conditional) return null;
  const whenTrue = conditional.whenTrue.trim();
  const whenFalse = conditional.whenFalse.trim();
  if (!whenTrue || !whenFalse || [whenTrue, whenFalse].some((label) => /[%\\@]/.test(label))) {
    return null;
  }
  return {
    predicate: parsePredicate(conditional.condition, symbols),
    whenTrue,
    whenFalse,
  };
}

function buildAskYnChoice(labels: readonly AskYnLabel[], line: number): KojoNode {
  const dynamicIndex = labels.findIndex((label) => typeof label !== "string");
  if (dynamicIndex >= 0) {
    const dynamic = labels[dynamicIndex]! as Exclude<AskYnLabel, string>;
    const branch = (label: string): KojoNode => buildAskYnChoice(
      labels.map((candidate, index) => index === dynamicIndex ? label : candidate),
      line,
    );
    return {
      type: "if",
      arms: [
        { predicate: dynamic.predicate, body: branch(dynamic.whenTrue) },
        { predicate: { kind: "always" }, body: branch(dynamic.whenFalse) },
      ],
    };
  }

  return {
    type: "choice",
    line,
    options: (labels as readonly string[]).map((label, index) => ({
      label,
      value: String(index),
      // ASK_YN returns 0 for the affirmative branch and 1 for the negative
      // branch. UI numbering is deliberately independent of this ERA value.
      body: {
        type: "seq",
        children: [{
          type: "result-set",
          index: 0,
          op: "set",
          value: { kind: "number", value: index },
          line,
        }],
      },
    })),
  };
}

/** DAYEVENTS.ERH is a #DIM CONST file rather than a normal variable
 * namespace. These names occur in authored `DAYEVENT_COND` SELECTCASE/INRANGE
 * expressions, so keep the small upstream enum available to the generic
 * parser instead of treating the cases as opaque. */
const DAY_EVENT_CONSTANTS: Readonly<Record<string, number>> = {
  DAYEVENT_GENERAL: 0,
  DAYEVENT_ORAL: 1,
  DAYEVENT_PAIZURI: 2,
  DAYEVENT_COWGIRL: 3,
  DAYEVENT_KISS: 4,
  DAYEVENT_WAKEUP: 5,
  DAYEVENT_COSLEEPING: 6,
  DAYEVENT_STARE: 7,
  DAYEVENT_PRANK: 8,
  NIGHTEVENT_KISS: 9,
  NIGHTEVENT_YOBAI: 10,
  NIGHTEVENT_DRINK: 11,
  NIGHTEVENT_MOONVIEWING: 12,
  NIGHTEVENT_SLEEPOVER: 13,
};

function parseDayEventConstant(raw: string): number | null {
  const value = raw.trim().replace(/^"|"$/g, "");
  return Object.prototype.hasOwnProperty.call(DAY_EVENT_CONSTANTS, value)
    ? DAY_EVENT_CONSTANTS[value]!
    : null;
}

function parseCaseMatchers(
  raw: string,
  symbols: KojoSymbolTables,
  allowStringTokens = false,
): { values: number[]; ranges: KojoSelectRange[] } | null {
  const values = raw.split(",").map((part) => part.trim());
  if (values.length === 0) return null;
  const exact: number[] = [];
  const ranges: KojoSelectRange[] = [];
  for (const value of values) {
    if (/^"?-?\d+"?$/.test(value)) {
      exact.push(Number(value.replace(/^"|"$/g, "")));
      continue;
    }
    const named = parseDayEventConstant(value);
    if (named !== null) {
      exact.push(named);
      continue;
    }
    const stringValue = /^"((?:[^"]|"")*)"$/.exec(value);
    if (stringValue) {
      const decoded = stringValue[1]!.replace(/""/g, '"');
      const resolved = resolveKojoSymbol(symbols, "STR", decoded);
      if (resolved === null && !allowStringTokens) return null;
      exact.push(resolved ?? kojoStringToken(decoded));
      continue;
    }
    const comparison = /^IS\s*(<=|>=|<|>)\s*(-?\d+)$/i.exec(value);
    if (comparison) {
      const bound = Number(comparison[2]);
      ranges.push({
        min: comparison[1]!.startsWith(">") ? bound : null,
        max: comparison[1]!.startsWith("<") ? bound : null,
        minInclusive: comparison[1] === ">=",
        maxInclusive: comparison[1] === "<=",
      });
      continue;
    }
    const between = /^(.+?)\s+TO\s+(.+)$/i.exec(value);
    if (between) {
      const min = /^-?\d+$/.test(between[1]!.trim())
        ? Number(between[1])
        : parseDayEventConstant(between[1]!);
      const max = /^-?\d+$/.test(between[2]!.trim())
        ? Number(between[2])
        : parseDayEventConstant(between[2]!);
      if (min === null || max === null) return null;
      ranges.push({
        min,
        max,
        minInclusive: true,
        maxInclusive: true,
      });
      continue;
    }
    if (allowStringTokens && value.length > 0) {
      exact.push(kojoStringToken(value));
      continue;
    }
    return null;
  }
  return { values: exact, ranges };
}

const SIF_RE = /^SIF\s+(.+)$/;
const PRINTDATA_RE = /^PRINTDATA((?:K|D)?)(L|W)?$/;
const DATA_RE = /^DATA(?:\s+(.*))?$/;
const DATAFORM_RE = /^DATAFORM(?:\s+(.*))?$/;
const DATALIST_RE = /^DATALIST$/;
const ENDLIST_RE = /^ENDLIST$/;
const ENDDATA_RE = /^ENDDATA$/;

/**
 * task #4: returns true when a token is a bare system-level identifier
 * the modern symbol table cannot resolve as a typed `var` / `arg` /
 * `rand` / `number`. These are the targeted `unsupported-expression`
 * offenders surfaced by the inventory: `MODE == "指令"`, `DISH_TYPE ==
 * "甜点"`, `DISH_DRG`, `iRT >= K17C_*`, `NAME:MASTER != "你"`,
 * `CALLNAME:MASTER != "你"`, `前面指令 == "V挿入"`, `LOCALS == ""`,
 * etc. — plus the leading-target namespace-id forms (`LOCALS:0`,
 * `RESULT:1`, `RESULTS:0`) which the predicate must dereference against
 * the VM at runtime. Calling this on an obviously typed value
 * (`STRING_TOKEN`, `123`, `MASTER`) returns `false`.
 */
function isBareSystemIdentifier(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  // Already recognised as a known typed form — let the typed branches
  // handle them (var_eq / arg_eq / rand_eq / compare). We only want to
  // catch the *unresolved* tail of the inventory.
  if (/^-?\d+$/.test(v)) return false;
  if (v === "MASTER" || v === "PLAYER" || v === "TARGET") return false;
  if (v === "CHARANUM") return false;
  // String literal? — caught above by the various string-compare
  // branches already (`string_arg_compare`, `festival_compare`,
  // `alcohol_face_compare`). Not considered a "bare ident".
  if (/^"((?:[^"]|"")*)"$/.test(v)) return false;
  // Forbidden characters: anything that would let a numeric or
  // arithmetic expression sneak through is a stronger typed path.
  // `&&`/`||` are split by the top-level splitter before we get here,
  // so not relevant.
  if (/[()+\-*/%&|<>=!?:,\s]/.test(v)) {
    // Namespace forms limited to system-level callsites the runtime
    // will resolve via `resolveSystemVarAccessor` — `NAME:MASTER`,
    // `CALLNAME:TARGET`, per-character `MASTERNAME:49`, `LOCALS:0`,
    // `RESULTS:1`, `RESULT:2`. All
    // other NS-prefixed forms (`CFLAG:K17C_恋慕`, `TALENT:恋慕`)
    // belong to the typed var branch and must NOT enter this
    // fallback (they pass through `parseValue` as `var_nonzero` /
    // `unknown_var_nonzero` already).
    const sysNsMatch = /^(DAY|NAME|CALLNAME|MASTERNAME|LOCALS|RESULTS|RESULT):[A-Z0-9_※一-龯\-\+ぁ-んァ-ヿ ]+$/i.exec(v);
    if (sysNsMatch) return true;
    return false;
  }
  // Catch standard namespaced forms (`CFLAG:K42C_既成事實`,
  // `TALENT:恋慕`) — these already go through `parseUnknownVarRef`
  // and surface as `unknown_var_nonzero`. Don't double-classify.
  if (/^[A-Z][A-Z_]+:/.test(v)) return false;
  // Pure bare identifier like `MODE`, `DISH_TYPE`, `DISH_DRG`,
  // `前面指令`, `iRT`, `前面`, `好感度`. Allow CJK characters and
  // underscores; first character must be a letter/CJK.
  if (!/^[A-Za-z_぀-ヿ㐀-鿿][\w぀-ヿ㐀-鿿]*$/.test(v)) return false;
  return true;
}

function stripOuterParens(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
      if (depth === 0 && i < value.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function splitTopLevel(raw: string, separator: "&&" | "||" | "+"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= raw.length - separator.length; i++) {
    const char = raw[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (depth === 0 && raw.slice(i, i + separator.length) === separator) {
      parts.push(raw.slice(start, i));
      start = i + separator.length;
      i += separator.length - 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(raw.slice(start));
  return parts;
}

function splitTopLevelBinary(
  raw: string,
  operators: readonly ("&" | "|" | "+" | "*" | "/" | "%" | "-")[],
): { left: string; op: "&" | "|" | "+" | "*" | "/" | "%" | "-"; right: string } | null {
  let depth = 0;
  let quoted = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    const char = raw[i];
    if (char === '"' && raw[i - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === ")") depth++;
    else if (char === "(") depth--;
    if (
      depth === 0 &&
      operators.includes(char as "&" | "|" | "+" | "*" | "/" | "%" | "-") &&
      !(char === "&" && (raw[i - 1] === "&" || raw[i + 1] === "&")) &&
      !(char === "|" && (raw[i - 1] === "|" || raw[i + 1] === "|")) &&
      !(char === "-" && (i === 0 || /[+\-*/%&|(<>=]/.test(raw[i - 1] ?? "")))
    ) {
      return {
        left: raw.slice(0, i),
        op: char as "&" | "|" | "+" | "*" | "/" | "%" | "-",
        right: raw.slice(i + 1),
      };
    }
  }
  return null;
}

function splitTopLevelTernary(
  raw: string,
): { condition: string; whenTrue: string; whenFalse: string } | null {
  let depth = 0;
  let question = -1;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && char === "?" && question < 0) question = index;
    else if (depth === 0 && char === "#" && question >= 0) {
      return {
        condition: raw.slice(0, question),
        whenTrue: raw.slice(question + 1, index),
        whenFalse: raw.slice(index + 1),
      };
    }
  }
  return null;
}

function splitFunctionArguments(raw: string): string[] | null {
  if (raw.trim().length === 0) return [];
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (quote) {
      if (char === quote) {
        if (raw[i + 1] === quote) {
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (char === "," && depth === 0) {
      parts.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0 || quote) return null;
  parts.push(raw.slice(start).trim());
  return parts;
}

function parseFunctionArguments(raw: string, name: string): string[] | null {
  if (!raw.startsWith(name) || !raw.endsWith(")")) return null;
  let cursor = name.length;
  while (/\s/.test(raw[cursor] ?? "")) cursor++;
  if (raw[cursor] !== "(") return null;
  return splitFunctionArguments(raw.slice(cursor + 1, -1));
}

/**
 * Detect an unknown function call shape `NAME(arg, arg, ...)` so the parser
 * can emit a `function-call-stub` node instead of rejecting the surrounding
 * assignment as `unsupported LOCAL assignment expression`. Used as the
 * last-resort fallback in `parseLocalAssignment` /
 * `parseNamedLocalAssignment` and as the SELECTCASE-selector safety net.
 *
 * Two shapes are recognised:
 *   - `<NAME>(<ARGS>)` — a function call with zero or more arguments.
 *   - `<NAME>` — a bare identifier (e.g. `DISHNAME`, `EQUIP`, `COM_STR`)
 *     that some kojo packs use as an opaque alias. We accept it as a
 *     no-argument function stub so SELECTCASE selectors stay supported;
 *     the runtime resolves it to `0` with the same `unknown-function:<name>`
 *     diagnostic. Real bindings (when known) should be added to a future
 *     registry rather than going through this fallback.
 *
 * The runtime will surface an `unknown-function:<name>` diagnostic so
 * missing implementations stay visible while the route remains supported.
 */
export function parseFunctionCallStub(raw: string): Extract<KojoValue, { kind: "function-call-stub" }> | null {
  const trimmed = raw.trim();
  // `<NAME>(<ARGS>)` — only call shapes (with parens) qualify. Bare
  // identifiers are intentionally NOT matched here: a bare word like
  // `有主语` is a `#DIMS` named local in the runtime, not a function
  // call. Snapping that into `function-call` would shadow the named-
  // local lookup path used by inline conditionals (e.g. `\@有主语?...
  // #...\`) and break shared counter bundles that rely on the VM
  // mapping `vm.namedLocals["有主语"]` (build-kojo-bundle serialises
  // `\@有主语?a#b\@` bodies that later re-parse in
  // `renderInlineConditionals`).
  const callMatch = /^([^\s()\[\]:,!=&|+\-*/%]+)\s*\((.*)\)\s*$/s.exec(trimmed);
  if (callMatch) {
    const name = callMatch[1]!;
    const argBody = callMatch[2]!.trim();
    const args = argBody.length === 0 ? [] : splitFunctionArguments(argBody) ?? [argBody];
    return { kind: "function-call-stub", name, args };
  }
  return null;
}

function parseSubjectScope(raw: string): KojoSubjectScope | null {
  const value = raw.trim();
  if (value === "TARGET") return "TARGET";
  if (value === "MASTER" || value === "PLAYER") return "MASTER";
  if (/^-?\d+$/.test(value)) return Number(value);
  return null;
}

function parseScope(
  namespace: KojoVarNs,
  token: string | undefined,
  symbols: KojoSymbolTables,
): KojoVarScope | null {
  if (namespace === "FLAG" || namespace === "ITEM" || namespace === "TFLAG") return "GLOBAL";
  if (token === undefined) return "TARGET";
  // Parenthesised subjects are common in dynamic writes, for example
  // `CFLAG:(TARGET:LOCAL):...`.  Strip only a balanced outer pair so the
  // colon inside the subject remains available to the dedicated forms below.
  const normalized = normalizeColonWhitespace(stripOuterParens(token));
  if (/^(MASTER|PLAYER)$/i.test(normalized)) return "MASTER";
  if (/^TARGET$/i.test(normalized)) return "TARGET";
  // `TARGET:LOCAL` is Emuera's current secondary-target slot.  In the
  // importer it is represented by the same VM local slot used by the
  // surrounding kojo loop; this lets a caller provide the resolved value
  // without making the parser invent a persistent namespace.
  const targetLocal = /^TARGET:LOCAL(?::(\d+))?$/i.exec(normalized);
  if (targetLocal) return { kind: "local", index: Number(targetLocal[1] ?? 0) };
  const local = /^LOCAL(?::(\d+))?$/i.exec(normalized);
  if (local) return { kind: "local", index: Number(local[1] ?? 0) };
  const arg = /^ARG(?::(\d+))?$/i.exec(normalized);
  if (arg) return { kind: "arg", index: Number(arg[1] ?? 0) };
  if (/^(ASSI|DISH_ASSI|NUM|TRANSBEFORE|TRANSAFTER|K17C_ID|CLIENT_ID)$/i.test(normalized)) {
    return { kind: "alias", name: normalized.toUpperCase() };
  }
  const namedChara = /^\[\[([^\]]+)\]\]$/.exec(normalized);
  if (namedChara) return resolveKojoSymbol(symbols, "CHARA", namedChara[1]!);
  if (/^-?\d+$/.test(normalized)) return Number(normalized);
  const dynamic = parseValue(normalized, symbols);
  return dynamic ? { kind: "value", value: dynamic } : null;
}

function splitTopLevelColons(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') { index++; continue; }
      quoted = !quoted;
    } else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") depth--;
    else if (!quoted && depth === 0 && char === ":") {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function normalizeColonWhitespace(raw: string): string {
  let output = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') { output += '""'; index++; continue; }
      quoted = !quoted;
      output += char;
      continue;
    }
    if (!quoted && char === ":") {
      output = output.replace(/\s+$/, "") + ":";
      while (/\s/.test(raw[index + 1] ?? "")) index++;
      continue;
    }
    output += char;
  }
  return output;
}

function parseVarRef(
  raw: string,
  symbols: KojoSymbolTables,
): Extract<KojoValue, { kind: "var" }> | null {
  // Emuera accepts a character-only two-dimensional reference as index 0.
  // K9 uses `TALENT:MASTER` to read MASTER's TALENT:0 (処女).
  const zeroIndex = /^(TALENT|CFLAG|TCVAR|ABL|BASE|MAXBASE|DOWNBASE|EXP|PALAM|JUEL|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX):(TARGET|MASTER|PLAYER)$/i.exec(raw.trim());
  if (zeroIndex) {
    const ns = zeroIndex[1]!.toUpperCase() as KojoVarNs;
    const scope = parseScope(ns, zeroIndex[2]!.toUpperCase(), symbols);
    if (scope !== null) return { kind: "var", ns, scope, id: 0 };
  }
  const head = /^(TALENT|CFLAG|FLAG|ITEM|TFLAG|TCVAR|ABL|BASE|MAXBASE|DOWNBASE|EXP|PALAM|JUEL|CUP|CDOWN|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX):(.+)$/i.exec(raw.trim());
  if (!head) return null;
  const ns = head[1]!.toUpperCase() as KojoVarNs;
  const dimensions = splitTopLevelColons(head[2]!);
  const global = ns === "FLAG" || ns === "ITEM" || ns === "TFLAG";
  const idRaw = global ? head[2]! : dimensions.at(-1)!;
  const scopeRaw = global || dimensions.length === 1
    ? undefined
    : dimensions.slice(0, -1).join(":");
  const symbolNamespace = ns === "CUP" || ns === "CDOWN"
    ? "PALAM"
    : ns === "DOWNBASE"
      ? "BASE"
      : ns;
  const id = resolveKojoSymbol(symbols, symbolNamespace as KojoSymbolNamespace, idRaw);
  const scope = parseScope(ns, scopeRaw, symbols);
  if (id === null || scope === null || (typeof scope === "number" && !Number.isFinite(scope))) return null;
  return { kind: "var", ns, scope, id };
}

function parseDynamicVarRef(
  raw: string,
  symbols: ScopedKojoSymbols,
): Extract<KojoValue, { kind: "dynamic_var" }> | null {
  const head = /^(TALENT|CFLAG|FLAG|ITEM|TFLAG|TCVAR|ABL|BASE|MAXBASE|DOWNBASE|EXP|PALAM|JUEL|CUP|CDOWN|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX):(.+)$/i.exec(raw.trim());
  if (!head) return null;
  const ns = head[1]!.toUpperCase() as KojoVarNs;
  const dimensions = splitTopLevelColons(head[2]!);
  const global = ns === "FLAG" || ns === "ITEM" || ns === "TFLAG";
  const idRaw = global ? head[2]! : dimensions.at(-1)!;
  const scopeRaw = global || dimensions.length === 1 ? undefined : dimensions.slice(0, -1).join(":");
  const scope = parseScope(ns, scopeRaw, symbols);
  const id = parseValue(idRaw, symbols);
  return scope !== null && id && id.kind !== "string_literal"
    ? { kind: "dynamic_var", ns, scope, id }
    : null;
}

function parseCurrentLocationScope(
  raw: string,
  symbols: KojoSymbolTables,
): KojoSubjectScope | null {
  const location = parseVarRef(raw, symbols);
  return location?.ns === "CFLAG" &&
    location.id === 300 &&
    location.scope !== "GLOBAL" &&
    typeof location.scope !== "object"
    ? location.scope
    : null;
}

export type ScopedKojoSymbols = KojoSymbolTables & {
  readonly namedLocals?: ReadonlySet<string>;
  readonly namedStringLocals?: ReadonlySet<string>;
};

/** Stable non-persistent id used only to compare authored string locals. */
function kojoStringToken(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return 0x40000000 | (hash & 0x3fffffff);
}

function parseKojoStringValue(raw: string, symbols: ScopedKojoSymbols): KojoStringValue | null {
  const value = raw.trim();
  const quoted = /^"((?:[^"]|"")*)"$/.exec(value);
  if (quoted) return { kind: "string", value: quoted[1]!.replace(/""/g, '"') };
  const escaped = /^ESCAPE\("((?:[^"]|"")*)"\)$/i.exec(value);
  if (escaped) {
    const literal = escaped[1]!.replace(/""/g, '"');
    return { kind: "string", value: literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  }
  if (value === "DISH_TASTE") return { kind: "host-string", name: value };
  const local = /^LOCALS(?::(\d+))?$/i.exec(value);
  if (local) return { kind: "string-local-ref", index: Number(local[1] ?? 0) };
  if (symbols.namedStringLocals?.has(value)) return { kind: "string-local-ref", name: value };
  const result = /^RESULTS(?::(\d+))?$/i.exec(value);
  if (result) return { kind: "string-result-ref", index: Number(result[1] ?? 0) };
  const characterName = /^(NAME|CALLNAME):(.+)$/i.exec(value);
  if (characterName) {
    const subject = parseValue(characterName[2]!, symbols);
    if (subject) return { kind: "character-name-string", field: characterName[1]!.toUpperCase() as "NAME" | "CALLNAME", subject };
  }
  const cstr = /^CSTR:(.+)$/i.exec(value);
  if (!cstr) return null;
  const parts = cstr[1]!.split(":");
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;
  // `CSTR:key` is a target-local read; `CSTR:TARGET:key` and
  // `CSTR:MASTER:key` use an explicit owner.
  if (parts.length === 1) {
    return { kind: "cstr", subject: { kind: "subject", scope: "TARGET" }, key: parts[0]! };
  }
  const subject = parseValue(parts[0]!, symbols);
  const key = parts.slice(1).join(":");
  return subject && key ? { kind: "cstr", subject, key } : null;
}

/** Names of every `NAME(args)` function the parser tries to type-bind
 *  in `parseValue`. When `parseValue` returns null for a call, the
 *  comparison branch's function-call fallback would otherwise re-bind
 *  the same name as a generic `function-call-stub`. Tracking these
 *  here keeps the fallback narrow: it only fires for names the typed
 *  handlers didn't recognise. `OPENPLACE(TFLAG:50)` (invalid scope
 *  literal), `STRCOUNT(arg1, arg2)` (counted-strings), and the IFRAND
 *  family all stay on their original "unknown" / typed paths. */
const PARSE_VALUE_TYPED_FN_NAMES: ReadonlySet<string> = new Set([
  "ABS", "ALCOHOL_TASTE", "AT_HOME", "BATHROOM", "BEDROOM",
  "CANNOT_DANMAKU", "CHK_DATENOW", "CHK_FOCUS", "DATE_HITOGOMI", "ESTRUS_CYCLE",
  "EXP_UP", "EYEWITNESS", "FISHING_SIZE", "GETBIT", "GET_CHARAHOME",
  "GET_MAPID", "GET_TARGETNUM", "GET_UWAKI_HISTORY", "GROUPMATCH",
  "HAS_PENIS", "IFRAND", "INRANGE", "INROOM", "IN_HEAT",
  "IN_ROOM_NUMBER", "IS_ANGRY", "IS_DATING_WITH_PLAYER", "IS_DRUNK",
  "IS_ERECT", "IS_FALLEN", "IS_HERE", "IS_LIBRARY", "IS_LOVER",
  "IS_MASTER", "IS_NONHUMAN", "IS_SAMESEX", "IS_SEXING",
  "IS_STANDING_SEX", "IS_WEEKDAY", "IS_WEEKEND", "OMANEKIBEYA", "OPENPLACE", "OTOKOGIRAI",
  "RAND", "ROAD_TO", "SHIRAHU", "SOAKED_OR_NOT", "STRCOUNT", "STRFIND",
  "LIMIT", "ITEMPRICE",
  "CMATCH", "DATENAME_PLACE", "DATENAME_SPOT", "GET_MAP_REPLACEMENT", "GET_MONTH", "K17_GRT", "K17_GRT_EX", "K17_MAS_ALICE_CHECK_CHILD", "K40_WHERE_ABOUT", "K60_HAS_FUCKED_PARSEE", "K79_WHERE_ABOUT", "LOVER_COUNT", "M_KOJO_K70_BALANCE", "M_KOJO_K70_FUKIGEN", "M_KOJO_K70_SADISTIC", "M_KOJO_K70_SUZUNAAN", "M_KOJO_K70_UFUFU", "M_KOJO_K83_FUKIGEN", "M_KOJO_K83_YOIDORE", "M_KOJO_K83_UFUFU", "M_KOJO_K111_FUKIGEN", "M_KOJO_K111_JUNKO_KURASHI", "MOON_WATCH", "MOON_WATCH_POINT", "NAME_MOON", "NEMUKE", "STELLARIS_FALLDOWN_K98", "K78_EXCESSIVE_STATURE_GAP", "K78_BASIC_CONDITION_IN_MATING", "TASTE_REACTION",
  "WITH_MOB", "YOUBI_MATCH",
]);

const KOJO_JOB_IDS: Readonly<Record<string, number>> = {
  JOB_清掃: 40,
  JOB_会話: 41,
  JOB_戦闘: 42,
  JOB_教養: 43,
  JOB_料理: 44,
  JOB_音楽: 45,
  JOB_遊び: 46,
  JOB_商売: 47,
  JOB_宴会準備: 48,
  JOB_宴会参加: 49,
  JOB_宴会の片づけ: 50,
  JOB_酔いつぶれる: 51,
  JOB_お酒: 52,
  JOB_家事: 53,
  JOB_採集: 54,
  JOB_釣り: 55,
};

function parseValue(raw: string, symbols: ScopedKojoSymbols): KojoValue | null {
  const value = normalizeColonWhitespace(stripOuterParens(raw));
  if (/^[+-]?\d+$/.test(value)) return { kind: "number", value: Number(value) };
  if (/^[+-]?0x[\da-f]+$/i.test(value)) return { kind: "number", value: Number(value) };
  const jobId = KOJO_JOB_IDS[value];
  if (jobId !== undefined) return { kind: "number", value: jobId };
  const bitConstant = /^1p(\d+)$/i.exec(value);
  if (bitConstant) return { kind: "number", value: 2 ** Number(bitConstant[1]) };
  // task #15: bare quoted string literal `"..."` — capture as a
  // dedicated `string_literal` KojoValue so the comparison branch can
  // resolve `WHERE_ABOUT() == "室外"`-style compares. The same text is
  // surfaced through `evaluateValue.text` so the `compare` predicate
  // routes to strict-equal string semantics instead of numeric.
  const stringLiteral = /^"((?:[^"]|"")*)"$/.exec(value);
  if (stringLiteral) {
    return { kind: "string_literal", value: stringLiteral[1]!.replace(/""/g, '"') };
  }
  // GETNUM(NS, "label") is Emuera's runtime spelling for a symbol-table
  // lookup. Literal lookups are compile-time deterministic, so fold them
  // into a numeric value instead of routing a surrounding loop/effect
  // through an unknown helper call. Dynamic second arguments remain
  // unsupported and continue to fail closed.
  const getNum = parseFunctionArguments(value, "GETNUM");
  if (getNum?.length === 2) {
    const namespace = getNum[0]!.trim().toUpperCase();
    const symbolNamespace = [
      "CONST", "CHARA", "TALENT", "CFLAG", "FLAG", "ITEM", "TFLAG", "TCVAR",
      "ABL", "BASE", "MAXBASE", "EXP", "PALAM", "JUEL", "SOURCE", "EQUIP",
      "STAIN", "TEQUIP", "MARK", "EX", "NOWEX", "STR",
    ].includes(namespace) ? namespace as KojoSymbolNamespace : null;
    const literal = /^"((?:[^"]|"")*)"$/.exec(getNum[1]!.trim())?.[1]?.replace(/""/g, '"');
    if (symbolNamespace && literal !== undefined) {
      let id = resolveKojoSymbol(symbols, symbolNamespace, literal);
      // A few upstream personal libraries use the older short clothing
      // labels while Equip.csv exposes the canonical 上身/下身衣服 names.
      if (id === null && symbolNamespace === "EQUIP") {
        const alias: Record<string, string> = {
          "上半身１": "上身衣服１",
          "上半身２": "上身衣服２",
          "下半身１": "下身衣服",
        };
        const canonical = alias[literal];
        if (canonical) id = resolveKojoSymbol(symbols, symbolNamespace, canonical);
      }
      if (id !== null) return { kind: "number", value: id };
    }
  }
  const limit = parseFunctionArguments(value, "LIMIT");
  if (limit?.length === 3) {
    const [candidate, min, max] = limit.map((part) => parseValue(part, symbols));
    if (candidate && min && max) return { kind: "limit", value: candidate, min, max };
  }
  const itemPrice = /^ITEMPRICE:\s*(?:\((.+)\)|(.+))$/i.exec(value);
  if (itemPrice) {
    const item = parseValue((itemPrice[1] ?? itemPrice[2])!, symbols);
    if (item) return { kind: "item_price", item };
  }
  if (value === "CHARANUM") return { kind: "chara_count" };
  if (value === "拠点_家主") return { kind: "room_owner" };
  if (value === "LINECOUNT") return { kind: "line-count" };
  // Alice's optional second-run pack declares this SAVEDATA flag outside
  // the core character tables. A missing save slot is the upstream zero
  // value, so keep this guard deterministic without a VM-backed array.
  if (/^MAS_ALICE_ASSUME:\d+$/i.test(value)) return { kind: "number", value: 0 };
  const characterName = /^(NAME|CALLNAME):(.+)$/i.exec(value);
  if (characterName) {
    const subject = parseValue(characterName[2]!, symbols);
    if (subject) {
      return {
        kind: "character_name",
        field: characterName[1]!.toUpperCase() as "NAME" | "CALLNAME",
        subject,
      };
    }
  }
  if (value === "DISH_TYPE") return { kind: "dish_type" };
  if (value === "DISHNAME") return { kind: "dish_name" };
  const roomData = /^ROOMDATA:\((.+)\)$/i.exec(value);
  if (roomData) {
    const room = parseValue(roomData[1]!, symbols);
    if (room) return { kind: "room_data", room };
  }
  const dishNumber = /^DISH_(DRG_2|DRG|ASSI|BASEPOINT|TIME)$/i.exec(value);
  if (dishNumber) {
    const fields = {
      DRG_2: "drg2",
      DRG: "drg",
      ASSI: "assi",
      BASEPOINT: "basepoint",
      TIME: "time",
    } as const;
    return { kind: "dish_number", field: fields[dishNumber[1]!.toUpperCase() as keyof typeof fields] };
  }
  if (value === "PLAYER" || value === "MASTER") return { kind: "subject", scope: "MASTER" };
  if (value === "TARGET") return { kind: "subject", scope: "TARGET" };
  // Emuera's bare EQUIP is the target's slot-zero worn item.  It appears in
  // clothing narration as `SELECTCASE EQUIP`; leaving it to the generic
  // function-stub fallback would make the selector structurally parse but
  // always evaluate as an unknown helper.
  if (value === "EQUIP") return { kind: "var", ns: "EQUIP", scope: "TARGET", id: 0 };
  if (/^(ASSI|DISH_ASSI|NUM|TRANSBEFORE|TRANSAFTER|K17C_ID|CLIENT_ID)$/i.test(value)) {
    return { kind: "subject_alias", name: value.toUpperCase() };
  }
  const charaNo = /^NO:(TARGET|MASTER|PLAYER|-?\d+|\[\[[^\]]+\]\])$/.exec(value);
  if (charaNo) {
    if (charaNo[1] === "TARGET") return { kind: "subject", scope: "TARGET" };
    if (charaNo[1] === "MASTER" || charaNo[1] === "PLAYER") {
      return { kind: "subject", scope: "MASTER" };
    }
    if (/^-?\d+$/.test(charaNo[1]!)) return { kind: "number", value: Number(charaNo[1]) };
    const named = /^\[\[([^\]]+)\]\]$/.exec(charaNo[1]!);
    const resolved = named ? resolveKojoSymbol(symbols, "CHARA", named[1]!) : null;
    if (resolved !== null) return { kind: "number", value: resolved };
  }
  // DIM.ERH's area constants are 260/950, while modern authoritative
  // positions use the concrete room bridge P225/P935. Normalize the semantic
  // room names so authored comparisons follow the same location authority.
  if (value === "情人用宿屋") return { kind: "number", value: 225 };
  if (value === "情人旅館") return { kind: "number", value: 935 };
  // PLACE_ERH.ERH constants used by authored location gates. MAIN_MAP is
  // projected as the shrine map (0), while P8 is the shrine kitchen room.
  if (value === "MAP神社") return { kind: "number", value: 0 };
  if (value === "P8廚房") return { kind: "number", value: 8 };
  const namedChara = /^\[\[([^\]]+)\]\]$/.exec(value);
  if (namedChara) {
    const charaNum = resolveKojoSymbol(symbols, "CHARA", namedChara[1]!);
    if (charaNum !== null) return { kind: "number", value: charaNum };
  }

  // STR:(numeric expression) dereferences a display string. SELECTCASE uses
  // the same numeric STR id in its quoted CASE labels, so retaining the id
  // gives the numeric runtime exact string-selection semantics without
  // persisting a second string-valued selector type.
  const strLookup = /^STR:\((.+)\)$/.exec(value);
  if (strLookup) return parseValue(strLookup[1]!, symbols);

  const stringCount = parseFunctionArguments(value, "STRCOUNT");
  if (stringCount?.length === 2) {
    const source = parseKojoStringValue(stringCount[0]!, symbols);
    const pattern = parseKojoStringValue(stringCount[1]!, symbols);
    if (source && pattern) return { kind: "string_count", source, pattern };
  }

  const ifrand = parseFunctionArguments(value, "IFRAND");
  if (ifrand && ifrand.length >= 2 && ifrand.length % 2 === 0) {
    const groups: Array<{ spec: string; condition: KojoPredicate }> = [];
    for (let index = 0; index < ifrand.length; index += 2) {
      const spec = /^"((?:[^"]|"")*)"$/.exec(ifrand[index]!.trim());
      if (!spec) return null;
      groups.push({
        spec: spec[1]!.replace(/""/g, '"'),
        condition: parsePredicate(ifrand[index + 1]!, symbols),
      });
    }
    return { kind: "ifrand", groups };
  }

  const expUp = parseFunctionArguments(value, "EXP_UP");
  if (expUp && (expUp.length === 1 || expUp.length === 2)) {
    const expId = parseValue(expUp[0]!, symbols);
    const subject = expUp.length === 2
      ? parseValue(expUp[1]!, symbols)
      : ({ kind: "subject", scope: "MASTER" } as const);
    if (expId && subject) return { kind: "exp_up", expId, subject };
  }

  const pregnancyPossible = parseFunctionArguments(value, "妊娠可否");
  if (pregnancyPossible?.length === 1) {
    const subject = parseValue(pregnancyPossible[0]!, symbols);
    if (subject) return { kind: "pregnancy_possible", subject };
  }
  const stringFind = parseFunctionArguments(value, "STRFIND");
  if (stringFind?.length === 2) {
    const source = parseKojoStringValue(stringFind[0]!, symbols);
    const pattern = parseKojoStringValue(stringFind[1]!, symbols);
    if (source && pattern) return { kind: "string_find", source, pattern };
  }
  for (const [name, weekend] of [["IS_WEEKDAY", false], ["IS_WEEKEND", true]] as const) {
    const weekday = parseFunctionArguments(value, name);
    if (weekday?.length === 1) {
      const day = parseValue(weekday[0]!, symbols);
      if (day) return { kind: "weekday_test", day, weekend };
    }
  }

  if (parseFunctionArguments(value, "NEMUKE")?.length === 0) return { kind: "nemuke" };
  if (parseFunctionArguments(value, "LOVER_COUNT")?.length === 0) return { kind: "lover_count" };

  const getMonth = parseFunctionArguments(value, "GET_MONTH");
  if (getMonth && getMonth.length <= 1) {
    const season = getMonth.length === 1 ? parseValue(getMonth[0]!, symbols) : undefined;
    if (getMonth.length === 0 || season) return { kind: "get_month", ...(season ? { season } : {}) };
  }
  const moonWatch = parseFunctionArguments(value, "MOON_WATCH");
  if (moonWatch && moonWatch.length >= 1 && moonWatch.length <= 2) {
    const date = parseValue(moonWatch[0]!, symbols);
    const ignoreLocation = moonWatch.length === 2 ? parseValue(moonWatch[1]!, symbols) : undefined;
    if (date && (moonWatch.length === 1 || ignoreLocation)) {
      return { kind: "moon_watch", date, ...(ignoreLocation ? { ignoreLocation } : {}) };
    }
  }
  const nameMoon = parseFunctionArguments(value, "NAME_MOON");
  if (nameMoon?.length === 1) {
    const date = parseValue(nameMoon[0]!, symbols);
    if (date) return { kind: "name_moon", date };
  }
  const datePlace = parseFunctionArguments(value, "DATENAME_PLACE");
  if (datePlace && datePlace.length <= 1) {
    const untranslated = datePlace.length === 1 ? parseValue(datePlace[0]!, symbols) : undefined;
    if (datePlace.length === 0 || untranslated) {
      return { kind: "date_name", field: "place", ...(untranslated ? { untranslated } : {}) };
    }
  }
  if (parseFunctionArguments(value, "DATENAME_SPOT")?.length === 0) {
    return { kind: "date_name", field: "spot" };
  }
  const cmatch = parseFunctionArguments(value, "CMATCH");
  if (cmatch?.length === 2) {
    const field = /^([A-Z_]+):(.+)$/i.exec(cmatch[0]!.trim());
    const expected = parseValue(cmatch[1]!, symbols);
    if (field && expected) {
      const ns = field[1]!.toUpperCase() as KojoVarNs;
      const id = resolveKojoSymbol(symbols, ns as KojoSymbolNamespace, field[2]!.trim());
      if (id !== null) return { kind: "cmatch", ns, id, expected };
    }
  }
  const chkFocus = parseFunctionArguments(value, "CHK_FOCUS");
  if (chkFocus?.length === 3) {
    const min = parseValue(chkFocus[0]!, symbols);
    const current = parseValue(chkFocus[1]!, symbols);
    const max = parseValue(chkFocus[2]!, symbols);
    if (min && current && max) return { kind: "in_range", value: current, min, max };
  }
  const tasteReaction = parseFunctionArguments(value, "TASTE_REACTION");
  if (tasteReaction?.length === 1) {
    const tag = /^"((?:[^"]|"")*)"$/.exec(tasteReaction[0]!.trim());
    if (tag) return { kind: "taste_reaction", tag: tag[1]!.replace(/""/g, '"') };
  }
  if (parseFunctionArguments(value, "K17_MAS_ALICE_CHECK_CHILD")?.length === 0) {
    return { kind: "k17_master_alice_child" };
  }
  if (parseFunctionArguments(value, "K60_HAS_FUCKED_PARSEE")?.length === 0) {
    return { kind: "k60_has_fucked_parsee" };
  }
  for (const [name, helper, arity] of [
    ["M_KOJO_K70_FUKIGEN", "fukigen", 1],
    ["M_KOJO_K70_SADISTIC", "sadistic", 1],
    ["M_KOJO_K70_UFUFU", "ufufu", 0],
    ["M_KOJO_K70_BALANCE", "balance", 2],
  ] as const) {
    const helperArgs = parseFunctionArguments(value, name);
    if (helperArgs?.length !== arity) continue;
    const subjects = helperArgs.map((arg) => parseValue(arg, symbols));
    if (subjects.every((subject): subject is KojoValue => subject !== null)) {
      return { kind: "k70_helper", helper, subjects };
    }
  }
  for (const [name, helper] of [
    ["M_KOJO_K83_FUKIGEN", "fukigen"],
    ["M_KOJO_K83_YOIDORE", "yoidore"],
    ["M_KOJO_K83_UFUFU", "ufufu"],
  ] as const) {
    const helperArgs = parseFunctionArguments(value, name);
    if (helperArgs?.length !== 1) continue;
    const subject = parseValue(helperArgs[0]!, symbols);
    if (subject) return { kind: "k83_helper", helper, subject };
  }
  for (const [functionName, name, minArgs, maxArgs] of [
    ["STELLARIS_FALLDOWN_K98", "stellaris_falldown_k98", 0, 0],
    ["K78_EXCESSIVE_STATURE_GAP", "k78_excessive_stature_gap", 0, 1],
    ["K78_BASIC_CONDITION_IN_MATING", "k78_basic_condition_in_mating", 0, 1],
    ["M_KOJO_K111_FUKIGEN", "k111_fukigen", 1, 1],
    ["M_KOJO_K111_JUNKO_KURASHI", "k111_junko_kurashi", 0, 0],
    ["MOON_WATCH_POINT", "moon_watch_point", 1, 1],
    ["K17_GRT", "k17_grt", 0, 1],
    // K17_GRT_EX starts from K17_GRT and adds volatile mood modifiers.
    // The deterministic static runtime owns the stable relationship rank;
    // transient extras stay fail-closed instead of making the player route
    // depend on KojoVM.
    ["K17_GRT_EX", "k17_grt", 0, 1],
    ["M_KOJO_K70_SUZUNAAN", "k70_suzunaan", 1, 1],
    ["GET_MAP_REPLACEMENT", "get_map_replacement", 1, 1],
  ] as const) {
    const rawArgs = parseFunctionArguments(value, functionName);
    if (!rawArgs || rawArgs.length < minArgs || rawArgs.length > maxArgs) continue;
    const parsedArgs = rawArgs.map((arg) => parseValue(arg, symbols));
    if (parsedArgs.every((arg): arg is KojoValue => arg !== null)) {
      return { kind: "authored_state_helper", name, args: parsedArgs };
    }
  }
  if (parseFunctionArguments(value, "K40_WHERE_ABOUT")?.length === 0 ||
      parseFunctionArguments(value, "K79_WHERE_ABOUT")?.length === 0) {
    return { kind: "where_about" };
  }

  for (const [name, helper] of [
    ["K120_INSEMINATION_POSSIBLE", "insemination_possible"],
    ["K120_IS_DANGEROUS_DAYS", "dangerous_days"],
    ["K120_ENDING_POSSIBLE", "ending_possible"],
  ] as const) {
    if (parseFunctionArguments(value, name)?.length === 0) {
      return { kind: "k120_helper", helper };
    }
  }

  const k60Attitude = parseFunctionArguments(value, "K60_ATTITUDE");
  if (k60Attitude && k60Attitude.length <= 1) {
    const argument = k60Attitude.length === 1 ? parseValue(k60Attitude[0]!, symbols) : undefined;
    if (k60Attitude.length === 0 || argument) {
      return { kind: "k60_attitude", ...(argument ? { argument } : {}) };
    }
  }

  const k49Relationship = parseFunctionArguments(value, "关系_310");
  if (k49Relationship && k49Relationship.length <= 1) {
    const subject = k49Relationship.length === 1 ? parseValue(k49Relationship[0]!, symbols) : undefined;
    if (k49Relationship.length === 0 || subject) {
      return { kind: "k49_relationship", ...(subject ? { subject } : {}) };
    }
  }

  for (const [name, speaker, acquaintances] of [
    ["K139_FIND_AROUND", 139, [140, 142, 141, 29, 42, 65]],
    ["K42_FIND_AROUND", 42, [29, 65, 51, 49, 38, 1]],
    ["K76_FIND_AROUND", 76, [30, 43, 1]],
  ] as const) {
    if (parseFunctionArguments(value, name)?.length === 0) {
      return { kind: "find_around", speaker, acquaintances };
    }
  }
  for (const [name, speaker] of [
    ["K139_FIND_LOVER", 139],
    ["K42_FIND_LOVER", 42],
    ["K76_FIND_LOVER", 76],
    ["K30_FIND_LOVER", 30],
  ] as const) {
    if (parseFunctionArguments(value, name)?.length === 0) {
      return { kind: "find_lover", speaker };
    }
  }
  for (const [name, speaker] of [["K139_BE_SEEN", 139], ["K30_BE_SEEN", 30]] as const) {
    if (parseFunctionArguments(value, name)?.length === 0) {
      return { kind: "be_seen", speaker };
    }
  }
  if (parseFunctionArguments(value, "FORM_K113")?.length === 0) {
    return { kind: "form_k113" };
  }
  for (const [name, helper, required] of [
    ["K15_LIKES_PLAYER", "likes_player", false],
    ["K15_HATE", "hate", false],
    ["K15_PLAYER_IS_SDM_RESIDENT", "player_is_sdm_resident", false],
    ["K15_PLAYER_IN_SDM", "player_in_sdm", false],
    ["K15_LOVER_LOVE", "lover_love", false],
    ["K15_LUST", "lust", true],
  ] as const) {
    const helperArgs = parseFunctionArguments(value, name);
    if (!helperArgs || helperArgs.length > 1 || (required && helperArgs.length !== 1)) continue;
    const argument = helperArgs.length === 1 ? parseValue(helperArgs[0]!, symbols) : undefined;
    if (helperArgs.length === 0 || argument) {
      return { kind: "k15_helper", helper, ...(argument ? { argument } : {}) };
    }
  }

  const getBit = parseFunctionArguments(value, "GETBIT");
  if (getBit?.length === 2) {
    const source = parseValue(getBit[0]!, symbols);
    const bit = parseValue(getBit[1]!, symbols);
    if (source && bit) return { kind: "get_bit", value: source, bit };
  }

  const inRange = parseFunctionArguments(value, "INRANGE");
  if (inRange?.length === 3) {
    const [candidate, min, max] = inRange.map((part) => parseValue(part, symbols));
    if (candidate && min && max) return { kind: "in_range", value: candidate, min, max };
  }

  const youbi = parseFunctionArguments(value, "YOUBI_MATCH");
  if (youbi?.length === 2) {
    const day = parseValue(youbi[0]!, symbols);
    const weekdays = /^"([日月火水木金土]+)"$/.exec(youbi[1]!.trim());
    if (day && weekdays) return { kind: "youbi_match", day, weekdays: weekdays[1]! };
  }

  const uwakiHistory = parseFunctionArguments(value, "GET_UWAKI_HISTORY");
  if (uwakiHistory?.length === 2) {
    const witness = parseValue(uwakiHistory[0]!, symbols);
    const partner = parseValue(uwakiHistory[1]!, symbols);
    if (witness && partner) return { kind: "uwaki_history", witness, partner };
  }

  const abs = parseFunctionArguments(value, "ABS");
  if (abs?.length === 1) {
    const inner = parseValue(abs[0]!, symbols);
    if (inner) return { kind: "abs", value: inner };
  }

  for (const [name, op] of [["MIN", "min"], ["MAX", "max"]] as const) {
    const args = parseFunctionArguments(value, name);
    if (args && args.length > 0) {
      const values = args.map((part) => parseValue(part, symbols));
      if (values.every((part): part is KojoValue => part !== null)) {
        return { kind: "minmax", op, values };
      }
    }
  }

  const soaked = parseFunctionArguments(value, "SOAKED_OR_NOT");
  if (soaked && (soaked.length === 1 || soaked.length === 2)) {
    const mode = /^"(V_SEMINAL|A_SEMINAL|SECRETIONAL)"$/.exec(soaked[0]!.trim())?.[1] as
      | "V_SEMINAL" | "A_SEMINAL" | "SECRETIONAL" | undefined;
    const subject = soaked.length === 2
      ? parseValue(soaked[1]!, symbols)
      : ({ kind: "subject", scope: "TARGET" } as const);
    if (mode && subject) return { kind: "soaked_or_not", mode, subject };
  }

  const fishingSize = parseFunctionArguments(value, "FISHING_SIZE");
  if (fishingSize?.length === 1) {
    const fishId = parseValue(fishingSize[0]!, symbols);
    if (fishId) return { kind: "fishing_size", fishId };
  }
  const fishsizeRecord = /^FISHSIZE_RECORD:\((.+)\)$/i.exec(value);
  if (fishsizeRecord) {
    const fishId = parseValue(fishsizeRecord[1]!, symbols);
    if (fishId) return { kind: "fishsize_record", fishId };
  }
  const fishExp = /^FISH_EXP:(?:\((.+)\)|([^()]+))$/i.exec(value);
  if (fishExp) {
    const fishId = parseValue((fishExp[1] ?? fishExp[2])!, symbols);
    if (fishId) return { kind: "fish_exp", fishId };
  }

  const mapId = parseFunctionArguments(value, "GET_MAPID");
  if (mapId?.length === 1) {
    const source = parseValue(mapId[0]!, symbols);
    if (source) return { kind: "map_id", value: source };
  }

  const omanekiBeya = parseFunctionArguments(value, "OMANEKIBEYA");
  if (omanekiBeya?.length === 0) return { kind: "omaneki_beya" };

  const inRoomNumber = parseFunctionArguments(value, "IN_ROOM_NUMBER");
  if (inRoomNumber?.length === 1) {
    const room = parseValue(inRoomNumber[0]!, symbols);
    if (room) return { kind: "in_room_number", room };
  }

  const roadTo = parseFunctionArguments(value, "ROAD_TO");
  if (roadTo?.length === 1) {
    const mapId = parseValue(roadTo[0]!, symbols);
    if (mapId) return { kind: "road_to", mapId };
  }

  const openPlace = parseFunctionArguments(value, "OPENPLACE");
  if (openPlace?.length === 1) {
    const scope = parseCurrentLocationScope(openPlace[0]!, symbols);
    if (scope !== null) return { kind: "open_place", scope };
  }

  const charaHome = parseFunctionArguments(value, "GET_CHARAHOME");
  if (charaHome?.length === 1) {
    const subject = parseValue(charaHome[0]!, symbols);
    if (subject) return { kind: "get_charahome", subject };
  }

  const yogore = /^YOGORE:(?:\((.+)\)|(-?\d+))$/u.exec(value);
  if (yogore) {
    const room = yogore[1]
      ? parseValue(yogore[1], symbols)
      : { kind: "number" as const, value: Number(yogore[2]) };
    if (room) return { kind: "yogore", room };
  }

  const cannotDanmaku = parseFunctionArguments(value, "CANNOT_DANMAKU");
  if (cannotDanmaku?.length === 0) return { kind: "cannot_danmaku" };

  const k30CheckHenT = parseFunctionArguments(value, "K30_CHECK_HEN_T");
  if (k30CheckHenT?.length === 0) return { kind: "k30_check_hen_t" };

  const k30Drunk = parseFunctionArguments(value, "K30_DRUNK");
  if (k30Drunk?.length === 0) return { kind: "k30_drunk" };

  const k15HateAnger = parseFunctionArguments(value, "K15_HATE_ANGER");
  if (k15HateAnger?.length === 0) return { kind: "k15_hate_anger" };

  for (const [name, helper] of [
    ["K2_EXCESSIVE_STATURE_GAP", "excessive_stature_gap"],
    ["K2_BASIC_CONDITION_IN_MATING", "basic_condition_in_mating"],
    ["K2_SEXUAL_FRANKNESS", "sexual_frankness"],
  ] as const) {
    const helperArgs = parseFunctionArguments(value, name);
    if (helperArgs?.length === 0 || helperArgs?.length === 1) {
      const subject = helperArgs.length === 0
        ? ({ kind: "subject", scope: "TARGET" } as const)
        : parseValue(helperArgs[0]!, symbols);
      if (subject) return { kind: "k2_helper", helper, subject };
    }
  }

  const estrusCycle = parseFunctionArguments(value, "ESTRUS_CYCLE");
  if (estrusCycle?.length === 1) {
    const subject = parseValue(estrusCycle[0]!, symbols);
    if (subject) return { kind: "estrus_cycle", subject };
  }

  const isDrunk = parseFunctionArguments(value, "IS_DRUNK");
  if (isDrunk?.length === 1) {
    const subject = parseValue(isDrunk[0]!, symbols);
    if (subject) return { kind: "is_drunk", subject };
  }

  const alcoholTaste = parseFunctionArguments(value, "ALCOHOL_TASTE");
  if (alcoholTaste?.length === 1) {
    const item = parseValue(alcoholTaste[0]!, symbols);
    if (item) return { kind: "alcohol_taste", item };
  }

  const shirahu = parseFunctionArguments(value, "SHIRAHU");
  if (shirahu?.length === 1) {
    const subject = parseValue(shirahu[0]!, symbols);
    if (subject) return { kind: "shirahu", subject };
  }

  const otokoGirai = parseFunctionArguments(value, "OTOKOGIRAI");
  if (otokoGirai?.length === 1) {
    const subject = parseValue(otokoGirai[0]!, symbols);
    if (subject) return { kind: "otoko_girai", subject };
  }

  // The current deterministic world has no crowd/MOB simulation. These
  // helpers only guard an optional extra bystander message, so model their
  // absent-world value explicitly rather than making the preceding authored
  // command prose fail closed.
  const crowdArgs = parseFunctionArguments(value, "DATE_HITOGOMI");
  if (crowdArgs && crowdArgs.length <= 1) {
    return { kind: "number", value: 0 };
  }
  if (parseFunctionArguments(value, "WITH_MOB")?.length === 0) {
    return { kind: "number", value: 0 };
  }
  if (parseFunctionArguments(value, "EYEWITNESS")?.length === 0) {
    return { kind: "number", value: 0 };
  }

  const hasPenis = parseFunctionArguments(value, "HAS_PENIS");
  if (hasPenis?.length === 1) {
    const subject = parseValue(hasPenis[0]!, symbols);
    if (subject) return { kind: "has_penis", subject };
  }

  for (const [name, test] of [
    ["IS_MALE", "male"],
    ["IS_FEMALE", "female"],
    ["IS_FUTA", "futa"],
    ["HAS_VAGINA", "vagina"],
  ] as const) {
    const args = parseFunctionArguments(value, name);
    if (args?.length === 1) {
      const subject = parseValue(args[0]!, symbols);
      if (subject) return { kind: "gender_test", test, subject };
    }
  }

  const sameSex = parseFunctionArguments(value, "IS_SAMESEX");
  if (sameSex?.length === 2) {
    const left = parseValue(sameSex[0]!, symbols);
    const right = parseValue(sameSex[1]!, symbols);
    if (left && right) return { kind: "same_sex", left, right };
  }

  for (const [name, test] of [["IS_VIRGIN", "virgin"], ["IS_DOUTEI", "doutei"]] as const) {
    const args = parseFunctionArguments(value, name);
    if (args?.length === 1) {
      const subject = parseValue(args[0]!, symbols);
      if (subject) return { kind: "virgin_test", test, subject };
    }
  }

  const fallen = parseFunctionArguments(value, "IS_FALLEN");
  if (fallen?.length === 0 || fallen?.length === 1) {
    const subject = fallen.length === 0
      ? ({ kind: "subject", scope: "TARGET" } as const)
      : parseValue(fallen[0]!, symbols);
    if (subject) return { kind: "fallen", subject };
  }

  const angry = parseFunctionArguments(value, "IS_ANGRY");
  if (angry?.length === 0 || angry?.length === 1) {
    const subject = angry.length === 0
      ? ({ kind: "subject", scope: "TARGET" } as const)
      : parseValue(angry[0]!, symbols);
    if (subject) return { kind: "angry", subject };
  }

  const inHeat = parseFunctionArguments(value, "IN_HEAT");
  if (inHeat?.length === 0 || inHeat?.length === 1) {
    const subject = inHeat.length === 0
      ? ({ kind: "subject", scope: "TARGET" } as const)
      : parseValue(inHeat[0]!, symbols);
    if (subject) return { kind: "in_heat", subject };
  }

  const isLover = parseFunctionArguments(value, "IS_LOVER");
  if (isLover?.length === 1) {
    const subject = parseValue(isLover[0]!, symbols);
    if (subject) return { kind: "is_lover", subject };
  }

  const isDatingWithPlayer = parseFunctionArguments(value, "IS_DATING_WITH_PLAYER");
  if (isDatingWithPlayer?.length === 1) {
    const subject = parseValue(isDatingWithPlayer[0]!, symbols);
    if (subject) return { kind: "is_dating_with_player", subject };
  }

  const isSexing = parseFunctionArguments(value, "IS_SEXING");
  if (isSexing?.length === 0 || isSexing?.length === 1) {
    const subject = isSexing.length === 0
      ? ({ kind: "subject", scope: "TARGET" } as const)
      : parseValue(isSexing[0]!, symbols);
    if (subject) return { kind: "is_sexing", subject };
  }

  const isMaster = parseFunctionArguments(value, "IS_MASTER");
  if (isMaster && isMaster.length >= 1 && isMaster.length <= 10) {
    const subjects = isMaster.map((part) => parseValue(part, symbols));
    if (subjects.every((subject): subject is KojoValue => subject !== null)) {
      return { kind: "is_master", subjects };
    }
  }

  for (const [name, test] of [["IS_BAD_WEATHER", "bad_weather"], ["IS_STORM", "storm"]] as const) {
    const args = parseFunctionArguments(value, name);
    if (args?.length === 0) return { kind: "weather_test", test };
  }

  const nonhuman = parseFunctionArguments(value, "IS_NONHUMAN");
  if (nonhuman?.length === 0 || nonhuman?.length === 1) {
    const subject = nonhuman.length === 0
      ? ({ kind: "subject", scope: "MASTER" } as const)
      : parseValue(nonhuman[0]!, symbols);
    if (subject) return { kind: "is_nonhuman", subject };
  }

  const isLibrary = parseFunctionArguments(value, "IS_LIBRARY");
  if (isLibrary?.length === 1 || isLibrary?.length === 2) {
    const place = parseValue(isLibrary[0]!, symbols);
    const permission = isLibrary.length === 2
      ? parseValue(isLibrary[1]!, symbols)
      : ({ kind: "number", value: 0 } as const);
    if (place && permission) return { kind: "is_library", place, permission };
  }

  const standingSex = parseFunctionArguments(value, "IS_STANDING_SEX");
  if (standingSex?.length === 1) {
    const command = parseValue(standingSex[0]!, symbols);
    if (command) return { kind: "is_standing_sex", command };
  }

  const erect = parseFunctionArguments(value, "IS_ERECT");
  if (erect?.length === 1) {
    const subject = parseValue(erect[0]!, symbols);
    if (subject) return { kind: "erect", subject };
  }

  const working = parseFunctionArguments(value, "仕事中チェック");
  if (working?.length === 1) {
    const subject = parseValue(working[0]!, symbols);
    if (subject) return { kind: "working", subject };
  }

  // Hatate's K42_BOKKI is a one-line wrapper around IS_ERECT(MASTER) in
  // Lib/M_KOJO_K42_関数ライブラリ.ERB. Normalize the transparent alias at
  // parse time instead of adding a character-specific runtime branch.
  const k42Bokki = parseFunctionArguments(value, "K42_BOKKI");
  if (k42Bokki?.length === 0) {
    return { kind: "erect", subject: { kind: "subject", scope: "MASTER" } };
  }

  const isHere = parseFunctionArguments(value, "IS_HERE");
  if (isHere && isHere.length > 0) {
    const subjects = isHere.map((part) => parseValue(part, symbols));
    if (subjects.every((subject): subject is KojoValue => subject !== null)) {
      return { kind: "is_here", subjects };
    }
  }

  const groupMatch = parseFunctionArguments(value, "GROUPMATCH");
  if (groupMatch && groupMatch.length >= 2) {
    const parsed = groupMatch.map((part) => parseValue(part, symbols));
    if (parsed.every((part): part is KojoValue => part !== null)) {
      return {
        kind: "group_match",
        value: parsed[0]!,
        candidates: parsed.slice(1),
      };
    }
  }

  const relationshipHelpers = [
    ["陷落状态", "fall"],
    ["陥落状態", "fall"],
    ["情感状态", "emotion"],
    ["情感狀態", "emotion"],
  ] as const;
  for (const [name, flavor] of relationshipHelpers) {
    const relationshipArgs = parseFunctionArguments(value, name);
    if (relationshipArgs && relationshipArgs.length <= 1) {
      const subject = relationshipArgs.length === 0
        ? ({ kind: "subject", scope: "TARGET" } as const)
        : parseValue(relationshipArgs[0]!, symbols);
      if (subject) return { kind: "relationship_state", flavor, subject };
    }
  }

  const inRoomArgs = parseFunctionArguments(value, "INROOM");
  if (inRoomArgs?.length === 1) {
    const scope = parseCurrentLocationScope(inRoomArgs[0]!, symbols);
    if (scope !== null) return { kind: "in_room", scope };
  }

  for (const [name, test] of [
    ["BATHCHECK", "bath"],
    ["OUTROOF", "out_roof"],
    ["IN_HOME", "in_home"],
  ] as const) {
    const locationArgs = parseFunctionArguments(value, name);
    if (locationArgs?.length === 1) {
      const scope = parseCurrentLocationScope(locationArgs[0]!, symbols);
      if (scope !== null) return { kind: "location_test", test, scope };
    }
  }

  const bathroomArgs = parseFunctionArguments(value, "BATHROOM");
  if (bathroomArgs) {
    if (bathroomArgs.length === 0) {
      return { kind: "location_test", test: "bathroom", scope: "MASTER" };
    }
    if (bathroomArgs.length === 1) {
      const scope = parseCurrentLocationScope(bathroomArgs[0]!, symbols);
      if (scope !== null) return { kind: "location_test", test: "bathroom", scope };
    }
  }

  const bedroomArgs = parseFunctionArguments(value, "BEDROOM");
  if (bedroomArgs) {
    if (bedroomArgs.length === 0) {
      return { kind: "location_test", test: "bedroom", scope: "MASTER" };
    }
    if (bedroomArgs.length === 1) {
      const scope = parseCurrentLocationScope(bedroomArgs[0]!, symbols);
      if (scope !== null) return { kind: "location_test", test: "bedroom", scope };
    }
  }

  const atHomeArgs = parseFunctionArguments(value, "AT_HOME");
  if (atHomeArgs?.length === 1) {
    const subject = parseValue(atHomeArgs[0]!, symbols);
    if (subject) return { kind: "at_home", subject };
  }

  const dateNowArgs = parseFunctionArguments(value, "CHK_DATENOW");
  if (dateNowArgs?.length === 1) {
    const mapId = parseValue(dateNowArgs[0]!, symbols);
    if (mapId) return { kind: "date_now", mapId };
  }

  const targetCountArgs = parseFunctionArguments(value, "GET_TARGETNUM");
  if (targetCountArgs?.length === 0) return { kind: "target_count" };

  const fillRate = parseFunctionArguments(value, "充填率");
  if (fillRate && (fillRate.length === 2 || fillRate.length === 3)) {
    const scope = parseSubjectScope(fillRate[0]!);
    const bodyPart = Number(fillRate[1]);
    const cumulative = fillRate.length === 3 ? Number(fillRate[2]) : 0;
    if (
      scope !== null &&
      Number.isInteger(bodyPart) &&
      bodyPart >= 1 &&
      bodyPart <= 5 &&
      (cumulative === 0 || cumulative === 1)
    ) {
      return {
        kind: "fill_rate",
        scope,
        bodyPart: bodyPart as 1 | 2 | 3 | 4 | 5,
        cumulative: cumulative === 1,
      };
    }
  }

  const ternary = splitTopLevelTernary(value);
  if (ternary) {
    const whenTrue = parseValue(ternary.whenTrue, symbols);
    const whenFalse = parseValue(ternary.whenFalse, symbols);
    if (whenTrue && whenFalse) {
      return {
        kind: "conditional",
        condition: parsePredicate(ternary.condition, symbols),
        whenTrue,
        whenFalse,
      };
    }
  }

  // Parse from lowest to highest precedence. Rightmost splitting preserves
  // left associativity for operators at the same precedence level.
  const bitwiseOr = splitTopLevelBinary(value, ["|"]);
  if (bitwiseOr) {
    const left = parseValue(bitwiseOr.left, symbols);
    const right = parseValue(bitwiseOr.right, symbols);
    if (!left || !right) return null;
    return { kind: "binary", op: "|", left, right };
  }

  const bitwise = splitTopLevelBinary(value, ["&"]);
  if (bitwise) {
    const left = parseValue(bitwise.left, symbols);
    const right = parseValue(bitwise.right, symbols);
    if (!left || !right) return null;
    return { kind: "binary", op: "&", left, right };
  }

  const additive = splitTopLevelBinary(value, ["+", "-"]);
  if (additive) {
    const left = parseValue(additive.left, symbols);
    const right = parseValue(additive.right, symbols);
    if (!left || !right) return null;
    return additive.op === "+"
      ? { kind: "add", parts: [left, right] }
      : { kind: "binary", op: "-", left, right };
  }

  const multiplicative = splitTopLevelBinary(value, ["*", "/", "%"]);
  if (multiplicative) {
    const left = parseValue(multiplicative.left, symbols);
    const right = parseValue(multiplicative.right, symbols);
    if (!left || !right) return null;
    return {
      kind: "binary",
      op: multiplicative.op as "*" | "/" | "%",
      left,
      right,
    };
  }

  // Comparisons are numeric in expression contexts too. Emuera coerces a
  // true condition to 1 and a false condition to 0, which is used by
  // dynamic RAND/LIMIT bounds such as `2 + (ABL:... > 2) * 2`.
  // Keep this after arithmetic splitting so a comparison nested in
  // parentheses is parsed as the conditional sub-expression rather than as
  // a malformed comparison spanning the surrounding arithmetic.
  if (/(?:==|!=|>=|<=|>|<)/.test(value)) {
    const condition = parsePredicate(value, symbols);
    if (condition.kind !== "unknown" && condition.kind !== "unknown_var_nonzero") {
      return {
        kind: "conditional",
        condition,
        whenTrue: { kind: "number", value: 1 },
        whenFalse: { kind: "number", value: 0 },
      };
    }
  }

  const arg = /^ARG(?::(\d+))?$/.exec(value);
  if (arg) return { kind: "arg", index: arg[1] ? Number(arg[1]) : 0 };

  if (value === "SELECTCOM") {
    return { kind: "turn", field: "selectCom", index: 0 };
  }
  if (value === "PREVCOM") {
    return { kind: "turn", field: "prevCom", index: 0 };
  }
  const result = /^RESULT(?::(\d+))?$/.exec(value);
  if (result) {
    return {
      kind: "turn",
      field: "result",
      index: result[1] ? Number(result[1]) : 0,
    };
  }
  const local = /^LOCAL(?::(\d+))?$/.exec(value);
  if (local) {
    return {
      kind: "turn",
      field: "local",
      index: local[1] ? Number(local[1]) : 0,
    };
  }
  const namedArray = /^([\p{L}_][\p{L}\p{N}_]*):(.+)$/u.exec(value);
  if (namedArray && symbols.namedLocals?.has(namedArray[1]!)) {
    const index = parseValue(namedArray[2]!, symbols);
    if (index) return { kind: "named_array", name: namedArray[1]!, index };
  }
  // Global declarations are supplied to the bundle parser as named locals,
  // but reserved runtime projections must keep their state-backed meaning.
  // In particular, `MAIN_MAP` is declared in upstream headers and otherwise
  // gets shadowed by that declaration table, causing the Browser bundle to
  // emit an unbound `#DIM MAIN_MAP` predicate while KojoCache evaluates the
  // same source correctly.
  if (value === "money" || value === "MONEY") return { kind: "state", field: "money" };
  if (/^MONEY:\s*2$/i.test(value)) return { kind: "state", field: "casino_chips" };
  if (value === "MAIN_MAP") return { kind: "state", field: "main_map" };
  // Encounter packs use this scratch name together with LINECOUNT to guard
  // optional print buffers.  It is not a persistent game variable and is
  // safe to model as a transient named local even when the caller did not
  // carry the source #DIM table into a later runtime re-parse.
  if (value === "gLineCount") return { kind: "named_local", name: value };
  if (symbols.namedLocals?.has(value)) return { kind: "named_local", name: value };
  if (symbols.namedStringLocals?.has(value)) return { kind: "named_string_local", name: value };

  const stringLocal = /^LOCALS(?::(\d+))?$/.exec(value);
  if (stringLocal) return { kind: "string_local", index: Number(stringLocal[1] ?? 0) };

  const diaryMax = /^MAX_DIARY_PAGE:(.+):0$/i.exec(value);
  if (diaryMax) {
    const subject = parseValue(diaryMax[1]!, symbols);
    if (subject) return { kind: "diary_max_page", subject };
  }
  const diaryFlag = /^DIARY:(.+)$/.exec(value);
  if (diaryFlag) {
    const dimensions = splitTopLevelColons(diaryFlag[1]!);
    const subject = dimensions.length === 2 ? parseValue(dimensions[0]!, symbols) : null;
    const page = dimensions.length === 2 ? parseValue(dimensions[1]!, symbols) : null;
    if (subject && page) return { kind: "diary_flag", subject, page };
  }
  const pageSet = /^PAGESET:(.+)$/i.exec(value);
  if (pageSet) {
    const dimensions = splitTopLevelColons(pageSet[1]!);
    const subject = dimensions.length === 2 ? parseValue(dimensions[0]!, symbols) : null;
    const slot = dimensions.length === 2 ? parseValue(dimensions[1]!, symbols) : null;
    if (subject && slot) return { kind: "diary_page_set", subject, slot };
  }

  // `CHILD_ACT:CHARA:CHILDNUM` is a string-valued CHARADATA array.  Keep the
  // selector in the control-flow tree even though the modern runtime does not
  // yet own the child-action table; its host boundary will fail closed rather
  // than discarding the whole SELECTCASE as malformed syntax.
  const childAct = /^CHILD_ACT:(.+)$/i.exec(value);
  if (childAct) {
    const indices = splitTopLevelColons(childAct[1]!).map((part) => parseValue(part, symbols));
    if (indices.every((part): part is KojoValue => part !== null)) {
      return { kind: "host_string_array", name: "CHILD_ACT", indices };
    }
  }

  const hostArray = /^(STONE_PLAYCOUNT|LEARNED_MENU|PRIVATEROOM|CHILD_SEX_PREG):(.+)$/i.exec(value);
  if (hostArray) {
    const indices = splitTopLevelColons(hostArray[2]!).map((part) => parseValue(part, symbols));
    if (indices.every((part): part is KojoValue => part !== null)) {
      return { kind: "host_array", name: hostArray[1]!.toUpperCase(), indices };
    }
  }

  if (value === "DAY") return { kind: "day", index: 0 };
  const day = /^DAY:\s*(\d+)$/.exec(value);
  if (day) return { kind: "day", index: Number(day[1]) };

  if (value === "TIME") return { kind: "time", index: 0 };
  const time = /^TIME:\s*(\d+)$/.exec(value);
  if (time) return { kind: "time", index: Number(time[1]) };
  if (value === "天候") return { kind: "time", index: 5 };

  const activity = /^(Activity_Type|Activity_Duration)(?::(TARGET|MASTER|PLAYER|-?\d+))?$/i.exec(value);
  if (activity) {
    const scope = parseScope("CFLAG", activity[2], symbols);
    if (scope === null) return null;
    return {
      kind: "activity",
      field: activity[1]!.toLowerCase() === "activity_type" ? "type" : "duration",
      scope,
    };
  }

  const palamLevel = /^PALAMLV:(\d+)$/.exec(value);
  if (palamLevel) return { kind: "palam_level", level: Number(palamLevel[1]) };

  const rand = /^RAND:\s*(\d+)$/i.exec(value);
  if (rand) return { kind: "rand", max: Math.max(1, Number(rand[1])) };

  const dynamicRand = /^RAND:\s*\((.+)\)$/i.exec(value);
  if (dynamicRand) {
    const max = parseValue(dynamicRand[1]!, symbols);
    if (max) return { kind: "dynamic_rand", max };
  }
  const dynamicRandBare = /^RAND:\s*(.+)$/i.exec(value);
  if (dynamicRandBare) {
    const max = parseValue(dynamicRandBare[1]!, symbols);
    if (max) return { kind: "dynamic_rand", max };
  }

  const randCall = parseFunctionArguments(value, "RAND");
  if (randCall?.length === 2) {
    const min = parseValue(randCall[0]!, symbols);
    const max = parseValue(randCall[1]!, symbols);
    if (min && max) {
      // Emuera's RAND(min, max) returns min <= n < max. Reuse the
      // deterministic one-bound host instead of introducing a second RNG
      // operation into the portable Kojo value IR.
      return {
        kind: "add",
        parts: [
          min,
          {
            kind: "dynamic_rand",
            max: { kind: "binary", op: "-", left: max, right: min },
          },
        ],
      };
    }
  }
  if (randCall?.length === 1 && /^\d+$/.test(randCall[0]!.trim())) {
    return { kind: "rand", max: Math.max(1, Number(randCall[0])) };
  }

  const stringArg = /^ARGS(?::(\d+))?$/.exec(value);
  if (stringArg) return { kind: "string_arg", index: stringArg[1] ? Number(stringArg[1]) : 0 };

  // Source-backed helper calls rather than generic CALL chains. Keep their
  // zero-argument form in the value IR so the router can evaluate them
  // against the canonical world state. Most are numeric; `FESTIVAL` returns
  // the current festival name as a string label (used as a FIRSTTIME key in
  // `FESTIVAL() + "_1"`, K77).
  for (const name of [
    "SUKIMA",
    "KICKOUT",
    "THINKS_IS_VIRGIN",
    "MASTER_IS_VIRGIN",
    "K15_DESIRE_INTIMACY",
    "K36_MASTER_LOVER_NUMBER",
    "FESTIVAL",
    "K88_KYOKO_GET_VARSION",
  ] as const) {
    const call = parseFunctionArguments(value, name);
    if (call) return { kind: "function-call-stub", name, args: call };
  }

  // Unary numeric NOT is used by a few direct equipment toggles
  // (`TEQUIP:X = !TEQUIP:X`). Lower the bounded variable form to a
  // conditional value so it follows the same read/evaluate/write path as
  // other numeric expressions without introducing a second effect API.
  if (value.startsWith("!")) {
    const operand = parseValue(value.slice(1), symbols);
    if (operand?.kind === "var") {
      return {
        kind: "conditional",
        condition: { kind: "var_nonzero", ns: operand.ns, scope: operand.scope, id: operand.id },
        whenTrue: { kind: "number", value: 0 },
        whenFalse: { kind: "number", value: 1 },
      };
    }
  }

  const dayEventConstant = parseDayEventConstant(value);
  if (dayEventConstant !== null) return { kind: "number", value: dayEventConstant };

  const privateConstant = resolveKojoSymbol(symbols, "CONST", value);
  if (privateConstant !== null) return { kind: "number", value: privateConstant };

  return parseVarRef(value, symbols) ?? parseDynamicVarRef(value, symbols);
}

/** Parse the static form of COMMON.ERB's ASK_M helper.
 *
 * ASK_M receives alternating `(label, enabled)` arguments and returns the
 * selected argument index in RESULT. The full helper also supports dynamic
 * disabled/hidden options and redraws them in a different colour. The static
 * kojo tree has no redraw channel, so only compile-time numeric conditions are
 * lowered here: negative options are hidden, zero options are not selectable,
 * and positive options become ordinary choice options. Dynamic conditions
 * stay outside this static lowering path; unresolved helper calls retain the
 * parser's existing behavior instead of poisoning an otherwise routable
 * legacy dialogue route.
 */
function buildAskMChoice(
  rawArgs: readonly string[],
  line: number,
  ctx: SubstituteContext,
  opts: ParseFuncOptions,
  symbols: ScopedKojoSymbols,
): KojoNode | null {
  if (rawArgs.length === 0 || rawArgs.length % 2 !== 0 || rawArgs.length > 20) return null;

  const options: KojoChoiceOption[] = [];
  for (let argIndex = 0; argIndex < rawArgs.length; argIndex += 2) {
    const label = parseAskMLabel(rawArgs[argIndex]!, ctx, opts);
    const condition = parseValue(rawArgs[argIndex + 1]!, symbols);
    if (label === null || !condition || condition.kind !== "number" || !Number.isFinite(condition.value)) {
      return null;
    }
    const optionIndex = argIndex / 2;
    if (condition.value < 0 || condition.value === 0) continue;
    options.push({
      label,
      value: String(optionIndex),
      body: {
        type: "seq",
        children: [{
          type: "result-set",
          index: 0,
          op: "set",
          value: { kind: "number", value: optionIndex },
          line,
        }],
      },
    });
  }

  return options.length > 0 ? { type: "choice", options, line } : null;
}

function parseAskMLabel(
  raw: string,
  ctx: SubstituteContext,
  opts: ParseFuncOptions,
): string | null {
  const trimmed = raw.trim();
  const quoted = parseStaticStringArgument(trimmed);
  const expression = /^@"((?:[^"]|"")*)"$/.exec(trimmed);
  const literal = quoted ?? (expression ? expression[1]!.replace(/""/g, '"') : null);
  if (literal === null) return null;
  return opts.substitute === false ? literal : substitute(literal, ctx);
}

/** Parse one static-call argument with the same symbol/local rules as the
 * regular parser. This is only for the small source-backed host-call
 * allowlist, not a general ERB evaluator. */
export function parseKojoValue(raw: string, symbols: ScopedKojoSymbols): KojoValue | null {
  return parseValue(raw, symbols);
}

function parseEffectTarget(raw: string, symbols: KojoSymbolTables): KojoEffectTarget | null {
  const normalized = normalizeColonWhitespace(stripOuterParens(raw));
  const diarySubjectScope = (subjectRaw: string): KojoEffectTarget["scope"] | null => {
    const subject = parseValue(subjectRaw, symbols);
    if (!subject) return null;
    if (subject.kind === "number") return subject.value;
    if (subject.kind === "subject") return subject.scope;
    return null;
  };
  const diaryMax = /^MAX_DIARY_PAGE:(.+):0$/i.exec(normalized);
  if (diaryMax) {
    const scope = diarySubjectScope(diaryMax[1]!);
    return scope === null ? null : { ns: "MAX_DIARY_PAGE", scope, id: 0 };
  }
  for (const [namespace, pattern] of [
    ["DIARY", /^DIARY:(.+)$/i],
    ["PAGESET", /^PAGESET:(.+)$/i],
  ] as const) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const dimensions = splitTopLevelColons(match[1]!);
    if (dimensions.length !== 2) return null;
    const scope = diarySubjectScope(dimensions[0]!);
    const index = parseValue(dimensions[1]!, symbols);
    if (scope === null || index?.kind !== "number" || !Number.isSafeInteger(index.value)) return null;
    return { ns: namespace, scope, id: index.value };
  }
  const money = /^MONEY(?::(\d+))?$/i.exec(normalized);
  if (money) {
    const id = Number(money[1] ?? 0);
    // The modern global owner exposes ordinary money (0) and casino chips
    // (2). Reject unknown dimensions instead of accepting a no-op write.
    if (id === 0 || id === 2) return { ns: "MONEY", scope: "GLOBAL", id };
    return null;
  }
  const time = /^TIME(?::(\d+))?$/i.exec(normalized);
  if (time) return { ns: "TIME", scope: "GLOBAL", id: Number(time[1] ?? 0) };
  const parsed = parseVarRef(normalized, symbols);
  if (!parsed) return null;
  if (
    parsed.ns !== "CFLAG" &&
    parsed.ns !== "TFLAG" &&
    parsed.ns !== "TCVAR" &&
    parsed.ns !== "EXP" &&
    parsed.ns !== "MARK" &&
    parsed.ns !== "ABL" &&
    parsed.ns !== "TALENT" &&
    parsed.ns !== "BASE" &&
    parsed.ns !== "MAXBASE" &&
    parsed.ns !== "DOWNBASE" &&
    parsed.ns !== "PALAM" &&
    parsed.ns !== "FLAG" &&
    parsed.ns !== "ITEM" &&
    parsed.ns !== "JUEL" &&
    parsed.ns !== "EX" &&
    parsed.ns !== "EQUIP" &&
    parsed.ns !== "STAIN" &&
    parsed.ns !== "TEQUIP" &&
    parsed.ns !== "CUP" &&
    parsed.ns !== "CDOWN" &&
    parsed.ns !== "SOURCE" &&
    parsed.ns !== "NOWEX" &&
    parsed.ns !== "TIME"
  ) {
    return null;
  }
  return { ns: parsed.ns as KojoEffectTarget["ns"], scope: parsed.scope, id: parsed.id };
}

function parseStringEffectTarget(raw: string, symbols: KojoSymbolTables): KojoStringEffectTarget | null {
  const normalized = normalizeColonWhitespace(stripOuterParens(raw));
  const cstr = /^CSTR:(.+):(.+)$/i.exec(normalized);
  if (cstr) {
    const subject = parseValue(cstr[1]!, symbols);
    const key = parseValue(cstr[2]!, symbols);
    if (!subject || !key || key.kind !== "number") return null;
    const scope = subject.kind === "number"
      ? subject.value
      : subject.kind === "subject"
        ? subject.scope
        : null;
    return scope === null ? null : { ns: "CSTR", scope, id: key.value };
  }
  const nickname = /^NICKNAME:(\d+)$/i.exec(normalized);
  return nickname
    ? { ns: "NICKNAME", scope: "GLOBAL", id: Number(nickname[1]) }
    : null;
}

function parseEffect(raw: string, line: number, symbols: KojoSymbolTables): KojoEffect | null {
  if (CONTROL_FLOW_RE.test(raw.trim())) return null;
  const displayName = /^MASTERNAME:(\d+)\s*=\s*(.+?)\s*$/.exec(raw);
  if (displayName) {
    const displayValue = displayName[2]!.trim();
    const parsedValue = parseStringAssignmentValue(displayValue, symbols);
    // A display name must not be committed from an unresolved RESULT slot.
    // Keep this authored path fail-closed; RESULT/RESULTS are transient
    // continuation values and are only safe in local string templates where
    // the static router can deliberately substitute an empty value.
    if (
      parsedValue?.kind === "string-template" &&
      parsedValue.parts.some((part) => part.kind === "results")
    ) {
      return null;
    }
    if (!parsedValue) return null;
    return {
      kind: "display-name",
      observer: Number(displayName[1]),
      subject: 0,
      value: parsedValue as KojoStringValue,
      line,
    };
  }
  const assignment = ASSIGNMENT_RE.exec(raw);
  if (assignment) {
    const stringTarget = parseStringEffectTarget(assignment[1]!, symbols);
    if (stringTarget) {
      if (assignment[2] !== "=") return null;
      const stringValue = parseStringAssignmentValue(assignment[3]!, symbols);
      return stringValue
        ? { kind: "string-set", target: stringTarget, value: stringValue as KojoStringValue, line }
        : null;
    }
  }
  const fishIncrement = /^(FISH_EXP|FISHSIZE_RECORD):(?:\((.+)\)|([^()]+))\s*(\+\+|--)$/i.exec(raw);
  if (fishIncrement) {
    const fishId = parseValue((fishIncrement[2] ?? fishIncrement[3])!, symbols);
    if (!fishId) return null;
    return {
      kind: "fish-ledger",
      field: fishIncrement[1]!.toUpperCase() === "FISH_EXP" ? "count" : "record",
      fishId,
      op: "add",
      value: { kind: "number", value: fishIncrement[4] === "++" ? 1 : -1 },
      line,
    };
  }
  const fishAssignment = /^(FISH_EXP|FISHSIZE_RECORD):(?:\((.+)\)|([^()]+))\s*(=|\+=|-=|=\+|=-)\s*(.+)$/i.exec(raw);
  if (fishAssignment) {
    const fishId = parseValue((fishAssignment[2] ?? fishAssignment[3])!, symbols);
    const parsedValue = parseValue(fishAssignment[5]!, symbols);
    if (!fishId || !parsedValue) return null;
    return {
      kind: "fish-ledger",
      field: fishAssignment[1]!.toUpperCase() === "FISH_EXP" ? "count" : "record",
      fishId,
      op: fishAssignment[4] === "=" ? "set" : "add",
      value: fishAssignment[4] === "-="
        ? { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: parsedValue }
        : fishAssignment[4] === "=-"
          ? { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: parsedValue }
        : parsedValue,
      line,
    };
  }
  const bit = BIT_EFFECT_RE.exec(raw);
  if (bit) {
    const target = parseEffectTarget(bit[2]!, symbols);
    const value = parseValue(bit[3]!, symbols);
    if (!target || !value) return null;
    return {
      kind: bit[1] === "SETBIT" ? "set-bit" : "clear-bit",
      target,
      bit: value,
      line,
    };
  }

  if (!assignment) return null;
  const target = parseEffectTarget(assignment[1]!, symbols);
  const value = parseValue(assignment[3]!, symbols);
  if (!target || !value) return null;
  switch (assignment[2]) {
    case "=":
      return { kind: "set", target, value, line };
    case "+=":
      return { kind: "add", target, value, line };
    case "-=":
      return {
        kind: "add",
        target,
        value: { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: value },
        line,
      };
    case "=+":
      return { kind: "add", target, value, line };
    case "=-":
      return {
        kind: "add",
        target,
        value: { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: value },
        line,
      };
    case "|=":
      return { kind: "or", target, value, line };
    case "&=":
      return { kind: "and", target, value, line };
    case "*=":
    case "=*":
      return { kind: "multiply", target, value, line };
    case "/=":
    case "=/":
      return { kind: "divide", target, value, line };
    case "%=":
    case "=%":
      return { kind: "mod", target, value, line };
    default:
      return null;
  }
}

function unsupportedEffectReason(raw: string): string | null {
  if (CONTROL_FLOW_RE.test(raw.trim())) return null;
  if (BIT_EFFECT_RE.test(raw)) return "unsupported set-bit target or expression";
  if (ASSIGNMENT_RE.test(raw)) return "unsupported assignment target or expression";
  return null;
}

/**
 * Parse an `IF` condition into a `KojoPredicate`. Handles `&&`, leading
 * `!`, the transparent `LOCAL` / `RESULT` wrappers, variable refs with
 * optional `== n`, and function calls (→ `unknown`).
 */
export function parsePredicate(
  raw: string,
  symbols: KojoSymbolTables = DEFAULT_KOJO_SYMBOLS,
): KojoPredicate {
  const expression = stripOuterParens(raw);

  // task #4: handle the empty-predicate edge case. The IF-regex /
  // SIF-regex require at least one character but downstream code paths
  // (`substituteLocals` mapping, ternary split, etc.) can still call
  // `parsePredicate("")` when an authored arm body starts with a
  // comment or when a stripped sub-expression collapses. Promote to
  // `always` so the route stays supported and the body still emits.
  if (expression === "") {
    return { kind: "always" };
  }

  const or = splitTopLevel(expression, "||");
  if (or) return { kind: "or", parts: or.map((part) => parsePredicate(part, symbols)) };

  const and = splitTopLevel(expression, "&&");
  if (and) return { kind: "and", parts: and.map((part) => parsePredicate(part, symbols)) };

  if (expression.startsWith("!")) {
    return { kind: "not", inner: parsePredicate(expression.slice(1), symbols) };
  }

  if (expression === "1") {
    return { kind: "always" };
  }
  if (expression === "0") return { kind: "never" };
  if (/^K\d+_CONSCIOUS_AND_TOLERANT\([^)]*\)$/.test(expression)) {
    return { kind: "always" };
  }
  for (const memoryName of ["FIRSTTIME", "ONCE"] as const) {
    const memoryArgs = parseFunctionArguments(expression, memoryName);
    if (!memoryArgs || memoryArgs.length === 0 || memoryArgs.length > 3) continue;
    const key = memoryArgs[0]!.trim();
    // CSTR-backed FIRSTTIME keys are either a numeric event id, SELECTCOM,
    // or an ERB string literal. Keep dynamic strings opaque except the
    // runtime's explicit {SELECTCOM} interpolation below.
    // `TRAINNAME:SELECTCOM` (eraTW's standard command first-run gate) is a
    // per-command dynamic key: Emuera resolves it to the selected command's
    // label. Treating it as a literal keeps it in `memory_first` instead of
    // the function-call fallback (which evaluates to `false`, wrongly
    // skipping the first-run branch — e.g. Keine's first touch triggered the
    // 反发 kojo). The runtime resolves it to a `TRAINNAME:{commandNo}` slot.
    const isLiteralKey =
      key === "SELECTCOM" ||
      key === "TRAINNAME:SELECTCOM" ||
      /^-?\d+$/.test(key) ||
      /^@?"(?:[^"]|"")*"$/.test(key);
    const keyValue = isLiteralKey ? null : parseValue(key, symbols);
    if (!isLiteralKey && !isSafeMemoryKeyValue(keyValue)) continue;

    const updateArg = memoryArgs[1]?.trim() ?? "";
    if (updateArg !== "" && updateArg !== "0" && updateArg !== "1") continue;

    const scopeArg = memoryArgs[2]?.trim();
    let scope: KojoSubjectScope | undefined;
    if (scopeArg === undefined || scopeArg === "" || scopeArg === "TARGET") {
      scope = "TARGET";
    } else if (scopeArg === "MASTER" || scopeArg === "PLAYER" || scopeArg === "-1") {
      scope = "MASTER";
    } else if (/^\d+$/.test(scopeArg)) {
      scope = Number(scopeArg);
    } else {
      const namedChara = /^\[\[([^\]]+)\]\]$/.exec(scopeArg);
      const charaNum = namedChara ? resolveKojoSymbol(symbols, "CHARA", namedChara[1]!) : null;
      if (charaNum !== null) scope = charaNum;
      else continue;
    }

    return {
      kind: "memory_first",
      memory: memoryName,
      key,
      ...(keyValue ? { keyValue } : {}),
      update: updateArg !== "1",
      scope,
    };
  }

  const comparison = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/.exec(expression);
  if (comparison) {
    const stringArg = /^ARGS(?::(\d+))?$/.exec(comparison[1]!.trim());
    const stringLiteral = /^"((?:[^"]|"")*)"$/.exec(comparison[3]!.trim());
    if (
      stringArg &&
      stringLiteral &&
      (comparison[2] === "==" || comparison[2] === "!=")
    ) {
      return {
        kind: "string_arg_compare",
        index: stringArg[1] ? Number(stringArg[1]) : 0,
        op: comparison[2],
        expected: stringLiteral[1]!.replace(/""/g, '"'),
      };
    }
    const festivalArgs = parseFunctionArguments(comparison[1]!.trim(), "FESTIVAL");
    const festivalText = /^"([^"]*)"$/.exec(comparison[3]!.trim());
    if (
      festivalArgs?.length === 0 &&
      (comparison[2] === "==" || comparison[2] === "!=") &&
      festivalText
    ) {
      return { kind: "festival_compare", op: comparison[2], expected: festivalText[1]! };
    }
    const faceArgs = parseFunctionArguments(comparison[1]!.trim(), "ALCOHOL_FACE");
    const faceText = /^"(清醒|微醺|醉酒|不省人事)"$/.exec(comparison[3]!.trim());
    if (faceArgs?.length === 1 && (comparison[2] === "==" || comparison[2] === "!=") && faceText) {
      const subject = parseValue(faceArgs[0]!, symbols);
      if (subject) {
        return {
          kind: "alcohol_face_compare",
          subject,
          op: comparison[2],
          expected: faceText[1] as "清醒" | "微醺" | "醉酒" | "不省人事",
        };
      }
    }
    const left = parseValue(comparison[1]!, symbols);
    const right = parseValue(comparison[3]!, symbols);
    // task #4: bare-identifier comparison fallback. `parseValue` returns
    // null for whole tokens it does not recognise as a typed `var`,
    // `arg`, `rand`, `number`, etc. — but the modern symbol table knows
    // about system-level identifiers like `MODE`, `DISH_TYPE`,
    // `DISH_DRG`, `iRT`, `LOCALS`, `NAME:MASTER`, `CALLNAME:MASTER`,
    // `前面指令`, etc. and the authored code often compares them to a
    // string literal or to another bare identifier (K17's `iRT >=
    // K17C_恋慕`). Before falling through to `kind:"unknown"` (which
    // classifies as `unsupported-expression`), capture the comparison
    // structurally. Runtime resolves each side against
    // `systemVarAccessor`; missing bindings evaluate to `""`/0 and the
    // predicate returns `false`, so ELSE arms still fire and the route
    // stays supported.
    if (left === null || right === null) {
      const op = comparison[2] as
        | "=="
        | "!="
        | ">="
        | "<="
        | ">"
        | "<";
      const lText = comparison[1]!.trim();
      const rText = comparison[3]!.trim();
      const lBare = isBareSystemIdentifier(lText);
      const rBare = isBareSystemIdentifier(rText);
      if (lBare || rBare) {
        return {
          kind: "system_var_compare",
          left: lText,
          op,
          right: rText,
        };
      }
      // task #15: function-call comparison fallback. When either
      // side is a `NAME(args)` shape (e.g. `K139_FIND_AROUND() == 140`,
      // `M_KOJO_K70_FUKIGEN(70) == 1`, `K40_WHERE_ABOUT() == "室外"`),
      // and `parseValue` returned null because the helper name is not
      // one of its known keys, try `parseFunctionCallStub` directly to
      // produce a `function-call-stub` value for that side. With at
      // least one side recognised we emit a `compare { left, right, op }`
      // node; the runtime consults `FUNCTION_CALL_VALUE_REGISTRY` for
      // function-call-stub values and resolves the comparison. The
      // other side uses its successfully-parsed value (left or right),
      // or a numeric-default fallback when both sides failed
      // `parseValue` (rare, e.g. `KC() == K77C_*()` where neither is
      // parseable but both are stubs).
      //
      // Important: skip when the helper name is one of the typed
      // handlers' registered names (OPENPLACE / STRCOUNT / IFRAND /
      // etc.). They exhausted their arg-shape checks in `parseValue`
      // and intentionally returned null; promoting the call here
      // would silently re-classify `OPENPLACE(TFLAG:50)` (or anything
      // else with wrong-typed args) as a supported function-call,
      // which `OPENPLACE(TFLAG:50) >= 2` test cases rely on being
      // `kind:"unknown"`.
      const lStub = parseFunctionCallStub(lText);
      const rStub = parseFunctionCallStub(rText);
      const lIsTyped = lStub !== null && PARSE_VALUE_TYPED_FN_NAMES.has(lStub.name);
      const rIsTyped = rStub !== null && PARSE_VALUE_TYPED_FN_NAMES.has(rStub.name);
      if ((lStub && !lIsTyped) || (rStub && !rIsTyped)) {
        const otherValue = (v: KojoValue | null, stub: typeof lStub, isTyped: boolean): KojoValue => {
          if (stub && !isTyped) {
            return { kind: "function-call-stub", name: stub.name, args: stub.args };
          }
          if (v) return v;
          return { kind: "number" as const, value: 0 };
        };
        const lValue = otherValue(left, lStub, lIsTyped);
        const rValue = otherValue(right, rStub, rIsTyped);
        return {
          kind: "compare",
          left: lValue,
          op,
          right: rValue,
        };
      }
    }
    if (left && right) {
      if (left.kind === "var" && right.kind === "number" && comparison[2] === "==") {
        return {
          kind: "var_eq",
          ns: left.ns,
          scope: left.scope,
          id: left.id,
          value: right.value,
        };
      }
      if (left.kind === "arg" && right.kind === "number" && comparison[2] === "==") {
        return { kind: "arg_eq", index: left.index, value: right.value };
      }
      if (left.kind === "rand" && right.kind === "number" && comparison[2] === "==") {
        return { kind: "rand_eq", max: left.max, value: right.value };
      }
      return {
        kind: "compare",
        left,
        op: comparison[2] as "==" | "!=" | ">=" | "<=" | ">" | "<",
        right,
      };
    }
    return { kind: "unknown", raw: expression };
  }

  const value = parseValue(expression, symbols);
  if (value) {
    if (value.kind === "var") {
      return { kind: "var_nonzero", ns: value.ns, scope: value.scope, id: value.id };
    }
    if (value.kind === "arg") return { kind: "arg_nonzero", index: value.index };
    if (value.kind === "rand") return { kind: "rand_nonzero", max: value.max };
    if (value.kind === "number") {
      return value.value === 0 ? { kind: "never" } : { kind: "always" };
    }
    if (value.kind === "function-call-stub") {
      return { kind: "function-call", name: value.name, args: value.args };
    }
    return { kind: "truthy", value };
  }

  // task #4: bare system identifier fallback. `parseValue` returned
  // null because the token is a whole identifier (`DISH_DRG`,
  // `DAYEVENT_SCENARIO`, `MODE`, etc.) that doesn't fit any typed
  // `var` / `arg` / `rand` / `number` shape. Promote to
  // `system_var_compare` against an empty RHS so the route stays
  // supported and the runtime resolves the LHS via
  // `resolveSystemVarAccessor`. Missing bindings fall through to
  // "empty == ''" → false → ELSE arm fires.
  if (isBareSystemIdentifier(expression)) {
    return {
      kind: "system_var_compare",
      left: expression,
      op: "==",
      right: "",
    };
  }

  // Final fallback: if the expression looks like a var reference
  // `NS[:SCOPE]:IDENT`, accept it as a soft-fallback predicate so the
  // AST stays structured and the route remains supported. Runtime
  // evaluates these as `false` so the ELSE arm wins; real bindings
  // are added per task #15.
  const unknownVar = parseUnknownVarRef(expression);
  if (unknownVar) return unknownVar;

  // Second-level fallback: bare function-call shapes that `parseValue`
  // didn't catch (e.g. when the expression had operator characters
  // upstream of the call but the splitter landed the call on its own).
  // `parseFunctionCallStub` is safe to call here: it only matches the
  // strict `NAME(args)` and bare `NAME` patterns.
  const stub = parseFunctionCallStub(expression);
  if (stub) return { kind: "function-call", name: stub.name, args: stub.args };

  return { kind: "unknown", raw: expression };
}

/**
 * Detect a permissive `NS[:SCOPE]:IDENT` shape and return a
 * `unknown_var_nonzero` predicate. Keeps the AST structured so the
 * kojo-coverage validator counts these as supported predicates instead
 * of falling through to `kind: "unknown"`.
 *
 * Recognised:
 *   - `CFLAG:既成事實` (bare id, scope defaults to TARGET upstream)
 *   - `CFLAG:K42C_結婚` (author-defined `K{n}C_` chara-index scope)
 *   - `TALENT:(NO:30):恋慕` (parenthesised expression scope)
 *   - `TALENT:ARG:恋人` (numeric / arg scope)
 *   - `CFLAG:既成事實 & ...` (NOT matched — & splits at parsePredicate
 *     level; this helper only sees the bare `CFLAG:既成事實` side)
 *
 * IDs are kept verbatim as strings — the runtime cannot resolve them
 * without a per-author symbol table; the predicate always evaluates
 * to `false` so the surrounding ELSE arm fires.
 */
export function parseUnknownVarRef(
  raw: string,
): Extract<KojoPredicate, { kind: "unknown_var_nonzero" }> | null {
  // NS list mirrors KojoVarNs minus the host-only NOWEX/SOURCE/CUP/CDOWN
  // (those have dedicated handlers upstream). Keep permissive about
  // case so author-written `cflag:` still parses.
  const match = /^(TALENT|CFLAG|FLAG|TCVAR|ABL|BASE|MAXBASE|EXP|PALAM|JUEL|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX|ITEM|TFLAG)(?::(.+))?:(.+)$/i.exec(
    raw.trim(),
  );
  if (!match) return null;
  // Avoid matching obvious non-vars: bit operations (`A & B`) and string
  // comparisons (`NS:X == "y"`) are handled by earlier branches of
  // parsePredicate. If the id looks like an operator/space chain, bail.
  const id = match[3]!.trim();
  if (!id || /^(==|!=|>=|<=|>|<|\+|-|\*|\/|%|\(|\)|&&|\|\|)$/.test(id)) return null;
  // Scope is opaque — preserved verbatim. Parser does not need to
  // resolve it; runtime never reads it.
  const scope = (match[2] ?? "TARGET").trim();
  return {
    kind: "unknown_var_nonzero",
    ns: match[1]!.toUpperCase() as KojoVarNs,
    scope,
    id,
  };
}

/** True if `p` (anywhere in its tree) reads `RESULT` / `RESULTS:N`.
 *  Used by the `input` hook to detect `PRINTL + INPUT + IF RESULT` patterns
 *  and decide whether to consume the pending menu. */
function predicateReadsResult(p: KojoPredicate): boolean {
  switch (p.kind) {
    case "always":
    case "never":
      return false;
    case "var_nonzero":
    case "var_eq":
    case "rand_nonzero":
    case "rand_eq":
    case "arg_nonzero":
    case "arg_eq":
    case "alcohol_face_compare":
    case "string_arg_compare":
    case "festival_compare":
    case "memory_first":
      return false;
    case "truthy":
      return kojoValueReadsResult(p.value);
    case "compare":
      return kojoValueReadsResult(p.left) || kojoValueReadsResult(p.right);
    case "not":
      return predicateReadsResult(p.inner);
    case "and":
    case "or":
      return p.parts.some(predicateReadsResult);
    case "unknown_var_nonzero":
    case "system_var_compare":
    case "function-call":
    case "unknown":
      return false;
  }
}

function kojoValueReadsResult(v: KojoValue): boolean {
  return v.kind === "turn" && v.field === "result";
}

/** Extract a matcher describing how this predicate consumes `RESULT`.
 *  - `IF RESULT` → `{kind: "truthy"}`
 *  - `IF RESULT == N` (or `N == RESULT`) → `{kind: "equals", value: N}`
 *  - Returns null when the predicate doesn't read RESULT, or reads it
 *    in a way V1 doesn't model (e.g. ranges, comparisons against another
 *    variable). Caller should treat null as a rollback signal. */
function extractResultMatcher(p: KojoPredicate): KojoInputMatcher | null {
  switch (p.kind) {
    case "truthy":
      if (p.value.kind === "turn" && p.value.field === "result") return { kind: "truthy" };
      return null;
    case "compare":
      if (p.op !== "==") return null;
      {
        const leftIsRes = p.left.kind === "turn" && p.left.field === "result";
        const rightIsRes = p.right.kind === "turn" && p.right.field === "result";
        if (leftIsRes && p.right.kind === "number") return { kind: "equals", value: p.right.value };
        if (rightIsRes && p.left.kind === "number") return { kind: "equals", value: p.left.value };
      }
      return null;
    default:
      return null;
  }
}

function isSafeMemoryKeyValue(value: KojoValue | null): value is KojoValue {
  return (
    value?.kind === "number" ||
    (value?.kind === "var" && value.ns === "TFLAG") ||
    (value?.kind === "add" && value.parts.every((part) =>
      part.kind === "number" || (part.kind === "var" && part.ns === "TFLAG"),
    )) ||
    isSafeMemoryStringKeyValue(value)
  );
}

/** FIRSTTIME/ONCE keys that are dynamic STRINGS evaluated at runtime —
 *  `DISHNAME` (the current dish name, K70), `FESTIVAL() + "_1"` (current
 *  festival + authored suffix, K77). The runtime extracts the key from the
 *  evaluated `text` and keys per-character memory on it, so the first-run
 *  gate fires once per distinct string value (first taste of a dish, first
 *  festival talk) instead of falling through to the always-false
 *  function-call path. */
function isSafeMemoryStringKeyValue(value: KojoValue | null): value is KojoValue {
  if (!value) return false;
  if (value.kind === "dish_name") return true;
  if (value.kind === "string_literal") return true;
  if (value.kind === "function-call-stub" && value.name === "FESTIVAL") return true;
  if (value.kind === "add") return value.parts.every(isSafeMemoryStringKeyValue);
  return false;
}

/** Substitute the raw PRINTFORM text in place. The substitution context
 *  is passed in from the bundle-build site (which knows the call name
 *  for this chara). For unit tests we use the default context. */
export interface ParseFuncOptions {
  /** False keeps `%CALLNAME:*%` tokens raw for runtime substitution. */
  substitute?: boolean;
  /** Build-time symbol registry generated from the upstream CSV/ALS tables. */
  symbols?: KojoSymbolTables;
  /** Dispatcher-owned locals initialized before this extracted body runs. */
  namedLocals?: Iterable<string>;
  /** String globals/locals declared by an owning ERH module. */
  namedStringLocals?: Iterable<string>;
  /**
   * Legacy option retained for callers that document function-result
   * contracts. RESULT assignments and RETURN nodes are now captured for all
   * functions so ordinary dialogue also stops at an authored RETURN.
   */
  captureFunctionResults?: boolean;
  /** Build-time expansion for a statically named function in the same source
   * file. Unknown/external calls deliberately remain absent from KojoNode. */
  resolveStaticCall?: (
    functionName: string,
    args: readonly string[],
    line: number,
  ) => KojoNode | null;
}

type ParsedKojoPrintForm = KojoLine["form"] | "HTML_PRINT";

function stripHtmlPrintMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function buildKojoLine(
  form: ParsedKojoPrintForm,
  text: string,
  line: number,
  ctx = DEFAULT_CONTEXT,
  opts: ParseFuncOptions = {},
): KojoLine {
  const htmlText = form === "HTML_PRINT"
    ? (/^"([\s\S]*)"$/.exec(text.trim())?.[1] ?? text).replace(/""/g, '"')
    : text;
  const normalizedText = form === "HTML_PRINT" ? stripHtmlPrintMarkup(htmlText) : text;
  const normalizedForm = form === "HTML_PRINT" ? "PRINTFORM" : form;
  return {
    form: normalizedForm,
    text: opts.substitute === false ? normalizedText : substitute(normalizedText, ctx),
    line,
  };
}

/** Concrete node aliases used while building (the tree is mutated as we
 *  walk). */
type SeqNode = { type: "seq"; children: KojoNode[] };
type IfNode = { type: "if"; arms: KojoArm[] };
type RandNode = { type: "rand"; cases: KojoNode[] };
type SelectNode = {
  type: "select";
  selector: KojoValue;
  stringSelector: boolean;
  cases: KojoSelectCase[];
  defaultCase: SeqNode | null;
  line: number;
};
type ChoiceNode = { type: "choice"; options: KojoChoiceOption[]; line: number };
type InputNode = {
  type: "input";
  inputMode: "number" | "string";
  values?: readonly (number | string)[];
  options: KojoInputOption[];
  line: number;
};
type ForNode = {
  type: "for";
  target: KojoLocalTarget;
  start: KojoValue;
  end: KojoValue;
  step: KojoValue;
  body: SeqNode;
  line: number;
};
type RepeatNode = { type: "repeat"; count: KojoValue; body: SeqNode; line: number };
type WhileNode = { type: "while"; predicate: KojoPredicate; body: SeqNode; line: number; doWhile?: boolean };

function parseLocalAssignment(
  raw: string,
  line: number,
  symbols: ScopedKojoSymbols,
): KojoNode | null {
  const match = LOCAL_ASSIGN_RE.exec(raw);
  if (!match) return null;
  const value = match[2] === "++" || match[2] === "--"
    ? { kind: "number" as const, value: 1 }
    : parseValue(match[3]!, symbols)
      ?? parseFunctionCallStub(match[3]!);
  if (!value) {
    return {
      type: "unsupported-effect",
      raw,
      line,
      reason: "unsupported LOCAL assignment expression",
    };
  }
  const resolvedValue = match[2] === "-=" || match[2] === "--"
    ? {
        kind: "binary" as const,
        op: "*" as const,
        left: { kind: "number" as const, value: -1 },
        right: value,
      }
    : value;
  return {
    type: "local-set",
    target: { kind: "slot", index: Number(match[1] ?? 0) },
    op: match[2] === "=" ? "set"
      : match[2] === "/=" || match[2] === "=/" ? "divide"
      : "add",
    value: resolvedValue,
    line,
  };
}

/** Segment a literal text into a `string-template` AST node.
 *
 * Recognises `%CALLNAME:scope%`, `%NAME:scope%`, `%LOCALS:N%`, `%RESULTS:N%`,
 * `%ARGS:N%`, and `%NAME(args)%` placeholders. Anything that does not match a
 * known shape is preserved as a `literal` so the runtime can still render it
 * verbatim — this keeps a missing formatter from silently dropping dialogue.
 *
 * Whitespace around the `%` token is tolerated; multiple `%` segments may
 * appear in the same template. Nested `%X(Y)%` calls (e.g. `%SLUR(SOMETHING)%`)
 * are detected by the parenthesis balance so the inner `%` of the call's
 * argument is not mis-segmented.
 */
export function parseStringTemplate(text: string): readonly StringTemplatePart[] {
  const parts: StringTemplatePart[] = [];
  let cursor = 0;
  let literalBuffer = "";
  const flushLiteral = () => {
    if (literalBuffer.length > 0) {
      parts.push({ kind: "literal", text: literalBuffer });
      literalBuffer = "";
    }
  };
  while (cursor < text.length) {
    const ch = text[cursor]!;
    if (ch !== "%") {
      literalBuffer += ch;
      cursor += 1;
      continue;
    }
    // Found `%` — find the matching closing `%`. Honour parenthesis depth
    // so `%SLUR(INNER%)%` is consumed in one shot instead of splitting at
    // the first inner `%`.
    let depth = 0;
    let scan = cursor + 1;
    while (scan < text.length) {
      const c = text[scan]!;
      if (c === "(") depth += 1;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === "%" && depth === 0) break;
      scan += 1;
    }
    if (scan >= text.length || text[scan] !== "%") {
      // Unterminated `%` — treat as literal so the text survives.
      literalBuffer += ch;
      cursor += 1;
      continue;
    }
    const token = text.slice(cursor + 1, scan).trim();
    flushLiteral();
    parts.push(classifyTemplateToken(token));
    cursor = scan + 1;
  }
  flushLiteral();
  return parts;
}

function classifyTemplateToken(token: string): StringTemplatePart {
  // `%CALLNAME:scope%`
  const callname = /^CALLNAME:([^%()]+)$/.exec(token);
  if (callname) return { kind: "callname", scope: callname[1]!.trim() };
  // `%NAME:scope%`
  const nameMatch = /^NAME:([^%()]+)$/.exec(token);
  if (nameMatch) return { kind: "name", scope: nameMatch[1]!.trim() };
  // `%LOCALS:N%` / `%LOCALS%`
  const locals = /^LOCALS(?::(\d+))?$/.exec(token);
  if (locals) return { kind: "locals", index: locals[1] ? Number(locals[1]) : 0 };
  // `%RESULTS:N%` / `%RESULTS%`
  const results = /^RESULTS(?::(\d+))?$/.exec(token);
  if (results) return { kind: "results", index: results[1] ? Number(results[1]) : 0 };
  // `%ARGS:N%` / `%ARGS%`
  const argsMatch = /^ARGS(?::(\d+))?$/.exec(token);
  if (argsMatch) return { kind: "string-arg", index: argsMatch[1] ? Number(argsMatch[1]) : 0 };
  // `%MASTERNAME:N%` collapses to a callname-MASTER lookup.
  const masterName = /^MASTERNAME(?::\d+)?$/.exec(token);
  if (masterName) return { kind: "callname", scope: "MASTER" };
  // Generic upper-case function/format call `%NAME(args)%`.
  const call = /^([A-Z0-9_]+)\((.*)\)$/s.exec(token);
  if (call) {
    const args = parseTemplateFormatterArgs(call[2]!);
    return { kind: "formatter", name: call[1]!, args };
  }
  // Unknown shape — keep verbatim so the renderer can decide.
  return { kind: "literal", text: `%${token}%` };
}

/** Split a comma-separated formatter argument list while honouring quoted
 *  strings and nested parens. Mirrors the logic in `text-renderer.ts` so the
 *  parser and runtime agree on what counts as one argument. Wrapped
 *  double-quotes are stripped from each argument so the resulting array
 *  contains the canonical argument strings. */
function parseTemplateFormatterArgs(raw: string): readonly string[] {
  const out: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c === '"' && raw[i - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (!quoted) {
      if (c === "(") depth += 1;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === "," && depth === 0) {
        out.push(current.trim());
        current = "";
        continue;
      }
    }
    current += c;
  }
  if (current.trim().length > 0 || out.length > 0) out.push(current.trim());
  return out;
}

function parseStringAssignmentValue(
  raw: string,
  symbols: ScopedKojoSymbols,
): KojoValue | null {
  const value = raw.trim();
  const source = /^LOCALS(?::(\d+))?$/.exec(value);
  if (source) return { kind: "string_local", index: Number(source[1] ?? 0) };
  if (symbols.namedStringLocals?.has(value)) {
    return { kind: "named_string_local", name: value };
  }
  const quoted = /^@?"((?:[^"]|"")*)"$/.exec(value);
  if (quoted) {
    return { kind: "string-template", parts: [{ kind: "literal", text: quoted[1]!.replace(/""/g, '"') }] };
  }
  // `「...」` is the eraTW / Emuera double-byte quote pair. Treat it as a
  // string literal body the same way `"..."` / `@"..."` are handled —
  // strip the brackets and feed the inner text through the template path.
  const bracketQuoted = /^「((?:[^」]|」(?=」))*)」$/s.exec(value);
  const inner = bracketQuoted ? bracketQuoted[1]! : null;
  const body = inner ?? (value.length === 0 ? "" : null);
  if (body !== null) {
    if (body === "") {
      return { kind: "string-template", parts: [{ kind: "literal", text: "" }] };
    }
    if (body.includes("%") || body.includes("(")) {
      return { kind: "string-template", parts: parseStringTemplate(body) };
    }
    return { kind: "number", value: kojoStringToken(body) };
  }
  // Bare RHS without `「」` brackets: still allow the template path for
  // percent/paren content so parser-only failure modes regress gracefully.
  if (value.includes("%") || value.includes("(")) {
    return { kind: "string-template", parts: parseStringTemplate(value) };
  }
  return { kind: "string-template", parts: [{ kind: "literal", text: value }] };
}

function parseStringLocalAssignment(
  raw: string,
  line: number,
  symbols: ScopedKojoSymbols,
): KojoNode | null {
  const match = STRING_LOCAL_ASSIGN_RE.exec(raw);
  if (!match) return null;
  const op = match[2] === "+=" ? "add" : "set";
  const value = parseStringAssignmentValue(match[3]!, symbols);
  return value
    ? {
        type: "local-set",
        target: { kind: "string-slot", index: Number(match[1] ?? 0) },
        op,
        value,
        line,
      }
    : { type: "unsupported-effect", raw, line, reason: "unsupported LOCALS assignment expression" };
}

function parseNamedLocalAssignment(
  raw: string,
  line: number,
  symbols: ScopedKojoSymbols,
): KojoNode | null {
  const match = NAMED_LOCAL_ASSIGN_RE.exec(raw);
  if (!match) return null;
  const stringTarget = symbols.namedStringLocals?.has(match[1]!);
  if (!stringTarget && !symbols.namedLocals?.has(match[1]!)) return null;
  if (stringTarget && (match[2] !== undefined || match[3] !== "=")) {
    return { type: "unsupported-effect", raw, line, reason: "unsupported #DIMS compound assignment" };
  }
  const arrayIndex = match[2] ? parseValue(match[2], symbols) : null;
  if (match[2] && !arrayIndex) {
    return { type: "unsupported-effect", raw, line, reason: "unsupported #DIM array index" };
  }
  const value = stringTarget
    ? parseStringAssignmentValue(match[4]!, symbols)
    : match[3] === "++" || match[3] === "--"
    ? { kind: "number" as const, value: 1 }
    : parseValue(match[4]!, symbols) ?? parseFunctionCallStub(match[4]!);
  if (!value) return { type: "unsupported-effect", raw, line, reason: "unsupported #DIM assignment expression" };
  return {
    type: "local-set",
    target: stringTarget
      ? { kind: "named-string", name: match[1]! }
      : arrayIndex
        ? { kind: "named-index", name: match[1]!, index: arrayIndex }
      : { kind: "named", name: match[1]! },
    op: match[3] === "=" ? "set"
      : match[3] === "/=" || match[3] === "=/" ? "divide"
      : "add",
    value: match[3] === "-=" || match[3] === "--"
      ? { kind: "binary", op: "*", left: { kind: "number", value: -1 }, right: value }
      : value,
    line,
  };
}

/** A few upstream kojo functions omit `#DIM` for short-lived numeric scratch
 * names (`M`, `K`, `i`, `天候`).  Infer only a simple, undeclared identifier
 * when its RHS already parses as a numeric KojoValue; string templates and
 * unknown helper calls remain deferred instead of being guessed as numbers. */
function implicitNumericLocalName(
  raw: string,
  symbols: ScopedKojoSymbols,
): string | null {
  const match = NAMED_LOCAL_ASSIGN_RE.exec(raw);
  if (!match || match[2] !== undefined) return null;
  const name = match[1]!;
  if (/^(?:RESULT|RESULTS|LOCAL|LOCALS)$/i.test(name)) return null;
  if (symbols.namedLocals?.has(name) || symbols.namedStringLocals?.has(name)) return null;
  const value = parseValue(match[4]!, symbols);
  if (!value) return null;
  switch (value.kind) {
    case "string_literal":
    case "string-template":
    case "string_local":
    case "named_string_local":
    case "string_arg":
    case "character_name":
    case "dish_type":
    case "dish_name":
    case "host_string_array":
      return null;
    default:
      return name;
  }
}

function parseForHeader(
  raw: string,
  symbols: ScopedKojoSymbols,
): Pick<ForNode, "target" | "start" | "end" | "step"> | null {
  const args = splitFunctionArguments(raw);
  if (!args || args.length < 3 || args.length > 4) return null;
  const variable = /^LOCAL(?::(\d+))?$/i.exec(args[0]!);
  const named = args[0]!.trim();
  const namedArray = /^([\p{L}_][\p{L}\p{N}_]*):(\d+)$/u.exec(named);
  // Emuera treats a FOR iterator as function-local storage even when the
  // surrounding file omitted an explicit #DIM declaration.  Keep LOCAL[:N]
  // on the numeric slot path, while lowering bare iterators and COUNT:0
  // style iterators to the existing VM named-local storage.  The caller
  // registers the iterator before parsing its body so references such as
  // EQUIP:TARGET:i and COUNT:0 resolve through the same symbol table.
  const target: KojoLocalTarget | null = variable
    ? { kind: "slot", index: Number(variable[1] ?? 0) }
    : namedArray
      ? { kind: "named-index", name: namedArray[1]!, index: { kind: "number", value: Number(namedArray[2]) } }
      : /^[\p{L}_][\p{L}\p{N}_]*$/u.test(named)
        ? { kind: "named", name: named }
        : null;
  if (!target) return null;
  const start = parseValue(args[1]!, symbols);
  const end = parseValue(args[2]!, symbols);
  const step = args[3]
    ? parseValue(args[3], symbols)
    : { kind: "number" as const, value: 1 };
  if (!start || !end || !step) return null;
  return { target, start, end, step };
}

/** A `PRINTBUTTON "label", "value"` collected before its `SELECTCASE`. */
interface PendingButton {
  label: string;
  value: string;
  fallbackLine?: KojoLine;
}

/** One open container on the build stack. The current "sink" seq is
 *  the arm body / case body / choice-option body / root we append into. */
type Frame =
  | { kind: "root"; seq: SeqNode }
  | { kind: "if"; node: IfNode; armBody: SeqNode }
  | { kind: "rand"; node: RandNode; caseBody: SeqNode | null }
  | { kind: "select"; node: SelectNode; caseBody: SeqNode | null }
  | { kind: "for"; node: ForNode; body: SeqNode }
  | { kind: "repeat"; node: RepeatNode; body: SeqNode }
  | { kind: "while"; node: WhileNode; body: SeqNode }
  | { kind: "discard" }
  | {
      kind: "choice";
      node: ChoiceNode;
      buttons: PendingButton[];
      optionIndex: number;
      optionBody: SeqNode | null;
    }
  | {
      kind: "input";
      node: InputNode;
      optionIndex: number;
      optionBody: SeqNode | null;
      buttons: PendingButton[];
      /** Snapshot of `pendingButtons` at IF detection — restored on rollback. */
      buttonsSnapshot: PendingButton[];
      /** Parallel `if` node so we can rollback to it when an ELSEIF arm
       *  doesn't read RESULT. */
      ifNode: IfNode;
      /** True when any ELSEIF/ELSE arm made rollback necessary. */
      rollback: boolean;
    };

/** Parse one @-func body into a `ParsedKojoFunc` (tree form). `ctx`
 *  drives `%CALLNAME%` substitution at parse time (per-chara names). */
export function parseFunc(
  fn: ExtractedFunc,
  ctx: SubstituteContext = DEFAULT_CONTEXT,
  opts: ParseFuncOptions = {},
): ParsedKojoFunc {
  const root: SeqNode = { type: "seq", children: [] };
  const bodyLines = mergeKojoMultilineStringAssignments(
    mergeKojoPredicateContinuations(stripKojoSkipBlocks(fn.body)),
  );
  const stack: Frame[] = [{ kind: "root", seq: root }];
  // Builders may register dispatcher-owned locals that are initialized by a
  // surrounding ERB function before this extracted body is called. Keep
  // those names alongside the function's own #DIM declarations.
  // `A` is an upstream VariableSize scratch array. Dialogue functions use
  // bare A as A:0; keeping it VM-local preserves its per-call behavior
  // without introducing shared mutable process state.
  const namedLocals = new Set<string>(["A", ...(opts.namedLocals ?? [])]);
  const namedStringLocals = new Set<string>(opts.namedStringLocals ?? []);
  const symbols: ScopedKojoSymbols = {
    ...(opts.symbols ?? DEFAULT_KOJO_SYMBOLS),
    namedLocals,
    namedStringLocals,
  };
  const parseCurrentPredicate = (raw: string): KojoPredicate =>
    parsePredicate(raw, symbols);

  /** The seq we currently append into (null only inside a SELECTCASE
   *  before the first CASE — content there is dropped). */
  function currentSink(): SeqNode | null {
    const top = stack[stack.length - 1]!;
    switch (top.kind) {
      case "root": return top.seq;
      case "if": return top.armBody;
      case "rand": return top.caseBody;
      case "select": return top.caseBody;
      case "for": return top.body;
      case "repeat": return top.body;
      case "while": return top.body;
      case "choice": return top.optionBody;
      case "input": return top.optionBody;
      case "discard": return null;
    }
  }

  /** Read-only seq of the given frame (used by rollback to swap a node
   *  in the parent's children list). */
  function parentSeqSink(frame: NonNullable<typeof stack[number]>): SeqNode | null {
    switch (frame.kind) {
      case "root": return frame.seq;
      case "if": return frame.armBody;
      case "rand": return frame.caseBody;
      case "select": return frame.caseBody;
      case "for": return frame.body;
      case "repeat": return frame.body;
      case "while": return frame.body;
      case "choice": return frame.optionBody;
      case "input": return frame.optionBody;
      case "discard": return null;
    }
  }

  /** Buttons collected since the last flush, awaiting their SELECTCASE. */
  let pendingButtons: PendingButton[] = [];
  let pendingBareInput = false;

  function flushPendingButtons(): void {
    if (pendingBareInput && pendingButtons.length > 0) {
      appendNode({
        type: "choice",
        line: pendingButtons[0]?.fallbackLine?.line ?? 0,
        options: pendingButtons.map((button) => ({
          label: button.label,
          value: button.value,
          body: newSeq(),
        })),
      });
      pendingButtons = [];
      pendingBareInput = false;
      return;
    }
    for (const button of pendingButtons) {
      if (button.fallbackLine) appendLine(button.fallbackLine);
    }
    pendingButtons = [];
  }

  function appendNode(node: KojoNode): void {
    currentSink()?.children.push(node);
  }

  function parseFunctionControl(
    raw: string,
    line: number,
  ): KojoNode | null {
    const result = RESULT_ASSIGN_RE.exec(raw);
    if (result) {
      const value = parseValue(result[3]!, symbols);
      return value
        ? {
            type: "result-set",
            index: Number(result[1] ?? 0),
            op: result[2] === "=" ? "set" : "add",
            value,
            line,
          }
        : {
            type: "unsupported-effect",
            raw,
            line,
            reason: "unsupported RESULT assignment expression",
          };
    }
    const returned = RETURN_RE.exec(raw);
    if (returned) {
      const value = returned[1]
        ? parseValue(returned[1], symbols)
        : { kind: "number" as const, value: 0 };
      return value
        ? { type: "return", value, line }
        : {
            type: "unsupported-effect",
            raw,
            line,
            reason: "unsupported RETURN expression",
          };
    }
    return null;
  }

  function appendLine(line: KojoLine): void {
    const seq = currentSink();
    if (!seq) return;
    const last = seq.children[seq.children.length - 1];
    if (last && last.type === "lines") last.lines.push(line);
    else seq.children.push({ type: "lines", lines: [line] });
  }

  function newSeq(): SeqNode {
    return { type: "seq", children: [] };
  }

  // 記入チェック LOCAL env — tracks `LOCAL[:N] = <int>` assignments seen
  // so far in the walk, so `IF LOCAL:1 && …` gates resolve to their current
  // literal value. Keyed "LOCAL" (bare) or "LOCAL:N". Static walk: the
  // eraTW convention resets `LOCAL:1 = 1` before each gated IF, so a
  // `LOCAL:1 = 0` inside one ARG branch doesn't leak into the next (the
  // intervening `LOCAL:1 = 1` reset overwrites it). Faithful for the
  // personal-kojo greeting bodies (verified reimu arm 2/3). Untracked
  // reads fall through to parsePredicate (bare `LOCAL`→always, `LOCAL:N`
  //→unknown).
  const localEnv = new Map<string, number>();
  let dynamicLoopDepth = 0;
  function substituteLocals(cond: string): string {
    if (dynamicLoopDepth > 0) return cond;
    return cond.replace(/\bLOCAL(?::(\d+))?\b/g, (tok, idx) => {
      const key = idx ? `LOCAL:${idx}` : "LOCAL";
      const v = localEnv.get(key);
      return v === undefined ? tok : String(v);
    });
  }

  for (let i = 0; i < bodyLines.length; i++) {
    // ERB indentation is structural only. Normalize it once so a tabbed
    // INPUT/SELECTCASE sequence follows the same path as its PRINT lines.
    const lineText = bodyLines[i]!.trimStart();
    const lineNo = fn.declLine + i + 1;
    let m: RegExpExecArray | null;

    const declaration = /^#(DIMS?)\s+(?:(?:CONST|DYNAMIC|SAVEDATA|GLOBAL|LOCAL|REF)\s+)*([\p{L}_][\p{L}\p{N}_]*)/iu.exec(lineText.trim());
    const scalarInitializer = /^#DIM\s+(?:(?:CONST|DYNAMIC|SAVEDATA|GLOBAL|LOCAL|REF)\s+)*[\p{L}_][\p{L}\p{N}_]*\s*=\s*(.+)$/iu.exec(lineText.trim());
    if (declaration?.[1]?.toUpperCase() === "DIMS") namedStringLocals.add(declaration[2]!);
    else if (declaration) namedLocals.add(declaration[2]!);
    if (COMPILE_TIME_DECLARATION_RE.test(lineText.trim())) {
      // A scalar #DIM initializer is evaluated when the ERB function starts.
      // Preserve numeric initializers in the per-call VM; dropping them made
      // later predicates see an unbound local (for example K31's kojo version).
      if (declaration?.[1]?.toUpperCase() === "DIM" && scalarInitializer?.[1]) {
        const initialValue = parseValue(scalarInitializer[1], symbols);
        if (initialValue) {
          currentSink()?.children.push({
            type: "local-set",
            target: { kind: "named", name: declaration[2]! },
            op: "set",
            value: initialValue,
            line: lineNo,
          });
        }
      }
      continue;
    }

    // Display text may contain `=` (HTML attributes and inline predicates).
    // Handle it before local/ledger assignment probes.
    const earlyPrint = PRINTFORM_RE.exec(lineText);
    if (
      earlyPrint &&
      !PRINTED_OPTION_RE.test(lineText)
    ) {
      const text = earlyPrint[2]!.trim();
      if (text.length > 0) {
        if (pendingButtons.length > 0) flushPendingButtons();
        else if (pendingBareInput) pendingBareInput = false;
        appendLine(buildKojoLine(earlyPrint[1] as ParsedKojoPrintForm, text, lineNo, ctx, opts));
      }
      continue;
    }

    // LOCAL[:N] = <int> — update the env; produces no node.
    const lam = LOCAL_ASSIGN_RE.exec(lineText);
    if (lam) {
      const key = lam[1] ? `LOCAL:${lam[1]}` : "LOCAL";
      const literal = (lam[2] === "++" || lam[2] === "--")
        ? 1
        : /^-?\d+$/.test(lam[3]!.trim()) ? Number(lam[3]) : null;
      if (literal !== null) {
        if (lam[2] === "=") localEnv.set(key, literal);
        else if (lam[2] === "-=" || lam[2] === "--") {
          const current = localEnv.get(key);
          if (current !== undefined) localEnv.set(key, current - literal);
        } else {
          const current = localEnv.get(key);
          if (current !== undefined) localEnv.set(key, current + literal);
        }
      }
      const localNode = parseLocalAssignment(
        lineText,
        lineNo,
        symbols,
      );
      if (localNode) appendNode(localNode);
      continue;
    }

    // State-backed ERB ledgers can also be declared with #DIM SAVEDATA
    // (for example FISH_EXP/FISHSIZE_RECORD). They must remain authoritative
    // effects even when the bundle passes those declaration names as locals;
    // otherwise the named-local adapter would swallow the write.
    const declaredLedgerEffect = parseEffect(lineText, lineNo, symbols);
    if (declaredLedgerEffect?.kind === "fish-ledger") {
      appendNode({ type: "effect", effect: declaredLedgerEffect });
      continue;
    }
    // Diary state uses colon-delimited names that otherwise look like a
    // function-local `#DIM name:index = ...` assignment. Preserve these
    // source-backed writes before the named-local adapter gets a chance to
    // consume them.
    if (
      declaredLedgerEffect &&
      declaredLedgerEffect.kind !== "display-name" &&
      (declaredLedgerEffect.target.ns === "DIARY" ||
        declaredLedgerEffect.target.ns === "MAX_DIARY_PAGE" ||
        declaredLedgerEffect.target.ns === "PAGESET" ||
        declaredLedgerEffect.target.ns === "MONEY" ||
        declaredLedgerEffect.target.ns === "TIME")
    ) {
      appendNode({ type: "effect", effect: declaredLedgerEffect });
      continue;
    }

    // A few encounter templates use a global scratch counter only to clear
    // their own transient PRINT buffer (`gLineCount = LINECOUNT`). The
    // static renderer has no such buffer; retain the assignment as a local
    // no-op value so it cannot poison an otherwise authored greeting.
    if (/^gLineCount\s*=\s*LINECOUNT$/i.test(lineText)) {
      appendNode({
        type: "local-set",
        target: { kind: "slot", index: 0 },
        op: "set",
        value: { kind: "line-count" },
        line: lineNo,
      });
      continue;
    }

    const implicitLocal = implicitNumericLocalName(lineText, symbols);
    if (implicitLocal) namedLocals.add(implicitLocal);
    const namedLocalNode = parseNamedLocalAssignment(lineText, lineNo, symbols);
    if (namedLocalNode) {
      appendNode(namedLocalNode);
      continue;
    }

    const functionControl = parseFunctionControl(lineText, lineNo);
    if (functionControl) {
      appendNode(functionControl);
      continue;
    }

    const stringLocalNode = parseStringLocalAssignment(lineText, lineNo, symbols);
    if (stringLocalNode) {
      appendNode(stringLocalNode);
      continue;
    }

    const k2Hph = /^CALL\s+K2_HPH_PRINT\s*,\s*@?"(.*)"\s*,\s*"([WL]?)"\s*$/.exec(lineText);
    if (k2Hph) {
      const form = k2Hph[2] === "W" ? "PRINTFORMW" : k2Hph[2] === "L" ? "PRINTFORML" : "PRINTFORM";
      appendLine(buildKojoLine(form, k2Hph[1]!.replaceAll("HPH", "❤"), lineNo, ctx, opts));
      continue;
    }

    const askYn = ASK_YN_CALL_RE.exec(lineText);
    if (askYn) {
      const rawArgs = (askYn[1] ?? askYn[2] ?? "").trim();
      const args = rawArgs.length === 0 ? [] : splitFunctionArguments(rawArgs);
      const labels = args && args.length <= 2
        ? [args[0] ?? '"是"', args[1] ?? '"否"'].map((arg) => parseAskYnLabel(arg, symbols))
        : null;
      if (!labels || labels.some((label) => label === null)) {
        appendNode({
          type: "unsupported-effect",
          raw: lineText,
          line: lineNo,
          reason: "unsupported ASK_YN arguments",
        });
        continue;
      }
      appendNode(buildAskYnChoice(labels as AskYnLabel[], lineNo));
      continue;
    }

    const askM = ASK_M_CALL_RE.exec(lineText);
    if (askM) {
      const rawArgs = (askM[1] ?? askM[2] ?? "").trim();
      const args = rawArgs.length === 0 ? [] : splitFunctionArguments(rawArgs);
      if (args === null) continue;
      // A number of upstream calls use a trailing comma before the closing
      // parenthesis. It is syntactic noise, not an additional ASK_M pair.
      while (args.length > 0 && args[args.length - 1].trim() === "") args.pop();
      const choice = args.length > 0 ? buildAskMChoice(args, lineNo, ctx, opts, symbols) : null;
      if (choice) {
        appendNode(choice);
      }
      continue;
    }

    const call = CALL_RE.exec(lineText);
    if (call) {
      const rawArgs = (call[2] ?? "").trim();
      const callArgs = rawArgs.length === 0 ? [] : splitFunctionArguments(rawArgs) ?? [];
      const expanded = opts.resolveStaticCall?.(call[1]!, callArgs, lineNo);
      if (expanded) appendNode(expanded);
      continue;
    }

    // PRINTBUTTON and older `PRINTL [value]-label` menus both feed INPUT and
    // SELECTCASE RESULT(S). Keep the latter visible only when no choice
    // branch follows, otherwise it becomes a regular interactive choice.
    const printedOption = PRINTED_OPTION_RE.exec(lineText);
    if (printedOption) {
      pendingButtons.push({
        label: printedOption[3]!.trim(),
        value: printedOption[2]!.trim(),
        fallbackLine: buildKojoLine(printedOption[1] as KojoLine["form"], lineText.replace(/^PRINT(?:FORM)?D?[LW]\s+/, "").trim(), lineNo, ctx, opts),
      });
      continue;
    }
    const button = PRINTBUTTON_RE.exec(lineText);
    if (button) {
      pendingButtons.push({ label: button[1]!.trim(), value: button[2]!.trim() });
      continue;
    }
    if (INPUT_RE.test(lineText)) {
      pendingBareInput = true;
      continue;
    }
    if (WAIT_RE.test(lineText)) {
      // A raw WAIT has no input value: it is the same session-owned pause as
      // a one-option menu. Keeping it as a choice preserves the continuation
      // boundary for interactive callers while non-interactive oracle callers
      // can deterministically traverse the sole acknowledgement branch.
      appendNode({
        type: "choice",
        line: lineNo,
        options: [{ label: "继续", value: "", body: newSeq() }],
      });
      continue;
    }
    // A label between rendered options and INPUT is the common retry-loop
    // shape (`$LOOP` / `GOTO LOOP`). It does not terminate the pending menu.
    if (LABEL_RE.test(lineText)) continue;
    if (pendingButtons.length > 0) {
      const bareSpacer = /^(PRINTL|PRINT)\s*$/.test(lineText);
      // Presentation-only state changes are commonly placed after the last
      // button and before INPUT(S). They do not end the menu; flushing here
      // loses the authored labels and leaves SELECTCASE with numeric fallbacks.
      const menuPresentation = /^(RESETCOLOR|SETCOLOR\b.*)$/.test(lineText);
      // A menu can be assembled in one arm of an IF and continue with common
      // options after ENDIF (Parsee's first-meeting menu is the canonical
      // example). ENDIF closes the prose branch, but it is not the end of the
      // pending menu; let the following common labels/INPUT decide that.
      const menuStructuralBoundary = /^ENDIF$/.test(lineText);
      // ROUTE B: keep pending buttons through `IF RESULT` so the IF_RE
      // hook below can lower the IF chain into an `input` node.
      const isInputCandidateIf = IF_RE.test(lineText);
      if (!bareSpacer && !menuPresentation && !menuStructuralBoundary && !SELECTCASE_RESULT_RE.test(lineText) && !isInputCandidateIf) {
        flushPendingButtons();
      }
      if (menuPresentation) continue;
    }
    if (pendingBareInput && !SELECTCASE_RESULT_RE.test(lineText) && !IF_RE.test(lineText)) {
      pendingBareInput = false;
    }

    // PRINTFORM text is allowed to contain `=` (for example a displayed
    // comparison or an authored placeholder). Recognize it before the
    // generic assignment probe; otherwise parseEffect() rejects the target
    // and unsupportedEffectReason() consumes the dialogue as a bad write.
    const effect = parseEffect(lineText, lineNo, symbols);
    if (effect) {
      appendNode({ type: "effect", effect });
      continue;
    }
    const unsupportedEffect = unsupportedEffectReason(lineText);
    if (unsupportedEffect) {
      appendNode({ type: "unsupported-effect", raw: lineText, line: lineNo, reason: unsupportedEffect });
      continue;
    }

    // Bounded WHILE. Unsupported bodies are discarded through WEND.
    if ((m = WHILE_RE.exec(lineText))) {
      const body = newSeq();
      const node: WhileNode = {
        type: "while",
        predicate: parseCurrentPredicate(m[1]!),
        body,
        line: lineNo,
      };
      appendNode(node);
      stack.push({ kind: "while", node, body });
      dynamicLoopDepth++;
      continue;
    }
    // Emuera's DO/LOOP is a do-while loop. The LOOP expression is parsed
    // when the closing line arrives; the optional `doWhile` marker lets the
    // runtime execute the body once before evaluating that expression.
    if (DO_RE.test(lineText)) {
      const body = newSeq();
      const node: WhileNode = {
        type: "while",
        predicate: { kind: "always" },
        body,
        line: lineNo,
        doWhile: true,
      };
      appendNode(node);
      stack.push({ kind: "while", node, body });
      dynamicLoopDepth++;
      continue;
    }
    if (WEND_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top?.kind === "while" && !top.node.doWhile) {
        stack.pop();
        dynamicLoopDepth--;
      } else if (top?.kind === "discard") stack.pop();
      continue;
    }
    if ((m = LOOP_RE.exec(lineText))) {
      const top = stack[stack.length - 1];
      if (top?.kind === "while" && top.node.doWhile) {
        top.node.predicate = parseCurrentPredicate(m[1] ?? "1");
        stack.pop();
        dynamicLoopDepth--;
      } else if (top?.kind === "discard") stack.pop();
      continue;
    }
    if (BREAK_RE.test(lineText) || CONTINUE_RE.test(lineText)) {
      // A discarded unsupported loop already fails closed as a whole. Do not
      // add a second diagnostic for every BREAK/CONTINUE nested in that body;
      // otherwise coverage is dominated by duplicate loop-control reports.
      if (stack.some((frame) => frame.kind === "discard")) continue;
      const insideLoop = stack.some((frame) =>
        frame.kind === "while" || frame.kind === "for" || frame.kind === "repeat"
      );
      if (insideLoop) {
        appendNode({ type: BREAK_RE.test(lineText) ? "break" : "continue" });
      } else {
        appendNode({
          type: "unsupported-effect",
          raw: lineText,
          line: lineNo,
          reason: "loop control outside loop",
        });
      }
      continue;
    }

    // Bounded numeric REPEAT. Unsupported counts are discarded through REND
    // so their body cannot be emitted once by accident.
    if ((m = REPEAT_RE.exec(lineText))) {
      const count = parseValue(m[1]!, symbols);
      if (!count) {
        appendNode({
          type: "unsupported-effect",
          raw: lineText,
          line: lineNo,
          reason: "unsupported REPEAT count",
        });
        stack.push({ kind: "discard" });
      } else {
        const body = newSeq();
        const node: RepeatNode = { type: "repeat", count, body, line: lineNo };
        appendNode(node);
        stack.push({ kind: "repeat", node, body });
        dynamicLoopDepth++;
      }
      continue;
    }
    if (REND_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top?.kind === "repeat") {
        stack.pop();
        dynamicLoopDepth--;
      } else if (top?.kind === "discard") stack.pop();
      continue;
    }

    // Bounded numeric FOR over VM-local storage. Unsupported headers are
    // discarded through NEXT so their body cannot be emitted once by accident.
    if ((m = FOR_RE.exec(lineText))) {
      const parsedFor = parseForHeader(m[1]!, symbols);
      if (!parsedFor) {
        appendNode({
          type: "unsupported-effect",
          raw: lineText,
          line: lineNo,
          reason: "unsupported FOR header",
        });
        stack.push({ kind: "discard" });
      } else {
        if (parsedFor.target.kind === "named" || parsedFor.target.kind === "named-index") {
          namedLocals.add(parsedFor.target.name);
        }
        const body = newSeq();
        const node: ForNode = { type: "for", ...parsedFor, body, line: lineNo };
        appendNode(node);
        stack.push({ kind: "for", node, body });
        dynamicLoopDepth++;
      }
      continue;
    }
    if (NEXT_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top?.kind === "for") {
        stack.pop();
        dynamicLoopDepth--;
      } else if (top?.kind === "discard") stack.pop();
      continue;
    }

    // IF / ELSEIF / ELSE / ENDIF -----------------------------------------------
    // ROUTE B: A pending `PRINTL/PRINTBUTTON + INPUT` menu followed by `IF RESULT`
    // becomes an `input` node (pause + surface to UI), not an `if` node.
    if ((m = IF_RE.exec(lineText))) {
      const armBody = newSeq();
      const predicate = parseCurrentPredicate(substituteLocals(m[1]!));
      const shouldBeInput =
        (pendingButtons.length > 0 || pendingBareInput) && predicateReadsResult(predicate);
      if (shouldBeInput) {
        const matcher = extractResultMatcher(predicate);
        // Emit each menu line as visible prose so the player sees "[1] 是 [0] 否".
        for (const button of pendingButtons) {
          if (button.fallbackLine) appendLine(button.fallbackLine);
        }
        const inputNode: InputNode = {
          type: "input",
          inputMode: "number",
          options: [{
            label: pendingButtons[0]?.label ?? "0",
            value: pendingButtons[0]?.value,
            matcher: matcher ?? undefined,
            body: armBody,
          }],
          line: lineNo,
        };
        const ifNode: IfNode = { type: "if", arms: [{ predicate, body: armBody }] };
        appendNode(inputNode);
        stack.push({
          kind: "input",
          node: inputNode,
          optionIndex: 0,
          optionBody: armBody,
          buttons: pendingButtons,
          buttonsSnapshot: pendingButtons,
          ifNode,
          rollback: false,
        });
        pendingButtons = [];
        pendingBareInput = false;
        continue;
      }
      const node: IfNode = { type: "if", arms: [{ predicate, body: armBody }] };
      appendNode(node);
      stack.push({ kind: "if", node, armBody });
      continue;
    }
    if ((m = ELSEIF_RE.exec(lineText))) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "input") {
        const armBody = newSeq();
        const predicate = parseCurrentPredicate(substituteLocals(m[1]!));
        const matcher = predicateReadsResult(predicate) ? extractResultMatcher(predicate) : undefined;
        const button = top.buttons[top.node.options.length];
        top.node.options.push({
          label: button?.label ?? String(top.node.options.length),
          value: button?.value,
          matcher: matcher ?? undefined,
          body: armBody,
        });
        top.optionBody = armBody;
        top.ifNode.arms.push({ predicate, body: armBody });
        if (!predicateReadsResult(predicate)) top.rollback = true;
      } else if (top && top.kind === "if") {
        const armBody = newSeq();
        top.node.arms.push({ predicate: parseCurrentPredicate(substituteLocals(m[1]!)), body: armBody });
        top.armBody = armBody;
      }
      continue;
    }
    if (ELSE_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "input") {
        const armBody = newSeq();
        const button = top.buttons[top.node.options.length];
        top.node.options.push({
          label: button?.label ?? "fallback",
          value: button?.value,
          matcher: undefined,
          body: armBody,
        });
        top.optionBody = armBody;
        top.ifNode.arms.push({ predicate: { kind: "always" }, body: armBody });
      } else if (top && top.kind === "if") {
        const armBody = newSeq();
        top.node.arms.push({ predicate: { kind: "always" }, body: armBody });
        top.armBody = armBody;
      }
      continue;
    }
    if (ENDIF_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "input") {
        if (top.rollback) {
          // Rollback: replace the input node in the parent's seq with the
          // parallel if-node, restore the menu snapshot so flushPendingButtons
          // can emit fallback prose.
          const parentFrame = stack[stack.length - 2];
          const parentSink = parentFrame ? parentSeqSink(parentFrame) : null;
          if (parentSink) {
            const idx = parentSink.children.indexOf(top.node);
            if (idx >= 0) parentSink.children[idx] = top.ifNode;
          }
          pendingButtons = top.buttonsSnapshot;
        }
        stack.pop();
      } else if (stack.length > 1 && top.kind === "if") {
        stack.pop();
      }
      continue;
    }

    // SELECTCASE / CASE / ENDSELECT --------------------------------------------
    if (SELECTCASE_RE.test(lineText)) {
      // A `SELECTCASE RESULT(S)` after a menu or bare INPUT is a player
      // choice. Bare INPUT gets one safe button for each literal CASE value.
      if ((pendingButtons.length > 0 || pendingBareInput) && SELECTCASE_RESULT_RE.test(lineText)) {
        const node: ChoiceNode = { type: "choice", options: [], line: lineNo };
        appendNode(node);
        stack.push({ kind: "choice", node, buttons: pendingButtons, optionIndex: 0, optionBody: null });
        pendingButtons = [];
        pendingBareInput = false;
        continue;
      }
      const selectorRaw = substituteLocals(lineText.replace(/^SELECTCASE\s+/, "").trim());
      const selector = parseValue(selectorRaw, symbols)
        ?? parseFunctionCallStub(selectorRaw);
      if (!selector) {
        appendNode({
          type: "unsupported-effect",
          raw: lineText,
          line: lineNo,
          reason: "unsupported SELECTCASE selector",
        });
        stack.push({ kind: "discard" });
        continue;
      }
      const node: SelectNode = {
        type: "select",
        selector,
        stringSelector:
          selector.kind === "string_local" ||
          selector.kind === "named_string_local" ||
          selector.kind === "host_string_array",
        cases: [],
        defaultCase: null,
        line: lineNo,
      };
      appendNode(node);
      stack.push({ kind: "select", node, caseBody: null });
      continue;
    }
    if (CASE_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "rand") {
        const caseBody = newSeq();
        top.node.cases.push(caseBody);
        top.caseBody = caseBody;
      } else if (top && top.kind === "choice") {
        // One option per CASE: match its value to a PRINTBUTTON for the label
        // (ordinal fallback), open a fresh body the following lines flow into.
        const vm = CASE_VALUE_RE.exec(lineText);
        const value = vm ? vm[1]!.trim() : String(top.optionIndex);
        const button = top.buttons.find((b) => b.value === value) ?? top.buttons[top.optionIndex];
        const optionBody = newSeq();
        top.node.options.push({ label: button?.label ?? value, value, body: optionBody });
        top.optionBody = optionBody;
        top.optionIndex += 1;
      } else if (top && top.kind === "select") {
        const raw = lineText.replace(/^CASE\s+/, "").trim();
        const caseBody = newSeq();
        const matchers = parseCaseMatchers(raw, symbols, top.node.stringSelector);
        top.node.cases.push({
          values: matchers?.values ?? null,
          ranges: matchers?.ranges ?? [],
          raw,
          body: caseBody,
        });
        top.caseBody = caseBody;
      }
      continue;
    }
    if (CASEELSE_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (top && top.kind === "select") {
        const caseBody = newSeq();
        top.node.defaultCase = caseBody;
        top.caseBody = caseBody;
      }
      continue;
    }
    if (ENDSELECT_RE.test(lineText)) {
      const top = stack[stack.length - 1];
      if (
        stack.length > 1 &&
        top &&
        (top.kind === "rand" || top.kind === "select" || top.kind === "choice" || top.kind === "discard")
      ) stack.pop();
      continue;
    }

    // SIF (single-line IF) — convert to single-arm IF node, consume the next line --
    if ((m = SIF_RE.exec(lineText))) {
      const armBody = newSeq();
      const nextIdx = i + 1;
      if (nextIdx < bodyLines.length) {
        const nextText = bodyLines[nextIdx]!;
        const nextLineNo = fn.declLine + nextIdx + 1;
        const control = parseFunctionControl(nextText, nextLineNo);
        if (control) {
          armBody.children.push(control);
        } else {
          // A SIF body is parsed inline rather than through the main loop.
          // Apply the same display-before-assignment rule here; otherwise a
          // PRINTFORM line containing an inline `=` is emitted correctly but
          // also leaves a duplicate unsupported-effect node behind.
          const isNextPrint = PRINTFORM_RE.test(nextText) && !PRINTED_OPTION_RE.test(nextText);
          const earlyEffect = isNextPrint ? null : parseEffect(nextText, nextLineNo, symbols);
          const preemptsNamedLocal =
            earlyEffect?.kind === "fish-ledger" ||
            (earlyEffect !== null &&
              earlyEffect !== undefined &&
              earlyEffect.kind !== "display-name" &&
              (earlyEffect.target.ns === "DIARY" ||
                earlyEffect.target.ns === "MAX_DIARY_PAGE" ||
                earlyEffect.target.ns === "PAGESET" ||
                earlyEffect.target.ns === "MONEY" ||
                earlyEffect.target.ns === "TIME"));
          const localNode =
            isNextPrint || preemptsNamedLocal
              ? null
              : parseLocalAssignment(nextText, nextLineNo, symbols) ??
                parseNamedLocalAssignment(nextText, nextLineNo, symbols) ??
                parseStringLocalAssignment(nextText, nextLineNo, symbols);
          if (preemptsNamedLocal && earlyEffect) {
            armBody.children.push({ type: "effect", effect: earlyEffect });
          } else if (localNode) {
            armBody.children.push(localNode);
          } else {
            if (earlyEffect) {
              armBody.children.push({ type: "effect", effect: earlyEffect });
            } else {
              const unsupportedEffect = isNextPrint ? null : unsupportedEffectReason(nextText);
              if (unsupportedEffect) {
                armBody.children.push({
                  type: "unsupported-effect",
                  raw: nextText,
                  line: nextLineNo,
                  reason: unsupportedEffect,
                });
              }
            }
          }

          // Parse the next line as PRINTFORM if it matches
          const npm = PRINTFORM_RE.exec(nextText);
          if (npm) {
            const ntext = npm[2]!.trim();
            if (ntext.length > 0) {
              armBody.children.push({
                type: "lines" as const,
                lines: [buildKojoLine(npm[1] as KojoLine["form"], ntext, nextLineNo, ctx, opts)],
              });
            }
          }
        }
        // If the next line isn't PRINTFORM, still consume it as the SIF body
        // (edge case: SIF on a control-flow line — treat as empty body)
      }
      const node: IfNode = {
        type: "if",
        arms: [{ predicate: parseCurrentPredicate(substituteLocals(m[1]!)), body: armBody }],
      };
      appendNode(node);
      i++; // consume the SIF'd line
      continue;
    }

    // PRINTDATA / DATA / DATAFORM / DATALIST / ENDLIST / ENDDATA -----------
    // A bare DATA/DATAFORM is one random candidate.  A DATALIST groups its
    // DATA/DATAFORM rows into one candidate, preserving authored multi-line
    // exchanges (the old flat implementation picked one row and silently
    // dropped the rest, which made 文 and many other characters sound cut off).
    const printDataMatch = PRINTDATA_RE.exec(lineText);
    if (printDataMatch) {
      const colorFlag = printDataMatch[1]!;
      const lineFlag = printDataMatch[2]!;
      // `K`/`D` only select the render colour.  The modern text layer has no
      // colour channel, so retain the existing `D` form while preserving the
      // important L/W line boundary and WAIT semantics.
      const dataForm = lineFlag === "L"
        ? "PRINTFORMDL"
        : lineFlag === "W"
          ? "PRINTFORMDW"
          : "PRINTFORMD";
      void colorFlag;

      const groups: KojoLine[][] = [];
      let activeList: KojoLine[] | undefined;
      while (++i < bodyLines.length) {
        const dataLine = bodyLines[i]!;
        if (ENDDATA_RE.test(dataLine)) break;
        if (DATALIST_RE.test(dataLine)) {
          activeList = [];
          groups.push(activeList);
          continue;
        }
        if (ENDLIST_RE.test(dataLine)) {
          activeList = undefined;
          continue;
        }
        const formMatch = DATAFORM_RE.exec(dataLine);
        const dataMatch = DATA_RE.exec(dataLine);
        const match = formMatch ?? dataMatch;
        if (!match) continue;
        const text = (match[1] ?? "").trim();
        const rowLine = fn.declLine + i + 1;
        const row = buildKojoLine(dataForm, text, rowLine, ctx, opts);
        if (activeList) activeList.push(row);
        else groups.push([row]);
      }
      const cases: KojoNode[] = groups
        .filter((rows) => rows.length > 0)
        .map((rows) => ({ type: "lines" as const, lines: rows }));
      if (cases.length > 0) appendNode({ type: "rand", cases });
      continue;
    }

    // PRINTFORM* ---------------------------------------------------------------
    const pm = PRINTFORM_RE.exec(lineText);
    if (pm) {
      const text = pm[2]!.trim();
      if (text.length > 0) {
        appendLine(buildKojoLine(pm[1] as KojoLine["form"], text, lineNo, ctx, opts));
      }
      continue;
    }

    // Anything else (CALL, RETURN, WAIT, `LOCAL = 1`, …) — skip.
  }

  return { name: fn.name, declLine: fn.declLine, body: root };
}

/** Parse a whole ERB file's worth of extracted funcs. */
export function parseFile(
  _relPath: string,
  funcs: ExtractedFunc[],
): { funcs: ParsedKojoFunc[]; unparseable: string[] } {
  const parsed: ParsedKojoFunc[] = [];
  const unparseable: string[] = [];
  for (const fn of funcs) {
    try {
      parsed.push(parseFunc(fn));
    } catch {
      unparseable.push(fn.name);
    }
  }
  return { funcs: parsed, unparseable };
}
