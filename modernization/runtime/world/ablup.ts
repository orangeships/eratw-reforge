/**
 * `@SHOW_ABLUP_SELECT` (slice C2-P2) — the day-end automatic
 * ability-level-up sweep. Faithful port of
 * `ステータス計算関連/ABL/ABL.ERB:3-136`.
 *
 * Per registered chara (skip `TALENT:路人 != 0`), iterate the
 * upstream-defined ABL ordering (中→中→中→中→中→百合/断袖→5 sense→4
 * social→4 中毒; 21 entries; runtime drops the mod-only 催眠奴隷 id 39
 * since its `JUEL_DEMAND_39` caller is DLC-dormant). For each ABL, try
 * each pattern 0..3 (the inner `LOCAL` loop in ERB is broken into 4
 * branches — pattern 0 prices one jewel column, pattern 1 another,
 * etc.). If both JUEL and EXP demands are satisfied, deduct the cost
 * and emit the "role … ABLNAME LVUP (rank → rank)" line; loop that
 * pattern until the demand fails.
 *
 * Output is a stream of `ObservationEvent` (NARRATION), splice into
 * `state.nightReport` for the night screen to render.
 *
 * DEFERRED: pattern-2 columns for 奉仕精神 (LOCAL:13 only when Lv0),
 * the GMF gated ＴＳ skill, full `CALC_ABL_DEMAND` rate tuning (we
 * use upstream's identity rate = 100% — `state.flagStore.ABL_UP_RAIT`
 * doesn't exist yet).
 */

