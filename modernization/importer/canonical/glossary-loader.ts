/**
 * Phase 2.6 PR 2 - Glossary loader.
 *
 * Loads the 4 JSONL files under `modernization/glossary/` and
 * validates each entry against the same constraints encoded in
 * `glossary/schema.json`.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import type { GlossaryEntry, GlossaryKind, GlossaryScope } from "./types.js";

/** One in-memory representation of a loaded glossary. */
export interface LoadedGlossary {
  /** Where the 4 JSONL files live. */
  glossaryDir: string;
  /** All entries, indexed by `legacy` name. */
  byLegacy: ReadonlyMap<string, GlossaryEntry>;
  /** All entries, partitioned by kind. */
  byKind: ReadonlyMap<GlossaryKind, ReadonlyArray<GlossaryEntry>>;
  /** Total entry count across all 4 files. */
  total: number;
}

export const GLOSSARY_KINDS: ReadonlyArray<GlossaryKind> = [
  "variable-type",
  "flag-name",
  "command-name",
  "function-name",
];

const SCOPES: ReadonlyArray<GlossaryScope> = ["type-layer", "value-layer"];

export const FILE_FOR_KIND: Record<GlossaryKind, string> = {
  "variable-type": "variable-types.jsonl",
  "flag-name": "flag-names.jsonl",
  "command-name": "command-names.jsonl",
  "function-name": "function-names.jsonl",
};

const REQUIRED_FIELDS = [
  "legacy",
  "canonical",
  "display",
  "kind",
  "scope",
  "doc",
  "since",
  "evidence",
] as const;

const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, "modScope"]);
const ALLOWED_EVIDENCE_FIELDS = new Set(["source", "count", "firstSeen"]);
const SINCE_RE = /^2\.6(\.[0-9]+)?$/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function fail(context: string, reason: string): never {
  throw new Error(`${context}: ${reason}`);
}

function requireString(
  entry: Record<string, unknown>,
  field: keyof GlossaryEntry,
  context: string,
): string {
  const value = entry[field];
  if (typeof value !== "string") {
    fail(context, `field '${field}' must be a string`);
  }
  return value;
}

/**
 * Validates one parsed glossary entry. This intentionally mirrors the
 * JSON Schema without adding an AJV dependency to the migration tools.
 */
export function validateGlossaryEntry(
  value: unknown,
  expectedKind?: GlossaryKind,
  context = "glossary entry",
): GlossaryEntry {
  if (!isRecord(value)) {
    fail(context, "entry must be an object");
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) {
      fail(context, `unexpected field '${key}'`);
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) {
      fail(context, `missing required field '${field}'`);
    }
  }

  const legacy = requireString(value, "legacy", context);
  const canonical = requireString(value, "canonical", context);
  const display = requireString(value, "display", context);
  const kind = requireString(value, "kind", context) as GlossaryKind;
  const scope = requireString(value, "scope", context) as GlossaryScope;
  const doc = requireString(value, "doc", context);
  const since = requireString(value, "since", context);
  const modScopeRaw = value.modScope;
  if (modScopeRaw !== undefined && modScopeRaw !== "core" && modScopeRaw !== "mod") {
    fail(
      context,
      `field 'modScope' must be 'core' or 'mod' if present, got '${String(modScopeRaw)}'`,
    );
  }
  const modScope = modScopeRaw as "core" | "mod" | undefined;
  void display;

  if (legacy.length === 0) fail(context, "field 'legacy' must not be empty");
  if (!GLOSSARY_KINDS.includes(kind)) {
    fail(context, `unknown kind '${kind}'`);
  }
  if (expectedKind !== undefined && kind !== expectedKind) {
    fail(context, `entry.kind='${kind}' does not match file kind='${expectedKind}'`);
  }
  if (!SCOPES.includes(scope)) {
    fail(context, `unknown scope '${scope}'`);
  }
  if (scope === "value-layer" && canonical.length > 0) {
    fail(
      context,
      `rule 2 violation: value-layer entry '${legacy}' has non-empty canonical='${canonical}'`,
    );
  }
  if (scope === "type-layer" && canonical.length === 0) {
    fail(context, `type-layer entry '${legacy}' must have a canonical name`);
  }
  if (doc.length === 0) fail(context, "field 'doc' must not be empty");
  if (!SINCE_RE.test(since)) {
    fail(context, `field 'since' must match ${SINCE_RE}`);
  }

  const evidence = value.evidence;
  if (!isRecord(evidence)) {
    fail(context, "field 'evidence' must be an object");
  }
  for (const key of Object.keys(evidence)) {
    if (!ALLOWED_EVIDENCE_FIELDS.has(key)) {
      fail(context, `unexpected evidence field '${key}'`);
    }
  }
  if (typeof evidence.source !== "string" || evidence.source.length === 0) {
    fail(context, "evidence.source must be a non-empty string");
  }
  if (typeof evidence.count !== "number" || !Number.isFinite(evidence.count) || evidence.count < 1) {
    fail(context, "evidence.count must be a number >= 1");
  }
  if (
    evidence.firstSeen !== undefined &&
    typeof evidence.firstSeen !== "string"
  ) {
    fail(context, "evidence.firstSeen must be a string when present");
  }

  return {
    legacy,
    canonical,
    display,
    kind,
    scope,
    doc,
    since,
    evidence: {
      source: evidence.source,
      count: evidence.count,
      ...(evidence.firstSeen === undefined ? {} : { firstSeen: evidence.firstSeen }),
    },
    ...(modScope === undefined ? {} : { modScope }),
  };
}

/**
 * Parse a single JSONL file into entries. Throws on malformed JSON,
 * schema violations, kind mismatch, rule-2 violations, or duplicate
 * legacy keys.
 */
export async function loadGlossaryFile(
  glossaryDir: string,
  kind: GlossaryKind,
): Promise<GlossaryEntry[]> {
  const filePath = path.join(glossaryDir, FILE_FOR_KIND[kind]);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw e;
  }

  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const context = `${FILE_FOR_KIND[kind]}:${i + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(`${context}: malformed JSON: ${(e as Error).message}`);
    }
    const entry = validateGlossaryEntry(parsed, kind, context);
    if (seen.has(entry.legacy)) {
      throw new Error(`${context}: duplicate legacy key '${entry.legacy}'`);
    }
    seen.add(entry.legacy);
    out.push(entry);
  }
  return out;
}

/**
 * Load all 4 JSONL files. Missing files are treated as empty so small
 * fixtures can test only one kind at a time; the real build script always
 * writes all 4 files.
 */
export async function loadGlossary(
  glossaryDir: string,
): Promise<LoadedGlossary> {
  const byKind = new Map<GlossaryKind, GlossaryEntry[]>();
  const byLegacy = new Map<string, GlossaryEntry>();
  let total = 0;

  for (const kind of GLOSSARY_KINDS) {
    const entries = await loadGlossaryFile(glossaryDir, kind);
    byKind.set(kind, entries);
    for (const entry of entries) {
      if (byLegacy.has(entry.legacy)) {
        throw new Error(`duplicate legacy '${entry.legacy}' across JSONL files`);
      }
      byLegacy.set(entry.legacy, entry);
    }
    total += entries.length;
  }

  return {
    glossaryDir,
    byLegacy,
    byKind,
    total,
  };
}
