/**
 * Fall-state resolution + auto-acquisition + EVENT-21 kojo hook (slice
 * C3). Faithful port of `@EVENTTURNEND` lines 31-199 plus the
 * `ADD_CHECK_FALL_STATES` machinery in
 * `fromEN/ADD_CUSTOM_FALL_CONDITION.ERB:33-48` and the per-state
 * condition functions in `イベント関連/EVENTTURNEND.ERB:353-…`
 * (思慕/恋慕/愛欲/炮友取得条件) and
 * `fromEN/Addition/Marriage/Add_Marriage.ERB:134` (TRUE_LOVE_CONDITIONS).
 *
 * The 5 fall-state slots are encoded as bit positions in a single
 * `FALL_STATES_ALLOWED` return value (per upstream):
 *   bit 0 = YEARNING  (思慕)
 *   bit 1 = LOVE      (恋慕)
 *   bit 2 = DEEP_LOVE (愛恋 — 恋慕>1)
 *   bit 3 = SEX_FRIEND (炮友)
 *   bit 4 = LUST      (愛欲)
 *
 * Per upstream `KOJO_CHECK(charaNum, "FALL_STATE_OVERRIDE", STATE)` and
 * `KOJO_CHECK(.., "FALL_STATE", ..)` hooks: a chara's kojo can either
 * hard-block the bit (`OVERRIDE == -1`) or layer extra predicates
 * on top of the upstream condition function (`FALL_STATE` returns
 * a string parseable as `1`-or-`0`). Our runtime lacks the kojo-
 * override plumbing today, so we ship the upstream-condition path
 * verbatim (the `KOJO_MESSAGE_SEND("EVENT", 21, …)` route is
 * already wired via `resolveEventKojo`).
 *
 * One-shot TALENT 取得 branches come from
 * `EVENTTURNEND.ERB:30-58` (接吻魔/自慰狂/子宮口性感/漏尿癖/反
 * 発抑制/合意誤認 reset) and `:174-186` (音楽知識 / 音感). Master
 * only on the first three (接吻/自慰/子宮), per `SIF LOCAL == MASTER
 * CONTINUE` in line :60-61.
 *
 * DEFERRED (honest, not faked):
 *   - `KOJO_CHECK("FALL_STATE_OVERRIDE")` hooks (DLC dormant).
 *   - Marriage / concubinage tiers (DLC).
 *   - `乐谱入手_陥落` (DLC).
 *   - MAGIC_DLC 好感亲密重做's "CFLAG:2/4 → 親密" cap (DLC).
 */

import type { GameState, CharaSlotState, CharaSlot } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { Rng } from "../command/rng.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import {
  ABL_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  MARK_ID,
  TALENT_ID,
} from "../state/settlement.js";

// Bit encoding (ADD_CUSTOM_FALL_CONDITION.ERB:32 comment).
export const FALL_STATE_YEARNING = 1 << 0; // 思慕
export const FALL_STATE_LOVE = 1 << 1; // 恋慕
export const FALL_STATE_DEEP_LOVE = 1 << 2; // 愛恋
export const FALL_STATE_SEX_FRIEND = 1 << 3; // 炮友 / 情人
export const FALL_STATE_LUST = 1 << 4; // 愛欲

// Fall-state id used for KOJO_MESSAGE_SEND("EVENT", 21, …, n).
// Mirrors the upstream :66-173 comment column ("EVENT 21, n=1 恋慕,
// 2 思慕, 3 愛欲, 4 情人, 5 炮友, 6 接吻魔, 7 自慰狂, 8 子宮口性感,
// 9 漏尿癖, 10 愛恋").
export const FALL_KOJO_ID = {
  YEARNING_LOVE: 1,
  YEARNING: 2,
  LUST: 3,
  LOVER: 4,
  FUCK_BUDDY: 5,
  KISS_FANATIC: 6,
  MASTURBATION_MANIAC: 7,
  CERVICAL_SENSATION: 8,
  URINATION_FETISH: 9,
  DEEP_LOVE: 10,
} as const;

