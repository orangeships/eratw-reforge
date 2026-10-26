import { useEffect, useState } from "react";
import { useAiStore } from "./store.js";
import { commandTimingCounts, commandTimingRecords } from "./command-perf.js";
import { kojoSourceReadRecords } from "../../../modernization/runtime/kojo/kojo-cache.js";
import { commandSegments, requestSegments } from "./ai-perf.js";
import { commandLabel } from "./context.js";
import { localCommandTimings } from "../game/dev-command-gate.js";
import { kojoWorkerTimings } from "../game/kojo-worker-client.js";

const AI_ROUTE_GROUPS: ReadonlyArray<{ id: string; label: string; features: ReadonlySet<string> }> = [
  { id: "l1", label: "L1 口上", features: new Set(["command-kojo", "counter-kojo", "ai-chat", "ambient-initiative"]) },
  { id: "l2", label: "L2 角色认知", features: new Set(["agent-materialization"]) },
  { id: "l3", label: "L3 剧情导演", features: new Set(["narrative-director"]) },
];

const FEATURE_LABELS: Record<string, string> = {
  "command-kojo": "命令口上",
  "counter-kojo": "反制口上",
  "ai-chat": "自由聊天",
  "ambient-initiative": "场景主动",
  "agent-materialization": "夜间认知",
  "narrative-director": "剧情导演",
};

const DONUT_PALETTE = ["#7fb3d5", "#e0a95f", "#d98b8b", "#9ab5ca", "#b0a8d9", "#8fbf9f"] as const;

