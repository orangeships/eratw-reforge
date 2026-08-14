/**
 * Phase 7.5 (§3C) — 露店 (roadside stall) sell mechanics, faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF447 露店を開く.ERB`.
 *
 * This module ports the **sell→money** half of the 采集→売→MONEY loop —
 * the explicit P3 deferral ("卖货→money 半截 defer") — and is the
 * reverse of `shop.ts::shopBuy` (item → money instead of money → item).
 * The gather half (`gathering.ts`) produces the 素材 ITEMs this sells.
 *
 * Posture mirrors `shop.ts`: the **mechanism** (sellable table, stall-spot
 * resolution, 商人パワー, `@STALL_PRICE_SET` pricing, the 来客 sale loop,
 * money/item/time/downbase/exp settlement) is ported as a pure runtime
 * module + atomic `shopSell`. The interactive multi-item picker (`INPUT`
 * loop, ERB 127-314) is a B9 交互-prompt concern, deferred — `runStall`
 * takes an explicit `lineup` so the mechanism is testable now and the UI
 * wires the picker later (same split as shopBuy vs shop-UI-mode).
 *
 * Ported faithfully:
 *   - **`ITEM_SELLABLE`** (ERB 1-11) — the CASE ranges that mark an item
 *     sellable at a stall: 271-276, 351-398, 500-512, 600, 611, 616,
 *     626-629, 700-708.
 *   - **`ITEMPRICE`** — real per-item prices from `CSV/Item.csv` (via
 *     `out/items.json`) for every sellable id. Missing ids read 0,
 *     matching era's `ITEMPRICE` default for an empty slot.
 *   - **`STALL_SPOT`** (ERB 793-882) — location → stall-spot id (1-14).
 *     Only the two walkable maps are mapped: 神社境内 (spot 1) and
 *     人里中央広場 (spot 3). Spots 2/4-14 defer to their maps (Phase 8+).
 *   - **商人パワー** (ERB 345-354) — `話術*25 + 教養*10 (+幸運補正*10)`;
 *     assistant combine (`商人パワーT`, MAX + other/2) deferred (no
 *     participant NPC in this slice). `TFLAG:幸運補正` not modeled → 0.
 *   - **`STALL_PRICE_SET`** (ERB 1065-1179) — 利率 roll
 *     (`power>200 ? MAX(RAND:power, power/3) : MAX(RAND:power, power/2)`),
 *     補正価格 = `trunc(ITEMPRICE/2)`, the flat price adjustments
 *     (CASE 500/600/611/616/626/627/628/707/708 + 601/602/631/636), and
 *     the per-spot location bonuses (CASE 3/5/8/9/11/12/13).
 *     `購入額 = trunc(補正価格 * qty * 利率 / 100)`.
 *   - **来客 sale loop** (ERB 360-580) — for each of 来客数 visitors:
 *     pick a goods slot via the RAND chain (ERB 380-406); LOCAL==0 → no
 *     sale; sold-out slot → re-pick; else roll 売る个数 by stock band
 *     (ERB 437-443), clamp to remaining, price via STALL_PRICE_SET,
 *     accumulate. Caps total sales by 来客数 (a real outcome — more
 *     distinct goods than visitors leaves stock unsold, faithfully).
 *   - **`STALL_SHOPPER`** (ERB 891-986) — the per-spot BASE 来客数 roll
 *     (spot 1 `RAND:5`; spot 3 `MAX(RAND:35, 10)`).
 *   - **Settlement** (ERB 582-671) — `MONEY += 合計売却値`; `ITEM -= sold`
 *     (removeItem); `TIME += 来客数`; `DOWNBASE 体力 = MAX(15*来客数,150)`,
 *     `気力 = MAX(20*来客数,200)`; `EXP:会話経験 += min(来客数,60)`;
 *     `EXP:学習経験 += 1` when `ABL:教養 <= 3`; `TFLAG:193` (1 if sold any
 *     else 0) + `TFLAG:194` (合計売却値) surfaced in the result.
 *
 * **Deferred (documented, same posture as gathering.ts / shop.ts):**
 *   - **Interactive picker** (ERB 127-314, the `INPUT`/`$SELECT_LOOP`/
 *     `$INPUT_LOOP02` per-item + qty menu) — B9 交互 prompt. `runStall`
 *     takes an explicit lineup; the COMF447 handler builds a default
 *     "sell all sellable" lineup for the trial run.
 *   - **Calendar/weather/festival corrections** — `STALL_SHOPPER`'s
 *     `FESTIVAL()`/`IS_WEEKEND(DAY)`/`TIME:2`(time-band)/`TIME:5`(weather)
 *     multipliers + `STALL_PRICE_SET`'s `FESTIVAL()*1.5` + seasonal
 *     `DAY:2` 補正価格×1.5. `TimeSlot` has no calendar/weather yet
 *     (Phase 8 WorldScheduler owns it). Only the per-spot base roll is
 *     ported; corrections land with the calendar.
 *   - **酒类招呼** (ERB 165-233, `[100]` 拿酒招呼 / `SHOPPER_WEED_SALE`) —
 *     B9 interactive + 酒 inventory branch.
 *   - **贩售事件** (ERB 454-556, `来客数 >= 50` branch) — unreachable at
 *     our base rolls (max 34 at spot 3); needs the festival inflation to
 *     hit 50. Deferred with the calendar.
 *   - **STALL_PERMISSION 親密 gate** (ERB 49-53, 994-1055) — modeled in
 *     the handler's execCheck for spot 1 (霊夢親密<5 → blocked); spots
 *     5/7/8/9/10/11 gates defer with their maps. Spot 3 (人里) has no
 *     permission gate (faithful — ERB has no CASE 3 in STALL_PERMISSION).
 *   - **Assistant (CHARA)** (ERB 107-120, 347-348, 631-654, 674-752) —
 *     the 约会/親密≥10 helper who adds 商人パワーT + SOURCE. No
 *     participant NPC in this slice.
 *   - **`IN_ROOM_NUMBER`** addend (ERB 69) — co-present NPCs boosting
 *     来客数. No multi-char dispersal yet (Phase 8).
 *   - **`RANDOMIZE(DAY+TIME)`** (ERB 894) — era re-seeds the 来客 roll
 *     per day+time so it's stable within a slot. We use `ctx.rng`
 *     (deterministic per call); the day-stable behavior lands with the
 *     calendar.
 *   - **`MONEY:2` 筹码** (casino chips, ERB 424/480/523) — `MONEY:2` not
 *     modeled (赌场 = Phase 7 命令族, separate slice).
 *   - **TFLAG store** — `TFLAG:193/194` are per-command transients
 *     consumed by KOJO/SOURCE within the same command. Master-only
 *     commands skip SOURCE settlement + dialogue (per makeComfHandler),
 *     so they are surfaced in `runStall`'s result + narration, not
 *     persisted. KOJO wiring (Phase 6 extension) will read them when the
 *     stall gets a target-directed arm.
 *   - **擺攤拓展 mod-layer** (`CHECK_ITEM_BONUS_PRICE` 当地热门 highlight,
 *     `SHOPPER_COME` 来客对话 flavor, `上架少量优化`) — cosmetic/QoL
 *     mod-layer; the pricing core is ported without the highlight flags.
 */

