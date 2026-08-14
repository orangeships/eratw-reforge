/**
 * Phase 7 — shared SOURCE sub-formula primitives for the "chore-help" family.
 *
 * eraTW's daily chore-help commands (`304 仕事を手伝う`, `410 掃除`,
 * `412 勉強`, and siblings) all build `SOURCE:歓楽` from the SAME two
 * bracketed sub-formulas. Two independent ERB reads (2026-06-17) found:
 *
 *   - The **好感度 → 歓楽 bracket is byte-identical** across 304 / 410 /
 *     412 (and almost certainly the rest of the chore family). It is a
 *     true universal primitive → {@link favorPleasureBonus}.
 *   - The **従順 → 歓楽 bracket comes in coefficient variants**: 410/412
 *     share one table, 304 uses different numbers. So it is parameterized
 *     by a tier table → {@link bracketBonus} + the named `*_TIERS`
 *     constants below.
 *
 * Extracting these is the leverage point: once the brackets live here,
 * a sibling chore command's `buildSources` is a few lines (pick the base
 * value + the right 従順 table), not a re-typed 9-line ladder that's easy
 * to transcribe wrong (the extractor's exact failure mode — Phase 7A
 * completion doc, lesson 5).
 *
 * All arithmetic mirrors ERA BASIC integer semantics: `coef * value` is
 * integer (the multiplicands are small ints), and the 好感度 bracket's
 * division truncates toward zero (`Math.trunc`), per
 * [[eratw-emuera-language-semantics]].
 */

import { expLv } from "../../state/settlement.js";

/** One arm of an ERB `IF/ELSEIF` 歓楽 bracket: `value <= max → base + coef*value`. */
export interface BracketTier {
  /** Inclusive upper bound for this arm. Use `Infinity` for the final `ELSE`. */
  max: number;
  /** Fixed addend for this arm. */
  base: number;
  /** Per-unit coefficient multiplied by the bracket input. */
  coef: number;
}

/**
 * Evaluate a `base + coef * value` tier ladder, returning the first arm
 * whose `value <= max`. The last tier should have `max: Infinity` (the
 * ERB `ELSE` arm); if none matches, returns `0`.
 */
export function bracketBonus(value: number, tiers: readonly BracketTier[]): number {
  for (const t of tiers) {
    if (value <= t.max) return t.base + t.coef * value;
  }
  return 0;
}

/**
 * 従順 → 歓楽 bracket used by `410 掃除` and `412 勉強` (ERB:
 * `COMF412 勉強.ERB` lines 41-53, `COMF410 掃除.ERB` lines 111-123).
 *
 *   従順<=1  → 従順*60
 *   従順<=3  → 200 + 従順*60
 *   従順<=5  → 500 + 従順*60
 *   従順<=8  → 750 + 従順*75
 *   従順<=11 → 1000 + 従順*75
 *   else     → 2000 + 従順*30
 */
export const JUUJUN_PLEASURE_CHORE_TIERS: readonly BracketTier[] = [
  { max: 1, base: 0, coef: 60 },
  { max: 3, base: 200, coef: 60 },
  { max: 5, base: 500, coef: 60 },
  { max: 8, base: 750, coef: 75 },
  { max: 11, base: 1000, coef: 75 },
  { max: Infinity, base: 2000, coef: 30 },
];

/**
 * 従順 → 歓楽 bracket used by `304 仕事を手伝う` (ERB:
 * `COMF304 仕事を手伝う.ERB` lines 140-152). DIFFERENT coefficients from
 * the chore table above — kept separate so the divergence is explicit,
 * not silently averaged.
 *
 *   従順<=1  → 従順*50
 *   従順<=3  → 100 + 従順*40
 *   従順<=5  → 200 + 従順*50
 *   従順<=8  → 400 + 従順*70
 *   従順<=11 → 500 + 従順*60
 *   else     → 800 + 従順*40
 */
export const JUUJUN_PLEASURE_WORK_TIERS: readonly BracketTier[] = [
  { max: 1, base: 0, coef: 50 },
  { max: 3, base: 100, coef: 40 },
  { max: 5, base: 200, coef: 50 },
  { max: 8, base: 400, coef: 70 },
  { max: 11, base: 500, coef: 60 },
  { max: Infinity, base: 800, coef: 40 },
];

/**
 * 親密 → 歓楽 bracket used by `304 仕事を手伝う` (ERB lines 155-167).
 * Only 304 has this extra bracket in the chore family observed so far.
 *
 *   親密<=1  → 70 + 親密*50
 *   親密<=3  → 120 + 親密*50
 *   親密<=5  → 200 + 親密*50
 *   親密<=8  → 500 + 親密*40
 *   親密<=11 → 800 + 親密*40
 *   else     → 1200 + 親密*30
 */
