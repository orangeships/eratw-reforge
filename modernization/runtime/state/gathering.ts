/**
 * Phase 7 (P3) — 採集 (gathering) core mechanics, faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF445 採集する.ERB`.
 *
 * This module ports the **gather** half of the 采集→売→MONEY loop (the sell
 * half lands with the multi-map town shops in P6, per the system map). It
 * produces real 素材 ITEMs via the P1 ITEM namespace.
 *
 * Ported faithfully:
 *   - **採集パワー** (ERB 79, non-DLC): `10 + TALENT:採集Lv*10 + ABL:教養*5`.
 *   - **GATHERING_PRODUCT** spot-1 (鎮守之森/妖精的大樹) whitelist (ERB 506-508):
 *     the 17 素材 item ids findable there, each with its `Item.csv` price.
 *   - **Gathering_Drawing** draw (ERB 975-1085): scan the spot's item ids in
 *     a randomized start/direction (RAND:5 → 4 patterns, ERB 997-1014); the
 *     first item where `採集パワー + Modification >= SQRT(ITEMPRICE + 1000)`
 *     (ERB 1051) AND not already at the 999 hold cap is chosen. QTY then
 *     rolls `MAX(RAND(SQRT(採集パワー)) - tier, 1)` where tier is 1..4 by
 *     price band (ERB 1055-1066); rare (≥10000) items give QTY=1.
 *
 * **Deferred** (documented, same posture as other C-tier slices):
 *   - 土地の恵み (`CFLAG:今日の運勢/20 - 25`, daily-luck modifier) → 0.
 *   - Weather rare-item patches (台風/低気圧/積乱雲 → 龍之爪/竜血/竜骨/氷之鱗
 *     boosted threshold; ERB 1034-1048). None of these are in spot-1 anyway.
 *   - Normal seasonal availability remains deferred. DAILY_EV24's explicit
 *     `GatheringSeason` override is enforced so the event changes real draws.
 *   - MAGIC_DLC branches (power formula + QTY RANDSF variant + 宝藏袋).
 *   - Participant (date/TARGET) power-combine (ERB 71-92) — solo gather only.
 *   - Treasure-chest / LOCKPICK_SYSTEM (ERB 60-69).
 *   - FLAG:採集再抽選 re-roll loop (ERB 110-130) — one draw per call.
 *   - Location gates (幽香/天子/百百世 弾幕勝負, ERB 14-41).
 *   - GATHERING_SPOT spots 2-30 (P6 multi-map). Only spot 1 is mapped here.
 *   - 虹龍洞 (spot 68) air-thin extra cost (ERB 211-216).
 *   - 約會経験 / participant SOURCE (ERB 232-260).
 */

import type { GameState } from "./game-state.js";
import { ABL_ID, TALENT_ID } from "./settlement.js";

/** The eraBASIC `RNG` surface this module needs — a slice of `CommandContext.rng`. */
export interface GatherRng {
  /** era `RAND:n` — returns an int in [0, n). */
  int: (n: number) => number;
}

/** A 素材 item findable at a gathering spot. `price` is `ITEMPRICE` from Item.csv. */
export interface GatherItem {
  id: number;
  name: string;
  price: number;
}

/**
 * Spot-1 (鎮守之森 / 妖精的大樹) 素材 whitelist — `GATHERING_PRODUCT` CASE 1
 * (COMF445.ERB:506-508). Prices from `CSV/Item.csv`. Sorted by id ascending
 * (the natural scan order).
 */
export const GATHERING_SPOT_1_ITEMS: readonly GatherItem[] = [
  { id: 600, name: "普通的菌菇", price: 100 },
  { id: 601, name: "毒菌菇", price: 100 },
  { id: 602, name: "黏性菌菇", price: 100 },
  { id: 607, name: "薬草", price: 100 },
  { id: 608, name: "高級薬草", price: 300 },
  { id: 611, name: "山菜", price: 10 },
  { id: 612, name: "毒草", price: 200 },
  { id: 616, name: "山芋", price: 100 },
  { id: 618, name: "高麗人参", price: 1000 }, // 原版 spot 2/4/6/14/16/33/36 采集; 补 spot-1 白名单
  { id: 619, name: "苦根", price: 3000 },
  { id: 621, name: "白色树脂", price: 100 },
  { id: 622, name: "黄色树脂", price: 2000 },
  { id: 626, name: "树莓", price: 50 },
  { id: 627, name: "蜂蜜", price: 100 },
  { id: 628, name: "木通果", price: 500 },
  { id: 629, name: "竹笋", price: 800 }, // 委托「缺柴火了」交付物 (commission.ts ITEM_WOOD); 原版 spot 2/16/63 + 春季
  { id: 634, name: "竜骨", price: 3000 }, // 原版 spot 16/35/62/64/65
  { id: 636, name: "粪", price: 10 },
  { id: 638, name: "彷徨灵魂", price: 3000 }, // 原版 spot 3/5/8/16/32/61/62/65
  { id: 653, name: "魔界菌菇", price: 5000 }, // 原版 spot 16
  { id: 665, name: "山葡萄", price: 50 },
  { id: 666, name: "发霉葡萄", price: 10 },
];

/** id → item, for O(1) whitelist + price lookup during the scan. */
const SPOT_1_BY_ID = new Map<number, GatherItem>(
  GATHERING_SPOT_1_ITEMS.map((it) => [it.id, it]),
);

// 618/629/634/638/653 — 补入 spot-1 白名单的稀有采集料 (原版分散在其他
// spot / 季节限定). 全年可采以闭合料理原料与竹笋委托 (现代化偏差, 见
// DEBUG-BOARD; 原版 629 竹笋为春季限定).
const ALL_SEASON_ITEMS = new Set([
  600, 601, 607, 608, 612, 618, 619, 621, 622, 626, 627, 629, 634, 636, 638, 653,
]);

