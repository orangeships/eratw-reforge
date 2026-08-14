/**
 * Phase 7 (P1) — ITEM namespace helpers.
 *
 * Pure accessors for the player's item inventory (`GameState.items`,
 * modeling eraBASIC `ITEM:n` — a 1-D int array sized 1000,
 * `CSV/VariableSize.csv:17`, indexed by item id, value = count owned).
 *
 * Faithful to the ERB shop flow in `ERB/SHOP関連/SHOP_ITEM.ERB`:
 *
 *   - `@SHOP_ASK` (`SHOP_ITEM.ERB`): gate `ITEMPRICE:ARG * (100 - 割引) / 100
 *     <= MONEY`, then `MONEY -= price` and `ITEM:ARG ++`. `buyItem` mirrors
 *     this atomically — money + item move together or not at all.
 *   - `@ITEM_CARTON` / `@ITEM_MATOMEGAI`: bulk variant —
 *     `値段 = ITEMPRICE * (100 - 割引) / 100` (per-unit, era integer
 *     division), then `MONEY -= 値段 * 个数`, `ITEM:ARG += 个数`. `buyItem`
 *     applies the discount per-unit (with `Math.trunc`) BEFORE multiplying
 *     by count, matching eraTW's truncation point exactly.
 *
 * Design: like `money.ts`, these are **void mutators on a caller-cloned
 * state**. `addItem`/`removeItem`/`buyItem` mutate in place; readers
 * (`hasItem`, `itemCount`) are pure. `buyItem` composes `pay` (money.ts) +
 * `addItem` so the MONEY floor-at-0 rule is reused, not re-implemented.
 *
 * Out of scope (deferred): `ITEMSALES:n` shop stock (P4 shop), `NOITEM`
 * debug flag, item categories (decided by `ITEMDATA.ERB`'s SELECTCASE, not
 * a CSV column), item *selling* (eraTW has no general sell-items path —
 * collected goods go through 摆摊/LOG_SALES, a separate subsystem).
 */

import type { GameState } from "./game-state.js";
import { canAfford, pay } from "./money.js";

/** Canonical item ids used by runtime helpers. */
export const ITEM_ID = {
  BOOK: 213,
  ICE_CREAM: 213,
  APHRODISIAC: 41,
  DOBUROKU: 51,
  SAKE: 52,
  ONIKOROSHI: 53,
  SWEET_SAKE: 56,
  CUCUMBER: 361,
  FROG: 706,
  SPORTS_DRINK: 251,
  SLEEPING_PILL: 252,
  /** DAILY_EV2 / upstream DAILY_EV23 miracle stone. */
  奇跡之石: 530,
  潤滑液: 40,
  避孕套: 45,
  姜黄飲料: 510,
  /** プレイマット / 塑料地墊 — enables normal sex in a bathroom. */
  プレイマット: 20,
  /** 黑雷神巧克力 — DAILY_EV0 bribe stock. */
  黑雷神巧克力: 120,
  巧克力: 121,
  高級巧克力: 122,
  本命巧克力: 123,
  WD巧克力: 124,
  WD布丁: 125,
  手制巧克力曲奇: 126,
  手制布丁: 127,
  装饰蛋糕: 128,
  跳蛋巧克力: 129,
  守矢之守札: 131,
  /** COM304 / COM410 cleaning-power bonus. */
  特制竹箒: 907,
  槲葉糕: 212,
  冰淇淋: 213,
  紅茶: 215,
  糖: 216,
  大回復薬: 503,
  万能药: 511,
  仙香玉兎: 514,
  八目鰻烤串: 550,
  來歷不明的肉: 705,
  賢者の石: 854,
  绯红之王: 871,
  /** Small consumables used by migrated outing/commission effects. */
  媚薬: 41,
  どぶろく: 51,
  清酒: 52,
  鬼殺し: 53,
  甜酒: 56,
  黄瓜: 361,
  青蛙: 706,
  運動飲料: 251,
  睡眠薬: 252,
} as const;

/**
 * Count of item `id` the player owns. Reads as 0 when the item is absent
 * (or the `items` map itself is unset) — matching eraTW's `ITEM:n` default
 * of 0 for an empty slot.
 */
export function itemCount(state: GameState, id: number): number {
  return state.items?.[id] ?? 0;
}

/**
 * Whether the player owns at least `min` (default 1) of item `id`.
 * `min <= 0` is trivially true (matches `ITEM:n` being ≥ 0 always).
 */
export function hasItem(state: GameState, id: number, min = 1): boolean {
  if (min <= 0) return true;
  return itemCount(state, id) >= min;
}

/**
 * Add `count` of item `id` to the inventory. No-op when `count <= 0`
 * (matches the money-helpers' non-positive early-out). Lazily creates the
 * `items` map if absent. Caps the result at `cap` (default 999), matching
 * eraTW's `@GET_ITEM` → `@QOL_SHOW_SET_ITEM` (`Misc.ERB:520`):
 * `ITEM:id = LIMIT(cur + mod, 0, 999)` — the universal per-item hold limit.
 * Mutates in place — callers must pass a cloned state.
 */
export function addItem(state: GameState, id: number, count: number, cap = 999): void {
  if (count <= 0) return;
  if (state.items == null) state.items = {};
  state.items[id] = Math.min(cap, (state.items[id] ?? 0) + count);
}

/**
 * Remove `count` of item `id` from the inventory. Floors at 0
 * (`Math.max(0, cur - count)`) — eraTW's `ITEM:ARG -= 个数` never goes
 * negative in practice because commands gate on ownership first, but the
 * floor is the safe invariant (mirrors `pay`'s `MAX(0, MONEY - VALUE)`).
 * No-op when `count <= 0`. Mutates in place.
 */
export function removeItem(state: GameState, id: number, count: number): void {
  if (count <= 0) return;
  if (state.items == null) return;
  const cur = state.items[id] ?? 0;
  const next = Math.max(0, cur - count);
  if (next === 0) {
    delete state.items[id]; // keep the map sparse, like an empty ERA slot
  } else {
    state.items[id] = next;
  }
}

/**
 * Atomically buy `count` of item `id` at unit `price` (yen) with an optional
 * `discount` percent (0–100, default 0). Mirrors `@SHOP_ASK` /
 * `@ITEM_MATOMEGAI` (`SHOP_ITEM.ERB`):
 *
 *   unitPrice = trunc(price * (100 - discount) / 100)   // era int division
 *   total     = unitPrice * count
 *   if total > MONEY  → fail (no change), return false
 *   else              → MONEY -= total, ITEM:id += count, return true
 *
 * The discount is applied **per unit before multiplying** (eraTW computes
 * `値段` per-unit then scales), so truncation happens once per unit, not on
 * the lump sum — matching the ERB exactly for non-multiples of 100.
 *
 * `price <= 0` or `count <= 0` is a no-op success (returns true, nothing
 * changes) — a free/zero-cost "buy" isn't a money failure; callers that
 * want to forbid zero-price items should gate on `price > 0` themselves
 * (eraTW does this via `ITEMDATA "SALES"` returning -1 for non-purchasable
 * items, a rule not modeled here).
 */
export function buyItem(
  state: GameState,
  id: number,
  count: number,
  price: number,
  discount = 0,
): boolean {
  if (count <= 0) return true;
  const unitPrice =
    price <= 0 ? 0 : Math.trunc((price * (100 - discount)) / 100);
  const total = unitPrice * count;
  if (!canAfford(state, total)) return false;
  pay(state, total);
  addItem(state, id, count);
  return true;
}
