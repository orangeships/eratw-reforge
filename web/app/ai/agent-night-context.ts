import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { AcceptedExperience } from "../../../modernization/runtime/experience.js";
import type { AiCompletionRequest } from "./types.js";
import { compileAiCharacterSemanticContext } from "./context.js";
import type {
  AgentCommissionCandidate,
  AgentDailyCharacterRecord,
  AgentMindStateV1,
  AgentMemory,
  AgentPendingEpisode,
  AgentPlanCandidate,
  AgentReflection,
} from "../../../modernization/runtime/agent/types.js";

export interface AgentNightPromptInput {
  charaNum: number;
  dayIndex: number;
  contextHash: string;
  state: Readonly<GameState>;
  ledger: Readonly<AgentDailyCharacterRecord>;
  mind: Readonly<AgentMindStateV1>;
  pendingEpisodes: readonly AgentPendingEpisode[];
  visibleExperiences: readonly AcceptedExperience[];
  recentMemories: readonly AgentMemory[];
  recentReflections: readonly AgentReflection[];
  planCandidates: readonly AgentPlanCandidate[];
  commissionCandidates: readonly AgentCommissionCandidate[];
}

const SYSTEM_PROMPT = [
  "你是 eraTW 角色的三段式夜间反思器（Night V3）。",
  "Runtime 提供的每日事实账本和关系证据是客观边界；既有记忆/反思只是角色的主观理解。",
  "你只写：对主角的态度、今天有意思的事、接下来的倾向，以及有证据的主观 mind 增改。",
  "有意思的事可以在事实锚点内自由补充柔软情节，但不能创造游戏状态、物品、关系变化、奖励或结算。",
  "实际计划只能选择给定候选 ID。只输出严格 JSON。",
].join("\n");

