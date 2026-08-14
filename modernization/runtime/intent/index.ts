/**
 * Phase 4 — `runtime/intent` barrel.
 *
 * Re-exports `applyIntent` + its result type and the Phase 6.4
 * `configureIntent` / `currentIntentDeps` injection surface that
 * the app entry (`App.tsx`) uses to wire the real DialogueRouter.
 */

export {
  applyIntent,
  configureIntent,
  currentIntentDeps,
  liveAvailableCommands,
  type ApplyIntentResult,
  type Now,
  type IntentDeps,
} from "./apply-intent.js";
export {
  finalizeElapsedAction,
  type FinalizeElapsedActionOptions,
  type FinalizeElapsedActionResult,
} from "./finalize-elapsed-action.js";
export type {
  CommandAvailability,
  CommandAvailabilityMode,
} from "../command/available.js";
