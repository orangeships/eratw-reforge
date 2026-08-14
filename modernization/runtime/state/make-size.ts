/**
 * SIZE engine — 身長/体重/三围 computation + 身体測定 command support.
 *
 * Faithful port of `ERB/ステータス表示関連/SIZE.ERB`:
 *  - `@MAKE_SIZE` (line 15): coefficients `MAXBASE:20..24` are generated when
 *    `CFLAG:身体測定 == 2` (re-measure requested) or `== 1` with unset
 *    coefficients: `CSVBASE(20..24)` (0 in every chara CSV in this repo →
 *    default 1000) × RAND(950,1050)/1000. The measurements `BASE:20..24` are
 *    then recomputed deterministically from 身長基準 (male 1700 / else 1500)
 *    × coefficient ×体型/胸围/ヒップサイズ/魅力 modifiers — every call, so
 *    ABL:Ｂ感覚 growth etc. shows up live.
 *  - `@PRINT_CUPSIZE` (line 202): cup = (胸围 − 身長×43/100) / 25 clamped
 *    0..30 over the (-)…(规格外) ladder.
 *  - `@SHOW_SIZE` (line 133): CFLAG:身体測定 == 0 ⇒ 「未测定」; master with
 *    性別==2 hides 身長/体重 (???); 性別==2 hides the three围 line; 妊娠 adds
 *    weight/waist offsets (kept — gates false while pregnancy is unported).
 *  - `@SOMATOMETRY` (USERCOM.ERB:837, command 824 [身体測定]): runs MAKE_SIZE,
 *    sets 身体測定=1, shows the panel; "再测定一次" sets =2 and reruns.
 *
 * Values are in upstream units: lengths in mm (display /10 = cm),
 * weight in 100g (display /10 = kg).
 *
 * TIMES semantics: `TIMES X, 1.10` = trunc(X * f) — see memory
 * `eratw-emuera-language-semantics`; implemented as Math.trunc.
 */

import type { CharaSlot } from "./game-state.js";
import { ABL_ID, BASE_ID, CFLAG_ID, TALENT_ID } from "./settlement.js";

/** trunc-style TIMES (Emuera: TIMES X, f = trunc(X*f)). */
function times(x: number, f: number): number {
  return Math.trunc(x * f);
}

/**
 * Generate the MAXBASE:20..24 coefficients if needed (MAKE_SIZE head).
 * `rng()` ∈ [0,1). CSVBASE 20..24 is 0 for every chara in this repo, so the
 * base coefficient is always 1000 (the SIF ==0 fallback), jittered ±5%.
 */
export function ensureSizeCoefficients(slot: CharaSlot, rng: () => number): void {
  const st = slot.state;
  const flag = st.CFLAG[CFLAG_ID.身体測定] ?? 0;
  const unset =
    !(st.MAXBASE[BASE_ID.身長] ?? 0) ||
    !(st.MAXBASE[BASE_ID.体重] ?? 0) ||
    !(st.MAXBASE[BASE_ID.胸圍] ?? 0) ||
    !(st.MAXBASE[BASE_ID.腰圍] ?? 0) ||
    !(st.MAXBASE[BASE_ID.臀圍] ?? 0);
  if (flag === 2 || (flag === 1 && unset)) {
    for (const id of [BASE_ID.身長, BASE_ID.体重, BASE_ID.胸圍, BASE_ID.腰圍, BASE_ID.臀圍]) {
      // CSVBASE is 0 upstream-wide → 1000; × RAND(950,1050)/1000.
      const rand = 950 + Math.trunc(rng() * 101); // RAND(950,1050) inclusive-exclusive → 950..1050
      st.MAXBASE[id] = Math.trunc((1000 * rand) / 1000);
    }
  }
}

