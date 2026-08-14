import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readCsvText, splitLines } from "../encoding/read-text.js";

/**
 * A3 importer — CSV/Chara/*.csv.  (Phase 2.1, fixed in 2.1.1.)
 *
 * Source shape: one file per character, UTF-8 BOM, with **variable column
 * count**:
 *
 *     番号,0,
 *     名前,你,
 *     素質,応答,1;傲慢          ← 3 cols: key, name, value+comment
 *     番号,11,;0-1              ← 3 cols: key, value, ;comment
 *     相性,1,200,;灵梦          ← 4 cols
 *     CSTR,10,～普通…           ← 3 cols: key, slot-id, value
 *     フラグ,…,2；60日目から休む ← 全角 ；作为注释分隔
 *     ;フラグ,大家候補           ← 整行注释
 *
 * The 2.1 release parser used `^([^,]+),([^,]*),?$` which only matched
 * 2 columns. 38 Chara files (the eraTW-template-generated Chara11-48
 * block plus Chara51/Chara65) were silently dropped — `parseCharacterText`
 * returned `null` and `parseCharactersDir` skipped the file. That's a
 * CLAUDE.md "不要静默删除" violation. 2.1.1 fixes it.
 *
 * New behavior:
 *   - LINE_RE captures only the first two columns (key, value). For
 *     3+ column lines, anything after the value is discarded (and any
 *     `;` or `；` comment in the value is stripped).
 *   - Lines starting with `;` (full-line comments) are skipped.
 *   - Files that still can't be parsed (no 番号, or 番号 not numeric) are
 *     collected into a `failures` slot instead of being silently dropped.
 *
 * Known limitation: for "素質/能力/相性" style lines where column 2 is a
 * *name* and column 3 is the actual *value* with an inline comment, this
 * parser only stores the name (`fields["素質"] = "応答"`, losing the `1;傲慢`).
 * 2.1.1 fixes the silent-drop problem, not the schema's inability to
 * represent (key, name, value) tuples. That richer schema is a 2.1.2+
 * concern.
 */

export interface CharacterEntry {
  fileName: string;
  id: number;
  fields: Record<string, string>;
}

export type CharacterFailureReason = "no_id" | "bad_id_format" | "read_error";

export interface CharacterFailure {
  fileName: string;
  reason: CharacterFailureReason;
  detail?: string;
}

export interface CharactersManifest {
  generatedAt: string;
  source: string;
  count: number;
  entries: CharacterEntry[];
  failures: CharacterFailure[];
}

export type CharacterParseResult =
  | { ok: true; entry: CharacterEntry }
  | { ok: false; reason: CharacterFailureReason; detail?: string };

// Accept any trailing columns; capture the first two only.  We also
// disallow `;` and the full-width `；` in the value group so the
// "1;傲慢" portion of "応答,1;傲慢" gets dropped on the first capture.
const LINE_RE = /^([^,]+),([^,;；]*)/;

/**
 * Strip an inline `;` or full-width `；` comment from `value` and trim.
 * Defensive: the LINE_RE should already have stopped at these, but if a
 * value sneaks through (e.g. from a malformed line) we still try to
 * truncate at the first comment marker.
 */
function cleanValue(value: string): string {
  const cut = value.search(/[;；]/);
  return (cut >= 0 ? value.slice(0, cut) : value).trim();
}

export function parseCharacterText(
  fileName: string,
  text: string,
): CharacterParseResult {
  const fields: Record<string, string> = {};
  for (const line of splitLines(text)) {
    // Skip full-line comments (Emuera uses `;` to comment out a line).
    if (line.startsWith(";")) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;
    const key = m[1].trim();
    const value = cleanValue(m[2]);
    if (key.length > 0 && value.length > 0) fields[key] = value;
  }
  const idStr = fields["番号"];
  if (idStr === undefined) {
    return { ok: false, reason: "no_id" };
  }
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return { ok: false, reason: "bad_id_format", detail: idStr };
  }
  return { ok: true, entry: { fileName, id, fields } };
}

export async function parseCharactersDir(
  dir: string,
): Promise<CharactersManifest> {
  const names = (await fs.readdir(dir))
    .filter((n) => n.toLowerCase().endsWith(".csv"))
    .sort();

  const entries: CharacterEntry[] = [];
  const failures: CharacterFailure[] = [];

  for (const name of names) {
    const fullPath = path.join(dir, name);
    let text: string;
    try {
      text = await readCsvText(fullPath);
    } catch (e) {
      failures.push({
        fileName: name,
        reason: "read_error",
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const parsed = parseCharacterText(name, text);
    if (parsed.ok) {
      entries.push(parsed.entry);
    } else {
      failures.push({
        fileName: name,
        reason: parsed.reason,
        detail: parsed.detail,
      });
    }
  }
  entries.sort((a, b) => a.id - b.id);

  return {
    generatedAt: new Date().toISOString(),
    source: dir,
    count: entries.length,
    entries,
    failures,
  };
}
