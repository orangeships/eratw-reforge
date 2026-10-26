import { defFromIraiId, iraiIdToLocalId } from "../state/commission.js";
import type { KojoResolution, KojoResolutionStatus } from "./types.js";

/**
 * Match the generic IRAI wrapper's call order: an authored commission-name
 * hook runs first when the modeled commission has one, then its numeric local
 * id hook runs. The two calls are additive upstream, not fallbacks.
 */
export function iraiKojoSelectorKeys(iraiId: number): readonly string[] {
  const def = defFromIraiId(iraiId);
  const localId = Math.abs(iraiIdToLocalId(iraiId));
  return [
    ...(def?.name ? [`name:${def.name}`] : []),
    `id:${localId}`,
  ];
}

/** Commission name/id hooks are additive upstream. Preserve all clean output,
 * but let any unsafe authored branch keep the combined route fail-closed so
 * an AI fallback cannot conceal a parser or predicate gap. */
export function mergeIraiKojoResolutions(
  resolutions: readonly KojoResolution[],
): KojoResolution {
  if (resolutions.length === 0) {
    return {
      status: "not-authored",
      lines: [],
      effects: [],
      unsupportedPredicates: [],
      unsupportedEffects: [],
      diagnostics: [],
    };
  }
  const priority: readonly KojoResolutionStatus[] = ["unsupported", "partial", "gated", "resolved", "not-authored"];
  const status = priority.find((candidate) => resolutions.some((resolution) => resolution.status === candidate))
    ?? "not-authored";
  return {
    status,
    lines: resolutions.flatMap((resolution) => resolution.lines),
    effects: resolutions.flatMap((resolution) => resolution.effects),
    unsupportedPredicates: resolutions.flatMap((resolution) => resolution.unsupportedPredicates),
    unsupportedEffects: resolutions.flatMap((resolution) => resolution.unsupportedEffects),
    diagnostics: resolutions.flatMap((resolution) => resolution.diagnostics),
    hostEvents: resolutions.flatMap((resolution) => resolution.hostEvents ?? []),
  };
}
