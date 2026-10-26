import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { AiDebugEntry, AiSettings, AiTokenUsage } from "./types.js";

export const S4_EVALUATION_SCHEMA_VERSION = 1 as const;
export const S4_EVALUATION_RECORD_LIMIT = 300;

/** A bounded diagnostic label; never contains provider text or character prose. */
export type S4OutcomeCode =
  | "pending"
  | "accepted"
  | "success-empty"
  | "first-encounter"
  | "blank-window"
  | "daily-budget"
  | "duplicate-day"
  | "timeout"
  | "stale-proposal"
  | "cancelled"
  | "json-parse"
  | "schema-validation"
  | "provider-error"
  | "unknown-error";

const S4_OUTCOME_CODES = new Set<S4OutcomeCode>([
  "pending", "accepted", "success-empty", "first-encounter", "blank-window", "daily-budget", "duplicate-day",
  "timeout", "stale-proposal", "cancelled", "json-parse", "schema-validation", "provider-error", "unknown-error",
]);

export interface S4LazyEvaluationRecord {
  requestId: string;
  createdAt: number;
  gameDayIndex?: number;
  gameTick?: number;
  target?: number;
  trigger?: "encounter" | "debug";
  status: AiDebugEntry["status"];
  providerStarted: boolean;
  acceptedCount: number;
  durationMs?: number;
  queueWaitMs?: number;
  tokenUsage?: AiTokenUsage;
  experienceBytesDelta?: number;
  saveBytesDelta?: number;
  outcomeReason?: string;
  outcomeCode?: S4OutcomeCode;
}

export interface S4EvaluationReport {
  schemaVersion: typeof S4_EVALUATION_SCHEMA_VERSION;
  generatedAt: string;
  gateStatus: "awaiting-player-review";
  configuration: {
    aiEnabled: boolean;
    agentEnabled: boolean;
    lazyEnabled: boolean;
    kojoEnabled: boolean;
    fullAiKojoEnabled: boolean;
    ambientEnabled: boolean;
    storyEnabled: boolean;
    model: string;
  };
  currentSnapshot: {
    gameDayIndex?: number;
    gameTick?: number;
    acceptedExperienceCount: number;
    acceptedExperienceBytes: number;
    saveBytes: number;
  };
  summary: {
    recordedAttempts: number;
    providerRequests: number;
    cachePolicy: "none";
    cacheHits: 0;
    cacheMisses: number;
    success: number;
    skipped: number;
    errors: number;
    cancelled: number;
    pending: number;
    acceptedExperiences: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    providerUsageRecords: number;
    estimatedUsageRecords: number;
    averageDurationMs?: number;
    maxDurationMs?: number;
    experienceBytesDelta: number;
    saveBytesDelta: number;
    outcomeCodeCounts: Partial<Record<S4OutcomeCode, number>>;
  };
  byDay: Array<{
    gameDayIndex: number | null;
    attempts: number;
    providerRequests: number;
    success: number;
    skipped: number;
    errors: number;
    acceptedExperiences: number;
    totalTokens: number;
  }>;
  records: S4LazyEvaluationRecord[];
  playerReview: {
    continuityNoticeable1to5: null;
    naturalness1to5: null;
    repetition1to5: null;
    overReference1to5: null;
    interactionBlocked: null;
    notes: string;
  };
}

function boundedNonNegative(value: unknown): number | undefined {
  return Number.isFinite(value) && Number(value) >= 0 ? Math.trunc(Number(value)) : undefined;
}

function safeInteger(value: unknown): number | undefined {
  return Number.isFinite(value) ? Math.trunc(Number(value)) : undefined;
}

function sanitizeReason(entry: AiDebugEntry): string | undefined {
  if (entry.skipReason) return entry.skipReason.slice(0, 160);
  if (!entry.error) return undefined;
  const lower = entry.error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("stale")) return "stale proposal";
  if (lower.includes("cancel")) return "cancelled";
  return "provider or validation error";
}

function classifyOutcome(entry: AiDebugEntry): S4OutcomeCode {
  if (entry.status === "success") return entry.acceptedCount && entry.acceptedCount > 0 ? "accepted" : "success-empty";
  if (entry.status === "cancelled") return "cancelled";
  if (entry.status === "pending") return "pending";
  const source = `${entry.skipReason ?? ""} ${entry.error ?? ""}`.toLowerCase();
  if (entry.status === "skipped") {
    if (source.includes("first encounter")) return "first-encounter";
    if (source.includes("180 minutes") || source.includes("blank window")) return "blank-window";
    if (source.includes("budget")) return "daily-budget";
    if (source.includes("already") || source.includes("requested today")) return "duplicate-day";
  }
  if (source.includes("timeout") || source.includes("timed out")) return "timeout";
  if (source.includes("stale")) return "stale-proposal";
  if (source.includes("cancel")) return "cancelled";
  if (source.includes("not json")) return "json-parse";
  if (source.includes("lazy response") || source.includes("schema") || source.includes("envelope")
    || source.includes("experience") || source.includes("unique") || source.includes("unknown or missing")) {
    return "schema-validation";
  }
  if (entry.status === "error") return "provider-error";
  return "unknown-error";
}