import type { GameState } from "./game-state.js";
import { ABL_ID } from "./settlement.js";
import { removeItem } from "./items.js";

/** The eraBASIC `RNG` surface this module needs — a slice of `CommandContext.rng`. */
export interface StallRng {
  /** era `RAND:n` — returns an int in [0, n). */
  int: (n: number) => number;
}

// ---------------------------------------------------------------------------
// ITEM_SELLABLE + ITEMPRICE (ERB 1-11 + CSV/Item.csv)
// ---------------------------------------------------------------------------

/**
 * `@ITEM_SELLABLE(ARG)` (ERB 2-11) — whether item `id` can be sold at a
 * stall. The exact CASE ranges: 271-276, 351-398, 500-512, 600, 611, 616,
 * 626-629, 700-708.
 */
export function itemSellable(id: number): boolean {
  if (id >= 271 && id <= 276) return true;
  if (id >= 351 && id <= 398) return true;
  if (id >= 500 && id <= 512) return true;
  if (id === 600 || id === 611 || id === 616) return true;
  if (id >= 626 && id <= 629) return true;
  if (id >= 700 && id <= 708) return true;
  return false;
}

/**
 * `ITEMPRICE:n` for sellable items — real prices from `CSV/Item.csv`
 * (rendered into `out/items.json`). An id absent from the table reads 0,
 * matching era's `ITEMPRICE` default for an empty slot (those ids in the
 * sellable ranges but not in Item.csv simply sell for ~0).
 */
