/**
 * CLOTHES Phase 0 (S5) — state-bound clothing display API.
 *
 * Faithful port of the read side of `衣服/CLOTHES.ERB`:
 *   - `@COVER_CLOTHES(chara, TYPE)` (line 566) — walk a fixed layering order
 *     per display-type, return the outermost WORN slot.
 *   - `@SHOW_TOP` / `@SHOW_BOTTOM` / `@SHOW_上半身内衣` / `@SHOW_下半身内衣`
 *     (line 401-548) — pick the visible layer from `TEQUIP` exposure bits,
 *     then read that piece's 名前.
 *   - `@PANTSNAME` (`衣服/PANTS.ERB`) — the 固有 underwear name (+ descriptor).
 *
 * **S5 state-bound model** (was Phase 0 static lookup by charaNum):
 *   - The worn set lives in `chara.state.EQUIP[部位id]` (per-slot piece id).
 *   - The exposure/displacement state lives in `chara.state.TEQUIP[0|1]`.
 *   - The static `CHARA_OUTFITS` table is the **seed source** — written into
 *     `EQUIP` once at chara load (`load-chara.ts::seedEquip`) so the runtime
 *     can mutate EQUIP/TEQUIP (P1 脱衣) without losing the default.
 *   - Read API: 1) check `state.EQUIP` for a piece; 2) fall back to outfit.
 *   - For the two 固有 underwear slots (`下半身内衣２` / `上半身内衣２`) the
 *     EQUIP entry is 0 (they are name-on-chara, not catalog pieces) — the
 *     read API falls back to `outfit.lowerUnderwear` / `outfit.upperUnderwear`.
 *
 * **QoL note (still relevant):** the live `@SHOW_TOP`/`@SHOW_BOTTOM`/
 * `@SHOW_内衣` all `RETURNF QOL_视觉优先度服装描写(…"_qol")` on their FIRST
 * line — i.e. they return the outermost WORN piece, and the TEQUIP-branch
 * below that RETURNF is dead legacy code. So the faithful (live) read is
 * TEQUIP-independent: the outermost worn layer. `TEQUIP` is kept in state for
 * P1 (脱衣) but the Phase 0 read API does not consult it (matching QoL).
 */

import type { CharaSlot } from "./game-state.js";
import { charaOutfit, type CharaOutfit, type SlotName } from "./clothing-outfits.js";
import { CFLAG_ID, EQUIP_SLOT } from "./settlement.js";
import { clothingName, type EquipPart } from "./clothing-catalog.js";

// ---------------------------------------------------------------------------
// Layering orders (`@COVER_CLOTHES` 571-575 + its CASE arms). Each list is
// outermost-first; the resolver returns the first slot the chara wears.
// ---------------------------------------------------------------------------

/** 上半身服装描写_qol — outermost upper garment. */
const UPPER_ORDER: readonly SlotName[] = ["外搭", "上身衣服２", "和服", "ボディースーツ", "上身衣服１", "連衣裙", "レオタード", "上半身内衣１", "上半身内衣２"];
/** 下半身服装描写_qol — outermost lower garment. */
const LOWER_ORDER: readonly SlotName[] = ["裤子", "ボディースーツ", "和服", "裙子", "連衣裙", "レオタード", "下半身内衣１", "下半身内衣２"];
/** 上半身内衣描写_qol — outermost upper underwear layer. */
const UPPER_UNDER_ORDER: readonly SlotName[] = ["レオタード", "上半身内衣１", "上半身内衣２", "ボディースーツ"];
/** 下半身内衣描写_qol — outermost lower underwear layer. */
const LOWER_UNDER_ORDER: readonly SlotName[] = ["ボディースーツ", "レオタード", "下半身内衣１", "下半身内衣２"];

/** The two slots whose piece is the chara's 固有 (unique) underwear. */
const LOWER_UNDERWEAR_SLOT: SlotName = "下半身内衣２";
const UPPER_UNDERWEAR_SLOT: SlotName = "上半身内衣２";

/** Slot id (`CSV/Equip.csv` value of `EQUIP_SLOT[name]`). */
function slotId(name: SlotName): EquipPart {
  return EQUIP_SLOT[name] as EquipPart;
}

/**
 * Whether the chara "wears" something in `slot`. Reads `state.EQUIP[slotId]`
 * first (the state-bound source of truth in S5); falls back to the static
 * `CHARA_OUTFITS` default only when EQUIP is **absent** (legacy chara with no
 * seed). When EQUIP is present and = 0, the slot is treated as EMPTY —
 * faithful to `EQUIP[id]=0` meaning "nothing here" (the deserialization
 * default after a strip). For the two 固有 underwear slots the EQUIP entry
 * is always 0 — the outfit fields `lowerUnderwear`/`upperUnderwear` are
 * the source of truth.
 */
