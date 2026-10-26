import type { KojoParseOptions } from "./source-parser.js";
import type { FuncLocation, KojoNode } from "./types.js";

/** Serializable compilation request. Gameplay state never crosses this boundary. */
export interface KojoParseRequest extends KojoParseOptions {
  location: FuncLocation;
  charaNum: number;
  revision: number;
}

export interface KojoParseResult {
  node: KojoNode | null;
  sourceFingerprint?: string;
}

export type KojoAsyncParser = (
  request: KojoParseRequest,
  signal?: AbortSignal,
) => Promise<KojoParseResult>;
