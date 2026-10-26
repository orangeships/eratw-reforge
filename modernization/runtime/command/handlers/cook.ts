/**
 * `COMF413 料理を作る` (cook a dish) — the P1 **real menu** slice.
 * Faithful to the non-DLC path of
 * `ERB/コマンド関連/COMF/日常系/COMF413 料理を作る.ERB` + `DISHDATA.ERB`.
 *
 * **COOKING_UI staged prompts.** Upstream `@COM413` is a
 * 400-line `DO…LOOP` around `COOKING_UI`: pick a dish *type* (1=軽食 2=主食
 * 3=甜点) → pick a menu (101-355 from DISHDATA, greyed by `@DISHDATA` RESULT)
 * → pick an ingredient → choose 仕込み / 添加物 → RESULT==9 「料理を作る」
 * commits. The modern prompt contract carries those choices in an ephemeral
 * `pick_sequence`, so no partial selection is saved or settles state.
 *
 * **Ported faithfully (RESULT==9 commit arm, ERB 263-405 — master, no helper):**
 *   - `DISH_RANK = 食材レベル(SELECT_ING)` — the chosen ingredient's rank
 *     (baked into the bundle by `build-dishes`).
 *   - `道具力 = ITEM:银杏案板` (ERB 572). 道具の共鳴 ×2 defer (chara taste).
 *   - BONUS点 (ERB 578-592) via `computeBonusPoints(taste)`; 減点 = 0 in P1
 *     (仕込み/添加物 pickers are P4).
 *   - `DISH_BASEPOINT` non-DLC: `MIN(300 + (skillSum + DISH_RANK + 道具力 +
 *     BONUS − 減点) * 20, 1200)` — skillSum = 料理技能*2 solo (ERB 629) or
 *     master+helper (ERB 619).
 *   - DISH_TASTE assembly (`@DISHDATA` 1084-1108 seasonal + `@DISH_COOKING`
 *     457-472) via `assembleDishTaste` — できたて/name/type + 旬/过季 + 中立温度.
 *   - `ITEM:SELECT_ING --` consume the ingredient (ERB 279).
 *   - DOWNBASE 体力/気力 by type (ERB 284-294): 軽食 50, 主食/甜点 100.
 *   - `EXP:MASTER:料理経験 += 1 + RAND:(MAX((BASEPOINT-300)/80,1))` (ERB 296) +
 *     `ITEM:調理指南書 && !RAND:2 → +1` (ERB 300-301).
 *   - `TIME += DISH_TIME` (真 per-dish time) + 同行 (ERB 309-312).
 *   - `TFLAG:194` dish-class (ERB 664-672): 甜点 3 / 主食 2 / 軽食 1. (跳蛋→100
 *     needs `DISH_TASTE_ADD` 跳蛋/ tag → P1 defers that, so falls to class.)
 *   - `DISH_LIMIT = DISH_MAXLIMIT + DISH_TIME` (ERB 474).
 *
 * **execCheck (`@COM_ABLE413`, ERB 680-710):** `FLAG:70` 時間停止, `KITCHEN`,
 * master 気力<=0, `CFLAG:诶嘿嘿`, `CFLAG:陪睡中`, `CFLAG:恶作剧` (诶嘿嘿 cluster),
 * `DISH_NAME != ""` (already cooking).
 *
 * **P2 — 助手做饭 (helper cooking, ERB 313-392):** when `ctx.target` is a
 * present, awake chara (`SHIRAHU`), it auto-helps: basepoint uses master+helper
 * 料理技能 (ERB 619); after the cook, `applyHelperEffects` grants the helper
 * 歓楽 SOURCE (`300 + 30*(従順係数+好感度係数)*DISH_TIME`) + 信頼 (TRUST_CALC) +
 * DOWNBASE 体力/気力 + 料理経験 (+習得速度, +調理指南書) + cross-skill EXP +
 * 同行. `computeBasepointFromSkillSum` splits the skill term.
 *
 * **P2.5 — 練習モード + 固有料理 (SP dishes):** `build-dishes` now also extracts
 * each chara's `@SPECIAL_MENU_N` (キャラデータ) as dish no 400+N. An unlearned
 * SP dish is hidden from the normal menu (`isSpDishLearned` gate, DISHDATA:1194);
 * the 練習 category (shown when 練習可: present helper +
 * `LEARNED_MENU<100` + `親密≥5` + owns the SP ingredient) cooks it AND accrues
 * `LEARNED_MENU += practiceGain` (+master EXP, ERB 302). At ≥100 →
 * `@LEARNING_SP_DISH` (set 100+DAY, 「学会了…」), unlocking it in the normal menu.
 *
 * **P3 — 角色 taste flavor (`@DISH_TASTE_FROM_CHARA` full, non-DLC):**
 * `assembleDishTaste` folds in `@DISH_TASTE_ADD` (the selected ingredient's tag)
 * and, when a helper cooks (not 練習), the helper's full chara-taste via
 * `charaFlavorTags` (author 助手効果 + `raceTasteTags` GET_TRIBENAME 種族/流派
 * + 愛情/母亲) run through `applyCharaTasteEngine` (cleanup + 付与/消去/変化/
 * 強化/未知の味 + LOCALS merge, DISHDATA:1449-1811). The 流派 EX_DISH_NAME
 * prefix (女仆流/天狗流/…) shows in the cook narration.
 *
 * **P4 — 仕込み(下药) + 添加物 + 減点:** the staged picker follows the selected
 * dish and ingredient; unavailable additives stay disabled, and 仕込み is
 * unavailable when a helper cooks (ERB 64). The cook sets `dish.drg`/`drg2`
 * + consumes them; 減点 = 仕込み(+1) + 栄養強化剤(−1), BONUS += wine
 * (`additiveBonus`, ERB 595/609-614). The **eat path** (`dish.ts`) then stamps
 * the drug on the eater (媚薬/利尿剤/催情薬/睡眠薬/新鲜精液 → TCVAR = 下药强度
 * 210) and 栄養強化剤 → ×1.1 回復率 (COMF414 657-697).
 *
 * **DEFERRED (documented):**
 *   - `nExcludeAssi` 「不让X帮忙」 toggle — auto-helps a present target.
 *   - 闪耀 (weather + 日光浴/月光浴 + TIME:2 band), 大火力/氷結 の DISH_MAXLIMIT×2,
 *     去掉蔬菜 (rare veg-dislike corner), the DLC 料理相关 block. Basic
 *     freshness decay is already owned by state/dish-freshness.ts.
 *   - おまかせ/搜索/委托一览/たかり — UI arms.
 *   - STAIN / 精液 resets (ERB 304-308), 保温壺 鮮度 ×1.5 — H/QoL detail.
 */

