/**
 * Phase 7 — `COMF434 おみくじ` (shrine fortune slip), MONEY-namespace C-tier.
 *
 * Faithful to `ERB/コマンド関連/COMF/日常系/COMF434 おみくじ.ERB`. The ERB
 * command: shows a first-visit notice (bit0), gates 1/day (bit1), charges
 * 200 円, advances TIME 2, then `CALL FORTUNE` (a 12-CASE subsystem that
 * sets bit10 当たり on a win), and on a win refunds the 200 円 with flavor.
 *
 * **MVP simplification:** we do NOT call the full `FORTUNE` 12-CASE
 * subsystem (it cross-links EVENTTURNEND / 礼物 / luck modifiers — a
 * separate slice). Instead we roll an 8-bucket fortune (`rng.int(8)`) and
 * treat 大吉/吉/中吉 as the 当たり (1/3 → refund 200 円), mirroring the
 * ERB win→refund flow (`MONEY += 200`, ERB 132). The 8 buckets are a
 * superset of eraTW's standard 御神签 ladder (大吉/吉/中吉/小吉/末吉/凶/
 * 大凶) plus a placeholder "——" to reach the RNG's 8-width (the real
 * FORTUNE ladder width is not 8; this is an explicit MVP shortcut,
 * documented for the FORTUNE slice to replace).
 *
 * ERB 6-137 sequence modeled here:
 *   1. (bit0 notice — deferred; first-visit flavor only, no state effect)
 *   2. bit1 gate (`GETBIT(FLAG:999, 1)` → 1/day, RETURN -1)        [execCheck]
 *   3. `MONEY < 200` → 望了望钱包… RETURN -1                        [handler noop]
 *   4. `MONEY -= 200` (ERB 53)
 *   5. `TIME += 2`    (ERB 54)
 *   6. `SETBIT FLAG:999, 1` (ERB 55) — mark today's draw
 *   7. roll fortune; if 当たり → `MONEY += 200` refund (ERB 132)
 *
 * **DEFERRED:**
 *   - Full `FORTUNE` 12-CASE subsystem (luck/礼物/EVENTTURNEND linkage).
 *   - bit0 first-visit notice print + `PRINT_AA(27)` art.
 *   - `RAND:18` box-state flavor text (ERB 57-82) — 6 print variants for
 *     "how full the slip box is"; cosmetic, omitted.
 *   - `OMIKUJI_SPOT` exact predicate (only 博麗神社賽銭箱,
 *     `GET_MAP_REPLACEMENT(3)`) — approximated as "loc 含 神社".
 *   - `M_TFLAG:转运魔法CD = 0` (ERB 86) — teleport-CD reset, unrelated
 *     subsystem; omitted.
 *   - `TFLAG:100` menu-reach gate — not modeled (catalog reachability).
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterBase,
} from "../../state/settlement.js";
import { canAfford, formatMoney, grant, pay } from "../../state/money.js";

// ---------------------------------------------------------------------------
// Constants — COMF434
// ---------------------------------------------------------------------------

/** ERB 18/39/53: 御神签 costs 200 円. */
const COST_OMIKUJI = 200;
/** ERB 54: `TIME += 2` — minutes. */
const TIME_COST = 2;
/** `@OMIKUJI_SPOT` = the 博麗神社 offering box only (Parity QA P-18). */
const OMIKUJI_SPOT = "神社:賽銭箱";
/** `FLAG:おみくじ` (999) bit masks. */
const BIT_TODAY_DRAWN = 1 << 1; // bit1 — 1/day gate.
// bit0 (告示既読) and bit10 (当たり) are ERB-defined; bit10 is set+cleared
// within a single command in our MVP (we refund inline), so we don't
// persist it. BIT_TODAY_DRAWN is the only bit we read across calls.

/** 8-bucket fortune ladder (MVP — see file header). Index 0..2 refund. */
const FORTUNES = [
  "大吉",
  "吉",
  "中吉",
  "小吉",
  "末吉",
  "凶",
  "大凶",
  "——",
] as const;
/** 当たり buckets → refund 200 円 (simulates FORTUNE setting bit10). */
const WINNING_INDICES = new Set([0, 1, 2]);

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE434` (ERB 143-160) + 1/day gate (ERB 34-37)
// ---------------------------------------------------------------------------

function checkOmikujiEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const master = ctx.state.master;
  const omikuji = ctx.state.flagStore[FLAG_ID.おみくじ] ?? 0;

  // ERB 158: 時間停止中は不可.
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法抽签。" } };
  }
  // ERB 155: 賽銭箱 (`OMIKUJI_SPOT` = 博麗神社賽銭箱 ONLY — `GET_MAP_REPLACEMENT(3)`).
  // Parity QA P-18: was "loc 含 神社" (the whole shrine could draw); faithful
  // gate is the exact 賽銭箱 room. So 御神签 only shows when standing at the
  // offering box, not anywhere in the shrine.
  if (master.location !== OMIKUJI_SPOT) {
    return { ok: false, reason: { kind: "precondition", message: "只有在神社的赛钱箱前才能抽御神签。" } };
  }
  // ERB 152: 気力0では不可.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法抽签。" } };
  }
  // ERB 34-37: bit1 — 1/day gate (`GETBIT(FLAG:999, 1)` → RETURN -1).
  if ((omikuji & BIT_TODAY_DRAWN) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "抽御神签是1天1次。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM434` (ERB 6-137, MVP)
// ---------------------------------------------------------------------------

export const omikujiHandlerEntry: HandlerEntry = {
  commandNo: 434,
  execCheck: (ctx) => {
    const r = checkOmikujiEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);

    // ERB 39-43: `MONEY < 200` → 望了望钱包可是没带够钱… RETURN -1.
    if (!canAfford(next, COST_OMIKUJI)) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `望了望钱包可是没带够钱。御神签需要 ${formatMoney(COST_OMIKUJI)}。`,
          },
        ],
        outcome: "noop" as const,
        failReason: { kind: "precondition", message: "金钱不足" },
      };
    }

    // ERB 53: `MONEY -= 200`.
    pay(next, COST_OMIKUJI);
    // ERB 54: `TIME += 2`.
    advanceTimeTicks(next, TIME_COST);
    // ERB 55: `SETBIT FLAG:999, 1` — mark today's draw.
    next.flagStore[FLAG_ID.おみくじ] = (next.flagStore[FLAG_ID.おみくじ] ?? 0) | BIT_TODAY_DRAWN;

    // ERB 57 + 87: roll the fortune (MVP: 8 buckets, NOT RAND:18 box-state
    // nor the full FORTUNE 12-CASE subsystem — see file header).
    const idx = ctx.rng.int(FORTUNES.length);
    const fortune = FORTUNES[idx]!;
    const won = WINNING_INDICES.has(idx);

    // ERB 90-134: 当たり (bit10) → `MONEY += 200` refund (ERB 132).
    if (won) {
      grant(next, COST_OMIKUJI);
    }

    const refundText = won ? "赛钱箱里飞出了刚才投进去的钱，算是中奖的回礼。" : "";
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%向赛钱箱投入了 ${formatMoney(COST_OMIKUJI)}，抽到了一张御神签——${fortune}。${refundText}`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
