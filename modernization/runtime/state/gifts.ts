/**
 * 礼物 (贈り物) engine — catalog seam, REVIEW_GIFT scoring, gift records,
 * shop draw (CREATE_GIFT) and the nightly favorite flow (GIFT_FAVORITE).
 *
 * Faithfulness anchors (ERB/イベント関連/贈り物関連/贈り物.ERB):
 *  - `@CREATE_GIFT(AREA)` (line 7): random 本体 (`category*10+rand10`, retry
 *    until the id exists AND its sellArea bit matches) + random 形容詞
 *    (`category*100+rand100`, same retry); price = BASIC × MAGNIF / 100.
 *  - `@REVIEW_GIFT` (line 142): gift sense = adjective sense + main sense
 *    (+ 高級/ when list price ≥10000, 安物/ when <1500); chara likes/dislikes
 *    from キャラデータ 感性 plus the common adjustments (幼稚→角色, 妖精→自然,
 *    付喪神→付喪神/道具, 妖怪→妖怪, 戦闘能力→符卡, 大炮弹 universal, 跳蛋 by
 *    炮友/愛欲, 粗悪 universally hated ×6, 巫術/妖術/骨/血/毒 race rules,
 *    酒耐性 rules); score = min(good×1000/(good+bad), 999) with
 *    good = 300 + 100×Σ(like-weight × gift-tag-count), bad likewise.
 *    (STR_MULTI_COUNT counts every like-substring occurrence in the gift
 *    string — weight × count, transcribed exactly.)
 *  - Purchase bookkeeping (COMF626:139-163 / 贈り物.ERB:1322-1350): 貰った回数
 *    = prior count + 1; record {回数,得点,日期,場所,形容詞,本体}; recipient's
 *    礼物保管库 = the new record; TCVAR:今天的礼物 both sides; MASTER
 *    送出的礼物 = 渡した回数*1000+chara; CFLAG:每日礼物 latch.
 *  - `@GIFT_FAVORITE` (line 303, night flow): per chara gifted today —
 *    score ≥700: keeps it close, becomes favorite when ≥ current favorite's
 *    score; 400..699: stored; <400: pawned (礼物保管库 keeps the record
 *    regardless — upstream only sets 获得的礼物 in the ≥700 branch).
 *
 * The upstream GIFT_ID packed integer exceeds JS safe range; the modern
 * stores the identical six fields as a struct (`GiftRecord`).
 */

import type { GameState } from "./game-state.js";
import { ABL_ID, CFLAG_ID, TALENT_ID } from "./settlement.js";
import { charaDataOf } from "./chara-data.js";
import { localizeGiftDisplayName } from "./gift-name.js";

// ---------------------------------------------------------------------------
// Catalog seam
// ---------------------------------------------------------------------------

export interface GiftCatalogItem {
  id: number;
  name: string;
  /** 本体: base price yen. 形容詞: price multiplier percent. */
  price: number;
  sense: string;
  sellArea: number;
}

export interface GiftCatalog {
  mains: Record<string, GiftCatalogItem>;
  adjects: Record<string, GiftCatalogItem>;
}

let catalog: GiftCatalog = { mains: {}, adjects: {} };

/** Inject the built gift catalog (from `gift-catalog.bundle.json`). */
export function setGiftCatalog(c: GiftCatalog | null | undefined): void {
  catalog = c ?? { mains: {}, adjects: {} };
}

export function giftCatalogLoaded(): boolean {
  return Object.keys(catalog.mains).length > 0;
}

/**
 * Keep player-facing gift names localized even when a stale/imported catalog
 * still contains the upstream Japanese atom. The generated catalog is also
 * localized, but this boundary prevents a cached bundle from leaking Japanese
 * into the purchase prompt or gift history.
 */
const displayGiftAtom = localizeGiftDisplayName;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** The six GET_GIFTDATA fields as a struct (packed-int equivalent). */
export interface GiftRecord {
  /** 回数 — 1-based receive counter. */
  count: number;
  /** 得点 — REVIEW_GIFT score at purchase (0..999). */
  score: number;
  /** 日期 — dayIndex received. */
  day: number;
  /** 場所 — area id bought at (99 = order-made/direct). */
  area: number;
  /** 形容詞 id. */
  adject: number;
  /** 本体 id. */
  main: number;
  /** Rendered name (adjective + main), stored for display stability. */
  name: string;
}

