/**
 * Phase 7 — `attitude.ts`: the 態度 / 合意判定 / 亲热 subsystem.
 *
 * Recap of the eraTW chain these helpers model
 * (`ERB/ステータス計算関連/ATTITUDE.ERB:8-104` + `INFO.ERB:1130-1146`):
 *
 *   1. **CHARA_ATTITUDE** (per chara, run each turn by INFO) computes
 *      `CFLAG:LOCAL:合意判定` from 好感度 + 信頼度 + 陥落 TALENT + ABL +
 *      PALAM + BASE 情緒/理性 + MARK + 薬/TCVAR + 風騷 + 討厭男人/同性 +
 *      强行内射 + 甲斐性無. Then brackets: ≥500→態度 3, ≥300→2, ≥150→1,
 *      else 0. `合意誤認` floors 態度 to 2 if <2. `ブチギレ`/`睡眠` zero it.
 *
 *   2. **INFO.ERB** derives `TCVAR:130 亲热` per turn:
 *      `consent(bit 0) || 弱み握り ? 態度 : MIN(態度, 2)`. Master's is the
 *      MIN across in-room members.
 *
 *   3. **COMF350 押し倒す** gates on `情緒<300 || 亲热<2`. Consent acquisition
 *      (`抱き寄せ`) compares `合意判定` vs `抱き寄せ必要値`.
 *
 * We compute on demand (no per-turn INFO refresh in our runtime yet); the
 * inputs (好感度 / 情緒 / ABL / PALAM / TALENT / 信頼度 / 弱み握り) are
 * exactly the same at gate time, so on-demand == INFO's snapshot.
 *
 * **Subsystem status.** The 亲热 computation is read by:
 *   - COMF350 押し倒す (this port — the gate)
 *   - COM_ABLE309 / COM_ABLE312 / COM_ABLE313-316 / 305 / 306 / 307 / 311 /
 *     336 etc. (every touch command's `亲热強度N` COM_ABLE gate)
 *   - EVENTCOMEND2 / INFO.ERB (every turn)
 * → ≥2 consumers ⇒ subsystem. Lives in `runtime/state/` alongside
 *   settlement.ts so handlers can `import` without crossing the forbidden
 *   names list in `web/app/**`.
 *
 * **Defer policy** (uniform, documented):
 *   - TCVAR:発情 / 催情薬 / 媚薬 / 仙香玉兎: treated as 0 (apothecary path).
 *   - 討厭男人 / HETEROSEX: OTOKOGIRAI()'s 同性+性別嗜好≠-1 arm treats
 *     対象 as +20/-30 on 合意判定 (line 69-76). We treat 討厭男人 as 0
 *     and HETEROSEX as defer (no early gate).
 *   - 討厭男人 / HETEROSEX remain deferred. Trust, MARK, forced-creampie,
 *     hypnosis, cowardice, sleep, and rage are authoritative live inputs.
 *
 * Faithful: matches ATTITUDE.ERB formula with defer=0 substitutions.
 * Every defer is bracketed to a single line in the diff.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  palamLevel,
} from "./settlement.js";

export type AttitudeWorldState = Pick<Readonly<GameState>, "flagStore">;

export interface RelationshipAuthoritySnapshot {
  readonly favor: number;
  readonly trust: number;
  readonly intimacy: number;
  readonly rebellionMark: number;
  readonly displeasure: number;
  readonly angry: boolean;
  readonly consentJudgement: number;
  readonly attitude: 0 | 1 | 2 | 3;
  readonly shinchitsu: number;
  readonly hConsent: boolean;
}

function globalFlag(
  state: AttitudeWorldState | undefined,
  id: number,
): number {
  return state?.flagStore[id] ?? 0;
}

/** `OTOKOGIRAI(ARG)` from COMMON.ERB:1610-1629. A target who is attracted to
 * both sexes, or already has 恋慕/愛欲, does not reject the master's gender. */