/** Recompute BASE:20..24 from the coefficients + TALENT modifiers (MAKE_SIZE body). */
export function makeSize(slot: CharaSlot): void {
  const st = slot.state;
  const t = (id: number) => st.TALENT[id] ?? 0;
  const coeff = (id: number) => st.MAXBASE[id] || 1000;

  // === 身長 ===
  let height = t(TALENT_ID.性別) === 2 ? 1700 : 1500;
  height = Math.trunc((height * coeff(BASE_ID.身長)) / 1000);
  const 体型 = t(TALENT_ID.体型);
  if (体型 === -2) height = times(height, 0.8);
  else if (体型 === -1) height = times(height, 0.9);
  else if (体型 === 1) height = times(height, 1.1);
  else if (体型 === 2) height = times(height, 1.2);
  else if (体型 === 3) height = times(height, 1.5);
  st.BASE[BASE_ID.身長] = height;

  // === 腰圍 ===
  let waist = Math.trunc((height * 40) / 100);
  waist = Math.trunc((waist * coeff(BASE_ID.腰圍)) / 1000);
  if (体型 === -2) waist = times(waist, 1.16);
  else if (体型 === -1) waist = times(waist, 1.08);
  if (t(TALENT_ID.魅力)) waist = times(waist, 0.95);
  st.BASE[BASE_ID.腰圍] = waist;

  // === 胸围 ===
  let bust = Math.trunc((height * 51) / 100);
  bust = Math.trunc((bust * coeff(BASE_ID.胸圍)) / 1000);
  const cup = t(TALENT_ID.胸围);
  if (cup === -2) bust = times(bust, 0.84);
  else if (cup === -1) bust = times(bust, 0.92);
  else if (cup === 1) bust = times(bust, 1.08);
  else if (cup === 2) bust = times(bust, 1.16);
  bust = Math.trunc((bust * (1000 + Math.min(st.ABL[ABL_ID.Ｂ感覚] ?? 0, 100))) / 1000);
  if (t(TALENT_ID.魅力)) bust = times(bust, 1.05);
  bust = Math.max(Math.trunc((height * 43) / 100), bust); // アンダー floor
  st.BASE[BASE_ID.胸圍] = bust;

  // === 臀圍 ===
  let hip = Math.trunc((height * 53) / 100);
  hip = Math.trunc((hip * coeff(BASE_ID.臀圍)) / 1000);
  const hipSize = t(TALENT_ID.ヒップサイズ);
  if (hipSize === -2) hip = times(hip, 0.84);
  else if (hipSize === -1) hip = times(hip, 0.92);
  else if (hipSize === 1) hip = times(hip, 1.08);
  else if (hipSize === 2) hip = times(hip, 1.16);
  if (t(TALENT_ID.魅力)) hip = times(hip, 1.05);
  st.BASE[BASE_ID.臀圍] = hip;

  // === 体重 ===
  let weight = Math.trunc((height * height) / 5000);
  weight = Math.trunc((weight * coeff(BASE_ID.体重)) / 1000);
  if (体型 === -2) weight = times(weight, 0.8);
  else if (体型 === -1) weight = times(weight, 0.9);
  else if (体型 === 1) weight = times(weight, 1.1);
  else if (体型 === 2) weight = times(weight, 1.2);
  else if (体型 === 3) weight = times(weight, 1.5);
  else if (体型 === 5) weight = times(weight, 10.0);
  if (t(TALENT_ID.魅力)) weight = times(weight, 0.95);
  st.BASE[BASE_ID.体重] = weight;
}

const CUP_LADDER = [
  "(-)", "(AAA)", "(AA)", "(A)", "(B)", "(C)", "(D)", "(E)", "(F)", "(G)",
  "(H)", "(I)", "(J)", "(K)", "(L)", "(M)", "(N)", "(O)", "(P)", "(Q)",
  "(R)", "(S)", "(T)", "(U)", "(V)", "(W)", "(X)", "(Y)", "(Z)", "(Z+)",
  "(规格外)",
] as const;

/** `@PRINT_CUPSIZE` — cup letter from bust vs height. */
export function cupSize(slot: CharaSlot): string {
  const st = slot.state;
  const bust = st.BASE[BASE_ID.胸圍] ?? 0;
  const height = st.BASE[BASE_ID.身長] ?? 0;
  let idx = Math.trunc((bust - Math.trunc((height * 43) / 100)) / 25);
  if ((st.TALENT[TALENT_ID.体型] ?? 0) === -5) idx = Math.trunc(idx * 0.1);
  idx = Math.max(0, Math.min(30, idx));
  return CUP_LADDER[idx]!;
}

export interface SizePanel {
  measured: boolean;
  /** Master with 性別==2 hides height/weight (`身高:???cm 体重:??kg`). */
  heightMasked: boolean;
  /** mm → display as `cm` with /10. */
  heightMm?: number;
  /** 100g units → display as kg with /10. */
  weight100g?: number;
  /** 性別==2 ⇒ no 三围 line (upstream hides it for [男人]). */
  showMeasurements: boolean;
  bustMm?: number;
  cup?: string;
  waistMm?: number;
  hipMm?: number;
}

/** `@SHOW_SIZE` (SIZE.ERB:133) — the panel data. Recomputes sizes when measured. */
export function buildSizePanel(slot: CharaSlot): SizePanel {
  const st = slot.state;
  if ((st.CFLAG[CFLAG_ID.身体測定] ?? 0) === 0) {
    return { measured: false, heightMasked: false, showMeasurements: false };
  }
  makeSize(slot);
  const gender = st.TALENT[TALENT_ID.性別] ?? 0;
  const heightMasked = slot.charaNum === 0 && gender === 2;
  const showMeasurements = gender !== 2;
  return {
    measured: true,
    heightMasked,
    heightMm: st.BASE[BASE_ID.身長],
    weight100g: st.BASE[BASE_ID.体重],
    showMeasurements,
    bustMm: showMeasurements ? st.BASE[BASE_ID.胸圍] : undefined,
    cup: showMeasurements ? cupSize(slot) : undefined,
    waistMm: showMeasurements ? st.BASE[BASE_ID.腰圍] : undefined,
    hipMm: showMeasurements ? st.BASE[BASE_ID.臀圍] : undefined,
  };
}

/**
 * `@SOMATOMETRY` (USERCOM.ERB:837) — run a measurement on `slot`.
 * `remeasure` mirrors the "再测定一次" branch: sets 身体測定=2 so
 * ensureSizeCoefficients regenerates before recomputing.
 */
export function somatometry(slot: CharaSlot, rng: () => number, remeasure = false): SizePanel {
  const st = slot.state;
  if (remeasure) st.CFLAG[CFLAG_ID.身体測定] = 2;
  else if ((st.CFLAG[CFLAG_ID.身体測定] ?? 0) === 0) st.CFLAG[CFLAG_ID.身体測定] = 2;
  ensureSizeCoefficients(slot, rng);
  st.CFLAG[CFLAG_ID.身体測定] = 1;
  makeSize(slot);
  return buildSizePanel(slot);
}
