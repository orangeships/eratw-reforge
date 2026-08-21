/**
 * Phase 7 (P4) — SHOP_ITEM 商店 buy mechanics + stock model, faithful to
 * `ERB/SHOP関連/SHOP_ITEM.ERB` + `ERB/COMMON.ERB:@ITEMSTOCK` +
 * `ERB/SHOP関連/ITEMDATA.ERB`.
 *
 * The shop in eraTW is a UI *mode* (`SHOP.ERB`), not a COMF command, so —
 * consistent with P1 (ITEM) and P2 (扫地奖励) — this slice ports the
 * **buy mechanics + stock model** as a pure runtime module. The shop-UI-
 * mode wiring (item grid, category filter, ASK_YN confirm) is a Web-layer
 * concern, deferred. This is the "丰富花钱系统" plumbing: `itemStock` (the
 * buyability gate), `shopBuy` (the atomic stock+money+item move), and
 * `restock` (day-end 店補充).
 *
 * Ported faithfully:
 *   - **`itemStock`** (`@ITEMSTOCK`, COMMON.ERB:10-25) — the 5-code gate,
 *     in era's exact order: 1 no-item, 4 sealed (`ITEMSALES=-2`), 2 sold
 *     out (`ITEMSALES=-1`), 3 can't-afford (`MONEY < 値段`), 5 at cap
 *     (`ITEM ≥ 999`), else 0 ok. `値段` is the per-unit discounted price.
 *   - **`shopBuy`** — unifies `@SHOP_ASK` (single, ERB 223-240) and
 *     `@ITEM_MATOMEGAI` (bulk, ERB 251-287): per-unit discount
 *     `trunc(price*(100-割引)/100)` BEFORE ×qty (era truncation point),
 *     per-unit ITEMSTOCK gate, bulk money gate (`値段*qty > MONEY`),
 *     bulk cap gate (`ITEM+qty > 999`), then `MONEY -= 値段*qty`,
 *     `ITEM += qty` (via `addItem`, 999 cap), and stock update by SALES
 *     kind (unique → -1 sold out; limited → decrement, -1 when depleted;
 *     infinite → unchanged — mirroring `ITEMDATA "SALES"` refresh).
 *   - **`restock`** (`@お店に入荷`, SHOP_ITEM.ERB:436-446) —
 *     `≥max → no-op; -1/0 → amount; else min(cur+amount, max)`.
 *
 * **Catalog** — a hand-transcribed faithful subset of `ITEMDATA.ERB`'s
 * 通信販売 purchasable set (real ids/prices from `CSV/Item.csv`), covering
 * the three SALES kinds + both buy paths:
 *   - 消耗品 (infinite, SALES=99): 潤滑液/避孕套/口服避孕薬/绷帯/营养饮料.
 *   - 食材 (limited, restocked): 平价/优质/高级食材/甜味料.
 *   - 素質 (unique, buy-once): 【技巧UP】.
 *
 * **Deferred** (documented, same posture as gathering.ts):
 *   - The rest of the 通信販売 catalog (調教道具/日用品/酒/魔法 + all
 *     specialized shops 酒屋/八百屋/花屋/食料品店/河童の道具屋 — P6 multi-map).
 *   - `@ITEM_CARTON` (fixed-qty carton buy with partial-clamp, ERB 297-323)
 *     — shopBuy mirrors @ITEM_MATOMEGAI (reject-on-cap) only.
 *   - Conditional sealing predicates (媚薬/利尿剤 `ABL:教養<2 → -2`;
 *     【技巧UP】 `ABL:技巧≥5 → -2`; 【汚臭耐性UP】 cap) — the `ITEMDATA
 *     "SALES"` refresh loop that sets `ITEMSALES=-2` from ABL/TALENT.
 *     Tests seed `itemSales[id]=-2` directly to exercise the SEALED path.
 *   - The modeled limited-stock catalog is replenished by
 *     `restockAllShopsAtDayEnd`, wired into `runDayEnd` as the modern
 *     `SHOP_EVENTTURNEND` boundary.
 *   - 素質-buy side effects (【技巧UP】 `ABL:技巧++`, 【汚臭耐性UP】
 *     `TALENT++`, 【施虐狂DOWN】 JUEL/EXP resets — ERB 460-547). shopBuy
 *     grants the ITEM only; the stat mutation is a separate deferred step.
 *   - MAGIC_DLC shop branches (魔法 category, RANDSF restock).
 *   - `NOITEM` debug flag, 割引 (discount) source (住環境設定/特典).
 *   - `金額表示` (yen formatting) — UI concern.
 */

