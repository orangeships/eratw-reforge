import type { AiGeneratedLine } from "./types.js";

const MAX_LINES = 6;
const MAX_LINE_LENGTH = 180;
const ALLOWED_FORMS = new Set(["PRINTFORML", "PRINTFORMDL"]);
const META_TEXT = /(?:作为(?:一个)?AI|语言模型|system prompt|系统提示|```)/i;
const LEGACY_LIKE_IDENTIFIER = /\b[A-Z][A-Z0-9_]{3,}\b/;
const PROVIDER_ERROR_TEXT = /^(?:error|错误)\s*:|\bnew_sensitive\b|\binput\s+[a-z_]+\s*\(\d+\)/i;

function isSafeLineText(text: string): boolean {
  return Boolean(text) && text.length <= MAX_LINE_LENGTH &&
    !/^[#>*-]\s/.test(text) && !META_TEXT.test(text) &&
    !LEGACY_LIKE_IDENTIFIER.test(text) && !PROVIDER_ERROR_TEXT.test(text);
}

function decodePartialJsonString(raw: string): string {
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === undefined) break;
    index += 1;
    if (escaped === "u") {
      const hex = raw.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }
    const escapes: Record<string, string> = {
      "\"": "\"",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    out += escapes[escaped] ?? escaped;
  }
  return out;
}

/** Extract safe, currently available `text` strings from an incomplete JSON
 * stream. Final acceptance still goes through parseAiKojoResponse. */
export function parsePartialAiKojoResponse(raw: string): AiGeneratedLine[] {
  const lines: AiGeneratedLine[] = [];
  const marker = /"text"\s*:\s*"/g;
  let match: RegExpExecArray | null;
  while (lines.length < MAX_LINES && (match = marker.exec(raw)) !== null) {
    let index = match.index + match[0].length;
    let escaped = false;
    let encoded = "";
    for (; index < raw.length; index += 1) {
      const char = raw[index]!;
      if (!escaped && char === "\"") break;
      encoded += char;
      if (char === "\\" && !escaped) escaped = true;
      else escaped = false;
    }
    const text = decodePartialJsonString(encoded).trim().slice(0, MAX_LINE_LENGTH);
    if (isSafeLineText(text)) lines.push({ text, form: "PRINTFORML" });
    marker.lastIndex = Math.max(marker.lastIndex, index + 1);
  }
  return lines;
}

export function jsonBody(raw: string): string {
  const trimmed = raw
    .replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think>\s*/gi, "")
    .trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith("{")) return candidate;

  // Some OpenAI-compatible DeepSeek endpoints prepend a short prose wrapper
  // after their reasoning stream. Only extract a complete object; the normal
  // schema and line safety checks below still fail closed.
  const start = candidate.indexOf("{");
  if (start < 0) return candidate;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return candidate.slice(start, index + 1);
  }
  return candidate;
}

export function parseAiKojoResponse(raw: string): AiGeneratedLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("AI response is not valid JSON");
  }
  const lines = (parsed as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES) {
    throw new Error(`AI response must contain 1-${MAX_LINES} lines`);
  }
  return lines.map((line, index) => {
    if (!line || typeof line !== "object") {
      throw new Error(`AI line ${index + 1} is not an object`);
    }
    const text = String((line as { text?: unknown }).text ?? "").trim();
    const requestedForm = (line as { form?: unknown }).form;
    const form = typeof requestedForm === "string" && ALLOWED_FORMS.has(requestedForm)
      ? requestedForm as AiGeneratedLine["form"]
      : "PRINTFORML";
    if (!text || text.length > MAX_LINE_LENGTH) {
      throw new Error(`AI line ${index + 1} must contain 1-${MAX_LINE_LENGTH} characters`);
    }
    if (!isSafeLineText(text)) {
      throw new Error(`AI line ${index + 1} contains meta or markdown text`);
    }
    return { text, form };
  });
}
