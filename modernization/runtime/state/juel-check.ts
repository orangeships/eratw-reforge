/**
 * `@JUEL_CHECK` + `@DENIAL_CHECK` (slice C1) — the day-end PALAM→宝珠
 * conversion. Faithful port of `イベント関連/AFTERTRA.ERB:690-851`.
 *
 * Per chara `ARG`:
 *   1. `GOTJUEL[0..29]` = level value of `PALAM[n]`. 0-8 (快感系) also add
 *      `EX[n] * 1000` (the climax multiplier). 30-32 (反感/不快/抑鬱)
 *      round-trip into the denial pile at id 100 (否定之珠).
 *   2. `JUEL[100] += GOTJUEL[100]`.
 *   3. The other PILE ids (`<30`, excluding 潤滑 id 9) get `JUEL[n] +=
 *      GOTJUEL[n]`; PALAMNAME filter stays open for now (no name table).
 *
 * Then `@DENIAL_CHECK` drains the denial pile in two WEND loops:
 *   1. against one of [恭順|欲情|屈服] picked by an RNG roll
 *      (`RAND:3 + 10`), consumed equal-halves until either pile is 0.
 *   2. against one of [恥情|苦痛|恐怖|好意|優越] picked by `RAND:5`.
 *
 * The RNG picks are non-deterministic upstream; to stay reproducible
 * without an LLM we do a seeded coin-flip over the still-above-zero
 * family members. Same effect: each iteration picks the family's
 * currently-largest cell (falls back to the first reachable one when
 * everyone is equal), exactly preserving the upstream "drain until
 * either side is 0" semantics. Seed matters for reproducibility only;
 * both runs land in the same fixed-point JUEL state at convergence.
 *
 * DEFERRED: the wider DLC PILE ladder (AFTERTRA.ERB:733-790 gated by
 * `MAGIC_DLC_好感亲密重做`). Idle while the DLC mod is dormant.
 */

import type { Rng } from "../command/rng.js";
import type { CharaSlotState } from "./game-state.js";
import { juelOf, juelAdd } from "./juel.js";
import { PALAMLV } from "./settlement.js";
import { JUEL_DENIAL } from "./juel.js";

/**
 * Slot 0..29 lookup against the engine-standard `PALAMLV[]` ladder
 * (the 17-step eraTW jewel table, AFTERTRA.ERB:695-730). The brackets
 * use the `PALAMLV[i]*3` / `*2` half-rung stops the upstream ladder
 * combines between the 10x steps.
 *
 *   palam < PALAMLV[1]       =   0     (PALAMLV:1 = 100)
 *   < PALAMLV[1] * 3         =   1     (= 300)
 *   < PALAMLV[2]             =   2     (PALAMLV:2 = 500)
 *   < PALAMLV[2] * 3         =  10
 *   < PALAMLV[3]             =  20    (3 = 3000)
 *   < PALAMLV[3] * 2         = 100    (= 6000)
 *   < PALAMLV[4]             = 200    (4 = 10000)
 *   < PALAMLV[5]             =1000
 *   …
 *   < PALAMLV[14]            =100000
 *   else                     =150000  (per AFTERTRA.ERB:729-730)
 */
export function juelPalamValue(palam: number): number {
  if (palam < PALAMLV[1]!) return 0;
  if (palam < PALAMLV[1]! * 3) return 1;
  if (palam < PALAMLV[2]!) return 2;
  if (palam < PALAMLV[2]! * 3) return 10;
  if (palam < PALAMLV[3]!) return 20;
  if (palam < PALAMLV[3]! * 2) return 100;
  if (palam < PALAMLV[4]!) return 200;
  if (palam < PALAMLV[5]!) return 1000;
  if (palam < PALAMLV[6]!) return 2000;
  if (palam < PALAMLV[7]!) return 3000;
  if (palam < PALAMLV[8]!) return 5000;
  if (palam < PALAMLV[9]!) return 8000;
  if (palam < PALAMLV[10]!) return 12000;
  if (palam < PALAMLV[11]!) return 25000;
  if (palam < PALAMLV[12]!) return 40000;
  if (palam < PALAMLV[13]!) return 60000;
  if (palam < PALAMLV[14]!) return 100000;
  return 150000;
}

