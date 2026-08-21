/**
 * Panty acquisition and collection state.
 *
 * This is the modern state-bound equivalent of `衣服/PANTS.ERB` plus
 * `COMF401 コレクション.ERB`: a removed panty first lives in PANTS_TEMP,
 * may be sent through the portable collection gap, and is otherwise carried
 * until the player returns home and runs 收藏 (COM401).
 */

import type { GameState } from "./game-state.js";
import { BASE_ID, EQUIP_SLOT, TALENT_ID } from "./settlement.js";
import { charaOutfit } from "./clothing-outfits.js";
import { clothingName } from "./clothing-catalog.js";
import { ITEM_ID, addItem, itemCount, removeItem } from "./items.js";

// ---------------------------------------------------------------------------
// Constants (DIM.ERH / FLAG.csv / Item.csv)
// ---------------------------------------------------------------------------

/** Maximum panty piece id (0-indexed, so 34 slots: 0..33). */
export const MAXPANTS = 34;
/** CFLAG offset for permanent collection storage. */
export const PANTS_MGMT_OFFSET = 100;
/** FLAG:700 — total unique panty species in permanent collection. */
export const FLAG_PANTY_SPECIES = 700;
/** FLAG:705 — bitmask of claimed collection bonuses. */
export const FLAG_PANTY_BONUS = 705;
/** FLAG:853 — panties are in transit (PANTS_TEMP non-empty). */
export const FLAG_PANTY_TRANSIT = 853;
/** FLAG:86 — the collection-gap acquisition/date marker. */
export const FLAG_PANTY_GAP = 86;
/** FLAG:87 — automatically send newly acquired panties to the gap. */
export const FLAG_PANTY_GAP_AUTO = 87;
/** ITEM:400 — portable collection gap. */
export const ITEM_PANTY_GAP = ITEM_ID.收藏隙間;

// ---------------------------------------------------------------------------
// PANTS_TEMP accessors and transit bookkeeping
// ---------------------------------------------------------------------------

function ensureTemp(state: GameState, charaNum: number): Record<number, number> {
  state.pantsTemp ??= {};
  state.pantsTemp[charaNum] ??= {};
  return state.pantsTemp[charaNum]!;
}

/** Get the count of a panty type currently carried in PANTS_TEMP. */
export function getPantsTemp(state: GameState, charaNum: number, pieceId: number): number {
  return state.pantsTemp?.[charaNum]?.[pieceId] ?? 0;
}

/** Whether any non-zero PANTS_TEMP bucket exists. */
function hasTempEntries(state: Readonly<GameState>): boolean {
  return Object.values(state.pantsTemp ?? {}).some((bucket) =>
    Object.values(bucket ?? {}).some((count) => count > 0),
  );
}

/** Keep FLAG:853 derived from PANTS_TEMP after every write. */
export function syncPantsTransitFlag(state: GameState): boolean {
  const active = hasTempEntries(state);
  state.flagStore[FLAG_PANTY_TRANSIT] = active ? 1 : 0;
  return active;
}

/** Add one freshly acquired panty to a character's PANTS_TEMP bucket. */
export function addPantsTemp(state: GameState, charaNum: number, pieceId: number): number {
  const bucket = ensureTemp(state, charaNum);
  bucket[pieceId] = (bucket[pieceId] ?? 0) + 1;
  syncPantsTransitFlag(state);
  return bucket[pieceId]!;
}

/**
 * Record a newly removed panty and apply the upstream automatic-gap rule.
 * `PANTS_GETTING` always records the item in PANTS_TEMP first; when FLAG:87
 * is enabled and a gap can be used, the same acquisition immediately moves
 * to permanent CFLAG storage.  No gift or new-game seed is implied here.
 */
export function acquirePants(
  state: GameState,
  charaNum: number,
  pieceId: number,
): { count: number; transferred: number } {
  const count = addPantsTemp(state, charaNum, pieceId);
  if ((state.flagStore[FLAG_PANTY_GAP_AUTO] ?? 0) === 0 || !hasPantyGapCharge(state)) {
    return { count, transferred: 0 };
  }
  return { count, transferred: transferPantsToGap(state, charaNum, pieceId) };
}

/** True when COM401 has something to transfer. */
export function hasPantsInTransit(state: Readonly<GameState>): boolean {
  return hasTempEntries(state);
}

// ---------------------------------------------------------------------------
// Names and collection projections
// ---------------------------------------------------------------------------

