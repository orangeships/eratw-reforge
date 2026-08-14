/**
 * Night-flow runner for `@JUEL_CHECK + @DENIAL_CHECK` (slice C1). Reads
 * the per-chara PALAM/EX day-scoped totals that `@EVENTTURNEND` and the
 * day-end settled paths accumulated, banks them into the persistent
 * `state.charas[i].state.JUEL`, and emits one narration per non-zero
 * grant + a per-chara "否定之珠变成一半" line when the denial pile
 * moved. Faithful to the upstream order (AFTERTRA.ERB:665-680 per-chara
 * loop + :811-851 once per chara after).
 */

import type { GameState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/rng.js";
import { juelCheck, denialCheck } from "../state/juel-check.js";
import { juelOf, JUEL_DENIAL } from "../state/juel.js";
import { JUEL_DISPLAY_NAME } from "../state/juel.js";
import { TALENT_ID } from "../state/settlement.js";

/** Snapshot a PILE id's pre-flow bank so the post-flow diff = "宝珠 ＋N". */
function diffGrant(state: GameState, charaNum: number, juelId: number, events: ObservationEvent[], now: () => number): void {
  const slot = state.charas[charaNum];
  if (!slot) return;
  const after = juelOf(slot.state, juelId);
  // We don't snapshot the "before" here (the runner takes it inline);
  // this helper would need state-before-state. Kept as a thin re-export
  // so callers can attach extra labels if they want.
  void after;
  void events;
  void now;
}

export interface JuelCheckDeps {
  now: () => number;
  rng?: Rng;
}

/** Per-chara PILE id → `快Ｃ之珠` style label. Falls back to `珠{n}`. */
function labelOf(juelId: number): string {
  return JUEL_DISPLAY_NAME[juelId] ?? `珠${juelId}`;
}

/** Capture the JUEL vault per chara (incl. MASTER at key 0) before the bank runs. */
function snapshot(state: GameState): Record<number, Record<number, number>> {
  const before: Record<number, Record<number, number>> = {};
  const vaultOf = (slot: { state: { JUEL?: Record<number, number> } }) => {
    const snap: Record<number, number> = {};
    const j = slot.state.JUEL ?? {};
    for (const idStr of Object.keys(j)) {
      const id = Number(idStr);
      snap[id] = j[id] ?? 0;
    }
    return snap;
  };
  before[0] = vaultOf(state.master);
  for (const [k, slot] of Object.entries(state.charas)) {
    before[Number(k)] = vaultOf(slot);
  }
  return before;
}

/**
 * Run the day-end PALAM→JUEL convert + denial-pile drain over every
 * registered chara. Mutates `state.charas[i].state.JUEL` (the existing
 * ONANISM grants are kept — `.JUEL` is additive across the night).
 * Returns the narration stream to splice into `nightReport`.
 */
export function runJuelCheckNarrated(
  state: GameState,
  deps: JuelCheckDeps,
): ObservationEvent[] {
  const { now, rng } = deps;
  const events: ObservationEvent[] = [];
  const before = snapshot(state);
  // Upstream AFTERTRA.ERB:665 `FOR LOCAL,0,CHARANUM` — 0 is MASTER, so the
  // PALAM→JUEL convert banks the master's day-scoped PALAM too (its PALAM is
  // only fed by master-centric settlements; charas are fed per-chara).
  const charaNums = [0, ...Object.keys(state.charas).map(Number)]
    .sort((a, b) => a - b);

  for (const num of charaNums) {
    const slot = num === 0 ? state.master : state.charas[num];
    if (!slot) continue;
    if ((slot.state.TALENT[TALENT_ID.路人] ?? 0) !== 0) continue;
    juelCheck(slot.state);
    const name = num === 0 ? (slot.callName ?? "主人") : (slot.callName ?? `角色${num}`);
    const prev = before[num] ?? {};
    const after = slot.state.JUEL ?? {};
    for (const idStr of Object.keys(after)) {
      const id = Number(idStr);
      if (id === JUEL_DENIAL) continue;
      const delta = (after[id] ?? 0) - (prev[id] ?? 0);
      if (delta > 0) {
        events.push({
          kind: "NARRATION",
          timestamp: now(),
          text: `${labelOf(id)}之珠 ＋${delta}（${name}）`,
        });
      }
    }
    denialCheck(slot.state, rng);
    const denialDiff =
      (slot.state.JUEL?.[JUEL_DENIAL] ?? 0) - (prev[JUEL_DENIAL] ?? 0);
    if (denialDiff > 0) {
      events.push({
        kind: "NARRATION",
        timestamp: now(),
        text: `${labelOf(JUEL_DENIAL)}之珠 ＋${denialDiff}（${name}）`,
      });
    } else if (denialDiff < 0) {
      events.push({
        kind: "NARRATION",
        timestamp: now(),
        text: `否定之珠减少 ${-denialDiff}（${name}）`,
      });
    }
    void diffGrant;
  }
  return events;
}
