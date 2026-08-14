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
 *   - The whole 日常時 BASE block in FAVOR_CALC (情緒/理性/憤怒 lines
 *     197-307), and the remaining DLC/personal modifiers.
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
  EXP_ID,
  MARK_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  FLAG_ID,
  getRevision,
  getRevision3,
  times,
  palamLv,
  palamLevel,
  expLv,
  sourceRevision1,
  sourceRevision2,
} from "../state/settlement.js";
import { readTequip } from "../state/tequip.js";

export interface SourceCheckResult {
  /** Net 好感度 change written to the target (ERB `TFLAG:97`). */
  readonly favorDelta: number;
  /** Settlement-level messages (e.g. the 好感度 ± line). */
  readonly events: readonly ObservationEvent[];
  /** Named state changes produced by this settlement. */
  readonly transitions: readonly DomainTransition[];
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

/** @SOURCE_反感 → CUP:反感 (心情, 従順+親密, 奉仕精神, 受虐属性). (5E) */
function sourceHankan(t: CharaSlot, s: Record<number, number>): void {
  let local = Math.trunc((src(s, SOURCE_ID.反感) * (10 - 3 * talent(t, TALENT_ID.心情))) / 10);
  // 诶嘿嘿/路人/体目当て — deferred (off).
  local = times(local, hankanJujunMul(abl(t, ABL_ID.従順) + abl(t, ABL_ID.親密)));
  local = times(local, hankanBandMul(abl(t, ABL_ID.奉仕精神)));
  local = times(local, hankanBandMul(abl(t, ABL_ID.受虐属性)));
  // FLAG:催眠強度 / TALENT:反発抑制 — deferred (off).
  cupAdd(t, PALAM_ID.反感, local);
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
 * @MARK_GOT_CHECK 反発刻印 arm (`TRACHECK_刻印取得.ERB` 154-227). Parity QA
 * P-15 ②. Reads the per-turn `CUP:反感 + CUP:不快` quanta (so it MUST run
 * before `applyAndClearCup` zeroes them), and on a high-enough sum brands the
 * target with 反発刻印 1/2/3 — setting 心情不快 / ブチギレ / TALENT:心情=-1 and
 * (at level ≥2) dropping ABL:従順/親密. The earlier 苦痛/時姦/快楽/不埒 brand
 * arms are deferred (their取得 reads CUP 快感/苦痛/恐怖 that 会話/掀裙子 don't
 * produce).
 *
 * Returns the brand level newly reached (0 = none) for narration / tests.
 */
function markGotCheckHankan(t: CharaSlot): number {
  // ERB 157-165 early returns (MASTER excluded handled by caller; 恶作剧/TFLAG:150
  // unmodeled-off).
  if (talent(t, TALENT_ID.反発抑制) !== 0) return 0;

  let val = cup(t, PALAM_ID.反感) + cup(t, PALAM_ID.不快);
  // ERB 167-172: 反発取得履歴 makes re-earning the same band harder (a
  // window of values collapses down a level).
  const hist = mark(t, MARK_ID.反発取得履歴);
  if (hist > 0 && inRange(val, 500, 700)) val = 0;
  if (hist > 1 && inRange(val, 1001, 1300)) val = 1000;
  if (hist > 2 && inRange(val, 2001, 2500)) val = 2000;

  const emoLack = false; // TALENT:感情缺乏 — unmodeled, off by default.
  const m = markStore(t);
  if (val >= 500 && val <= 1000) {
    if (mark(t, MARK_ID.反発刻印) < 1) {
      m[MARK_ID.反発刻印] = 1;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 1);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 1;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      return 1;
    }
  } else if (val >= 1001 && val <= 2000) {
    if (mark(t, MARK_ID.反発刻印) < 2) {
      m[MARK_ID.反発刻印] = 2;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 2);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 2;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      // ERB 192-201: 従順/親密 drop (when first reaching this band or val high).
      if ((hist < 2 || val >= 1200) && !emoLack) {
        const ju = abl(t, ABL_ID.従順);
        if (ju >= 1 && ju <= 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 1, 0);
        } else if (ju > 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
        }
      }
      return 2;
    }
  } else if (val > 2000) {
    if (mark(t, MARK_ID.反発刻印) < 3) {
      m[MARK_ID.反発刻印] = 3;
      m[MARK_ID.反発取得履歴] = Math.max(hist, 3);
      t.state.CFLAG[CFLAG_ID.不機嫌] = 3;
      t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
      t.state.TALENT[TALENT_ID.心情] = -1;
      if ((hist < 3 || val >= 2400) && !emoLack) {
        const ju = abl(t, ABL_ID.従順);
        if (ju >= 1 && ju <= 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 2, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 2, 0);
        } else if (ju > 5) {
          t.state.ABL[ABL_ID.従順] = Math.max(ju - 1, 0);
          t.state.ABL[ABL_ID.親密] = Math.max(abl(t, ABL_ID.親密) - 1, 0);
        }
      }
      return 3;
    }
  }
  return 0;
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
function favorCalc(t: CharaSlot, s: Record<number, number>, bias: number): number {
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

  // --- 日常時 BASE block (ERB 197-307) — Parity QA P-15 ① 反感→憤怒 ----------
  // Upstream gates the whole block on `TFLAG:102 != 2`; in our settlement the
  // daily-mode path is the only one (no うふふ session state machine yet), so
  // we run the 憤怒 accumulation. The 情緒/理性 lines are deferred (they need
  // 約会/抑制/天候 flags + feed the deferred 理性 reducer); we port the
  // anger arm, which is what the user's low-favor 掀裙子 report is about.
  // The 憤怒 accrual + cap-overflow + 心情不快 arms all read MAXBASE:憤怒. As
  // with `recoverPermil`, an UNSET MAXBASE (== 0) means "no cap known" and the
  // arm no-ops rather than zeroing current 憤怒 (a clean chara loaded via the
  // CSV always has MAXBASE seeded; tests that don't seed it opt out faithfully).
  const angerMax = maxbase(t, BASE_ID.憤怒);
  const hankanSrc = src(s, SOURCE_ID.反感);
  if (hankanSrc > 0 && angerMax > 0) {
    // ERB 247: 憤怒上昇値 = 反感 * 3 * (2000-情緒) * (500+理性) /
    //                      ((2000+情緒) * (500+MAXBASE:理性)).
    const joucho = base(t, BASE_ID.情緒);
    const risei = base(t, BASE_ID.理性);
    const riseiMax = maxbase(t, BASE_ID.理性);
    let anger = Math.trunc(
      (hankanSrc * 3 * (2000 - joucho) * (500 + risei)) /
        ((2000 + joucho) * (500 + riseiMax)),
    );
    // ERB 255-258: 心情 (TALENT:15) shifts the rise.
    const kokoro = talent(t, TALENT_ID.心情);
    if (kokoro === 1) anger = Math.trunc((anger * 7) / 10);
    else if (kokoro === -1) anger = Math.trunc((anger * 3) / 2);
    // ERB 271: 反発抑制 → /3.
    if (talent(t, TALENT_ID.反発抑制) !== 0) anger = Math.trunc(anger / 3);
    // ERB 274: BASE:憤怒 += 憤怒上昇値.
    t.state.BASE[BASE_ID.憤怒] = base(t, BASE_ID.憤怒) + anger;
    // ERB 276-277: 憤怒 over its cap → GET_ANGRY(ARG) (刻印付与 0).
    if (base(t, BASE_ID.憤怒) > angerMax) {
      getAngry(t, 0);
    }
    // ERB 278: clamp 憤怒 to its cap.
    t.state.BASE[BASE_ID.憤怒] = Math.min(base(t, BASE_ID.憤怒), angerMax);
  }
  // ERB 281-284: 心情不快 (反発刻印 earned this/earlier) → always angry. Only
  // when a cap is known (see above); otherwise leave seeded 憤怒 untouched.
  if (angerMax > 0 && (t.state.CFLAG[CFLAG_ID.不機嫌] ?? 0) !== 0) {
    t.state.BASE[BASE_ID.憤怒] = angerMax;
    t.state.CFLAG[CFLAG_ID.勃然大怒] = 1;
  }

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
  return tflag97;
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
 * 追加持续 SOURCE. 值来自各 `EQUIP_COM{40-49/104-107}` 的非时停分支 (审计).
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

/** 把目标已装备调教道具的持续 SOURCE 追加到 `s`. */
function addEquipContinuous(t: CharaSlot, s: Record<number, number>): void {
  for (const [tequip, sources] of Object.entries(TEQUIP_CONTINUOUS)) {
    if (readTequip(t, Number(tequip)) === 0) continue;
    for (const [sid, v] of Object.entries(sources)) {
      s[Number(sid)] = (s[Number(sid)] ?? 0) + v;
    }
  }
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

export function settleSourcePalam(
  _next: GameState,
  t: CharaSlot,
  p: CharaSlot,
  source: Readonly<Record<number, number>>,
  options: { skipReactiveEffects?: boolean } = {},
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
  addEquipContinuous(t, s);

  sourceKaikanC(t, s);
  sourceKaikanV(t, s);
  sourceJouai(t, s);
  sourceYokujou(t, s);
  sourcePain(t, p, s);
  sourceKanraku(t, p, s);
  sourceSeifuku(t, p, s);
  sourceJudou(t, p, s);
  sourceDepression(_next, t, s);
  // A frozen target cannot register aversion. Keep the physical/pleasure
  // converters active, but do not create CUP:反感 or its reaction mark.
  if (!options.skipReactiveEffects) sourceHankan(t, s);

  // 媚薬 (TCVAR:140) CUP 倍率 — after the converters accumulated CUP, before
  // MARK reads CUP:反感/不快 and applyAndClearCup flushes it (faithful to
  // SOURCE_EXTRA.ERB:18-22 / SOURCE_CBVA.ERB:656-661).
  applyAphrodisiacCupMul(t);

  // Parity QA P-15 ② — MARK_GOT_CHECK 反発刻印 runs HERE, reading the
  // accumulated CUP:反感/不快 before applyAndClearCup zeroes them (faithful
  // to the upstream order: MARK at SOURCE.ERB:1011, CUP-apply at 1127). The
  // target's brand floor then feeds FAVOR_CALC / TRUST_CALC below.
  if (!options.skipReactiveEffects) markGotCheckHankan(t);

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
  const t = next.charas[target];
  if (!t) throw new Error(`applySourceCheck: unknown target ${target}`);
  const p = next.master;
  const beforeDomain = snapshotCharaDomainState(t);

  const timeStopped = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const consciouslyActed = (t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 0;
  const s = settleSourcePalam(next, t, p, source, {
    skipReactiveEffects: timeStopped && !consciouslyActed,
  });

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
      events: [],
      transitions: detectCharaDomainTransitions(
        target,
        beforeDomain,
        snapshotCharaDomainState(t),
      ),
    };
  }

  const favorDelta = mobGirlGrowthBonus(t, favorCalc(t, s, favorBias));
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

  const events: ObservationEvent[] =
    favorDelta !== 0
      ? [
          {
            kind: "STATUS_MESSAGE",
            timestamp: 0,
            source: "system",
            text: `好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}`,
          },
        ]
      : [];
  return {
    favorDelta,
    events,
    transitions: detectCharaDomainTransitions(
      target,
      beforeDomain,
      snapshotCharaDomainState(t),
    ),
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
