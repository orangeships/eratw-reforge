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
 *   - 憤怒 naturally falls, including 合意誤認 / banquet / rage modifiers,
 *     and its rage latch clears at zero (ERB 108-122).
 *   - 睡眠深度 and 疲労度 advance while sleeping and unwind while awake
 *     (ERB 134-163).
 *
 * DEFERRED (the rest of the 672-line function): everything behind `MAGIC_DLC`,
 * the weather/umbrella damage (ERB 267-495), 媚毒(ポイズンゲージ)/魅惑/仙香玉兎/
 * 毒气花园 発情 induction, 勃起 drift, and 肮脏度/YOGORE soiling.
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
import { JOB_ID } from "../world/work/work-manifest.js";

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
  options: {
    ordinaryRest?: boolean;
    randomInt?: (maxExclusive: number) => number;
    /** Global FLAG:不会生气, passed by the GameState scheduler. */
    noAnger?: boolean;
  } = {},
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

  // BASE自然変動.ERB 108-122: 憤怒 falls every elapsed interval. The
  // divisor is intentionally based on the pre-clear rage flag: a normal
  // character loses Lapse*5, a raging one loses less, and the banquet /
  // 合意誤認 arms add their own exact integer-truncated terms.
  const angerBefore = base[BASE_ID.憤怒] ?? 0;
  const rage = slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0;
  let angerDrop = Math.trunc((lapse * 5) / (rage + 1));
  if ((slot.state.TALENT[TALENT_ID.合意誤認] ?? 0) !== 0) {
    angerDrop += Math.trunc((lapse * 10) / (rage + 1));
  }
  if (
    (slot.state.CFLAG[CFLAG_ID.职种] ?? 0) === JOB_ID.宴会参加 &&
    rage > 0
  ) {
    angerDrop += Math.trunc((lapse * 5) / (rage + 1));
  }
  let anger = angerBefore - angerDrop;
  if (anger <= 0) {
    anger = 0;
    slot.state.CFLAG[CFLAG_ID.勃然大怒] = 0;
  }

  // BASE自然変動.ERB 164-166: an unhappy mood pins anger to MAXBASE.
  // A missing cap is represented by zero in old/minimal fixtures, exactly as
  // the upstream MAXBASE lookup does.
  if ((slot.state.CFLAG[CFLAG_ID.不機嫌] ?? 0) !== 0) {
    anger = maxbase[BASE_ID.憤怒] ?? 0;
  }
  // Global FLAG:不会生气 is the final safety arm in the upstream function.
  if (options.noAnger ?? false) anger = 0;
  if (anger <= 0) slot.state.CFLAG[CFLAG_ID.勃然大怒] = 0;
  base[BASE_ID.憤怒] = Math.max(0, anger);

  // BASE自然変動.ERB 123-128: alcohol always falls by elapsed minutes.
  // Characters currently marked 泥酔 lose an additional RAND:4 multiples of
  // the same lapse. RNG is injected so the state function stays deterministic
  // and independently testable.
  const alcohol = base[BASE_ID.酒気] ?? 0;
  const drunkExtra = (slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0
    ? lapse * Math.max(0, Math.min(3, Math.trunc(options.randomInt?.(4) ?? 0)))
    : 0;
  base[BASE_ID.酒気] = Math.max(0, alcohol - lapse - drunkExtra);

  // BASE自然変動.ERB 134-163: sleep depth grows while sleeping, and drains
  // while awake. The fatigue/alcohol contribution is evaluated after the
  // ordinary alcohol decay above, matching the source order.
  const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
  const sleepDrugStrength = slot.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0;
  const sleepDepth = slot.state.TCVAR[TCVAR_ID.睡眠深度] ?? 0;
  if (sleeping) {
    const fatigue = slot.state.TCVAR[TCVAR_ID.疲労度] ?? 0;
    slot.state.TCVAR[TCVAR_ID.睡眠深度] =
      sleepDepth +
      lapse * 10 * Math.max(sleepDrugStrength, 1) +
      Math.trunc((base[BASE_ID.酒気] ?? 0) / 5) + Math.trunc(fatigue / 3);
    slot.state.TCVAR[TCVAR_ID.疲労度] = Math.trunc((fatigue * 2) / 3);
    if ((slot.state.TCVAR[TCVAR_ID.疲労度] ?? 0) < 100) {
      slot.state.TCVAR[TCVAR_ID.疲労度] = 0;
    }
  } else {
    slot.state.TCVAR[TCVAR_ID.睡眠深度] = Math.max(0, sleepDepth - lapse * 10);
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
