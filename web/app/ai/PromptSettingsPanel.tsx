import { useMemo, useState } from "react";
import {
  AI_PROMPT_LAYER_ORDER,
  AI_PROMPT_LAYER_TITLES,
  AI_PROMPT_MODE_TITLES,
  AI_PROMPT_SLOTS,
  AI_PROMPT_SLOT_LIMIT,
  withoutPromptOverride,
  withPromptOverride,
  type AiPromptMode,
  type AiPromptSlotDef,
} from "./prompt-catalog.js";
import { AI_PROMPT_DEFAULTS } from "./prompt-defaults.js";
import { useAiStore } from "./store.js";

interface PromptGroup {
  title: string;
  slots: AiPromptSlotDef[];
}

function groupSlots(mode: AiPromptMode): PromptGroup[] {
  const groups: PromptGroup[] = [];
  for (const slot of AI_PROMPT_SLOTS) {
    if ((slot.mode ?? "daily") !== mode) continue;
    const title = slot.group;
    const existing = groups.find((group) => group.title === title);
    if (existing) existing.slots.push(slot);
    else groups.push({ title, slots: [slot] });
  }
  return groups;
}

export default function PromptSettingsPanel() {
  const [mode, setMode] = useState<AiPromptMode>("daily");
  const overrides = useAiStore((state) => state.settings.promptOverrides);
  const updateSettings = useAiStore((state) => state.updateSettings);
  const groups = useMemo(() => groupSlots(mode), [mode]);
  const visibleSlots = groups.flatMap((group) => group.slots);
  const editedCount = visibleSlots.filter((slot) => overrides[slot.id] !== undefined).length;

  return (
    <div className="ai-settings__prompt-editor" data-testid="ai-prompt-editor">
      <p className="ai-settings__note">
        下面是会参与发送的可编辑提示词块，按功能分组。改动立刻作用于下一次请求，并保存到本机。
        生成时会根据场景自动选用日常或 H 提示词；这里的切换只改变正在编辑的内容。事实、人物卡、历史与输出格式仍由游戏提供；清空文本框等于恢复默认。
      </p>
      <div className="ai-settings__prompt-mode-switch" role="group" aria-label="提示词编辑模式">
        {(["daily", "h"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={mode === entry}
            aria-controls="ai-prompt-mode-panel"
            onClick={() => setMode(entry)}
          >
            {AI_PROMPT_MODE_TITLES[entry]}
          </button>
        ))}
      </div>
      {mode === "h" && (
        <p className="ai-settings__note">“H 场景写法”在角色清醒且非时停时使用；“H 场景时停任务”只在时停时使用。</p>
      )}
      {editedCount > 0 && (
        <div className="ai-settings__prompt-head">
          <span className="ai-settings__note">当前模式已修改 {editedCount} 块</span>
          <button type="button" onClick={() => updateSettings({
            promptOverrides: visibleSlots.reduce((next, slot) => withoutPromptOverride(next, slot.id), overrides),
          })}>当前模式全部恢复默认</button>
        </div>
      )}
      <div id="ai-prompt-mode-panel" aria-label={AI_PROMPT_MODE_TITLES[mode]}>
        {AI_PROMPT_LAYER_ORDER.map((layer) => (
          <section className="ai-settings__section" key={layer}>
            <h3>{AI_PROMPT_LAYER_TITLES[layer]}</h3>
            {groups.map((group) => (
              <div className="ai-settings__prompt-group" key={group.title}>
                <strong>{group.title}</strong>
                {group.slots.map((slot) => {
                  const defaultText = AI_PROMPT_DEFAULTS[slot.id];
                  const override = overrides[slot.id];
                  const edited = override !== undefined;
                  return (
                    <details className="ai-settings__details" key={slot.id}>
                      <summary data-testid={`ai-prompt-summary-${slot.id}`}>
                        <span>{slot.title}</span>
                        {edited && <span className="ai-settings__prompt-badge">已修改</span>}
                        {slot.hasOutputContract && (
                          <span className="ai-settings__prompt-badge ai-settings__prompt-badge--warn">含输出格式</span>
                        )}
                        <span className="ai-settings__note">{(override ?? defaultText).length} 字</span>
                      </summary>
                      <div className="ai-settings__details-body">
                        <textarea
                          aria-label={slot.title}
                          data-testid={`ai-prompt-${slot.id}`}
                          rows={10}
                          spellCheck={false}
                          value={override ?? defaultText}
                          onChange={(event) => updateSettings({
                            promptOverrides: withPromptOverride(overrides, slot.id, event.target.value),
                          })}
                        />
                        <div className="ai-settings__prompt-head">
                          <span className="ai-settings__note">
                            {edited ? `已修改 · 默认 ${defaultText.length} 字` : "使用默认"}
                            {` · 上限 ${AI_PROMPT_SLOT_LIMIT} 字`}
                          </span>
                          <button
                            type="button"
                            disabled={!edited}
                            onClick={() => updateSettings({
                              promptOverrides: withoutPromptOverride(overrides, slot.id),
                            })}
                          >
                            恢复默认
                          </button>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
