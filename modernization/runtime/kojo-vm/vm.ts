import {
  DEFAULT_KOJO_VM_LIMITS,
  formatHphPrintText,
  hphPrintForm,
  type KojoVmDiagnostic,
  type KojoVmExecutionOptions,
  type KojoVmLine,
  type KojoVmHostEvent,
  type KojoVmNumberValue,
  type KojoVmProgram,
  type KojoVmResult,
  type KojoVmWrite,
} from "./types.js";

interface KojoVmCallResult {
  number: number;
  strings: string[];
}

function withFunctionReturns(result: KojoVmResult, functionReturns: readonly { name: string; returnValue: number }[]): KojoVmResult {
  Object.defineProperty(result, "functionReturns", { value: functionReturns, enumerable: false });
  return result;
}

type InstructionResult = number | null | undefined | {
  kind: "jump";
  target: string;
  location: import("./types.js").KojoVmLocation;
} | { kind: "loop-break" | "loop-continue" };

function readSlot(raw: string, args: readonly number[], locals: readonly number[], results: readonly number[]): number | null {
  const slot = /^(ARG|LOCAL|RESULT)(?::(\d+))?$/i.exec(raw);
  if (!slot) return null;
  const values = slot[1].toUpperCase() === "ARG" ? args : slot[1].toUpperCase() === "LOCAL" ? locals : results;
  return values[Number(slot[2] ?? 0)] ?? 0;
}

/** Execute a compiled ERB function with an isolated call stack. No GameState
 * mutation or UI effect is possible in this P1 pure VM slice. */
