/**
 * Phase 6.1 — KojoExtractor.
 *
 * Pure function: take ERB text → list of `@FUNC_NAME` declarations and
 * their bodies. This is the BOTTOM layer of the KojoParser pipeline;
 * `parser.ts` consumes the body strings and turns them into the branch
 * tree (`parser-types.ts`).
 *
 * **Deliberate non-features** (deferred to later phases):
 *   - We don't try to resolve `$FUNCTION` or `%FUNCTION%` references —
 *     those live in `event-messages.ts`'s scope.
 *   - We don't track line numbers across continuation lines.
 *   - We don't dedupe @-funcs with the same name appearing multiple
 *     times in one file (eraTW never does that, but defensively we'd
 *     take the last one — we don't).
 *
 * Encoding: input is expected to already be a UTF-8 string (caller
 * decodes via `readCsvText` / `readErbText`). The extractor is encoding
 * agnostic.
 */

/** A single `@FUNC` block extracted from an ERB file. */
export interface ExtractedFunc {
  /** Full name including the leading `@`. */
  name: string;
  /** 1-based line number of the `@`-declaration. */
  declLine: number;
  /** Raw body lines (trimmed, comments stripped, blank lines removed),
   *  in source order. The last meaningful statement may be `RETURN n`
   *  or another `@FUNC` declaration. */
  body: string[];
}

/** Regex matching the leading `@FUNC` token. The name starts ASCII
 *  (every kojo func is `M_KOJO…` / `EVENT_MESSAGE…` / `KOJO…`) but the
 *  CONTINUATION may contain CJK / kana: variant functions embed the
 *  variant infix as a Japanese/Chinese string, e.g.
 *  `@M_KOJO_少女之梦_MESSAGE_COM_K1_300_1` or `@M_KOJO_YURI百合_…`.
 *  Allowing hiragana (ぁ-ゖ), katakana (ァ-ー), and CJK
 *  unified ideographs (一-鿿) keeps those names intact instead
 *  of truncating at the first non-ASCII byte. */
const AT_RE = /^@([A-Za-z_][A-Za-z0-9_\[\]ぁ-ゖァ-ー一-鿿]*)/;

/** Strip an inline `;...` comment from a line, preserving leading
 *  whitespace so the parser can still detect indentation depth. */
function stripInlineComment(line: string): string {
  // Strip only OUTSIDE of strings to be safe; ERA BASIC doesn't have
  // quotes in its syntax, so the simple form works.
  const semi = line.indexOf(";");
  return semi >= 0 ? line.slice(0, semi) : line;
}

/** Trim trailing whitespace (tabs / spaces / CR). */
function rtrim(line: string): string {
  return line.replace(/[\t ]+$/, "").replace(/\r$/, "");
}

/**
 * Scan ERB text and return one `ExtractedFunc` per `@FUNC` declaration.
 * The body of each func runs until the next `@`-declaration or EOF.
 * Blank lines and pure-comment lines inside the body are filtered out
 * (the parser only cares about executable lines).
 */
export function extractFuncs(text: string): ExtractedFunc[] {
  const lines = text.split(/\r?\n/);
  const out: ExtractedFunc[] = [];
  let current: ExtractedFunc | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = rtrim(raw).trim();
    // Skip blank lines outside any func.
    if (trimmed.length === 0) continue;

    const atMatch = AT_RE.exec(trimmed);
    if (atMatch) {
      // Close out the previous func (if any).
      if (current) out.push(current);
      current = {
        name: "@" + atMatch[1]!,
        declLine: i + 1,
        body: [],
      };
      // Some `@FUNC` declarations put the args on the same line; we
      // strip the comment but keep the args out of the body. The
      // first body line is the next non-empty, non-@-line.
      continue;
    }

    if (!current) continue; // text before the first `@` is module prelude

    const stripped = stripInlineComment(trimmed).trim();
    if (stripped.length === 0) continue;
    current.body.push(stripped);
  }

  if (current) out.push(current);
  return out;
}
