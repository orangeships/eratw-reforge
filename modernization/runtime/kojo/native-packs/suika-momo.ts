import type { CharacterDialoguePack } from "../native-dialogue.js";
import {
  generatedAssetClaims,
  resolveGeneratedAsset,
  resolveGeneratedAssetInteractive,
  type GeneratedNativeDialogueAssets,
  type SharedCounterDialogueAssets,
  type SharedEventDialogueAssets,
  type SharedMarkDialogueAssets,
  type SharedPalamDialogueAssets,
  type SharedSpEventDialogueAssets,
} from "./generated-assets.js";

/** K10's MOMO custom variant. Every indexed route is source-backed and owns
 * its route even when a predicate/effect is unsupported, so it fails closed
 * instead of falling through to a different Suika script or AI response. */
export const SUIKA_MOMO_NATIVE_DIALOGUE_PACK: CharacterDialoguePack = {
  charaNum: 10,
  variantId: "1",
  claims: () => false,
  rules: [],
};

export function createSuikaMomoNativeDialoguePack(
  assets: GeneratedNativeDialogueAssets,
  sharedCounterAssets: SharedCounterDialogueAssets,
  sharedEventAssets: SharedEventDialogueAssets,
  sharedPalamAssets: SharedPalamDialogueAssets,
  sharedSpEventAssets: SharedSpEventDialogueAssets,
  sharedMarkAssets: SharedMarkDialogueAssets,
): CharacterDialoguePack {
  return {
    ...SUIKA_MOMO_NATIVE_DIALOGUE_PACK,
    claims: (trigger) => generatedAssetClaims(assets, trigger),
    resolve: (context, rng) => resolveGeneratedAsset(
      assets, context, rng,
      sharedCounterAssets, sharedEventAssets, sharedPalamAssets,
      sharedSpEventAssets, sharedMarkAssets,
    ),
    resolveInteractive: (context, rng, choices) => resolveGeneratedAssetInteractive(
      assets, context, rng, choices,
      sharedCounterAssets, sharedEventAssets, sharedPalamAssets,
      sharedSpEventAssets, sharedMarkAssets,
    ),
  };
}