function sanitizeTokenUsage(value: AiTokenUsage | undefined): AiTokenUsage | undefined {
  if (!value) return undefined;
  const promptTokens = boundedNonNegative(value.promptTokens);
  const completionTokens = boundedNonNegative(value.completionTokens);
  const totalTokens = boundedNonNegative(value.totalTokens);
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    source: value.source === "provider" ? "provider" : "estimated",
  };
}

/** Keep only S4 metrics; prompt, response, lore, API key, and raw errors are excluded. */
export function evaluationRecordFromDebug(entry: AiDebugEntry): S4LazyEvaluationRecord | null {
  if (entry.feature !== "agent-materialization") return null;
  return {
    requestId: entry.requestId.slice(0, 180),
    createdAt: boundedNonNegative(entry.createdAt) ?? Date.now(),
    gameDayIndex: boundedNonNegative(entry.gameDayIndex),
    gameTick: boundedNonNegative(entry.gameTick),
    target: boundedNonNegative(entry.target),
    trigger: entry.lazyTrigger === "encounter" || entry.lazyTrigger === "debug" ? entry.lazyTrigger : undefined,
    status: entry.status,
    providerStarted: entry.providerStarted === true,
    acceptedCount: boundedNonNegative(entry.acceptedCount) ?? 0,
    durationMs: boundedNonNegative(entry.durationMs),
    queueWaitMs: boundedNonNegative(entry.queueWaitMs),
    tokenUsage: sanitizeTokenUsage(entry.tokenUsage),
    experienceBytesDelta: safeInteger(entry.experienceBytesDelta),
    saveBytesDelta: safeInteger(entry.saveBytesDelta),
    outcomeReason: sanitizeReason(entry),
    outcomeCode: classifyOutcome(entry),
  };
}

export function upsertS4EvaluationRecord(
  existing: readonly S4LazyEvaluationRecord[],
  entry: AiDebugEntry,
): S4LazyEvaluationRecord[] {
  const record = evaluationRecordFromDebug(entry);
  if (!record) return [...existing];
  const withoutCurrent = existing.filter((candidate) => candidate.requestId !== record.requestId);
  return [...withoutCurrent, record]
    .sort((left, right) => left.createdAt - right.createdAt || left.requestId.localeCompare(right.requestId))
    .slice(-S4_EVALUATION_RECORD_LIMIT);
}

export function normalizeS4EvaluationRecords(value: unknown): S4LazyEvaluationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<S4LazyEvaluationRecord>;
    if (typeof raw.requestId !== "string" || raw.requestId.length === 0
      || !["pending", "success", "skipped", "error", "cancelled"].includes(String(raw.status))) return [];
    const debug: AiDebugEntry = {
      requestId: raw.requestId,
      createdAt: boundedNonNegative(raw.createdAt) ?? 0,
      feature: "agent-materialization",
      status: raw.status as AiDebugEntry["status"],
      gameDayIndex: raw.gameDayIndex,
      gameTick: raw.gameTick,
      target: raw.target,
      lazyTrigger: raw.trigger,
      providerStarted: raw.providerStarted,
      acceptedCount: raw.acceptedCount,
      durationMs: raw.durationMs,
      queueWaitMs: raw.queueWaitMs,
      tokenUsage: raw.tokenUsage,
      experienceBytesDelta: raw.experienceBytesDelta,
      saveBytesDelta: raw.saveBytesDelta,
      skipReason: raw.outcomeReason,
      error: raw.outcomeCode === "json-parse"
        ? "lazy response is not JSON"
        : raw.outcomeCode === "schema-validation"
          ? "lazy response schema validation failed"
          : raw.outcomeCode === "provider-error"
            ? "provider error"
            : undefined,
    };
    const normalized = evaluationRecordFromDebug(debug);
    if (!normalized) return [];
    return [S4_OUTCOME_CODES.has(String(raw.outcomeCode) as S4OutcomeCode)
      ? { ...normalized, outcomeCode: raw.outcomeCode as S4OutcomeCode }
      : normalized];
  }).slice(-S4_EVALUATION_RECORD_LIMIT);
}

