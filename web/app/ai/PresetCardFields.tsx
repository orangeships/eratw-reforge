import { useMemo } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { buildAiCharacterCard } from "./character-card.js";
import { getKojoVoiceCard } from "./character-voice.js";
import { DEFAULT_AI_CHARACTER_LORE } from "./character-lore.generated.js";
import { disabledPresetCardFields, PRESET_CARD_FIELDS, type PresetCardField } from "./preset-card-fields.js";
import { useAiStore } from "./store.js";
import "./preset-card-fields.css";

export function PresetCardFields({ state, charaNum }: { state?: Readonly<GameState>; charaNum: number }) {
  const disabledByCharacter = useAiStore(entry => entry.settings.presetCardDisabledFields);
  const update = useAiStore(entry => entry.updateSettings);
  const disabled = disabledPresetCardFields(disabledByCharacter, charaNum);
  const raw = useMemo(() => state ? buildAiCharacterCard({ state, target: charaNum, visibility: "player", disabledPresetFields: [] }) : null, [state, charaNum]);
  const preview = (key: PresetCardField): string => {
    if (key === "preset_lore") return DEFAULT_AI_CHARACTER_LORE[charaNum] || "（无内置补充设定）";
    if (!raw) return "进入游戏后可查看预设内容";
    if (key === "reference_lines") return getKojoVoiceCard(charaNum, raw.variant)?.guidance.referenceLines.join("\n") || "（此变体无预设）";
    let value: unknown = raw;
    for (const part of key.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
    return (Array.isArray(value) ? value.join("\n") : String(value ?? "")) || "（此变体无预设）";
  };
  const save = (fields: readonly PresetCardField[]) => update({ presetCardDisabledFields: {
    ...useAiStore.getState().settings.presetCardDisabledFields, [String(charaNum)]: [...fields],
  } });
  return <details className="ai-preset-fields" data-testid="ai-preset-fields">
    <summary>预设角色卡字段 <span>{PRESET_CARD_FIELDS.length - disabled.length}/{PRESET_CARD_FIELDS.length} 启用</span></summary>
    <p>按当前角色保存，切换口上变体后仍生效。取消勾选即停止发送该预设字段，玩家补充与追加内容保留。</p>
    <div className="ai-preset-fields__actions">
      <button type="button" onClick={() => save([])}>全部启用</button>
      <button type="button" onClick={() => save(PRESET_CARD_FIELDS.map(field => field.key))}>全部停用</button>
    </div>
    {[...new Set(PRESET_CARD_FIELDS.map(field => field.group))].map(group => <fieldset key={group}>
      <legend>{group}</legend>
      {PRESET_CARD_FIELDS.filter(field => field.group === group).map(field => <div className="ai-preset-fields__row" key={field.key}>
        <label><input type="checkbox" checked={!disabled.includes(field.key)} data-testid={`preset-field-${field.key}`} onChange={event => save(event.target.checked ? disabled.filter(key => key !== field.key) : [...disabled, field.key])} /><span>{field.label}</span></label>
        <details><summary aria-label={`查看${field.label}预设`}>查看</summary><pre>{preview(field.key)}</pre></details>
      </div>)}
    </fieldset>)}
  </details>;
}
