/**
 * `@GIFT_DATE_EVENT` / `CREATE_GIFT_FROM_CHARA` — the post-date gift a partner
 * hands the player on the way home.
 *
 * Upstream (ERB/イベント関連/贈り物関連/贈り物.ERB:728-780):
 *
 *   CALL CREATE_GIFT_FROM_CHARA(CHARA, 701, 1000)
 *   IF RESULT == -1
 *       CALL KOJO_MESSAGE_SEND("SP_EVENT",3,CHARA,0)
 *       RETURN
 *   ENDIF
 *   GIFT_ID = 渡した回数 * 1e16 + 点数 * 1e13 + DAY * 1e9 + 约会中 * 1e7 + GIFT_ID
 *   GIFT_GAVE:CHARA:(渡した回数 % 100) = GIFT_ID
 *   CFLAG:CHARA:送出的礼物 = GIFT_ID
 *
 * `CREATE_GIFT_FROM_CHARA` (贈り物.ERB:42-100) draws a 本体 + 形容詞 with
 * `DRAW_GIFT_MAIN(99)` / `DRAW_GIFT_ADJECT(99, …)`, scores the pair with
 * `REVIEW_GIFT`, and retries until the score lands in [SCORE_MIN, SCORE_MAX].
 * The date passes **701..1000** — a gift the partner deliberately picks because
 * *they* like it, which is why it reads the character's own review rather than
 * the player's.
 *
 * Both halves already exist in `state/gifts.ts` (`createGift` = the draw,
 * `reviewGift` = the scoring); what is added here is the score-window retry, the
 * **chara → master** record direction, and the personality-flavoured narration.
 *
 * ## Divergences (explicit, not silent)
 *
 * - **Bounded retries.** With `IFPf` falsy (see below) upstream's `ELSE` arm is
 *   a bare `RESTART`, and `DRAW_GIFT_MAIN` is a `WHILE !RESULT` loop, so neither
 *   is bounded. A synchronous runtime cannot spin forever, so the cap of 100
 *   draws is applied unconditionally — the same budget upstream grants on its
 *   `IFPf` path (`IF LOCAL < 100 … ELSE RETURN -1`). Exhaustion returns `null`,
 *   which the caller turns into `SP_EVENT 3`, i.e. upstream's own failure path.
 * - **`IFPf` reads falsy.** It is toggled only by the DLC choice menu
 *   (`DLCCHIOSEMENU.ERB:862`) and is not modelled, so upstream's second arm
 *   (`SIF TALENT:CHARA:7 → LOCAL:1 = 100`, the immediate-give-up path) is
 *   unreachable. The first arm's `!IFPf` is therefore always satisfied, exactly
 *   as upstream behaves without the DLC.
 * - **`EGG_GIFT_DATE_EVENT` is not called.** It returns immediately unless
 *   `FLAG:USE_EXPANDED_PREGNANCY_OPTIONS` (Add_PregnancyTypes.ERB), an option
 *   that does not exist in the modern runtime — so the egg variant is inert
 *   here for the same reason it is inert upstream without that DLC.
 * - **`GIFT_ID` is not bit-packed.** Modern `GiftRecord` keeps the fields
 *   structured (`count` / `score` / `day` / `area` / `adject` / `main`), which
 *   is the same information without the 1e16-scale integer arithmetic. The
 *   `CFLAG:送出的礼物` mirror stores the master's `回数*1000+chara` counter the
 *   way `recordGiftPurchase` already does, since the packed id has no
 *   bit-width room in a JS number.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import { CFLAG_ID } from "../state/settlement.js";
import {
  createGift,
  giftStateOf,
  reviewGift,
  type GiftRecord,
} from "../state/gifts.js";
import type { Rng } from "../command/types.js";

/** Upstream's `LOCAL < 100` budget; see the bounded-retry note above. */
const MAX_DRAWS = 100;

/** `@GIFT_DATE_EVENT` passes 701..1000. */
const SCORE_MIN = 701;
const SCORE_MAX = 1000;

export interface DateGift {
  readonly name: string;
  readonly score: number;
  readonly sense: string;
  readonly adjectId: number;
  readonly mainId: number;
  readonly price: number;
}

/**
 * `@CREATE_GIFT_FROM_CHARA(chara, 701, 1000)` — draw a gift the character
 * would want to give, or `null` where upstream returns -1.
 */