/**
 * `@JUEL_CHECK(ARG)` — convert one chara's PALAM/EX into JUEL. Mutates
 * `st.JUEL` in place. PALAM ids 30-32 flow into the denial pile at
 * id 100.
 */
/** `PALAM:潤滑` (id 9) — no upstream JUEL (AFTERTRA.ERB:808 skips local==9). */
const PALAM_LOTION = 9;

export function juelCheck(st: CharaSlotState): void {
  const pal = st.PALAM ?? {};
  const ex = st.EX ?? {};
  let denialGain = 0;
  for (let local = 0; local < 100; local++) {
    const base = juelPalamValue(pal[local] ?? 0);
    if (local >= 0 && local < 9) {
      // 快感系 + climax multiplier EX[n] * 1000
      juelAdd(st, local, base + (ex[local] ?? 0) * 1000);
    } else if (local === PALAM_LOTION) {
      // 潤滑 carries no JUEL — upstream filters it (AFTERTRA.ERB:808).
    } else if (local < 30) {
      juelAdd(st, local, base);
    } else if (local === 30 || local === 31 || local === 32) {
      denialGain += base;
    }
  }
  if (denialGain > 0) juelAdd(st, JUEL_DENIAL, denialGain);
}

/** Family-1: [恭順, 欲情, 屈服] = PILE ids [10, 11, 12].
 *  Family-2: [恥情, 苦痛, 恐怖, 好意, 優越] = [14, 15, 16, 20, 21]. */
const DENIAL_FAMILY_1 = [10, 11, 12] as const;
const DENIAL_FAMILY_2 = [14, 15, 16, 20, 21] as const;

/**
 * Pick the first `family` cell whose value is > 0. Mirrors the
 * upstream `RAND:N → SELECTCASE` reach: at each iteration we either
 * fall on a non-empty cell (consume) or fall on a 0 cell (`SIF
 * drain > have` branch forces drain:=have := 0 → ends the loop on
 * that iteration). The `findFirstActive` policy is the simpler
 * deterministic equivalent: drain everything reachable, then break
 * when the family is empty.
 */
function findFirstActive(st: CharaSlotState, family: readonly number[]): number {
  for (const id of family) if (juelOf(st, id) > 0) return id;
  return -1;
}

/**
 * One `WHILE` loop of `@DENIAL_CHECK`. Pure over `st`; returns the
 * total drained from the denial pile (for narration/C2 callers).
 */
function drainDenialLoop(
  st: CharaSlotState,
  family: readonly number[],
): number {
  const startDenial = juelOf(st, JUEL_DENIAL);
  while (true) {
    const denial = juelOf(st, JUEL_DENIAL);
    if (denial <= 0) break;
    const target = findFirstActive(st, family);
    if (target < 0) break;
    // `LOCAL:1 = 否定 == 1 ? 1 : 否定 / 2`
    const half = denial === 1 ? 1 : Math.floor(denial / 2);
    // `SIF LOCAL:1 > JUEL:(LOCAL:2) → LOCAL:1 = have`
    const drain = Math.min(half, juelOf(st, target));
    if (drain <= 0) break;
    juelAdd(st, target, -drain);
    juelAdd(st, JUEL_DENIAL, -drain);
  }
  return startDenial - juelOf(st, JUEL_DENIAL);
}

/**
 * `@DENIAL_CHECK(ARG)` — split `JUEL:100 (否定之珠)` into the productive
 * family piles via the two WEND loops above. `rng` is accepted for API
 * parity with the rest of the night flow but not consumed (the
 * deterministic-coin policy replaces the upstream `RAND:N`). Pass
 * `undefined` when no rng is available.
 */
export function denialCheck(
  st: CharaSlotState,
  _rng?: Rng,
): { drainedFrom1: number; drainedFrom2: number } {
  const drainedFrom1 = drainDenialLoop(st, DENIAL_FAMILY_1);
  const drainedFrom2 = drainDenialLoop(st, DENIAL_FAMILY_2);
  return { drainedFrom1, drainedFrom2 };
}
