/**
 * K2 — Generic event-message handler parser.
 *
 * Walks the top-level of `ERB/口上・メッセージ関連/` (and
 * `EVENT_MESSAGE_挿入系COM/`) and produces an `EventMessagesManifest`.
 * These are the per-category / dispatch-hub files (not per-character).
 *
 * Unlike `kojos.ts`, we DO extract the per-func name list — the file
 * count is small (~33 files, ~50 funcs total) and a Phase-5
 * `CommandResolver` / Phase-6 `DialogueRouter` reader wants to see the
 * dispatch hub in full.
 *
 * Categorization (basename → category):
 *   - `KOJO_MESSAGE*.ERB`         → DISPATCH
 *   - `COMMON_KOJO.ERB`           → COMMON
 *   - `EVENT_MESSAGE_COM*.ERB`   → EVENT_MESSAGE_COM
 *   - `EVENT_MESSAGE_挿入系COM/...ERB` → EVENT_MESSAGE_POSITION
 *   - `EVENT_MESSAGE*.ERB`        → EVENT_MESSAGE
 *   - `STAND_COM_IMAGE.ERB`       → IMAGE
 *   - `AUTO_AEGI.ERB` / `TINKO_TYPE.ERB` → UTILITY
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readXmlText as readErbText } from "../encoding/read-text.js";
import type {
  EventMessageCategory,
  EventMessageEntry,
  EventMessagesManifest,
} from "./types.js";

const AT_RE = /^@([^\s(,;]+)/;

function trimComment(line: string): string {
  const semi = line.indexOf(";");
  const out = semi >= 0 ? line.slice(0, semi) : line;
  return out.replace(/\s+$/, "").replace(/^\s+/, "");
}

function categorize(relPath: string, fileName: string): EventMessageCategory {
  if (fileName.startsWith("KOJO_MESSAGE")) return "DISPATCH";
  if (fileName === "COMMON_KOJO.ERB") return "COMMON";
  if (relPath.startsWith("EVENT_MESSAGE_挿入系COM/")) return "EVENT_MESSAGE_POSITION";
  if (fileName.startsWith("EVENT_MESSAGE_COM")) return "EVENT_MESSAGE_COM";
  if (fileName.startsWith("EVENT_MESSAGE")) return "EVENT_MESSAGE";
  if (fileName === "STAND_COM_IMAGE.ERB") return "IMAGE";
  return "UTILITY"; // AUTO_AEGI.ERB, TINKO_TYPE.ERB
}

interface ScannedEventFile {
  relPath: string;
  fileName: string;
  category: EventMessageCategory;
  atFuncCount: number;
  atFuncs: Array<{ name: string; line: number; signature: string }>;
}

async function scanEntry(absPath: string, relPath: string): Promise<ScannedEventFile> {
  const fileName = path.basename(absPath);
  const category = categorize(relPath, fileName);
  const text = await readErbText(absPath);
  const lines = text.split(/\r?\n/);
  const atFuncs: ScannedEventFile["atFuncs"] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.charCodeAt(0) !== 0x40 /* '@' */) continue;
    const m = AT_RE.exec(line);
    if (!m) continue;
    atFuncs.push({
      name: m[1],
      line: i + 1,
      signature: trimComment(line),
    });
  }
  return {
    relPath,
    fileName,
    category,
    atFuncCount: atFuncs.length,
    atFuncs,
  };
}

/**
 * The set of filenames we know are at the top level of the kojo dir.
 * We don't try to auto-discover them — these are the well-known
 * dispatch-hub / per-category template files (see survey §1.2).
 */
const KNOWN_TOP_LEVEL = [
  "KOJO_MESSAGE.ERB",
  "COMMON_KOJO.ERB",
  "EVENT_MESSAGE.ERB",
  "EVENT_MESSAGE_COM.ERB",
  "EVENT_MESSAGE_COM300.ERB",
  "EVENT_MESSAGE_COM400.ERB",
  "EVENT_MESSAGE_COM500.ERB",
  "EVENT_MESSAGE_COM700.ERB",
  "EVENT_MESSAGE_COM80~.ERB",
  "EVENT_MESSAGE_COM_SM系.ERB",
  "EVENT_MESSAGE_COM_セクハラ.ERB",
  "EVENT_MESSAGE_COM_押し倒し.ERB",
  "EVENT_MESSAGE_COM_道具系.ERB",
  "EVENT_MESSAGE_MARK.ERB",
  "EVENT_MESSAGE_ORGASM.ERB",
  "EVENT_MESSAGE_派生COM.ERB",
  "EVENT_MESSAGE_脱衣.ERB",
  "STAND_COM_IMAGE.ERB",
  "AUTO_AEGI.ERB",
  "TINKO_TYPE.ERB",
];

export async function parseEventMessages(kojoDir: string): Promise<EventMessagesManifest> {
  const absTop = kojoDir;
  const absPosSubdir = path.join(kojoDir, "EVENT_MESSAGE_挿入系COM");

  const tasks: Array<Promise<ScannedEventFile | null>> = [];
  for (const fn of KNOWN_TOP_LEVEL) {
    const abs = path.join(absTop, fn);
    const rel = fn;
    tasks.push(
      fs.access(abs).then(
        () => scanEntry(abs, rel),
        () => null,
      ),
    );
  }
  // Position-specific subdir
  if (await fs.access(absPosSubdir).then(() => true).catch(() => false)) {
    const entries = await fs.readdir(absPosSubdir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !/\.(ERB|erb)$/i.test(e.name)) continue;
      const abs = path.join(absPosSubdir, e.name);
      const rel = `EVENT_MESSAGE_挿入系COM/${e.name}`.split(path.sep).join("/");
      tasks.push(scanEntry(abs, rel));
    }
  }

  const results = (await Promise.all(tasks)).filter((x): x is ScannedEventFile => x !== null);
  results.sort((a, b) => a.category.localeCompare(b.category) || a.fileName.localeCompare(b.fileName));

  const entries: EventMessageEntry[] = results.map((r) => ({
    relPath: r.relPath,
    fileName: r.fileName,
    category: r.category,
    atFuncCount: r.atFuncCount,
    atFuncs: r.atFuncs,
  }));

  const atFuncTotal = entries.reduce((s, e) => s + e.atFuncCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: "",
    kojoDir,
    fileCount: entries.length,
    atFuncTotal,
    entries,
  };
}
