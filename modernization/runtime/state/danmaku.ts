/**
 * COMF480 弾幕勝負 — non-DLC battle core.
 *
 * This ports the portable part of `DANMAKU_BATTLE`: lives, dice count/face,
 * per-turn showdown, automatic Bomb use when the player loses a clash, and
 * the post-battle COMF480 settlement (fatigue, EXP, first-win marker, and the
 * SOURCE:歓楽 quantum that the command handler feeds into SOURCE_CHECK).
 *
 * Deferred on purpose: Magic DLC arms, item picker/Gips equip, character
 * special abilities, and the full step-by-step prompt UI. V1 always takes the
 * original "一决胜负" branch and uses Bomb automatically when it would help.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  TCVAR_ID,
} from "./settlement.js";

export interface DanmakuRng {
  int(max: number): number;
}

export interface DanmakuBattleCore {
  won: boolean;
  opponentRemaining: number;
  masterRemaining: number;
  turns: number;
  log: string[];
}

export interface DanmakuBattleResult extends DanmakuBattleCore {
  firstWin: boolean;
  firstWinBonus: number;
  battleExp: number;
  strongEnemyBonus: boolean;
  sourcePleasure: number;
  favorBonus: number;
  trustSeed: number;
}

/** Apply the original COM480 post-battle state writes to a battle result.
 * The realtime battle feeds this exact settlement path; legacy callers still
 * obtain their core result from the dice implementation above. */
export function settleDanmakuBattleCore(
  state: GameState,
  targetCharaNum: number,
  battle: DanmakuBattleCore,
): DanmakuBattleResult {
  const target = state.charas[targetCharaNum];
  if (!target) throw new Error(`settleDanmakuBattleCore: unknown target ${targetCharaNum}`);
  const targetState = target.state;
  const targetBattle = abl(target, ABL_ID.战斗能力);
  const masterBattle = abl(state.master, ABL_ID.战斗能力);
  const firstWin = battle.won && (targetState.CFLAG[CFLAG_ID.弾幕勝負勝利] ?? 0) === 0;
  const firstWinBonus = firstWin ? firstWinBonusForBattleAbility(targetBattle) : 0;
  let battleExp = 5 - battle.opponentRemaining;
  const strongEnemyBonus = masterBattle <= targetBattle;
  if (strongEnemyBonus) battleExp *= 2;
  targetState.TCVAR[TCVAR_ID.弾幕勝負結果] = battle.won ? 1 : -1;
  targetState.TCVAR[TCVAR_ID.弾幕勝負不能] = 1;
  addBase(state.master, BASE_ID.体力, -500);
  addBase(state.master, BASE_ID.気力, -500);
  addBase(target, BASE_ID.体力, -500);
  addBase(target, BASE_ID.気力, -500);
  if (firstWin) targetState.CFLAG[CFLAG_ID.弾幕勝負勝利] = 1;
  state.master.state.EXP[EXP_ID.戦闘経験] = (state.master.state.EXP[EXP_ID.戦闘経験] ?? 0) + firstWinBonus + battleExp;
  const sourcePleasure = Math.trunc((3000 + (abl(target, ABL_ID.親密) ?? 0) * 100) / (battle.opponentRemaining + 1));
  return { ...battle, firstWin, firstWinBonus, battleExp, strongEnemyBonus, sourcePleasure, favorBonus: firstWin ? Math.trunc(400 / (battle.opponentRemaining + 1)) : 0, trustSeed: firstWin ? 3 - battle.opponentRemaining : 0 };
}

function truncDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

function positiveInt(rng: DanmakuRng, max: number): number {
  return max > 0 ? rng.int(max) : 0;
}

function abl(slot: CharaSlot, id: number): number {
  return slot.state.ABL[id] ?? 0;
}

function addBase(slot: CharaSlot, id: number, delta: number): void {
  slot.state.BASE[id] = (slot.state.BASE[id] ?? 0) + delta;
}

function diceValue(count: number, face: number, modifier: number, rng: DanmakuRng): number {
  const safeCount = Math.max(1, Math.trunc(count));
  const safeFace = Math.max(1, Math.trunc(face));
  let total = modifier;
  for (let i = 0; i < safeCount; i += 1) {
    total += positiveInt(rng, safeFace) + 1;
  }
  return total;
}

function useBomb(masterBattle: number, rng: DanmakuRng): number {
  return (
    masterBattle *
      (7 + positiveInt(rng, 5)) *
      (truncDiv(masterBattle, 2) + 1) +
    positiveInt(rng, 7)
  );
}