function fmtTime(tick: number): string {
  const minute = ((tick % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function relationLine(record: Readonly<AgentDailyCharacterRecord>): string {
  const before = record.relationshipStart;
  const after = record.relationshipEnd ?? before;
  const changes = record.relationshipChanges.length > 0
    ? record.relationshipChanges.map((entry) => `${entry.field}:${String(entry.before)}→${String(entry.after)}`).join("；")
    : "无结构化变化";
  return [
    `日初/记录起点：好感${before.favor}，信赖${before.trust}，亲密${before.intimacy}，态度${before.attitude}，阶段${before.stage}`,
    `日终：好感${after.favor}，信赖${after.trust}，亲密${after.intimacy}，态度${after.attitude}，阶段${after.stage}`,
    `变化证据：${changes}`,
  ].join("\n");
}

import { attachStateContext } from "./state-context.js";
import { currentAiSettings } from "./store.js";

export function buildAgentNightCompletion(input: AgentNightPromptInput): AiCompletionRequest {
  const slot = input.state.charas[input.charaNum];
  const name = slot?.callName ?? `角色#${input.charaNum}`;
  const persona = compileAiCharacterSemanticContext(input.state, input.charaNum, "player");
  const sections: string[] = [
    `## 角色\n名称：${name}\n编号：${input.charaNum}`,
    `## 对主角的关系权威证据\n${relationLine(input.ledger)}`,
  ];

  sections.push(`## 确定性活动（${input.ledger.activities.length}）`);
  for (const entry of input.ledger.activities) {
    sections.push(`[${entry.id}] ${fmtTime(entry.startTick)}-${fmtTime(entry.endTick)} ${entry.location} ${entry.kind}：${entry.label}`);
  }
  sections.push(`## 实际到达地点（${input.ledger.visitedLocations.length}）`);
  for (const entry of input.ledger.visitedLocations) {
    sections.push(`[${entry.id}] ${fmtTime(entry.arrivedAtTick)}-${fmtTime(entry.leftAtTick ?? entry.arrivedAtTick)} ${entry.location}`);
  }
  sections.push(`## 正时长同场（${input.ledger.encounters.length}）`);
  for (const entry of input.ledger.encounters) {
    sections.push(`[${entry.id}] ${fmtTime(entry.startTick)}-${fmtTime(entry.endTick)} ${entry.location}；同场=${entry.participants.join(",") || "无"}`);
  }

  sections.splice(1, 0, `## 角色人设与口吻\n${persona.lines.join("\n")}`);
  if (input.visibleExperiences.length > 0) {
    sections.push("## 依可见性合同可知的 AcceptedExperience");
    for (const experience of input.visibleExperiences.slice(-8)) {
      sections.push(`[experience:${experience.id}] ${experience.payload.summary}`);
    }
  }
  sections.push("## 当前主观 mind（未必正确，只能在本次证据支持下增改）");
  sections.push(`关系理解：${input.mind.relationshipToPlayer || "（暂无）"}`);
  sections.push(`当前倾向：${input.mind.currentTendency || "（暂无）"}`);
  for (const belief of input.mind.beliefs.slice(-4)) {
    sections.push(`[belief:${belief.id}] ${belief.topic} ${belief.status ?? "active"}：${belief.text}`);
  }
  for (const goal of input.mind.goals.slice(-3)) {
    sections.push(`[goal:${goal.id}] ${goal.topic} ${goal.status ?? "active"}：${goal.text}`);
  }
  for (const thread of input.mind.threads.slice(-6)) {
    sections.push(`[thread:${thread.id}] ${thread.kind} ${thread.status}：${thread.text}`);
  }
  if (input.pendingEpisodes.length > 0) {
    sections.push("## 待归并的玩家参与对话（仅本角色可见）");
    for (const episode of input.pendingEpisodes.slice(-12)) {
      sections.push(`[episode:${episode.id}] 第${episode.dayIndex + 1}日的交谈${episode.incomplete ? "（旧存档仅存片段）" : ""}：${episode.lines.map((line) => `${line.speaker === "player" ? "玩家" : "角色"}：${line.text}`).join(" / ")}`);
      for (const choice of episode.choices) sections.push(`  选择「${choice.label}」→ ${choice.lines.join(" / ")}`);
    }
  }
  if (input.recentMemories.length > 0 || input.recentReflections.length > 0) {
    sections.push("## 既有主观认知（不是客观事实）");
    for (const memory of input.recentMemories.slice(-4)) sections.push(`记忆：${memory.text}`);
    for (const reflection of input.recentReflections.slice(-2)) sections.push(`反思：${reflection.text}`);
  }

  if (input.planCandidates.length > 0) {
    sections.push("## Runtime 提供的新一天闭合地点/拜访候选");
    for (const candidate of input.planCandidates) {
      sections.push(`[${candidate.id}] ${fmtTime(candidate.windowStart)}-${fmtTime(candidate.windowEnd)} ${candidate.label}`);
    }
  }
  if (input.commissionCandidates.length > 0) {
    sections.push("## Runtime 提供的委托候选");
    for (const candidate of input.commissionCandidates) {
      sections.push(`[${candidate.id}] ${candidate.name}：${candidate.description}`);
    }
  }

  sections.push(`## 输出合同
{
  "schemaVersion": 3,
  "charaNum": ${input.charaNum},
  "dayIndex": ${input.dayIndex},
  "contextHash": "${input.contextHash}",
  "attitudeToPlayer": {"text": "只依据关系证据和既有主观认知的第一人称态度"},
  "interestingEvent": {
    "text": "主观记得的柔软情节",
    "claim": {"startTick": 0, "endTick": 1, "location": "必须来自锚点", "participants": [], "anchorIds": ["ledger:..."]}
  },
  "nextTendency": {
    "text": "第一人称主观倾向",
    "planSelections": [{"candidateId": "stay", "windowStart": 480, "windowEnd": 600}],
    "commissionSelection": {"candidateId": "defer", "action": "defer"}
  },
  "mindUpdates": {
    "relationshipToPlayer": "可选，最多 300 字",
    "currentTendency": "可选，最多 300 字",
    "beliefs": [{"action": "add|update|resolve", "id": "仅 update/resolve 填已有 [belief:*]", "topic": "self|player|relationship", "text": "最多 180 字", "evidenceIds": ["本次账本/Experience/episode 中的 ID"]}],
    "goals": [{"action": "add|update|resolve", "id": "仅 update/resolve 填已有 [goal:*]", "topic": "self|player|relationship", "text": "最多 180 字", "evidenceIds": ["本次账本/Experience/episode 中的 ID"]}],
    "threads": [{"action": "add|update|resolve", "id": "仅 update/resolve 填已有 [thread:*]", "kind": "promise|conflict|secret|question", "text": "最多 300 字", "evidenceIds": ["本次账本/Experience/episode 中的 ID"]}]
  }
}

- 三段字段都必须存在；文本不得为空。
- 本次只做内部反思和认知更新，不生成日记正文；是否写日记由后续独立分类判断，平静一天也不必额外写一段独白。
- 没有正时长活动、地点或会面锚点时，interestingEvent 必须为 null。
- interestingEvent 不为 null 时，claim 必须声明绝对 tick 时间窗、地点、参与者和至少一个上方 ledger 锚点 ID。
- participants 不包含角色自己；0 代表主角。
- planSelections 只能逐字选择上方候选的 ID 与窗口；commissionSelection 只能选择上方委托或 defer。
- mindUpdates 的每项都必须带本次上下文中可见的 evidenceIds；无法引用的项目不要输出。
- 未提及的既有 belief、goal、thread 继续保留；只有带新证据的 resolve 才能关闭。
- 不得输出 memoryDrafts、reflection、diary、goalUpdates 或任何额外字段。`);

  return attachStateContext({
    system: SYSTEM_PROMPT,
    user: sections.join("\n\n"),
    temperature: 0.75,
    maxTokens: 1000,
    jsonMode: true,
  }, { state: input.state, route: "l2", observer: input.charaNum,
    cue: `${input.mind.currentTendency} ${input.ledger.activities.map(e => e.label).join(" ")}`,
    excludeFields: ["favor", "trust"],
  }, currentAiSettings().stateQueryEnabled === true);
}
