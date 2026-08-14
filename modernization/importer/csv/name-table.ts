/**
 * Phase 5.5 — stat name→id tables.
 *
 * Chara CSV rows reference stats by **name** (`能力,話術技能,1`), and that
 * name must resolve to the numeric id the runtime uses. The canonical
 * id↔name table is the `.csv` (Japanese names — `Abl.csv:30 = 41,話術技能`,
 * matching the Chara files); the sibling `.als` adds Chinese aliases
 * (`话术技能` — different bytes). We union both per namespace so either
 * variant resolves; the `.csv` wins on conflict.
 *
 * Both `.csv` and `.als` use the same `id,name[,alias…]` line format, so
 * we reuse `parseAlsText` (`flags.ts`).
 */

import * as path from "node:path";
import { readCsvText } from "../encoding/read-text.js";
import { parseAlsText, type FlagFile } from "./flags.js";

/**
 * Stat namespace → the CSV basenames that define its id↔name table, in
 * **priority order** (csv first so its names win, als fills gaps).
 */
export const NAME_TABLE_FILES = {
  BASE: ["Base.csv", "Base.als"],
  ABL: ["Abl.csv", "Abl.als"],
  TALENT: ["Talent.csv", "Talent.als"],
  CFLAG: ["CFLAG.csv", "CFLAG.als"],
  EXP: ["exp.csv", "exp.als"],
  FLAG: ["FLAG.csv", "FLAG.als"],
  ITEM: ["Item.csv", "Item.als"],
  TFLAG: ["TFLAG.csv", "TFLAG.als"],
  TCVAR: ["TCVAR.csv", "TCVAR.als"],
  MARK: ["Mark.csv", "Mark.als"],
  PALAM: ["Palam.csv", "Palam.als"],
  SOURCE: ["source.csv", "source.als"],
  EQUIP: ["Equip.csv", "Equip.als"],
  STAIN: ["Stain.csv", "Stain.als"],
  TEQUIP: ["Tequip.csv", "Tequip.als"],
  EX: ["ex.csv", "ex.als"],
  NOWEX: ["ex.csv", "ex.als"],
  STR: ["Str.csv"],
} as const;

export type StatNamespace = keyof typeof NAME_TABLE_FILES;
export type NameTables = Record<StatNamespace, Map<string, number>>;

/** Union `FlagFile`s (in priority order) into a name→id map; first wins. */
export function buildNameToId(files: FlagFile[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of files) {
    for (const e of f.entries) {
      for (const name of e.names) {
        if (name.length > 0 && !name.startsWith(";") && !map.has(name)) map.set(name, e.id);
      }
    }
  }
  return map;
}

/** Build the per-namespace name→id maps from a project `CSV/` directory. */
export async function loadNameTables(csvDir: string): Promise<NameTables> {
  const out = {} as NameTables;
  for (const ns of Object.keys(NAME_TABLE_FILES) as StatNamespace[]) {
    const files: FlagFile[] = [];
    for (const base of NAME_TABLE_FILES[ns]) {
      try {
        const text = await readCsvText(path.join(csvDir, base));
        files.push(parseAlsText(base, text));
      } catch {
        // A namespace may lack one of the two files (e.g. no .als).
        // Skip silently — the other file still populates the map.
      }
    }
    out[ns] = buildNameToId(files);
  }
  return out;
}
