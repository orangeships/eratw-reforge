/**
 * Phase 2.6 PR 2 — Glossary type definitions.
 *
 * These mirror the JSON Schema in `glossary/schema.json`. The
 * schema is the source of truth (machine-checkable); this file
 * is the TS mirror (compile-time-checkable in code that imports
 * it). Keep the two in sync.
 */

export type GlossaryKind =
  | "variable-type"
  | "flag-name"
  | "command-name"
  | "function-name";

export type GlossaryScope = "type-layer" | "value-layer";

export interface GlossaryEvidence {
  source: string;
  count: number;
  firstSeen?: string;
}

export interface GlossaryEntry {
  legacy: string;
  canonical: string;
  display: string;
  kind: GlossaryKind;
  scope: GlossaryScope;
  doc: string;
  since: string;
  evidence: GlossaryEvidence;
  /**
   * Optional. Marks whether this entry belongs to the upstream core
   * (default "core") or to a Phase 10 mod ("mod"). Reserved for
   * Phase 10 — Phase 3 emits only "core" on every entry. The field
   * is optional for backward compatibility with older JSONL files.
   */
  modScope?: "core" | "mod";
}