export interface CharaGiftState {
  /** GIFT_GOT — ordered receive history (upstream ring of 100; we keep all). */
  records: GiftRecord[];
  /** GIFT_GAVE — the reverse direction: gifts this chara handed the master,
   *  written by `@GIFT_DATE_EVENT` (see `world/date-gift.ts`). Empty for the
   *  shop, which only ever fills `records`. */
  given?: GiftRecord[];
  /** CFLAG:获得的礼物 — index into records of the favorite (夜 GIFT_FAVORITE). */
  favoriteIdx?: number;
  /** CFLAG:礼物保管库 — index of the latest received record. */
  latestIdx?: number;
  /** TCVAR:今天的礼物 — index of today's gift; cleared by the night flow. */
  todayIdx?: number;
}

export function giftStateOf(state: GameState, charaNum: number): CharaGiftState {
  state.gifts ??= {};
  return (state.gifts[charaNum] ??= { records: [] });
}

// ---------------------------------------------------------------------------
// REVIEW_GIFT
// ---------------------------------------------------------------------------

/** Count of every occurrence of every like-tag inside the gift sense string
 *  (upstream STR_MULTI_COUNT: Σ over like-tags of STRCOUNT(gift, tag)). */
function multiCount(charaTags: string, giftSense: string): number {
  let total = 0;
  for (const piece of charaTags.split("/")) {
    const tag = piece.trim();
    if (!tag) continue;
    // Duplicates in the chara list are NOT deduped — each list entry counts
    // its own occurrences in the gift string (weight × count, upstream-exact).
    let idx = 0;
    while (true) {
      const at = giftSense.indexOf(tag, idx);
      if (at < 0) break;
      total++;
      idx = at + tag.length;
    }
  }
  return total;
}

function checkRace(state: GameState, charaNum: number, raceId: number, value?: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  const v = slot?.state.TALENT[raceId] ?? 0;
  return value === undefined ? v !== 0 : v === value;
}

export interface GiftReview {
  score: number;
  giftSense: string;
}

/**
 * `@REVIEW_GIFT(chara, adjectId, mainId)` — score a gift for a chara.
 * `listPrice` = BASIC × MAGNIF / 100 (the 高級/安物 threshold input).
 */
export function reviewGift(
  state: GameState,
  charaNum: number,
  adjectId: number,
  mainId: number,
): GiftReview {
  const adj = catalog.adjects[String(adjectId)];
  const main = catalog.mains[String(mainId)];
  let giftSense = (adj?.sense ?? "") + (main?.sense ?? "");
  const listPrice = Math.trunc(((main?.price ?? 0) * (adj?.price ?? 100)) / 100);
  if (listPrice >= 10000) giftSense += "高級/";
  else if (listPrice < 1500) giftSense += "安物/";

  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  const data = charaDataOf(charaNum);
  let good = data?.senseLike ?? "";
  let bad = data?.senseDislike ?? "";
  const t = (id: number) => slot?.state.TALENT[id] ?? 0;

  // 共通設定：好き
  if (t(TALENT_ID.幼稚)) good += "角色/".repeat(3);
  if (checkRace(state, charaNum, 192)) good += "自然/".repeat(3); // 妖精
  if (checkRace(state, charaNum, 195)) good += "付喪神/道具/".repeat(3); // 付喪神
  if (checkRace(state, charaNum, 191)) good += "妖怪/".repeat(3); // 妖怪
  if ((slot?.state.ABL[ABL_ID.战斗能力] ?? 0) > 0) good += "符卡/".repeat(3);
  good += "大炮弹/";
  if (t(TALENT_ID.炮友) || t(TALENT_ID.愛欲)) good += "跳蛋/";

  // 共通設定：嫌い
  bad += "粗悪/".repeat(6);
  const likesTag = (tag: string) => good.includes(tag);
  if (charaNum !== 0) {
    if ((checkRace(state, charaNum, 191) || checkRace(state, charaNum, 194)) && !likesTag("巫術/")) {
      bad += "巫術/".repeat(3);
      if (!likesTag("法具/")) bad += "法具/".repeat(3);
    }
    if ((!checkRace(state, charaNum, 191) && !likesTag("妖術/")) || likesTag("巫術/")) {
      bad += "妖術/".repeat(3);
      if (!likesTag("骨/")) bad += "骨/".repeat(3);
      if (!likesTag("血/")) bad += "血/".repeat(3);
      if (!likesTag("毒/")) bad += "毒/".repeat(3);
    }
  }
  const alcohol = t(TALENT_ID.酒耐性);
  if (alcohol < -1) bad += "酒/".repeat(3);
  else if (alcohol < 0) bad += "酒/";
  if (charaNum !== 0 && (slot?.state.ABL[ABL_ID.战斗能力] ?? 0) <= 0) bad += "符卡/";
  if (!t(TALENT_ID.炮友) && !t(TALENT_ID.愛欲)) {
    const desire = slot?.state.ABL[ABL_ID.欲望] ?? 0;
    if (t(TALENT_ID.恋人) && desire > 20) {
      // no penalty (高欲望恋人)
    } else if (t(TALENT_ID.恋人)) bad += "跳蛋/".repeat(2);
    else if (t(TALENT_ID.恋慕)) bad += "跳蛋/".repeat(3);
    else bad += "跳蛋/".repeat(6);
  }

  const goodScore = 300 + 100 * multiCount(good, giftSense);
  // 祭日補正 (×1.25 on good) — festival system not modeled; gate false.
  const badScore = 300 + 100 * multiCount(bad, giftSense);
  const score = Math.min(Math.trunc((goodScore * 1000) / (goodScore + badScore)), 999);
  return { score, giftSense };
}

