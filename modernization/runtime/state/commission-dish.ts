/**
 * 一般依頼 17/18 — 料理委托的味要求 / 点单 / 味觉评分.
 *
 * Ported from the upstream 依頼 objects (upstream is the oracle here):
 * - `ERB/コマンド関連/COMF/依頼/一般依頼17_あれがたべたい.ERB`
 *   - `@IRAI_一般17_味設定` (:213-427) — the client's vague-memory taste tags.
 *   - `@IRAI_一般17_ジャンル評価` (:433-462) — tag overlap between the
 *     delivered dish and the request.
 *   - `依頼実行時` (:102-189) — 評価基礎 / タグ評価 → ★ grading → 失敗 / 成功 /
 *     大成功(おまけ).
 * - `ERB/コマンド関連/COMF/依頼/一般依頼18_おなかすいた.ERB`
 *   - the point-order draw (:88-160) — 100/200/300 号段, or 400+CHARA when
 *     the client is close enough and can be brought along.
 *   - `依頼実行時` (:184-275) — 評価基礎 * 75% + 一致ボーナス 30.
 *
 * Everything here is deterministic given the seeded RNG handed in by the
 * caller: upstream re-seeds a scratch RNG with `IRAI_SUB` around the taste
 * draw (`一般17.ERB:86-89` `DUMPRAND / RANDOMIZE IRAI_SUB:CHK_SLOT /
 * … / INITRAND`, and the same again in `COMF366 依頼を聞く.ERB:128-132`), so
 * the tags a client asks for never change between the accept dialog and the
 * delivery. `commission.ts` therefore draws once at acceptance and persists
 * the result on the slot.
 */

import type { GameState } from "./game-state.js";
import { ABL_ID } from "./settlement.js";
import { dishesOfType, spDishFor, type DishEntry, type DishType } from "./dish-menu.js";

/** The slice of `RAND` these draws need. */
export interface DishCommissionRng {
  int(max: number): number;
}

// ---------------------------------------------------------------------------
// 一般依頼17 — 味要求 (the "I can't remember the name" taste tags)
// ---------------------------------------------------------------------------

/** `MINTAG` / `MAXTAG` of `@IRAI_一般17_味設定(CHR, MINTAG = 5, MAXTAG = 9)`. */
const MINTAG = 5;
const MAXTAG = 9;

/** 和洋中 — 50% the request carries a cuisine axis. Mutually exclusive. */
const CUISINE_TAGS = ["和食", "洋食", "中華"] as const;

/** 料理ジャンル — 50% a coarse category. Mutually exclusive. */
const GENRE_TAGS = [
  "肉料理", "魚料理", "麺類", "鍋物", "汁物",
  "蛋糕", "派", "下酒菜", "油炸食品", "煮物", "谜料理",
] as const;

/**
 * The `TASTETAG_ORI` pool (`一般17.ERB:273-354`) verbatim, including the
 * untranslated leftovers the author left in place (ジャンキー/サクサク) and
 * the two out-of-band bonus tags (精力/附魔/银吉獣) that the comment at :355
 * says are not meant to be part of the normal draw.
 */
const TASTE_TAG_POOL: readonly string[] = [
  "甜", "咸", "辣", "酸", "简易", "丰盛", "健康", "ジャンキー", "濃厚", "淡白",
  "冷", "温暖", "中立温度",
  "豪華", "上品", "豪快", "家庭的", "機能的", "薬効",
  "米", "豆", "野菜", "葉物", "面包", "乳酪", "卵", "好吃的魚", "果物", "虫肉", "鳥肉", "獣肉",
  "青蛙", "芥末", "牛奶", "香料",
  "甜味料",
  "卷心菜", "草莓", "芜菁", "黄瓜", "番茄", "洋葱", "西瓜", "茄子", "马铃薯", "南瓜", "大麦", "白菜",
  "胡萝卜", "葱",
  "仙桃", "树莓", "山葡萄",
  "黏稠", "滑溜溜", "软绵绵", "サクサク", "软糯的",
  "新鲜", "芸術的", "怪诞", "質素", "野趣",
  "春物", "夏物", "秋物", "冬物",
  "精力", "附魔", "银吉獣",
];

/**
 * Per-client tag exclusions (`一般17.ERB:370-390`). The author's rule is
 * "only Lv10-class dislikes are force-removed", and these four groups are
 * exactly the ones he listed.
 */
const TASTE_TAG_EXCLUSIONS: Readonly<Record<number, readonly string[]>> = {
  28: ["鳥肉", "卵"],   // ミスティア
  129: ["鳥肉", "卵"],  // 久侘歌
  27: ["虫肉"],         // リグル
  118: ["虫肉"],        // ラルバ
  33: ["青蛙"],         // 諏訪子
  93: ["魚", "好吃的魚"], // わかさぎ姫
};

