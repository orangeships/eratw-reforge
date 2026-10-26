import type {
  KojoVmFunction,
  KojoVmCallArgument,
  KojoVmInstruction,
  KojoVmLocation,
  KojoVmParameter,
  KojoVmPrintForm,
  KojoVmNumberValue,
  KojoVmPredicate,
  KojoVmProgram,
  KojoVmStringValue,
  KojoVmTextSegment,
} from "../../runtime/kojo-vm/types.js";

const DECLARATION = /^@([^\s(,;]+)(?:\((.*)\))?$/;
const PRINT = /^(PRINT(?:FORM)?(?:DW|DL|W|D|L)?|PRINTL)\s*(.*)$/i;
const CALL = /^(CALL|CALLF|CALLFORM|CALLFORMF|TRYCALL|TRYCALLFORM|TRYCALLFORMF|TRYCCALL|TRYCCALLFORM)\s+([^\s(,]+)(?:\((.*)\)|,\s*(.*))?$/i;
const RETURN = /^RETURNF?\s*(.*)$/i;
const SLOT_SET = /^(LOCAL|RESULT)(?::(\d+))?\s*=\s*(.+)$/i;
const FRAME_SET_BIT = /^SETBIT\s+(LOCAL|RESULT)(?::(\d+))?\s*,\s*(.+)$/i;
const STATE_SET_BIT = /^(SETBIT|CLEARBIT)\s+([A-Z_][A-Z0-9_]*(?::[^,\s]+)+)\s*,\s*(.+)$/i;
// String frame slots use the same optional apostrophe assignment marker as
// declared #DIMS variables in upstream ERB (for example, `RESULTS '= ""`).
const STRING_SLOT_SET = /^(LOCALS|RESULTS)(?::(\d+))?\s*'?\s*=\s*(.*)$/i;
// Emuera permits authored local names in the project's Japanese and Chinese
// sources. Keep this narrower than a generic non-whitespace capture so a
// namespace expression can never become a local assignment accidentally.
const LOCAL_IDENTIFIER = "[\\p{L}_][\\p{L}\\p{N}_]*";
const STRING_VARIABLE_SET = new RegExp(`^(${LOCAL_IDENTIFIER})\\s*'\\s*=\\s*(.*)$`, "iu");
const NUMBER_VARIABLE_SET = new RegExp(`^(${LOCAL_IDENTIFIER})\\s*=\\s*(.+)$`, "iu");
const SYMBOL_SET = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/i;
const STATE_SET = /^([A-Z_][A-Z0-9_]*(?::[^=]+))\s*=\s*(.+)$/i;
const STATE_INCREMENT = /^([A-Z_][A-Z0-9_]*(?::[^\s]+)+)\s*(\+\+|--)$/i;
const VARSET = new RegExp(`^VARSET\\s+(${LOCAL_IDENTIFIER}|LOCAL|RESULT|LOCALS|RESULTS)$`, "iu");
const PRINT_BUTTON = /^PRINTBUTTONC?\s+@?"([\s\S]*)"\s*,\s*(.+)$/i;
const INPUT = /^(INPUTS?|\$INPUT(?:STR)?|INPUTSTR)$/i;
const WAIT = /^WAIT$/i;
const PRESENTATION_CALL = /^(REDRAW|CLEARLINE)\s+(.+)$/i;
const DRAW_LINE = /^DRAWLINE$/i;
const SET_COLOR = /^SETCOLOR\s+(.+)$/i;
const GOTO = /^GOTO\s+(.+)$/iu;
const SKIP_START = /^\[SKIPSTART\]$/i;
const SKIP_END = /^\[SKIPEND\]$/i;
const FRAME_INCREMENT = /^(LOCAL|RESULT)(?::(\d+))?\s*(\+\+|--)$/i;
const NUMBER_VARIABLE_UPDATE = new RegExp(`^(${LOCAL_IDENTIFIER})\\s*(\\+=|-=|\\+\\+|--)(?:\\s*(.+))?$`, "iu");
const EMPTY_STRING_VARIABLES: ReadonlySet<string> = new Set();

function stripComment(line: string): string {
  const index = line.indexOf(";");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function normalizeGotoLabel(value: string): string {
  return value.trim().replace(/^\$/, "");
}

function location(file: string, line: number): KojoVmLocation {
  return { file, line };
}

function parseValue(raw: string, numberVariables: ReadonlySet<string>, stringVariables: ReadonlySet<string> = EMPTY_STRING_VARIABLES): KojoVmNumberValue | null {
  const value = stripOuterParens(raw);
  if (/^-?\d+$/.test(value)) return { kind: "number", value: Number(value) };
  if (/^0x[0-9a-f]+$/i.test(value)) return { kind: "number", value: Number(value) };
  const bitValue = /^(-?\d+)\s*[pP]\s*(\d+)$/.exec(value);
  if (bitValue) {
    const parsed = Number(bitValue[1]) * 2 ** Number(bitValue[2]);
    if (Number.isSafeInteger(parsed)) return { kind: "number", value: parsed };
  }
  const projectArray = new RegExp(`^__KOJO_VM_ARRAY\\((${LOCAL_IDENTIFIER}),\\s*([^()]+)\\)$`, "iu").exec(value);
  if (projectArray) {
    const index = parseValue(projectArray[2]!, numberVariables, stringVariables);
    return index ? { kind: "array", name: projectArray[1]!.toUpperCase(), index } : null;
  }
  for (const operators of [["|"], ["^"], ["&"], ["+", "-"], ["*", "/", "%"]] as const) {
    const binary = splitTopLevelBinary(value, operators);
    if (binary) {
      const left = parseValue(binary.left, numberVariables, stringVariables);
      const right = parseValue(binary.right, numberVariables, stringVariables);
      return left && right
        ? { kind: "binary", op: binary.op as Extract<KojoVmNumberValue, { kind: "binary" }>['op'], left, right }
        : null;
    }
  }
  if (value.startsWith("-")) {
    const operand = parseValue(value.slice(1), numberVariables, stringVariables);
    return operand ? { kind: "unary", op: "-", value: operand } : null;
  }
  const slot = /^(ARG|LOCAL|RESULT)(?::(\d+))?$/i.exec(value);
  if (slot) return { kind: "slot", scope: slot[1].toLowerCase() as "arg" | "local" | "result", index: Number(slot[2] ?? 0) };
  if (numberVariables.has(value.toUpperCase())) return { kind: "variable", name: value.toUpperCase() };
  const getBit = /^GETBIT\((.*)\)$/i.exec(value);
  if (getBit) {
    const args = splitArguments(getBit[1]).map((entry) => parseValue(entry, numberVariables, stringVariables));
    return args.length === 2 && args.every((entry): entry is KojoVmNumberValue => entry !== null)
      ? { kind: "builtin", name: "GETBIT", args }
      : null;
  }
  const rand = /^RAND\((.*)\)$/i.exec(value);
  if (rand) {
    const args = splitArguments(rand[1]).map((entry) => parseValue(entry, numberVariables, stringVariables));
    return args.length === 1 && args[0]
      ? { kind: "builtin", name: "RAND", args: [args[0]] }
      : null;
  }
  const limit = /^LIMIT\((.*)\)$/i.exec(value);
  if (limit) {
    const args = splitArguments(limit[1]).map((entry) => parseValue(entry, numberVariables, stringVariables));
    return args.length === 3 && args.every((entry): entry is KojoVmNumberValue => entry !== null)
      ? { kind: "builtin", name: "LIMIT", args }
      : null;
  }
  const worldPredicate = /^(BATHCHECK|IN_HOME|CHK_DATENOW)\((.*)\)$/i.exec(value);
  if (worldPredicate) {
    const args = splitArguments(worldPredicate[2]).map((entry) => parseValue(entry, numberVariables, stringVariables));
    return args.length === 1 && args.every((entry): entry is KojoVmNumberValue => entry !== null)
      ? { kind: "builtin", name: worldPredicate[1].toUpperCase() as "BATHCHECK" | "IN_HOME" | "CHK_DATENOW", args }
      : null;
  }
  const outRoof = /^OUTROOF\((.*)\)$/i.exec(value);
  if (outRoof) {
    const rawArgument = outRoof[1]?.trim();
    return rawArgument ? { kind: "builtin", name: "OUTROOF", args: [], rawArgument } : null;
  }
  if (/^GETCOLOR\(\)$/i.test(value)) return { kind: "builtin", name: "GETCOLOR", args: [] };
  if (/^CURRENTREDRAW\(\)$/i.test(value)) return { kind: "builtin", name: "CURRENTREDRAW", args: [] };
  if (/^LINECOUNT$/i.test(value)) return { kind: "line-count" };
  const stringCount = /^STRCOUNT\((.*)\)$/i.exec(value);
  if (stringCount) {
    const args = splitArguments(stringCount[1]).map((entry) => parseStringReference(entry, stringVariables));
    return args.length === 2 && args.every((entry): entry is KojoVmStringValue => entry !== null)
      ? { kind: "string-count", source: args[0], pattern: args[1] }
      : null;
  }
  const stringLength = /^STRLENS\((.*)\)$/i.exec(value);
  if (stringLength) {
    const argument = parseStringReference(stringLength[1]!, stringVariables);
    return argument ? { kind: "string-length", value: argument } : null;
  }
  const expressionCall = /^([^\s(,]+)\((.*)\)$/u.exec(value);
  if (expressionCall && !/[{%]/.test(expressionCall[1])) {
    const args = parseArguments(expressionCall[2], stringVariables, numberVariables);
    const memory = expressionCall[1].toUpperCase();
    if ((memory === "FIRSTTIME" || memory === "ONCE") && args && args.length >= 1 && args.length <= 3) {
      const query = args[1];
      const subject = args[2];
      return (!query || query.kind === "number") && (!subject || subject.kind === "number")
        ? {
          kind: "memory-check",
          memory,
          key: args[0]!,
          query: query?.value ?? { kind: "number", value: 0 },
          subject: subject?.value,
        }
        : null;
    }
    return args ? { kind: "call-expression", target: expressionCall[1], args } : null;
  }
  // Symbol names come from upstream CSV/ERH tables and may contain a fullwidth
  // slash (for example `TALENT:幼児／幼児退行`). It is data, not division.
  return (/^\[\[[^\]]+\]\]$/u.test(value) || /^[A-Z_][A-Z0-9_:()\[\]{}／ぁ-ゖァ-ー一-鿿]*$/i.test(value))
    ? { kind: "symbol", raw: value }
    : null;
}

function parseStringValue(raw: string, stringVariables: ReadonlySet<string>): KojoVmStringValue {
  const value = raw.trim();
  const slot = /^(ARGS|LOCALS|RESULTS)(?::(\d+))?$/i.exec(value);
  if (slot) return { kind: "slot", scope: slot[1].toLowerCase() as "args" | "locals" | "results", index: Number(slot[2] ?? 0) };
  if (stringVariables.has(value.toUpperCase())) return { kind: "variable", name: value.toUpperCase() };
  const stringCase = /^(TOLOWER|TOUPPER)\((.*)\)$/i.exec(value);
  if (stringCase) {
    const source = parseStringReference(stringCase[2]!, stringVariables);
    if (source) return { kind: "case", mode: stringCase[1]!.toUpperCase() === "TOLOWER" ? "lower" : "upper", value: source };
  }
  const replace = /^REPLACE\((.*)\)$/i.exec(value);
  if (replace) {
    const args = splitArguments(replace[1]).map((entry) => parseStringReference(entry, stringVariables));
    if (args.length === 3 && args.every((entry): entry is KojoVmStringValue => entry !== null)) {
      return { kind: "replace", source: args[0], pattern: args[1], replacement: args[2] };
    }
  }
  const quoted = /^(?:@)?(?:"([\s\S]*)"|'([\s\S]*)')$/.exec(value);
  if (quoted) return { kind: "string", value: quoted[1] ?? quoted[2] ?? "" };
  if (/^(?:CSTR|TSTR|NAME|MASTERNAME|CALLNAME):.+$/iu.test(value)) return { kind: "symbol", raw: value };
  return { kind: "string", value };
}

function parseStringReference(raw: string, stringVariables: ReadonlySet<string>): KojoVmStringValue | null {
  const value = raw.trim();
  const parsed = parseStringValue(value, stringVariables);
  if (parsed.kind !== "string" || /^(?:"[\s\S]*"|'[\s\S]*')$/.test(value)) return parsed;
  // Keep namespace reads explicit. A bare unquoted token remains authored text
  // in regular string contexts and must not silently turn into a host lookup.
  return /^(?:CSTR|TSTR|NAME|MASTERNAME|CALLNAME):.+$/iu.test(value) ? { kind: "symbol", raw: value } : null;
}

function parseStringStateValue(raw: string, stringVariables: ReadonlySet<string>): KojoVmStringValue | null {
  const template = /^%([\s\S]+)%$/.exec(raw.trim());
  return template
    ? parseStringReference(template[1]!, stringVariables)
    : parseStringReference(raw, stringVariables);
}

function parseArguments(raw: string | undefined, stringVariables: ReadonlySet<string>, numberVariables: ReadonlySet<string>): KojoVmCallArgument[] | null {
  if (!raw?.trim()) return [];
  return raw.split(",").map((entry) => {
    if (/^(ARGS|LOCALS|RESULTS)(?::\d+)?$/i.test(entry.trim())) {
      return { kind: "string", value: parseStringValue(entry, stringVariables) };
    }
    const number = parseValue(entry, numberVariables, stringVariables);
    return number ? { kind: "number", value: number } : { kind: "string", value: parseStringValue(entry, stringVariables) };
  });
}

function parseFunctionParameters(
  raw: string | undefined,
  stringVariables: ReadonlySet<string>,
  numberVariables: ReadonlySet<string>,
): KojoVmParameter[] {
  if (!raw?.trim()) return [];
  let nextNumber = 0;
  let nextString = 0;
  const parameters: KojoVmParameter[] = [];
  for (const entry of splitArguments(raw)) {
    const match = new RegExp(`^(${LOCAL_IDENTIFIER}|ARGS?|LOCALS?|RESULTS?)(?::(\\d+))?(?:\\s*=\\s*(.*))?$`, "iu").exec(entry.trim());
    if (!match) return [];
    const name = match[1]!.toUpperCase();
    const explicitIndex = match[2] === undefined ? undefined : Number(match[2]);
    const defaultRaw = match[3];
    const directString = /^(?:ARGS|LOCALS|RESULTS)$/i.test(name);
    const kind = directString || stringVariables.has(name)
      || (defaultRaw !== undefined && /^(?:@)?(?:"[\s\S]*"|'[\s\S]*')$/.test(defaultRaw.trim()))
      ? "string"
      : "number";
    const index = explicitIndex ?? (kind === "string" ? nextString : nextNumber);
    if (kind === "string") {
      nextString = Math.max(nextString, index + 1);
      const defaultValue = defaultRaw === undefined ? undefined : parseStringReference(defaultRaw, stringVariables);
      if (defaultRaw !== undefined && !defaultValue) return [];
      parameters.push({ kind, name, index, ...(defaultValue ? { defaultValue } : {}) });
    } else {
      nextNumber = Math.max(nextNumber, index + 1);
      const defaultValue = defaultRaw === undefined ? undefined : parseValue(defaultRaw, numberVariables, stringVariables);
      if (defaultRaw !== undefined && !defaultValue) return [];
      parameters.push({ kind, name, index, ...(defaultValue ? { defaultValue } : {}) });
    }
  }
  return parameters;
}

function parseFor(
  raw: string,
  numberVariables: ReadonlySet<string>,
  stringVariables: ReadonlySet<string>,
): Extract<KojoVmInstruction, { kind: "for" }> | null {
  const values = splitArguments(raw);
  if (values.length < 3 || values.length > 4) return null;
  const frameTarget = /^LOCAL(?::(\d+))?$/i.exec(values[0]!);
  const namedTarget = new RegExp(`^${LOCAL_IDENTIFIER}$`, "iu").exec(values[0]!);
  if (!frameTarget && !namedTarget) return null;
  const start = parseValue(values[1]!, numberVariables, stringVariables);
  if (!start) return null;
  const condition = parseValue(values[2]!, numberVariables, stringVariables);
  const until = condition ? null : compilePredicate(values[2]!, stringVariables, numberVariables);
  const step = parseValue(values[3] ?? "1", numberVariables, stringVariables);
  if ((!condition && !until) || !step) return null;
  return {
    ...(frameTarget ? { index: Number(frameTarget[1] ?? 0) } : { variable: namedTarget![0].toUpperCase() }),
    start,
    ...(condition ? { end: condition } : { until: until! }),
    step,
  };
}

function compileInlineTextSegments(
  text: string,
  stringVariables: ReadonlySet<string>,
  numberVariables: ReadonlySet<string>,
): KojoVmTextSegment[] | null {
  if (!text.includes("\\@")) return [];
  const segments: KojoVmTextSegment[] = [];
  const expression = /\\@\s*([^?]+?)\s*\?\s*([\s\S]*?)\s*#\s*([\s\S]*?)\s*\\@/g;
  let cursor = 0;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    if (match.index > cursor) segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    const predicate = compilePredicate(match[1]!.trim(), stringVariables, numberVariables);
    if (!predicate) return null;
    segments.push({ kind: "conditional", predicate, whenTrue: match[2]!, whenFalse: match[3]! });
    cursor = expression.lastIndex;
  }
  if (cursor === 0) return null;
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

function compileInstruction(raw: string, source: KojoVmLocation, stringVariables: ReadonlySet<string>, numberVariables: ReadonlySet<string>): KojoVmInstruction | null {
  if (!raw || raw.startsWith("#")) return null;
  if (/^RESETCOLOR$/i.test(raw)) return { kind: "reset-color", location: source };
  const setColor = SET_COLOR.exec(raw);
  if (setColor) {
    const color = setColor[1]!.trim();
    const value = parseValue(color, numberVariables, stringVariables);
    return { kind: "set-color", color, ...(value ? { value } : {}), location: source };
  }
  // Emuera's parameterless DRAWLINE is presentation-only. Keep it as a
  // non-dialogue transcript line so the existing owner/session UI shows the
  // separator without inventing a second popup or discarding authored pacing.
  if (DRAW_LINE.test(raw)) return { kind: "emit", text: "────────────────────────", form: "PRINTFORMDL", location: source };
  const jump = GOTO.exec(raw);
  if (jump) return { kind: "jump", target: normalizeGotoLabel(jump[1]!), location: source };
  if (WAIT.test(raw)) return { kind: "wait", location: source };
  const printButton = PRINT_BUTTON.exec(raw);
  if (printButton) {
    const numeric = parseValue(printButton[2], numberVariables, stringVariables);
    return {
      kind: "print-button",
      label: printButton[1] ?? "",
      value: numeric
        ? { kind: "number", value: numeric }
        : { kind: "string", value: parseStringValue(printButton[2], stringVariables) },
      location: source,
    };
  }
  const input = INPUT.exec(raw);
  if (input) {
    const name = input[1].toUpperCase();
    return {
      kind: "input",
      scope: name === "INPUT" ? "result" : "string-result",
      index: 0,
      location: source,
    };
  }
  const presentation = PRESENTATION_CALL.exec(raw);
  if (presentation) {
    const args = splitArguments(presentation[2]).map((entry) => parseValue(entry, numberVariables, stringVariables));
    return args.length > 0 && args.every((entry): entry is KojoVmNumberValue => entry !== null)
      ? { kind: "host-call", name: presentation[1].toUpperCase(), args, location: source }
      : { kind: "unsupported", raw, reason: "unsupported presentation call", location: source };
  }
  const frameIncrement = FRAME_INCREMENT.exec(raw);
  if (frameIncrement) {
    const scope = frameIncrement[1].toUpperCase() === "LOCAL" ? "local-set" : "result-set";
    const index = Number(frameIncrement[2] ?? 0);
    const slot: KojoVmNumberValue = {
      kind: "slot",
      scope: scope === "local-set" ? "local" : "result",
      index,
    };
    return {
      kind: scope,
      index,
      value: { kind: "binary", op: frameIncrement[3] === "++" ? "+" : "-", left: slot, right: { kind: "number", value: 1 } },
      location: source,
    };
  }
  const variableUpdate = NUMBER_VARIABLE_UPDATE.exec(raw);
  if (variableUpdate && numberVariables.has(variableUpdate[1].toUpperCase())) {
    const name = variableUpdate[1].toUpperCase();
    const operator = variableUpdate[2];
    const right = operator === "++" || operator === "--"
      ? { kind: "number", value: 1 } as const
      : parseValue(variableUpdate[3] ?? "", numberVariables, stringVariables);
    if (!right) return { kind: "unsupported", raw, reason: "unsupported numeric variable update", location: source };
    return {
      kind: "number-variable-set",
      name,
      value: { kind: "binary", op: operator === "+=" || operator === "++" ? "+" : "-", left: { kind: "variable", name }, right },
      location: source,
    };
  }
  const print = PRINT.exec(raw);
  if (print) {
    const text = print[2] ?? "";
    const segments = compileInlineTextSegments(text, stringVariables, numberVariables);
    return segments === null
      ? { kind: "unsupported", raw, reason: "unsupported inline text condition", location: source }
      : { kind: "emit", text, ...(segments.length ? { segments } : {}), form: print[1].toUpperCase() as KojoVmPrintForm, location: source };
  }
  const varset = VARSET.exec(raw);
  if (varset) {
    const scope = varset[1].toUpperCase();
    if (numberVariables.has(scope)) {
      return { kind: "number-variable-set", name: scope, value: { kind: "number", value: 0 }, location: source };
    }
    if (stringVariables.has(scope)) {
      return { kind: "string-variable-set", name: scope, value: { kind: "literal", value: "" }, location: source };
    }
    if (scope === "LOCAL" || scope === "RESULT" || scope === "LOCALS" || scope === "RESULTS") {
      return {
        kind: "frame-clear",
        scope: scope === "LOCAL" ? "local" : scope === "RESULT" ? "result" : scope === "LOCALS" ? "string-local" : "string-result",
        location: source,
      };
    }
    return { kind: "unsupported", raw, reason: "unsupported VARSET scope", location: source };
  }
  const call = CALL.exec(raw);
  if (call) {
    const target = call[2]!;
    const rawArgs = call[3] ?? call[4];
    if (target.toUpperCase() === "HPH_PRINT") {
      const values = rawArgs === undefined ? [] : splitArguments(rawArgs);
      if (values.length < 1 || values.length > 2) {
        return { kind: "unsupported", raw, reason: "invalid HPH_PRINT arguments", location: source };
      }
      return {
        kind: "hph-print",
        text: parseStringValue(values[0]!, stringVariables),
        mode: parseStringValue(values[1] ?? '""', stringVariables),
        location: source,
      };
    }
    const args = parseArguments(rawArgs, stringVariables, numberVariables);
    return {
      kind: "call",
      target,
      args,
      dynamic: /[{%]/.test(target),
      optional: call[1]!.toUpperCase().startsWith("TRY"),
      location: source,
    };
  }
  const returnMatch = RETURN.exec(raw);
  if (returnMatch) {
    const value = parseValue(returnMatch[1].trim() || "0", numberVariables, stringVariables);
    return value
      ? { kind: "return", value, location: source }
      : { kind: "unsupported", raw, reason: "unsupported return expression", location: source };
  }
  const stringSlotSet = STRING_SLOT_SET.exec(raw);
  if (stringSlotSet) {
    return {
      kind: "string-set",
      scope: stringSlotSet[1].toUpperCase() === "LOCALS" ? "local" : "result",
      index: Number(stringSlotSet[2] ?? 0),
      value: parseStringValue(stringSlotSet[3], stringVariables),
      location: source,
    };
  }
  const stringVariableSet = STRING_VARIABLE_SET.exec(raw);
  if (stringVariableSet && stringVariables.has(stringVariableSet[1].toUpperCase())) {
    return {
      kind: "string-variable-set",
      name: stringVariableSet[1].toUpperCase(),
      value: parseStringValue(stringVariableSet[2], stringVariables),
      location: source,
    };
  }
  const numberVariableSet = NUMBER_VARIABLE_SET.exec(raw);
  // Upstream often omits the string-assignment apostrophe when copying an
  // INPUTS/RESULTS value into an explicitly declared #DIMS variable.
  if (numberVariableSet && stringVariables.has(numberVariableSet[1].toUpperCase())) {
    const value = parseStringStateValue(numberVariableSet[2], stringVariables);
    return value
      ? { kind: "string-variable-set", name: numberVariableSet[1].toUpperCase(), value, location: source }
      : { kind: "unsupported", raw, reason: "unsupported string variable assignment", location: source };
  }
  if (numberVariableSet && numberVariables.has(numberVariableSet[1].toUpperCase())) {
    const value = parseValue(numberVariableSet[2], numberVariables, stringVariables);
    return value
      ? { kind: "number-variable-set", name: numberVariableSet[1].toUpperCase(), value, location: source }
      : { kind: "unsupported", raw, reason: "unsupported numeric variable assignment", location: source };
  }
  const symbolSet = SYMBOL_SET.exec(raw);
  if (symbolSet && !/^(LOCAL|RESULT)$/i.test(symbolSet[1])) {
    const value = parseValue(symbolSet[2], numberVariables, stringVariables);
    return value
      ? { kind: "symbol-set", name: symbolSet[1].toUpperCase(), value, location: source }
      : { kind: "unsupported", raw, reason: "unsupported host symbol assignment", location: source };
  }
  const slotSet = SLOT_SET.exec(raw);
  if (slotSet) {
    const value = parseValue(slotSet[3], numberVariables, stringVariables);
    if (!value) return { kind: "unsupported", raw, reason: "unsupported assignment expression", location: source };
    return { kind: slotSet[1].toUpperCase() === "LOCAL" ? "local-set" : "result-set", index: Number(slotSet[2] ?? 0), value, location: source };
  }
  const frameSetBit = FRAME_SET_BIT.exec(raw);
  if (frameSetBit) {
    const bit = parseValue(frameSetBit[3], numberVariables, stringVariables);
    return bit
      ? {
        kind: "frame-set-bit",
        scope: frameSetBit[1].toUpperCase() === "LOCAL" ? "local" : "result",
        index: Number(frameSetBit[2] ?? 0),
        bit,
        location: source,
      }
      : { kind: "unsupported", raw, reason: "unsupported SETBIT frame expression", location: source };
  }
  const stateSetBit = STATE_SET_BIT.exec(raw);
  if (stateSetBit) {
    const value = parseValue(stateSetBit[3], numberVariables, stringVariables);
    return value
      ? {
        kind: "state-set",
        target: stateSetBit[2].trim(),
        operation: stateSetBit[1].toUpperCase() === "SETBIT" ? "set-bit" : "clear-bit",
        value,
        location: source,
      }
      : { kind: "unsupported", raw, reason: "unsupported state bit expression", location: source };
  }
  const stateSet = STATE_SET.exec(raw);
  const stateIncrement = STATE_INCREMENT.exec(raw);
  if (stateIncrement) {
    return {
      kind: "state-set",
      target: stateIncrement[1].trim(),
      operation: "add",
      value: { kind: "number", value: stateIncrement[2] === "++" ? 1 : -1 },
      location: source,
    };
  }
  if (stateSet) {
    if (/^(?:NAME|MASTERNAME):/i.test(stateSet[1].trim())) {
      const value = parseStringStateValue(stateSet[2], stringVariables);
      return value
        ? { kind: "string-state-set", target: stateSet[1].trim(), value, location: source }
        : { kind: "unsupported", raw, reason: "unsupported string state assignment", location: source };
    }
    const value = parseValue(stateSet[2], numberVariables, stringVariables);
    return value
      ? { kind: "state-set", target: stateSet[1].trim(), operation: "set", value, location: source }
      : { kind: "unsupported", raw, reason: "unsupported state assignment expression", location: source };
  }
  return { kind: "unsupported", raw, reason: "unrecognized statement", location: source };
}

function isStringReference(raw: string, stringVariables: ReadonlySet<string>): boolean {
  const value = raw.trim();
  return parseStringValue(value, stringVariables).kind !== "string"
    || /^(?:"[\s\S]*"|'[\s\S]*')$/.test(value);
}

function stripOuterParens(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith("(") || !value.endsWith(")")) return value;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")") depth--;
    if (depth === 0 && index < value.length - 1) return value;
  }
  return depth === 0 ? value.slice(1, -1).trim() : value;
}

function splitTopLevel(raw: string, operator: "&&" | "||"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < raw.length - 1; index++) {
    const char = raw[index]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && raw.slice(index, index + 2) === operator) {
      parts.push(raw.slice(start, index).trim());
      start = index + 2;
      index++;
    }
  }
  parts.push(raw.slice(start).trim());
  return parts;
}

