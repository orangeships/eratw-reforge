/**
 * FARM-BREW Part B1 — `state/brewing.ts`: the 酒虫 brewing graph.
 *
 * Faithful port of the `@酒データ{N}` object table
 * (`ERB/コマンド関連/COMF/日常系/酒関連.ERB`, 酒データ1-102) + the shared
 * `@F酒データ_WATER_GENERAL` raw-ingredient additions +
 * `BREWING_WATER_GENERAL_ADDITIONS` (`SAKE_BREWING_GUIDE.ERH:10`).
 *
 * This module owns the **fermentation side**: each drink's 変化先 (what it
 * turns into if left in the jar), 醸造日数 (days needed), 醸造数 (bottles
 * extracted on a water swap), and ADDITIONS (mix-in recipes). The **drinking
 * side** (酒気増加量 / TASTE / EFFECT) lives in `state/alcohol.ts` (COMF332
 * 招待). The two are keyed the same way (drink name) and together describe a
 * drink completely.
 *
 * The eraBASIC object system indexes by numeric OBJ_ID and resolves names
 * via `BOOZE_MAP` (name→id). Since `VAR_FERMENT` is a **string** and the
 * fermentation graph is naturally a name→name transition, the modern
 * registry keys directly by drink name — the id/BOOZE_MAP indirection folds
 * away.
 *
 * **Faithfully ported:** the full 酒データ graph — 4 base waters (1/2/3/5)
 * that accept the 17 general raw-ingredient additions + their specials, the
 * juice/mash intermediates (WATER_GENERAL products), and every fermentation
 * chain (清酒→吟酿→熟成→古酒, 贵酿 line, 白兰地 VS→VSOP→XO, 朗姆 white→gold→
 * black, the fruit wines, etc.). 醸造数 formulas use `ABL:MASTER:教養` + RAND
 * (non-DLC arm; the MAGIC_DLC `RANDSF(…ITEM:957)` variant is deferred).
 *
 * **Deliberate upstream typo fix:** 酒データ101 麦芽汁 / 102 ビール use
 * `CASE "名称"` (a typo for `"名前"`) upstream, so their name lookup returns
 * "" — they never enter BOOZE_MAP, `ALC_ID` is 0, and the 大麦→麦芽汁→ビール
 * path is DEAD in the original. We correct that typo here: 麦芽汁 ferments to
 * 啤酒 (name reconciled to Item.csv's Chinese "啤酒" == id 593, not the JP
 * "ビール"), so the barley→beer chain works. This is a documented deviation
 * from the (bugged) upstream behavior — see the 101/102 entries below.
 *
 * **DEFERRED (documented):** MAGIC_DLC 醸造数 boosts + ITEM:957 catalyst; the
 * 果渣 EXTRA byproducts that are MAGIC_DLC-gated (only the two non-DLC 果渣
 * from 山葡萄/发霉葡萄 are kept); 夢美/鬼/神霊 TASTE arms are a drinking-side
 * (alcohol.ts) concern.
 */

import { ABL_ID, TALENT_ID } from "./settlement.js";
import type { GameState } from "./game-state.js";
import { addItem, hasItem, removeItem } from "./items.js";

/** The eraBASIC `RAND` surface (`int(max)` → RAND:max ∈ [0,max)). */
export interface BrewRng {
  int(max: number): number;
}

/** One mix-in recipe (`ADDITIONS` option). */
export interface BrewAddition {
  /** Consumed ingredients (`ITEM:<x>` count = `QUANTITY:<x>`). */
  ingredients: { item: string; qty: number }[];
  /** What the jar (`VAR_FERMENT`) becomes (`ITEM:<option>`). */
  result: string;
  /** `SPEED:<option>` → `DAY:10 += speed` (fermentation accelerator). */
  speed?: number;
  /** `EXTRA:<option>` byproduct granted (non-DLC only). */
  extra?: { item: string; qty: number };
}

