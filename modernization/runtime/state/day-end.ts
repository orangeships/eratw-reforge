/**
 * Phase 8 — day-end settlement, fired at the midnight boundary.
 *
 * Closes the MONEY loop: 304 仕事を手伝う accumulates a wage credit into
 * `TCVAR:315 帮忙工作量` (`work.ts`), but the credit only becomes yen at
 * day-end (`EVENTTURNEND.ERB:331 RANK_POINT` → `MONEY += TCVAR:MASTER:
 * 帮忙工作量`). Without a day-end, the credit never cashes out and the
 * 1/day gates on 421 願掛け / 434 おみくじ never refresh (they reset in
 * `BEFORETRAIN:523` / `AFTERTRA:52`, also day-end flow).
 *
 * **Phase 8 decoupling:** day-end is no longer triggered by the sleep
 * command. Upstream eraTW fires it from the main loop when `TIME` crosses
 * a day boundary (`@INFO_GO_NEXTDAY`, `INFO.ERB:1232`: `SIF TIME <= 1440:
 * RETURN` — fires only past midnight, then `DAY++; TIME -= 1440`); the
 * modernized `advanceClock` (`runtime/world/clock.ts`) is the single time
 * authority and calls `runDayEnd` once per crossed midnight. Sleep is now
 * just a time fast-forward through midnight (which triggers this) plus
 * wake-recovery (lives in `sleep.ts`, per `BEFORETRAIN:334-357`).
 *
 * `runDayEnd` does the SETTLE + RESET halves only — it does **not** touch
 * `dayIndex` (the clock authority owns that) and does **not** do sleep
 * recovery (the sleep command owns that). eraTW day-end has three phases
 * (verified against ERB); this module owns phases 1 + 3:
 *   1. **Settle** (`EVENTTURNEND:RANK_POINT`, ERB 302-351):
 *      - 清掃奖励 `LOCAL:2 = EX:今日的掃除回数 / 10` → `MONEY += LOCAL:2`
 *        (era integer division, trunc). COMF410 accumulates `EX:MASTER:
 *        今日的掃除回数 += SWEEP_YOGORE` (the dirt swept) on each clean.
 *        大扫除 x2 (DAY:2==4 && DAY:3==31) **deferred** (date subsystem);
 *        好感度/信赖度 on 拠点_家主 + 平价食材 item grant **deferred**
 *        (needs home-owner resolution + ITEM:安物食材 id).
 *      - 帮忙工资 `LOCAL:4 = TCVAR:MASTER:帮忙工作量` → `MONEY += LOCAL:4`
 *        (黄金律 +30% MAGIC_DLC — deferred).
 *      - then clear `TCVAR:315` (RANK_POINT reads but doesn't clear; the
 *        real clear site wasn't found by grep — likely a full
 *        `VARSET TCVAR:MASTER` — but a cross-day clear is logically
 *        mandatory to avoid double-paying. Marked as fidelity TBD).
 *   2. **Advance day** (`INFO.ERB:1261`): `DAY++` — OWNED BY `advanceClock`
 *      (`dayIndex = floor(tickValue / 1440)`), NOT here.
 *   3. **1/day reset** (BEFORETRAIN:523-524 + AFTERTRA:52):
 *      - `FLAG:祈願内容 = 0`, `FLAG:精力強化回数 = 0`
 *      - `CLEARBIT FLAG:おみくじ, 1` (bit1 = 今日已抽)
 *
 * **Deferred**: 清掃奖励 (`EX:今日的掃除回数`) full reset, child support,
 * 赌场筹码, 陷落素質判定, BEFORETRAIN's full reset (服装/位置/生理周期/
 * 陪睡中/徹夜/大运蘑菇惩罚/起床妨害), BUFF_RESET, 睡眠深度/疲労度, real
 * 睡眠時間 clock, 安眠補正, SHOP_EVENTTURNEND 道具入货, 天候/月份推进.
 */

import type { GameState } from "./game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { EX_ID, FLAG_ID, TCVAR_ID } from "./settlement.js";
import { grant, formatMoney } from "./money.js";
import { advanceCalendarDay } from "../world/calendar.js";
import { enforceCognitiveCaps } from "../agent/init.js";
import { selectRosterAtNight } from "../agent/roster.js";
import { accrueDailyDirt } from "../world/dirt-accrual.js";
import { createRng } from "../command/rng.js";
import { refreshWeatherForecastsForNewDay } from "../weather/prediction.js";
import { clearTflagsByLifecycle } from "./tflag.js";
import { applyBanquetStateProjection, scheduleBanquet } from "../world/banquet.js";
import { restockAllShopsAtDayEnd } from "./shop.js";

/** `FLAG:おみくじ` (999) bit1 — 今日已抽 (1/day gate, COMF434). */
const BIT_OMIKUJI_TODAY_DRAWN = 1 << 1;

/**
 * Run the day-end settlement on `state` (mutates in place — caller must
 * pass a cloned state). Returns the narration events for the caller to
 * merge + restamp. Does NOT advance `dayIndex` (the clock authority owns
 * that) and does NOT do sleep recovery (the sleep command owns that).
 *
 * Order matches eraTW: settle cleaning → settle wages → reset 1/day flags.
 * Idempotent w.r.t. the gate resets, so firing it once per crossed
 * midnight (even multiple in one `advanceClock` call) is faithful — the
 * 2nd+ firing cashes 0 wages (TCVAR cleared) and re-resets already-reset
 * gates.
 */
