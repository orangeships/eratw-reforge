/**
 * 命令全链路计时（AI-STATE-CONTEXT-MANAGER-DESIGN.md §9 切片 1 的
 * "点击 → 口上出现" 段，此前只有 AI 请求内有分段、结算段是盲区）。
 *
 * 环形记录保存在模块内而非 zustand：每次命令只写一条，面板打开时按秒
 * 轮询读取，避免 store churn。所有聚合都是纯函数，便于测试。
 */

import { kojoPerformanceTotals, type KojoPerformanceTotals } from "../../../modernization/runtime/kojo/performance.js";

export interface RuntimeCommandTimings {
  runtimeMs: number;
  kojo: KojoPerformanceTotals;
}

export interface AiSegmentTimings {
  preparationMs: number;
  stateContextMs: number;
  firstTokenMs: number;
  providerMs: number;
  parseMs: number;
  providerCalls: number;
}

export type CommandRoute = "authored" | "ai";

export interface CommandTimingRecord {
  id: number;
  commandNo: number;
  target?: number;
  route: CommandRoute;
  startedAt: number;
  /** 点击 → 确定性结算与口上解析完成（authored 口上的出现点）。 */
  settleMs: number;
  /** AI 语气样例采集 + prompt 组装（authored 路径为 0）。 */
  prepareMs: number;
  ai: AiSegmentTimings | null;
  /** 点击 → 口上最终出现（AI 路径含网络等待与流式完成）。 */
  totalMs: number;
  outcome: "success" | "error";
  /** Synchronous Runtime window. Resolve and clone are nested, not additive. */
  runtime?: RuntimeCommandTimings;
}

export interface CommandTimingHandle {
  markRuntimeStarted(): void;
  markRuntimeFinished(): void;
  markSettled(): void;
  markPrepared(): void;
  finish(route: CommandRoute, ai?: AiSegmentTimings): void;
  fail(route: CommandRoute): void;
}

const COMMAND_TIMING_LIMIT = 40;
const records: CommandTimingRecord[] = [];
let serial = 0;

/** 未走完（提前 return 的弹窗/委托路径）的计时直接丢弃，不进入记录。 */
export function beginCommandTiming(commandNo: number, target?: number): CommandTimingHandle {
  const startedAt = performance.now();
  let settledMs = 0;
  let preparedMs = 0;
  let done = false;
  let runtimeStartedAt = 0;
  let before: KojoPerformanceTotals | null = null;
  let runtime: RuntimeCommandTimings | undefined;
  return {
    markRuntimeStarted() {
      runtimeStartedAt = performance.now();
      before = kojoPerformanceTotals();
    },
    markRuntimeFinished() {
      if (!before || runtime) return;
      const after = kojoPerformanceTotals();
      runtime = { runtimeMs: performance.now() - runtimeStartedAt, kojo: {
        read: after.read - before.read, parse: after.parse - before.parse,
        resolve: after.resolve - before.resolve, clone: after.clone - before.clone,
      } };
    },
    markSettled() {
      if (!settledMs) settledMs = performance.now() - startedAt;
    },
    markPrepared() {
      if (!preparedMs) preparedMs = performance.now() - startedAt;
    },
    finish(route, ai) {
      if (done) return;
      done = true;
      push({
        id: ++serial,
        commandNo,
        target,
        route,
        startedAt,
        settleMs: settledMs,
        prepareMs: Math.max(0, preparedMs - settledMs),
        ai: ai ?? null,
        totalMs: performance.now() - startedAt,
        outcome: "success",
        runtime,
      });
    },
    fail(route) {
      if (done) return;
      done = true;
      push({
        id: ++serial,
        commandNo,
        target,
        route,
        startedAt,
        settleMs: settledMs,
        prepareMs: Math.max(0, preparedMs - settledMs),
        ai: null,
        totalMs: performance.now() - startedAt,
        outcome: "error",
        runtime,
      });
    },
  };
}

function push(record: CommandTimingRecord): void {
  records.unshift(record);
  if (records.length > COMMAND_TIMING_LIMIT) records.length = COMMAND_TIMING_LIMIT;
}

export function commandTimingRecords(): readonly CommandTimingRecord[] {
  return records;
}

export function resetCommandTimingsForTests(): void {
  records.length = 0;
  serial = 0;
}

export interface CommandTimingCounts {
  total: number;
  ai: number;
  authored: number;
  errors: number;
}

export function commandTimingCounts(
  list: readonly CommandTimingRecord[] = records,
): CommandTimingCounts {
  return {
    total: list.length,
    ai: list.filter((record) => record.outcome === "success" && record.route === "ai").length,
    authored: list.filter((record) => record.outcome === "success" && record.route === "authored").length,
    errors: list.filter((record) => record.outcome === "error").length,
  };
}