const SELLABLE_ITEM_PRICES: Readonly<Record<number, number>> = {
  271: 100, 272: 200, 273: 500, 274: 1000, 275: 3000, 276: 50,
  351: 3000, 352: 3000, 353: 3000, 361: 3000, 362: 3000, 363: 3000,
  364: 3000, 371: 3000, 372: 3000, 373: 3000, 374: 3000, 381: 3000,
  382: 3000, 383: 3000,
  500: 100, 501: 3000, 502: 10000, 503: 5000, 505: 15000, 506: 20000,
  507: 3000, 508: 5000, 509: 4000, 510: 500, 511: 30000, 512: 50000,
  600: 100, 611: 10, 616: 100, 626: 50, 627: 100, 628: 500, 629: 800,
  701: 100, 702: 4500, 703: 4500, 705: 100, 706: 100, 707: 100, 708: 200,
};

/** `ITEMPRICE:n` for a sellable item (0 if unknown — era default). */
export function itemPrice(id: number): number {
  return SELLABLE_ITEM_PRICES[id] ?? 0;
}

// ---------------------------------------------------------------------------
// STALL_SPOT — location → stall-spot id (ERB 793-882)
// ---------------------------------------------------------------------------

/**
 * `@STALL_SPOT(ARG)` (ERB 793-882) — resolve the player's current
 * location to a stall-spot id (1-14, 0 = no stall here). Only the two
 * walkable maps are mapped:
 *   - spot 1 = 博麗神社境内 (`神社:境内`, MAIN_MAP=0 room 2)
 *   - spot 3 = 人里中央広場 (`人間之里:中央広場`, MAIN_MAP=2 room 202)
 * Spots 2/4-14 defer with their maps. Location is our flat scene string
 * (the same `CharaSlot.location` gathering.ts/cleaning.ts match on).
 */
export function stallSpot(location: string): number {
  if (location === "神社:境内") return 1;
  if (location === "人間之里:中央広場") return 3;
  return 0;
}

// ---------------------------------------------------------------------------
// 商人パワー (ERB 345-354)
// ---------------------------------------------------------------------------

/**
 * 商人パワー (ERB 345-354, solo — no assistant in this slice):
 *   商人パワーM = ABL:MASTER:話術技能*25 + ABL:MASTER:教養*10 + TFLAG:幸運補正*10
 * `TFLAG:幸運補正` is not modeled → 0. The assistant combine (商人パワーT +
 * MAX + other/2) defers with the participant NPC.
 */
export function merchantPower(state: GameState): number {
  const talk = state.master.state.ABL[ABL_ID.話術技能] ?? 0;
  const kyo = state.master.state.ABL[ABL_ID.教養] ?? 0;
  return talk * 25 + kyo * 10;
}

// ---------------------------------------------------------------------------
// STALL_SHOPPER — per-spot base 来客数 (ERB 891-986)
// ---------------------------------------------------------------------------

