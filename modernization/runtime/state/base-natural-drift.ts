/**
 * `@BASE自然変動` — per-tick natural BASE drift (non-DLC core slice).
 *
 * Source: `eratw-sub-modding-main/ERB/MOVEMENTS/BASE自然変動.ERB`. eraTW calls
 * `@BASE自然変動(ARG)` for each character whenever in-game time advances, with
 * `Lapse = TIME_PROGRESS(...)` = the minutes elapsed since the last call. It
 * lets emotional/stat gauges drift back toward rest while the world ticks.
 *
 * This ports the deterministic base-game core that the runtime can model:
 *
 *   - Away from the master (ERB 18-21): 情緒 (agitation) decays toward 0,
 *     理性 (rationality) recovers toward its MAXBASE cap.
 *   - Working, `CFLAG:行动 == 5` (ERB 102-103): 仕事量 (work-done gauge) drains.
 *   - 理性 is always clamped to `[0, MAXBASE]` afterward (ERB 99).
 *   - Resting NPCs recover 体力/気力 (ERB 243-248).
 *   - 衰弱 recovers and clears 休憩中 after 体力 exceeds half (ERB 250-266).
 *
 * DEFERRED (the rest of the 672-line function): everything behind `MAGIC_DLC`,
 * the weather/umbrella damage (ERB 267-495), 媚毒(ポイズンゲージ)/魅惑/仙香玉兎/
 * 毒气花园 発情 induction, 勃起 drift, 酒気/睡眠深度/疲労度,
 * 肮脏度/YOGORE soiling, and the
 * base-game 憤怒 natural decrease (ERB 108-122) — that last one IS base-game
 * (the `ELSE` branch at 112) but overlaps the existing `mood.ts` anger
 * subsystem, so it's left for a coordinated pass rather than wired blind here.
 *
 * Pure function over a single `CharaSlot`; mutates its BASE in place. era
 * integer division truncates toward zero — modelled with `Math.trunc`.
 */

import type { CharaSlot } from "./game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  TALENT_ID,
  TCVAR_ID,
  recoverBase,
} from "./settlement.js";

/** Action-type value meaning "currently working" (`CFLAG:行动`, ERB 102). */
const ACTION_WORKING = 5;

/**
 * Apply one tick of natural BASE drift to `slot`, given the master's current
 * location and the minutes elapsed (`lapseMinutes`). No-op when no time passed.
 *
 * 理性 is only touched when the chara has a real `MAXBASE:理性` cap (> 0) — a
 * bare fixture with an unset cap is left alone (the same "no ceiling → don't
 * touch" rule load-chara / recoverPermil follow), so unseeded test states are
 * not driven to 0.
 */
export function applyNaturalDrift(
  slot: CharaSlot,
  masterLocation: string,
  lapseMinutes: number,
  options: { ordinaryRest?: boolean } = {},
): void {
  if (lapseMinutes <= 0) return;
  const lapse = lapseMinutes;
  const base = slot.state.BASE;
  // Old saves and the Phase-4 minimal fixtures predate MAXBASE. Natural drift
  // must remain a no-op for capped recovery in that shape, not crash the tick.
  const hasMaxbase = slot.state.MAXBASE != null;
  const maxbase = slot.state.MAXBASE ?? [];
  const maxRisei = maxbase[BASE_ID.理性] ?? 0;
  const hasRiseiCap = maxRisei > 0;

  // Away from the master (ERB 18-21).
  if (slot.location !== masterLocation) {
    // 情緒 = 情緒 - Lapse*4*(情緒+500)/500, floored at 0.
    const joucho = base[BASE_ID.情緒] ?? 0;
    base[BASE_ID.情緒] = Math.max(
      0,
      joucho - Math.trunc((lapse * 4 * (joucho + 500)) / 500),
    );
    // 理性 = 理性 + Lapse*(MAXBASE理性+500)/(理性+500).
    if (hasRiseiCap) {
      const risei = base[BASE_ID.理性] ?? 0;
      base[BASE_ID.理性] = risei + Math.trunc((lapse * (maxRisei + 500)) / (risei + 500));
    }
  }

  // 理性 = LIMIT(理性, 0, MAXBASE理性) (ERB 99, always runs).
  if (hasRiseiCap) {
    base[BASE_ID.理性] = Math.min(maxRisei, Math.max(0, base[BASE_ID.理性] ?? 0));
  }

  // Working (ERB 102-103): 仕事量 = MAX(仕事量 - Lapse*10, 0).
  if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING) {
    const work = base[BASE_ID.仕事量] ?? 0;
    base[BASE_ID.仕事量] = Math.max(0, work - lapse * 10);
  }

  // Ordinary NPC rest recovery (ERB 243-248). `ARG` excludes MASTER, and
  // recovery only happens in a non-H, non-working interval of at least 10 min.
  if (
    slot.charaNum !== 0 &&
    options.ordinaryRest !== false &&
    hasMaxbase &&
    !(slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) &&
    !(slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) &&
    (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) !== ACTION_WORKING &&
    lapse >= 10
  ) {
    const recoverySpeed = slot.state.TALENT[TALENT_ID.回復速度] ?? 0;
    const amount = Math.trunc(((10 + recoverySpeed) * lapse) / 20);
    recoverBase(slot, BASE_ID.体力, amount);
    recoverBase(slot, BASE_ID.気力, amount);
  }

  // Weakened recovery (ERB 250-266) applies to MASTER and NPCs. Integer
  // truncation is performed before multiplying by elapsed minutes, matching
  // Emuera expression evaluation.
  if (hasMaxbase && (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) > 0) {
    const recoverySpeed = slot.state.TALENT[TALENT_ID.回復速度] ?? 0;
    const coSleep = (slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0 ? 2 : 1;
    const bodyPerMinute = Math.trunc(
      ((3 + recoverySpeed) * (maxbase[BASE_ID.体力] ?? 0)) / 2000,
    ) * coSleep;
    const willPerMinute = Math.trunc(
      ((3 + recoverySpeed) * (maxbase[BASE_ID.気力] ?? 0)) / 2000,
    ) * coSleep;
    recoverBase(slot, BASE_ID.体力, lapse * bodyPerMinute);
    recoverBase(slot, BASE_ID.気力, lapse * willPerMinute);
    slot.state.CFLAG[CFLAG_ID.衰弱] = Math.max(
      0,
      (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) - lapse,
    );
    const maxBody = maxbase[BASE_ID.体力] ?? 0;
    if (maxBody > 0 && (base[BASE_ID.体力] ?? 0) > maxBody / 2) {
      slot.state.CFLAG[CFLAG_ID.衰弱] = 0;
      slot.state.TCVAR[TCVAR_ID.休憩中] = 0;
    }
  }
}
