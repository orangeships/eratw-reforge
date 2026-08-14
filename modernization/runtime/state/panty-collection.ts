/**
 * P4 — Panty collection system (PANTS_TEMP + permanent CFLAG storage).
 *
 * Upstream anchors:
 *   - `衣服/PANTS.ERB` — PANTS_GET, PANTS_GETTING, PANTS_SUKIMA
 *   - `COMF401 コレクション.ERB` — transfer PANTS_TEMP → CFLAG permanent
 *   - `DIM.ERH:218-219` — MAXPANTS=34, 胖次管理=100
 *   - `DIM.ERH:413` — PANTS_TEMP SAVEDATA array
 *
 * Data model:
 *   - `pantsTemp[charaNum][pantyPieceId]` — freshly acquired panties,
 *      held in-memory until the player runs COMF401 at home.
 *   - Permanent: `CFLAG[charaNum][pantyPieceId + PANTS_MGMT_OFFSET]` —
 *      permanent collection count per chara per panty type.
 *   - `FLAG:700` — total unique panty species collected.
 *   - `FLAG:853` (胖次輸送) — set when panties are in PANTS_TEMP,
 *      cleared by COMF401. Gates the collection command.
 *
 * Flow:
 *   1. pantyGet() or other source → incr pantsTemp
 *   2. FLAG:胖次輸送 = 1
 *   3. COMF401 at home → transfer pantsTemp to CFLAG, count species,
 *      clear pantsTemp, clear FLAG:胖次輸送
 *
 * Deferred (P4+):
 *   - COMF444 物色する (mob girl generator)
 *   - ITEM:收藏隙間 (portable auto-transfer item)
 *   - COMF430 着替える (spend PANTS_TEMP to change underwear)
 *   - FLAG:705 胖次BONUS (collection milestone rewards)
 *   - 風で飛んでくる (wind-blown panties, weather system)
 *   - ボッシュート (confiscation event)
 *   - SHOP_COLLECTION viewer (shop UI for browsing collection)
 */

import type { GameState } from "./game-state.js";

// ---------------------------------------------------------------------------
// Constants (mirror DIM.ERH)
// ---------------------------------------------------------------------------

/** Maximum panty piece id (0-indexed, so 34 slots: 0..33). */
export const MAXPANTS = 34;
/** CFLAG offset for permanent collection storage: CFLAG[ch][id + 100] = count. */
export const PANTS_MGMT_OFFSET = 100;

// ---------------------------------------------------------------------------
// FLAG IDs (mirror FLAG.csv)
// ---------------------------------------------------------------------------

/** FLAG:700 — total unique panty species in permanent collection. */
export const FLAG_PANTY_SPECIES = 700;
/** FLAG:705 — bitmask of claimed collection bonuses. */
export const FLAG_PANTY_BONUS = 705;
/** FLAG:853 — panties are in transit (PANTS_TEMP non-empty). */
export const FLAG_PANTY_TRANSIT = 853;

// ---------------------------------------------------------------------------
// PANTS_TEMP accessors
// ---------------------------------------------------------------------------

/** Ensure a chara's PANTS_TEMP bucket exists (lazy-init). */
function ensureTemp(state: GameState, charaNum: number): Record<number, number> {
  let pt = (state as any).pantsTemp as Record<number, Record<number, number>> | undefined;
  if (!pt) pt = (state as any).pantsTemp = {};
  if (!pt[charaNum]) pt[charaNum] = {};
  return pt[charaNum]!;
}

/** Get the count of panty type `pieceId` in PANTS_TEMP for a chara. */
export function getPantsTemp(state: GameState, charaNum: number, pieceId: number): number {
  const pt = (state as any).pantsTemp as Record<number, Record<number, number>> | undefined;
  return pt?.[charaNum]?.[pieceId] ?? 0;
}

/** Increment PANTS_TEMP for a chara + panty type. Returns the new count. */
export function addPantsTemp(state: GameState, charaNum: number, pieceId: number): number {
  const bucket = ensureTemp(state, charaNum);
  bucket[pieceId] = (bucket[pieceId] ?? 0) + 1;
  // Set transit flag
  state.flagStore[FLAG_PANTY_TRANSIT] = 1;
  return bucket[pieceId]!;
}

