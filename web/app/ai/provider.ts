import type {
  AiCompletionRequest,
  AiProvider,
  AiSettings,
  AiTokenUsage,
} from "./types.js";
import { hasTauriRuntime } from "../ipc/tauri-bridge.js";
import { requestAiHttp } from "../ipc/tauri-ai-bridge.js";
import { completionMessages } from "./completion-messages.js";

interface OpenAiCompatibleUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
  usage?: OpenAiCompatibleUsage;
}

interface OpenAiCompatibleModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

interface OpenAiCompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
      /** DeepSeek-compatible reasoning payload. It is intentionally not
       * forwarded into the structured dialogue response. */
      reasoning_content?: string;
    };
    message?: { content?: string | Array<{ type?: string; text?: string }> };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
  usage?: OpenAiCompatibleUsage;
}

/**
 * Agent Plan intentionally does not expose OpenAI's GET /models endpoint.
 * Keep a small, editable-in-code fallback for the settings picker; the
 * current settings.model is still merged into the picker by the UI so a
 * provider-specific value is never discarded.
 */
export const ARK_AGENT_PLAN_MODELS = [
  "doubao-seed-2.0-lite",
  "doubao-seed-2.0-mini",
  "kimi-k3",
] as const;

const ARK_AGENT_PLAN_HOST = "ark.cn-beijing.volces.com";

/** Recognizes the versioned Agent Plan base, with or without a chat suffix. */
export function isArkAgentPlanBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/chat/completions")) {
      path = path.slice(0, -"/chat/completions".length);
    }
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === ARK_AGENT_PLAN_HOST
      && path === "/api/plan/v3";
  } catch {
    return false;
  }
}

function safeTokenCount(value: unknown): number | undefined {
  return Number.isFinite(value) && Number(value) >= 0 ? Math.trunc(Number(value)) : undefined;
}

function providerTokenUsage(value: OpenAiCompatibleUsage | undefined): AiTokenUsage | undefined {
  if (!value) return undefined;
  const promptTokens = safeTokenCount(value.prompt_tokens ?? value.input_tokens);
  const completionTokens = safeTokenCount(value.completion_tokens ?? value.output_tokens);
  const totalTokens = safeTokenCount(value.total_tokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined;
  const prompt = promptTokens ?? Math.max(0, (totalTokens ?? 0) - (completionTokens ?? 0));
  const completion = completionTokens ?? Math.max(0, (totalTokens ?? 0) - prompt);
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: totalTokens ?? prompt + completion,
    source: "provider",
  };
}

function estimateTokenCount(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x3400 && code <= 0x9fff)
      || (code >= 0x3040 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateAiTokenUsage(
  request: Pick<AiCompletionRequest, "system" | "user" | "contextMessages">,
  response: string,
): AiTokenUsage {
  const promptTokens = estimateTokenCount(completionMessages(request).map(message => message.content).join("\n"));
  const completionTokens = estimateTokenCount(response);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: "estimated",
  };
}

function completionUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return `${trimmed.slice(0, -"/chat/completions".length)}/models`;
  }
  return trimmed.endsWith("/models") ? trimmed : `${trimmed}/models`;
}

function authorizationHeaders(apiKey: string): Record<string, string> {
  return apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("AI request cancelled");
}

/**
 * Browser fetch is retained for ordinary web-compatible providers. Tauri
 * uses the native command so API keys and Authorization headers do not have
 * to pass through the WebView's CORS policy.
 */
export async function providerResponse(
  settings: Pick<AiSettings, "baseUrl" | "apiKey">,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  if (!hasTauriRuntime()) {
    try {
      return await fetch(url, { ...init, signal });
    } catch (error) {
      if (
        isArkAgentPlanBaseUrl(settings.baseUrl)
        && (error instanceof TypeError
          || (error instanceof Error && /failed to fetch|networkerror/i.test(error.message)))
      ) {
        throw new Error("Agent Plan 浏览器直连被 CORS 拦截，请使用 Tauri 桌面版或配置同源代理");
      }
      throw error;
    }
  }

  throwIfAborted(signal);
  const body = init.body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    throw new Error("AI request body must be a JSON string");
  }
  const nativeResponse = await requestAiHttp({
    url,
    method: String(init.method ?? "GET"),
    apiKey: settings.apiKey,
    body: body == null ? undefined : body,
  });
  throwIfAborted(signal);
  return new Response(nativeResponse.body, {
    status: nativeResponse.status,
    headers: nativeResponse.contentType ? { "Content-Type": nativeResponse.contentType } : undefined,
  });
}

