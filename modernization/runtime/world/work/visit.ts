/**
 * The original eraTW activity-window model — `@VISIT` (`COMMON.ERB:868`).
 *
 * A character's "activity window" is the half-open interval
 * `[来訪時間, 帰宅時間)` read from their CSV (`フラグ,来訪時間,N` /
 * `フラグ,帰宅時間,N`). While inside it the character is "out and about"
 * (visiting / roaming); outside it they head home (`@KITAKU`).
 *
 * This module ports only the **main arm** of `@VISIT` (line 880:
 * `RETURNF BETWEENTIME(CFLAG:来訪時間, CFLAG:帰宅時間)`). The upstream special
 * cases — the 幻想乡大地图 region extension (873), the slept-over-so-still-
 * active early-morning case (877) — are deferred; they need the DLC large-map
 * and the 拠点来訪/sleepover flags this runtime doesn't drive yet. The main arm
 * is the common case for every bundled character.
 *
 * `BETWEENTIME(a, b, t)` is the faithful port of `@BETWEENTIME`
 * (`COMMON.ERB:847`): half-open `[a, b)` when `a < b`, midnight-wrapping
 * (`t >= a || t < b`) when `a >= b`.
 */

import { CFLAG_ID } from "../../state/settlement.js";
import type { CharaSlot } from "../../state/game-state.js";

/** `@BETWEENTIME(ARG, ARG:1)` — is `t` in the (possibly midnight-wrapping)
 *  half-open interval `[a, b)`? `t` is minutes-of-day (0..1439). */
export function betweenTime(a: number, b: number, t: number): boolean {
  if (a < b) return t >= a && t < b;
  return t >= a || t < b;
}

/**
 * `@VISIT` main arm — is `chara` inside their `[来訪時間, 帰宅時間)` activity
 * window at minute `t`? Characters whose CSV left the window unset (0) are
 * treated as never active (faithful: a 0..0 window is empty).
 */
export function isInVisitWindow(chara: CharaSlot, t: number): boolean {
  const visit = chara.state.CFLAG[CFLAG_ID.来訪時間] ?? 0;
  const ret = chara.state.CFLAG[CFLAG_ID.帰宅時間] ?? 0;
  if (visit <= 0 || ret <= 0) return false;
  return betweenTime(visit, ret, t);
}
