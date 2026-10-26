import { createKojoWorkerRuntime } from "./kojo-worker-runtime.js";
import type { KojoWorkerRequest, KojoWorkerResponse } from "./kojo-worker-protocol.js";

// Use an explicit small host contract so DOM and Worker lib declarations do not clash.
const host = globalThis as unknown as {
  onmessage: ((event: MessageEvent<KojoWorkerRequest>) => void) | null;
  postMessage: (message: KojoWorkerResponse) => void;
};
const compile = createKojoWorkerRuntime();
host.onmessage = (event) => {
  void compile(event.data).then((response) => host.postMessage(response));
};
