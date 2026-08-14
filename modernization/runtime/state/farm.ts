/**
 * FARM-BREW Part A — `state/farm.ts`: the 家庭菜園 (kitchen garden) engine.
 *
 * Faithful port of `ERB/コマンド関連/COMF/日常系/COMF418 家庭菜園.ERB`
 * (@FARMING / @INPLANT / @HERVEST / @収穫可能 / @苗対応作物番号取得 /
 * @GETUNELENGTH418) + the nightly growth tick `ERB/YASAI.ERB` (@YASAI,
 * called from `AFTERTRA.ERB:366 @EVENTEND` — the night-settlement chain).
 * Plan: `modernization/docs/FARM-BREW-PLAN.md` (Part A).
 *
 * State: `GameState.farm` — 5 `FarmPlot` slots (the `PLANT_*`/`HATAKE_NAME`
 * SAVEDATA arrays, `DIM.ERH:251-256`). The usable prefix is gated by
 * `TALENT:MASTER:採集Lv` (`@GETUNELENGTH418`); YASAI iterates all 5 slots
 * (`FOR LOCAL,0,5`) regardless — both faithful.
 *
 * **Faithfully ported:**
 *   - 苗↔作物 mapping (`@苗対応作物番号取得`): crop = seedling id + 200,
 *     except 跳蛋苗 (190) → 跳蛋 (item id **0** — GETNUM(ITEM,"跳蛋") really
 *     is 0, which is why the upstream harvest nerf reads `== 0`).
 *   - Plot count ladder (採集Lv >5→4 / >2→3 / >0→2 / else 1; the upstream
 *     >4 branch is redundant — both >4 and >2 yield 3).
 *   - Plant / water / uproot / fertilize / harvest actions with their
 *     upstream 行動コスト (10/5/10/20/20) and refusal arms.
 *   - `@HERVEST`: harvest gate (`@収穫可能` grow>7 && !withered), pre-yield
 *     grow bonuses (days>9 → +2, fertilized → +1, 天滴坤神 && RAND:2==1 →
 *     +2), the 大丰收/丰收/normal/poor yield ladder (fertilizer adds RAND
 *     bonuses), `TCVAR:MASTER:豊穣` +1/5, and the 跳蛋 ÷2 nerf.
 *   - `@YASAI` nightly tick: 澆水代行 proxy-watering (FLAG:85, set by the
 *     630 hobgoblin commission), days++/dry++, weather-indexed growth
 *     (TIME:5 = current weather index; caller passes the **real** simulated
 *     regional weather), rain (4-7) auto-waters, snow/storm (8-13) shrinks,
 *     地底 (MAIN_MAP==9) constant-growth arm kept structurally, and the
 *     三粒の天滴 (item 402) dry-rescue + 1/4 bonus-growth arms.
 *
 * **DEFERRED (documented, faithful-not-fabricated):**
 *   - 自动洒水 action 4 (needs ITEM:簡易泳池 38 + FLAG:泳池 bit2 — the pool
 *     subsystem is unbuilt; the handler does not surface the option).
 *   - `MAGIC_DLC_大成功相关` harvest bonus (DLC arm).
 *   - 三粒の天滴 (402) is not obtainable yet (諏訪子 gift event unbuilt) —
 *     its arms are live but dormant (ITEM:402 reads 0).
 *   - GMF 幻想乡大地图 / IS_GAP_GUEST arms of `@家庭菜園可` (handler gates
 *     on `PLACE_GARDEN` place-flags — the modern ROOMDATA 場所_菜園).
 */

import type { FarmPlot, GameState } from "./game-state.js";
import { FLAG_ID, TALENT_ID, TCVAR_ID } from "./settlement.js";
import { addItem, hasItem, removeItem } from "./items.js";

/** The eraBASIC `RAND` surface this module needs (`int(max)` → RAND:max). */
export interface FarmRng {
  int(max: number): number;
}

// ---------------------------------------------------------------------------
// 苗↔作物 registry (Item.csv rows; prices carried for the shop slice)
// ---------------------------------------------------------------------------

export interface SeedlingEntry {
  /** 苗 item id (`PLANT_TYPE` value). */
  seedlingId: number;
  /** 苗 display name (Item.csv). */
  seedlingName: string;
  /** Crop item id (`@苗対応作物番号取得`: +200, or 0 for 跳蛋). */
  cropId: number;
  /** Crop display name — becomes `HATAKE_NAME`. */
  cropName: string;
  /** 苗 unit price (Item.csv col 3) — used by the 花屋 stock slice. */
  price: number;
}