/** Skill-acquisition kojo sub-id (EVENT 34 n=7,1 音楽知識 / 7,2 相対音感). */
export const SKILL_KOJO_ID = {
  MUSIC_KNOWLEDGE: 1,
  RELATIVE_PITCH: 2,
} as const;

type OneShotTalentEvent =
  | { kind: "tal"; talentId: number; kojoArm: number; kojoSubId: number }
  | { kind: "music"; musicId: number; kojoArm: number; kojoSubId: number };

function cflag(st: CharaSlotState, id: number): number {
  return st.CFLAG[id] ?? 0;
}
function exp(st: CharaSlotState, id: number): number {
  return st.EXP[id] ?? 0;
}
function abl(st: CharaSlotState, id: number): number {
  return st.ABL[id] ?? 0;
}
function talent(st: CharaSlotState, id: number): number {
  return st.TALENT[id] ?? 0;
}
function mark(st: CharaSlotState, id: number): number {
  return st.MARK[id] ?? 0;
}

/** `思慕取得条件(ARG)` (EVENTTURNEND.ERB:371-389). Returns 1 if the chara
 *  can acquire 思慕 this turn. */
export function yearningCondition(st: CharaSlotState): boolean {
  if (talent(st, TALENT_ID.恋慕) || talent(st, TALENT_ID.愛欲)) return false;
  if (talent(st, TALENT_ID.思慕)) return false;
  if (cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_思慕) return false;
  if (cflag(st, CFLAG_ID.信頼度) < REQUIRED_TRUST_思慕) return false;
  if (abl(st, ABL_ID.親密) < REQUIRED_AFFECTION_思慕) return false;
  if (talent(st, TALENT_ID.炮友) !== 0) return false; // upstream `炮友 && !FLAG:陥落路線変化`
  return true;
}

/** `恋慕取得条件(ARG)` (EVENTTURNEND.ERB:353-369). */
export function loveCondition(st: CharaSlotState): boolean {
  if (talent(st, TALENT_ID.恋慕)) return false;
  if (cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_恋慕) return false;
  if (cflag(st, CFLAG_ID.信頼度) < REQUIRED_TRUST_恋慕) return false;
  if (abl(st, ABL_ID.親密) < REQUIRED_AFFECTION_恋慕) return false;
  if (mark(st, MARK_ID.反発刻印) !== 0) return false;
  if (talent(st, TALENT_ID.愛欲) !== 0) return false;
  return true;
}

/** `愛欲取得条件(ARG)` (EVENTTURNEND.ERB:391-409). */
export function lustCondition(st: CharaSlotState): boolean {
  if (talent(st, TALENT_ID.恋慕)) return false;
  if (talent(st, TALENT_ID.愛欲)) return false;
  if (talent(st, TALENT_ID.炮友) === 0) return false;
  if (cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_愛欲) return false;
  if (abl(st, ABL_ID.欲望) < REQUIRED_DESIRE_愛欲) return false;
  // Upstream uses `(EXP:ARG:絶頂経験 - EXP:ARG:無自覚絶頂経験)` —
  // 自覚 (conscious) only — as the gate. The runtime EXP namespace
  // currently lacks a 無自覚絶頂経験 id (emuera builtin reserved
  // slot); until it does we approximate conscious-climax as the sum of
  // the 5 sense 絶頂経験 ids (C/V/A/B/M), which is faithful to the
  // day-end gate when 無自覚 term is 0 (default load).
  const consciousEcstacy =
    exp(st, EXP_ID.Ｃ絶頂経験) +
    exp(st, EXP_ID.Ｖ絶頂経験) +
    exp(st, EXP_ID.Ａ絶頂経験) +
    exp(st, EXP_ID.Ｂ絶頂経験) +
    exp(st, EXP_ID.Ｍ絶頂経験);
  if (consciousEcstacy < REQUIRED_ECSTACY_愛欲) return false;
  if (abl(st, ABL_ID.欲望) - abl(st, ABL_ID.親密) < 1) return false;
  return true;
}

/** `炮友取得条件(ARG)` (lookup: not literal in EVENTTURNEND.ERB but
 *  referenced via `DIM_als.ERH` constants). Upstream takes 好感 + 欲望 + 絶頂.
 *  Mirrors the per-DLC ladder (`DIM_als.ERH:2-4`). */
