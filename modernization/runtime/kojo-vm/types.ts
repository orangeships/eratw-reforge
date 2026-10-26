/**
 * Browser-safe intermediate representation for the ERB KojoVM.
 *
 * This is intentionally separate from the legacy KojoNode tree. The legacy
 * parser drops CALL instructions; a VM program retains them so author
 * functions execute as ERB functions rather than TypeScript special cases.
 */
export interface KojoVmLocation {
  file: string;
  line: number;
}

export type KojoVmPrintForm =
  | "PRINT" | "PRINTW" | "PRINTD" | "PRINTDW" | "PRINTDL"
  | "PRINTFORM" | "PRINTFORMW" | "PRINTFORMDW" | "PRINTFORMDL" | "PRINTFORMD" | "PRINTFORML" | "PRINTL";

/** Browser-safe projection of the project's HPH_PRINT text markers. */
export function formatHphPrintText(text: string): string {
  return text.replaceAll("HPH", "♥").replaceAll("BPB", "///");
}

export function hphPrintForm(mode: string): KojoVmPrintForm {
  switch (mode.toLowerCase()) {
    case "l":
    case "strl": return "PRINTL";
    case "w":
    case "strw": return "PRINTW";
    case "dl": return "PRINTDL";
    case "dw": return "PRINTDW";
    default: return "PRINT";
  }
}

export interface KojoVmLine {
  text: string;
  form: KojoVmPrintForm;
  location: KojoVmLocation;
}

export type KojoVmHostEvent =
  | {
    kind: "reset-color";
    location: KojoVmLocation;
  }
  | {
    kind: "set-color";
    color: string;
    location: KojoVmLocation;
  }
  /** A request for a browser/Tauri host capability. The VM records it as data
   * so the enclosing ERB transaction can still roll it back atomically. */
  | {
    kind: "host-call";
    name: string;
    args: readonly number[];
    stringArgs: readonly string[];
    location: KojoVmLocation;
  };

export type KojoVmNumberValue =
  | { kind: "number"; value: number }
  /** A read-only, project-level numeric constant array. Its index is evaluated
   * in the current ERB function frame and bounds are enforced by the VM. */
  | { kind: "array"; name: string; index: KojoVmNumberValue }
  | { kind: "slot"; scope: "arg" | "local" | "result"; index: number }
  | { kind: "variable"; name: string }
  | { kind: "builtin"; name: "GETBIT" | "RAND" | "LIMIT" | "GETCOLOR" | "CURRENTREDRAW"; args: KojoVmNumberValue[] }
  /** Browser-safe projections of upstream world-state queries. */
  | { kind: "builtin"; name: "BATHCHECK" | "IN_HOME" | "CHK_DATENOW"; args: KojoVmNumberValue[] }
  /** Location predicates retain their source argument because the modern
   * state authority stores locations as strings, rather than ERB room ids. */
  | { kind: "builtin"; name: "OUTROOF"; args: []; rawArgument: string }
  /** Emuera STRCOUNT uses a regular-expression pattern and returns its hit count. */
  | { kind: "string-count"; source: KojoVmStringValue; pattern: KojoVmStringValue }
  | { kind: "string-length"; value: KojoVmStringValue }
  /** Engine presentation buffer line count. It is execution-local, never a
   * persisted state field. */
  | { kind: "line-count" }
  /** An authored function used as a numeric expression, e.g. `HELPER() == 1`. */
  | { kind: "call-expression"; target: string; args: KojoVmCallArgument[] }
  /** `FIRSTTIME`/`ONCE` use the authoritative kojo-memory transaction rather
   * than interpreting their legacy CSTR implementation bodies. */
  | { kind: "memory-check"; memory: "FIRSTTIME" | "ONCE"; key: KojoVmCallArgument; query: KojoVmNumberValue; subject?: KojoVmNumberValue }
  | { kind: "unary"; op: "-"; value: KojoVmNumberValue }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^"; left: KojoVmNumberValue; right: KojoVmNumberValue }
  /** Preserved ERB expression that the generic host expression adapter owns. */
  | { kind: "symbol"; raw: string };

export type KojoVmStringValue =
  | { kind: "string"; value: string }
  | { kind: "slot"; scope: "args" | "locals" | "results"; index: number }
  | { kind: "variable"; name: string }
  | { kind: "case"; mode: "lower" | "upper"; value: KojoVmStringValue }
  /** Emuera REPLACE(source, pattern, replacement), evaluated in the current
   * function frame so input validation remains deterministic. */
  | { kind: "replace"; source: KojoVmStringValue; pattern: KojoVmStringValue; replacement: KojoVmStringValue }
  /** A read-only string namespace such as CSTR. It must be host-resolved. */
  | { kind: "symbol"; raw: string };