function splitArguments(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(raw.slice(start).trim());
  return parts;
}

/** Returns the final top-level binary operator, preserving ERB's left-to-right
 * arithmetic for chained operators while leaving nested function calls intact. */
function splitTopLevelBinary(raw: string, operators: readonly string[]): { left: string; op: string; right: string } | null {
  let depth = 0;
  let quote = "";
  for (let index = raw.length - 1; index >= 0; index--) {
    const char = raw[index]!;
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ")") depth++;
    else if (char === "(") depth--;
    else if (depth === 0 && operators.includes(char)) {
      // A leading sign belongs to its operand, not to a binary expression.
      if (index === 0 || (char === "-" && /[+\-*/%&|^(,]/.test(raw[index - 1] ?? ""))) continue;
      const left = raw.slice(0, index).trim();
      const right = raw.slice(index + 1).trim();
      if (left && right) return { left, op: char, right };
    }
  }
  return null;
}

function compilePredicate(raw: string, stringVariables: ReadonlySet<string>, numberVariables: ReadonlySet<string>): KojoVmPredicate | null {
  const value = stripOuterParens(raw);
  const orParts = splitTopLevel(value, "||");
  if (orParts.length > 1) {
    const parsed = orParts.map((part) => compilePredicate(part, stringVariables, numberVariables));
    return parsed.every((entry): entry is KojoVmPredicate => entry !== null) ? { kind: "or", parts: parsed } : null;
  }
  const parts = splitTopLevel(value, "&&");
  if (parts.length > 1) {
    const parsed = parts.map((part) => compilePredicate(part, stringVariables, numberVariables));
    return parsed.every((entry): entry is KojoVmPredicate => entry !== null) ? { kind: "and", parts: parsed } : null;
  }
  if (value.startsWith("!")) {
    const inner = compilePredicate(value.slice(1).trim(), stringVariables, numberVariables);
    return inner ? { kind: "not", inner } : null;
  }
  const groupMatch = /^GROUPMATCH\((.*)\)$/i.exec(value);
  if (groupMatch) {
    const parts = splitArguments(groupMatch[1]);
    if (parts.length < 2) return null;
    if (isStringReference(parts[0], stringVariables)) {
      return {
        kind: "string-group-match",
        value: parseStringValue(parts[0], stringVariables),
        candidates: parts.slice(1).map((part) => parseStringValue(part, stringVariables)),
      };
    }
    const value = parseValue(parts[0], numberVariables, stringVariables);
    const candidates = parts.slice(1).map((part) => parseValue(part, numberVariables, stringVariables));
    return value && candidates.every((entry): entry is KojoVmNumberValue => entry !== null)
      ? { kind: "number-group-match", value, candidates }
      : null;
  }
  const compare = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(value);
  if (compare) {
    if ((compare[2] === "==" || compare[2] === "!=")
      && (isStringReference(compare[1], stringVariables) || isStringReference(compare[3], stringVariables))) {
      return {
        kind: "string-compare",
        left: parseStringValue(compare[1], stringVariables),
        op: compare[2],
        right: parseStringValue(compare[3], stringVariables),
      };
    }
    const left = parseValue(compare[1], numberVariables, stringVariables);
    const right = parseValue(compare[3], numberVariables, stringVariables);
    return left && right ? { kind: "compare", left, op: compare[2] as "==" | "!=" | ">=" | "<=" | ">" | "<", right } : null;
  }
  const number = parseValue(value, numberVariables, stringVariables);
  return number ? { kind: "truthy", value: number } : null;
}

