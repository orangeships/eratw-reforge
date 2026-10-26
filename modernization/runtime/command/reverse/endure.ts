/**
 * Deterministic reverse-entry scoring from `ステータス計算関連/押し倒され.ERB`.
 *
 * This module is intentionally read-only.  `ENDURE` and `複数被逆推` are
 * decision inputs for the eventual reverse-entry event; they do not mutate
 * H-mode flags, start a training session, or emit a command by themselves.
 * That keeps the current runtime's command/session ownership intact while the
 * missing world entry point is still being migrated.
 */

import type { CharaSlot, GameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  FLAG_ID,
  MARK_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../state/settlement.js";
import { getTflag, TFLAG_ID } from "../../state/tflag.js";
import { isOtokoGirai, liftedConsentJudgement } from "../../state/attitude.js";
import { relationOf } from "../../world/relation.js";

export interface EndureOptions {
  /** The upstream SELECTCOM value active at the reverse-entry probe. */
  selectCom?: number;
  /** Optional DLC charm override. Omitted means the modern non-DLC path. */
  charmValid?: boolean;
  /** `MAGIC_CharmFactor(2)` when `charmValid` is true. */
  charmFactor?: number;
  /** Optional overrides for the upstream heat/consumable escape hatches. */
  heat?: boolean;
  incense?: boolean;
}

export interface MultipleReverseOptions extends EndureOptions {
  /** A deterministic RAND value in `[0, 400 + 200 * targetCount)`. */
  randomRoll?: number;
}

export interface MultipleReverseResult {
  score: number;
  randomUpperBound: number;
  threshold: number;
  randomRoll?: number;
  eligible: boolean;
  success: boolean;
  reason?:
    | "not-multiple"
    | "missing-target"
    | "endure-low"
    | "random-roll-missing";
  perTarget: readonly number[];
}

function value(values: Readonly<Record<number, number>>, id: number): number {
  return values[id] ?? 0;
}

function present(values: Readonly<Record<number, number>>, id: number): boolean {
  return value(values, id) !== 0;
}

function hasBit(values: Readonly<Record<number, number>>, id: number, bit: number): boolean {
  return (value(values, id) & (1 << bit)) !== 0;
}

function consentJudgement(
  state: Readonly<GameState>,
  target: CharaSlot,
): number {
  // INFO/CHARA_ATTITUDE is not a separate modern scheduler tick yet.  The
  // relationship authority is its on-demand equivalent at the gate boundary.
  return liftedConsentJudgement(target, state.master, state);
}

function isHeat(state: Readonly<GameState>, target: CharaSlot): boolean {
  return (
    value(target.state.TCVAR, TCVAR_ID.催情薬) !== 0 ||
    value(target.state.TCVAR, TCVAR_ID.発情) !== 0
  );
}

function isIncenseValid(
  state: Readonly<GameState>,
  target: CharaSlot,
): boolean {
  if (target.charaNum === state.master.charaNum) return false;
  if (target.location !== state.master.location) return false;
  if (getTflag(state, TFLAG_ID.仙香玉兎) <= 0) return false;
  if (present(target.state.TALENT, TALENT_ID.人形)) return false;
  if (present(target.state.TALENT, TALENT_ID.薬毒耐性)) return false;
  return true;
}

function isShirahu(state: Readonly<GameState>, target: CharaSlot): boolean {
  const cflag = target.state.CFLAG;
  if (
    value(state.flagStore, FLAG_ID.時間停止) !== 0 &&
    value(cflag, CFLAG_ID.時間停止行動) === 0
  ) {
    return false;
  }
  return (
    !present(cflag, CFLAG_ID.睡眠) &&
    !present(cflag, CFLAG_ID.陪睡中) &&
    !present(target.state.TCVAR, TCVAR_ID.泥酔) &&
    !present(cflag, CFLAG_ID.衰弱)
  );
}

function applyEndureModifiers(
  state: Readonly<GameState>,
  target: CharaSlot,
  score: number,
  options: EndureOptions,
): number {
  let local = score;
  const cflag = target.state.CFLAG;
  const talent = target.state.TALENT;
  const base = target.state.BASE;

  if (
    isOtokoGirai(target, state.master) &&
    !(options.heat ?? isHeat(state, target)) &&
    !(options.incense ?? isIncenseValid(state, target))
  ) {
    local = Math.trunc(local / 2);
  }

  if (value(talent, TALENT_ID.一線越えない) !== 0 && value(talent, TALENT_ID.恋慕) !== 0) {
    local = Math.trunc((local * 12) / 5);
  }

  if (value(target.state.MARK, MARK_ID.反発刻印) === 3) local = 0;
  const kissMarkTarget = getTflag(state, TFLAG_ID.接吻マーク);
  if (kissMarkTarget !== 0 && kissMarkTarget !== target.charaNum) local = 0;
  if (!isShirahu(state, target)) local = 0;
  if (value(cflag, CFLAG_ID.行動) === 5) local = 0;
  if (present(cflag, CFLAG_ID.延迟)) local = 0;
  if (present(cflag, CFLAG_ID.陪睡中)) local = 0;

  const pentUp = value(cflag, CFLAG_ID.溜まってる度);
  if (pentUp >= 1000) local *= 3;
  else if (pentUp >= 800) local = Math.trunc((local * 3) / 2);
  else if (pentUp >= 600) local = Math.trunc((local * 5) / 4);
  else if (pentUp >= 500) {
    // Upstream has an intentionally empty >=500 arm.
  } else if (pentUp >= 300) local = Math.trunc(local / 2);
  else if (pentUp >= 200) local = Math.trunc(local / 4);
  else if (pentUp >= 100) local = Math.trunc(local / 10);
  else local = 0;

  const stamina = value(base, BASE_ID.体力);
  if (stamina < 750) local = 0;
  else if (stamina < 1000) local = Math.trunc(local / 2);
  else if (stamina < 1500) local = Math.trunc((local * 3) / 4);

  const energy = value(base, BASE_ID.気力);
  if (energy === 0) local = 0;
  else if (energy < 500) local = Math.trunc(local / 2);

  const reason = value(base, BASE_ID.理性);
  if (reason > 800) local = Math.trunc(local / 5);
  else if (reason > 600) local = Math.trunc(local / 2);

  const emotion = value(base, BASE_ID.情緒);
  if (emotion < 200) local = 0;
  else if (emotion >= 201 && emotion <= 400) local = Math.trunc(local / 4);
  else if (emotion >= 401 && emotion <= 600) local = Math.trunc(local / 2);
  else if (emotion > 800) local = Math.trunc((local * 6) / 5);

  if (value(state.flagStore, FLAG_ID.甲斐性無) !== 0) local *= 2;
  if (options.charmValid === true) {
    local = Math.trunc(local * (1 + (options.charmFactor ?? 0) / 3));
  }
  if (present(cflag, CFLAG_ID.勃然大怒)) local = 0;
  if (present(cflag, CFLAG_ID.推倒禁止)) local = 0;
  if (getTflag(state, TFLAG_ID.パール期限) !== 0) local = 0;
  return local;
}

/** Faithful read-only port of upstream `@ENDURE(ARG)`. */
export function computeEndureScore(
  state: Readonly<GameState>,
  targetId: number,
  options: EndureOptions = {},
): number {
  const target = state.charas[targetId];
  if (!target) return 0;

  const cflag = target.state.CFLAG;
  const talent = target.state.TALENT;
  let local = consentJudgement(state, target);
  local +=
    (value(target.state.EX, EX_ID.Ｃ寸止め) +
      value(target.state.EX, EX_ID.Ｖ寸止め) +
      value(target.state.EX, EX_ID.Ａ寸止め) +
      value(target.state.EX, EX_ID.Ｂ寸止め) +
      value(target.state.EX, EX_ID.Ｍ寸止め)) * 20;

  const selectCom = options.selectCom ?? state.turnContext?.selectCom ?? 0;
  if (selectCom === 311) {
    local += 30;
    if (value(state.flagStore, FLAG_ID.甲斐性無) !== 0) local += 100;
  }

  local += value(talent, TALENT_ID.性的兴趣) * 20;
  if (present(talent, TALENT_ID.処女)) local -= 50;
  if (present(talent, TALENT_ID.恋慕)) local += 50;
  if (value(talent, TALENT_ID.自尊心) > 0) local -= 20;
  if (value(cflag, CFLAG_ID.允许无套) === 2) local += 50;
  if (present(cflag, CFLAG_ID.强行内射)) local -= 100;
  if (
    value(talent, TALENT_ID.胆量) < 0 ||
    value(talent, TALENT_ID.応答) < 0 ||
    present(talent, TALENT_ID.冷漠)
  ) {
    local -= 30;
  }
  if (value(talent, TALENT_ID.羞耻心) > 0) local -= 30;
  if (value(talent, TALENT_ID.羞耻心) < 0) local += 20;
  if (present(talent, TALENT_ID.自制心)) local -= 20;
  if (
    value(talent, TALENT_ID.貞操) < 0 ||
    present(talent, TALENT_ID.小悪魔)
  ) {
    local += 20;
  }
  if (
    value(talent, TALENT_ID.貞操) > 0 ||
    present(talent, TALENT_ID.一線越えない)
  ) {
    local -= 20;
  }
  if (!hasBit(cflag, CFLAG_ID.既成事實, 1) && value(talent, TALENT_ID.貞操) > 0) {
    local -= 30;
    if (!present(talent, TALENT_ID.恋慕) && !present(talent, TALENT_ID.炮友)) {
      local -= 50;
    }
  }

  return applyEndureModifiers(state, target, local, options);
}

/** Faithful read-only port of upstream `@被逆推判定(ARG)`. */
export function computeReverseJudgement(
  state: Readonly<GameState>,
  targetId: number,
): number {
  const target = state.charas[targetId];
  if (!target) return 0;

  let local =
    value(target.state.ABL, ABL_ID.战斗能力) -
    value(state.master.state.ABL, ABL_ID.战斗能力);
  local +=
    value(target.state.TALENT, TALENT_ID.体型) -
    value(state.master.state.TALENT, TALENT_ID.体型);

  // The four cached personality CFLAGs used by the upstream file are not
  // authoritative modern fields yet.  Keep their terms deferred; the
  // canonical personality-clique correction below is modeled directly.
  const personality = value(target.state.CFLAG, CFLAG_ID.性格傾向);
  if (personality === 1 || personality === 3) local += 1;
  else if (personality === 2 || personality === 4) local -= 1;

  const pentUp = value(target.state.CFLAG, CFLAG_ID.溜まってる度);
  if (pentUp < 600) return 0;
  if (pentUp < 800) local += 1;
  else if (pentUp < 1000) local += 2;
  else local += 3;

  if (value(state.flagStore, FLAG_ID.催眠強度) > 50) local -= 1;
  return local;
}

/** Faithful read-only port of upstream `@複数被逆推()`. */
export function computeMultipleReverseScore(
  state: Readonly<GameState>,
  targetIds: readonly number[],
  options: EndureOptions = {},
): MultipleReverseResult {
  const randomUpperBound = 400 + 200 * targetIds.length;
  const threshold = 450;
  if (targetIds.length <= 1) {
    return {
      score: 0,
      randomUpperBound,
      threshold,
      eligible: false,
      success: false,
      reason: "not-multiple",
      perTarget: [],
    };
  }

  const perTarget: number[] = [];
  let total = 0;
  for (const targetId of targetIds) {
    const target = state.charas[targetId];
    if (!target) {
      return {
        score: 0,
        randomUpperBound,
        threshold,
        eligible: false,
        success: false,
        reason: "missing-target",
        perTarget,
      };
    }
    if (value(target.state.CFLAG, CFLAG_ID.同室) !== 1) {
      perTarget.push(0);
      continue;
    }

    const endure = computeEndureScore(state, targetId, options);
    if (endure < 450) {
      return {
        score: 0,
        randomUpperBound,
        threshold,
        eligible: false,
        success: false,
        reason: "endure-low",
        perTarget,
      };
    }

    let adjusted = endure;
    const yuriAttribute = value(target.state.ABL, ABL_ID.百合属性);
    if (yuriAttribute === 0) adjusted = 0;
    else if (yuriAttribute === 1) adjusted = Math.trunc(adjusted * 0.5);
    else if (yuriAttribute === 2) adjusted = Math.trunc(adjusted * 0.8);
    else if (yuriAttribute >= 3) {
      adjusted = Math.trunc(
        (adjusted * (100 + 10 * (yuriAttribute - 3))) / 100,
      );
    }
    adjusted = Math.trunc(
      (adjusted * (100 + 10 * value(target.state.ABL, ABL_ID.百合中毒))) / 100,
    );

    let compatibility = 0;
    for (const otherId of targetIds) {
      if (otherId === targetId) continue;
      const other = state.charas[otherId];
      if (!other || value(other.state.CFLAG, CFLAG_ID.同室) !== 1) continue;
      const relation = relationOf(targetId, otherId);
      compatibility += relation === 0 ? 100 : relation;
    }
    compatibility = Math.trunc(compatibility / (targetIds.length - 1));
    adjusted = Math.trunc((adjusted * compatibility) / 100);
    perTarget.push(adjusted);
    total += adjusted;
  }

  const score = Math.trunc(total / targetIds.length);
  return {
    score,
    randomUpperBound,
    threshold,
    eligible: true,
    success: false,
    perTarget,
  };
}

/** Apply the upstream `RAND:(400 + 200 * NUM_TARGET) + 450` test. */
export function canMultipleReverse(
  state: Readonly<GameState>,
  targetIds: readonly number[],
  options: MultipleReverseOptions = {},
): MultipleReverseResult {
  const result = computeMultipleReverseScore(state, targetIds, options);
  if (!result.eligible) return result;
  if (options.randomRoll === undefined) {
    return { ...result, reason: "random-roll-missing" };
  }
  return {
    ...result,
    randomRoll: options.randomRoll,
    success: options.randomRoll + result.threshold <= result.score,
  };
}
