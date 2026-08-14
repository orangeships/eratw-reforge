import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readCsvText, splitLines } from "../encoding/read-text.js";

/**
 * A4 importer — CSV/*.als.
 *
 * Source shape (UTF-8 BOM, simple ID → name(s) tables):
 *   ﻿;感觉                       ← header comment (zero or more ';' lines)
 *   0,Ｃ感觉
 *   1,Ｖ感觉
 *   ...
 *
 * Quirks observed in real eraTW files:
 *   - CFLAG.als row "1,既成事實" then "1,既成事实" — same ID, two names.
 *     We accumulate into a single FlagEntry with `names: string[]`.
 *   - Multiple ';' lines form a multi-line headerComment (joined with '\n').
 *   - Trailing commas / extra whitespace tolerated; fields trimmed.
 *
 * Files in the directory that don't match `*.als` are ignored, so future
 * additions to CSV/ don't accidentally trip the importer.
 */

export interface FlagEntry {
  id: number;
  names: string[];
}

export interface FlagFile {
  fileName: string;
  headerComment: string;
  entries: FlagEntry[];
}

export interface FlagsManifest {
  generatedAt: string;
  source: string;
  files: FlagFile[];
}

export function parseAlsText(fileName: string, text: string): FlagFile {
  const headerLines: string[] = [];
  const dataLines: string[] = [];

  for (const line of splitLines(text)) {
    if (line.startsWith(";")) {
      headerLines.push(line.replace(/^;/, "").trim());
    } else {
      dataLines.push(line);
    }
  }

  const byId = new Map<number, string[]>();
  for (const line of dataLines) {
    const parts = line
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length < 2) continue;
    const id = Number.parseInt(parts[0], 10);
    if (!Number.isFinite(id)) continue;
    const names = parts.slice(1);
    let acc = byId.get(id);
    if (!acc) {
      acc = [];
      byId.set(id, acc);
    }
    acc.push(...names);
  }

  const entries: FlagEntry[] = Array.from(byId.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, names]) => ({ id, names }));

  return {
    fileName,
    headerComment: headerLines.join("\n"),
    entries,
  };
}

export async function parseAlsDir(dir: string): Promise<FlagsManifest> {
  const names = (await fs.readdir(dir))
    .filter((n) => n.toLowerCase().endsWith(".als"))
    .sort();

  const files: FlagFile[] = [];
  for (const name of names) {
    const fullPath = path.join(dir, name);
    const text = await readCsvText(fullPath);
    files.push(parseAlsText(name, text));
  }

  return {
    generatedAt: new Date().toISOString(),
    source: dir,
    files,
  };
}