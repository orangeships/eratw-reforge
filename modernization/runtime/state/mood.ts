/**
 * Phase 7 — `mood.ts`: the 心情 / 憤怒 (mood / anger) subsystem.
 *
 * Two daily commands share one cluster of mood state, so it earns a
 * subsystem module (per CLAUDE.md "recurs ≥2 commands"):
 *
 *   - **COMF303 謝る** (apologize) — gated on the target being angry
 *     (`CFLAG:勃然大怒`); a successful reconcile clears the anger.
 *   - **COMF333 愚痴を聞く** (listen to complaints) — its good outcomes
 *     (CASE 2/3/6) also halve `BASE:憤怒` and clear `CFLAG:不機嫌`.
 *
 * The cluster these helpers model (`COMF303 謝る.ERB` lines 96-108 +
 * `COMF333 愚痴を聞く.ERB` lines 54-77):
 *
 *   - `CFLAG:勃然大怒` (318, ERB alias `ブチギレ`) — full-rage flag.
 *   - `CFLAG:不機嫌`  (322, ERB alias `心情不快`) — sulking flag.
 *   - `BASE:憤怒`     (12) — the numeric anger value.
 *   - `TALENT:心情`   (15, .als `機嫌`) — disposition; 333 raises it.
 *
 * **Reconcile semantics** (303 lines 96-106):
 *   - success (TFLAG:193 == 0): 勃然大怒=0, 不機嫌=0, 憤怒 /= 2 (trunc)
 *   - great   (TFLAG:193 == 1): 勃然大怒=0, 不機嫌=0, 憤怒 = 0
 *   - 憤怒 then clamped ≥ 0 (line 107).
 *   333's good arms (lines 57/63/76) do `憤怒 /= 2` + `不機嫌 = 0`.
 *
 * **Defer policy** (uniform, documented — same posture as attitude.ts):
 *   - `MARK:反発刻印` (Mark.als:3) — MARK namespace not modeled in
 *     GameState. The 303 點心盒/败犬 reconcile-via-item arm (ERB 109-117)
 *     is deferred entirely.
 *   - `ITEM:點心盒` — ITEM namespace not modeled → deferred.
 *   - `CFLAG:败犬` (303 line 6) — not found in any .als; treated as 0
 *     (the "irredeemable" early-return arm never fires in our slice).
 *
 * These are pure functions over a `CharaSlot` (the angry party / target),
 * mirroring the attitude.ts subsystem shape.
 */

import type { CharaSlot } from "./game-state.js";
import { BASE_ID, CFLAG_ID } from "./settlement.js";
import type { DomainTransition } from "./domain-transition.js";

// ---------------------------------------------------------------------------
// Anger predicate
// ---------------------------------------------------------------------------

/**
 * Whether the target is in a full-rage state (`CFLAG:勃然大怒 != 0`).
 * COMF303's `@COM_ABLE303` (ERB line 145) gates 謝る on this — you can
 * only apologize to someone who is actually angry. (The ERB's OR with
 * the 點心盒/反発刻印 item arm is deferred — MARK/ITEM not modeled.)
 */
export function isAngry(slot: CharaSlot): boolean {
  return (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0;
}

// ---------------------------------------------------------------------------
// Reconcile — clear anger on a successful apology / vent
// ---------------------------------------------------------------------------

/**
 * Clear the target's anger after a successful reconcile.
 *
 * `great` distinguishes 303's two success tiers (ERB lines 96-103):
 *   - `great = false` (TFLAG:193 == 0, plain success): 憤怒 /= 2 (trunc).
 *   - `great = true`  (TFLAG:193 == 1, 大成功):          憤怒 = 0.
 * Both clear `CFLAG:勃然大怒` and `CFLAG:不機嫌`. 憤怒 is clamped ≥ 0
 * afterward (ERB line 107-108).
 *
 * 333's good arms call this with `great = false` (they `憤怒 /= 2` and
 * clear 不機嫌 but do not touch 勃然大怒 in the ERB — clearing an unset
 * flag is a no-op, so the shared helper stays faithful).
 *
 * Mutates `slot` in place — callers operate on a cloned next-state slot.
 */
export function clearAnger(
  slot: CharaSlot,
  great: boolean,
): DomainTransition | null {
  const wasAngry = isAngry(slot);
  slot.state.CFLAG[CFLAG_ID.勃然大怒] = 0;
  slot.state.CFLAG[CFLAG_ID.不機嫌] = 0;
  const fury = slot.state.BASE[BASE_ID.憤怒] ?? 0;
  const next = great ? 0 : Math.trunc(fury / 2);
  slot.state.BASE[BASE_ID.憤怒] = Math.max(0, next);
  return wasAngry
    ? { kind: "anger-cleared", charaNum: slot.charaNum }
    : null;
}

// ---------------------------------------------------------------------------
// 303 謝る — SOURCE:征服 bracket (ERB lines 62-93)
// ---------------------------------------------------------------------------

/**
 * The 征服 (subjugation) SOURCE that 謝る builds when the target is in
 * full rage (`CFLAG:ブチギレ`), ERB lines 60-93. A fixed +400 base, a
 * 従順-bracket bonus, and a 親密-bracket penalty, clamped ≥ 0.
 *
 *   base                      = 400                       (ERB 61)
 *   + 従順 bracket (ERB 63-75):
 *       従順 ≤ 1  → +2000 - 従順*30
 *       従順 ≤ 3  → +1000 - 従順*30
 *       従順 ≤ 5  →  +750 - 従順*40
 *       従順 ≤ 8  →  +500 - 従順*20
 *       従順 ≤ 11 →  +200 - 従順*20
 *       else      →  +100 - 従順*10
 *   - 親密 bracket (ERB 78-90):
 *       親密 ≤ 1  → -親密*60
 *       親密 ≤ 3  → -親密*60
 *       親密 ≤ 5  → -親密*60
 *       親密 ≤ 8  → -親密*50
 *       親密 ≤ 11 → -親密*40
 *       else      → -親密*30
 *   clamp ≥ 0                 (ERB 92-93)
 */
export function apologySubjugation(juujun: number, shinmitsu: number): number {
  let s = 400;

  // 従順 bracket (ERB 63-75).
  if (juujun <= 1) s += 2000 - juujun * 30;
  else if (juujun <= 3) s += 1000 - juujun * 30;
  else if (juujun <= 5) s += 750 - juujun * 40;
  else if (juujun <= 8) s += 500 - juujun * 20;
  else if (juujun <= 11) s += 200 - juujun * 20;
  else s += 100 - juujun * 10;

  // 親密 bracket (ERB 78-90).
  if (shinmitsu <= 1) s -= shinmitsu * 60;
  else if (shinmitsu <= 3) s -= shinmitsu * 60;
  else if (shinmitsu <= 5) s -= shinmitsu * 60;
  else if (shinmitsu <= 8) s -= shinmitsu * 50;
  else if (shinmitsu <= 11) s -= shinmitsu * 40;
  else s -= shinmitsu * 30;

  return Math.max(0, s);
}