function PerfDonut({ segments, testId }: {
  segments: ReadonlyArray<{ label: string; value: number }>;
  testId: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return <p className="ai-perf__empty">暂无样本。</p>;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="ai-perf__donut" data-testid={testId}>
      <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label="耗时构成环形图">
        <circle cx={70} cy={70} r={radius} fill="none" stroke="#20262d" strokeWidth={18} />
        {segments.map((segment, index) => {
          const value = Math.max(0, segment.value);
          if (value <= 0) return null;
          const fraction = value / total;
          const element = (
            <circle
              key={segment.label}
              cx={70}
              cy={70}
              r={radius}
              fill="none"
              stroke={DONUT_PALETTE[index % DONUT_PALETTE.length]}
              strokeWidth={18}
              strokeDasharray={`${fraction * circumference} ${circumference}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += fraction * circumference;
          return element;
        })}
        <text x={70} y={66} textAnchor="middle" className="ai-perf__donut-total">{Math.round(total)}</text>
        <text x={70} y={82} textAnchor="middle" className="ai-perf__donut-unit">ms</text>
      </svg>
      <ul className="ai-perf__legend">
        {segments.map((segment, index) => (
          <li key={segment.label}>
            <span className="ai-perf__swatch" style={{ background: DONUT_PALETTE[index % DONUT_PALETTE.length] }} />
            {segment.label}
            <strong>{Math.round(Math.max(0, segment.value))}ms</strong>
            <span className="ai-perf__share">{Math.round((Math.max(0, segment.value) / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiPerfPanel() {
  const debugEntries = useAiStore((entry) => entry.debugEntries);
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const records = commandTimingRecords();
  const counts = commandTimingCounts(records);
  // Polled on the same 1 s tick as the command records. This is the only place
  // the dev shell's blocking kojo read is observable — Node measures a warm
  // `readFileSync` instead and understates it by roughly an order of magnitude.
  const sourceReads = kojoSourceReadRecords();
  const sourceReadTotal = sourceReads.reduce((sum, read) => sum + read.ms, 0);
  const sourceReadMax = sourceReads.reduce((max, read) => Math.max(max, read.ms), 0);
  const localCommands = localCommandTimings();
  const workerRecords = kojoWorkerTimings();
  const [selectedCommandId, setSelectedCommandId] = useState<number | null>(null);
  const selectedCommand = records.find((record) => record.id === selectedCommandId) ?? records[0];

  const groups = AI_ROUTE_GROUPS
    .map((group) => ({ ...group, entries: debugEntries.filter((entry) => group.features.has(entry.feature) && entry.timings) }))
    .filter((group) => group.entries.length > 0);
  const requestItems = groups.flatMap((group) => group.entries.map((entry) => ({ group, entry })));
  const [selectedRequestKey, setSelectedRequestKey] = useState<string | null>(null);
  const selectedRequest = requestItems.find((item) => item.entry.requestId === selectedRequestKey) ?? requestItems[0];

  return (
    <div className="ai-perf" data-testid="ai-perf-panel">
      <section className="ai-perf__section">
        <h4>
          命令点击 → 口上出现
          （共 {counts.total} 次 · AI {counts.ai} · 纯地文 {counts.authored} · 失败 {counts.errors}）
        </h4>
        {selectedCommand ? (
          <PerfDonut segments={commandSegments(selectedCommand)} testId="ai-perf-command-donut" />
        ) : (
          <p className="ai-perf__empty">暂无命令记录。</p>
        )}
        {records.length > 0 && (
          <ul className="ai-perf__list" data-testid="ai-perf-command-list">
            {records.slice(0, 12).map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className={selectedCommand?.id === record.id ? "is-selected" : ""}
                  onClick={() => setSelectedCommandId(record.id)}
                >
                  {commandLabel(record.commandNo)}{record.target !== undefined ? ` → #${record.target}` : ""}
                  <span className="ai-perf__tag">{record.route === "ai" ? "AI 口上" : "作者口上"}</span>
                  <strong>{record.outcome === "error" ? "失败" : `${Math.round(record.totalMs)}ms`}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedCommand?.runtime && (
          <p data-testid="runtime-command-timings">
            Runtime {Math.round(selectedCommand.runtime.runtimeMs)}ms ·
            同步读取 {Math.round(selectedCommand.runtime.kojo.read)}ms ·
            主线程解析 {Math.round(selectedCommand.runtime.kojo.parse)}ms ·
            口上求值 {Math.round(selectedCommand.runtime.kojo.resolve)}ms
            （其中状态复制 {Math.round(selectedCommand.runtime.kojo.clone)}ms）
          </p>
        )}
      </section>

      <section className="ai-perf__section">
        <h4>本地操作：准备 → 执行 → 界面提交</h4>
        <p className="ai-perf__empty">下一帧计时包含 React 提交后的等待，不代表实际绘制耗时；AI 网络时间见下方。</p>
        <ul className="ai-perf__list" data-testid="local-command-timings">
          {localCommands.slice(0, 8).map((record) => (
            <li key={record.id}>
              <span>{record.commandNo === -1 ? "路径移动" : commandLabel(record.commandNo)} · {record.outcome}</span>
              <span>准备 {Math.round(record.preparationMs)}ms · 执行 {Math.round(record.applicationMs)}ms ·
                提交与下一帧 {record.commitFrameMs === null ? "—" : `${Math.round(record.commitFrameMs)}ms`}</span>
            </li>
          ))}
        </ul>
        <h5>后台口上编译</h5>
        <ul className="ai-perf__list" data-testid="kojo-worker-timings">
          {workerRecords.slice(0, 8).map((record, index) => (
            <li key={index}>
              <span>{record.filePath}</span>
              <span>读取 {Math.round(record.readMs)}ms · 解析 {Math.round(record.parseMs)}ms ·
                往返 {Math.round(record.roundTripMs)}ms</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ai-perf__section">
        <h4>
          口上源文件阻塞读取（dev 同步 XHR）
          {sourceReadTotal > 0 && (
            <span className="ai-perf__tag">
              累计 {Math.round(sourceReadTotal)}ms · 最长 {Math.round(sourceReadMax)}ms
            </span>
          )}
        </h4>
        {sourceReads.length === 0 ? (
          <p className="ai-perf__empty">
            暂无同步读取记录。若这里持续增长，说明仍有未准备的路径在执行时读取源码。
          </p>
        ) : (
          <ul className="ai-perf__list" data-testid="ai-perf-source-read-list">
            {sourceReads.slice(0, 8).map((read, index) => (
              <li key={`${read.filePath}:${index}`}>
                <span className="ai-perf__tag" style={{ maxWidth: "22em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {read.filePath}
                </span>
                <strong>{Math.round(read.ms)}ms</strong>
                <span className="ai-perf__tag">{(read.chars / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ai-perf__section">
        <h4>AI 请求</h4>
        {requestItems.length === 0 ? (
          <p className="ai-perf__empty">暂无 AI 请求记录。</p>
        ) : selectedRequest ? (
          <PerfDonut segments={requestSegments(selectedRequest.entry.timings!)} testId="ai-perf-request-donut" />
        ) : null}
        {groups.map((group) => (
          <div key={group.id} className="ai-perf__route" data-testid={`ai-perf-route-${group.id}`}>
            <h5>{group.label} · {group.entries.length} 次</h5>
            <ul className="ai-perf__list">
              {group.entries.slice(0, 8).map((entry) => (
                <li key={entry.requestId}>
                  <button
                    type="button"
                    className={selectedRequest?.entry.requestId === entry.requestId ? "is-selected" : ""}
                    onClick={() => setSelectedRequestKey(entry.requestId)}
                  >
                    {FEATURE_LABELS[entry.feature] ?? entry.feature}
                    {entry.commandNo !== undefined ? ` · ${commandLabel(entry.commandNo)}` : ""}
                    <strong>{Math.round(entry.timings?.providerMs ?? 0)}ms</strong>
                    <span className="ai-perf__tag">首 token {Math.round(entry.timings?.firstTokenMs ?? 0)}ms</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
