import { invoke } from "@tauri-apps/api/core";

/** Response envelope returned by the native AI HTTP adapter. */
export interface TauriAiHttpResponse {
  status: number;
  contentType: string | null;
  body: string;
}

export interface TauriAiHttpRequest {
  url: string;
  method: string;
  apiKey: string;
  body?: string;
}

/** Send a user-selected OpenAI-compatible request outside the WebView CORS path. */
export async function requestAiHttp(
  request: TauriAiHttpRequest,
): Promise<TauriAiHttpResponse> {
  return await invoke<TauriAiHttpResponse>("ai_http_request", {
    request: {
      url: request.url,
      method: request.method,
      apiKey: request.apiKey,
      body: request.body ?? null,
    },
  });
}