import type { GameState } from "./game-state.js";
import { addItem } from "./items.js";
import { ABL_ID, EXP_ID, PALAM_ID, TALENT_ID } from "./settlement.js";

// ---------------------------------------------------------------------------
// Catalog — hand-transcribed faithful subset of ITEMDATA.ERB 通信販売.
// ---------------------------------------------------------------------------

/** How an item's shop stock (`ITEMSALES`) behaves — `ITEMDATA "SALES"`. */
export type SalesKind = "infinite" | "unique" | "limited";

export interface ShopCatalogEntry {
  id: number;
  name: string;
  /** `ITEMPRICE` from `CSV/Item.csv`. */
  price: number;
  sales: SalesKind;
  /** `ITEMDATA "TYPE:"` category (消耗品/食材/素質/…). */
  category: string;
  /**
   * 素質/conditional purchases: run by `shopBuy` right after `addItem`,
   *  mirroring `ITEMDATA "購入"`'s post-grant stat mutations (ERB 460-547).
   *  E.g. 【技巧UP】→ `ABL:技巧++`, 【禁断的知識】→ `TALENT=1`.
   */
  onBuy?: (state: GameState) => void;
  /**
   * `ITEMDATA "SALES"` conditional gate override for 素質 (the SALES refresh
   *  loop is deferred, so the buy-condition is evaluated here instead):
   *  - `-2` → SEALED (条件不満, e.g. 技巧 already ≥ cap),
   *  - `-1` → SOLD_OUT (already owned, e.g. 禁断的知識),
   *  - `undefined` → fall back to `itemSales`.
   */
  salesGate?: (state: Readonly<GameState>) => -2 | -1 | undefined;
}

/**
 * 通信販売 purchasable subset. Prices from `CSV/Item.csv`. Covers all three
 * SALES kinds (infinite/unique/limited) and both buy paths (bulk/single).
 * The full catalog (調教道具/日用品/酒/魔法 + specialized shops) is deferred.
 */