import type { GameState, CharaSlotState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import {
  ABL_ID,
  EXP_ID,
  PALAM_ID,
  TALENT_ID,
} from "../state/settlement.js";
import {
  juelDemandPattern0,
  juelOf,
  juelAdd,
} from "../state/juel.js";
import { ablName, ablRankLabelMax99 } from "../state/abl-name.js";

/**
 * The upstream ABL ordering (ABL.ERB:14-79, the inner `SELECTCASE
 * LOCAL:11`). The first 21 entries cover every non-DLC capability.
 * id 39 (催眠奴隷) was deliberately excluded — its donor arm is DLC
 * dormant and its tier table only half-implemented in upstream.
 */
const ABL_ORDER: readonly number[] = [
  ABL_ID.自慰中毒,
  ABL_ID.膣射中毒,
  ABL_ID.肛射中毒,
  ABL_ID.精液中毒,
  ABL_ID.百合中毒,
  ABL_ID.断袖中毒,
  ABL_ID.奉仕精神,
  ABL_ID.百合属性,
  ABL_ID.断袖属性,
  ABL_ID.受虐属性,
  ABL_ID.施虐属性,
  ABL_ID.露出癖,
  ABL_ID.親密,
  ABL_ID.従順,
  ABL_ID.欲望,
  ABL_ID.技巧,
  ABL_ID.Ｃ感覚,
  ABL_ID.Ｖ感覚,
  ABL_ID.Ａ感覚,
  ABL_ID.Ｂ感覚,
  ABL_ID.Ｍ感覚,
];

/** Max pattern sweep; most ABLs stop after pattern 0; some have
 *  multiple columns. Each iteration consumes the required jewels (per
 *  the column list) and EXP (per `expDemand`), looping until one fails. */
const PATTERN_RANGE: readonly number[] = [0, 1, 2, 3];
/** Hard limit on consecutive successful levels per ABL (the upstream
 *  `FOR LOCAL,0,4` outer). The nested `GOTO AGAIN` would otherwise
 *  loop forever if the costs underflow to negative. */
const MAX_LEVELS_PER_ABL = 4;

const trunc = Math.trunc;

function abl(st: CharaSlotState, id: number): number {
  return st.ABL[id] ?? 0;
}
function exp(st: CharaSlotState, id: number): number {
  return st.EXP[id] ?? 0;
}
function talent(st: CharaSlotState, id: number): number {
  return st.TALENT[id] ?? 0;
}

/** EXP gate for one ABL pattern+EXP id. Faithful to ABL_UP_DATA.ERB
 *  (ABL.ERB:317-371 Ａ感覚 ladder + 486-489 Ｖ感覚 LV3+). Most ABLs
 *  have no EXP gating (returns 0). */
function expDemand(
  st: CharaSlotState,
  ablId: number,
  pattern: number,
  expId: number,
): number {
  void pattern;
  if (ablId === ABL_ID.Ｖ感覚) {
    if (expId === EXP_ID.Ｖ経験 && abl(st, ABL_ID.Ｖ感覚) >= 3) return 1;
    return 0;
  }
  if (ablId === ABL_ID.Ａ感覚) {
    if (expId !== EXP_ID.Ａ経験) return 0;
    const lvl = abl(st, ABL_ID.Ａ感覚);
    const ladder = [2, 10, 30, 75, 150, 220, 270, 360, 420, 500];
    let v = lvl >= 0 && lvl <= 9 ? ladder[lvl]! : 100 * (lvl - 4);
    if (talent(st, TALENT_ID.一線越えない) !== 0) {
      v = trunc((v * (talent(st, TALENT_ID.恋慕) !== 0 ? 0.5 : 2.0)));
    }
    if (talent(st, TALENT_ID.Ａ感度) > 0) v = trunc(v * 0.5);
    return Math.max(1, v);
  }
  void expId;
  return 0;
}

/**
 * The list of (juelId, pattern) pairs that the auto-loop should examine
 * for one ABL. Faithful to the local `LOCAL:n` set that
 * `@JUEL_DEMAND_N(PATTERN=0..3, …)` writes. The runner iterates
 * patterns 0..3 outer; the inner filter picks the columns whose
 * pattern ≤ current pattern (so pattern 0 is the cheapest default).
 */
function ablJuelColumns(ablId: number): Array<[number, number]> {
  switch (ablId) {
    case ABL_ID.親密: return [[PALAM_ID.好意, 0]];
    case ABL_ID.従順: return [[PALAM_ID.恐怖, 0], [PALAM_ID.恭順, 1]];
    case ABL_ID.欲望: return [[PALAM_ID.欲情, 0], [PALAM_ID.優越, 1]];
    case ABL_ID.技巧: return [[PALAM_ID.習得, 0]];
    case ABL_ID.奉仕精神: return [
      [PALAM_ID.屈服, 0],
      [PALAM_ID.恭順, 1],
    ];
    case ABL_ID.露出癖: return [[PALAM_ID.恥情, 0]];
    case ABL_ID.受虐属性: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 1]];
    case ABL_ID.施虐属性: return [[PALAM_ID.欲情, 0], [PALAM_ID.優越, 1]];
    case ABL_ID.百合属性: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 1]];
    case ABL_ID.断袖属性: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 1]];
    case ABL_ID.自慰中毒: return [
      [PALAM_ID.欲情, 0],
      [PALAM_ID.快Ｃ, 0],
      [PALAM_ID.恥情, 0],
    ];
    case ABL_ID.精液中毒: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 0]];
    case ABL_ID.百合中毒: return [[PALAM_ID.快Ｃ, 0]];
    case ABL_ID.断袖中毒: return [[PALAM_ID.快Ｃ, 0]];
    case ABL_ID.膣射中毒: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 0]];
    case ABL_ID.肛射中毒: return [[PALAM_ID.欲情, 0], [PALAM_ID.屈服, 0]];
    case ABL_ID.Ｃ感覚: return [[PALAM_ID.快Ｃ, 0]];
    case ABL_ID.Ｖ感覚: return [[PALAM_ID.快Ｖ, 0]];
    case ABL_ID.Ａ感覚: return [[PALAM_ID.快Ａ, 0]];
    case ABL_ID.Ｂ感覚: return [[PALAM_ID.快Ｂ, 0]];
    case ABL_ID.Ｍ感覚: return [[PALAM_ID.快Ｍ, 0]];
    default: return [];
  }
}

/** Consume JUEL/EXP costs for one upgrade. Returns true on success. */
function applyLevelCost(
  st: CharaSlotState,
  ablId: number,
  pattern: number,
  isMaster: boolean,
  flags: GameState["flagStore"],
): boolean {
  const columns = ablJuelColumns(ablId).filter(([_j, p]) => pattern >= p);
  if (columns.length === 0) return false;
  // Pre-check: every required PILE banked; fail fast. Negative `need`
  // sentinels (`-1 = unsupported pattern` / `-2 = gate failure`) short-
  // circuit the upgrade — upstream `SIF JUEL_DEMAND(... < 0) CONTINUE`
  // / `SIF JUEL_DEMAND(... == -2) BREAK` semantics.
  for (const [juelId] of columns) {
    const need = juelDemandPattern0(st, isMaster, ablId, juelId, flags ?? {});
    if (need < 0) return false;
    if (need > 0 && juelOf(st, juelId) < need) return false;
  }
  // Pre-check: every required EXP banked.
  for (let expId = 0; expId < 100; expId++) {
    const need = expDemand(st, ablId, pattern, expId);
    if (need > 0 && exp(st, expId) < need) return false;
  }
  // Deduct.
  for (const [juelId] of columns) {
    const need = juelDemandPattern0(st, isMaster, ablId, juelId, flags ?? {});
    if (need > 0) juelAdd(st, juelId, -need);
  }
  for (let expId = 0; expId < 100; expId++) {
    const need = expDemand(st, ablId, pattern, expId);
    if (need > 0) {
      st.EXP[expId] = (st.EXP[expId] ?? 0) - need;
    }
  }
  return true;
}

