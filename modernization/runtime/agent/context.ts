/**
 * A6 — Agent-to-L1 context bridge.
 *
 * Builds a compact, read-only context block for the L1 AI dialogue prompt.
 * Agent memories, goals, and plans are labeled as low-weight background
 * reference — the L1 model must never override real-time game facts or
 * relationship authority with agent-generated content.
 */

import type { GameState } from "../state/game-state.js";

/** Maximum agent context lines returned. */
const MAX_LINES = 8;

/**
 * Build the agent context block for L1 dialogue generation.
 *
 * Returns an array of human-readable lines to insert into the L1 prompt
 * between the relationship lens and authored voice reference.  Returns
 * an empty array when:
 * - The agent runtime is disabled or missing,
 * - The target character is not on the active roster, or
 * - The target has no cognitive state.
 */
export function buildAgentL1Context(
  state: GameState,
  target: number,
): string[] {
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return [];
  if (!runtime.activeRoster.includes(target)) return [];

  const cog = runtime.cognitions[target];
  if (!cog) return [];

  const lines: string[] = [];

  // 1. Active goals (top 3)
  const activeGoals = cog.goals
    .filter((g) => g.status === "active")
    .slice(0, 3);
  if (activeGoals.length > 0) {
    lines.push(
      `当前目标：${activeGoals.map((g) => g.text).join("；")}`,
    );
  }

  // 2. Today's plan selections
  const plan = cog.currentPlan;
  if (plan && plan.selections.length > 0) {
    const planLabels = plan.selections.slice(0, 4).map((sel) => {
      const startH = Math.floor(sel.windowStart / 60);
      const startM = sel.windowStart % 60;
      const endH = Math.floor(sel.windowEnd / 60);
      const endM = sel.windowEnd % 60;
      const time = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}-${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      return `${time} ${sel.candidateId}`;
    });
    lines.push(`今日计划：${planLabels.join("，")}`);
  }

  // 3. Top memories by importance (top 3 from last 16)
  const recentMemories = [...cog.memories]
    .slice(-16)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);
  if (recentMemories.length > 0) {
    lines.push(
      `最近记忆：${recentMemories.map((m) => m.text.slice(0, 80)).join("；")}`,
    );
  }

  // 4. Latest reflection (mood summary, truncated)
  const latestReflection = cog.reflections.slice(-1)[0];
  if (latestReflection) {
    const moodText = latestReflection.text.slice(0, 100);
    lines.push(`心情：${moodText}`);
  }

  // Cap total lines
  return lines.slice(0, MAX_LINES);
}
