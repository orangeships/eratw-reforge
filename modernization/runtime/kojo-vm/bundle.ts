import type {
  KojoVmCallArgument,
  KojoVmInstruction,
  KojoVmNumberValue,
  KojoVmPredicate,
  KojoVmProgram,
} from "./types.js";

export interface KojoVmBundleDuplicateFunction {
  name: string;
  first: { file: string; line: number };
  duplicate: { file: string; line: number };
}

/** Browser-loadable, deterministic VM program shard. A non-empty duplicate
 * list means the caller must reject the shard rather than choose a function
 * definition based on generator filesystem order. */
export interface KojoVmProgramShard {
  schemaVersion: 1;
  charaNum: number | null;
  program: KojoVmProgram;
  duplicateFunctions: KojoVmBundleDuplicateFunction[];
}

export interface KojoVmBundleManifestEntry {
  charaNum: number;
  file: string;
  functionCount: number;
  duplicateFunctionCount: number;
  /** Omitted means the shard covers every COMMAND route for its character. */
  commandNos?: number[];
  /** Explicit EVENT arms bundled for this character. Omitted means none. */
  eventArms?: number[];
  /** Explicit SP_EVENT subids bundled for this character. Omitted means none. */
  spEventSubids?: number[];
  /** The single first-meeting ENCOUNTER route is bundled for this character. */
  encounter?: true;
  /** Explicit COUNTER action routes bundled for this character. */
  counterActions?: number[];
}

export interface KojoVmBundleManifest {
  schemaVersion: 1;
  generatedAt: string;
  shared: { file: string; functionCount: number; duplicateFunctionCount: number };
  charas: KojoVmBundleManifestEntry[];
}

function nestedInstructions(instructions: readonly KojoVmInstruction[]): readonly KojoVmInstruction[] {
  return instructions.flatMap((instruction) => {
    const nested = instruction.kind === "if"
      ? [...nestedInstructions(instruction.then), ...nestedInstructions(instruction.otherwise)]
      : instruction.kind === "select" || instruction.kind === "string-select"
        ? [...instruction.cases.flatMap((entry) => nestedInstructions(entry.body)), ...nestedInstructions(instruction.defaultCase)]
        : instruction.kind === "for" || instruction.kind === "repeat"
          ? nestedInstructions(instruction.body)
          : instruction.kind === "try-call"
            ? nestedInstructions(instruction.fallback)
            : [];
    return [instruction, ...nested];
  });
}

function staticTargetsFromNumberValue(value: KojoVmNumberValue): string[] {
  switch (value.kind) {
    case "array":
      return staticTargetsFromNumberValue(value.index);
    case "call-expression":
      return [
        value.target,
        ...value.args.flatMap(staticTargetsFromCallArgument),
      ];
    case "builtin":
      return value.args.flatMap(staticTargetsFromNumberValue);
    case "memory-check":
      return [
        ...staticTargetsFromCallArgument(value.key),
        ...staticTargetsFromNumberValue(value.query),
        ...(value.subject ? staticTargetsFromNumberValue(value.subject) : []),
      ];
    case "unary":
      return staticTargetsFromNumberValue(value.value);
    case "binary":
      return [...staticTargetsFromNumberValue(value.left), ...staticTargetsFromNumberValue(value.right)];
    default:
      return [];
  }
}

function staticTargetsFromCallArgument(argument: KojoVmCallArgument): string[] {
  return argument.kind === "number" ? staticTargetsFromNumberValue(argument.value) : [];
}

function staticTargetsFromPredicate(predicate: KojoVmPredicate): string[] {
  switch (predicate.kind) {
    case "truthy":
      return staticTargetsFromNumberValue(predicate.value);
    case "compare":
      return [...staticTargetsFromNumberValue(predicate.left), ...staticTargetsFromNumberValue(predicate.right)];
    case "number-group-match":
      return [
        ...staticTargetsFromNumberValue(predicate.value),
        ...predicate.candidates.flatMap(staticTargetsFromNumberValue),
      ];
    case "not":
      return staticTargetsFromPredicate(predicate.inner);
    case "and":
    case "or":
      return predicate.parts.flatMap(staticTargetsFromPredicate);
    default:
      return [];
  }
}

function staticTargetsFromInstruction(instruction: KojoVmInstruction): string[] {
  switch (instruction.kind) {
    case "call":
      return [
        ...(instruction.dynamic ? [] : [instruction.target]),
        ...instruction.args.flatMap(staticTargetsFromCallArgument),
      ];
    case "try-call":
      return [
        ...(instruction.call.dynamic ? [] : [instruction.call.target]),
        ...instruction.call.args.flatMap(staticTargetsFromCallArgument),
      ];
    case "return":
    case "local-set":
    case "result-set":
    case "number-variable-set":
    case "symbol-set":
    case "state-set":
      return staticTargetsFromNumberValue(instruction.value);
    case "frame-set-bit":
      return staticTargetsFromNumberValue(instruction.bit);
    case "if":
      return staticTargetsFromPredicate(instruction.predicate);
    case "select":
      return staticTargetsFromNumberValue(instruction.selector);
    case "for":
      return [
        ...staticTargetsFromNumberValue(instruction.start),
        ...(instruction.end ? staticTargetsFromNumberValue(instruction.end) : []),
        ...(instruction.until ? staticTargetsFromPredicate(instruction.until) : []),
        ...staticTargetsFromNumberValue(instruction.step),
      ];
    case "repeat":
      return staticTargetsFromNumberValue(instruction.count);
    case "print-button":
      return staticTargetsFromCallArgument(instruction.value);
    default:
      return [];
  }
}

/** Resolve only statically known calls. Dynamic calls are deliberately left
 * for the VM's explicit resolver and manifest-selected character shard. */
export function collectKojoVmStaticClosure(
  program: KojoVmProgram,
  entries: readonly string[],
  excludedTargets: ReadonlySet<string> = new Set(),
): string[] {
  const names = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (names.has(name) || !program.functions[name]) continue;
    names.add(name);
    for (const instruction of nestedInstructions(program.functions[name]!.instructions)) {
      for (const target of staticTargetsFromInstruction(instruction)) {
        if (!excludedTargets.has(target)) pending.push(target);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}
