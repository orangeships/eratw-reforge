import {
  DEFAULT_KOJO_VM_LIMITS,
  formatHphPrintText,
  hphPrintForm,
  type KojoVmContinuation,
  type KojoVmDiagnostic,
  type KojoVmExecutionOptions,
  type KojoVmHostEvent,
  type KojoVmInputOption,
  type KojoVmInstruction,
  type KojoVmLine,
  type KojoVmLocation,
  type KojoVmNumberValue,
  type KojoVmPendingInput,
  type KojoVmProgram,
  type KojoVmResult,
  type KojoVmWrite,
  type KojoVmStringValue,
} from "./types.js";

interface CallResult { number: number; strings: string[] }
type BlockResult = { kind: "continue" } | { kind: "loop-break" | "loop-continue" } | { kind: "return"; value: number } | { kind: "jump"; target: string; location: KojoVmLocation } | { kind: "failed" } | { kind: "paused"; pending: KojoVmPendingInput; resume: (value: number | string) => BlockResult };
type CallRunResult = { kind: "complete"; value: CallResult } | { kind: "failed" } | { kind: "paused"; pending: KojoVmPendingInput; resume: (value: number | string) => CallRunResult };

function withFunctionReturns(result: KojoVmResult, functionReturns: readonly { name: string; returnValue: number }[]): KojoVmResult {
  Object.defineProperty(result, "functionReturns", { value: functionReturns, enumerable: false });
  return result;
}

function pausedBlock(pending: KojoVmPendingInput, resume: (value: number | string) => BlockResult): BlockResult {
  return { kind: "paused", pending, resume };
}

/**
 * Execute a VM program until it returns or reaches an authored INPUT. Unlike
 * the legacy parser choice support this retains the live ERB frame closures;
 * no prefix instructions, host calls, RNG reads, or staged writes are replayed
 * when the player chooses an option.
 *
 * This entry point intentionally has no GameState/UI ownership. Router and
 * session adapters must bind the returned continuation to one dialogue owner
 * and discard it when that session or its loaded program is invalidated.
 */
