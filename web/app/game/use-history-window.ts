import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { eventInstanceKey } from "./event-merge.js";

const ESTIMATED_ROW_HEIGHT = 28;
const OVERSCAN = 400;

/** Keep the complete timeline scrollable while mounting only viewport rows.
 * Measured heights include paragraph margins and survive cloned event objects. */
export function useHistoryWindow(events: readonly ObservationEvent[], container: RefObject<HTMLDivElement>, enabled: boolean) {
  const sizes = useRef(new Map<number, { key: string; height: number }>());
  const followBottom = useRef(true);
  const previousLength = useRef(events.length);
  const previousWidth = useRef(0);
  const [viewport, setViewport] = useState({ top: Infinity, height: 600, width: 0 });
  const [measurement, setMeasurement] = useState(0);
  const offsets = useMemo(() => {
    if (!enabled) return [0];
    const result = [0];
    for (let index = 0; index < events.length; index += 1) {
      const size = sizes.current.get(index);
      result.push(result[index]! + (size?.key === eventInstanceKey(events[index]!) ? size.height : ESTIMATED_ROW_HEIGHT));
    }
    return result;
  }, [events, enabled, measurement]);
  const total = offsets[offsets.length - 1]!;
  const top = Math.min(viewport.top, Math.max(0, total - viewport.height));
  const findRow = (position: number): number => {
    let low = 0, high = events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1]! <= position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = enabled ? findRow(Math.max(0, top - OVERSCAN)) : 0;
  const end = enabled ? Math.min(events.length, findRow(top + viewport.height + OVERSCAN) + 1) : events.length;

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !enabled) return;
    const resize = () => {
      const height = element.clientHeight || 600;
      const width = element.clientWidth;
      if (previousWidth.current !== width) sizes.current.clear();
      previousWidth.current = width;
      setViewport((old) => old.height === height && old.width === width ? old : { ...old, height, width });
      setMeasurement((value) => value + 1);
    };
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, [container, enabled]);

  // Streaming/typewriter output can grow without rerendering its parent.
  // Observe mounted rows too so spacers follow their actual wrapped height.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !enabled || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => setMeasurement((value) => value + 1));
    for (const row of element.querySelectorAll("[data-history-index]")) observer.observe(row);
    return () => observer.disconnect();
  }, [container, enabled, start, end]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !enabled) return;
    if (previousLength.current !== events.length) {
      if (events.length < previousLength.current) sizes.current.clear();
      previousLength.current = events.length;
      followBottom.current = true;
    }
    let changed = false;
    for (const row of element.querySelectorAll<HTMLElement>("[data-history-index]")) {
      const index = Number(row.dataset.historyIndex);
      const height = row.getBoundingClientRect().height;
      if (height <= 0) continue;
      const key = eventInstanceKey(events[index]!);
      const previous = sizes.current.get(index);
      if (previous?.key !== key || Math.abs(previous.height - height) > 0.5) {
        sizes.current.set(index, { key, height });
        changed = true;
      }
    }
    if (changed) setMeasurement((value) => value + 1);
    if (followBottom.current) {
      element.scrollTop = element.scrollHeight;
      setViewport((old) => old.top === Infinity ? old : { ...old, top: Infinity });
    }
  }, [container, enabled, events, start, end, total, measurement]);

  return {
    start, end,
    before: enabled ? offsets[start]! : 0,
    after: enabled ? total - offsets[end]! : 0,
    onScroll: () => {
      const element = container.current;
      if (!element || !enabled) return;
      followBottom.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
      const nextTop = followBottom.current ? Infinity : element.scrollTop;
      setViewport((old) => old.top === nextTop ? old : { ...old, top: nextTop });
    },
  };
}
