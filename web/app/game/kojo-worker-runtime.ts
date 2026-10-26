import { parseKojoSource } from "../../../modernization/runtime/kojo/source-parser.js";
import type { KojoWorkerRequest, KojoWorkerResponse } from "./kojo-worker-protocol.js";

const MAX_SOURCE_CHARS = 16_000_000;

/** Worker-owned source cache: no source strings or line arrays sent to the UI. */
export function createKojoWorkerRuntime(fetchImpl: typeof fetch = fetch, maxSourceChars = MAX_SOURCE_CHARS) {
  const sources = new Map<string, { text: string; lines: string[] }>();
  const loading = new Map<string, Promise<{ text: string; lines: string[] }>>();
  let revision = -1;
  let residentChars = 0;

  return async (message: KojoWorkerRequest): Promise<KojoWorkerResponse> => {
    const { id, sourceUrl, request } = message;
    try {
      if (request.revision < revision) throw new Error("obsolete kojo compilation");
      if (request.revision > revision) {
        revision = request.revision;
        sources.clear();
        loading.clear();
        residentChars = 0;
      }
      const readStartedAt = performance.now();
      // Fingerprints come from the index generator; changes cannot reuse old text.
      const sourceKey = `${sourceUrl}:${request.location.contentFingerprint ?? ""}`;
      let source = sources.get(sourceKey);
      if (source) {
        sources.delete(sourceKey);
        sources.set(sourceKey, source);
      } else {
        let pending = loading.get(sourceKey);
        if (!pending) {
          pending = (async () => {
            const response = await fetchImpl(sourceUrl);
            if (!response.ok) throw new Error(`kojo source fetch failed (${response.status})`);
            const text = new TextDecoder("utf-8").decode(await response.arrayBuffer()).replace(/^\uFEFF/, "");
            const entry = { text, lines: text.split("\n") };
            if (request.revision === revision) {
              sources.set(sourceKey, entry);
              residentChars += text.length;
              for (const [key, old] of sources) {
                if (residentChars <= maxSourceChars) break;
                sources.delete(key);
                residentChars -= old.text.length;
              }
            }
            return entry;
          })().finally(() => {
            if (loading.get(sourceKey) === pending) loading.delete(sourceKey);
          });
          loading.set(sourceKey, pending);
        }
        source = await pending;
      }
      if (request.revision !== revision) throw new Error("obsolete kojo compilation");
      const readMs = performance.now() - readStartedAt;
      const parseStartedAt = performance.now();
      const node = parseKojoSource(request.location, request.charaNum, source, request);
      return { id, result: { node, sourceFingerprint: request.location.contentFingerprint },
        readMs, parseMs: performance.now() - parseStartedAt };
    } catch (error) {
      return { id, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
