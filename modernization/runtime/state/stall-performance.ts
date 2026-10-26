/**
 * COMF447 来客演出 (stall performance) text tables — the player-facing
 * beats of `COMF447 露店を開く.ERB`, split out of `stall.ts` to keep the
 * settlement module focused on mechanics:
 *
 *   - greeting    (ERB 362-375, `SELECTCASE RAND:6` six-way; the CHARA
 *                  assistant arm collapses to the plain `经商中.....` —
 *                  the assistant is deferred, see stall.ts header)
 *   - no-sale     (ERB 408-430, `PRINTDATAL` eight-way, gray upstream)
 *   - SHOPPER_COME (ERB 1320-1374) — rate-tiered customer dialogue
 *                  (80-150 / 151-200 / CASEELSE, each `RAND:5`), rate
 *                  clamped to 80..300 like the upstream `ARG:0` guard
 *   - sold line   (ERB 559-561)
 *   - sold-out    (ERB 577 `恭喜完售！`) and closing (ERB 591)
 *   - summary     (ERB 593-624) — per-slot tally + 合计/来客数
 *
 * **RNG posture**: these text rolls are presentation-only. Upstream
 * interleaves them in the settlement RAND stream, but the modern port has
 * never consumed them there (the hand-traced fixtures in `stall.test.ts`
 * are the current contract), so the flavor rolls run on a dedicated
 * performance RNG passed to `runStall` — the settlement stream is
 * untouched. The divergence from the upstream RNG sequence is a
 * documented defer (see stall.ts header).
 *
 * **Item names** come from `CSV/Item.csv` via the same injection seam as
 * `setItemExplanations` (`web/app/App.tsx` injects `items.bundle.json`).
 * Uninjected ⇒ `道具#<id>` fallback.
 */
import type { StallRng } from "./stall.js";

/** ERB 362-375 (CASE 0 collapses the assistant arm to plain text). */
export const STALL_GREETINGS: readonly string[] = [
  "经商中.....",
  "欢迎光临————",
  "瞧一瞧看一看、走过路过不要错过了诶",
  "【拒绝还价　接受还价】",
  "这位客人眼光不错嘛",
  "这位小姐、现在正便宜着呢ー",
];

/** ERB 408-419 `PRINTDATAL` (leading full-width space is upstream's). */
export const STALL_NO_SALE_LINES: readonly string[] = [
  "　「能再便宜点吗？」　……这样讲讲价也不是不可以的",
  "　有个小孩子咬着手指盯着商品看了半天、被父母牵着手拽走了…",
  "　有个客人斜着眼悄悄地瞟了两眼商品、但是一出声招呼就好像被吓到了的样子逃走了…",
  "　一个话唠的客人、只是过来随便闲聊两句就走了…",
  "　一个看上去很犹豫不决的、一边看着商品念念有词的客人来了又走了…",
  "　讨价还价的交渉决裂了…",
  "　被无视了…",
  "　只是瞥了一眼商品、客人站了一下就走了…",
];

/** ERB 1326-1330: `ARG:0` clamped into 80..300 before the tier SELECTCASE. */
const SHOPPER_COME_TIERS: ReadonlyArray<{ min: number; max: number; lines: readonly string[] }> = [
  {
    // ERB 1334-1346: CASE 80 TO 150
    min: 80,
    max: 150,
    lines: [
      "对方点点头付钱：「嗯…也不算贵啦。」",
      "「刚好今天家里要用，就买这个吧～」",
      "顾客一脸平淡地付完款，像是生活日常的一部分。",
      "「喔…这价格跟之前差不多嘛。」说完就买了下来。",
      "「哈？才这价钱？买了赚到。」对方笑得有点坏。",
    ],
  },
  {
    // ERB 1347-1359: CASE 151 TO 200
    min: 151,
    max: 200,
    lines: [
      "顾客笑笑说：「虽然有点贵…但感觉你说得有道理～」",
      "「今天刚好心情好，就不杀价了！」对方豪迈地拿走商品。",
      "「喔～这味道不错，价格嘛…算你会做生意～」",
      "交谈甚欢之下，对方一口气的付了高价。",
      "「这个价格还不错，今天就买了吧！」",
    ],
  },
  {
    // ERB 1360-1372: CASEELSE
    min: 201,
    max: 300,
    lines: [
      "用些话术，翻倍卖出！",
      "神秘顾客出现：「我喜欢你的摊位，这点小钱不用找了。」",
      "当地有名的富商大方地买下了商品，还给了你一个小费。",
      "「……不愧是你，这种商品也能说得这么高级。」顾客佩服地掏出钱包。",
      "一位穿着得体的少女轻声说：「这是我一直在找的东西…价格随你开。」",
    ],
  },
];

/** Injection seam for `CSV/Item.csv` names (`items.bundle.json` via App.tsx). */
let itemNames: Readonly<Record<number, string>> = {};

export function setStallItemNames(table: Readonly<Record<number, string>> | null | undefined): void {
  itemNames = table ?? {};
}

/** `ITEMNAME_TR(id)` — fallback `道具#<id>` when the bundle is uninjected. */
export function stallItemName(id: number): string {
  return itemNames[id] ?? `道具#${id}`;
}

/** ERB 362-375 — the per-visitor greeting. */
export function stallGreetingText(rng: StallRng): string {
  return STALL_GREETINGS[rng.int(STALL_GREETINGS.length)]!;
}

/** ERB 408-419 — the no-sale bystander line. */
export function stallNoSaleText(rng: StallRng): string {
  return STALL_NO_SALE_LINES[rng.int(STALL_NO_SALE_LINES.length)]!;
}

/** ERB 1320-1374 — the per-sale customer line, tiered on the sale's 利率. */
export function stallShopperComeText(rng: StallRng, rate: number): string {
  const clamped = Math.min(300, Math.max(80, rate));
  const tier = SHOPPER_COME_TIERS.find((t) => clamped >= t.min && clamped <= t.max)
    ?? SHOPPER_COME_TIERS[SHOPPER_COME_TIERS.length - 1]!;
  return tier.lines[rng.int(tier.lines.length)]!;
}

/** ERB 559-561 — the sold beat. 数え方 collapses to 个 (per-item table deferred). */
export function formatStallSoldText(itemId: number, qty: number, yen: number): string {
  return `${stallItemName(itemId)}${qty}个、以${yen}元卖出去了！`;
}