export function fuckbuddyCondition(st: CharaSlotState): boolean {
  if (
    cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_炮友 &&
    cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_セフレ
  ) {
    return false;
  }
  const desire = abl(st, ABL_ID.欲望);
  if (desire < REQUIRED_DESIRE_炮友) return false;
  // Same conscious-climax proxy as `lustCondition` above.
  const consciousEcstacy =
    exp(st, EXP_ID.Ｃ絶頂経験) +
    exp(st, EXP_ID.Ｖ絶頂経験) +
    exp(st, EXP_ID.Ａ絶頂経験) +
    exp(st, EXP_ID.Ｂ絶頂経験) +
    exp(st, EXP_ID.Ｍ絶頂経験);
  if (consciousEcstacy < REQUIRED_ECSTACY_炮友) return false;
  return true;
}

/** `TRUE_LOVE_CONDITIONS(ARG)` (Add_Marriage.ERB:134) — the harder
 *  gate for 恋慕 → 愛恋. */
export function deepLoveCondition(st: CharaSlotState): boolean {
  if (talent(st, TALENT_ID.恋慕) !== 1) return false; // only the Lv1 flavor upgrades
  if (cflag(st, CFLAG_ID.好感度) < REQUIRED_FAVOR_TRUE_LOVE) return false;
  if (cflag(st, CFLAG_ID.信頼度) < REQUIRED_TRUST_TRUE_LOVE) return false;
  if (abl(st, ABL_ID.親密) < REQUIRED_AFFECTION_TRUE_LOVE) return false;
  // デート / 愛情 経験 are not yet loaded in the modern runtime.
  return false;
}

// ─── constants (DIM.ERH:10-24 + DIM_als.ERH:2-4 + Add_Marriage.ERH:69-75) ─
const REQUIRED_FAVOR_恋慕 = 3000;
const REQUIRED_TRUST_恋慕 = 700;
const REQUIRED_AFFECTION_恋慕 = 10;
const REQUIRED_FAVOR_思慕 = 1500;
const REQUIRED_TRUST_思慕 = 250;
const REQUIRED_AFFECTION_思慕 = 5;
const REQUIRED_FAVOR_愛欲 = 3000;
const REQUIRED_DESIRE_愛欲 = 10;
const REQUIRED_ECSTACY_愛欲 = 500;
const REQUIRED_FAVOR_炮友 = 1500;
const REQUIRED_FAVOR_セフレ = 1500;
const REQUIRED_DESIRE_炮友 = 5;
const REQUIRED_ECSTACY_炮友 = 100;
const REQUIRED_FAVOR_TRUE_LOVE = 40000;
const REQUIRED_TRUST_TRUE_LOVE = 5000;
const REQUIRED_AFFECTION_TRUE_LOVE = 20;

/** `ADD_CHECK_FALL_STATES(CHARA)` (ADD_CUSTOM_FALL_CONDITION.ERB:33-48).
 *  Returns the bitmask; gaps respect the upstream `SIF !(...)` invariants
 *  (don't re-trigger states the chara is already in / blocked from). */
export function computeFallStates(st: CharaSlotState): number {
  let bits = 0;
  // YEARNING — gated by `!(恋慕 || 思慕)`.
  if (!talent(st, TALENT_ID.恋慕) && !talent(st, TALENT_ID.思慕)) {
    if (yearningCondition(st)) bits |= FALL_STATE_YEARNING;
  }
  // LOVE — `!(恋慕 || (愛欲 && !変化))`.
  if (!talent(st, TALENT_ID.恋慕) && !talent(st, TALENT_ID.愛欲)) {
    if (loveCondition(st)) bits |= FALL_STATE_LOVE;
  }
  // DEEP_LOVE — only Lv1 恋慕.
  if (talent(st, TALENT_ID.恋慕) === 1) {
    if (deepLoveCondition(st)) bits |= FALL_STATE_DEEP_LOVE;
  }
  // SEX_FRIEND — `!(恋人 || 恋慕 || セフレ==2)`.
  if (
    !talent(st, TALENT_ID.恋人) &&
    !talent(st, TALENT_ID.恋慕) &&
    talent(st, TALENT_ID.炮友) !== 2
  ) {
    if (fuckbuddyCondition(st)) bits |= FALL_STATE_SEX_FRIEND;
  }
  // LUST — `!(恋慕 || 愛欲 || セフレ==0)`.
  if (
    !talent(st, TALENT_ID.恋慕) &&
    !talent(st, TALENT_ID.愛欲) &&
    talent(st, TALENT_ID.炮友) !== 0
  ) {
    if (lustCondition(st)) bits |= FALL_STATE_LUST;
  }
  return bits;
}

