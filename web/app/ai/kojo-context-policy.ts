import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { getCharacterCognition } from "../../../modernization/runtime/agent/context.js";
import { formatExperiencesForL1, selectRelevantExperiencesForL1 } from "../../../modernization/runtime/experience.js";
import type { L1SceneMode } from "../../../modernization/runtime/ai-state/h-scene-context.js";
import type { AiCharacterCard } from "./character-card.js";
import type { AiPromptSlotId } from "./prompt-catalog.js";
import type { AiInteractionHistoryEntry } from "./types.js";

export type L1InteractionKind = "open-conversation" | "player-response" | "settled-action" | "counter-initiative" | "event-invitation" | "time-stopped";

export function l1InteractionKind(input: {
  commandNo: number;
  playerSemantic?: string;
  hasAnswer: boolean;
  counter: boolean;
  timeStopped: boolean;
}): L1InteractionKind {
  if (input.timeStopped) return "time-stopped";
  if (input.counter) return "counter-initiative";
  if (input.commandNo === 19987) return "event-invitation";
  if (input.playerSemantic !== undefined || input.hasAnswer) return "player-response";
  return input.commandNo === 300 ? "open-conversation" : "settled-action";
}

/** 每个互动类型的任务说明是独立可编辑块。 */
export const KOJO_TASK_SLOT: Record<L1InteractionKind, AiPromptSlotId> = {
  "open-conversation": "l1.kojo.task.open-conversation",
  "player-response": "l1.kojo.task.player-response",
  "settled-action": "l1.kojo.task.settled-action",
  "counter-initiative": "l1.kojo.task.counter-initiative",
  "event-invitation": "l1.kojo.task.event-invitation",
  "time-stopped": "l1.kojo.task.time-stopped",
};

export type L1TaskSlot = AiPromptSlotId;

/** H 场景的独立开头；日常的「创作方向」不在 H 请求中使用。 */
export const H_SCENE_CONTRACT_PROMPT =
  "你是 eraTW 的口上作者。依据本轮已经确定的事实，为 character_card 指定角色写这一轮 H 场景的口上或可观察地文。\n";

/**
 * 本轮任务说明选哪一块。
 *
 * 时停的第三视角约束**优先于场景**：进入 H 不构成角色清醒、愿意回应或允许某项
 * 具体动作的证据，所以时停轮仍用时停任务文字；H 场景有独立的可编辑副本。
 * 无意识目标不走单独分支——它仍然用 H 场景任务，但直接描写授权会被抑制，既有的
 * 睡眠约束文字照旧生效（见 `h-scene-authorization.ts`）。
 */
export function selectL1TaskSlot(input: {
  interactionKind: L1InteractionKind;
  sceneMode: L1SceneMode;
}): L1TaskSlot {
  if (input.interactionKind === "time-stopped") {
    return input.sceneMode === "h" ? "l1.kojo.scene.h.task.time-stopped" : "l1.kojo.task.time-stopped";
  }
  if (input.sceneMode === "h") return "l1.kojo.scene.h.task";
  return KOJO_TASK_SLOT[input.interactionKind];
}

/** `l1.kojo.scene.h.task` — H 场景下**替换**掉上面那一整组。因为它是替换而不是
 *  叠加，原 `counter-initiative` 的「角色主动发起」语义必须由本块自带。 */
export const H_SCENE_TASK_GUIDANCE =
  "本轮是一次调教行为的即时回应，command 的结果已经确定。runtime.scene_context 说明本轮实际执行的行为、结算后仍在持续的联系，以及角色此刻和长期的身体状态。角色可以承接这一刻，也可以由她自己主动开口或行动——主动程度、语气和距离感由 character_card、当前关系与情绪共同决定。已展示的地文无需复述；本轮没有新事件时保持互动连续，不要写成重新开场。不得把成功写成未遂、撤销或重做结算，也不得替玩家追加行动；新的提议可以说出口，涉及移动、物品归属或其他规则状态的结果须由 Runtime 执行后才成立。";

/** `l1.kojo.scene.h.context` — 六组事实怎么读、谁优先。 */
export const H_SCENE_CONTEXT_GUIDANCE =
  "runtime.scene_context 说明这个场景已经确定的事实。本轮命令身份以 runtime.command 为准，action_state 补充执行者、对象和结算后仍然存在的联系；event_phase 区分本轮事件与此前事件留下的状态。current_body_state 是当前对象的身体事实：insertions 按部位明确状态、actor_id 与 receiver_id；devices 独立列出道具，不代表人物关系；contacts 和 sustained_contact 只记录当前接触，clothing 记录衣着与挪开状态，cavities 与 abdomen 记录当前残留、充填率与孕期。状态持续不表示本轮重新发生，残留不等于本轮增加；不得从 command 或 interaction_memory 的历史推断仍在持续的状态。palam_state 按主角与对象分别列出当前关键档位、本轮所有已证实的 PALAM 变化；current_level 是结算后档位，same_tier 表示数值变化但未跨档。PALAM 好意只是当下积攒，不等同于关系好感；这些档位用于约束描写，不要逐项报数或把变化推断成具体往事。physical_state 是此刻身体状态，body_profile 是长期经验概况，mental_state 只补当前事实；关系与情绪仍以 runtime.relationship 和 runtime.scene.emotion 为准。interaction_memory 提供同一段互动的连续性。unknown 表示没有依据，不要读成「本轮无变化」或补成确定事实。";

