/**
 * Phase 7 — `yogore.ts`: the 掃除 / 汚れ (cleaning / dirt) subsystem.
 *
 * eraTW keeps a top-level `#DIM SAVEDATA YOGORE, 2000` array — per-room
 * dirt, indexed by room id (`DIM.ERH:247`). `COMF410 掃除` reads the dirt
 * at the master's current room, computes a cleaning power, and removes a
 * fraction of the dirt. The helpers here mirror the two pure formulas
 * `@SWEEP_POWER_CALC` and `@OSOUJI_LIMIT` (both defined inside
 * `COMF410 掃除.ERB`) plus the dirt-removal arithmetic, so the handler
 * stays a thin orchestrator.
 *
 * **State shape.** We key dirt by the canonical location STRING
 * (`GameState.yogore["神社:本堂"]`) to match `CharaSlot.location`, rather
 * than ERB's numeric room id. A missing key reads as 0 dirt.
 *
 * **Subsystem status.** `sweepPower` / `osoujiLimit` / `sweepAmount` are
 * also consumed by `@AUTO_SWEEP` (COMF410.ERB:356) and the cleaning 依頼
 * commands (`一般依頼01/07`), so this is a genuine ≥2-consumer subsystem.
 *
 * **Defer policy** (documented, same posture as attitude.ts / mood.ts):
 *   - `ITEM:特制竹箒` (SWEEP_POWER_CALC ERB 285-292) — ITEM not modeled →
 *     0 (no broom bonus).
 *   - `ITEM:977` (OSOUJI_LIMIT ERB 317-318, cleaning-magic catalyst) —
 *     ITEM not modeled → no threshold reduction.
 *   - The 虫籠 (P54) ×5 multiplier + sweep-along (COMF410 ERB 67-76) is a
 *     specific-room special case — deferred at the handler level.
 */

import { ABL_ID, TALENT_ID } from "./settlement.js";
import type { CharaSlot, GameState } from "./game-state.js";

// ---------------------------------------------------------------------------
// Dirt accessors (per-location)
// ---------------------------------------------------------------------------

/** Read `YOGORE:<location>` (missing → 0). */
export function getYogore(state: GameState, location: string): number {
  return state.yogore?.[location] ?? 0;
}

/**
 * UI accessor: the "清洁度:XX" label for a location, faithful to
 * `@DRAW_MAP` (`DRAW_MAP.ERB:232-247`). Returns the label WITHOUT the
 * "清洁度:" prefix so the caller can style it. A location with no dirt
 * entry reads as 最高 (freshly-seeded / never-dirtied).
 *
 * Namespace-free (the UI layer may not spell `yogore` internals) — same
 * posture as `getNamedStat` / `getRelationStat`.
 */
export function getCleanlinessLabel(state: GameState, location: string): string {
  return cleanlinessLabel(getYogore(state, location));
}

/** Write `YOGORE:<location>` on the (cloned) next-state. Clamped ≥ 0. */
export function setYogore(state: GameState, location: string, value: number): void {
  if (!state.yogore) state.yogore = {};
  state.yogore[location] = Math.max(0, value);
}

// ---------------------------------------------------------------------------
// @SWEEP_POWER_CALC (COMF410.ERB:277-301)
// ---------------------------------------------------------------------------

/**
 * Cleaning power. `helper` is the assisting chara (or `undefined` for a
 * solo clean — ERB passes 0).
 *
 *   SWEEP_POWER = 2 + ABL:MASTER:清掃技能 + 3 * TALENT:MASTER:清掃中毒   (283)
 *   + 特制竹箒 bonus (285-292)                                          DEFERRED (ITEM → 0)
 *   ×= (5 - TALENT:MASTER:汚臭耐性) / 5                                  (294)
 *   小人 (TALENT:MASTER:体型 == -5) → /= 5                              (296-297)
 *   + ABL:helper:清掃技能  (if a helper)                                (299-300)
 *   RETURN MAX(SWEEP_POWER, 1)                                          (301)
 */
