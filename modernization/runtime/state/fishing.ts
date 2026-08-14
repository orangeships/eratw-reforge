/**
 * COM621 fishing data and deterministic rules.
 *
 * Fish, spots and the rank table mirror `COMF621 釣りをする.ERB`.  Rod and
 * line grades are an intentional modern extension used by the full-screen
 * fishing game; legacy item 37 remains the ownership bridge.
 */

export const FISHING_SPOT = {
  NONE: 0,
  MISTY_LAKE: 1,
  SANZU_RIVER: 2,
  GENBU_MARSH: 3,
  TOAD_POND: 4,
  WATERFALL: 5,
  MOUNTAIN_LAKE: 6,
  HELL_RIVER: 7,
  MOON_SEA: 8,
  ICE_WORLD: 9,
} as const;

const SPOT_LOCATIONS: Readonly<Record<string, number>> = {
  "霧之湖": 1,
  "紅魔館:霧之湖": 1,
  "霧之湖:霧之湖": 1,
  "霧之湖:湖畔": 1,
  "彼岸:賽の河原": 2,
  "妖怪之山・山麓:玄武之澤": 3,
  "妖怪之山・山麓:大蛤蟆之池": 4,
  "妖怪之山・山顶:瀑布背面": 5,
  "守矢神社:湖畔": 6,
  "旧都:川岸": 7,
  "纯狐邸:純狐邸・中庭": 8,
  "静かの海": 8,
  "冰雪世界": 9,
};

export function fishingSpot(location: string): number {
  return SPOT_LOCATIONS[location] ?? FISHING_SPOT.NONE;
}

export function fishingSpotName(spotId: number): string {
  return ["未知", "霧之湖", "賽之河原", "玄武之泽", "大蛤蟆之池", "瀑布背面", "守矢湖畔", "旧都川岸", "寂静之海", "冰雪世界"][spotId] ?? "未知";
}

export interface FishDef {
  id: number;
  name: string;
  isDelicious: boolean;
  minRank: number;
  spots: number;
  minSizeCm: number;
  maxSizeCm: number;
  /** Condensed from upstream `@FISHING_EXPLANATION`. */
  description: string;
}

const FISH_NAMES = [
  "", "石斑鱼", "皋月鳟", "山女鱼", "岩鱼", "拉氏鱥", "溪哥", "鲫鱼", "食人鱼", "雀鳝", "蓝鳃太阳鱼",
  "鲑鱼", "西太公鱼", "虹鳟", "八目鳗", "雷鱼", "杜父鱼", "香鱼", "鲶鱼", "鳗鱼", "姬鳟",
  "跳蛋", "鲤鱼", "腔棘鱼", "鲟", "国鳟", "草鱼", "高身鲫", "伊富鱼", "大口黑鲈", "巨骨舌鱼",
  "泷太郎", "青鱼", "魔界鱼·壹", "魔界鱼·贰", "魔界鱼·叁", "魔界鱼·肆", "魔界鱼·伍", "魔界鱼·陆", "魔界鱼·柒", "魔界鱼·捌",
] as const;

const FISH_SIZES: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [25, 56], [18, 40], [25, 50], [20, 70], [10, 18], [10, 18], [15, 36], [15, 61], [120, 300], [12, 28],
  [65, 100], [8, 18], [35, 105], [45, 65], [80, 115], [10, 18], [25, 35], [50, 80], [85, 120], [20, 55],
  [5, 5], [55, 115], [100, 200], [100, 301], [30, 45], [70, 140], [25, 62], [90, 220], [25, 55], [250, 400],
  [300, 550], [120, 220], [10, 18], [15, 36], [25, 50], [20, 70], [25, 55], [45, 65], [80, 115], [120, 220],
];

