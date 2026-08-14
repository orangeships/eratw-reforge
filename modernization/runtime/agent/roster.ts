import type { GameState } from "../state/game-state.js";
import type { AgentRuntimeState } from "./types.js";
import {
  applyDecay,
  CHALLENGE_THRESHOLD,
  effectiveScore,
} from "./engagement.js";

/** Maximum number of replacements (in + out) per night. */
export const MAX_REPLACEMENTS_PER_NIGHT = 2;

interface ScoredEntry {
  charaNum: number;
  score: number;
  isIncumbent: boolean;
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
 * Select the active top-N roster.
 *
 * Algorithm (deterministic, no LLM):
 * 1. Decay all candidate engagements to `nowTick`.
 * 2. Compute effective scores (incumbents get +10 %).
 * 3. Force-include pinned charas; skip excluded charas.
 * 4. Fill remaining slots from top scorers (descending).
 * 5. Apply challenge threshold: a challenger must exceed the
 *    lowest-scoring non-pinned incumbent by at least 15 %.
 * 6. Cap replacements at `MAX_REPLACEMENTS_PER_NIGHT`.
 * 7. Tiebreak equal scores by lower `charaNum`.
 *
 * Returns the new active roster (sorted by effective score descending).
 * MUTATES `runtime.engagements` in place (ensures entries exist).
 */
export function selectRoster(
  runtime: AgentRuntimeState,
  state: GameState,
  nowTick: number,
): number[] {
  const settings = runtime.settings;
  const previousRoster = new Set(runtime.activeRoster);
  const excludedSet = new Set(settings.excludedCharaNums);
  const pinnedSet = new Set(settings.pinnedCharaNums);

  // Collect candidate charaNums (all non-master NPCs in state.charas).
  const candidateNums = eligibleAgentCharaNums(state);

  // Ensure engagement objects exist and apply decay.
  const scored: ScoredEntry[] = [];
  for (const charaNum of candidateNums) {
    if (excludedSet.has(charaNum)) continue;
    let eng = runtime.engagements[charaNum];
    if (!eng) {
      eng = { score: 0, lastDecayTick: 0, signals: [] };
      runtime.engagements[charaNum] = eng;
    }
    applyDecay(eng, nowTick);
    const isIncumbent = previousRoster.has(charaNum);
    scored.push({
      charaNum,
      score: effectiveScore(eng, isIncumbent),
      isIncumbent,
    });
  }

  // Sort by score descending, tiebreak by lower charaNum.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.charaNum - b.charaNum;
  });

  const maxSlots = Math.max(1, Math.min(settings.maxActiveAgents, 10));

  // Build new roster: pinned chars first, then incumbents, then
  // challengers — so that challengers can only enter through the
  // challenge-threshold gate below, not by outranking an incumbent
  // in the raw fill step.
  const newRoster: number[] = [];
  const newRosterSet = new Set<number>();

  for (const pinned of settings.pinnedCharaNums) {
    if (
      candidateNums.includes(pinned) &&
      !excludedSet.has(pinned) &&
      newRoster.length < maxSlots
    ) {
      newRoster.push(pinned);
      newRosterSet.add(pinned);
    }
  }

  // Fill incumbents first (descending score).
  for (const entry of scored) {
    if (newRoster.length >= maxSlots) break;
    if (!entry.isIncumbent) continue;
    if (newRosterSet.has(entry.charaNum)) continue;
    newRoster.push(entry.charaNum);
    newRosterSet.add(entry.charaNum);
  }

  // Fill remaining slots with top-scoring challengers.
  for (const entry of scored) {
    if (newRoster.length >= maxSlots) break;
    if (newRosterSet.has(entry.charaNum)) continue;
    newRoster.push(entry.charaNum);
    newRosterSet.add(entry.charaNum);
  }

  // Apply challenge threshold + replacement cap.
  let replacements = 0;
  for (const entry of scored) {
    // Only consider challengers (non-incumbents) not already on roster.
    if (entry.isIncumbent || newRosterSet.has(entry.charaNum)) continue;
    if (replacements >= MAX_REPLACEMENTS_PER_NIGHT) break;

    // Find the lowest-scoring non-pinned incumbent currently on the roster.
    let lowestIdx = -1;
    let lowestScore = Infinity;
    for (let i = 0; i < newRoster.length; i++) {
      const rostered = newRoster[i];
      if (pinnedSet.has(rostered)) continue;
      if (!previousRoster.has(rostered)) continue;
      const rosteredEntry = scored.find((s) => s.charaNum === rostered);
      const rosteredScore = rosteredEntry?.score ?? 0;
      if (rosteredScore < lowestScore) {
        lowestScore = rosteredScore;
        lowestIdx = i;
      }
    }
    if (lowestIdx === -1) break;

    // Challenger must exceed incumbent by CHALLENGE_THRESHOLD.
    if (entry.score <= lowestScore * CHALLENGE_THRESHOLD) continue;

    // Replace.
    const replaced = newRoster[lowestIdx];
    newRoster[lowestIdx] = entry.charaNum;
    newRosterSet.delete(replaced);
    newRosterSet.add(entry.charaNum);
    replacements++;
  }

  return newRoster;
}

/**
 * Nightly roster selection entry point.  Only selects if the day has
 * advanced since the last selection (`nowDay > rosterSelectedDay`).
 *
 * Returns the new roster, or `null` if no selection was performed.
 */
export function selectRosterAtNight(
  runtime: AgentRuntimeState,
  state: GameState,
  nowTick: number,
  nowDay: number,
): number[] | null {
  if (nowDay <= runtime.rosterSelectedDay) return null;
  // Save current roster before overwriting — needed for dirty detection
  // in the orchestrator to identify characters that just entered the roster.
  runtime.previousRoster = [...runtime.activeRoster];
  const roster = selectRoster(runtime, state, nowTick);
  runtime.activeRoster = roster;
  runtime.rosterSelectedDay = nowDay;
  return roster;
}