export function isOtokoGirai(
  slot: CharaSlot,
  masterSlot: CharaSlot,
): boolean {
  const preference = slot.state.TALENT[TALENT_ID.性別嗜好] ?? 0;
  if (preference === -1) return false;
  if ((slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) return false;
  if ((slot.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0) return false;
  const masterGender = masterSlot.state.TALENT[TALENT_ID.性別] ?? 0;
  return (
    ((preference & 1) !== 0 && (masterGender & 1) === 0) ||
    ((preference & 2) !== 0 && (masterGender & 2) === 0)
  );
}

// ---------------------------------------------------------------------------
// 合意判定 (consent-judgment score)
// ---------------------------------------------------------------------------

/**
 * `CFLAG:LOCAL:合意判定` — the per-chara consent-judgment score computed by
 * `CHARA_ATTITUDE` (ATTITUDE.ERB:8-104). The brackets that turn this score
 * into `態度` are in {@link computeAttitude}. The 抱き寄せ comparison
 * (goodwill-vs-resistance) uses this same number directly.
 *
 * All inputs are ERA `?? 0` defaults — unset slots count as zero. The
 * defer list is enumerated at the top of the file.
 *
 * **No 発情 / 催情薬 / 媚薬 / 仙香玉兎 deductions** — those subtract from
 * the 好意判定値 inside 抱き寄せ (ATTITUDE.ERB:152-158), not from the raw
 * 合意判定. Faithful at the score level; the deductions are 抱き寄せ's.
 */
export function computeConsentJudgement(
  slot: CharaSlot,
  masterSlot: CharaSlot,
  state?: AttitudeWorldState,
): number {
  const c = slot.state;

  // 1. 好感度 bracket (ATTITUDE.ERB:11-26)
  let score = 0;
  const kaori = c.CFLAG[CFLAG_ID.好感度] ?? 0;
  if (kaori > 50000) score += 300;
  else if (kaori > 30000) score += 200;
  else if (kaori > 10000) score += 150;
  else if (kaori > 5000) score += 100;
  else if (kaori > 3000) score += 75;
  else if (kaori > 1000) score += 50;
  // ≤1000: +0

  // 2. 信頼度 bracket (ATTITUDE.ERB:27-40).
  const trust = c.CFLAG[CFLAG_ID.信頼度] ?? 0;
  if (trust <= 100) score -= 50;
  else if (trust <= 300) score -= 20;
  else if (trust <= 500) score += 0;
  else if (trust <= 750) score += 30;
  else if (trust <= 1000) score += 50;
  else score += 100;

  // 3. 陥落素質 (ATTITUDE.ERB:42)
  score += (c.TALENT[TALENT_ID.恋慕] ?? 0) * 100;
  score += (c.TALENT[TALENT_ID.思慕] ?? 0) * 30;
  score += (c.TALENT[TALENT_ID.愛欲] ?? 0) * 80;
  score += (c.TALENT[TALENT_ID.炮友] ?? 0) * 30;

  // 4. ABL (ATTITUDE.ERB:44) — clamp to 20, multiply.
  const shinmitsu = Math.min(c.ABL[ABL_ID.親密] ?? 0, 20);
  const yokubo = Math.min(c.ABL[ABL_ID.欲望] ?? 0, 20);
  score += shinmitsu * 10 + yokubo * 5;

  // 5. PALAM 欲情 / 好意 (ATTITUDE.ERB:46) — `GETPALAMLV(PALAM:欲情, 15)`
  //    returns the level index (0..15) such that PALAMLV[level] ≤ value.
  //    Coefficient is 5 per level.
  const yj = palamLevel(c.PALAM[PALAM_ID.欲情] ?? 0, 15);
  const hi = palamLevel(c.PALAM[PALAM_ID.好意] ?? 0, 15);
  score += yj * 5 + hi * 5;

  // 6. 情緒 / 理性 (ATTITUDE.ERB:48)
  const seicho = c.BASE[BASE_ID.情緒] ?? 0;
  const risei = c.BASE[BASE_ID.理性] ?? 0;
  score += Math.trunc(seicho / 25) + Math.trunc((1000 - risei) / 25);

  // 7. 刻印 (ATTITUDE.ERB:50-51). Preserve the upstream MIN expression
  // exactly, including its signed behavior.
  const marks = c.MARK ?? {};
  score += (marks[MARK_ID.不埒] ?? 0) * 20;
  score += (marks[MARK_ID.快乐] ?? 0) * 20;
  score -= Math.min(
    (marks[MARK_ID.反発刻印] ?? 0) - (marks[MARK_ID.时奸] ?? 0),
    0,
  ) * 30;

  // 8. 薬 / TCVAR (ATTITUDE.ERB:53-57) — DEFERRED.

  // 9. 弱み握り / 媚香 (ATTITUDE.ERB:58-62) — IsGardenValid / IsInsenceValid
  //    defer. We model only 弱み握り (CFLAG 10) → +40 (ATTITUDE.ERB:58).
  if ((c.CFLAG[CFLAG_ID.弱み握り] ?? 0) > 0) score += 40;

  // 10. 討厭男人 + 同性 (ATTITUDE.ERB:64-76). HETEROSEX remains deferred,
  // but OTOKOGIRAI is a local, deterministic gender gate and must lower the
  // consent score even when no full HETEROSEX model is active.
  if (isOtokoGirai(slot, masterSlot)) score -= 70;

  // 11. 風騷 (ATTITUDE.ERB:77)
  if ((c.TALENT[TALENT_ID.風騷] ?? 0) > 0) score += 400;

  // 12. 强行内射 (ATTITUDE.ERB:79-80).
  if ((c.CFLAG[CFLAG_ID.强行内射] ?? 0) !== 0) score -= 100;

  // 13. 甲斐性無 (ATTITUDE.ERB:81-82).
  if (score >= 100 && globalFlag(state, FLAG_ID.甲斐性無) !== 0) score += 50;

  // 14. 催眠強度 (ATTITUDE.ERB:84).
  score += globalFlag(state, FLAG_ID.催眠強度) * 4;

  return score;
}

// ---------------------------------------------------------------------------
// 態度 (attitude bracket) + 合意誤認 floor
// ---------------------------------------------------------------------------

/**
 * `態度` — the bracket of 合意判定 (ATTITUDE.ERB:85-99). The H-mode
 * entry gate (`COMF350`) reads `TCVAR:MASTER:亲热` which derives from 態度.
 *
 * Brackets (ATTITUDE.ERB:85-94):
 *   - 合意判定 ≥ 500 → 3
 *   - 合意判定 ≥ 300 → 2
 *   - 合意判定 ≥ 150 → 1
 *   - else          → 0
 *
 * Then ATTITUDE.ERB:95-99 floors 態度 to 2 (and 合意判定 to 300) if
 * 合意誤認 TALENT and 態度 < 2. ATTITUDE.ERB:100-103 zeros 態度 on
 * ブチギレ (with 非時停 bypass) or 睡眠. We apply 睡眠 zero explicitly
 * (gate would short-circuit on sleeping anyway); ブチギレ defers to 0.
 */
function attitudeFromJudgement(
  slot: CharaSlot,
  judgement: number,
  state?: AttitudeWorldState,
): 0 | 1 | 2 | 3 {
  const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
  if (sleeping) return 0;

  let attitude: 0 | 1 | 2 | 3;
  if (judgement >= 500) attitude = 3;
  else if (judgement >= 300) attitude = 2;
  else if (judgement >= 150) attitude = 1;
  else attitude = 0;

  // 合意誤認 floors 態度 to 2 if <2, and lifts 合意判定 to 300 if it was
  // <300 (ATTITUDE.ERB:95-99). Faithful: lift the SCORE too so callers
  // that read it (e.g. 抱き寄せ) get the same floor.
  if ((slot.state.TALENT[TALENT_ID.合意誤認] ?? 0) > 0 && attitude < 2) {
    attitude = 2;
  }
  const angry = (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0;
  const timeStopped = globalFlag(state, FLAG_ID.時間停止) !== 0;
  const consciouslyActed =
    (slot.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 1;
  if (angry && (!timeStopped || consciouslyActed)) return 0;
  return attitude;
}

export function computeAttitude(
  slot: CharaSlot,
  masterSlot: CharaSlot,
  state?: AttitudeWorldState,
): 0 | 1 | 2 | 3 {
  return attitudeFromJudgement(
    slot,
    liftedConsentJudgement(slot, masterSlot, state),
    state,
  );
}

/**
 * The 合意誤認 floor on the raw 合意判定 score. Callers that consume
 * 合意判定 directly (e.g. 抱き寄せ's 好意判定値, ATTITUDE.ERB:148)
 * should apply this lift. Returns `max(judgement, 300)` when 合意誤認
 * is set and the raw judgement is < 300; otherwise the raw judgement.
 */
export function liftedConsentJudgement(
  slot: CharaSlot,
  masterSlot: CharaSlot,
  state?: AttitudeWorldState,
): number {
  const raw = computeConsentJudgement(slot, masterSlot, state);
  if ((slot.state.TALENT[TALENT_ID.合意誤認] ?? 0) > 0 && raw < 300) return 300;
  return raw;
}

// ---------------------------------------------------------------------------
// 亲热 (per-turn intimate-atmosphere cap)
// ---------------------------------------------------------------------------

/**
 * `TCVAR:LOCAL:130 亲热` — the per-turn intimate-atmosphere level, derived
 * from 態度 by `INFO.ERB:1130-1146`:
 *
 *   - If 既成事實 bit 0 (接吻) OR 弱み握り (blackmail): 亲热 = 態度 (full)
 *   - Else: 亲热 = MIN(態度, 2)
 *
 * The first branch (full 態度) lets kiss-experienced or blackmailed targets
 * reach 亲热 = 3, unlocking the more intense H-commands whose COM_ABLE
 * gates on `亲热強度2` (e.g. 313 胸愛撫, 315 クリ愛撫 — see family 8).
 *
 * NOTE: This is the TARGET's 亲热. The MASTER's is the MIN across all
 * in-room members (INFO.ERB:1146). For the 押し倒す single-target gate,
 * the two collapse to the target's 親热 (NUM_TARGET == 1).
 */
export function computeShinchitsu(
  slot: CharaSlot,
  masterSlot: CharaSlot,
  state?: AttitudeWorldState,
): number {
  const attitude = computeAttitude(slot, masterSlot, state);
  const kissConsented = ((slot.state.CFLAG[CFLAG_ID.既成事実] ?? 0) & (1 << 0)) !== 0;
  const blackmailed = (slot.state.CFLAG[CFLAG_ID.弱み握り] ?? 0) > 0;
  if (kissConsented || blackmailed) return attitude;
  return Math.min(attitude, 2);
}

// ---------------------------------------------------------------------------
// Consent-for-H (既成事實 bit 1)
// ---------------------------------------------------------------------------

/**
 * `既成事實 bit 1 || 合意誤認 TALENT` — whether the target has *agreed to H*
 * (the bit 押し倒す checks at line 132 / 221 of COMF350). Distinct from
 * the *kiss-consent* bit (bit 0) used by the 亲热 cap above.
 *
 * Note: bit 1 can also be set via the 抱き寄せ consent-acquisition flow
 * (ATTITUDE.ERB:178). 抱き寄せ is deferred (kojo PERMISSION + 二次修正),
 * so in our slice this bit must be pre-seeded (or 合意誤認 must be set).
 */
export function hConsentAcquired(slot: CharaSlot): boolean {
  const flag = slot.state.CFLAG[CFLAG_ID.既成事実] ?? 0;
  const bit1 = (flag & (1 << 1)) !== 0;
  const mistaken = (slot.state.TALENT[TALENT_ID.合意誤認] ?? 0) > 0;
  return bit1 || mistaken;
}

/** One read model for every consumer that needs relationship/anger authority. */
export function deriveRelationshipAuthority(
  slot: CharaSlot,
  masterSlot: CharaSlot,
  state?: AttitudeWorldState,
): RelationshipAuthoritySnapshot {
  const consentJudgement = liftedConsentJudgement(slot, masterSlot, state);
  const attitude = attitudeFromJudgement(slot, consentJudgement, state);
  const kissConsented =
    ((slot.state.CFLAG[CFLAG_ID.既成事実] ?? 0) & (1 << 0)) !== 0;
  const blackmailed = (slot.state.CFLAG[CFLAG_ID.弱み握り] ?? 0) > 0;
  return {
    favor: slot.state.CFLAG[CFLAG_ID.好感度] ?? 0,
    trust: slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0,
    intimacy: slot.state.ABL[ABL_ID.親密] ?? 0,
    rebellionMark: slot.state.MARK?.[MARK_ID.反発刻印] ?? 0,
    displeasure: slot.state.CFLAG[CFLAG_ID.不機嫌] ?? 0,
    angry: (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0,
    consentJudgement,
    attitude,
    shinchitsu: kissConsented || blackmailed
      ? attitude
      : Math.min(attitude, 2),
    hConsent: hConsentAcquired(slot),
  };
}