export function executeKojoVm(
  program: KojoVmProgram,
  entry: string,
  options: KojoVmExecutionOptions = {},
): KojoVmResult {
  const activeLimits = { ...DEFAULT_KOJO_VM_LIMITS, ...options };
  const lines: string[] = [];
  const events: KojoVmLine[] = [];
  const hostEvents: KojoVmHostEvent[] = [];
  const diagnostics: KojoVmDiagnostic[] = [];
  const writes: KojoVmWrite[] = [];
  const functionReturns: { name: string; returnValue: number }[] = [];
  const numberSymbols: Record<string, number> = {};
  const defaultColor = 0xFFFFFF;
  let activeColor = defaultColor;
  let activeRedraw = 1;
  let instructionCount = 0;

  const fail = (diagnostic: KojoVmDiagnostic): null => {
    diagnostics.push(diagnostic);
    return null;
  };

  const run = (
    name: string,
    depth: number,
    args: readonly number[] = [],
    stringArgs: readonly string[] = [],
  ): KojoVmCallResult | null => {
    if (depth > activeLimits.maxCallDepth) {
      return fail({ code: "budget-exceeded", detail: `call depth exceeded at ${name}` });
    }
    const fn = program.functions[name];
    if (!fn) return fail({ code: "missing-function", detail: name });
    const traceStart = functionReturns.length;
    // Function headers may supply defaults. Never mutate an ancestor frame or
    // the caller-provided execution options while binding them.
    const boundArgs = [...args];
    const boundStringArgs = [...stringArgs];
    args = boundArgs;
    stringArgs = boundStringArgs;
    const localLinesStart = lines.length;
    const eventsStart = events.length;
    const hostEventsStart = hostEvents.length;
    const writesStart = writes.length;
    const colorStart = activeColor;
    const redrawStart = activeRedraw;
    const locals: number[] = [];
    const results: number[] = [];
    const stringLocals: string[] = [];
    const stringResults: string[] = [];
    const stringVariables: Record<string, string> = {};
    const numberVariables: Record<string, number> = {};
    const evaluate = (value: KojoVmNumberValue): number | null => {
      if (value.kind === "number") return value.value;
      if (value.kind === "array") {
        const index = evaluate(value.index);
        const values = program.globalNumberArrays?.[value.name];
        return index === null || !Number.isSafeInteger(index) || !values || index < 0 || index >= values.length
          ? null
          : values[index] ?? null;
      }
      if (value.kind === "variable") return numberVariables[value.name] ?? 0;
      if (value.kind === "unary") {
        const operand = evaluate(value.value);
        return operand === null || !Number.isSafeInteger(operand) ? null : -operand;
      }
      if (value.kind === "binary") {
        const left = evaluate(value.left);
        const right = evaluate(value.right);
        if (left === null || right === null || !Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
        const result = value.op === "+" ? left + right
          : value.op === "-" ? left - right
            : value.op === "*" ? left * right
              : value.op === "/" ? (right === 0 ? null : Math.trunc(left / right))
                : value.op === "%" ? (right === 0 ? null : left % right)
                  : value.op === "&" ? left & right
                    : value.op === "|" ? left | right : left ^ right;
        return result === null || !Number.isSafeInteger(result) ? null : result;
      }
      if (value.kind === "builtin") {
        if (value.name === "GETCOLOR") return activeColor;
        if (value.name === "CURRENTREDRAW") return activeRedraw;
        if (value.name === "OUTROOF") {
          return options.resolveNumberSymbol?.({
            functionName: name,
            raw: `OUTROOF:${value.rawArgument}`,
            args,
            locals,
            results,
            numberVariables,
            numberSymbols,
            writes,
          }) ?? null;
        }
        const builtinArgs: number[] = [];
        for (const argument of value.args) {
          const resolved = evaluate(argument);
          if (resolved === null) return null;
          builtinArgs.push(resolved);
        }
        if (value.name === "RAND") {
          const upper = builtinArgs[0];
          if (upper === undefined || !Number.isSafeInteger(upper) || upper <= 0) return null;
          return options.resolveNumberSymbol?.({ functionName: name, raw: `RAND:${upper}`, args: builtinArgs, locals, results, numberVariables, numberSymbols, writes }) ?? null;
        }
        if (value.name === "BATHCHECK" || value.name === "IN_HOME" || value.name === "CHK_DATENOW") {
          const roomId = builtinArgs[0];
          return roomId === undefined
            ? null
            : options.resolveNumberSymbol?.({ functionName: name, raw: `${value.name}:${roomId}`, args: builtinArgs, locals, results, numberVariables, numberSymbols, writes }) ?? null;
        }
        if (value.name === "LIMIT") {
          const [source, minimum, maximum] = builtinArgs;
          return source === undefined || minimum === undefined || maximum === undefined || minimum > maximum
            ? null
            : Math.max(minimum, Math.min(source, maximum));
        }
        const [source, bit] = builtinArgs;
        if (!Number.isSafeInteger(source) || !Number.isSafeInteger(bit) || bit < 0 || bit > 52) return null;
        return Math.floor(source / 2 ** bit) % 2;
      }
      if (value.kind === "line-count") return events.length;
      if (value.kind === "string-count") {
        const source = evaluateString(value.source);
        const pattern = evaluateString(value.pattern);
        if (source === null || pattern === null) return null;
        try {
          const insensitive = pattern.includes("(?i)");
          const expression = new RegExp(pattern.replaceAll("(?i)", ""), insensitive ? "gi" : "g");
          let count = 0;
          for (let match = expression.exec(source); match !== null; match = expression.exec(source)) {
            count++;
            // Global JS regexes do not advance consistently after zero-width
            // matches, whereas Emuera counts each regular-expression hit.
            if (match[0] === "") expression.lastIndex++;
          }
          return count;
        } catch {
          return null;
        }
      }
      if (value.kind === "string-length") {
        const source = evaluateString(value.value);
        return source === null ? null : Array.from(source).length;
      }
      if (value.kind === "memory-check") {
        const key = value.key.kind === "number"
          ? (() => {
            const resolved = evaluate(value.key.value);
            if (resolved === null) return null;
            return value.key.value.kind === "symbol" && value.key.value.raw.toUpperCase() === "SELECTCOM"
              ? `SELECTCOM:${resolved}`
              : String(resolved);
          })()
          : evaluateString(value.key.value);
        const query = evaluate(value.query);
        const subjectValue = value.subject ? evaluate(value.subject) : undefined;
        if (key === null || query === null || (subjectValue !== undefined && (!Number.isSafeInteger(subjectValue)))) return null;
        const subject = subjectValue ?? undefined;
        const resolved = options.resolveKojoMemory?.({ functionName: name, memory: value.memory, key, subject, writes });
        if (!resolved || !Number.isSafeInteger(resolved.charaNum)) return null;
        const seen = resolved.seen || writes.some((write) => "kind" in write && write.kind === "memory"
          && write.memory === value.memory && write.charaNum === resolved.charaNum && write.key === key);
        if (seen) return 0;
        if (query === 0) writes.push({ kind: "memory", memory: value.memory, charaNum: resolved.charaNum, key, location: fn.location });
        return 1;
      }
      if (value.kind === "call-expression") {
        const numberArgs: number[] = [];
        const expressionStrings: string[] = [];
        for (const argument of value.args) {
          if (argument.kind === "number") {
            const resolved = evaluate(argument.value);
            if (resolved === null) return null;
            numberArgs.push(resolved);
          } else {
            const resolved = evaluateString(argument.value);
            if (resolved === null) return null;
            expressionStrings.push(resolved);
          }
        }
        return run(value.target, depth + 1, numberArgs, expressionStrings)?.number ?? null;
      }
      if (value.kind === "symbol") {
        return numberSymbols[value.raw.toUpperCase()]
          ?? options.resolveNumberSymbol?.({ functionName: name, raw: value.raw, args, locals, results, numberVariables, numberSymbols, writes })
          ?? null;
      }
      const slots = value.scope === "arg" ? args : value.scope === "local" ? locals : results;
      return slots[value.index] ?? 0;
    };
    const evaluatePredicate = (predicate: import("./types.js").KojoVmPredicate): boolean | null => {
      switch (predicate.kind) {
        case "truthy": {
          const value = evaluate(predicate.value);
          return value === null ? null : value !== 0;
        }
        case "not": {
          const value = evaluatePredicate(predicate.inner);
          return value === null ? null : !value;
        }
        case "and": {
          for (const part of predicate.parts) {
            const value = evaluatePredicate(part);
            if (value === null || !value) return value;
          }
          return true;
        }
        case "or": {
          for (const part of predicate.parts) {
            const value = evaluatePredicate(part);
            if (value === null || value) return value;
          }
          return false;
        }
        case "compare": {
          const left = evaluate(predicate.left);
          const right = evaluate(predicate.right);
          if (left === null || right === null) return null;
          return predicate.op === "==" ? left === right
            : predicate.op === "!=" ? left !== right
            : predicate.op === ">=" ? left >= right
            : predicate.op === "<=" ? left <= right
            : predicate.op === ">" ? left > right : left < right;
        }
        case "string-compare": {
          const left = evaluateString(predicate.left);
          const right = evaluateString(predicate.right);
          if (left === null || right === null) return null;
          return predicate.op === "==" ? left === right : left !== right;
        }
        case "number-group-match": {
          const value = evaluate(predicate.value);
          if (value === null) return null;
          const candidates = predicate.candidates.map(evaluate);
          return candidates.some((candidate) => candidate === null) ? null : candidates.includes(value);
        }
        case "string-group-match": {
          const value = evaluateString(predicate.value);
          if (value === null) return null;
          const candidates = predicate.candidates.map(evaluateString);
          return candidates.some((candidate) => candidate === null) ? null : candidates.includes(value);
        }
      }
    };
    const evaluateString = (value: import("./types.js").KojoVmStringValue): string | null => {
      if (value.kind === "string") {
        // CALL arguments may contain the caller's dynamic string variables
        // (for example CHARA_TEXT's `%NAME_RESULTS%`). Resolve only frame
        // slots/variables here; ordinary PRINTFORM host placeholders retain
        // their established rendering boundary.
        return value.value.replace(/%([^%]+)%/g, (whole, raw: string) => {
          const slot = /^(ARGS|LOCALS|RESULTS)(?::(\d+))?$/i.exec(raw.trim());
          if (slot) {
            const values = slot[1].toUpperCase() === "ARGS" ? stringArgs
              : slot[1].toUpperCase() === "LOCALS" ? stringLocals : stringResults;
            return values[Number(slot[2] ?? 0)] ?? "";
          }
          const name = raw.trim();
          const variable = stringVariables[name.toUpperCase()];
          if (variable !== undefined) return variable;
          const symbol = options.resolveStringSymbol?.({
            functionName: name, raw: name, args, locals, results, stringArgs, stringLocals, stringResults,
            stringVariables, numberVariables, numberSymbols, writes,
          });
          return symbol ?? whole;
        });
      }
      if (value.kind === "variable") return stringVariables[value.name] ?? "";
      if (value.kind === "case") {
        const source = evaluateString(value.value);
        return source === null ? null : value.mode === "lower" ? source.toLowerCase() : source.toUpperCase();
      }
      if (value.kind === "replace") {
        const source = evaluateString(value.source);
        const pattern = evaluateString(value.pattern);
        const replacement = evaluateString(value.replacement);
        if (source === null || pattern === null || replacement === null) return null;
        try {
          const insensitive = pattern.includes("(?i)");
          return source.replace(new RegExp(pattern.replaceAll("(?i)", ""), insensitive ? "gi" : "g"), replacement);
        } catch {
          return null;
        }
      }
      if (value.kind === "symbol") {
        return options.resolveStringSymbol?.({
          functionName: name, raw: value.raw, args, locals, results, stringArgs, stringLocals, stringResults,
          stringVariables, numberVariables, numberSymbols, writes,
        }) ?? null;
      }
      const slots = value.scope === "args" ? stringArgs : value.scope === "locals" ? stringLocals : stringResults;
      return slots[value.index] ?? "";
    };
    const bindParameters = (): boolean => {
      for (const parameter of fn.parameters) {
        if (parameter.kind === "number") {
          let value = boundArgs[parameter.index];
          if (value === undefined && parameter.defaultValue) {
            const fallback = evaluate(parameter.defaultValue);
            if (fallback === null) return false;
            value = fallback;
          }
          if (value !== undefined && !Number.isSafeInteger(value)) return false;
          if (value !== undefined) boundArgs[parameter.index] = value;
          if (!/^(?:ARG|LOCAL|RESULT)(?::\d+)?$/i.test(parameter.name)) numberVariables[parameter.name] = value ?? 0;
        } else {
          let value = boundStringArgs[parameter.index];
          if (value === undefined && parameter.defaultValue) {
            const fallback = evaluateString(parameter.defaultValue);
            if (fallback === null) return false;
            value = fallback;
          }
          if (value !== undefined) boundStringArgs[parameter.index] = value;
          if (!/^(?:ARGS|LOCALS|RESULTS)(?::\d+)?$/i.test(parameter.name)) stringVariables[parameter.name] = value ?? "";
        }
      }
      return true;
    };
    if (!bindParameters()) return fail({ code: "unsupported-statement", detail: `invalid function parameters: ${name}`, location: fn.location });
    const resolveTemplate = (template: string): string | null => {
      let unresolved = false;
      const resolved = template.replace(/%([^%]+)%|\{([^{}]+)\}/g, (whole, stringExpression: string | undefined, numberExpression: string | undefined) => {
        if (stringExpression !== undefined) {
          const value = /^(ARGS|LOCALS|RESULTS)(?::(\d+))?$/i.exec(stringExpression);
          if (value) {
            const resolved = evaluateString({ kind: "slot", scope: value[1].toLowerCase() as "args" | "locals" | "results", index: Number(value[2] ?? 0) });
            if (resolved !== null) return resolved;
          }
          const variable = stringVariables[stringExpression.toUpperCase()];
          if (variable !== undefined) return variable;
          const symbol = options.resolveStringSymbol?.({
            functionName: name, raw: stringExpression.trim(), args, locals, results, stringArgs, stringLocals, stringResults,
            stringVariables, numberVariables, numberSymbols, writes,
          });
          if (symbol !== null && symbol !== undefined) return symbol;
          unresolved = true;
          return whole;
        }
        const raw = numberExpression!.trim();
        const value = readSlot(raw, args, locals, results)
          ?? numberVariables[raw.toUpperCase()]
          ?? numberSymbols[raw.toUpperCase()]
          ?? options.resolveNumberSymbol?.({ functionName: name, raw, args, locals, results, numberVariables, numberSymbols, writes })
          ?? null;
        if (value !== null) return String(value);
        unresolved = true;
        return whole;
      });
      return unresolved ? null : resolved;
    };
    const renderText = (text: string, segments?: import("./types.js").KojoVmTextSegment[]): string | null => {
      // `PANTSNAME` is a VM-owned typed host query. Resolve it now instead of
      // leaking an authored expression into the transcript. Other ordinary
      // PRINTFORM placeholders retain the established adapter contract until
      // their host namespaces have a complete fail-closed implementation.
      if (!segments) {
        const variable = /^%([^%]+)%$/.exec(text)?.[1]?.trim().toUpperCase();
        return /%PANTSNAME\(/i.test(text) || /^%(?:ARGS|LOCALS|RESULTS)(?::\d+)?%$/i.test(text)
          || (variable !== undefined && stringVariables[variable] !== undefined)
          ? resolveTemplate(text)
          : text;
      }
      let rendered = "";
      for (const segment of segments) {
        const selected = segment.kind === "text"
          ? segment.text
          : (() => {
            const selected = evaluatePredicate(segment.predicate);
            return selected === null ? null : selected ? segment.whenTrue : segment.whenFalse;
          })();
        if (selected === null) return null;
        const resolved = resolveTemplate(selected);
        if (resolved === null) return null;
        rendered += resolved;
      }
      return rendered;
    };
    const failValue = (detail: string, location: import("./types.js").KojoVmLocation): null => {
      lines.splice(localLinesStart);
      events.splice(eventsStart);
      hostEvents.splice(hostEventsStart);
      writes.splice(writesStart);
      activeColor = colorStart;
      activeRedraw = redrawStart;
      return fail({ code: "unsupported-statement", detail, location });
    };
    const invokeCall = (
      instruction: Extract<import("./types.js").KojoVmInstruction, { kind: "call" }>,
      missingOptionalIsFailure = false,
    ): KojoVmCallResult | "skipped" | null => {
      const dynamicContext = { functionName: name, template: instruction.target, args, locals, results, stringArgs, stringLocals, stringResults, stringVariables, numberVariables, numberSymbols, writes };
      const callTarget = instruction.dynamic
        ? options.resolveDynamicCall?.(dynamicContext) ?? resolveTemplate(instruction.target)
        : instruction.target;
      if (!callTarget) return fail({ code: "dynamic-call", detail: instruction.target, location: instruction.location });
      const target = program.functions[callTarget];
      const numberArgs: number[] = [];
      const nextStringArgs: string[] = [];
      for (const argument of instruction.args) {
        if (argument.kind === "string") {
          const value = evaluateString(argument.value);
          if (value === null) return failValue("unresolved string call argument", instruction.location);
          nextStringArgs.push(value);
        }
        else {
          const value = evaluate(argument.value);
          if (value === null) return failValue("unresolved call argument", instruction.location);
          numberArgs.push(value);
        }
      }
      if (!target) {
        const capability = options.hostCapabilities?.[callTarget];
        if (capability) {
          const result = capability({
            name: callTarget,
            functionName: name,
            args: numberArgs,
            stringArgs: nextStringArgs,
            location: instruction.location,
          });
          if (result === null) return failValue(`host capability rejected call: ${callTarget}`, instruction.location);
          if (result.lines) {
            lines.push(...result.lines.map((line) => line.text));
            events.push(...result.lines);
          }
          hostEvents.push({
            kind: "host-call",
            name: callTarget,
            args: numberArgs,
            stringArgs: nextStringArgs,
            location: instruction.location,
          });
          return { number: result.returnValue ?? 0, strings: [...(result.stringResults ?? [])] };
        }
        if (instruction.optional && !missingOptionalIsFailure) return "skipped";
      }
      return run(callTarget, depth + 1, numberArgs, nextStringArgs);
    };
    const runInstructions = (instructions: Readonly<typeof fn.instructions>): InstructionResult => {
      for (const instruction of instructions) {
      instructionCount++;
      if (instructionCount > activeLimits.maxInstructions) {
        lines.splice(localLinesStart);
        events.splice(eventsStart);
        hostEvents.splice(hostEventsStart);
        writes.splice(writesStart);
        activeColor = colorStart;
          return fail({ code: "budget-exceeded", detail: `instruction budget exceeded at ${name}`, location: instruction.location });
      }
      switch (instruction.kind) {
        case "emit": {
          const text = renderText(instruction.text, instruction.segments);
          if (text === null) return failValue("unresolved inline text condition", instruction.location);
          lines.push(text);
          events.push({ text, form: instruction.form, location: instruction.location });
          break;
        }
        case "hph-print": {
          const text = evaluateString(instruction.text);
          const mode = evaluateString(instruction.mode);
          if (text === null || mode === null) return failValue("unresolved HPH_PRINT argument", instruction.location);
          const form = hphPrintForm(mode);
          const rendered = formatHphPrintText(text);
          lines.push(rendered);
          events.push({ text: rendered, form, location: instruction.location });
          break;
        }
        case "print-button":
        case "input":
        case "wait":
          // Interactive instructions must only run through the continuation
          // executor. The ordinary synchronous entry point must not silently
          // skip them and commit a partial ERB transaction.
          return failValue(`interactive instruction requires continuation: ${instruction.kind}`, instruction.location);
        case "host-call": {
          const args: number[] = [];
          for (const argument of instruction.args) {
            const value = evaluate(argument);
            if (value === null) return failValue(`unresolved ${instruction.name} argument`, instruction.location);
            args.push(value);
          }
          if (instruction.name === "REDRAW") activeRedraw = args[0] ?? activeRedraw;
          hostEvents.push({ kind: "host-call", name: instruction.name, args, stringArgs: [], location: instruction.location });
          break;
        }
        case "reset-color":
          activeColor = defaultColor;
          hostEvents.push({ kind: "reset-color", location: instruction.location });
          break;
        case "set-color": {
          if (instruction.value) {
            const value = evaluate(instruction.value);
            if (value === null || !Number.isSafeInteger(value) || value < 0 || value > 0xFFFFFF) return failValue("invalid SETCOLOR value", instruction.location);
            activeColor = value;
            hostEvents.push({ kind: "set-color", color: `0x${value.toString(16).toUpperCase().padStart(6, "0")}`, location: instruction.location });
          } else {
            hostEvents.push({ kind: "set-color", color: instruction.color, location: instruction.location });
          }
          break;
        }
        case "local-set":
          {
            const value = evaluate(instruction.value);
            if (value === null) return failValue(`unresolved value: ${instruction.value.kind === "symbol" ? instruction.value.raw : "frame slot"}`, instruction.location);
            locals[instruction.index] = value;
          }
          break;
        case "result-set":
          {
            const value = evaluate(instruction.value);
            if (value === null) return failValue(`unresolved value: ${instruction.value.kind === "symbol" ? instruction.value.raw : "frame slot"}`, instruction.location);
            results[instruction.index] = value;
          }
          break;
        case "frame-set-bit": {
          const bit = evaluate(instruction.bit);
          const slots = instruction.scope === "local" ? locals : results;
          const current = slots[instruction.index] ?? 0;
          if (bit === null || !Number.isInteger(bit) || bit < 0 || bit > 52 || !Number.isSafeInteger(current) || current < 0) {
            return failValue("invalid SETBIT frame value", instruction.location);
          }
          const mask = 2 ** bit;
          if (Math.floor(current / mask) % 2 === 0) slots[instruction.index] = current + mask;
          break;
        }
        case "frame-clear":
          if (instruction.scope === "local") locals.splice(0);
          else if (instruction.scope === "result") results.splice(0);
          else if (instruction.scope === "string-local") stringLocals.splice(0);
          else stringResults.splice(0);
          break;
        case "number-variable-set": {
          const value = evaluate(instruction.value);
          if (value === null) return failValue(`unresolved value: ${instruction.name}`, instruction.location);
          numberVariables[instruction.name] = value;
          break;
        }
        case "symbol-set": {
          const value = evaluate(instruction.value);
          if (value === null) return failValue(`unresolved host symbol assignment: ${instruction.name}`, instruction.location);
          numberSymbols[instruction.name] = value;
          break;
        }
        case "string-set":
          {
            const value = evaluateString(instruction.value);
            if (value === null) return failValue("unresolved string frame value", instruction.location);
            (instruction.scope === "local" ? stringLocals : stringResults)[instruction.index] = value;
          }
          break;
        case "string-variable-set": {
          const value = evaluateString(instruction.value);
          if (value === null) return failValue("unresolved string variable", instruction.location);
          stringVariables[instruction.name] = value;
          break;
        }
        case "string-state-set": {
          const value = evaluateString(instruction.value);
          if (value === null) return failValue("unresolved string state write", instruction.location);
          writes.push({ kind: "string", target: instruction.target, value, location: instruction.location });
          break;
        }
        case "state-set": {
          const value = evaluate(instruction.value);
          if (value === null) return failValue(`unresolved state write: ${instruction.target}`, instruction.location);
          writes.push({ target: instruction.target, operation: instruction.operation, value, location: instruction.location });
          break;
        }
        case "if": {
          const branch = evaluatePredicate(instruction.predicate);
          if (branch === null) return failValue("unresolved IF predicate", instruction.location);
          const result = runInstructions(branch ? instruction.then : instruction.otherwise);
          if (result !== undefined) return result;
          break;
        }
        case "select": {
          const selector = evaluate(instruction.selector);
          if (selector === null) return failValue("unresolved SELECTCASE selector", instruction.location);
          const selected = instruction.cases.find((entry) => entry.values.includes(selector)
            || entry.ranges.some((range) => selector >= range.start && selector <= range.end))?.body ?? instruction.defaultCase;
          const result = runInstructions(selected);
          if (result !== undefined) return result;
          break;
        }
        case "string-select": {
          const selector = evaluateString(instruction.selector);
          if (selector === null) return failValue("unresolved string SELECTCASE selector", instruction.location);
          const selected = instruction.cases.find((entry) => entry.values.includes(selector))?.body ?? instruction.defaultCase;
          const result = runInstructions(selected);
          if (result !== undefined) return result;
          break;
        }
        case "for": {
          const step = evaluate(instruction.step);
          const start = evaluate(instruction.start);
          const end = instruction.end === undefined ? undefined : evaluate(instruction.end);
          if (start === null || step === null || end === null || (!instruction.until && end === undefined)) {
            return failValue("unresolved FOR bound", instruction.location);
          }
          if (step === 0) {
            lines.splice(localLinesStart);
            events.splice(eventsStart);
            hostEvents.splice(hostEventsStart);
            writes.splice(writesStart);
            activeColor = colorStart;
            return fail({ code: "invalid-loop", detail: "FOR step is zero", location: instruction.location });
          }
          for (let value = start; ; value += step) {
            if (!instruction.until && (step > 0 ? value > end! : value < end!)) break;
            if (instruction.index !== undefined) locals[instruction.index] = value;
            else if (instruction.variable) numberVariables[instruction.variable] = value;
            else return failValue("FOR has no loop target", instruction.location);
            if (instruction.until) {
              const stop = evaluatePredicate(instruction.until);
              if (stop === null) return failValue("unresolved FOR condition", instruction.location);
              if (stop) break;
            }
            const result = runInstructions(instruction.body);
            if (typeof result === "object" && result?.kind === "loop-break") break;
            if (typeof result === "object" && result?.kind === "loop-continue") continue;
            if (result !== undefined) return result;
          }
          break;
        }
        case "repeat": {
          const count = evaluate(instruction.count);
          if (count === null) return failValue("unresolved REPEAT count", instruction.location);
          if (!Number.isSafeInteger(count) || count < 0) {
            lines.splice(localLinesStart);
            events.splice(eventsStart);
            hostEvents.splice(hostEventsStart);
            writes.splice(writesStart);
            activeColor = colorStart;
            return fail({ code: "invalid-loop", detail: "REPEAT count must be a non-negative integer", location: instruction.location });
          }
          for (let iteration = 0; iteration < count; iteration++) {
            const result = runInstructions(instruction.body);
            if (typeof result === "object" && result?.kind === "loop-break") break;
            if (typeof result === "object" && result?.kind === "loop-continue") continue;
            if (result !== undefined) return result;
          }
          break;
        }
        case "do": {
          for (;;) {
            const result = runInstructions(instruction.body);
            if (typeof result === "object" && result?.kind === "loop-break") break;
            if (result !== undefined && !(result !== null && typeof result === "object" && result.kind === "loop-continue")) return result;
            const repeat = evaluatePredicate(instruction.condition);
            if (repeat === null) return failValue("unresolved LOOP condition", instruction.location);
            if (!repeat) break;
          }
          break;
        }
        case "break": return { kind: "loop-break" };
        case "continue": return { kind: "loop-continue" };
        case "return":
          {
            const value = evaluate(instruction.value);
            return value === null ? failValue("unresolved return value", instruction.location) : value;
          }
        case "call": {
          const result = invokeCall(instruction);
          if (result === null) {
            lines.splice(localLinesStart);
            writes.splice(writesStart);
            hostEvents.splice(hostEventsStart);
            activeColor = colorStart;
            return null;
          }
          if (result === "skipped") break;
          results[0] = result.number;
          stringResults.splice(0, stringResults.length, ...result.strings);
          break;
        }
        case "try-call": {
          const linesStart = lines.length;
          const eventsStart = events.length;
          const hostEventsStart = hostEvents.length;
          const writesStart = writes.length;
          const diagnosticsStart = diagnostics.length;
          const colorAtTry = activeColor;
          const result = invokeCall(instruction.call, true);
          if (result !== null && result !== "skipped") {
            results[0] = result.number;
            stringResults.splice(0, stringResults.length, ...result.strings);
            break;
          }
          lines.splice(linesStart);
          events.splice(eventsStart);
          hostEvents.splice(hostEventsStart);
          writes.splice(writesStart);
          diagnostics.splice(diagnosticsStart);
          activeColor = colorAtTry;
          const fallback = runInstructions(instruction.fallback);
          if (fallback !== undefined) return fallback;
          break;
        }
        case "jump":
          return { kind: "jump", target: instruction.target, location: instruction.location };
        case "unsupported":
          lines.splice(localLinesStart);
          events.splice(eventsStart);
          hostEvents.splice(hostEventsStart);
          writes.splice(writesStart);
          activeColor = colorStart;
          return fail({
            code: instruction.reason === "dynamic call" ? "dynamic-call" : "unsupported-statement",
            detail: instruction.raw,
            location: instruction.location,
          });
      }
    }
      return undefined;
    };
    let result = runInstructions(fn.instructions);
    while (result && typeof result === "object" && result.kind === "jump") {
      const label = fn.labels[result.target];
      if (!label) return failValue(`unresolved GOTO label: ${result.target}`, result.location);
      result = runInstructions(label);
    }
    if (result === null || typeof result === "object") {
      functionReturns.splice(traceStart);
      return null;
    }
    const returnValue = result === undefined ? 0 : result;
    functionReturns.push({ name, returnValue });
    return { number: returnValue, strings: stringResults };
  };

  if (!program.functions[entry]) {
    return { status: "not-authored", lines: [], events: [], hostEvents: [], returnValue: 0, stringResults: [], diagnostics: [], writes: [] };
  }
  const returnValue = run(entry, 1, options.args, options.stringArgs);
  if (returnValue === null) {
    return { status: "unsupported", lines: [], events: [], hostEvents: [], returnValue: 0, stringResults: [], diagnostics, writes: [] };
  }
  return withFunctionReturns(
    { status: "resolved", lines, events, hostEvents, returnValue: returnValue.number, stringResults: returnValue.strings, diagnostics, writes },
    functionReturns,
  );
}