const FISH_DESCRIPTIONS: readonly string[] = [
  "",
  "对水质十分敏感、群居于河川与山中湖泊的杂食性鱼。",
  "与山女鱼相似，侧面散布红点；雨季与初夏尤其活跃。",
  "警戒心很强的冷水溪流鱼，有“溪流女王”之称。",
  "栖息于河川最上游冷水域，甚至会捕食蛇类。",
  "体表滑腻、喜欢低温水域，可用于天妇罗与南蛮腌。",
  "耐受污染与环境变化的群居小鱼，繁殖期色彩鲜艳。",
  "广泛栖息于河川下游和湖沼，分类至今仍十分困难。",
  "有尖锐牙齿却性情胆小，群体兴奋时才会集体攻击。",
  "披着坚硬原始鳞片的北美鱼类，有细长的吻与躯体。",
  "圆而扁平、食欲旺盛的外来鱼，可能影响幻想乡水域。",
  "会在河海间长距离洄游，产卵后结束生命。",
  "喜欢冷水却适应力很强，冬季冰下钓鱼的代表。",
  "繁殖期雄鱼会显出彩虹色，也是少见可生食的淡水鱼。",
  "拥有七对鳃孔的无颌类活化石，营养丰富。",
  "潜伏于水草间袭击猎物的肉食鱼，肉质白嫩。",
  "藏身清澈河流的砾石底，看似普通却有鲜美汤汁。",
  "寿命只有一年、以石上藻类为食，拥有强烈领地意识。",
  "依靠发达嘴须在夜间捕食，也常被视为地震前兆。",
  "夜行且体表覆满黏液，会前往深海产卵。",
  "生活在寒冷深水中的红鲑陆封型，离水后鲜度下降很快。",
  "",
  "生命力与寿命都很强的杂食鱼，会在水底吸食食物。",
  "肉质鳍发达的古代活化石；这个个体竟然是淡水性的。",
  "外形近似鲨鱼的古代鱼类，其卵可制成鱼子酱。",
  "曾被宣布灭绝后重新发现的深湖鱼，味道极为鲜美。",
  "耐高温和缺氧、以水草为食的中国四大家鱼之一。",
  "菱形体态的长寿鲫鱼，吸饵动作轻微而难以察觉。",
  "日本最大的淡水鱼之一，生长缓慢但肉质与鱼油很好。",
  "原产北美的凶猛肉食鱼，也是著名的游钓对象。",
  "原木般巨大的古代鱼，骨舌和坚硬鳞片也能制成工具。",
  "栖息于冰冷深湖、体长可达三米以上的神秘大怪鱼。",
  "体色深青、专吃贝类，是中国四大家鱼中最大的一种。",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const TASTY = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32, 37, 38, 39, 40]);

export const FISH_CATALOG: FishDef[] = Array.from({ length: 40 }, (_, index) => index + 1)
  .filter((id) => id !== 21)
  .map((id) => ({
    id,
    name: FISH_NAMES[id]!,
    isDelicious: TASTY.has(id),
    minRank: id >= 33 ? 20 + (id - 33) * 10 : id >= 25 ? 90 : id >= 22 ? 80 : id >= 11 ? 70 : 20,
    spots: 0x1ff,
    minSizeCm: FISH_SIZES[id]![0],
    maxSizeCm: FISH_SIZES[id]![1],
    description: FISH_DESCRIPTIONS[id] ?? "",
  }));

export function fishingCatchDescription(result: FishCatchResult): string {
  if (result.fish) return result.fish.description;
  return "";
}

export interface FishCatchResult {
  fish?: FishDef;
  itemId: number;
  name: string;
  isLegendary: boolean;
  rank: number;
  sizeCm?: number;
}

function fish(id: number, rank: number, rng: () => number): FishCatchResult {
  const def = FISH_CATALOG.find((entry) => entry.id === id)!;
  // Upstream uses MAX(RAND:max, min), so the minimum is deliberately biased.
  const sizeCm = Math.max(Math.floor(rng() * def.maxSizeCm), def.minSizeCm);
  return { fish: def, itemId: def.isDelicious ? 708 : 707, name: def.name, isLegendary: rank >= 95, rank, sizeCm };
}

function item(itemId: number, name: string, rank: number, isLegendary = false): FishCatchResult {
  return { itemId, name, isLegendary, rank };
}

function rankFromRoll(roll: number): number {
  if (roll <= 5) return 0;
  if (roll <= 10) return 10;
  if (roll <= 20) return 20;
  if (roll <= 30) return 30;
  if (roll <= 40) return 40;
  if (roll <= 50) return 50;
  if (roll <= 60) return 60;
  if (roll <= 89) return Math.floor((roll + 10) / 10) * 10;
  if (roll <= 94) return 90;
  if (roll <= 99) return 95;
  return 100;
}