export function firstWinBonusForBattleAbility(battleAbility: number): number {
  if (battleAbility <= 0) return 1;
  if (battleAbility === 1) return 3;
  if (battleAbility === 2) return 5;
  if (battleAbility === 3) return 10;
  if (battleAbility === 4) return 20;
  if (battleAbility === 5) return 30;
  return 50;
}

export function runDanmakuBattle(
  master: CharaSlot,
  opponent: CharaSlot,
  rng: DanmakuRng,
): DanmakuBattleCore {
  const masterBattle = abl(master, ABL_ID.战斗能力);
  const opponentBattle = abl(opponent, ABL_ID.战斗能力);
  let masterLives = 3;
  let opponentLives = 3;
  let bombs = 2;
  let hp = Math.max(
    1,
    master.state.MAXBASE[BASE_ID.体力] ?? 0,
    master.state.BASE[BASE_ID.体力] ?? 0,
  );
  const maxHp = hp;
  const log: string[] = [];

  let turns = 0;
  while (masterLives > 0 && opponentLives > 0 && turns < 200) {
    turns += 1;

    let masterCount =
      (masterBattle + positiveInt(rng, 5)) * 2 +
      truncDiv(masterBattle + positiveInt(rng, 3), 2);
    let opponentCount =
      (opponentBattle + positiveInt(rng, 4) + 1) * 2 +
      truncDiv(opponentBattle, 2) * positiveInt(rng, 3);
    if (opponentLives === 2) opponentCount += 2 + truncDiv(opponentBattle, 2);
    if (opponentLives === 1) opponentCount += 4 + opponentBattle;

    let masterFace =
      (masterBattle + 1) * (6 + positiveInt(rng, 8)) +
      truncDiv(positiveInt(rng, 15) * masterBattle, 2);
    let opponentFace =
      (opponentBattle + 1) * (9 + positiveInt(rng, 7)) +
      positiveInt(rng, 10) -
      (opponentLives - 1) * opponentBattle;

    let masterModifier = 0;
    let opponentModifier = 0;
    const gap = Math.abs(masterBattle - opponentBattle) + 3;
    if (masterBattle > opponentBattle) {
      masterModifier =
        gap * (-(positiveInt(rng, 5)) - 8) * truncDiv(masterBattle, 2);
      opponentModifier =
        gap * (positiveInt(rng, 5) + 8) * truncDiv(opponentBattle, 2);
    } else if (opponentBattle > masterBattle) {
      masterModifier =
        gap * (positiveInt(rng, 5) + 8) * truncDiv(masterBattle, 2);
      opponentModifier =
        gap * (-(positiveInt(rng, 5)) - 8) * truncDiv(opponentBattle, 2);
    }

    masterCount = Math.max(1, masterCount);
    opponentCount = Math.max(1, opponentCount);
    masterFace = Math.max(1, masterFace);
    opponentFace = Math.max(1, opponentFace);

    const masterValue = diceValue(masterCount, masterFace, masterModifier, rng);
    const opponentValue = diceValue(opponentCount, opponentFace, opponentModifier, rng);
    let diff = opponentValue - masterValue;

    if (diff < 0) {
      opponentLives -= 1;
      log.push(`turn ${turns}: opponent life -1`);
      continue;
    }
    if (diff === 0) {
      log.push(`turn ${turns}: draw`);
      continue;
    }

    if (bombs > 0) {
      bombs -= 1;
      const bombPower = useBomb(masterBattle, rng);
      if (bombPower >= diff) {
        diff = 0;
        log.push(`turn ${turns}: bomb`);
      } else {
        diff -= bombPower;
      }
    }
    if (diff > 0) {
      masterLives -= 1;
      hp = maxHp;
      bombs = 2;
      log.push(`turn ${turns}: master life -1`);
    }
  }

  if (turns >= 200 && masterLives > 0 && opponentLives > 0) {
    // Avoid pathological endless ties in a deterministic test RNG. The full
    // original loop waits for player input; V1 resolves a deadlock by lives.
    opponentLives = masterLives > opponentLives ? 0 : opponentLives;
    masterLives = masterLives <= opponentLives ? 0 : masterLives;
    log.push("turn cap reached");
  }

  return {
    won: opponentLives <= 0 && masterLives > 0,
    opponentRemaining: Math.max(0, opponentLives),
    masterRemaining: Math.max(0, masterLives),
    turns,
    log,
  };
}

export function settleDanmakuBattle(
  state: GameState,
  targetCharaNum: number,
  rng: DanmakuRng,
): DanmakuBattleResult {
  const target = state.charas[targetCharaNum];
  if (!target) throw new Error(`settleDanmakuBattle: unknown target ${targetCharaNum}`);

  const battle = runDanmakuBattle(state.master, target, rng);
  return settleDanmakuBattleCore(state, targetCharaNum, battle);
}
