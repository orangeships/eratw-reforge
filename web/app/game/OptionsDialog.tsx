import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import OptionsPanel from "./OptionsPanel.js";

export default function OptionsDialog({ state, onClose, onTogglePortraitKind }: {
  state: GameState; onClose: () => void; onTogglePortraitKind?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".ai-settings__scrim")) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const controls = Array.from(panel.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"))
        .filter(control => control.tabIndex >= 0 && !control.matches(":disabled"))
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="morning-menu__modal-scrim" data-testid="morning-menu-panel" onClick={onClose}>
    <div className="morning-menu__modal" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="OPTION" onClick={e => e.stopPropagation()}>
      <div className="morning-menu__modal-head"><span>OPTION · 游戏设置</span><button type="button" data-testid="morning-panel-close" aria-label="关闭设置" onClick={onClose}>×</button></div>
      <div className="morning-menu__modal-body"><OptionsPanel state={state} onTogglePortraitKind={onTogglePortraitKind} onClose={onClose} /></div>
    </div>
  </div>, document.body);
}