function fishForRank(spot: number, rank: number, season: number, moonWatch: boolean): number | null {
  const table: Record<number, readonly number[]> = {
    20: [0, 5, 6, 1, 5, 1, 1, 6, 6, 33],
    30: [0, 7, 7, 2, 0, 2, 7, 8, 8, 34],
    40: [0, 16, 16, 3, 0, 3, 16, 9, 0, 35],
    50: [0, 10, season <= 2 ? 17 : 6, 4, 0, 4, 10, season <= 2 ? 17 : 6, season <= 2 ? 17 : 6, 36],
    70: [0, season === 4 ? 12 : 18, 19, season === 3 ? 11 : season === 4 ? 12 : 13, season === 4 ? 12 : 18, season === 3 ? 11 : season === 4 ? 12 : 13, season === 4 ? 12 : 18, 19, 19, 37],
    80: [0, 20, 22, 14, 22, 14, 22, 24, 22, 38],
    90: [0, 25, 26, 15, 27, 28, 29, 30, 32, 39],
    95: [0, moonWatch ? 31 : 0, 23, 0, 0, 0, 0, 0, 0, 40],
  };
  return table[rank]?.[spot] ?? null;
}

/** Exact upstream rank/spot selection. `moonWatch` is the upstream moon-view flag. */
export function resolveFishCatch(
  spotId: number,
  fishingPower: number,
  season: number,
  rng: () => number,
  moonWatch = false,
): FishCatchResult {
  const roll = Math.floor(rng() * Math.max(1, fishingPower)) + 1;
  const rank = rankFromRoll(roll);
  if (rank === 0) return item(610, "木材", rank);
  if (rank === 10) return item(131, "守矢之守札", rank);
  if (rank === 60) return item(706, "青蛙", rank);
  if (rank === 100) {
    if (spotId === 4) return item(706, "青蛙", rank, true);
    if (season === 4) return item(609, "冰之鳞", rank, true);
    return [1, 6, 8, 9].includes(spotId)
      ? item(643, "龙涎香", rank, true)
      : item(606, "龙之爪", rank, true);
  }
  const fishId = fishForRank(spotId, rank, season, moonWatch);
  if (fishId) return fish(fishId, rank, rng);
  if (rank === 30 || rank === 40 || rank === 50 || rank === 95) {
    return rank === 95 ? item(21, "跳蛋", rank) : item(706, "青蛙", rank);
  }
  return fish(fishForRank(spotId, 20, season, moonWatch) ?? 1, rank, rng);
}

export interface FishingActivityOptions {
  weatherIdx?: number;
  continuousRainfall?: number;
  rainbow?: boolean;
  thunderstorm?: boolean;
}

export function calcFishingActivity(season: number, hourOfDay: number, weatherIdx?: number): number;
export function calcFishingActivity(season: number, hourOfDay: number, options?: FishingActivityOptions): number;
export function calcFishingActivity(season: number, hourOfDay: number, value?: number | FishingActivityOptions): number {
  const options = typeof value === "number" ? { weatherIdx: value } : value ?? {};
  let activity = season === 2 ? 7 : season === 4 ? 3 : 10;
  const slot = Math.floor(((hourOfDay % 24) + 24) % 24 / 3);
  if (slot === 1 || slot === 4) activity += 10;
  else if (slot === 5 || slot === 6) activity += 5;
  const weather = options.weatherIdx;
  if (weather === 3 || weather === 6) activity += 5;
  else if (weather === 4 || weather === 5 || weather === 14 || weather === 15) activity += 7;
  else if (weather === 13) activity += options.thunderstorm ? 7 : -3;
  else if (weather !== undefined && weather >= 8 && weather <= 12) activity -= 3;
  if (options.rainbow) activity += 7;
  activity += Math.min(10, Math.max(0, options.continuousRainfall ?? 0));
  return activity;
}

export function calcFishingPower(activity: number, fishingLv: number, luck: number, missBonus: number, gearBonus = 0): number {
  return Math.max(1, Math.min(100, activity + fishingLv * 15 + Math.floor(luck / 10) - 50 + missBonus + gearBonus));
}

export function activityText(activity: number, luck: number): string {
  const total = activity + Math.floor(luck / 10) - 50;
  if (total <= 10) return "几乎看不到鱼影…";
  if (total <= 30) return "鱼影稀疏…";
  if (total <= 50) return "鱼影看起来还不错…";
  if (total <= 65) return "鱼影相当多…";
  return "鱼影到处都是、水面沙沙作响…";
}

