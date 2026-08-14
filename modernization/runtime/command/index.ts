/**
 * Phase 5A — Command runtime barrel.
 *
 * Side-effect-free: no top-level `new` or function calls. 5B+ handlers
 * and 5F's `apply_intent` switchover import from here:
 *
 *   import { resolveCommand, CommandCatalog, type CommandContext } from
 *     "../../runtime/command/index.js";
 *
 * No file inside `./command/**` imports from `./index.js` — the barrel
 * is consumed only by tests and by `apply-intent.ts`. This avoids any
 * cycle through the index file.
 */

export * from "./types.js";
export * from "./rng.js";
export * from "./catalog.js";
export * from "./resolver.js";
export * from "./train-message.js";
export * from "./training-session.js";
export * from "./hooks.js";
export * from "./available.js";
export * from "./comf/semantic-gate.js";
