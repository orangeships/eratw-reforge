/**
 * Phase 5A — Hook registry stub.
 *
 * The interface is the contract Phase 10 will implement against. 5A
 * ships a `noopHooks()` runtime stub so 5B+ handlers can `import
 * { noopHooks } from "../command/index.js"` and pass a real value
 * through, rather than `as HookRegistry` cast or `// @ts-expect-error`
 * the call site.
 *
 * A type-only file would force every consumer into a cast on day 1;
 * a runtime stub costs ~10 lines and gives reviewers a real import
 * path. Phase 10 replaces the impl behind the same interface; no
 * caller-side change is expected.
 *
 * Hook points:
 * - `pre_exec`  — fired by resolver BEFORE `execCheck` runs.
 * - `post_exec` — fired by resolver AFTER `CommandResult` is built.
 * - `fail`      — fired by resolver on `outcome: "blocked"` / `"noop"`.
 *
 * Payload shape (`unknown`) is intentionally untyped in 5A; 5B+ will
 * narrow the payload type as concrete hooks are added.
 */

export type HookEvent = "pre_exec" | "post_exec" | "fail";

export type HookListener = (ctx: unknown) => void;

export interface HookRegistry {
  /**
   * Register a listener for a hook event. Returns an unsubscribe fn.
   * Multiple listeners per event are allowed; ordering is registration
   * order (FIFO).
   */
  on(event: HookEvent, listener: HookListener): () => void;
}

/**
 * Build a real (but inert) `HookRegistry`. Listeners are stored but
 * never invoked. This is intentional for 5A — the deterministic
 * core must NOT have side effects beyond the `CommandResult.events`
 * array until Phase 10 wires a real implementation.
 */
export function noopHooks(): HookRegistry {
  const listeners: Record<HookEvent, HookListener[]> = {
    pre_exec: [],
    post_exec: [],
    fail: [],
  };

  return {
    on(event: HookEvent, listener: HookListener): () => void {
      listeners[event].push(listener);
      // Return an unsubscribe function; intentionally inert in 5A.
      return () => {
        const arr = listeners[event];
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
  };
}