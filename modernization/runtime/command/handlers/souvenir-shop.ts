/**
 * COMF626 土産屋 — buy a gift for TARGET at a gift-shop location.
 *
 * Modern equivalent of `@COM626` (`ERB/コマンド関連/COMF/外出系/COMF626 土産屋.ERB`)
 * — the acquisition mechanism behind GIFT_GOT / PAGE 3 礼物历史.
 *
 * Faithful pieces:
 *  - `@COM_ABLE626`: gift-shop location + TARGET present + not already gifted
 *    today (`CFLAG:每日礼物`) + not sleeping + not 時間停止.
 *  - `@GIFT_SHOP(位置)` location arms mapped to the BUILT maps:
 *      2 境内→神社:境内 / 102 →命蓮寺:境内 / 219 集会所→人間之里:集会所 /
 *      343 湖畔→霧之湖:湖畔 / 403 待合室→永遠亭:待合室 / 502 香霖堂 /
 *      601 彼岸 / 702 山道 / 811 守矢神社 / 931 旧都 / 1003 玉兎街.
 *      The still-unbuilt 1106 arm remains unavailable.
 *  - Inventory: 10 gifts drawn via `CREATE_GIFT(area)` filtered by the
 *    area's sell bit; each shows the REVIEW_GIFT score for TARGET + price.
 *  - Purchase (ERB 139-163): MONEY−=price; record into GIFT_GOT
 *    (recordGiftPurchase); TFLAG:193 = score/100 drives the SOURCE assembly
 *    `歓楽 = 800+1500*k+800*好感度係数` / `受動 = 600+1500*k+800*ABL:従順` /
 *    `征服 = 600+800*k+1500*ABL:施虐属性`, 恋人 ⇒ 歓楽×2; TIME += 10.
 *  - Cancel (ERB 94-98): window-shopping 歓楽 = 500+300*好感度係数.
 *
 * Deviations (documented, mechanism-preserving):
 *  - The 10-item list is drawn from a per-(day,tick,location) deterministic
 *    seed instead of live RNG so the B9 prompt and the settling handler see
 *    the SAME list (the modern prompt layer is a pure function of state).
 *    The [99] reload option is subsumed — the list re-rolls whenever game
 *    time advances. 大甩卖/市場の神 flags unmodeled (gates false).
 *  - [100] 定制礼物 (GIFT_ORDER_MADE_FROM_MASTER, a two-stage picker over
 *    187×593 catalog entries) is deferred; the drawn-inventory path is the
 *    faithful acquisition loop.
 *  - 祭日補正 (FESTIVAL) unmodeled — no festival system yet.
 */

import type { GameState } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { canAfford, pay } from "../../state/money.js";
import {
  ABL_ID,
  CFLAG_ID,
  EVENT_FLAG_ALIASES as EVENT_FLAGS,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
  times,
} from "../../state/settlement.js";
import { souvenirSaleDiscount } from "../../state/shop.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { createGift, recordGiftPurchase, reviewGift, type DrawnGift } from "../../state/gifts.js";
import { RINNOSUKE_HOME, RINNOSUKE_ROLE } from "../../world/dynamic-characters.js";

/** Gift-shop locations on the built maps → AREA_SETBIT bit index. */
const GIFT_SHOP_AREAS: Readonly<Record<string, { areaBit: number; areaId: number }>> = {
  "神社:境内": { areaBit: 0, areaId: 0 },
  "命蓮寺:境内": { areaBit: 1, areaId: 1 },
  "人間之里:集会所": { areaBit: 2, areaId: 2 },
  "霧之湖:湖畔": { areaBit: 3, areaId: 3 },
  "永遠亭:待合室": { areaBit: 4, areaId: 4 },
  "魔法之森:香霖堂": { areaBit: 5, areaId: 5 },
  "彼岸": { areaBit: 6, areaId: 6 },
  "妖怪之山・山麓:山道・通往沼澤之道": { areaBit: 7, areaId: 7 },
  "守矢神社:境内": { areaBit: 8, areaId: 8 },
  "旧都:大街": { areaBit: 9, areaId: 9 },
  "月之世界:玉兎街": { areaBit: 10, areaId: 10 },
};

export function giftShopAt(location: string): { areaBit: number; areaId: number } | null {
  return GIFT_SHOP_AREAS[location] ?? null;
}

/** `@好感度係数` (COMF626.ERB:298) — favor tier 0..6. */
export function favorCoefficient(favor: number): number {
  if (favor < 100) return 0;
  if (favor < 500) return 1;
  if (favor < 1000) return 2;
  if (favor < 5000) return 3;
  if (favor < 10000) return 4;
  if (favor < 30000) return 5;
  return 6;
}

/** splitmix32 — deterministic per-(day,tick,location) inventory seed. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z ^= z >>> 15;
    return (z >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const SHELF_SIZE = 10; // 品揃え上限 (non-市場の神).

/** Draw today's shelf — same list for prompt + handler (state-derived seed). */
export function drawShelf(state: GameState): DrawnGift[] {
  const shop = giftShopAt(state.master.location);
  if (!shop) return [];
  if ((state.flagStore[EVENT_FLAGS.marketGod] ?? 0) === 10 && state.marketGifts?.length) {
    return state.marketGifts.map((gift) => ({ ...gift }));
  }
  const seed =
    (state.time.dayIndex * 131071 + state.time.tickValue * 197 + hashString(state.master.location)) >>> 0;
  const rng = splitmix32(seed);
  const out: DrawnGift[] = [];
  for (let i = 0; i < SHELF_SIZE; i++) {
    const gift = createGift(rng, shop.areaBit);
    if (!gift) break;
    out.push(gift);
  }
  return out;
}

