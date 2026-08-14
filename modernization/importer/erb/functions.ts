/**
 * F1 — ERB function-index parser.
 *
 * Walks the `ERB/` tree under an eraTW project root and records every
 * top-level `@FUNC` declaration. No body parsing, no tokenizer — just a
 * line-by-line regex over every *.ERB / *.ERH file outside the excluded
 * directories.
 *
 * Encoding: re-uses `readXmlText` (aliased `readErbText`). Phase 2.3 survey
 * verified the non-kojo ERB tree is 100% UTF-8 (mostly with BOM, some
 * without); the Shift-JIS fallback baked into `readXmlText` stays as a
 * backstop and never fires in practice. See phase-2-3-survey.md §2.
 *
 * Convention: function names are CJK-safe (`@催眠発動` is real). We use
 * `[^\s(;]+` instead of `\w+` so non-ASCII identifiers aren't silently
 * dropped.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readXmlText as readErbText } from "../encoding/read-text.js";
import type { ErbFile, ErbFunction, FunctionsManifest } from "./types.js";

/** Extensions we treat as ERB source. README.md etc. are ignored. */
const ERB_EXTS = new Set([".erb", ".erh", ".erhex"]);

/**
 * Captures the identifier immediately after a leading `@`. Stops at the
 * first whitespace, `(` (paren-arg list start), `,` (legacy comma-arg
 * form like `@NAME, ARG`), or `;` (line comment).
 *
 * Examples (with the captured name in [brackets]):
 *   `@USERCOM`                  → [USERCOM]
 *   `@GLOBAL_COMABLE(ARG)`      → [GLOBAL_COMABLE]
 *   `@SHOW_SLAVE_DEBUG, ARG`    → [SHOW_SLAVE_DEBUG]   ← comma-arg form
 *   `@催眠発動`                  → [催眠発動]
 *   `@MY_FUNC  ; comment`       → [MY_FUNC]
 *
 * The comma-arg form (`@NAME, ARG` with no parens) is common in eraTW
 * DLC code (e.g. eraTW DEBUG commands). Phase 2.3 originally missed
 * the `,` terminator and stored names like `"SHOW_SLAVE_DEBUG,"` —
 * fixed in 2.3.1.
 */
const DECL_RE = /^@([^\s(,;]+)/;

/** Strip a trailing `;...` comment (and surrounding whitespace) from a line. */
function trimComment(line: string): string {
  const semi = line.indexOf(";");
  const out = semi >= 0 ? line.slice(0, semi) : line;
  return out.replace(/\s+$/, "").replace(/^\s+/, "");
}

export interface ParseFunctionsOptions {
  /**
   * Top-level subdirectory names under `erbDir` to skip entirely. Each match
   * is by **exact name** (not glob). Defaults to `["口上・メッセージ関連", "ORACLE"]`
   * — the per-character kojo tree (deferred to a later slice) + the modernization
   * oracle's dump/trace tools (an `ORACLE` dir under the ERB tree; these are
   * debug tools, not game functions to index).
   */
  excludeDirs?: string[];
}

const DEFAULT_EXCLUDES = ["口上・メッセージ関連", "ORACLE"];

/**
 * Walks `erbDir` recursively (skipping excluded directories) and returns
 * the absolute paths of all ERB-family files, sorted lexicographically for
 * stable manifest output.
 */
async function listErbFiles(
  erbDir: string,
  excludeDirs: Set<string>,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (excludeDirs.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile() && ERB_EXTS.has(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  await walk(erbDir);
  out.sort();
  return out;
}

/** Scan a single file's text into an `ErbFunction[]`. */
function scanFunctions(text: string): ErbFunction[] {
  const out: ErbFunction[] = [];
  // Use a generic line split so CRLF / LF / CR-only files all work.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.charCodeAt(0) !== 0x40 /* '@' */) continue;
    const m = DECL_RE.exec(line);
    if (!m) continue;
    out.push({
      name: m[1],
      line: i + 1,
      signature: trimComment(line),
    });
  }
  return out;
}

function topLevelDir(relPath: string): string {
  const idx = relPath.indexOf("/");
  return idx < 0 ? "" : relPath.slice(0, idx);
}

/**
 * Parse every ERB/ERH file under `erbDir` and produce a `FunctionsManifest`.
 *
 * Tolerates a missing `erbDir` (returns an empty manifest, doesn't throw) —
 * makes fixture / unit tests easier.
 */
export async function parseFunctions(
  erbDir: string,
  opts: ParseFunctionsOptions = {},
): Promise<FunctionsManifest> {
  const excludeDirs = opts.excludeDirs ?? DEFAULT_EXCLUDES;
  const excludeSet = new Set(excludeDirs);

  const absFiles = await listErbFiles(erbDir, excludeSet).catch(
    (e: NodeJS.ErrnoException) => {
      if (e?.code === "ENOENT") return [] as string[];
      throw e;
    },
  );

  const files: ErbFile[] = [];
  let functionCount = 0;
  for (const abs of absFiles) {
    const text = await readErbText(abs);
    const functions = scanFunctions(text);
    const rel = path.relative(erbDir, abs).split(path.sep).join("/");
    files.push({
      relPath: rel,
      dir: topLevelDir(rel),
      functions,
    });
    functionCount += functions.length;
  }

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: "",
    erbDir,
    excludedDirs: [...excludeDirs],
    fileCount: files.length,
    functionCount,
    files,
  };
}