function wearsSlot(chara: CharaSlot, outfit: CharaOutfit, slot: SlotName): boolean {
  // The unique underwear slot is stored in the authored outfit, but
  // CFLAG:291 is the authoritative removal marker.  Without this check a
  // stolen/removéd unique panty would reappear on every read through the
  // static outfit fallback.
  if (slot === LOWER_UNDERWEAR_SLOT) {
    if ((chara.state.CFLAG[CFLAG_ID.没穿内裤] ?? 0) !== 0) return false;
    return Boolean(outfit.lowerUnderwear);
  }
  if (slot === UPPER_UNDERWEAR_SLOT) return Boolean(outfit.upperUnderwear);
  const equipId = chara.state.EQUIP[slotId(slot)];
  if (equipId !== undefined) return equipId !== 0; // 0 = explicitly stripped
  return outfit.wear[slot] != null; // legacy: no seed → use outfit default
}

/**
 * The display name of the piece worn in `slot`. Same priority order as
 * `wearsSlot` — state first, outfit fallback only when EQUIP is absent.
 */
function pieceNameInSlot(chara: CharaSlot, outfit: CharaOutfit, slot: SlotName): string {
  if (slot === LOWER_UNDERWEAR_SLOT) {
    if ((chara.state.CFLAG[CFLAG_ID.没穿内裤] ?? 0) !== 0) return "";
    return outfit.lowerUnderwear ?? "";
  }
  if (slot === UPPER_UNDERWEAR_SLOT) return outfit.upperUnderwear ?? "";
  const equipId = chara.state.EQUIP[slotId(slot)];
  if (equipId !== undefined) {
    if (equipId === 0) return ""; // stripped
    const fromCatalog = clothingName(slotId(slot), equipId);
    if (fromCatalog) return fromCatalog;
  }
  return outfit.wear[slot] ?? "";
}