// ---------------------------------------------------------------------------
// CREATE_GIFT — shop draw
// ---------------------------------------------------------------------------

export interface DrawnGift {
  adjectId: number;
  mainId: number;
  name: string;
  price: number;
}

/**
 * `@CREATE_GIFT(AREA)` — draw a random gift available in `areaBit`
 * (bit index into the AREA_SETBIT mask; pass null for the 全域 draw,
 * upstream AREA 99 / 市場の神). `rng()` ∈ [0,1).
 */
export function createGift(rng: () => number, areaBit: number | null): DrawnGift | null {
  if (!giftCatalogLoaded()) return null;
  const areaOk = (item: GiftCatalogItem) =>
    areaBit === null || (item.sellArea & (1 << areaBit)) !== 0;

  const draw = (
    table: Record<string, GiftCatalogItem>,
    make: () => number,
  ): GiftCatalogItem | null => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const item = table[String(make())];
      if (item && areaOk(item)) return item;
    }
    return null;
  };

  const main = draw(catalog.mains, () => (Math.trunc(rng() * 52) + 1) * 10 + Math.trunc(rng() * 10));
  if (!main) return null;
  const adj = draw(catalog.adjects, () => (Math.trunc(rng() * 21) + 1) * 100 + Math.trunc(rng() * 100));
  if (!adj) return null;

  return {
    adjectId: adj.id,
    mainId: main.id,
    name: `${displayGiftAtom(adj.name)}${displayGiftAtom(main.name)}`,
    price: Math.trunc((main.price * adj.price) / 100),
  };
}

// ---------------------------------------------------------------------------
// Purchase bookkeeping
// ---------------------------------------------------------------------------

/**
 * Record a purchased gift for `charaNum` (COMF626:139-163 bookkeeping).
 * Returns the new record. Caller handles MONEY and SOURCE settlement.
 */
export function recordGiftPurchase(
  state: GameState,
  charaNum: number,
  gift: DrawnGift,
  score: number,
  areaId: number,
): GiftRecord {
  const gs = giftStateOf(state, charaNum);
  const record: GiftRecord = {
    count: gs.records.length + 1,
    score,
    day: state.time.dayIndex,
    area: areaId,
    adject: gift.adjectId,
    main: gift.mainId,
    name: gift.name,
  };
  gs.records.push(record);
  gs.latestIdx = gs.records.length - 1;
  gs.todayIdx = gs.records.length - 1;
  const slot = state.charas[charaNum];
  if (slot) {
    slot.state.CFLAG[CFLAG_ID.每日礼物] = 1;
    // CFLAG:礼物保管库/获得的礼物 live as gs indexes; the CFLAG mirror keeps
    // the "has any" boolean visible to legacy-style gates.
    slot.state.CFLAG[CFLAG_ID.礼物保管库] = record.count;
  }
  state.master.state.CFLAG[CFLAG_ID.送出的礼物] =
    (Math.trunc((state.master.state.CFLAG[CFLAG_ID.送出的礼物] ?? 0) / 1000) + 1) * 1000 + charaNum;
  return record;
}

// ---------------------------------------------------------------------------
// GIFT_FAVORITE — night flow
// ---------------------------------------------------------------------------

