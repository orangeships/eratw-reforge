import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type {
  AgentMindItemUpdate,
  AgentMindUpdatesV1,
  AgentMindStateV1,
  AgentSocialThreadUpdate,
  DaytimeEvidenceBatch,
} from "../../../modernization/runtime/agent/index.js";
import type { AiCompletionRequest, AiProvider, AiSettings } from "./types.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import { completeWithStateContext, type CompletionHooks } from "./state-context.js";
import { jsonBody } from "./response-validator.js";
import { compileAiCharacterSemanticContext } from "./context.js";

export interface AgentDaytimeReactionEnvelope {
  schemaVersion: 1;
  charaNum: number;
  dayIndex: number;
  baseRevision: number;
  observationIds: string[];
  mindUpdates: AgentMindUpdatesV1;
}
export interface AgentDaytimeReactionRequest {
  requestId: string;
  state: Readonly<GameState>;
  evidence: DaytimeEvidenceBatch;
  settings: AiSettings;
  signal: AbortSignal;
  /** Debug-panel recording of the exchange (prompt/response). */
  hooks?: CompletionHooks;
}

/** Bump when the daytime prompt or patch contract changes. */
export { AGENT_DAYTIME_PROMPT_VERSION } from "./daytime-guard.js";

/** Provider output that failed the daytime JSON/patch contract. */
export class AgentDaytimeSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentDaytimeSchemaError";
  }
}

export function isAgentDaytimeSchemaError(error: unknown): error is AgentDaytimeSchemaError {
  return error instanceof AgentDaytimeSchemaError;
}

let providerOverride: AiProvider | null = null;

export function configureAgentDaytimeProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\0/g, "").trim();
  return text ? text.slice(0, max) : undefined;
}

function boundedIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return [];
  return [...new Set(value
    .map((entry) => boundedText(entry, 180))
    .filter((entry): entry is string => entry !== undefined))];
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentDaytimeSchemaError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

/** Drop keys outside the contract instead of rejecting the whole response.
 * Models habitually add a `note`/`confidence`/echoed-runtime field; the safety
 * boundary is the value validation below and the evidence re-check in
 * `requestAgentDaytimeReaction`, not key strictness. */
function stripExtraKeys(value: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const allowedSet = new Set(allowed);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (allowedSet.has(key)) result[key] = entry;
  }
  return result;
}

function parseEvidence(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new AgentDaytimeSchemaError(`${label} must contain at most 8 ids`);
  const ids = value.map((entry) => boundedText(entry, 180));
  if (ids.some((entry) => entry === undefined)) throw new AgentDaytimeSchemaError(`${label} contains invalid ids`);
  return [...new Set(ids as string[])];
}

function parseItemUpdate(value: unknown, label: string): AgentMindItemUpdate {
  const obj = stripExtraKeys(objectValue(value, label), ["action", "id", "topic", "text", "evidenceIds"]);
  if (obj.action !== "add" && obj.action !== "update" && obj.action !== "resolve") {
    throw new AgentDaytimeSchemaError(`${label}.action is invalid`);
  }
  const result: AgentMindItemUpdate = { action: obj.action };
  if (obj.id !== undefined) result.id = boundedText(obj.id, 160);
  if (obj.topic !== undefined) {
    if (obj.topic !== "self" && obj.topic !== "player" && obj.topic !== "relationship") throw new AgentDaytimeSchemaError(`${label}.topic is invalid`);
    result.topic = obj.topic;
  }
  if (obj.text !== undefined) result.text = boundedText(obj.text, 180);
  const evidenceIds = parseEvidence(obj.evidenceIds, `${label}.evidenceIds`);
  if (evidenceIds !== undefined) result.evidenceIds = evidenceIds;
  return result;
}

function parseThreadUpdate(value: unknown, label: string): AgentSocialThreadUpdate {
  const obj = stripExtraKeys(objectValue(value, label), ["action", "id", "kind", "text", "evidenceIds"]);
  if (obj.action !== "add" && obj.action !== "update" && obj.action !== "resolve") {
    throw new AgentDaytimeSchemaError(`${label}.action is invalid`);
  }
  const result: AgentSocialThreadUpdate = { action: obj.action };
  if (obj.id !== undefined) result.id = boundedText(obj.id, 160);
  if (obj.kind !== undefined) {
    if (obj.kind !== "promise" && obj.kind !== "conflict" && obj.kind !== "secret" && obj.kind !== "question") throw new AgentDaytimeSchemaError(`${label}.kind is invalid`);
    result.kind = obj.kind;
  }
  if (obj.text !== undefined) result.text = boundedText(obj.text, 300);
  const evidenceIds = parseEvidence(obj.evidenceIds, `${label}.evidenceIds`);
  if (evidenceIds !== undefined) result.evidenceIds = evidenceIds;
  return result;
}