export const SHOP_CATALOG: readonly ShopCatalogEntry[] = [
  // 消耗品 — infinite stock (ITEMDATA "SALES" returns 99).
  { id: 40, name: "潤滑液", price: 300, sales: "infinite", category: "消耗品" },
  { id: 45, name: "避孕套", price: 100, sales: "infinite", category: "消耗品" },
  { id: 49, name: "口服避孕薬", price: 2000, sales: "infinite", category: "消耗品" },
  { id: 520, name: "绷帯", price: 1000, sales: "infinite", category: "消耗品" },
  { id: 501, name: "营养饮料", price: 3000, sales: "infinite", category: "消耗品" },
  // 食材 — limited stock, restocked at day-end (SHOP_EVENTTURNEND).
  { id: 81, name: "平价食材", price: 300, sales: "limited", category: "食材" },
  { id: 82, name: "优质食材", price: 1500, sales: "limited", category: "食材" },
  { id: 83, name: "高级食材", price: 7500, sales: "limited", category: "食材" },
  { id: 84, name: "甜味料", price: 3000, sales: "limited", category: "食材" },
  // Unique 日用品/素質 — buy-once (ITEMDATA "SALES": 0 if !owned, -1 if owned).
  { id: 25, name: "昆虫采集套装", price: 7000, sales: "unique", category: "日用品" },
  { id: 37, name: "钓鱼竿", price: 3000, sales: "unique", category: "日用品" },
  { id: 63, name: "【技巧UP】", price: 5000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.技巧] ?? 0) >= 5 ? -2 : undefined,
    onBuy: (state) => { state.master.state.ABL[ABL_ID.技巧] = (state.master.state.ABL[ABL_ID.技巧] ?? 0) + 1; } },
  // --- Wave 3b village-shop produce/food (TYPE-categorized buy-shops) ---
  // 食料品店 extras (お肉/卵) — limited, restocked. Prices from CSV/Item.csv.
  { id: 702, name: "獣肉", price: 4500, sales: "limited", category: "お肉" },
  { id: 703, name: "鳥肉", price: 4500, sales: "limited", category: "お肉" },
  { id: 711, name: "卵", price: 2000, sales: "limited", category: "食材" },
  // 事件料 (701/712/923) — 原版非卖品/口上给, 为闭合料理原料缺料入食料品店
  // (现代化偏差, 见 DEBUG-BOARD). Prices from CSV/Item.csv.
  { id: 701, name: "野雞肉", price: 100, sales: "limited", category: "お肉" },
  { id: 712, name: "奇妙な卵", price: 500, sales: "limited", category: "食材" },
  { id: 923, name: "少女の卵", price: 300, sales: "limited", category: "食材" },
  // 八百屋 野菜 — limited, restocked. (harvest-grade vegetables, id 381-383/362.)
  { id: 362, name: "番茄", price: 3000, sales: "limited", category: "野菜" },
  { id: 381, name: "白菜", price: 3000, sales: "limited", category: "野菜" },
  { id: 382, name: "胡萝卜", price: 3000, sales: "limited", category: "野菜" },
  { id: 383, name: "葱", price: 3000, sales: "limited", category: "野菜" },
  // 花屋 園芸 — full 苗 lineup + 肥料 + 園芸用品一式 (unique kit). Faithful to
  // `ITEMDATA.ERB:259-286` (SHOP:花屋 membership) + `COMF618 花屋.ERB` (LIST_ITEM
  // 跳蛋/野菜/園芸用品). Upstream the 苗/肥料 are ITEMSALES limited-stock
  // (restocked via `お店に入荷`); modern keeps them `infinite` (always buyable)
  // — the limited-stock「卖完了」nuance stays deferred, as
  // for 619 酒. Prices from CSV/Item.csv (苗 50円 / 跳蛋苗 5000 / 肥料 1500).
  { id: 151, name: "卷心菜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 152, name: "草莓苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 153, name: "芜菁苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 161, name: "黄瓜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 162, name: "番茄苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 163, name: "洋葱苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 164, name: "西瓜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 171, name: "茄子苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 172, name: "马铃薯苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 173, name: "南瓜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 174, name: "大麦の苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 181, name: "白菜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 182, name: "胡萝卜苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 183, name: "葱苗", price: 50, sales: "infinite", category: "園芸用品" },
  { id: 190, name: "跳蛋苗", price: 5000, sales: "infinite", category: "園芸用品" },
  { id: 191, name: "肥料", price: 1500, sales: "infinite", category: "園芸用品" },
  { id: 150, name: "園芸用品一式", price: 10000, sales: "unique", category: "園芸用品" },
  // 酒屋 (619) 酒 — the 4 items the 酒購入 menu lists (COMF619:96-99). Prices
  // from CSV/Item.csv. Treated as infinite stock (a liquor store staple); the
  // upstream ITEMSALES limited-stock「卖完了」nuance is deferred.
  { id: 51, name: "浊酒", price: 3000, sales: "infinite", category: "酒" },
  { id: 52, name: "清酒", price: 10000, sales: "infinite", category: "酒" },
  { id: 53, name: "鬼杀酒", price: 15000, sales: "infinite", category: "酒" },
  { id: 56, name: "甜酒", price: 500, sales: "infinite", category: "酒" },
  // --- 恢复药 (COMF490 usable) — 原版うさぎ薬品/掉落聚合到隙间商店 (catalog plan) ---
  { id: 500, name: "青汁", price: 100, sales: "infinite", category: "回復薬" },
  { id: 502, name: "精力剤", price: 10000, sales: "infinite", category: "回復薬" },
  { id: 503, name: "大回復薬", price: 5000, sales: "infinite", category: "回復薬" },
  { id: 505, name: "流星群Ｘ", price: 15000, sales: "infinite", category: "回復薬" },
  { id: 506, name: "精力剤『天元凸破』", price: 20000, sales: "infinite", category: "回復薬" },
  { id: 507, name: "薬水", price: 3000, sales: "infinite", category: "回復薬" },
  { id: 508, name: "魔法薬水", price: 5000, sales: "infinite", category: "回復薬" },
  { id: 509, name: "破眠薬水", price: 4000, sales: "infinite", category: "回復薬" },
  { id: 510, name: "姜黄飲料", price: 500, sales: "infinite", category: "回復薬" },
  { id: 511, name: "万能药", price: 30000, sales: "infinite", category: "回復薬" },
  { id: 512, name: "仙丹", price: 50000, sales: "infinite", category: "回復薬" },
  // --- 甜点 / 食品 / 果物 (COMF490 usable) ---
  // 巧克力 120-123 原版为非卖品 (ITEMDATA 仅 TYPE:巧克力), 现代聚合到隙间商店
  // 以闭合 COMF490 获得途径 (catalog plan).
  { id: 120, name: "黑雷神巧克力", price: 30, sales: "infinite", category: "食品" },
  { id: 121, name: "巧克力", price: 1000, sales: "infinite", category: "食品" },
  { id: 122, name: "高級巧克力", price: 3000, sales: "infinite", category: "食品" },
  { id: 123, name: "本命巧克力", price: 1000, sales: "infinite", category: "食品" },
  { id: 212, name: "槲葉糕", price: 500, sales: "infinite", category: "食品" },
  { id: 213, name: "冰淇淋", price: 500, sales: "infinite", category: "食品" },
  { id: 352, name: "草莓", price: 3000, sales: "infinite", category: "果物" },
  { id: 364, name: "西瓜", price: 3000, sales: "infinite", category: "果物" },
  { id: 550, name: "八目鰻烤串", price: 2500, sales: "infinite", category: "食品" },
  { id: 576, name: "灰汁卷", price: 5000, sales: "infinite", category: "食品" },
  { id: 626, name: "树莓", price: 50, sales: "infinite", category: "果物" },
  { id: 628, name: "木通果", price: 500, sales: "infinite", category: "果物" },
  { id: 630, name: "仙桃", price: 12000, sales: "infinite", category: "果物" },
  { id: 665, name: "山葡萄", price: 50, sales: "infinite", category: "果物" },
  { id: 669, name: "墨西哥卷饼", price: 6000, sales: "infinite", category: "食品" },
  // --- 其他 COMF490-usable (部分消费方 deferred, catalog plan) ---
  { id: 215, name: "紅茶", price: 500, sales: "infinite", category: "其他" },
  { id: 216, name: "糖", price: 500, sales: "infinite", category: "其他" },
  { id: 514, name: "仙香玉兎", price: 45000, sales: "infinite", category: "其他" },
  { id: 721, name: "神奇蘑菇", price: 10000, sales: "infinite", category: "其他" },
  // --- 素質 (buy-once; ITEMDATA "SALES" conditional + post-buy stat mutations) ---
  { id: 62, name: "【禁断的知識】", price: 80000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.TALENT[TALENT_ID.禁断的知識] ?? 0) !== 0 ? -1 : undefined,
    onBuy: (state) => { state.master.state.TALENT[TALENT_ID.禁断的知識] = 1; } },
  { id: 64, name: "【技巧DOWN】", price: 0, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.技巧] ?? 0) <= 0 ? -2 : undefined,
    onBuy: (state) => { state.master.state.ABL[ABL_ID.技巧] = (state.master.state.ABL[ABL_ID.技巧] ?? 0) - 1; } },
  { id: 66, name: "【汚臭耐性UP】", price: 5000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) >= 2 ? -2 : undefined,
    onBuy: (state) => { state.master.state.TALENT[TALENT_ID.汚臭耐性] = (state.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) + 1; } },
  { id: 67, name: "【汚臭耐性DOWN】", price: 5000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) <= -2 ? -2 : undefined,
    onBuy: (state) => { state.master.state.TALENT[TALENT_ID.汚臭耐性] = (state.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) - 1; } },
  { id: 68, name: "【施虐狂DOWN】", price: 3000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.施虐属性] ?? 0) <= 0 ? -2 : undefined,
    onBuy: (state) => {
      state.master.state.ABL[ABL_ID.施虐属性] = (state.master.state.ABL[ABL_ID.施虐属性] ?? 0) - 1;
      state.master.state.JUEL[PALAM_ID.優越] = 0;
      state.master.state.EXP[EXP_ID.嗜虐快楽経験] = Math.max(0, (state.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) - 200);
    } },
  { id: 69, name: "【受虐狂DOWN】", price: 3000, sales: "unique", category: "素質",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.受虐属性] ?? 0) <= 0 ? -2 : undefined,
    onBuy: (state) => { state.master.state.ABL[ABL_ID.受虐属性] = (state.master.state.ABL[ABL_ID.受虐属性] ?? 0) - 1; } },
  // --- 调教道具 (河童道具屋/通信販売) ---
  // 装备型 (SHOP_ASK 买1, 已有即不可再买 — ITEMDATA "SALES": IF ITEM RETURN -1).
  { id: 0, name: "跳蛋", price: 3000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[0] ?? 0) > 0 ? -1 : undefined },
  { id: 1, name: "電動按摩棒", price: 9000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[1] ?? 0) > 0 ? -1 : undefined },
  { id: 2, name: "陰蒂夾", price: 3000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[2] ?? 0) > 0 ? -1 : undefined },
  { id: 3, name: "飛機杯", price: 12000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[3] ?? 0) > 0 ? -1 : undefined },
  { id: 4, name: "振動棒", price: 4500, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[4] ?? 0) > 0 ? -1 : undefined },
  { id: 5, name: "肛用振動棒", price: 4500, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[5] ?? 0) > 0 ? -1 : undefined },
  { id: 10, name: "乳頭夾", price: 3000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[10] ?? 0) > 0 ? -1 : undefined },
  { id: 11, name: "搾乳器", price: 4500, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[11] ?? 0) > 0 ? -1 : undefined },
  { id: 12, name: "穿戴式假陰茎", price: 20000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[12] ?? 0) > 0 ? -1 : undefined },
  { id: 15, name: "眼罩", price: 15000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[15] ?? 0) > 0 ? -1 : undefined },
  { id: 16, name: "縄", price: 15000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[16] ?? 0) > 0 ? -1 : undefined },
  { id: 20, name: "塑料地墊", price: 6000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[20] ?? 0) > 0 ? -1 : undefined },
  { id: 23, name: "圍裙", price: 15000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[23] ?? 0) > 0 ? -1 : undefined },
  { id: 27, name: "【捕縛技能】", price: 30000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[27] ?? 0) > 0 ? -1 : undefined },
  // 补充调教道具 — Item.csv 注释项 (原版未实装/无商店), 为闭合 46/106/184 装备环
  // 与 186/192 消耗环入店 (现代化有意偏差, 见 DEBUG-BOARD). 价格取 Item.csv.
  { id: 6, name: "後庭拉珠", price: 4500, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[6] ?? 0) > 0 ? -1 : undefined },
  { id: 17, name: "口球", price: 15000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[17] ?? 0) > 0 ? -1 : undefined },
  { id: 21, name: "大鏡", price: 15000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[21] ?? 0) > 0 ? -1 : undefined },
  { id: 22, name: "项圈", price: 6000, sales: "infinite", category: "调教道具",
    salesGate: (s) => (s.items?.[22] ?? 0) > 0 ? -1 : undefined },
  { id: 91, name: "排卵誘発剤", price: 50000, sales: "infinite", category: "调教消耗" },
  // 消耗型 (infinite; 媚薬/利尿剤 原版需教養≥2 解锁).
  { id: 40, name: "潤滑液", price: 300, sales: "infinite", category: "调教消耗" },
  { id: 41, name: "媚薬", price: 3000, sales: "infinite", category: "调教消耗",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.教養] ?? 0) < 2 ? -2 : undefined },
  { id: 42, name: "利尿剤", price: 3000, sales: "infinite", category: "调教消耗",
    salesGate: (s) => (s.master.state.ABL[ABL_ID.教養] ?? 0) < 2 ? -2 : undefined },
  { id: 250, name: "催情薬", price: 5000, sales: "infinite", category: "调教消耗" },
  { id: 252, name: "睡眠薬", price: 3000, sales: "infinite", category: "调教消耗" },
];

