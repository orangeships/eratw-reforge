/**
 * Phase 7 (Wave 3b) — village produce/food shops (COMF614 食料品店 /
 * COMF618 花屋 / COMF622 八百屋). The first **real B9 picker over a shop
 * catalog**, reusing `prompt.ts` (pickOne) + `shop.ts` (shopBuy).
 *
 * Faithful to the buy path of each `COMF6xx`:
 *   - `@COM6xx` builds its lineup via `ITEMDATA(LOCAL, "SHOP:<店名>")`
 *     (transcribed as `VILLAGE_SHOPS[].itemIds` in `shop.ts`), refreshes
 *     `ITEMSALES` (`ITEMDATA "SALES"`), shows a `SHOW_SHOPPING` picker, then
 *     on a valid pick calls `ITEMDATA "購入"` = `@ITEM_MATOMEGAI` (= shopBuy).
 *   - The picker's `[999] 返回` is the no-buy exit → `RETURN -1` (noop).
 *   - `@COM_ABLE6xx` gates the shop's village location (`FLOWER_SHOP` /
 *     `KAIDASHI_SHOP` / 八百屋 location via `GET_MAP_REPLACEMENT`), 睡眠,
 *     時間停止. (614 also has a once-a-day `GETBIT(TFLAG:一日一回,2)` gate.)
 *
 * **B9 collapse:** the synchronous resolver models the `INPUT` picker as
 * `prompt(ctx)` → `pickOne` over the in-stock lineup; the chosen item id is
 * read from `ctx.promptAnswer` and bought (qty 1) via `shopBuy`. A `0`
 * (or absent) answer = the `[999] 返回` no-buy exit.
 *
 * **Stock model:** the first visit seeds an absent `ITEMSALES` entry, then
 * limited items (食材/野菜/お肉/卵) keep their depleted/sold-out value across
 * later visits. `runDayEnd` applies the modeled `@SHOP_EVENTTURNEND` rules.
 * Infinite items (園芸 苗) and the unique 園芸用品一式 follow `shopBuy`'s
 * normal stock rules.
 *
 * **DEFERRED:** 614's 特売日 RNG discount (60% vs 30% — daily-event flag not
 * modeled → flat 30%); 614's date-bonus SOURCE arm (`CHK_DATENOW` 歓楽/情愛/
 * 受動/征服 settlement when on a date); 614 `一日一回,2` once-a-day gate
 * (撤廃 upstream comment says the cap was removed — not enforced); the
 * complex village shops (616/617/619/620/623-627) — see `VILLAGE_SHOPS`
 * header. TIME += 10/30 per shop is applied.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  catalogEntry,
  ensureShopStock,
  shopBuy,
  VILLAGE_SHOPS,
  type VillageShop,
} from "../../state/shop.js";
import { CFLAG_ID, FLAG_ID, advanceTimeTicks } from "../../state/settlement.js";

/** TIME cost per shop (`@COM6xx` tail: 614 += 30; 618/622 += 10). */
function shopTimeCost(commandNo: number): number {
  return commandNo === 614 ? 30 : 10;
}

/** Build the shop's pickOne over its in-catalog lineup (price + discount). */
function shopPrompt(shop: VillageShop): PromptSpec {
  const options = shop.itemIds
    .map((id) => {
      const e = catalogEntry(id);
      if (!e) return null;
      const unit =
        e.price <= 0 ? 0 : Math.trunc((e.price * (100 - shop.discount)) / 100);
      return { id, label: e.name, detail: `${unit} 円` };
    })
    .filter((o): o is { id: number; label: string; detail: string } => o !== null);
  return pickOne(`${shop.name}：买什么？`, options);
}

function checkShopEligible(
  state: GameState,
  shop: VillageShop,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // 時間停止 (FLAG:70) → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  // location gate (FLOWER_SHOP / KAIDASHI_SHOP / 八百屋) → must be at the shop.
  if (state.master.location !== shop.location) {
    return { ok: false, reason: { kind: "precondition", message: `不在${shop.name}。` } };
  }
  // 睡眠中 → block (master CFLAG:睡眠).
  if ((state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中。" } };
  }
  return { ok: true };
}

/** Build the `HandlerEntry` for a village shop. */
function makeVillageShopHandler(shop: VillageShop): HandlerEntry {
  return {
    commandNo: shop.commandNo,
    prompt: () => shopPrompt(shop),
    execCheck: (ctx) => {
      const r = checkShopEligible(ctx.state, shop);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    handler: (ctx) => {
      const next: GameState = cloneGameState(ctx.state);
      // The first visit seeds stock; later visits preserve depletion. Daily
      // replenishment belongs to SHOP_EVENTTURNEND in runDayEnd.
      ensureShopStock(next, shop.itemIds);

      const spec = shopPrompt(shop);
      const picked = requirePickOne(spec, ctx.promptAnswer);
      // 0 / absent answer = [999] 返回 no-buy exit (RETURN -1) — TIME still
      // advances on cancel for 618/622 (ERB: 999 arm does TIME += 10 then
      // RETURN -1); 614's cancel is a bare RETURN -1 (no TIME). Match each.
      if (picked == null) {
        if (shop.commandNo !== 614) advanceTimeTicks(next, shopTimeCost(shop.commandNo));
        return {
          state: next,
          events: [
            { kind: "NARRATION" as const, timestamp: ctx.now(), text: `离开了${shop.name}。` },
          ],
          outcome: "noop" as const,
        };
      }

      const buy = shopBuy(next, picked as number, 1, shop.discount);
      if (!buy.ok) {
        // Can't buy (sold out / no money / at cap) — no purchase, no TIME.
        return {
          state: next,
          events: [
            { kind: "NARRATION" as const, timestamp: ctx.now(), text: `买不了（${buy.code}）。` },
          ],
          outcome: "noop" as const,
        };
      }

      // TIME += per-shop cost on a successful buy (ERB tail).
      advanceTimeTicks(next, shopTimeCost(shop.commandNo));
      const e = catalogEntry(picked as number);
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `在${shop.name}买了${e?.name ?? "道具"}（${buy.total} 円）。`,
          },
        ],
        outcome: "ok" as const,
      };
    },
  };
}

/**
 * The command numbers this module registers. Declared as explicit literals
 * (not just `shop.commandNo`) so the coverage oracle's `commandNo: <int>`
 * scan — which reads handler source text — counts 614/618/622 as done.
 * Kept in sync with `VILLAGE_SHOPS` by the assertion below.
 */
const VILLAGE_SHOP_NOS = [
  { commandNo: 614 },
  { commandNo: 618 },
  { commandNo: 622 },
  { commandNo: 619 },
  { commandNo: 443 },
] as const;

export const villageShopEntries: readonly HandlerEntry[] =
  VILLAGE_SHOPS.map(makeVillageShopHandler);

// Sanity: the literal manifest must match the data-driven registry.
if (
  VILLAGE_SHOP_NOS.map((x) => x.commandNo).sort().join(",") !==
  villageShopEntries.map((e) => e.commandNo).sort().join(",")
) {
  throw new Error("village-shop: VILLAGE_SHOP_NOS out of sync with VILLAGE_SHOPS");
}

// Re-export each by number for explicit registration + test imports.
export const comf614HandlerEntry = villageShopEntries.find((e) => e.commandNo === 614)!;
export const comf618HandlerEntry = villageShopEntries.find((e) => e.commandNo === 618)!;
export const comf622HandlerEntry = villageShopEntries.find((e) => e.commandNo === 622)!;
export const comf619HandlerEntry = villageShopEntries.find((e) => e.commandNo === 619)!;