/**
 * `@STALL_SHOPPER(ARG)` (ERB 891-986) — the per-spot BASE 来客数 roll,
 * WITHOUT the festival/weekend/time/weather corrections (those need the
 * Phase 8 calendar). Faithful to the base `LOCAL:0 = …` line per spot:
 *   - spot 1 (博麗神社): `RAND:5` → 0..4
 *   - spot 3 (人里):     `MAX(RAND:35, 10)` → 10..34
 * Spots 2/4-14 defer with their maps. `RANDOMIZE(DAY+TIME)` (ERB 894)
 * deferred — we use `ctx.rng` (deterministic per call).
 */
export function stallShopperBase(spot: number, rng: StallRng): number {
  switch (spot) {
    case 1:
      return rng.int(5); // 0..4
    case 3:
      return Math.max(rng.int(35), 10); // 10..34
    default:
      return 0; // unmapped spot — no stall
  }
}

// ---------------------------------------------------------------------------
// STALL_PRICE_SET — per-visitor 購入額 (ERB 1065-1179)
// ---------------------------------------------------------------------------

export interface StallPrice {
  /** 購入額 — yen this visitor paid (ERB 1173). */
  total: number;
  /** 利率 — the rate percentile rolled (ERB 1077/1080), for KOJO/debug. */
  rate: number;
}

/**
 * `@STALL_PRICE_SET(商人パワー, itemId, qty, spot)` (ERB 1065-1179) — what
 * one visitor paid for `qty` of `itemId`. Faithful to:
 *   - 利率: `power>200 ? MAX(RAND:power, power/3) : MAX(RAND:power, power/2)`
 *     (power floored at 1, ERB 1071-1073).
 *   - 補正価格 = `trunc(ITEMPRICE/2)` (ERB 1082).
 *   - flat price adjustments (ERB 1100-1128): 500/600/611/616/626/627/
 *     628/707/708 + 601/602/631/636.
 *   - per-spot location bonuses (ERB 1134-1171): spot 3/5/8/9/11/12/13.
 *   - `購入額 = trunc(補正価格 * qty * 利率 / 100)` (ERB 1173).
 *
 * Deferred: seasonal `DAY:2` 補正価格×1.5 (ERB 1087-1098) + `FESTIVAL()×1.5`
 * (ERB 1130-1131) — need the Phase 8 calendar.
 */
export function stallPriceSet(
  power: number,
  itemId: number,
  qty: number,
  spot: number,
  rng: StallRng,
): StallPrice {
  const p = power <= 0 ? 1 : power;
  // 利率 (ERB 1076-1081).
  const rate = p > 200 ? Math.max(rng.int(p), Math.trunc(p / 3)) : Math.max(rng.int(p), Math.trunc(p / 2));

  // 補正価格 = trunc(ITEMPRICE/2) (ERB 1082).
  let adjusted = Math.trunc(itemPrice(itemId) / 2);

  // Flat price adjustments (ERB 1100-1128).
  switch (itemId) {
    case 500: adjusted += 150; break;
    case 600: adjusted += 150; break;
    case 611: adjusted += 145; break;
    case 616: adjusted += 200; break;
    case 626: adjusted += 125; break;
    case 627: adjusted += 200; break;
    case 628: adjusted += 50; break;
    case 707: adjusted += 250; break;
    case 708: adjusted += 350; break;
    case 601: adjusted += 200; break;
    case 602: adjusted += 200; break;
    case 631: adjusted += 100; break;
    case 636: adjusted += 10; break;
  }

  // Per-spot location bonuses (ERB 1134-1171). FESTIVAL×1.5 deferred.
  const mountain = (id: number) => [600, 602, 611, 616, 626, 627, 628, 629, 707, 708].includes(id);
  switch (spot) {
    case 3: // 人里 — 山の幸 +30%
      if (mountain(itemId)) adjusted = Math.trunc(adjusted * 1.3);
      break;
    case 5: // 永遠亭 — にんじん(382) ×2.0
      if (itemId === 382) adjusted = Math.trunc(adjusted * 2.0);
      break;
    case 8: // 玄武之澤 — きゅうり(361) ×2.5, 魚(707/708) ×0.5
      if (itemId === 361) adjusted = Math.trunc(adjusted * 2.5);
      if (itemId === 707 || itemId === 708) adjusted = Math.trunc(adjusted * 0.5);
      break;
    case 9: // 妖怪之山頂上 — 魚(707/708) ×1.5
      if (itemId === 707 || itemId === 708) adjusted = Math.trunc(adjusted * 1.5);
      break;
    case 11: // 有頂天街 — 山の幸 +30%
      if (mountain(itemId)) adjusted = Math.trunc(adjusted * 1.3);
      break;
    case 12: // 地底大街 — 野菜(351-398) ×1.5
      if (itemId >= 351 && itemId <= 398) adjusted = Math.trunc(adjusted * 1.5);
      break;
    case 13: // 月之都 — 山の幸 +30%
      if (mountain(itemId)) adjusted = Math.trunc(adjusted * 1.3);
      break;
  }

  // 購入額 = trunc(補正価格 * qty * 利率 / 100) (ERB 1173).
  const total = Math.trunc((adjusted * qty * rate) / 100);
  return { total, rate };
}

