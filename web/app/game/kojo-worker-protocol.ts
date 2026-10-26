import type { KojoParseRequest, KojoParseResult } from "../../../modernization/runtime/kojo/async-parser.js";

export interface KojoWorkerRequest {
  id: number;
  sourceUrl: string;
  request: KojoParseRequest;
}

export type KojoWorkerResponse = { id: number } & (
  | { result: KojoParseResult; readMs: number; parseMs: number }
  | { error: string }
);
