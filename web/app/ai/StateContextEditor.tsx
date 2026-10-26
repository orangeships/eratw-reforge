import { useState } from "react";
import { compileStateTopics, getStateTopics, resolveStateContext, stateFieldCatalog, type StateRoute } from "../../../modernization/runtime/ai-state/context.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { useAiStore } from "./store.js";

export function StateContextEditor({ state, target }: { state?: Readonly<GameState>; target?: number }) {
  const [draft, setDraft] = useState(() => JSON.stringify(getStateTopics(), null, 2));
  const [cue, setCue] = useState("昨天做的料理");
  const [route, setRoute] = useState<StateRoute>("l1");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  return <details>
    <summary>语义状态主题编辑与预览</summary>
    <p>修改别名、关联和优先级后应用，下一次请求即生效。读取权限与关系写入限制不能在这里扩大。</p>
    <details><summary>可用字段目录（可复制 ID 到 fields）</summary><pre className="ai-settings__trace">{JSON.stringify(stateFieldCatalog(), null, 2)}</pre></details>
    <textarea aria-label="语义主题 JSON" rows={12} value={draft} onChange={e => setDraft(e.target.value)} />
    <button type="button" onClick={() => {
      try {
        if (draft.length > 64000) throw new Error("配置超过 64KB");
        const parsed = JSON.parse(draft); compileStateTopics(parsed);
        useAiStore.getState().updateSettings({ stateTopics: parsed }); setMessage("已应用并保存");
      } catch (error) { setMessage(String(error)); }
    }}>应用主题</button>
    <button type="button" onClick={() => {
      useAiStore.getState().updateSettings({ stateTopics: undefined });
      setDraft(JSON.stringify(getStateTopics(), null, 2)); setMessage("已恢复内置主题");
    }}>恢复默认</button>
    <p role="status">{message}</p>
    <label>预览输入<input value={cue} onChange={e => setCue(e.target.value)} /></label>
    <select aria-label="预览层级" value={route} onChange={e => setRoute(e.target.value as StateRoute)}>
      <option value="l1">L1 角色口上</option><option value="l2">L2 角色认知</option><option value="l3">L3 导演</option>
    </select>
    <button type="button" disabled={!state || !target} onClick={() => {
      if (state && target) setPreview(JSON.stringify(resolveStateContext({ state, observer: target, cue, route }), null, 2));
    }}>预览当前角色</button>
    {preview && <pre className="ai-settings__trace">{preview}</pre>}
  </details>;
}
