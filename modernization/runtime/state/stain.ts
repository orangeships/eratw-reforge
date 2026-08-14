/**
 * STAIN — body-soil subsystem. Faithful port of eraTW `STAIN:chara:part`
 * (`CSV/Stain.csv` + `ERB/ステータス計算関連/STAIN.ERB` +
 * `ERB/ステータス表示関連/INFO.ERB:202-240`).
 *
 * **Data model**: each character has an 8-part body-soil bitmask array.
 *   - Parts (`Stain.csv`): 0=口 1=手 2=Ｐ 3=Ｖ 4=Ａ 5=Ｂ 6=膣内 7=腸内
 *   - Soil bits (`Stain.csv` bit legend): 1=愛液 2=陰茎 4=精液 8=肛門
 *     16=母乳 32=黏液 64=破瓜之血 128=巧克力
 *
 * A part's value is the OR of the soil bits present on it; 0 = clean.
 * Stored as `state.STAIN[partId]` (sparse — a missing part reads as 0).
 *
 * **Three operations** ported here:
 *   1. Bit accessors (`getStain`/`hasStainBit`/`setStainBit`/`clearStain`).
 *   2. Insertion swaps (`stainSwapInsertV`/`stainSwapInsertA` = `@STAIN_膣内Ｐ挿入`/
 *      `@STAIN_肛門Ｐ挿入`): V/A-internal ⇔ master-Ｐ soil transfer, condom-gated
 *      (`TEQUIP:PLAYER:避孕套`). Defloration blood (64) is added to 膣内 on V
 *      insertion if the target is a virgin (`TALENT:処女` 1 or 2).
 *   3. Display (`stainInfo` = `@INFO_CHARA_STAIN`): one line per part listing
 *      present soil tags, gender-gated (Ｐ only if has-penis bit1 of 性別;
 *      Ｖ/Ｂ only if has-vagina bit0). Used by the ExComPanel 汚れ显示.
 *
 * **Not ported here** (per-command, see slice 2 + 3):
 *   - The `不潔` SOURCE conditional chain (STAIN-bit checks + 汚臭耐性/自尊心
 *     multipliers) — ported per-command in slice 2 (comf0/10/...).
 *   - Kiss/petting contact swaps — wired per-command in slice 3.
 *   - Natural time-decay — eraTW applies no per-tick STAIN decay (soil only
 *     clears on bath/water-drawing); faithful = no decay.
 *   - ASSI (assistant) STAIN — ASSI concept not modeled.
 */

import type { CharaSlot } from "./game-state.js";
import { TALENT_ID, TEQUIP_ID } from "./settlement.js";
import { readTequip } from "./tequip.js";

// =====================================================================
// Constants — `Stain.csv` (body parts) + bit legend
// =====================================================================

/** Body-part ids (`Stain.csv`). */
export const STAIN_PART = {
  口: 0,
  手: 1,
  Ｐ: 2,
  Ｖ: 3,
  Ａ: 4,
  Ｂ: 5,
  膣内: 6,
  腸内: 7,
} as const;

/** Soil-type bits (`Stain.csv` bit legend). */
export const STAIN_BIT = {
  愛液: 1,
  陰茎: 2,
  精液: 4,
  肛門: 8,
  母乳: 16,
  黏液: 32,
  破瓜之血: 64,
  巧克力: 128,
} as const;

/** TEQUIP id for 避孕套 (condom) — `TEQUIP:PLAYER:避孕套` (Tequip.csv 35).
 *  EraTW gates insertion swaps on this; we read the master's `state.TEQUIP[35]`
 *  (per-chara equipment namespace, see `state/tequip.ts`). */
const EQUIP_CONDOM = TEQUIP_ID.避孕套;

// =====================================================================
// Bit accessors
// =====================================================================

/** Read a part's soil bitmask (0 = clean / part not in map). */
export function getStain(slot: CharaSlot, part: number): number {
  return slot.state.STAIN[part] ?? 0;
}

/** Is soil-bit `bit` present on `part`? */
export function hasStainBit(slot: CharaSlot, part: number, bit: number): boolean {
  return (getStain(slot, part) & bit) !== 0;
}

/** Set (OR) one soil bit onto a part. Mutates `slot.state.STAIN` in place. */
export function setStainBit(slot: CharaSlot, part: number, bit: number): void {
  slot.state.STAIN[part] = getStain(slot, part) | bit;
}

/** Clear all soil from a part (set to 0). Mutates in place. */
export function clearStain(slot: CharaSlot, part: number): void {
  slot.state.STAIN[part] = 0;
}

/** Clear ALL parts (full wash — bath). Mutates in place. */
export function clearAllStain(slot: CharaSlot): void {
  for (let p = 0; p < 8; p++) slot.state.STAIN[p] = 0;
}

/** OR one part's soil onto another part (one-way soil transfer). */
function transferStain(slot: CharaSlot, fromPart: number, toPart: number): void {
  slot.state.STAIN[toPart] = getStain(slot, toPart) | getStain(slot, fromPart);
}

// =====================================================================
// Insertion swaps — `@STAIN_膣内Ｐ挿入` / `@STAIN_肛門Ｐ挿入` (STAIN.ERB)
// =====================================================================

