import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUiPreferences } from "../../state/ui-preferences.js";

export function useReducedMotion(): boolean {
  const preference = useUiPreferences(s => s.reducedMotion);
  const [reduced, setReduced] = useState(() =>
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced || preference;
}

export const ASCII_NOISE = "!#$%&*+-/:;<=>?@[]^_{|}~";

const LONG_PAUSE = new Set(Array.from("。！？!?…」』～♪"));
const SHORT_PAUSE = new Set(Array.from("、，,；;：:"));

/** Delay after `ch` is printed. Sentence ends hold longer than commas. */
export function typewriterDelay(ch: string, base: number): number {
  if (LONG_PAUSE.has(ch)) return base * 6;
  if (SHORT_PAUSE.has(ch)) return base * 3;
  return base;
}

/** Base per-character delay. Long lines type faster so a paragraph never stalls the box. */
export function typewriterBase(length: number, backlog = 0): number {
  const base = Math.max(14, Math.min(34, Math.floor(3_200 / Math.max(1, length))));
  return Math.max(6, Math.floor(base / (1 + Math.max(0, backlog))));
}

export interface TypewriterState {
  /** Characters (code units, surrogate-safe) currently visible. */
  shown: number;
  done: boolean;
  complete: () => void;
}

/**
 * Reveals `text` one glyph at a time. The same `key` keeps progress when the
 * text grows (streamed chunks extend the line instead of restarting it).
 */
export function useTypewriter(text: string, options: { key: string; active: boolean; backlog?: number }): TypewriterState {
  const reduced = useReducedMotion();
  const speed = useUiPreferences(s => s.textSpeed);
  const [progress, setProgress] = useState({ key: options.key, shown: options.active ? 0 : text.length });
  const current = progress.key === options.key ? progress.shown : options.active ? 0 : text.length;
  const enabled = options.active && !reduced && speed > 0;
  const shown = enabled ? Math.min(current, text.length) : text.length;
  const done = shown >= text.length;
  const backlog = options.backlog ?? 0;

  useEffect(() => {
    if (progress.key !== options.key) setProgress({ key: options.key, shown: options.active ? 0 : text.length });
  }, [options.key, options.active, progress.key, text.length]);

  useEffect(() => {
    if (!enabled || done || progress.key !== options.key) return;
    const previous = shown > 0 ? text[shown - 1] ?? "" : "";
    const delay = shown === 0 ? 0 : typewriterDelay(previous, typewriterBase(text.length, backlog)) / Math.max(.5, speed);
    const timer = window.setTimeout(() => {
      setProgress((p) => {
        if (p.key !== options.key) return p;
        const code = text.charCodeAt(p.shown);
        const step = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
        return { key: p.key, shown: Math.min(text.length, p.shown + step) };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, done, shown, text, backlog, speed, options.key, progress.key]);

  const complete = useCallback(() => {
    setProgress({ key: options.key, shown: Number.MAX_SAFE_INTEGER });
  }, [options.key]);

  return { shown, done, complete };
}

/** Visual-only glyph at the typing head; changes with each printed character. */
export function noiseGlyph(seed: number): string {
  return ASCII_NOISE[Math.abs(Math.imul(seed + 1, 2654435761) >>> 0) % ASCII_NOISE.length]!;
}

export function TypingHead({ seed }: { seed: number }) {
  return (
    <span className="ascii-type-head" aria-hidden="true">
      <span className="ascii-type-head__noise">{noiseGlyph(seed)}</span>
      <span className="ascii-cursor">_</span>
    </span>
  );
}

/** Spinner for a reply that has not produced its first glyph yet. */
export function AsciiSpinner({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 110);
    return () => window.clearInterval(timer);
  }, [reduced]);
  const frames = "|/-\\";
  return (
    <span className="ascii-spinner">
      <span className="ascii-spinner__frame" aria-hidden="true">[{reduced ? "*" : frames[tick % 4]}]</span>
      {" "}{label}<span className="ascii-spinner__dots" aria-hidden="true">{reduced ? "……" : ".".repeat((tick >> 1) % 4).padEnd(3, " ")}</span>
    </span>
  );
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function formatNumber(value: number, grouped: boolean): string {
  return grouped ? value.toLocaleString() : String(value);
}

/**
 * The text node is always the authoritative value. While a change animates, the
 * text is painted transparent and a CSS overlay (`data-roll`) counts toward it.
 */
export function AsciiNumber({ value, grouped = false, prefix = "", suffix = "" }: { value: number; grouped?: boolean; prefix?: string; suffix?: string }) {
  const previous = useRef(value);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const [change, setChange] = useState<{ delta: number; sequence: number } | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const from = previous.current;
    const delta = value - from;
    previous.current = value;
    const el = valueRef.current;
    if (!delta || reduced || !el) return;
    setChange((last) => ({ delta, sequence: (last?.sequence ?? 0) + 1 }));
    const duration = Math.min(700, 260 + Math.log10(Math.abs(delta) + 1) * 120);
    let frame = 0;
    let start: number | null = null;
    const paint = (n: number) => { el.dataset.roll = `${prefix}${formatNumber(n, grouped)}${suffix}`; };
    paint(from);
    el.classList.add("ascii-number__value--rolling");
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      paint(Math.round(from + delta * easeOutCubic(t)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else el.classList.remove("ascii-number__value--rolling");
    };
    frame = requestAnimationFrame(tick);
    const timeout = window.setTimeout(() => setChange(null), 1_200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      el.classList.remove("ascii-number__value--rolling");
    };
  }, [value, reduced, prefix, suffix, grouped]);

  const tone = change ? (change.delta < 0 ? " ascii-number--loss" : " ascii-number--gain") : "";
  return (
    <span className={`ascii-number${tone}`}>
      <span ref={valueRef} className="ascii-number__value">{`${prefix}${formatNumber(value, grouped)}${suffix}`}</span>
      {change && !reduced && (
        <span key={change.sequence} className={`ascii-number__delta${change.delta < 0 ? " ascii-number__delta--loss" : ""}`} data-delta={`${change.delta > 0 ? "+" : ""}${change.delta}`} aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * Solid-block resource bar. When the fill changes, cells step toward the new count;
 * gained cells flash bright, lost cells drain in red.
 */
export function AsciiBar({ fill01, cells, fillChar = "█", emptyChar = "." }: { fill01: number; cells: number; fillChar?: string; emptyChar?: string }) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, fill01)) * cells)));
  const [anim, setAnim] = useState({ from: target, shown: target });
  const settled = useRef(target);

  useEffect(() => {
    const from = settled.current;
    settled.current = target;
    if (reduced || target === from) { setAnim({ from: target, shown: target }); return; }
    const direction = target > from ? 1 : -1;
    let n = from;
    let hold = 0;
    setAnim({ from, shown: from });
    const timer = window.setInterval(() => {
      n += direction;
      setAnim({ from, shown: n });
      if (n === target) {
        window.clearInterval(timer);
        hold = window.setTimeout(() => setAnim({ from: target, shown: target }), 360);
      }
    }, Math.max(18, Math.floor(360 / Math.abs(target - from))));
    return () => { window.clearInterval(timer); window.clearTimeout(hold); };
  }, [target, reduced]);

  const visible = reduced ? target : anim.shown;
  const from = reduced ? target : anim.from;
  const base = Math.min(from, visible, target);
  const gain = visible > from ? visible - base : 0;
  const loss = visible > target ? visible - Math.max(base, target) : 0;
  const steady = visible - gain - loss;
  return (
    <span className="ascii-bar" aria-hidden="true">
      [<span className="ascii-bar__filled" style={{ width: `${Math.max(0, steady)}ch` }}>{fillChar.repeat(Math.max(0, steady))}</span>
      {gain > 0 && <span className="ascii-bar__gain" style={{ width: `${gain}ch` }}>{fillChar.repeat(gain)}</span>}
      {loss > 0 && <span className="ascii-bar__loss" style={{ width: `${loss}ch` }}>{fillChar.repeat(loss)}</span>}
      <span className="ascii-bar__empty">{emptyChar.repeat(Math.max(0, cells - visible))}</span>]
    </span>
  );
}

/** Plain text only. Never interprets authored dialogue as HTML or effect markup. */
export function AsciiText({ text, animate = false, typingKey }: { text: string; animate?: boolean; typingKey?: string }) {
  const typed = useTypewriter(text, { key: typingKey ?? text, active: animate });
  if (!animate || typed.done) return <span>{text}</span>;
  return (
    <span className="ascii-text">
      <span className="ascii-sr-only">{text}</span>
      <span aria-hidden="true">{text.slice(0, typed.shown)}<TypingHead seed={typed.shown} /></span>
    </span>
  );
}
