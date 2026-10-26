import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { portraitKindOf } from "../../../modernization/runtime/state/portrait-kind.js";
import { DEFAULT_UI_PREFERENCES, useUiPreferences } from "../state/ui-preferences.js";
import { useSceneBackgroundEnabled, setSceneBackgroundEnabled } from "../state/scene-display-settings.js";
import AiSettingsPopup from "../ai/AiSettingsPopup.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useAiStore } from "../ai/store.js";

export default function OptionsPanel({ state, onTogglePortraitKind, onClose }: {
  state: GameState; onTogglePortraitKind?: () => void; onClose: () => void;
}) {
  const prefs = useUiPreferences();
  const background = useSceneBackgroundEnabled();
  const [aiOpen, setAiOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [displayError, setDisplayError] = useState("");
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    setDisplayError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setDisplayError("当前窗口无法切换全屏，请使用窗口自身的全屏功能。"); }
  };
  const ai = useAiStore(s => s.settings);
  const updateAgentSettings = useGameStateStore(s => s.updateAgentSettingsAction);
  return <><div className="game-options" data-testid="morning-option">
    <p className="game-options__intro">调整属于你的幻想乡。显示设置即时生效，并保存在当前设备。</p>
    <section className="game-options__section" aria-label="阅读与界面">
      <h3>阅读与界面 <small>DISPLAY</small></h3>
      <label className="game-options__row">字体大小 <span>{Math.round(prefs.fontScale * 100)}%</span>
        <input aria-label="字体大小" type="range" min="80" max="130" step="5" value={prefs.fontScale * 100} onChange={e => prefs.update({ fontScale: Number(e.target.value) / 100 })} />
      </label>
      <p className="game-options__hint">随窗口宽高自动缩放，此处调整阅读倍率。</p>
      <label className="game-options__row">口上行距 <span>{prefs.lineHeight.toFixed(1)}</span>
        <input aria-label="口上行距" type="range" min="1.3" max="1.9" step="0.1" value={prefs.lineHeight} onChange={e => prefs.update({ lineHeight: Number(e.target.value) })} />
      </label>
      <label className="game-options__select">文字显示速度
        <select aria-label="文字显示速度" value={prefs.textSpeed} onChange={e => prefs.update({ textSpeed: Number(e.target.value) })}>
          <option value="0.5">舒缓</option><option value="1">标准</option><option value="2">快速</option><option value="0">立即显示</option>
        </select>
      </label>
      <label className="game-options__toggle"><span>口上渐隐<small>从最新台词平滑过渡至显示区域顶部</small></span><input type="checkbox" checked={prefs.dialogueFade} onChange={e => prefs.update({ dialogueFade: e.target.checked })} /></label>
      <label className="game-options__toggle"><span>减少动态效果<small>立即显示弹窗，停用界面装饰动画</small></span><input type="checkbox" checked={prefs.reducedMotion} onChange={e => prefs.update({ reducedMotion: e.target.checked })} /></label>
      <button type="button" disabled={!document.fullscreenEnabled} onClick={() => void toggleFullscreen()}>{fullscreen ? "退出全屏" : "进入全屏"}</button>
      {displayError && <p className="game-options__hint" role="status">{displayError}</p>}
    </section>
    <section className="game-options__section" aria-label="场景与立绘">
      <h3>场景与立绘 <small>SCENE</small></h3>
      <label className="game-options__toggle"><span>场景背景<small>显示当前地点的场景画面</small></span><input type="checkbox" checked={background} onChange={e => setSceneBackgroundEnabled(e.target.checked)} /></label>
      <button type="button" data-testid="morning-option-toggle-portrait-kind" disabled={!onTogglePortraitKind} onClick={onTogglePortraitKind}>[3] 角色绘的类型 — {portraitKindOf(state) === "face" ? "颜绘" : "立绘"}</button>
    </section>
    <section className="game-options__section" aria-label="AI 辅助">
      <h3>AI 辅助 <small>AI</small></h3>
      <p className="game-options__hint">当前{ai.enabled ? "已开启" : "已关闭"} · {ai.model || "尚未选择模型"}</p>
      <p className="game-options__hint">在 AI 设置中管理口上、场景互动、角色认知及故事功能，也可配置连接、提示词和超时。</p>
      <button type="button" className="game-options__primary" onClick={() => setAiOpen(true)}>打开 AI 设置 →</button>
    </section>
    <footer className="game-options__footer">
      <button type="button" onClick={() => prefs.update(DEFAULT_UI_PREFERENCES)}>恢复阅读默认值</button>
      <button type="button" data-testid="morning-option-close" onClick={onClose}>完成</button>
    </footer>
  </div>{aiOpen && createPortal(<AiSettingsPopup state={state} onUpdateAgentSettings={updateAgentSettings} onClose={() => setAiOpen(false)} />, document.body)}</>;
}
