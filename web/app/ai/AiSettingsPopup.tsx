import { useEffect, useMemo, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { AgentSettings } from "../../../modernization/runtime/agent/index.js";
import { cancelAllRealtimeAiKojo } from "./kojo-runtime.js";
import { currentAiCharacterProfile, useAiStore } from "./store.js";
import { listOpenAiCompatibleModels } from "./provider.js";

const FAMILY_OPTIONS = [
  { id: "comm", label: "交流" },
  { id: "daily", label: "日常" },
  { id: "kaji", label: "家务" },
  { id: "sekuhara", label: "日常触摸" },
];

type SettingsTab = "features" | "connection" | "character" | "debug";

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "features", label: "功能" },
  { id: "connection", label: "连接" },
  { id: "character", label: "角色" },
  { id: "debug", label: "诊断" },
];

export interface AiSettingsPopupProps {
  onClose: () => void;
  state?: Readonly<GameState>;
  currentCharaNum?: number;
  onUpdateAgentSettings?: (patch: Partial<AgentSettings>) => void;
}

export default function AiSettingsPopup({
  onClose,
  state,
  currentCharaNum,
  onUpdateAgentSettings,
}: AiSettingsPopupProps) {
  const settings = useAiStore((entry) => entry.settings);
  const updateSettings = useAiStore((entry) => entry.updateSettings);
  const updateCharacterProfile = useAiStore((entry) => entry.updateCharacterProfile);
  const debugEntries = useAiStore((entry) => entry.debugEntries);
  const clearDebug = useAiStore((entry) => entry.clearDebug);
  const [activeTab, setActiveTab] = useState<SettingsTab>("features");
  const [showPrompt, setShowPrompt] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const characters = useMemo(() => Object.values(state?.charas ?? {})
    .filter((slot) => slot.charaNum > 0)
    .sort((left, right) => left.charaNum - right.charaNum), [state]);
  const [profileCharaNum, setProfileCharaNum] = useState(() =>
    currentCharaNum && currentCharaNum > 0 ? currentCharaNum : characters[0]?.charaNum ?? 1);
  const profile = currentAiCharacterProfile(profileCharaNum);
  const runtime = state?.agentRuntime;
  const latest = debugEntries[0];
  const models = useMemo(() => [...new Set([
    ...availableModels,
    ...(settings.model.trim() ? [settings.model.trim()] : []),
  ])].sort((left, right) => left.localeCompare(right)), [availableModels, settings.model]);

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

  const setAiEnabled = (enabled: boolean) => {
    updateSettings({ enabled });
    if (!enabled) {
      cancelAllRealtimeAiKojo();
      onUpdateAgentSettings?.({ masterEnabled: false });
    }
  };

  return (
    <div className="ai-settings__scrim" data-testid="ai-settings-scrim" onClick={onClose}>
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
                <h3>即时功能</h3>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={settings.kojoEnabled}
                    disabled={!settings.enabled}
                    onChange={(event) => updateSettings({ kojoEnabled: event.target.checked })}
                  />
                  <span>AI 口上补全</span>
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
                <details className="ai-settings__details">
                  <summary>口上补全范围</summary>
                  <div className="ai-settings__details-body">
                    {FAMILY_OPTIONS.map((family) => (
                      <label key={family.id} className="ai-settings__toggle">
                        <input
                          type="checkbox"
                          checked={settings.kojoFamilies.includes(family.id)}
                          disabled={!settings.enabled || !settings.kojoEnabled}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...settings.kojoFamilies, family.id]
                              : settings.kojoFamilies.filter((id) => id !== family.id);
                            updateSettings({ kojoFamilies: next });
                          }}
                        />
                        <span>{family.label}</span>
                      </label>
                    ))}
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
                <h3>角色智能体</h3>
                <label className="ai-settings__toggle">
                  <input
                    type="checkbox"
                    checked={runtime?.settings.masterEnabled ?? false}
                    disabled={!settings.enabled || !runtime || !onUpdateAgentSettings}
                    onChange={(event) => onUpdateAgentSettings?.({ masterEnabled: event.target.checked })}
                  />
                  <span>夜间记忆、目标与日计划</span>
                </label>
                <label className="ai-settings__compact-field">
                  <span>活跃角色上限</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
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
                  placeholder="https://api.minimaxi.com/v1"
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
                      ? `已发现 ${availableModels.length} 个模型`
                      : "尚未读取模型"}
              </p>
              <div className="ai-settings__row">
                <label>
                  <span>超时（毫秒）</span>
                  <input
                    type="number"
                    min={1000}
                    max={60000}
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
                <span>允许该角色使用 AI 口上</span>
              </label>
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
            </div>
          )}

          {activeTab === "debug" && (
            <div className="ai-settings__pane ai-settings__debug" role="tabpanel">
              <div className="ai-settings__debug-head">
                <span>最近请求</span>
                <button type="button" onClick={clearDebug}>清空</button>
              </div>
              {latest ? (
                <>
                  <div className={`ai-settings__status ai-settings__status--${latest.status}`}>
                    {latest.status} · COM {latest.commandNo} · 角色 {latest.target}
                    {latest.durationMs !== undefined ? ` · ${latest.durationMs}ms` : ""}
                  </div>
                  {latest.error && <pre>{latest.error}</pre>}
                  <button type="button" onClick={() => setShowPrompt((value) => !value)}>
                    {showPrompt ? "隐藏详情" : "查看详情"}
                  </button>
                  {showPrompt && (
                    <pre className="ai-settings__trace">
                      {latest.prompt ?? ""}
                      {latest.response ? `\n\n--- RESPONSE ---\n${latest.response}` : ""}
                    </pre>
                  )}
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