// ---------------------------------------------------------------------------
// runStall — the 来客 sale loop + settlement (ERB 360-671)
// ---------------------------------------------------------------------------

/** One goods slot the player puts up for sale (ERB GoodsID/GoodsQty). */
export interface StallLineupEntry {
  id: number;
  /** Units put up (≤ owned). The interactive qty-picker (B9) is deferred. */
  qty: number;
}

/** Per-slot sale tally (for narration + testing). */
export interface StallSlotResult {
  id: number;
  putUp: number;
  sold: number;
}

export interface StallResult {
  /** 来客数 this session (ERB 69, base only — IN_ROOM_NUMBER deferred). */
  visitors: number;
  /** 合計売却値 (ERB 569) — total yen earned. */
  totalYen: number;
  /** Per-slot sale tally, in lineup order. */
  slots: StallSlotResult[];
  /** TFLAG:193 (ERB 621/625) — 1 if any sold, else 0. */
  success: 0 | 1;
  /** TFLAG:194 (ERB 622) — 合計売却値 (mirrored for KOJO wiring). */
  yenFlag: number;
}

/**
 * Run a stall session: roll 来客数, run the per-visitor sale loop over
 * `lineup` (1-9 goods slots), then settle money/items/time/downbase/exp.
 * Mirrors `@COM447` ERB 360-671 (solo, base algorithm; interactive picker
 * + 酒 + 贩售事件 + assistant + calendar corrections deferred — see header).
 *
 * `lineup` is the goods put up (the interactive `INPUT` picker is B9;
 * the COMF447 handler builds a default "all sellable" lineup). `spot` is
 * the resolved stall-spot (`stallSpot(location)`). Mutates `state` in
 * place — callers pass a cloned state. Returns the sale tally + the
 * TFLAG:193/194 success flags (surfaced, not persisted — see header).
 *
 * Settlement (ERB 582-671):
 *   MONEY += 合計売却値;  ITEM -= sold (removeItem);
 *   TIME  += 来客数;
 *   DOWNBASE 体力 = MAX(15*来客数, 150);  気力 = MAX(20*来客数, 200);
 *   EXP:会話経験 += min(来客数, 60);
 *   EXP:学習経験 += 1  when ABL:教養 <= 3.
 */