/** One drink/water/mash in the brewing graph (`@酒データ{N}`). */
export interface BrewEntry {
  /** `名前` (== `VAR_FERMENT` string). */
  name: string;
  /** `変化先` — what it ferments into. Absent/"" = terminal (no transition). */
  changesTo?: string;
  /** `醸造日数` — days in the jar before the transition. Absent = 0/none. */
  fermentDays?: number;
  /** `醸造数` — bottles extracted on a water swap. Absent = 0 (water/mash). */
  brewYield?: (edu: number, rng: BrewRng) => number;
  /** `ADDITIONS` — mix-in recipes available on this jar content. */
  additions?: BrewAddition[];
}

/** `ABL:MASTER:教養` (education) — drives most 醸造数 formulas. */
function edu(state: GameState): number {
  return state.master.state.ABL[ABL_ID.教養] ?? 0;
}

// ---------------------------------------------------------------------------
// `@F酒データ_WATER_GENERAL` — raw farm produce → water/juice/mash.
// The `BREWING_WATER_GENERAL_ADDITIONS` list (17 options) is available on
// every base water (酒データ1/2/3/5, which fall through to this function).
// 果渣 EXTRA is MAGIC_DLC-gated EXCEPT 山葡萄/发霉葡萄 (non-DLC) — only those
// two are kept.
// ---------------------------------------------------------------------------

const WATER_GENERAL_ADDITIONS: BrewAddition[] = [
  { ingredients: [{ item: "马铃薯", qty: 10 }], result: "薯类酒曲" },
  { ingredients: [{ item: "南瓜", qty: 10 }], result: "南瓜水" },
  { ingredients: [{ item: "大麦", qty: 10 }], result: "麦芽汁" },
  { ingredients: [{ item: "蜂蜜", qty: 10 }], result: "蜂蜜水" },
  { ingredients: [{ item: "树莓", qty: 20 }], result: "树莓汁" },
  {
    ingredients: [{ item: "山葡萄", qty: 20 }],
    result: "葡萄汁",
    extra: { item: "果渣", qty: 1 }, // non-DLC byproduct
  },
  {
    ingredients: [{ item: "发霉葡萄", qty: 20 }],
    result: "贵腐葡萄汁",
    extra: { item: "果渣", qty: 1 }, // non-DLC byproduct
  },
  { ingredients: [{ item: "草莓", qty: 20 }], result: "草莓汁" },
  { ingredients: [{ item: "西瓜", qty: 20 }], result: "西瓜汁" },
  { ingredients: [{ item: "木通果", qty: 10 }], result: "木通果汁" },
  { ingredients: [{ item: "甜味料", qty: 10 }], result: "糖水" },
  { ingredients: [{ item: "优质食材", qty: 1 }], result: "大米酒曲" },
  { ingredients: [{ item: "药草", qty: 20 }], result: "草药汁" },
  { ingredients: [{ item: "陈酿前的朗姆酒", qty: 1 }], result: "陈酿前的朗姆酒" },
  { ingredients: [{ item: "陈酿前的莓子酒", qty: 1 }], result: "陈酿前的莓子酒" },
  { ingredients: [{ item: "陈酿前的草莓白兰地", qty: 1 }], result: "陈酿前的草莓白兰地" },
  { ingredients: [{ item: "陈酿前的白兰地", qty: 1 }], result: "陈酿前的白兰地" },
];

/** The 4 base waters (`GROUPMATCH` in `@CAN_FERMENT` / MIX_MENU). */
export const BASE_WATERS: readonly string[] = [
  "普通的水",
  "雾之湖的水",
  "地狱温泉的水",
  "奇迹之水",
];

// ---------------------------------------------------------------------------
// The 酒データ graph (keyed by 名前). 醸造数 formulas are the non-DLC arm.
// ---------------------------------------------------------------------------