/** Festival/day-event price adjustment shared by the pure prompt and settlement. */
export function effectiveGiftPrice(state: Readonly<GameState>, gift: Readonly<DrawnGift>): number {
  return Math.max(0, Math.trunc(gift.price * (100 - souvenirSaleDiscount(state)) / 100));
}

function check626(state: GameState, target: number):
  | { ok: true }
  | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (!giftShopAt(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有土产屋。" } };
  }
  const tSlot = target >= 1 ? state.charas[target] : undefined;
  if (!tSlot) {
    return { ok: false, reason: { kind: "precondition", message: "没有赠送礼物的对象。" } };
  }
  const targetMeta = state.dynamicCharacters?.[target];
  if (
    targetMeta?.origin === "authored" &&
    targetMeta.role === RINNOSUKE_ROLE &&
    tSlot.location === RINNOSUKE_HOME &&
    state.master.location === RINNOSUKE_HOME
  ) {
    return {
      ok: false,
      reason: {
        kind: "precondition",
        message: "霖之助是店家，不能把在香霖堂购买的土产送给他。",
      },
    };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.每日礼物] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "今天已经送过礼物了。" } };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

function buildPrompt(ctx: CommandContext): PromptSpec | null {
  const state = ctx.state;
  const target = ctx.target;
  const shelf = drawShelf(state);
  if (shelf.length === 0) return null;
  const tSlot = state.charas[target];
  const name = tSlot?.callName ?? "对方";
  const options = shelf.map((g, i) => {
    const review = reviewGift(state, target, g.adjectId, g.mainId);
    const price = effectiveGiftPrice(state, g);
    return {
      id: i,
      label: g.name,
      detail: `评价 ${review.score} / 价格 ${price} 円`,
      disabled: !canAfford(state, price),
    };
  });
  options.push({ id: -1, label: "只是看看（取消）", detail: "", disabled: false });
  return pickOne(`要给${name}买点什么好呢……`, options);
}

export const souvenirShop626HandlerEntry: HandlerEntry = {
  commandNo: 626,
  displayCheck: (ctx) => ({
    shown: true,
    ...(giftShopAt(ctx.state.master.location)?.areaId === 5
      ? { labelOverride: "香霖堂" }
      : {}),
  }),
  execCheck: (ctx) => check626(ctx.state, ctx.target),
  prompt: buildPrompt,
  handler: (ctx) => {
    const spec = buildPrompt(ctx);
    if (!spec) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "货架上空空如也。" }],
        outcome: "noop" as const,
      };
    }
    const choice = requirePickOne(spec, ctx.promptAnswer);
    if (choice === null) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "还没有选好要买的礼物。" }],
        outcome: "blocked" as const,
      };
    }

    const next = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target]!;
    const favor = tSlot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
    const favorK = favorCoefficient(favor);

    // 取消 — window-shopping 歓楽 (ERB 94-98).
    if (choice === -1) {
      const sources: Record<number, number> = {
        [SOURCE_ID.歓楽]: 500 + 300 * favorK,
      };
      const settled = applySourceCheck(next, target, sources, 0);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "随便看了看橱窗里的商品。" },
          ...settled.events,
        ],
        outcome: "ok" as const,
      };
    }

    const shelf = drawShelf(ctx.state);
    const gift = shelf[Number(choice)];
    const price = gift ? effectiveGiftPrice(next, gift) : 0;
    if (!gift || !canAfford(next, price)) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "钱不够……" }],
        outcome: "noop" as const,
      };
    }

    // 購入 (ERB 134-163).
    pay(next, price);
    const review = reviewGift(next, target, gift.adjectId, gift.mainId);
    const shop = giftShopAt(next.master.location)!;
    recordGiftPurchase(next, target, gift, review.score, shop.areaId);

    // SOURCE assembly (ERB 167-182). TFLAG:193 = score/100.
    const k = Math.trunc(review.score / 100);
    const sources: Record<number, number> = {
      [SOURCE_ID.歓楽]: 800 + 1500 * k + 800 * favorK,
      [SOURCE_ID.受動]: 600 + 1500 * k + 800 * (tSlot.state.ABL[ABL_ID.従順] ?? 0),
      [SOURCE_ID.征服]: 600 + 800 * k + 1500 * (tSlot.state.ABL[ABL_ID.施虐属性] ?? 0),
    };
    if (tSlot.state.TALENT[TALENT_ID.恋人]) {
      sources[SOURCE_ID.歓楽] = times(sources[SOURCE_ID.歓楽]!, 2.0);
    }

    // TIME += 10 (ERB 207, リロード数 0 in the modern single-shot flow).
    advanceTimeTicks(next, 10);

    const settled = applySourceCheck(next, target, sources, 0);
    const name = tSlot.callName ?? `#${target}`;
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `买下【${gift.name}】(${price}円) 送给了${name}。（对方评价 ${review.score}）`,
        },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};
