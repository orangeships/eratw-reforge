/**
 * Phase 5D — minimal `SOURCE_CHECK`, the 会話-reachable path.
 *
 * Ports the slice of eraTW's daily settlement that turns a command's
 * transient `SOURCE` quanta into persisted `PALAM` + `CFLAG:好感度`:
 *
 *   SOURCE (per-turn quantum from COMF300)
 *     → 4 pre-scalers (MASTER_FAVOR / TECHNIQUE / MOOD / REASON)
 *     → SOURCE_歓楽 / SOURCE_征服 / SOURCE_受動  → CUP (good/down accumulators)
 *     → apply  PALAM += CUP - CDOWN ; zero CUP/CDOWN
 *     → FAVOR_CALC  → CFLAG:好感度 delta
 *
 * ERB sources (read-only, verified this slice):
 *   - `ステータス計算関連/SOURCE/SOURCE.ERB`   @SOURCE_CHECK (loop 221-224, PALAM-apply 1109-1131, FAVOR call 1246)
 *   - `ステータス計算関連/SOURCE/SOURCE_1.ERB` @SOURCE_歓楽 (417), @SOURCE_征服 (499), @SOURCE_受動 (596)
 *   - `ステータス計算関連/TRACHECK.ERB`        @MASTER_FAVOR_CHECK/@TECHNIQUE_CHECK/@MOOD_CHECK/@REASON_CHECK (38-105)
 *   - `ステータス計算関連/TRACHECK_好感度上昇処理.ERB` @FAVOR_CALC (8)
 *
 * **Arithmetic fidelity:** every `TIMES`/`/` follows ERA semantics
 * (truncate toward zero) via `times()` / `Math.trunc` — see memory
 * `eratw-emuera-language-semantics`. Default-value rule (5C Issue 3):
 * SOURCE/PALAM/CUP additive slots default `?? 0`.
 *
 * **IN this slice (faithful):** the SOURCE→CUP→PALAM mechanism reading
 * real `ABL`/`CFLAG:好感度`/`TALENT` (`?? 0`), and FAVOR_CALC's numeric
 * `LOCAL`-from-SOURCE core + the `ABL` base term → `CFLAG:好感度`.
 *
 * **DEFERRED to Phase 7 (documented, NOT silently dropped):**
 *   - The remaining DLC/personal modifiers in the 日常時 BASE block.
 *   - FAVOR_CALC's TALENT/MARK/继承/DLC personality modifiers
 *     (lines 26-152, 309-409) — all 0 for a clean chara; the floor we
 *     apply is the `MARK:反発刻印 == 0 → max(0, …)` arm only.
 *   - 诶嘿嘿/媚薬/利尿/约会/甲斐性無/烂醉/WITH_MOB flag branches in the
 *     converters (all off by default in a fresh state).
 *   - SOURCE_誘惑/侮辱/快感各種/露出/屈従/情愛 and the pre-scaler 0-3/10/30-33
 *     special arms (unreached by 会話's source ids 20/21/22).
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import {
  detectCharaDomainTransitions,
  snapshotCharaDomainState,
  type DomainTransition,
} from "../state/domain-transition.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  MARK_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  EQUIP_SLOT,
  FLAG_ID,
  getRevision,
  getRevision3,
  times,
  palamLv,
  palamLevel,
  expLv,
  sourceRevision1,
  sourceRevision2,
  advanceTimeTicks,
  SAVEDATA_KEY,
} from "../state/settlement.js";
import { readTequip } from "../state/tequip.js";
import { readHInsertionRelation } from "../state/h-interaction-state.js";
import { applyOrgasmAdd } from "./orgasm-settlement.js";
import {
  accumulateTrainingMarkCups,
  applyTrainingMarkAcquisitionChecks,
  type TrainingMarkCupTotals,
} from "./training-marks.js";
import { getTflag, setTflag, TFLAG_ID } from "../state/tflag.js";
import { isTimeStopped } from "./h-mode.js";
import { readCurrentTouchPose } from "../state/touch-state.js";
import { applyCharaAwake, planCharaAwake } from "../world/chara-awake.js";

export interface SourceCheckResult {
  /** Net 好感度 change written to the target (ERB `TFLAG:97`). */
  readonly favorDelta: number;
  /** Settlement-level messages (e.g. the 好感度 ± line). */
  readonly events: readonly ObservationEvent[];
  /** Named state changes produced by this settlement. */
  readonly transitions: readonly DomainTransition[];
  /** Formula-level diagnostics for the target's daily 憤怒 arm. */
  readonly angerDiagnostics: AngerDiagnostics | null;
  /** Rebellion mark reached during this settlement, if any. */
  readonly rebellionMark?: {
    readonly previousLevel: 0 | 1 | 2 | 3;
    readonly level: 1 | 2 | 3;
  };
}

/** Hook for command-specific effects that must observe CUP before it flushes. */
export type SourceSettlementHook = (
  target: CharaSlot,
  participant: CharaSlot,
  scaledSource: Readonly<Record<number, number>>,
) => Readonly<Record<number, number>> | void;

export interface AngerDiagnostics {
  readonly source: number;
  readonly emotion: number;
  readonly reason: number;
  readonly reasonMax: number;
  readonly angerBefore: number;
  readonly angerMax: number;
  readonly rawIncrement: number;
  readonly angerIncrement: number;
  readonly angerAfter: number;
  readonly underwear: "none" | "no-anger" | "belt";
  readonly mood: number;
  readonly sleepDrugStrength: number;
  readonly prankSleepDrugSuppression: boolean;
  readonly rebellionSuppression: boolean;
  readonly hypnosisStrength: number;
  /** Charm is intentionally not approximated until IsCharmValid is ported. */
  readonly charmDeferred: boolean;
  readonly suppressedBy: "none" | "training" | "no-source" | "no-cap";
}

// --- tiny readers (default 0 per the additive-slot convention) -------------
const abl = (s: CharaSlot, id: number) => s.state.ABL[id] ?? 0;
const cflag = (s: CharaSlot, id: number) => s.state.CFLAG[id] ?? 0;
const talent = (s: CharaSlot, id: number) => s.state.TALENT[id] ?? 0;
const src = (m: Record<number, number>, id: number) => m[id] ?? 0;
const palam = (s: CharaSlot, id: number) => s.state.PALAM[id] ?? 0;
const exp = (s: CharaSlot, id: number) => s.state.EXP[id] ?? 0;
const cupAdd = (s: CharaSlot, id: number, v: number) => {
  s.state.CUP[id] = (s.state.CUP[id] ?? 0) + v;
};
const cup = (s: CharaSlot, id: number) => s.state.CUP[id] ?? 0;
// MARK is a newer namespace; tolerate CharaSlotStates built before it existed
// (older hand-built test fixtures) by treating an absent map as empty.
const mark = (s: CharaSlot, id: number) => s.state.MARK?.[id] ?? 0;
/** Ensure the MARK map exists before writing (older fixtures may omit it). */
const markStore = (s: CharaSlot): Record<number, number> =>
  (s.state.MARK ??= {});
const base = (s: CharaSlot, id: number) => s.state.BASE[id] ?? 0;
const maxbase = (s: CharaSlot, id: number) => s.state.MAXBASE[id] ?? 0;

/**
 * `LOCAL = LOCAL * (mul) / 100` with the ERB overflow guard: small
 * values divide last, mid values divide first (`SOURCE_1.ERB` 443-447).
 * Both truncate; the guard only changes overflow behaviour, not the
 * value for normal magnitudes.
 */
function ablScale(local: number, mul: number): number {
  if (local < 100000) return Math.trunc((local * mul) / 100);
  if (local < 100000000) return Math.trunc(local / 100) * mul;
  return local;
}

/**
 * `@ABL補正(value, ablLevel, mode)` (`SOURCE_1.ERB` 825): a per-ability
 * `TIMES` table. mode 1 (情愛/従順-style) and mode 2 (欲望-style). Used by
 * the 情愛/欲情 converters (5E).
 */
function ablHosei(value: number, ablLevel: number, mode: 1 | 2): number {
  const t1 = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
  const t2 = [0.2, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6];
  if (mode === 1) return times(value, t1[ablLevel] ?? 6.0);
  return times(value, t2[ablLevel] ?? 5.0);
}

/** @SOURCE_歓楽 → CUP:好意 (+ CUP:PLAYER:欲情). */
function sourceKanraku(
  t: CharaSlot,
  p: CharaSlot,
  s: Record<number, number>,
): void {
  let local = src(s, SOURCE_ID.歓楽);
  // 诶嘿嘿==2 (対方主導) ×1.5 — deferred (flag off by default).
  local = Math.trunc((local * (10 + 5 * talent(t, TALENT_ID.恋慕))) / 10);
  local = Math.trunc((local * (10 + 3 * talent(t, TALENT_ID.思慕))) / 10);
  local = Math.trunc((local * (10 + 2 * talent(t, TALENT_ID.心情))) / 10);
  // 媚薬: 歓楽→好意 LOCAL /= 5 (SOURCE_1.ERB:430-431). 利尿剤 / WITH_MOB /
  // 约会 modifiers — deferred (flags off).
  if (aphrodisiacActive(t)) local = Math.trunc(local / 5);
  local = ablScale(local, abl(t, ABL_ID.親密) * 5 + 100);
  local = ablScale(local, abl(t, ABL_ID.欲望) * 5 + 100);
  // 好感度ブラケット (CFLAG:好感度, read pre-command — converters run
  // before FAVOR_CALC writes it).
  const favor = cflag(t, CFLAG_ID.好感度);
  if (favor <= 10) local = times(local, 0.5);
  else if (favor <= 50) local = times(local, 0.8);
  else if (favor <= 100) local = times(local, 1.0);
  else if (favor <= 300) local = times(local, 1.1);
  else if (favor <= 500) local = times(local, 1.2);
  else if (favor <= 700) local = times(local, 1.3);
  else if (favor <= 1000) local = times(local, 1.4);
  else if (favor <= 3000) local = times(local, 1.5);
  else if (favor <= 5000) local = times(local, 1.7);
  else if (favor <= 500000) local = ablScale(local, Math.trunc(favor / 50) + 100);
  // (>500000 caps to 1e9 in ERB — unreachable for 会話, deferred.)
  cupAdd(t, PALAM_ID.好意, local);
  cupAdd(p, PALAM_ID.欲情, Math.min(Math.trunc(local / 10), 100));
}

/** @SOURCE_征服 → CUP:優越/欲情/恥情 (+ CUP:PLAYER:屈服). */
function sourceSeifuku(
  t: CharaSlot,
  p: CharaSlot,
  s: Record<number, number>,
): void {
  const s征服 = src(s, SOURCE_ID.征服);
  // GETBIT(TCVAR:随便)/FLAG:甲斐性無 boosts — deferred (off).
  let local1 = 0;
  let local2 = 0;
  if (cflag(t, CFLAG_ID.地位) > cflag(p, CFLAG_ID.地位)) {
    // 高位の角色
    local1 = Math.trunc(s征服 / 4);
    const yokubo = abl(t, ABL_ID.欲望);
    if (yokubo === 0) local1 = times(local1, 0.1);
    else if (yokubo <= 2) local1 = times(local1, 0.15);
    else if (yokubo <= 4) local1 = times(local1, 0.2);
    else if (yokubo <= 7) local1 = times(local1, 0.25);
    else if (yokubo <= 9) local1 = times(local1, 0.3);
    else local1 = ablScale(local1, yokubo * 5 + 15);
    local1 = ablScale(local1, abl(t, ABL_ID.施虐属性) * 30 + 100);
  } else {
    // 低位の角色
    local2 = Math.trunc(s征服 / 2);
    const shinmitsu = abl(t, ABL_ID.親密);
    if (shinmitsu === 0) local2 = times(local2, 0.1);
    else if (shinmitsu === 1) local2 = times(local2, 0.15);
    else if (shinmitsu === 2) local2 = times(local2, 0.2);
    else if (shinmitsu === 3) local2 = times(local2, 0.25);
    else if (shinmitsu === 4) local2 = times(local2, 0.3);
    else local2 = ablScale(local2, shinmitsu * 5 + 15);
  }
  let local = s征服;
  const sado = abl(t, ABL_ID.施虐属性);
  if (sado === 0) local = times(local, 0.7);
  else if (sado === 1) local = times(local, 1.0);
  else if (sado === 2) local = times(local, 1.3);
  else if (sado === 3) local = times(local, 1.7);
  else if (sado === 4) local = times(local, 2.0);
  else local = ablScale(local, sado * 15 + 175);
  cupAdd(t, PALAM_ID.優越, local);
  cupAdd(t, PALAM_ID.欲情, local1);
  cupAdd(p, PALAM_ID.屈服, local1);
  cupAdd(t, PALAM_ID.恥情, local2);
}