/**
 * `@STAIN_膣内Ｐ挿入` (STAIN.ERB:1-11) — V-insertion soil swap between the
 * target (膣内/Ｖ) and the master (Ｐ). If the target is a virgin
 * (`TALENT:処女` 1 or 2), 破瓜之血 (64) is added to 膣内. If the master is
 * NOT wearing a condom (EQUIP[35]==0), soil is bidirectionally swapped:
 * master-Ｐ |= target-Ｖ | target-膣内; then target-Ｖ |= target-膣内 |=
 * master-Ｐ. (Matches the ERB `|=` chain exactly — note it is NOT a true
 * swap, it's a mutual OR that leaves both sides with the union.)
 *
 * Mutates both slots in place.
 */
export function stainSwapInsertV(target: CharaSlot, master: CharaSlot): void {
  // ERB 3-4: virgin → 破瓜之血 on 膣内.
  const virgin = target.state.TALENT[TALENT_ID.処女] ?? 0;
  if (virgin === 1 || virgin === 2) {
    setStainBit(target, STAIN_PART.膣内, STAIN_BIT.破瓜之血);
  }
  // ERB 5: condom-gated. !TEQUIP:PLAYER:避孕套 → swap.
  const condom = readTequip(master, EQUIP_CONDOM);
  if (condom !== 0) return;
  // ERB 7-10: mutual OR chain (master-Ｐ ⇔ target-Ｖ/膣内).
  master.state.STAIN[STAIN_PART.Ｐ] =
    getStain(master, STAIN_PART.Ｐ) | getStain(target, STAIN_PART.Ｖ) | getStain(target, STAIN_PART.膣内);
  target.state.STAIN[STAIN_PART.Ｖ] =
    getStain(target, STAIN_PART.Ｖ) | getStain(master, STAIN_PART.Ｐ);
  target.state.STAIN[STAIN_PART.膣内] =
    getStain(target, STAIN_PART.膣内) | getStain(master, STAIN_PART.Ｐ);
}

/**
 * `@STAIN_肛門Ｐ挿入` (STAIN.ERB:13-20) — A-insertion soil swap between
 * the target (Ａ/腸内) and the master (Ｐ), condom-gated. Same mutual-OR
 * shape as the V swap, no virgin-blood arm.
 *
 * Mutates both slots in place.
 */
export function stainSwapInsertA(target: CharaSlot, master: CharaSlot): void {
  const condom = readTequip(master, EQUIP_CONDOM);
  if (condom !== 0) return;
  master.state.STAIN[STAIN_PART.Ｐ] =
    getStain(master, STAIN_PART.Ｐ) | getStain(target, STAIN_PART.Ａ) | getStain(target, STAIN_PART.腸内);
  target.state.STAIN[STAIN_PART.Ａ] =
    getStain(target, STAIN_PART.Ａ) | getStain(master, STAIN_PART.Ｐ);
  target.state.STAIN[STAIN_PART.腸内] =
    getStain(target, STAIN_PART.腸内) | getStain(master, STAIN_PART.Ｐ);
}

// =====================================================================
// Display — `@INFO_CHARA_STAIN` (INFO.ERB:215-240)
// =====================================================================

/** Part display names, indexed by part id (`INFO.ERB:213`). */
const PARTS_NAME = ["口", "手", "Ｐ", "Ｖ", "Ａ", "Ｂ", "膣内", "腸内"];

/** Soil-tag display names, indexed by bit-position (`INFO.ERB:214`). */
const STAIN_NAME = ["爱液", "阴茎", "精液", "肛门", "母乳", "黏液", "破瓜之血", "巧克力"];

/**
 * `@INFO_CHARA_STAIN(C_ID)` (INFO.ERB:215-240) — one display line per
 * non-empty part, listing present soil tags. Parts are gender-gated:
 *   - Ｐ shown only if the chara has a penis (`TALENT:性別` bit1).
 *   - Ｖ/Ｂ shown only if the chara has a vagina (`TALENT:性別` bit0).
 * Returns the lines joined by newline (no trailing WAIT). Empty string if
 * the chara is fully clean.
 */
export function stainInfo(slot: CharaSlot): string {
  const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
  const hasPenis = (gender & 2) !== 0;
  const hasVagina = (gender & 1) !== 0;
  const lines: string[] = [];
  for (let part = 0; part < 8; part++) {
    // Gender gate (INFO.ERB:225-228).
    if (PARTS_NAME[part] === "Ｐ" && !hasPenis) continue;
    if ((PARTS_NAME[part] === "Ｖ" || PARTS_NAME[part] === "Ｂ") && !hasVagina) continue;
    const soil = getStain(slot, part);
    if (soil === 0) continue;
    const tags: string[] = [];
    for (let bit = 0; bit < 8; bit++) {
      if ((soil & (1 << bit)) !== 0) tags.push(STAIN_NAME[bit]!);
    }
    // 巧克力 + 母乳 → 巧克力奶汁 (INFO.ERB:233-238).
    if ((soil & STAIN_BIT.巧克力) !== 0 && (soil & STAIN_BIT.母乳) !== 0) {
      // Replace the two separate tags with the combined one.
      const filtered = tags.filter((t) => t !== "巧克力" && t !== "母乳");
      lines.push(`　${PARTS_NAME[part]}：<${filtered.join("><")}>${filtered.length ? "" : ""}<巧克力奶汁>`);
      continue;
    }
    lines.push(`　${PARTS_NAME[part]}：<${tags.join("><")}>`);
  }
  return lines.join("\n");
}

// Suppress unused-export lint for the one-way transfer helper (kept for
// slice 3 kiss/petting swaps; not yet called here).
void transferStain;