import type { GameState } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState } from "../../state/game-state.js";
import { getCurrentRoomProps } from "../comable/shrine-rooms.js";
import { getDish, seedDish, setDish, DISH_DRUG_ITEM_ID } from "../../state/dish.js";
import { itemCount, removeItem } from "../../state/items.js";
import { charaDataOf } from "../../state/chara-data.js";
import { applySourceCheck } from "../source-check.js";
import {
  pickOne,
  type PromptAnswer,
  type PromptSpec,
  type PromptOption,
} from "../prompt.js";
import {
  allDishes,
  assembleDishTaste,
  computeBonusPoints,
  currentMonth,
  dishByNo,
  exDishNamePrefix,
  loveAndMotherTags,
  raceTasteTags,
  additiveBonus,
  helperCookExp,
  helperKanrakuSource,
  helperTrustSeed,
  favorCoef,
  isSpDishLearned,
  learnedMenuOf,
  masterCookingSkill,
  obedienceCoef,
  ownedIngredientsFor,
  practiceGain,
  setLearnedMenu,
  spDishFor,
  type DishEntry,
  type DishType,
} from "../../state/dish-menu.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getCharaBase,
  getMasterBase,
  getMasterCflag,
  setCharaBase,
  setMasterBase,
} from "../../state/settlement.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

/** ITEM ids the cook path reads (Item.csv). Local table (brewing.ts pattern). */
const DISH_ITEM_ID = {
  銀杏案板: 904, // 道具力 (ERB 572)
  調理指南書: 102, // EXP +1 bonus (ERB 300)
} as const;

/** 仕込み(下药) catalog (SHIKOMI, QOL_COM_STUFF.ERH) — id/name, stable order. */
const SHIKOMI_DRUGS: ReadonlyArray<{ id: number; name: string }> = [
  { id: DISH_DRUG_ITEM_ID.媚薬, name: "媚薬" },
  { id: DISH_DRUG_ITEM_ID.利尿剤, name: "利尿剤" },
  { id: DISH_DRUG_ITEM_ID.催情薬, name: "催情薬" },
  { id: DISH_DRUG_ITEM_ID.睡眠薬, name: "睡眠薬" },
  { id: DISH_DRUG_ITEM_ID.新鲜精液, name: "新鲜精液" },
];