/** @SOURCE_受動 → CUP:好意/屈服/恭順 (+ CUP:PLAYER:恭順). */
function sourceJudou(
  t: CharaSlot,
  p: CharaSlot,
  s: Record<number, number>,
): void {
  const s受動 = src(s, SOURCE_ID.受動);
  // FLAG:甲斐性無 halving — deferred (off).
  let local1 = 0;
  let local2 = 0;
  if (cflag(t, CFLAG_ID.地位) > cflag(p, CFLAG_ID.地位)) {
    local1 = Math.trunc(s受動 / 3);
    const yokubo = abl(t, ABL_ID.欲望);
    if (yokubo === 0) local1 = times(local1, 0.3);
    else if (yokubo === 1) local1 = times(local1, 0.35);
    else if (yokubo === 2) local1 = times(local1, 0.4);
    else if (yokubo === 3) local1 = times(local1, 0.45);
    else if (yokubo === 4) local1 = times(local1, 0.5);
    else local1 = ablScale(local1, yokubo * 10 + 10);
  } else {
    local2 = Math.trunc(s受動 / 2);
    const houshi = abl(t, ABL_ID.奉仕精神);
    if (houshi === 0) local2 = times(local2, 0.3);
    else if (houshi === 1) local2 = times(local2, 0.35);
    else if (houshi === 2) local2 = times(local2, 0.4);
    else if (houshi === 3) local2 = times(local2, 0.45);
    else if (houshi === 4) local2 = times(local2, 0.5);
    else local2 = ablScale(local2, houshi * 10 + 10);
  }
  let local = s受動;
  // 诶嘿嘿==2 ×0.5 — deferred (off).
  local = ablScale(local, abl(t, ABL_ID.親密) * 10 + 70);
  cupAdd(t, PALAM_ID.好意, local);
  cupAdd(t, PALAM_ID.屈服, local1);
  cupAdd(p, PALAM_ID.恭順, local1);
  cupAdd(t, PALAM_ID.恭順, local2);
}

const EDGING_EX_IDS = [
  EX_ID.Ｃ寸止め,
  EX_ID.Ｖ寸止め,
  EX_ID.Ａ寸止め,
  EX_ID.Ｂ寸止め,
  EX_ID.Ｍ寸止め,
] as const;

function snapshotEdgingEx(target: CharaSlot): readonly number[] {
  return EDGING_EX_IDS.map((id) => target.state.EX[id] ?? 0);
}

function edgingTransitionEvents(
  before: readonly number[],
  after: readonly number[],
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  if (after.some((value, index) => value > before[index]!)) {
    events.push({
      kind: "NARRATION",
      timestamp: 0,
      text: "寸止积累已暂存，下一次有效绝顶会吸收这些积累。",
    });
  }
  if (after.some((value, index) => value < before[index]!)) {
    events.push({
      kind: "NARRATION",
      timestamp: 0,
      text: "这次绝顶吸收了此前暂存的寸止积累。",
    });
  }
  return events;
}

function sourceRevisionScale(value: number, ability: number, rate: number): number {
  return Math.trunc((value * getRevision(ability, 500, rate)) / 100);
}

function isPartnerLedSource(t: CharaSlot, p: CharaSlot): boolean {
  return t.charaNum !== p.charaNum && cflag(t, CFLAG_ID.诶嘿嘿) === 2;
}

/**
 * `@SOURCE_誘惑` (`SOURCE_1.ERB:668-689`).
 *
 * These sources are produced by partner-led counter actions rather than the
 * ordinary command SOURCE map. Keeping their cross-participant CUP writes in
 * the shared settlement makes the counter path obey the same flush/order as H
 * commands. The 甲斐性無 flag is not yet modelled, so its optional ×2 arm is
 * deliberately omitted rather than inferred from an unrelated field.
 */
export function sourceYuwaku(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  let source = sourceRevisionScale(src(s, SOURCE_ID.誘惑), abl(t, ABL_ID.欲望) + 2, 10);
  let local = source;
  let obedience = source;
  if (isPartnerLedSource(t, p)) {
    local *= 2;
    obedience *= 2;
  }
  cupAdd(t, PALAM_ID.優越, local);
  local = sourceRevisionScale(local, abl(p, ABL_ID.欲望), 20);
  obedience = sourceRevisionScale(obedience, abl(p, ABL_ID.従順), 5);
  cupAdd(p, PALAM_ID.欲情, local);
  cupAdd(p, PALAM_ID.恭順, obedience);
}

/** `@SOURCE_侮辱` (`SOURCE_1.ERB:692-723`). */
export function sourceBujoku(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  let local = sourceRevisionScale(src(s, SOURCE_ID.侮辱), abl(t, ABL_ID.施虐属性) + 2, 10);
  if (isPartnerLedSource(t, p)) local *= 2;
  local = sourceRevisionScale(local, abl(p, ABL_ID.受虐属性), 20);
  local = sourceRevisionScale(local, abl(p, ABL_ID.露出癖), 20);
  const shame = palam(p, PALAM_ID.恥情);
  if (shame < palamLv(1)) local = times(local, 1.0);
  else if (shame < palamLv(2)) local = times(local, 0.9);
  else if (shame < palamLv(3)) local = times(local, 0.8);
  else if (shame < palamLv(4)) local = times(local, 0.7);
  else local = times(local, 0.6);
  cupAdd(p, PALAM_ID.恥情, local);
  cupAdd(t, PALAM_ID.優越, Math.trunc(local / 2));
}

/** `@SOURCE_挑発` (`SOURCE_1.ERB:725-748`). */
export function sourceChouhatsu(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  const source = sourceRevisionScale(src(s, SOURCE_ID.挑発), abl(t, ABL_ID.施虐属性) + 2, 10);
  let local = source;
  let submission = source;
  if (isPartnerLedSource(t, p)) {
    local *= 2;
    submission *= 2;
  }
  cupAdd(t, PALAM_ID.優越, local);
  local = sourceRevisionScale(local, abl(p, ABL_ID.欲望), 10);
  submission = sourceRevisionScale(submission, abl(p, ABL_ID.受虐属性), 5);
  cupAdd(p, PALAM_ID.欲情, local);
  cupAdd(p, PALAM_ID.屈服, submission);
}

/** `@SOURCE_奉仕` (`SOURCE_1.ERB:750-769`). */
export function sourceHoushi(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  const source = sourceRevisionScale(
    src(s, SOURCE_ID.奉仕),
    abl(t, ABL_ID.技巧) + abl(t, ABL_ID.奉仕精神) + 2,
    10,
  );
  let local = source;
  let submission = source;
  if (isPartnerLedSource(t, p)) {
    local = times(local, 0.75);
    submission = times(submission, 0.75);
  }
  local = sourceRevisionScale(local, abl(p, ABL_ID.欲望), 10);
  submission = sourceRevisionScale(submission, abl(p, ABL_ID.受虐属性), 5);
  cupAdd(p, PALAM_ID.欲情, local);
  cupAdd(p, PALAM_ID.屈服, submission);
}

/** `@SOURCE_強要` (`SOURCE_1.ERB:771-796`). */
export function sourceKyouyou(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  const source = sourceRevisionScale(
    src(s, SOURCE_ID.強要),
    abl(t, ABL_ID.施虐属性) + abl(t, ABL_ID.欲望) + 2,
    10,
  );
  let local = source;
  let submission = source;
  if (isPartnerLedSource(t, p)) {
    local *= 2;
    submission *= 2;
  }
  cupAdd(t, PALAM_ID.優越, local);
  local = sourceRevisionScale(local, abl(p, ABL_ID.奉仕精神), 5);
  submission = sourceRevisionScale(submission, abl(p, ABL_ID.従順), 10);
  cupAdd(p, PALAM_ID.恭順, local);
  cupAdd(p, PALAM_ID.屈服, submission);
  cupAdd(p, PALAM_ID.恐怖, Math.trunc(submission / 2));
}

/** @SOURCE_情愛 → CUP:恭順 (via ABL:従順) + CUP:欲情 (via ABL:欲望). (5E) */
function sourceJouai(t: CharaSlot, s: Record<number, number>): void {
  // TCVAR:强行 /=5, 诶嘿嘿/甲斐性無 modifiers are deferred.
  let local = ablHosei(src(s, SOURCE_ID.情愛), abl(t, ABL_ID.従順), 1);
  cupAdd(t, PALAM_ID.恭順, local);
  // SOURCE_1.ERB:49-53: a fresh 路人 reacts more strongly to the
  // pleasurable part of 情愛. 体目当て doubles that same contribution.
  local = src(s, SOURCE_ID.情愛);
  if (talent(t, TALENT_ID.路人) === 1) {
    local = times(local, 1.5);
    if (cflag(t, CFLAG_ID.体目当て) !== 0) local = times(local, 2);
  }
  local = ablHosei(local, abl(t, ABL_ID.欲望), 2);
  cupAdd(t, PALAM_ID.欲情, local);
}

/** `@SOURCE_苦痛` — pain also raises desire for masochists and a small fear quantum. */
function sourcePain(t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  let pain = src(s, SOURCE_ID.苦痛);
  let desire = pain;
  let fear = Math.trunc(pain / 20);
  const masochism = abl(t, ABL_ID.受虐属性);
  const desireScale = masochism === 0 ? 0
    : masochism >= 1 && masochism <= 3 ? masochism * 0.1
      : masochism === 4 ? 0.45
        : masochism === 5 ? 0.6
          : masochism === 6 ? 0.75
            : masochism === 7 ? 0.9
              : masochism === 8 ? 1.2
                : masochism === 9 ? 1.5
                  : 3;
  desire = times(desire, desireScale);
  if (talent(t, TALENT_ID.体型) < -2) {
    pain = times(pain, 2);
    desire = times(desire, 0.75);
  }
  if (talent(p, TALENT_ID.施虐狂) !== 0) desire = times(desire, 2.5);
  if (talent(t, TALENT_ID.胆量) < 0) fear = times(fear, 2);
  cupAdd(t, PALAM_ID.苦痛, pain);
  cupAdd(t, PALAM_ID.欲情, desire);
  cupAdd(t, PALAM_ID.恐怖, fear);
}

function negativeDispositionScale(value: number): number {
  if (value === 0) return 1.5;
  if (value >= 1 && value <= 3) return 1.3;
  if (value >= 4 && value <= 6) return 1;
  if (value >= 7 && value <= 9) return 0.75;
  if (value >= 10 && value <= 12) return 0.5;
  if (value >= 13 && value <= 15) return 0.25;
  return 0.1;
}

/** `@SOURCE_鬱屈` — negative mood/relationship modifiers into PALAM:抑鬱. */
function sourceDepression(next: GameState, t: CharaSlot, s: Record<number, number>): void {
  let local = src(s, SOURCE_ID.鬱屈);
  local = Math.trunc((local * (10 - 2 * talent(t, TALENT_ID.心情))) / 10);
  if (talent(t, TALENT_ID.恋慕) !== 0) local = times(local, 0.25);
  else if (talent(t, TALENT_ID.思慕) !== 0) local = times(local, 0.75);
  local = times(local, negativeDispositionScale(abl(t, ABL_ID.従順)));
  local = times(local, negativeDispositionScale(abl(t, ABL_ID.欲望)));
  const hypnosis = next.flagStore[FLAG_ID.催眠強度] ?? 0;
  if (hypnosis > 0) local = Math.trunc((local * (100 - hypnosis)) / 100);
  if (talent(t, TALENT_ID.反発抑制) !== 0) local = times(local, 0.5);
  cupAdd(t, PALAM_ID.抑鬱, local);
}

/** @SOURCE_欲情 → CUP:欲情 (via ABL:欲望). (5E) */
function sourceYokujou(t: CharaSlot, s: Record<number, number>): void {
  // WITH_MOB/動物耳/付喪神 modifiers are deferred.  The 路人 branch is
  // authored and materially affects the fast-growth path of a fresh girl.
  let local = src(s, SOURCE_ID.欲情);
  if (talent(t, TALENT_ID.路人) === 1) {
    local = times(local, 1.5);
    if (cflag(t, CFLAG_ID.体目当て) !== 0) local = times(local, 2);
  }
  local = ablHosei(local, abl(t, ABL_ID.欲望), 2);
  cupAdd(t, PALAM_ID.欲情, local);
}

/** 反感 brackets (`SOURCE_マイナス.ERB` 184-241). */
function hankanJujunMul(sum: number): number {
  if (sum === 0) return 2.0;
  if (sum <= 3) return 1.25;
  if (sum <= 7) return 1.0;
  if (sum <= 10) return 0.75;
  if (sum <= 14) return 0.5;
  if (sum <= 19) return 0.25;
  if (sum <= 24) return 0.1;
  return 0.05;
}
function hankanBandMul(v: number): number {
  // shared shape for 奉仕精神 and 受虐属性 (CASE 1 TO 3 wins the overlap at 3)
  if (v === 0) return 1.0;
  if (v <= 3) return 0.9;
  if (v <= 5) return 0.75;
  if (v <= 7) return 0.6;
  if (v <= 9) return 0.5;
  if (v <= 12) return 0.3;
  if (v <= 15) return 0.2;
  return 0.1;
}

