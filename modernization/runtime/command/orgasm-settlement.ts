/**
 * Shared ORGASM_ADD settlement window.
 *
 * `SOURCE_CHECK` owns this call site in the upstream game: every character
 * sees the same five pleasure channels before CUP/CDOWN is flushed.  Keeping
 * the implementation here prevents individual H command handlers from
 * silently growing a V/A-only variant of the rule.
 *
 * This slice ports the stateful part of TRACHECK_ORGASM.ERB: channel
 * threshold/strength, edging accumulation, multi-channel markers, NOWEX/EX/
 * EXP, frustration reduction, afterglow accumulation, and the orgasm SOURCE
 * additions.  The caller applies the returned SOURCE additions through the
 * ordinary converters before the CUP flush.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import {
  afterglowLevel,
  afterglowSoftCap,
  rebuildAfterglowScalar,
} from "../state/h-afterglow.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  palamLv,
} from "../state/settlement.js";
import { readTequip, readTequipOptional } from "../state/tequip.js";
import { hPositionExperienceId } from "../state/h-position-experience.js";

interface OrgasmChannel {
  readonly pleasure: number;
  readonly orgasmEx: number;
  readonly edgingEx: number;
  readonly orgasmExp: number;
  readonly unawareEx: number;
  readonly unawareExp: number;
  readonly afterglow: number;
  readonly source: Partial<Record<number, number>>;
}

const CHANNELS: readonly OrgasmChannel[] = [
  {
    pleasure: PALAM_ID.快Ｃ,
    orgasmEx: EX_ID.Ｃ絶頂,
    edgingEx: EX_ID.Ｃ寸止め,
    orgasmExp: EXP_ID.Ｃ絶頂経験,
    unawareEx: EX_ID.無自覚Ｃ絶頂,
    unawareExp: EXP_ID.無自覚Ｃ経験,
    afterglow: BASE_ID.Ｃ絶頂余韻,
    source: { [SOURCE_ID.露出]: 500, [SOURCE_ID.屈従]: 200 },
  },
  {
    pleasure: PALAM_ID.快Ｖ,
    orgasmEx: EX_ID.Ｖ絶頂,
    edgingEx: EX_ID.Ｖ寸止め,
    orgasmExp: EXP_ID.Ｖ絶頂経験,
    unawareEx: EX_ID.無自覚Ｖ絶頂,
    unawareExp: EXP_ID.無自覚Ｖ経験,
    afterglow: BASE_ID.Ｖ絶頂余韻,
    source: {
      [SOURCE_ID.恭順]: 500,
      [SOURCE_ID.露出]: 700,
      [SOURCE_ID.屈従]: 400,
      [SOURCE_ID.欲情]: 800,
    },
  },
  {
    pleasure: PALAM_ID.快Ａ,
    orgasmEx: EX_ID.Ａ絶頂,
    edgingEx: EX_ID.Ａ寸止め,
    orgasmExp: EXP_ID.Ａ絶頂経験,
    unawareEx: EX_ID.無自覚Ａ絶頂,
    unawareExp: EXP_ID.無自覚Ａ経験,
    afterglow: BASE_ID.Ａ絶頂余韻,
    source: {
      [SOURCE_ID.恭順]: 700,
      [SOURCE_ID.露出]: 900,
      [SOURCE_ID.屈従]: 500,
      [SOURCE_ID.欲情]: 500,
    },
  },
  {
    pleasure: PALAM_ID.快Ｂ,
    orgasmEx: EX_ID.Ｂ絶頂,
    edgingEx: EX_ID.Ｂ寸止め,
    orgasmExp: EXP_ID.Ｂ絶頂経験,
    unawareEx: EX_ID.無自覚Ｂ絶頂,
    unawareExp: EXP_ID.無自覚Ｂ経験,
    afterglow: BASE_ID.Ｂ絶頂余韻,
    source: { [SOURCE_ID.露出]: 500, [SOURCE_ID.屈従]: 200 },
  },
  {
    pleasure: PALAM_ID.快Ｍ,
    orgasmEx: EX_ID.Ｍ絶頂,
    edgingEx: EX_ID.Ｍ寸止め,
    orgasmExp: EXP_ID.Ｍ絶頂経験,
    unawareEx: EX_ID.無自覚Ｍ絶頂,
    unawareExp: EXP_ID.無自覚Ｍ経験,
    afterglow: BASE_ID.Ｍ絶頂余韻,
    source: { [SOURCE_ID.情愛]: 1500, [SOURCE_ID.恭順]: 1000 },
  },
];

function add(record: Record<number, number>, id: number, amount: number): void {
  if (amount === 0) return;
  record[id] = (record[id] ?? 0) + amount;
}

function value(
  slot: CharaSlot,
  namespace: "ABL" | "BASE" | "CFLAG" | "CUP" | "EX" | "PALAM" | "TCVAR" | "TALENT",
  id: number,
): number {
  return slot.state[namespace][id] ?? 0;
}

function recordNowEx(state: GameState, charaNum: number, id: number, amount: number): void {
  const frame = state.turnContext?.frame;
  if (!frame || amount === 0) return;
  frame.nowExByChara[charaNum] ??= {};
  frame.nowExByChara[charaNum][id] = (frame.nowExByChara[charaNum][id] ?? 0) + amount;
}

function hasCurrentOrgasm(state: GameState, charaNum: number): boolean {
  const now = state.turnContext?.frame?.nowExByChara[charaNum];
  if (!now) return false;
  return CHANNELS.some((channel) => (now[channel.orgasmEx] ?? 0) > 0)
    || (now[EX_ID.射精] ?? 0) > 0;
}

function correctionForHitCount(count: number): number {
  switch (count) {
    case 1: return 1000;
    case 2: return 1500;
    case 3: return 2000;
    case 4: return 3000;
    case 5: return 5000;
    default: return 0;
  }
}

function addGeneratedSource(
  generated: Record<number, number>,
  id: number,
  amount: number,
): void {
  add(generated, id, amount);
}

/** The upstream @挑逗発生 gate. */
function shouldEdge(
  target: CharaSlot,
  participant: CharaSlot,
  unscaledTotal: number,
): boolean {
  if (value(participant, "TCVAR", TCVAR_ID.要去了) !== 0) return false;
  const count = value(target, "TCVAR", TCVAR_ID.挑逗回数);
  const edging = CHANNELS.reduce(
    (sum, channel) => sum + value(target, "EX", channel.edgingEx),
    0,
  );
  return unscaledTotal + edging < (5 - count) * 2;
}

