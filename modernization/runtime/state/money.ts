/**
 * Phase 7 — MONEY namespace helpers.
 *
 * Pure accessors for the player's yen pool (`GameState.money`, modeling
 * eraBASIC `MONEY:0`). Faithful to the ERB money helpers in
 * `COMMON.ERB:2864-2930`:
 *
 *   - `@PAY_MONEY_YEN` / `@LOST_MONEY_YEN` — `MONEY = MAX(0, MONEY - VALUE)`
 *     (floor at 0, never negative). Both no-op when `VALUE <= 0`.
 *   - `@GET_MONEY_YEN` — `MONEY += VALUE`, plus a 黄金律 +30% bonus gated
 *     on `TALENT:MASTER:黄金律 && MAGIC_DLC_魔法成就 && VALUE > 4`. That
 *     bonus is MAGIC_DLC-domain and **deferred** — `grant` here adds the
 *     bare amount only (the 黄金律 hook is left for the DLC slice).
 *
 * Design: these are **void mutators on a caller-cloned state**, matching
 * the settlement-helper idiom (`setMasterBase`, `advanceTimeTicks`). The
 * handler clones `ctx.state` first, then calls `pay(next, cost)` and keeps
 * mutating the same `next`. `canAfford` / `formatMoney` are pure readers.
 *
 * `MONEY:1` (MAGIC_DLC 法力) and `MONEY:2` (casino chips, CM_LIMIT cap)
 * are out of scope — different subsystems, modeled elsewhere when those
 * land.
 */

import type { GameState } from "./game-state.js";

/**
 * Whether the player can spend `cost` yen without going negative.
 * `cost <= 0` is always affordable (matches the ERB `SIF VALUE <= 0 RETURN`
 * early-out — a non-positive cost is a no-op, not a failure).
 */
export function canAfford(state: GameState, cost: number): boolean {
  if (cost <= 0) return true;
  return state.money >= cost;
}

/**
 * Spend `cost` yen. Floors at 0 (`MAX(0, MONEY - VALUE)`), matching
 * `@PAY_MONEY_YEN` / `@LOST_MONEY_YEN`. No-op when `cost <= 0`. Mutates
 * `state.money` in place — callers must pass a cloned state.
 */
export function pay(state: GameState, cost: number): void {
  if (cost <= 0) return;
  state.money = Math.max(0, state.money - cost);
}

/**
 * Synonym for {@link pay} — eraTW spells the same `MAX(0, MONEY - VALUE)`
 * floor as both `@LOST_MONEY_YEN` (lost) and `@PAY_MONEY_YEN` (paid). Kept
 * as a separate name so handler prose can read "lose 200 円" vs "pay 3000 円"
 * faithfully against the ERB helper each command actually calls.
 */
export function lose(state: GameState, cost: number): void {
  pay(state, cost);
}

/**
 * Grant `amount` yen (`MONEY += VALUE`, matching `@GET_MONEY_YEN`'s base
 * add). No-op when `amount <= 0` (the ERB early-out). The 黄金律 +30%
 * MAGIC_DLC bonus is **not** applied here — deferred to the DLC slice;
 * when it lands it will branch on `TALENT:黄金律 && MAGIC_DLC_魔法成就`.
 */
export function grant(state: GameState, amount: number): void {
  if (amount <= 0) return;
  state.money += amount;
}

/**
 * Format yen for display — `"¥1,000"` / `"¥10,000"` / `"¥-200"`. eraTW's
 * `@金額表示` (`COMMON.ERB:3037`) returns `MONEYSTR(ARG, "#,##0")` (a
 * thousands-separated integer with a currency prefix); we mirror that with
 * `toLocaleString("en-US")` grouping and a `¥` prefix. Negative values
 * render with a leading minus (can't occur via `pay`'s floor, but `grant`
 * of a negative amount is guarded out too — kept for direct-display safety).
 */
export function formatMoney(value: number): string {
  return `¥${value.toLocaleString("en-US")}`;
}