/** @SOURCE_反感 → CUP:反感 (心情, 理性削り, 従順+親密, 奉仕精神, 受虐属性). (5E) */
function sourceHankan(
  t: CharaSlot,
  s: Record<number, number>,
  reasonShaved: boolean,
): void {
  let local = Math.trunc((src(s, SOURCE_ID.反感) * (10 - 3 * talent(t, TALENT_ID.心情))) / 10);
  if (reasonShaved && cflag(t, CFLAG_ID.体目当て) !== 0) local = Math.trunc(local / 2);
  // Partner-led H mode and mob-specific aversion multipliers remain deferred.
  local = times(local, hankanJujunMul(abl(t, ABL_ID.従順) + abl(t, ABL_ID.親密)));
  local = times(local, hankanBandMul(abl(t, ABL_ID.奉仕精神)));
  local = times(local, hankanBandMul(abl(t, ABL_ID.受虐属性)));
  // FLAG:催眠強度 / TALENT:反発抑制 — deferred (off).
  cupAdd(t, PALAM_ID.反感, local);
}

/** @SOURCE_恭順 — the obedience SOURCE arm used by ORGASM_ADD additions. */
function sourceGeneratedKyojun(t: CharaSlot, s: Record<number, number>): void {
  let local = src(s, SOURCE_ID.恭順);
  if (cflag(t, CFLAG_ID.诶嘿嘿) === 2) local = times(local, 0.5);
  const scales = [0.5, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.4, 3.0];
  local = times(local, scales[abl(t, ABL_ID.従順)] ?? 5.0);
  cupAdd(t, PALAM_ID.恭順, local);
}

/** @SOURCE_露出 — the exposure SOURCE arm used by ORGASM_ADD additions. */
function sourceGeneratedExposure(t: CharaSlot, s: Record<number, number>): void {
  let raw = src(s, SOURCE_ID.露出);
  const shame = talent(t, TALENT_ID.羞恥心);
  if (shame > 0) raw = times(raw, 2.0);
  else if (shame < 0) raw = times(raw, 0.5);
  raw += Math.trunc(cup(t, PALAM_ID.潤滑) / 2);
  s[SOURCE_ID.露出] = raw;

  let local = raw;
  if (cflag(t, CFLAG_ID.诶嘿嘿) === 2) local = times(local, 0.75);
  const scales = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
  cupAdd(t, PALAM_ID.欲情, times(local, scales[abl(t, ABL_ID.露出癖)] ?? 2.0));

  let shameValue = raw;
  const currentShame = palam(t, PALAM_ID.恥情);
  if (currentShame < palamLv(1)) shameValue = times(shameValue, 1.0);
  else if (currentShame < palamLv(2)) shameValue = times(shameValue, 0.9);
  else if (currentShame < palamLv(3)) shameValue = times(shameValue, 0.8);
  else if (currentShame < palamLv(4)) shameValue = times(shameValue, 0.7);
  else shameValue = times(shameValue, 0.6);
  cupAdd(t, PALAM_ID.恥情, Math.max(shameValue, 0));
}

/** @SOURCE_屈従 — the submission SOURCE arm used by ORGASM_ADD additions. */
function sourceGeneratedKujun(t: CharaSlot, s: Record<number, number>): void {
  let local = src(s, SOURCE_ID.屈従);
  if (cflag(t, CFLAG_ID.诶嘿嘿) === 2) local = times(local, 0.5);
  local = ablHosei(local, abl(t, ABL_ID.従順), 1);
  const scales = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5];
  local = times(local, scales[abl(t, ABL_ID.奉仕精神)] ?? 7.0);
  cupAdd(t, PALAM_ID.屈服, local);
}

/** Re-run only the post-orgasm SOURCE arms for SOURCE quanta generated by
 * ORGASM_ADD. The ordinary command SOURCE has already passed these arms. */
function applyGeneratedOrgasmSource(
  t: CharaSlot,
  p: CharaSlot,
  generated: Record<number, number>,
  skipReactiveEffects: boolean,
  reasonShaved: boolean,
): void {
  sourceJouai(t, generated);
  sourceYokujou(t, generated);
  sourceGeneratedKyojun(t, generated);
  sourceGeneratedExposure(t, generated);
  sourceGeneratedKujun(t, generated);
  if (!skipReactiveEffects) sourceHankan(t, generated, reasonShaved);
  void p;
}

/**
 * @SOURCE_快Ｃ (`SOURCE_CBVA.ERB` 8-39) → CUP:快Ｃ (+ CUP:欲情).
 * (B1a) The 鈍感無視 skip and FLAG:異常気象 ×1.5 are deferred (off by default).
 */
export function sourceKaikanC(t: CharaSlot, s: Record<number, number>): void {
  // 感度 scale (default 0 → ×1; -1 鈍感 halves).
  let v = Math.trunc((src(s, SOURCE_ID.快Ｃ) * (2 + talent(t, TALENT_ID.Ｃ感度))) / 2);
  // Ｃ感覚 (REVISION1 /10).
  v = Math.trunc((v * sourceRevision1(abl(t, ABL_ID.Ｃ感覚))) / 10);
  // CUP:快Ｃ via the PALAM:欲情 bracket.
  const yokujou = palam(t, PALAM_ID.欲情);
  let local = v;
  if (yokujou < palamLv(1)) local = times(local, 0.8);
  else if (yokujou < palamLv(3)) local = times(local, 1.0);
  else if (yokujou < palamLv(5)) local = times(local, 1.2);
  else if (yokujou < palamLv(7)) local = times(local, 1.4);
  else local = times(local, 1.6);
  cupAdd(t, PALAM_ID.快Ｃ, local);
  // CUP:欲情 via REVISION2(欲望).
  cupAdd(t, PALAM_ID.欲情, Math.trunc((v * sourceRevision2(abl(t, ABL_ID.欲望))) / 100));
}

/**
 * @SOURCE_快Ｖ (`SOURCE_CBVA.ERB` 48-116) → CUP:快Ｖ (+ CUP:欲情).
 * (B1a) Deferred: 鈍感無視, FLAG:異常気象, 小人体型 (TALENT:体型 — off/unmodeled).
 */
export function sourceKaikanV(t: CharaSlot, s: Record<number, number>): void {
  let v = Math.trunc((src(s, SOURCE_ID.快Ｖ) * (2 + talent(t, TALENT_ID.Ｖ感度))) / 2);
  v = Math.trunc((v * sourceRevision1(abl(t, ABL_ID.Ｖ感覚))) / 10);
  // EXP:Ｖ経験 bracket.
  const ve = exp(t, EXP_ID.Ｖ経験);
  if (ve < expLv(1)) v = times(v, 0.3);
  else if (ve < expLv(2)) v = times(v, 0.5);
  else if (ve < expLv(3)) v = times(v, 0.8);
  else if (ve < expLv(4)) v = times(v, 1.0);
  else if (ve < expLv(5)) v = times(v, 1.2);
  else v = times(v, 1.5);
  // PALAM:潤滑 bracket.
  const junkatsu = palam(t, PALAM_ID.潤滑);
  if (junkatsu < palamLv(1)) v = times(v, 0.1);
  else if (junkatsu < palamLv(2)) v = times(v, 0.3);
  else if (junkatsu < palamLv(3)) v = times(v, 0.4);
  else if (junkatsu < palamLv(4)) v = times(v, 0.75);
  else if (junkatsu < palamLv(5)) v = times(v, 0.9);
  else v = times(v, 1.0);
  // CUP:快Ｖ via PALAM:欲情 bracket; CUP:欲情 via REVISION2(欲望).
  const yokujou = palam(t, PALAM_ID.欲情);
  let local = v;
  if (yokujou < palamLv(1)) local = times(local, 0.6);
  else if (yokujou < palamLv(3)) local = times(local, 0.8);
  else if (yokujou < palamLv(5)) local = times(local, 1.0);
  else if (yokujou < palamLv(7)) local = times(local, 1.2);
  else local = times(local, 1.5);
  cupAdd(t, PALAM_ID.快Ｖ, local);
  cupAdd(t, PALAM_ID.欲情, Math.trunc((v * sourceRevision2(abl(t, ABL_ID.欲望))) / 100));
}

/** @SOURCE_快Ａ (`SOURCE_CBVA.ERB:121-200`) → CUP:快Ａ (+ CUP:欲情). */
export function sourceKaikanA(t: CharaSlot, s: Record<number, number>): void {
  let v = Math.trunc((src(s, SOURCE_ID.快Ａ) * (2 + talent(t, TALENT_ID.Ａ感度))) / 2);
  v = Math.trunc((v * sourceRevision1(abl(t, ABL_ID.Ａ感覚))) / 10);

  const ae = exp(t, EXP_ID.Ａ経験);
  if (ae < expLv(1)) v = times(v, 0.3);
  else if (ae < expLv(2)) v = times(v, 0.5);
  else if (ae < expLv(3)) v = times(v, 0.8);
  else if (ae < expLv(4)) v = times(v, 1.0);
  else if (ae < expLv(5)) v = times(v, 1.2);
  else v = times(v, 1.5);

  const lubrication = palam(t, PALAM_ID.潤滑);
  if (lubrication < palamLv(1)) v = times(v, 0.1);
  else if (lubrication < palamLv(2)) v = times(v, 0.2);
  else if (lubrication < palamLv(3)) v = times(v, 0.4);
  else if (lubrication < palamLv(4)) v = times(v, 0.75);
  else if (lubrication < palamLv(5)) v = times(v, 0.9);

  let local = v;
  const desire = palam(t, PALAM_ID.欲情);
  if (desire < palamLv(1)) local = times(local, 0.9);
  else if (desire < palamLv(3)) local = times(local, 1.0);
  else if (desire < palamLv(5)) local = times(local, 1.1);
  else if (desire < palamLv(7)) local = times(local, 1.2);
  else local = times(local, 1.3);

  let desireSource = Math.trunc((v * sourceRevision2(abl(t, ABL_ID.欲望))) / 100);
  if ((talent(t, TALENT_ID.体型) ?? 0) < -2) {
    local = times(local, 0.5);
    desireSource = times(desireSource, 1.5);
  }

  cupAdd(t, PALAM_ID.快Ａ, local);
  cupAdd(t, PALAM_ID.欲情, desireSource);

  // SOURCE_CBVA.ERB:185-189: a virgin target who values chastity takes
  // only one third of the generated 屈従 from a positive anal source.
  if (exp(t, EXP_ID.Ｖ経験) === 0 && talent(t, TALENT_ID.貞操) > 0 && src(s, SOURCE_ID.快Ａ) > 0) {
    s[SOURCE_ID.屈従] = Math.trunc(src(s, SOURCE_ID.屈従) / 3);
  }
}

/** @SOURCE_快Ｂ (`SOURCE_CBVA.ERB:208-242`) → CUP:快Ｂ (+ CUP:欲情). */
export function sourceKaikanB(t: CharaSlot, s: Record<number, number>): void {
  let v = Math.trunc((src(s, SOURCE_ID.快Ｂ) * (2 + talent(t, TALENT_ID.Ｂ感度))) / 2);
  v = Math.trunc((v * sourceRevision1(abl(t, ABL_ID.Ｂ感覚))) / 10);

  let local = v;
  const desire = palam(t, PALAM_ID.欲情);
  if (desire < palamLv(1)) local = times(local, 0.8);
  else if (desire < palamLv(3)) local = times(local, 1.0);
  else if (desire < palamLv(5)) local = times(local, 1.2);
  else if (desire < palamLv(7)) local = times(local, 1.4);
  else local = times(local, 1.6);

  cupAdd(t, PALAM_ID.快Ｂ, local);
  cupAdd(t, PALAM_ID.欲情, Math.trunc((v * sourceRevision2(abl(t, ABL_ID.欲望))) / 100));
}

/** @SOURCE_快Ｍ (`SOURCE_CBVA.ERB:250-299`) → CUP:快Ｍ (+ CUP:欲情). */
export function sourceKaikanM(t: CharaSlot, s: Record<number, number>): void {
  let v = Math.trunc((src(s, SOURCE_ID.快Ｍ) * (2 + talent(t, TALENT_ID.Ｍ感度))) / 2);
  v = Math.trunc((v * sourceRevision1(abl(t, ABL_ID.Ｍ感覚))) / 10);

  const me = exp(t, EXP_ID.Ｍ経験);
  if (me < expLv(1)) v = times(v, 0.25);
  else if (me < expLv(2)) v = times(v, 0.5);
  else if (me < expLv(3)) v = times(v, 1.0);
  else if (me < expLv(4)) v = times(v, 2.0);
  else if (me < expLv(5)) v = times(v, 3.0);
  else v = times(v, 5.0);

  let local = v;
  const desire = palam(t, PALAM_ID.欲情);
  if (desire < palamLv(1)) local = times(local, 0.6);
  else if (desire < palamLv(3)) local = times(local, 0.8);
  else if (desire < palamLv(5)) local = times(local, 1.0);
  else if (desire < palamLv(7)) local = times(local, 1.2);
  else local = times(local, 1.5);

  cupAdd(t, PALAM_ID.快Ｍ, local);
  cupAdd(t, PALAM_ID.欲情, Math.trunc((v * sourceRevision2(abl(t, ABL_ID.欲望))) / 100));
}

/**
 * @GET_ANGRY (`COMMON.ERB` 1357-1367) — the rage trigger. Sets 不機嫌
 * (心情不快) + 勃然大怒 (ブチギレ), pins 憤怒 to its cap, drops TALENT:心情 to
 * -1, and grants `markGrant` 反発刻印 (clamped to 3) + updates 反発取得履歴.
 *
 * FAVOR_CALC calls `GET_ANGRY(ARG)` with the default `刻印付与 = 0` (憤怒
 * overflow alone does not brand — only MARK_GOT_CHECK's 反感 path does), so
 * the brand grant is 0 there; MARK_GOT_CHECK sets the brand directly.
 */
