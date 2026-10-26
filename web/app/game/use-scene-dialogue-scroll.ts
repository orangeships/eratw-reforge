import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Fade by physical distance across the visible region, independently of row count. */
export function paintSceneDialogueFade(viewport: HTMLElement): void {
  const rows = Array.from(viewport.querySelectorAll<HTMLElement>("[data-scene-dialogue-line]"));
  const bounds = viewport.getBoundingClientRect();
  const rects = rows.map(row => row.getBoundingClientRect());
  const visible = rects.filter(rect => rect.top < bounds.bottom && rect.bottom > bounds.top);
  const last = visible.at(-1);
  const bottom = last ? Math.min(bounds.bottom, (last.top + last.bottom) / 2) : bounds.bottom;
  for (const [index, row] of rows.entries()) {
    const rect = rects[index]!;
    const progress = bounds.height > 0
      ? Math.max(0, Math.min(1, ((rect.top + rect.bottom) / 2 - bounds.top) / Math.max(1, bottom - bounds.top)))
      : (index + 1) / Math.max(1, rows.length);
    row.style.opacity = String(.22 + .78 * progress);
  }
}

export function useSceneDialogueScroll(content: unknown, owner?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const automaticScrollTop = useRef<number | null>(null);
  const update = useCallback(() => {
    const viewport = ref.current;
    if (!viewport) return;
    if (pinned.current) {
      viewport.scrollTop = viewport.scrollHeight;
      automaticScrollTop.current = viewport.scrollTop;
    }
    paintSceneDialogueFade(viewport);
  }, []);
  useLayoutEffect(() => { if (owner !== undefined) pinned.current = true; }, [owner]);
  useLayoutEffect(update, [content, owner, update]);
  useEffect(() => {
    const viewport = ref.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [update, owner]);
  const onScroll = useCallback(() => {
    const viewport = ref.current;
    if (!viewport) return;
    // A browser dispatches scroll asynchronously. More text may already have
    // arrived after our last scroll assignment; that is not a reader scrolling
    // into history. Only a changed offset can release the bottom pin.
    if (automaticScrollTop.current === null || Math.abs(viewport.scrollTop - automaticScrollTop.current) > 1) {
      pinned.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 8;
    }
    paintSceneDialogueFade(viewport);
  }, []);
  return { ref, onScroll };
}
