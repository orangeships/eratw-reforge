import type { AiCompletionRequest, AiProvider } from "./types.js";
import { completeWithStateContext, type CompletionHooks } from "./state-context.js";

export const NARRATIVE_COMPLETION_TIMEOUT_MS = 180_000;

/** Bound a whole L3 phase, including its optional state query and non-abortable native I/O. */
export async function completeNarrativeWithDeadline(
  provider: AiProvider, request: AiCompletionRequest, signal: AbortSignal,
  hooks: CompletionHooks = {}, timeoutMs = NARRATIVE_COMPLETION_TIMEOUT_MS,
): Promise<string> {
  if (signal.aborted) throw new DOMException("narrative request cancelled", "AbortError");
  const controller = new AbortController();
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancelled(new DOMException("narrative request cancelled", "AbortError"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectCancelled(new Error(`L3 当前阶段等待超过 ${timeoutMs / 1000} 秒，已停止；本阶段结果未提交，可重试。`));
  }, timeoutMs);
  const guarded: CompletionHooks = {
    onPartial: raw => { if (!controller.signal.aborted) hooks.onPartial?.(raw); },
    onUsage: usage => { if (!controller.signal.aborted) hooks.onUsage?.(usage); },
    onMetrics: metrics => { if (!controller.signal.aborted) hooks.onMetrics?.(metrics); },
    onExchange: exchange => { if (!controller.signal.aborted) hooks.onExchange?.(exchange); },
  };
  try {
    return await Promise.race([completeWithStateContext(provider, request, controller.signal, guarded), cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