export function getAngry(t: CharaSlot, markGrant: number): void {
  t.state.CFLAG[CFLAG_ID.不機嫌] = 1;
  t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
  t.state.BASE[BASE_ID.憤怒] = maxbase(t, BASE_ID.憤怒);
  t.state.TALENT[TALENT_ID.心情] = -1;
  if (markGrant > 0) {
    const m = markStore(t);
    const cur = mark(t, MARK_ID.反発刻印);
    m[MARK_ID.反発刻印] = Math.min(cur + markGrant, 3);
    m[MARK_ID.反発取得履歴] = Math.max(mark(t, MARK_ID.反発取得履歴), m[MARK_ID.反発刻印]!);
  }
}

/** `INRANGE(x, lo, hi)` — `lo <= x <= hi` (ERB COMMON helper). */
function inRange(x: number, lo: number, hi: number): boolean {
  return x >= lo && x <= hi;
}

/**
 * @MARK_GOT_CHECK 反発刻印 arm (`TRACHECK_刻印取得.ERB` 154-230). Reads the
 * accumulated `CUP:反感 + CUP:不快` after the other four brand checks. The
 * previous ASSIPLAY latch suppresses only this rebellion arm.
 *
 * Returns the brand level newly reached (0 = none) for narration / tests.
 */
function markGotCheckHankan(
  state: GameState,
  t: CharaSlot,
  cupTotals?: TrainingMarkCupTotals,
): number {
  // ERB 157-165: these early returns apply only to the rebellion brand arm.
  if (talent(t, TALENT_ID.反発抑制) !== 0) return 0;
  if (t.charaNum === 0) return 0;
  if (getTflag(state, TFLAG_ID.前回のASSIPLAYの履歴) !== 0) return 0;

  const finish = (level: number): number => {
    setTflag(state, TFLAG_ID.前回のASSIPLAYの履歴, 0);
    return level;
  };

  let val = (cupTotals?.[PALAM_ID.反感] ?? cup(t, PALAM_ID.反感))
    + (cupTotals?.[PALAM_ID.不快] ?? cup(t, PALAM_ID.不快));
  // ERB 167-172: 反発取得履歴 makes re-earning the same band harder (a
  // window of values collapses down a level).
  const hist = mark(t, MARK_ID.反発取得履歴);
  if (hist > 0 && inRange(val, 500, 700)) val = 0;
  if (hist > 1 && inRange(val, 1001, 1300)) val = 1000;
  if (hist > 2 && inRange(val, 2001, 2500)) val = 2000;

  const emoLack = talent(t, TALENT_ID.感情缺乏) !== 0;
  const m = markStore(t);
  if (val >= 500 && val <= 1000) {
    if (mark(t, MARK_ID.反発刻印) < 1) {
      m[MARK_ID.反発刻印] = 1;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 1);
      setTflag(state, TFLAG_ID.反発刻印取得, 1);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 1;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      return finish(1);
    }
  } else if (val >= 1001 && val <= 2000) {
    if (mark(t, MARK_ID.反発刻印) < 2) {
      m[MARK_ID.反発刻印] = 2;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 2);
      setTflag(state, TFLAG_ID.反発刻印取得, 2);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 2;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      // ERB 192-201: 従順/親密 drop (when first reaching this band or val high).
      if ((hist < 2 || val >= 1200) && !emoLack) {
        const ju = abl(t, ABL_ID.従順);
        if (ju >= 1 && ju <= 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 1, 0);
          setTflag(state, TFLAG_ID.刻印従順変化, 1);
        } else if (ju > 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
          setTflag(state, TFLAG_ID.刻印従順変化, 2);
        }
      }
      return finish(2);
    }
  } else if (val > 2000) {
    if (mark(t, MARK_ID.反発刻印) < 3) {
      m[MARK_ID.反発刻印] = 3;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 3);
      setTflag(state, TFLAG_ID.反発刻印取得, 3);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 3;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      if ((hist < 3 || val >= 2400) && !emoLack) {
        const ju = abl(t, ABL_ID.従順);
        if (ju >= 1 && ju <= 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 2, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 2, 0);
          setTflag(state, TFLAG_ID.刻印従順変化, 1);
        } else if (ju > 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 1, 0);
          setTflag(state, TFLAG_ID.刻印従順変化, 2);
        }
      }
      return finish(3);
    }
  }
  return finish(0);
}

/** Commit accumulated mark inputs once after the command's SOURCE passes. */
export function finalizeTrainingMarkAcquisitionChecks(
  state: GameState,
  charaNum?: number,
): void {
  const frame = state.turnContext?.frame;
  const pending = frame?.trainingMarkCupsByChara;
  if (!pending) return;
  const charaNums = charaNum === undefined
    ? Object.keys(pending).map(Number)
    : [charaNum];
  for (const num of charaNums) {
    const cups = pending[num];
    const target = state.charas[num];
    if (!cups || !target) continue;
    delete pending[num];
    if (cflag(target, CFLAG_ID.恶作剧) !== 0) continue;
    applyTrainingMarkAcquisitionChecks(state, target, cups);
    markGotCheckHankan(state, target, cups);
  }
}

/**
 * @SOURCE_CHECK 欲求不満度上昇 (`SOURCE.ERB` 1200-1234) — Parity QA S-2.
 *
 * After PALAM is settled, if the target's 欲情 level grew past the last-banked
 * level (`TCVAR:欲求不満度管理`), bank the difference into `CFLAG:溜まってる度`
 * (积攒度) at `(levelNow − levelLast) * 30`, then snapshot the new level.
 *
 * **Faithful core:** the `GETPALAMLV(PALAM:欲情,15)` level gate, the `*30`
 * rise, `欲求不満素質補正` (all SIF素質 → identity for a clean chara), the
 * `LIMIT(_, 0, MAX_积攒度=1000)` clamp, and the marker snapshot.
 *
 * **DEFERRED (off in a clean state / DLC):** MAGIC_DLC_好感亲密重做 + CHARM
 * (媚薬) + 発情 + 仙香玉兎 + 甲斐性無 multipliers, 路人 ×3, the DLC
 * `积攒度上限()` per-chara cap (non-DLC path uses the flat 1000).
 *
 * Runs only for a real target (`ARG != 0`); the master (PLAYER) has no
 * frustration accrual. `applySourceCheck`/`settleSourcePalam` call it on the
 * settled `t` before FAVOR_CALC.
 */
function settleFrustration(t: CharaSlot): void {
  const MAX_积攒度 = 1000; // MODDING_VALUE.ERH:43 (#DIM CONST), non-DLC path.
  const levelNow = palamLevel(palam(t, PALAM_ID.欲情), 15);
  const levelLast = t.state.TCVAR[TCVAR_ID.欲求不満度管理] ?? 0;
  if (levelLast < levelNow) {
    // ERB 1203: 欲求不満度上昇 = (levelNow − levelLast) * 30.
    let rise = (levelNow - levelLast) * 30;
    // ERB 1227: 欲求不満素質補正 — all-SIF素質 chain; identity for a clean
    // chara (自制心/自己愛/幼稚/妊娠/育児中/オナバレ all 0). Deferred arms.
    rise = frustrationTraitAdjust(t, rise);
    // ERB 1229-1231: CFLAG:溜まってる度 = LIMIT(rise + current, 0, 1000).
    const cur = cflag(t, CFLAG_ID.溜まってる度);
    t.state.CFLAG[CFLAG_ID.溜まってる度] = Math.max(0, Math.min(rise + cur, MAX_积攒度));
    // ERB 1233: snapshot the level so the same level isn't re-banked.
    t.state.TCVAR[TCVAR_ID.欲求不満度管理] = levelNow;
  }
}

/**
 * @欲求不満素質補正 (`AFTERTRA.ERB` 1166-1187) — the 素質 multiplier chain.
 * For a clean trial chara every SIF is false → returns the value unchanged.
 * Ported faithfully so a seeded-素質 chara settles correctly.
 */
export function frustrationTraitAdjust(t: CharaSlot, value: number): number {
  let v = value;
  if (talent(t, TALENT_ID.自制心) !== 0) v = Math.trunc(v / 2);
  if (talent(t, TALENT_ID.自己愛) < 0) v = Math.trunc(v / 2);
  if (talent(t, TALENT_ID.自己愛) > 0) v = Math.trunc((v * 5) / 4);
  if (talent(t, TALENT_ID.幼稚) !== 0 && talent(t, TALENT_ID.初潮) === 0) v = Math.trunc(v / 4);
  if (talent(t, TALENT_ID.HYPERFERTILE) === 0) {
    if (talent(t, TALENT_ID.妊娠) !== 0) v = Math.trunc(v / 4);
    if (talent(t, TALENT_ID.育児中) !== 0) v = Math.trunc(v / 2);
  }
  if (cflag(t, CFLAG_ID.オナバレ) !== 0) v = Math.trunc(v / 4);
  return v;
}

/** Apply `PALAM += CUP - CDOWN` for one slot, then zero CUP/CDOWN. */
function applyAndClearCup(slot: CharaSlot): void {
  const { CUP, CDOWN, PALAM } = slot.state;
  const ids = new Set<number>([
    ...Object.keys(CUP).map(Number),
    ...Object.keys(CDOWN).map(Number),
  ]);
  for (const id of ids) {
    const delta = (CUP[id] ?? 0) - (CDOWN[id] ?? 0);
    if (delta !== 0) PALAM[id] = (PALAM[id] ?? 0) + delta;
  }
  slot.state.CUP = {};
  slot.state.CDOWN = {};
}

/**
 * @FAVOR_CALC numeric core — the `LOCAL`-from-SOURCE accumulation
 * (`TRACHECK_好感度上昇処理.ERB` 153-191) + the ABL base term (line 24)
 * + the MARK==0 floor (lines 319-321). Returns the 好感度 delta.
 */