/** `@COVER_CLOTHES` — the outermost worn slot in `order`, or null. */
function cover(chara: CharaSlot, outfit: CharaOutfit, order: readonly SlotName[]): SlotName | null {
  for (const slot of order) {
    if (wearsSlot(chara, outfit, slot)) return slot;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public read API — take a CharaSlot (charaNum → outfit; state.EQUIP → worn set;
// state.TEQUIP → exposure bits for P1).
// ---------------------------------------------------------------------------

function outfitOf(chara: CharaSlot): CharaOutfit | undefined {
  return charaOutfit(chara.charaNum);
}

/** `@SHOW_TOP` — the outermost worn upper garment name ("" if none/naked). */
export function showTop(chara: CharaSlot): string {
  const outfit = outfitOf(chara);
  if (!outfit) return "";
  const slot = cover(chara, outfit, UPPER_ORDER);
  return slot ? pieceNameInSlot(chara, outfit, slot) : "";
}

/** `@SHOW_BOTTOM` — the outermost visible lower garment name. */
export function showBottom(chara: CharaSlot): string {
  const outfit = outfitOf(chara);
  if (!outfit) return "";
  const slot = cover(chara, outfit, LOWER_ORDER);
  return slot ? pieceNameInSlot(chara, outfit, slot) : "";
}

/** `@SHOW_上半身内衣` — the visible upper-underwear layer name. */
export function showUpperUnderwear(chara: CharaSlot): string {
  const outfit = outfitOf(chara);
  if (!outfit) return "";
  const slot = cover(chara, outfit, UPPER_UNDER_ORDER);
  return slot ? pieceNameInSlot(chara, outfit, slot) : "";
}

/**
 * `@SHOW_下半身内衣` — the visible lower-underwear layer name. When the
 * outermost underwear IS the chara's 固有 panties and `withDescriptor` is set,
 * prefix the 固有内衣形容詞 (faithful to `@PANTSNAME` 描写有).
 */
export function showLowerUnderwear(chara: CharaSlot, withDescriptor = false): string {
  const outfit = outfitOf(chara);
  if (!outfit) return "";
  const slot = cover(chara, outfit, LOWER_UNDER_ORDER);
  if (!slot) return "";
  const name = pieceNameInSlot(chara, outfit, slot);
  if (withDescriptor && slot === LOWER_UNDERWEAR_SLOT && outfit.underwearAdj) {
    return outfit.underwearAdj + name;
  }
  return name;
}

/** The piece worn in a specific slot (`@CLOTHNAME`), or "" if nothing. */
export function wornPieceName(chara: CharaSlot, slot: SlotName): string {
  const outfit = outfitOf(chara);
  return outfit ? pieceNameInSlot(chara, outfit, slot) : "";
}

/** `@下半身内衣チェック` — does the chara have visible lower underwear? */
export function lowerUnderwearCheck(chara: CharaSlot): boolean {
  return showLowerUnderwear(chara) !== "";
}

/** `@上半身内衣チェック` — does the chara have visible upper underwear? */
export function upperUnderwearCheck(chara: CharaSlot): boolean {
  return showUpperUnderwear(chara) !== "";
}

// ---------------------------------------------------------------------------
// `@SHOW_CLOTHES(C_ID, "現在的衣装")` — full per-slot listing for the status
// panel (PRINT_STATE_CLOTH → 能力表示 PAGE 0). Faithful to CLOTHES.ERB:1574-1653.
// ---------------------------------------------------------------------------

/** One rendered `装备:标签[内容]` row. */
export interface ClothingLine {
  /** 表示ラベル (upstream label, trailing full-width pad stripped). */
  label: string;
  /** 表示内容 — piece name, or "没穿"/"裸足"/"？？？？？". */
  value: string;
}

export interface ClothingDescription {
  /** `＜全裸＞` — nothing worn on top, bottom, or as underwear. */
  naked: boolean;
  lines: ClothingLine[];
}

/**
 * Slot list in `SHOW_CLOTHES` 表示部位 order (`下身衣服` omitted, matching the
 * upstream `SIF 表示部位 == "下身衣服" CONTINUE`). Label = 表示ラベル with the
 * decorative full-width padding trimmed (the panel is a real grid there; the
 * modern UI aligns with its own layout).
 */
const CLOTH_SLOTS: ReadonlyArray<{ slot: SlotName; label: string }> = [
  { slot: "帽子", label: "头饰" },
  { slot: "飾品", label: "饰品" },
  { slot: "腕部装束", label: "腕" },
  { slot: "外搭", label: "外搭" },
  { slot: "上身衣服１", label: "上衣一" },
  { slot: "上身衣服２", label: "上衣二" },
  { slot: "和服", label: "和服" },
  { slot: "連衣裙", label: "连衣裙" },
  { slot: "裙子", label: "裙子" },
  { slot: "裤子", label: "裤子" },
  { slot: "レオタード", label: "紧身衣" },
  { slot: "ボディースーツ", label: "连体服" },
  { slot: "上半身内衣１", label: "内衣一" },
  { slot: "上半身内衣２", label: "内衣二" },
  { slot: "下半身内衣１", label: "内裤一" },
  { slot: "下半身内衣２", label: "内裤二" },
  { slot: "其他１", label: "附属一" },
  { slot: "其他２", label: "附属二" },
  { slot: "其他３", label: "附属三" },
  { slot: "襪子", label: "袜子" },
  { slot: "靴", label: "鞋" },
];

/** Upper-body garment slots (for the 全上半身[没穿] aggregate line). */
const UPPER_CLUSTER: readonly SlotName[] = ["外搭", "上身衣服１", "上身衣服２", "和服", "連衣裙", "レオタード", "ボディースーツ"];
/** Lower-body garment slots (for the 全下半身[没穿] aggregate line). */
const LOWER_CLUSTER: readonly SlotName[] = ["裙子", "裤子", "連衣裙", "和服", "レオタード", "ボディースーツ"];
/** Foot slots (for the 足部[裸足] aggregate line). */
const FEET_CLUSTER: readonly SlotName[] = ["靴", "襪子"];

function anyWorn(chara: CharaSlot, outfit: CharaOutfit, slots: readonly SlotName[]): boolean {
  return slots.some((s) => wearsSlot(chara, outfit, s));
}

/**
 * `@SHOW_CLOTHES(…, "現在的衣装")` — the per-slot 装备 list shown on the
 * ability-panel 服装 section. Iterates 表示部位, emits a row for every worn
 * slot; adds the upstream 全上半身/全下半身[没穿] + 足部[裸足] aggregate lines
 * when a whole cluster is bare. 固有 panties get their 形容詞 prefix.
 */
export function describeClothing(chara: CharaSlot): ClothingDescription {
  const outfit = outfitOf(chara);
  const naked =
    showTop(chara) === "" &&
    showBottom(chara) === "" &&
    showLowerUnderwear(chara) === "" &&
    showUpperUnderwear(chara) === "";
  if (!outfit) return { naked, lines: [] };

  const lines: ClothingLine[] = [];
  for (const { slot, label } of CLOTH_SLOTS) {
    if (!wearsSlot(chara, outfit, slot)) continue;
    let value = pieceNameInSlot(chara, outfit, slot);
    if (slot === LOWER_UNDERWEAR_SLOT && outfit.underwearAdj) {
      value = outfit.underwearAdj + value;
    }
    if (value === "") continue;
    lines.push({ label, value });
  }

  // Aggregate "whole cluster bare" lines, faithful to CLOTHES.ERB:1621-1626.
  if (!anyWorn(chara, outfit, UPPER_CLUSTER)) lines.push({ label: "全上半身", value: "没穿" });
  if (!anyWorn(chara, outfit, LOWER_CLUSTER)) lines.push({ label: "全下半身", value: "没穿" });
  if (!anyWorn(chara, outfit, FEET_CLUSTER)) lines.push({ label: "足部", value: "裸足" });

  return { naked, lines };
}
