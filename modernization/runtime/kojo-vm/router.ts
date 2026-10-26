import type { KojoResolution } from "../kojo/types.js";
import type { KojoSymbolTables } from "../kojo/symbol-table.js";
import { toKojoVmResolution } from "./resolution.js";
import type { KojoVmExecutionOptions, KojoVmProgram } from "./types.js";
import { executeKojoVm } from "./vm.js";

export interface KojoVmCommandRoute {
  charaNum: number;
  commandNo: number;
  /** Original dispatcher RESULTS infix: "" for default, otherwise e.g. "_YURI". */
  variantSuffix?: string;
}

export interface KojoVmSelectedCommandRoute {
  charaNum: number;
  commandNo: number;
  /** The upstream CFLAG:口上セレクタ value. Omit or use 0 for default. */
  selector?: number;
}

export function kojoVmCommandFunctionName(route: KojoVmCommandRoute, commandNo = route.commandNo): string {
  const commandSuffix = commandNo === 0 ? "00" : String(commandNo);
  return `M_KOJO${route.variantSuffix ?? ""}_MESSAGE_COM_K${route.charaNum}_${commandSuffix}`;
}

/** Implements the authored COMMAND dispatch naming rule from
 * KOJO_MESSAGE_SEND: variant-specific command first, then the character's
 * `_00` common command. The VM produces one self-contained resolution; it
 * never appends legacy parser output. */
export function resolveKojoVmCommand(
  program: KojoVmProgram,
  route: KojoVmCommandRoute,
  options: KojoVmExecutionOptions = {},
  symbols?: KojoSymbolTables,
): KojoResolution {
  const primary = kojoVmCommandFunctionName(route);
  const fallback = kojoVmCommandFunctionName(route, 0);
  const entry = program.functions[primary] ? primary : program.functions[fallback] ? fallback : null;
  if (!entry) {
    return { status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [] };
  }
  return toKojoVmResolution(executeKojoVm(program, entry, options), route.charaNum, symbols);
}

/** Mirrors KOJO_ACTIVE_INFO: an explicit selector invokes only its matching
 * M_KOJO_K helper. A missing selected helper is not silently replaced with
 * the default pack. */
export function resolveKojoVmSelectedCommand(
  program: KojoVmProgram,
  route: KojoVmSelectedCommandRoute,
  options: KojoVmExecutionOptions = {},
  symbols?: KojoSymbolTables,
): KojoResolution {
  const selector = route.selector ?? 0;
  const helper = selector === 0
    ? `M_KOJO_K${route.charaNum}`
    : `M_KOJO_K${route.charaNum}_${selector}`;
  const variant = executeKojoVm(program, helper, options);
  if (variant.status === "not-authored" || (variant.status === "resolved" && variant.returnValue === 0)) {
    return { status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [] };
  }
  if (variant.status === "unsupported") return toKojoVmResolution(variant, route.charaNum, symbols);
  return resolveKojoVmCommand(
    program,
    { charaNum: route.charaNum, commandNo: route.commandNo, variantSuffix: variant.stringResults[0] ?? "" },
    options,
    symbols,
  );
}