function collectGotoTargets(source: string): Map<string, Set<string>> {
  const targets = new Map<string, Set<string>>();
  let functionName: string | null = null;
  let skipDepth = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (SKIP_START.test(line)) {
      skipDepth++;
      continue;
    }
    if (SKIP_END.test(line)) {
      skipDepth = Math.max(0, skipDepth - 1);
      continue;
    }
    if (skipDepth > 0) continue;
    const declaration = DECLARATION.exec(line);
    if (declaration) {
      functionName = declaration[1]!;
      continue;
    }
    const jump = functionName ? GOTO.exec(line) : null;
    if (jump) {
      const entries = targets.get(functionName!) ?? new Set<string>();
      entries.add(normalizeGotoLabel(jump[1]!));
      targets.set(functionName!, entries);
    }
  }
  return targets;
}

/** Compile a collection of ERB function declarations into a pure VM program.
 * The compiler deliberately preserves unsupported statements as instructions;
 * execution can then fail closed with a source diagnostic instead of silently
 * skipping authored behavior. */
export function compileKojoVmProgram(source: string, file = "<memory>"): KojoVmProgram {
  const functions: Record<string, KojoVmFunction> = {};
  const gotoTargets = collectGotoTargets(source);
  let current: KojoVmFunction | null = null;
  const sinks: KojoVmInstruction[][] = [];
  // Control blocks from the upstream corpus are not always well-nested. Keep
  // the function root sink intact so malformed structure becomes explicit IR
  // instead of crashing project compilation before VM fail-closed handling.
  const popSink = sinks.pop.bind(sinks);
  sinks.pop = () => sinks.length > 1 ? popSink() : undefined;
  type IfNode = Extract<KojoVmInstruction, { kind: "if" }>;
  type TryCallNode = Extract<KojoVmInstruction, { kind: "try-call" }>;
  type IfFrame = { root: IfNode; active: IfNode | null } | null;
  const ifStack: IfFrame[] = [];
  type SelectNode = Extract<KojoVmInstruction, { kind: "select" | "string-select" }>;
  const selectStack: Array<SelectNode | null> = [];
  const forStack: Array<Extract<KojoVmInstruction, { kind: "for" }> | null> = [];
  const repeatStack: Array<Extract<KojoVmInstruction, { kind: "repeat" }> | null> = [];
  const doStack: Array<Extract<KojoVmInstruction, { kind: "do" }> | null> = [];
  const catchStack: Array<TryCallNode | null> = [];
  let stringVariables = new Set<string>();
  let numberVariables = new Set<string>();
  let pendingSif: IfNode | null = null;
  let parameterSource: string | undefined;
  const finalizeFunction = () => {
    if (current) current.parameters = parseFunctionParameters(parameterSource, stringVariables, numberVariables);
  };
  let skipDepth = 0;
  for (const [offset, rawLine] of source.split(/\r?\n/).entries()) {
    const line = stripComment(rawLine);
    if (SKIP_START.test(line)) {
      skipDepth++;
      continue;
    }
    if (SKIP_END.test(line)) {
      skipDepth = Math.max(0, skipDepth - 1);
      continue;
    }
    if (skipDepth > 0) continue;
    if (!line) continue;
    const declaration = DECLARATION.exec(line);
    if (declaration) {
      finalizeFunction();
      current = { name: declaration[1]!, location: location(file, offset + 1), parameters: [], instructions: [], labels: {} };
      functions[current.name] = current;
      parameterSource = declaration[2];
      sinks.length = 0;
      sinks.push(current.instructions);
      ifStack.length = 0;
      selectStack.length = 0;
      forStack.length = 0;
      repeatStack.length = 0;
      doStack.length = 0;
      catchStack.length = 0;
      stringVariables = new Set<string>();
      numberVariables = new Set<string>();
      pendingSif = null;
      continue;
    }
    if (!current) continue;
    const source = location(file, offset + 1);
    // A bare line is a label only when a static GOTO in this function targets
    // it. Normal fallthrough is represented by a jump into the same body, so
    // labels can appear inside an authored IF/SELECT branch without needing
    // to reconstruct that branch's frame during a transfer.
    const label = normalizeGotoLabel(line);
    if (gotoTargets.get(current.name)?.has(label)) {
      if (pendingSif) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "GOTO label cannot be a SIF body", location: source });
        pendingSif = null;
      } else if (current.labels[label]) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "duplicate GOTO label", location: source });
      } else {
        const body: KojoVmInstruction[] = [];
        current.labels[label] = body;
        sinks.at(-1)!.push({ kind: "jump", target: label, location: source });
        sinks[sinks.length - 1] = body;
      }
      continue;
    }
    const stringDeclaration = new RegExp(`^#DIMS\\s+(?:DYNAMIC\\s+)?(${LOCAL_IDENTIFIER})(?:\\s*'=\\s*(.*))?$`, "iu").exec(line);
    if (stringDeclaration) {
      const name = stringDeclaration[1].toUpperCase();
      stringVariables.add(name);
      if (stringDeclaration[2] !== undefined) {
        const value = parseStringStateValue(stringDeclaration[2], stringVariables);
        sinks.at(-1)!.push(value
          ? { kind: "string-variable-set", name, value, location: source }
          : { kind: "unsupported", raw: line, reason: "unsupported string variable declaration", location: source });
      }
      continue;
    }
    const numberDeclaration = new RegExp(`^#DIM\\s+(?:DYNAMIC\\s+)?(${LOCAL_IDENTIFIER})(?:\\s*=\\s*(.+))?$`, "iu").exec(line);
    if (numberDeclaration) {
      const name = numberDeclaration[1].toUpperCase();
      numberVariables.add(name);
      if (numberDeclaration[2] !== undefined) {
        const value = parseValue(numberDeclaration[2], numberVariables, stringVariables);
        sinks.at(-1)!.push(value
          ? { kind: "number-variable-set", name, value, location: source }
          : { kind: "unsupported", raw: line, reason: "unsupported numeric variable declaration", location: source });
      }
      continue;
    }
    const constantDeclaration = /^#DIM\s+CONST\s+(.+?)\s*=\s*(.+)$/i.exec(line);
    if (constantDeclaration) {
      const name = constantDeclaration[1].trim().toUpperCase();
      numberVariables.add(name);
      const value = parseValue(constantDeclaration[2], numberVariables, stringVariables);
      if (!value) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported numeric constant", location: source });
      } else {
        sinks.at(-1)!.push({ kind: "number-variable-set", name, value, location: source });
      }
      continue;
    }
    if (pendingSif && /^(?:DO|LOOP|REPEAT|FOR|SELECTCASE|CASE(?:ELSE)?|ENDSELECT|NEXT|REND|IF|ELSEIF|ELSE|ENDIF|SIF|CATCH|ENDCATCH)\b/i.test(line)) {
      sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "SIF control-flow body", location: source });
      pendingSif = null;
      continue;
    }
    if (/^CATCH$/i.test(line)) {
      const preceding = sinks.at(-1)!.pop();
      if (!preceding || preceding.kind !== "call") {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "CATCH without call", location: source });
        catchStack.push(null);
        sinks.push([]);
      } else {
        const instruction: TryCallNode = { kind: "try-call", call: preceding, fallback: [], location: source };
        sinks.at(-1)!.push(instruction);
        catchStack.push(instruction);
        sinks.push(instruction.fallback);
      }
      continue;
    }
    if (/^ENDCATCH$/i.test(line)) {
      if (catchStack.length === 0) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "ENDCATCH without CATCH", location: source });
      } else {
        catchStack.pop();
        sinks.pop();
      }
      continue;
    }
    const repeatMatch = /^REPEAT\s+(.+)$/i.exec(line);
    if (repeatMatch) {
      const count = parseValue(repeatMatch[1], numberVariables, stringVariables);
      if (!count) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported REPEAT", location: source });
        repeatStack.push(null);
        sinks.push([]);
      } else {
        const instruction: Extract<KojoVmInstruction, { kind: "repeat" }> = { kind: "repeat", count, body: [], location: source };
        sinks.at(-1)!.push(instruction);
        repeatStack.push(instruction);
        sinks.push(instruction.body);
      }
      continue;
    }
    if (/^REND$/i.test(line)) {
      if (repeatStack.length === 0) sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "REND without REPEAT", location: source });
      else {
        repeatStack.pop();
        sinks.pop();
      }
      continue;
    }
    if (/^DO$/i.test(line)) {
      // The completion predicate arrives on the matching LOOP line. Store a
      // temporary true predicate so malformed/missing LOOP still fails only
      // when that route executes, not while loading the project.
      const instruction: Extract<KojoVmInstruction, { kind: "do" }> = {
        kind: "do", condition: { kind: "truthy", value: { kind: "number", value: 1 } }, body: [], location: source,
      };
      sinks.at(-1)!.push(instruction);
      doStack.push(instruction);
      sinks.push(instruction.body);
      continue;
    }
    const loopMatch = /^LOOP\s+(.+)$/i.exec(line);
    if (loopMatch) {
      const loop = doStack.pop();
      const condition = compilePredicate(loopMatch[1].trim(), stringVariables, numberVariables);
      if (!loop || !condition) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "LOOP without supported DO condition", location: source });
      } else {
        loop.condition = condition;
        sinks.pop();
      }
      continue;
    }
    const forMatch = /^FOR\s+(.+)$/i.exec(line);
    if (forMatch) {
      const loopTarget = splitArguments(forMatch[1])[0]?.trim();
      if (loopTarget && new RegExp(`^${LOCAL_IDENTIFIER}$`, "iu").test(loopTarget) && !/^LOCAL(?::\d+)?$/i.test(loopTarget)) {
        numberVariables.add(loopTarget.toUpperCase());
      }
      const parsed = parseFor(forMatch[1], numberVariables, stringVariables);
      if (!parsed) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported FOR", location: source });
        forStack.push(null);
        sinks.push([]);
      } else {
        const instruction: Extract<KojoVmInstruction, { kind: "for" }> = { kind: "for", ...parsed, body: [], location: source };
        sinks.at(-1)!.push(instruction);
        forStack.push(instruction);
        sinks.push(instruction.body);
      }
      continue;
    }
    if (/^NEXT$/i.test(line)) {
      if (forStack.length === 0) sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "NEXT without FOR", location: source });
      else {
        forStack.pop();
        sinks.pop();
      }
      continue;
    }
    const selectMatch = /^SELECTCASE\s+(.+)$/i.exec(line);
    if (selectMatch) {
      const rawSelector = selectMatch[1].trim();
      const stringSelector = isStringReference(rawSelector, stringVariables);
      const selector = stringSelector ? parseStringValue(rawSelector, stringVariables) : parseValue(rawSelector, numberVariables, stringVariables);
      if (!selector) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported SELECTCASE selector", location: source });
        selectStack.push(null);
        sinks.push([]);
      } else {
        const instruction: SelectNode = stringSelector
          ? { kind: "string-select", selector: selector as KojoVmStringValue, cases: [], defaultCase: [], location: source }
          : { kind: "select", selector: selector as KojoVmNumberValue, cases: [], defaultCase: [], location: source };
        sinks.at(-1)!.push(instruction);
        selectStack.push(instruction);
      }
      continue;
    }
    const caseMatch = /^CASE\s+(.+)$/i.exec(line);
    if (caseMatch) {
      const parent = selectStack.at(-1);
      if (!parent) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported CASE", location: source });
      } else {
        if (parent.cases.length > 0 || parent.defaultCase.length > 0) sinks.pop();
        const body: KojoVmInstruction[] = [];
        if (parent.kind === "string-select") {
          const values = caseMatch[1].split(",").map((value) => parseStringValue(value, stringVariables));
          if (values.some((value) => value.kind !== "string")) {
            sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "dynamic string CASE", location: source });
            continue;
          }
          parent.cases.push({ values: values.map((value) => value.value), body });
        } else {
          const values: number[] = [];
          const ranges: Array<{ start: number; end: number }> = [];
          let valid = true;
          for (const value of caseMatch[1].split(",")) {
            const range = /^(-?\d+)\s+TO\s+(-?\d+)$/i.exec(value.trim());
            if (range) {
              const start = Number(range[1]);
              const end = Number(range[2]);
              if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
                valid = false;
                break;
              }
              ranges.push({ start, end });
              continue;
            }
            const numeric = Number(value.trim());
            if (!Number.isSafeInteger(numeric)) {
              valid = false;
              break;
            }
            values.push(numeric);
          }
          if (!valid) {
            sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unsupported CASE", location: source });
            continue;
          }
          parent.cases.push({ values, ranges, body });
        }
        sinks.push(body);
      }
      continue;
    }
    if (/^CASEELSE$/i.test(line)) {
      const parent = selectStack.at(-1);
      if (!parent) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "CASEELSE without SELECTCASE", location: source });
      } else {
        if (parent.cases.length > 0 || parent.defaultCase.length > 0) sinks.pop();
        parent.defaultCase = [];
        sinks.push(parent.defaultCase);
      }
      continue;
    }
    if (/^ENDSELECT$/i.test(line)) {
      if (selectStack.length === 0) sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "ENDSELECT without SELECTCASE", location: source });
      else {
        selectStack.pop();
        sinks.pop();
      }
      continue;
    }
    const ifMatch = /^IF\s+(.+)$/i.exec(line);
    if (ifMatch) {
      const predicate = compilePredicate(ifMatch[1].trim(), stringVariables, numberVariables);
      const instruction: KojoVmInstruction = predicate
        ? { kind: "if", predicate, then: [], otherwise: [], location: source }
        : { kind: "unsupported", raw: line, reason: "unrecognized IF predicate", location: source };
      sinks.at(-1)!.push(instruction);
      if (instruction.kind === "if") {
        ifStack.push({ root: instruction, active: instruction });
        sinks.push(instruction.then);
      } else {
        ifStack.push(null);
        sinks.push([]);
      }
      continue;
    }
    const elseIfMatch = /^ELSEIF\s+(.+)$/i.exec(line);
    if (elseIfMatch) {
      const frame = ifStack.at(-1);
      if (!frame || !frame.active) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "ELSEIF without active IF", location: source });
      } else {
        sinks.pop();
        const predicate = compilePredicate(elseIfMatch[1].trim(), stringVariables, numberVariables);
        if (!predicate) {
          frame.active.otherwise = [{ kind: "unsupported", raw: line, reason: "unrecognized ELSEIF predicate", location: source }];
          frame.active = null;
          sinks.push([]);
        } else {
          const branch: IfNode = { kind: "if", predicate, then: [], otherwise: [], location: source };
          frame.active.otherwise = [branch];
          frame.active = branch;
          sinks.push(branch.then);
        }
      }
      continue;
    }
    const sifMatch = /^SIF\s+(.+)$/i.exec(line);
    if (sifMatch) {
      const predicate = compilePredicate(sifMatch[1].trim(), stringVariables, numberVariables);
      if (!predicate) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "unrecognized SIF predicate", location: source });
      } else {
        const instruction: IfNode = { kind: "if", predicate, then: [], otherwise: [], location: source };
        sinks.at(-1)!.push(instruction);
        pendingSif = instruction;
      }
      continue;
    }
    if (/^ELSE$/i.test(line)) {
      const frame = ifStack.at(-1);
      if (!frame || !frame.active) {
        sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "ELSE without IF", location: source });
      } else {
        sinks.pop();
        const active = frame.active;
        active.otherwise = [];
        frame.active = null;
        sinks.push(active.otherwise);
      }
      continue;
    }
    if (/^ENDIF$/i.test(line)) {
      if (ifStack.length === 0) sinks.at(-1)!.push({ kind: "unsupported", raw: line, reason: "ENDIF without IF", location: source });
      else {
        ifStack.pop();
        sinks.pop();
      }
      continue;
    }
    if (/^BREAK$/i.test(line)) {
      const instruction: KojoVmInstruction = { kind: "break", location: source };
      if (pendingSif) { pendingSif.then.push(instruction); pendingSif = null; }
      else sinks.at(-1)!.push(instruction);
      continue;
    }
    if (/^CONTINUE$/i.test(line)) {
      const instruction: KojoVmInstruction = { kind: "continue", location: source };
      if (pendingSif) { pendingSif.then.push(instruction); pendingSif = null; }
      else sinks.at(-1)!.push(instruction);
      continue;
    }
    const instruction = compileInstruction(line, source, stringVariables, numberVariables);
    if (instruction) {
      if (pendingSif) {
        pendingSif.then.push(instruction);
        pendingSif = null;
      } else {
        sinks.at(-1)!.push(instruction);
      }
    }
  }
  finalizeFunction();
  return { functions };
}