// ---------------------------------------------------------------------------
// Wave 3b — village shop lineups (per-shop ITEMDATA "SHOP:<店名>" catalogs)
// ---------------------------------------------------------------------------

/**
 * A village outdoor shop: its scene location string + the catalog item ids it
 * sells (ITEMDATA `SHOP:<店名>` membership) + a flat 割引 discount percent.
 * Faithful to each `COMF6xx`'s `ITEMDATA(LOCAL, "SHOP:<店名>")` enumeration —
 * transcribed as an explicit id list (the DISHDATA-style full TYPE scan is
 * deferred; these are the in-catalog, buyable members).
 */
export interface VillageShop {
  /** COMF command number (614/618/622). */
  commandNo: number;
  /** Display name (店名). */
  name: string;
  /** The modern scene location string that gates the shop (execCheck). */
  location: string;
  /** Catalog ids this shop lists (must each be in SHOP_CATALOG). */
  itemIds: readonly number[];
  /** Flat 割引 discount percent (0 = none). */
  discount: number;
}

/**
 * The three clean TYPE-categorized produce/food buy-shops faithfully ported in
 * Wave 3b. Each `@COM6xx` does `ITEMDATA(LOCAL,"SHOP:<店名>")` to build its
 * lineup, `SHOW_SHOPPING` (a B9 picker), then `ITEMDATA "購入"` (= shopBuy).
 *
 * DEFER (complex shops, not here): 616 診察 (REMEDY + 調教 shop, 永遠亭 map
 * unbuilt), 623/624 材木/製材所 (lumber sell+craft economy), 625 家具屋
 * (furniture order/craft), 626 土産屋 (gift RNG, 香霖堂 map unbuilt), 627
 * 龍神の像 (weather oracle subsystem). 619 酒屋 buy path is here (sell 酒卸売 +
 * first-visit 40% + 累積購入 gift deferred); 620 鈴奈庵 (rental) + 617 甘味処
 * (dessert date) use their own modules. 614's date-bonus arm is deferred too.
 */
