/**
 * A6 — Agent-to-L1 context bridge.
 *
 * Builds a compact, read-only context block for the L1 AI dialogue prompt.
 * Agent memories, goals, and plans are labeled as low-weight background
 * reference — the L1 model must never override real-time game facts or
 * relationship authority with agent-generated content.
 */

import type { GameState } from "../state/game-state.js";
import type { AgentCognitiveState } from "./types.js";

/** Maximum agent context lines returned. */
const MAX_LINES = 8;

/**
 * Build the agent context block for L1 dialogue generation.
 *
 * Returns an array of human-readable lines to insert into the L1 prompt
 * between the relationship lens and authored voice reference.  Returns
 * an empty array when:
 * - The agent runtime is disabled or missing,
 * - The target has no cognitive state.
 */
export function getCharacterCognition(
  state: Readonly<GameState>,
  target: number,
): Readonly<AgentCognitiveState> | undefined {
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return undefined;
  return runtime.cognitions[target];
}

export function buildAgentL1Context(
  state: Readonly<GameState>,
  target: number,
): string[] {
  const cog = getCharacterCognition(state, target);
  if (!cog) return [];

  const lines: string[] = [];

  const mind = cog.mind;
  if (mind?.relationshipToPlayer) {
    lines.push(`当前关系理解（主观）：${mind.relationshipToPlayer.slice(0, 120)}`);
  }
  if (mind?.currentTendency) {
    lines.push(`当前倾向（主观）：${mind.currentTendency.slice(0, 120)}`);
  }

  // 1. L2 active goals (top 3), with the legacy goal array as a save-compat
  // fallback until an older save has passed through migration.
  const activeGoals = (mind?.goals ?? cog.goals.map((goal) => ({
    id: goal.id,
    topic: "relationship" as const,
    text: goal.text,
    createdTick: goal.createdTick,
    updatedTick: goal.createdTick,
    evidenceIds: [],
    status: goal.status === "active" ? "active" as const : "resolved" as const,
  })))
    .filter((g) => g.status === "active")
    .slice(0, 3);
  if (activeGoals.length > 0) {
    lines.push(
      `当前目标：${activeGoals.map((g) => g.text).join("；")}`,
    );
  }

  // 2. Bounded beliefs and unresolved social threads.
  if (mind?.beliefs.length) {
    lines.push(`当前信念：${mind.beliefs.filter((item) => item.status !== "resolved").slice(0, 2).map((item) => item.text).join("；")}`);
  }
  if (mind?.threads.length) {
    lines.push(`未决社交事项：${mind.threads.filter((item) => item.status === "open").slice(0, 2).map((item) => `${item.kind}:${item.text}`).join("；")}`);
  }

  // Same-day player work memory keeps consecutive L1 turns coherent. It is
  // still explicitly provisional until a successful Night merge.
  if (cog.pendingEpisodes?.length) {
    const excerpts = cog.pendingEpisodes.slice(-2).map((episode) =>
      episode.lines.map((line) => `${line.speaker === "player" ? "玩家" : "角色"}：${line.text}`).join(" / ")
    ).filter(Boolean);
    if (excerpts.length > 0) lines.push(`待归并玩家对话：${excerpts.join(" || ").slice(0, 240)}`);
  }

  // 3. Today's plan selections
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

  // 4. Top memories by importance (top 3 from last 16)
  const recentMemories = [...cog.memories]
    .slice(-16)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);
  if (recentMemories.length > 0) {
    lines.push(
      `最近记忆：${recentMemories.map((m) => m.text.slice(0, 80)).join("；")}`,
    );
  }

  // 5. Latest reflection. Structured V2 parts stay explicitly subjective;
  // deterministic current state and the relationship lens remain earlier.
  const latestReflection = cog.reflections.slice(-1)[0];
  if (latestReflection) {
    if (latestReflection.parts) {
      lines.push(`主观态度：${latestReflection.parts.attitudeToPlayer.slice(0, 100)}`);
      if (latestReflection.parts.interestingEvent) {
        lines.push(`经核查的主观记忆：${latestReflection.parts.interestingEvent.slice(0, 100)}`);
      }
      lines.push(`主观倾向：${latestReflection.parts.nextTendency.slice(0, 100)}`);
    } else {
      lines.push(`心情：${latestReflection.text.slice(0, 100)}`);
    }
  }

  // Cap total lines
  return lines.slice(0, MAX_LINES);
}
