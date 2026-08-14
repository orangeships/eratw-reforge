/**
 * dish-menu.ts — the DISHDATA 料理 menu for COMF413 料理を作る (P1 cook slice).
 *
 * Data source: `web/app/game/dishes.bundle.json` (179 通用菜 101-355),
 * extracted from `ERB/コマンド関連/COMF/日常系/DISHDATA.ERB` by
 * `scripts/build-dishes.ts`; injected at app init via `setDishMenu` (the
 * relation-table / chara-data seam pattern). Unconfigured (unit tests / Node
 * before wiring) ⇒ empty menu ⇒ `allDishes()` empty and 413 falls back to the
 * type-only picker gracefully.
 *
 * Faithfulness anchors (all verified against DISHDATA.ERB / COMF413):
 *  - `@DISHDATA` RESULT ladder (1170-1206): 0 not-shown / 1 material-short /
 *    2 skill-short / 10 cookable — `dishCookStatus`.
 *  - `食材レベル` (1818-1909) baked as `ingredient.rank` at extraction (with
 *    the ITEMPRICE fallback), so DISH_RANK = the picked ingredient's rank.
 *  - BONUS点 (`@DISH_COOKING` 578-592): 旬+2 / 玉兎流+胡萝卜+2 / プロの味+2 /
 *    闪耀+1 / 得意料理+2 / 切れ味+1 / 美味的水+1 — `computeBonusPoints`.
 *  - Taste assembly (`@DISHDATA` 1084-1108 seasonal 旬/过季 + `@DISH_COOKING`
 *    457-472 できたて/name/type + 中立温度 season swap) — `assembleDishTaste`.
 *
 * **P1 deferred (documented, non-silent):**
 *  - `@DISH_TASTE_ADD` ingredient→taste (蘑菇/果物/卵/怪诞… per-item, 1259+):
 *    only enriches EAT-side taste, not basepoint. Base dish taste is kept.
 *  - `@DISH_TASTE_FROM_CHARA` / 流派 (女僕流/天狗流/…) / 得意料理 / プロの味 /
 *    切れ味 — all come from the assistant/master chara layer → P2/P3.
 *  - 400+ 固有料理 (SP dishes) — not extracted; P2.
 */

import type { GameState } from "./game-state.js";
import { itemCount } from "./items.js";
import { monthName, seasonOf } from "../world/calendar.js";
import { ABL_ID, TALENT_ID } from "./settlement.js";

export type DishType = "軽食" | "主食" | "甜点";

export interface DishIngredient {
  id: number;
  name: string;
  /** `食材レベル(id)` — ingredient quality → DISH_RANK. */
  rank: number;
}

export interface DishEntry {
  no: number;
  name: string;
  type: DishType;
  skillLv: number;
  time: number;
  maxLimit: number;
  taste: string;
  comment: string;
  ingredientCategory: string;
  ingredients: DishIngredient[];
  uncookable: boolean;
  /** 固有料理 (no 400+): the owner chara num. Gated by LEARNED_MENU≥100. */
  spChara?: number;
}

/** `@DISHDATA` RESULT: 0 not-shown, 1 material-short, 2 skill-short, 10 cookable. */
export type CookStatus = 0 | 1 | 2 | 10;

let menu: Record<number, DishEntry> = {};

/** Inject the built dish menu (from `dishes.bundle.json`). */
export function setDishMenu(
  bundle: { dishes?: Record<string | number, DishEntry> } | null | undefined,
): void {
  menu = {};
  if (!bundle?.dishes) return;
  for (const [k, v] of Object.entries(bundle.dishes)) menu[Number(k)] = v;
}

/** All dishes, ascending by DISH_NUM (stable menu order). */
export function allDishes(): DishEntry[] {
  return Object.values(menu).sort((a, b) => a.no - b.no);
}

export function dishByNo(no: number): DishEntry | undefined {
  return menu[no];
}

/** Dishes of a given DISH_TYPE (the type the player selected in COOKING_UI). */
export function dishesOfType(type: DishType): DishEntry[] {
  return allDishes().filter((d) => d.type === type);
}

