import { useKojoSourceStore } from "../../state/kojo-source-store.js";

export default function KojoSourceSetup() {
  const { selectedPath, validation, loading, error, pickAndValidate, clear } =
    useKojoSourceStore();

  return (
    <section className="pre-flow" data-testid="kojo-source-setup">
      <div className="pre-flow__card">
        <p className="pre-flow__eyebrow">首次启动</p>
        <h1>连接原版口上</h1>
        <p>
          本游戏不附带原版口上正文。请选择原版 eraTW 项目根目录、ERB
          目录，或“口上・メッセージ関連”目录本身。
        </p>
        <p className="muted">
          文件只在本机读取；触发对话时才解析并写入会话缓存，不会上传或改写原文件。
        </p>

        {selectedPath && <div className="path">{selectedPath}</div>}
        {validation?.isValid && (
          <div className="success-banner">口上目录已就绪，正在进入游戏。</div>
        )}
        {(error || validation?.error) && (
          <div className="error-banner">{error ?? validation?.error}</div>
        )}

        <div className="row">
          <button type="button" onClick={() => void pickAndValidate()} disabled={loading}>
            {loading ? "正在校验…" : "选择原版口上目录"}
          </button>
          {selectedPath && (
            <button type="button" className="secondary" onClick={() => void clear()} disabled={loading}>
              清除选择
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