export function jsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function buildS4EvaluationReport(
  state: Readonly<GameState> | undefined,
  settings: Readonly<AiSettings>,
  records: readonly S4LazyEvaluationRecord[],
  now = Date.now(),
): S4EvaluationReport {
  const durations = records.flatMap((record) => record.providerStarted && record.durationMs !== undefined
    ? [record.durationMs]
    : []);
  const usage = records.flatMap((record) => record.tokenUsage ? [record.tokenUsage] : []);
  const outcomeCodeCounts: Partial<Record<S4OutcomeCode, number>> = {};
  for (const record of records) {
    if (record.outcomeCode) outcomeCodeCounts[record.outcomeCode] = (outcomeCodeCounts[record.outcomeCode] ?? 0) + 1;
  }
  const byDay = new Map<number | null, S4EvaluationReport["byDay"][number]>();
  for (const record of records) {
    const key = record.gameDayIndex ?? null;
    const day = byDay.get(key) ?? {
      gameDayIndex: key,
      attempts: 0,
      providerRequests: 0,
      success: 0,
      skipped: 0,
      errors: 0,
      acceptedExperiences: 0,
      totalTokens: 0,
    };
    day.attempts += 1;
    day.providerRequests += record.providerStarted ? 1 : 0;
    day.success += record.status === "success" ? 1 : 0;
    day.skipped += record.status === "skipped" ? 1 : 0;
    day.errors += record.status === "error" ? 1 : 0;
    day.acceptedExperiences += record.acceptedCount;
    day.totalTokens += record.tokenUsage?.totalTokens ?? 0;
    byDay.set(key, day);
  }
  const acceptedExperiences = state?.acceptedExperiences ?? [];
  return {
    schemaVersion: S4_EVALUATION_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    gateStatus: "awaiting-player-review",
    configuration: {
      aiEnabled: settings.enabled,
      agentEnabled: state?.agentRuntime?.settings.masterEnabled === true,
      lazyEnabled: settings.lazyMaterializationEnabled,
      kojoEnabled: settings.kojoEnabled,
      fullAiKojoEnabled: settings.fullAiKojoEnabled,
      ambientEnabled: settings.ambientEnabled,
      storyEnabled: settings.storyEnabled,
      model: settings.model,
    },
    currentSnapshot: {
      gameDayIndex: state?.time.dayIndex,
      gameTick: state?.time.tickValue,
      acceptedExperienceCount: acceptedExperiences.length,
      acceptedExperienceBytes: jsonUtf8Bytes(acceptedExperiences),
      saveBytes: state ? jsonUtf8Bytes(state) : 0,
    },
    summary: {
      recordedAttempts: records.length,
      providerRequests: records.filter((record) => record.providerStarted).length,
      cachePolicy: "none",
      cacheHits: 0,
      cacheMisses: records.filter((record) => record.providerStarted).length,
      success: records.filter((record) => record.status === "success").length,
      skipped: records.filter((record) => record.status === "skipped").length,
      errors: records.filter((record) => record.status === "error").length,
      cancelled: records.filter((record) => record.status === "cancelled").length,
      pending: records.filter((record) => record.status === "pending").length,
      acceptedExperiences: records.reduce((sum, record) => sum + record.acceptedCount, 0),
      promptTokens: usage.reduce((sum, entry) => sum + entry.promptTokens, 0),
      completionTokens: usage.reduce((sum, entry) => sum + entry.completionTokens, 0),
      totalTokens: usage.reduce((sum, entry) => sum + entry.totalTokens, 0),
      providerUsageRecords: usage.filter((entry) => entry.source === "provider").length,
      estimatedUsageRecords: usage.filter((entry) => entry.source === "estimated").length,
      averageDurationMs: durations.length > 0
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
        : undefined,
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : undefined,
      experienceBytesDelta: records.reduce((sum, record) => sum + (record.experienceBytesDelta ?? 0), 0),
      saveBytesDelta: records.reduce((sum, record) => sum + (record.saveBytesDelta ?? 0), 0),
      outcomeCodeCounts,
    },
    byDay: [...byDay.values()].sort((left, right) => (left.gameDayIndex ?? -1) - (right.gameDayIndex ?? -1)),
    records: records.map((record) => ({ ...record, tokenUsage: record.tokenUsage ? { ...record.tokenUsage } : undefined })),
    playerReview: {
      continuityNoticeable1to5: null,
      naturalness1to5: null,
      repetition1to5: null,
      overReference1to5: null,
      interactionBlocked: null,
      notes: "",
    },
  };
}

export function serializeS4EvaluationReport(report: S4EvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
