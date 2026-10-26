/**
 * Phase 7.5 F-1d-2 — PALAM level ladder (`PALAMLV`).
 *
 * eraTW's status line shows each PALAM as `润滑Lv {N}{bar} {value}`, e.g.
 *   `润滑Lv 0▄▄▄▄▄▄▄▄     0  恭顺Lv 0▄▄▄▄▄▄▄▄     0 …`
 * where `N` = `GETPALAMLV(PALAM, 10)` (the rung index, 0-based over a 10-step
 * ladder) and the bar fills toward the NEXT rung's threshold.
 *
 * UI display uses the same game PALAMLV table as Runtime settlement, menu
 * gates, and orgasm thresholds. Keeping a second UI ladder made one PALAM
 * value report different levels in the status bar and gameplay.
 *
 * `GETPALAMLV(value, n)` returns the count of rungs (out of the first `n`)
 * whose threshold `value` meets or exceeds — i.e. the 0-based level clamped
 * to `n`. We expose `getPalamLv(value, rungs=10)` for that, plus
 * `palamLvBar(value)` returning `{ level, value, fill01 }` for the UI.
 */

import { PALAMLV as RUNTIME_PALAMLV, palamLevel } from "./settlement.js";

export const PALAMLV = RUNTIME_PALAMLV;

/** `GETPALAMLV(value, rungs)` — how many of the first `rungs` thresholds `value`
 *  meets. Faithful to the era builtin: returns 0..rungs (clamped). */
export function getPalamLv(value: number, rungs = 10): number {
  return palamLevel(value, rungs);
}

/** A PALAM rung's display info: current level (0..rungs), the raw value, and
 *  a 0..1 fill toward the NEXT rung (1.0 when already at the top rung). */
export interface PalamLvBar {
  level: number;
  value: number;
  fill01: number;
}

/** Compute the bar-fill for a PALAM value over a `rungs`-step ladder. */
export function palamLvBar(value: number, rungs = 10): PalamLvBar {
  const level = getPalamLv(value, rungs);
  const value_ = Math.max(0, value);
  if (level >= rungs) return { level, value: value_, fill01: 1 };
  const cur = PALAMLV[level] ?? 0;
  const next = PALAMLV[level + 1] ?? cur;
  if (next <= cur) return { level, value: value_, fill01: 1 };
  return { level, value: value_, fill01: Math.max(0, Math.min(1, (value_ - cur) / (next - cur))) };
}
