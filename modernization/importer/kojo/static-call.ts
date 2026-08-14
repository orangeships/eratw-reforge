import type { ExtractedFunc } from "./extractor.js";

/**
 * Bind the positional ARG values at a statically expanded call site.
 *
 * Static expansion in the browser bundle/cache is deliberately narrower than
 * a VM call: only source-local helpers (and a tiny explicit host allowlist)
 * are expanded.  Replacing ARG tokens before parsing preserves the callee's
 * argument frame when its tree is spliced into the caller.  Unbound arguments
 * follow Emuera's zero default.
 */
export function bindStaticCallArguments(
  fn: ExtractedFunc,
  args: readonly string[],
): ExtractedFunc {
  if (args.length === 0) return fn;
  return {
    ...fn,
    body: fn.body.map((line) => line.replace(/\bARG(?::(\d+))?\b/g, (_match, index: string | undefined) => {
      const value = args[index ? Number(index) : 0];
      return value && value.length > 0 ? value : "0";
    })),
  };
}