export type KojoVmCallArgument =
  | { kind: "number"; value: KojoVmNumberValue }
  | { kind: "string"; value: KojoVmStringValue };

export type KojoVmPredicate =
  | { kind: "truthy"; value: KojoVmNumberValue }
  | { kind: "compare"; left: KojoVmNumberValue; op: "==" | "!=" | ">=" | "<=" | ">" | "<"; right: KojoVmNumberValue }
  | { kind: "string-compare"; left: KojoVmStringValue; op: "==" | "!="; right: KojoVmStringValue }
  | { kind: "number-group-match"; value: KojoVmNumberValue; candidates: KojoVmNumberValue[] }
  | { kind: "string-group-match"; value: KojoVmStringValue; candidates: KojoVmStringValue[] }
  | { kind: "not"; inner: KojoVmPredicate }
  | { kind: "and" | "or"; parts: KojoVmPredicate[] };

/** Inline Emuera text condition: `\\@ predicate ? true text # false text \\@`. */
export type KojoVmTextSegment =
  | { kind: "text"; text: string }
  | { kind: "conditional"; predicate: KojoVmPredicate; whenTrue: string; whenFalse: string };

export type KojoVmInstruction =
  | { kind: "emit"; text: string; segments?: KojoVmTextSegment[]; form: KojoVmPrintForm; location: KojoVmLocation }
  /** `HPH_PRINT` is a project-wide rendering macro, not author code. */
  | { kind: "hph-print"; text: KojoVmStringValue; mode: KojoVmStringValue; location: KojoVmLocation }
  /** A selectable Emuera button. It is deliberately separate from emitted
   * dialogue: button labels are interaction data, not transcript lines. */
  | { kind: "print-button"; value: KojoVmCallArgument; label: string; location: KojoVmLocation }
  /** INPUT and INPUTS pause only through the explicit continuation runner.
   * A plain executeKojoVm call fails closed instead of committing a prefix. */
  | { kind: "input"; scope: "result" | "string-result"; index: number; location: KojoVmLocation }
  /** Explicit player acknowledgement. Timed waits remain unsupported rather
   * than pretending browser frame time matches Emuera's scheduler. */
  | { kind: "wait"; location: KojoVmLocation }
  /** Direct engine presentation operations that have no ERB return value. */
  | { kind: "host-call"; name: string; args: KojoVmNumberValue[]; location: KojoVmLocation }
  | { kind: "reset-color"; location: KojoVmLocation }
  | { kind: "set-color"; color: string; value?: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "call"; target: string; args: KojoVmCallArgument[]; dynamic: boolean; optional: boolean; location: KojoVmLocation }
  | { kind: "try-call"; call: Extract<KojoVmInstruction, { kind: "call" }>; fallback: KojoVmInstruction[]; location: KojoVmLocation }
  /** A static intra-function GOTO. The compiler keeps its target separate
   * from executable code so a jump exits any nested structured block. */
  | { kind: "jump"; target: string; location: KojoVmLocation }
  | { kind: "return"; value: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "local-set" | "result-set"; index: number; value: KojoVmNumberValue; location: KojoVmLocation }
  /** SETBIT on a function frame is local control-flow state, not a GameState write. */
  | { kind: "frame-set-bit"; scope: "local" | "result"; index: number; bit: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "frame-clear"; scope: "local" | "result" | "string-local" | "string-result"; location: KojoVmLocation }
  | { kind: "number-variable-set"; name: string; value: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "symbol-set"; name: string; value: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "string-set"; scope: "local" | "result"; index: number; value: KojoVmStringValue; location: KojoVmLocation }
  | { kind: "string-variable-set"; name: string; value: KojoVmStringValue; location: KojoVmLocation }
  /** A persisted string relation (currently NAME / MASTERNAME). It remains
   * transactional like numeric state writes. */
  | { kind: "string-state-set"; target: string; value: KojoVmStringValue; location: KojoVmLocation }
  | { kind: "state-set"; target: string; operation: "set" | "add" | "set-bit" | "clear-bit"; value: KojoVmNumberValue; location: KojoVmLocation }
  | { kind: "if"; predicate: KojoVmPredicate; then: KojoVmInstruction[]; otherwise: KojoVmInstruction[]; location: KojoVmLocation }
  | { kind: "select"; selector: KojoVmNumberValue; cases: Array<{ values: number[]; ranges: Array<{ start: number; end: number }>; body: KojoVmInstruction[] }>; defaultCase: KojoVmInstruction[]; location: KojoVmLocation }
  | { kind: "string-select"; selector: KojoVmStringValue; cases: Array<{ values: string[]; body: KojoVmInstruction[] }>; defaultCase: KojoVmInstruction[]; location: KojoVmLocation }
  /** `FOR LOCAL,...` retains its frame index. Named loop variables are
   * function-local and condition-form loops stop once `until` becomes true. */
  | {
    kind: "for";
    index?: number;
    variable?: string;
    start: KojoVmNumberValue;
    end?: KojoVmNumberValue;
    until?: KojoVmPredicate;
    step: KojoVmNumberValue;
    body: KojoVmInstruction[];
    location: KojoVmLocation;
  }
  | { kind: "repeat"; count: KojoVmNumberValue; body: KojoVmInstruction[]; location: KojoVmLocation }
  /** Post-test Emuera loop. The body runs once before `condition` decides
   * whether to repeat. */
  | { kind: "do"; condition: KojoVmPredicate; body: KojoVmInstruction[]; location: KojoVmLocation }
  | { kind: "break"; location: KojoVmLocation }
  | { kind: "continue"; location: KojoVmLocation }
  | { kind: "unsupported"; raw: string; reason: string; location: KojoVmLocation };

