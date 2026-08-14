/**
 * Phase 7.5 F-1c — human-readable description of a `STATE_DELTA` event's
 * `fields`, for the text window. eraTW prints a command's state changes as
 * `体力-50 気力-100 (伊川)` / `气力-10 (灵梦)`; the modern runtime logs a
 * `STATE_DELTA` with per-field `{namespace, id, delta}` but the UI was only
 * showing `fields=<count>`. This helper turns the fields into the faithful
 * `名前±delta` lines (namespace-free surface for the UI layer).
 *
 * Only the well-known stat ids carry display names (体力/気力/酒/精力/TSP/
 * 情緒/理性/憤怒 + the 5 PALAM gauges + 好感度/信頼度). Unknown ids degrade
 * to `{NS}[{id}]` so nothing is silently dropped — same posture as the
 * status-bar accessors. PALAM deltas render as `恭顺+852` etc. (the line
 * eraTW prints as `恭顺 0 + 852 = 852` — here we show just the delta leg;
 * the absolute-value table is a separate future surface).
 */

import type { StateDelta } from "../../schemas/types.js";

// The id→name maps are DUPLICATED here (not imported from settlement.js) so
// this module stays a pure leaf with zero runtime value-imports — importing
// settlement.js would pull `world/clock.js` and transitively Node-only modules
// into the browser bundle (the white-screen trap, see ui-barrel-kojo-pitfall
// memory). The ids are pinned to CSV/ALS constants; settlement.js's
// BASE_ID/CFLAG_ID/PALAM_ID are the canonical source — if they move, update
// these literals to match. Pinned values: 体力0/気力1/酒気15/精力6/TSP8/
// 情緒10/理性11/憤怒12/勃起5/尿意4/射精2/母乳3 (BASE); 好感度2/信頼度4 (CFLAG);
// 潤滑9/恭順10/欲情11/屈服12/習得13/好意20/反感30 (PALAM).

/** BASE id → display name (the named stats + emotion gauges). */
const BASE_NAMES: Readonly<Record<number, string>> = {
  0: "体力",
  1: "気力",
  15: "酒",
  6: "精力",
  8: "TSP",
  10: "情緒",
  11: "理性",
  12: "憤怒",
  5: "勃起",
  4: "尿意",
  2: "射精",
  3: "母乳",
};

/** CFLAG id → display name (the relation counters + a few common ones). */
const CFLAG_NAMES: Readonly<Record<number, string>> = {
  2: "好感度",
  4: "信頼度",
};

/** PALAM id → display name (the 5 status gauges + 好意/反感). */
const PALAM_NAMES: Readonly<Record<number, string>> = {
  9: "润滑",
  10: "恭顺",
  11: "情欲",
  12: "屈服",
  13: "习得",
  20: "好意",
  30: "反感",
};

function fieldName(ns: string, id: number): string {
  switch (ns) {
    case "BASE":
      return BASE_NAMES[id] ?? `BASE[${id}]`;
    case "CFLAG":
      return CFLAG_NAMES[id] ?? `CFLAG[${id}]`;
    case "PALAM":
      return PALAM_NAMES[id] ?? `PALAM[${id}]`;
    default:
      return `${ns}[${id}]`;
  }
}

/** Format one field's delta as `名前+N` / `名前-N`. */
function formatField(ns: string, id: number, delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${fieldName(ns, id)}${sign}${delta}`;
}

/**
 * Describe a STATE_DELTA's fields as a single `名前±delta 名前±delta …` line
 * (no subject name — the caller adds `(谁)`). Returns "" when there are no
 * fields. Drops zero deltas (eraTW doesn't print no-op changes).
 */
export function describeStateDelta(event: StateDelta): string {
  return event.fields
    .filter((f) => f.delta !== 0)
    .map((f) => formatField(f.namespace, f.id, f.delta))
    .join(" ");
}
