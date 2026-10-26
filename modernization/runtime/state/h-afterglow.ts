/** Shared H afterglow rules used by settlement, world time, and status UI. */

import type { CharaSlot, GameState } from "./game-state.js";
import { BASE_ID, CFLAG_ID, TCVAR_ID } from "./settlement.js";

const AFTERGLOW_BUFFER_MINUTES = 10;
const AFTERGLOW_REMAINDER_BASE = 12;
const AFTERGLOW_CHANNEL_COUNT = 5;

export function afterglowLevel(value: number): number {
  if (value < 15) return 0;
  if (value < 100) return 1;
  if (value < 200) return 2;
  if (value < 300) return 3;
  if (value < 400) return 4;
  return 5;
}

/** A player-facing stage label; the saved numeric value remains internal. */
export function afterglowStageLabel(value: number): string | undefined {
  if (value <= 0) return undefined;
  switch (afterglowLevel(value)) {
    case 0: return "余韵渐息";
    case 1: return "淡淡余韵";
    case 2: return "余韵尚存";
    case 3: return "余韵明显";
    case 4: return "余韵强烈";
    default: return "余韵未消";
  }
}

export function afterglowSoftCap(amount: number, currentScalar: number): number {
  const threshold = [200, 120, 80, 50, 30, 15][afterglowLevel(currentScalar)]!;
  if (amount <= threshold) return amount;
  return threshold + Math.trunc((amount - threshold) * 0.2);
}

export function rebuildAfterglowScalar(target: CharaSlot): void {
  const channels = [
    target.state.BASE[BASE_ID.Ｃ絶頂余韻] ?? 0,
    target.state.BASE[BASE_ID.Ｖ絶頂余韻] ?? 0,
    target.state.BASE[BASE_ID.Ａ絶頂余韻] ?? 0,
    target.state.BASE[BASE_ID.Ｂ絶頂余韻] ?? 0,
    target.state.BASE[BASE_ID.Ｍ絶頂余韻] ?? 0,
  ];
  const highest = Math.max(...channels);
  const rest = channels.reduce((sum, current) => sum + current, 0) - highest;
  target.state.BASE[BASE_ID.絶頂余韻] = Math.min(800, highest + Math.trunc(rest / 6));
}

function afterglowChannelValue(target: CharaSlot, index: number): number {
  switch (index) {
    case 0: return target.state.BASE[BASE_ID.Ｃ絶頂余韻] ?? 0;
    case 1: return target.state.BASE[BASE_ID.Ｖ絶頂余韻] ?? 0;
    case 2: return target.state.BASE[BASE_ID.Ａ絶頂余韻] ?? 0;
    case 3: return target.state.BASE[BASE_ID.Ｂ絶頂余韻] ?? 0;
    default: return target.state.BASE[BASE_ID.Ｍ絶頂余韻] ?? 0;
  }
}

function setAfterglowChannelValue(target: CharaSlot, index: number, value: number): void {
  switch (index) {
    case 0: target.state.BASE[BASE_ID.Ｃ絶頂余韻] = value; break;
    case 1: target.state.BASE[BASE_ID.Ｖ絶頂余韻] = value; break;
    case 2: target.state.BASE[BASE_ID.Ａ絶頂余韻] = value; break;
    case 3: target.state.BASE[BASE_ID.Ｂ絶頂余韻] = value; break;
    default: target.state.BASE[BASE_ID.Ｍ絶頂余韻] = value; break;
  }
}

function decodeRemainders(packed: number): number[] {
  let remaining = Math.max(0, Math.trunc(packed));
  const remainders: number[] = [];
  for (let index = 0; index < AFTERGLOW_CHANNEL_COUNT; index++) {
    remainders.push(remaining % AFTERGLOW_REMAINDER_BASE);
    remaining = Math.trunc(remaining / AFTERGLOW_REMAINDER_BASE);
  }
  return remainders;
}

function encodeRemainders(remainders: readonly number[]): number {
  let packed = 0;
  let place = 1;
  for (let index = 0; index < AFTERGLOW_CHANNEL_COUNT; index++) {
    packed += (remainders[index] ?? 0) * place;
    place *= AFTERGLOW_REMAINDER_BASE;
  }
  return packed;
}

/**
 * Decay every character's H afterglow for actual forward world time. A newly
 * raised afterglow is protected for ten minutes; if an advance crosses the
 * end of that window, only the portion beyond the buffer decays.
 */
export function decayHAfterglowForWorldTime(
  state: GameState,
  startTick: number,
  endTick: number,
): void {
  const elapsed = Math.max(0, Math.trunc(endTick - startTick));
  if (elapsed === 0) return;

  const slots = [state.master, ...Object.values(state.charas)];
  for (const target of slots) {
    const buffer = target.state.TCVAR[TCVAR_ID.絶頂余韻_BUFFER] ?? 0;
    let decayStart = startTick;
    if (buffer !== 0) {
      const bufferEnd = buffer + AFTERGLOW_BUFFER_MINUTES;
      if (endTick <= bufferEnd) continue;
      decayStart = Math.max(startTick, bufferEnd);
      target.state.TCVAR[TCVAR_ID.絶頂余韻_BUFFER] = 0;
    }

    const decayMinutes = Math.max(0, Math.trunc(endTick - decayStart));
    if (decayMinutes <= 0) continue;
    const remainders = decodeRemainders(
      target.state.TCVAR[TCVAR_ID.絶頂余韻_DECAY_REMAINDER] ?? 0,
    );
    const rateScale = (target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 ? 7 : 10;
    for (let minute = 0; minute < decayMinutes; minute++) {
      let anyAfterglow = false;
      for (let index = 0; index < AFTERGLOW_CHANNEL_COUNT; index++) {
        const current = afterglowChannelValue(target, index);
        if (current <= 0) {
          remainders[index] = 0;
          continue;
        }
        anyAfterglow = true;
        const level = Math.max(afterglowLevel(current), 1);
        const accumulated = remainders[index]! + rateScale * (7 - level);
        const decrease = Math.trunc(accumulated / AFTERGLOW_REMAINDER_BASE);
        remainders[index] = accumulated % AFTERGLOW_REMAINDER_BASE;
        const next = Math.max(0, current - decrease);
        setAfterglowChannelValue(target, index, next);
        if (next === 0) remainders[index] = 0;
      }
      if (!anyAfterglow) break;
    }
    target.state.TCVAR[TCVAR_ID.絶頂余韻_DECAY_REMAINDER] = encodeRemainders(remainders);
    rebuildAfterglowScalar(target);
  }
}

/** Preserve an active ten-minute buffer across ERA's non-elapsed TIME edits. */
export function shiftHAfterglowBuffers(state: GameState, deltaMinutes: number): void {
  if (deltaMinutes === 0) return;
  for (const target of [state.master, ...Object.values(state.charas)]) {
    const buffer = target.state.TCVAR[TCVAR_ID.絶頂余韻_BUFFER] ?? 0;
    if (buffer !== 0) target.state.TCVAR[TCVAR_ID.絶頂余韻_BUFFER] = buffer + deltaMinutes;
  }
}
