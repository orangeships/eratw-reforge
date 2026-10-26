import type { CommandTimingRecord } from "./command-perf.js";

/** 单次请求/命令的分段视图（AI-STATE-CONTEXT-MANAGER-DESIGN.md §9）。
 *  只做单次呈现，不做平均聚合。 */
export const AI_PERF_SEGMENTS = [
  "preparationMs",
  "stateContextMs",
  "firstTokenMs",
  "providerMs",
  "parseMs",
] as const;

export type AiPerfSegment = (typeof AI_PERF_SEGMENTS)[number];

export const AI_PERF_SEGMENT_LABELS: Record<AiPerfSegment, string> = {
  preparationMs: "口上采样+组装",
  stateContextMs: "语义状态检索",
  firstTokenMs: "网络首 token",
  providerMs: "网络总耗时",
  parseMs: "解析+验证",
};

export interface AiPerfSegmentView {
  label: string;
  value: number;
}

/** 一次命令记录的构成段（authored 只有出现段；AI 含网络两段）。 */
export function commandSegments(record: CommandTimingRecord): AiPerfSegmentView[] {
  if (record.route !== "ai" || !record.ai) {
    return [{ label: "结算与公共地文（出现）", value: record.totalMs }];
  }
  const { firstTokenMs, providerMs } = record.ai;
  return [
    { label: "确定性结算+公共地文", value: record.settleMs },
    { label: "AI 准备（采样+组装）", value: record.prepareMs },
    { label: "网络等待（首 token 前）", value: firstTokenMs },
    { label: "网络生成（首 token 后）", value: Math.max(0, providerMs - firstTokenMs) },
    { label: "解析+发布", value: record.ai.parseMs },
  ];
}

/** 一次 AI 请求的构成段（本地三段合一）。 */
export function requestSegments(timings: Record<string, number>): AiPerfSegmentView[] {
  const firstTokenMs = timings.firstTokenMs ?? 0;
  const providerMs = timings.providerMs ?? 0;
  const local = (timings.preparationMs ?? 0) + (timings.stateContextMs ?? 0) + (timings.parseMs ?? 0);
  return [
    { label: "网络等待（首 token 前）", value: firstTokenMs },
    { label: "网络生成（首 token 后）", value: Math.max(0, providerMs - firstTokenMs) },
    { label: "本地段合计（采样/检索/解析）", value: local },
  ];
}
