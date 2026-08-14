import type { GameState } from "../state/game-state.js";
import type {
  AgentRuntimeState,
  AcceptedAgentDailyPlan,
  AcceptedAgentPlanSelection,
  AgentPlanCandidate,
  AgentPlanSelection,
} from "./types.js";
import { ensureCognitiveState } from "./init.js";
import { compileHardBlocks, hashPlanContext } from "./plan-compiler.js";

/**
 * Apply an accepted plan to the character's cognitive state.
 * Also registers the plan with the schedule provider for tomorrow's execution.
 */
export function applyAgentPlan(
  runtime: AgentRuntimeState,
  charaNum: number,
  selections: AgentPlanSelection[],
  candidates: readonly AgentPlanCandidate[],
  dayIndex: number,
  contextHash: string,
  nowTick: number,
): AcceptedAgentDailyPlan {
  const acceptedSelections: AcceptedAgentPlanSelection[] = selections.flatMap((selection) => {
    const candidate = candidates.find((entry) =>
      entry.id === selection.candidateId &&
      entry.windowStart === selection.windowStart &&
      entry.windowEnd === selection.windowEnd,
    );
    return candidate ? [{ ...selection, kind: candidate.kind, location: candidate.location }] : [];
  });
  const plan: AcceptedAgentDailyPlan = {
    dayIndex,
    selections: acceptedSelections,
    contextHash,
    acceptedAtTick: nowTick,
  };
  const cog = ensureCognitiveState(runtime, charaNum);
  cog.currentPlan = plan;
  return plan;
}

/**
 * Look up an accepted plan for a character at a given tick.
 * Returns the active selection for the current minute-of-day, or null.
 */
export function activePlanSelection(
  state: GameState,
  charaNum: number,
  tickMin: number,
): AcceptedAgentPlanSelection | null {
  const runtime = state.agentRuntime;
  if (!runtime?.settings.masterEnabled) return null;
  const cog = runtime.cognitions[charaNum];
  if (!cog?.currentPlan) return null;
  const plan = cog.currentPlan;
  // Plan is for the current day?
  if (plan.dayIndex !== state.time.dayIndex) return null;

  // A6-fix: validate context hash.  Re-compile the hard blocks for today
  // and compare the hash with the one stored at compile time.  If the
  // schedule has drifted (changed sleep times, work hours, or location),
  // the plan is stale — discard it.
  const blocks = compileHardBlocks(state, charaNum, state.time.dayIndex);
  const currentHash = hashPlanContext(blocks);
  if (currentHash !== plan.contextHash) {
    cog.currentPlan = undefined;
    return null;
  }

  // Find a selection covering this minute
  for (const sel of plan.selections) {
    if (tickMin >= sel.windowStart && tickMin < sel.windowEnd) {
      return sel;
    }
  }
  return null;
}
