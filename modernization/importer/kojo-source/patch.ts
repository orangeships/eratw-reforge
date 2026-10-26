/**
 * Patch protocol: an edit replaces one anchor's line range (or inserts after
 * it). Nothing else is regenerated, which is what keeps comments, blank lines,
 * closing lines and `[SKIPSTART]` blocks byte-identical.
 *
 * Verification (gate G5) is a common-prefix/common-suffix diff: after patching,
 * the differing region of the file must fall inside the edited anchors' span.
 * If anything outside moved, the patch is rejected rather than written.
 */
import { scanKojoSource } from "./scan.js";
import type { KojoSourceFile, PatchVerification } from "./types.js";

export interface ReplaceAnchor { kind: "replace"; anchorId: string; text: string }
export interface InsertAfterAnchor { kind: "insert-after"; anchorId: string; lines: readonly string[] }
export interface InsertBeforeAnchor { kind: "insert-before"; anchorId: string; lines: readonly string[] }
export interface DeleteAnchor { kind: "delete"; anchorId: string }
export interface SourcePatchLine { text: string; eol: string; originalLine?: number }
/** A validated visual transaction can rearrange a whole structured range.
 * Original line identities retain untouched encodings, comments and EOLs. */
export interface ReplaceRange { kind: "replace-range"; anchorId: string; endLine: number; lines: SourcePatchLine[] }
export type SourceEdit = ReplaceAnchor | InsertAfterAnchor | InsertBeforeAnchor | DeleteAnchor | ReplaceRange;

export interface PatchResult {
  text: string;
  verification: PatchVerification;
}

/** Split replacement text into bare lines (terminators come from the anchor). */
function asLines(text: string): string[] {
  const parts = text.split("\n").map(part => (part.endsWith("\r") ? part.slice(0, -1) : part));
  if (parts.at(-1) === "") parts.pop();
  return parts.length ? parts : [""];
}

/**
 * The region that actually differs, expressed in both old and new line
 * coordinates (1-based, inclusive; `oldEnd`/`newEnd` may be < start when the
 * region is empty).
 */
function diffRegion(oldLines: readonly string[], newLines: readonly string[]): { oldStart: number; oldEnd: number; newStart: number; newEnd: number } {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;
  return {
    oldStart: prefix + 1,
    oldEnd: oldLines.length - suffix,
    newStart: prefix + 1,
    newEnd: newLines.length - suffix,
  };
}

export function applyEdits(file: KojoSourceFile, edits: readonly SourceEdit[]): PatchResult {
  const byStart = new Map<number, SourceEdit[]>();
  const anchorByStart = new Map<number, KojoSourceFile["anchors"][number]>();
  for (const edit of edits) {
    const anchor = file.anchors.find(item => item.id === edit.anchorId);
    if (!anchor) throw new Error(`unknown anchor: ${edit.anchorId}`);
    byStart.set(anchor.startLine, [...(byStart.get(anchor.startLine) ?? []), edit]);
    if (edit.kind === "replace-range") {
      if (!Number.isInteger(edit.endLine) || edit.endLine < anchor.endLine || edit.endLine > file.lines.length) throw new Error("invalid visual edit range");
      for (const line of edit.lines) {
        if (/[\r\n]/.test(line.text) || !["", "\n", "\r\n"].includes(line.eol)) throw new Error("invalid physical line");
        if (line.originalLine !== undefined) {
          const original = file.lines[line.originalLine - 1];
          if (!original || original.text !== line.text || original.eol !== line.eol) throw new Error("original line identity does not match");
        }
      }
      anchorByStart.set(anchor.startLine, { ...anchor, endLine: edit.endLine });
    } else anchorByStart.set(anchor.startLine, anchor);
  }
  if (!byStart.size) return { text: file.lines.map(line => `${line.text}${line.eol}`).join(""), verification: { ok: true, changedLines: [], strayLines: [], issues: [] } };

  const chunks: string[] = [];
  let index = 0; // 0-based index into file.lines
  while (index < file.lines.length) {
    const line = file.lines[index]!;
    const pending = byStart.get(line.no);
    if (!pending) { chunks.push(`${line.text}${line.eol}`); index++; continue; }
    const anchor = anchorByStart.get(line.no)!;
    const eol = line.eol;
    const insertEol = eol || file.lines.find(item => item.eol)?.eol || "\n";
    const replacement = pending.find((edit): edit is ReplaceAnchor => edit.kind === "replace");
    const range = pending.find((edit): edit is ReplaceRange => edit.kind === "replace-range");
    const deleted = pending.some(edit => edit.kind === "delete");
    for (const edit of pending) if (edit.kind === "insert-before") for (const text of edit.lines) chunks.push(`${text}${insertEol}`);
    if (!deleted) {
      if (range) {
        for (const source of range.lines) chunks.push(source.text + source.eol);
      } else if (replacement) {
        for (const text of asLines(replacement.text)) chunks.push(`${text}${eol}`);
      } else {
        for (let offset = 0; offset < anchor.endLine - anchor.startLine + 1; offset++) {
          const source = file.lines[anchor.startLine - 1 + offset]!;
          chunks.push(`${source.text}${source.eol}`);
        }
      }
    }
    const after = pending.filter((edit): edit is InsertAfterAnchor => edit.kind === "insert-after");
    if (after.some(edit => edit.lines.length) && !eol && !deleted) chunks.push(insertEol);
    for (const edit of after) for (const text of edit.lines) chunks.push(`${text}${insertEol}`);
    index = anchor.endLine; // line numbers are 1-based, so this is the next index
  }

  const text = chunks.join("");
  const oldFlat = file.lines.map(line => line.text);
  const rescanned = scanKojoSource(file.file, text, file.encoding);
  const newFlat = rescanned.lines.map(line => line.text);
  const region = diffRegion(oldFlat, newFlat);
  const empty = region.oldEnd < region.oldStart && region.newEnd < region.newStart;

  const editedStart = Math.min(...[...anchorByStart.keys()]);
  const editedEnd = Math.max(...[...anchorByStart.values()].map(anchor => anchor.endLine));
  const delta = newFlat.length - oldFlat.length;
  const withinSpan = empty
    || (region.oldStart >= editedStart && region.oldEnd <= editedEnd && region.newEnd <= editedEnd + delta);

  // Reported in new-file coordinates, which is what a reviewer diffs against.
  const changedLines: number[] = [];
  for (let no = region.newStart; no <= region.newEnd; no++) changedLines.push(no);
  const strayLines = withinSpan ? [] : changedLines.filter(no => no < editedStart || no > editedEnd + delta);

  return {
    text,
    verification: { ok: withinSpan, changedLines, strayLines, issues: rescanned.issues },
  };
}

/** A compact unified-style diff limited to the changed span, for review output. */
export function describePatch(file: KojoSourceFile, result: PatchResult): string[] {
  const oldFlat = file.lines.map(line => line.text);
  const newFlat = result.text.split("\n").map(line => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (newFlat.at(-1) === "") newFlat.pop();
  const region = diffRegion(oldFlat, newFlat);
  const out: string[] = [];
  for (let no = region.oldStart; no <= region.oldEnd; no++) out.push(`- ${oldFlat[no - 1] ?? ""}`);
  for (let no = region.newStart; no <= region.newEnd; no++) out.push(`+ ${newFlat[no - 1] ?? ""}`);
  return out;
}