export const SHINMITSU_PLEASURE_WORK_TIERS: readonly BracketTier[] = [
  { max: 1, base: 70, coef: 50 },
  { max: 3, base: 120, coef: 50 },
  { max: 5, base: 200, coef: 50 },
  { max: 8, base: 500, coef: 40 },
  { max: 11, base: 800, coef: 40 },
  { max: Infinity, base: 1200, coef: 30 },
];

/**
 * 親密 → 歓楽 bracket used by `411 戦闘訓練`, CASE 0 (indoor / good-weather)
 * (ERB `COMF411 戦闘訓練.ERB` lines 59-68). Only 4 arms, starting at ≤5 —
 * distinct from the chore 従順 ladder. The悪天候/ヤバい天気 weather cases
 * (1/2/3) use slightly higher bases (520/550…) and are deferred with the
 * rest of the weather model.
 *
 *   親密<=5  → 500 + 親密*60
 *   親密<=8  → 750 + 親密*75
 *   親密<=11 → 1000 + 親密*75
 *   else     → 2000 + 親密*30
 */
export const SHINMITSU_PLEASURE_TRAIN_TIERS: readonly BracketTier[] = [
  { max: 5, base: 500, coef: 60 },
  { max: 8, base: 750, coef: 75 },
  { max: 11, base: 1000, coef: 75 },
  { max: Infinity, base: 2000, coef: 30 },
];

/**
 * 親密 → 歓楽 bracket for the 添い寝/cuddle family (`417 昼寝` sleeping
 * together, ERB lines 49-66). Note the ≤1 arm contributes NO 歓楽 (only
 * 情愛 — see {@link SHINMITSU_JOAI_NAP_TIERS}).
 *
 *   親密<=1  → 0
 *   親密<=3  → 100 + 親密*40
 *   親密<=5  → 400 + 親密*50
 *   親密<=8  → 700 + 親密*60
 *   親密<=11 → 1200 + 親密*80
 *   else     → 2000 + 親密*50
 */
export const SHINMITSU_PLEASURE_NAP_TIERS: readonly BracketTier[] = [
  { max: 1, base: 0, coef: 0 },
  { max: 3, base: 100, coef: 40 },
  { max: 5, base: 400, coef: 50 },
  { max: 8, base: 700, coef: 60 },
  { max: 11, base: 1200, coef: 80 },
  { max: Infinity, base: 2000, coef: 50 },
];

/**
 * 親密 → 情愛 bracket for the 添い寝/cuddle family (`417 昼寝`, same lines).
 *
 *   親密<=1  → 親密*30
 *   親密<=3  → 200 + 親密*30
 *   親密<=5  → 300 + 親密*30
 *   親密<=8  → 400 + 親密*40
 *   親密<=11 → 600 + 親密*40
 *   else     → 1500 + 親密*20
 */
export const SHINMITSU_JOAI_NAP_TIERS: readonly BracketTier[] = [
  { max: 1, base: 0, coef: 30 },
  { max: 3, base: 200, coef: 30 },
  { max: 5, base: 300, coef: 30 },
  { max: 8, base: 400, coef: 40 },
  { max: 11, base: 600, coef: 40 },
  { max: Infinity, base: 1500, coef: 20 },
];

/**
 * 好感度 → 歓楽 bonus. **Universal** across the chore family (304/410/412
 * verified byte-identical). ERB (`COMF412 勉強.ERB` lines 56-62):
 *
 *   好感度<=500   → 好感度
 *   好感度<=5000  → 500 + (好感度-500)/3      (integer division, trunc)
 *   else          → 2000 + (好感度-5000)/5
 */
export function favorPleasureBonus(favor: number): number {
  if (favor <= 500) return favor;
  if (favor <= 5000) return 500 + Math.trunc((favor - 500) / 3);
  return 2000 + Math.trunc((favor - 5000) / 5);
}

/**
 * 緊縛経験 → DOWNBASE multiplier for the SM equip family (104 アイマスク /
 * 105 縄 / 106 ギャグ / 107 拘束). The target's bondage experience reduces
 * how much the restraint drains them (ERB, e.g. `COMF105 縄.ERB` 42-51):
 *
 *   緊縛経験 < EXPLV:3 (20) → ×1.00
 *   緊縛経験 < EXPLV:4 (50) → ×0.90
 *   else                   → ×0.70
 *
 * Callers apply it with `times(drain, mul)` (per-step Emuera truncation).
 * Shared here (≥2 consumers) rather than copied into each def.
 */
export function kinbakuDrainMul(kinbaku: number): number {
  if (kinbaku < expLv(3)) return 1.0;
  if (kinbaku < expLv(4)) return 0.9;
  return 0.7;
}
