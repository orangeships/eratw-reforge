/**
 * Phase 5.5 — load a character's real stats into a `CharaSlotState`.
 *
 * Bridges the importer's `CharaStats` (parsed from `CSV/Chara/*.csv`) into
 * the runtime `CharaSlotState`. Defined structurally (`CharaStatsLike`) so
 * `runtime/` does not import from `importer/` — the committed chara bundle
 * (`web/app/game/charas.bundle.json`) is JSON that satisfies this shape.
 *
 * Only the numeric stat namespaces are loaded; CUP/CDOWN/EQUIP start empty
 * (settlement-transient / not in the Chara CSV). `relations` (相性) and
 * strings are deliberately not pushed into GameState yet (Phase 7).
 */

import type { CharaSlot, CharaSlotState } from "./game-state.js";
import { emptyCharaSlotState } from "./game-state.js";
import { BASE_ID, CFLAG_ID, EQUIP_SLOT, TEQUIP_ID } from "./settlement.js";
import { charaOutfit, type SlotName } from "./clothing-outfits.js";
import { clothingIdByName } from "./clothing-catalog.js";

/**
 * "Gauge" BASE stats whose Chara-CSV「基礎」value is the *cap* (MAXBASE),
 * not the new-game runtime value. eraTW's `@RESET_CHARA` (COMMON.ERB:3144-3155)
 * first loads 基礎 into BOTH BASE and MAXBASE, then explicitly zeroes this
 * exact set — a freshly-loaded character is calm and empty on these gauges,
 * building them up only through play:
 *
 *     BASE:ARG:射精 = 0 / 母乳 = 0 / 尿意 = 0 / 勃起 = 0
 *     BASE:ARG:ムード(情緒) = 0 / 怒り(憤怒) = 0 / 酒気 = 0
 *
 * 理性 is NOT in this list — it stays at its cap (full), which the plain
 * `BASE = MAXBASE` copy below already gives it (cf. BEFORETRAIN.ERB:850
 * `BASE:理性 = MAXBASE:11`).
 *
 * Without this reset every NPC loaded straight from the CSV 基礎 column would
 * spawn at maximum agitation + full rage + fully erect + max drunk (霊夢:
 * 情緒 1500 / 怒り 1000 / 勃起 1500 / 酒気 1900), a visible status-bar bug AND
 * a real SOURCE_CHECK input bug.
 */
const GAUGE_BASE_RESET_TO_ZERO: ReadonlyArray<number> = [
  BASE_ID.射精, // 2
  BASE_ID.母乳, // 3
  BASE_ID.尿意, // 4
  BASE_ID.勃起, // 5
  BASE_ID.情緒, // 10 (ムード) — agitation, empty when calm
  BASE_ID.憤怒, // 12 (怒り)  — anger, none when calm
  BASE_ID.酒気, // 15
];

/** Structural view of the importer's `CharaStats` (id-keyed numeric maps). */
export interface CharaStatsLike {
  id: number;
  name: string;
  callName: string;
  BASE: Record<number, number>;
  ABL: Record<number, number>;
  TALENT: Record<number, number>;
  CFLAG: Record<number, number>;
  EXP: Record<number, number>;
}

/** Fill a `CharaSlotState` from real parsed stats (copies, no aliasing). */
export function charaStatsToSlotState(s: CharaStatsLike): CharaSlotState {
  // Parity QA P-11 — the 性骚扰 (sekuhara) filter is OFF by default for
  // every freshly-loaded chara (a deliberate special case; upstream defaults
  // ALL filters on). The filter is "on" (commands shown) when the CFLAG is 0,
  // so defaulting it OFF means seeding 1. A CSV/explicit value still wins.
  // The player toggles it on per-target via the [性骚扰] filter button.
  const cflag = { ...s.CFLAG };
  if (cflag[CFLAG_ID.性騷擾過濾器] === undefined) {
    cflag[CFLAG_ID.性騷擾過濾器] = 1;
  }
  // eraTW initializes stat caps (MAXBASE) from the chara CSV's 基礎 values,
  // so most stats start at full (current BASE == MAXBASE). The emotional
  // gauges are the exception: their 基礎 entry is the cap, but the new-game
  // runtime value is 0 (calm). Reset those to 0 while keeping their cap.
  const base = { ...s.BASE };
  for (const id of GAUGE_BASE_RESET_TO_ZERO) base[id] = 0;
  // CLOTHES S5 — seed the chara's default outfit into `state.EQUIP` (per-slot
  // piece id) and `state.TEQUIP` (no exposure on a freshly-dressed chara).
  // The outfit comes from the static `CHARA_OUTFITS` table for bundled
  // charas; unbundled charas get an empty EQUIP (read layer falls back
  // gracefully). See `clothing-catalog.ts` for the subset catalog.
  const { equip, tequip } = seedEquip(s.id);
  return {
    ...emptyCharaSlotState(),
    BASE: base,
    // Per-stat max formulas that diverge from 基礎 are a follow-up.
    MAXBASE: { ...s.BASE },
    ABL: { ...s.ABL },
    TALENT: { ...s.TALENT },
    CFLAG: cflag,
    EXP: { ...s.EXP },
    EQUIP: equip,
    TEQUIP: tequip,
  };
}

