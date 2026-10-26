import type { MotionGlyph } from "./scene-motion.js";

export interface NativeSceneMotion {
  version: number; cols: number; rows: number; cellHeight: number;
  cells: readonly (readonly [number, number, string, readonly number[], number])[];
  /** Creator-authored horizontal sway: anchor x, row, glyph, color, amplitude, radians/sec, phase. */
  sways?: readonly (readonly [number, number, string, readonly number[], number, number, number])[];
  /** Source firefly bounds, initial position, heading and blink phase. */
  fireflies?: readonly { bounds: readonly [number, number, number, number]; seeds: readonly { x: number; y: number; a: number; ph: number }[] }[];
  particles: readonly { chars: string; sway: number; seeds: readonly { x: number; y: number; vx: number; vy: number; ph: number; color: readonly number[] }[] }[];
}
// Same integer hash and 15fps tag formulas as the creator HTML example.
function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const rgb = (color: readonly number[], scale = 1) => `rgb(${color.map((v) => Math.max(0, Math.min(255, (v * scale) | 0))).join(",")})`;
// Sum the source particle's per-frame sway without replaying a growing history.
const waveSum = (phase: number, step: number, n: number, cosine = false) =>
  (cosine ? Math.cos : Math.sin)(phase + step * (n + 1) / 2) * Math.sin(n * step / 2) / Math.sin(step / 2);

export function nativeSceneGlyphs(data: NativeSceneMotion, seconds: number): MotionGlyph[] {
  const frame = Math.floor(seconds * 15);
  const result: MotionGlyph[] = data.cells.map(([x, y, text, color, tag]) => {
    let scale = 1, glyph = text;
    if (tag === 1) scale = 0.84 + 0.16 * Math.sin(frame * 0.85 + x * 1.3 + y) * Math.sin(frame * 0.37 + y);
    else if (tag === 2 && hash(x, y, 300) < 0.3) scale = 0.55 + 0.45 * Math.sin(frame * 0.25 + hash(x, y, 301) * 20);
    else if (tag === 3 || tag === 4) {
      const h = hash(x, y + (frame >> 1) * 7, 302);
      glyph = tag === 3 ? (h < 0.12 ? " " : "=-~"[Math.floor(h * 3)]) : h < 0.6 ? text : h < 0.8 ? "~" : "-";
    }
    return { x, y, text: glyph, color: rgb(color, scale), alpha: 1, native: true };
  });
  for (const [anchorX, y, text, color, amplitude, speed, phase] of data.sways ?? []) {
    const x = Math.round(anchorX + amplitude * Math.sin(frame / 15 * speed + phase));
    if (x >= 0 && x < data.cols && y >= 0 && y < data.rows) {
      result.push({ x, y, text, color: rgb(color), alpha: 1, native: true });
    }
  }
  for (const effect of data.particles) effect.seeds.forEach((p, index) => {
    // Source spawn/color/velocity are retained. Only respawn timing is a bounded visual cycle.
    const life = Math.max(1, Math.ceil((p.vy > 0 ? data.rows - p.y : p.y + 2) / Math.abs(p.vy || 1)));
    const n = (frame + index * 7) % life;
    const x = Math.round(p.x + p.vx * n + effect.sway * waveSum(p.ph, 0.35, n));
    const y = Math.round(p.y + p.vy * n + 0.06 * waveSum(p.ph * 0.7, 0.245, n, true));
    if (x < 0 || y < 0 || x >= data.cols || y >= data.rows) return;
    result.push({ x, y, text: effect.chars[Math.floor(p.ph + n * 0.35) % effect.chars.length], color: rgb(p.color), alpha: 1, native: true });
  });
  for (const effect of data.fireflies ?? []) for (const p of effect.seeds) {
    const blink = Math.sin(p.ph + frame * 0.3);
    if (blink <= -0.2) continue;
    // Replace the creator's random heading walk with a bounded, history-free
    // curved path. Retain its .35/.2 step sizes and original blink/colors.
    const turn = Math.sin(p.a) < 0 ? -0.045 : 0.045;
    const [x0, y0, x1, y1] = effect.bounds;
    const x = Math.round(Math.max(x0, Math.min(x1, p.x + 0.35 * waveSum(p.a, turn, frame, true))));
    const y = Math.round(Math.max(y0, Math.min(y1, p.y + 0.2 * waveSum(p.a, turn, frame))));
    if (x < 0 || y < 0 || x >= data.cols || y >= data.rows) continue;
    result.push({ x, y, text: blink > 0.7 ? "*" : ".", color: rgb(blink > 0.7 ? [230, 255, 150] : [170, 210, 110]), alpha: 1, native: true });
  }
  return result;
}
