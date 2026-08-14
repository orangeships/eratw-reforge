import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { AiCompletionRequest } from "./types.js";
import type {
  AgentObservation,
  AgentMemory,
  AgentGoal,
  AgentPlanCandidate,
  AgentCommissionCandidate,
} from "../../../modernization/runtime/agent/types.js";

export interface AgentNightPromptInput {
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  state: Readonly<GameState>;
  observations: AgentObservation[];
  recentMemories: AgentMemory[];
  activeGoals: AgentGoal[];
  /** A3 — plan candidates for the newly started day's free windows. */
  planCandidates?: AgentPlanCandidate[];
  /** A5 — commission candidates for tomorrow morning. */
  commissionCandidates?: AgentCommissionCandidate[];
}

const SYSTEM_PROMPT = [
  "你是 eraTW 角色的内心独白与记忆整理器。",
  "你会收到一名角色今天经历的事实（观察），请用第一人称视角整理：",
  "",
  "1. 从今天的观察中选出最值得记住的（最多 4 条），写成主观记忆。每条记忆必须引用对应的观察 ID。",
  "2. 可选的反思：今天的心情、感悟或对未来的想法。",
  "3. 可选的目标更新：新建、完成或放弃一个目标。",
  "4. 可选的日记：今天的情绪轨迹，用角色的口吻写。",
  "",
  "规则：",
  "- 只基于提供的观察来写，不要凭空编造事件、物品、地点或状态变化。",
  "- 记忆是主观的——可以包含角色的感受和解读，但事实核心必须来自观察。",
  "- 日记不必复述所有事——截取今天的情绪弧线即可。",
  "- 如果今天没什么值得记的，可以少写或不写。",
  "- 只输出 JSON，不要思考过程、markdown 或解释。",
].join("\n");

/**
 * Build the night cognitive-cycle prompt for one character.
 */
export function buildAgentNightCompletion(
  input: AgentNightPromptInput,
): AiCompletionRequest {
  const { charaNum, dayIndex, contextHash, state, observations, recentMemories, activeGoals } = input;
  const slot = state.charas[charaNum];
  const name = slot?.callName ?? `角色#${charaNum}`;

  const sections: string[] = [];

  // 1. 角色画像
  sections.push(`## 角色\n名称：${name}\n编号：${charaNum}`);

  // 2. 今日的经历
  sections.push(`## 今日的经历（${observations.length} 条）`);
  if (observations.length > 0) {
    for (const obs of observations) {
      sections.push(`[${obs.id}] (${obs.kind}) ${obs.text}`);
    }
  } else {
    sections.push("（今天没有记录到特殊经历。）");
  }

  // 3. 最近的记忆
  if (recentMemories.length > 0) {
    sections.push(`## 最近的记忆（${recentMemories.length} 条）`);
    for (const mem of recentMemories.slice(-8)) {
      sections.push(`- [重要度:${mem.importance}] ${mem.text}`);
    }
  }

  // 4. 当前目标
  if (activeGoals.length > 0) {
    sections.push(`## 当前目标`);
    for (const goal of activeGoals.filter((g) => g.status === "active").slice(0, 4)) {
      sections.push(`- [active] ${goal.text}`);
    }
  }

  // 5. 明天的计划（可选）
  if (input.planCandidates && input.planCandidates.length > 0) {
    // Group candidates by window
    const windowMap = new Map<string, AgentPlanCandidate[]>();
    for (const c of input.planCandidates) {
      const key = `${c.windowStart}-${c.windowEnd}`;
      if (!windowMap.has(key)) windowMap.set(key, []);
      windowMap.get(key)!.push(c);
    }
    sections.push("## 新一天的自由时间");
    for (const [key, cands] of windowMap) {
      const [start, end] = key.split("-").map(Number);
      sections.push(`[${fmtTime(start)}-${fmtTime(end)}] 自由窗口：`);
      for (const c of cands) {
        sections.push(`  [${c.id}] ${c.label}`);
      }
    }
    sections.push("你可以为每个窗口选一个想去的地方（不选就走默认路线）。");
  }

  // 6. 可用的委托（可选，A5）
  if (input.commissionCandidates && input.commissionCandidates.length > 0) {
    sections.push("## 可用的委托");
    sections.push("你可以选择下次早晨是否向主人公提出委托：");
    for (const c of input.commissionCandidates) {
      sections.push(`  [${c.id}] ${c.name} — ${c.description}`);
    }
    sections.push("选择一项提出，或者跳过（defer）：");
    sections.push('{"commissionSelections": [{"candidateId": "commission:1:1", "action": "propose"}]}');
    sections.push('// 或 {"commissionSelections": [{"candidateId": "defer", "action": "defer"}]}');
  }

  // 7. 输出约束
  sections.push(`## 输出格式
严格 JSON，无其他内容：

{
  "schemaVersion": 1,
  "charaNum": ${charaNum},
  "dayIndex": ${dayIndex},
  "contextHash": "${contextHash}",
  "memoryDrafts": [
    {"observationId": "obs-...", "text": "我主观记得的内容", "importance": 7}
  ],
  "reflection": {"text": "今天心情..."},
  "goalUpdates": [
    {"text": "想和谁更亲近", "status": "active"}
  ],
  "diary": {"text": "亲爱的日记，今天...", "sourceObservationIds": ["obs-..."]},
  "planSelections": [
    {"candidateId": "room:神社:境内", "windowStart": 480, "windowEnd": 720}
  ],
  "commissionSelections": [
    {"candidateId": "commission:1:1", "action": "propose"}
  ]
}

- memoryDrafts: 0-4 条，每条必须引用 observations 中的有效 id
- reflection: 可选，1-500 字
- goalUpdates: 0-2 条，status 为 active/completed/abandoned
- diary: 可选，1-600 字
- planSelections: 可选，0-6 条，每条必须匹配上面候选中的 id/windowStart/windowEnd
- commissionSelections: 可选，0-1 条，action 为 propose（提出委托）或 defer（跳过）
- schemaVersion、charaNum、dayIndex、contextHash 必须原样返回
- diary.sourceObservationIds 必须引用上面提供的观察；没有可引用经历时不要写日记
- 所有认知字段都是可选的。如果今天没什么值得写的，只返回四个信封字段`);

  return {
    system: SYSTEM_PROMPT,
    user: sections.join("\n\n"),
    temperature: 0.75,
    maxTokens: 1024,
    jsonMode: true,
  };
}

function fmtTime(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