/** A chara's 固有料理 (SP dish, no 400+charaNum), or undefined if none. */
export function spDishFor(charaNum: number): DishEntry | undefined {
  return menu[400 + charaNum];
}

// ---------------------------------------------------------------------------
// P2.5 — 練習モード (LEARNED_MENU) + 固有料理 unlock.
// ---------------------------------------------------------------------------

/** `LEARNED_MENU:chara` — 固有料理 practice progress (0..99, ≥100 = learned). */
export function learnedMenuOf(state: GameState, charaNum: number): number {
  return state.learnedMenu?.[charaNum] ?? 0;
}

/** Set `LEARNED_MENU:chara`. Lazily creates the map. */
export function setLearnedMenu(state: GameState, charaNum: number, value: number): void {
  (state.learnedMenu ??= {})[charaNum] = value;
}

/** Whether a chara's 固有料理 is learned (`LEARNED_MENU ≥ 100`, DISHDATA:1194). */
export function isSpDishLearned(state: GameState, charaNum: number): boolean {
  return learnedMenuOf(state, charaNum) >= 100;
}

/**
 * 練習 LEARNED_MENU gain (DISH_COOKING 644, non-DLC):
 * `20 + TALENT:MASTER:習得速度*5 + RAND:(MAX(ABL:MASTER:料理技能*25, 1))`.
 */
export function practiceGain(
  masterLearnSpeed: number,
  masterSkill: number,
  rng: { int(max: number): number },
): number {
  return 20 + masterLearnSpeed * 5 + rng.int(Math.max(masterSkill * 25, 1));
}

/**
 * `料理技能` — the master's cooking skill (ABL). Central so the handler and
 * status ladder read the same source.
 */
export function masterCookingSkill(state: GameState): number {
  return state.master.state.ABL[ABL_ID.料理技能] ?? 0;
}

/** Ingredients of `dish` the player currently owns (`ITEM:id > 0`). */
export function ownedIngredientsFor(state: GameState, dish: DishEntry): DishIngredient[] {
  return dish.ingredients.filter((ing) => itemCount(state, ing.id) > 0);
}

/**
 * `@DISHDATA` RESULT ladder (1170-1206) for the given selected DISH_TYPE.
 * Order matters and mirrors the ERB exactly:
 *   material (1|10) → skill overrides to 2 → type-mismatch overrides to 0 →
 *   empty name overrides to 0.
 */
export function dishCookStatus(state: GameState, dish: DishEntry, selectedType: DishType): CookStatus {
  let result: CookStatus = ownedIngredientsFor(state, dish).length > 0 ? 10 : 1;
  if (masterCookingSkill(state) < dish.skillLv) result = 2;
  if (dish.type !== selectedType) result = 0;
  if (!dish.name) result = 0;
  return result;
}

/**
 * BONUS点 (`@DISH_COOKING` 578-592). Counts the static bonus tags present in
 * the final assembled taste. In P1 (no chara/流派 layer) the reachable tags
 * are 旬 (from seasonal base taste) plus any literal 闪耀/プロの味/美味的水/
 * 切れ味/得意料理 baked into a dish's own taste.
 */
export function computeBonusPoints(taste: string): number {
  let bonus = 0;
  if (taste.includes("旬/")) bonus += 2;
  if (taste.includes("玉兎流/") && taste.includes("胡萝卜/")) bonus += 2;
  if (taste.includes("プロの味/")) bonus += 2;
  if (taste.includes("闪耀/")) bonus += 1;
  if (taste.includes("得意料理")) bonus += 2; // STRCOUNT no slash (587)
  if (taste.includes("切れ味/")) bonus += 1;
  if (taste.includes("美味的水/")) bonus += 1;
  return bonus;
}