function favorCalc(
  t: CharaSlot,
  s: Record<number, number>,
  bias: number,
  suppressDailyAnger = false,
  hypnosisStrength = 0,
): { value: number; angerDiagnostics: AngerDiagnostics } {
  // `bias` = the command's own `TFLAG:97 += …` pre-seed (e.g. COMF309's
  // 親密/好感 penalty). 0 for 会話.
  let tflag97 = bias + Math.trunc((abl(t, ABL_ID.従順) + abl(t, ABL_ID.親密)) / 2);

  const kc =
    src(s, SOURCE_ID.快Ｃ) +
    src(s, SOURCE_ID.快Ｖ) +
    src(s, SOURCE_ID.快Ａ) +
    src(s, SOURCE_ID.快Ｂ);
  let local = 0;
  // 各種快感
  local += (100 - Math.trunc(30000 / (kc + 300))) * (1 + talent(t, TALENT_ID.快感応答));
  // 情愛 / 欲情 (also feed the deferred 理性 reducer L1 — unused here)
  local += 100 - Math.trunc(100000 / (src(s, SOURCE_ID.情愛) + 1000));
  local += 20 - Math.trunc(20000 / (src(s, SOURCE_ID.欲情) + 1000));
  local += 30 - Math.trunc(30000 / (src(s, SOURCE_ID.達成) + 1000));
  local += 20 - Math.trunc(20000 / (src(s, SOURCE_ID.恭順) + 1000));
  local += 20 - Math.trunc(20000 / (src(s, SOURCE_ID.屈従) + 1000));
  local += Math.trunc(
    ((30 - Math.trunc(30000 / (src(s, SOURCE_ID.露出) + 1000))) *
      (abl(t, ABL_ID.露出癖) - 3)) /
      3,
  );
  local += Math.trunc(
    ((50 - Math.trunc(20000 / (src(s, SOURCE_ID.苦痛) + 400))) *
      (abl(t, ABL_ID.受虐属性) - 3)) /
      3,
  );
  local += 50 - Math.trunc(10000 / (src(s, SOURCE_ID.歓楽) + 2000));
  local += 30 - Math.trunc(90000 / (src(s, SOURCE_ID.征服) + 3000));
  local += 30 - Math.trunc(90000 / (src(s, SOURCE_ID.受動) + 3000));
  local -= Math.trunc(
    ((50 - Math.trunc(20000 / (src(s, SOURCE_ID.恐怖) + 400))) *
      (abl(t, ABL_ID.従順) - 3)) /
      3,
  );
  local -= Math.trunc(
    ((50 - Math.trunc(25000 / (src(s, SOURCE_ID.不潔) + 500))) *
      (2 - talent(t, TALENT_ID.汚臭耐性))) /
      2,
  );
  local -= 50 - Math.trunc(15000 / (src(s, SOURCE_ID.鬱屈) + 300));
  local -= 50 - Math.trunc(25000 / (src(s, SOURCE_ID.逸脱) + 500));
  local -= 50 - Math.trunc(10000 / (src(s, SOURCE_ID.反感) + 200));

  tflag97 += Math.trunc(local / 10);

  // --- 情緒上昇 + 理性減少 (ERB 199-243) — Parity QA S-1 -----------------------
  // `LOCAL:1` (ERB) is a SECOND accumulator summing ONLY 情愛 + 欲情, both with
  // the 100-coefficient form (ERB 160/163) — distinct from `local`, where 欲情
  // uses the 20-coefficient (line 162). Self-contained, so computed inline.
  const local1 =
    100 - Math.trunc(100000 / (src(s, SOURCE_ID.情愛) + 1000)) +
    (100 - Math.trunc(100000 / (src(s, SOURCE_ID.欲情) + 1000)));

  // 情緒上昇 (ERB 200-225): MIN(親密+1,10) * LOCAL / 3 → GET_REVISION3 → sleep
  // gate → BASE:情緒 += MIN(_,200), clamped to MAXBASE. Like the 憤怒 arm, the
  // MAXBASE-clamp only runs when a cap is known (MAXBASE:情緒 > 0) so an unseeded
  // fixture isn't zeroed. 約会/抑制/WITH_MOB/WEATHERDLC modifiers deferred (off).
  // 情緒BONUS (TFLAG:92, COMF603 date path) defaults 0 — not threaded here yet.
  const jouchoMax = maxbase(t, BASE_ID.情緒);
  if (jouchoMax > 0) {
    const emotionBonus = 0; // TFLAG:情緒BONUS — date-only, deferred to 0.
    const shinmitsu = Math.min(abl(t, ABL_ID.親密) + 1, 10);
    let emoRise = Math.trunc((shinmitsu * local) / 3);
    emoRise = getRevision3(emoRise, 50 + emotionBonus, 100 + emotionBonus, 200 + emotionBonus);
    // ERB 221: sleeping target gains no 情緒 (bug-fix comment in upstream).
    if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) emoRise = 0;
    t.state.BASE[BASE_ID.情緒] = base(t, BASE_ID.情緒) + Math.min(emoRise, 200);
    t.state.BASE[BASE_ID.情緒] = Math.min(base(t, BASE_ID.情緒), jouchoMax);
  }

  // 理性減少 (ERB 237-243): 理性減少値 = LOCAL:1 * (GETPALAMLV(欲情,10)+1) / 10 *
  // (积攒度+1000) / 2000, evaluated left-to-right with per-`/` truncation. Reads
  // the post-S-2 积攒度 (settleFrustration ran before favorCalc, matching the
  // ERB 1200→1246 order). 理性削り/体目当て multipliers deferred (off).
  const yokujouLv = palamLevel(palam(t, PALAM_ID.欲情), 10);
  const tamatte = cflag(t, CFLAG_ID.溜まってる度);
  let reasonDrop = Math.trunc((local1 * (yokujouLv + 1)) / 10);
  reasonDrop = Math.trunc((reasonDrop * (tamatte + 1000)) / 2000);
  t.state.BASE[BASE_ID.理性] = Math.max(base(t, BASE_ID.理性) - reasonDrop, 0);

  // --- 日常時 BASE block (ERB 197-307) — 憤怒 arm -----------------------------
  // The state change and every modifier are kept together so the UI/debug
  // surface can explain why a low-favor action produced a given result.
  const angerMax = maxbase(t, BASE_ID.憤怒);
  const hankanSrc = src(s, SOURCE_ID.反感);
  const joucho = base(t, BASE_ID.情緒);
  const risei = base(t, BASE_ID.理性);
  const riseiMax = maxbase(t, BASE_ID.理性);
  const angerBefore = base(t, BASE_ID.憤怒);
  const underwear = t.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
  const underwearMode: AngerDiagnostics["underwear"] =
    underwear === 27 ? "belt" : [28, 29, 30].includes(underwear) ? "no-anger" : "none";
  const kokoro = talent(t, TALENT_ID.心情);
  const sleepDrugStrength = Math.trunc(t.state.TCVAR[TCVAR_ID.睡眠薬強度] ?? 0);
  const prankSleepDrugSuppression =
    sleepDrugStrength >= 1 && sleepDrugStrength <= 3 &&
    cflag(t, CFLAG_ID.恶作剧) !== 0;
  const rebellionSuppression = talent(t, TALENT_ID.反発抑制) !== 0;
  hypnosisStrength = Math.max(0, Math.trunc(hypnosisStrength));
  const charmDeferred =
    talent(t, TALENT_ID.魅惑) !== 0 || talent(t, TALENT_ID.謎之魅力) !== 0;
  let rawIncrement = 0;
  let angerIncrement = 0;
  let suppressedBy: AngerDiagnostics["suppressedBy"] = "none";
  if (hankanSrc <= 0) suppressedBy = "no-source";
  else if (angerMax <= 0) suppressedBy = "no-cap";
  else if (suppressDailyAnger) suppressedBy = "training";
  else {
    // ERB 247: 憤怒上昇値 = 反感 * 3 * (2000-情緒) * (500+理性) /
    //                      ((2000+情緒) * (500+MAXBASE:理性)).
    rawIncrement = Math.trunc(
      (hankanSrc * 3 * (2000 - joucho) * (500 + risei)) /
        ((2000 + joucho) * (500 + riseiMax)),
    );
    angerIncrement = rawIncrement;
    if (underwearMode === "no-anger") angerIncrement = 0;
    else if (underwearMode === "belt") angerIncrement = Math.trunc((angerIncrement * 4) / 3);
    // ERB 255-258: 心情 (TALENT:15) shifts the rise.
    if (kokoro === 1) angerIncrement = Math.trunc((angerIncrement * 7) / 10);
    else if (kokoro === -1) angerIncrement = Math.trunc((angerIncrement * 3) / 2);
    // ERB 261-268: sleep-drug prank suppression.
    if (prankSleepDrugSuppression) {
      if (sleepDrugStrength === 1) angerIncrement = Math.trunc(angerIncrement / 2);
      else if (sleepDrugStrength === 2) angerIncrement = Math.trunc(angerIncrement / 5);
      else if (sleepDrugStrength === 3) angerIncrement = 0;
    }
    // ERB 271: 反発抑制 → /3.
    if (rebellionSuppression) angerIncrement = Math.trunc(angerIncrement / 3);
    // ERB 274: 催眠強度 × (101-strength) / 100. A valid charm arm is
    // intentionally left untouched and exposed in diagnostics below until
    // IsCharmValid/MAGIC_CharmFactor are ported.
    if (hypnosisStrength > 0) {
      angerIncrement = Math.trunc((angerIncrement * (101 - hypnosisStrength)) / 100);
    }
    t.state.BASE[BASE_ID.憤怒] = angerBefore + angerIncrement;
    // ERB 276-277: 憤怒 over its cap → GET_ANGRY(ARG) (刻印付与 0).
    if (base(t, BASE_ID.憤怒) > angerMax) getAngry(t, 0);
    // ERB 278: clamp 憤怒 to its cap.
    t.state.BASE[BASE_ID.憤怒] = Math.min(base(t, BASE_ID.憤怒), angerMax);
  }
  // ERB 281-284: 心情不快 (反発刻印 earned this/earlier) → always angry. Only
  // when a cap is known (see above); otherwise leave seeded 憤怒 untouched.
  if (!suppressDailyAnger && angerMax > 0 && (t.state.CFLAG[CFLAG_ID.不機嫌] ?? 0) !== 0) {
    t.state.BASE[BASE_ID.憤怒] = angerMax;
    t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
  }

  const angerDiagnostics: AngerDiagnostics = {
    source: hankanSrc,
    emotion: joucho,
    reason: risei,
    reasonMax: riseiMax,
    angerBefore,
    angerMax,
    rawIncrement,
    angerIncrement,
    angerAfter: base(t, BASE_ID.憤怒),
    underwear: underwearMode,
    mood: kokoro,
    sleepDrugStrength,
    prankSleepDrugSuppression,
    rebellionSuppression,
    hypnosisStrength,
    charmDeferred,
    suppressedBy,
  };

  // --- 反発刻印補正 (ERB 309-321) — Parity QA P-15 ② -------------------------
  // ERB 310: TFLAG:97 -= (FLAG:難易度 + 1) * MARK:反発刻印.
  const difficulty = 0; // FLAG:難易度, global; 0 in a clean trial.
  const brand = mark(t, MARK_ID.反発刻印);
  tflag97 -= (difficulty + 1) * brand;
  // ERB 313-321: brand-graded negative floor.
  if (brand >= 3 && tflag97 < -3) tflag97 = -3;
  else if (brand === 2 && tflag97 < -2) tflag97 = -2;
  else if (brand === 1 && tflag97 < -1) tflag97 = -1;
  else if (tflag97 < 0) tflag97 = 0;
  return { value: tflag97, angerDiagnostics };
}

/**
 * Upstream `YUKIZURI_BONUS` (`TRACHECK_好感度上昇処理.ERB:430-459`).
 * Newly generated路人 girls are intentionally quick to warm up: the final
 * favor delta is multiplied after all ordinary relationship/anger floors, and
 * the settled PALAM levels immediately promote the four relevant abilities.
 * This is a projection of the deterministic runtime state, never AI output.
 */
function mobGirlGrowthBonus(t: CharaSlot, favorDelta: number): number {
  if (talent(t, TALENT_ID.路人) !== 1) return favorDelta;

  let boosted = favorDelta * 10;
  if (cflag(t, CFLAG_ID.体目当て) !== 0) boosted *= 2;

  const promote = (id: number, value: number): void => {
    if (value > abl(t, id)) t.state.ABL[id] = value;
  };
  // YUKIZURI_BONUS_1: PALAM level is the requested ABL rank.  The -1 arms
  // intentionally leave a level-0 fresh ability untouched.
  promote(ABL_ID.親密, palamLevel(palam(t, PALAM_ID.好意), 10) - 1);
  promote(ABL_ID.技巧, palamLevel(palam(t, PALAM_ID.習得), 3));
  promote(
    ABL_ID.従順,
    Math.max(palamLevel(palam(t, PALAM_ID.恭順), 3), palamLevel(palam(t, PALAM_ID.屈服), 3)),
  );
  promote(ABL_ID.奉仕精神, palamLevel(palam(t, PALAM_ID.恭順), 3) - 1);
  return boosted;
}

/**
 * SOURCE → PALAM settlement for one subject (no 好感度). Runs the 4
 * pre-scalers, the converter set (incl. 快感), then applies CUP→PALAM on
 * both `t` and the master `p` (the converters write cross-participant
 * quanta like 欲情/屈服 into `p`'s CUP). Returns the post-scale source
 * map (FAVOR_CALC reads it). Extracted for dual-participant settlement (B1b).
 *
 * This is the part of settlement shared by target-side and master-side.
 * `applySourceCheck` adds the target's 好感度/FAVOR_CALC on top.
 */
/**
 * Slice C — 调教装备 TEQUIP 槽的持续 SOURCE (原版 `EQUIP_CHECK` →
 * `EQUIP_COM{N}`, SOURCE.ERB:242). 目标每 SOURCE 结算时, 已装备的调教道具
 * 追加持续 SOURCE. 值来自各 `EQUIP_COM{11-12/40-49/104-107}` 的非时停分支 (审计).
 *
 * 装备状态在 `state.TEQUIP` (per-chara, 见 `state/tequip.ts`) — 读 TEQUIP
 * 而非 EQUIP (EQUIP 槽 11-22 是衣服, 撞号会误判穿裤子角色已装 陰蒂夾).
 */
const TEQUIP_CONTINUOUS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  [TEQUIP_ID.陰蒂夾]: { [SOURCE_ID.快Ｃ]: 100 },
  [TEQUIP_ID.飛機杯]: { [SOURCE_ID.快Ｃ]: 100 },
  [TEQUIP_ID.振動棒]: { [SOURCE_ID.快Ｖ]: 125, [SOURCE_ID.露出]: 10 },
  [TEQUIP_ID.肛用振動棒]: { [SOURCE_ID.快Ａ]: 125 },
  [TEQUIP_ID.後庭拉珠]: { [SOURCE_ID.快Ａ]: 75 },
  [TEQUIP_ID.乳頭夾]: { [SOURCE_ID.快Ｂ]: 100 },
  [TEQUIP_ID.搾乳機]: { [SOURCE_ID.快Ｂ]: 100 },
  [TEQUIP_ID.眼罩]: { [SOURCE_ID.恐怖]: 350, [SOURCE_ID.露出]: 50 },
  [TEQUIP_ID.縄]: { [SOURCE_ID.苦痛]: 150 },
  [TEQUIP_ID.拘束]: { [SOURCE_ID.苦痛]: 30 },
};

/** 把目标已装备调教道具与持续接触的 SOURCE 追加到 `s`. */
export function addEquipContinuous(next: GameState, t: CharaSlot, p: CharaSlot, s: Record<number, number>): void {
  for (const [tequip, sources] of Object.entries(TEQUIP_CONTINUOUS)) {
    if (readTequip(t, Number(tequip)) === 0) continue;
    for (const [sid, v] of Object.entries(sources)) {
      s[Number(sid)] = (s[Number(sid)] ?? 0) + v;
    }
  }
  addSustainedContactSources(t, p, s, isTimeStopped(next) && cflag(t, CFLAG_ID.時間停止行動) === 0);
}