/**
 * `@IRAI_一般17_味設定(CHR)` (`一般17.ERB:213-427`).
 *
 * Faithful points:
 * - cuisine / genre are each 50% and mutually exclusive;
 * - 好吃的魚 becomes 魚 2/3 of the time (`:358-360`);
 * - 5..9 tags are drawn **without replacement**;
 * - a 10% roll appends 縁起物 / 过季 (`:414-421`);
 * - the result carries no trailing slash (`:423-425`).
 *
 * Deviation (distribution-equivalent, documented): upstream draws an index
 * into the whole split array and re-rolls on empty slots
 * (`:404-412`); filtering the pool and splicing is the same uniform draw over
 * the remaining tags without the rejection loop.
 */
export function generateTasteRequest(
  clientId: number,
  rng: DishCommissionRng,
): string {
  let taste = "";
  if (rng.int(2) === 1) taste += `${CUISINE_TAGS[rng.int(CUISINE_TAGS.length)]}/`;
  if (rng.int(2) === 1) taste += `${GENRE_TAGS[rng.int(GENRE_TAGS.length)]}/`;

  let pool = [...TASTE_TAG_POOL];
  if (pool.includes("好吃的魚") && rng.int(3) !== 0) {
    pool = pool.filter((tag) => tag !== "好吃的魚");
    pool.push("魚");
  }
  const excluded = TASTE_TAG_EXCLUSIONS[clientId];
  if (excluded) pool = pool.filter((tag) => !excluded.includes(tag));

  let count = MINTAG + rng.int(MAXTAG - MINTAG + 1);
  while (count > 0 && pool.length > 0) {
    const index = rng.int(pool.length);
    taste += `${pool[index]}/`;
    pool.splice(index, 1);
    count -= 1;
  }

  if (rng.int(10) === 0) taste += rng.int(3) === 0 ? "縁起物/" : "过季/";

  return taste.endsWith("/") ? taste.slice(0, -1) : taste;
}

/**
 * `@IRAI_一般17_ジャンル評価(料理味, 要求味)` (`一般17.ERB:433-462`): count how
 * many requested tags the dish actually carries, consuming one dish
 * occurrence per hit (so `料理味=甜/甜/…` + `要求味=甜/…` scores 1, not 2).
 */