/**
/** Seasonal 旬/过季 from 春物/夏物/秋物/冬物 (`@DISHDATA` 1084-1108). */
function applySeasonalTaste(t: string, month: string): string {
  if (t.includes("春物/")) return t + (month === "春之月" ? "旬/" : month === "秋之月" ? "过季/" : "");
  if (t.includes("夏物/")) return t + (month === "夏之月" ? "旬/" : month === "冬之月" ? "过季/" : "");
  if (t.includes("秋物/")) return t + (month === "秋之月" ? "旬/" : month === "春之月" ? "过季/" : "");
  if (t.includes("冬物/")) return t + (month === "冬之月" ? "旬/" : month === "夏之月" ? "过季/" : "");
  return t;
}

/**
 * `@DISH_TASTE_ADD(ingredient)` (DISHDATA:1259-1310) — the selected ingredient
 * adds its own taste tag(s). Keyed by item name. Faithful subset (the酒造 wine
 * arms included; the dead duplicate 野趣 CASE is not).
 */
export function ingredientTasteAdd(t: string, itemName: string): string {
  const hasEgg = t.includes("卵/");
  switch (itemName) {
    case "獣肉":
    case "鳥肉":
    case "冰淇淋":
      return t; // no tag added (肉/冰淇淋 excluded upstream)
    case "普通的菌菇":
    case "毒菌菇":
    case "黏性菌菇":
    case "冬虫夏草":
    case "可疑菌菇":
    case "魔法菌菇":
      return t + "蘑菇/";
    case "草莓":
    case "西瓜":
    case "仙桃":
    case "树莓":
    case "山葡萄":
      return t + itemName + "/果物/";
    case "卵":
      return hasEgg ? t : t + "卵/";
    case "奇妙な卵":
      return (hasEgg ? t : t + "卵/") + "怪诞/";
    case "少女の卵":
      return hasEgg ? t : t + "少女の卵/卵/";
    case "红酒":
      return t + "家庭的/";
    case "陈酿红酒":
      return t + "上品/";
    case "优质陈酿红酒":
      return t + "上品/豪華/";
    default:
      return t + itemName + "/";
  }
}

/**
 * `@DISH_TASTE_FROM_CHARA` effect-cleanup subset (DISHDATA:1449-1471) — drop the
 * chara-taste tags whose gate the dish doesn't satisfy, so BONUS/eat see only
 * the tags that actually apply. Returns the cleaned chara-taste string.
 * (The full 消去/変化/強化 per-流派 engine is P3b.)
 *  - 稗田家秘伝の味 needs 和食.
 *  - 得意料理＊X＊ needs the dish taste to contain X/.
 *  - 切れ味 needs 野菜/肉/魚.
 *  - 美味的水 needs 鍋物/汁物/饮用/滑溜溜.
 */
