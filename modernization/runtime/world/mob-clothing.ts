/**
 * MOB girl clothing seed — faithful port of the "arrive dressed" half of
 * upstream `MOBGIRL_GENERATOR.ERB` (lines 1236-1270).
 *
 * Upstream generates a mob girl, then:
 *   1. reads her portrait cloth layer string (SET_MOB_IMAGE_STR) and maps it
 *      to a 衣装セット id — 私服A/B/CA/CB/D → 19-23, ゴスロリ → 63
 *      (MOBGIRL_GENERATOR.ERB:1245-1256);
 *   2. falls back to the species 服装ランダマイズ pick for race-specific
 *      cloth layers — 妖精→13, 女仆妖精→51, 因幡/販売員→16,
 *      妖怪狐/妖怪狸→11, 鬼→18;
 *   3. runs `CTRL_CLOTHES_SET` + `CLOTHES_SETTING_TRAIN`, i.e. writes EQUIP
 *      and re-derives the TEQUIP exposure bits.
 *
 * The modern port applies the same rule to the modern portrait recipes
 * (`dynamic-portraits.ts` RACE_RECIPES): the recipe's `cloth` layer decides
 * the set, the species table is the fallback for race cloth (和服/妖精服/
 * 女僕服/灯笼裤/玉兎服). Where the modern recipe draws 私服A under a race
 * skin (河童/山童/白狼天狗/鸦天狗 — upstream draws the race cloth itself),
 * the SIF rule fires first, so the seeded EQUIP matches what the portrait
 * actually shows (私服Aセット) instead of upstream's race sets 12/14/15.
 * That keeps 立绘 and 状态面板 consistent, which is the invariant this
 * module exists for.
 *
 * Piece lists are transcribed from `ERB/OBJ/CLASS/METH_衣装セット.ERB`
 * (set ids in comments). 村姑/人妻 keep the modern recipe fallback 私服A
 * (upstream randomizes 和服-heavy); documented divergence — the portrait
 * also shows 私服A, so state stays consistent.
 */

import type { CharaSlot } from "../state/game-state.js";
import { EQUIP_SLOT } from "../state/settlement.js";
import { clothingIdByName } from "../state/clothing-catalog.js";
import { recomputeExposure } from "../state/clothing-write.js";

/** An EQUIP slot key + the display name of the piece to wear. */
type PieceSpec = readonly [keyof typeof EQUIP_SLOT, string];
type OutfitSet = readonly PieceSpec[];

// ---------------------------------------------------------------------------
// 衣装セット transcription (METH_衣装セット.ERB). The 上半身内衣１ "男の娘は
// 文胸を付けない" guard is skipped — every REGION_SPECIES mob girl is
// 性別=1 (female).
// ---------------------------------------------------------------------------

