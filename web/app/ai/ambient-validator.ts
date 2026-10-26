import type { AmbientInitiativeOpportunity } from "../../../modernization/runtime/world/ambient-initiative.js";
import { jsonBody } from "./response-validator.js";
import type { SceneAmbientLine, SceneAmbientForm } from "./types.js";

const MAX_LINES = 6;
const MAX_LINE_LENGTH = 180;
const ALLOWED_FORMS = new Set<SceneAmbientForm>(["speech", "action"]);
const META_OR_MARKDOWN = /(?:作为(?:一个)?AI|语言模型|system prompt|系统提示|```|^[#>*-]\s)/i;
const PLAYER_GHOSTWRITING = /(?:(?:主角|玩家)\s*(?:说|回答|答道|点头答应|选择|决定|承诺))|(?:你\s*(?:回答道|点头答应|选择了|决定了|承诺(?:道|了)))|(?:^|[\s“「])(?:主角|玩家)[：:]/;
const RULE_CONSEQUENCE = /(?:离开(?:了|这里|房间)|走出(?:房间|地点)|前往(?:别处|工作)|获得(?:了)?(?:道具|物品|金钱)|交给(?:主角|玩家|对方)|拿走(?:了)?(?:道具|物品)|开始(?:工作|约会|战斗)|进入(?:战斗|工作状态)|好感(?:上升|增加)|信赖(?:上升|增加)|关系(?:改变|加深|确定)|成为(?:恋人|情侣)|答应(?:约会|交往)|许下承诺|承诺(?:以后|一定)|一定会(?:陪你|做到))/;

function validateLine(
  value: unknown,
  opportunity: AmbientInitiativeOpportunity,
  index: number,
): SceneAmbientLine {
  if (!value || typeof value !== "object") {
    throw new Error(`Ambient line ${index + 1} is not an object`);
  }
  const participantId = Number((value as { participantId?: unknown }).participantId);
  const form = (value as { form?: unknown }).form;
  const text = String((value as { text?: unknown }).text ?? "").trim();
  if (!Number.isInteger(participantId) || !opportunity.participantIds.includes(participantId)) {
    throw new Error(`Ambient line ${index + 1} has an out-of-scope participant`);
  }
  if (typeof form !== "string" || !ALLOWED_FORMS.has(form as SceneAmbientForm)) {
    throw new Error(`Ambient line ${index + 1} has an invalid form`);
  }
  if (opportunity.mode === "character-dialogue") {
    if (opportunity.kind !== "address-player" && opportunity.kind !== "question-player") {
      throw new Error("character-dialogue only permits address-player or question-player");
    }
    if (form !== "speech") {
      throw new Error("character-dialogue accepts speech lines only");
    }
  } else {
    if (opportunity.kind !== "npc-exchange" &&
        opportunity.kind !== "event-echo") {
      throw new Error("scene-interaction only permits scene interaction kinds");
    }
    if (form !== "speech") {
      throw new Error("scene-interaction accepts speech lines only");
    }
  }
  if (!text || text.length > MAX_LINE_LENGTH) {
    throw new Error(`Ambient line ${index + 1} must contain 1-${MAX_LINE_LENGTH} characters`);
  }
  if (META_OR_MARKDOWN.test(text)) {
    throw new Error(`Ambient line ${index + 1} contains meta or markdown text`);
  }
  if (PLAYER_GHOSTWRITING.test(text)) {
    throw new Error(`Ambient line ${index + 1} writes the player`);
  }
  if (RULE_CONSEQUENCE.test(text)) {
    throw new Error(`Ambient line ${index + 1} claims a rule consequence`);
  }
  return { participantId, form: form as SceneAmbientForm, text };
}

function validateStructure(
  lines: readonly SceneAmbientLine[],
  opportunity: AmbientInitiativeOpportunity,
): void {
  const used = new Set(lines.map((line) => line.participantId));
  const speech = lines.filter((line) => line.form === "speech");
  if (opportunity.mode === "character-dialogue") {
    if (
      opportunity.participantIds.length !== 1 ||
      used.size !== 1 ||
      !used.has(opportunity.initiatorId) ||
      lines.some((line) => line.form !== "speech")
    ) {
      throw new Error("character-dialogue must contain one participant and speech lines only");
    }
    if (opportunity.kind === "question-player") {
      const lastLine = lines[lines.length - 1];
      if (!lastLine || !/[?？]\s*$/.test(lastLine.text)) {
        throw new Error("question-player must end with the initiator's question");
      }
    } else if (opportunity.kind !== "address-player") {
      throw new Error("character-dialogue only permits player-directed dialogue");
    }
    return;
  }
  if (opportunity.mode !== "scene-interaction") {
    throw new Error("Ambient response has an unknown initiative mode");
  }
  switch (opportunity.kind) {
    case "event-echo":
      if (used.size !== 1 || !used.has(opportunity.initiatorId) || speech.length === 0) {
        throw new Error(`${opportunity.kind} must contain the initiator and at least one speech line`);
      }
      break;
    case "address-player":
    case "question-player":
      throw new Error(`${opportunity.kind} belongs to character-dialogue`);
    case "npc-exchange":
      if (
        opportunity.participantIds.length !== 2 ||
        used.size !== 2 ||
        !opportunity.participantIds.every((participantId) => used.has(participantId)) ||
        speech.length === 0
      ) {
        throw new Error("npc-exchange must include both participants and speech");
      }
      break;
  }
}

export function parseSceneAmbientResponse(
  raw: string,
  opportunity: AmbientInitiativeOpportunity,
): SceneAmbientLine[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("Ambient response is not valid JSON");
  }
  const values = (parsed as { lines?: unknown })?.lines;
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_LINES) {
    throw new Error(`Ambient response must contain 1-${MAX_LINES} lines`);
  }
  const lines = values.map((value, index) => validateLine(value, opportunity, index));
  validateStructure(lines, opportunity);
  return lines;
}

/** Extract only complete, individually safe line objects from an SSE prefix. */
export function parsePartialSceneAmbientResponse(
  raw: string,
  opportunity: AmbientInitiativeOpportunity,
): SceneAmbientLine[] {
  const linesKey = /"lines"\s*:\s*\[/.exec(raw);
  if (!linesKey) return [];
  const start = linesKey.index + linesKey[0].length;
  const objects: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < raw.length && objects.length < MAX_LINES; index += 1) {
    const char = raw[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(raw.slice(objectStart, index + 1));
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }
  const safe: SceneAmbientLine[] = [];
  for (const object of objects) {
    try {
      safe.push(validateLine(JSON.parse(object), opportunity, safe.length));
    } catch {
      // A malformed/unsafe completed line is never displayed. Final parsing
      // rejects the response as a whole.
    }
  }
  try {
    validateStructure(safe, opportunity);
    return safe;
  } catch {
    // Streaming uses the same mode/shape gate as the final response. A
    // character dialogue action, an incomplete NPC exchange, or a question
    // without its final question mark is not published prematurely.
    return [];
  }
}