export function executeKojoVmInteractive(
  program: KojoVmProgram,
  entry: string,
  options: KojoVmExecutionOptions = {},
): KojoVmResult {
  const limits = { ...DEFAULT_KOJO_VM_LIMITS, ...options };
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
  let settled = false;

  const fail = (detail: string, location?: KojoVmLocation, code: KojoVmDiagnostic["code"] = "unsupported-statement"): BlockResult => {
    diagnostics.push({ code, detail, location });
    return { kind: "failed" };
  };
  const empty = (status: "not-authored" | "unsupported"): KojoVmResult => ({
    status, lines: [], events: [], hostEvents: [], returnValue: 0, stringResults: [], diagnostics, writes: [],
  });
  if (!program.functions[entry]) return empty("not-authored");
  const finish = (result: CallRunResult): KojoVmResult => {
    if (settled) return empty("unsupported");
    if (result.kind === "failed") {
      settled = true;
      return empty("unsupported");
    }
    if (result.kind === "complete") {
      settled = true;
      return withFunctionReturns(
        { status: "resolved", lines, events, hostEvents, returnValue: result.value.number, stringResults: result.value.strings, diagnostics, writes },
        functionReturns,
      );
    }
    let consumed = false;
    const continuation: KojoVmContinuation = {
      pendingInput: result.pending,
      resume(value) {
        if (consumed || settled) return empty("unsupported");
        consumed = true;
        return finish(result.resume(value));
      },
      cancel() {
        if (!consumed) {
          consumed = true;
          settled = true;
        }
        return empty("unsupported");
      },
    };
    return withFunctionReturns({
      status: "paused", lines: [...lines], events: [...events], hostEvents: [...hostEvents], returnValue: 0,
      stringResults: [], diagnostics: [...diagnostics], writes: [...writes], pendingInput: result.pending, continuation,
    }, [...functionReturns]);
  };

  const run = (name: string, depth: number, args: readonly number[] = [], stringArgs: readonly string[] = []): CallRunResult => {
    if (depth > limits.maxCallDepth) return { kind: "failed" };
    const fn = program.functions[name];
    if (!fn) return { kind: "failed" };
    const traceStart = functionReturns.length;
    // Header defaults belong to this function frame and must survive an
    // interactive continuation without mutating the caller's frame.
    const boundArgs = [...args];
    const boundStringArgs = [...stringArgs];
    args = boundArgs;
    stringArgs = boundStringArgs;
    const lineStart = lines.length;
    const eventStart = events.length;
    const hostEventStart = hostEvents.length;
    const writeStart = writes.length;
    const colorStart = activeColor;
    const redrawStart = activeRedraw;
    const locals: number[] = [];
    const results: number[] = [];
    const stringLocals: string[] = [];
    const stringResults: string[] = [];
    const stringVariables: Record<string, string> = {};
    const numberVariables: Record<string, number> = {};
    const buttons: KojoVmInputOption[] = [];
    const rollback = () => {
      lines.splice(lineStart); events.splice(eventStart); hostEvents.splice(hostEventStart); writes.splice(writeStart);
      activeColor = colorStart;
      activeRedraw = redrawStart;
    };
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
        const values: number[] = [];
        for (const argument of value.args) {
          const resolved = evaluate(argument);
          if (resolved === null) return null;
          values.push(resolved);
        }
        if (value.name === "RAND") {
          const upper = values[0];
          if (upper === undefined || !Number.isSafeInteger(upper) || upper <= 0) return null;
          return options.resolveNumberSymbol?.({ functionName: name, raw: `RAND:${upper}`, args, locals, results, numberVariables, numberSymbols, writes }) ?? null;
        }
        if (value.name === "BATHCHECK" || value.name === "IN_HOME" || value.name === "CHK_DATENOW") {
          const roomId = values[0];
          return roomId === undefined
            ? null
            : options.resolveNumberSymbol?.({ functionName: name, raw: `${value.name}:${roomId}`, args: values, locals, results, numberVariables, numberSymbols, writes }) ?? null;
        }
        if (value.name === "LIMIT") {
          const [source, minimum, maximum] = values;
          return source === undefined || minimum === undefined || maximum === undefined || minimum > maximum
            ? null
            : Math.max(minimum, Math.min(source, maximum));
        }
        const [source, bit] = values;
        return Number.isSafeInteger(source) && Number.isSafeInteger(bit) && bit >= 0 && bit <= 52 ? Math.floor(source / 2 ** bit) % 2 : null;
      }
      if (value.kind === "line-count") return events.length;
      if (value.kind === "string-count") {
        const source = stringValue(value.source);
        const pattern = stringValue(value.pattern);
        if (source === null || pattern === null) return null;
        try {
          const insensitive = pattern.includes("(?i)");
          const expression = new RegExp(pattern.replaceAll("(?i)", ""), insensitive ? "gi" : "g");
          let count = 0;
          for (let match = expression.exec(source); match !== null; match = expression.exec(source)) {
            count++;
            if (match[0] === "") expression.lastIndex++;
          }
          return count;
        } catch {
          return null;
        }
      }
      if (value.kind === "string-length") {
        const source = stringValue(value.value);
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
          : stringValue(value.key.value);
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
            const resolved = stringValue(argument.value);
            if (resolved === null) return null;
            expressionStrings.push(resolved);
          }
        }
        const result = run(value.target, depth + 1, numberArgs, expressionStrings);
        return result.kind === "complete" ? result.value.number : null;
      }
      if (value.kind === "symbol") return numberSymbols[value.raw.toUpperCase()] ?? options.resolveNumberSymbol?.({ functionName: name, raw: value.raw, args, locals, results, numberVariables, numberSymbols, writes }) ?? null;
      const slots = value.scope === "arg" ? args : value.scope === "local" ? locals : results;
      return slots[value.index] ?? 0;
    };
    const stringValue = (value: KojoVmStringValue): string | null => {
      if (value.kind === "string") {
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
        const source = stringValue(value.value);
        return source === null ? null : value.mode === "lower" ? source.toLowerCase() : source.toUpperCase();
      }
      if (value.kind === "replace") {
        const source = stringValue(value.source);
        const pattern = stringValue(value.pattern);
        const replacement = stringValue(value.replacement);
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
            const fallback = stringValue(parameter.defaultValue);
            if (fallback === null) return false;
            value = fallback;
          }
          if (value !== undefined) boundStringArgs[parameter.index] = value;
          if (!/^(?:ARGS|LOCALS|RESULTS)(?::\d+)?$/i.test(parameter.name)) stringVariables[parameter.name] = value ?? "";
        }
      }
      return true;
    };
    if (!bindParameters()) return { kind: "failed" };
    const predicate = (value: import("./types.js").KojoVmPredicate): boolean | null => {
      if (value.kind === "truthy") { const found = evaluate(value.value); return found === null ? null : found !== 0; }
      if (value.kind === "not") { const found = predicate(value.inner); return found === null ? null : !found; }
      if (value.kind === "and" || value.kind === "or") {
        for (const part of value.parts) { const found = predicate(part); if (found === null) return null; if (value.kind === "and" && !found) return false; if (value.kind === "or" && found) return true; }
        return value.kind === "and";
      }
      if (value.kind === "compare") { const left = evaluate(value.left); const right = evaluate(value.right); if (left === null || right === null) return null; return value.op === "==" ? left === right : value.op === "!=" ? left !== right : value.op === ">=" ? left >= right : value.op === "<=" ? left <= right : value.op === ">" ? left > right : left < right; }
      if (value.kind === "string-compare") {
        const left = stringValue(value.left);
        const right = stringValue(value.right);
        return left === null || right === null ? null : value.op === "==" ? left === right : left !== right;
      }
      if (value.kind === "number-group-match") { const source = evaluate(value.value); const candidates = value.candidates.map(evaluate); return source === null || candidates.some((entry) => entry === null) ? null : candidates.includes(source); }
      if (value.kind === "string-group-match") {
        const source = stringValue(value.value);
        const candidates = value.candidates.map(stringValue);
        return source === null || candidates.some((candidate) => candidate === null) ? null : candidates.includes(source);
      }
      return null;
    };
    const resolveTemplate = (template: string): string | null => {
      let unresolved = false;
      const resolved = template.replace(/%([^%]+)%|\{([^{}]+)\}/g, (whole, stringExpression: string | undefined, numberExpression: string | undefined) => {
        if (stringExpression !== undefined) {
          const slot = /^(ARGS|LOCALS|RESULTS)(?::(\d+))?$/i.exec(stringExpression);
          if (slot) {
            const resolved = stringValue({ kind: "slot", scope: slot[1].toLowerCase() as "args" | "locals" | "results", index: Number(slot[2] ?? 0) });
            if (resolved !== null) return resolved;
          }
          const value = stringVariables[stringExpression.toUpperCase()];
          if (value !== undefined) return value;
          const symbol = options.resolveStringSymbol?.({
            functionName: name, raw: stringExpression.trim(), args, locals, results, stringArgs, stringLocals, stringResults,
            stringVariables, numberVariables, numberSymbols, writes,
          });
          if (symbol !== null && symbol !== undefined) return symbol;
          unresolved = true;
          return whole;
        }
        const raw = numberExpression!.trim();
        const slot = /^(ARG|LOCAL|RESULT)(?::(\d+))?$/i.exec(raw);
        const value = slot
          ? (slot[1].toUpperCase() === "ARG" ? args : slot[1].toUpperCase() === "LOCAL" ? locals : results)[Number(slot[2] ?? 0)] ?? 0
          : numberVariables[raw.toUpperCase()]
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
      // Keep continuation behavior identical to the synchronous VM. A typed
      // PANTSNAME host query must be expanded before the suspension boundary;
      // remaining legacy placeholders stay with the established text adapter.
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
            const selected = predicate(segment.predicate);
            return selected === null ? null : selected ? segment.whenTrue : segment.whenFalse;
          })();
        if (selected === null) return null;
        const resolved = resolveTemplate(selected);
        if (resolved === null) return null;
        rendered += resolved;
      }
      return rendered;
    };
    const mapBlockToCall = (block: Exclude<BlockResult, { kind: "jump" }>): CallRunResult => {
      if (block.kind === "failed") return { kind: "failed" };
      if (block.kind === "paused") return { kind: "paused", pending: block.pending, resume: (value) => resolveJumps(block.resume(value)) };
      return { kind: "complete", value: { number: block.kind === "return" ? block.value : 0, strings: [...stringResults] } };
    };
    const call = (
      instruction: Extract<KojoVmInstruction, { kind: "call" }>,
      missingOptionalIsFailure = false,
    ): CallRunResult | "skipped" => {
      const target = instruction.dynamic
        ? options.resolveDynamicCall?.({ functionName: name, template: instruction.target, args, locals, results, stringArgs, stringLocals, stringResults, stringVariables, numberVariables, numberSymbols, writes })
          ?? resolveTemplate(instruction.target)
        : instruction.target;
      if (!target) return { kind: "failed" };
      const numeric: number[] = [];
      const strings: string[] = [];
      for (const argument of instruction.args) {
        if (argument.kind === "string") {
          const value = stringValue(argument.value);
          if (value === null) return { kind: "failed" };
          strings.push(value);
        }
        else { const value = evaluate(argument.value); if (value === null) return { kind: "failed" }; numeric.push(value); }
      }
      if (!program.functions[target]) {
        const capability = options.hostCapabilities?.[target];
        if (capability) {
          const capabilityResult = capability({ name: target, functionName: name, args: numeric, stringArgs: strings, location: instruction.location });
          if (capabilityResult === null) return { kind: "failed" };
          if (capabilityResult.lines) {
            lines.push(...capabilityResult.lines.map((line) => line.text));
            events.push(...capabilityResult.lines);
          }
          hostEvents.push({ kind: "host-call", name: target, args: numeric, stringArgs: strings, location: instruction.location });
          return { kind: "complete", value: { number: capabilityResult.returnValue ?? 0, strings: [...(capabilityResult.stringResults ?? [])] } };
        }
        return instruction.optional && !missingOptionalIsFailure ? "skipped" : { kind: "failed" };
      }
      return run(target, depth + 1, numeric, strings);
    };
    const runList = (instructions: readonly KojoVmInstruction[], index = 0): BlockResult => {
      for (let cursor = index; cursor < instructions.length; cursor++) {
        const instruction = instructions[cursor]!;
        if (++instructionCount > limits.maxInstructions) { rollback(); return fail(`instruction budget exceeded at ${name}`, instruction.location, "budget-exceeded"); }
        const continueAfter = (outcome: BlockResult): BlockResult => outcome.kind === "continue" ? runList(instructions, cursor + 1) : outcome.kind === "paused" ? pausedBlock(outcome.pending, (value) => continueAfter(outcome.resume(value))) : outcome;
        switch (instruction.kind) {
          case "emit": {
            const text = renderText(instruction.text, instruction.segments);
            if (text === null) { rollback(); return fail("unresolved inline text condition", instruction.location); }
            lines.push(text);
            events.push({ text, form: instruction.form, location: instruction.location });
            break;
          }
          case "hph-print": {
            const text = stringValue(instruction.text);
            const mode = stringValue(instruction.mode);
            if (text === null || mode === null) { rollback(); return fail("unresolved HPH_PRINT argument", instruction.location); }
            const form = hphPrintForm(mode);
            const rendered = formatHphPrintText(text);
            lines.push(rendered);
            events.push({ text: rendered, form, location: instruction.location });
            break;
          }
          case "print-button": {
            const value = instruction.value.kind === "number"
              ? evaluate(instruction.value.value)
              : stringValue(instruction.value.value);
            if (value === null) { rollback(); return fail("unresolved PRINTBUTTON value", instruction.location); }
            const label = resolveTemplate(instruction.label);
            if (label === null) { rollback(); return fail("unresolved PRINTBUTTON label", instruction.location); }
            buttons.push({ label, value, location: instruction.location });
            break;
          }
          case "input": {
            const pending: KojoVmPendingInput = { scope: instruction.scope, index: instruction.index, options: [...buttons], location: instruction.location };
            buttons.splice(0);
            return pausedBlock(pending, (answer) => {
              if ((instruction.scope === "result" && typeof answer !== "number")
                || (instruction.scope === "string-result" && typeof answer !== "string")) {
                rollback(); return fail("invalid INPUT choice", instruction.location);
              }
              if (instruction.scope === "result") results[instruction.index] = answer as number;
              else stringResults[instruction.index] = answer as string;
              return runList(instructions, cursor + 1);
            });
          }
          case "wait": {
            const pending: KojoVmPendingInput = {
              scope: "wait",
              index: 0,
              options: [{ label: "继续", value: 0, location: instruction.location }],
              location: instruction.location,
            };
            return pausedBlock(pending, (answer) => {
              if (answer !== 0) { rollback(); return fail("invalid WAIT acknowledgement", instruction.location); }
              return runList(instructions, cursor + 1);
            });
          }
          case "host-call": {
            const args: number[] = [];
            for (const argument of instruction.args) {
              const value = evaluate(argument);
              if (value === null) { rollback(); return fail(`unresolved ${instruction.name} argument`, instruction.location); }
              args.push(value);
            }
            if (instruction.name === "REDRAW") activeRedraw = args[0] ?? activeRedraw;
            hostEvents.push({ kind: "host-call", name: instruction.name, args, stringArgs: [], location: instruction.location });
            break;
          }
          case "reset-color": activeColor = defaultColor; hostEvents.push({ kind: "reset-color", location: instruction.location }); break;
          case "set-color": {
            if (instruction.value) {
              const value = evaluate(instruction.value);
              if (value === null || !Number.isSafeInteger(value) || value < 0 || value > 0xFFFFFF) { rollback(); return fail("invalid SETCOLOR value", instruction.location); }
              activeColor = value;
              hostEvents.push({ kind: "set-color", color: `0x${value.toString(16).toUpperCase().padStart(6, "0")}`, location: instruction.location });
            } else {
              hostEvents.push({ kind: "set-color", color: instruction.color, location: instruction.location });
            }
            break;
          }
          case "local-set": { const value = evaluate(instruction.value); if (value === null) { rollback(); return fail("unresolved LOCAL assignment", instruction.location); } locals[instruction.index] = value; break; }
          case "result-set": { const value = evaluate(instruction.value); if (value === null) { rollback(); return fail("unresolved RESULT assignment", instruction.location); } results[instruction.index] = value; break; }
          case "frame-set-bit": {
            const bit = evaluate(instruction.bit);
            const slots = instruction.scope === "local" ? locals : results;
            const current = slots[instruction.index] ?? 0;
            if (bit === null || !Number.isInteger(bit) || bit < 0 || bit > 52 || !Number.isSafeInteger(current) || current < 0) {
              rollback(); return fail("invalid SETBIT frame value", instruction.location);
            }
            const mask = 2 ** bit;
            if (Math.floor(current / mask) % 2 === 0) slots[instruction.index] = current + mask;
            break;
          }
          case "number-variable-set": { const value = evaluate(instruction.value); if (value === null) { rollback(); return fail("unresolved numeric variable", instruction.location); } numberVariables[instruction.name] = value; break; }
          case "symbol-set": { const value = evaluate(instruction.value); if (value === null) { rollback(); return fail("unresolved host symbol", instruction.location); } numberSymbols[instruction.name] = value; break; }
          case "string-set": { const value = stringValue(instruction.value); if (value === null) { rollback(); return fail("unresolved string frame value", instruction.location); } (instruction.scope === "local" ? stringLocals : stringResults)[instruction.index] = value; break; }
          case "string-variable-set": { const value = stringValue(instruction.value); if (value === null) { rollback(); return fail("unresolved string variable", instruction.location); } stringVariables[instruction.name] = value; break; }
          case "string-state-set": { const value = stringValue(instruction.value); if (value === null) { rollback(); return fail("unresolved string state write", instruction.location); } writes.push({ kind: "string", target: instruction.target, value, location: instruction.location }); break; }
          case "frame-clear": if (instruction.scope === "local") locals.splice(0); else if (instruction.scope === "result") results.splice(0); else if (instruction.scope === "string-local") stringLocals.splice(0); else stringResults.splice(0); break;
          case "state-set": { const value = evaluate(instruction.value); if (value === null) { rollback(); return fail("unresolved state write", instruction.location); } writes.push({ target: instruction.target, operation: instruction.operation, value, location: instruction.location }); break; }
          case "if": { const selected = predicate(instruction.predicate); if (selected === null) { rollback(); return fail("unresolved IF predicate", instruction.location); } const outcome = runList(selected ? instruction.then : instruction.otherwise); return continueAfter(outcome); }
          case "select": { const selected = evaluate(instruction.selector); if (selected === null) { rollback(); return fail("unresolved SELECTCASE selector", instruction.location); } return continueAfter(runList(instruction.cases.find((entry) => entry.values.includes(selected) || entry.ranges.some((range) => selected >= range.start && selected <= range.end))?.body ?? instruction.defaultCase)); }
          case "string-select": { const selected = stringValue(instruction.selector); if (selected === null) { rollback(); return fail("unresolved string SELECTCASE selector", instruction.location); } return continueAfter(runList(instruction.cases.find((entry) => entry.values.includes(selected))?.body ?? instruction.defaultCase)); }
          case "for": {
            const start = evaluate(instruction.start);
            const end = instruction.end === undefined ? undefined : evaluate(instruction.end);
            const step = evaluate(instruction.step);
            if (start === null || end === null || step === null || step === 0 || (!instruction.until && end === undefined)) {
              rollback(); return fail("invalid FOR bounds", instruction.location, step === 0 ? "invalid-loop" : "unsupported-statement");
            }
            const runIteration = (value: number): BlockResult => {
              if (!instruction.until && (step > 0 ? value > end! : value < end!)) return runList(instructions, cursor + 1);
              if (instruction.index !== undefined) locals[instruction.index] = value;
              else if (instruction.variable) numberVariables[instruction.variable] = value;
              else { rollback(); return fail("FOR has no loop target", instruction.location); }
              if (instruction.until) {
                const stop = predicate(instruction.until);
                if (stop === null) { rollback(); return fail("unresolved FOR condition", instruction.location); }
                if (stop) return runList(instructions, cursor + 1);
              }
              const body = runList(instruction.body);
              const afterBody = (outcome: BlockResult): BlockResult => {
                if (outcome.kind === "loop-break") return runList(instructions, cursor + 1);
                if (outcome.kind === "loop-continue") return runIteration(value + step);
                if (outcome.kind === "continue") return runIteration(value + step);
                if (outcome.kind === "paused") return pausedBlock(outcome.pending, (answer) => afterBody(outcome.resume(answer)));
                return outcome;
              };
              return afterBody(body);
            };
            return runIteration(start);
          }
          case "repeat": {
            const count = evaluate(instruction.count);
            if (count === null || !Number.isSafeInteger(count) || count < 0) { rollback(); return fail("invalid REPEAT count", instruction.location, "invalid-loop"); }
            const runIteration = (iteration: number): BlockResult => {
              if (iteration >= count) return runList(instructions, cursor + 1);
              const body = runList(instruction.body);
              const afterBody = (outcome: BlockResult): BlockResult => {
                if (outcome.kind === "loop-break") return runList(instructions, cursor + 1);
                if (outcome.kind === "loop-continue") return runIteration(iteration + 1);
                if (outcome.kind === "continue") return runIteration(iteration + 1);
                if (outcome.kind === "paused") return pausedBlock(outcome.pending, (answer) => afterBody(outcome.resume(answer)));
                return outcome;
              };
              return afterBody(body);
            };
            return runIteration(0);
          }
          case "do": {
            const runIteration = (): BlockResult => {
              const body = runList(instruction.body);
              const afterBody = (outcome: BlockResult): BlockResult => {
                if (outcome.kind === "loop-break") return runList(instructions, cursor + 1);
                if (outcome.kind !== "continue" && outcome.kind !== "loop-continue") {
                  if (outcome.kind === "paused") return pausedBlock(outcome.pending, (answer) => afterBody(outcome.resume(answer)));
                  return outcome;
                }
                const repeat = predicate(instruction.condition);
                if (repeat === null) { rollback(); return fail("unresolved LOOP condition", instruction.location); }
                return repeat ? runIteration() : runList(instructions, cursor + 1);
              };
              return afterBody(body);
            };
            return runIteration();
          }
          case "break": return { kind: "loop-break" };
          case "continue": return { kind: "loop-continue" };
          case "jump": return { kind: "jump", target: instruction.target, location: instruction.location };
          case "return": { const value = evaluate(instruction.value); return value === null ? fail("unresolved return value", instruction.location) : { kind: "return", value }; }
          case "call": {
            const outcome = call(instruction);
            if (outcome === "skipped") break;
            if (outcome.kind === "failed") { rollback(); return fail(`failed call: ${instruction.target}`, instruction.location); }
            if (outcome.kind === "complete") { results[0] = outcome.value.number; stringResults.splice(0, stringResults.length, ...outcome.value.strings); break; }
            const continueCall = (resumed: CallRunResult): BlockResult => {
              if (resumed.kind === "failed") return { kind: "failed" };
              if (resumed.kind === "paused") return pausedBlock(resumed.pending, (value) => continueCall(resumed.resume(value)));
              results[0] = resumed.value.number;
              stringResults.splice(0, stringResults.length, ...resumed.value.strings);
              return runList(instructions, cursor + 1);
            };
            return pausedBlock(outcome.pending, (value) => continueCall(outcome.resume(value)));
          }
          case "try-call": {
            const linesStart = lines.length;
            const eventsStart = events.length;
            const hostEventsStart = hostEvents.length;
            const writesStart = writes.length;
            const diagnosticsStart = diagnostics.length;
            const colorAtTry = activeColor;
            const afterPrimary = (outcome: CallRunResult | "skipped"): BlockResult => {
              if (outcome === "skipped" || outcome.kind === "failed") {
                lines.splice(linesStart); events.splice(eventsStart); hostEvents.splice(hostEventsStart); writes.splice(writesStart); diagnostics.splice(diagnosticsStart);
                activeColor = colorAtTry;
                return continueAfter(runList(instruction.fallback));
              }
              if (outcome.kind === "paused") return pausedBlock(outcome.pending, (value) => afterPrimary(outcome.resume(value)));
              results[0] = outcome.value.number;
              stringResults.splice(0, stringResults.length, ...outcome.value.strings);
              return runList(instructions, cursor + 1);
            };
            return afterPrimary(call(instruction.call, true));
          }
          default: rollback(); return fail(`interactive VM does not yet support ${instruction.kind}`, instruction.location);
        }
      }
      return { kind: "continue" };
    };
    function resolveJumps(block: BlockResult): CallRunResult {
      if (block.kind === "jump") {
        const label = fn.labels[block.target];
        return label ? resolveJumps(runList(label)) : { kind: "failed" };
      }
      if (block.kind === "paused") {
        return { kind: "paused", pending: block.pending, resume: (value) => resolveJumps(block.resume(value)) };
      }
      return mapBlockToCall(block);
    }
    const record = (outcome: CallRunResult): CallRunResult => {
      if (outcome.kind === "failed") {
        functionReturns.splice(traceStart);
        return outcome;
      }
      if (outcome.kind === "complete") {
        functionReturns.push({ name, returnValue: outcome.value.number });
        return outcome;
      }
      return { ...outcome, resume: (value) => record(outcome.resume(value)) };
    };
    return record(resolveJumps(runList(fn.instructions)));
  };
  return finish(run(entry, 1, options.args, options.stringArgs));
}