export const VILLAGE_SHOPS: readonly VillageShop[] = [
  {
    commandNo: 614,
    name: "食料品店",
    location: "人間之里:食料品店",
    // 食材 (平价/优质/高级/甜味料) + お肉 (獣肉/鳥肉) + 卵. 701/712/923 为
    // 事件料 (原版非卖品/口上给), 补入以闭合料理原料 (现代化偏差).
    itemIds: [81, 82, 83, 84, 702, 703, 711, 701, 712, 923],
    discount: 30, // 通常 30% (特売日 60% — daily-event RNG deferred → 通常).
  },
  {
    commandNo: 618,
    name: "花屋",
    location: "人間之里:花屋",
    // 園芸 苗 (全 15 种含跳蛋苗) + 肥料 + 園芸用品一式. `SHOP:花屋` 全成员.
    itemIds: [
      151, 152, 153, 161, 162, 163, 164, 171, 172, 173, 174, 181, 182, 183,
      190, 191, 150,
    ],
    discount: 0,
  },
  {
    commandNo: 622,
    name: "八百屋",
    location: "人間之里:八百屋",
    // 野菜 (番茄/白菜/胡萝卜/葱).
    itemIds: [362, 381, 382, 383],
    discount: 0,
  },
  {
    commandNo: 619,
    name: "酒屋",
    location: "人間之里:酒屋",
    // 酒購入 menu (COMF619:96-99): 浊酒/清酒/鬼杀酒/甜酒.
    itemIds: [51, 52, 53, 56],
    discount: 20, // 通常 20% (first-visit 40% deferred, like 614's 特売日).
  },
  {
    commandNo: 443,
    name: "河童の道具屋",
    location: "妖怪之山・山麓:河童の宣傳站",
    // 调教道具 (ITEMDATA "SHOP:河童の道具屋" membership): 装备型 0-27 (unique)
    // + 消耗型 40/41/42/250/252. 6/17/21/22/91 为 Item.csv 注释项/原版无商店,
    // 为闭合 46/106/184/186/192 装备与消耗环入店 (现代化有意偏差, 见 DEBUG-BOARD).
    itemIds: [
      0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 15, 16, 17, 20, 21, 22, 23, 27,
      40, 41, 42, 91, 250, 252,
    ],
    discount: 0,
  },
];

