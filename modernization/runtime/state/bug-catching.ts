import { RAW_BUG_BAITS, RAW_BUG_CATALOG } from "./bug-catalog.generated.js";
import { mapIdOfLocation } from "../world/location-predicates.js";
import type { GameState } from "./game-state.js";

/**
 * 449 虫捕り — bug catching state & data (V1).
 *
 * V1 scope: representative bug catalog (~20 bugs, rarity 0-8), spot→field
 * bitset mapping for built maps (shrine/village/koumakan/reiten), drawBug
 * lottery, mushitoriSpot validation, and item-conversion table.
 *
 * TODO (V2 full catalog):
 * - Full 100+ bug data table (MUSHI_DATA.ERB 3777 lines)
 * - G-type / X-type mutations + rank system
 * - Bug cage storage (MUSHI_CAGE, MUSHI_MAXCAGE)
 * - Bug collection book (MUSHI_COLLECT)
 * - Partner catch negotiation mini-game (抢/求/杀)
 * - MUSHI_PALAM battle stats (HP/ATK/SPD/SKL for 483 ムシバトル)
 * - 昆虫诱捕装置 (insect trap) mode
 * - Yukkuri special剧情
 * - Bug-catching in unbuilt maps (bamboo forest, moriya, etc.)
 */

// ---------------------------------------------------------------------------
// Field-type bitset (mirrors @FIELD_SETBIT in COMF449.ERB)
// ---------------------------------------------------------------------------

export const FIELD = {
  GRASS:    1 << 0,  // 草
  FLOWER:   1 << 1,  // 花
  TREE:     1 << 2,  // 樹
  DIRT:     1 << 3,  // 土
  WATER:    1 << 4,  // 水
  ROCK:     1 << 5,  // 岩
  BUILDING: 1 << 6,  // 家
  MOON:     1 << 7,  // 月
  HOLY:     1 << 8,  // 圣
  MAGIC:    1 << 9,  // 魔
} as const;

// ---------------------------------------------------------------------------
// Representative bug catalog (~20 bugs covering rarity 0-8)
// ---------------------------------------------------------------------------

export interface BugDef {
  /** 1-indexed bug number (matches MUSHI_NUM in MUSHI_DATA.ERB) */
  num: number;
  name: string;
  /** Rarity 0 (common) to 9 (legendary) */
  rarity: number;
  /** Tribe tags, e.g. `[蝶][飛行]`. Empty string = tribe-less species (14 upstream). */
  tribe: string;
  /** 属性（色）. May stack two colours, e.g. `緑黒`. */
  type: string;
  field: number;        // FIELD bitset
  /** Area bitset (mapId 0..11), faithful to AREA_SETBIT. */
  area: number;
  /** Conditions for appearance; empty = always */
  condition: string;    // "昼間" | "夜間" | "夏" | "夏&&夜間" | ""
  /** Atomic upstream ムシ出現条件 predicates. */
  conditions: readonly string[];
  /** `FAVOS`: bait types or named favourites used by the insect trap. */
  favorites: string;
  /** Base 斗虫 stats. `MUSHI_PALAM` derives max HP/ATK/SPD from these + rank. */
  hp: number;
  atk: number;
  spd: number;
  size: number;
  /** Special abilities, e.g. `[睡眠粉][強攻撃]`. */
  skl: string;
  /** Catch result → item conversion (item id or pseudo-category) */
  itemId: number;       // Item.csv id
}

/**
 * V1 bug table — 20 representative bugs hand-picked from MUSHI_DATA.ERB cases
 * 1-95, covering all rarity tiers and common field types.
 *
 * TODO(V2): full 100+ bug catalog from MUSHI_DATA.ERB.
 */
/**
 * Readable fixture slice used as documentation examples. Deliberately *not* a
 * `BugDef`: the battle fields (type/hp/atk/spd/size/skl) live in the generated
 * catalog, and duplicating hand-typed copies here would only rot.
 */
