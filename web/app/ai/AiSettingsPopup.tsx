import { useEffect, useMemo, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { AgentSettings } from "../../../modernization/runtime/agent/index.js";
import { cancelAllRealtimeAiKojo } from "./kojo-runtime.js";
import { resetSceneAmbientRuntime } from "./ambient-runtime.js";
import { cancelLazyMaterialization } from "./lazy-materialization.js";
import { AI_MAX_TOKENS_LIMIT, currentAiCharacterProfile, useAiStore } from "./store.js";
import { isArkAgentPlanBaseUrl, listOpenAiCompatibleModels } from "./provider.js";
import { buildS4EvaluationReport, serializeS4EvaluationReport } from "./s4-evaluation.js";
import PromptSettingsPanel from "./PromptSettingsPanel.js";
import type { AiDebugEntry } from "./types.js";
import { formatNarrativeWindow } from "./narrative-status.js";

type SettingsTab = "features" | "connection" | "prompts" | "character" | "perf" | "debug";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "features", label: "功能" },
  { id: "connection", label: "连接" },
  { id: "prompts", label: "提示词" },
  { id: "character", label: "角色" },
  { id: "perf", label: "耗时" },
  { id: "debug", label: "诊断" },
];

const OUTCOME_CODE_LABELS: Record<string, string> = {
  accepted: "已接受",
  "success-empty": "空成功",
  "first-encounter": "首次相遇登记",
  "blank-window": "间隔不足 180 分钟",
  "daily-budget": "达到每日预算",
  "duplicate-day": "今日已请求",
  timeout: "请求超时",
  "stale-proposal": "提案过期",
  cancelled: "已取消",
  "json-parse": "返回不是 JSON",
  "schema-validation": "输出合同校验失败",
  "provider-error": "Provider 错误",
  "unknown-error": "未分类错误",
  pending: "等待中",
};

const STORY_ARC_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  abandoned: "已放弃",
  expired: "已过期",
};

const STORY_ARC_REASON_LABELS: Record<string, string> = {
  "arc deadline expired": "故事期限已结束",
  "arc has no valid cast evidence": "没有有效的参与角色",
  "arc has no live event or continuation": "没有仍在进行的事件或后续机会",
  "restored cast from accepted event program": "已按有效事件恢复参与角色",
  "restored prematurely missed unstarted event": "已恢复被提前取消的未开始剧情",
};

/** One label for both the debug list row and the selected-entry header, so a
 * feature can never render as another feature's name in one of the two. */
function debugEntryLabel(entry: AiDebugEntry): string {
  switch (entry.feature) {
    case "agent-materialization":
      return `惰性角色经历 · 角色 ${entry.target ?? "?"} · 接受 ${entry.acceptedCount ?? 0}`;
    case "ambient-initiative":
      return `场景主动口上 · ${entry.trigger ?? "未知触发"} · 角色 ${(entry.participants ?? []).join(", ")}`;
    case "narrative-director":
      return `L3 叙事导演 · 角色 ${(entry.participants ?? []).join(", ")}`;
    case "ai-chat":
      return `自由对话（AI）· 角色 ${entry.target ?? "?"}`;
    case "agent-daytime":
      // The queue-level summary entry carries no character of its own.
      return entry.target === undefined ? "白天认知 · 汇总" : `白天认知 · 角色 ${entry.target}`;
    case "agent-diary":
      return `JEV 日记判断 · 角色 ${entry.target ?? "?"}`;
    default:
      return `命令口上 · COM ${entry.commandNo ?? "?"} · 角色 ${entry.target ?? "?"}`;
  }
}

export interface AiSettingsPopupProps {
  onClose: () => void;
  state?: Readonly<GameState>;
  currentCharaNum?: number;
  onUpdateAgentSettings?: (patch: Partial<AgentSettings>) => void;
  onPrepareCharacterForEncounter?: (charaNum: number) => void;
  onCancelLazyMaterialization?: (reason?: string) => void;
  onStartStoryProgram?: (templateId?: 1 | 2, actorId?: number) => Promise<boolean>;
  onSetStoryArcStatus?: (arcId: string, status: "active" | "paused" | "abandoned") => void;
  onFavoriteNarrativeEvent?: (eventId: string) => void;
  /** 问题3 — wipe every AI-generated persisted field from the current game. */
  onClearAiGeneratedContent?: () => void;
}

import { StateContextEditor } from "./StateContextEditor.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { describeNarrativeDirectorStatus } from "./narrative-status.js";
import { AiPerfPanel } from "./AiPerfPanel.js";
import { CharacterCardEditor } from "./CharacterCardEditor.js";
import { PresetCardFields } from "./PresetCardFields.js";