/** 12 个一次性素质 connect — 接吻魔 / 自慰狂 / 子宮口性感 / 漏尿癖
 *  (per-character, master-eligible except 漏尿癖 is master too in
 *  upstream `:30-58`: all four branches check `EXP:LOCAL:` regardless
 *  of master; we mirror that). Music-learning branches only fire on
 *  the music XP path (演奏経験 1000/5000). Both fire regardless of
 *  master vs NPC. */
function evaluateOneShotTalent(
  st: CharaSlotState,
  isMaster: boolean,
  state: Readonly<GameState>,
): OneShotTalentEvent[] {
  const evts: OneShotTalentEvent[] = [];
  // 接吻魔 — 接吻経験 > 300 && M感覚 > 5 && !接吻魔
  if (
    exp(st, EXP_ID.接吻経験) > 300 &&
    abl(st, ABL_ID.Ｍ感覚) > 5 &&
    !talent(st, TALENT_ID.接吻魔)
  ) {
    evts.push({ kind: "tal", talentId: TALENT_ID.接吻魔, kojoArm: 21, kojoSubId: FALL_KOJO_ID.KISS_FANATIC });
  }
  // 自慰狂 — 調教自慰 > 200 && 自慰 > 500 && !自慰狂
  if (
    exp(st, EXP_ID.調教自慰経験) > 200 &&
    exp(st, EXP_ID.自慰経験) > 500 &&
    !talent(st, TALENT_ID.自慰狂)
  ) {
    evts.push({ kind: "tal", talentId: TALENT_ID.自慰狂, kojoArm: 21, kojoSubId: FALL_KOJO_ID.MASTURBATION_MANIAC });
  }
  // 子宮口性感 — 子宮口開発経験 > 50 && !子宮口性感
  if (
    exp(st, EXP_ID.子宮口開発経験) > 50 &&
    !talent(st, TALENT_ID.子宮口性感)
  ) {
    evts.push({ kind: "tal", talentId: TALENT_ID.子宮口性感, kojoArm: 21, kojoSubId: FALL_KOJO_ID.CERVICAL_SENSATION });
  }
  // 漏尿癖 — master-eligible in this slice (upstream `:52` has no
  // `SIF LOCAL != MASTER` guard; the `SIF LOCAL == MASTER CONTINUE`
  // for fall-states is at :60 — these come BEFORE the skip block).
  if (
    (state.flagStore[FLAG_ID.おもらし有効] ?? 0) > 0 &&
    exp(st, EXP_ID.放尿経験) > (100 * (10 - 2 * talent(st, TALENT_ID.容易中毒))) / 10 &&
    !talent(st, TALENT_ID.漏尿癖)
  ) {
    evts.push({ kind: "tal", talentId: TALENT_ID.漏尿癖, kojoArm: 21, kojoSubId: FALL_KOJO_ID.URINATION_FETISH });
  }
  // 音楽知識 (EVENT 34): 演奏経験 >= 1000 && 技巧 > 3 && !音楽知識.
  // Upstream has no `SIF LOCAL == MASTER CONTINUE` for these (it sits
  // before the master-skip block at line :60).
  if (
    exp(st, EXP_ID.演奏経験) >= 1000 &&
    abl(st, ABL_ID.技巧) > 3 &&
    !talent(st, TALENT_ID.音楽知識)
  ) {
    evts.push({ kind: "music", musicId: SKILL_KOJO_ID.MUSIC_KNOWLEDGE, kojoArm: 34, kojoSubId: 7 });
  } else if (exp(st, EXP_ID.演奏経験) >= 5000 && !talent(st, TALENT_ID.音感)) {
    evts.push({ kind: "music", musicId: SKILL_KOJO_ID.RELATIVE_PITCH, kojoArm: 34, kojoSubId: 7 });
  }
  // 反発抑制/合意誤認 are reset to 0 every turn (upstream line :20-21)
  // — not an acquisition, just a transient clear.
  st.TALENT[TALENT_ID.反発抑制] = 0;
  st.TALENT[TALENT_ID.合意誤認] = 0;
  void isMaster;
  return evts;
}