const LEGACY_BUG_CATALOG: ReadonlyArray<Pick<BugDef, "num" | "name" | "rarity" | "tribe" | "field" | "condition" | "itemId">> = [
  // rarity 0 — commons
  { num: 1,  name: "菜粉蝶", rarity: 0, tribe: "[蝶][飛行]",    field: FIELD.GRASS | FIELD.FLOWER, condition: "昼間", itemId: 709 },
  { num: 19, name: "剑角蝗", rarity: 0, tribe: "[蝗虫]",         field: FIELD.GRASS,                condition: "",     itemId: 709 },
  { num: 22, name: "稻蝗",   rarity: 0, tribe: "[蝗虫]",         field: FIELD.GRASS,                condition: "",     itemId: 709 },
  { num: 41, name: "油蝉",   rarity: 0, tribe: "[飛行]",         field: FIELD.TREE,                 condition: "夏",   itemId: 709 },
  { num: 66, name: "步行虫", rarity: 0, tribe: "[甲虫]",         field: FIELD.DIRT,                 condition: "",     itemId: 709 },
  { num: 76, name: "艳金龟", rarity: 0, tribe: "[甲虫]",         field: FIELD.FLOWER | FIELD.TREE,  condition: "",     itemId: 709 },

  // rarity 1-2 — uncommon
  { num: 2,  name: "豆粉蝶",   rarity: 0, tribe: "[蝶][飛行]",    field: FIELD.GRASS | FIELD.FLOWER, condition: "昼間", itemId: 709 },
  { num: 34, name: "蜜蜂",     rarity: 1, tribe: "[飛行]",         field: FIELD.GRASS | FIELD.FLOWER, condition: "",     itemId: 709 },
  { num: 61, name: "异色瓢虫", rarity: 1, tribe: "[甲虫]",         field: FIELD.GRASS | FIELD.FLOWER, condition: "",     itemId: 709 },
  { num: 73, name: "金龟子",   rarity: 1, tribe: "[甲虫]",         field: FIELD.TREE,                 condition: "",     itemId: 709 },
  { num: 23, name: "螽斯",     rarity: 2, tribe: "[蝗虫]",         field: FIELD.GRASS,                condition: "",     itemId: 709 },
  { num: 30, name: "棕静螳",   rarity: 2, tribe: "[螳螂]",         field: FIELD.GRASS,                condition: "",     itemId: 709 },

  // rarity 3-4 — mid tier
  { num: 8,  name: "青斑弄蝶", rarity: 3, tribe: "[蝶][飛行]",    field: FIELD.GRASS | FIELD.FLOWER, condition: "昼間", itemId: 709 },
  { num: 46, name: "碧伟蜓",   rarity: 3, tribe: "[蜻][飛行]",    field: FIELD.GRASS | FIELD.WATER,  condition: "",     itemId: 709 },
  { num: 20, name: "飞蝗",     rarity: 4, tribe: "[蝗虫]",         field: FIELD.GRASS,                condition: "",     itemId: 709 },
  { num: 31, name: "大刀螳",   rarity: 4, tribe: "[螳螂]",         field: FIELD.GRASS,                condition: "",     itemId: 710 },
  { num: 78, name: "小锹形虫", rarity: 4, tribe: "[锹形虫][甲虫]", field: FIELD.TREE,                 condition: "夏",   itemId: 710 },

  // rarity 5-6 — rare
  { num: 32, name: "花螳螂",   rarity: 5, tribe: "[螳螂]",         field: FIELD.FLOWER,               condition: "",     itemId: 710 },
  { num: 88, name: "独角仙",   rarity: 6, tribe: "[兜虫][甲虫]",   field: FIELD.TREE,                 condition: "夏",   itemId: 710 },

  // rarity 7-8 — legendary
  { num: 74, name: "宝石金龟", rarity: 7, tribe: "[甲虫]",         field: FIELD.GRASS | FIELD.TREE,   condition: "",     itemId: 710 },
  { num: 93, name: "赫拉克勒斯", rarity: 8, tribe: "[兜虫][甲虫]", field: FIELD.TREE,                 condition: "夏",   itemId: 710 },
];
// Kept temporarily as readable fixture examples; live capture uses the
// generated full catalog below.
void LEGACY_BUG_CATALOG;