/**
 * CLOTHES S5 seed — translate a chara's `CHARA_OUTFITS` default into
 * `state.EQUIP[部位id]=件id` (catalog id) and `state.TEQUIP` (no exposure).
 *
 * Returns empty records for unbundled charas (read layer falls back to
 * static lookup of CHARA_OUTFITS — which is also absent — so nothing
 * breaks). The two 固有 underwear slots (`下半身内衣２` / `上半身内衣２`)
 * are NOT seeded — those pieces are name-on-chara (faithful to
 * `@PANTSNAME`), the read API looks them up via `outfit.lowerUnderwear`.
 *
 * Bits used in TEQUIP:
 *   - TEQUIP:0 (下半身着衣状況): 1=裙子 / 2=ずらし可 / 4=ずらし不可 /
 *     8=下身衣服ずらし不可 (per `@SHOW_下半身内衣` 472-486). A fresh
 *     chara is fully dressed → bit 1 if wearing a skirt, 0 otherwise.
 *   - TEQUIP:1 (上半身着衣状況): 1=はだけ可 / 2=はだけ不可 (per
 *     `@SHOW_TOP` 511-514). A fresh chara is fully dressed → bit 2 set
 *     when 上身衣服１ is worn.
 */
function seedEquip(charaNum: number): {
  equip: Record<number, number>;
  tequip: Record<number, number>;
} {
  const outfit = charaOutfit(charaNum);
  if (!outfit) {
    return { equip: {}, tequip: {} };
  }
  const equip: Record<number, number> = {};
  for (const [slotName, pieceName] of Object.entries(outfit.wear)) {
    const slotId = EQUIP_SLOT[slotName as SlotName];
    const pieceId = clothingIdByName(slotId, pieceName);
    if (pieceId !== undefined) {
      equip[slotId] = pieceId;
    }
    // If pieceId is undefined, the catalog hasn't been extended for this
    // piece yet — the read API will fall back to outfit.wear[slotName]
    // (preserving Phase-0 static-display behavior).
  }
  const tequip: Record<number, number> = {};
  // 下半身着衣状況: bit 1 (裙子) when the chara wears a 裙子 slot.
  let lowerBits = 0;
  if (equip[EQUIP_SLOT.裙子] && equip[EQUIP_SLOT.裙子] !== 0) {
    lowerBits |= 0b0001;
  }
  // 上半身着衣状況: bit 2 (はだけ不可) when 上身衣服１ is worn.
  let upperBits = 0;
  if (equip[EQUIP_SLOT.上身衣服１] && equip[EQUIP_SLOT.上身衣服１] !== 0) {
    upperBits |= 0b0010;
  }
  if (lowerBits !== 0) tequip[TEQUIP_ID.下半身着衣状況] = lowerBits;
  if (upperBits !== 0) tequip[TEQUIP_ID.上半身着衣状況] = upperBits;
  return { equip, tequip };
}

/** Build a positioned `CharaSlot`. `homeLocation` is the string-keyed
 * adapter for the CSV's numeric `CFLAG:初期位置`; callers that already pass
 * the configured home can omit it. */
export function buildCharaSlot(
  s: CharaStatsLike,
  location: string,
  homeLocation: string = location,
): CharaSlot {
  return {
    charaNum: s.id,
    name: s.name,
    callName: s.callName,
    location,
    homeLocation,
    state: charaStatsToSlotState(s),
  };
}