/** All 15 plantable 苗 (Item.csv 138-158). 大麦の苗 is upstream custom content. */
export const SEEDLINGS: readonly SeedlingEntry[] = [
  { seedlingId: 151, seedlingName: "卷心菜苗", cropId: 351, cropName: "卷心菜", price: 50 },
  { seedlingId: 152, seedlingName: "草莓苗", cropId: 352, cropName: "草莓", price: 50 },
  { seedlingId: 153, seedlingName: "芜菁苗", cropId: 353, cropName: "芜菁", price: 50 },
  { seedlingId: 161, seedlingName: "黄瓜苗", cropId: 361, cropName: "黄瓜", price: 50 },
  { seedlingId: 162, seedlingName: "番茄苗", cropId: 362, cropName: "番茄", price: 50 },
  { seedlingId: 163, seedlingName: "洋葱苗", cropId: 363, cropName: "洋葱", price: 50 },
  { seedlingId: 164, seedlingName: "西瓜苗", cropId: 364, cropName: "西瓜", price: 50 },
  { seedlingId: 171, seedlingName: "茄子苗", cropId: 371, cropName: "茄子", price: 50 },
  { seedlingId: 172, seedlingName: "马铃薯苗", cropId: 372, cropName: "马铃薯", price: 50 },
  { seedlingId: 173, seedlingName: "南瓜苗", cropId: 373, cropName: "南瓜", price: 50 },
  { seedlingId: 174, seedlingName: "大麦の苗", cropId: 374, cropName: "大麦", price: 50 },
  { seedlingId: 181, seedlingName: "白菜苗", cropId: 381, cropName: "白菜", price: 50 },
  { seedlingId: 182, seedlingName: "胡萝卜苗", cropId: 382, cropName: "胡萝卜", price: 50 },
  { seedlingId: 183, seedlingName: "葱苗", cropId: 383, cropName: "葱", price: 50 },
  // 跳蛋苗 (190, 5000円) → 跳蛋 (item id 0). Harvest yield is halved
  // (the upstream 一強-breaker nerf). Not sold at the 花屋 (source deferred).
  { seedlingId: 190, seedlingName: "跳蛋苗", cropId: 0, cropName: "跳蛋", price: 5000 },
];

const BY_SEEDLING: ReadonlyMap<number, SeedlingEntry> = new Map(
  SEEDLINGS.map((e) => [e.seedlingId, e]),
);

/** `@苗対応作物番号取得(苗id)` → the crop entry, or undefined for a non-苗 id. */
export function seedlingEntry(seedlingId: number): SeedlingEntry | undefined {
  return BY_SEEDLING.get(seedlingId);
}

/** Item ids for the garden gear (Item.csv). */
export const FARM_ITEM = {
  /** 園芸用品一式 — the garden kit `@COM_ABLE418` requires (`ITEM:150`). */
  園芸用品一式: 150,
  /** 肥料 — fertilizer consumable. */
  肥料: 191,
  /** 三粒の天滴 — 諏訪子's blessing item (dormant; not yet obtainable). */
  三粒の天滴: 402,
} as const;

// ---------------------------------------------------------------------------
// Plots
// ---------------------------------------------------------------------------

/** All-empty plot. */
function emptyPlot(): FarmPlot {
  return { type: 0, days: 0, grow: 0, dry: 0, food: 0, name: "" };
}

/** Total slots in the SAVEDATA arrays (`#DIM SAVEDATA PLANT_TYPE, 5`). */
export const FARM_SLOTS = 5;

/** The farm array, lazily initialized to 5 empty plots. Mutable reference. */
export function getFarm(state: GameState): FarmPlot[] {
  if (!state.farm) {
    state.farm = Array.from({ length: FARM_SLOTS }, emptyPlot);
  } else {
    // Old saves might carry a short array; pad to 5 (missing = empty slot).
    while (state.farm.length < FARM_SLOTS) state.farm.push(emptyPlot());
  }
  return state.farm;
}

/**
 * `@GETUNELENGTH418()` — usable plot count from `TALENT:MASTER:採集Lv`:
 * >5 → 4 / >2 → 3 / >0 → 2 / else 1. (The upstream >4 branch also yields 3 —
 * redundant, folded.) `FLAG:畑拡張` is a commented-out upstream leftover.
 */