export function tasteRequestMatchCount(dishTaste: string, tasteRequest: string): number {
  const dishTags = dishTaste.split("/").filter(Boolean);
  let score = 0;
  for (const tag of tasteRequest.split("/").filter(Boolean)) {
    const index = dishTags.indexOf(tag);
    if (index >= 0) {
      dishTags.splice(index, 1);
      score += 1;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// 一般依頼18 — 点单 (the ordered dish)
// ---------------------------------------------------------------------------

/** `一般18.ERB:81` `ユニーク閾値 = 5` — 親密 needed to sell a unique dish. */
const UNIQUE_DISH_AFFINITY = 5;

/** A `DISH_REQUEST` (upstream `REQUEST_DISHNAME:CHARA:0` = name + `/` + no). */
export interface DishRequest {
  /** DISH_NUM. */
  no: number;
  name: string;
  /** 400+CHARA unique dish — upstream prints 「这是XX的拿手菜来着？」. */
  isSp: boolean;
}

function pickGenericDish(rng: DishCommissionRng): DishEntry | undefined {
  // RAND:3 * 100 + 100 → 100 (軽食) / 200 (主食) / 300 (甜点); the draw is
  // `RAND(base, base+101)`, and the two boundary numbers carry no DISHDATA
  // row upstream (its DO/LOOP simply re-rolls on an empty name), so taking
  // the type's real rows is the same distribution without the retry loop.
  const type = (["軽食", "主食", "甜点"] as const)[rng.int(3)] as DishType;
  const candidates = dishesOfType(type).filter((d) => d.no >= 100 && d.no < 400);
  if (candidates.length === 0) return undefined;
  return candidates[rng.int(candidates.length)];
}

/**
 * `一般18.ERB:88-160` — the dish the client orders.
 *
 * `ABL:親密 >= 5 && COM_351_CONDITION && RAND:4 == 0` promotes the draw to
 * `400 + CHARA` (that client's 固有料理); upstream does not check whether the
 * unique row exists, but its re-roll loop on an empty `DISH_NAME` makes the
 * effective behaviour a fall back to the generic draw, which is what this
 * does. `canBring` is injected so this module stays free of the commission
 * state machine.
 */
export function pickDishRequest(
  clientId: number,
  affinity: number,
  canBring: boolean,
  rng: DishCommissionRng,
): DishRequest | undefined {
  if (
    affinity >= UNIQUE_DISH_AFFINITY &&
    canBring &&
    rng.int(4) === 0
  ) {
    const sp = spDishFor(clientId);
    if (sp) return { no: sp.no, name: sp.name, isSp: true };
  }
  const generic = pickGenericDish(rng);
  return generic ? { no: generic.no, name: generic.name, isSp: false } : undefined;
}

/** `親密` of a client — the only ABL the dish order reads. */
export function dishOrderAffinity(state: Readonly<GameState>, clientId: number): number {
  return state.charas[clientId]?.state.ABL[ABL_ID.親密] ?? 0;
}

// ---------------------------------------------------------------------------
// 味觉评分 (both 17 and 18)
// ---------------------------------------------------------------------------

/** `評価基準 = 50, 75` (`一般17.ERB:76` / `一般18.ERB:79`): <50 失敗, <75 成功. */
export const DISH_RATING_FAIL = 50;
export const DISH_RATING_GREAT = 75;

/** `タグ一致加点 = 10` (`一般17.ERB:77`). */
const TAG_MATCH_POINTS = 10;
/** `基礎補正 = 50` (`一般17.ERB:78`) / `評価点補正 = 75` (`一般18.ERB:78`). */
const BASE_RATE_17 = 50;
const BASE_RATE_18 = 75;
/** `一致ボーナス = 30` (`一般18.ERB:80`). */
const ORDER_MATCH_POINTS = 30;

export type DishCommissionOutcome = "failed" | "success" | "great";

export interface DishCommissionScore {
  /** 評価基礎 — dish quality, rate-corrected. */
  base: number;
  /** タグ評価 (17) / 一致評価 (18). */
  extra: number;
  /** base + extra, the value compared against the thresholds. */
  total: number;
  outcome: DishCommissionOutcome;
  /** 大成功 → the client adds a bonus at report time (おまけ). */
  bonus: boolean;
}

/**
 * `一般17.ERB:120-189` / `一般18.ERB:206-275`.
 *
 * `evaluated` is `TCVAR:料理評価値` as written by `reviewDish` (0-999).
 *
 * The 17 branch also carries the author's star-alignment fixup
 * (`:125-131`): the remainder below the tens place is pushed into タグ評価 so
 * both star rows land on a multiple of 10. 18 has no such fixup upstream.
 */
export function scoreDishCommission(opts: {
  localId: 17 | 18;
  evaluated: number;
  dishTaste: string;
  tasteRequest?: string;
  dishRequest?: DishRequest;
  deliveredName: string;
}): DishCommissionScore {
  const is17 = opts.localId === 17;
  let base = Math.trunc((opts.evaluated * (is17 ? BASE_RATE_17 : BASE_RATE_18)) / 100 / 10);
  let extra: number;
  if (is17) {
    extra = tasteRequestMatchCount(opts.dishTaste, opts.tasteRequest ?? "") * TAG_MATCH_POINTS;
    const rest = base % 10;
    if (rest < 5) {
      extra += rest;
      base -= rest;
    } else {
      extra -= 10 - rest;
      base += 10 - rest;
    }
  } else {
    // `STRCOUNT(DISH_DELIVER, DISH_REQUEST) > 0` — the upstream check is a
    // substring test on the delivered name, not equality.
    const ordered = opts.dishRequest?.name ?? "";
    extra = ordered !== "" && opts.deliveredName.includes(ordered) ? ORDER_MATCH_POINTS : 0;
  }

  const total = base + extra;
  const outcome: DishCommissionOutcome =
    total < DISH_RATING_FAIL ? "failed"
      : total < DISH_RATING_GREAT ? "success"
        : "great";
  return { base, extra, total, outcome, bonus: outcome === "great" };
}

/**
 * The two star rows upstream prints in colour (`一般17.ERB:134-141`:
 * yellow `%"★" * (評価基礎 / 10)%` then red `%"★" * (タグ評価 / 10)%`). The text
 * log has no colour, so each row is rendered as a fixed 10-slot ★/☆ bar and
 * the tag row is appended in parentheses.
 */
export function dishScoreStars(base: number, extra: number): string {
  const row = (value: number): string => {
    const filled = Math.max(0, Math.min(10, Math.trunc(value / 10)));
    return `${"★".repeat(filled)}${"☆".repeat(10 - filled)}`;
  };
  return extra > 0 ? `${row(base)}（要求契合 ${row(extra)}）` : row(base);
}
