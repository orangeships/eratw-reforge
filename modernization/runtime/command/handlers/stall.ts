/**
 * Phase 7.5 (§3C) — `COMF447 露店を開く` (open a roadside stall), the
 * "sell gathered 素材 → MONEY" command that closes the 采集→売→MONEY loop
 * (the explicit P3 deferral). Faithful to the **base** eraTW algorithm in
 * `ERB/コマンド関連/COMF/日常系/COMF447 露店を開く.ERB`.
 *
 * The mechanism lives in `runtime/state/stall.ts` (sellable table, stall
 * spot, 商人パワー, `@STALL_PRICE_SET` pricing, the 来客 sale loop,
 * money/item/time/downbase/exp settlement, atomic `shopSell`). This handler
 * is the thin COMF437 wrapper: execCheck (`@COM_ABLE447`) + building the
 * goods lineup + narration.
 *
 * **Interactive picker deferred (B9).** The ERB `INPUT`/`$SELECT_LOOP`/
 * `$INPUT_LOOP02` per-item + qty menu (ERB 127-314) is a 交互-prompt
 * concern (same deferral as 352 告白 / 421 full / 434 full). This MVP
 * builds the lineup from **all sellable items in inventory** (up to 9
 * distinct, full owned qty each) — a valid "open stall, sell everything"
 * session. The 来客 loop naturally caps sales by 来客数 (more distinct
 * goods than visitors → stock left unsold, faithfully). When B9 lands,
 * the picker replaces the lineup builder; `runStall` is unchanged.
 *
 * Ported faithfully (handler layer):
 *   - **execCheck** (`@COM_ABLE447`, ERB 760-785): `STALL_SPOT(現在位置)`
 *     != 0, not 睡眠, not 诶嘿嘿, `気力 >= 300`, `体力 >= 400`, not
 *     `FLAG:時間停止`. Plus `STALL_PERMISSION` for spot 1 (霊夢親密 < 5 →
 *     blocked; ERB 994-1001 / 1026). Spots 5/7/8/9/10/11 permission gates
 *     defer with their maps; spot 3 (人里) has no gate (faithful).
 *   - **lineup** — every sellable item the player owns (ERB 132-162 lists
 *     these; we take all, up to the 9-slot cap, full owned qty).
 *   - **delegation** to `runStall` for the sale loop + settlement.
 *
 * **Deferred (handler layer; mechanism deferrals in stall.ts header):**
 *   - Interactive per-item + qty picker (B9) — lineup is "all sellable".
 *   - 约会中 gate (ERB 772) + 约会 assistant (ERB 107-120) — no dating.
 *   - 酒类招呼 `[100]` (ERB 190-233) — B9 interactive + 酒 inventory.
 *   - STALL_PERMISSION spots 5/7/8/9/10/11 (ERB 1005-1019 / 1037-1052) —
 *     their maps aren't walkable yet.
 *   - TFLAG:100 menu-reach gate (ERB 763) — not modeled (catalog
 *     reachability; same as prayer/omikuji).
 *   - TFLAG:193/194 are surfaced in `runStall`'s result + narration, not
 *     persisted (master-only command skips SOURCE/KOJO; see stall.ts header).
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry, CommandContext } from "../types.js";
import { createRng } from "../rng.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  getMasterBase,
  getMasterCflag,
} from "../../state/settlement.js";
import {
  itemSellable,
  runStall,
  stallSpot,
  type StallLineupEntry,
} from "../../state/stall.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE447` core (ERB 760-785) + STALL_PERMISSION spot 1
// ---------------------------------------------------------------------------

function checkStallEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const state = ctx.state;
  // ERB 769: STALL_SPOT(現在位置) must be non-zero (a stall-able spot).
  const spot = stallSpot(state.master.location);
  if (spot === 0) {
    return { ok: false, reason: { kind: "precondition", message: "这里不能摆摊。" } };
  }
  // ERB 775: not sleeping.
  if (getMasterCflag(state, CFLAG_ID.睡眠) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中不能摆摊。" } };
  }
  // ERB 777: not in 诶嘿嘿.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是摆摊的时候。" } };
  }
  // ERB 780: 気力 >= 300 && 体力 >= 400.
  if ((getMasterBase(state, BASE_ID.気力) ?? 0) < 300) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法摆摊。" } };
  }
  if ((getMasterBase(state, BASE_ID.体力) ?? 0) < 400) {
    return { ok: false, reason: { kind: "precondition", message: "体力不足，无法摆摊。" } };
  }
  // ERB 783: not 時間停止 (FLAG:70).
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能摆摊。" } };
  }
  // STALL_PERMISSION is handled after selection in the shrine interaction;
  // it is not an @COM_ABLE menu threshold. Low intimacy must not hide 447.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM447` core (lineup = all sellable; mechanism in runStall)
// ---------------------------------------------------------------------------

/** Max goods slots a stall puts up (ERB GoodsID:1-9, `Lineup < 9`). */
const MAX_SLOTS = 9;

/**
 * Build the goods lineup from the player's sellable inventory — every
 * sellable item owned (up to `MAX_SLOTS` distinct), full owned qty each.
 * This is the MVP default for the deferred interactive picker (B9).
 */
function buildLineup(state: GameState): StallLineupEntry[] {
  const items = state.items;
  if (!items) return [];
  const lineup: StallLineupEntry[] = [];
  for (const idStr of Object.keys(items)) {
    if (lineup.length >= MAX_SLOTS) break;
    const id = Number(idStr);
    const qty = items[id] ?? 0;
    if (qty > 0 && itemSellable(id)) {
      lineup.push({ id, qty });
    }
  }
  return lineup;
}

export const stallHandlerEntry: HandlerEntry = {
  commandNo: 447,
  execCheck: (ctx) => {
    const r = checkStallEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const spot = stallSpot(next.master.location);

    // Defensive — execCheck should have blocked spot 0.
    if (spot === 0) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "这里不能摆摊。" },
        ],
        outcome: "noop" as const,
      };
    }

    // Lineup = all sellable inventory (MVP; interactive picker = B9).
    const lineup = buildLineup(next);

    // Run the 来客 sale loop + settlement (ERB 360-671). The 来客演出 text
    // rolls run on a dedicated performance RNG seeded from the tick — they
    // are presentation-only and must not perturb the settlement stream
    // (stall.test.ts pins the hand-traced economy trace).
    const result = runStall(next, lineup, spot, ctx.rng, createRng(next.time.tickValue * 100003 + 447));

    // Narration — the ERB 360-624 beats verbatim (greeting / no-sale /
    // customer line / sold / closing / 成果 summary). 成交行 carries the
    // auspicious tone the upstream SETCOLOR 0x00FF00 marks.
    const events = result.performance.map((beat) => ({
      kind: "NARRATION" as const,
      timestamp: ctx.now(),
      text: beat.text,
      surface: "stall" as const,
      tone: (beat.kind === "sold" || beat.kind === "soldOut" ? "auspicious" : "plain") as
        | "auspicious"
        | "plain",
    }));

    return {
      state: next,
      events,
      outcome: "ok" as const,
    };
  },
};