const ENTRIES: BrewEntry[] = [
  // -- base waters (1/2/3/5) — general additions + their specials --
  {
    name: "普通的水", // 酒データ1
    changesTo: "浊酒",
    fermentDays: 5,
    additions: [
      ...WATER_GENERAL_ADDITIONS,
      // ／浊酒 special: pour finished 浊酒 back to jumpstart (stays water).
      { ingredients: [{ item: "浊酒", qty: 3 }], result: "普通的水", speed: 3 },
    ],
  },
  { name: "雾之湖的水", changesTo: "清酒", fermentDays: 5, additions: WATER_GENERAL_ADDITIONS }, // 2
  { name: "地狱温泉的水", changesTo: "鬼杀酒", fermentDays: 5, additions: WATER_GENERAL_ADDITIONS }, // 3
  {
    name: "奇迹之水", // 酒データ5
    changesTo: "神酒",
    fermentDays: 5,
    additions: [
      ...WATER_GENERAL_ADDITIONS,
      { ingredients: [{ item: "大米酒曲", qty: 1 }], result: "大米酒醅" },
    ],
  },

  // -- 酒データ4 葡萄汁 (juice, not a base water) --
  {
    name: "葡萄汁", // 4
    changesTo: "红酒",
    fermentDays: 5,
    additions: [{ ingredients: [{ item: "蒸馏酒", qty: 1 }], result: "葡萄汁(含酒精)" }],
  },

  // -- juice / mash intermediates --
  { name: "大米酒曲", changesTo: "甜酒", fermentDays: 1, brewYield: (e, r) => Math.max(1, r.int(e + 1)) }, // 6
  { name: "薯类酒曲", changesTo: "薯类酒醅", fermentDays: 5 }, // 10
  { name: "蜂蜜水", changesTo: "蜂蜜酒", fermentDays: 5 }, // 11
  { name: "树莓汁", changesTo: "果酒", fermentDays: 5 }, // 12
  { name: "糖水", changesTo: "发酵糖浆", fermentDays: 5 }, // 13
  { name: "陈酿前的莓子酒", changesTo: "莓子酒", fermentDays: 5 }, // 14
  { name: "陈酿前的朗姆酒", changesTo: "白朗姆酒", fermentDays: 5 }, // 15
  { name: "葡萄汁(含酒精)", changesTo: "强化红酒", fermentDays: 5 }, // 16
  { name: "贵腐葡萄汁", changesTo: "贵腐红酒", fermentDays: 5 }, // 17
  { name: "陈酿前的白兰地", changesTo: "白兰地VS", fermentDays: 5 }, // 18
  { name: "发酵糖浆", brewYield: () => 5 }, // 19 terminal, yields 5
  { name: "南瓜水", changesTo: "南瓜酒醅", fermentDays: 5 }, // 88
  { name: "草莓汁", changesTo: "草莓酒", fermentDays: 5 }, // 91
  { name: "陈酿前的草莓白兰地", changesTo: "草莓白兰地", fermentDays: 5 }, // 93
  { name: "木通果汁", changesTo: "木通果酒", fermentDays: 5 }, // 95
  { name: "西瓜汁", changesTo: "西瓜家酿酒", fermentDays: 5 }, // 97
  { name: "草药汁", changesTo: "苦艾酒", fermentDays: 5 }, // 99

  // -- terminals / chains with yields --
  { name: "烧酒", brewYield: () => 0 }, // 49
  { name: "一夜奇稻田" }, // 50 (yield unset)
  {
    name: "浊酒", // 51
    changesTo: "清酒",
    fermentDays: 5,
    brewYield: (e, r) => 10 + r.int(e * 2 + 1),
    additions: [{ ingredients: [{ item: "草木灰", qty: 1 }], result: "灰持酒" }],
  },
  {
    name: "清酒", // 52 — 変化先 吟酿酒 only under MAGIC_DLC+ITEM:957>=4 → non-DLC terminal.
    brewYield: (e, r) => 10 + r.int(e * 2 + 1),
    additions: [
      {
        ingredients: [
          { item: "蒸馏酒", qty: 1 },
          { item: "甜味料", qty: 1 },
        ],
        result: "三增酒",
      },
    ],
  },
  { name: "鬼杀酒", fermentDays: 0, brewYield: (e, r) => 5 + r.int(e + 1) }, // 53
  { name: "红酒", changesTo: "陈酿红酒", fermentDays: 5, brewYield: () => 5 }, // 54
  { name: "神酒", brewYield: (e, r) => 1 + r.int(Math.trunc(e / 2) + 1) }, // 55
  { name: "甜酒", brewYield: (e, r) => 10 + r.int(e * 2 + 1) }, // 56
  { name: "蒸馏酒" }, // 58 terminal, no yield
  { name: "药酒" }, // 59 terminal, no yield
  { name: "薯类酒醅", brewYield: (e, r) => 5 + r.int(e + 1) }, // 60 terminal mash
  { name: "蜂蜜酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 61
  { name: "果酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 62
  { name: "莓子酒", brewYield: () => 1 }, // 63
  { name: "白朗姆酒", changesTo: "金朗姆酒", fermentDays: 5, brewYield: () => 3 }, // 64
  { name: "金朗姆酒", changesTo: "黑朗姆酒", fermentDays: 5, brewYield: () => 3 }, // 65
  { name: "黑朗姆酒", brewYield: () => 3 }, // 66
  { name: "强化红酒", brewYield: (e, r) => 7 + r.int(e + 1) }, // 67
  { name: "贵腐红酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 68
  { name: "陈酿红酒", changesTo: "优质陈酿红酒", fermentDays: 10, brewYield: (e, r) => 5 + r.int(e + 1) }, // 69
  { name: "优质陈酿红酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 70
  { name: "白兰地VS", changesTo: "白兰地VSOP", fermentDays: 5, brewYield: () => 3 }, // 71
  { name: "白兰地VSOP", changesTo: "白兰地XO", fermentDays: 10, brewYield: () => 3 }, // 72
  { name: "白兰地XO", brewYield: () => 3 }, // 73
  { name: "灰持酒", fermentDays: 0, brewYield: () => 10 }, // 74
  { name: "果渣白兰地", brewYield: () => 0 }, // 75
  { name: "大米酒醅", changesTo: "云浊酒", fermentDays: 5 }, // 76
  { name: "云浊酒", changesTo: "吟酿酒", fermentDays: 2, brewYield: (e, r) => 5 + r.int(e + 1) }, // 77
  {
    name: "吟酿酒", // 78
    changesTo: "熟成酒",
    fermentDays: 5,
    brewYield: (e, r) => 4 + r.int(e + 1),
    additions: [{ ingredients: [{ item: "大米酒曲", qty: 1 }], result: "复酿酒醅" }],
  },
  { name: "熟成酒", changesTo: "古酒", fermentDays: 10, brewYield: (e, r) => 3 + r.int(e + 1) }, // 79
  { name: "古酒", brewYield: (e, r) => 2 + r.int(e + 1) }, // 80
  { name: "复酿酒醅", changesTo: "贵酿云浊酒", fermentDays: 7 }, // 81
  { name: "贵酿云浊酒", changesTo: "贵酿酒", fermentDays: 2, brewYield: (e, r) => 4 + r.int(e + 1) }, // 82
  { name: "贵酿酒", changesTo: "贵酿熟成酒", fermentDays: 5, brewYield: (e, r) => 3 + r.int(e + 1) }, // 83
  { name: "贵酿熟成酒", changesTo: "贵酿古酒", fermentDays: 10, brewYield: (e, r) => 3 + r.int(e + 1) }, // 84
  { name: "贵酿古酒", brewYield: (e, r) => 2 + r.int(e + 1) }, // 85
  { name: "酒粕烧酒" }, // 86 terminal
  { name: "三增酒", brewYield: (e, r) => 30 + r.int(e + 1) * 3 }, // 87
  { name: "南瓜酒醅", brewYield: (e, r) => 5 + r.int(e + 1) }, // 89
  { name: "南瓜烧酒", brewYield: () => 0 }, // 90
  { name: "草莓酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 92
  { name: "草莓白兰地", brewYield: () => 1 }, // 94
  { name: "木通果酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 96
  { name: "西瓜家酿酒", brewYield: (e, r) => 5 + r.int(e + 1) }, // 98
  { name: "苦艾酒", brewYield: (e, r) => 3 + r.int(e + 1) }, // 100
  // 酒データ101 麦芽汁 / 102 ビール — upstream `CASE "名称"` (a typo for
  // "名前") left these unregistered, killing the 大麦→麦芽汁→啤酒 path. We
  // DELIBERATELY correct that typo here (name reconciled to the Item.csv
  // Chinese "啤酒" == id 593, not the JP "ビール"), so the barley→beer chain
  // works. Documented deviation from the broken upstream behavior.
  { name: "麦芽汁", changesTo: "啤酒", fermentDays: 5 }, // 101 (typo-fixed)
  { name: "啤酒", brewYield: (e, r) => 10 + r.int(e + 1) }, // 102 (typo-fixed)
];

const BY_NAME: ReadonlyMap<string, BrewEntry> = new Map(ENTRIES.map((e) => [e.name, e]));

/**
 * Drink/mash name → Item.csv id. The extraction (`GET_ITEM(VAR_FERMENT,…)` in
 * COMF450) grants bottles by NAME → GETNUM(ITEM, name); this is that map. The
 * canonical drinks are 51-59 (`酒データ N == item id`), the 酒造パッチ additions
 * are 560-593, and the item-backed mashes/pre-ages are 660-674. Shared with
 * `alcohol.ts` (B4) which registers the drinking-side 酒気/TASTE by item id.
 * Names absent here have no inventory item (waters/juices/some mashes with
 * 醸造数 0 → never extracted; the 发酵糖浆 quirk with yield-but-no-item is a
 * documented dead grant).
 */
export const BREW_ITEM_ID: Readonly<Record<string, number>> = {
  浊酒: 51,
  清酒: 52,
  鬼杀酒: 53,
  红酒: 54,
  神酒: 55,
  甜酒: 56,
  蒸馏酒: 58,
  药酒: 59,
  一夜奇稻田: 513,
  烧酒: 560,
  蜂蜜酒: 561,
  果酒: 562,
  莓子酒: 563,
  白朗姆酒: 564,
  金朗姆酒: 565,
  黑朗姆酒: 566,
  强化红酒: 567,
  贵腐红酒: 568,
  陈酿红酒: 569,
  优质陈酿红酒: 570,
  白兰地VS: 571,
  白兰地VSOP: 572,
  白兰地XO: 573,
  灰持酒: 574,
  果渣白兰地: 575,
  云浊酒: 577,
  吟酿酒: 578,
  熟成酒: 579,
  古酒: 580,
  酒粕烧酒: 581,
  贵酿云浊酒: 582,
  贵酿酒: 583,
  贵酿熟成酒: 584,
  贵酿古酒: 585,
  三增酒: 586,
  啤酒: 593,
  草莓酒: 587,
  草莓白兰地: 588,
  木通果酒: 589,
  西瓜家酿酒: 590,
  南瓜烧酒: 591,
  苦艾酒: 592,
  薯类酒醅: 660,
  南瓜酒醅: 673,
};

/** The Item.csv id a drink name grants as a bottle, or undefined if none. */
export function brewItemId(name: string): number | undefined {
  return BREW_ITEM_ID[name];
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

/** The jar's current content (`VAR_FERMENT`), defaulting to 普通的水. */
export function currentFerment(state: GameState): string {
  return state.varFerment && state.varFerment !== "" ? state.varFerment : "普通的水";
}

/** The `@酒データ` entry for a drink name, or undefined if unregistered. */
export function brewEntry(name: string): BrewEntry | undefined {
  return BY_NAME.get(name);
}

/** `変化先` — what `name` ferments into ("" / undefined = terminal). */
export function fermentTarget(name: string): string | undefined {
  const e = BY_NAME.get(name);
  return e?.changesTo && e.changesTo !== "" ? e.changesTo : undefined;
}

/** `醸造日数` for `name` (0 when none / terminal). */
export function fermentDays(name: string): number {
  return BY_NAME.get(name)?.fermentDays ?? 0;
}

/** `醸造数` — bottles extracted when swapping water out of `name`'s jar. */
export function brewYield(state: GameState, name: string, rng: BrewRng): number {
  const e = BY_NAME.get(name);
  if (!e?.brewYield) return 0;
  return e.brewYield(edu(state), rng);
}

/** `ADDITIONS` recipes available on `name`'s jar (empty when none). */
export function brewAdditions(name: string): BrewAddition[] {
  return BY_NAME.get(name)?.additions ?? [];
}

/** Whether `name` is one of the 4 base waters (`@CAN_FERMENT` GROUPMATCH). */
export function isBaseWater(name: string): boolean {
  return BASE_WATERS.includes(name);
}

/**
 * `@CAN_FERMENT` — a base water can still take additions only while its
 * `DAY:10` (brewDays) is under 3 (else 発酵过头 → all options greyed). Non-
 * water jars are always addition-eligible if they have any recipe. Faithful
 * to `@CAN_FERMENT(ARG)` (`COMF450:127-133`): `DAY:10 >= 3 → 0`, then
 * GROUPMATCH base water → 1.
 */
export function canFerment(state: GameState, name: string): boolean {
  if ((state.brewDays ?? 0) >= 3) return false;
  return isBaseWater(name);
}

/** Every registered drink name (for guide / test iteration). */
export function allBrewNames(): string[] {
  return ENTRIES.map((e) => e.name);
}

/** `@BREWING_GUIDE_MAKE_KNOWN` — mark a drink seen in the guide 图鉴. */
export function markBrewKnown(state: GameState, name: string): void {
  if (!brewEntry(name)) return; // unregistered (e.g. 麦芽汁) → no id → not tracked
  if (state.brewKnown == null) state.brewKnown = {};
  state.brewKnown[name] = true;
}

/** Whether a drink is in the brewing guide 图鉴. */
export function isBrewKnown(state: GameState, name: string): boolean {
  return Boolean(state.brewKnown?.[name]);
}

// ---------------------------------------------------------------------------
// COMF450 actions — swap water (extract brew) + apply an addition
// ---------------------------------------------------------------------------

/** Aged sakes that drop 酒粕 (item 672) on a water swap (COMF450:44-46). */
const AGED_SAKES = new Set([
  "吟酿酒",
  "熟成酒",
  "古酒",
  "贵酿酒",
  "贵酿熟成酒",
  "贵酿古酒",
]);

/** Feed items (COMF450:51-70): 鱼粕 642 (+1 DAY:10) / 肉骨粉 648 (+2). */
export const BREW_FEED = { 鱼粕: 642, 肉骨粉: 648, 酒粕: 672 } as const;

/**
 * COMF450 option 1 — swap the carried water (`VAR_WATER`) into the jar,
 * extracting the finished brew first. Faithful to `COMF450:35-71`:
 *
 *   醸造量 = 醸造数(current); 酒造家(>=1) → 醸造量++; IF 醸造量>0 →
 *     GET_ITEM(current, 醸造量); aged sake → +酒粕; jar = VAR_WATER,
 *     VAR_WATER="", DAY:10=0; optional feed (鱼粕 +1 / 肉骨粉 +2);
 *     MAKE_KNOWN(jar).
 *
 * `feed` picks the nested ASK_M arm ("none"/"fish"/"bone"); the handler only
 * offers "fish"/"bone" when the item is held. Returns narration lines.
 * Mutates `state`. Requires `state.varWater` set (the handler gates this).
 */
export function swapWater(
  state: GameState,
  rng: BrewRng,
  feed: "none" | "fish" | "bone" = "none",
): string[] {
  const messages: string[] = [];
  const current = currentFerment(state);
  const water = state.varWater ?? "";
  if (water === "") return messages; // guarded by the handler

  let amount = brewYield(state, current, rng);
  const brewer = state.master.state.TALENT[TALENT_ID.酒造家] ?? 0;
  if (amount > 0 && brewer >= 1) amount++;
  if (amount > 0) {
    const itemId = brewItemId(current);
    if (itemId != null) addItem(state, itemId, amount);
    messages.push(`从酒虫之瓶中取出了${amount}瓶${current}。`);
  }
  if (AGED_SAKES.has(current)) {
    addItem(state, BREW_FEED.酒粕, 1);
    messages.push("还得到了酒粕。");
  }

  state.varFerment = water;
  state.varWater = "";
  state.brewDays = 0;
  messages.push(`往瓶里放入了${water}。`);

  if (feed === "fish" && hasItem(state, BREW_FEED.鱼粕)) {
    removeItem(state, BREW_FEED.鱼粕, 1);
    state.brewDays += 1;
    messages.push("酒虫吃完了鱼粕而变得稍微活跃了一点…");
  } else if (feed === "bone" && hasItem(state, BREW_FEED.肉骨粉)) {
    removeItem(state, BREW_FEED.肉骨粉, 1);
    state.brewDays += 2;
    messages.push("酒虫吃完了肉骨粉而变得活跃起来…");
  }

  markBrewKnown(state, water);
  return messages;
}

/**
 * COMF450 option 2 — apply an `ADDITIONS` recipe (`MIX_MENU`): consume the
 * ingredients, turn the jar into `result`, add `speed` to DAY:10, grant the
 * `extra` byproduct, MAKE_KNOWN. Faithful to `BREWING_GUIDE_MIX_MENU`
 * (`SAKE_BREWING_GUIDE.ERB:472-492`). Returns narration; mutates `state`.
 * The handler validates ingredient ownership before calling.
 */
export function applyBrewAddition(state: GameState, addition: BrewAddition): string[] {
  // The B9 handler filters this first, but every caller must preserve the
  // material-cost invariant as well.
  if (!canApplyBrewAddition(state, addition)) return [];
  for (const ing of addition.ingredients) {
    const id = brewIngredientItemId(ing.item);
    if (id != null) removeItem(state, id, ing.qty);
  }
  if (addition.extra) {
    const id = brewIngredientItemId(addition.extra.item);
    if (id != null) addItem(state, id, addition.extra.qty);
  }
  state.varFerment = addition.result;
  if (addition.speed) state.brewDays = (state.brewDays ?? 0) + addition.speed;
  markBrewKnown(state, addition.result);
  return [`酒虫之瓶中的内容物变成了${addition.result}。`];
}

/**
 * Item ids for addition ingredients / byproducts that are NOT brew names
 * (raw produce / consumables). Brew-name ingredients resolve via
 * `brewItemId`; these cover the rest. Missing entries → the consume/grant is
 * a documented no-op (the recipe still transforms the jar).
 */
const INGREDIENT_ITEM_ID: Readonly<Record<string, number>> = {
  马铃薯: 372,
  南瓜: 373,
  大麦: 374,
  蜂蜜: 627,
  树莓: 626,
  草莓: 352,
  西瓜: 364,
  木通果: 628,
  山葡萄: 665,
  发霉葡萄: 666,
  甜味料: 84,
  药草: 607,
  草木灰: 667,
  果渣: 668,
  优质食材: 82,
};

/** Resolve an addition ingredient to its inventory item id, if registered. */
export function brewIngredientItemId(name: string): number | undefined {
  return brewItemId(name) ?? INGREDIENT_ITEM_ID[name];
}

/** Unknown ingredients fail closed; recipes never create free products. */
export function canApplyBrewAddition(state: GameState, addition: BrewAddition): boolean {
  return addition.ingredients.every((ingredient) => {
    const id = brewIngredientItemId(ingredient.item);
    return id != null && hasItem(state, id, ingredient.qty);
  });
}

// ---------------------------------------------------------------------------
// `@酒造` nightly fermentation tick
// ---------------------------------------------------------------------------

/**
 * `@酒造` (`酒関連.ERB:2528-2543`), the nightly brew tick called from
 * `AFTERTRA.ERB:371 @EVENTEND` (right after `CALL YASAI`):
 *
 *   DAY:10++; days = 醸造日数(jar); 杜氏(酒造家>=2) && days>2 → days--;
 *   IF days>0 && days<=DAY:10 → jar = 変化先, DAY:10=0, MAKE_KNOWN, 黄字旁白.
 *
 * DAILY_EV30 is dispatched separately before this function. Keeping the base
 * tick free of its own random roll preserves the upstream first-hit DAILY_EV
 * exclusivity.
 *
 * Mutates `state`; returns narration lines (empty when nothing changed).
 */
export function runBrewTick(state: GameState, _rng?: BrewRng): string[] {
  const messages: string[] = [];

  // @酒造.
  state.brewDays = (state.brewDays ?? 0) + 1;
  const current = currentFerment(state);
  let days = fermentDays(current);
  const brewer = state.master.state.TALENT[TALENT_ID.酒造家] ?? 0;
  if (brewer >= 2 && days > 2) days--;

  if (days > 0 && days <= state.brewDays) {
    const target = fermentTarget(current);
    if (target) {
      state.varFerment = target;
      state.brewDays = 0;
      markBrewKnown(state, target);
      messages.push(`酒虫之瓶中的${current}变成了${target}。`);
    }
  }
  return messages;
}
