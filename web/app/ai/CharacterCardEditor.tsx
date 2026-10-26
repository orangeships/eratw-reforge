import { useMemo, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { AiCharacterCardOverride, AiProvider } from "./types.js";
import { buildAiCharacterCard } from "./character-card.js";
import { currentAiSettings, useAiStore } from "./store.js";
import { createOpenAiCompatibleProvider } from "./provider.js";
import {
  buildCardEditCompletion,
  diffCardOverride,
  EMPTY_CARD_OVERRIDE,
  mergeCardOverride,
  parseCardEdit,
  applyCardOverride,
  type CardOverrideDiffEntry,
} from "./character-card-ai.js";

export function CharacterCardEditor({ state, charaNum, provider }: {
  state?: Readonly<GameState>;
  charaNum: number;
  /** 测试注入；缺省用真实连接。 */
  provider?: AiProvider;
}) {
  const currentOverride = useAiStore((entry) => entry.settings.characterCardOverrides[String(charaNum)]);
  const disabledPresetFields = useAiStore((entry) => entry.settings.presetCardDisabledFields?.[String(charaNum)]);
  const updateCharacterCardOverride = useAiStore((entry) => entry.updateCharacterCardOverride);
  const [intent, setIntent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<CardOverrideDiffEntry[] | null>(null);
  const [merged, setMerged] = useState<AiCharacterCardOverride | null>(null);

  const card = useMemo(() => state
    ? buildAiCharacterCard({ state, target: charaNum, visibility: "player" })
    : null, [state, charaNum, disabledPresetFields]);
  const base = currentOverride ?? EMPTY_CARD_OVERRIDE;
  const effectiveCard = useMemo(() => (card ? applyCardOverride(card, base) : null), [card, base]);

  const generate = async (): Promise<void> => {
    const trimmed = intent.trim();
    if (!card || !trimmed || pending) return;
    const settings = currentAiSettings();
    if (!settings.enabled || !settings.baseUrl.trim() || !settings.model.trim()) {
      setError("AI 未启用或连接未配置");
      return;
    }
    const activeProvider = provider ?? createOpenAiCompatibleProvider(settings);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort("timeout"), settings.timeoutMs);
    setPending(true);
    setError(null);
    setDiff(null);
    setMerged(null);
    try {
      const raw = await activeProvider.complete(
        buildCardEditCompletion({ card: effectiveCard ?? card, override: base, playerIntent: trimmed, settings }),
        controller.signal,
      );
      const delta = parseCardEdit(raw, effectiveCard ?? card, base);
      const nextOverride = mergeCardOverride(base, delta, card);
      setMerged(nextOverride);
      setDiff(diffCardOverride(card, base, nextOverride));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      window.clearTimeout(timer);
      setPending(false);
    }
  };

  const hasOverride = Object.keys(base).some((key) => key !== "append" && key !== "remove")
    || Object.keys(base.append ?? {}).length > 0 || Object.keys(base.remove ?? {}).length > 0;

  return (
    <div className="ai-card-editor" data-testid="ai-card-editor">
      <label>
        <span>用 AI 调整角色卡（描述想调整的性格、口吻或约束）</span>
        <textarea
          data-testid="ai-card-intent"
          rows={3}
          maxLength={1000}
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
        />
      </label>
      <button type="button" data-testid="ai-card-generate" disabled={!state || pending || !intent.trim()} onClick={() => void generate()}>
        {pending ? "生成中…" : "生成修改建议"}
      </button>
      {error && <p className="ai-card-editor__error" data-testid="ai-card-error" role="alert">{error}</p>}
      {diff && merged && (
        <div data-testid="ai-card-proposal">
          <ul className="ai-card-editor__diff">
            {diff.map((entry) => (
              <li key={entry.key}>
                <strong>{entry.label}</strong>
                {entry.added.map((text) => <div key={`+${text}`}>＋ {text}</div>)}
                {entry.removed.map((text) => <div key={`-${text}`}>− {text}</div>)}
                {entry.scalarAfter !== undefined && (
                  <div className="ai-card-editor__scalar">
                    <div>− {entry.scalarBefore || "（空）"}</div>
                    <div>＋ {entry.scalarAfter || "（空）"}</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button type="button" data-testid="ai-card-apply" onClick={() => { updateCharacterCardOverride(charaNum, merged); setDiff(null); setMerged(null); setIntent(""); }}>
            应用修改
          </button>
          <button type="button" data-testid="ai-card-discard" onClick={() => { setDiff(null); setMerged(null); }}>放弃</button>
        </div>
      )}
      {hasOverride && (
        <button type="button" data-testid="ai-card-reset" onClick={() => updateCharacterCardOverride(charaNum, null)}>恢复原角色卡</button>
      )}
    </div>
  );
}
