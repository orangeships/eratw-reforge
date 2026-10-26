/**
 * Line-level structural scan of upstream kojo ERB.
 *
 * Design notes that matter for correctness:
 *  - One physical line = one anchor. Measured over the full 個人口上 corpus
 *    (2,671,863 code lines) only 0.023% of lines have an unbalanced quote, and
 *    every sampled case was ASCII art rather than a real multi-line string, so
 *    continuation grouping is deliberately not attempted here.
 *  - Blank lines and comment-only lines are NOT anchored; they stay in
 *    `lines` so `render()` can return the file byte for byte.
 *  - `;` inside a string literal must not start a comment, so comment
 *    stripping is quote-aware. (The legacy VM compiler cuts at the first `;`
 *    unconditionally, which mis-handles 205 lines in this corpus.)
 */
import type { Anchor, AnchorRole, KojoSourceFile, SourceIssue, SourceLine } from "./types.js";

interface SourceFunctionAcc {
  name: string;
  declLine: number;
  anchorIds: string[];
}

const OPENERS: Record<string, string> = {
  IF: "ENDIF",
  SELECTCASE: "ENDSELECT",
  FOR: "NEXT",
  WHILE: "WEND",
  REPEAT: "REND",
  DO: "LOOP",
  DATALIST: "ENDLIST",
};
/**
 * Story-structure openers. `DATALIST` is tracked because it pairs cleanly
 * (118/118 in the Reimu corpus); the `DATAFORM`/`ENDDATA` data-table family is
 * deliberately NOT treated as a block — measured on that corpus, `DATAFORM` is
 * overwhelmingly a single row (`DATAFORM 台詞…`, 469 with arguments against 101
 * bare), and `ENDDATA` terminates a section whose opener is a caption line, not
 * a keyword. Data tables carry no story structure, so the editor only needs
 * them to stay byte-identical, which the anchor model already guarantees.
 */
export const STRUCTURAL_OPENERS: ReadonlySet<string> = new Set(["IF", "SIF", "SELECTCASE", "FOR", "WHILE", "REPEAT", "DO", "DATALIST"]);
const DATA_SECTION_END = "ENDDATA";
/** `REPEAT` is closed by `REND` in Emuera; some authors write `LOOP`. */
const CLOSER_ALTERNATIVES: Record<string, readonly string[]> = {
  REND: ["REND", "LOOP"],
  LOOP: ["LOOP", "REND"],
};
const BRANCHES = new Set(["ELSEIF", "ELSE", "CASE", "CASEELSE", "CATCH"]);
const ALL_CLOSERS = new Set(["ENDIF", "ENDSELECT", "NEXT", "WEND", "REND", "LOOP", "ENDDATA", "ENDLIST", "ENDCATCH"]);
const EMIT = /^(PRINT(?:FORMDW|FORMDL|FORMD|FORML|FORMW|FORMS|FORM|FORMC|DL|DW|D|L|W|S|C)?|PRINTL|HTML_PRINT|HPH_PRINT|PRINTBUTTONC?|DEBUGPRINTFORML)\b/i;
const CALL = /^(CALL|CALLF|CALLFORM|CALLFORMF|TRYCALL|TRYCALLFORM|TRYCALLFORMF|TRYCCALL|TRYCCALLFORM|JUMP|CALLSHARP)\b/i;
const RET = /^RETURNF?\b/i;
const STATE_OP = /^(SETBIT|CLEARBIT|VARSET|CVARSET|SWAP|RESETCOLOR|SETCOLOR|SETCOLORBYNAME|DRAWLINE[FW]?|WAIT|WAITANYKEY|FORCEWAIT|REDRAW|CLEARLINE|TWAIT|SETFONT\w*|FONT\w+|ALIGNMENT|CSTYLE|REUSELASTLINE|CLEARBIT)\b/i;
const ASSIGN = /(^|[^<>=!])(=|'=|\+=|-=|\*=|\/=|%=|\+\+|--)/;

/** Split into physical lines while remembering each terminator. */
export function splitPhysicalLines(text: string): Array<{ text: string; eol: string }> {
  const out: Array<{ text: string; eol: string }> = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) { out.push({ text: text.slice(start), eol: "" }); break; }
    let end = nl;
    let eol = "\n";
    if (end > start && text[end - 1] === "\r") { end -= 1; eol = "\r\n"; }
    out.push({ text: text.slice(start, end), eol });
    start = nl + 1;
  }
  return out;
}