function addSustainedContactSources(t: CharaSlot, p: CharaSlot, s: Record<number, number>, frozen: boolean): void {
  // EQUIP_COM11/12 run at each SOURCE_CHECK while the toggle is active.
  if (readTequip(t, TEQUIP_ID.吸乳头) !== 0) {
    const tongue = abl(p, ABL_ID.舌);
    s[SOURCE_ID.快Ｂ] = (s[SOURCE_ID.快Ｂ] ?? 0) + (tongue + 1) * 10;
    if (!frozen) {
      s[SOURCE_ID.露出] = 20;
      s[SOURCE_ID.不潔] = 30;
      s[SOURCE_ID.反感] = 50;
      s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + tongue * 5
        + (abl(t, ABL_ID.親密) >= 5 ? abl(t, ABL_ID.親密) * 3 : 0);
    }
  }
  if (readTequip(t, TEQUIP_ID.揉胸) !== 0) {
    const fingers = abl(p, ABL_ID.指);
    s[SOURCE_ID.快Ｂ] = (s[SOURCE_ID.快Ｂ] ?? 0) + (fingers + 1) * 10;
    if (!frozen) {
      s[SOURCE_ID.露出] = 20;
      s[SOURCE_ID.逸脱] = 30;
      s[SOURCE_ID.反感] = 30;
      s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + fingers * 5
        + (abl(t, ABL_ID.親密) >= 5 ? abl(t, ABL_ID.親密) * 2 : 0);
    }
  }
}

/** `EQUIP_COM11/12` also charge each participant and award player experience each settled turn. */
export function applySustainedContactCosts(next: GameState, t: CharaSlot, p: CharaSlot): void {
  if (t.charaNum === 0 || p.charaNum !== 0) return;
  const sucking = readTequip(t, TEQUIP_ID.吸乳头) !== 0;
  const fondling = readTequip(t, TEQUIP_ID.揉胸) !== 0;
  if (!sucking && !fondling) return;

  const frozen = isTimeStopped(next) && cflag(t, CFLAG_ID.時間停止行動) === 0;
  if (frozen) {
    p.state.BASE[BASE_ID.TSP] = base(p, BASE_ID.TSP) - 20 * (Number(sucking) + Number(fondling));
  } else {
    t.state.BASE[BASE_ID.体力] = base(t, BASE_ID.体力) - (sucking ? 5 : 0) - (fondling ? 5 : 0);
    t.state.BASE[BASE_ID.気力] = base(t, BASE_ID.気力) - (sucking ? 20 : 0) - (fondling ? 20 : 0);
    p.state.BASE[BASE_ID.体力] = base(p, BASE_ID.体力) - (sucking ? 5 : 0) - (fondling ? 15 : 0);
    p.state.BASE[BASE_ID.気力] = base(p, BASE_ID.気力) - (sucking ? 10 : 0) - (fondling ? 20 : 0);
  }
  if (sucking) {
    p.state.EXP[EXP_ID.口淫経験] = exp(p, EXP_ID.口淫経験) + 1;
    if (talent(p, TALENT_ID.猫舌)) {
      p.state.EXP[EXP_ID.嗜虐快楽経験] = exp(p, EXP_ID.嗜虐快楽経験) + 1;
    }
  }
  if (fondling) p.state.EXP[EXP_ID.手淫経験] = exp(p, EXP_ID.手淫経験) + 1;
}

/** 媚薬 (TCVAR:140) active — the target is under an aphrodisiac effect. */
function aphrodisiacActive(t: CharaSlot): boolean {
  return (t.state.TCVAR[TCVAR_ID.媚薬] ?? 0) > 0;
}

/**
 * 媚薬 (TCVAR:140) 的 CUP 消费方 — `SOURCE_CBVA.ERB:656-661` + `SOURCE_EXTRA.ERB:18-22`.
 * Runs AFTER the converters accumulated CUP, BEFORE `applyAndClearCup` flushes it:
 *   - CUP 快感 C/V/A/B/M ×1.30
 *   - CUP 恭順 ×1.20 / 欲情 ×1.50 / 屈服 ×1.20 / 不快 ×0.75
 * (射精量 ×2 is 射精確定後処理 — 射精未建模, deferred.)
 */
export function applyAphrodisiacCupMul(t: CharaSlot): void {
  if (!aphrodisiacActive(t)) return;
  const cupMul: Readonly<Record<number, number>> = {
    [PALAM_ID.快Ｃ]: 1.3,
    [PALAM_ID.快Ｖ]: 1.3,
    [PALAM_ID.快Ａ]: 1.3,
    [PALAM_ID.快Ｂ]: 1.3,
    [PALAM_ID.快Ｍ]: 1.3,
    [PALAM_ID.恭順]: 1.2,
    [PALAM_ID.欲情]: 1.5,
    [PALAM_ID.屈服]: 1.2,
    [PALAM_ID.不快]: 0.75,
  };
  for (const [idStr, mul] of Object.entries(cupMul)) {
    const id = Number(idStr);
    if (cup(t, id) !== 0) t.state.CUP[id] = times(cup(t, id), mul);
  }
}

type InsertionContinuationChannel = "v" | "a";

/**
 * `TRACHECK_EQUIP_挿入継続.ERB` pain/aversion ladder for the target side.
 * This is deliberately kept beside the shared EQUIP_CHECK bridge: the
 * continuation routine is only allowed to add its channel when the current
 * command did not already provide that channel's pleasure SOURCE.
 */
function insertionContinuationPain(
  t: CharaSlot,
  channel: InsertionContinuationChannel,
): { pain: number; aversion: number } {
  const experience = exp(
    t,
    channel === "v" ? EXP_ID.Ｖ経験 : EXP_ID.Ａ経験,
  );
  const lubrication = palam(t, PALAM_ID.潤滑);
  let pain = channel === "v" ? 200 : 400;
  let aversion = channel === "v" ? 150 : 250;

  if (channel === "v") {
    if (experience < expLv(2)) {
      pain = times(pain, 0.8);
      aversion = times(aversion, 1.2);
    } else if (experience < expLv(3)) {
      pain = times(pain, 0.4);
    } else if (experience < expLv(4)) {
      pain = times(pain, 0.1);
    } else {
      pain = 0;
    }

    if (lubrication < palamLv(1)) {
      pain = times(pain, 3);
      aversion = times(aversion, 3);
    } else if (lubrication < palamLv(2)) {
      pain = times(pain, 2);
      aversion = times(aversion, 2.5);
    } else if (lubrication < palamLv(3)) {
      pain = times(pain, 0.6);
      aversion = times(aversion, 1.5);
    } else if (lubrication < palamLv(4)) {
      pain = times(pain, 0.5);
    } else if (lubrication < palamLv(5)) {
      pain = times(pain, 0.1);
      aversion = times(aversion, 0.5);
    } else {
      pain = times(pain, 0.02);
      aversion = times(aversion, 0.3);
    }
  } else {
    if (experience < expLv(1)) {
      pain = times(pain, 3);
      aversion = times(aversion, 3);
    } else if (experience < expLv(2)) {
      pain = times(pain, 1.2);
      aversion = times(aversion, 2);
    } else if (experience < expLv(3)) {
      pain = times(pain, 0.8);
      aversion = times(aversion, 1.5);
    } else if (experience < expLv(4)) {
      pain = times(pain, 0.6);
      aversion = times(aversion, 1.2);
    } else if (experience < expLv(5)) {
      pain = times(pain, 0.4);
    } else {
      pain = times(pain, 0.2);
    }

    if (lubrication < palamLv(1)) {
      pain = times(pain, 3);
      aversion = times(aversion, 3);
    } else if (lubrication < palamLv(2)) {
      pain = times(pain, 2);
      aversion = times(aversion, 2.5);
    } else if (lubrication < palamLv(3)) {
      pain = times(pain, 0.6);
      aversion = times(aversion, 1.5);
    } else if (lubrication < palamLv(4)) {
      pain = times(pain, 0.5);
    } else if (lubrication < palamLv(5)) {
      pain = times(pain, 0.3);
      aversion = times(aversion, 0.5);
    } else {
      pain = times(pain, 0.2);
      aversion = times(aversion, 0.3);
    }
  }

  return { pain, aversion };
}

/**
 * Add the target-side continuous V/A insertion effects from
 * `TRACHECK_EQUIP_挿入継続.ERB:2-188`.
 *
 * The upstream `EQUIP_CHECK` guard is important: a thrust command that already
 * emitted `SOURCE:快Ｖ`/`SOURCE:快Ａ` must not receive this second channel pulse.
 * Only a bilateral PLAYER↔target link is accepted here; malformed or
 * multi-character links remain untouched until the identity graph exists.
 */
function addInsertionContinuation(
  next: GameState,
  t: CharaSlot,
  p: CharaSlot,
  s: Record<number, number>,
): void {
  if (t.charaNum <= 0 || t.charaNum === p.charaNum) return;

  const timeStopped = isTimeStopped(next) && cflag(t, CFLAG_ID.時間停止行動) === 0;
  const pose = readCurrentTouchPose(t);
  const favoritePose = cflag(t, CFLAG_ID.喜欢的体位);
  const channels: ReadonlyArray<readonly [InsertionContinuationChannel, number]> = [
    ["v", SOURCE_ID.快Ｖ],
    ["a", SOURCE_ID.快Ａ],
  ];

  for (const [channel, pleasureSource] of channels) {
    // `SOURCE.ERB` uses `!SOURCE:ARG:快Ｖ/快Ａ` as the continuation gate.
    if (src(s, pleasureSource) !== 0) continue;
    const relation = readHInsertionRelation(next, t.charaNum, channel);
    if (
      relation.status !== "active" || !relation.bilateral ||
      relation.actor_id !== p.charaNum || relation.receiver_id !== t.charaNum ||
      (p.state.TCVAR[TCVAR_ID.ゴム使用済み] ?? 0) !== 0
    ) continue;

    const basePleasure = channel === "v" ? 150 : 200;
    s[pleasureSource] = (s[pleasureSource] ?? 0) + basePleasure;

    if (!timeStopped) {
      if (channel === "v") {
        s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + 75;
        s[SOURCE_ID.露出] = (s[SOURCE_ID.露出] ?? 0) + 25;
        if ((t.state.TCVAR[TCVAR_ID.强行] ?? 0) !== 0) {
          s[SOURCE_ID.反感] = (s[SOURCE_ID.反感] ?? 0) + 1000;
        }
        if (talent(p, TALENT_ID.形状) === 5) {
          s[SOURCE_ID.苦痛] = (s[SOURCE_ID.苦痛] ?? 0) + 200;
        }
        if (pose === 6) {
          s[SOURCE_ID.苦痛] = (s[SOURCE_ID.苦痛] ?? 0) + 300;
        }
        if (pose > 0 && pose === favoritePose) {
          s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + 100;
          s[SOURCE_ID.恭順] = (s[SOURCE_ID.恭順] ?? 0) + 50;
        }
      } else {
        s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + 50;
        s[SOURCE_ID.露出] = (s[SOURCE_ID.露出] ?? 0) + 30;
        s[SOURCE_ID.逸脱] = (s[SOURCE_ID.逸脱] ?? 0) + 100;
        if (talent(p, TALENT_ID.形状) === 5) {
          s[SOURCE_ID.苦痛] = (s[SOURCE_ID.苦痛] ?? 0) + 300;
        }
        if (pose === 6) {
          s[SOURCE_ID.苦痛] = (s[SOURCE_ID.苦痛] ?? 0) + 300;
        }
        if (pose > 0 && pose === favoritePose - 5) {
          s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + 100;
          s[SOURCE_ID.恭順] = (s[SOURCE_ID.恭順] ?? 0) + 50;
        }
      }
    }

    const ladder = insertionContinuationPain(t, channel);
    s[SOURCE_ID.苦痛] = (s[SOURCE_ID.苦痛] ?? 0) + ladder.pain;
    if (!timeStopped && (channel === "v" || cflag(t, CFLAG_ID.恶作剧) === 0)) {
      s[SOURCE_ID.反感] = (s[SOURCE_ID.反感] ?? 0) + ladder.aversion;
    }

    // Partner-led 诶嘿嘿 is a target-side continuation bonus. The ejaculation
    // strength belongs to the actor/master, while the SOURCE remains target-side.
    if (cflag(t, CFLAG_ID.诶嘿嘿) === 2) {
      s[pleasureSource] = (s[pleasureSource] ?? 0) + 150;
      s[SOURCE_ID.情愛] = (s[SOURCE_ID.情愛] ?? 0) + 100;
      p.state.TCVAR[TCVAR_ID.射精快感強度] =
        (p.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0) + 150;
    }
  }
}

/**
 * USERCOM/SOURCE.ERB:315-321 — teasing deliberately dampens every pleasure
 * CUP before ORGASM_ADD observes it.  Keep this on the shared SOURCE_CHECK
 * path so H commands and any other settled source use the same rule.
 */
function applyTeasingCupMul(t: CharaSlot): void {
  if (readTequip(t, TEQUIP_ID.挑逗モード) === 0) return;
  for (const id of [PALAM_ID.快Ｃ, PALAM_ID.快Ｖ, PALAM_ID.快Ａ, PALAM_ID.快Ｂ, PALAM_ID.快Ｍ]) {
    if (cup(t, id) !== 0) t.state.CUP[id] = times(cup(t, id), 0.9);
  }
}

