/**
 * Phase 7.5 (§3F) — `dish.ts`: the cooking/DISH subsystem, **eat half**
 * (B7-eat). Unlocks COMF414 食事を取る + COMF415 食事をふるまう without
 * waiting on 413 料理を作る (B7-cook, deferred). Faithful to the
 * **non-DLC** path of `COMF414 食事を取る.ERB` (`@吃飯` / `@REVIEW_DISH` /
 * `@満腹度上昇` / `@COM414_実食` SOURCE formula / `@KIGEN_CHANGE`).
 *
 * The dish itself is populated by `seedDish()` (a bypass for 413's
 * `COOKING_UI` interactive picker — the same depth-first "seed one dish,
 * verify the eat loop" posture the §3F scan prescribed). The full 170-dish
 * `DISHDATA` static-table import + `DISH_TASTE_FROM_CHARA`/`DISH_COOKING`
 * cooking-phase belong to B7-cook (413/498) and are NOT here.
 *
 * **Faithfully ported (non-DLC `@吃飯`, ERB 610-653 + 656-748):**
 *   - Base recovery rates by DISH_TYPE (軽食/主食/甜点) — ERB 378-394.
 *   - Taste-tag modifiers: 神力/妖力/生命力 ×1.2; 霊障/魔力/仙術/秘術 +100 TSP;
 *     薬効/薬膳 +100 気力; 精力/強精 +100 精力; 奇跡/幸運 → TFLAG:幸運補正.
 *   - 添加物 栄養強化剤 → ×1.1 回復率 (P4-wired; fires when 413 sets DISH_DRG_2).
 *   - Special buffs: 祝福/附魔/加護/豊穣 → per-chara TCVAR flags.
 *   - non-MASTER: `@REVIEW_DISH` (taste evaluation) + 仕込み (DISH_DRG→drug
 *     TCVAR, dead for seed) + 評価値補正 (×0.6/0.8/1.0/1.1 by 評価値).
 *   - 跳蛋 → EXP:Ｃ経験 +30; 丰盛/简易 → 満腹度 ×1.2/0.8; `@満腹度上昇`.
 *   - `RECOVER_PERMIL` 体力/気力/精力 (+TSP for MASTER); なるべく動かない=1.
 *   - `@COM414_実食` SOURCE: 歓楽/受動/征服/不潔/反感 + 大胃王/BONUS ×1.5 +
 *     `@KIGEN_CHANGE` mood nudge + TFLAG:193 (1/0/-1 by 評価値).
 *
 * **DEFERRED (documented; off in the eat-only slice):**
 *   - `MAGIC_DLC_料理相关` entire branch — the big taste→提升値/CHANGE_MAXBASE/
 *     BUFF_BASE ladder (ERB 395-609). Non-DLC path is the MVP.
 *   - `BUFF_BASE` (薬膳/強精 non-DLC calls) — buff system not ported; the
 *     回復率 adds are kept, the BUFF_BASE calls dropped.
 *   - DISHDATA 170-dish import + `DISH_TASTE_FROM_CHARA` + `DISH_COOKING`
 *     + `COOKING_UI` — B7-cook (413/498).
 *   - 仕込み drug TCVAR (媚薬/利尿剤/催情薬/睡眠薬/新鲜精液 → TCVAR = 下药强度
 *     210) — P4-wired (fires when 413 sets DISH_DRG on a non-master eater).
 *   - 鮮度 (DISH_LIMIT) ambient decay — stored, decays on Phase 8 time tick.
 *     (Upstream `@REVIEW_DISH` adds 劣化×3 / 过季×6 unconditionally, which this
 *     port does too; neither reads DISH_LIMIT at meal time.)
 *   - `KOJO_MESSAGE_SEND` / `TFLAG:192` 口上 evaluation override — the authored
 *     kojo can force 大成功/成功/失敗 (700/500/400) or abort the whole command
 *     (`-2`). We have no channel for an authored kojo or the AI to return an
 *     outcome, so the pre-loop 評価値=0 always falls through to `reviewDish`.
 *     That is the correct *fallback* arm, but it is NOT equivalent to upstream:
 *     a character who would have refused the dish still eats it.
 *   - TFLAG:授乳コマンド — set in ERB, no consumer in our slice.
 *   - 約會経験 / 约会临时标记 — no dating subsystem.
 *
 * Race arms in `reviewDish` are COMPLETE: `CHECK_CHARA` reads the race TALENTs
 * directly (妖怪 191 / 妖精 192 / 神霊 193 / 幽霊 194 / 付喪神 195 / 人形 196 /
 * 人类 190) and 半人类 is derived from them; 魔法使 is 追加種族 == 2.
 */

