/**
 * Phase 7.1a — `場所_*` place-flag bitset, faithful to eraTW `ROOMDATA`.
 *
 * Upstream (`ERB/DIM.ERH:506-540`) defines a `#DIM SAVEDATA ROOMDATA, 100`
 * per-room bitset of `場所_*` constants (`1pN` = `1 << N`, a power-of-two
 * bit position). Each base map's `ROOMSETTING_{mapId}.ERB` ORs bits into
 * `ROOMDATA:(room % 100)`, then `MAP_MANAGE.ERB:281-298` applies four
 * auto-derivation rules. The place predicates (`PLACE_拠点共通.ERB`:
 * `BATHCHECK` / `OPENPLACE` / `OUTROOF` / `INROOM` / `IN_HOME`) all read
 * these bits.
 *
 * The modern runtime uses string locations (`"神社:風呂"`) instead of
 * numeric room ids, so `ROOMDATA` is modeled here as a per-location
 * bitset (`place-flags-data.ts`) + this constants/derivation module.
 *
 * **BigInt, not number.** era's `1pN` reaches `N = 33` (`場所_无尘`), and
 * the auto-derivation ORs `1p32` (`場所_炬燵`). JS bitwise `&`/`|` coerce
 * to signed 32-bit, so `1 << 31` goes negative and `1 << 32` truncates to
 * 0. BigInt `&`/`|` are arbitrary-precision and preserve every bit
 * position faithfully. The bitset stays internal to this module;
 * `placeFlagsOf` returns `bigint` but the predicate API (`bathCheck` etc.)
 * returns plain booleans/numbers, so callers never touch BigInt.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

/** `場所_被窝` = `1p0` — auto-grants 休憩. */
export const PLACE_FUTON = 1n << 0n;
/** `場所_屋内` = `1p1` — indoor. */
export const PLACE_INDOOR = 1n << 1n;
/** `場所_風呂` = `1p2` — bath (drives `BATHCHECK`). */
export const PLACE_BATH = 1n << 2n;
/** `場所_厨房` = `1p3` — kitchen; auto-grants つまみ食い. */
export const PLACE_KITCHEN = 1n << 3n;
/** `場所_訓練` = `1p4` — training spot. */
export const PLACE_TRAINING = 1n << 4n;
/** `場所_学习` = `1p5` — study spot. */
export const PLACE_STUDY = 1n << 5n;
/** `場所_休憩` = `1p6` — rest spot. */
export const PLACE_REST = 1n << 6n;
/** `場所_廁所` = `1p7` — toilet. */
export const PLACE_TOILET = 1n << 7n;
/** `場所_赏月` = `1p9` — moon visible (roofed or indoor but sky visible). */
export const PLACE_MOON = 1n << 9n;
/** `場所_天之声` = `1p10` — sky-audible (open sky). */
export const PLACE_SKY = 1n << 10n;
/** `場所_菜園` = `1p11` — kitchen garden / farm plot. */
export const PLACE_GARDEN = 1n << 11n;
/** `場所_打水` = `1p12` — water-drawing spot. */
export const PLACE_WATER = 1n << 12n;
/** `場所_物干し` = `1p14` — drying yard (scenic). */
export const PLACE_DRYING = 1n << 14n;
/** `場所_广阔` = `1p16` — spacious (drives `OPENPLACE`). */
export const PLACE_WIDE = 1n << 16n;
/** `場所_身体測定` = `1p19` — body-measurement spot. */
export const PLACE_BODY = 1n << 19n;
/** `場所_過疎` = `1p23` — rarely visited. */
export const PLACE_DEPOPULATED = 1n << 23n;
/** `場所_プライベート` = `1p24` — private room. */
export const PLACE_PRIVATE = 1n << 24n;
/** `場所_公共の場` = `1p25` — public place (no 推倒). */
export const PLACE_PUBLIC = 1n << 25n;
/** `場所_飲食` = `1p26` — eating spot. */
export const PLACE_MEAL = 1n << 26n;
/** `場所_屋根` = `1p27` — outdoor but roofed. */
export const PLACE_ROOF = 1n << 27n;
/** `場所_洋室` = `1p28` — Western-style room; auto-grants 屋内. */
export const PLACE_WESTERN = 1n << 28n;
/** `場所_つまみ食い` = `1p29` — snacking spot. */
export const PLACE_SNACK = 1n << 29n;
/** `場所_留まらない` = `1p30` — pass-through (characters don't linger). */
export const PLACE_PASSAGE = 1n << 30n;
/** `場所_ワンルーム` = `1p31` — one-room dwelling; auto-grants 8 bits. */
export const PLACE_ONEROOM = 1n << 31n;
/** `場所_炬燵` = `1p32` — kotatsu (winter). */
export const PLACE_KOTATSU = 1n << 32n;
/** `場所_无尘` = `1p33` — never accumulates dirt. */
export const PLACE_CLEANLESS = 1n << 33n;

/** A place-flag bitset. */
export type PlaceFlags = bigint;

/**
 * The four `MAP_MANAGE.ERB:281-298` auto-derivation rules, applied to a
 * raw `ROOMSETTING` bitset. Faithful order: ワンルーム → (被窝|屋内|厨房|
 * 学习|休憩|飲食|プライベート|炬燵, clear 過疎); 被窝 → 休憩; 洋室 → 屋内;
 * 厨房 → つまみ食い. (MASTER 初期位置 rule skipped — that mutates the
 * master's start room at runtime, not a static room property.)
 */
export function expandPlaceFlags(raw: PlaceFlags): PlaceFlags {
  let f = raw;
  if (f & PLACE_ONEROOM) {
    f |=
      PLACE_FUTON |
      PLACE_INDOOR |
      PLACE_KITCHEN |
      PLACE_STUDY |
      PLACE_REST |
      PLACE_MEAL |
      PLACE_PRIVATE |
      PLACE_KOTATSU;
    f &= ~PLACE_DEPOPULATED;
  }
  if (f & PLACE_FUTON) f |= PLACE_REST;
  if (f & PLACE_WESTERN) f |= PLACE_INDOOR;
  if (f & PLACE_KITCHEN) f |= PLACE_SNACK;
  return f;
}

/** Test one flag. */
export function hasPlace(flags: PlaceFlags, flag: PlaceFlags): boolean {
  return (flags & flag) !== 0n;
}

/**
 * `PLACE_SENTO(ARG)` (`COMF432 銭湯.ERB:378`) return value — the 銭湯
 * "place id": 2 = 人里銭湯 (room 223), 9 = 旧地獄温泉 (地底 room 934),
 * 0 = not a 銭湯. Used by 431 (block bath-relax at 銭湯 → use 432) and
 * 432 (銭湯 entry). Narrowed scope models only id 2 (人間之里:銭湯).
 */
export const PLACE_SENTO_NONE = 0;
export const PLACE_SENTO_VILLAGE = 2;
export const PLACE_SENTO_OLD_HELL = 9;
