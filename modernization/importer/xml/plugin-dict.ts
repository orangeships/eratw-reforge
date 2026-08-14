/**
 * R2 — Plugin dict parser.
 *
 * Walks `<projectRoot>/plugins/*.xml` and parses:
 *   - `bbas_dataset.xml`, `tw_csv_chs.xml` as `bbas_dataset` schema:
 *       <DocumentElement>
 *         <bbas_dataset>
 *           <id>1</id>
 *           <name>靈夢</name>
 *           <髮色>4531748</髮色>
 *           …
 *         </bbas_dataset>
 *       </DocumentElement>
 *   - `tw_taste_chs.xml` as `tw_taste_chs` schema:
 *       <map>
 *         <p><k>安眠薬</k><v>安眠药</v></p>
 *         …
 *       </map>
 *
 * SKIPPED: `plugins/schema.xml` (XSD metadata, not data).
 *
 * Field handling: we keep the schema-specific id/name on the entry itself
 * and shove all other sub-elements into a free-form `fields: Record<string,string>`.
 * This preserves the original key names (which are CJK in some cases — `髮色`,
 * `代表色1`, `嘴型`) and tolerates files that omit or add fields.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { readXmlText } from "../encoding/read-text.js";
import type {
  BbasDictEntry,
  PluginDictEntry,
  PluginDictFile,
  PluginDictsManifest,
  PluginDictSchema,
  TasteChsEntry,
} from "./types.js";

/** Skip the XSD metadata file. */
const SKIP_BASENAMES = new Set(["schema.xml"]);

/** Schema routing: file basename → schema type. */
function schemaFor(basename: string): PluginDictSchema | null {
  if (basename === "bbas_dataset.xml" || basename === "tw_csv_chs.xml") {
    return "bbas_dataset";
  }
  if (basename === "tw_taste_chs.xml") {
    return "tw_taste_chs";
  }
  return null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name, _jpath, _isLeafNode, _isAttribute) => {
    // bbas_dataset records are siblings under <DocumentElement>; tw_taste_chs
    // records are <p> siblings under <map>. Both must become arrays.
    return name === "bbas_dataset" || name === "p";
  },
  parseAttributeValue: false,
  parseTagValue: false,
  // CRITICAL: do NOT trim values. tw_taste_chs entries use a full-width
  // space (U+3000) as a semantic word boundary in CJK; the parser defaults
  // trimValues to true, which would corrupt those keys.
  trimValues: false,
});

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v);
}

function asNumber(v: unknown): number {
  const s = asString(v);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Pull the body of an element that may be a string or an object (text+children). */
function elementText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null) {
    // fast-xml-parser puts raw text in `#text` when there are no child elements.
    const obj = v as Record<string, unknown>;
    if ("#text" in obj) return asString(obj["#text"]);
  }
  return "";
}

interface RawBbasDoc {
  DocumentElement?: {
    bbas_dataset?: Array<Record<string, unknown>>;
  };
}

interface RawTasteDoc {
  map?: {
    p?: Array<{ k?: unknown; v?: unknown }>;
  };
}

function parseBbasDataset(text: string): PluginDictEntry[] {
  const doc = parser.parse(text) as RawBbasDoc;
  const items = doc.DocumentElement?.bbas_dataset ?? [];
  return items.map((item) => {
    const entry: BbasDictEntry = {
      id: asNumber(item.id),
      fields: {},
    };
    const nameRaw = item.name;
    if (nameRaw != null) entry.name = asString(nameRaw);
    for (const [k, v] of Object.entries(item)) {
      // Skip id, name (handled above) and fast-xml-parser's `#text` slot
      // (whitespace between child elements is represented this way).
      if (k === "id" || k === "name" || k === "#text") continue;
      entry.fields[k] = elementText(v);
    }
    return entry;
  });
}

function parseTasteChs(text: string): PluginDictEntry[] {
  const doc = parser.parse(text) as RawTasteDoc;
  const items = doc.map?.p ?? [];
  return items.map((p) => {
    const entry: TasteChsEntry = {
      key: elementText(p.k),
      value: elementText(p.v),
    };
    return entry;
  });
}

async function parseOneFile(absolutePath: string): Promise<PluginDictFile | null> {
  const basename = path.basename(absolutePath);
  const schema = schemaFor(basename);
  if (!schema) return null;
  const text = await readXmlText(absolutePath);
  const entries = schema === "bbas_dataset"
    ? parseBbasDataset(text)
    : parseTasteChs(text);
  return {
    fileName: basename,
    schema,
    entryCount: entries.length,
    entries,
  };
}

export async function parsePluginDictDir(pluginsDir: string): Promise<PluginDictsManifest> {
  // Top-level *.xml only (no recursion — we know exactly which files we want).
  // Tolerate a missing plugins/ dir — return empty manifest.
  const all = await fs.readdir(pluginsDir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === "ENOENT") return [] as Awaited<ReturnType<typeof fs.readdir>>;
    throw e;
  });
  const xmlFiles = all
    .filter(
      (e) =>
        e.isFile() &&
        e.name.toLowerCase().endsWith(".xml") &&
        !SKIP_BASENAMES.has(e.name.toLowerCase()),
    )
    .map((e) => path.join(pluginsDir, e.name))
    .sort();
  const dicts: PluginDictFile[] = [];
  for (const abs of xmlFiles) {
    const d = await parseOneFile(abs);
    if (d) dicts.push(d);
  }
  return {
    generatedAt: new Date().toISOString(),
    // projectRoot is filled in by loadAllXml; placeholder here.
    projectRoot: "",
    pluginsDir,
    dicts,
  };
}