export function plotCount(state: GameState): number {
  const lv = state.master.state.TALENT[TALENT_ID.採集Lv] ?? 0;
  if (lv > 5) return 4;
  if (lv > 2) return 3;
  if (lv > 0) return 2;
  return 1;
}

/** `PLANT_DRY > 4 || PLANT_GROW > 10` — the plot has withered (枯). */
export function isWithered(plot: FarmPlot): boolean {
  return plot.dry > 4 || plot.grow > 10;
}

/** `@収穫可能(ARG)` — grow > 7 and not withered. */
export function canHarvest(plot: FarmPlot): boolean {
  return plot.grow > 7 && !isWithered(plot);
}

/**
 * Growth-stage label (`@SHOW_PLANT` SELECTCASE): 枯 / 熟(10) / 果(8-9) /
 * 花(6-7) / 叶(4-5) / 苗(else). Empty plot → "".
 */
export function growthStage(plot: FarmPlot): string {
  if (plot.type <= 0) return "";
  if (isWithered(plot)) return "枯";
  if (plot.grow === 10) return "熟";
  if (plot.grow >= 8) return "果";
  if (plot.grow >= 6) return "花";
  if (plot.grow >= 4) return "叶";
  return "苗";
}

/** Reset a plot to empty (the repeated 6-line clear in the ERB). */
function clearPlot(plot: FarmPlot): void {
  plot.type = 0;
  plot.days = 0;
  plot.grow = 0;
  plot.dry = 0;
  plot.food = 0;
  plot.name = "";
}

// ---------------------------------------------------------------------------
// Actions (`@FARMING` arms + `@INPLANT`). All mutate a caller-cloned state
// and return `{ cost, messages }` (行動コスト minutes + display lines);
// refusal arms return cost 0 with the upstream refusal text.
// ---------------------------------------------------------------------------

export interface FarmActionResult {
  /** 行動コスト (minutes; the handler does `TIME += cost`). */
  cost: number;
  /** Display lines (upstream PRINTFORML output). */
  messages: string[];
}

/**
 * `@INPLANT(plot)` success path — plant a seedling the master owns.
 * 苗-1, `PLANT_TYPE=苗id`, `PLANT_DRY=1`, `HATAKE_NAME=作物名`; with
 * 三粒の天滴: instantly watered + fertilized + `FLAG:天滴坤神=1`.
 * Cost 10. Refuses (cost 0) when the plot is occupied, the id is not a 苗,
 * or none is owned.
 */
export function plantSeedling(
  state: GameState,
  plotIndex: number,
  seedlingId: number,
): FarmActionResult {
  const plot = getFarm(state)[plotIndex];
  if (!plot) return { cost: 0, messages: [] };
  if (plot.type > 0) {
    return { cost: 0, messages: [`已经种植了${plot.name}`] };
  }
  const entry = seedlingEntry(seedlingId);
  if (!entry || !hasItem(state, seedlingId)) {
    return { cost: 0, messages: [] };
  }
  removeItem(state, seedlingId, 1);
  plot.type = seedlingId;
  plot.days = 0;
  plot.grow = 0;
  plot.food = 0;
  plot.dry = 1;
  plot.name = entry.cropName;
  const messages = [`在畑${plotIndex}里种上了${entry.seedlingName}`];
  if (hasItem(state, FARM_ITEM.三粒の天滴)) {
    plot.dry = 0;
    plot.food = 1;
    state.flagStore[FLAG_ID.天滴坤神] = 1;
  }
  return { cost: 10, messages };
}

/**
 * `@FARMING` 行動番号1 — water one plot. Needs `PLANT_DRY > 0` (else
 * 「今天已经浇够水了」) and carried water (`VAR_WATER != ""`, else
 * 「还没有打水」). Sets DRY=0; with 三粒の天滴 arms 坤神. Cost 5.
 */
export function waterPlot(state: GameState, plotIndex: number): FarmActionResult {
  const plot = getFarm(state)[plotIndex];
  if (!plot || plot.type <= 0) return { cost: 0, messages: [] };
  if (plot.dry <= 0) {
    return { cost: 0, messages: ["今天已经浇够水了"] };
  }
  if (!state.varWater) {
    return { cost: 0, messages: ["还没有打水"] };
  }
  plot.dry = 0;
  if (hasItem(state, FARM_ITEM.三粒の天滴)) {
    state.flagStore[FLAG_ID.天滴坤神] = 1;
  }
  return { cost: 5, messages: [`对${plot.name}浇了水`] };
}