function addAfterglow(
  state: GameState,
  target: CharaSlot,
  strengths: readonly number[],
): void {
  const oldLevel = afterglowLevel(value(target, "BASE", BASE_ID.絶頂余韻));
  const currentScalar = value(target, "BASE", BASE_ID.絶頂余韻);
  for (const [index, strength] of strengths.entries()) {
    if (strength <= 0) continue;
    const channel = CHANNELS[index]!;
    const current = value(target, "BASE", channel.afterglow);
    const increment = afterglowSoftCap(strength * strength * 25, currentScalar);
    target.state.BASE[channel.afterglow] = Math.min(600, current + increment);
  }

  rebuildAfterglowScalar(target);
  if (afterglowLevel(value(target, "BASE", BASE_ID.絶頂余韻)) > oldLevel) {
    target.state.TCVAR[TCVAR_ID.絶頂余韻_BUFFER] = state.time.tickValue;
  }
}

function addOrgasmMarks(
  target: CharaSlot,
  timeStopped: boolean,
  total: number,
): void {
  if (total <= 0 || target.charaNum === 0) return;
  const mob = value(target, "TALENT", TALENT_ID.路人) === 1;
  const markId = timeStopped ? MARK_ID.時姦刻印 : MARK_ID.快楽刻印;
  const currentMark = target.state.MARK?.[markId] ?? 0;
  let level = 0;

  if (mob) {
    if (total >= 4 && (timeStopped ? currentMark < 3 : currentMark <= 3)) level = 3;
    else if (total >= 2 && currentMark < 2) level = 2;
    else if (total >= 1 && currentMark < 1) level = 1;
  } else if (timeStopped) {
    if (total >= 16 && currentMark < 3) level = 3;
    else if (total >= 8 && currentMark < 2) level = 2;
    else if (total >= 1 && currentMark < 1) level = 1;
  } else if (total >= 24 && currentMark <= 3) {
    level = 3;
  } else if (total >= 12 && currentMark < 2) {
    level = 2;
  } else if (total >= 2 && currentMark < 1) {
    level = 1;
  }

  if (timeStopped) target.state.TCVAR[TCVAR_ID.時姦刻印取得用] = level;
  else target.state.TCVAR[TCVAR_ID.快楽強度] = level;
}