export default function AiSettingsPopup({
  onClose,
  state,
  currentCharaNum,
  onUpdateAgentSettings,
  onPrepareCharacterForEncounter,
  onCancelLazyMaterialization,
  onStartStoryProgram,
  onSetStoryArcStatus,
  onFavoriteNarrativeEvent,
  onClearAiGeneratedContent,
}: AiSettingsPopupProps) {
  const settings = useAiStore((entry) => entry.settings);
  const updateSettings = useAiStore((entry) => entry.updateSettings);
  const updateCharacterProfile = useAiStore((entry) => entry.updateCharacterProfile);
  const debugEntries = useAiStore((entry) => entry.debugEntries);
  const narrativeDirectorStatus = useGameStateStore((s) => s.narrativeDirectorStatus);
  const clearDebug = useAiStore((entry) => entry.clearDebug);
  const s4EvaluationEntries = useAiStore((entry) => entry.s4EvaluationEntries);
  const clearS4Evaluation = useAiStore((entry) => entry.clearS4Evaluation);
  const [activeTab, setActiveTab] = useState<SettingsTab>("features");
  const [showPrompt, setShowPrompt] = useState(false);
  const [debugErrorsOnly, setDebugErrorsOnly] = useState(false);
  const [selectedDebugRequestId, setSelectedDebugRequestId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [storyLaunching, setStoryLaunching] = useState(false);
  const [storyLaunchResult, setStoryLaunchResult] = useState<string | null>(null);
  // 问题3 — two-step confirmation for wiping AI-generated content.
  const [confirmClearAi, setConfirmClearAi] = useState(false);
  const [clearAiResult, setClearAiResult] = useState<string | null>(null);
  const characters = useMemo(() => Object.values(state?.charas ?? {})
    .filter((slot) => slot.charaNum > 0)
    .sort((left, right) => left.charaNum - right.charaNum), [state]);
  const [profileCharaNum, setProfileCharaNum] = useState(() =>
    currentCharaNum && currentCharaNum > 0 ? currentCharaNum : characters[0]?.charaNum ?? 1);
  const profile = currentAiCharacterProfile(profileCharaNum);
  const runtime = state?.agentRuntime;
  const l3PrerequisitesReady = settings.enabled && runtime?.settings.masterEnabled === true;
  // Arcs that never had an NPC participant are pre-version shells: an older
  // build could open a solo line, and reconciliation now closes every one of
  // them on sight. They are dead records, not a state worth reporting, so the
  // log hides them and keeps the player looking at live or meaningful lines.
  // Nothing is removed from the save.
  const listableStoryArcs = useMemo(
    () => (state?.storyArcs ?? []).filter((arc) => arc.participantRoles.some((role) => role.characterId > 0)),
    [state?.storyArcs],
  );
  const debugMindCharaNum = currentCharaNum && currentCharaNum > 0
    ? currentCharaNum
    : profileCharaNum;
  const debugMindCognition = runtime?.cognitions[debugMindCharaNum];
  const visibleDebugEntries = useMemo(
    () => (debugErrorsOnly ? debugEntries.filter((entry) => entry.status === "error") : debugEntries).slice(0, 30),
    [debugEntries, debugErrorsOnly],
  );
  const selectedDebugEntry = visibleDebugEntries.find((entry) => entry.requestId === selectedDebugRequestId)
    ?? visibleDebugEntries[0];
  const s4Report = useMemo(
    () => buildS4EvaluationReport(state, settings, s4EvaluationEntries),
    [s4EvaluationEntries, settings, state],
  );
  const models = useMemo(() => [...new Set([
    ...availableModels,
    ...(settings.model.trim() ? [settings.model.trim()] : []),
  ])].sort((left, right) => left.localeCompare(right)), [availableModels, settings.model]);
  const usesBuiltInModelCatalog = isArkAgentPlanBaseUrl(settings.baseUrl);

  useEffect(() => {
    const baseUrl = settings.baseUrl.trim();
    const apiKey = settings.apiKey.trim();
    if (!baseUrl || !apiKey) {
      setAvailableModels([]);
      setModelLoadError(null);
      setModelsLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setModelsLoading(true);
      setModelLoadError(null);
      void listOpenAiCompatibleModels({ baseUrl, apiKey }, controller.signal)
        .then((entries) => {
          if (!controller.signal.aborted) setAvailableModels(entries);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setAvailableModels([]);
            setModelLoadError(error instanceof Error ? error.message : "Unable to load models");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setModelsLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [settings.apiKey, settings.baseUrl]);

  const downloadS4Report = (): void => {
    const blob = new Blob([serializeS4EvaluationReport(s4Report)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eratw-s4-evaluation-day-${(state?.time.dayIndex ?? 0) + 1}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const setAiEnabled = (enabled: boolean) => {
    updateSettings({ enabled });
    if (!enabled) {
      cancelAllRealtimeAiKojo();
      resetSceneAmbientRuntime();
      cancelLazyMaterialization("AI disabled");
      onUpdateAgentSettings?.({ masterEnabled: false });
    }
  };

  return (
    <div className="ai-settings__scrim" data-testid="ai-settings-scrim">
      <div
        className="ai-settings"
        role="dialog"
        aria-label="AI 设置"
        data-testid="ai-settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ai-settings__head">
          <span>AI 设置</span>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="ai-settings__tabs" role="tablist" aria-label="AI 设置分类">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "is-active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ai-settings__body">
          {activeTab === "features" && (
            <div className="ai-settings__pane" role="tabpanel">
              <div className="ai-settings__master-row">
                <div>
                  <strong>AI 总开关</strong>
                  <span>{settings.enabled ? "已开启" : "已关闭"}</span>
                </div>
                <button
                  type="button"
                  className={settings.enabled ? "" : "ai-settings__enable"}
                  onClick={() => setAiEnabled(!settings.enabled)}
                >
                  {settings.enabled ? "关闭" : "开启 AI"}
                </button>
              </div>

              <section className="ai-settings__section">
                <h3>L1 - 口上路由补全</h3>
                <p className="ai-settings__section-desc">角色反应与对话生成，填充静默口上或替换作者口上</p>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="AI 口上补全"
                    checked={settings.kojoEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => updateSettings({ kojoEnabled: event.target.checked })}
                  />
                  <span>AI 口上补全（填充无作者口上的空白）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={settings.fullAiKojoEnabled}
                    disabled={!settings.enabled || !settings.kojoEnabled}
                    onChange={(event) => updateSettings({ fullAiKojoEnabled: event.target.checked })}
                  />
                  <span>全 AI 口上（作者口上作为倾向参考，失败时恢复原文）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input type="checkbox" checked={settings.relationshipChangesEnabled === true} disabled={!settings.enabled}
                    onChange={event => updateSettings({ relationshipChangesEnabled: event.target.checked })} />
                  <span>自由聊天影响好感与信赖（小幅增减，每日有限额）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input type="checkbox" checked={settings.dialogueActionsEnabled === true} disabled={!settings.enabled}
                    onChange={event => updateSettings({ dialogueActionsEnabled: event.target.checked })} />
                  <span>对话行动（同行与邀约）</span>
                </label>
                {settings.dialogueActionsEnabled && <>
                  <label className="ai-settings__field">
                    <span>同行判断模型</span>
                    <select value={settings.dialogueActionProvider ?? "chat"}
                      onChange={event => updateSettings({ dialogueActionProvider: event.target.value === "jev" ? "jev" : "chat" })}>
                      <option value="chat">沿用口上模型</option>
                      <option value="jev">OpenRouter · typesafe/jev-1.13</option>
                    </select>
                  </label>
                  {settings.dialogueActionProvider === "jev" && <label className="ai-settings__field">
                    <span>同行判断 OpenRouter API Key</span>
                    <input type="password" autoComplete="off" value={settings.dialogueActionApiKey ?? ""}
                      onChange={event => updateSettings({ dialogueActionApiKey: event.target.value })} />
                  </label>}
                </>}
                <label className="ai-settings__toggle">
                  <input type="checkbox" checked={settings.stateQueryEnabled === true} disabled={!settings.enabled}
                    onChange={event => updateSettings({ stateQueryEnabled: event.target.checked })} />
                  <span>允许夜间反思与叙事导演补查状态（仅 L2/L3，可能增加一次等待；L1 口上一律用确定性预载）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="EVENT_COUNTER AI 选择"
                    checked={settings.counterEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => updateSettings({ counterEnabled: event.target.checked })}
                  />
                  <span>EVENT_COUNTER AI 选择（gameplay 选择层，默认关闭）</span>
                </label>
                <details className="ai-settings__details">
                  <summary>实验性口上路由</summary>
                  <div className="ai-settings__details-body">
                    <label className="ai-settings__toggle">
                      <input
                        type="checkbox"
                        checked={settings.allowUnsupportedAuthored}
                        disabled={!settings.enabled || !settings.kojoEnabled}
                        onChange={(event) => updateSettings({ allowUnsupportedAuthored: event.target.checked })}
                      />
                      <span>实验性补写 unsupported authored 空白</span>
                    </label>
                  </div>
                </details>
              </section>

              <section className="ai-settings__section">
                <h3>L2 - 角色智能体</h3>
                <p className="ai-settings__section-desc">角色记忆、目标、日计划和离屏经历生成</p>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={runtime?.settings.masterEnabled ?? false}
                    disabled={!settings.enabled || !runtime || !onUpdateAgentSettings}
                    onChange={(event) => onUpdateAgentSettings?.({ masterEnabled: event.target.checked })}
                  />
                  <span>夜间记忆、目标与日计划</span>
                </label>
                <label className="ai-settings__field">
                  <span>日记判断 JEV API Key</span>
                  <input type="password" autoComplete="off" value={settings.dialogueActionApiKey ?? ""}
                    onChange={event => updateSettings({ dialogueActionApiKey: event.target.value })} />
                </label>
                <p className="ai-settings__note">与同行判断共用 OpenRouter Key，无需开启同行判断。仅 JEV 判定很重要时生成日记；未配置或判断失败时仍保留夜间反思。</p>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="白天角色即时反应"
                    checked={settings.daytimeReactionEnabled === true}
                    disabled={!settings.enabled || !runtime?.settings.masterEnabled}
                    onChange={(event) => updateSettings({ daytimeReactionEnabled: event.target.checked })}
                  />
                  <span>白天认知（白天角色即时反应，实验性，默认关闭）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="惰性角色经历"
                    checked={settings.lazyMaterializationEnabled}
                    disabled={!settings.enabled || !runtime?.settings.masterEnabled}
                    onChange={(event) => {
                      updateSettings({ lazyMaterializationEnabled: event.target.checked });
                      if (!event.target.checked) {
                        cancelLazyMaterialization("Lazy materialization disabled");
                        onCancelLazyMaterialization?.("Lazy materialization disabled");
                      }
                    }}
                  />
                  <span>惰性角色经历（实验性，默认关闭）</span>
                </label>
                <button
                  type="button"
                  disabled={!currentCharaNum
                    || currentCharaNum <= 0
                    || !settings.enabled
                    || !runtime?.settings.masterEnabled
                    || !settings.lazyMaterializationEnabled}
                  onClick={() => currentCharaNum && onPrepareCharacterForEncounter?.(currentCharaNum)}
                >
                  为当前角色手动准备经历
                </button>
                <label className="ai-settings__compact-field">
                  <span>活跃角色上限</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={runtime?.settings.maxActiveAgents ?? 10}
                    disabled={!runtime || !onUpdateAgentSettings}
                    onChange={(event) => onUpdateAgentSettings?.({ maxActiveAgents: Number(event.target.value) })}
                  />
                </label>
                {runtime && runtime.activeRoster.length > 0 ? (
                  <div className="ai-settings__roster" data-testid="ai-agent-roster">
                    <span>当前名单 {runtime.activeRoster.length}/{runtime.settings.maxActiveAgents}</span>
                    <ol>
                      {runtime.activeRoster.map((charaNum) => (
                        <li key={charaNum}>
                          <span>{state?.charas[charaNum]?.callName ?? `#${charaNum}`}</span>
                          <output>{(runtime.engagements[charaNum]?.score ?? 0).toFixed(1)}</output>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="ai-settings__note">名单将在首次夜间结算后生成。</p>
                )}
              </section>

              <section className="ai-settings__section">
                <h3>L3 - 叙事导演</h3>
                <p className="ai-settings__section-desc">AI 生成的故事事件与叙事弧线</p>
                {(() => {
                  const directorView = describeNarrativeDirectorStatus(
                    state ?? null,
                    narrativeDirectorStatus,
                    debugEntries,
                  );
                  return directorView ? (
                    <div className="ai-settings__details-body" data-testid="narrative-director-live" role="status" aria-live="polite">
                      <span data-testid="narrative-director-live-label">{directorView.label}</span>
                      {directorView.detail && <span className="ai-settings__note">{directorView.detail}</span>}
                    </div>
                  ) : null;
                })()}
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="L3 叙事导演"
                    checked={settings.narrativeEnabled}
                    disabled={!settings.narrativeEnabled && !l3PrerequisitesReady}
                    onChange={(event) => updateSettings({ narrativeEnabled: event.target.checked })}
                  />
                  <span>L3 叙事导演（需同时开启 AI 与 Agent Runtime；不依赖全 AI 替换口上）</span>
                </label>
                <label>
                  <span>叙事频率</span>
                  <select
                    aria-label="叙事频率"
                    value={settings.narrativeFrequency}
                    disabled={!settings.enabled || !settings.narrativeEnabled}
                    onChange={(event) => updateSettings({ narrativeFrequency: event.target.value as typeof settings.narrativeFrequency })}
                  >
                    <option value="sparse">稀疏</option>
                    <option value="moderate">适中（每日最多 1 / 七日最多 3）</option>
                    <option value="frequent">频繁</option>
                  </select>
                </label>
                {listableStoryArcs.length > 0 && (
                  <div className="ai-settings__details-body" data-testid="story-arc-log">
                    <strong>StoryArc 日志</strong>
                    {listableStoryArcs.map((arc) => (
                      <div key={arc.id} className="ai-settings__arc-row">
                        <span>{arc.title} · 阶段 {arc.phase} · {STORY_ARC_STATUS_LABELS[arc.status] ?? arc.status}</span>
                        {arc.lifecycleReason && (
                          <span className="ai-settings__note">{STORY_ARC_REASON_LABELS[arc.lifecycleReason] ?? arc.lifecycleReason}</span>
                        )}
                        {arc.maintenance?.nextChance && (
                          <span className="ai-settings__note">
                            候选窗口：{arc.maintenance.nextChance.locationIds.join("、")}
                            （{formatNarrativeWindow(arc.maintenance.nextChance.earliestTick, arc.maintenance.nextChance.latestTick)}，错过则 {arc.maintenance.nextChance.onMiss === "defer" ? "顺延" : "结束"}）
                          </span>
                        )}
                        {(arc.maintenance?.evolution?.pendingPlayerIntents?.length ?? 0) > 0 && (
                          <span className="ai-settings__note">待处理互动提案 {arc.maintenance!.evolution!.pendingPlayerIntents!.length} 项</span>
                        )}
                        <span className="ai-settings__arc-actions">
                          {arc.status === "active" && <button type="button" onClick={() => onSetStoryArcStatus?.(arc.id, "paused")}>暂停</button>}
                          {arc.status === "paused" && <button type="button" onClick={() => onSetStoryArcStatus?.(arc.id, "active")}>继续</button>}
                          {(arc.status === "active" || arc.status === "paused") && <button type="button" onClick={() => onSetStoryArcStatus?.(arc.id, "abandoned")}>放弃</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {(state?.narrativeEvents ?? []).some((event) => event.status === "resolved") && (
                  <div className="ai-settings__details-body" data-testid="narrative-event-recap">
                    <strong>事件回顾</strong>
                    {(state?.narrativeEvents ?? []).filter((event) => event.status === "resolved").slice(-8).reverse().map((event) => {
                      const favorited = state?.storyTemplateFavorites?.some((entry) => entry.eventId === event.id && entry.status !== "cancelled");
                      return (
                        <div key={event.id}>
                          <span>{event.title}{event.arcId ? " · Arc" : ""}</span>
                          <button type="button" disabled={favorited} onClick={() => onFavoriteNarrativeEvent?.(event.id)}>
                            {favorited ? "已收藏" : "收藏为模板"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    aria-label="叙事短事件"
                    checked={settings.storyEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => updateSettings({ storyEnabled: event.target.checked })}
                  />
                  <span>StoryProgram V1 fixture（开发工具，默认关闭）</span>
                </label>
                <div className="ai-settings__actions">
                  <button
                    type="button"
                    disabled={!settings.enabled || !settings.storyEnabled || storyLaunching || !onStartStoryProgram}
                    onClick={() => {
                      setStoryLaunching(true);
                      setStoryLaunchResult(null);
                      void onStartStoryProgram?.(undefined, currentCharaNum)
                        .then((ok) => setStoryLaunchResult(ok ? "已启动一个受限短事件。" : "当前没有可接受的短事件提案。"))
                        .finally(() => setStoryLaunching(false));
                    }}
                  >
                    {storyLaunching ? "正在选择短事件..." : "由 AI 选择短事件"}
                  </button>
                  <button
                    type="button"
                    disabled={!settings.enabled || !settings.storyEnabled || storyLaunching || !onStartStoryProgram || !currentCharaNum}
                    onClick={() => {
                      setStoryLaunching(true);
                      setStoryLaunchResult(null);
                      void onStartStoryProgram?.(1, currentCharaNum)
                        .then((ok) => setStoryLaunchResult(ok ? "已启动作者 fixture：片刻茶歇。" : "当前无法启动 fixture。"))
                        .finally(() => setStoryLaunching(false));
                    }}
                  >
                    测试片刻茶歇
                  </button>
                </div>
                {storyLaunchResult && <p className="ai-settings__note" role="status">{storyLaunchResult}</p>}
              </section>

              <section className="ai-settings__section">
                <h3>AI 玩法润色</h3>
                <p className="ai-settings__section-desc">AI 增强的游戏表现与体验</p>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={settings.ambientEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => {
                      updateSettings({ ambientEnabled: event.target.checked });
                      if (!event.target.checked) resetSceneAmbientRuntime();
                    }}
                  />
                  <span>场景主动口上（实验性，默认关闭）</span>
                </label>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={settings.radioEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => updateSettings({ radioEnabled: event.target.checked })}
                  />
                  <span>AI 润色收音机</span>
                </label>
              </section>

              <section className="ai-settings__section">
                <h3>数据管理</h3>
                <div className="ai-settings__clear-ai" data-testid="ai-clear-generated">
                  {clearAiResult ? (
                    <p className="ai-settings__note">{clearAiResult}</p>
                  ) : confirmClearAi ? (
                    <>
                      <p className="ai-settings__note">将清除全部角色记忆、AI 日记、经历、故事与 AI 人设（保留智能体名单与连接设置）。确认执行？</p>
                      <button
                        type="button"
                        data-testid="ai-clear-generated-confirm"
                        onClick={() => {
                          onClearAiGeneratedContent?.();
                          setConfirmClearAi(false);
                          setClearAiResult("已清除 AI 生成内容。请保存游戏以覆盖当前存档槽。");
                        }}
                      >
                        [确认清除]
                      </button>
                      <button type="button" onClick={() => setConfirmClearAi(false)}>取消</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-testid="ai-clear-generated-start"
                      disabled={!onClearAiGeneratedContent || !state}
                      onClick={() => setConfirmClearAi(true)}
                    >
                      清除 AI 生成内容
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === "connection" && (
            <div className="ai-settings__pane" role="tabpanel">
              <label>
                <span>OpenAI-compatible 地址</span>
                <input
                  data-testid="ai-base-url"
                  value={settings.baseUrl}
                  onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                  placeholder="https://uuapi.io/v1"
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  data-testid="ai-api-key"
                  type="password"
                  autoComplete="off"
                  value={settings.apiKey}
                  onChange={(event) => updateSettings({ apiKey: event.target.value })}
                />
              </label>
              <label>
                <span>模型</span>
                <select
                  data-testid="ai-model"
                  value={settings.model}
                  onChange={(event) => updateSettings({ model: event.target.value })}
                >
                  {models.length > 0
                    ? models.map((model) => <option key={model} value={model}>{model}</option>)
                    : <option value={settings.model}>{settings.model || "等待模型列表"}</option>}
                </select>
              </label>
              <p className={`ai-settings__models-status${modelLoadError ? " ai-settings__models-status--error" : ""}`}>
                {modelsLoading
                  ? "正在读取模型..."
                  : modelLoadError
                    ? `模型读取失败：${modelLoadError}`
                    : availableModels.length > 0
                      ? usesBuiltInModelCatalog
                        ? `已提供 ${availableModels.length} 个 Agent Plan 候选模型`
                        : `已发现 ${availableModels.length} 个模型`
                      : "尚未读取模型"}
              </p>
              <div className="ai-settings__row">
                <label>
                  <span>思考强度</span>
                  <select
                    data-testid="ai-reasoning-effort"
                    value={settings.reasoningEffort}
                    onChange={(event) => updateSettings({
                      reasoningEffort: event.target.value as typeof settings.reasoningEffort,
                    })}
                  >
                    <option value="off">关闭</option>
                    <option value="low">低（更快）</option>
                    <option value="medium">中（推荐）</option>
                    <option value="high">高（更慢）</option>
                  </select>
                </label>
                <label>
                  <span>回复预算（tokens）</span>
                  <input
                    data-testid="ai-max-tokens"
                    type="number"
                    min={128}
                    max={AI_MAX_TOKENS_LIMIT}
                    step={128}
                    value={settings.maxTokens}
                    onChange={(event) => updateSettings({ maxTokens: Number(event.target.value) })}
                  />
                </label>
              </div>
              <p className="ai-settings__models-status">
                Gemini 3.8 Flash 默认使用中等思考；可切换关闭 / 低 / 中 / 高。DeepSeek 的“关闭”会禁用思考，其他模型是否支持由模型协议决定。
              </p>
              <div className="ai-settings__row">
                <label>
                  <span>超时（毫秒）</span>
                  <input
                    type="number"
                    min={1000}
                    max={180000}
                    step={1000}
                    value={settings.timeoutMs}
                    onChange={(event) => updateSettings({ timeoutMs: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>温度</span>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.temperature}
                    onChange={(event) => updateSettings({ temperature: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === "prompts" && (
            <div className="ai-settings__pane" role="tabpanel" aria-label="提示词">
              <PromptSettingsPanel />
            </div>
          )}

          {activeTab === "character" && (
            <div className="ai-settings__pane" role="tabpanel">
              <label>
                <span>角色</span>
                <select
                  data-testid="ai-character-select"
                  value={profileCharaNum}
                  onChange={(event) => setProfileCharaNum(Number(event.target.value))}
                >
                  {characters.length > 0 ? characters.map((slot) => (
                    <option key={slot.charaNum} value={slot.charaNum}>
                      #{slot.charaNum} {slot.callName}
                    </option>
                  )) : <option value={profileCharaNum}>#{profileCharaNum}</option>}
                </select>
              </label>
              <label className="ai-settings__toggle">
                <input
                  type="checkbox"
                  checked={profile.enabled}
                  onChange={(event) => updateCharacterProfile(profileCharaNum, { enabled: event.target.checked })}
                />
                <span>允许该角色使用命令及场景 AI 口上</span>
              </label>
              <PresetCardFields key={profileCharaNum} state={state} charaNum={profileCharaNum} />
              <label>
                <span>角色补充设定</span>
                <textarea
                  data-testid="ai-character-lore"
                  rows={7}
                  value={profile.lore}
                  onChange={(event) => updateCharacterProfile(profileCharaNum, { lore: event.target.value })}
                />
              </label>
              <label>
                <span>口吻与扮演约束</span>
                <textarea
                  rows={4}
                  value={profile.styleGuide}
                  onChange={(event) => updateCharacterProfile(profileCharaNum, { styleGuide: event.target.value })}
                />
              </label>
              {profile.generatedPersona && (
                <label>
                  <span>动态角色基础画像</span>
                  <textarea rows={2} value={profile.generatedPersona} readOnly />
                </label>
              )}
              <CharacterCardEditor state={state} charaNum={profileCharaNum} />
            </div>
          )}

          {activeTab === "perf" && (
            <div className="ai-settings__pane ai-settings__perf" role="tabpanel" aria-label="耗时">
              <AiPerfPanel />
            </div>
          )}
          {activeTab === "debug" && (
            <div className="ai-settings__pane ai-settings__debug" role="tabpanel">
              <div data-testid="s4-evaluation-summary">
                <div className="ai-settings__debug-head">
                  <span>S4 玩家评测</span>
                  <button type="button" onClick={clearS4Evaluation}>开始新一轮</button>
                </div>
                <p className="ai-settings__note">
                  已记录 {s4Report.summary.recordedAttempts} 次机会 · 模型请求 {s4Report.summary.providerRequests} ·
                  成功 {s4Report.summary.success} · 接受经历 {s4Report.summary.acceptedExperiences}
                </p>
                <p className="ai-settings__note">
                  Token {s4Report.summary.totalTokens}
                  （provider {s4Report.summary.providerUsageRecords} / 估算 {s4Report.summary.estimatedUsageRecords}） ·
                  缓存命中 {s4Report.summary.cacheHits}（V1 无缓存） ·
                  Experience 增量 {s4Report.summary.experienceBytesDelta} B · 存档增量 {s4Report.summary.saveBytesDelta} B
                </p>
                {Object.keys(s4Report.summary.outcomeCodeCounts).length > 0 && (
                  <p className="ai-settings__note" data-testid="s4-outcome-codes">
                    诊断阶段：{Object.entries(s4Report.summary.outcomeCodeCounts)
                      .map(([code, count]) => `${OUTCOME_CODE_LABELS[code] ?? code} × ${count}`).join(" · ")}
                  </p>
                )}
                <button type="button" onClick={downloadS4Report} disabled={s4EvaluationEntries.length === 0}>
                  导出 S4 评测 JSON
                </button>
                <p className="ai-settings__note">
                  导出仅含次数、状态、耗时、token 与字节数；不含 API key、prompt、response 或角色私密文本。
                </p>
              </div>
              <section className="ai-settings__mind-debug" data-testid="ai-mind-debug">
                <div className="ai-settings__debug-head">
                  <span>角色当前 mind（只读主观状态）</span>
                  <span>角色 {debugMindCharaNum}</span>
                </div>
                {debugMindCognition?.mind ? (
                  <div className="ai-settings__details-body">
                    <p className="ai-settings__note">
                      revision {debugMindCognition.mind.revision} · 更新时间 {debugMindCognition.mind.updatedTick}
                    </p>
                    <p><strong>关系理解：</strong>{debugMindCognition.mind.relationshipToPlayer || "（暂无）"}</p>
                    <p><strong>当前倾向：</strong>{debugMindCognition.mind.currentTendency || "（暂无）"}</p>
                    <div><strong>信念</strong>{debugMindCognition.mind.beliefs.length > 0
                      ? <ul>{debugMindCognition.mind.beliefs.map((item) => <li key={item.id}>[{item.id}] {item.text} · {item.evidenceIds.join(", ") || "无证据"}</li>)}</ul>
                      : <p className="ai-settings__note">暂无</p>}</div>
                    <div><strong>目标</strong>{debugMindCognition.mind.goals.length > 0
                      ? <ul>{debugMindCognition.mind.goals.map((item) => <li key={item.id}>[{item.id}] {item.text} · {item.status ?? "active"} · {item.evidenceIds.join(", ") || "无证据"}</li>)}</ul>
                      : <p className="ai-settings__note">暂无</p>}</div>
                    <div><strong>未决社交事项</strong>{debugMindCognition.mind.threads.length > 0
                      ? <ul>{debugMindCognition.mind.threads.map((item) => <li key={item.id}>[{item.id}] {item.kind} · {item.text} · {item.status} · {item.evidenceIds.join(", ") || "无证据"}</li>)}</ul>
                      : <p className="ai-settings__note">暂无</p>}</div>
                    <div><strong>待归并 episode</strong>{(debugMindCognition.pendingEpisodes ?? []).length > 0
                      ? <ul>{(debugMindCognition.pendingEpisodes ?? []).map((episode) => <li key={episode.id}>[{episode.id}] session {episode.sessionId} · {episode.lines.map((line) => line.text).join(" / ")} {episode.choices.length > 0 ? `· choices: ${episode.choices.map((choice) => choice.label).join(", ")}` : ""}</li>)}</ul>
                      : <p className="ai-settings__note">暂无</p>}</div>
                  </div>
                ) : (
                  <p className="ai-settings__note">当前角色还没有可显示的 mind。</p>
                )}
              </section>
              <div className="ai-settings__debug-head">
                <StateContextEditor state={state} target={currentCharaNum} />
                <span>最近请求</span>
                <div className="ai-settings__debug-actions">
                  <label className="ai-settings__debug-filter">
                    <input
                      type="checkbox"
                      checked={debugErrorsOnly}
                      onChange={(event) => setDebugErrorsOnly(event.target.checked)}
                    />
                    只看错误
                  </label>
                  <button type="button" onClick={clearDebug}>清空</button>
                </div>
              </div>
              {visibleDebugEntries.length > 0 ? (
                <>
                  <div className="ai-settings__debug-list" data-testid="ai-debug-list">
                    {visibleDebugEntries.map((entry) => {
                      const label = debugEntryLabel(entry);
                      return (
                        <button
                          type="button"
                          key={entry.requestId}
                          className={`ai-settings__debug-item${entry.requestId === selectedDebugEntry?.requestId ? " is-selected" : ""}`}
                          onClick={() => {
                            setSelectedDebugRequestId(entry.requestId);
                            setShowPrompt(false);
                          }}
                        >
                          <span className={`ai-settings__status ai-settings__status--${entry.status}`}>
                            {entry.status}
                          </span>
                          <span>{label}</span>
                          {entry.durationMs !== undefined && <span>{entry.durationMs}ms</span>}
                        </button>
                      );
                    })}
                  </div>
                  {selectedDebugEntry ? (
                    <>
                      <div className={`ai-settings__status ai-settings__status--${selectedDebugEntry.status}`}>
                        {selectedDebugEntry.status} · {debugEntryLabel(selectedDebugEntry)}
                        {selectedDebugEntry.durationMs !== undefined ? ` · ${selectedDebugEntry.durationMs}ms` : ""}
                      </div>
                      {selectedDebugEntry.skipReason && <pre>{selectedDebugEntry.skipReason}</pre>}
                      {selectedDebugEntry.error && <pre>{selectedDebugEntry.error}</pre>}
                      {selectedDebugEntry.timings && <pre>{JSON.stringify(selectedDebugEntry.timings, null, 2)}</pre>}
                      {selectedDebugEntry.relationshipResult !== undefined && <pre>{JSON.stringify(selectedDebugEntry.relationshipResult, null, 2)}</pre>}
                      {selectedDebugEntry.dialogueActionResult !== undefined && <pre>{JSON.stringify(selectedDebugEntry.dialogueActionResult, null, 2)}</pre>}
                      {(() => {
                        // Fields recorded by every route but never shown before:
                        // this is what narrative-director / agent-daytime entries
                        // carry instead of prompt/response.
                        const meta: string[] = [];
                        if (selectedDebugEntry.gameDayIndex !== undefined) {
                          meta.push(`游戏日 ${selectedDebugEntry.gameDayIndex}`);
                        }
                        if (selectedDebugEntry.gameTick !== undefined) {
                          meta.push(`tick ${selectedDebugEntry.gameTick}`);
                        }
                        if (selectedDebugEntry.providerStarted) meta.push("provider 已发起");
                        if (selectedDebugEntry.acceptedCount !== undefined) {
                          meta.push(`接受 ${selectedDebugEntry.acceptedCount}`);
                        }
                        if (selectedDebugEntry.tokenUsage) {
                          meta.push(`tokens ${selectedDebugEntry.tokenUsage.promptTokens}+${selectedDebugEntry.tokenUsage.completionTokens}=${selectedDebugEntry.tokenUsage.totalTokens}`);
                        }
                        if (selectedDebugEntry.routeStatus) {
                          meta.push(`route ${selectedDebugEntry.routeStatus}`);
                        }
                        if (selectedDebugEntry.queueWaitMs !== undefined) {
                          meta.push(`排队 ${selectedDebugEntry.queueWaitMs}ms`);
                        }
                        if (selectedDebugEntry.participants && selectedDebugEntry.participants.length > 0) {
                          meta.push(`角色 ${selectedDebugEntry.participants.join(", ")}`);
                        }
                        return meta.length > 0 ? <pre>{meta.join(" · ")}</pre> : null;
                      })()}
                      {showPrompt && selectedDebugEntry.stateTrace !== undefined && <pre>{JSON.stringify(selectedDebugEntry.stateTrace, null, 2)}</pre>}
                      {(selectedDebugEntry.prompt || selectedDebugEntry.response) && (
                        <button type="button" onClick={() => setShowPrompt((value) => !value)}>
                          {showPrompt ? "隐藏详情" : "查看详情"}
                        </button>
                      )}
                      {showPrompt && (selectedDebugEntry.prompt || selectedDebugEntry.response) && (
                        <pre className="ai-settings__trace">
                          {selectedDebugEntry.prompt ?? ""}
                          {selectedDebugEntry.response ? `\n\n--- RESPONSE ---\n${selectedDebugEntry.response}` : ""}
                        </pre>
                      )}
                    </>
                  ) : null}
                </>
              ) : (
                <p className="ai-settings__note">暂无请求记录。</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