/** 添加物 catalog (TENKABUTSU) — id/name/dessertOnly (IS_DESSERT_ONLY_ADDITIVE). */
const TENKABUTSU: ReadonlyArray<{ id: number; name: string; dessertOnly: boolean }> = [
  { id: DISH_DRUG_ITEM_ID.栄養強化剤, name: "栄養強化剤", dessertOnly: false },
  { id: 563, name: "莓子酒", dessertOnly: true },
  { id: 588, name: "草莓白兰地", dessertOnly: true },
  { id: 566, name: "黑朗姆酒", dessertOnly: true },
  { id: 571, name: "白兰地VS", dessertOnly: true },
  { id: 572, name: "白兰地VSOP", dessertOnly: true },
  { id: 573, name: "白兰地XO", dessertOnly: true },
];

/** DOWNBASE 体力/気力 by type (ERB 284-294). */
function cookCost(type: DishType): { stamina: number; will: number } {
  return type === "軽食" ? { stamina: 50, will: 50 } : { stamina: 100, will: 100 };
}

/** TFLAG:194 dish-class (ERB 664-672; 跳蛋→100 needs DISH_TASTE_ADD → P1 defer). */
function dishClass194(type: DishType): number {
  return type === "甜点" ? 3 : type === "主食" ? 2 : 1;
}

/**
 * `DISH_BASEPOINT` from an already-summed skill term (non-DLC):
 * `MIN(300 + (skillSum + DISH_RANK + 道具力 + BONUS − 減点) * 20, 1200)`.
 * `skillSum` = 料理技能*2 solo (ERB 629) or master+helper (ERB 619). Pure.
 */
export function computeBasepointFromSkillSum(
  skillSum: number,
  rank = 0,
  tool = 0,
  bonus = 0,
  penalty = 0,
): number {
  const raw = skillSum + rank + tool + bonus - penalty;
  return Math.min(300 + raw * 20, 1200);
}

/**
 * `DISH_BASEPOINT` master-only non-DLC (ERB 629-634): `料理技能*2 + …`.
 * The 1-arg form (`computeBasepoint(skill)`) is the no-ingredient value.
 */
export function computeBasepoint(
  cookingSkill: number,
  rank = 0,
  tool = 0,
  bonus = 0,
  penalty = 0,
): number {
  return computeBasepointFromSkillSum(cookingSkill * 2, rank, tool, bonus, penalty);
}

/** Chara call-name (state-only, for prompt + narration). */
function charaName(state: GameState, num: number): string {
  if (num === 0) return state.master.callName ?? "主人公";
  return state.charas[num]?.callName ?? `角色${num}`;
}

/**
 * A valid cook helper — `SHIRAHU(TARGET)` (COMMON.ERB:827): a present chara
 * that is not 睡眠 / 陪睡中 / 泥酔(烂醉) / 衰弱. (Time-stop is handled by
 * execCheck; the `!nExcludeAssi` toggle is deferred — P1/P2 auto-help.)
 */
