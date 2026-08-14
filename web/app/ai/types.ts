import type { ObservationEvent } from "../../../modernization/schemas/types.js";

export interface AiSettings {
  /** Master switch for every optional AI presentation feature. */
  enabled: boolean;
  /** AI-generated dialogue for otherwise silent everyday kojo routes. */
  kojoEnabled: boolean;
  /** Which command families AI is allowed to complete. */
  kojoFamilies: string[];
  /** AI-authored connective prose for the deterministic radio forecast. */
  radioEnabled: boolean;
  /** Kept low for DeepSeek-compatible reasoning models so final JSON has room. */
  reasoningEffort: "low" | "medium" | "high";
  /** M3 opt-in: fill silent authored routes whose resolver status is exactly
   *  unsupported. Gated/partial routes remain ineligible. */
  allowUnsupportedAuthored: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  characterProfiles: Record<string, AiCharacterProfile>;
}

export interface AiCharacterProfile {
  /** Per-character child switch under the global AI switch. */
  enabled: boolean;
  /** User-maintained canon/personality notes (e.g. pasted from a wiki). */
  lore: string;
  /** Voice, wording, address and out-of-character prohibitions. */
  styleGuide: string;
  /** Short generated seed for a dynamic character's ordinary dialogue. */
  generatedPersona?: string;
  /** Provenance of the generated persona; fallback is deterministic/local. */
  generatedPersonaSource?: "ai" | "fallback";
  /** Dynamic-character identity guard so reused ids cannot inherit old text. */
  generatedPersonaKey?: string;
}

export interface AiCompletionRequest {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  /** Request provider-level JSON enforcement for structured kojo output. */
  jsonMode?: boolean;
}

export interface AiProvider {
  /** `onPartial` receives the accumulated assistant content while an SSE
   *  response is arriving. Providers without streaming may omit callbacks. */
  complete(
    request: AiCompletionRequest,
    signal: AbortSignal,
    onPartial?: (accumulated: string) => void,
  ): Promise<string>;
}

export interface AiGeneratedLine {
  text: string;
  form: "PRINTFORML" | "PRINTFORMDL";
}

/** The route provenance recorded for an AI completion. */
export type AiRouteStatus = "not-authored" | "unsupported" | "authored-empty";

export interface AiCommandHistoryEntry {
  id: string;
  target: number;
  targetName: string;
  commandNo: number;
  commandLabel: string;
  timestamp: number;
  location: string;
  outcome: "ok" | "blocked" | "noop";
  visibleEvents: string[];
  aiLines: string[];
}

export interface AiDebugEntry {
  requestId: string;
  createdAt: number;
  target: number;
  commandNo: number;
  routeStatus?: AiRouteStatus;
  status: "pending" | "success" | "error" | "cancelled";
  durationMs?: number;
  prompt?: string;
  response?: string;
  error?: string;
}

export interface PreparedAiKojoRequest {
  requestId: string;
  sessionId: string;
  target: number;
  commandNo: number;
  routeStatus: AiRouteStatus;
  historyEntryId: string;
  completion: AiCompletionRequest;
  settings: AiSettings;
}

export type AiDialogueEvent = Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>;