export function sweepPower(master: CharaSlot, helper?: CharaSlot): number {
  const m = master.state;
  let power =
    2 +
    (m.ABL[ABL_ID.清扫技能] ?? 0) +
    3 * (m.TALENT[TALENT_ID.清掃中毒] ?? 0);

  // 特制竹箒 bonus (ERB 285-292) — ITEM deferred → no bonus.

  // 汚臭耐性 (ERB 294): integer multiply then divide (Emuera truncation).
  power = Math.trunc((power * (5 - (m.TALENT[TALENT_ID.汚臭耐性] ?? 0))) / 5);

  // 小人 (ERB 296-297).
  if ((m.TALENT[TALENT_ID.体型] ?? 0) === -5) power = Math.trunc(power / 5);

  // helper assist (ERB 299-300).
  if (helper) power += helper.state.ABL[ABL_ID.清扫技能] ?? 0;

  return Math.max(power, 1);
}

// ---------------------------------------------------------------------------
// @OSOUJI_LIMIT (COMF410.ERB:304-319)
// ---------------------------------------------------------------------------

/**
 * The dirt threshold below which a chara won't bother cleaning a room.
 *
 *   O_LIMIT = 300                                  (309)
 *   ズボラ (懒散) → *= 10                           (310-311)
 *   ×= (3 + TALENT:汚臭耐性) / 3                     (312)
 *   献身的 → /= 2                                   (313-314)
 *   清掃中毒 → /= 10                                (315-316)
 *   ITEM:977 ≥ 1 → /= ITEM:977                      (317-318)  DEFERRED (ITEM → no div)
 */
export function osoujiLimit(slot: CharaSlot): number {
  const s = slot.state;
  let limit = 300;
  if ((s.TALENT[TALENT_ID.ズボラ] ?? 0) !== 0) limit *= 10;
  limit = Math.trunc((limit * (3 + (s.TALENT[TALENT_ID.汚臭耐性] ?? 0))) / 3);
  if ((s.TALENT[TALENT_ID.献身的] ?? 0) !== 0) limit = Math.trunc(limit / 2);
  if ((s.TALENT[TALENT_ID.清掃中毒] ?? 0) !== 0) limit = Math.trunc(limit / 10);
  // ITEM:977 catalyst division (ERB 317-318) deferred — ITEM not modeled.
  return limit;
}

// ---------------------------------------------------------------------------
// Dirt removal (COMF410.ERB:67-68)
// ---------------------------------------------------------------------------

/**
 * How much dirt one sweep removes from a room at `yogore` dirt with the
 * given `power` (ERB 67, non-虫籠 case → the `# 1` multiplier):
 *
 *   SWEEP_YOGORE = YOGORE - YOGORE / power     (integer divide, trunc)
 *
 * i.e. a sweep leaves `floor(YOGORE / power)` behind and removes the rest.
 * The 虫籠 (P54) ×5 power multiplier (ERB 67) is deferred (room-specific).
 */
export function sweepAmount(yogore: number, power: number): number {
  return yogore - Math.trunc(yogore / power);
}

// ---------------------------------------------------------------------------
// 散らかり具合 bracket — TFLAG:194 (COMF410.ERB:28-37)
// ---------------------------------------------------------------------------

/**
 * The dirt-severity bracket the ERB stashes in `TFLAG:194` (drives the
 * narration tone): `< 500 → 0`, `< 2000 → 1`, `< 5000 → 2`, else `3`.
 */
export function dirtSeverity(yogore: number): 0 | 1 | 2 | 3 {
  if (yogore < 500) return 0;
  if (yogore < 2000) return 1;
  if (yogore < 5000) return 2;
  return 3;
}

/**
 * `@DRAW_MAP` 清洁度 label (`DRAW_MAP.ERB:232-247`) — the "清洁度:XX" suffix
 * eraTW appends to a room's title. Faithful bracket thresholds:
 *   < 100 最高 / < 500 高 / < 1000 较高 / < 2000 中 /
 *   < 3500 较低 / < 5000 低 / else 垃圾山
 *
 * Note the live `yogore` value is dirt (higher = dirtier); the label is the
 * INVERSE reading (more dirt → lower cleanliness label), exactly as ERB writes
 * it. `0` dirt reads as 最高 (a freshly-seeded / never-dirtied room).
 */
export function cleanlinessLabel(yogore: number): string {
  if (yogore < 100) return "最高";
  if (yogore < 500) return "高";
  if (yogore < 1000) return "较高";
  if (yogore < 2000) return "中";
  if (yogore < 3500) return "较低";
  if (yogore < 5000) return "低";
  return "垃圾山";
}