/** Resolve the authored/catalog name used by PANTSNAME for a collected type. */
export function pantyPieceName(_state: Readonly<GameState>, charaNum: number, pieceId: number): string {
  if (pieceId === 0) {
    return charaOutfit(charaNum)?.lowerUnderwear ?? "固有胖次";
  }
  return clothingName(EQUIP_SLOT.下半身内衣２, pieceId) || `胖次 #${pieceId}`;
}

export interface PantyCollectionRow {
  charaNum: number;
  name: string;
  pieceId: number;
  count: number;
  source: "permanent" | "transit";
}

export interface PermanentCollectionRow extends PantyCollectionRow {
  source: "permanent";
}

/** Permanent SHOW_COLLECTION projection, sorted like the upstream viewer. */
export function listPermanentCollection(state: Readonly<GameState>): PermanentCollectionRow[] {
  return Object.values(state.charas)
    .flatMap((slot) => Array.from({ length: MAXPANTS }, (_, pieceId) => {
      const count = slot.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0;
      return {
        charaNum: slot.charaNum,
        name: slot.callName ?? `#${slot.charaNum}`,
        pieceId,
        count,
        source: "permanent" as const,
      };
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.charaNum - b.charaNum || a.pieceId - b.pieceId);
}

/** Combined permanent + carried projection for the collection UI. */
export function listPantyCollection(state: Readonly<GameState>): PantyCollectionRow[] {
  const rows: PantyCollectionRow[] = listPermanentCollection(state).map((row) => ({ ...row }));
  for (const [charaRaw, bucket] of Object.entries(state.pantsTemp ?? {})) {
    const charaNum = Number(charaRaw);
    const name = state.charas[charaNum]?.callName ?? `#${charaNum}`;
    for (const [pieceRaw, count] of Object.entries(bucket ?? {})) {
      if (count <= 0) continue;
      rows.push({ charaNum, name, pieceId: Number(pieceRaw), count, source: "transit" });
    }
  }
  return rows.sort((a, b) => a.charaNum - b.charaNum || a.pieceId - b.pieceId || a.source.localeCompare(b.source));
}

/** Number of distinct permanent panty species (FLAG:700). */
export function recountSpecies(state: GameState): number {
  let count = 0;
  for (const slot of Object.values(state.charas)) {
    for (let pieceId = 0; pieceId < MAXPANTS; pieceId++) {
      if ((slot.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0) > 0) count++;
    }
  }
  state.flagStore[FLAG_PANTY_SPECIES] = count;
  return count;
}

// ---------------------------------------------------------------------------
// Collection bonuses (SHOP関連/BONUS2.ERB:581-780)
// ---------------------------------------------------------------------------

/** The eight ordinary (non-DLC-scaled) panty collection milestones. */
export const PANTY_COLLECTION_BONUSES = [
  { id: 1, threshold: 10, label: "￥10000·筹码200" },
  { id: 2, threshold: 30, label: "看穿欲求不满的少女程度的能力" },
  { id: 3, threshold: 100, label: "祭坛" },
  { id: 4, threshold: 300, label: "找出欲求不满的少女程度的能力" },
  { id: 5, threshold: 500, label: "最大气力+500" },
  { id: 6, threshold: 750, label: "最大体力+500" },
  { id: 7, threshold: 1000, label: "最大精力+500" },
  { id: 8, threshold: 2000, label: "最大TSP+500" },
] as const;

export type PantyCollectionBonusId = (typeof PANTY_COLLECTION_BONUSES)[number]["id"];

export interface PantyCollectionBonusStatus {
  id: PantyCollectionBonusId;
  threshold: number;
  label: string;
  claimed: boolean;
  available: boolean;
}

/** Project BONUS2's list view without writing state. */
export function listPantyCollectionBonuses(state: Readonly<GameState>): PantyCollectionBonusStatus[] {
  const species = state.flagStore[FLAG_PANTY_SPECIES] ?? 0;
  const mask = state.flagStore[FLAG_PANTY_BONUS] ?? 0;
  return PANTY_COLLECTION_BONUSES.map((bonus) => ({
    ...bonus,
    claimed: (mask & (1 << bonus.id)) !== 0,
    available: species >= bonus.threshold,
  }));
}

export interface PantyCollectionBonusClaim {
  ok: boolean;
  id: PantyCollectionBonusId;
  reason?: "unknown" | "not-ready" | "already-claimed";
  lines: string[];
}

function increaseMasterMaxBase(state: GameState, baseId: number, amount: number): void {
  const current = state.master.state.MAXBASE[baseId] ?? 0;
  state.master.state.MAXBASE[baseId] = current + amount;
}

/**
 * Claim one earned BONUS2 panty milestone.  Upstream claims are explicit from
 * the achievements screen, so crossing a threshold alone never grants a
 * reward.  The modern action calls this on a cloned state and appends `lines`
 * to the normal narration log.
 */
export function claimPantyCollectionBonus(
  state: GameState,
  id: number,
): PantyCollectionBonusClaim {
  const definition = PANTY_COLLECTION_BONUSES.find((bonus) => bonus.id === id);
  if (!definition) return { ok: false, id: id as PantyCollectionBonusId, reason: "unknown", lines: [] };

  const species = state.flagStore[FLAG_PANTY_SPECIES] ?? recountSpecies(state);
  const bit = 1 << definition.id;
  const mask = state.flagStore[FLAG_PANTY_BONUS] ?? 0;
  if ((mask & bit) !== 0) {
    return { ok: false, id: definition.id, reason: "already-claimed", lines: [] };
  }
  if (species < definition.threshold) {
    return { ok: false, id: definition.id, reason: "not-ready", lines: [] };
  }

  state.flagStore[FLAG_PANTY_BONUS] = mask | bit;
  const lines: string[] = [];
  switch (definition.id) {
    case 1:
      state.money += 10_000;
      state.casinoChips = (state.casinoChips ?? 0) + 200;
      lines.push("获得了￥10000和筹码200。");
      break;
    case 2:
      state.master.state.TALENT[TALENT_ID.劣情察知] =
        (state.master.state.TALENT[TALENT_ID.劣情察知] ?? 0) | 1;
      lines.push("因为收集了许多胖次，获得了看穿欲求不满的少女程度的能力。");
      break;
    case 3:
      addItem(state, ITEM_ID.祭壇, 1);
      lines.push("为了更好的收集胖次而被赐予祭坛。可以在自室祈愿和聆听天之声了。");
      break;
    case 4:
      state.master.state.TALENT[TALENT_ID.劣情察知] =
        (state.master.state.TALENT[TALENT_ID.劣情察知] ?? 0) | 2;
      lines.push("因为收集了大量的胖次，获得了找出欲求不满的少女程度的能力。");
      break;
    case 5:
      increaseMasterMaxBase(state, BASE_ID.気力, 500);
      lines.push("气力的上限提升了。");
      break;
    case 6:
      increaseMasterMaxBase(state, BASE_ID.体力, 500);
      lines.push("体力的上限提升了。");
      break;
    case 7:
      increaseMasterMaxBase(state, BASE_ID.精力, 500);
      lines.push("精力的上限提升了。");
      break;
    case 8:
      increaseMasterMaxBase(state, BASE_ID.TSP, 500);
      lines.push("TSP上限增加了。");
      break;
  }
  return { ok: true, id: definition.id, lines };
}

/** Sell every duplicate in permanent collection, retaining one of each. */
export function spendCollectionDuplicates(state: GameState): number {
  let sold = 0;
  for (const slot of Object.values(state.charas)) {
    for (let pieceId = 0; pieceId < MAXPANTS; pieceId++) {
      const key = pieceId + PANTS_MGMT_OFFSET;
      const count = slot.state.CFLAG[key] ?? 0;
      if (count <= 1) continue;
      sold += count - 1;
      slot.state.CFLAG[key] = 1;
    }
  }
  if (sold > 0) state.money += sold * 100;
  recountSpecies(state);
  return sold;
}

// ---------------------------------------------------------------------------
// Portable collection gap (PANTS_SUKIMA)
// ---------------------------------------------------------------------------

function atHome(state: Readonly<GameState>): boolean {
  const home = state.homeLocation ?? state.master.homeLocation;
  return Boolean(home && state.master.location === home);
}

/** Whether one carried panty can currently be sent through the gap. */
export function canSendPantsToGap(state: Readonly<GameState>): boolean {
  return atHome(state) || itemCount(state, ITEM_PANTY_GAP) > 0;
}

/** Whether PANTS_GETTING may offer the portable gap right now. The upstream
 * acquisition path is entered only when ITEM:收藏隙間 is positive; at-home
 * COM401/SHOW_HAVE_COLLECTION can still call PANTS_SUKIMA without consuming a
 * charge, but a zero-charge pickup must remain ordinary transit. */
export function hasPantyGapCharge(state: Readonly<GameState>): boolean {
  return itemCount(state, ITEM_PANTY_GAP) > 0;
}

/**
 * Move one PANTS_TEMP bucket into permanent CFLAG storage.  Away from home
 * this consumes one ITEM:400; at home the upstream path does not consume a
 * gap charge.  Returns the number transferred (0 when the request is unsafe).
 */
export function transferPantsToGap(
  state: GameState,
  charaNum: number,
  pieceId: number,
): number {
  const temp = getPantsTemp(state, charaNum, pieceId);
  const chara = state.charas[charaNum];
  if (temp <= 0 || !chara || !canSendPantsToGap(state)) return 0;

  const key = pieceId + PANTS_MGMT_OFFSET;
  const wasEmpty = (chara.state.CFLAG[key] ?? 0) <= 0;
  chara.state.CFLAG[key] = (chara.state.CFLAG[key] ?? 0) + temp;
  state.pantsTemp![charaNum]![pieceId] = 0;
  if (!atHome(state)) removeItem(state, ITEM_PANTY_GAP, 1);
  if (wasEmpty) state.flagStore[FLAG_PANTY_SPECIES] = (state.flagStore[FLAG_PANTY_SPECIES] ?? 0) + 1;
  syncPantsTransitFlag(state);
  return temp;
}

/** Transfer every carried bucket (the explicit COM401 home action). */
export function commitPantsCollection(state: GameState): string[] {
  const lines: string[] = [];
  for (const [charaRaw, bucket] of Object.entries(state.pantsTemp ?? {})) {
    const charaNum = Number(charaRaw);
    const slot = state.charas[charaNum];
    if (!slot) continue;
    for (const [pieceRaw, count] of Object.entries(bucket ?? {})) {
      if (count <= 0) continue;
      const pieceId = Number(pieceRaw);
      const oldCount = getCollectionCount(state, charaNum, pieceId);
      transferPantsTemp(state, charaNum, pieceId);
      if (oldCount <= 0) {
        lines.push(`在收藏中追加了${slot.callName ?? `#${charaNum}`}的${pantyPieceName(state, charaNum, pieceId)}`);
      } else {
        lines.push(`在收藏中追加了${slot.callName ?? `#${charaNum}`}的${pantyPieceName(state, charaNum, pieceId)} ×${count}`);
      }
    }
  }
  recountSpecies(state);
  syncPantsTransitFlag(state);
  lines.push(`现在收藏有${state.flagStore[FLAG_PANTY_SPECIES] ?? 0}种`);
  return lines;
}

/** Get permanent collection count for a chara + panty type. */
export function getCollectionCount(state: GameState, charaNum: number, pieceId: number): number {
  return state.charas[charaNum]?.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0;
}

/** Transfer a single temp bucket without location/item checks (COM401 helper). */
export function transferPantsTemp(state: GameState, charaNum: number, pieceId: number): number {
  const temp = getPantsTemp(state, charaNum, pieceId);
  const chara = state.charas[charaNum];
  if (temp <= 0 || !chara) return 0;
  const key = pieceId + PANTS_MGMT_OFFSET;
  chara.state.CFLAG[key] = (chara.state.CFLAG[key] ?? 0) + temp;
  state.pantsTemp![charaNum]![pieceId] = 0;
  syncPantsTransitFlag(state);
  return temp;
}

/** Result of the daily portable-gap replenishment at the morning boundary. */
export interface PantyGapReplenishResult {
  amount: number;
  total: number;
  period: number;
}

/**
 * Reproduce `BEFORETRAIN.ERB:443-456` for the ordinary game path.
 * The first morning grants 200 charges; a missed interval grants 40 per
 * elapsed period, capped at 1500.  This is a system refill only — it does not
 * model a gift, shop purchase, or new-game inventory seed.
 */
export function replenishPantyGap(state: GameState): PantyGapReplenishResult {
  const period = Math.max(1, state.time.dayIndex + 1);
  const last = state.flagStore[FLAG_PANTY_GAP] ?? 0;
  if (last === period) {
    return { amount: 0, total: itemCount(state, ITEM_PANTY_GAP), period };
  }

  const amount = last < period ? 200 : Math.max(0, (last - period) * 40);
  const before = itemCount(state, ITEM_PANTY_GAP);
  addItem(state, ITEM_PANTY_GAP, amount, 1500);
  state.flagStore[FLAG_PANTY_GAP] = period;
  return {
    amount: Math.max(0, itemCount(state, ITEM_PANTY_GAP) - before),
    total: itemCount(state, ITEM_PANTY_GAP),
    period,
  };
}

/** Spend one carried panty for COMF430 (着替える). */
export function spendPantsTemp(state: GameState, charaNum: number, pieceId: number): boolean {
  if (getPantsTemp(state, charaNum, pieceId) <= 0) return false;
  state.pantsTemp![charaNum]![pieceId] = getPantsTemp(state, charaNum, pieceId) - 1;
  syncPantsTransitFlag(state);
  return true;
}
