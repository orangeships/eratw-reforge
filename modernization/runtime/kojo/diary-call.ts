import type { KojoResolveContext } from "./static-router.js";
import type { KojoSymbolTables } from "./symbol-table.js";

/**
 * Runtime bindings for the authored DIARY_TEXT signature.
 *
 * Upstream dispatches the three function parameters as
 * `PAGENUM, MODE, PAGECOUNT` (ARG:3, ARGS:2, ARG:4).  The public router API
 * keeps its historical compact numeric args (`[page, pageCount]`), so this
 * adapter materialises the named locals that the parser emits for a
 * `#DIM/#DIMS` declaration.  It is deliberately a data-only frame; no
 * generic ERB call execution is involved.
 */
export function resolveDiaryCall(
  page: number,
  args: readonly number[] | undefined,
  mode: string | undefined,
  symbols?: KojoSymbolTables,
): { args: readonly number[]; context: KojoResolveContext } {
  const resolvedPage = args && args.length > 0 ? args[0] ?? page : page;
  const pageCount = args && args.length > 1 ? args[1] ?? 1 : 1;
  const resolvedMode = mode ?? "コマンド";

  return {
    // Keep the compact API contract used by existing callers and tests:
    // ARG/ARG:1 are the page number and visible PAGESET slot respectively.
    args: [resolvedPage, pageCount],
    context: {
      vm: {
        locals: [],
        result: [],
        namedLocals: {
          PAGENUM: resolvedPage,
          PAGECOUNT: pageCount,
        },
        // The numeric mirror is only used to establish that MODE is bound;
        // comparisons consume the resolved string mirror below.
        namedStringLocals: { MODE: 0 },
        resolvedNamedStringLocals: { MODE: resolvedMode },
      },
      stringArgs: [resolvedMode],
      symbols,
    },
  };
}