/** Convert the complete upstream table into browser-safe runtime data. */
export const BUG_CATALOG: readonly BugDef[] = RAW_BUG_CATALOG.map((bug) => ({
  num: bug.num,
  name: bug.name,
  rarity: bug.rarity,
  tribe: bug.tribe,
  type: bug.type,
  field: FieldBitset(bug.field),
  area: AreaBitset(bug.area),
  condition: bug.conditions.join("&&"),
  conditions: bug.conditions,
  favorites: bug.favorites,
  hp: bug.hp,
  atk: bug.atk,
  spd: bug.spd,
  size: bug.size,
  skl: bug.skl,
  itemId: bug.rarity > 5 ? 710 : 709,
}));

const BUG_BY_NUM = new Map(BUG_CATALOG.map((bug) => [bug.num, bug]));

/** Species lookup by upstream `MUSHI_NUM`. */
export function bugDefFor(num: number): BugDef | undefined {
  return BUG_BY_NUM.get(num);
}

/** Upstream `@MUSHI_ESA_DATA`, generated with real Item.csv ids. */
export interface BugBaitDef {
  itemId: number;
  name: string;
  types: string;
  quality: number;
}
export const BUG_BAIT_CATALOG: readonly BugBaitDef[] = RAW_BUG_BAITS;
const BAIT_BY_ID = new Map(BUG_BAIT_CATALOG.map((bait) => [bait.itemId, bait]));
export function bugBaitForItem(itemId: number): BugBaitDef | undefined {
  return BAIT_BY_ID.get(itemId);
}

// ---------------------------------------------------------------------------
// Spot → field bitset mapping (@MUSHITORI_SPOT)
// ---------------------------------------------------------------------------

/**
 * Map a location string to field-type bitset.
 * Only built-map spots are listed; unbuilt maps deferred.
 *
 * TODO(V2): add spots from unbuilt maps (bamboo forest, moriya, etc.)
 * and MAIN_MAP name-based spots for interior rooms.
 */