export function runDayEnd(state: GameState): {
  events: ObservationEvent[];
} {
  const events: ObservationEvent[] = [];

  // ----- 1a. Settle cleaning reward (RANK_POINT, ERB 309) -----
  // LOCAL:2 = EX:MASTER:今日的掃除回数 / 10 (era int division). Cashed out
  // before wages (ERB order: LOCAL:2 then LOCAL:4), then the accumulator is
  // cleared cross-day. Like TCVAR:315, the real eraTW clear site isn't
  // grep-able (likely a bulk VARSET in the train-reset flow); a cross-day
  // clear is logically mandatory to avoid re-paying yesterday's dirt.
  const swept = state.master.state.EX[EX_ID.今日的掃除回数] ?? 0;
  if (swept > 0) {
    const cleaningReward = Math.trunc(swept / 10);
    if (cleaningReward > 0) {
      grant(state, cleaningReward);
      events.push({
        kind: "NARRATION",
        timestamp: 0, // advanceClock stamps via now()
        text: `清扫得到的额外奖励 ${formatMoney(cleaningReward)}。`,
      });
    }
    state.master.state.EX[EX_ID.今日的掃除回数] = 0;
  }

  // ----- 1b. Settle wages (RANK_POINT, ERB 331 + 339) -----
  const wages = state.master.state.TCVAR[TCVAR_ID.帮忙工作量_MASTER] ?? 0;
  if (wages > 0) {
    grant(state, wages);
    events.push({
      kind: "NARRATION",
      timestamp: 0, // advanceClock stamps via now()
      text: `帮忙干活得到的额外奖励 ${formatMoney(wages)}。`,
    });
    // Clear the credit so it isn't paid twice. Real eraTW clear site not
    // found by grep (RANK_POINT reads but doesn't zero); a cross-day clear
    // is logically mandatory. Fidelity TBD for Phase 8.
    state.master.state.TCVAR[TCVAR_ID.帮忙工作量_MASTER] = 0;
  }

  // ----- 2. Advance day (INFO.ERB:1261 DAY++) — OWNED BY advanceClock -----
  // advanceClock recomputes dayIndex = floor(tickValue / 1440); runDayEnd
  // must NOT also bump it (double-advance). Phase 7's advanceDay did the
  // bump here because there was no clock authority; Phase 8 removed it.

  // ----- 1c. 汚れ自然増加 (AFTERTRA.ERB:283-298) -----
  // Every room in the master's current map gets a day's dirt; NPC-owned 私室
  // self-clean, public squares cap at 500. This is what gives 掃除[410] and the
  // 清洁度 display something to act on (see world/dirt-accrual.ts).
  accrueDailyDirt(state);

  // ----- 2b. Advance calendar (INFO.ERB:1262 DAY:3++) — season/date -----
  // eraTW bumps DAY:3 (date) at the day-end site; on >31 it wraps and
  // bumps season (日時天候管理.ERB @CHANGE_MONTH). dayIndex is owned by
  // advanceClock above; the (season, date) pair is tracked separately
  // (124-day cycle, not derivable from dayIndex). Phase 7.1b.
  const seasonWrapped = advanceCalendarDay(state.time);
  const weatherRng = createRng((state.time.tickValue + state.time.dayIndex * 31 + (state.time.season ?? 1) * 997) | 0);
  refreshWeatherForecastsForNewDay(state, weatherRng, seasonWrapped);
  // Raw unit fixtures may omit the migrated banquet-enabled flag; treat that
  // as a pre-migration state and let save migration supply the explicit 1.
  if (state.flagStore[3] !== undefined) {
    const banquet = scheduleBanquet(state, weatherRng);
    applyBanquetStateProjection(state, banquet.state);
    for (const event of banquet.events) events.push(event);
    if (banquet.diagnostics.length > 0) {
      events.push({ kind: "STATUS_MESSAGE", timestamp: 0, source: "system", text: banquet.diagnostics.join("; ") });
    }
  }

  // ----- 3. 1/day reset (BEFORETRAIN:523-524 + AFTERTRA:52) -----
  state.flagStore[FLAG_ID.祈願内容] = 0;
  state.flagStore[FLAG_ID.精力強化回数] = 0;
  const omikuji = state.flagStore[FLAG_ID.おみくじ] ?? 0;
  state.flagStore[FLAG_ID.おみくじ] = omikuji & ~BIT_OMIKUJI_TODAY_DRAWN;
  // BEFORETRAIN resets day-scoped TFLAG fields together. This reopens nap,
  // once-per-day, and public-bath gates without touching session/persistent
  // TFLAG state.
  clearTflagsByLifecycle(state, "day");
  restockAllShopsAtDayEnd(state);

  // A1 — nightly agent roster selection + cognitive cap enforcement.
  // The day is settled; recompute the dynamic top-N before the morning
  // pipeline (来訪/encounter/commission) reads from it.
  const ar = state.agentRuntime;
  if (ar?.settings.masterEnabled) {
    enforceCognitiveCaps(ar);
    selectRosterAtNight(ar, state, state.time.tickValue, state.time.dayIndex);
  }

  return { events };
}