function parseMindUpdates(value: unknown): AgentMindUpdatesV1 {
  // A patch may legitimately be empty; models often express "nothing changed"
  // by omitting the field entirely, and the prompt tells them an empty object
  // is the correct no-op — accept both spellings.
  if (value === undefined || value === null) return {};
  const obj = stripExtraKeys(objectValue(value, "mindUpdates"),
    ["relationshipToPlayer", "currentTendency", "beliefs", "goals", "threads"]);
  const result: AgentMindUpdatesV1 = {};
  if (obj.relationshipToPlayer !== undefined) result.relationshipToPlayer = boundedText(obj.relationshipToPlayer, 300);
  if (obj.currentTendency !== undefined) result.currentTendency = boundedText(obj.currentTendency, 300);
  const boundedList = <T>(value: unknown, label: string, max: number, parse: (entry: unknown, label: string) => T): T[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new AgentDaytimeSchemaError(`${label} must be an array`);
    return value.slice(0, max).map((entry, index) => parse(entry, `${label}[${index}]`));
  };
  result.beliefs = boundedList(obj.beliefs, "mindUpdates.beliefs", 4, parseItemUpdate);
  result.goals = boundedList(obj.goals, "mindUpdates.goals", 3, parseItemUpdate);
  result.threads = boundedList(obj.threads, "mindUpdates.threads", 6, parseThreadUpdate);
  return result;
}

export function parseAgentDaytimeReaction(raw: string): AgentDaytimeReactionEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new AgentDaytimeSchemaError("daytime reaction is not valid JSON");
  }
  const obj = stripExtraKeys(objectValue(parsed, "daytime reaction"),
    ["schemaVersion", "charaNum", "dayIndex", "baseRevision", "observationIds", "mindUpdates"]);
  if (obj.schemaVersion !== 1
    || !Number.isSafeInteger(obj.charaNum)
    || !Number.isSafeInteger(obj.dayIndex)
    || !Number.isSafeInteger(obj.baseRevision)) throw new AgentDaytimeSchemaError("daytime reaction envelope is invalid");
  const observationIds = boundedIds(obj.observationIds);
  if (observationIds.length === 0) throw new AgentDaytimeSchemaError("daytime reaction must cite evidence");
  return {
    schemaVersion: 1,
    charaNum: Number(obj.charaNum),
    dayIndex: Number(obj.dayIndex),
    baseRevision: Number(obj.baseRevision),
    observationIds,
    mindUpdates: parseMindUpdates(obj.mindUpdates),
  };
}

