import type { AiGeneratedLine } from "./types.js";
import type { AgentActionOfferV1, AgentActionProposalV1 } from "../../../modernization/runtime/agent/action-offers.js";

const MAX_LINES = 24;
const MAX_LINE_LENGTH = 600;
const MAX_TOTAL_LENGTH = 12_000;
const MAX_CHOICE_LABEL_LENGTH = 200;
const MAX_BRANCH_LINES = 4;
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
  // A few providers occasionally omit the colon while streaming a text
  // property. Accept that one local typo for presentation-only recovery; the
  // final validator still rejects every field except safe dialogue lines.
  const marker = /"text"\s*(?::\s*)?"/g;
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

/** Decode a kojo document while keeping malformed provider output bounded.
 *
 * Some OpenAI-compatible endpoints return a few valid `lines[].text` values
 * and then lose a comma/brace when thinking is disabled. Recover only those
 * presentation lines; never recover action or relationship fields from a
 * syntactically invalid document. The normal document validator still owns
 * all length, metadata, and content checks.
 */
export function parseAiKojoDocument(raw: string): Record<string, unknown> {
  if (raw.length > 64000) throw new Error("AI response exceeds size budget");
  try {
    const parsed = JSON.parse(jsonBody(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("AI response must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    const recoveredLines = parsePartialAiKojoResponse(raw);
    if (recoveredLines.length > 0) return { lines: recoveredLines };
    throw new Error("AI response is not valid JSON");
  }
}

export function parseAiKojoResponse(raw: string): AiGeneratedLine[] {
  return validateAiKojoDocument(parseAiKojoDocument(raw));
}

export function validateAiKojoDocument(parsed: unknown): AiGeneratedLine[] {
  const sourceLines = (parsed as { lines?: unknown })?.lines;
  if (!Array.isArray(sourceLines) || sourceLines.length < 1 || sourceLines.length > MAX_LINES) {
    throw new Error(`AI response must contain 1-${MAX_LINES} lines`);
  }
  const lines = sourceLines.flatMap((line): unknown[] => {
    if (!line || typeof line !== "object") return [line];
    const rawText = (line as { text?: unknown }).text;
    // Do not stringify provider objects/arrays into character dialogue. Keep
    // the row so the final validator reports the actionable source line.
    if (typeof rawText !== "string") return [line];
    const text = rawText.trim();
    if (!text) return [];
    if (text.length <= MAX_LINE_LENGTH) return [line];
    const form = (line as { form?: unknown }).form;
    const chunks: unknown[] = [];
    for (let start = 0; start < text.length; start += MAX_LINE_LENGTH) {
      chunks.push({ text: text.slice(start, start + MAX_LINE_LENGTH), form });
    }
    return chunks;
  });
  if (lines.length < 1 || lines.length > MAX_LINES) {
    throw new Error(`AI response must normalize to 1-${MAX_LINES} lines`);
  }
  const validated: AiGeneratedLine[] = lines.map((line, index) => {
    if (!line || typeof line !== "object") {
      throw new Error(`AI line ${index + 1} is not an object`);
    }
    const rawText = (line as { text?: unknown }).text;
    const text = typeof rawText === "string" ? rawText.trim() : "";
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
  const totalLength = validated.reduce((sum, line) => sum + line.text.length, 0);
  if (totalLength > MAX_TOTAL_LENGTH) {
    throw new Error(`AI response must contain at most ${MAX_TOTAL_LENGTH} characters in total`);
  }
  const rawChoice = (parsed as { choice?: unknown }).choice;
  if (rawChoice === undefined) return validated;
  if (!rawChoice || typeof rawChoice !== "object") throw new Error("AI choice must be an object");
  const storyArcId = (rawChoice as { storyArcId?: unknown }).storyArcId;
  if (storyArcId !== undefined && (typeof storyArcId !== "string" || !storyArcId.trim()
    || storyArcId.length > 160 || /[\s\u0000-\u001f]/.test(storyArcId))) throw new Error("AI choice has an invalid story Arc ID");
  const rawOptions = (rawChoice as { options?: unknown }).options;
  if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 3) {
    throw new Error("AI choice must contain 2-3 options");
  }
  const options = rawOptions.map((rawOption, optionIndex) => {
    if (!rawOption || typeof rawOption !== "object") throw new Error(`AI choice option ${optionIndex + 1} is not an object`);
    const label = typeof (rawOption as { label?: unknown }).label === "string"
      ? (rawOption as { label: string }).label.trim()
      : "";
    if (!label || label.length > MAX_CHOICE_LABEL_LENGTH || !isSafeLineText(label)) {
      throw new Error(`AI choice option ${optionIndex + 1} has an invalid label`);
    }
    const rawBranchLines = (rawOption as { lines?: unknown }).lines;
    if (!Array.isArray(rawBranchLines) || rawBranchLines.length < 1 || rawBranchLines.length > MAX_BRANCH_LINES) {
      throw new Error(`AI choice option ${optionIndex + 1} must contain 1-${MAX_BRANCH_LINES} lines`);
    }
    const branchLines = rawBranchLines.map((rawLine, lineIndex) => {
      if (!rawLine || typeof rawLine !== "object") throw new Error(`AI branch line ${lineIndex + 1} is not an object`);
      const text = typeof (rawLine as { text?: unknown }).text === "string"
        ? (rawLine as { text: string }).text.trim()
        : "";
      if (!text || text.length > MAX_LINE_LENGTH || !isSafeLineText(text)) {
        throw new Error(`AI branch line ${lineIndex + 1} must contain safe text`);
      }
      const requestedForm = (rawLine as { form?: unknown }).form;
      const form = typeof requestedForm === "string" && ALLOWED_FORMS.has(requestedForm)
        ? requestedForm as AiGeneratedLine["form"]
        : "PRINTFORML";
      return { text, form };
    });
    return { label, lines: branchLines };
  });
  if (new Set(options.map(option => option.label)).size !== options.length) throw new Error("AI choice labels must be distinct");
  if (totalLength + options.reduce((sum, option) => sum + option.label.length
    + option.lines.reduce((n, line) => n + line.text.length, 0), 0) > MAX_TOTAL_LENGTH) throw new Error("AI choice exceeds the response text budget");
  validated[validated.length - 1] = {
    ...validated[validated.length - 1]!,
    aiChoice: { ...(typeof storyArcId === "string" ? { storyArcId } : {}), options },
  };
  return validated;
}

/** Parses only a selection from the runtime-authored menu. Unknown IDs,
 * parameters, or stale hashes fail closed before the core revalidates them. */
export function parseAiKojoActionProposal(
  raw: string,
  offers: readonly AgentActionOfferV1[],
  document?: unknown,
): AgentActionProposalV1 | null {
  let parsed: unknown;
  try {
    parsed = document ?? JSON.parse(jsonBody(raw));
  } catch {
    return null;
  }
  const action = (parsed as { action?: unknown })?.action;
  if (action === undefined) return null;
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const record = action as Record<string, unknown>;
  const keys = Object.keys(record).sort().join("|");
  const compact = keys === "offerId|parameters";
  const legacy = keys === "contextHash|offerId|parameters|version";
  if (!compact && !legacy) return null;
  if (typeof record.offerId !== "string") return null;
  if (!record.parameters || typeof record.parameters !== "object" || Array.isArray(record.parameters)) return null;
  const selected = offers.find((offer) => offer.id === record.offerId
    && (compact || (record.version === 1 && record.contextHash === offer.contextHash)));
  if (!selected) return null;
  const parameters = record.parameters as Record<string, unknown>;
  if (Object.keys(parameters).length !== selected.parameters.length) return null;
  const accepted: Record<string, string> = {};
  for (const parameter of selected.parameters) {
    const value = parameters[parameter.id];
    if (typeof value !== "string" || !parameter.options.some((entry) => entry.id === value)) return null;
    accepted[parameter.id] = value;
  }
  return { version: 1, offerId: selected.id, contextHash: selected.contextHash, parameters: accepted };
}

export type AiRelationshipProposalParse =
  | { status: "none" }
  | { status: "accepted"; item: unknown }
  | { status: "skipped"; reason: string };

/** 关系提案与 action 提案一样是**建议**，形状不合规就整条丢弃，本轮台词照常
 *  显示（此前这里直接 throw，会把已经通过校验的对白一起丢掉）。
 *
 *  放宽的只有形状：真正的裁决在 `settleRelationshipProposal`，grant、证据、
 *  单项与每日额度全部 fail-closed，所以这里接受「省略数组包裹」不会放宽任何
 *  状态写入。提示词给的是对象示例，模型经常直接吐对象，因此单对象等价于单元素
 *  数组。 */
export function parseAiKojoRelationshipProposal(
  document: unknown,
  granted: boolean,
): AiRelationshipProposalParse {
  const record = document && typeof document === "object" && !Array.isArray(document)
    ? document as Record<string, unknown>
    : {};
  const value = record.relationship_changes;
  if (value === undefined || value === null) return { status: "none" };
  if (!granted) return { status: "skipped", reason: "关系提案未获 Runtime 授权，已忽略" };
  // Narrative speech evidence is independently validated and has no gameplay
  // effect. It must not suppress an otherwise authorized relationship proposal.
  const unexpected = Object.keys(record).filter((key) => key !== "lines" && key !== "relationship_changes" && key !== "storyProgress");
  if (unexpected.length > 0) {
    return { status: "skipped", reason: `关系提案响应含额外字段，已忽略：${unexpected.join(", ")}` };
  }
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return { status: "none" };
  const item = list[0];
  if (list.length > 1 || !item || typeof item !== "object" || Array.isArray(item)) {
    return { status: "skipped", reason: "关系提案形状不合法，已忽略（最多一项，且必须是对象）" };
  }
  return { status: "accepted", item };
}

/** Scan complete rows once and rescan only the bounded unfinished row.
 * Choice branches and relationship evidence never enter the live transcript. */
export function createAiKojoStreamParser() {
  let cursor = 0, arrayStart = -1, depth = 0, objectStart = -1;
  let quoted = false, escaped = false, ended = false;
  let seekDepth = 0, seekQuoted = false, seekEscaped = false, keyStart = -1;
  let expectKey = false, isKey = false, key = "", expectArray = false;
  const lines: AiGeneratedLine[] = [];
  return (raw: string): AiGeneratedLine[] => {
    if (raw.length > 64000) throw new Error("AI response exceeds size budget");
    if (ended) return lines.slice();
    if (arrayStart < 0) {
      for (; cursor < Math.min(raw.length, 8192); cursor++) {
        const ch = raw[cursor]!;
        if (seekQuoted) {
          if (seekEscaped) seekEscaped = false;
          else if (ch === "\\") seekEscaped = true;
          else if (ch === '"') { seekQuoted = false; if (isKey) key = raw.slice(keyStart, cursor); }
          continue;
        }
        if (ch === '"') { seekQuoted = true; isKey = seekDepth === 1 && expectKey; keyStart = cursor + 1; expectKey = false; continue; }
        if (ch === ":" && seekDepth === 1) { expectArray = key === "lines"; key = ""; continue; }
        if (/\s/.test(ch)) continue;
        if (ch === "[" && expectArray && seekDepth === 1) { arrayStart = ++cursor; break; }
        expectArray = false;
        if (ch === "{" || ch === "[") { seekDepth++; if (seekDepth === 1 && ch === "{") expectKey = true; }
        else if (ch === "}" || ch === "]") seekDepth--;
        else if (ch === "," && seekDepth === 1) expectKey = true;
      }
      if (arrayStart < 0) return [];
    }
    for (; cursor < raw.length; cursor++) {
      const ch = raw[cursor]!;
      if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') { quoted = true; continue; }
      if (ch === "{" && depth++ === 0) objectStart = cursor;
      else if (ch === "}" && --depth === 0 && objectStart >= 0) {
        try {
          const item = JSON.parse(raw.slice(objectStart, cursor + 1));
          if (typeof item.text === "string" && isSafeLineText(item.text.trim()) && lines.length < MAX_LINES)
            lines.push({ text: item.text.trim(), form: item.form === "PRINTFORMDL" ? "PRINTFORMDL" : "PRINTFORML" });
        } catch { /* Only the final full document validator accepts output. */ }
        objectStart = -1;
      } else if (ch === "]" && depth === 0) { ended = true; break; }
    }
    const result = lines.slice();
    if (!ended && objectStart >= 0 && result.length < MAX_LINES) {
      // Only rescan the bounded unfinished row, never the accumulated response.
      const row = raw.slice(objectStart, objectStart + 1600);
      const textMatch = /"text"\s*:\s*"((?:\\.|[^"\\])*)/.exec(row);
      if (textMatch) {
        const text = decodePartialJsonString(textMatch[1]!).trim().slice(0, MAX_LINE_LENGTH);
        if (isSafeLineText(text)) result.push({ text, form: /"form"\s*:\s*"PRINTFORMDL"/.test(row) ? "PRINTFORMDL" : "PRINTFORML" });
      }
    }
    return result;
  };
}