const CATALOG_BY_ID = new Map<number, ShopCatalogEntry>(
  SHOP_CATALOG.map((e) => [e.id, e]),
);

/** Look up a catalog entry by item id (`undefined` if not 通信販売-purchasable). */
export function catalogEntry(id: number): ShopCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// @ITEMSTOCK — buyability gate (COMMON.ERB:10-25)
// ---------------------------------------------------------------------------

/** `@ITEMSTOCK` result codes (COMMON.ERB:3-9). */
export const ITEM_STOCK_CODE = {
  OK: 0,
  NO_ITEM: 1,
  SOLD_OUT: 2,
  NO_MONEY: 3,
  SEALED: 4,
  AT_CAP: 5,
} as const;
export type ItemStockCode = (typeof ITEM_STOCK_CODE)[keyof typeof ITEM_STOCK_CODE];

/** era 所持数制限 — universal per-item hold cap (`@GET_ITEM` LIMIT 999). */
const HOLD_CAP = 999;

/**
 * `@ITEMSTOCK(ARG, 値段)` — the per-unit buyability gate, in era's exact
 * order. `unitPrice` is the per-unit discounted price
 * (`ITEMPRICE*(100-割引)/100`). Catalog membership proxies `!STRLENS
 * (ITEMNAME)` (only catalog items are 通信販売-purchasable). Mutates
 * nothing — pure read.
 */
