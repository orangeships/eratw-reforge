import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Text file readers — Phase 2.2.
 *
 * Two flavors:
 *
 * - {@link readCsvText}: strict UTF-8 with BOM-strip. Explicitly rejects UTF-16.
 *   Used by CSV importers (Phase 2.1 behavior, unchanged).
 *
 * - {@link readXmlText}: permissive. Handles:
 *     1. UTF-8 / UTF-16-LE / UTF-16-BE BOMs (auto-detect)
 *     2. `<?xml ... encoding="..."?>` declaration (utf-8 / shift-jis / cp932 / utf-16)
 *     3. No BOM, no declaration → try UTF-8, fall back to Shift-JIS on
 *        decode failure (matches mkResourceXml.py line 62 behavior:
 *        `try utf_8 except UnicodeDecodeError: shift_jis`).
 *
 * The Shift-JIS fallback exists because some eraTW `resources/` XML files
 * contain Shift-JIS bytes despite declaring `encoding='utf_8'` (mkResourceXml.py
 * itself does this).
 *
 * CP932 / GB18030 are not auto-detected here. If a file declares one of those,
 * readXmlText will decode accordingly; if it doesn't declare and contains
 * GB18030 bytes, it'll either mojibake (utf-8 path) or partial-fallback
 * (shift-jis path). That's acceptable for 2.2; ERB files in Phase 2.3 may
 * need GB18030 support added.
 */

/** Read a file as UTF-8 text with any leading BOM stripped. */
export async function readCsvText(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf-8", 3);
  }
  if (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
  ) {
    throw new Error(
      `UTF-16 BOM detected at ${filePath}; eraTW CSV is expected to be UTF-8. ` +
        `Add UTF-16 support here if the source really contains it.`,
    );
  }
  return buf.toString("utf-8");
}

/**
 * Read an XML file as a string. Picks the best decoder based on BOM +
 * `<?xml encoding=...?>` declaration; falls back to Shift-JIS on UTF-8
 * decode failure.
 */
export async function readXmlText(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);

  // --- 1. BOM-based detection -----------------------------------------
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf.subarray(2));
  }

  // --- 2. XML declaration (first 256 bytes) ---------------------------
  const head = buf.subarray(0, Math.min(256, buf.length)).toString("ascii");
  const decl = head.match(/<\?xml\s+[^?>]*?encoding\s*=\s*["']([^"']+)["']/i);
  if (decl) {
    const enc = decl[1].toLowerCase().replace(/_/g, "-");
    if (enc === "utf-8" || enc === "utf8") {
      return buf.toString("utf-8");
    }
    if (
      enc === "shift-jis" ||
      enc === "shift_jis" ||
      enc === "sjis" ||
      enc === "cp932" ||
      enc === "windows-31j"
    ) {
      return new TextDecoder("shift_jis").decode(buf);
    }
    if (enc === "utf-16" || enc === "utf-16le") {
      return new TextDecoder("utf-16le").decode(buf);
    }
    if (enc === "utf-16be") {
      return new TextDecoder("utf-16be").decode(buf);
    }
    // Unknown declared encoding — fall through to default try/utf-8 + shift-jis.
  }

  // --- 3. No BOM + no useful declaration: try UTF-8, fallback ---------
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

/**
 * List files in a directory whose name ends with `suffix` (case-insensitive).
 * Returns absolute paths in lexicographic order so manifest output is stable.
 */
export async function listFilesBySuffix(
  dir: string,
  suffix: string,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(suffix.toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  out.sort();
  return out;
}

/** List just the basenames (sorted). Useful when the caller joins with its own dir. */
export async function listNamesBySuffix(
  dir: string,
  suffix: string,
): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(suffix.toLowerCase())) {
      out.push(e.name);
    }
  }
  out.sort();
  return out;
}

/**
 * Split a multi-line body into non-empty trimmed lines. Empty lines (including
 * trailing newline) are dropped so callers don't have to filter.
 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