export function cleanCharaTaste(charaTags: string, dishTaste: string): string {
  let s = charaTags;
  if (s.includes("稗田家秘伝の味/") && !dishTaste.includes("和食/")) {
    s = s.replace(/稗田家秘伝の味\//g, "");
  }
  const tokui = /得意料理＊([^＊]*)＊\//.exec(s);
  if (tokui && !dishTaste.includes(tokui[1]! + "/")) {
    s = s.replace(/得意料理＊[^＊]*＊\//g, "");
  }
  if (
    s.includes("切れ味/") &&
    !dishTaste.includes("野菜/") &&
    !dishTaste.includes("肉/") &&
    !dishTaste.includes("魚/")
  ) {
    s = s.replace(/切れ味\//g, "");
  }
  if (
    s.includes("美味的水/") &&
    !dishTaste.includes("鍋物/") &&
    !dishTaste.includes("汁物/") &&
    !dishTaste.includes("饮用/") &&
    !dishTaste.includes("滑溜溜/")
  ) {
    s = s.replace(/美味的水\//g, "");
  }
  return s;
}

/** 愛情 + 母亲的味道 tags (DISH_TASTE_FROM_CHARA 1428-1438). Pure. */
export function loveAndMotherTags(opts: {
  koibito?: boolean;
  renbo?: boolean;
  shibo?: boolean;
  motherly?: boolean;
}): string {
  let s = "";
  if (opts.motherly) s += "母亲的味道/";
  if (opts.koibito) s += "愛情/愛情/愛情/愛情/愛情/";
  else if (opts.renbo) s += "愛情/愛情/愛情/";
  else if (opts.shibo) s += "愛情/";
  return s;
}

/**
 * Race/tribe taste tags (`@DISH_TASTE_FROM_CHARA` 1338-1417, non-DLC) — read the
 * chara's race TALENT values (GET_TRIBENAME) and emit 流派/race taste. Pure.
 *  - 人类: 仙人→仙術 天人→天界風 月人→月都風 外界人→外界風
 *  - 妖怪: all→妖力; 天狗→+天狗流 恶魔→+魔力 小人→+小人族秘伝の味 (鬼/吸血鬼
 *    非DLC 只 妖力)
 *  - 妖精→生命力 神霊→神力 幽霊→霊障 付喪神→道具の共鳴
 *  - 追加種族: 巫女→神力 魔法使→魔力 女仆→女僕流 蓬莱人→生命力
 *  - 魔界人→魔界風
 */
export function raceTasteTags(talent: Record<number, number>): string {
  let s = "";
  switch (talent[TALENT_ID.人类] ?? 0) {
    case 2: s += "仙術/"; break;
    case 3: s += "天界風/"; break;
    case 4: s += "月都風/"; break;
    case 5: s += "外界風/"; break;
  }
  const yokai = talent[TALENT_ID.妖怪] ?? 0;
  if (yokai > 0) {
    s += "妖力/";
    if (yokai === 5) s += "天狗流/";
    else if (yokai === 9) s += "魔力/";
    else if (yokai === 10) s += "小人族秘伝の味/";
  }
  if ((talent[TALENT_ID.妖精] ?? 0) !== 0) s += "生命力/";
  if ((talent[TALENT_ID.神霊] ?? 0) !== 0) s += "神力/";
  if ((talent[TALENT_ID.幽霊] ?? 0) !== 0) s += "霊障/";
  if ((talent[TALENT_ID.付喪神] ?? 0) !== 0) s += "道具の共鳴/";
  switch (talent[TALENT_ID.追加種族] ?? 0) {
    case 1: s += "神力/"; break;
    case 2: s += "魔力/"; break;
    case 3: s += "女僕流/"; break;
    case 4: s += "生命力/"; break;
  }
  if ((talent[TALENT_ID.魔界人] ?? 0) === 1) s += "魔界風/";
  return s;
}

/** 強化効果 (DISHDATA:1615-1793): 流派 trigger → reinforce existing tags ×N. */
const STRENGTHEN: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ["女僕流/", [["健康/", 1], ["家庭的/", 1], ["上品/", 1], ["芸術的/", 1]]],
  ["天狗流/", [["和食/", 1], ["質素/", 1], ["野趣/", 1]]],
  ["冥界風/", [["简易/", 1], ["淡白/", 1]]],
  ["地底風/", [["濃厚/", 1]]],
  ["地獄風/", [["怪诞/", 2], ["丰盛/", 1], ["ジャンキー/", 1], ["野趣/", 1], ["豪快/", 1]]],
  ["畜生流/", [["香料/", 1], ["丰盛/", 1], ["ジャンキー/", 1], ["濃厚/", 1], ["野趣/", 1], ["豪快/", 1]]],
  ["月都風/", [["简易/", 1], ["淡白/", 1]]],
  ["玉兎流/", [["中華/", 1], ["野菜/", 1]]],
  ["魔界風/", [["辣/", 1], ["咸/", 1], ["濃厚/", 1]]],
  ["夢幻風/", [["甜/", 1], ["酸/", 1], ["淡白/", 1]]],
  ["外界風/", [["機能的/", 1], ["ジャンキー/", 1]]],
  ["化学的/", [["機能的/", 1], ["ジャンキー/", 1], ["健康/", 1]]],
  ["小人族秘伝の味/", [["甜/", 2], ["辣/", 2], ["咸/", 2], ["酸/", 2]]],
  ["稗田家秘伝の味/", [["健康/", 3], ["和食/", 1], ["淡白/", 1], ["上品/", 1]]],
  ["母亲的味道/", [["家庭的/", 3], ["縁起物/", 1], ["旬/", 1]]],
  ["ドッキリ味/", [["甜/", 1], ["辣/", 1], ["咸/", 1], ["酸/", 1]]],
  ["刺激的/", [["辣/", 2], ["酸/", 2]]],
  ["彩り/", [["新鲜/", 1], ["豪華/", 1], ["芸術的/", 1]]],
  ["絢爛/", [["上品/", 1], ["新鲜/", 1], ["豪華/", 1], ["豪快/", 1]]],
  ["貧乏飯/", [["質素/", 1], ["野趣/", 1], ["家庭的/", 1]]],
  ["純化的味道/", [["甜/", 3], ["辣/", 3], ["咸/", 3], ["酸/", 3]]],
];

/** 消去効果 (DISHDATA:1524-1568): 流派 trigger → remove tags from the dish. */
const ERASE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["天界風/", ["質素/", "野趣/", "家庭的/"]],
  ["地獄風/", ["健康/", "简易/"]],
  ["畜生風/", ["健康/", "简易/", "淡白/", "上品/"]],
  ["化学的/", ["芸術的/", "野趣/"]],
  ["稗田家秘伝の味/", ["濃厚/", "ジャンキー/"]],
  ["絢爛/", ["質素/", "野趣/", "家庭的/"]],
  ["貧乏飯/", ["上品/", "新鲜/", "豪華/"]],
  ["純化的味道/", ["丰盛/", "简易/", "健康/", "ジャンキー/", "濃厚/", "淡白/"]],
];

const repl = (t: string, tag: string): string => t.split(tag).join("");
const swap = (t: string, a: string, b: string): string => {
  if (t.includes(a)) return t.split(a).join(b);
  if (t.includes(b)) return t.split(b).join(a);
  return t;
};

/**
 * `@DISH_TASTE_FROM_CHARA` effect engine (DISHDATA:1449-1811, non-DLC): given
 * the chara-taste string `locals`, clean it, apply付与/消去/変化/強化/未知の味
 * to the dish taste, then merge the cleaned `locals` in (`DISH_TASTE += LOCALS`).
 * Pure; `rng` only used by 未知の味 (skipped if absent). Returns the new taste.
 *
 * Deferred (documented): 闪耀 (weather + 日光浴/月光浴 + TIME:2 band), 大火力/
 * 氷結 の DISH_MAXLIMIT×2 (鮮度 unused), 去掉蔬菜 (rare veg-dislike corner).
 */
export function applyCharaTasteEngine(
  dishTaste: string,
  locals: string,
  opts: { rng?: { int(max: number): number } } = {},
): string {
  // Cleanup (1449-1472): drop chara tags whose gate the dish fails.
  let L = cleanCharaTaste(locals, dishTaste);
  if (L.includes("大火力/") && dishTaste.includes("冷/")) L = repl(L, "大火力/");
  if (L.includes("氷結/") && dishTaste.includes("温暖/")) L = repl(L, "氷結/");

  let t = dishTaste;
  const has = (tag: string): boolean => t.includes(tag);
  const lo = (tag: string): boolean => L.includes(tag);

  // 付与効果 (1476-1522).
  if (lo("冥界風/") && !has("洋食/") && !has("中華/")) t += "和食/";
  if (lo("地底風/") && !has("冷/")) t += "温暖/";
  if (lo("月都風/") && !has("和食/") && !has("洋食/")) t += "中華/";
  if (lo("魔界風/") && !has("和食/") && !has("中華/")) t += "洋食/";
  if (lo("夢幻風/") && !has("和食/") && !has("中華/")) t += "洋食/";
  // 未知の味 (1485-1507, RAND).
  if (lo("未知の味/") && opts.rng) {
    const r = opts.rng.int(10);
    const n = r === 0 ? 4 : r <= 2 ? 3 : r <= 5 ? 2 : 1;
    const which = opts.rng.int(4);
    const flavor = which === 1 ? "甜/" : which === 2 ? "辣/" : which === 3 ? "咸/" : "酸/";
    t += flavor.repeat(n);
  }
  if (lo("浓郁/") && !has("濃厚/")) t += "濃厚/";
  if (lo("薄味/") && !has("淡白/")) t += "淡白/";
  if (lo("大火力/") && !has("冷/")) { t += "温暖/温暖/温暖/"; t = repl(t, "中立温度/"); }
  if (lo("氷結/") && !has("温暖/")) { t += "冷/冷/冷/"; t = repl(t, "中立温度/"); }

  // 消去効果 (1524-1568).
  for (const [trigger, tags] of ERASE) if (lo(trigger)) for (const tag of tags) t = repl(t, tag);
  if (lo("浓郁/")) t = repl(t, "淡白/");
  if (lo("薄味/")) t = repl(t, "濃厚/");

  // 変化効果 (1570-1613).
  if (lo("ドッキリ味/")) t = has("甜/") || has("辣/") ? swap(t, "甜/", "辣/") : swap(t, "咸/", "酸/");
  if (lo("逆転/")) {
    t = has("甜/") || has("辣/") ? swap(t, "甜/", "辣/") : swap(t, "咸/", "酸/");
    t = swap(t, "简易/", "丰盛/");
    t = swap(t, "健康/", "ジャンキー/");
    t = swap(t, "濃厚/", "淡白/");
    t = swap(t, "温暖/", "冷/");
  }

  // 強化効果 (1615-1793): reinforce existing tags.
  for (const [trigger, reinforce] of STRENGTHEN) {
    if (!lo(trigger)) continue;
    for (const [tag, mult] of reinforce) if (t.includes(tag)) t += tag.repeat(mult);
  }

  // 最後にLOCALSを入れる (1811).
  return t + L;
}

/**
 * `@GET_ADDITIVE_BONUS(ITEM_ID)` (QOL_COOKING.ERB:32) — a 添加物's basepoint
 * modifier by ITEM id: 栄養強化剤 −1 (減点); 莓子酒/草莓白兰地/黑朗姆酒/白兰地VS
 * +2; 白兰地VSOP +3; 白兰地XO +4; else 0. `@DISH_COOKING` 609-614 splits it into
 * BONUS点 (>0) vs 減点 (<0).
 */
export function additiveBonus(itemId: number): number {
  switch (itemId) {
    case 518: return -1; // 栄養強化剤
    case 563: // 莓子酒
    case 588: // 草莓白兰地
    case 566: // 黑朗姆酒
    case 571: return 2; // 白兰地VS
    case 572: return 3; // 白兰地VSOP
    case 573: return 4; // 白兰地XO
    default: return 0;
  }
}

/** 流派 tags → EX_DISH_NAME display prefix (`@DISH_COOKING` 485-551), first-match. */
const EX_NAME_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["女僕流/", "女仆流"], ["天狗流/", "天狗流"], ["冥界風/", "冥界风"], ["天界風/", "天界风"],
  ["地底風/", "地底风"], ["地獄風/", "地狱风"], ["畜生流/", "畜生流"], ["月都風/", "月都风"],
  ["玉兎流/", "玉兔流"], ["魔界風/", "魔界风"], ["夢幻風/", "梦幻风"], ["外界風/", "外界风"],
  ["化学的/", "化学的"], ["小人族秘伝の味/", "小人族秘传的"], ["稗田家秘伝の味/", "稗田家秘传的"],
  ["純化的味道/", "纯化的"], ["逆転/", "逆转的"], ["大火力/", "大火力"], ["氷結/", "结冰的"],
  ["ドッキリ味/", "惊喜口味"], ["未知の味/", "奇妙口味"], ["闪耀/", "闪光"], ["生命力/", "妖精的"],
  ["仙術/", "仙人的"], ["鬼の魔力/", "鬼的"], ["血の魔力/", "吸血鬼的"], ["魔力/", "魔法的"],
  ["妖力/", "妖气的"], ["霊障/", "灵气的"], ["秘術/", "神秘的"],
];

/** The 流派 display prefix for a dish's taste, or "" (non-DLC, `去掉蔬菜的` defer). */
export function exDishNamePrefix(taste: string): string {
  for (const [tag, prefix] of EX_NAME_PREFIX) if (taste.includes(tag)) return prefix;
  return "";
}

/**
 * Assemble the cooked dish's DISH_TASTE.
 *  - Seasonal 旬/过季 (`@DISHDATA` 1084-1108).
 *  - + ingredient tags (`@DISH_TASTE_ADD`, `opts.ingredientName`).
 *  - + cleaned chara tags (`@DISH_TASTE_FROM_CHARA` author 助手効果 + 愛情/母亲,
 *    `opts.charaTags`; race/weather/full-effect-engine = P3b).
 *  - + できたて/ + name/ + type/ (`@DISH_COOKING` 457-459).
 *  - 中立温度 → 冷/温暖 by season (`@DISH_COOKING` 466-472).
 * `month` is `GET_MONTH()` (春之月/夏之月/秋之月/冬之月).
 */
export function assembleDishTaste(
  dish: DishEntry,
  month: string,
  opts: { ingredientName?: string; charaTags?: string; rng?: { int(max: number): number } } = {},
): string {
  let t = applySeasonalTaste(dish.taste, month);
  if (opts.ingredientName) t = ingredientTasteAdd(t, opts.ingredientName);
  // `@DISH_TASTE_FROM_CHARA` full effect engine (P3b): 付与/消去/変化/強化 + merge.
  if (opts.charaTags) t = applyCharaTasteEngine(t, opts.charaTags, { rng: opts.rng });
  t += "できたて/";
  t += dish.name + "/";
  t += dish.type + "/";
  if (t.includes("中立温度/")) t = t.replace("中立温度/", month === "夏之月" ? "冷/" : "温暖/");
  return t;
}

/** `GET_MONTH()` for the current state — 春之月/夏之月/秋之月/冬之月. */
export function currentMonth(state: GameState): string {
  return monthName(seasonOf(state.time));
}

// ---------------------------------------------------------------------------
// P2 — 助手做饭 (helper cooking) pure effect formulas (COMF413 313-392).
// Kept pure here (state layer); the handler applies them via applySourceCheck.
// ---------------------------------------------------------------------------

/** 従順係数 (ERB 316-330): ABL:従順 → 0..6 ladder. */
export function obedienceCoef(juujun: number): number {
  if (juujun <= 1) return 0;
  if (juujun <= 3) return 1;
  if (juujun <= 5) return 2;
  if (juujun <= 8) return 3;
  if (juujun <= 11) return 4;
  if (juujun <= 14) return 5;
  return 6;
}

/** 好感度係数 (ERB 331-345): CFLAG:好感度 → 0/1/2/4/6/8/10 ladder. */
export function favorCoef(favor: number): number {
  if (favor < 100) return 0;
  if (favor < 500) return 1;
  if (favor < 1000) return 2;
  if (favor < 5000) return 4;
  if (favor < 10000) return 6;
  if (favor < 30000) return 8;
  return 10;
}

/** SOURCE:helper:歓楽 (ERB 347): `300 + 30 * (従順係数 + 好感度係数) * DISH_TIME`. */
export function helperKanrakuSource(obCoef: number, favCoef: number, time: number): number {
  return 300 + 30 * (obCoef + favCoef) * time;
}

/** TFLAG:信頼度管理 seed for TRUST_CALC (ERB 349): `2 + 料理技能/2` (int div). */
export function helperTrustSeed(helperSkill: number): number {
  return 2 + Math.trunc(helperSkill / 2);
}

/**
 * EXP:helper:料理経験 gain (ERB 362, non-DLC):
 * `MAX(1 + RAND:(MAX((BASEPOINT-300)/80, 1)) + TALENT:習得速度, 1)`.
 */
export function helperCookExp(
  basepoint: number,
  learnSpeed: number,
  rng: { int(max: number): number },
): number {
  const span = Math.max(Math.trunc((basepoint - 300) / 80), 1);
  return Math.max(1 + rng.int(span) + learnSpeed, 1);
}
