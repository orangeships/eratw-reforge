/**
 * Phase 7.5 F-1d-2 — PALAM level ladder (`PALAMLV`).
 *
 * eraTW's status line shows each PALAM as `润滑Lv {N}{bar} {value}`, e.g.
 *   `润滑Lv 0▄▄▄▄▄▄▄▄     0  恭顺Lv 0▄▄▄▄▄▄▄▄     0 …`
 * where `N` = `GETPALAMLV(PALAM, 10)` (the rung index, 0-based over a 10-step
 * ladder) and the bar fills toward the NEXT rung's threshold.
 *
 * `PALAMLV` is an era-engine STANDARD built-in array (like `EXPLV`) — it is
 * NOT assigned anywhere in eraTW's ERB/CSV (grep confirms no writer), so the
 * game runs on the engine default. The thresholds below are the canonical
 * era `PALAMLV` ladder (50/300/800/1500/2500/3500/5000/7000/9000/11000 …).
 *
 * `GETPALAMLV(value, n)` returns the count of rungs (out of the first `n`)
 * whose threshold `value` meets or exceeds — i.e. the 0-based level clamped
 * to `n`. We expose `getPalamLv(value, rungs=10)` for that, plus
 * `palamLvBar(value)` returning `{ level, value, fill01 }` for the UI.
 */

/** The era-standard PALAMLV threshold ladder (index 1..). PALAMLV:0 = 0. */
export const PALAMLV: ReadonlyArray<number> = [
  0, // index 0 (unused / =0)
  50,
  300,
  800,
  1500,
  2500,
  3500,
  5000,
  7000,
  9000,
  11000,
  13000,
  15000,
  17000,
  19000,
  21000,
  23000,
  25000,
  27000,
  29000,
  31000,
];

/** `GETPALAMLV(value, rungs)` — how many of the first `rungs` thresholds `value`
 *  meets. Faithful to the era builtin: returns 0..rungs (clamped). */
export function getPalamLv(value: number, rungs = 10): number {
  let lv = 0;
  for (let i = 1; i <= rungs; i++) {
    if (value >= (PALAMLV[i] ?? Infinity)) lv = i;
    else break;
  }
  return lv;
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