export interface KojoVmFunction {
  name: string;
  location: KojoVmLocation;
  /** Function-header arguments bind the numeric/string call frames before
   * the function body begins. */
  parameters: KojoVmParameter[];
  instructions: KojoVmInstruction[];
  /** Intra-function Emuera labels addressed by static GOTO instructions. */
  labels: Record<string, KojoVmInstruction[]>;
}

export type KojoVmParameter =
  | { kind: "number"; name: string; index: number; defaultValue?: KojoVmNumberValue }
  | { kind: "string"; name: string; index: number; defaultValue?: KojoVmStringValue };

export interface KojoVmProgram {
  functions: Record<string, KojoVmFunction>;
  /** Numeric `#DIM CONST` arrays loaded from the upstream ERB project. */
  globalNumberArrays?: Record<string, readonly number[]>;
}

export interface KojoVmDiagnostic {
  code: "missing-function" | "dynamic-call" | "unsupported-statement" | "budget-exceeded" | "invalid-loop";
  detail: string;
  location?: KojoVmLocation;
}

/** A raw ERB state write staged by the VM. P2 host adapters map only known
 * targets to authoritative GameState effects at the commit boundary. */
export interface KojoVmStateWrite {
  target: string;
  operation: "set" | "add" | "set-bit" | "clear-bit";
  value: number;
  location: KojoVmLocation;
}

/** A staged FIRSTTIME/ONCE update. It is committed through the existing
 * KojoStagedEffect memory authority only after the entire route succeeds. */
export interface KojoVmMemoryWrite {
  kind: "memory";
  memory: "FIRSTTIME" | "ONCE";
  charaNum: number;
  key: string;
  location: KojoVmLocation;
}

export interface KojoVmStringWrite {
  kind: "string";
  target: string;
  value: string;
  location: KojoVmLocation;
}

export type KojoVmWrite = KojoVmStateWrite | KojoVmMemoryWrite | KojoVmStringWrite;

export interface KojoVmResult {
  status: "resolved" | "not-authored" | "unsupported" | "paused";
  lines: string[];
  events: KojoVmLine[];
  hostEvents: KojoVmHostEvent[];
  returnValue: number;
  stringResults: string[];
  diagnostics: KojoVmDiagnostic[];
  writes: KojoVmWrite[];
  /** Completed ERB frames in call order. This diagnostic trace is
   * transactional and lets routers distinguish an entered empty template
   * from a dispatcher gate that never entered the authored route. */
  functionReturns?: readonly { name: string; returnValue: number }[];
  pendingInput?: KojoVmPendingInput;
  continuation?: KojoVmContinuation;
}

export interface KojoVmInputOption {
  label: string;
  value: number | string;
  location: KojoVmLocation;
}

/** Serializable interaction boundary. The continuation is intentionally
 * opaque to the UI but includes its bundle/program identity at the adapter
 * boundary before it may be resumed. */
export interface KojoVmPendingInput {
  scope: "result" | "string-result" | "wait";
  index: number;
  options: readonly KojoVmInputOption[];
  location: KojoVmLocation;
}