/** Cut a trailing `;` comment, ignoring semicolons inside string literals. */
export function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') inString = !inString;
    else if (ch === ";" && !inString) return line.slice(0, i);
  }
  return line;
}

function firstToken(code: string): string {
  return (code.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] ?? "").toUpperCase();
}

function classify(code: string, gotoLabels: ReadonlySet<string>): { kind: string; opaque: boolean } {
  const token = firstToken(code);
  if (EMIT.test(code)) return { kind: "emit", opaque: false };
  if (CALL.test(code)) return { kind: "call", opaque: false };
  if (RET.test(code)) return { kind: "return", opaque: false };
  if (STATE_OP.test(code)) return { kind: token.toLowerCase(), opaque: false };
  if (gotoLabels.has(token) && new RegExp(`^${token}\\s*$`).test(code)) return { kind: "label", opaque: false };
  if (ASSIGN.test(code)) return { kind: "assignment", opaque: false };
  return { kind: "raw", opaque: true };
}

/** Static GOTO targets in a file, used to recognise bare label lines. */
export function collectGotoTargets(codeLines: readonly string[]): Set<string> {
  const targets = new Set<string>();
  for (const code of codeLines) {
    const jump = /^GOTO\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/i.exec(code);
    if (jump) targets.add(jump[1]!.toUpperCase());
  }
  return targets;
}

