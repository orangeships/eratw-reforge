import type { CharaSlot, GameState } from "../state/game-state.js";
import {
  ABL_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../state/settlement.js";
import { setTflag, TFLAG_ID } from "../state/tflag.js";

function cup(target: CharaSlot, id: number): number {
  return target.state.CUP[id] ?? 0;
}

export type TrainingMarkCupTotals = Readonly<Record<number, number>>;

const TRAINING_MARK_CUP_IDS = [
  PALAM_ID.苦痛,
  PALAM_ID.恭順,
  PALAM_ID.屈服,
  PALAM_ID.反感,
  PALAM_ID.不快,
] as const;

/** Accumulate pre-flush mark inputs for all SOURCE_CHECK passes in one command. */
export function accumulateTrainingMarkCups(
  state: GameState,
  target: CharaSlot,
): TrainingMarkCupTotals | undefined {
  const frame = state.turnContext?.frame;
  if (!frame) return undefined;
  const byChara = frame.trainingMarkCupsByChara ?? (frame.trainingMarkCupsByChara = {});
  const totals = byChara[target.charaNum] ?? (byChara[target.charaNum] = {});
  for (const id of TRAINING_MARK_CUP_IDS) {
    const current = cup(target, id);
    if (current !== 0) totals[id] = (totals[id] ?? 0) + current;
  }
  return totals;
}

function mark(target: CharaSlot, id: number): number {
  return target.state.MARK?.[id] ?? 0;
}

function setMark(target: CharaSlot, id: number, level: number): void {
  const marks = target.state.MARK ?? (target.state.MARK = {});
  marks[id] = level;
}

function talent(target: CharaSlot, id: number): number {
  return target.state.TALENT[id] ?? 0;
}

function addExperience(target: CharaSlot, id: number, amount: number): void {
  target.state.EXP[id] = (target.state.EXP[id] ?? 0) + amount;
}

/**
 * Active non-rebellion branches of `MARK_GOT_CHECK` (TRACHECK_刻印取得.ERB).
 * Called after ORGASM_ADD, while this command's CUP values are still live.
 */
export function applyTrainingMarkAcquisitionChecks(
  state: GameState,
  target: CharaSlot,
  cupTotals?: TrainingMarkCupTotals,
): void {
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0) return;

  const markCup = (id: number): number => cupTotals?.[id] ?? cup(target, id);
  const pain = markCup(PALAM_ID.苦痛);
  const painMark = mark(target, MARK_ID.苦痛刻印);
  const painLevel = pain >= 8000 ? 3 : pain >= 4000 ? 2 : pain >= 2000 ? 1 : 0;
  if (painLevel > painMark) {
    setMark(target, MARK_ID.苦痛刻印, painLevel);
    setTflag(state, TFLAG_ID.苦痛刻印取得, painLevel);

    if (painLevel >= 2 && talent(target, TALENT_ID.胆量) > 0) {
      const obedience = target.state.ABL[ABL_ID.従順] ?? 0;
      if (obedience === 0 && talent(target, TALENT_ID.感情缺乏) === 0) {
        target.state.ABL[ABL_ID.従順] = 1;
        setTflag(state, TFLAG_ID.刻印従順変化, 1);
      }
    }

    if (painLevel === 3) {
      const player = state.master;
      const abnormalExperience =
        talent(player, TALENT_ID.施虐狂) !== 0 ||
        (talent(player, TALENT_ID.擅長用針) !== 0 &&
          (state.turnContext?.frame?.commandNo ?? state.turnContext?.selectCom ?? 0) === 103)
          ? 2
          : 1;
      addExperience(target, EXP_ID.異常経験, abnormalExperience);
    }
  }

  const timeBrand = target.state.TCVAR[TCVAR_ID.時姦刻印取得用] ?? 0;
  if (timeBrand >= 1 && timeBrand <= 3 && timeBrand > mark(target, MARK_ID.時姦刻印)) {
    setMark(target, MARK_ID.時姦刻印, timeBrand);
    setTflag(state, TFLAG_ID.時姦刻印取得, timeBrand);
  }

  const pleasureBrand = target.state.TCVAR[TCVAR_ID.快楽強度] ?? 0;
  if (
    pleasureBrand >= 1 &&
    pleasureBrand <= 3 &&
    pleasureBrand > mark(target, MARK_ID.快楽刻印)
  ) {
    setMark(target, MARK_ID.快楽刻印, pleasureBrand);
    setTflag(state, TFLAG_ID.快楽刻印取得, pleasureBrand);

    if (
      pleasureBrand === 3 &&
      (target.state.ABL[ABL_ID.従順] ?? 0) === 0 &&
      talent(target, TALENT_ID.自制心) === 0 &&
      talent(target, TALENT_ID.感情缺乏) === 0
    ) {
      target.state.ABL[ABL_ID.従順] = 1;
      setTflag(state, TFLAG_ID.刻印従順変化, 1);
    }
  }

  const timeStopped = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const actedDuringTimeStop = (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 0;
  if (timeStopped && !actedDuringTimeStop) return;

  const unrulySource = markCup(PALAM_ID.恭順) + markCup(PALAM_ID.屈服);
  const unrulyMark = mark(target, MARK_ID.不埒刻印);
  const unrulyLevel = unrulySource >= 10000 ? 3 : unrulySource >= 7000 ? 2 : unrulySource >= 4500 ? 1 : 0;
  if (unrulyLevel <= unrulyMark) return;

  setMark(target, MARK_ID.不埒刻印, unrulyLevel);
  setTflag(state, TFLAG_ID.屈服刻印取得, 30 + unrulyLevel);

  const obedience = target.state.ABL[ABL_ID.従順] ?? 0;
  const emotionalLack = talent(target, TALENT_ID.感情缺乏) !== 0;
  if (unrulyLevel === 2 && obedience === 0 && !emotionalLack) {
    target.state.ABL[ABL_ID.従順] = 1;
    setTflag(state, TFLAG_ID.刻印従順変化, 1);
  } else if (unrulyLevel === 3 && obedience <= 1 && !emotionalLack) {
    target.state.ABL[ABL_ID.従順] = 2;
    setTflag(state, TFLAG_ID.刻印従順変化, 1);
  }
}
