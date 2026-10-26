/**
 * Rendering is the safety net for the whole editor: `render(scan(text))` must
 * reproduce `text` byte for byte, otherwise untouched content would be
 * rewritten by accident.
 */
import type { Anchor, KojoSourceFile } from "./types.js";

/** Reassemble the original file, byte for byte. */
export function render(file: KojoSourceFile): string {
  let out = "";
  for (const line of file.lines) out += `${line.text}${line.eol}`;
  return out;
}

/** Source slice owned by one anchor (terminators included). */
export function anchorText(file: KojoSourceFile, anchor: Anchor): string {
  let out = "";
  for (let no = anchor.startLine; no <= anchor.endLine; no++) {
    const line = file.lines[no - 1];
    if (!line) continue;
    out += `${line.text}${line.eol}`;
  }
  return out;
}

/** Anchors in source order. */
export function orderedAnchors(file: KojoSourceFile): Anchor[] {
  return [...file.anchors].sort((a, b) => a.startLine - b.startLine);
}

/** Anchors belonging to one function, in source order. */
export function anchorsOfFunction(file: KojoSourceFile, name: string): Anchor[] {
  const fn = file.functions.find(item => item.name === name);
  if (!fn) return [];
  const wanted = new Set(fn.anchorIds);
  return orderedAnchors(file).filter(anchor => wanted.has(anchor.id));
}
