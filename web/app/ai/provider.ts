import type { AiProvider, AiSettings } from "./types.js";

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
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

/** Reads OpenAI-compatible GET /models results for the settings picker. */
export async function listOpenAiCompatibleModels(
  settings: Pick<AiSettings, "baseUrl" | "apiKey">,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(modelsUrl(settings.baseUrl), {
    headers: authorizationHeaders(settings.apiKey),
    signal,
  });
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
  onPartial?: (accumulated: string) => void,
): Promise<string> {
  if (!response.body) throw new Error("AI endpoint returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let reasoningOutput = "";
  let finishReason: string | null | undefined;

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
      throw new Error("AI response contained only reasoning_content; no final content was emitted");
    }
    if (finishReason === "length") {
      throw new Error("AI response reached its token limit before emitting final content");
    }
    throw new Error("AI endpoint returned an empty response");
  }
  return output;
}

export function createOpenAiCompatibleProvider(settings: AiSettings): AiProvider {
  return {
    async complete(request, signal, onPartial) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authorizationHeaders(settings.apiKey),
      };
      const response = await fetch(completionUrl(settings.baseUrl), {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          model: settings.model.trim(),
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: request.temperature,
          // DeepSeek-compatible reasoning models otherwise spend the small
          // kojo budget in hidden reasoning and omit the final JSON entirely.
          max_tokens: /deepseek/i.test(settings.model)
            ? Math.max(512, request.maxTokens)
            : request.maxTokens,
          ...(/deepseek/i.test(settings.model)
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
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as OpenAiCompatibleResponse;
        throw new Error(body.error?.message || `AI endpoint returned HTTP ${response.status}`);
      }
      if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
        return readEventStream(response, signal, onPartial);
      }
      const body = await response.json().catch(() => ({})) as OpenAiCompatibleResponse;
      const choice = body.choices?.[0];
      const content = contentText(choice?.message?.content);
      if (!content.trim()) {
        if (contentText(choice?.message?.reasoning_content).trim()) {
          throw new Error("AI response contained only reasoning_content; no final content was emitted");
        }
        if (choice?.finish_reason === "length") {
          throw new Error("AI response reached its token limit before emitting final content");
        }
        throw new Error("AI endpoint returned an empty response");
      }
      onPartial?.(content);
      return content;
    },
  };
}