/** Run `@SHOW_ABLUP_SELECT` over every registered chara. Mutates each
 *  chara's JUEL/EXP/ABL in place; returns the narration stream (NARRATION).
 *  Caller (finishPlayerSleep) splices into `state.nightReport`. */
export function runAblupAutoSelect(
  state: GameState,
  deps: { now: () => number; includeMaster?: boolean; includeMobs?: boolean },
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const charaNums = [
    ...(deps.includeMaster ? [0] : []),
    ...Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b),
  ];
  for (const num of charaNums) {
    const slot = num === 0 ? state.master : state.charas[num];
    if (!slot) continue;
    const st = slot.state;
    if (!deps.includeMobs && talent(st, TALENT_ID.路人) !== 0) continue;
    const isMaster = num === 0;
    const flags = state.flagStore;
    const name = slot.callName ?? `角色${num}`;
    let firstPrinted = false;
    for (const ablId of ABL_ORDER) {
      if (abl(st, ablId) >= 99) continue;
      const levels = upgradeLoop(st, ablId, isMaster, flags);
      for (let i = 0; i < levels.length; i++) {
        // `upgradeLoop` has already applied the whole cascade. Reconstruct
        // the per-level transition from the level at the end of the loop so
        // each line mirrors upstream's one-level-at-a-time output.
        const afterLevel = abl(st, ablId) - levels.length + i + 1;
        const beforeLevel = afterLevel - 1;
        const beforeRank = ablRankLabelMax99(beforeLevel);
        const afterRank = ablRankLabelMax99(afterLevel);
        events.push({
          kind: "NARRATION",
          timestamp: deps.now(),
          charaNum: num,
          text: firstPrinted
            ? `         ${ablName(ablId)} LVUP (${beforeRank} ${beforeLevel} → ${afterRank} ${afterLevel})`
            : `${name.padEnd(14, " ")} … ${ablName(ablId)} LVUP (${beforeRank} ${beforeLevel} → ${afterRank} ${afterLevel})`,
        });
        firstPrinted = true;
      }
    }
  }
  return events;
}

/** Run the inner `LOCAL` (pattern 0..3) loops for one ABL, applying up to
 *  MAX_LEVELS_PER_ABL successful level-ups. Returns the per-level
 *  delta list (caller consumes the post-state ABL value). */
function upgradeLoop(
  st: CharaSlotState,
  ablId: number,
  isMaster: boolean,
  flags: GameState["flagStore"],
): number[] {
  const diffs: number[] = [];
  // Pattern 0 first; on success loop (GOTO AGAIN). After exhausting
  // pattern 0, try pattern 1, etc. This mirrors the inner `FOR LOCAL,
  // 0, 4` semantics at ABL.ERB:79-131: each pattern is its own
  // ladder, only entered by `GOTO AGAIN` whose success means we
  // re-enter the same pattern. Note that practical eraTW auto-Ablup
  // never loops back to a higher pattern once the lower one succeeded
  // (the upstream uses `BREAK` style abort implicitly — but the body
  // has `GOTO AGAIN` which only re-runs the same pattern). The
  // correct semantics for THIS slice is: each pattern is a guarded
  // entry; pattern N+1 starts only after pattern N has fully emptied.
  for (const pattern of PATTERN_RANGE) {
    let runs = 0;
    while (runs < MAX_LEVELS_PER_ABL) {
      const before = abl(st, ablId);
      const ok = applyLevelCost(st, ablId, pattern, isMaster, flags);
      if (!ok) break;
      st.ABL[ablId] = before + 1;
      diffs.push(st.ABL[ablId]! - before);
      runs++;
    }
    if (diffs.length > 0) break;
  }
  return diffs;
}