/**
 * Whether uprooting plot would discard a live (non-withered, pre-ripe)
 * plant — the upstream `PLANT_DRY <= 4 && PLANT_GROW <= 10` ASK_YN gate.
 * The handler surfaces a confirm variant when true.
 */
export function uprootNeedsConfirm(plot: FarmPlot): boolean {
  return plot.type > 0 && plot.dry <= 4 && plot.grow <= 10;
}

/** `@FARMING` 行動番号3 — uproot (clear) a plot. Cost 10. */
export function uprootPlot(state: GameState, plotIndex: number): FarmActionResult {
  const plot = getFarm(state)[plotIndex];
  if (!plot || plot.type <= 0) return { cost: 0, messages: [] };
  const name = plot.name;
  clearPlot(plot);
  return { cost: 10, messages: [`拔掉了${name}`] };
}

/**
 * `@FARMING` 行動番号5 — fertilize. Needs `ITEM:肥料` and `!PLANT_FOOD`
 * (else 「肥料太多了也不是好事」). FOOD=1, 肥料-1. Cost 20.
 */
export function fertilizePlot(state: GameState, plotIndex: number): FarmActionResult {
  const plot = getFarm(state)[plotIndex];
  if (!plot || plot.type <= 0) return { cost: 0, messages: [] };
  if (plot.food) {
    return { cost: 0, messages: ["肥料太多了也不是好事"] };
  }
  if (!hasItem(state, FARM_ITEM.肥料)) {
    return { cost: 0, messages: [] };
  }
  plot.food = 1;
  removeItem(state, FARM_ITEM.肥料, 1);
  return { cost: 20, messages: [`对${plot.name}施了肥料`] };
}

/**
 * `@HERVEST(ARG, ARGS)` — harvest one plot. Not harvestable → cost 0 no-op.
 * Pre-yield grow bonuses: days>9 → +2; fertilized → +1; `FLAG:天滴坤神` &&
 * RAND:2==1 → +2. Yield ladder (post-bonus grow): >12 大丰收 20 (+肥料
 * RAND:6+RAND:4) / >10 丰收 14 (+肥料 RAND:4+RAND:3) / >7 → 7 (+肥料
 * RAND:3+RAND:2) / else 5 (unreachable — gate needs grow>7). Then
 * `TCVAR:MASTER:豊穣` → +1/5 (int), crop id 0 (跳蛋) → ÷2. Crop enters
 * inventory; plot clears. Cost 20. MAGIC_DLC bonus deferred.
 */
export function harvestPlot(
  state: GameState,
  plotIndex: number,
  rng: FarmRng,
): FarmActionResult {
  const plot = getFarm(state)[plotIndex];
  if (!plot || !canHarvest(plot)) return { cost: 0, messages: [] };

  if (plot.days > 9) plot.grow += 2;
  if (plot.food) plot.grow += 1;
  if ((state.flagStore[FLAG_ID.天滴坤神] ?? 0) !== 0 && rng.int(2) === 1) {
    plot.grow += 2;
  }

  const messages: string[] = [];
  let yieldCount: number;
  if (plot.grow > 12) {
    messages.push("大丰收！");
    yieldCount = plot.food ? 20 + rng.int(6) + rng.int(4) : 20;
  } else if (plot.grow > 10) {
    messages.push("丰收了！");
    yieldCount = plot.food ? 14 + rng.int(4) + rng.int(3) : 14;
  } else if (plot.grow > 7) {
    yieldCount = plot.food ? 7 + rng.int(3) + rng.int(2) : 7;
  } else {
    yieldCount = 5; // upstream fallback arm; unreachable behind 収穫可能
  }

  if ((state.master.state.TCVAR[TCVAR_ID.豊穣] ?? 0) !== 0) {
    yieldCount += Math.trunc(yieldCount / 5);
  }
  const entry = seedlingEntry(plot.type);
  const cropId = entry?.cropId ?? plot.type + 200;
  if (cropId === 0) {
    // 跳蛋一強を崩すため収穫量ダウン (crop item id 0 really is 跳蛋).
    yieldCount = Math.trunc(yieldCount / 2);
  }

  messages.push(`收获了${yieldCount}个${plot.name}`);
  addItem(state, cropId, yieldCount);
  clearPlot(plot);
  return { cost: 20, messages };
}

