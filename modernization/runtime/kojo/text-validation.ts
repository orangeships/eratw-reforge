import type { KojoLine } from "./types.js";

export interface KojoTextValidationIssue {
  code: "unresolved-text";
  detail: string;
  line: number;
}

const UNRESOLVED_PERCENT_TOKEN = /%[^%\r\n]+%/;
const UNRESOLVED_CHARACTER_REF = /\[\[[^\]\r\n]*\]\]/;
const UNRESOLVED_INLINE_EXPRESSION = /\\?@\s*[^@\r\n]+(?:\?|#|\\?@)/;

/**
 * Reject formatter syntax that reached the final player-facing text layer.
 *
 * A literal formatter token is never a faithful fallback: it exposes ERB
 * internals and can make a partially evaluated branch appear valid. The
 * router turns these issues into a terminal `unsupported` resolution.
 */
export function validateKojoLines(
  lines: readonly KojoLine[],
): KojoTextValidationIssue[] {
  const issues: KojoTextValidationIssue[] = [];
  for (const line of lines) {
    if (UNRESOLVED_PERCENT_TOKEN.test(line.text)) {
      issues.push({
        code: "unresolved-text",
        detail: "unresolved percent formatter token",
        line: line.line,
      });
    }
    if (UNRESOLVED_CHARACTER_REF.test(line.text)) {
      issues.push({
        code: "unresolved-text",
        detail: "unresolved character reference",
        line: line.line,
      });
    }
    if (UNRESOLVED_INLINE_EXPRESSION.test(line.text)) {
      issues.push({
        code: "unresolved-text",
        detail: "unresolved inline ERB expression",
        line: line.line,
      });
    }
  }
  return issues;
}