function validCookHelper(state: GameState, charaNum: number): boolean {
  if (charaNum <= 0) return false;
  const c = state.charas[charaNum];
  if (!c || c.location !== state.master.location) return false;
  return (
    (c.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0 &&
    (c.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) === 0 &&
    (c.state.CFLAG[CFLAG_ID.衰弱] ?? 0) === 0 &&
    (c.state.TCVAR[TCVAR_ID.泥酔] ?? 0) === 0
  );
}

/**
 * 角色依存 taste tags (`@DISH_TASTE_FROM_CHARA`, non-race subset): the chara's
 * author-authored 助手効果 (from chara-data) + 愛情 (恋人×5/恋慕×3/思慕×1) +
 * 母亲的味道 (母性 || 出産経験). Race (GET_TRIBENAME) / weather 闪耀 = P3b.
 */
function charaFlavorTags(state: GameState, charaNum: number): string {
  const c = state.charas[charaNum];
  if (!c) return "";
  let tags = charaDataOf(charaNum)?.assistEffect ?? "";
  tags += raceTasteTags(c.state.TALENT); // 種族/流派 (GET_TRIBENAME, P3b)
  tags += loveAndMotherTags({
    koibito: (c.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0,
    renbo: (c.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0,
    shibo: (c.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0,
    motherly: (c.state.TALENT[TALENT_ID.母性] ?? 0) !== 0 || (c.state.EXP[EXP_ID.出産経験] ?? 0) !== 0,
  });
  return tags;
}

/**
 * Apply the helper (DISH_ASSI) effects block (ERB 313-392, non-DLC):
 * 歓楽 SOURCE + 信頼 (TRUST_CALC) + DOWNBASE 体力/気力 + 料理経験 (+習得速度,
 * +調理指南書) + cross-skill EXP + 同行. Mutates `next` in place.
 */
function applyHelperEffects(
  next: GameState,
  helperNum: number,
  dish: DishEntry,
  basepoint: number,
  rng: { int(max: number): number },
): void {
  const helper = next.charas[helperNum]!;
  const juujun = helper.state.ABL[ABL_ID.従順] ?? 0;
  const favor = helper.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  const helperSkill = helper.state.ABL[ABL_ID.料理技能] ?? 0;

  // SOURCE:歓楽 (ERB 347) + 信頼度管理 → TRUST_CALC (ERB 349).
  const sources = {
    [SOURCE_ID.歓楽]: helperKanrakuSource(obedienceCoef(juujun), favorCoef(favor), dish.time),
  };
  applySourceCheck(next, helperNum, sources, 0, helperTrustSeed(helperSkill));

  // DOWNBASE 体力/気力 (ERB 352-360).
  const cost = cookCost(dish.type);
  setCharaBase(next, helperNum, BASE_ID.体力, Math.max(0, getCharaBase(next, helperNum, BASE_ID.体力) - cost.stamina));
  setCharaBase(next, helperNum, BASE_ID.気力, Math.max(0, getCharaBase(next, helperNum, BASE_ID.気力) - cost.will));

  // EXP:helper:料理経験 (ERB 362) + 調理指南書 (ERB 363).
  const learnSpeed = helper.state.TALENT[TALENT_ID.習得速度] ?? 0;
  let hExp = helperCookExp(basepoint, learnSpeed, rng);
  if (itemCount(next, DISH_ITEM_ID.調理指南書) > 0 && rng.int(2) === 0) hExp += 1;
  helper.state.EXP[EXP_ID.料理経験] = (helper.state.EXP[EXP_ID.料理経験] ?? 0) + hExp;

  // Cross-skill 経験 (ERB 366-370, non-DLC): the less-skilled cook improves.
  if (masterCookingSkill(next) <= helperSkill) {
    next.master.state.EXP[EXP_ID.料理経験] = (next.master.state.EXP[EXP_ID.料理経験] ?? 0) + 1;
  } else {
    helper.state.EXP[EXP_ID.料理経験] = (helper.state.EXP[EXP_ID.料理経験] ?? 0) + 1;
  }

  // 同行 += DISH_TIME (ERB 385-386).
  const hDoko = helper.state.CFLAG[CFLAG_ID.同行] ?? 0;
  if (hDoko) helper.state.CFLAG[CFLAG_ID.同行] = hDoko + dish.time;
}

/**
 * `EXP:MASTER:料理経験` gain (ERB 296, non-DLC): `1 + RAND:(MAX((BASEPOINT-300)
 * /80, 1))`. `rng.int(n)` models `RAND:n` ∈ [0,n). Pure for tests.
 */
export function computeCookExp(
  basepoint: number,
  rng: { int(max: number): number },
): number {
  const span = Math.max(Math.trunc((basepoint - 300) / 80), 1);
  return 1 + rng.int(span);
}

/** A cookable dish + its default (first-owned) ingredient. */
interface CookOption {
  dish: DishEntry;
  ingId: number;
  ingName: string;
  rank: number;
}

/**
 * 練習可 (ERB 47): a present helper whose 固有料理 is not yet learned, with
 * 親密 ≥ 5, and whose SP-dish ingredient the player owns (so it's cookable).
 * Returns the SP dish + default ingredient, or null.
 */
function practiceOptionFor(state: GameState, helperNum: number): CookOption | null {
  if (!validCookHelper(state, helperNum)) return null;
  const dish = spDishFor(helperNum);
  if (!dish || dish.uncookable) return null;
  if (isSpDishLearned(state, helperNum)) return null; // already learned
  if ((state.charas[helperNum]?.state.ABL[ABL_ID.親密] ?? 0) < 5) return null;
  const owned = ownedIngredientsFor(state, dish);
  if (owned.length === 0) return null;
  return { dish, ingId: owned[0]!.id, ingName: owned[0]!.name, rank: owned[0]!.rank };
}

/** Selections retained by the UI only while the multi-screen cooking menu is open. */
function stagedSelections(answer: PromptAnswer | undefined): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function selectedValue(selections: readonly (number | string)[], prefix: string): string | undefined {
  for (let index = selections.length - 1; index >= 0; index -= 1) {
    const value = selections[index];
    if (typeof value === "string" && value.startsWith(prefix)) return value;
  }
  return undefined;
}

function selectedNumber(selections: readonly (number | string)[], prefix: string): number | undefined {
  const value = selectedValue(selections, prefix);
  if (!value) return undefined;
  const parsed = Number(value.slice(prefix.length));
  return Number.isInteger(parsed) ? parsed : undefined;
}

function typePrompt(state: Readonly<GameState>, helper: number): PromptSpec {
  const options: PromptOption[] = [
    { id: "type:1", label: "轻食" },
    { id: "type:2", label: "主食" },
    { id: "type:3", label: "甜点" },
  ];
  if (helper && practiceOptionFor(state, helper)) {
    options.push({ id: "type:4", label: `练习${charaName(state, helper)}的拿手菜` });
  }
  return pickOne("选择料理类别", options);
}

function dishPrompt(state: Readonly<GameState>, type: number, helper: number): PromptSpec {
  if (type === 4) {
    const practice = helper ? practiceOptionFor(state, helper) : null;
    return pickOne("选择要练习的料理", practice
      ? [{ id: `dish:${practice.dish.no}`, label: practice.dish.name, detail: `熟练度 ${learnedMenuOf(state, helper)}/100` }]
      : []);
  }
  const dishType = type === 1 ? "軽食" : type === 2 ? "主食" : "甜点";
  const skill = masterCookingSkill(state);
  const options = allDishes()
    .filter((dish) =>
      dish.type === dishType &&
      !dish.uncookable &&
      dish.name !== "" &&
      (dish.spChara === undefined || isSpDishLearned(state, dish.spChara)),
    )
    .sort((a, b) => a.no - b.no)
    .map((dish) => {
      const unavailable = skill < dish.skillLv || ownedIngredientsFor(state, dish).length === 0;
      return {
        id: `dish:${dish.no}`,
        label: dish.name,
        detail: `料理Lv ${dish.skillLv}${unavailable ? " · 当前无法制作" : ""}`,
        disabled: unavailable,
      };
    });
  return pickOne("选择料理", options);
}

function ingredientPrompt(state: Readonly<GameState>, dish: DishEntry): PromptSpec {
  return pickOne("选择食材", dish.ingredients.map((ingredient) => ({
    id: `ingredient:${ingredient.id}`,
    label: ingredient.name,
    detail: `食材等级 ${ingredient.rank}`,
    disabled: itemCount(state, ingredient.id) <= 0,
  })));
}

function drugPrompt(state: Readonly<GameState>, helper: number): PromptSpec {
  const options: PromptOption[] = [{ id: "drug:0", label: "不下药" }];
  if (!helper) {
    for (const drug of SHIKOMI_DRUGS) {
      options.push({
        id: `drug:${drug.id}`,
        label: drug.name,
        disabled: itemCount(state, drug.id) <= 0,
      });
    }
  }
  return pickOne("选择预处理（下药）", options);
}

function additivePrompt(state: Readonly<GameState>, dish: DishEntry): PromptSpec {
  const options: PromptOption[] = [{ id: "additive:0", label: "不添加" }];
  for (const additive of TENKABUTSU) {
    options.push({
      id: `additive:${additive.id}`,
      label: additive.name,
      disabled: itemCount(state, additive.id) <= 0 || (additive.dessertOnly && dish.type !== "甜点"),
    });
  }
  return pickOne("选择添加物", options);
}

/** Upstream COOKING_UI: type → menu → ingredient → drug/additive → commit. */
function cookPrompt(ctx: CommandContext): PromptSpec | null {
  if (getDish(ctx.state)) return null;
  const helper = validCookHelper(ctx.state, ctx.target) ? ctx.target : 0;
  const selections = stagedSelections(ctx.promptAnswer);
  const type = selectedNumber(selections, "type:");
  if (!type) return typePrompt(ctx.state, helper);
  const dishNo = selectedNumber(selections, "dish:");
  if (!dishNo) return dishPrompt(ctx.state, type, helper);
  const dish = dishByNo(dishNo);
  if (!dish) return dishPrompt(ctx.state, type, helper);
  const ingredient = selectedNumber(selections, "ingredient:");
  if (!ingredient) return ingredientPrompt(ctx.state, dish);
  if (selectedNumber(selections, "drug:") === undefined) return drugPrompt(ctx.state, helper);
  if (selectedNumber(selections, "additive:") === undefined) return additivePrompt(ctx.state, dish);
  return selectedValue(selections, "commit:") ? null : pickOne(
    `确认制作「${dish.name}」？`,
    [{ id: "commit:yes", label: "制作" }],
  );
}

function hasCookableDish(state: GameState, target: number): boolean {
  const skill = masterCookingSkill(state);
  const normal = allDishes().some((dish) =>
    !dish.uncookable &&
    dish.name !== "" &&
    (dish.spChara === undefined || isSpDishLearned(state, dish.spChara)) &&
    skill >= dish.skillLv &&
    ownedIngredientsFor(state, dish).length > 0
  );
  return normal || (target > 0 && practiceOptionFor(state, target) !== null);
}

function checkCookEligible(
  state: GameState,
  target = 0,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 684: 時間停止 (FLAG:70) → block.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能做饭。" } };
  }
  // ERB 694: KITCHEN(現在位置) — must be in a kitchen room.
  const room = getCurrentRoomProps(state.master.location);
  if (!room || !room.kitchen) {
    return { ok: false, reason: { kind: "precondition", message: "需要在厨房做饭。" } };
  }
  // ERB 697: 気力 <= 0 → block.
  if (getMasterBase(state, BASE_ID.気力) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有気力做饭。" } };
  }
  // ERB 699: 诶嘿嘿 → block (also covers 恶作剧 cluster, ERB 705).
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是做饭的时候。" } };
  }
  // ERB 702: 陪睡中 → block.
  if (getMasterCflag(state, CFLAG_ID.陪睡中) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "正在陪睡，不能做饭。" } };
  }
  // ERB 708: 既に料理を作っている (DISH_NAME != "") → block.
  if (getDish(state)) {
    return { ok: false, reason: { kind: "precondition", message: "已经做好了一道料理。" } };
  }
  if (!hasCookableDish(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "没有技能允许且持有食材的料理。" } };
  }
  return { ok: true };
}