import type { CharaSlot, Dish, GameState } from "./game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EQUIP_SLOT,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  recoverPermil,
  times,
} from "./settlement.js";
import { TFLAG_ID, setTflag } from "./tflag.js";
import { charaDataOf } from "./chara-data.js";
import { SEASON_SUMMER, SEASON_WINTER } from "../world/calendar.js";

/**
 * The eraBASIC `RAND` surface this module needs — a slice of
 * `CommandContext.rng` (`int(max)` → `RAND:max` ∈ [0, max)). Defined locally
 * (like `GatherRng`) so `state/` does not depend on `command/`.
 */
export interface DishRng {
  int(max: number): number;
}

/**
 * 仕込み(下药) / 添加物 ITEM ids (Item.csv) read by the eat path (COMF414
 * 683-697 drug arm + 657-662 additive). Exported so 413's cook picker
 * (`cook.ts` P4) sets `dish.drg`/`drg2` to the same ids. `SHIKOMI` /
 * `TENKABUTSU` lists: `QOL_COM_STUFF.ERH`.
 */
export const DISH_DRUG_ITEM_ID = {
  // 仕込み (SHIKOMI)
  媚薬: 41,
  利尿剤: 42,
  催情薬: 250,
  睡眠薬: 252,
  新鲜精液: 47,
  // 添加物 (TENKABUTSU)
  栄養強化剤: 518,
} as const;

/** `下药强度` — the drug strength stamped on the eater (qol ERH const). */
const 下药强度 = 210;

// ---------------------------------------------------------------------------
// Dish accessors
// ---------------------------------------------------------------------------

/** Read the current dish, or `null` if none (`DISH_NAME == ""`). */
export function getDish(state: GameState): Dish | null {
  const d = state.dish;
  return d && d.name !== "" ? d : null;
}

/** Set the current dish (mutates `state`). */
export function setDish(state: GameState, dish: Dish | null): void {
  state.dish = dish;
}

/** Clear the current dish (料理リセット). */
export function clearDish(state: GameState): void {
  state.dish = null;
}

/**
 * Build a `Dish` from a partial spec, bypassing COMF413's interactive
 * `COOKING_UI` picker. The eat path (414/415) only reads `name`/`taste`/
 * `type`/`basepoint`; the cooking-only fields (`drg`/`drg2`/`assi`/`limit`)
 * default to 0 so the 仕込み/添加物/assistant arms are inert (faithful for a
 * hand-prepared dish with no drug/additive).
 */