export function runStall(
  state: GameState,
  lineup: readonly StallLineupEntry[],
  spot: number,
  rng: StallRng,
): StallResult {
  const power = merchantPower(state);
  const visitors = stallShopperBase(spot, rng);

  // Goods slots (ERB GoodsID/GoodsQty/GoodsSold, 1-9). Filter zero-qty.
  const slots = lineup
    .filter((e) => e.qty > 0 && itemSellable(e.id))
    .slice(0, 9)
    .map((e) => ({ id: e.id, putUp: e.qty, sold: 0 }));
  const slotCount = slots.length;

  const allSoldOut = () => slots.every((s) => s.sold >= s.putUp);

  let totalYen = 0;
  if (visitors > 0 && slotCount > 0) {
    // ERB 360: FOR COUNT, 0, 来客数
    for (let v = 0; v < visitors; v++) {
      if (allSoldOut()) break; // ERB 575-579: 全部売りつくしたら抜ける

      // $SARCH_START — pick a goods slot (ERB 380-406).
      let local = pickSlot(slotCount, rng);

      // ERB 408: LOCAL == 0 → no sale this visitor, GOTO SARCH_END.
      if (local === 0) continue;
      // ERB 432: sold-out slot → re-pick (GOTO SARCH_START). Bound the
      // retry so a pathological all-sold-out-except-LOCAL==0 case can't
      // spin (allSoldOut above already breaks the outer loop).
      let guard = 0;
      while (slots[local - 1]!.sold >= slots[local - 1]!.putUp && guard++ < 16) {
        local = pickSlot(slotCount, rng);
        if (local === 0) break;
      }
      if (local === 0) continue;
      const slot = slots[local - 1]!;

      // 売る个数 by stock band (ERB 437-443).
      const talk = state.master.state.ABL[ABL_ID.話術技能] ?? 0;
      const kyo = state.master.state.ABL[ABL_ID.教養] ?? 0;
      let batch: number;
      if (slot.putUp >= 500) {
        batch = Math.max(rng.int(Math.trunc(slot.putUp / 20) + talk + kyo), 10);
      } else if (slot.putUp >= 100) {
        batch = Math.max(rng.int(Math.trunc(slot.putUp / 10) + talk + kyo), 5);
      } else {
        batch = Math.max(rng.int(5 + talk) + rng.int(5), 1);
      }
      // ERB 445-446: clamp to remaining stock.
      const remaining = slot.putUp - slot.sold;
      if (batch > remaining) batch = remaining;

      // ERB 448: 売却値 = STALL_PRICE_SET(商人パワー, GoodsID, batch).
      const price = stallPriceSet(power, slot.id, batch, spot, rng);

      // ERB 568-569: GoodsSold += batch; 合計売却値 += 売却値.
      slot.sold += batch;
      totalYen += price.total;
    }
  }

  // ---- Settlement (ERB 597-671) ----

  // ERB 605: ITEM -= sold (removeItem, floors at 0).
  for (const s of slots) {
    if (s.sold > 0) removeItem(state, s.id, s.sold);
  }

  // ERB 620: MONEY += 合計売却値.
  state.money += totalYen;

  // ERB 657: TIME += 来客数.
  state.time.tickValue += visitors;

  // ERB 669-670: DOWNBASE 体力 = MAX(15*来客数,150), 気力 = MAX(20*来客数,200).
  // (酒气飘香>30 reduced-cost branch deferred — needs 酒招呼.)
  state.master.state.BASE[0] = (state.master.state.BASE[0] ?? 0) - Math.max(15 * visitors, 150);
  state.master.state.BASE[1] = (state.master.state.BASE[1] ?? 0) - Math.max(20 * visitors, 200);

  // ERB 629-637: EXP:会話経験 += min(来客数, 60).
  const talkExp = Math.min(visitors, 60);
  state.master.state.EXP[71] = (state.master.state.EXP[71] ?? 0) + talkExp;
  // ERB 640-641: ABL:教養 <= 3 → EXP:学習経験 += 1.
  if ((state.master.state.ABL[ABL_ID.教養] ?? 0) <= 3) {
    state.master.state.EXP[75] = (state.master.state.EXP[75] ?? 0) + 1;
  }

  // TFLAG:193/194 (ERB 621-622 / 625) — surfaced, not persisted (header).
  const success: 0 | 1 = totalYen > 0 ? 1 : 0;

  return { visitors, totalYen, slots, success, yenFlag: totalYen };
}