export function buildAgentDaytimeCompletion(input: {
  state: Readonly<GameState>;
  evidence: DaytimeEvidenceBatch;
  requestId: string;
}): AiCompletionRequest {
  const slot = input.state.charas[input.evidence.charaNum];
  const persona = compileAiCharacterSemanticContext(input.state, input.evidence.charaNum, "player");
  const mind = input.state.agentRuntime?.cognitions[input.evidence.charaNum]?.mind;
  const mindContext = daytimeMindPromptView(mind);
  const lines = input.evidence.observations.map((observation) => `[${observation.id}] ${observation.text}`);
  const exampleEvidenceId = input.evidence.observations[0]?.id ?? "本次 observation ID";
  const exampleBeliefId = mind?.beliefs.find((item) => item.status !== "resolved")?.id ?? "当前 mind 中已有 belief id";
  const exampleGoalId = mind?.goals.find((item) => item.status !== "resolved")?.id ?? "当前 mind 中已有 goal id";
  const exampleThreadId = mind?.threads.find((item) => item.status !== "resolved")?.id ?? "当前 mind 中已有 thread id";
  return {
    system: [
      "你是 eraTW 角色的白天即时认知更新器。Runtime 已经结算的事实是唯一客观边界。",
      "只根据列出的 observation ID 更新当前角色的主观理解、倾向、目标或社会线索。",
      "不要创造事件、移动、奖励、关系数值、承诺或任何 Runtime 行动；不输出对白，不写日记。",
      "必须返回严格 JSON，所有新增或修改项都必须引用本次 observationIds。",
      "mindUpdates 是补丁，不是完整 mind；只输出本次确实变化的字段。",
      "没有任何字段需要变化时，输出 mindUpdates: {}；此时 observationIds 仍必须列出本次读到的全部 observation ID，一条都不能省。",
      "beliefs/goals 每项只能有 action、id、topic、text、evidenceIds；threads 每项只能有 action、id、kind、text、evidenceIds。",
      "action 只能是 add、update、resolve 之一；beliefs/goals 的 topic 只能是 self、player、relationship 之一；threads 的 kind 只能是 promise、conflict、secret、question 之一。写出其他取值会让整批更新被拒绝。",
      "禁止在 mindUpdates 条目中输出 createdTick、updatedTick、status、observationIds、revision、version 或其他 Runtime 字段。",
    ].join("\n"),
    user: [
      `requestId: ${input.requestId}`,
      `角色: ${slot?.callName ?? `角色#${input.evidence.charaNum}`} (${input.evidence.charaNum})`,
      `dayIndex: ${input.state.time.dayIndex}`,
      `baseRevision: ${input.evidence.baseRevision}`,
      `角色设定:\n${persona.lines.join("\n")}`,
      `当前 mind（只读摘要，不要复制其字段到 mindUpdates）: ${JSON.stringify(mindContext)}`,
      `本次可用事实:\n${lines.join("\n")}`,
      `补丁条目示例（只作为格式示例，evidenceIds 必须换成本次实际 observation ID）：\n${JSON.stringify({ action: "add", topic: "player", text: "从本次事实形成的一条主观理解", evidenceIds: [exampleEvidenceId] })}\n${JSON.stringify({ action: "update", id: exampleBeliefId, text: "用新事实修正已有理解", evidenceIds: [exampleEvidenceId] })}\n${JSON.stringify({ action: "resolve", id: exampleGoalId, evidenceIds: [exampleEvidenceId] })}\n${JSON.stringify({ action: "update", id: exampleThreadId, kind: "question", text: "补充一条社会线索", evidenceIds: [exampleEvidenceId] })}`,
      `输出示例:\n${JSON.stringify({
        schemaVersion: 1,
        charaNum: input.evidence.charaNum,
        dayIndex: input.state.time.dayIndex,
        baseRevision: input.evidence.baseRevision,
        observationIds: input.evidence.observations.map((observation) => observation.id),
        mindUpdates: { beliefs: [], goals: [], threads: [] },
      })}`,
    ].join("\n\n"),
    temperature: Math.min(0.6, input.state.agentRuntime?.settings.masterEnabled ? 0.6 : 0.4),
    maxTokens: Math.min(700, input.state.agentRuntime?.settings.masterEnabled ? 700 : 400),
    jsonMode: true,
  };
}

/** Expose only the fields needed to reason about a patch target. */
function daytimeMindPromptView(mind: AgentMindStateV1 | undefined): Record<string, unknown> | null {
  if (!mind) return null;
  return {
    relationshipToPlayer: mind.relationshipToPlayer,
    currentTendency: mind.currentTendency,
    beliefs: mind.beliefs
      .filter((item) => item.status !== "resolved")
      .map(({ id, topic, text }) => ({ id, topic, text })),
    goals: mind.goals
      .filter((item) => item.status !== "resolved")
      .map(({ id, topic, text }) => ({ id, topic, text })),
    threads: mind.threads
      .filter((item) => item.status !== "resolved")
      .map(({ id, kind, text }) => ({ id, kind, text })),
  };
}

async function completeWithTimeout(
  provider: AiProvider,
  request: AiCompletionRequest,
  settings: AiSettings,
  signal: AbortSignal,
  hooks: CompletionHooks = {},
): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.max(5_000, Math.min(settings.timeoutMs, 30_000)));
  try {
    return await completeWithStateContext(provider, request, controller.signal, hooks);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Call the optional L2 daytime route. No state is mutated in this module. */
export async function requestAgentDaytimeReaction(
  input: AgentDaytimeReactionRequest,
): Promise<AgentDaytimeReactionEnvelope> {
  const provider = providerOverride ?? createOpenAiCompatibleProvider(input.settings);
  const request = buildAgentDaytimeCompletion({ state: input.state, evidence: input.evidence, requestId: input.requestId });
  const raw = await completeWithTimeout(provider, request, input.settings, input.signal, input.hooks ?? {});
  const parsed = parseAgentDaytimeReaction(raw);
  if (parsed.charaNum !== input.evidence.charaNum
    || parsed.dayIndex !== input.state.time.dayIndex
    || parsed.baseRevision !== input.evidence.baseRevision) {
    throw new Error("daytime reaction envelope is stale or mismatched");
  }
  const allowed = new Set(input.evidence.observations.map((observation) => observation.id));
  if (parsed.observationIds.some((id) => !allowed.has(id))) throw new Error("daytime reaction cited unavailable evidence");
  return parsed;
}
