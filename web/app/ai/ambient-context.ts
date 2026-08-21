import type { GameState } from "../../../modernization/runtime/state/index.js";
import { buildAgentL1Context } from "../../../modernization/runtime/agent/index.js";
import { checkHehai } from "../../../modernization/runtime/world/detection.js";
import type { AmbientInitiativeOpportunity } from "../../../modernization/runtime/world/ambient-initiative.js";
import { buildAiRelationshipLens } from "./relationship-lens.js";
import { compileAiCharacterSemanticContext } from "./context.js";
import { formatInteractionHistoryEntry, relevantInteractionHistory } from "./interaction-history.js";
import { useAiStore } from "./store.js";
import type { AiCompletionRequest, AiSettings } from "./types.js";

const ACTIVITY: Readonly<Record<number, string>> = {
  1: "空闲",
  2: "工作中",
  3: "睡眠中",
  4: "自由行动中",
};

export interface BuildSceneAmbientCompletionInput {
  requestId: string;
  sceneEpoch: number;
  state: Readonly<GameState>;
  opportunity: AmbientInitiativeOpportunity;
  settings: AiSettings;
  voiceSamples?: Readonly<Record<number, readonly string[]>>;
  visibleFacts?: readonly string[];
}

function timeText(state: Readonly<GameState>): string {
  const minute = ((state.time.tickValue % 60) + 60) % 60;
  const hour = ((state.time.hourOfDay % 24) + 24) % 24;
  return `第${state.time.dayIndex + 1}日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function modeInstruction(opportunity: AmbientInitiativeOpportunity): string {
  if (opportunity.mode === "character-dialogue") {
    return "当前模式是 character-dialogue；显示目标是对应角色立绘上方的主动对话气泡。只允许一个参与者，所有行都必须是 speech 台词；不得生成 action、NPC 互聊、事件旁观反应或主角回答。";
  }
  return "当前模式是 scene-interaction；显示目标是场景右侧互动框。只能写已固定的单角色动作、NPC 互聊或事件反应，不得把内容改写成立绘上方的面向主角对话。";
}

function kindInstruction(opportunity: AmbientInitiativeOpportunity): string {
  switch (opportunity.kind) {
    case "self-gesture":
      return "只写发起者一个不改变规则状态的当下微动作；所有行 form=action，不写台词。";
    case "address-player":
      return "由发起者自然向主角说一句或一个很小的交流节拍；所有行都是发起者的 speech，不得替主角回答。";
    case "question-player":
      return "由发起者问主角一个轻量、可不回答的问题；所有行都是发起者的 speech，最后一行必须以问号结束，不生成回答或选项。";
    case "npc-exchange":
      return "写两名在场 NPC 之间的一个很小的交流节拍；两人都必须至少出现一行，不得让主角参与说话。";
    case "event-echo":
      return "由发起者对刚刚公开可见的场景事实作一个很小的自然反应；不得重做结算或把旁白扩成新事件。";
  }
}

function toneInstruction(opportunity: AmbientInitiativeOpportunity): string[] {
  if (opportunity.kind !== "npc-exchange") return [];
  const tone = opportunity.exchangeTone === "mutual"
    ? "双方相性都高，可以自然亲近，但不要自动写成恋爱关系。"
    : opportunity.exchangeTone === "one-sided"
      ? "双方相性不对称：一方更主动或投入，另一方较克制；不要把这种差异写成规则关系变化。"
      : opportunity.exchangeTone === "strained"
        ? "双方相性都低，可以有轻微不对付或敷衍，但不升级成战斗、离场或关系变化。"
        : "双方相性处在中性边界，保持普通同室交流。";
  return [tone];
}

export function buildSceneAmbientCompletion(
  input: BuildSceneAmbientCompletionInput,
): AiCompletionRequest {
  const { state, opportunity } = input;
  const npcExchange = opportunity.kind === "npc-exchange";
  const participants = opportunity.participantIds.map((participantId) => {
    const slot = state.charas[participantId];
    const persona = compileAiCharacterSemanticContext(
      state,
      participantId,
      npcExchange ? "npc-public" : "player",
    );
    return [
      `角色 ID ${participantId}：${slot?.callName ?? `#${participantId}`}`,
      ...persona.lines,
      ...persona.referenceLines.map((line) => `稳定口上语气参考：${line}`),
      `公开活动：${slot ? ACTIVITY[checkHehai(slot, state as GameState)] ?? "未知" : "未知"}`,
      ...((input.voiceSamples?.[participantId] ?? []).slice(0, 3)
        .map((sample) => `作者口上语气参考：${sample}`)),
    ];
  });
  const history = relevantInteractionHistory(
    useAiStore.getState().interactionHistory,
    opportunity.participantIds,
    undefined,
    6,
  );
  const names = Object.values(state.charas)
    .filter((slot) => slot.charaNum > 0 && slot.location === state.master.location)
    .map((slot) => `${slot.callName ?? `#${slot.charaNum}`}(${slot.charaNum})`)
    .slice(0, 12);

  const system = [
    "你是 eraTW 的场景临时动态写作者。只生成可丢弃的表现文本，不是剧情导演或规则系统。",
    "直接输出严格 JSON，不显示思考、解释、Markdown 或代码块。",
    "每次机会只能遵守一种模式；模式和显示目标由确定性系统固定，不能同时生成两类内容。",
    "只写当前地点、当前参与者此刻可观察的 1-6 行台词或微动作。不得代写主角，不得添加玩家回答、按钮或选择。",
    "不得宣告或造成离场、物品转移、工作、约会、战斗、关系变化、承诺、时间推进、状态变化或后续事件。",
    "当前游戏事实与关系权威高于历史文本。历史只用于连续性和避免重复，不能成为新世界事实。",
    npcExchange
      ? "NPC 交流只使用公开场景、角色稳定声音和给出的双向相性语气；不得推测任何角色对主角的私有关系、记忆、欲望或成人信息。"
      : "面向主角时只写 NPC 一方；角色内心背景是低权重写作参考，不能成为对主角的自动坦白或承诺。",
  ].join("\n");

  const user = [
    "【机会已由确定性系统固定】",
    `请求：${input.requestId}`,
    `地点会话：${opportunity.location} / epoch ${input.sceneEpoch}`,
    `触发：${opportunity.trigger}`,
    `模式：${opportunity.mode}`,
    `显示目标：${opportunity.mode === "character-dialogue" ? "参与者对应的立绘上方主动对话区" : "场景右侧互动框"}`,
    `互动类型：${opportunity.kind}`,
    `参与者白名单：${opportunity.participantIds.join(", ")}`,
    modeInstruction(opportunity),
    kindInstruction(opportunity),
    ...toneInstruction(opportunity),
    "",
    "【公开场景】",
    `时间：${timeText(state)}`,
    `地点：${state.master.location}`,
    `同室角色：${names.join("、") || "无"}`,
    `最近公开事实：${input.visibleFacts?.join(" / ") || "无"}`,
    "",
    "【参与者声音】",
    ...participants.flatMap((lines, index) => [
      `-- 参与者 ${index + 1} --`,
      ...lines,
    ]),
    ...(!npcExchange
      ? [
          "",
          "【与主角的当前关系上限】",
          ...(buildAiRelationshipLens(state, opportunity.initiatorId)?.lines ?? ["无可用关系资料"]),
          ...(() => {
            const agent = buildAgentL1Context(state, opportunity.initiatorId);
            return agent.length > 0
              ? ["【角色内心背景（低权重）】", ...agent]
              : [];
          })(),
        ]
      : []),
    "",
    "【相关亲历历史】",
    ...(history.length > 0
      ? history.map((entry, index) => `${index + 1}. ${formatInteractionHistoryEntry(entry)}`)
      : ["没有双方都亲历或见证的可用历史。"]),
    "",
    "【输出】",
    "严格输出：{\"lines\":[{\"participantId\":角色数字ID,\"form\":\"speech\"或\"action\",\"text\":\"文本\"}]}。",
    "1-6 行；participantId 只能来自白名单。speech 是该角色台词，action 是可观察的轻量微动作。不要添加其他字段。",
  ].join("\n");

  return {
    system,
    user,
    temperature: input.settings.temperature,
    maxTokens: Math.max(128, input.settings.maxTokens),
    jsonMode: true,
  };
}
