/**
 * `ADD_KISS` (ERB/イベント関連/DATE_CMN.ERB:306-319) — the canonical
 * first-kiss / kiss-XP writer shared by the date ending, the counter
 * `MUTUAL_KISS` arm, and the interaction boxes.
 *
 * Upstream:
 *   - if the partner still has `TALENT:キス未経験` → `SET_FIRSTKISS(partner, MASTER, …)`
 *     and `AddEXP("愛情経験", partner, 10)`.
 *   - if the master still has it → `SET_FIRSTKISS(MASTER, partner, …)` and the
 *     same 愛情経験 grant.
 *   - `AddEXP("接吻経験")` on both sides.
 *   - `SETBIT CFLAG:partner:既成事実, 0` (kiss is 合意 bit 0).
 *
 * The prose/history half of `SET_FIRSTKISS` lives in the per-feature writers
 * (`world/dayevent.ts`, `world/onabare.ts`); this module owns the canonical
 * talent + CFLAG + XP fields so every caller observes the same result.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import { CFLAG_ID, EXP_ID, TALENT_ID } from "./settlement.js";

/** `CFLAG:既成事実` bit 0 = 接吻（合意）— kojo symbol `合意_キス`. */
export const KISS_BIT = 1 << 0;

/** Write one side's first-kiss record. No-op when already kissed. */
export function recordFirstKiss(
  state: GameState,
  slot: CharaSlot,
  partnerNum: number,
): boolean {
  if ((slot.state.TALENT[TALENT_ID.キス未経験] ?? 0) <= 0) return false;
  slot.state.TALENT[TALENT_ID.キス未経験] = 0;
  slot.state.CFLAG[CFLAG_ID.初吻喪失記念日] = state.time.dayIndex;
  slot.state.CFLAG[CFLAG_ID.初吻喪失对手] = partnerNum;
  slot.state.CFLAG[CFLAG_ID.初吻喪失対象] = 0;
  state.firstKissHistory ??= {};
  state.firstKissHistory[slot.charaNum] = {
    dayIndex: state.time.dayIndex,
    location: slot.location,
    partner: { kind: "character", charaNum: partnerNum },
    situation: "ordinary",
  };
  // `AddEXP("愛情経験", …, 10)` — granted once, on the first kiss only.
  slot.state.EXP[EXP_ID.愛情経験] = (slot.state.EXP[EXP_ID.愛情経験] ?? 0) + 10;
  return true;
}

/**
 * `ADD_KISS(target, count)` — `count` is upstream's `ARG:1` 接吻経験 amount and
 * defaults to 1 (a single kiss). Returns which sides registered a first kiss so
 * callers can emit the matching prose.
 */
export function addKiss(
  state: GameState,
  target: CharaSlot,
  count = 1,
): { targetFirst: boolean; masterFirst: boolean } {
  const targetFirst = recordFirstKiss(state, target, state.master.charaNum);
  const masterFirst = recordFirstKiss(state, state.master, target.charaNum);
  const amount = Math.max(0, Math.trunc(count));
  target.state.EXP[EXP_ID.接吻経験] = (target.state.EXP[EXP_ID.接吻経験] ?? 0) + amount;
  state.master.state.EXP[EXP_ID.接吻経験] =
    (state.master.state.EXP[EXP_ID.接吻経験] ?? 0) + amount;
  target.state.CFLAG[CFLAG_ID.既成事実] =
    (target.state.CFLAG[CFLAG_ID.既成事実] ?? 0) | KISS_BIT;
  return { targetFirst, masterFirst };
}