/**
 * `SOURCE_CBVA.ERB:749-753` — apply the command-local pleasure modifiers
 * after all SOURCE converters and before ORGASM_ADD reads CUP. The command
 * bodies write these transient TCVAR slots; keeping the consumer here makes
 * the ordering identical for ordinary H commands, SM commands, and the
 * master-side SOURCE of a dual-participant command.
 */
export function applyCommandPleasureCorrections(t: CharaSlot): void {
  const corrections: ReadonlyArray<readonly [number, number]> = [
    [PALAM_ID.快Ｃ, TCVAR_ID.指令Ｃ補正],
    [PALAM_ID.快Ｖ, TCVAR_ID.指令Ｖ補正],
    [PALAM_ID.快Ａ, TCVAR_ID.指令Ａ補正],
    [PALAM_ID.快Ｂ, TCVAR_ID.指令Ｂ補正],
    [PALAM_ID.快Ｍ, TCVAR_ID.指令Ｍ補正],
  ];
  for (const [palamId, tcvarId] of corrections) {
    const correction = t.state.TCVAR[tcvarId] ?? 0;
    if (correction === 0 || cup(t, palamId) === 0) continue;
    t.state.CUP[palamId] = Math.trunc((cup(t, palamId) * (100 + correction)) / 100);
  }
}

/**
 * TRACHECK_TIME (TRACHECK.ERB:10-28) for the ordinary SOURCE_CHECK route.
 * The command frame owns the once-per-command guard because some handlers
 * settle both TARGET and MASTER SOURCE maps during one command.
 *
 * One_Minute_Man is an upstream named SAVEDATA toggle, not a FLAG. Its
 * ordinary-H branch changes the standard +5-minute cost to +1.
 */
function applyTraceCheckTime(next: GameState): ObservationEvent[] {
  const frame = next.turnContext?.frame;
  if (!frame || frame.sourceCheckTimeApplied) return [];
  frame.sourceCheckTimeApplied = true;
  if (isTimeStopped(next) || frame.commandNo >= 200) return [];
  const oneMinuteMan = (next.dlcSavedata?.[SAVEDATA_KEY.OneMinuteMan] ?? 0) !== 0;
  return advanceTimeTicks(next, oneMinuteMan ? 1 : 5);
}

/** Modern COMF costs and upstream post-command corrections, audited per branch. */
const ONE_MINUTE_H_AUDITED_COMF_TIME: Readonly<
  Record<number, { readonly baseTimeCosts: readonly number[]; readonly correction: number }>
> = {
  312: { baseTimeCosts: [0, 5, 10], correction: 4 },
  317: { baseTimeCosts: [5], correction: 4 },
  318: { baseTimeCosts: [5], correction: 4 },
  313: { baseTimeCosts: [5], correction: 4 },
  314: { baseTimeCosts: [5], correction: 4 },
  315: { baseTimeCosts: [5], correction: 4 },
  316: { baseTimeCosts: [5], correction: 4 },
  330: { baseTimeCosts: [5], correction: 4 },
  331: { baseTimeCosts: [30], correction: 4 },
  335: { baseTimeCosts: [30], correction: 4 },
  336: { baseTimeCosts: [20, 40], correction: 4 },
  356: { baseTimeCosts: [5], correction: 4 },
  357: { baseTimeCosts: [10], correction: 4 },
  360: { baseTimeCosts: [5], correction: 4 },
  361: { baseTimeCosts: [10], correction: 9 },
  320: { baseTimeCosts: [0], correction: 4 },
  322: { baseTimeCosts: [0], correction: 4 },
  323: { baseTimeCosts: [0], correction: 4 },
};

/**
 * Fold TRACHECK_TIME's −4/−9 into audited positive COMF costs before clock
 * advancement. Zero-cost H commands retain a signed correction, applied by
 * the clock as a TIME adjustment rather than elapsed world time. Family7's
 * COMF356/357 and COMF360/361 handlers also call this for explicit costs.
 */
export function applyOneMinuteHCommandTimeCorrection(
  state: GameState,
  commandNo: number,
  target: number,
  baseTimeCost: number,
): number {
  const audited = ONE_MINUTE_H_AUDITED_COMF_TIME[commandNo];
  if (!audited || !audited.baseTimeCosts.includes(baseTimeCost)) {
    return baseTimeCost;
  }
  // TRACHECK_TIME's H correction is outside FLAG:70's normal elapsed-time
  // branch. Preserve a zero-cost TIME -= 4 even during time stop (notably
  // COMF312's dedicated stop arm); positive body costs remain frozen here.
  if (isTimeStopped(state) && baseTimeCost !== 0) return baseTimeCost;
  if ((state.dlcSavedata?.[SAVEDATA_KEY.OneMinuteMan] ?? 0) === 0) {
    return baseTimeCost;
  }
  const targetHMode = state.charas[target]?.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0;
  return targetHMode > 0 ? baseTimeCost - audited.correction : baseTimeCost;
}

function culcTired(downbase: number): number {
  if (downbase < 10) return 0;
  const local = Math.trunc(downbase / 10);
  return Math.trunc(local * Math.sqrt(local));
}

/**
 * ADD_TIRED/CULC_TIRED (SET_CMN.ERB:182-205) for the bounded H slice.
 * Until handlers expose their authored DOWNBASE accumulator, derive the
 * consumed stamina/will from the command-start frame snapshot. This keeps
 * the state mutation in SOURCE settlement and is safe across repeated calls.
 */
function applyFrameFatigue(next: GameState, t: CharaSlot): void {
  const frame = next.turnContext?.frame;
  const baseline = frame?.baseBeforeByChara?.[t.charaNum];
  if (!frame || !baseline) return;
  frame.fatigueAppliedByChara ??= {};
  if (frame.fatigueAppliedByChara[t.charaNum]) return;
  frame.fatigueAppliedByChara[t.charaNum] = true;

  // ADD_TIRED skips MASTER and a target that is already sleeping.
  if (t.charaNum === 0 || cflag(t, CFLAG_ID.睡眠) !== 0) return;
  const staminaDrop = Math.max(0, baseline.stamina - base(t, BASE_ID.体力));
  const willDrop = Math.max(0, baseline.will - base(t, BASE_ID.気力));
  const tired = 12 * culcTired(staminaDrop) + 8 * culcTired(willDrop);
  if (tired > 0) {
    t.state.TCVAR[TCVAR_ID.疲労度] = (t.state.TCVAR[TCVAR_ID.疲労度] ?? 0) + tired;
  }
}

export function settleSourcePalam(
  _next: GameState,
  t: CharaSlot,
  p: CharaSlot,
  source: Readonly<Record<number, number>>,
  options: {
    skipReactiveEffects?: boolean;
    beforeApply?: SourceSettlementHook;
  } = {},
): Record<number, number> {
  // Work on a copy — the pre-scalers mutate the source quanta and
  // FAVOR_CALC reads the post-scale values.
  const s: Record<number, number> = { ...source };

  // Pre-scaling loop (SOURCE.ERB 221-224): S *= FAVOR*TECH/10000, then
  // S *= MOOD*REASON/10000.
  for (const idStr of Object.keys(s)) {
    const id = Number(idStr);
    let v = s[id]!;
    v = Math.trunc((v * masterFavorCheck(t, id) * techniqueCheck(p, id)) / 10000);
    v = Math.trunc((v * moodCheck(t, id) * reasonCheck(t, id)) / 10000);
    s[id] = v;
  }

  // Slice C: EQUIP_CHECK 持续效果 (SOURCE.ERB:242) — 目标装备的调教道具每
  // SOURCE 结算产生持续 SOURCE (不经 FAVOR/TECH 预处理, 与原版顺序一致).
  addEquipContinuous(_next, t, p, s);
  applySustainedContactCosts(_next, t, p);
  addInsertionContinuation(_next, t, p, s);

  sourceKaikanC(t, s);
  sourceKaikanV(t, s);
  sourceKaikanA(t, s);
  sourceKaikanB(t, s);
  sourceKaikanM(t, s);
  sourceJouai(t, s);
  sourceYokujou(t, s);
  sourcePain(t, p, s);
  sourceYuwaku(t, p, s);
  sourceBujoku(t, p, s);
  sourceChouhatsu(t, p, s);
  sourceHoushi(t, p, s);
  sourceKyouyou(t, p, s);
  sourceKanraku(t, p, s);
  sourceSeifuku(t, p, s);
  sourceJudou(t, p, s);
  sourceDepression(_next, t, s);
  // A frozen target cannot register aversion. Keep the physical/pleasure
  // converters active, but do not create CUP:反感 or its reaction mark.
  const reasonShaved = getTflag(_next, TFLAG_ID.理性削り) !== 0;
  if (!options.skipReactiveEffects) sourceHankan(t, s, reasonShaved);

  // 媚薬 (TCVAR:140) CUP 倍率 — after the converters accumulated CUP, before
  // MARK reads CUP:反感/不快 and applyAndClearCup flushes it (faithful to
  // SOURCE_EXTRA.ERB:18-22 / SOURCE_CBVA.ERB:656-661).
  applyAphrodisiacCupMul(t);
  applyTeasingCupMul(t);
  applyCommandPleasureCorrections(t);

  // Every SOURCE_CHECK pass owns the upstream ORGASM_ADD window. It runs
  // after the ordinary converters, while CUP/CDOWN are still live, and its
  // generated SOURCE is then fed through the post-orgasm converter arms.
  const orgasm = applyOrgasmAdd(_next, t, p, s);
  const generatedSource: Record<number, number> = { ...orgasm.generatedSource };
  if (Object.keys(generatedSource).length > 0) {
    applyGeneratedOrgasmSource(
      t,
      p,
      generatedSource,
      options.skipReactiveEffects === true,
      reasonShaved,
    );
    for (const [id, amount] of Object.entries(generatedSource)) {
      s[Number(id)] = (s[Number(id)] ?? 0) + amount;
    }
  }

  // Keep the compatibility hook for narrow callers that still need an
  // additional pre-flush effect. Its returned SOURCE map follows the same
  // deterministic converter path.
  const extraSource = options.beforeApply?.(t, p, s);
  if (extraSource && Object.keys(extraSource).length > 0) {
    const extra = { ...extraSource };
    applyGeneratedOrgasmSource(
      t,
      p,
      extra,
      options.skipReactiveEffects === true,
      reasonShaved,
    );
    for (const [id, amount] of Object.entries(extra)) {
      s[Number(id)] = (s[Number(id)] ?? 0) + amount;
    }
  }

  applyFrameFatigue(_next, t);

  // SOURCE.ERB calls MARK_GOT_CHECK after ORGASM_ADD, SOURCE_DOWNBASE, and
  // EXP_GOT_CHECK, while CUP and the orgasm TCVAR results are still live.
  // The prank guard belongs around the whole check; time-stop suppresses only
  // the active 不埒 branch inside applyTrainingMarkAcquisitionChecks.
  const frame = _next.turnContext?.frame;
  if (frame) {
    accumulateTrainingMarkCups(_next, t);
  } else if (cflag(t, CFLAG_ID.恶作剧) === 0) {
    applyTrainingMarkAcquisitionChecks(_next, t);
    markGotCheckHankan(_next, t);
  }
  if (frame) frame.sourceByChara[t.charaNum] = { ...s };

  applyAndClearCup(t);
  applyAndClearCup(p);
  return s;
}

/**
 * @TRUST_CALC deterministic core (`TRACHECK_信頼度上昇処理.ERB`) — Parity QA
 * P-15 ③. Computes the 信頼度 (CFLAG:信頼度) delta from the command's
 * `trustSeed` (= upstream `TFLAG:信頼度管理`, +up / −down), the target's 親密 /
 * 憤怒 / personality traits, the post-scale SOURCE map, and the 反発刻印
 * penalty. Writes `CFLAG:信頼度 += delta` (clamped 0..999999) and returns the
 * delta.
 *
 * **Gate (caller's job, faithful to SOURCE.ERB:1251):** only runs when the
 * command supplied a non-zero trust seed AND the target is awake / not in
 * 诶嘿嘿. `applySourceCheck` enforces this before calling.
 *
 * **DEFERRED (off in a clean state / unmodeled):** DLC 好感亲密重做 arms,
 * CHARM (媚薬), 動物耳/謎之魅力/魅惑/人気 talents, 继承 bits, 不誠実度,
 * 体目当て, MAP_住人 bonus, 好感度BONUS, FLAG:信頼度上昇率, ASSIPLAY, ウフフ
 * (313-330) cap, 什麼也不做(21) cap, 烂醉. The numeric SOURCE → trust core +
 * 親密/憤怒/反発刻印 + 情緒/理性 modifiers + the failure-flag floor are ported.
 */