/** `@FARMING` 行動番号6 — harvest every harvestable plot (costs add up). */
export function harvestAll(state: GameState, rng: FarmRng): FarmActionResult {
  const farm = getFarm(state);
  let cost = 0;
  const messages: string[] = [];
  for (let i = 0; i < farm.length; i++) {
    const r = harvestPlot(state, i, rng);
    cost += r.cost;
    messages.push(...r.messages);
  }
  return { cost, messages };
}

// ---------------------------------------------------------------------------
// `@YASAI` — nightly growth tick (AFTERTRA.ERB:366, night settlement)
// ---------------------------------------------------------------------------

/**
 * `@YASAI`. Runs once per night for every planted slot (upstream iterates
 * all 5 regardless of the 採集Lv gate — faithful).
 *
 * `weatherIndex` is upstream `TIME:5` — the **real** current weather index.
 * Callers should pass the simulated regional weather
 * (`gensokyoWeatherSystem[masterRegionId]`), not the display approximation.
 * `undergroundHome` mirrors `MAIN_MAP == 9` (地底 — constant growth, no
 * weather); unbuilt map, structurally kept (callers pass false today).
 *
 * Returns narration lines (the 坤神 rescue message).
 */
export function runYasaiTick(
  state: GameState,
  weatherIndex: number,
  rng: FarmRng,
  undergroundHome = false,
): string[] {
  const farm = getFarm(state);
  const messages: string[] = [];
  const rained: string[] = [];
  const stunted: string[] = [];
  let planted = 0;
  for (const plot of farm) {
    if (plot.type <= 0) continue;
    planted++;

    // FLAG:澆水代行 — hobgoblin proxy watering (commission 630).
    if ((state.flagStore[FLAG_ID.澆水代行] ?? 0) !== 0) plot.dry = 0;

    plot.days += 1;
    plot.dry += 1;

    if (undergroundHome) {
      // MAIN_MAP == 9 (地底): constant growth, fertilizer bonus.
      plot.grow += 1;
      if (plot.food && plot.grow < 10) plot.grow += 1;
    } else {
      // SELECTCASE TIME:5 — weather-indexed growth.
      if (weatherIndex === 0 || weatherIndex === 1) {
        plot.grow += 1;
        if (plot.food && plot.grow < 10) plot.grow += 1;
      } else if (weatherIndex === 2 || weatherIndex === 3) {
        plot.grow += rng.int(2);
        if (plot.food && plot.grow < 10) plot.grow += 1;
      } else if (weatherIndex >= 4 && weatherIndex <= 7) {
        plot.dry = 0; // rain waters the plot
        rained.push(plot.name);
        if (plot.food && plot.grow < 10) plot.grow += rng.int(2);
      } else if (weatherIndex >= 8 && weatherIndex <= 13) {
        const prevGrow = plot.grow;
        plot.grow -= rng.int(2);
        if (plot.grow < prevGrow) stunted.push(plot.name);
      }
      // 14+ (暴雨/钻石尘 etc.): no upstream CASE — nothing happens.
    }

    // 三粒の天滴 — dry rescue + 1/4 bonus growth.
    if (hasItem(state, FARM_ITEM.三粒の天滴)) {
      if ((state.flagStore[FLAG_ID.天滴坤神] ?? 0) !== 0 && plot.dry > 2) {
        messages.push("坤神的恩惠滋润了干涸的田地");
        plot.dry = 0;
        state.flagStore[FLAG_ID.天滴坤神] = 0;
      }
      if (plot.grow < 10 && rng.int(4) === 0) plot.grow += 1;
    }
  }

  // Weather narration — one line per effect, so the player sees the weather
  // interacting with their garden.
  if (rained.length > 0) {
    messages.push(`夜雨滋润了${rained.join("、")}，土壤得到了天然浇灌。`);
  }
  if (stunted.length > 0) {
    messages.push(`昨夜的严寒让${stunted.join("、")}的生长倒退了。`);
  }
  if (planted > 0 && rained.length === 0 && stunted.length === 0 &&
      weatherIndex >= 0 && weatherIndex <= 3) {
    messages.push("菜园在夜色中安静地生长着。");
  }

  return messages;
}