export function mushitoriSpot(location: string): number {
  // Non-home (sub-map / odekake field) spots
  if (location === "神社:桜花道的鳥居" || location === "博麗神社:桜花道的鳥居") return FieldBitset("花樹土");
  if (location === "神社:妖精的大樹"   || location === "博麗神社:妖精的大樹")   return FieldBitset("草花樹土");
  if (location === "神社:境内"         || location === "博麗神社:境内")         return FieldBitset("土岩家");

  // 人里 spots
  if (location === "人間之里:広場"      || location === "人間の里:広場")          return FieldBitset("土岩家");
  if (location === "人間之里:長屋街"    || location === "人間の里:長屋街")        return FieldBitset("家");

  // 命蓮寺 spots
  if (location === "命蓮寺:境内")       return FieldBitset("土岩家");
  if (location === "命蓮寺:墓地")       return FieldBitset("草花土岩");
  if (location === "霊廟:霊廟広場")     return FieldBitset("土岩家");
  if (location === "霊廟:枯山水")       return FieldBitset("草花岩");

  // 紅魔館 spots
  if (location === "紅魔館:正門")       return FieldBitset("草花樹土");
  if (location === "紅魔館:庭")         return FieldBitset("草花樹土家");
  if (location === "紅魔館:後院")       return FieldBitset("草花樹土家");
  if (location === "紅魔館:霧之湖" || location === "霧之湖") return FieldBitset("草水");
  if (location === "紅魔館:廃洋館")     return FieldBitset("家");

  const room = location.split(":").at(-1) ?? location;
  const allMapSpots: Readonly<Record<string, string>> = {
    "倒垂的柳樹下": "草土樹", "竹林入口": "草土樹", "迷失的小道": "草土樹",
    "斜角的竹林": "草土樹", "兎的洞穴": "土岩", "無名之丘": "草花土",
    "太陽花田": "草花土", "森林的入口": "草樹土", "古木的大樹": "草樹土",
    "再思之道": "草花土", "無縁塚": "草樹花土岩", "中有之道": "草土",
    "三途之川": "草水", "彼岸": "花水", "白玉楼庭": "花樹土家", "地獄": "土岩",
    "山麓樹海": "草樹土", "玄武之澤": "水岩", "大蛤蟆之池": "草水",
    "絶景之丘": "草樹土岩", "山之湖": "草水", "守矢神社境内": "土岩家",
    "幻想風穴": "土岩", "地獄的深道": "土岩水", "旧地獄街道": "土家", "地霊殿": "家",
    "寧靜海": "月", "圣域": "樹土月圣", "浅间净秽山": "土岩月圣",
    "魔界都市": "岩家魔", "冰雪世界": "魔", "法界": "土岩魔",
    "魔法之森入口": "草樹土", "岔道": "草樹土", "菌菇群生地": "草樹土",
    "魔法之広場": "草樹土家", "莉格露的棲息処": "草土", "賽の河原": "草水",
    "西行妖": "花樹", "八雲邸庭": "草花樹土家", "樹海道入口": "草樹土",
    "山道・通往沼澤之道": "草樹土岩", "山道・中腹": "草樹土岩", "山道・分岐点": "草樹土岩",
    "秋姉妹的家・畑": "草花土家", "仙人的宅邸・庭": "草花樹土家", "帚木": "樹",
    "通向山頂的路": "草樹土岩", "猿猴通路": "草樹土圣", "美天居所": "樹家圣",
    "圣域深林道": "樹土圣", "月都秘道": "草樹土月圣", "圣域深道": "樹土圣",
    "山中密道": "土岩圣", "四季竖穴": "草樹土水岩圣", "化石丛林荒地": "土岩圣",
    "月海通路": "水岩月圣", "巧克力河": "圣", "化石深道": "岩圣", "磐永神社本殿": "岩家圣",
    "山頂入口": "草樹土岩", "頂上": "草樹土岩", "瀑布背面": "水岩", "地霊殿前": "家",
    "薔薇園": "草花", "中庭": "草花岩家", "小胡同": "土家", "川岸": "土水岩", "縦穴底部": "土岩",
    "入海口": "月", "庭": "草花樹土家", "後院": "草花樹土家", "境内": "土岩家",
    "本殿内部": "土岩家", "参道": "草樹土", "鎮守之森": "草花樹土", "人里的門": "土岩家",
    "中央広場": "土樹岩家", "湖畔": "草水", "传送点": "土家魔", "黄昏街": "岩家魔",
    "星辰之家外": "岩家魔", "先知环形路": "岩家魔", "智者写字楼外": "岩家魔",
    "流光巷": "土岩家魔", "渡鸦小区・小路": "土岩家魔", "万魔殿・庭院": "土岩魔",
    "堕落神殿・殿外": "土岩魔", "冰雪世界・冰原": "魔", "冰雪世界・冰湖": "水魔",
  };
  const bits = allMapSpots[room];
  if (bits) return FieldBitset(bits);

  return 0;
}

/** Parse a field-type string like "草花樹土" into bitset. */
function FieldBitset(s: string): number {
  let bits = 0;
  if (s.includes("草")) bits |= FIELD.GRASS;
  if (s.includes("花")) bits |= FIELD.FLOWER;
  if (s.includes("樹")) bits |= FIELD.TREE;
  if (s.includes("土")) bits |= FIELD.DIRT;
  if (s.includes("水")) bits |= FIELD.WATER;
  if (s.includes("岩")) bits |= FIELD.ROCK;
  if (s.includes("家")) bits |= FIELD.BUILDING;
  if (s.includes("月")) bits |= FIELD.MOON;
  if (s.includes("圣")) bits |= FIELD.HOLY;
  if (s.includes("魔")) bits |= FIELD.MAGIC;
  return bits;
}

/** Upstream AREA_SETBIT: map id is the bit index. */
function AreaBitset(s: string): number {
  const all = (1 << 12) - 1;
  if (s.includes("全て")) return all;
  let bits = 0;
  const names: readonly [string, number][] = [
    ["神社", 0], ["寺", 1], ["里", 2], ["湖", 3], ["竹", 4], ["森", 5],
    ["冥界", 6], ["山麓", 7], ["山頂", 8], ["地底", 9], ["月", 10], ["魔", 11],
  ];
  for (const [name, id] of names) if (s.includes(name)) bits |= 1 << id;
  return s.includes("以外") ? bits ^ all : bits;
}

