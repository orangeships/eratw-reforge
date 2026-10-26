import { useEffect, useState } from "react";
import { useManifestStore } from "../state/manifest-store";

/**
 * SyncStatusPill — Phase 2.4.
 *
 * Three-state indicator in the header, fed by the `watchStatus` slot in
 * the manifest store (which is updated by the Rust fs watcher via
 * `manifest://rebuilt` / `manifest://error` events).
 *
 *   synced    → green dot,  "已同步", shows last rebuild time
 *   rebuilding → yellow dot + spinner, "正在重建..."
 *   error     → red dot,    "重建失败", tooltip with stderr tail
 *   idle      → grey dot,   "未启用" (no project selected)
 */
export default function SyncStatusPill() {
  const watchStatus = useManifestStore((s) => s.watchStatus);
  const lastRebuiltAt = useManifestStore((s) => s.lastRebuiltAt);
  const lastDurationMs = useManifestStore((s) => s.lastDurationMs);
  const watchError = useManifestStore((s) => s.watchError);

  // Tick once a minute so the "x minutes ago" label stays fresh.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const label = (() => {
    switch (watchStatus) {
      case "idle":
        return "未启用";
      case "synced":
        if (lastRebuiltAt) {
          const ago = formatAgo(Date.now() - lastRebuiltAt);
          return lastDurationMs != null
            ? `已同步 · ${ago} · ${(lastDurationMs / 1000).toFixed(1)}s`
            : `已同步 · ${ago}`;
        }
        // Watcher is armed; no rebuilds have happened yet (or none needed).
        return "已就绪";
      case "rebuilding":
        return "正在重建…";
      case "error":
        return "重建失败";
    }
  })();

  return (
    <div
      className={`status-pill status-pill--${watchStatus}`}
      role="status"
      aria-live="polite"
      title={
        watchStatus === "error" && watchError
          ? watchError
          : watchStatus === "synced" && lastRebuiltAt
            ? `last rebuild at ${new Date(lastRebuiltAt).toISOString()}`
            : ""
      }
    >
      {watchStatus === "rebuilding" && (
        <span className="status-pill__spinner" aria-hidden="true" />
      )}
      <span className="status-pill__dot" aria-hidden="true" />
      <span className="status-pill__label">{label}</span>
    </div>
  );
}

function formatAgo(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 5) return "刚刚";
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}