/** The resolved cook/practice action. */
interface Chosen {
  dish: DishEntry;
  ingId: number;
  ingName: string;
  rank: number;
  helperNum: number;
  isPractice: boolean;
  /** 仕込み(下药) ITEM id, 0 = none. */
  drg: number;
  /** 添加物 ITEM id, 0 = none. */
  drg2: number;
}

function normalDishAllowed(state: GameState, dish: DishEntry): boolean {
  return !!dish.name && !dish.uncookable && masterCookingSkill(state) >= dish.skillLv
    && (dish.spChara === undefined || isSpDishLearned(state, dish.spChara));
}

function additiveAllowed(state: GameState, dish: DishEntry, id: number): boolean {
  const additive = TENKABUTSU.find(entry => entry.id === id);
  return !!additive && itemCount(state, id) > 0 && (!additive.dessertOnly || dish.type === "甜点");
}

/** Decode `cook:<dishNo>:<ingId>[:d<drg>|:a<add>]` (+ target helper), or null. */
function decodeCook(state: GameState, picked: number | string | null, target: number): Chosen | null {
  if (typeof picked !== "string") return null;
  const parts = picked.split(":");
  if (parts[0] !== "cook") return null;
  const dish = dishByNo(Number(parts[1]));
  const ingId = Number(parts[2]);
  if (!dish || !normalDishAllowed(state, dish)) return null;
  const ing = dish.ingredients.find((i) => i.id === ingId);
  // Must still own it (state may have changed since the prompt was built).
  if (!ing || itemCount(state, ingId) <= 0) return null;
  const helperNum = validCookHelper(state, target) ? target : 0;
  // 仕込み/添加物 suffix — must still be owned; 仕込み voided when a helper cooks.
  let drg = 0;
  let drg2 = 0;
  const mod = parts[3] ?? "";
  if (mod.startsWith("d") && !helperNum) {
    const id = Number(mod.slice(1));
    if (!SHIKOMI_DRUGS.some(drug => drug.id === id) || itemCount(state, id) <= 0) return null;
    drg = id;
  } else if (mod.startsWith("a")) {
    const id = Number(mod.slice(1));
    if (!additiveAllowed(state, dish, id)) return null;
    drg2 = id;
  }
  return { dish, ingId, ingName: ing.name, rank: ing.rank, helperNum, isPractice: false, drg, drg2 };
}

