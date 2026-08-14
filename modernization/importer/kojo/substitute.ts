/**
 * Phase 6.1 — substitute.ts.
 *
 * Replace runtime tokens in kojo text with their static (bundle-time)
 * equivalents. The bundle is a snapshot; we don't carry the live
 * GameState into substitution (the runtime `DialogueRouter` does that
 * pass separately when needed).
 *
 * **Handled substitutions**:
 *   - `%CALLNAME:TARGET%` / `%CALLNAME:NN%` (N≠0) → chara callName (calleeName)
 *   - `%TALENT:xxx%` → `` (predicate-like tokens defensively stripped from dialogue)
 *   - Unknown `%X%` tokens → `[X]` (preserved as visible, won't crash UI)
 *
 * **NOT handled at parse time** (resolved at runtime instead):
 *   - `%CALLNAME:MASTER%` / `%CALLNAME:PLAYER%` / `%CALLNAME:0%` —
 *     these reference the player's customizable name (`state.master.callName`)
 *     which is set AFTER the bundle is built (new-game wizard) and may
 *     change between sessions. They are left verbatim in the bundle
 *     and resolved at `resolveKojoNode` emit time —
 *     `runtime/kojo/text-renderer.ts::substituteKojoCallNames`.
 *
 * NOT handled (deferred):
 *   - `%STR:NNN%` (string var lookup) → kept verbatim
 *   - `%ANAME(...)%` (auto-numbered chara name) → kept verbatim
 *   - `%UNICODE(0x2603)%` → kept verbatim
 *   - Multi-token nesting `%COLOR(%CALLNAME:MASTER%)%`
 *
 * The text passes through `replaceAll` so multiple tokens in one line
 * are all substituted.
 */

export interface SubstituteContext {
  /**
   * **Deprecated for caller-tokens.** The field is kept on the type so
   * `build-kojo-bundle.ts` and other call sites compile, but
   * `substitute()` no longer applies it. The runtime resolves the three
   * caller tokens (`MASTER`/`PLAYER`/`0`) against live state. See
   * `runtime/kojo/text-renderer.ts::substituteKojoCallNames`.
   */
  callerName: string;
  /** Callee name (the chara's callName, e.g. "灵梦"). */
  calleeName: string;
  /** Callee charaNum — needed for `%CALLNAME:NN%` expansion. */
  calleeCharaNum: number;
  /** CALLNAME aliases whose value depends on the runtime invocation rather
   * than the target character. IRAI uses this for `CHARA` and `CLIENT_ID`.
   * They must survive parse-time substitution for the resolver's final text
   * rendering pass. */
  deferredCallNameAliases?: readonly string[];
}

/** Default context — used when the bundle is loaded standalone (e.g.
 *  inside the build script). Tests override per call. */
export const DEFAULT_CONTEXT: SubstituteContext = {
  callerName: "",
  calleeName: "灵梦",
  calleeCharaNum: 1,
};

const UNKNOWN_TOKEN_RE = /%([A-Za-z_][A-Za-z0-9_():\.]*?)%/g;

/** Tokens the caller-side runtime pass resolves against the live master
 *  callName. We explicitly skip them in the catch-all sweep so the
 *  un-substituted form survives into the bundle, where
 *  `runtime/kojo/text-renderer.ts::substituteKojoCallNames` will swap it
 *  for `state.master.callName`.
 *
 *  If we wrapped these too, the runtime pass would never see them. */
const CALLER_TOKEN_RE = /%CALLNAME:(?:MASTER|PLAYER|0)%|%MASTERNAME:\d+%/;
/** Text functions whose state-dependent result is resolved by the browser-safe
 * renderer after an authored branch has been selected. */
const RUNTIME_FORMATTER_TOKEN_RE =
  /%(?:TINKO|SLIT|OPPAI_DESCRIPTION|NIPPLE_DESCRIPTION|K30_C_NAME|HE_SHE_CN|PRINT_MALE_CN|COND_STR|BREAKENG|TOUPPER)\([^%\r\n]*\)%/;
/** String-local references whose real value is resolved at emit-time from
 *  `KojoVmState.resolvedStringLocals` / `resolvedNamedStringLocals`.
 *  Preserved verbatim so the static-router `substituteKojoStringLocals`
 *  pass can substitute the actual resolved string. If we wrapped these
 *  here, the runtime would never know what `%LOCALS:N%` meant and the
 *  whole string-template round-trip would silently collapse. */
const STRING_LOCAL_TOKEN_RE = /%(?:LOCALS|LOCAL|RESULTS|RESULT)(?::\d+)?%/;
/** Mutable string slots are resolved against the active GameState, after
 * authored effects have been staged. Keep them verbatim through bundle time. */
const STRING_STATE_TOKEN_RE = /%(?:CSTR:\d+:\d+|NICKNAME:\d+)%/;

/**
 * Apply a context's substitutions to a single line of kojo text.
 * Returns a new string; input is not mutated.
 *
 * Only callee-side tokens are resolved here (`TARGET`/numeric chara-id).
 * The three caller-side tokens (`MASTER`/`PLAYER`/`0`) are intentionally
 * left verbatim — the runtime resolves them against live
 * `state.master.callName` so post-wizard renames take effect.
 */
export function substitute(text: string, ctx: SubstituteContext): string {
  let out = text;
  // Callee-side tokens first; the player-caller tokens deliberately pass
  // through unmodified so the runtime can resolve them against live state.
  out = out.replace(/%CALLNAME:TARGET%/g, ctx.calleeName);
  // Callee-specific number — match `%CALLNAME:1%`, `:14%`, etc. MUST skip
  // `%CALLNAME:0%` (the master-keyed token, resolved at runtime).
  out = out.replace(/%CALLNAME:[1-9]\d*%/g, ctx.calleeName);
  // Strip the KOJO's `TALENT:`, `CFLAG:`, `ABL:` references that may
  // have leaked through (these are predicate strings, not dialogue;
  // they should not appear in PRINTFORM text but defensively neutralise).
  out = out.replace(/%TALENT:[A-Za-z0-9_]+%/g, "");

  // Sweep any remaining `%X%` tokens and surface them visibly. This
  // is a last-ditch safety net so the UI never crashes on a literal
  // `%`. The three caller tokens (`MASTER` / `PLAYER` / `0`) are
  // excluded — they intentionally survive as raw tokens so the runtime
  // `resolveKojoNode → substituteKojoCallNames` pass can replace them with
  // the live `state.master.callName`.
  out = out.replace(UNKNOWN_TOKEN_RE, (m, body: string) => {
    if (CALLER_TOKEN_RE.test(m)) return m;
    if (RUNTIME_FORMATTER_TOKEN_RE.test(m)) return m;
    if (STRING_LOCAL_TOKEN_RE.test(m)) return m;
    if (STRING_STATE_TOKEN_RE.test(m)) return m;
    const callName = /^CALLNAME:([^%\r\n]+)$/.exec(body);
    if (callName && ctx.deferredCallNameAliases?.includes(callName[1]!.trim())) {
      return m;
    }
    return `[${body}]`;
  });

  return out;
}
