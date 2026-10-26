import type { GameState } from "../state/game-state.js";

export type AgentAttentionLevel = "Foreground" | "Warm" | "Cold";

/**
 * Pure, derived attention hint for S2. It is never persisted and never starts
 * work by itself. A recent interaction means one game day (1440 ticks).
 */
export function getAgentAttentionLevel(
  state: Readonly<GameState>,
  charaNum: number,
  currentInteractionCharaNum?: number,
): AgentAttentionLevel {
  if (currentInteractionCharaNum === charaNum) return "Foreground";
  const runtime = state.agentRuntime;
  if (!runtime) return "Cold";
  if (runtime.settings.pinnedCharaNums.includes(charaNum)) return "Warm";
  const cognition = runtime.cognitions[charaNum];
  if (cognition?.mind?.goals.some((goal) => goal.status !== "resolved")
    || cognition?.goals.some((goal) => goal.status === "active")) return "Warm";
  const latestSignalTick = runtime.engagements[charaNum]?.signals
    .reduce((latest, signal) => Math.max(latest, signal.tick), Number.NEGATIVE_INFINITY);
  const elapsed = latestSignalTick === undefined ? Number.POSITIVE_INFINITY : state.time.tickValue - latestSignalTick;
  return latestSignalTick !== undefined
    && Number.isFinite(latestSignalTick)
    && elapsed >= 0
    && elapsed <= 1440
    ? "Warm"
    : "Cold";
}
