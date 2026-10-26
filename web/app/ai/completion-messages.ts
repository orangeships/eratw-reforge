import type { AiCompletionRequest } from "./types.js";

/** Materialize from current strings: owners may append a bounded grant or a
 * permitted state-query result after context compilation. */
export function completionMessages(request: Pick<AiCompletionRequest, "system" | "user" | "contextMessages">) {
  return [
    { role: "system" as const, content: request.system },
    ...(request.contextMessages ?? []).map(message => ({ ...message })),
    { role: "user" as const, content: request.user },
  ];
}

export function formatCompletionPrompt(request: Pick<AiCompletionRequest, "system" | "user" | "contextMessages">): string {
  if (!request.contextMessages?.length) return `${request.system}\n\n${request.user}`;
  return completionMessages(request).map(message => `[${message.role}]\n${message.content}`).join("\n\n");
}