export function itemStock(
  state: GameState,
  id: number,
  unitPrice: number,
): ItemStockCode {
  // ERB 15: SIF !STRLENS(ITEMNAME:ARG) RETURNF 1
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) return ITEM_STOCK_CODE.NO_ITEM;
  // 素質 conditional SALES gate (ITEMDATA "SALES" 条件判定优先于 itemSales).
  const gate = entry.salesGate?.(state);
  if (gate === -2) return ITEM_STOCK_CODE.SEALED;
  if (gate === -1) return ITEM_STOCK_CODE.SOLD_OUT;
  const stock = state.itemSales?.[id] ?? 0;
  // ERB 17: SIF ITEMSALES:ARG == -2 RETURNF 4 (sealed / 条件不満)
  if (stock === -2) return ITEM_STOCK_CODE.SEALED;
  // ERB 19: SIF ITEMSALES:ARG == -1 RETURNF 2 (sold out)
  if (stock === -1) return ITEM_STOCK_CODE.SOLD_OUT;
  // ERB 21: SIF MONEY < 値段 RETURNF 3 (can't afford even one)
  if (state.money < unitPrice) return ITEM_STOCK_CODE.NO_MONEY;
  // ERB 23: SIF ITEM:ARG >= 999 RETURNF 5 (at hold cap)
  if ((state.items?.[id] ?? 0) >= HOLD_CAP) return ITEM_STOCK_CODE.AT_CAP;
  return ITEM_STOCK_CODE.OK;
}

// ---------------------------------------------------------------------------
// shopBuy — @SHOP_ASK (single) + @ITEM_MATOMEGAI (bulk), unified
// ---------------------------------------------------------------------------

export interface ShopBuyResult {
  ok: boolean;
  /** On failure, the `ITEMSTOCK`-style code explaining why. */
  code: ItemStockCode;
  /** Per-unit discounted price actually charged (0 if not purchasable). */
  unitPrice: number;
  /** Total yen charged (0 on failure / no-op). */
  total: number;
  /** Units granted (0 on failure / no-op). */
  qty: number;
}

/**
 * Atomically buy `qty` of catalog item `id` at an optional `discount`
 * percent (0–100). Mirrors `@ITEM_MATOMEGAI` (bulk) for infinite/limited
 * items and `@SHOP_ASK` (single, qty=1) for unique items:
 *
 *   unitPrice = trunc(price * (100 - discount) / 100)   // era int div, per-unit
 *   gate per-unit ITEMSTOCK(itemStock)                   // can buy ≥1?
 *   gate bulk money: unitPrice * qty > MONEY  → NO_MONEY
 *   gate bulk cap:   ITEM + qty > 999        → AT_CAP
 *   apply: MONEY -= unitPrice * qty; ITEM += qty (addItem, 999 cap)
 *   stock: unique → ITEMSALES = -1; limited → max(cur - qty, …) → -1 if ≤0;
 *          infinite → unchanged.
 *
 * `qty <= 0` is a no-op success. Mutates `state` in place — callers pass a
 * cloned state. Returns the charged `total` + `unitPrice` for narration.
 */
export function shopBuy(
  state: GameState,
  id: number,
  qty: number,
  discount = 0,
): ShopBuyResult {
  const entry = CATALOG_BY_ID.get(id);
  if (entry === undefined) {
    return { ok: false, code: ITEM_STOCK_CODE.NO_ITEM, unitPrice: 0, total: 0, qty };
  }
  if (qty <= 0) {
    return { ok: true, code: ITEM_STOCK_CODE.OK, unitPrice: 0, total: 0, qty };
  }
  // DAILY_EV27 writes 100+region (and uses 1100+region before day-end
  // projection). The same computed unit price is used for the affordability
  // check and the actual debit, preserving integer-half semantics.
  if (discount === 0) {
    const sale = state.flagStore[872] ?? 0;
    const region = sale >= 1100 ? sale - 1100 : sale >= 100 ? sale - 100 : -1;
    if (region >= 0 && region === shopRegionForLocation(state.master.location)) discount = 50;
  }
  // @ITEM_MATOMEGAI:258 / @SHOP_ASK:231 — per-unit discounted price.
  const unitPrice =
    entry.price <= 0 ? 0 : Math.trunc((entry.price * (100 - discount)) / 100);

  // @SHOW_SHOPPING:102 — per-unit ITEMSTOCK gate (can buy ≥1?).
  const stockCode = itemStock(state, id, unitPrice);
  if (stockCode !== ITEM_STOCK_CODE.OK) {
    return { ok: false, code: stockCode, unitPrice, total: 0, qty };
  }
  const total = unitPrice * qty;
  // @ITEM_MATOMEGAI:274 — bulk money gate.
  if (state.money < total) {
    return { ok: false, code: ITEM_STOCK_CODE.NO_MONEY, unitPrice, total, qty };
  }
  // @ITEM_MATOMEGAI:277 — bulk hold-cap gate (所持数制限 = 999).
  if ((state.items?.[id] ?? 0) + qty > HOLD_CAP) {
    return { ok: false, code: ITEM_STOCK_CODE.AT_CAP, unitPrice, total, qty };
  }

  // Apply (ERB 281-283): MONEY -= 値段*qty; ITEM += qty.
  state.money -= total;
  addItem(state, id, qty, HOLD_CAP);

  // 素質/conditional post-buy mutations (ITEMDATA "購入" ERB 460-547).
  entry.onBuy?.(state);

  // Stock update by SALES kind (mirrors ITEMDATA "SALES" refresh).
  if (entry.sales === "unique") {
    if (state.itemSales == null) state.itemSales = {};
    state.itemSales[id] = -1; // sold out — already owned (ERB SALES: IF ITEM RETURN -1)
  } else if (entry.sales === "limited") {
    if (state.itemSales == null) state.itemSales = {};
    const after = (state.itemSales[id] ?? 0) - qty;
    state.itemSales[id] = after <= 0 ? -1 : after; // depleted → -1 (ERB SALES: IF <=0 RETURN -1)
  }
  // infinite: no stock change (SALES stays 99 via refresh; not persisted here).

  return { ok: true, code: ITEM_STOCK_CODE.OK, unitPrice, total, qty };
}