/** Decode `practice:<helperNum>` → the helper's SP dish (re-validates 練習可). */
function decodePractice(state: GameState, picked: number | string | null, target: number): Chosen | null {
  if (typeof picked !== "string") return null;
  const parts = picked.split(":");
  if (parts[0] !== "practice") return null;
  const helperNum = Number(parts[1]);
  if (helperNum !== target) return null;
  const opt = practiceOptionFor(state, helperNum);
  if (!opt) return null;
  return { ...opt, helperNum, isPractice: true, drg: 0, drg2: 0 };
}

function decodeStagedCook(state: GameState, answer: PromptAnswer | undefined, target: number): Chosen | null {
  const selections = stagedSelections(answer);
  if (selectedValue(selections, "commit:") !== "commit:yes") return null;
  const type = selectedNumber(selections, "type:");
  const dishNo = selectedNumber(selections, "dish:");
  const ingId = selectedNumber(selections, "ingredient:");
  if (!type || ![1, 2, 3, 4].includes(type) || !dishNo || ingId === undefined) return null;
  const dish = dishByNo(dishNo);
  if (!dish || itemCount(state, ingId) <= 0) return null;
  const ingredient = dish.ingredients.find((entry) => entry.id === ingId);
  if (!ingredient) return null;
  const helperNum = validCookHelper(state, target) ? target : 0;
  const practice = type === 4 ? (helperNum ? practiceOptionFor(state, helperNum) : null) : null;
  if (type === 4 && (!practice || practice.dish.no !== dish.no)) return null;
  if (type !== 4 && dish.type !== (type === 1 ? "軽食" : type === 2 ? "主食" : "甜点")) return null;
  if (type !== 4 && !normalDishAllowed(state, dish)) return null;
  const selectedDrug = selectedNumber(selections, "drug:") ?? 0;
  const selectedAdditive = selectedNumber(selections, "additive:") ?? 0;
  if (selectedDrug && (helperNum || !SHIKOMI_DRUGS.some(drug => drug.id === selectedDrug) || itemCount(state, selectedDrug) <= 0)) return null;
  if (selectedAdditive && !additiveAllowed(state, dish, selectedAdditive)) return null;
  const drg = selectedDrug;
  const drg2 = selectedAdditive;
  return {
    dish,
    ingId,
    ingName: ingredient.name,
    rank: ingredient.rank,
    helperNum,
    isPractice: type === 4,
    drg,
    drg2,
  };
}

