import * as path from "node:path";
import {
  parseVariableSizesFile,
  type VariableSizesManifest,
} from "./variable-sizes.js";
import {
  parseCharactersDir,
  type CharactersManifest,
} from "./characters.js";
import { parseAlsDir, type FlagsManifest } from "./flags.js";
import {
  parseCharaStatsDir,
  type CharaStatsManifest,
} from "./chara-stats.js";
import { parseItemsFile, type ItemsManifest } from "./items.js";

/**
 * Phase 2.1 dispatcher (+ 5.5 chara-stats) — read all manifests from a
 * project root in parallel. This is the only function build-manifests.ts
 * needs.
 *
 * Returns the parsed manifests plus a top-level timestamp and the
 * projectRoot they came from, so the JSON envelope is self-describing.
 */

export interface ManifestBundle {
  generatedAt: string;
  projectRoot: string;
  variableSizes: VariableSizesManifest;
  characters: CharactersManifest;
  flags: FlagsManifest;
  /** Phase 5.5 — structured per-character BASE/ABL/TALENT/CFLAG/EXP. */
  charaStats: CharaStatsManifest;
  /** Phase 7 (P1) — `CSV/Item.csv` (id/name/price). */
  items: ItemsManifest;
}

export async function loadAll(projectRoot: string): Promise<ManifestBundle> {
  const csvDir = path.join(projectRoot, "CSV");
  const [variableSizes, characters, flags, charaStats, items] =
    await Promise.all([
      parseVariableSizesFile(path.join(csvDir, "VariableSize.csv")),
      parseCharactersDir(path.join(csvDir, "Chara")),
      parseAlsDir(csvDir),
      parseCharaStatsDir(csvDir),
      parseItemsFile(path.join(csvDir, "Item.csv")),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    variableSizes,
    characters,
    flags,
    charaStats,
    items,
  };
}

export * from "../encoding/read-text.js";
export * from "./variable-sizes.js";
export * from "./characters.js";
export * from "./flags.js";
export * from "./name-table.js";
export * from "./chara-stats.js";
export * from "./items.js";