/** Check if any chara has panties in PANTS_TEMP (for gate checks). */
export function hasPantsInTransit(state: GameState): boolean {
  const val = state.flagStore[FLAG_PANTY_TRANSIT];
  return val !== undefined && val !== 0;
}

// ---------------------------------------------------------------------------
// Permanent collection (CFLAG-based)
// ---------------------------------------------------------------------------

/** Get permanent collection count for a chara + panty type. */
export function getCollectionCount(
  state: GameState,
  charaNum: number,
  pieceId: number,
): number {
  return state.charas[charaNum]?.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0;
}

export interface PermanentCollectionRow {
  charaNum: number;
  name: string;
  pieceId: number;
  count: number;
}

/** Read-only SHOW_COLLECTION projection for adapters; sorted by chara/piece. */
export function listPermanentCollection(state: Readonly<GameState>): PermanentCollectionRow[] {
  return Object.values(state.charas)
    .flatMap((slot) => Array.from({ length: MAXPANTS }, (_, pieceId) => ({
      charaNum: slot.charaNum,
      name: slot.callName ?? `#${slot.charaNum}`,
      pieceId,
      count: slot.state.CFLAG[pieceId + PANTS_MGMT_OFFSET] ?? 0,
    })))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.charaNum - b.charaNum || a.pieceId - b.pieceId);
}

/** Transfer PANTS_TEMP → permanent CFLAG storage for a single chara + type. */
export function transferPantsTemp(
  state: GameState,
  charaNum: number,
  pieceId: number,
): number {
  const temp = getPantsTemp(state, charaNum, pieceId);
  if (temp <= 0) return 0;
  const chara = state.charas[charaNum];
  if (!chara) return 0;
  const cflagKey = pieceId + PANTS_MGMT_OFFSET;
  chara.state.CFLAG[cflagKey] = (chara.state.CFLAG[cflagKey] ?? 0) + temp;
  // Clear temp
  const bucket = state.pantsTemp?.[charaNum];
  if (bucket) bucket[pieceId] = 0;
  return temp;
}

/** Count unique species in permanent collection across all charas.
 *  Also updates FLAG:700 in place. */
export function recountSpecies(state: GameState): number {
  let count = 0;
  for (const [, slot] of Object.entries(state.charas)) {
    const cflag = slot.state.CFLAG;
    for (let i = 0; i < MAXPANTS; i++) {
      if ((cflag[i + PANTS_MGMT_OFFSET] ?? 0) > 0) {
        count++;
      }
    }
  }
  state.flagStore[FLAG_PANTY_SPECIES] = count;
  return count;
}

// ---------------------------------------------------------------------------
// COMF401: Transfer all PANTS_TEMP → permanent collection
// ---------------------------------------------------------------------------

/**
 * Execute the COMF401 collection transfer. Iterates all charas × all panty
 * types (0..MAXPANTS), moves each temp count to permanent CFLAG, reports
 * the additions, and resets the transit flag.
 *
 * Returns human-readable narration lines for each transfer.
 */
export function commitPantsCollection(state: GameState): string[] {
  const lines: string[] = [];
  // Reset species count before recount
  state.flagStore[FLAG_PANTY_SPECIES] = 0;

  for (const [charaNumStr, slot] of Object.entries(state.charas)) {
    const ch = Number(charaNumStr);
    const bucket = state.pantsTemp?.[ch];
    if (!bucket) continue;
    const name = slot.callName ?? `#${ch}`;
    for (const [pieceIdStr, count] of Object.entries(bucket)) {
      if (count <= 0) continue;
      const pid = Number(pieceIdStr);
      transferPantsTemp(state, ch, pid);
      // Report: only if this is a new species (was 0 before)
      const cflagKey = pid + PANTS_MGMT_OFFSET;
      if ((slot.state.CFLAG[cflagKey] ?? 0) > 0) {
        lines.push(`在收藏中追加了${name}的胖次 #${pid}`);
      }
    }
  }

  recountSpecies(state);
  state.flagStore[FLAG_PANTY_TRANSIT] = 0;

  const species = state.flagStore[FLAG_PANTY_SPECIES] ?? 0;
  lines.push(`现在收藏有${species}种`);
  return lines;
}