export function createGiftFromChara(
  state: GameState,
  charaNum: number,
  rng: Rng,
  scoreMin: number = SCORE_MIN,
  scoreMax: number = SCORE_MAX,
): DateGift | null {
  const next = () => rng.next();
  for (let attempt = 0; attempt < MAX_DRAWS; attempt++) {
    // `DRAW_GIFT_MAIN(99)` — 99 is the 全域 draw, i.e. no area restriction.
    const drawn = createGift(next, null);
    if (!drawn) return null;
    const review = reviewGift(state, charaNum, drawn.adjectId, drawn.mainId);
    if (review.score >= scoreMin && review.score <= scoreMax) {
      return {
        name: drawn.name,
        score: review.score,
        sense: review.giftSense,
        adjectId: drawn.adjectId,
        mainId: drawn.mainId,
        price: drawn.price,
      };
    }
  }
  return null;
}

/**
 * Write the chara → master record: `GIFT_GAVE:CHARA:(回数 % 100)` plus the
 * `CFLAG:CHARA:送出的礼物` mirror.
 *
 * This is the **reverse** of the direction the shop writes. `state.gifts[n].records`
 * is what chara *received* from the master; `given` is what the master received
 * from chara. **No reader consumes `given` yet** — `buildGiftHistory` walks only
 * `records`, so the date-gift direction is stored for the save state and is not
 * yet surfaced in the gift-history UI. Recorded as a known gap in DEBUG-BOARD
 * rather than described as a UI fix.
 *
 * `area` is passed through as `onDate` (0 from the `runPostDateGift` call site in
 * `world/date-event.ts`). Upstream
 * packs no location for this direction at all — the `约会中 * 1e7` term in `GIFT_ID`
 * is a *flag*, and `GiftRecord.area` is an area id that the history UI compares
 * against 99 for "order-made". 0 is therefore the honest "not a shop purchase"
 * value rather than a missing argument; the fact that the gift happened on a date
 * is carried by `day` plus the `CFLAG:送出的礼物` counter.
 */
export function recordCharaGift(
  state: GameState,
  charaNum: number,
  gift: DateGift,
  day: number,
  onDate: number,
): GiftRecord | null {
  const chara = state.charas[charaNum];
  if (!chara) return null;
  const gifts = giftStateOf(state, charaNum);
  gifts.given ??= [];
  const record: GiftRecord = {
    count: gifts.given.length + 1,
    score: gift.score,
    day,
    area: onDate,
    adject: gift.adjectId,
    main: gift.mainId,
    name: gift.name,
  };
  gifts.given.push(record);
  // `CFLAG:送出的礼物 = 渡した回数*1000+对方`, the same packing
  // `recordGiftPurchase` uses on the master side — but stored on the *partner*,
  // since it is the partner handing something over.
  const prev = chara.state.CFLAG[CFLAG_ID.送出的礼物] ?? 0;
  chara.state.CFLAG[CFLAG_ID.送出的礼物] =
    (Math.trunc(prev / 1000) + 1) * 1000 + state.master.charaNum;
  return record;
}

/**
 * The `CFLAG:CHARA:性格傾向` five-way narration opener (贈り物.ERB:759-776).
 * Only the opener is reproduced here; the upstream lines continue into the
 * gift-name reveal, which the kojo layer supplies.
 */
export function dateGiftNarration(partner: CharaSlot): string {
  const name = partner.callName ?? `#${partner.charaNum}`;
  switch (partner.state.CFLAG[CFLAG_ID.性格傾向] ?? 0) {
    case 1:
      return `约会回去的路上、${name}扭扭捏捏地从怀里拿出什么东西、小心翼翼地递了过来…`;
    case 2:
      return `约会回去的路上、${name}看着你的脸、像是想起了什么似的、拿出什么东西得意地递了过来…`;
    case 3:
      return `约会回去的路上、${name}慢慢地拿出什么东西、说要送给你、然后递了过来…`;
    case 4:
      return `约会回去的路上、${name}对着你说道「那个、能收下吗」然后把东西递了过来…`;
    case 5:
      return `约会回去的路上、${name}叹了口气、摇摇头、什么也没拿出来…`;
    default:
      return `约会回去的路上、${name}拿出了什么东西递了过来…`;
  }
}
