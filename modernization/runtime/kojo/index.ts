/**
 * Phase 6C — runtime/kojo barrel.
 *
 * Public surface:
 *   - `DialogueRouter` interface (handler contract)
 *   - `resolveKojoNode` pure function (stateless tree walker)
 *   - `KojoCache` (lazy index-backed router, implements DialogueRouter)
 *   - Index types
 *   - `KojoBundle` (deprecated, backward compat)
 */

export type {
  DialogueRouter,
  KojoBundle,
  KojoLine,
  ParsedKojoFunc,
  BundleEntry,
  KojoNode,
  KojoArm,
  KojoPredicate,
  KojoChoiceOption,
  KojoEffect,
  KojoStagedEffect,
  PendingKojoChoice,
  DiaryHappenResolution,
  InteractiveKojoResolution,
  KojoFunctionResolution,
  KojoResolution,
  KojoResolutionStatus,
  KojoDiagnostic,
  KojoCommandIndex,
  VariantIndex,
  FuncLocation,
  IraiSceneLocation,
  EventMsgIndex,
  PalamKojoKind,
} from "./types.js";
export {
  resolveKojoNode,
  resolveKojoNodeDetailed,
  resolveKojoFunctionDetailed,
  resolveKojoNodeWithChoices,
} from "./static-router.js";
export { applyKojoEffects } from "./effects.js";
export {
  renderKojoText,
  selectTextrAlternatives,
  substituteKojoCallNames,
  type KojoNameReference,
  type KojoNameResolver,
  type KojoNameRenderOptions,
  type KojoTextRenderOptions,
} from "./text-renderer.js";
export {
  withMarkKojoContext,
  withRebellionMarkContext,
  type MarkKojoId,
  type RebellionMarkLevel,
} from "./mark-kojo.js";
export { palamKojoKey } from "./palam-kojo.js";
export { iraiKojoSelectorKeys } from "./irai-kojo.js";
export { isKojoAiFallbackEligible } from "./ai-fallback.js";
export {
  createNativeDialogueRouter,
  resolveNativeDialogue,
  type CharacterDialoguePack,
  type NativeDialogueContext,
  type NativeDialogueRule,
  type NativeDialogueTrigger,
} from "./native-dialogue.js";
export {
  resolveDomainTransitionDialogue,
  type DomainTransitionDialogueDeps,
  type DomainTransitionDialogueResult,
} from "./domain-transition-dialogue.js";
export {
  findKojoCategoryRoute,
  isStructuredKojoCategory,
  type KojoCategory,
  type KojoCategoryResolver,
  type KojoCategoryRoute,
} from "./category-routes.js";
export { KOJO_CATEGORY_ROUTES } from "./category-routes.generated.js";
export { KojoCache } from "./kojo-cache.js";
export { resolveActiveKojoVariantCode } from "./variant-selection.js";
export { resolveDiaryCall } from "./diary-call.js";
export {
  listNewGameKojoUpdates,
  resolveNewGameKojoUpdate,
  type NewGameKojoUpdateCandidate,
  type NewGameKojoUpdateResult,
  type NewGameKojoUpdateStatus,
} from "./new-game-update.js";