export const cookHandlerEntry: HandlerEntry = {
  commandNo: 413,
  prompt: cookPrompt,
  stagedPrompt: true,
  execCheck: (ctx) => {
    const r = checkCookEligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);

    const legacyPick = ctx.promptAnswer?.kind === "pick_one" ? ctx.promptAnswer.value : null;
    const chosen =
      decodeStagedCook(next, ctx.promptAnswer, ctx.target) ??
      decodePractice(next, legacyPick, ctx.target) ??
      decodeCook(next, legacyPick, ctx.target);
    if (!chosen) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "还没决定做什么。" },
        ],
        outcome: "noop" as const,
      };
    }
    const { dish, ingId, ingName, rank, helperNum, isPractice, drg, drg2 } = chosen;
    const type = dish.type;

    const masterSkill = masterCookingSkill(next);
    const helperSkill = helperNum ? next.charas[helperNum]!.state.ABL[ABL_ID.料理技能] ?? 0 : 0;

    // 角色依存 taste (`@DISH_TASTE_FROM_CHARA`, ERB 453): a helper (not in 練習)
    // flavors the dish with their author 助手効果 + 愛情/母亲. Race/weather = P3b.
    const charaTags = helperNum && !isPractice ? charaFlavorTags(next, helperNum) : "";

    // Taste assembly (seasonal + ingredient DISH_TASTE_ADD + chara effect engine).
    const taste = assembleDishTaste(dish, currentMonth(next), {
      ingredientName: ingName,
      charaTags,
      rng: ctx.rng,
      practice: isPractice,
    });
    // Basepoint: skillSum + rank + 道具力(銀杏案板) + BONUS − 減点(0). skillSum is
    // 料理技能*2 solo (ERB 629) or master+helper (ERB 619).
    const tool = itemCount(next, DISH_ITEM_ID.銀杏案板);
    // 減点/BONUS: 仕込み → 減点+1 (ERB 595); 添加物 → GET_ADDITIVE_BONUS split
    // into BONUS点(>0) vs 減点(<0) (ERB 609-614).
    const addBonus = drg2 ? additiveBonus(drg2) : 0;
    const bonus = computeBonusPoints(taste) + Math.max(addBonus, 0);
    const penalty = (drg ? 1 : 0) + Math.max(-addBonus, 0);
    const skillSum = helperNum ? masterSkill + helperSkill : masterSkill * 2;
    const basepoint = computeBasepointFromSkillSum(skillSum, rank, tool, bonus, penalty);

    // Seed the current dish (DISH_LIMIT = DISH_MAXLIMIT + DISH_TIME, ERB 474).
    setDish(
      next,
      seedDish({
        name: dish.name,
        type,
        taste,
        basepoint,
        time: dish.time,
        assi: helperNum,
        maxLimit: dish.maxLimit,
        limit: dish.maxLimit + dish.time,
        drg, // 仕込み — the eat path (dish.ts) stamps the drug TCVAR (ERB 683).
        drg2, // 添加物 — 栄養強化剤 ×1.1 回復率 on eat (ERB 657).
      }),
    );

    // Consume the ingredient (ERB 279) + 仕込み/添加物 (ERB 279-283).
    removeItem(next, ingId, 1);
    if (drg) removeItem(next, drg, 1);
    if (drg2) removeItem(next, drg2, 1);

    // DOWNBASE 体力/気力 (ERB 284-294).
    const cost = cookCost(type);
    setMasterBase(next, BASE_ID.体力, getMasterBase(next, BASE_ID.体力) - cost.stamina);
    setMasterBase(next, BASE_ID.気力, getMasterBase(next, BASE_ID.気力) - cost.will);

    // EXP:MASTER:料理経験 (ERB 296) + 調理指南書 !RAND:2 → +1 (ERB 300-301).
    let cookExp = computeCookExp(basepoint, ctx.rng);
    if (itemCount(next, DISH_ITEM_ID.調理指南書) > 0 && ctx.rng.int(2) === 0) cookExp += 1;
    next.master.state.EXP[EXP_ID.料理経験] = (next.master.state.EXP[EXP_ID.料理経験] ?? 0) + cookExp;

    // TIME += DISH_TIME (ERB 309) + 同行 (ERB 311-312).
    advanceTimeTicks(next, dish.time);
    const doko = getMasterCflag(next, CFLAG_ID.同行);
    if (doko) next.master.state.CFLAG[CFLAG_ID.同行] = doko + dish.time;

    // TFLAG:194 dish-class (ERB 664-672).
    setTflag(
      next,
      TFLAG_ID.SOURCEなどに影響しないSELECTCOMの分岐,
      dishClass194(type),
    );

    // Helper effects (ERB 313-392): 歓楽/信頼/経験/DOWNBASE/同行 to the helper.
    if (helperNum) applyHelperEffects(next, helperNum, dish, basepoint, ctx.rng);

    const events: ObservationEvent[] = [];
    const withWhom = helperNum ? `和${charaName(next, helperNum)}一起` : "";

    // 練習モード (DISH_COOKING 642-662): master EXP +1 (ERB 302), LEARNED_MENU
    // gain, and 固有料理 unlock at ≥100 (@LEARNING_SP_DISH → 100+DAY).
    if (isPractice && helperNum) {
      next.master.state.EXP[EXP_ID.料理経験] = (next.master.state.EXP[EXP_ID.料理経験] ?? 0) + 1;
      const learnSpeed = next.master.state.TALENT[TALENT_ID.習得速度] ?? 0;
      const gain = practiceGain(learnSpeed, masterSkill, ctx.rng);
      const before = learnedMenuOf(next, helperNum);
      let after = before + gain;
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `${withWhom}练习制作了【${dish.name}】。（熟练度 ${Math.min(after, 100)}/100）`,
      });
      if (after >= 100) {
        after = 100 + next.time.dayIndex; // @LEARNING_SP_DISH: 100 + DAY
        events.push({
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `学会了『${dish.name}』！`,
        });
      }
      setLearnedMenu(next, helperNum, after);
    } else {
      // EX_DISH_NAME 流派 display prefix (ERB 485-551).
      const exName = exDishNamePrefix(taste) + dish.name;
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `${withWhom}用${ingName}做好了【${exName}】（品质 ${basepoint}）。（经过 ${dish.time} 分钟）`,
      });
    }

    return { state: next, events, outcome: "ok" as const };
  },
};