// ---------------------------------------------------------------------------
// Season / time helpers
// ---------------------------------------------------------------------------

/** Check whether current season allows bug-catching. Winter (season=4) → closed. */
export function isBugSeason(season: number): boolean {
  return season !== 4; // 冬之月 → no bugs
}

/**
 * Check a bug's appearance condition against current season and time-of-day.
 * condition is a string like "昼間", "夜間", "夏", "夏&&夜間", or "".
 *
 * TODO(V2): full condition system with hour bands and multi-clause parsing.
 */
export function bugConditionMet(def: BugDef, season: number, hourOfDay: number, date = 1): boolean {
  const conditions = def.conditions.length > 0 ? def.conditions : (def.condition ? def.condition.split("&&") : []);
  if (conditions.length === 0) return true;

  for (const cond of conditions) {
    if (cond === "春" && season !== 1) return false;
    if (cond === "夏" && season !== 2) return false;
    if (cond === "秋" && season !== 3) return false;
    if (cond === "昼間" && !(hourOfDay >= 6 && hourOfDay < 18)) return false;
    if ((cond === "夜間" || cond === "夜间") && !(hourOfDay >= 18 || hourOfDay < 6)) return false;
    if (cond === "深夜" && !(hourOfDay >= 0 && hourOfDay < 5)) return false;
    if (cond === "暁" && !((hourOfDay >= 4 && hourOfDay < 6) || (hourOfDay >= 14 && hourOfDay < 18))) return false;
    if (cond === "0の付く日" && ![10, 20, 30].includes(date)) return false;
    if (cond === "月初め" && !(date >= 1 && date <= 3)) return false;
    // Weather and presence predicates are unavailable to this pure draw
    // helper. Fail closed rather than spawning a gated species incorrectly.
    if (cond === "雨天" || cond === "晴朗" || cond === "后户") return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Draw a bug
// ---------------------------------------------------------------------------

export interface BugDrawResult {
  bug: BugDef;
  /** Unique ID (simplified: num + rarity*1000 + rank*10000) */
  bugId: number;
}

/** Upstream `MUSHI_MAXCAGE`. Battle selection deliberately stays deferred. */
export const MUSHI_MAX_CAGE = 8;

/** One persistent `MUSHI_CAGE` entry, with all non-battle identity fields. */
export interface CaughtBug {
  /** JSON-safe deterministic identity (the upstream numeric packing exceeds JS safe integers). */
  id: string;
  bugNum: number;
  rank: number;
  gType: boolean;
  xType: boolean;
  caughtDay: number;
  location: string;
}

/** Single persistent `MUSHI_TRAP`; the upstream game permits one device. */
export interface BugTrap {
  location: string;
  baitItemId: number;
  baitName: string;
  baitTypes: string;
  baitQuality: number;
  placedTick: number;
  /** A catch waits at the location until the player returns to inspect it. */
  caughtBugNum?: number;
  caughtPower?: number;
}

export function cageOf(state: GameState): readonly CaughtBug[] {
  return state.bugCage ?? [];
}

export function collectionOf(state: GameState): Readonly<Record<number, true>> {
  return state.bugCollection ?? {};
}

/**
 * Store a caught insect and register the species. A full cage fails closed:
 * the caller keeps the result visible but does not silently destroy a resident
 * or convert the new insect into material without the player's choice.
 */
export function storeCaughtBug(
  state: GameState,
  draw: BugDrawResult,
  power: number,
  luck: number,
  rng: () => number = () => 0.5,
): CaughtBug | null {
  const cage = state.bugCage ?? (state.bugCage = []);
  const collection = state.bugCollection ?? (state.bugCollection = {});
  collection[draw.bug.num] = true;
  const sequence = (state.bugCaptureCount ?? 0) + 1;
  state.bugCaptureCount = sequence;
  if (cage.length >= MUSHI_MAX_CAGE) return null;
  const rank = Math.min(99, Math.floor(rng() * Math.max(1, Math.floor(luck / 10))));
  const gType = power > 0 && rng() * 100 < power / 2;
  const xType = power > 0 && rng() * 100 < power / 2;
  const caught: CaughtBug = {
    id: `${sequence}-${state.time.dayIndex}-${draw.bug.num}-${rank}-${gType ? 1 : 0}${xType ? 1 : 0}`,
    bugNum: draw.bug.num,
    rank,
    gType,
    xType,
    caughtDay: state.time.dayIndex,
    location: state.master.location,
  };
  cage.push(caught);
  return caught;
}

export function releaseCaughtBug(state: GameState, id: string): CaughtBug | undefined {
  const cage = state.bugCage ?? [];
  const index = cage.findIndex((bug) => bug.id === id);
  return index < 0 ? undefined : cage.splice(index, 1)[0];
}

/** Turn one selected caged insect into its faithful coarse material class. */
export function materializeCaughtBug(state: GameState, id: string): { bug: CaughtBug; itemId: number } | undefined {
  const bug = releaseCaughtBug(state, id);
  if (!bug) return undefined;
  const def = BUG_CATALOG.find((candidate) => candidate.num === bug.bugNum);
  if (!def) return undefined;
  const itemId = bugToItemId(def);
  const items = state.items ?? (state.items = {});
  items[itemId] = (items[itemId] ?? 0) + 1;
  return { bug, itemId };
}

/** Place the sole insect trap, consuming one valid bait from inventory. */
export function placeBugTrap(state: GameState, baitItemId: number): BugTrap | null {
  const bait = bugBaitForItem(baitItemId);
  if (!bait || !mushitoriSpot(state.master.location) || (state.items?.[baitItemId] ?? 0) <= 0) return null;
  state.items![baitItemId]!--;
  if (state.items![baitItemId] === 0) delete state.items![baitItemId];
  const trap: BugTrap = {
    location: state.master.location,
    baitItemId,
    baitName: bait.name,
    baitTypes: bait.types,
    baitQuality: bait.quality,
    placedTick: state.time.tickValue,
  };
  state.bugTrap = trap;
  return trap;
}

/** Advance an armed trap from the authoritative game clock. */
export function progressBugTrap(state: GameState, rng: () => number = () => 0.5): void {
  const trap = state.bugTrap;
  if (!trap || trap.caughtBugNum !== undefined || state.time.tickValue <= trap.placedTick) return;
  const power = Math.max(1, Math.min(10, 5 + trap.baitQuality));
  // `RAND:power < 2` → no catch on this progress. It remains armed.
  if (Math.floor(rng() * power) < 2) return;
  const mapId = mapIdOfLocation(trap.location);
  const areaMask = mapId === null ? 0 : 1 << mapId;
  const eligible = BUG_CATALOG.filter((bug) =>
    (bug.field & mushitoriSpot(trap.location)) !== 0 &&
    (areaMask === 0 || (bug.area & areaMask) !== 0) &&
    bugConditionMet(bug, state.time.season ?? 1, state.time.hourOfDay, state.time.date ?? 1) &&
    (bug.favorites.includes(trap.baitName) || bug.favorites.includes(trap.baitTypes) || bug.favorites === "全部"),
  );
  const fallback = BUG_CATALOG.filter((bug) =>
    (bug.field & mushitoriSpot(trap.location)) !== 0 &&
    (areaMask === 0 || (bug.area & areaMask) !== 0) &&
    bugConditionMet(bug, state.time.season ?? 1, state.time.hourOfDay, state.time.date ?? 1) &&
    (bug.favorites === "全部" || bug.favorites.includes(trap.baitTypes)),
  );
  const pool = eligible.length > 0 ? eligible : fallback;
  if (pool.length === 0) return;
  let rarity = Math.floor(rng() * power);
  while (rarity >= 0) {
    const tier = pool.filter((bug) => bug.rarity === rarity);
    if (tier.length > 0) {
      trap.caughtBugNum = tier[Math.floor(rng() * tier.length)]!.num;
      trap.caughtPower = power;
      return;
    }
    rarity--;
  }
}

/** Claim a trap catch only at its original location; a full cage safely releases it. */
export function collectBugTrap(state: GameState, rng: () => number = () => 0.5): { bug: BugDef; stored: CaughtBug | null } | null {
  const trap = state.bugTrap;
  if (!trap || trap.location !== state.master.location || trap.caughtBugNum === undefined) return null;
  const bug = BUG_CATALOG.find((candidate) => candidate.num === trap.caughtBugNum);
  if (!bug) return null;
  const draw: BugDrawResult = { bug, bugId: bug.num + bug.rarity * 1000 };
  const stored = storeCaughtBug(state, draw, trap.caughtPower ?? 1, trap.baitQuality * 20, rng);
  delete state.bugTrap;
  return { bug, stored };
}

/** Remove an idle trap without returning its already-consumed bait. */
export function discardBugTrap(state: GameState): boolean {
  if (!state.bugTrap) return false;
  delete state.bugTrap;
  return true;
}

/**
 * Draw a random bug at the given location with the given power.
 *
 * Simplified V1: shuffle all eligible bugs, pick first matching rarity
 * within draw power. Higher power = higher rarity ceiling.
 *
 * TODO(V2): Full FISHER_YATES_SHAFFLE + rarity-tier fallback loop matching
 * @MUSHITORI / @DRAW_MUSHI.
 */
export function drawBug(
  location: string,
  power: number,
  season: number,
  hourOfDay: number,
  rng: () => number,
  date = 1,
): BugDrawResult | null {
  const spotBits = mushitoriSpot(location);
  if (!spotBits) return null;
  const mapId = mapIdOfLocation(location);
  const areaMask = mapId === null ? 0 : (1 << mapId);

  // Eligible bugs: field matches spot AND condition met
  const eligible = BUG_CATALOG.filter(
    (b) => (b.field & spotBits) !== 0 && (areaMask === 0 || (b.area & areaMask) !== 0) && bugConditionMet(b, season, hourOfDay, date),
  );
  if (eligible.length === 0) return null;

  // @MUSHITORI first requests RAND:power rarity, then retries one tier lower
  // until @DRAW_MUSHI finds a matching candidate.
  for (let rarity = Math.min(9, Math.floor(rng() * Math.max(1, power))); rarity >= 0; rarity--) {
    const tier = eligible.filter((bug) => bug.rarity === rarity);
    if (tier.length === 0) continue;
    const bug = tier[Math.min(tier.length - 1, Math.max(0, Math.floor(rng() * tier.length)))]!;
    const rank = Math.min(99, Math.max(0, Math.floor(rng() * 100)));
    return { bug, bugId: bug.num + bug.rarity * 1000 + Math.min(rank, 99) * 10000 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bug → item conversion
// ---------------------------------------------------------------------------

/**
 * Convert a caught bug into an item.
 * Rare bugs (rarity >= 4) → 稀有昆虫 (710).
 * Frog-tribe → 青蛙 (706).
 * All others → 虫 (709).
 *
 * TODO(V2): full material conversion from @MUSHI_CAPTURE:
 *   - 爬虫類 → 來歷不明的肉
 *   - 機械/跳蛋 → 跳蛋
 *   - 機械/异变敌 → 龍珠
 *   - 機械/other → 潤滑液
 *   - 青蛙 special handling
 *   - 油库里 special剧情
 */
export function bugToItemId(bug: BugDef): number {
  // TODO(V2): tribe-based material conversion
  return bug.itemId;
}

// ---------------------------------------------------------------------------
// Power calculation
// ---------------------------------------------------------------------------

/**
 * Calculate bug-catching power from luck and gathering level.
 * power = LIMIT(luck / 200 + gatheringLv, 1, 10)
 *
 * luck is derived from CFLAG:今日の運勢 (today's fortune, range ~10-1000).
 */
export function calcBugPower(luck: number, gatheringLv: number): number {
  return Math.max(1, Math.min(10, Math.floor(luck / 200) + gatheringLv));
}