/** Magic DLC 親密 autocap (lines :22-29): dormant — `MAGIC_DLC_好感亲密重做` is
 *  upstream false by default and the relevant constants (REQUIRED_FAVOR_CONCUBINE_LOVE)
 *  live only in the DLC branch. */
void 0;

/** Apply the resolved fall-state to the slot and craft the EVENT-21 narration.
 *  This is the per-chara inner-loop (`LOCAL:0,CHARANUM` body in
 *  EVENTTURNEND.ERB:19-199 minus the master-skip guard). */
function applyFallState(
  slot: CharaSlot,
  isMaster: boolean,
  bits: number,
  events: ObservationEvent[],
  deps: RunFallDeps,
): void {
  const st = slot.state;
  const name = slot.callName ?? `角色${slot.charaNum}`;
  void isMaster;
  if ((bits & FALL_STATE_LOVE) !== 0) {
    // 恋慕 — 面霊気 (id 57) special-case, else 思慕 → 恋慕 vs 愛欲 → 恋慕
    // (EVENTTURNEND.ERB:67-94).
    if (slot.charaNum === 57) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}在察觉了自己对主人的思慕的同时、嘴角翘了起来`,
      });
    } else if (talent(st, TALENT_ID.愛欲) !== 0) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}因为身体与心灵都被主人填满而感到了喜悦…`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}因为与主人共同渡过的时光而感到很幸福的样子…`,
      });
    }
    // EVENT 21 / 1
    const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.YEARNING_LOVE]);
    emitKojoLines(lines, slot.charaNum, events, deps);
    if (talent(st, TALENT_ID.愛欲) !== 0) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}的[爱欲]变成了[恋慕]`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}的[思慕]变成了[恋慕]`,
      });
    }
    st.TALENT[TALENT_ID.恋慕] = 1;
    st.TALENT[TALENT_ID.思慕] = 0;
    st.TALENT[TALENT_ID.愛欲] = 0;
    st.TALENT[TALENT_ID.炮友] = 0;
    return;
  }
  if ((bits & FALL_STATE_YEARNING) !== 0) {
    if (talent(st, TALENT_ID.炮友) !== 0) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}对主人产生了身体之外的兴趣`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}变得对主人很在意的样子…`,
      });
    }
    const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.YEARNING]);
    emitKojoLines(lines, slot.charaNum, events, deps);
    events.push({
      kind: "NARRATION",
      timestamp: deps.now(),
      text: `${name}获得了[思慕]`,
    });
    st.TALENT[TALENT_ID.思慕] = 1;
    return;
  }
  if ((bits & FALL_STATE_LUST) !== 0) {
    if (talent(st, TALENT_ID.思慕) !== 0) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}与主人不仅在心灵上也在肉体的羁绊上获得了满足的样子…`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}好像沉溺于对主人的情欲之中了…`,
      });
    }
    const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.LUST]);
    emitKojoLines(lines, slot.charaNum, events, deps);
    events.push({
      kind: "NARRATION",
      timestamp: deps.now(),
      text: `${name}获得了[爱欲]`,
    });
    st.TALENT[TALENT_ID.愛欲] = 1;
    st.TALENT[TALENT_ID.思慕] = 0;
    return;
  }
  if ((bits & FALL_STATE_SEX_FRIEND) !== 0) {
    if (talent(st, TALENT_ID.思慕) !== 0 && talent(st, TALENT_ID.炮友) !== 2) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}似乎开始觉得就算这样沉溺在与主人的快乐之中也没有什么不好的了…`,
      });
      const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.LOVER]);
      emitKojoLines(lines, slot.charaNum, events, deps);
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}成为了[情人]`,
      });
      st.TALENT[TALENT_ID.炮友] = 2;
    } else if (talent(st, TALENT_ID.思慕) !== 0 && talent(st, TALENT_ID.炮友) === 1) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}好像渴望着与主人产生超越单纯的肉体关系之上的羁绊的样子…`,
      });
      const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.LOVER]);
      emitKojoLines(lines, slot.charaNum, events, deps);
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}成为了[情人]`,
      });
      st.TALENT[TALENT_ID.炮友] = 2;
    } else if (talent(st, TALENT_ID.炮友) === 0) {
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}沉溺在主人给予的快感之中…`,
      });
      const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.FUCK_BUDDY]);
      emitKojoLines(lines, slot.charaNum, events, deps);
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        text: `${name}成为了[炮友]`,
      });
      st.TALENT[TALENT_ID.炮友] = 1;
    }
    return;
  }
  if ((bits & FALL_STATE_DEEP_LOVE) !== 0) {
    events.push({
      kind: "NARRATION",
      timestamp: deps.now(),
      text: `共度了如此多时光之后，${name}的感情变得更加强烈……`,
    });
    const lines = fallKojo(deps, slot.charaNum, [FALL_KOJO_ID.DEEP_LOVE]);
    emitKojoLines(lines, slot.charaNum, events, deps);
    events.push({
      kind: "NARRATION",
      timestamp: deps.now(),
      text: `${name}的[恋慕]变成了[爱恋]！`,
    });
    st.TALENT[TALENT_ID.恋慕] = 2;
    return;
  }
}

