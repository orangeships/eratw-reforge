import type { KojoAsyncParser, KojoParseResult } from "../../../modernization/runtime/kojo/async-parser.js";
import type { KojoWorkerRequest, KojoWorkerResponse } from "./kojo-worker-protocol.js";

export interface KojoWorkerPort {
  postMessage: (message: KojoWorkerRequest) => void;
  onmessage: ((event: MessageEvent<KojoWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate: () => void;
}

export interface KojoWorkerTiming {
  filePath: string;
  readMs: number;
  parseMs: number;
  roundTripMs: number;
}
const timings: KojoWorkerTiming[] = [];
export function kojoWorkerTimings(): readonly KojoWorkerTiming[] { return timings; }

export function createKojoWorkerClient(
  sourceUrl: (filePath: string) => string,
  createWorker: () => KojoWorkerPort = () => new Worker(new URL("./kojo-parser.worker.ts", import.meta.url), { type: "module" }),
  timeoutMs = 30_000,
): { parse: KojoAsyncParser; dispose: () => void } {
  let worker: KojoWorkerPort | null = null;
  let serial = 0;
  let closed = false;
  const pending = new Map<number, {
    resolve: (result: KojoParseResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    filePath: string;
    startedAt: number;
  }>();
  const stopWorker = (): void => {
    worker?.terminate();
    worker = null;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("kojo background compiler stopped"));
    }
    pending.clear();
  };
  const dispose = (): void => {
    closed = true;
    stopWorker();
  };
  const parse: KojoAsyncParser = (request) => {
    if (closed) return Promise.reject(new Error("kojo background compiler unavailable"));
    if (!worker) {
      try {
        worker = createWorker();
        const activeWorker = worker;
        worker.onmessage = ({ data }) => {
          const item = pending.get(data.id);
          if (!item) return;
          pending.delete(data.id);
          clearTimeout(item.timer);
          if ("error" in data) item.reject(new Error(data.error));
          else {
            timings.unshift({ filePath: item.filePath, readMs: data.readMs, parseMs: data.parseMs,
              roundTripMs: performance.now() - item.startedAt });
            if (timings.length > 40) timings.length = 40;
            item.resolve(data.result);
          }
        };
        worker.onerror = () => { if (worker === activeWorker) stopWorker(); };
        worker.onmessageerror = () => { if (worker === activeWorker) stopWorker(); };
      } catch (error) {
        stopWorker();
        return Promise.reject(error);
      }
    }
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(stopWorker, timeoutMs);
      pending.set(id, { resolve, reject, timer, filePath: request.location.filePath, startedAt: performance.now() });
      try {
        worker!.postMessage({ id, sourceUrl: sourceUrl(request.location.filePath), request });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  };
  return { parse, dispose };
}
