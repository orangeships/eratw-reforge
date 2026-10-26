import type { KojoResolution } from "../kojo/types.js";
import type { KojoSymbolTables } from "../kojo/symbol-table.js";
import { mapKojoVmWritesToEffects } from "./effects.js";
import type { KojoVmResult } from "./types.js";

/** Converts a completed VM transaction to the shared dialogue-router contract.
 * It does not commit state. Callers commit `effects` through applyKojoEffects
 * at their existing authoritative boundary. */
export function toKojoVmResolution(
  result: KojoVmResult,
  targetChara: number,
  symbols?: KojoSymbolTables,
): KojoResolution {
  if (result.status === "not-authored") {
    return { status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [] };
  }
  if (result.status === "unsupported") {
    return {
      status: "unsupported", lines: [], effects: [], unsupportedPredicates: [],
      unsupportedEffects: result.diagnostics.map((entry) => entry.detail),
      diagnostics: result.diagnostics.map((entry) => ({ code: "unsupported-effect", detail: entry.detail, line: entry.location?.line })),
    };
  }
  const mapping = mapKojoVmWritesToEffects(result.writes, targetChara, symbols);
  if (mapping.unsupportedWrites.length > 0) {
    return {
      status: "unsupported", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: mapping.unsupportedWrites,
      diagnostics: mapping.unsupportedWrites.map((detail) => ({ code: "unsupported-effect", detail })),
    };
  }
  return {
    status: result.events.length > 0 || mapping.effects.length > 0 ? "resolved" : "gated",
    lines: result.events.map((event) => ({ text: event.text, form: event.form, line: event.location.line })),
    effects: mapping.effects,
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
    hostEvents: result.hostEvents.map((event) => event.kind === "reset-color"
      ? { kind: "reset-color" as const }
      : event.kind === "set-color"
        ? { kind: "host-call" as const, name: "SETCOLOR", args: [], stringArgs: [event.color] }
        : {
        kind: "host-call" as const,
        name: event.name,
        args: event.args,
        stringArgs: event.stringArgs,
      }),
  };
}
