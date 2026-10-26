import type { CharaSlot } from "../../../modernization/runtime/state/game-state.js";
import { showTop, showBottom, wornPieceName } from "../../../modernization/runtime/state/clothing.js";
import { TEQUIP_ID } from "../../../modernization/runtime/state/settlement.js";
import { readTequip } from "../../../modernization/runtime/state/tequip.js";

/** Small read-only projection of the live outfit, using the same QoL layering
 * authority as SHOW_TOP / SHOW_BOTTOM. Names describe worn pieces, not proof
 * of visibility or garment construction. Never send the entire wardrobe. */
export function clothingContext(chara: CharaSlot | undefined) {
  if (!chara) return undefined;
  const accents = ["帽子", "飾品", "腕部装束", "襪子", "靴"] as const;
  return {
    upper: showTop(chara) || null,
    lower: showBottom(chara) || null,
    accents: [...new Set(accents.map((slot) => wornPieceName(chara, slot)).filter(Boolean))].slice(0, 3),
    ...(readTequip(chara, TEQUIP_ID.上半身裸露状態) !== 0 ? { upper_open: true } : {}),
  };
}