function availableInGatheringOverride(id: number, season: 1 | 2 | 3 | 4): boolean {
  if (ALL_SEASON_ITEMS.has(id)) return true;
  switch (season) {
    case 1:
      return id === 602 || id === 611 || id === 616;
    case 2:
      return id === 665;
    case 3:
      return id === 602 || id === 611 || id === 616 || id === 628 || id === 665;
    case 4:
      return false;
  }
}

/**
 * `@GATHERING_SPOT` (ERB 353) — resolve a location to a gathering-spot id
 * (1–30). Spot 1 = 鎮守之森 / 妖精的大樹. Returns 0 (no spot) for anywhere
 * else. Spots 2–30 are deferred to P6 multi-map.
 *
 * Live locations carry a "区域:" prefix (e.g. the shrine 鎮守之森 room is
 * stored as `"神社:鎮守之森"`), so we match on the room name after the last
 * `:`. Bare room names ("鎮守之森") still match for direct/test callers.
 */
export function gatheringSpot(location: string): number {
  const i = location.lastIndexOf(":");
  const room = i >= 0 ? location.slice(i + 1) : location;
  if (room === "鎮守之森" || room === "妖精的大樹") return 1;
  return 0;
}

/**
 * 採集パワー (ERB 79, non-DLC): `10 + TALENT:MASTER:採集Lv*10 + ABL:MASTER:
 * 教養*5`. The `TFLAG:幸運補正*10` and `ITEM:108` +10 bonuses and the
 * MAGIC_DLC branch are deferred.
 */
export function gatheringPower(state: GameState): number {
  const lv = state.master.state.TALENT[TALENT_ID.採集Lv] ?? 0;
  const kyo = state.master.state.ABL[ABL_ID.教養] ?? 0;
  return 10 + lv * 10 + kyo * 5;
}

/**
 * QTY tier for a chosen item, by `ITEMPRICE + 1000` band (ERB 1055-1066,
 * non-MAGIC_DLC). Returns the tier (1..4) subtracted from the SQRT(power)
 * roll, or 0 for the ≥10000 rare band (QTY fixed at 1).
 */
function qtyTier(pricePlus1000: number): number {
  if (pricePlus1000 <= 2000) return 1;
  if (pricePlus1000 <= 4000) return 2;
  if (pricePlus1000 <= 7000) return 3;
  if (pricePlus1000 <= 9999) return 4;
  return 0;
}

/** Era `SQRT` is integer (trunc); `RAND:n` is [0, n). QTY = MAX(roll - tier, 1). */
function rollQty(power: number, price: number, rng: GatherRng): number {
  const pricePlus1000 = price + 1000;
  if (pricePlus1000 >= 10000) return 1; // CASEELSE (no spot-1 item hits this; kept for fidelity)
  const tier = qtyTier(pricePlus1000);
  const sqrtPower = Math.floor(Math.sqrt(power));
  const roll = sqrtPower > 0 ? rng.int(sqrtPower) : 0;
  return Math.max(roll - tier, 1);
}

/** The result of one gather draw: the chosen item id (0 = nothing) + qty. */
export interface GatherResult {
  id: number;
  qty: number;
  name: string;
}

/**
 * One `@Gathering_Drawing` draw (ERB 975-1085) for spot 1. Scans the
 * contiguous id range 600–707 in a randomized start/direction (the 4
 * `RAND:5` patterns, ERB 997-1014); the first id that is (a) in the spot-1
 * whitelist, (b) not already at the 999 hold cap, and (c) passes
 * `採集パワー >= SQRT(ITEMPRICE + 1000)` is chosen, and its QTY is rolled.
 * Returns `{ id: 0 }` when nothing in the visited window passes (a real
 * outcome at low power / unlucky windows).
 */
export function gatherDraw(
  state: GameState,
  rng: GatherRng,
): GatherResult {
  const power = gatheringPower(state);
  const pattern = rng.int(5); // 0..4 → ERB SELECTCASE 0/1/2/CASEELSE
  let start: number;
  let end: number;
  let diff: number;
  switch (pattern) {
    case 0:
      start = 600 + rng.int(40);
      end = 707;
      diff = 1;
      break;
    case 1:
      start = 706;
      end = 599;
      diff = -1;
      break;
    case 2:
      start = 640 - rng.int(40);
      end = 599;
      diff = -1;
      break;
    default:
      start = 600 + 5 * rng.int(9);
      end = 707;
      diff = 1;
      break;
  }
  // ERB `FOR LOCAL, start, end, diff`: visits [start, end) for diff>0,
  // (end, start] for diff<0.
  for (let id = start; diff > 0 ? id < end : id > end; id += diff) {
    const item = SPOT_1_BY_ID.get(id);
    if (item === undefined) continue; // not in spot-1 whitelist (GATHERING_PRODUCT)
    if (state.gatheringSeason !== undefined && !availableInGatheringOverride(item.id, state.gatheringSeason)) continue;
    if ((state.items?.[id] ?? 0) >= 999) continue; // hold-cap skip (ERB 1020)
    // ERB 1051: skip if `power + Modification < SQRT(ITEMPRICE + 1000)`.
    // Modification (土地の恵み) deferred → 0.
    if (power < Math.floor(Math.sqrt(item.price + 1000))) continue;
    return { id: item.id, qty: rollQty(power, item.price, rng), name: item.name };
  }
  return { id: 0, qty: 0, name: "" };
}
