import { defFromIraiId, iraiIdToLocalId } from "../state/commission.js";

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