// H 场景写法已迁出本模块：它现在是「骨架 + 每轮轮换的技法侧重」，归代码所有、
// 不是可编辑 slot。见 `h-scene-writing.ts`。

export const L1_TASK_GUIDANCE: Record<L1InteractionKind, string> = {
  "open-conversation": "本轮语义是「交流」：一场任何一方都可能发起、接话或转题的双向日常互动。指令只是交互引子，不是玩家已说完的具体台词，也不是玩家有事相求的正式谈话。角色同样可以开启或主导话题，从自己的兴趣、眼下的状态或未完话题自然生发一段互动，让这成为一次真实的交流而不是问询或接待；除非当前关系或摩擦确实支持，不要写出「有话快说」式的公事化打发。已展示的公共起手地文无需复述或接写，保持场景连续即可。",
  "player-response": "本轮优先回应玩家明确说的话或选定的意思，让玩家认得出你接住了什么。角色可以有自己的理解、态度和话题延伸，不必逐句作答；可选背景不能把玩家的问题挤走。",
  "settled-action": "command 的结果已确定。可写行为过程、角色的即时参与或由此展开的交流，不必先复述玩家动作再配一句反应。未指定的过程细节按人物、关系与现场自然补足，不必每轮点明部位；公共地文已有的具体事实须保留。不得把成功写成未遂、撤销或重做结算，也不得替玩家追加行动。新的提议可说出口，涉及移动、物品归属或其他规则状态的结果须由 Runtime 执行后才成立。",
  "counter-initiative": "本轮由 character_card 指定的角色主动发起。runtime.preceding_player_command 是刚结束的玩家行动，提供当前情境的前因；runtime.counter_action 是角色自行做出、已经结算的本轮动作。以角色此刻的选择、动作、开口及现场交流为重心。她可以顺势承接刚才的互动，也可以从自己的兴趣和状态自然带出话题。依据 counter_action 与 visible_events 呈现动作的过程和余韵，保持已确定的事实。新的提议可以说出口；移动、物品归属及其他规则结果由 Runtime 后续执行。",
  "event-invitation": "本轮表达 runtime.date_invitation 中已确定的邀请。地点与时间服从唯一提案，角色自由选择邀请的措辞、理由和表达方式。",
  "time-stopped": "special.time_stopped=true 时只描写可观察的时停画面，所有行 form=PRINTFORMDL。时停中目标不能说话、思考、选择或主动行动，不得推进关系、选择或后续事件。",
};

/** Only identified COM300 public setup prose is dispensable. Untagged
 * narration may be a meaningful event and must survive; no keyword guessing. */
export function selectL1FactEvents(events: readonly ObservationEvent[], openConversation: boolean) {
  return events.filter((event) => !(openConversation && event.kind === "NARRATION"
    && (event.origin === "train-message" || event.origin === "comf-fallback")));
}

/** The full cached author card remains intact; L1 receives its active lens.
 * User-authored lore and voice overrides are never silently clipped. */
export function projectL1CharacterCard(card: AiCharacterCard, gradient: string | undefined, angry: boolean) {
  return {
    ...card,
    intro: card.core_traits.length > 0 ? [] : card.intro,
    relationship_gradients: Object.fromEntries(Object.entries(card.relationship_gradients)
      .filter(([key]) => key === gradient || (angry && key === "angry"))),
  };
}

/** Keep the end of a conversation, where the unanswered question often is.
 * The addressed character keeps their own command/dialogue continuity across
 * movement. Commands aimed at somebody else are only short-lived witnessed
 * context and must belong to the current scene epoch. Ambient history stays
 * in its own consumer. */
export function selectL1History(
  history: readonly AiInteractionHistoryEntry[],
  state: Readonly<GameState>,
  target: number,
  currentSceneEpoch?: number,
) {
  return history.filter((entry) => entry.source === "command"
    && entry.gameTick <= state.time.tickValue
    && entry.gameTick >= state.time.tickValue - 180
    && (entry.target === target || (
      currentSceneEpoch !== undefined
      && entry.sceneEpoch === currentSceneEpoch
      && entry.location === state.master.location
    ))).slice(-2);
}