function emitKojoLines(
  lines: ReadonlyArray<{ text: string; form?: string }>,
  charaNum: number,
  events: ObservationEvent[],
  deps: RunFallDeps,
): void {
  if (!deps.router) return;
  for (const line of lines) {
    events.push({
      kind: "DIALOGUE_LINE" as const,
      timestamp: deps.now(),
      charaNum,
      text: line.text,
      form: line.form,
    });
  }
}

// `Rng` is non-optional here: upstream `@ADD_CHECK_FALL_STATES` always
// calls `KOJO_CHECK` (rng-driven), and our `resolveEventKojo` reaches
// into the personal-kojo cache by rng-seed. `createRng(0)` is the
// runtime's canonical fallback for "no rng supplied".
void 0;

export interface RunFallDeps {
  now: () => number;
  rng: Rng;
  router?: DialogueRouter;
  state: GameState;
}

function eventKojo(deps: RunFallDeps, charaNum: number, arm: number, args: number[]) {
  return deps.router
    ? resolveEventKojoAndApply(deps.router, deps.state, charaNum, arm, deps.rng, args)
    : [];
}

function fallKojo(deps: RunFallDeps, charaNum: number, args: number[]) {
  return eventKojo(deps, charaNum, 21, args);
}

export function runFallStates(deps: RunFallDeps): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const state = deps.state;
  const charaNums = Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b);
  const targets: Array<{ slot: CharaSlot; isMaster: boolean }> = [
    { slot: state.master, isMaster: true },
    ...charaNums
      .map((num) => state.charas[num])
      .filter((slot): slot is CharaSlot => slot !== undefined)
      .map((slot) => ({ slot, isMaster: false })),
  ];
  for (const { slot, isMaster } of targets) {
    if (!slot) continue;
    // Stamp every NARRATION this target produces with its charaNum so the
    // night screen groups fall-state events into the character's block
    // (DIALOGUE_LINE lines are already tagged by `emitKojoLines`).
    const eventsBefore = events.length;
    // 1) One-shot talents (接吻魔/自慰狂/子宮口性感/漏尿癖 + 音楽知識/音感
    //    + 反発抑制/合意誤認 reset). Upstream runs these BEFORE the
    //    master-skip block (i.e. master IS eligible for these).
    const oneShots = evaluateOneShotTalent(slot.state, isMaster, deps.state);
    for (const ev of oneShots) {
      const name = slot.callName ?? `角色${slot.charaNum}`;
      if (ev.kind === "tal") {
        const lines = eventKojo(deps, slot.charaNum, ev.kojoArm, [ev.kojoSubId]);
        if (ev.talentId === TALENT_ID.接吻魔) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}找到了自己灵魂的归宿，一刻也离不开亲吻…`,
          });
        } else if (ev.talentId === TALENT_ID.自慰狂) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}懂得了如何发泄自己的欲望，一天里所有时间都在想自慰…`,
          });
        } else if (ev.talentId === TALENT_ID.子宮口性感) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}被反复进攻着子宫口，比起痛苦来能感觉到更加强烈的快感…`,
          });
        } else if (ev.talentId === TALENT_ID.漏尿癖) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}的身体变得非常松弛，以至于排尿已经变成了一种习惯…`,
          });
        }
        emitKojoLines(lines, slot.charaNum, events, deps);
        events.push({
          kind: "NARRATION",
          timestamp: deps.now(),
          text: `${name}获得了[${talentName(ev.talentId)}]`,
        });
        slot.state.TALENT[ev.talentId] = 1;
      } else if (ev.kind === "music") {
        const lines = eventKojo(
          deps,
          slot.charaNum,
          ev.kojoArm,
          [ev.kojoSubId, ev.musicId],
        );
        if (ev.musicId === SKILL_KOJO_ID.MUSIC_KNOWLEDGE) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}演奏乐器造诣精进了`,
          });
        } else {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}的音感得到了反复锻炼`,
          });
        }
        emitKojoLines(lines, slot.charaNum, events, deps);
        if (ev.musicId === SKILL_KOJO_ID.MUSIC_KNOWLEDGE) {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}获得了[音乐知识]`,
          });
          slot.state.TALENT[TALENT_ID.音楽知識] = 1;
        } else {
          events.push({
            kind: "NARRATION",
            timestamp: deps.now(),
            text: `${name}获得了[相对音感]`,
          });
          slot.state.TALENT[TALENT_ID.音感] = 1;
        }
      }
    }
    // 2) Fall-state acquisition — master SKIPPED (upstream :60-61).
    if (isMaster) continue;
    if (talent(slot.state, TALENT_ID.路人) === 0) {
      const bits = computeFallStates(slot.state);
      if (bits !== 0) {
        applyFallState(slot, isMaster, bits, events, deps);
      }
    }
    // 3) 心情不快 tick (`:187-193`): decrement; 反発刻印 rebounds.
    let mb = cflag(slot.state, CFLAG_ID.心情不快);
    if (mb) {
      mb -= 1;
      slot.state.CFLAG[CFLAG_ID.心情不快] = mb;
      if (!mb && mark(slot.state, MARK_ID.反発刻印) !== 0) {
        slot.state.CFLAG[CFLAG_ID.心情不快] = 1;
      }
    }
    for (let i = eventsBefore; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.kind === "NARRATION" && ev.charaNum === undefined) {
        ev.charaNum = slot.charaNum;
      }
    }
  }
  // 4) Ex-chara 恋慕 → 仲間追加 フラグ (`:194-198`).
  for (const num of charaNums) {
    const slot = state.charas[num];
    if (!slot) continue;
    if (cflag(slot.state, CFLAG_ID.神社在住) !== 0) continue;
    if (
      talent(slot.state, TALENT_ID.恋慕) !== 0 &&
      exp(slot.state, EXP_ID.愛情経験) >= 200
    ) {
      state.flagStore[FLAG_ID.SYS_EVENT起動FLAG] = 3;
    }
  }
  return events;
}

function talentName(id: number): string {
  const map: Record<number, string> = {
    [TALENT_ID.接吻魔]: "接吻魔",
    [TALENT_ID.自慰狂]: "自慰狂",
    [TALENT_ID.子宮口性感]: "子宫口性感",
    [TALENT_ID.漏尿癖]: "漏尿癖",
  };
  return map[id] ?? `T${id}`;
}
