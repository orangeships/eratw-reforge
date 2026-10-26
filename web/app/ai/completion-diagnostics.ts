import type { CompletionExchange } from "./state-context.js";
import { useAiStore } from "./store.js";

/** Truncation points for the debug panel. Diagnostics are for inspecting
 * structure and contract, not for archiving full text: an untruncated L3
 * exchange can reach ~100 KB per entry, and DEBUG_LIMIT (30) entries would
 * then pin megabytes in memory. */
const MAX_PROMPT_CHARS = 8_000;
const MAX_RESPONSE_CHARS = 16_000;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[截断，共 ${text.length} 字符]`;
}

/**
 * Record every provider exchange of one request into its debug entry.
 *
 * `patchDebugEntry` is a static patch (no updater form), so each exchange must
 * read the current entry first and append — which also makes multiple hops
 * accumulate naturally under the same requestId (stage B can run two hops).
 */
export function recordCompletionExchanges(requestId: string): {
  onExchange: (exchange: CompletionExchange) => void;
} {
  return {
    onExchange(exchange: CompletionExchange): void {
      const store = useAiStore.getState();
      const existing = store.debugEntries.find((entry) => entry.requestId === requestId);
      const prompt = existing?.prompt ?? truncate(exchange.prompt, MAX_PROMPT_CHARS);
      const previousResponse = existing?.response
        ? `${existing.response}\n\n--- RESPONSE ---\n`
        : "";
      store.patchDebugEntry(requestId, {
        prompt,
        response: `${previousResponse}${truncate(exchange.response, MAX_RESPONSE_CHARS)}`,
      });
    },
  };
}
