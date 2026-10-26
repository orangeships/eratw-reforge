import { resolveStateContext, type StateContextInput, type StateFact } from "../../../modernization/runtime/ai-state/context.js";
import type { AiCompletionRequest, AiProvider, AiTokenUsage } from "./types.js";
import { jsonBody } from "./response-validator.js";
import { formatCompletionPrompt } from "./completion-messages.js";

type PromptStateFact = StateFact | Pick<StateFact, "id" | "subject" | "label" | "value">;

/** L1 receives only fact content that can affect the line being written.
 * Freshness, classification, and visibility remain Runtime-side diagnostics;
 * resolveStateContext() has already enforced visibility, and a null value
 * still represents an unknown fact. */
function promptFacts(facts: readonly StateFact[], route: StateContextInput["route"]): PromptStateFact[] {
  if (route !== "l1") return [...facts];
  return facts.map(({ id, subject, label, value }) => ({ id, subject, label, value }));
}

export const STATE_CONTEXT_GUIDANCE = "semantic_state 是按角色可见性筛选的当前事实；unknown 表示未知。数值经验不证明具体往事，当前值不证明过去状态。事实是可选素材，不必逐项复述；director 信息不能转成角色知识。";

/** Freeze only small permitted projections. Never capture mutable state in a deferred query. */
export function attachStateContext(request: AiCompletionRequest, input: StateContextInput, allowQuery = false): AiCompletionRequest {
  const initial = resolveStateContext(input);
  const initialPromptFacts = promptFacts(initial.facts, input.route);
  const answers = allowQuery
    ? new Map<string, PromptStateFact[]>(initial.topics.map((t): [string, PromptStateFact[]] =>
      // 补查是一笔专门的一跳，预算用**该层默认值**，绝不继承调用方为「不预载」
      // 而设的 `maxFacts: 0` —— 否则补查答案会被同一个 0 清空，模型收到
      // `{facts: [], status: "available"}`，比 unavailable 更容易被误读成
      // 「世界里没有这条信息」。（L1 自由对话曾同时踩到；L1 已于 2026-09-11
      // 撤下补查，这条是防止重新武装时再次踩到。）
      [t.id, promptFacts(resolveStateContext({ ...input, cue: "", topics: [t.id], maxFacts: undefined }).facts, input.route)]))
    : new Map<string, PromptStateFact[]>();
  let user = initialPromptFacts.length > 0
    ? `${request.user}\nsemantic_state: ${JSON.stringify(initialPromptFacts)}`
    : request.user;
  const start = request.user.indexOf("{");
  if (start >= 0) {
    try {
      const doc = JSON.parse(request.user.slice(start));
      if (doc && typeof doc === "object" && !Array.isArray(doc) && initialPromptFacts.length > 0) {
        user = request.user.slice(0, start) + JSON.stringify({ ...doc, semantic_state: initialPromptFacts }, null, 1);
      }
    } catch { /* Non-document routes use a labeled appendix. */ }
  }
  return {
    ...request,
    system: `${request.system}\n${STATE_CONTEXT_GUIDANCE}${allowQuery ? '\n如确实缺少必要状态，可只输出 {"need_context":["主题ID"]}（最多三个），不同时输出台词或写入；仅允许一次补查。主题：' + JSON.stringify(initial.topics) : ""}`,
    user,
    stateContext: { canQuery: allowQuery, topics: initial.topics, trace: initial.trace, durationMs: initial.durationMs,
      query: topics => {
        let remaining = input.route === "l1" ? 2400 : input.route === "l2" ? 4800 : 7200;
        const seen = new Set<string>();
        return topics.map(id => ({ topic: id, facts: (answers.get(id) ?? []).filter(f => {
          const size = JSON.stringify(f).length + 1;
          if (seen.has(f.id) || size > remaining) return false;
          seen.add(f.id); remaining -= size; return true;
        }), status: answers.has(id) ? "available" : "unavailable" }));
      } },
  };
}

/** One provider round-trip as actually sent and received. Recorded for the
 * debug panel so every route's exchange is inspectable, not just L1 kojo. */
export interface CompletionExchange {
  prompt: string;
  response: string;
}

export interface CompletionHooks {
  onPartial?: (raw: string) => void;
  onUsage?: (usage: AiTokenUsage) => void;
  onMetrics?: (metrics: Record<string, number>) => void;
  /** Called once per provider hop (the `need_context` follow-up is a second
   * hop and is reported separately, so the query route stays visible). */
  onExchange?: (exchange: CompletionExchange) => void;
}

/** Generic one-hop protocol for providers without tool calling; caller owns total timeout. */
export async function completeWithStateContext(provider: AiProvider, request: AiCompletionRequest, signal: AbortSignal,
  hooks: CompletionHooks = {}): Promise<string> {
  const { onPartial, onUsage, onMetrics, onExchange } = hooks;
  const exchange = (sent: AiCompletionRequest, response: string): void => {
    onExchange?.({ prompt: formatCompletionPrompt(sent), response });
  };
  const started = performance.now();
  let firstTokenMs: number | undefined;
  const partial = (raw: string) => { firstTokenMs ??= performance.now() - started; onPartial?.(raw); };
  let raw = await provider.complete(request, signal, partial, onUsage);
  if (signal.aborted) throw new Error("AI request cancelled");
  if (raw.length > 64000) throw new Error("AI response exceeds size budget");
  exchange(request, raw);
  let parsed: unknown;
  // Only inspect a query-shaped response; final response is decoded by its existing validator.
  if (/"need_context"\s*:/.test(raw)) {
    try { parsed = JSON.parse(jsonBody(raw)); } catch { throw new Error("Invalid state query JSON"); }
  }
  let calls = 1;
  if (parsed && typeof parsed === "object" && "need_context" in parsed) {
    const topics = (parsed as { need_context: unknown }).need_context;
    if (!request.stateContext?.canQuery || Object.keys(parsed).length !== 1
      || !Array.isArray(topics) || topics.length < 1 || topics.length > 3
      || topics.some(t => typeof t !== "string" || !request.stateContext!.topics.some(a => a.id === t))) throw new Error("State query is not permitted");
    const extra = JSON.stringify(request.stateContext.query([...new Set(topics)]));
    const followUp: AiCompletionRequest = { ...request, system: `${request.system}\n补查已用完，现在必须输出最终答案；不得再次请求补查。`,
      user: `${request.user}\nstate_query_result: ${extra}` };
    raw = await provider.complete(followUp, signal, partial, onUsage);
    calls++;
    if (signal.aborted || raw.length > 64000 || /"need_context"\s*:/.test(raw)) throw new Error("State query budget exhausted or cancelled");
    exchange(followUp, raw);
  }
  onMetrics?.({ providerMs: performance.now() - started, firstTokenMs: firstTokenMs ?? performance.now() - started, providerCalls: calls });
  return raw;
}
