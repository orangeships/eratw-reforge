import { readCsvText, splitLines } from "../encoding/read-text.js";

/**
 * A1 importer — VariableSize.csv.
 *
 * Source shape (real file, 138 lines, UTF-8 BOM):
 *   ;≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡
 *   ;Header / description comments...
 *   ;≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡≡
 *   DAY,100
 *   MONEY,100
 *   ...
 *
 * Parser rules:
 *   - Lines starting with ';' (after trim) are comments, skipped.
 *   - Empty lines are skipped.
 *   - Each data line is "NAME,SIZE". NAME matches [A-Za-z_][A-Za-z0-9_]*.
 *   - SIZE must parse as a non-negative integer.
 *   - Malformed rows throw — silent data loss is worse than a loud error.
 */

export interface VariableSize {
  name: string;
  size: number;
}

export interface VariableSizesManifest {
  generatedAt: string;
  source: string;
  count: number;
  entries: VariableSize[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseVariableSizesText(text: string): VariableSize[] {
  const out: VariableSize[] = [];
  for (const rawLine of splitLines(text)) {
    if (rawLine.startsWith(";")) continue;

    const parts = rawLine.split(",");
    if (parts.length < 2) {
      throw new Error(`VariableSize row missing size: "${rawLine}"`);
    }
    const name = parts[0].trim();
    const sizeStr = parts[1].trim();

    if (!NAME_RE.test(name)) {
      throw new Error(`VariableSize row has invalid name: "${rawLine}"`);
    }
    const size = Number.parseInt(sizeStr, 10);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`VariableSize row has invalid size: "${rawLine}"`);
    }

    out.push({ name, size });
  }
  return out;
}

export async function parseVariableSizesFile(
  filePath: string,
): Promise<VariableSizesManifest> {
  const text = await readCsvText(filePath);
  const entries = parseVariableSizesText(text);
  return {
    generatedAt: new Date().toISOString(),
    source: filePath,
    count: entries.length,
    entries,
  };
}