/**
 * Pick a goods slot index (1..slotCount, or 0 = no sale) via the ERB
 * 380-406 RAND chain:
 *   - slotCount >= 9 → RAND:10 (but capped at slotCount; ERB GoodsID:9 arm)
 *   - slotCount >= 8 → RAND:9 ; … ; >= 6 → RAND:7
 *   - slotCount <= 5 → 上架少量优化 = RAND:5; if set, MAX(RAND:n,1) for the
 *     highest filled slot (5/4/3/2 → 1); else LOCAL = 0 (no sale).
 * Returns 0 when no slot is picked (a real "no sale this visitor" outcome).
 *
 * (`上架少量优化` is a 擺攤拓展 mod-layer flag; we port its behavior
 * faithfully — it just randomizes whether a small-stall visitor buys.)
 */
function pickSlot(slotCount: number, rng: StallRng): number {
  // ERB 380-389: GoodsID:9/8/7/6/5 arms → RAND:10/9/8/7/6.
  if (slotCount >= 9) return rng.int(10); // 0..9 (0 = no sale)
  if (slotCount >= 8) return rng.int(9);
  if (slotCount >= 7) return rng.int(8);
  if (slotCount >= 6) return rng.int(7);
  // ERB 391-405: <= 5 goods → 上架少量优化 arm. The chain checks GoodsID:4
  // / :3 / :2 (the highest filled slot), NOT :5/:4/:3 — so a 5-slot stall
  // hits the GoodsID:4 arm (slot 5 is unreachable via this branch, an era
  // quirk preserved). MAX(RAND:n, 1) floors at slot 1; LOCAL 0 = no sale.
  const optimize = rng.int(5); // 0..4; truthy = 1..4
  if (optimize) {
    if (slotCount >= 4) return Math.max(rng.int(5), 1); // GoodsID:4 → 1..4
    if (slotCount >= 3) return Math.max(rng.int(4), 1); // GoodsID:3 → 1..3
    if (slotCount >= 2) return Math.max(rng.int(3), 1); // GoodsID:2 → 1..2
    return 1; // ELSE (only slot 1) → LOCAL = 1
  }
  return 0; // no sale this visitor
}

// ---------------------------------------------------------------------------
// shopSell — atomic item→money primitive (reverse of shopBuy)
// ---------------------------------------------------------------------------

export interface ShopSellResult {
  ok: boolean;
  /** Why it failed (only meaningful when `ok === false`). `"noop"` for the
   *  `qty <= 0` no-op success. */
  code: "not_sellable" | "no_stock" | "no_spot" | "noop";
  /** Total yen received (0 on failure / no-op). */
  total: number;
  /** Units sold (0 on failure / no-op). */
  qty: number;
}

/**
 * Atomically sell `qty` of item `id` at stall-spot `spot` — the reverse of
 * `shopBuy` (item → money). One visitor buys the whole batch at
 * `STALL_PRICE_SET(商人パワー, id, qty, spot)`; `MONEY += total`, `ITEM -= qty`.
 *
 * This is the single-transaction primitive under `runStall` (which runs the
 * full 来客 loop). Useful for tests + a future explicit "sell N of X" UI
 * action. `qty <= 0` is a no-op success. Fails when the item isn't
 * sellable, the player owns none, or `spot` is 0 (no stall here). Mutates
 * `state` in place — callers pass a cloned state.
 */
export function shopSell(
  state: GameState,
  id: number,
  qty: number,
  spot: number,
  rng: StallRng,
): ShopSellResult {
  if (spot === 0) {
    return { ok: false, code: "no_spot", total: 0, qty };
  }
  if (!itemSellable(id)) {
    return { ok: false, code: "not_sellable", total: 0, qty };
  }
  const owned = state.items?.[id] ?? 0;
  if (owned <= 0) {
    return { ok: false, code: "no_stock", total: 0, qty };
  }
  if (qty <= 0) {
    return { ok: true, code: "noop", total: 0, qty };
  }
  const sellQty = Math.min(qty, owned);
  const power = merchantPower(state);
  const price = stallPriceSet(power, id, sellQty, spot, rng);
  removeItem(state, id, sellQty);
  state.money += price.total;
  return { ok: true, code: "noop", total: price.total, qty: sellQty };
}