function trustCalc(
  t: CharaSlot,
  p: CharaSlot,
  s: Record<number, number>,
  trustSeed: number,
): number {
  // ERB 18-19: a negative seed (failed command) raises the failure flag,
  // which gates whether trust may drop at all (ERB 245-246).
  const failed = trustSeed < 0;
  let trust = trustSeed;

  // ERB 22: 親密 / 5.
  trust += Math.trunc(abl(t, ABL_ID.親密) / 5);
  // ERB 26-27: 憤怒 lowers trust on a failed command.
  if (base(t, BASE_ID.憤怒) > 0 && trustSeed < 0) {
    trust -= Math.trunc(base(t, BASE_ID.憤怒) / 100);
  }
  // ERB 31-69 personality arms (clean-state-reachable subset).
  const taido = talent(t, TALENT_ID.態度);
  if (taido > 0 && talent(t, TALENT_ID.恋慕) === 0) trust -= 1; // 叛逆
  trust += talent(t, TALENT_ID.心情); // 心情 (±1)
  if (taido < 0 && trustSeed > 0) trust += 1; // 坦率
  const cheerT = talent(t, TALENT_ID["开朗／阴郁"]);
  const cheerP = talent(p, TALENT_ID["开朗／阴郁"]);
  if (cheerT > 0 && cheerP > 0) trust += 1; // 開朗同士
  if (cheerT < 0 && cheerP < 0) trust += 1; // 阴郁同士
  if (talent(t, TALENT_ID.抵抗) !== 0) trust -= 2; // 抵抗
  if (talent(t, TALENT_ID.献身的) !== 0 && trustSeed > 0) trust += 1; // 献身的
  // TRACHECK_信頼度上昇処理.ERB:63-64.  A freshly encountered路人
  // quickly grants a meaningful trust head-start as part of the same
  // deterministic settlement pass.
  if (talent(t, TALENT_ID.路人) === 1) trust += 10;
  // ERB 61-72 (non-DLC arm): 恋慕 +2, 思慕 +1.
  if (talent(t, TALENT_ID.恋慕) !== 0) trust += 2;
  if (talent(t, TALENT_ID.思慕) !== 0) trust += 1;

  // ERB 94-127: SOURCE → trust numeric core (LOCAL accumulation, /10).
  let local = 0;
  local += 50 - Math.trunc(250000 / (src(s, SOURCE_ID.情愛) + 5000));
  local += 30 - Math.trunc(30000 / (src(s, SOURCE_ID.達成) + 1000));
  local += 20 - Math.trunc(20000 / (src(s, SOURCE_ID.恭順) + 1000));
  local += 15 - Math.trunc(15000 / (src(s, SOURCE_ID.屈従) + 1000));
  local += 30 - Math.trunc(150000 / (src(s, SOURCE_ID.歓楽) + 5000));
  local += 30 - Math.trunc(90000 / (src(s, SOURCE_ID.征服) + 3000));
  local += 30 - Math.trunc(90000 / (src(s, SOURCE_ID.受動) + 3000));
  // hasUpper = was there any positive trust-source? (ERB LOCAL:1 guard,
  // line 110/271 — only write trust if a source moved it.)
  const hasUpper = local !== 0;
  local -= Math.trunc(
    ((50 - Math.trunc(20000 / (src(s, SOURCE_ID.恐怖) + 400))) *
      (abl(t, ABL_ID.従順) - 3)) /
      3,
  );
  local -= Math.trunc(
    ((50 - Math.trunc(20000 / (src(s, SOURCE_ID.苦痛) + 400))) *
      (abl(t, ABL_ID.受虐属性) - 3)) /
      3,
  );
  local -= Math.trunc(
    ((50 - Math.trunc(25000 / (src(s, SOURCE_ID.不潔) + 500))) *
      (2 - talent(t, TALENT_ID.汚臭耐性))) /
      2,
  );
  local -= 50 - Math.trunc(15000 / (src(s, SOURCE_ID.鬱屈) + 300));
  local -= 50 - Math.trunc(25000 / (src(s, SOURCE_ID.逸脱) + 500));
  local -= 30 - Math.trunc(10000 / (src(s, SOURCE_ID.反感) + 500));
  trust += Math.trunc(local / 10);

  // ERB 167: 反発刻印補正 — (FLAG:難易度 + 1) * MARK:反発刻印 (difficulty 0).
  trust -= mark(t, MARK_ID.反発刻印);

  // ERB 218-230: 情緒/理性 modifiers.
  const joucho = base(t, BASE_ID.情緒);
  const jouchoMax = maxbase(t, BASE_ID.情緒);
  const risei = base(t, BASE_ID.理性);
  const riseiMax = maxbase(t, BASE_ID.理性);
  if (jouchoMax > 0 && joucho === jouchoMax) {
    trust += 2;
    if (trust < 0) trust = 0; // 情緒全開 → no drop
  } else if (
    (jouchoMax > 0 && joucho >= Math.trunc((jouchoMax / 5) * 4)) ||
    (riseiMax > 0 && risei <= Math.trunc(riseiMax / 2))
  ) {
    trust += 1;
    if (trust < 0) trust += Math.trunc(Math.abs(trust) / 2); // half the drop
  }

  // ERB 245-246: a non-failed command never lowers trust.
  if (!failed && trust < 0) trust = 0;
  // (ERB 247: a failed command zeroes any positive trust — the trust flag
  // semantics. Here trustSeed<0 implies failed; a positive trust on a failed
  // command is rare but we honor it.)
  if (failed && trust > 0) trust = 0;

  // ERB 258: lower bound = MAX(反発刻印 − 心情, 0) × −5.
  const floor = Math.max(mark(t, MARK_ID.反発刻印) - talent(t, TALENT_ID.心情), 0) * -5;
  if (trust < floor) trust = floor;

  // ERB 261-263: only write trust if a source actually contributed.
  if (hasUpper) {
    const before = cflag(t, CFLAG_ID.信頼度);
    t.state.CFLAG[CFLAG_ID.信頼度] = Math.max(0, Math.min(before + trust, 999999));
  }
  return hasUpper ? trust : 0;
}

/**
 * Apply the 会話 SOURCE settlement to `next` (mutated in place):
 * pre-scale → converters → PALAM-apply → FAVOR_CALC → CFLAG:好感度.
 *
 * `target` must be a real chara (`> 0`) present in `next.charas`; the
 * caller (`talk.ts`) guards this.
 *
 * Parity QA P-15 ③ — when `trustSeed` (= upstream `TFLAG:信頼度管理`) is
 * non-zero and the target is awake / not in 诶嘿嘿, TRUST_CALC also runs.
 * Commands that drive trust pass their seed; 会話 and clean commands pass 0
 * (faithful: SOURCE.ERB:1251 only calls TRUST_CALC when 信頼度管理 != 0).
 */
export function applySourceCheck(
  next: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  favorBias = 0,
  trustSeed = 0,
): SourceCheckResult {
  return applySourceCheckInternal(next, target, source, favorBias, trustSeed);
}

/** Apply SOURCE_CHECK with a pre-PALAM hook for bounded H settlement. */
export function applySourceCheckWithHook(
  next: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  favorBias = 0,
  trustSeed = 0,
  beforeApply: SourceSettlementHook,
): SourceCheckResult {
  return applySourceCheckInternal(next, target, source, favorBias, trustSeed, beforeApply);
}

function applySourceCheckInternal(
  next: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  favorBias = 0,
  trustSeed = 0,
  beforeApply?: SourceSettlementHook,
): SourceCheckResult {
  const t = next.charas[target];
  if (!t) throw new Error(`applySourceCheck: unknown target ${target}`);
  const p = next.master;
  const timeEvents = applyTraceCheckTime(next);
  const beforeDomain = snapshotCharaDomainState(t);
  const edgingBefore = snapshotEdgingEx(t);

  const timeStopped = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const consciouslyActed = (t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 0;
  const s = settleSourcePalam(next, t, p, source, {
    skipReactiveEffects: timeStopped && !consciouslyActed,
    beforeApply,
  });
  const edgingEvents = edgingTransitionEvents(edgingBefore, snapshotEdgingEx(t));

  // S-2 — 欲求不満度上昇 (SOURCE.ERB:1200). Banks 积攒度 from the now-settled
  // 欲情 PALAM level. Runs after PALAM-apply, before FAVOR_CALC (ERB order).
  settleFrustration(t);

  // @FAVOR_CALC head gate (TRACHECK_好感度上昇処理.ERB:13-14):
  //   SIF FLAG:70 == 1 && CFLAG:TARGET:344 == 0 → RETURN
  // While time is stopped and the target has NOT been "consciously acted on"
  // (時間停止行動 == 0, i.e. still frozen and unaware), the whole 好感度 /
  // 憤怒 / 情緒 / 理性 / 信頼 settlement is skipped — a frozen chara doesn't
  // register the action, so it can never anger them or move their affection.
  // (Modern doesn't yet SET 344 mid-timestop, so in the current slice this is
  // effectively "no anger while time-stopped"; the 344 term keeps it correct
  // once conscious-during-timestop tracking lands.)
  if (timeStopped && !consciouslyActed) {
    return {
      favorDelta: 0,
      events: [...timeEvents, ...edgingEvents],
      angerDiagnostics: null,
      transitions: detectCharaDomainTransitions(
        target,
        beforeDomain,
        snapshotCharaDomainState(t),
      ),
      rebellionMark: undefined,
    };
  }

  const activeTraining = next.training?.target === target;
  const favorResult = favorCalc(
    t,
    s,
    favorBias,
    activeTraining,
    next.flagStore[FLAG_ID.催眠強度] ?? 0,
  );
  // FAVOR_CALC: daily rage wakes a sleeping character through the ordinary
  // lifecycle, including fatigue/depth and co-sleep/prank cleanup.
  const wakeEvents: ObservationEvent[] = [];
  if (!activeTraining && cflag(t, CFLAG_ID.勃然大怒) && cflag(t, CFLAG_ID.睡眠)) {
    const plan = planCharaAwake(next, target, false);
    if (plan) {
      applyCharaAwake(next, target, plan);
      wakeEvents.push({ kind: "NARRATION", timestamp: next.time.tickValue, text: `${t.callName ?? `#${target}`}被惊醒了。` });
    }
  }
  const favorDelta = mobGirlGrowthBonus(t, favorResult.value);
  const favorBefore = cflag(t, CFLAG_ID.好感度);
  t.state.CFLAG[CFLAG_ID.好感度] = Math.max(
    0,
    Math.min(favorBefore + favorDelta, 1000000),
  );

  // P-15 ③ — TRUST_CALC, gated faithfully (SOURCE.ERB:1251).
  if (
    trustSeed !== 0 &&
    (t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0 &&
    (t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0
  ) {
    trustCalc(t, p, s, trustSeed);
  }

  const events: ObservationEvent[] = timeEvents.concat(
    edgingEvents,
    wakeEvents,
    favorDelta !== 0
      ? [
          {
            kind: "STATUS_MESSAGE",
            timestamp: 0,
            source: "system",
            text: `好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}`,
          },
        ]
      : [],
  );
  const previousMark = beforeDomain.marks[3] as 0 | 1 | 2 | 3;
  const currentMark = (t.state.MARK?.[MARK_ID.反発刻印] ?? 0) as 0 | 1 | 2 | 3;
  return {
    favorDelta,
    events,
    angerDiagnostics: favorResult.angerDiagnostics,
    transitions: detectCharaDomainTransitions(
      target,
      beforeDomain,
      snapshotCharaDomainState(t),
    ),
    ...(currentMark > previousMark
      ? { rebellionMark: { previousLevel: previousMark, level: currentMark as 1 | 2 | 3 } }
      : {}),
  };
}

// --- the 4 pre-scalers (TRACHECK.ERB 38-105), keyed on SOURCE id ----------
// All return a /100-scaled coefficient (100 == ×1.0).

function masterFavorCheck(t: CharaSlot, srcId: number): number {
  const favor = cflag(t, CFLAG_ID.好感度);
  if (srcId <= 3) return getRevision(favor, 200, 20000) + 100;
  if (srcId === 10) return getRevision(favor, 200, 15000) + 100;
  if (srcId >= 30 && srcId <= 33) return Math.max(50, 100 - Math.trunc(favor / 200));
  return 100;
}

function techniqueCheck(_p: CharaSlot, srcId: number): number {
  // TCVAR:116 (調教者 index) defaults 0/unmodeled → not < 0, so we fall
  // through. ids 0-3 read ABL:技巧; 会話's 20/21/22 → CASEELSE → 100.
  if (srcId <= 3) return getRevision(abl(_p, ABL_ID.技巧) + 2, 500, 10);
  return 100;
}

function moodCheck(t: CharaSlot, srcId: number): number {
  const joucho = t.state.BASE[10] ?? 0; // BASE:情緒
  if ([10, 12, 15, 16, 18, 20, 21, 22].includes(srcId))
    return getRevision(joucho, 50, 500) + 100;
  if (srcId >= 30 && srcId <= 33) return 200 - Math.trunc(joucho / 100);
  return 100;
}

function reasonCheck(t: CharaSlot, srcId: number): number {
  const risei = t.state.BASE[11] ?? 0; // BASE:理性
  if ([0, 1, 2, 3, 10, 12, 15, 16, 18].includes(srcId))
    return getRevision(1000 - risei, 50, 500) + 100;
  if (srcId >= 30 && srcId <= 33) return 50 + Math.trunc(risei / 100);
  return 100;
}
