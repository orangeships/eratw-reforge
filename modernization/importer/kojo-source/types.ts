/**
 * Source-structure layer for upstream kojo ERB.
 *
 * The semantic parser (`importer/kojo/parser.ts`) answers "what does this
 * branch mean" but keeps only ~40% of source lines addressable. This layer
 * answers the different question the editor needs: "where is it, and what do
 * we write back".
 *
 * The invariable contract is I1: every code line belongs to exactly one
 * anchor. The file text stays the single source of truth — an anchor is only
 * a view over a line range, so anything nobody edits is re-emitted verbatim.
 */

export type AnchorRole =
  /** A single-line statement: PRINT*, CALL, assignment, SETCOLOR, WAIT, SETBIT… */
  | "statement"
  /** IF / SIF / SELECTCASE / FOR / WHILE / REPEAT / DO / DATAFORM / DATALIST */
  | "block-open"
  /** ELSEIF / ELSE / CASE / CASEELSE / CATCH */
  | "block-branch"
  /** ENDIF / ENDSELECT / NEXT / WEND / LOOP / ENDDATA / ENDLIST */
  | "block-close"
  /** An intra-function GOTO target line. */
  | "label"
  /** `[SKIPSTART]` / `[SKIPEND]` directives. */
  | "directive"
  /** An `@FUNCTION` declaration line. */
  | "declaration";

export interface Anchor {
  /** `${file}:${startLine}` — stable across re-scans of an unchanged file. */
  id: string;
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive; equal to startLine until multi-line statements exist. */
  endLine: number;
  role: AnchorRole;
  /** Coarse statement kind: emit / call / return / assignment / state-set / raw … */
  kind: string;
  /** Enclosing block opener anchor id, or null at function root. */
  parent: string | null;
  /** Nesting depth of the enclosing blocks (0 = function root). */
  depth: number;
  /** Verbatim source slice, terminators included. */
  raw: string;
  /** True when the structure layer does not understand the statement. */
  opaque: boolean;
  /** True when the line sits inside a `[SKIPSTART]` block (inert to Emuera). */
  inert: boolean;
  /** block-open → its matching block-close anchor id. */
  closer?: string;
  /** block-close / block-branch → the owning block-open anchor id. */
  opener?: string;
  /** Structural diagnostic attached to this anchor, if any. */
  note?: string;
}

export interface SourceLine {
  /** 1-based physical line number. */
  no: number;
  /** Line content without its terminator. */
  text: string;
  /** "\r\n" | "\n" | "" (last line without a trailing newline). */
  eol: string;
  /** Anchor owning this line, or null for blank lines and comment-only lines. */
  anchorId: string | null;
}

export interface SourceIssue {
  line: number;
  code:
    | "unmatched-close"
    | "unmatched-open"
    | "stray-branch"
    | "duplicate-label"
    | "unbalanced-quotes"
    | "anchor-gap";
  detail: string;
}

export interface KojoSourceFile {
  file: string;
  encoding: string;
  lines: SourceLine[];
  anchors: Anchor[];
  issues: SourceIssue[];
  /** Function name owning each anchor, taken from the preceding `@` line. */
  functions: SourceFunction[];
}

export interface SourceFunction {
  name: string;
  /** 1-based line of the `@` declaration. */
  declLine: number;
  /** Anchor ids belonging to this function, in source order. */
  anchorIds: string[];
}

/** Result of re-scanning a patched document. */
export interface PatchVerification {
  ok: boolean;
  /** Lines that differ from the original, as 1-based new-file line numbers. */
  changedLines: number[];
  /** Changed lines that fall outside the edited anchors' expected ranges. */
  strayLines: number[];
  issues: SourceIssue[];
}