export interface GiftFavoriteEvent {
  charaNum: number;
  giftName: string;
  score: number;
  /** "cherish" ≥700 / "store" 400..699 / "pawn" <400. */
  disposition: "cherish" | "store" | "pawn";
  becameFavorite: boolean;
  /** Narration line (upstream PRINTFORMW prose, sense-branched). */
  text: string;
}

function dispositionText(callName: string, giftName: string, sense: string, disposition: GiftFavoriteEvent["disposition"]): string {
  if (disposition === "cherish") {
    if (sense.includes("握住/")) return `${callName}珍重地握着你赠送的${giftName}、就这么睡着了……`;
    if (sense.includes("抱住/")) return `${callName}想起你赠送的${giftName}、抱着它睡着了……`;
    if (sense.includes("穿戴/")) return `${callName}试着穿上了你赠送的${giftName}、镜子前的自己被羞涩染红了脸……`;
    return `${callName}入迷地看着你赠送的${giftName}、就这么睡着了……`;
  }
  if (disposition === "store") {
    if (sense.includes("握住/")) return `${callName}把你赠送的${giftName}放到了架子上……`;
    if (sense.includes("抱住/")) return `${callName}把你赠送的${giftName}放到了桌子上……`;
    if (sense.includes("穿戴/")) return `${callName}把你赠送的${giftName}收进了衣柜……`;
    return `${callName}把你赠送的${giftName}暂时保管起来……`;
  }
  return `${callName}偷偷把你赠送的${giftName}拿去典当了……`;
}

/** `@GIFT_FAVORITE` — run at night for every chara gifted today. */
export function runGiftFavorite(state: GameState): GiftFavoriteEvent[] {
  const out: GiftFavoriteEvent[] = [];
  if (!state.gifts) return out;
  for (const [numStr, gs] of Object.entries(state.gifts)) {
    const charaNum = Number(numStr);
    if (gs.todayIdx === undefined) continue;
    const record = gs.records[gs.todayIdx];
    gs.todayIdx = undefined;
    if (!record) continue;
    const slot = state.charas[charaNum];
    const callName = slot?.callName ?? `#${charaNum}`;
    const adj = catalog.adjects[String(record.adject)];
    const main = catalog.mains[String(record.main)];
    const sense = (adj?.sense ?? "") + (main?.sense ?? "");

    let disposition: GiftFavoriteEvent["disposition"];
    let becameFavorite = false;
    if (record.score >= 700) {
      disposition = "cherish";
      const currentFav = gs.favoriteIdx !== undefined ? gs.records[gs.favoriteIdx] : undefined;
      if (record.score >= (currentFav?.score ?? 0)) {
        gs.favoriteIdx = gs.records.indexOf(record);
        becameFavorite = true;
        if (slot) slot.state.CFLAG[CFLAG_ID.获得的礼物] = record.count;
      }
    } else if (record.score >= 400) {
      disposition = "store";
    } else {
      disposition = "pawn";
    }
    out.push({
      charaNum,
      giftName: record.name,
      score: record.score,
      disposition,
      becameFavorite,
      text: dispositionText(callName, record.name, sense, disposition),
    });
    // 每日礼物 latch clears with the day (TCVAR is day-scoped upstream).
    if (slot) slot.state.CFLAG[CFLAG_ID.每日礼物] = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAGE 3 display
// ---------------------------------------------------------------------------

export interface GiftHistoryRow {
  name: string;
  score: number;
  day: number;
  count: number;
  favorite: boolean;
  /** 99 = 特别定制 (order-made / direct). */
  orderMade: boolean;
}

/** `PRINT_STATE_GIFTDATA_TR(chara, 15)` — favorite first, then latest N. */
export function buildGiftHistory(state: GameState, charaNum: number, maxRows = 15): GiftHistoryRow[] {
  const gs = state.gifts?.[charaNum];
  if (!gs || gs.records.length === 0) return [];
  const rows: GiftHistoryRow[] = [];
  const fav = gs.favoriteIdx !== undefined ? gs.records[gs.favoriteIdx] : undefined;
  const toRow = (r: GiftRecord): GiftHistoryRow => ({
    name: r.name,
    score: r.score,
    day: r.day,
    count: r.count,
    favorite: r === fav,
    orderMade: r.area === 99,
  });
  if (fav) rows.push(toRow(fav));
  const latest = gs.records.slice(-maxRows).reverse();
  for (const r of latest) {
    if (r === fav) continue;
    rows.push(toRow(r));
    if (rows.length >= maxRows) break;
  }
  return rows;
}