export type FishingRodId = "bamboo" | "kourindou" | "tengu" | "lunar";
export type FishingLineId = "cotton" | "silk" | "youkai" | "lunar";

export interface FishingRodDef { id: FishingRodId; name: string; price: number; power: number; control: number; description: string }
export interface FishingLineDef { id: FishingLineId; name: string; price: number; maxDurability: number; tension: number; description: string }

export const FISHING_RODS: readonly FishingRodDef[] = [
  { id: "bamboo", name: "竹制钓竿", price: 3000, power: 0, control: 1, description: "朴素可靠。适合平静水域。" },
  { id: "kourindou", name: "香霖堂复合竿", price: 12000, power: 8, control: 1.12, description: "外界材料制成，腰力与手感都更好。" },
  { id: "tengu", name: "天狗风切竿", price: 36000, power: 15, control: 1.28, description: "轻而敏锐，能迅速修正鱼竿方向。" },
  { id: "lunar", name: "月都碳素竿", price: 90000, power: 22, control: 1.45, description: "来历可疑的高强度素材。" },
] as const;

export const FISHING_LINES: readonly FishingLineDef[] = [
  { id: "cotton", name: "棉编鱼线", price: 800, maxDurability: 100, tension: 1, description: "便宜的消耗品，承受猛冲的能力有限。" },
  { id: "silk", name: "妖蚕丝鱼线", price: 3200, maxDurability: 170, tension: 1.18, description: "韧性很好，适合中型鱼。" },
  { id: "youkai", name: "妖怪山钢丝线", price: 9500, maxDurability: 270, tension: 1.38, description: "不易磨损，可对付大型鱼。" },
  { id: "lunar", name: "月都单分子线", price: 26000, maxDurability: 430, tension: 1.62, description: "几乎看不见，却异常坚韧。" },
] as const;

export interface FishingGearState {
  ownedRods: Partial<Record<FishingRodId, true>>;
  lineSpools: Partial<Record<FishingLineId, number>>;
  equippedRod: FishingRodId;
  equippedLine: FishingLineId;
  catches: number;
  catchCounts: Record<number, number>;
  bestSizes: Record<number, number>;
}

export function defaultFishingGear(hasLegacyRod = false): FishingGearState {
  return {
    ownedRods: hasLegacyRod ? { bamboo: true } : {},
    lineSpools: hasLegacyRod ? { cotton: 100 } : {},
    equippedRod: "bamboo",
    equippedLine: "cotton",
    catches: 0,
    catchCounts: {},
    bestSizes: {},
  };
}

export function ensureFishingGear(state: { items?: Record<number, number>; fishingGear?: FishingGearState }): FishingGearState {
  if (!state.fishingGear) state.fishingGear = defaultFishingGear((state.items?.[37] ?? 0) > 0);
  state.fishingGear.catchCounts ??= {};
  return state.fishingGear;
}

export type FishingGearKind = "rod" | "line";
export interface FishingGearPurchaseResult { ok: boolean; message: string; spent: number }

export function buyFishingGear(
  state: { money: number; items?: Record<number, number>; fishingGear?: FishingGearState },
  kind: FishingGearKind,
  id: FishingRodId | FishingLineId,
): FishingGearPurchaseResult {
  const gear = ensureFishingGear(state);
  if (kind === "rod") {
    const def = FISHING_RODS.find((entry) => entry.id === id);
    if (!def) return { ok: false, message: "香霖堂没有这件货。", spent: 0 };
    if (gear.ownedRods[def.id]) { gear.equippedRod = def.id; return { ok: true, message: `换上了${def.name}。`, spent: 0 }; }
    if (state.money < def.price) return { ok: false, message: "钱不够。", spent: 0 };
    state.money -= def.price;
    gear.ownedRods[def.id] = true;
    gear.equippedRod = def.id;
    state.items ??= {};
    state.items[37] = 1;
    return { ok: true, message: `买下并装备了${def.name}。`, spent: def.price };
  }
  const def = FISHING_LINES.find((entry) => entry.id === id);
  if (!def) return { ok: false, message: "香霖堂没有这件货。", spent: 0 };
  if (state.money < def.price) return { ok: false, message: "钱不够。", spent: 0 };
  state.money -= def.price;
  gear.lineSpools[def.id] = def.maxDurability;
  gear.equippedLine = def.id;
  return { ok: true, message: `买下并装上了${def.name}。`, spent: def.price };
}
