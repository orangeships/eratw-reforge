/**
 * Phase 5.5 — structured per-character stats from `CSV/Chara/*.csv`.
 *
 * The Phase-2.1 `characters.ts` importer is intentionally lossy
 * (`fields: key→last-value`); it stays as-is. This parser produces the
 * RICH `(rowType, name, value)` data the runtime needs, resolving stat
 * names to ids via the `.csv`/`.als` tables (`name-table.ts`).
 *
 * Chara CSV row vocabulary (counts across all files):
 *   基礎 → BASE · 能力 → ABL · 素質 → TALENT · フラグ → CFLAG · 経験 → EXP
 *   相性 → relations (相性,<otherId>,<value>) · CSTR/TSTR → strings (skip)
 *   番号/名前/呼び名 → identity
 *
 * Per CLAUDE.md "不要静默删除": a stat name that resolves to no id, and any
 * unknown rowType, is collected into `unresolved` — never dropped silently.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readCsvText, splitLines } from "../encoding/read-text.js";
import {
  loadNameTables,
  type NameTables,
  type StatNamespace,
} from "./name-table.js";

const ROW_TYPE_TO_NS: Readonly<Record<string, StatNamespace>> = {
  基礎: "BASE",
  能力: "ABL",
  素質: "TALENT",
  フラグ: "CFLAG",
  経験: "EXP",
};

export interface CharaStats {
  fileName: string;
  id: number;
  name: string;
  callName: string;
  BASE: Record<number, number>;
  ABL: Record<number, number>;
  TALENT: Record<number, number>;
  CFLAG: Record<number, number>;
  EXP: Record<number, number>;
  /** 相性: other-chara-id → compatibility value. Parsed, not yet loaded into GameState. */
  relations: Record<number, number>;
  /**
   * CSTR rows, keyed by the raw second column (numbered `"10"`.."19" carry the
   * 角色介绍 paragraphs read by `PRINT_STATE_PERSONAL` via `CSVCSTR(ARG,10..19)`;
   * named keys like `工作情報`/`職場` carry the work-info strings). Values keep
   * the full text INCLUDING any `;`-suffixed tail — chara CSV prose legitimately
   * contains fullwidth `；`, so no comment stripping here.
   */
  CSTR: Record<string, string>;
  /** Stat names with no id, or unknown rowTypes — surfaced, never dropped. */
  unresolved: { rowType: string; name: string; raw: string }[];
}

export type CharaStatsResult =
  | { ok: true; stats: CharaStats }
  | { ok: false; reason: "no_id" | "bad_id_format"; detail?: string };

export interface CharaStatsManifest {
  generatedAt: string;
  source: string;
  count: number;
  entries: CharaStats[];
  failures: { fileName: string; reason: string; detail?: string }[];
}

/** Strip a trailing `;`/`；` comment and trim. */
function stripComment(s: string): string {
  const cut = s.search(/[;；]/);
  return (cut >= 0 ? s.slice(0, cut) : s).trim();
}

export function parseCharaStatsText(
  fileName: string,
  text: string,
  tables: NameTables,
): CharaStatsResult {
  const stats: CharaStats = {
    fileName,
    id: -1,
    name: "",
    callName: "",
    BASE: {},
    ABL: {},
    TALENT: {},
    CFLAG: {},
    EXP: {},
    relations: {},
    CSTR: {},
    unresolved: [],
  };
  let idStr: string | undefined;

  for (const line of splitLines(text)) {
    if (line.startsWith(";")) continue;
    const cols = line.split(",").map((c) => c.trim());
    const rowType = cols[0];
    if (!rowType) continue;

    if (rowType === "番号") {
      idStr = stripComment(cols[1] ?? "");
      continue;
    }
    if (rowType === "名前") {
      stats.name = stripComment(cols[1] ?? "");
      continue;
    }
    if (rowType === "呼び名") {
      stats.callName = stripComment(cols[1] ?? "");
      continue;
    }
    if (rowType === "相性") {
      const other = Number.parseInt(stripComment(cols[1] ?? ""), 10);
      const val = Number.parseInt(stripComment(cols[2] ?? ""), 10);
      if (Number.isFinite(other) && Number.isFinite(val)) stats.relations[other] = val;
      continue;
    }

    if (rowType === "CSTR") {
      const key = (cols[1] ?? "").trim();
      // Re-join from the RAW line (not the trimmed cols) — prose may contain commas.
      const firstComma = line.indexOf(",");
      const secondComma = line.indexOf(",", firstComma + 1);
      const value = secondComma >= 0 ? line.slice(secondComma + 1).trim() : "";
      if (key && value) stats.CSTR[key] = value;
      continue;
    }

    const ns = ROW_TYPE_TO_NS[rowType];
    if (!ns) continue; // TSTR/その他 — strings/unknown, not a stat row.

    const statName = (cols[1] ?? "").trim();
    const value = Number.parseInt(stripComment(cols[2] ?? ""), 10);
    const id = tables[ns].get(statName);
    if (id === undefined || !Number.isFinite(value)) {
      stats.unresolved.push({ rowType, name: statName, raw: line });
      continue;
    }
    stats[ns][id] = value;
  }

  if (idStr === undefined) return { ok: false, reason: "no_id" };
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) return { ok: false, reason: "bad_id_format", detail: idStr };
  stats.id = id;
  return { ok: true, stats };
}

export async function parseCharaStatsDir(
  csvDir: string,
  tables?: NameTables,
): Promise<CharaStatsManifest> {
  const resolved = tables ?? (await loadNameTables(csvDir));
  const charaDir = path.join(csvDir, "Chara");
  const names = (await fs.readdir(charaDir))
    .filter((n) => n.toLowerCase().endsWith(".csv"))
    .sort();

  const entries: CharaStats[] = [];
  const failures: CharaStatsManifest["failures"] = [];
  for (const name of names) {
    let text: string;
    try {
      text = await readCsvText(path.join(charaDir, name));
    } catch (e) {
      failures.push({ fileName: name, reason: "read_error", detail: String(e) });
      continue;
    }
    const r = parseCharaStatsText(name, text, resolved);
    if (r.ok) entries.push(r.stats);
    else failures.push({ fileName: name, reason: r.reason, detail: r.detail });
  }
  entries.sort((a, b) => a.id - b.id);

  return {
    generatedAt: new Date().toISOString(),
    source: charaDir,
    count: entries.length,
    entries,
    failures,
  };
}
