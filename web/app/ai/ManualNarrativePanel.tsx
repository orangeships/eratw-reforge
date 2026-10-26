import { useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { NARRATIVE_PLAYER_INTENT_MAX_LENGTH } from "../../../modernization/runtime/story/types.js";
import { unavailableNarrativeIntentCharacters } from "../../../modernization/runtime/story/director.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useAiStore } from "./store.js";
import NarrativeStatusPanel from "./NarrativeStatusPanel.js";

export interface ManualNarrativePanelProps {
  state: GameState;
  onTriggerNarrative: (playerIntent?: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * 手动触发 L3 叙事导演的面板。玩家可以输入自定义意图（比如想构建什么故事），
 * 后台根据玩家意图开启 L3。如果玩家有意图就按玩家思路走，否则按原有自动流程。
 */
export default function ManualNarrativePanel({
  state,
  onTriggerNarrative,
  onClose,
}: ManualNarrativePanelProps) {
  const [playerIntent, setPlayerIntent] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const directorStatus = useGameStateStore(s => s.narrativeDirectorStatus);
  const settings = useAiStore(s => s.settings);
  const busy = triggering || directorStatus !== null;
  const unavailableNames = unavailableNarrativeIntentCharacters(state, playerIntent);
  const enabled = settings.enabled && settings.narrativeEnabled && settings.apiKey.trim().length > 0
    && state.agentRuntime?.settings.masterEnabled === true;

  const handleTrigger = async (): Promise<void> => {
    setTriggering(true);
    setResult(null);
    try {
      const intent = playerIntent.trim();
      const success = await onTriggerNarrative(intent || undefined);
      if (success) {
        setResult("候选故事方向已生成（这一步不会创建剧情事件）。请在下方选择方向，继续生成开场与剧情结构；实际结果以下方状态为准。");
      } else {
        const latest = useAiStore.getState().debugEntries.find(entry => entry.feature === "narrative-director");
        setResult(`本次未生成候选方向：${latest?.error ?? latest?.skipReason ?? "请求未提交，请查看下方组件状态与请求记录。"}`);
      }
    } catch (error) {
      setResult(`启动失败：${String(error)}`);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="manual-narrative" data-testid="manual-narrative-panel">
      <p className="morning-menu__message">
        手动触发 L3 叙事导演。你可以输入想要构建的故事意图，AI 会根据你的想法和当前情况生成叙事事件。
        如果不输入意图，AI 会自行拟定候选方向供你选择。
      </p>
      <p className="morning-menu__note">当前地点：{state.master.location}</p>

      <label>
        <span className="manual-narrative__label">你的故事意图（可选）</span>
        <textarea
          data-testid="manual-narrative-intent"
          className="manual-narrative__textarea"
          rows={4}
          placeholder="例如：我想和某某角色一起去湖边散步，聊聊最近的事情..."
          value={playerIntent}
          maxLength={NARRATIVE_PLAYER_INTENT_MAX_LENGTH}
          aria-describedby="manual-narrative-intent-count"
          disabled={busy}
          onChange={(event) => setPlayerIntent(event.target.value.slice(0, NARRATIVE_PLAYER_INTENT_MAX_LENGTH))}
        />
        <span id="manual-narrative-intent-count" className="morning-menu__note">{playerIntent.length} / {NARRATIVE_PLAYER_INTENT_MAX_LENGTH} 字符</span>
      </label>

      {unavailableNames.length > 0 && <p className="morning-menu__note" role="status">
        输入提到的 {unavailableNames.join("、")} 不在当前活跃角色名单中，不能参与本幕。若是核心角色，请先调整角色名单；候选不能用其他人替代这段互动。
      </p>}

      <p className="morning-menu__note">
        流程：生成候选方向 → 你选择方向 → 生成开场 → 生成剧情结构 → 校验并创建事件。
        空白意图时 AI 会拟定候选方向，仍需你选择。结果与错误会显示在下方，无需先起床。
      </p>

      {result && (
        <p
          className="morning-menu__message"
          data-testid="manual-narrative-result"
          role="status"
        >
          {result}
        </p>
      )}

      <div className="manual-narrative__actions">
        <button
          type="button"
          data-testid="manual-narrative-trigger"
          disabled={busy || !enabled}
          onClick={handleTrigger}
        >
          {triggering ? "正在生成候选方向…" : "生成故事候选方向"}
        </button>
        <button
          type="button"
          data-testid="manual-narrative-close"
          onClick={onClose}
        >
          关闭
        </button>
      </div>
      <NarrativeStatusPanel state={state} />
    </div>
  );
}