export function scanKojoSource(file: string, text: string, encoding = "utf-8"): KojoSourceFile {
  const physical = splitPhysicalLines(text);
  const codes = physical.map(part => stripComment(part.text).trim());
  const gotoLabels = collectGotoTargets(codes);

  const lines: SourceLine[] = physical.map((part, index) => ({
    no: index + 1, text: part.text, eol: part.eol, anchorId: null,
  }));

  const anchors: Anchor[] = [];
  const issues: SourceIssue[] = [];
  const stack: Array<{ id: string; keyword: string; anchor: Anchor; depth: number }> = [];
  let inertDepth = 0;
  let currentFunction: string | null = null;
  const functionAnchors = new Map<string, SourceFunctionAcc>();

  for (let index = 0; index < physical.length; index++) {
    const line = physical[index]!;
    const code = codes[index]!;
    const lineNo = index + 1;
    if (!code) continue; // blank or comment-only: stays unanchored, still rendered

    const declaration = /^@([^\s(,;]+)/.exec(code);
    if (declaration && stack.length) {
      for (const leftover of stack) {
        leftover.anchor.note = `unclosed ${leftover.keyword}`;
        issues.push({ line: leftover.anchor.startLine, code: "unmatched-open", detail: `${leftover.keyword} crosses a function boundary` });
      }
      stack.length = 0;
    }
    const token = firstToken(code);
    let role: AnchorRole = "statement";
    let kind = "statement";
    let opaque = false;

    if (declaration) { role = "declaration"; kind = "function"; }
    else if (/^\[SKIP(?:START|END)\]$/i.test(code)) { role = "directive"; kind = code.toLowerCase(); }
    else if (token === "SIF") { role = "block-open"; kind = "sif"; }
    else if (OPENERS[token]) { role = "block-open"; kind = token.toLowerCase(); }
    else if (token === DATA_SECTION_END) { role = "block-close"; kind = "enddata"; }
    else if (ALL_CLOSERS.has(token)) { role = "block-close"; kind = token.toLowerCase(); }
    else if (BRANCHES.has(token)) { role = "block-branch"; kind = token.toLowerCase(); }
    else if (token === "DATAFORM") { kind = "dataform"; opaque = true; }
    else {
      const result = classify(code, gotoLabels);
      kind = result.kind;
      opaque = result.opaque;
      if (kind === "label") role = "label";
    }

    /** `@` lines and `[SKIP*]` directives sit outside any block stack. */
    const parent = role === "declaration" || role === "directive" ? undefined : stack.at(-1);
    const anchor: Anchor = {
      id: `${file}:${lineNo}`,
      file,
      startLine: lineNo,
      endLine: lineNo,
      role,
      kind,
      parent: parent?.id ?? null,
      depth: role === "declaration" || role === "directive" ? 0 : stack.length,
      raw: `${line.text}${line.eol}`,
      opaque,
      inert: inertDepth > 0,
    };

    if (role === "declaration" && declaration) {
      currentFunction = declaration[1]!;
      if (!functionAnchors.has(currentFunction)) {
        functionAnchors.set(currentFunction, { name: currentFunction, declLine: lineNo, anchorIds: [] });
      }
    }

    if (role === "directive" && /^\[SKIPSTART\]$/i.test(code)) inertDepth++;
    else if (role === "directive" && /^\[SKIPEND\]$/i.test(code)) inertDepth = Math.max(0, inertDepth - 1);

    if (role === "block-open") {
      if (kind === "sif") { anchor.closer = anchor.id; } // single-line IF holds no body
      else stack.push({ id: anchor.id, keyword: token, anchor, depth: anchor.depth });
    } else if (role === "block-close" && kind === "enddata") {
      // A data-section terminator whose opener is a caption line, not a keyword.
      // It carries no story structure, so it is exempt from pairing accounting.
      anchor.note = "data-section terminator";
    } else if (role === "block-branch") {
      const owner = stack.at(-1);
      if (!owner) { anchor.note = "stray branch"; issues.push({ line: lineNo, code: "stray-branch", detail: `${token} without an open block` }); }
      else anchor.opener = owner.id;
    } else if (role === "block-close") {
      let matched: typeof stack[number] | undefined;
      while (stack.length) {
        const top = stack.at(-1)!;
        const accepted = CLOSER_ALTERNATIVES[token] ?? [token];
        if (accepted.includes(OPENERS[top.keyword] ?? "")) { matched = stack.pop(); break; }
        const abandoned = stack.pop()!;
        abandoned.anchor.note = `unmatched ${abandoned.keyword}`;
        issues.push({ line: abandoned.anchor.startLine, code: "unmatched-open", detail: `${abandoned.keyword} closed by ${token}` });
      }
      if (!matched) { anchor.note = "unmatched close"; issues.push({ line: lineNo, code: "unmatched-close", detail: `${token} without a matching open block` }); }
      else { anchor.opener = matched.id; matched.anchor.closer = anchor.id; }
    }

    if (currentFunction) {
      let acc = functionAnchors.get(currentFunction);
      if (!acc) { acc = { name: currentFunction, declLine: 0, anchorIds: [] }; functionAnchors.set(currentFunction, acc); }
      acc.anchorIds.push(anchor.id);
    }
    anchors.push(anchor);
    lines[index]!.anchorId = anchor.id;
  }

  for (const leftover of stack) {
    leftover.anchor.note = `unclosed ${leftover.keyword}`;
    issues.push({ line: leftover.anchor.startLine, code: "unmatched-open", detail: `${leftover.keyword} never closed` });
  }

  // Invariant I1: every code line belongs to exactly one anchor.
  for (const line of lines) {
    const isCode = stripComment(line.text).trim().length > 0;
    if (isCode && !line.anchorId) issues.push({ line: line.no, code: "anchor-gap", detail: "code line has no anchor" });
  }

  return {
    file,
    encoding,
    lines,
    anchors,
    issues,
    functions: [...functionAnchors.values()].map(acc => ({ ...acc })),
  };
}