function shopRegionForLocation(location: string): number {
  const prefixes = ["神社", "人間之里", "永遠亭", "魔法の森", "紅魔館", "地底", "彼岸", "天界", "月都", "魔界", "夢"];
  const index = prefixes.findIndex((prefix) => location.includes(prefix));
  return index < 0 ? -1 : index;
}

export function souvenirSaleDiscount(state: Readonly<GameState>): number {
  const sale = state.flagStore[872] ?? 0;
  if (sale < 100) return 0;
  const region = sale >= 1100 ? sale - 1100 : sale - 100;
  return region === shopRegionForLocation(state.master.location) ? 50 : 0;
}

// ---------------------------------------------------------------------------
// restock — @お店に入荷 (SHOP_ITEM.ERB:436-446)
// ---------------------------------------------------------------------------

export const SHOP_RESTOCK_RULES: Readonly<Record<number, { amount: number; max: number }>> = {
  81: { amount: 10, max: 20 },
  82: { amount: 7, max: 15 },
  83: { amount: 5, max: 10 },
  84: { amount: 5, max: 10 },
  701: { amount: 5, max: 10 },
  702: { amount: 5, max: 10 },
  703: { amount: 5, max: 10 },
  711: { amount: 5, max: 10 },
  712: { amount: 5, max: 10 },
  923: { amount: 5, max: 10 },
  362: { amount: 5, max: 10 },
  381: { amount: 5, max: 10 },
  382: { amount: 5, max: 10 },
  383: { amount: 5, max: 10 },
};

/** Seed a shop's limited inventory once. Existing 0/-1/positive values are
 * authoritative and must survive reopening the shop. */
export function ensureShopStock(state: GameState, itemIds: readonly number[]): void {
  state.itemSales ??= {};
  for (const id of itemIds) {
    if (Object.prototype.hasOwnProperty.call(state.itemSales, id)) continue;
    const rule = SHOP_RESTOCK_RULES[id];
    if (rule) state.itemSales[id] = rule.amount;
  }
}

/** SHOP_EVENTTURNEND: replenish every modeled limited-stock item once/day. */
export function restockAllShopsAtDayEnd(state: GameState): void {
  for (const [idText, rule] of Object.entries(SHOP_RESTOCK_RULES)) {
    restock(state, Number(idText), rule.amount, rule.max);
  }
}

/**
 * `@お店に入荷(ARG, 入荷量, 最大在庫)` — day-end shop restock primitive
 * (also used by 酒屋 sell-back). Clamps to `maxStock`:
 *   - `cur >= maxStock` → no-op (過剰在庫).
 *   - `cur ∈ {-1, 0}`   → `cur = amount` (fresh stock).
 *   - else              → `cur = min(cur + amount, maxStock)`.
 * Mutates `state` in place.
 */
export function restock(
  state: GameState,
  id: number,
  amount: number,
  maxStock: number,
): void {
  if (state.itemSales == null) state.itemSales = {};
  const cur = state.itemSales[id] ?? 0;
  if (cur >= maxStock) return; // CASE IS >= 最大在庫 → no restock
  if (cur === -1 || cur === 0) {
    // CASE -1, 0 → 入荷量
    state.itemSales[id] = amount;
  } else {
    // CASEELSE → MIN(cur + amount, maxStock)
    state.itemSales[id] = Math.min(cur + amount, maxStock);
  }
}