/** An in-memory, single-use suspended VM stack. Continuations are deliberately
 * not save data: adapters must discard them on save/new game/session close or
 * program replacement. Keeping the actual closures preserves frames, random
 * reads, and the transaction overlay without replaying the ERB prefix. */
export interface KojoVmContinuation {
  readonly pendingInput: KojoVmPendingInput;
  resume(value: number | string): KojoVmResult;
  cancel(): KojoVmResult;
}

export interface KojoVmLimits {
  maxCallDepth: number;
  maxInstructions: number;
}

export interface KojoVmDynamicCallContext {
  functionName: string;
  template: string;
  args: readonly number[];
  locals: readonly number[];
  results: readonly number[];
  stringArgs: readonly string[];
  stringLocals: readonly string[];
  stringResults: readonly string[];
  stringVariables: Readonly<Record<string, string>>;
  numberVariables: Readonly<Record<string, number>>;
  numberSymbols: Readonly<Record<string, number>>;
  writes: readonly KojoVmWrite[];
}

export interface KojoVmNumberSymbolContext {
  functionName: string;
  raw: string;
  args: readonly number[];
  locals: readonly number[];
  results: readonly number[];
  numberVariables: Readonly<Record<string, number>>;
  numberSymbols: Readonly<Record<string, number>>;
  writes: readonly KojoVmWrite[];
}

export interface KojoVmStringSymbolContext {
  functionName: string;
  raw: string;
  args: readonly number[];
  locals: readonly number[];
  results: readonly number[];
  stringArgs: readonly string[];
  stringLocals: readonly string[];
  stringResults: readonly string[];
  stringVariables: Readonly<Record<string, string>>;
  numberVariables: Readonly<Record<string, number>>;
  numberSymbols: Readonly<Record<string, number>>;
  writes: readonly KojoVmWrite[];
}

export interface KojoVmMemoryContext {
  functionName: string;
  memory: "FIRSTTIME" | "ONCE";
  key: string;
  /** Omitted means TARGET; -1 is the upstream MASTER shorthand. */
  subject?: number;
  writes: readonly KojoVmWrite[];
}

export interface KojoVmMemoryResolution {
  charaNum: number;
  seen: boolean;
}

export interface KojoVmHostCallContext {
  name: string;
  functionName: string;
  args: readonly number[];
  stringArgs: readonly string[];
  location: KojoVmLocation;
}

/** A host capability is an explicit, pure ERB boundary. It cannot mutate UI
 * or GameState during VM execution: the VM records the call as a structured
 * event and the authoritative adapter consumes it after resolution succeeds. */
export interface KojoVmHostCallResult {
  returnValue?: number;
  stringResults?: readonly string[];
  /** Structured presentation emitted by a host-backed ERB helper such as
   * CHARA_TEXT. The VM appends these lines transactionally with PRINT output. */
  lines?: readonly KojoVmLine[];
}

export type KojoVmHostCapability = (context: KojoVmHostCallContext) => KojoVmHostCallResult | null;

export interface KojoVmExecutionOptions extends Partial<KojoVmLimits> {
  args?: readonly number[];
  stringArgs?: readonly string[];
  /** Resolves CALLFORM-family templates through the generic ERB expression
   * layer. Returning null is diagnostic and fail-closed. */
  resolveDynamicCall?: (context: KojoVmDynamicCallContext) => string | null;
  /** Resolves non-frame ERB numeric values such as `TCVAR:302`,
   * `CFLAG:ARG:口上セレクタ`, or `RAND:6`. */
  resolveNumberSymbol?: (context: KojoVmNumberSymbolContext) => number | null;
  /** Resolves explicitly modeled read-only string namespaces such as CSTR.
   * Returning null keeps the route unsupported; it never becomes an empty string. */
  resolveStringSymbol?: (context: KojoVmStringSymbolContext) => string | null;
  /** Resolves the persisted FIRSTTIME/ONCE owner and its current value.
   * The VM, rather than the host, stages a memory effect so rollback remains
   * atomic across nested calls and interactive continuations. */
  resolveKojoMemory?: (context: KojoVmMemoryContext) => KojoVmMemoryResolution | null;
  /** Explicitly supported non-ERB calls such as DISPLAY_COM_IMAGE. A missing
   * capability is never treated as a silent no-op. */
  hostCapabilities?: Readonly<Record<string, KojoVmHostCapability>>;
}

export const DEFAULT_KOJO_VM_LIMITS: KojoVmLimits = {
  maxCallDepth: 64,
  maxInstructions: 20_000,
};