function addPositionExperience(target: CharaSlot, strengths: readonly number[]): void {
  const pose = readTequip(target, TEQUIP_ID.体位);
  if (strengths[1]! > 0 && readTequipOptional(target, TEQUIP_ID.Ｖ性交) !== undefined) {
    const expId = hPositionExperienceId(pose, "v");
    if (expId !== undefined) add(target.state.EXP, expId, 1);
  }
  if (strengths[2]! > 0 && readTequipOptional(target, TEQUIP_ID.Ａ性交) !== undefined) {
    const expId = hPositionExperienceId(pose, "a");
    if (expId !== undefined) add(target.state.EXP, expId, 1);
  }
}

export interface OrgasmSettlementResult {
  readonly generatedSource: Readonly<Record<number, number>>;
  readonly strengths: readonly number[];
  readonly edged: boolean;
}

/** Apply one upstream ORGASM_ADD pass to `target` before CUP/CDOWN flush. */
export function applyOrgasmAdd(
  state: GameState,
  target: CharaSlot,
  participant: CharaSlot,
  scaledSource: Record<number, number>,
): OrgasmSettlementResult {
  const threshold = palamLv(4);
  const rawCups = CHANNELS.map((channel) => value(target, "CUP", channel.pleasure));
  const rawPalam = CHANNELS.map((channel) => value(target, "PALAM", channel.pleasure));
  const hitCount = CHANNELS.filter(
    (_, index) => rawCups[index]! + rawPalam[index]! >= threshold,
  ).length;
  const correction = correctionForHitCount(hitCount);
  if (correction === 0) {
    return { generatedSource: {}, strengths: [0, 0, 0, 0, 0], edged: false };
  }

  const strengths = CHANNELS.map((channel, index) => {
    const total = rawCups[index]! + rawPalam[index]!;
    if (total < threshold) return 0;
    const local = rawCups[index]! > 0 ? correction : 0;
    let strength = Math.min(3, Math.trunc((total + local) / threshold));
    if (strength <= 0) return 0;

    let down = threshold * strength - local;
    if (total - down >= threshold) down = total - threshold + 1;
    target.state.CDOWN[channel.pleasure] = Math.max(
      target.state.CDOWN[channel.pleasure] ?? 0,
      down,
    );

    let frustrationFactor = Math.max(60 - value(target, "ABL", ABL_ID.欲望) * 2, 30);
    if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) frustrationFactor = Math.trunc(frustrationFactor / 2);
    if (value(target, "TCVAR", TCVAR_ID.発情) !== 0) frustrationFactor = Math.trunc(frustrationFactor / 2);
    target.state.CFLAG[CFLAG_ID.溜まってる度] = Math.max(
      0,
      value(target, "CFLAG", CFLAG_ID.溜まってる度) - strength * frustrationFactor,
    );

    // The source uses LOCAL:1 at this point; keep it as a named value so the
    // later edging/multi-orgasm operations cannot accidentally change the
    // frustration and threshold calculations.
    return strength;
  });

  const unscaledTotal = strengths.reduce((sum, strength) => sum + strength, 0);
  if (unscaledTotal <= 0) {
    return { generatedSource: {}, strengths, edged: false };
  }

  const teasing = readTequip(target, TEQUIP_ID.挑逗モード) !== 0;
  if (teasing && shouldEdge(target, participant, unscaledTotal)) {
    for (const [index, strength] of strengths.entries()) {
      if (strength > 0) add(target.state.EX, CHANNELS[index]!.edgingEx, strength);
    }
    target.state.TCVAR[TCVAR_ID.挑逗回数] = value(target, "TCVAR", TCVAR_ID.挑逗回数) + 1;
    return { generatedSource: {}, strengths, edged: true };
  }

  for (const [index, channel] of CHANNELS.entries()) {
    if (rawCups[index]! > 0) {
      strengths[index] = strengths[index]! + value(target, "EX", channel.edgingEx);
      target.state.EX[channel.edgingEx] = 0;
    }
  }

  const multipleEc = Math.max(0, strengths.filter((strength) => strength > 0).length - 1);
  const multiplier = 2 ** multipleEc;
  const finalStrengths = strengths.map((strength) => strength * multiplier);
  const total = finalStrengths.reduce((sum, strength) => sum + strength, 0);
  if (total <= 0) {
    return { generatedSource: {}, strengths: finalStrengths, edged: false };
  }

  const generatedSource: Record<number, number> = {};
  const timeStopped = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const consciouslyActed = value(target, "CFLAG", CFLAG_ID.時間停止行動) !== 0;
  const suppressPhysicalReaction = timeStopped && !consciouslyActed;
  const synced = target.charaNum !== 0
    && hasCurrentOrgasm(state, participant.charaNum);
  const magicMark = (scaledSource[SOURCE_ID.魔力印记] ?? 0) !== 0;
  const playful = value(target, "CFLAG", CFLAG_ID.诶嘿嘿) !== 0;

  for (const [index, channel] of CHANNELS.entries()) {
    const strength = finalStrengths[index]!;
    if (strength <= 0) continue;
    add(target.state.EX, channel.orgasmEx, strength);
    add(target.state.EXP, channel.orgasmExp, strength);
    recordNowEx(state, target.charaNum, channel.orgasmEx, strength);
    for (const [sourceId, amount] of Object.entries(channel.source)) {
      const sourceAmount = (amount ?? 0) * strength;
      addGeneratedSource(generatedSource, Number(sourceId), sourceAmount);
    }

  }

  add(target.state.EXP, EXP_ID.絶頂経験, total);
  if (timeStopped) add(target.state.EX, EX_ID.時間停止TotalEX_TRACKER, total);
  recordNowEx(state, target.charaNum, EX_ID.TotalEX, total);

  if (multipleEc === 1) recordNowEx(state, target.charaNum, EX_ID.二重絶頂, 1);
  else if (multipleEc === 2) recordNowEx(state, target.charaNum, EX_ID.三重絶頂, 1);
  else if (multipleEc === 3) recordNowEx(state, target.charaNum, EX_ID.四重絶頂, 1);
  else if (multipleEc >= 4) recordNowEx(state, target.charaNum, EX_ID.五重絶頂, 1);

  const unaware = (timeStopped || value(target, "CFLAG", CFLAG_ID.睡眠) !== 0) && target.charaNum !== 0;
  if (unaware) {
    for (const [index, channel] of CHANNELS.entries()) {
      const strength = finalStrengths[index]!;
      add(target.state.EX, channel.unawareEx, strength);
      add(target.state.EXP, channel.unawareExp, strength);
    }
    add(target.state.EXP, EXP_ID.無自覚絶頂経験, total);
  }

  if (!suppressPhysicalReaction) {
    const drain = finalStrengths.reduce(
      (sum, strength, index) => sum + [20, 30, 40, 20, 10][index]! * strength,
      0,
    );
    const energyDrain = finalStrengths.reduce(
      (sum, strength, index) => sum + [10, 20, 20, 10, 5][index]! * strength,
      0,
    );
    const multipleRelief = multipleEc >= 4 ? [80, 70]
      : multipleEc === 3 ? [40, 30]
        : multipleEc === 2 ? [20, 10]
          : [0, 0];
    target.state.BASE[BASE_ID.体力] = Math.max(
      0,
      value(target, "BASE", BASE_ID.体力) - drain + multipleRelief[0]!,
    );
    target.state.BASE[BASE_ID.気力] = Math.max(
      0,
      value(target, "BASE", BASE_ID.気力) - energyDrain + multipleRelief[1]!,
    );
  }

  // ORGASM_ADD resets the edging mode after a real orgasm.  The accumulated
  // EX remains the historical record; only the current mode/count are reset.
  target.state.TCVAR[TCVAR_ID.挑逗回数] = 0;
  if (readTequip(target, TEQUIP_ID.挑逗モード) !== 0) target.state.TEQUIP[TEQUIP_ID.挑逗モード] = 0;

  addOrgasmMarks(target, timeStopped, total);
  addAfterglow(state, target, finalStrengths);
  addPositionExperience(target, finalStrengths);

  // Keep the five-channel SOURCE additions available to the normal favor /
  // trust path. This is intentionally the only gameplay output of this
  // module besides target-local orgasm state.
  if (suppressPhysicalReaction) {
    return { generatedSource: {}, strengths: finalStrengths, edged: false };
  }
  if (synced) {
    for (const sourceId of [SOURCE_ID.屈従, SOURCE_ID.恭順, SOURCE_ID.情愛]) {
      if (generatedSource[sourceId] !== undefined) {
        generatedSource[sourceId] = Math.trunc((generatedSource[sourceId]! * 120) / 100);
      }
    }
  }

  // The reaction arm is deliberately gated by 魔力印记 and is only present
  // for channels with an upstream reaction coefficient.
  if (!magicMark) {
    for (const [index, strength] of finalStrengths.entries()) {
      if (strength <= 0) continue;
      const reaction = [40, 80, 120, 50, 0][index]!;
      if (reaction > 0) addGeneratedSource(
        generatedSource,
        SOURCE_ID.反感,
        reaction * strength * (playful ? 1 : 3),
      );
    }
  }

  return { generatedSource, strengths: finalStrengths, edged: false };
}