/** Reads OpenAI-compatible GET /models results for the settings picker. */
export async function listOpenAiCompatibleModels(
  settings: Pick<AiSettings, "baseUrl" | "apiKey">,
  signal?: AbortSignal,
): Promise<string[]> {
  if (isArkAgentPlanBaseUrl(settings.baseUrl)) {
    throwIfAborted(signal);
    return [...ARK_AGENT_PLAN_MODELS].sort((left, right) => left.localeCompare(right));
  }
  const response = await providerResponse(settings, modelsUrl(settings.baseUrl), {
    headers: authorizationHeaders(settings.apiKey),
  }, signal);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as OpenAiCompatibleModelsResponse;
    throw new Error(body.error?.message || `Model endpoint returned HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => ({})) as OpenAiCompatibleModelsResponse;
  return [...new Set((body.data ?? [])
    .map((model) => model.id?.trim() ?? "")
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function contentText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === undefined || part.type === "text")
    .map((part) => part?.text ?? "")
    .join("");
}

async function readEventStream(
  response: Response,
  signal: AbortSignal,
  request: AiCompletionRequest,
  onPartial?: (accumulated: string) => void,
  onUsage?: (usage: AiTokenUsage) => void,
): Promise<string> {
  if (!response.body) throw new Error("AI endpoint returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let reasoningOutput = "";
  let finishReason: string | null | undefined;
  let usage: OpenAiCompatibleUsage | undefined;

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: OpenAiCompatibleStreamChunk;
    try {
      chunk = JSON.parse(data) as OpenAiCompatibleStreamChunk;
    } catch {
      return; // Wait for a complete SSE data line or ignore provider keepalives.
    }
    if (chunk.error?.message) throw new Error(chunk.error.message);
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    finishReason = choice?.finish_reason ?? finishReason;
    reasoningOutput += contentText(choice?.delta?.reasoning_content);
    const delta = contentText(choice?.delta?.content ?? choice?.message?.content);
    if (!delta) return;
    output += delta;
    onPartial?.(output);
  };

  while (true) {
    if (signal.aborted) throw new Error("AI request cancelled");
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!output.trim()) {
    if (reasoningOutput.trim()) {
      throw new Error("AI response contained only reasoning_content; no final content was emitted (the model spent the whole completion budget on hidden reasoning — raise max_tokens, lower reasoning effort, or switch to a model with thinking disabled)");
    }
    if (finishReason === "length") {
      throw new Error("AI response reached its token limit before emitting final content");
    }
    throw new Error("AI endpoint returned an empty response");
  }
  onUsage?.(providerTokenUsage(usage) ?? estimateAiTokenUsage(request, output));
  return output;
}

/** kimi-k3 always reasons: the K2.x `thinking:{type:"disabled"}` flag is
 *  documented as invalid for K3 ("do not send a thinking parameter"), so the
 *  only lever is a top-level `reasoning_effort` restricted to low/high/max.
 *  K3 cannot honor `off`; map it to the lowest supported effort. */
const KIMI_K3_REASONING_EFFORT = {
  off: "low",
  low: "low",
  medium: "high",
  high: "max",
} as const;

export function createOpenAiCompatibleProvider(settings: AiSettings): AiProvider {
  return {
    async complete(request, signal, onPartial, onUsage) {
      const isKimiK3 = /kimi[-_\s]*k3/i.test(settings.model);
      const isDeepSeek = /deepseek/i.test(settings.model);
      const isGemini3 = /gemini[-_\s]*3(?:[._-]\d+)?/i.test(settings.model);
      // DeepSeek exposes low/high/max effort values and a separate flag for
      // disabling thinking. Keep the UI's four steps distinct: `off` uses the
      // flag, while low/medium/high map onto low/high/max respectively.
      const deepseekThinking = isDeepSeek
        ? (settings.reasoningEffort === "off"
          ? { thinking: { type: "disabled" } as const }
          : {
            thinking: { type: "enabled" } as const,
            reasoning_effort: settings.reasoningEffort === "high"
              ? "max"
              : settings.reasoningEffort === "medium"
                ? "high"
                : "low",
          })
        : {};
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authorizationHeaders(settings.apiKey),
      };
      const response = await providerResponse(settings, completionUrl(settings.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: settings.model.trim(),
          messages: completionMessages(request),
          temperature: request.temperature,
          // DeepSeek-compatible reasoning models otherwise spend the small
          // kojo budget in hidden reasoning and omit the final JSON entirely.
          // kimi-k3 reasons unconditionally and its reasoning stream also
          // consumes max_tokens, so it needs an even larger completion budget.
          max_tokens: isDeepSeek
            ? Math.max(settings.reasoningEffort === "off" ? 512 : 1024, request.maxTokens)
            : isKimiK3
              ? Math.max(1024, request.maxTokens)
              : request.maxTokens,
          ...deepseekThinking,
          ...(isKimiK3
            ? { reasoning_effort: KIMI_K3_REASONING_EFFORT[settings.reasoningEffort] }
            : {}),
          // Gemini 3's OpenAI-compatible API maps the standard effort values
          // directly onto its thinking levels. UU exposes the same contract.
          ...(isGemini3 && settings.reasoningEffort !== "off"
            ? { reasoning_effort: settings.reasoningEffort }
            : {}),
          // MiniMax M3 supports `thinking:{type:"disabled"}` so the small kojo
          // budget stays available for the JSON reply. The M2.x family ignores
          // this flag (thinking is mandatory there) and burns the budget on a
          // <think> block, so the shipped default is M3.
          ...(/minimax[-_\s]*m3/i.test(settings.model)
            ? { thinking: { type: "disabled" } }
            : {}),
          ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
          stream: true,
        }),
      }, signal);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as OpenAiCompatibleResponse;
        throw new Error(body.error?.message || `AI endpoint returned HTTP ${response.status}`);
      }
      if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
        return readEventStream(response, signal, request, onPartial, onUsage);
      }
      const body = await response.json().catch(() => ({})) as OpenAiCompatibleResponse;
      const choice = body.choices?.[0];
      const content = contentText(choice?.message?.content);
      if (!content.trim()) {
        if (contentText(choice?.message?.reasoning_content).trim()) {
          throw new Error("AI response contained only reasoning_content; no final content was emitted (the model spent the whole completion budget on hidden reasoning — raise max_tokens, lower reasoning effort, or switch to a model with thinking disabled)");
        }
        if (choice?.finish_reason === "length") {
          throw new Error("AI response reached its token limit before emitting final content");
        }
        throw new Error("AI endpoint returned an empty response");
      }
      onPartial?.(content);
      onUsage?.(providerTokenUsage(body.usage) ?? estimateAiTokenUsage(request, content));
      return content;
    },
  };
}
