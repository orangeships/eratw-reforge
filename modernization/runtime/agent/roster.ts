import type { GameState } from "../state/game-state.js";
import type { AgentRuntimeState } from "./types.js";
import { applyDecay, effectiveScore } from "./engagement.js";

export const MAX_ACTIVE_AGENTS = 20;
export const ROSTER_HEAD_RATIO = 0.8;
export const ROSTER_REPLACEMENT_RATIO = 0.3;

/** Maximum nightly churn for a full roster; additions into empty slots do not count. */
export function replacementLimitForRosterSize(size: number): number {
  return Math.floor(Math.max(0, size) * ROSTER_REPLACEMENT_RATIO);
}

/** Compatibility value for the default 10-slot roster. */
export const MAX_REPLACEMENTS_PER_NIGHT = replacementLimitForRosterSize(10);

interface ScoredEntry {
  charaNum: number;
  score: number;
}

export function eligibleAgentCharaNums(state: Readonly<GameState>): number[] {
  return Object.keys(state.charas)
    .map(Number)
    .filter((charaNum) => {
      if (charaNum <= 0) return false;
      const dynamic = state.dynamicCharacters?.[charaNum];
      if (!dynamic) return true;
      return dynamic.origin === "authored" && dynamic.lifecycle === "resident" && dynamic.active;
    })
    .sort((a, b) => a - b);
}

/**
 * Select the active roster deterministically: 80% from the engagement-ranked
 * head and 20% from a nightly shuffle of the remaining eligible characters.
 * Existing members receive the established incumbency bonus, and a full
 * roster changes by no more than 30% per night.
 */
export function selectRoster(
  runtime: AgentRuntimeState,
  state: GameState,
  nowTick: number,
): number[] {
  const settings = runtime.settings;
  const previousRoster = new Set(runtime.activeRoster);
  const excludedSet = new Set(settings.excludedCharaNums);
  const candidateNums = eligibleAgentCharaNums(state);

  const scored: ScoredEntry[] = [];
  for (const charaNum of candidateNums) {
    if (excludedSet.has(charaNum)) continue;
    let engagement = runtime.engagements[charaNum];
    if (!engagement) {
      engagement = { score: 0, lastDecayTick: 0, signals: [] };
      runtime.engagements[charaNum] = engagement;
    }
    applyDecay(engagement, nowTick);
    const isIncumbent = previousRoster.has(charaNum);
    scored.push({ charaNum, score: effectiveScore(engagement, isIncumbent) });
  }
  scored.sort((a, b) => b.score - a.score || a.charaNum - b.charaNum);

  const maxSlots = Math.max(1, Math.min(settings.maxActiveAgents, MAX_ACTIVE_AGENTS));
  if (scored.length <= maxSlots) return scored.map((entry) => entry.charaNum);

  const desired: number[] = [];
  const desiredSet = new Set<number>();
  for (const pinned of settings.pinnedCharaNums) {
    if (!desiredSet.has(pinned) && scored.some((entry) => entry.charaNum === pinned) && desired.length < maxSlots) {
      desired.push(pinned);
      desiredSet.add(pinned);
    }
  }

  const headSlots = Math.ceil(maxSlots * ROSTER_HEAD_RATIO);
  for (const entry of scored) {
    if (desired.length >= headSlots) break;
    if (desiredSet.has(entry.charaNum)) continue;
    desired.push(entry.charaNum);
    desiredSet.add(entry.charaNum);
  }

  // A date-derived shuffle is random across nights but deterministic in replay.
  const randomKey = (charaNum: number): number => {
    let value = (Math.trunc(nowTick / 1440) + 1) ^ Math.imul(charaNum, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return (value ^ (value >>> 16)) >>> 0;
  };
  const tail = scored
    .filter((entry) => !desiredSet.has(entry.charaNum))
    .sort((a, b) => randomKey(a.charaNum) - randomKey(b.charaNum) || a.charaNum - b.charaNum);
  for (const entry of tail) {
    if (desired.length >= maxSlots) break;
    desired.push(entry.charaNum);
    desiredSet.add(entry.charaNum);
  }

  const validPrevious = runtime.activeRoster
    .filter((charaNum) => scored.some((entry) => entry.charaNum === charaNum))
    .slice(0, maxSlots);
  if (validPrevious.length === 0) return desired;

  const previousSet = new Set(validPrevious);
  const outgoing = validPrevious.filter((charaNum) => !desiredSet.has(charaNum));
  const replacementLimit = replacementLimitForRosterSize(validPrevious.length);
  if (outgoing.length <= replacementLimit) return desired;

  const newcomers = desired.filter((charaNum) => !previousSet.has(charaNum));
  const emptySlots = Math.max(0, maxSlots - validPrevious.length);
  const allowedNewcomers = new Set(newcomers.slice(0, emptySlots + replacementLimit));
  const finalRoster = desired.filter((charaNum) => previousSet.has(charaNum) || allowedNewcomers.has(charaNum));
  for (const charaNum of outgoing) {
    if (finalRoster.length >= maxSlots) break;
    finalRoster.push(charaNum);
  }
  return finalRoster;
}

/** Select once when the day advances. */
export function selectRosterAtNight(
  runtime: AgentRuntimeState,
  state: GameState,
  nowTick: number,
  nowDay: number,
): number[] | null {
  if (nowDay <= runtime.rosterSelectedDay) return null;
  runtime.previousRoster = [...runtime.activeRoster];
  const roster = selectRoster(runtime, state, nowTick);
  runtime.activeRoster = roster;
  runtime.rosterSelectedDay = nowDay;
  return roster;
}