export function seedDish(spec: {
  name: string;
  type: Dish["type"];
  taste?: string;
  basepoint?: number;
  time?: number;
  drg?: number;
  drg2?: number;
  assi?: number;
  limit?: number;
  maxLimit?: number;
}): Dish {
  return {
    name: spec.name,
    type: spec.type,
    taste: spec.taste ?? "",
    basepoint: spec.basepoint ?? 0,
    time: spec.time ?? 0,
    drg: spec.drg ?? 0,
    drg2: spec.drg2 ?? 0,
    assi: spec.assi ?? 0,
    limit: spec.limit ?? 0,
    maxLimit: spec.maxLimit ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Taste-tag helpers (ERA `STRCOUNT` / `STR_MULTI_COUNT`)
// ---------------------------------------------------------------------------

/**
 * `STRCOUNT(str, "tag/")` — number of occurrences of `tag/` in `str`
 * (ERA counts overlapping? no — non-overlapping left-to-right). e.g.
 * `tasteCount("劣化/劣化/軽食/", "劣化") === 2`.
 */
export function tasteCount(taste: string, tag: string): number {
  if (!tag) return 0;
  const needle = `${tag}/`;
  let n = 0;
  let i = 0;
  while ((i = taste.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

/** `STRCOUNT(DISH_TASTE, "tag/") >= 1` — does the dish carry this tag? */
function hasTaste(taste: string, tag: string): boolean {
  return tasteCount(taste, tag) >= 1;
}

/**
 * `STR_MULTI_COUNT(listStr, tasteStr)` — sum, over each tag occurrence in
 * `listStr` (multiplicity via repetition, e.g. `"劣化/劣化/劣化/"`), of
 * `STRCOUNT(tasteStr, "tag/")`. Used by `@REVIEW_DISH` to weigh good/bad.
 */
function strMultiCount(listStr: string, taste: string): number {
  let n = 0;
  for (const tag of listStr.split("/").filter(Boolean)) {
    n += tasteCount(taste, tag);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hunger clock (`TIME_PROGRESS(空腹時刻)`)
// ---------------------------------------------------------------------------

/**
 * Whether `charaNum` is hungry for the current dish type — ERA
 * `TIME_PROGRESS(TCVAR:空腹時刻)` (or `甜点空腹時刻` for 甜点). Hungry when
 * the in-game clock (`state.time.tickValue`, total minutes = `1440*DAY+TIME`)
 * has reached the stored hunger-clock timestamp. An unset (0) clock means
 * "hungry from the start" (a fresh chara).
 */
export function isHungryFor(
  state: GameState,
  charaNum: number,
  isDessert: boolean,
): boolean {
  const clockId = isDessert ? TCVAR_ID.甜点空腹時刻 : TCVAR_ID.空腹時刻;
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  const threshold = slot.state.TCVAR[clockId] ?? 0;
  return state.time.tickValue >= threshold;
}

/**
 * `@満腹度上昇(ARG, ARGS, ARG:1)` (ERB 872-893). Sets the hunger clock
 * forward by `満腹度` minutes (`1440*DAY+TIME+満腹度` = `tickValue+満腹度`).
 * 大胃王 ×0.7. 甜点 writes `甜点空腹時刻`; else `空腹時刻`.
 *
 * `満腹度` is the post-丰盛/简易 multiplier value (caller computes it).
 */
export function riseFullness(
  state: GameState,
  charaNum: number,
  type: Dish["type"],
  manpuku: number,
): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;
  let m = manpuku;
  // 大胃王 ×0.7 (ERB 887-888). TALENT not in our enum → looked up by a
  // dedicated id; deferred (a clean chara has it off → no-op).
  // (When 大胃王 is imported, add: if (talent(slot, 大胃王)) m = times(m, 0.7);)
  const clockId = type === "甜点" ? TCVAR_ID.甜点空腹時刻 : TCVAR_ID.空腹時刻;
  slot.state.TCVAR[clockId] = state.time.tickValue + m;
}

// ---------------------------------------------------------------------------
// `@KIGEN_CHANGE(ARG, 確率, 傾向)` (COMMON.ERB:1584)
// ---------------------------------------------------------------------------

/**
 * Mood nudge: with probability `prob`/100, shift `TALENT:心情` by `tendency`
 * (`tendency 0` → random ±1), then clamp to [-1, 1]. `感情缺乏` halves
 * `prob` (deferred — talent not imported → no-op). Mutates `slot` in place.
 *
 * `rng.int(100)` models `RAND:100`; `rng.int(2)` models `RAND:2`.
 */
export function kigenChange(
  slot: CharaSlot,
  prob: number,
  tendency: number,
  rng: DishRng,
): void {
  let p = prob;
  // SIF TALENT:ARG:感情缺乏 → 確率 /= 2 (deferred: 感情缺乏 not imported).
  if (rng.int(100) >= p) return;
  const cur = slot.state.TALENT[TALENT_ID.心情] ?? 0;
  let next: number;
  if (tendency === 0) {
    next = rng.int(2) === 0 ? cur + 1 : cur - 1;
  } else {
    next = cur + tendency;
  }
  slot.state.TALENT[TALENT_ID.心情] = Math.max(-1, Math.min(1, next));
}

// ---------------------------------------------------------------------------
// `@REVIEW_DISH(CHARA, ARGS)` (ERB 754-858) — non-master taste evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the current dish for `charaNum` and write `TCVAR:料理評価値`.
 * Models the per-chara `GETMETH_STR` キャラデータ taste (foodLike/foodDislike,
 * `ERB 758-759`) + the **common** taste settings (race/talent/seasonal gates)
 * for a 人类 chara; the non-人类 race arms defer (need the race map; the
 * `人类`-gated arms ARE ported). Returns the computed 評価値 (0-999).
 *
 * Faithful formula (ERB 840-845):
 *   TASTE_GOOD = 300 + (80 + RAND:20) * STR_MULTI_COUNT(GOOD, taste)
 *   TASTE_BAD  = 300 + 150 * STR_MULTI_COUNT(BAD, taste)
 *   評価値     = TASTE_GOOD * DISH_BASEPOINT * 2 / (TASTE_GOOD + TASTE_BAD)
 * (+ DLC 料理评价补正 — non-DLC → 0.)
 */
export function reviewDish(
  state: GameState,
  charaNum: number,
  rng: DishRng,
): number {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return 0;
  const dish = getDish(state);
  if (!dish) return 0;
  const taste = dish.taste;

  // --- 個人設定：キャラデータ 料理の好み (ERB 758-759) ---
  // GETMETH_STR(, "キャラデータ", CHARA, "料理：喜欢的味道"/"料理：讨厌的味道")
  // — the weighted slash-delimited tag strings from chara-data.bundle.json.
  // Multiplicity = weight, matched via STR_MULTI_COUNT below.
  const data = charaDataOf(slot.charaNum);
  let good = data?.foodLike ?? "";
  let bad = data?.foodDislike ?? "";

  // --- 共通設定：好き (ERB 764-807) ---
  good += "甜点/"; // 甜点はみんな好き (766)
  good += "できたて/"; // できたてはみんな好き (768)
  // Race arms. `CHECK_CHARA` reads the race TALENTs directly, and 半人类 is
  // derived from them (`COMMON.ERB` @CHECK_CHARA: 人类 && (妖怪||妖精||神霊||
  // 幽霊||付喪神||人形)) — no separate race table is needed. 魔法使 is the one
  // exception: it lives in 追加種族 (value 2, `@GET_TRIBENAME`).
  const race = slot.state.TALENT;
  const isHuman = (race[TALENT_ID.人类] ?? 0) !== 0;
  const isHalfHuman = isHuman && (
    (race[TALENT_ID.妖怪] ?? 0) !== 0 || (race[TALENT_ID.妖精] ?? 0) !== 0
    || (race[TALENT_ID.神霊] ?? 0) !== 0 || (race[TALENT_ID.幽霊] ?? 0) !== 0
    || (race[TALENT_ID.付喪神] ?? 0) !== 0 || (race[TALENT_ID.人形] ?? 0) !== 0
  );
  const isYoukai = (race[TALENT_ID.妖怪] ?? 0) !== 0;
  const isDivineSpirit = (race[TALENT_ID.神霊] ?? 0) !== 0;
  const isFairy = (race[TALENT_ID.妖精] ?? 0) !== 0;
  const isMagician = (race[TALENT_ID.追加種族] ?? 0) === 2; // 追加種族 2 = 魔法使
  const isGhost = (race[TALENT_ID.幽霊] ?? 0) !== 0;
  const isTsukumogami = (race[TALENT_ID.付喪神] ?? 0) !== 0;
  // [妖怪] && !半人类 → 妖力 好き (770-771).
  if (isYoukai && !isHalfHuman) good += "妖力/";
  // [神霊] || ([人类] && !半人类) → 神力 好き (772-774).
  if (isDivineSpirit || (isHuman && !isHalfHuman)) good += "神力/";
  // [妖精] → 生命力 好き (775-777).
  if (isFairy) good += "生命力/";
  // [魔法使] → 魔力 好き (778-780).
  if (isMagician) good += "魔力/";
  // [幽霊][付喪神] → 霊障 好き, unless they already dislike it (781-783).
  if ((isGhost || isTsukumogami) && !hasTaste(bad, "霊障")) good += "霊障/";
  // [付喪神] → 鬼の魔力 ×3 (784-786).
  if (isTsukumogami) good += "鬼の魔力/鬼の魔力/鬼の魔力/";
  // 幼稚 → 母亲的味道 + 儿童午餐×5 (ERB 788-792).
  if ((slot.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0) {
    good += "母亲的味道/";
    good += "儿童午餐/儿童午餐/儿童午餐/儿童午餐/儿童午餐/";
  }
  // DISH_ASSI → 嫉妬×3 (794); DISH_BASEPOINT>=500 → 隠し味×2 (797-798).
  if (dish.assi !== 0 && charaNum === dish.assi) good += "嫉妬/嫉妬/嫉妬/";
  if (dish.basepoint >= 500) good += "隠し味/隠し味/";
  // 動物耳 → まんま×3 (ERB 800).
  if ((slot.state.TALENT[TALENT_ID.動物耳] ?? 0) !== 0) {
    good += "まんま/まんま/まんま/";
  }
  // GET_MONTH seasonal (803-807): 夏 likes 冷, 冬 likes 温暖 — unless the
  // personal/common dislike list already carries the tag.
  if (state.time.season === SEASON_SUMMER && !hasTaste(bad, "冷")) {
    good += "冷/";
  } else if (state.time.season === SEASON_WINTER && !hasTaste(bad, "温暖")) {
    good += "温暖/";
  }
  // 愛情,ASSI→MASTERへの愛情 — flavor only upstream, not scored.

  // --- 共通設定：嫌い (ERB 811-837) ---
  bad += "劣化/劣化/劣化/"; // 劣化×3 (813)
  bad += "过季/过季/过季/过季/过季/过季/"; // 过季×6 (815)
  // [妖怪][幽霊][付喪神] && !神力 good → 神力 嫌い (816-818).
  if ((isYoukai || isGhost || isTsukumogami) && !hasTaste(good, "神力")) bad += "神力/";
  // [人类][神霊] && !妖力 good → 妖力 嫌い (819-821).
  if ((isHuman || isDivineSpirit) && !hasTaste(good, "妖力")) bad += "妖力/";
  // [人类] && !半人类 && !霊障 good → 霊障 嫌い (822-824).
  if (isHuman && !isHalfHuman && !hasTaste(good, "霊障")) bad += "霊障/";
  // 嫉妬 嫌い (826-834): not the assi → 恋人×5 / 恋慕×3 / 思慕×1.
  if (charaNum !== dish.assi) {
    if ((slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) {
      bad += "嫉妬/嫉妬/嫉妬/嫉妬/嫉妬/";
    } else if ((slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) {
      bad += "嫉妬/嫉妬/嫉妬/";
    } else if ((slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0) {
      bad += "嫉妬/";
    }
  }
  // DISH_BASEPOINT<500 → 隠し味×2 嫌い (836-837).
  if (dish.basepoint < 500) bad += "隠し味/隠し味/";

  // --- 評価得点 (ERB 840-845) ---
  const goodCount = strMultiCount(good, taste);
  const badCount = strMultiCount(bad, taste);
  const tasteGood = 300 + (80 + rng.int(20)) * goodCount;
  const tasteBad = 300 + 150 * badCount;
  // 評価値 = TASTE_GOOD * DISH_BASEPOINT * 2 / (TASTE_GOOD + TASTE_BAD) (int /).
  let value = Math.trunc(
    (tasteGood * dish.basepoint * 2) / (tasteGood + tasteBad),
  );
  // + TCVAR:料理评价补正 * MAGIC_DLC_料理相关 (non-DLC → 0).
  slot.state.TCVAR[TCVAR_ID.前回料理評価値] = slot.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
  slot.state.TCVAR[TCVAR_ID.料理評価値] = value;
  return value;
}

/**
 * `TFLAG:信頼度管理` for a finished meal — `@COM414` ERB 139 / `@COM415` ERB 93:
 *
 *     TFLAG:信頼度管理 = (TCVAR:TARGET:料理評価値 / 100) / 2 + 1
 *
 * Both arms use ERA integer division and read the **TARGET's** evaluation (set
 * by `reviewDish`), so the range is 1..5 and a well-cooked meal is worth more
 * trust than a badly received one. This is the flag `SOURCE.ERB:1251` gates
 * `@TRUST_CALC` on, and it is the only channel by which a meal raises 信頼度 —
 * 好感度 comes separately through the SOURCE → PALAM settle.
 *
 * Returns 0 when the upstream gate (`SOURCE.ERB:1251`:
 * `TFLAG:信頼度管理 && !CFLAG:TARGET:诶嘿嘿 && !CFLAG:TARGET:睡眠`) is closed,
 * because `applySourceCheck` reads a zero seed as "do not run TRUST_CALC".
 */
export function mealTrustSeed(state: GameState, charaNum: number): number {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return 0;
  if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return 0;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return 0;
  const evaluated = slot.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
  return Math.trunc(Math.trunc(evaluated / 100) / 2) + 1;
}

// ---------------------------------------------------------------------------
// `@吃飯(ARG)` — non-DLC recovery path (ERB 342-748)
// ---------------------------------------------------------------------------

/** Base recovery (‰) + 満腹度 by DISH_TYPE (ERB 378-394). */
function dishTypeBase(type: Dish["type"]): {
  stamina: number;
  will: number;
  energy: number;
  manpuku: number;
} {
  switch (type) {
    case "軽食":
      return { stamina: 200, will: 300, energy: 100, manpuku: 180 };
    case "主食":
      return { stamina: 400, will: 400, energy: 200, manpuku: 360 };
    case "甜点":
      return { stamina: 100, will: 500, energy: 100, manpuku: 180 };
  }
}

/**
 * `@吃飯(ARG)` non-DLC path (ERB 342-748). Restores the eater's BASE by
 * permille, applies taste/additive/buff modifiers, runs `@REVIEW_DISH` +
 * 仕込み + 評価値補正 for non-master, grants 跳蛋 EXP, raises 満腹度, and
 * sets なるべく動かない. Mutates `state` in place.
 *
 * Returns the eater's post-eval `料理評価値` (master: 0 — master is not
 * evaluated; non-master: the REVIEW_DISH result) for test assertion.
 *
 * `rng` consumes `RAND:20` inside `reviewDish` (non-master only).
 */
export function eatMeal(
  state: GameState,
  charaNum: number,
  rng: DishRng,
): number {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return 0;
  const dish = getDish(state);
  if (!dish) return 0;
  const taste = dish.taste;
  const isMaster = charaNum === 0;

  const base = dishTypeBase(dish.type);
  let staminaR = base.stamina; // 体力回復率 (‰)
  let willR = base.will; // 気力回復率
  let energyR = base.energy; // 精力回復率
  let tspR = 0; // TSP回復率 (non-DLC starts 0)
  let manpuku = base.manpuku;

  // --- taste modifiers (non-DLC, ERB 610-652) ---
  if (hasTaste(taste, "神力")) willR = times(willR, 1.2);
  if (hasTaste(taste, "妖力")) willR = times(willR, 1.2);
  if (hasTaste(taste, "生命力")) staminaR = times(staminaR, 1.2);
  if (hasTaste(taste, "霊障")) tspR += 100;
  if (hasTaste(taste, "魔力")) tspR += 100;
  if (hasTaste(taste, "仙術")) tspR += 100;
  if (hasTaste(taste, "秘術")) tspR += 100;
  if (hasTaste(taste, "薬効")) willR += 100;
  if (hasTaste(taste, "薬膳")) {
    willR += 100;
    // CALL BUFF_BASE(気力, MIN(MAXBASE:気力*10/100, 200)) — buff system defer.
  }
  if (hasTaste(taste, "精力")) energyR += 100;
  if (hasTaste(taste, "強精")) {
    energyR += 100;
    // CALL BUFF_BASE(精力, MIN(MAXBASE:精力*10/100, 200)) — buff system defer.
  }
  if (hasTaste(taste, "奇跡")) setTflag(state, TFLAG_ID.幸運補正, 5);
  if (hasTaste(taste, "幸運")) setTflag(state, TFLAG_ID.幸運補正, 3);

  // --- 添加物 (ERB 657-662): DISH_DRG_2 == 栄養強化剤 → ×1.1 回復率 (all eaters).
  if (dish.drg2 === DISH_DRUG_ITEM_ID.栄養強化剤) {
    willR = times(willR, 1.1);
    staminaR = times(staminaR, 1.1);
    energyR = times(energyR, 1.1);
  }

  // --- special buffs (ERB 665-675) ---
  if (hasTaste(taste, "祝福")) slot.state.TCVAR[TCVAR_ID.祝福] = 1;
  if (hasTaste(taste, "附魔")) slot.state.TCVAR[TCVAR_ID.附魔] = 1;
  if (hasTaste(taste, "加護")) slot.state.TCVAR[TCVAR_ID.加護] = 1;
  if (hasTaste(taste, "豊穣")) slot.state.TCVAR[TCVAR_ID.豊穣] = 1;

  // --- non-MASTER: REVIEW_DISH + 仕込み + 評価値補正 (ERB 677-713) ---
  let evaluatedValue = 0;
  if (!isMaster) {
    // REVIEW_DISH runs when 評価値 is 0 (no kojo pre-set) — true for our slice.
    const evalSet = slot.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
    if (!evalSet) {
      evaluatedValue = reviewDish(state, charaNum, rng);
    } else {
      evaluatedValue = evalSet;
    }
    // 仕込み (ERB 683-697): DISH_DRG → drug TCVAR = 下药强度(210) on the eater.
    switch (dish.drg) {
      case DISH_DRUG_ITEM_ID.媚薬:
        slot.state.TCVAR[TCVAR_ID.媚薬] = 下药强度;
        break;
      case DISH_DRUG_ITEM_ID.利尿剤:
        slot.state.TCVAR[TCVAR_ID.利尿剤] = 下药强度;
        break;
      case DISH_DRUG_ITEM_ID.催情薬:
        slot.state.TCVAR[TCVAR_ID.催情薬] = 下药强度;
        break;
      case DISH_DRUG_ITEM_ID.睡眠薬:
        if ((slot.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0) < 2) {
          slot.state.TCVAR[TCVAR_ID.睡眠薬強度] = 2;
          slot.state.TCVAR[TCVAR_ID.睡眠薬茶使用] = 1;
        }
        break;
      case DISH_DRUG_ITEM_ID.新鲜精液:
        slot.state.TCVAR[TCVAR_ID.新鲜精液] = 下药强度;
        break;
    }
    // 評価値補正 (ERB 699-712): scale 体力/気力 回復率 by 評価値 tier.
    const v = evaluatedValue;
    if (v < 400) {
      staminaR = times(staminaR, 0.6);
      willR = times(willR, 0.6);
    } else if (v < 600) {
      staminaR = times(staminaR, 0.8);
      willR = times(willR, 0.8);
    } else if (v < 750) {
      // ×1.0 — no-op.
    } else {
      staminaR = times(staminaR, 1.1);
      willR = times(willR, 1.1);
    }
  }

  // --- 跳蛋 EXP (ERB 722-723) ---
  if (hasTaste(taste, "跳蛋")) {
    slot.state.EXP[EXP_ID.Ｃ経験] = (slot.state.EXP[EXP_ID.Ｃ経験] ?? 0) + 30;
  }

  // --- 満腹度 (ERB 726-729) ---
  if (hasTaste(taste, "丰盛")) manpuku = times(manpuku, 1.2);
  if (hasTaste(taste, "简易")) manpuku = times(manpuku, 0.8);
  riseFullness(state, charaNum, dish.type, manpuku);

  // --- 回復 (ERB 735-743) ---
  recoverPermil(slot, BASE_ID.体力, staminaR);
  recoverPermil(slot, BASE_ID.気力, willR);
  recoverPermil(slot, BASE_ID.精力, energyR);
  if (isMaster) {
    recoverPermil(slot, BASE_ID.TSP, tspR);
  }
  // (non-master TSP recover is DLC-only at ERB 738-739; master TSP at 743.)

  // --- なるべく動かない (ERB 748) ---
  slot.state.TCVAR[TCVAR_ID.なるべく動かない] = 1;

  return evaluatedValue;
}

// ---------------------------------------------------------------------------
// `@COM414_実食(CHARA, EAT_TIME, BONUS)` — per-NPC SOURCE (ERB 161-302)
// ---------------------------------------------------------------------------

/** 従順係数 (ERB 192-206). */
function juujunCoeff(juujun: number): number {
  if (juujun <= 1) return 0;
  if (juujun <= 3) return 1;
  if (juujun <= 5) return 2;
  if (juujun <= 8) return 3;
  if (juujun <= 11) return 4;
  if (juujun <= 14) return 5;
  return 6;
}

/** 好感度係数 (ERB 207-221). */
function favorCoeff(favor: number): number {
  if (favor < 100) return 0;
  if (favor < 500) return 1;
  if (favor < 1000) return 2;
  if (favor < 5000) return 4;
  if (favor < 10000) return 6;
  if (favor < 30000) return 8;
  return 10;
}

/** 評価点係数 (ERB 225-247, non-DLC → else 45 at ≥900). */
function evalPointCoeff(evalValue: number): number {
  if (evalValue < 300) return 0;
  if (evalValue < 400) return 1;
  if (evalValue < 500) return 3;
  if (evalValue < 600) return 12;
  if (evalValue < 650) return 16;
  if (evalValue < 700) return 20;
  if (evalValue < 750) return 24;
  if (evalValue < 800) return 30;
  if (evalValue < 850) return 36;
  if (evalValue < 900) return 40;
  return 45;
}

/**
 * Whether `charaNum` can participate in the meal (ERB 174-187): not
 * 睡眠, not 衰弱, and hungry for the dish type. (COM414_実食's gates.)
 */
export function canEatMeal(
  state: GameState,
  charaNum: number,
  isDessert: boolean,
): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  if (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) return false;
  if (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) return false;
  return isHungryFor(state, charaNum, isDessert);
}

export interface MealSources {
  /** SOURCE map (歓楽/受動/征服?/不潔/反感/露出?). */
  readonly sources: Record<number, number>;
  /** `TFLAG:193` for this eater (1=good / 0=plain / -1=bad). */
  readonly tflag193: number;
}

/**
 * `@COM414_実食` SOURCE assembly (ERB 191-289). **Caller must have already
 * run `eatMeal`** (which sets 評価値 via REVIEW_DISH for non-master) — the
 * ERB calls `吃飯(CHARA)` at line 189 before computing SOURCE. Computes the
 * SOURCE set, applies 大胃王/BONUS ×1.5, runs `@KIGEN_CHANGE` + sets
 * TFLAG:193 by 評価値, and advances the eater's 同行. Mutates `state`.
 *
 * `tflag194` is the special-dish flag (ERB 38-54): 1 = 涮涮锅 (没穿内裤 →
 * 露出 1000). Seed-dish MVP leaves it 0 (the named-dish arms need DISHDATA).
 */
export function computeMealSources(
  state: GameState,
  charaNum: number,
  eatTime: number,
  bonus: boolean,
  tflag194: number,
  rng: DishRng,
): MealSources {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return { sources: {}, tflag193: 0 };
  const dish = getDish(state);
  if (!dish) return { sources: {}, tflag193: 0 };
  const taste = dish.taste;

  const evalValue = slot.state.TCVAR[TCVAR_ID.料理評価値] ?? 0;
  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  const shinmitsu = slot.state.ABL[ABL_ID.親密] ?? 0;
  const sadism = slot.state.ABL[ABL_ID.施虐属性] ?? 0;

  const jCoef = juujunCoeff(juujun);
  const fCoef = favorCoeff(favor);
  const timeCoef = Math.trunc(eatTime / 20); // ERB 223
  const eCoef = evalPointCoeff(evalValue);

  // SOURCE (ERB 256-262) — non-DLC branch (256-257 == DLC branch sans拍照).
  const sources: Record<number, number> = {};
  sources[SOURCE_ID.歓楽] =
    (100 * eCoef + 500 * fCoef + 30 * shinmitsu) * timeCoef;
  sources[SOURCE_ID.受動] =
    (20 * eCoef + 300 * jCoef + 30 * juujun) * timeCoef;
  // 征服 only for DISH_ASSI (ERB 259-260).
  if (dish.assi !== 0 && charaNum === dish.assi) {
    sources[SOURCE_ID.征服] = (10 * eCoef + sadism * 30) * timeCoef;
  }
  // 不潔 / 反感 = 劣化 count * (100 - 評価値/10) * 2 (ERB 261-262).
  const degradation = tasteCount(taste, "劣化");
  const dirty = degradation * (100 - Math.trunc(evalValue / 10)) * 2;
  if (dirty) {
    sources[SOURCE_ID.不潔] = dirty;
    sources[SOURCE_ID.反感] = dirty;
  }
  // 没穿内裤涮涮锅 (ERB 264-265): `TFLAG:194 == 1 && ! EQUIP:CHARA:下半身内衣２`
  // → 露出 1000. The EQUIP test is PER EATER: `@COM414` sets 194=1 when *any*
  // present character is uncovered, so a guest who is wearing theirs eats the
  // hot pot without the 露出 source.
  if (tflag194 === 1 && (slot.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) === 0) {
    sources[SOURCE_ID.露出] = 1000;
  }

  // 大胃王 ×1.5 歓楽 (ERB 267-268) — TALENT not imported → no-op for clean chara.
  // (When wired: if (talent(slot, 大胃王)) sources[歓楽] = times(..., 1.5);)
  // BONUS ×1.5 歓楽/受動/征服 (ERB 269-273).
  if (bonus) {
    sources[SOURCE_ID.歓楽] = times(sources[SOURCE_ID.歓楽]!, 1.5);
    sources[SOURCE_ID.受動] = times(sources[SOURCE_ID.受動]!, 1.5);
    if (sources[SOURCE_ID.征服] !== undefined) {
      sources[SOURCE_ID.征服] = times(sources[SOURCE_ID.征服]!, 1.5);
    }
  }

  // KIGEN_CHANGE + TFLAG:193 by 評価値 (ERB 275-289).
  let tflag193: number;
  const mood = slot.state.TALENT[TALENT_ID.心情] ?? 0;
  if (evalValue >= 750) {
    kigenChange(slot, mood < 0 ? 100 : 50, 1, rng);
    tflag193 = 1;
  } else if (evalValue >= 400) {
    kigenChange(slot, 30, 1, rng);
    tflag193 = 0;
  } else {
    if (mood >= 0) kigenChange(slot, 100, -1, rng);
    tflag193 = -1;
  }

  // 同行 += EAT_TIME (ERB 292-293).
  const doko = slot.state.CFLAG[CFLAG_ID.同行] ?? 0;
  if (doko) slot.state.CFLAG[CFLAG_ID.同行] = doko + eatTime;

  return { sources, tflag193 };
}