export function l1HistoryLines(entry: AiInteractionHistoryEntry): string[] {
  return entry.visibleLines
    .filter((line) => !(entry.source === "command" && entry.commandNo === 300 && line.startsWith("旁白：")))
    .slice(-4);
}

// Small, deterministic lexical cue matcher; this is not semantic search.
// Whole Latin words and Chinese bigrams avoid matching on single pronouns.
function cueTerms(text: string): Set<string> {
  const ignored = new Set(["什么", "怎么", "我们", "你们", "可以", "今天", "现在", "这个", "那个", "觉得", "说话", "聊天"]);
  const terms: string[] = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  for (const run of text.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index + 1 < run.length; index++) {
      const term = run.slice(index, index + 2);
      if (!ignored.has(term)) terms.push(term);
    }
  }
  return new Set(terms);
}

function overlap(terms: ReadonlySet<string>, text: string): number {
  const candidate = cueTerms(text);
  return [...terms].filter((term) => candidate.has(term)).length;
}

/** One optional subject, selected before generation, not an eight-category
 * cognition dump. Accepted facts keep their observer/time visibility gate;
 * subjective memory never acquires gameplay authority. */
export function selectL1Background(state: Readonly<GameState>, target: number, input: {
  cue: string;
  openConversation: boolean;
  recentText: string;
  rotation: number;
}): { innerWorld: string[]; experiences: string[] } {
  const cog = getCharacterCognition(state, target);
  const candidates: { text: string; rendered: string; kind: "mind" | "experience"; tick: number }[] = [];
  const add = (text: string | undefined, label: string, tick: number) => {
    if (text?.trim() && tick <= state.time.tickValue) candidates.push({ text, rendered: `${label}：${text.slice(0, 200)}`, kind: "mind", tick });
  };
  if (cog) {
    const mind = cog.mind;
    if (mind) {
      add(mind.currentTendency, "当前倾向（主观）", mind.updatedTick);
      add(mind.relationshipToPlayer, "关系理解（主观）", mind.updatedTick);
      for (const thread of mind.threads.filter((item) => item.status === "open")) add(thread.text, "未完话题（主观）", thread.updatedTick);
      for (const item of [...mind.goals, ...mind.beliefs].filter((item) => item.status !== "resolved")) add(item.text, "关注事项（主观）", item.updatedTick);
    } else {
      const reflection = cog.reflections.at(-1);
      if (reflection) add(reflection.parts?.nextTendency ?? reflection.text, "主观倾向", reflection.createdTick);
      for (const goal of cog.goals.filter((item) => item.status === "active")) add(goal.text, "关注事项（主观）", goal.createdTick);
    }
    for (const memory of cog.memories.slice(-16)) add(memory.text, "最近记忆", memory.createdTick);
    // Pending exchanges are useful after a scene change removes local history.
    for (const episode of cog.pendingEpisodes?.slice(-2) ?? []) {
      add(episode.lines.map((line) => `${line.speaker === "player" ? "玩家" : "角色"}：${line.text}`).join(" / "), "先前对话", episode.createdTick);
    }
  }
  for (const experience of selectRelevantExperiencesForL1(state, {
    observerIds: [target], relatedCharacterIds: [state.master.charaNum, target], locationId: state.master.location,
  })) {
    candidates.push({ text: experience.payload.summary, rendered: formatExperiencesForL1([experience])[0]!, kind: "experience", tick: experience.endTick });
  }
  const cue = cueTerms(input.cue);
  const recent = cueTerms(input.recentText);
  const recallQuestion = /最近.*(怎么样|怎样|做|忙|过得)|今天.*(做了|过得|忙)|记得|还记着|之前的事|昨天.*(做|发生)|刚才.*(说|聊)|后来.*(怎样|怎么样)|那件事/.test(input.cue);
  const ranked = candidates
    .filter((candidate, index, all) => all.findIndex((other) => other.text === candidate.text) === index)
    .map((candidate) => ({ ...candidate, relevance: overlap(cue, candidate.text), repeated: overlap(recent, candidate.text) >= 3 }))
    .filter((candidate) => candidate.relevance > 0 || ((recallQuestion || (input.openConversation && !candidate.repeated))
      && candidate.tick >= state.time.tickValue - 7 * 1440))
    .sort((a, b) => b.relevance - a.relevance || Number(a.repeated) - Number(b.repeated) || b.tick - a.tick);
  // Rotate only unsolicited topics; explicit questions always get the best match.
  const eligible = ranked[0]?.relevance || !input.openConversation ? ranked.slice(0, 1) : ranked.slice(0, 3);
  const chosen = eligible[(input.rotation >>> 0) % Math.max(1, eligible.length)];
  return {
    innerWorld: chosen?.kind === "mind" ? [chosen.rendered] : [],
    experiences: chosen?.kind === "experience" ? [chosen.rendered] : [],
  };
}