/** Set 19 私服Aセット. */
const SET_SHISHOKU_A: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["裙子", "裙子"],
  ["上身衣服２", "Ｔ恤衬衫"],
];
/** Set 20 私服Bセット. */
const SET_SHISHOKU_B: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["裙子", "裙子"],
  ["上身衣服２", "短袖女式衬衫"],
  ["其他１", "领带"],
];
/** Set 21 私服CAセット. */
const SET_SHISHOKU_CA: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["裤子", "裤子"],
  ["上身衣服２", "Ｔ恤衬衫"],
  ["外搭", "夹克衫"],
  ["飾品", "首飾"],
  ["其他１", "吊帯"],
];
/** Set 22 私服CBセット. */
const SET_SHISHOKU_CB: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["裤子", "裤子"],
  ["上身衣服２", "Ｔ恤衬衫"],
  ["飾品", "首飾"],
  ["其他１", "吊帯"],
];
/** Set 23 私服Dセット. */
const SET_SHISHOKU_D: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["連衣裙", "連衣裙"],
];
/** Set 63 哥特洛丽塔套装. */
const SET_GOTH_LOLI: OutfitSet = [
  ["靴", "长筒靴"],
  ["襪子", "吊带袜"],
  ["上半身内衣１", "文胸"],
  ["連衣裙", "哥特洛丽塔裙"],
];
/** Set 13 妖精セット. */
const SET_FAIRY: OutfitSet = [
  ["帽子", "蝴蝶结"],
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["連衣裙", "連衣裙"],
];
/** Set 51 女仆装 (cosplay). */
const SET_MAID: OutfitSet = [
  ["帽子", "女仆发箍"],
  ["靴", "鞋子"],
  ["襪子", "吊带袜"],
  ["上半身内衣１", "文胸"],
  ["連衣裙", "围裙洋装"],
];
/** Set 16 因幡セット. */
const SET_INABA: OutfitSet = [
  ["連衣裙", "連衣裙"],
];
/** Set 11 一套和服. */
const SET_KIMONO: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["和服", "和服"],
  ["上半身内衣１", "文胸"],
];
/** Set 17 玉兎セット. */
const SET_MOON_RABBIT: OutfitSet = [
  ["靴", "鞋子"],
  ["襪子", "袜子"],
  ["裙子", "裙子"],
  ["上身衣服２", "白衬衫"],
  ["上身衣服１", "西装上衣"],
  ["其他１", "领带"],
];
/** Set 18 鬼セット. */
const SET_ONI: OutfitSet = [
  ["靴", "木屐"],
  ["襪子", "足袋"],
  ["和服", "和服"],
  ["其他１", "拘束具"],
  ["上半身内衣１", "裹胸"],
];

// ---------------------------------------------------------------------------
// Resolution — upstream SIF order: portrait cloth first, species fallback.
// ---------------------------------------------------------------------------

/**
 * Portrait cloth layer → 衣装セット (MOBGIRL_GENERATOR.ERB:1245-1256).
 * ゴスロリ is reachable via the 僵尸妖精 recipe; 風俗嬢→43 has no modern
 * species pool and is omitted.
 */
const CLOTH_OUTFIT_SETS: Readonly<Record<string, OutfitSet>> = {
  私服A: SET_SHISHOKU_A,
  私服B: SET_SHISHOKU_B,
  私服CA: SET_SHISHOKU_CA,
  私服CB: SET_SHISHOKU_CB,
  私服D: SET_SHISHOKU_D,
  ゴスロリ: SET_GOTH_LOLI,
};

/**
 * Species fallback for race cloth layers (upstream 服装ランダマイズ picks;
 * MOBGIRL_GENERATOR.ERB lines 217/269/478/536/600/834/895/959 etc.).
 */
const SPECIES_OUTFIT_SETS: Readonly<Record<string, OutfitSet>> = {
  妖精: SET_FAIRY,
  女仆妖精: SET_MAID,
  因幡: SET_INABA,
  售货员: SET_INABA,
  妖怪狐: SET_KIMONO,
  妖怪狸: SET_KIMONO,
  鬼: SET_ONI,
  // 玉兎服(色固定) is a race cloth layer (upstream set 17), not 私服A.
  玉兔: SET_MOON_RABBIT,
  玉兎: SET_MOON_RABBIT,
};

/**
 * Seed a generated mob girl's `EQUIP` from her portrait cloth / species and
 * re-derive the `TEQUIP` exposure bits (upstream `CTRL_CLOTHES_SET` +
 * `CLOTHES_SETTING_TRAIN`). No-op when neither table knows the species —
 * same empty-EQUIP behavior as before this module existed.
 */
export function seedMobOutfit(slot: CharaSlot, species: string, cloth: string): void {
  const set = CLOTH_OUTFIT_SETS[cloth] ?? SPECIES_OUTFIT_SETS[species];
  if (!set) return;
  for (const [slotName, pieceName] of set) {
    const slotId = EQUIP_SLOT[slotName];
    const pieceId = clothingIdByName(slotId, pieceName);
    if (pieceId !== undefined) {
      slot.state.EQUIP[slotId] = pieceId;
    }
  }
  recomputeExposure(slot);
}
