import type { GameState } from "../../../modernization/runtime/state/index.js";
import { storyInteractionContext } from "../../../modernization/runtime/story/interaction-progress.js";
import { retrieveCharacterMemories } from "./memory-archive.js";
import { compileL1PromptContext } from "./l1-context-compiler.js";
import type { DatePlanEvent, BanquetEventInstance } from "../../../modernization/runtime/state/game-state.js";
import type { AgentActionOfferV1 } from "../../../modernization/runtime/agent/action-offers.js";
import { getCharacterCognition } from "../../../modernization/runtime/agent/context.js";
import { buildTalentCategories } from "../../../modernization/runtime/state/talent-categories.js";
import { getRelationStat } from "../../../modernization/runtime/state/named-stats.js";
import { checkHehai } from "../../../modernization/runtime/world/detection.js";
import { activeWorkEntry } from "../../../modernization/runtime/world/work/work-manifest.js";
import { currentRegionWeather } from "../../../modernization/runtime/weather/region-override.js";
import { mobGirlProfileForCharacter } from "../../../modernization/runtime/world/dynamic-characters.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import { playerTalentSummaryForL1 } from "../game/pre/newgame-talent.js";
import charasBundle from "../game/charas.bundle.json";
import commandsBundle from "../game/commands.bundle.json";
import kojoCatalogBundle from "../game/kojo.catalog.bundle.json";
import { familyIdOf } from "../game/command-families.js";
import { compileKojoVoiceSlice, relationshipGradientKey } from "./character-voice.js";
import { buildAiCharacterCard, characterCardStyleExamples } from "./character-card.js";
import { applyCardOverride } from "./character-card-ai.js";
import { disabledPresetCardFields, presetLore } from "./preset-card-fields.js";
import { fallbackMobGirlBasePersona, mobGirlPersonaKey } from "./mob-girl-profile.js";
import { currentAiCharacterProfile, useAiStore } from "./store.js";
import { buildAiRelationshipLens, describeAiRelationshipChange } from "./relationship-lens.js";
import { isTimeStopped } from "../../../modernization/runtime/command/h-mode.js";
import { BASE_ID } from "../../../modernization/runtime/state/settlement.js";
import { commandLabel } from "../game/command-label.js";
export { commandLabel } from "../game/command-label.js";
import { alcoholFace } from "../../../modernization/runtime/state/alcohol.js";
import type { AiCompletionRequest, AiRouteStatus, AiSettings } from "./types.js";
import { relevantInteractionHistory } from "./interaction-history.js";
import { clothingContext } from "./clothing-context.js";
import { H_SCENE_BASE_WRITING_GUIDANCE, KOJO_WRITING_GUIDANCE, matchHKojoStyleExamples, selectHKojoLengthTier, selectHKojoRhythm, selectKojoRhythm, selectKojoStyleExamples } from "./kojo-writing.js";
import { PLAYER_FACING_PROSE_GUIDANCE } from "./player-facing-prose.js";
import { promptText } from "./prompt-catalog.js";
import { selectNarrativeTopic } from "../../../modernization/runtime/story/topic.js";
import {
  H_SCENE_CONTRACT_PROMPT, H_SCENE_CONTEXT_GUIDANCE, H_SCENE_TASK_GUIDANCE, L1_TASK_GUIDANCE, l1InteractionKind,
  l1HistoryLines, projectL1CharacterCard, selectL1Background, selectL1FactEvents,
  selectL1History, selectL1TaskSlot,
} from "./kojo-context-policy.js";
import { buildHSceneWriting } from "./h-scene-writing.js";
import { buildHSceneContext, l1SceneMode } from "../../../modernization/runtime/ai-state/h-scene-context.js";
import { projectHSceneContextForPrompt } from "../../../modernization/runtime/ai-state/h-scene-prompt.js";
import { hSceneAuthorization } from "./h-scene-authorization.js";

type CharaBundleEntry = {
  id?: number;
  name?: string;
  callName?: string;
  CSTR?: Record<string, string>;
};

const COMMANDS = commandsBundle as Record<string, { label?: string; category?: string }>;
const INTIMATE_COMMAND_FAMILIES = new Set([
  "foreplay", "toy", "v", "a", "service", "sm", "hmode", "solo",
]);
const CHARAS = charasBundle as Record<string, CharaBundleEntry>;
const KOJO_CATALOG = kojoCatalogBundle as {
  byChara?: Record<string, {
    defaultVariantId?: string;
    variants?: Record<string, { label?: string; description?: string }>;
  }>;
};

const HEHAI_LABELS: Record<number, string> = {
  1: "空闲",
  2: "工作中",
  3: "睡眠中",
  4: "自由行动中",
};

function timeBand(hour: number): string {
  return hour < 5 ? "深夜" : hour < 8 ? "清晨" : hour < 12 ? "上午"
    : hour < 17 ? "下午" : hour < 21 ? "傍晚" : "夜晚";
}

function clockText(state: Readonly<GameState>): string {
  const minute = ((state.time.tickValue % 60) + 60) % 60;
  const hour = ((state.time.hourOfDay % 24) + 24) % 24;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * AI must describe the job the deterministic scheduler actually selected,
 * rather than `CSTR:工作情報`: that profile field is a human-facing summary and
 * frequently omits alternate weekday/condition branches.
 * Keep the concrete job out of ordinary dialogue context: it is a continuity
 * constraint, not a topic suggestion. The detailed job remains visible in the
 * deterministic scene/character UI.
 */
function currentActivityText(state: Readonly<GameState>, target: number): string {
  const slot = state.charas[target];
  if (!slot) return "未知";
  const minuteOfDay = ((state.time.tickValue % 1440) + 1440) % 1440;
  const activeWork = activeWorkEntry(state as GameState, target, minuteOfDay);
  if (activeWork) return "工作中";
  return HEHAI_LABELS[checkHehai(slot, state as GameState)] ?? "未知";
}

/** 情緒 gauge tier, faithful to @INFO_EMOTION: absolute value/200 clamped to
 * 0..5 (NOT a ratio of MAXBASE — the cap is 1500 upstream while tier 5
 * saturates at 1000). */
function emotionTier(value: number): number {
  return Math.max(0, Math.min(5, Math.trunc(value / 200)));
}

/** 理性 gauge tier: MAX(value/200, 1) — the star gauge never drops below 1. */
function composureTier(value: number): number {
  return Math.max(1, Math.min(5, Math.trunc(value / 200)));
}

export interface PersonaPromptContext {
  lines: string[];
  referenceLines: readonly string[];
}

export function compileAiCharacterSemanticContext(
  state: Readonly<GameState>,
  target: number,
  visibility: "player" | "npc-public" = "player",
): PersonaPromptContext {
  const live = state.charas[target];
  const data = CHARAS[String(target)] ?? {};
  const cstr = data.CSTR ?? {};
  const intro = Array.from({ length: 10 }, (_, index) => cstr[String(index + 10)])
    .filter((value): value is string => Boolean(value));
  const mentalTraits = live
    ? buildTalentCategories(live)
      .find((category) => category.key === "MENTAL")
      ?.tags.map((trait) => trait.name)
    : undefined;
  const charaCatalog = KOJO_CATALOG.byChara?.[String(target)];
  const selected = state.selectedKojoVariants?.[target] ?? charaCatalog?.defaultVariantId ?? "0";
  const variant = charaCatalog?.variants?.[selected];
  const profile = currentAiCharacterProfile(target);
  const disabledPresetFields = disabledPresetCardFields(useAiStore.getState().settings.presetCardDisabledFields, target);
  const lore = presetLore(disabledPresetFields, target, profile.lore.trim());
  const targetName = live?.callName ?? data.callName ?? `#${target}`;
  const masterName = state.master.callName ?? "主角";
  const voiceSlice = compileKojoVoiceSlice({
    target,
    selectedVariant: selected,
    variantLabel: variant?.label,
    // NPC-to-NPC ambient prompts must not receive this character's private
    // relationship toward the player. A null lens keeps only stable voice.
    relationship: visibility === "player" ? buildAiRelationshipLens(state, target) : null,
    includeRelationshipGradient: visibility === "player",
    masterName,
    targetName,
  });
  const fallbackProfile = [
    ...(disabledPresetFields.includes("intro")
      ? [] : [`人物介绍：${intro.join(" ") || "无资料"}`]),
    ...(visibility === "player"
      ? [`精神的特征（弱参考；只描述长期倾向，不要求在本次互动中表现）：${mentalTraits?.join("、") || "无"}`]
      : []),
  ];
  const dynamicProfile = mobGirlProfileForCharacter(state, target);
  const generatedPersona = dynamicProfile
    ? profile.generatedPersonaKey === mobGirlPersonaKey(dynamicProfile)
      ? profile.generatedPersona ?? fallbackMobGirlBasePersona(dynamicProfile).persona
      : fallbackMobGirlBasePersona(dynamicProfile).persona
    : profile.generatedPersona ?? "";
  return {
    lines: [
    `角色：${data.name ?? live?.callName ?? `#${target}`}；称呼：${live?.callName ?? data.callName ?? `#${target}`}`,
    `当前口上变体：${variant?.label ?? selected}`,
    ...(voiceSlice?.lines ?? fallbackProfile),
    ...(visibility === "player" && mentalTraits && mentalTraits.length > 0
      ? [`精神的特征（弱参考；只描述长期倾向，不要求在本次互动中表现）：${mentalTraits.join("、")}`]
      : []),
    ...(generatedPersona
      ? [`动态路人基础画像（低于用户维护设定）：${generatedPersona}`]
      : []),
    ...(visibility === "player" && lore
      ? [`用户维护的补充设定（高于默认画像）：${lore}`]
      : []),
    ...(profile.styleGuide.trim()
      ? [`用户维护的专属口吻与扮演约束（最高优先）：${profile.styleGuide.trim()}`]
      : []),
  ],
    referenceLines: voiceSlice?.referenceLines ?? [],
  };
}

function visibleEventEntries(
  events: readonly ObservationEvent[],
  state: Readonly<GameState>,
): { kind: string; speaker?: string; text: string }[] {
  return events.flatMap((event) => {
    // Scenery is dispensable, but a witnessed arrival/departure is an actual
    // change of participants and must remain available to the speaking NPC.
    if (event.kind === "NARRATION") {
      return event.presentation === "ambient" && event.origin !== "world-movement"
        ? [] : [{ kind: "narration", text: event.text }];
    }
    if (event.kind === "DIALOGUE_LINE") {
      const name = event.charaNum === state.master.charaNum
        ? state.master.callName ?? "主角"
        : state.charas[event.charaNum]?.callName ?? `角色${event.charaNum}`;
      return [{ kind: "dialogue", speaker: name, text: event.text }];
    }
    return [];
  }).slice(-12);
}

function safeAnswer(answer: PromptAnswer | undefined): PromptAnswer | string | null {
  if (answer === undefined) return null;
  try {
    // Round-trip drops undefined values and proves plain-object serializability
    // before the prompt document is stringified.
    return JSON.parse(JSON.stringify(answer)) as PromptAnswer;
  } catch {
    return "已选择（无法序列化）";
  }
}

/** Staleness and idempotency metadata stays on the prepared Runtime request.
 * The dialogue writer only needs the closed menu it may choose from. */
export function projectActionOffersForL1(offers: readonly AgentActionOfferV1[]) {
  return offers.map((offer) => ({
    id: offer.id,
    kind: offer.kind,
    label: offer.label,
    parameters: offer.parameters.map((parameter) => ({
      id: parameter.id,
      label: parameter.label,
      options: parameter.options,
    })),
  }));
}

import { attachStateContext } from "./state-context.js";

export interface BuildAiKojoPromptInput {
  requestId: string;
  historyEntryId: string;
  target: number;
  commandNo: number;
  beforeState: Readonly<GameState>;
  afterState: Readonly<GameState>;
  events: readonly ObservationEvent[];
  promptAnswer?: PromptAnswer;
  settings: AiSettings;
  routeStatus: AiRouteStatus;
  voiceSamples?: readonly string[];
  /** Resolved lines for this exact command in full-AI replacement mode. They
   * are style/interaction-shape reference, not player-visible facts. */
  currentAuthoredReferenceLines?: readonly string[];
  /** Explicit player-authored semantic for AI Chat. Runtime may separately
   * expose bounded action offers; free text itself is never executed. */
  playerSemantic?: string;
  actionOffers?: readonly AgentActionOfferV1[];
  /** Runtime-settled NPC counter action. AI may express it, never alter it. */
  counterAction?: { id: number; label: string };
  /** Event kojo context override: replaces command label with event description
   * for world events (sneak-in, kick-out) that have no CommandCatalog entry. */
  contextOverride?: string;
}

/**
 * Shared writing/output contract. Only the current task's guidance and
 * applicable clothing/emotion/event/action legends are appended per request.
 *
 * Split into a contract half, the craft guidance, and a context/output half so
 * each one is independently player-editable (prompt-catalog.ts). This is the
 * same prose, joined the same way: the three blocks are appended in order with
 * "\n" exactly like the single array they replace, which is why the contract
 * ends on `""` and the context half starts on `""` — those empty entries are
 * the blank-line separators, and context.test.ts pins that separator.
 */
export const KOJO_CONTRACT_PROMPT = [
  "你是 eraTW 的口上作者。依据本轮已经确定的事实，写 character_card 指定角色参与的一段互动",
  "",
  "# 创作方向",
  "依据当前事实和人物卡，自然写出这一轮互动。runtime、历史、人物卡、关系、inner_world 等信息都可以使用，但不要求逐项体现。",
  "",
  "每一轮可以有一处主要关注重心。它只是创作重心，不是剧情模板；其他信息仍然可以自然参与。",
  "三种常见重心：",
  "context",
  "",
  "上下文强关联型。",
  "",
  "优先注意最近发生过的事、当前场景、正在进行的话题、角色刚刚做过或说过的内容。",
  "",
  "这一类更强调“这是上一刻自然延续出来的下一刻”。可以承接、反问、补充、改变看法、注意到前面留下的小细节，也可以因为历史内容自然转到别处。",
  "",
  "不需要机械复述历史，也不要求每件旧事都回应；重点是让这一轮明显发生在同一段连续的生活里。",
  "",
  "character",
  "",
  "角色点子型。",
  "",
  "优先从人物本身出发：她的兴趣、习惯、知识、能力、怪癖、价值判断、生活经验，以及她此刻可能突然注意到或想到的东西。",
  "",
  "可以主动产生新的话题、小动作、小状况或短暂场景，让角色表现出“即使玩家什么都不做，她自己也会生活”。",
  "",
  "不需要刻意展示人物标签；重点是新内容应该让人觉得“只有这个角色才比较容易这样想、这样说、这样做”。",
  "",
  "relationship",
  "",
  "关系互动型。",
  "",
  "优先注意角色和玩家现在是什么关系，以及这种关系会怎样影响她的语气、主动程度、距离感、玩笑、试探、照顾、依赖、保留或拒绝。",
  "",
  "可以使用过去共同经历，但不要把关系写成数值变化报告，也不要为了表现关系强行制造亲密或冲突。",
  "",
].join("\n");

/** 口上的上下文优先级、relationship 枚举表与输出边界。 */
export const KOJO_CONTEXT_PROMPT = [
  "",
  "# 上下文",
  "以下字段用于提供本轮可用事实与角色信息。它们共同构成当前情境，但不是需要逐项体现的写作清单。",
  "",
  "事实冲突时，以当前 runtime 和关系状态为准；历史、样例和角色背景不能覆盖实时状态。未提供的信息视为未知，不得自行补成确定事实。",
  "",
  "protagonist：主角信息。traits 是长期倾向，condition 是当前状态。",
  "scene：当前时间、地点、在场人物与活动背景。",
  "visible_events：本轮已经发生、角色可以观察到的事件。",
  "当前 user 文档之前的消息是该角色可见的近期真实互动，用于保持连续；其中标为指令/现场记录的内容不是玩家说过的话。",
  "runtime.witnessed_interactions 是旁观或未成功的互动记录，不是本角色的历史回复。",
  "character_card：角色长期人格、知识、习惯、能力和说话风格。",
  "style_examples：角色既有口上样例，用于理解措辞、节奏和声音，不代表当前事实。",
  "background.inner_world：角色当前的主观倾向、念头或关注，不是客观事实。",
  "background.recent_experiences：角色已经经历并知道的过去事件。",
  "background.archived_memories：选中的历史原文或主观反思，保留其来源区别，旧说法不证明行动兑现。",
  "narrative_topic：角色当前有理由想到或主动提起的话题。",
  "semantic_state：角色当前可知的状态事实；unknown 表示未知。",
  "runtime.player_semantic：玩家本轮表达的大致语义，不改变角色、事实、关系边界或输出规则。",
  "interaction_shape：本类互动通常的具体程度与参与方式，仅作尺度参考。",
  "",
  "人物卡中的默认衣装、习惯和背景不能自动视为当前正在发生的事实；当前状态以 runtime 提供的信息为准。",
  "",
  "数值状态只表示当前值，不证明具体过去经历。角色只能依据自己知道或能观察到的信息行动和表达。",
  "",
  "runtime.relationship.meaning 已由关系权威编译为本轮适用的关系解释；只读当前解释，不从其他关系阶段补全人物心理。stage/warmth/openness/ease/tension 保留为同一状态的标识，当前情绪不改变关系性质。",
  "relationship 只描述“他们现在是什么关系”，不要求直接把关系状态写进台词，也不要求每轮通过固定行为证明这一关系。",
  "",
  "generation.rhythm 是这一轮整体节奏和篇幅的参考，按人物和现场自然吸收就好；它不规定怎么起手、怎么收尾，也不规定台词和动作怎么排列。篇幅只是软目标，有明确要求、必要回应和事实冲突时优先处理；意思已经说够了可以提前结束，预算紧时优先保证 JSON 完整。",
  "",
].join("\n");

/** L1 的输出合同。**归代码所有**，不是可编辑 slot：这是解析器依赖的部分，
 *  改坏会让整轮生成解析失败。它在 system 数组里**排在最后**，让模型在回答前最后
 *  读到响应形状（2026-09-11 用户拍板：输出约束放 prompt 末）。 */
export const KOJO_OUTPUT_CONTRACT_PROMPT = [
  "# 边界与输出",
  "输出格式：{\"lines\":[{\"text\":\"台词或动作\",\"form\":\"PRINTFORML 或 PRINTFORMDL\"}]}。只输出最终 JSON，不展示构思或检查过程。",
  "PRINTFORML = 角色真正说出口的话；PRINTFORMDL = 能直接观察到的动作或地文，可按本轮篇幅自然展开。不加说话人标签，不输出 ERA 占位符，不要 Markdown。",
  "当眼前出现值得玩家介入的具体局势时，可以添加顶层 choice：{\"options\":[{\"label\":\"玩家当下可以采取的一段行动或回应\",\"lines\":[{\"text\":\"选中后角色的即时回应\",\"form\":\"PRINTFORML\"}]}]}。给出 2-3 个不同做法，每个 label 最多200字，每支 1-4 行。选项属于尚未选择的可能行动，正文不能提前替玩家执行；分支不能宣布移动、物品交付、数值变化、他人同意或后续事情已经完成。没有自然的介入点就省略 choice，不能每轮都列选项。",
  "主体使用中文；角色名、专有名词、拟声词和少量日文字符可以保留，但不要整段写成日文。",
].join("\n");

export const STORY_CHOICE_GUIDANCE = [
  "# 当前剧情中的可选回应",
  "剧情钩子和 story_interactions 帮你理解眼前正在发生的事。只有角色确实把局势交到玩家面前，或现在有几种值得尝试的具体做法时，才随本次口上一并给出 choice；问候、气氛描写、重复话题和事情已说清时不要硬添。",
  "选项像小说中的一小段行动：用一到两句有语气、有细节的文字写玩家现在准备怎么做、怎么问或怎么回应。细节须来自当前现场可见的人、物和已经说出口的话；可以是追问、查看、安抚、提出试探性办法、换个切入口或暂时退一步。不要写成‘调查一下’‘支持她’‘推进剧情’这类概括标签，也不要替玩家预设内心、感情或必然成功。",
  "各项可以只是着眼点、措辞、先后顺序和介入程度不同，不必凑成赞成/反对、善/恶或针锋相对的立场；不要预告未来分支和幕后真相。让玩家看得出此刻可做什么，而不是看穿之后会发生什么。",
  "若这组选项确实针对一条 story_interactions 中的当前故事，在 choice 内额外填写 storyArcId，原样复制那条故事的 arcId。只绑定一条，不为无关闲聊绑定故事。未选的分支不会发生；选中项及该角色的即时回应将成为后续剧情重新判断局势的依据，不能在分支里替其他人答应、凭空给物品、跳过到场要求或宣布尝试成功。",
  "若钩子有既定的正式回应，由 Runtime 保留原选项和效果；不要另外编造可以绕过它的选项。choice 的后续 lines 只写当前角色对所选做法的现场回应，不代写一整段后续剧情。",
].join("\n");

// 任务槽映射已随 `selectL1TaskSlot` 移到 `kojo-context-policy.ts`——H 场景会替换掉
// 这一整组，选择逻辑留在槽位表旁边更不容易分叉。

function promptSeed(value: string): number {
  // Request IDs contain the runtime timestamp and serial. Hashing instead of
  // using Math.random keeps a prepared request reproducible while still
  // rotating the creative signal across normal play.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildAiKojoCompletion(input: BuildAiKojoPromptInput): AiCompletionRequest {
  const { target, commandNo, beforeState, afterState } = input;
  const aiChat = input.playerSemantic !== undefined;
  const intimateCommand = !aiChat && INTIMATE_COMMAND_FAMILIES.has(familyIdOf(commandNo));
  const commandMetadata = COMMANDS[String(commandNo)] ?? (commandNo === 19987
    ? { label: "主动提出约会邀请", family: "事件" }
    : aiChat
      ? { label: "对话（AI）", family: "AI 测试" }
    : undefined);
  const command = { ...commandMetadata, label: commandLabel(commandNo, beforeState, target) };
  const targetSlot = afterState.charas[target];
  const lens = buildAiRelationshipLens(afterState, target);
  const disabledPresetFields = disabledPresetCardFields(input.settings.presetCardDisabledFields, target);
  const baseCard = buildAiCharacterCard({ state: afterState, target, visibility: "player", disabledPresetFields });
  const cardOverride = useAiStore.getState().settings.characterCardOverrides[String(target)];
  const card = cardOverride ? applyCardOverride(baseCard, cardOverride) : baseCard;
  const timeStopped = isTimeStopped(afterState);
  const interactionKind = l1InteractionKind({
    commandNo, playerSemantic: input.playerSemantic, hasAnswer: input.promptAnswer !== undefined,
    counter: Boolean(input.counterAction), timeStopped,
  });
  // H 场景是独立维度，不是任务枚举的一员：一个请求可以同时是「处于 H 场景」和
  // 「角色主动行动」。场景身份读 Runtime 判定 + 结算回执，不看 UI 打开状态。
  const sceneMode = l1SceneMode(afterState, target, commandNo, afterState.lastHSettlement);
  const sceneContext = sceneMode === "h"
    ? buildHSceneContext(afterState, target, {
        commandNo,
        beforeState,
        receipt: afterState.lastHSettlement,
        labelFor: (no) => commandLabel(no, afterState, target),
      })
    : undefined;
  const promptSceneContext = sceneContext
    ? projectHSceneContextForPrompt(sceneContext, beforeState, afterState, target,
        (no) => commandLabel(no, afterState, target))
    : undefined;
  const openConversation = interactionKind === "open-conversation";
  // Use contextOverride for event kojo, otherwise use command label or player semantic
  const cue = input.counterAction?.label ?? input.contextOverride ?? input.playerSemantic ?? (openConversation ? "" : command?.label ?? "");
  const archivedMemories = timeStopped ? [] : retrieveCharacterMemories(afterState.agentRuntime, target, cue);
  const narrativeHook = selectNarrativeHook(afterState, target, input.commandNo);
  const hookMind = narrativeHook ? getCharacterCognition(afterState, target)?.mind : undefined;
  const hookProgram = narrativeHook && (afterState.storyProgram?.id === narrativeHook.storyId ? afterState.storyProgram
    : afterState.narrativeEvents?.find(event => event.program.id === narrativeHook.storyId)?.program);
  const hookArc = hookProgram?.version === 2 ? afterState.storyArcs?.find(arc => arc.id === hookProgram.arcId) : undefined;
  const eventContext = afterState.activeEventContext
    && afterState.activeEventContext.expiresAtTick >= afterState.time.tickValue
    && afterState.activeEventContext.openedAtTick <= afterState.time.tickValue
    && afterState.activeEventContext.participantIds.includes(target)
    ? afterState.activeEventContext : undefined;
  // The one narrative subject this character may raise on their own. Only
  // conversational turns carry it, and an active event is excluded because
  // event_context above already covers that beat with its own reveal bounds.
  const conversational = openConversation || interactionKind === "player-response";
  const narrativeTopic = conversational && !timeStopped
    ? selectNarrativeTopic(afterState, target) : null;
  const present = Object.values(afterState.charas)
    .filter((slot) => slot.location === afterState.master.location && slot.charaNum !== target
      && slot.charaNum !== afterState.master.charaNum);
  const relevantPresent = present.filter((slot) =>
    (slot.callName && cue.includes(slot.callName))
    || eventContext?.participantIds.includes(slot.charaNum)
    || input.events.some((event) => event.kind === "DIALOGUE_LINE" && event.charaNum === slot.charaNum))
    .map((slot) => slot.callName ?? `#${slot.charaNum}`);
  const dateInvitation = commandNo === 19987
    ? (afterState.worldEvents ?? []).find((event): event is DatePlanEvent =>
        event.kind === "date-plan" &&
        event.partner === target &&
        event.phase === "offered" &&
        event.scheduledStartTick != null &&
        Boolean(event.location))
    : undefined;

  // Detect active banquet event when target is a participant
  const activeBanquet = (afterState.worldEvents ?? []).find((event): event is BanquetEventInstance =>
    event.kind === "banquet" &&
    ["preparing", "active", "cleanup"].includes(event.phase) &&
    event.participants?.includes(target));

  const banquetTemplates = [
    { id: 1, name: "灵梦的随兴酒宴" },
    { id: 2, name: "幻想乡年忘会" },
    { id: 3, name: "月见酒" },
    { id: 4, name: "收获祭" },
    { id: 7, name: "畜生界的和平亲睦会" },
    { id: 8, name: "住所不定者的集会" },
    { id: 10, name: "姐姐聚会" },
    { id: 11, name: "正邪的一人宴会" },
  ];

  const banquetInfo = activeBanquet ? {
    name: banquetTemplates.find((t) => t.id === (activeBanquet as any).templateId)?.name ?? "宴会",
    venue: activeBanquet.venue,
    phase: activeBanquet.phase === "preparing" ? "准备中" : activeBanquet.phase === "active" ? "进行中" : "收尾中",
    scale: activeBanquet.initialScale > 2000 ? "大型" : activeBanquet.initialScale > 1200 ? "中型" : "小型",
  } : undefined;

  const interactionHistory = useAiStore.getState().interactionHistory;
  const currentSceneEpoch = interactionHistory.find((entry) => entry.id === input.historyEntryId)?.sceneEpoch;
  const recentHistory = selectL1History(relevantInteractionHistory(
    interactionHistory,
    [target],
    input.historyEntryId,
    12,
  ), afterState, target, currentSceneEpoch);
  const visibleFactEvents = input.routeStatus === "authored-reference"
    ? input.events.filter((event) => event.kind !== "DIALOGUE_LINE")
    : input.events;

  const availableStyleExamples = selectKojoStyleExamples({
    currentAuthored: !openConversation && input.routeStatus === "authored-reference"
      ? input.currentAuthoredReferenceLines ?? [] : [],
    liveSamples: input.voiceSamples ?? [],
    cardSamples: characterCardStyleExamples(card, disabledPresetFields),
  });

  const background = timeStopped ? { innerWorld: [], experiences: [] } : selectL1Background(afterState, target, {
    cue, openConversation,
    recentText: recentHistory.flatMap(l1HistoryLines).join(" "),
    rotation: promptSeed(`${input.historyEntryId}|${target}|background`),
  });
  const clothing = clothingContext(targetSlot);
  const clothingChanged = JSON.stringify(clothing) !== JSON.stringify(clothingContext(beforeState.charas[target]));
  const includeClothing = Boolean(clothing && (clothingChanged || clothing.upper_open || intimateCommand
    || input.counterAction || /衣|穿|裙|袖|鞋|帽|换装|打扮|配饰|眼镜|clothes|outfit/i.test(cue)));
  const emotionFor = (state: Readonly<GameState>) => {
    const slot = state.charas[target];
    if (!slot) return { stirred: 0, composure: 5, anger: 0 };
    return {
      stirred: emotionTier(getRelationStat(slot.state, "情緒").value),
      composure: composureTier(getRelationStat(slot.state, "理性").value),
      anger: emotionTier(getRelationStat(slot.state, "憤怒").value),
    };
  };
  const emotion = emotionFor(afterState);
  const targetActivity = currentActivityText(afterState, target);
  const unconscious = targetActivity === "睡眠中";
  const storyInteractions = input.settings.narrativeEnabled && !timeStopped && !unconscious ? storyInteractionContext(afterState, target) : [];
  const taskSlot = selectL1TaskSlot({ interactionKind, sceneMode });
  const authorization = hSceneAuthorization({ sceneMode, timeStopped, unconscious });
  const includeEmotion = emotion.anger > 0 || emotion.stirred >= 3 || emotion.composure <= 2
    || JSON.stringify(emotion) !== JSON.stringify(emotionFor(beforeState));
  const includeClock = Boolean(dateInvitation || eventContext || /几点|时候|时间|日期|哪天|迟到|钟|time|date/i.test(cue));
  // currentRegionWeather is a pure selector; unlike weatherStatusShow it
  // never initializes or mutates the weather state during prompt building.
  const weather = currentRegionWeather(afterState);
  const previousWeather = currentRegionWeather(beforeState);
  const includeWeather = weather.weatherVisible && (
    /天气|下雨|下雪|雨势|雪势|刮风|晴天|阴天|天候|weather/i.test(`${cue} ${eventContext?.objective ?? ""}`)
    || weather.weatherIndex !== previousWeather.weatherIndex
    || weather.windIndex >= 2);
  // Only unusual, directly noticeable protagonist conditions help write this
  // exchange. Healthy percentages and the configured home otherwise become
  // repeated prompt noise in every ordinary chat.
  const masterSlot = afterState.master;
  const vitalityPercent = (baseId: number): number => {
    const max = masterSlot.state.MAXBASE[baseId] ?? 0;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(((masterSlot.state.BASE[baseId] ?? 0) / max) * 100)));
  };
  const masterVitality = {
    stamina: vitalityPercent(BASE_ID.体力),
    energy: vitalityPercent(BASE_ID.気力),
  };
  const masterDrunk = alcoholFace(afterState, masterSlot.charaNum);
  const protagonistCondition = {
    ...(masterVitality.stamina < 60 || masterVitality.energy < 60 ? { vitality: masterVitality } : {}),
    // 微醺不算「需要角色作出反应的状态」：只有明显醉酒（醉酒 / 不省人事）才进
    // 语义，避免每喝一口酒就让角色围着主角的酒气写一段。
    ...(masterDrunk === "醉酒" || masterDrunk === "不省人事" ? { drunk: masterDrunk } : {}),
  };
  const promptAnswer = safeAnswer(input.promptAnswer);

  // COM496's radio reaction shares the formal interaction surface with the
  // broadcast column; a long kojo overwhelms it (实玩反馈 2026-09-08). The
  // cap also pins the rhythm pool to brief entries via selectKojoRhythm.
  // 提到 document 之前：节奏、H 写法侧重项和 provider 的 maxTokens 都要用同一个值。
  const effectiveMaxTokens = commandNo === 496 ? Math.min(input.settings.maxTokens, 320) : input.settings.maxTokens;
  const hLengthTier = sceneMode === "h"
    ? selectHKojoLengthTier(promptSeed(`${input.requestId}|${input.historyEntryId}|${target}|${commandNo}|h-length`), effectiveMaxTokens)
    : null;
  const styleExamples = hLengthTier
    ? matchHKojoStyleExamples(availableStyleExamples, hLengthTier)
    : availableStyleExamples.slice(0, 3);

  // H 场景写法 = 固定骨架 + 每轮按 seed 抽 2–3 项描写侧重。归代码所有，不过
  // promptText：它不是可编辑 slot（见 `h-scene-writing.ts`）。
  // seed 后缀必须与节奏用的 `|rhythm` 不同，否则两个选择器锁步轮换。
  const hSceneWriting = authorization.scope === "explicit"
    ? buildHSceneWriting(
      promptSeed(`${input.requestId}|${input.historyEntryId}|${target}|${commandNo}|h-scene-writing`),
      effectiveMaxTokens,
      hLengthTier ?? "short",
    )
    : null;

  // Identity stays separate from current task facts. Optional blocks are
  // actually omitted here, not merely labeled low-priority in a larger dump.
  const document = {
    protagonist: {
      name: afterState.master.callName ?? "主角",
      traits: playerTalentSummaryForL1(afterState),
      ...(Object.keys(protagonistCondition).length > 0 ? { condition: protagonistCondition } : {}),
    },
    character_card: projectL1CharacterCard(card, lens ? relationshipGradientKey(lens) : undefined, lens?.tension === "angry"),
    runtime: {
      interaction: interactionKind,
      // 与 interaction 平级：`scene` 的语义是时间/地点/在场，且部分路径会省略它，
      // 场景模式不能挂在那里。
      scene_mode: sceneMode,
      ...(promptSceneContext ? { scene_context: promptSceneContext } : {}),
      scene: {
        ...(includeClock ? { day: afterState.time.dayIndex + 1, time: clockText(afterState) } : {}),
        band: timeBand(((afterState.time.hourOfDay % 24) + 24) % 24),
        location: afterState.master.location,
        target_activity: currentActivityText(afterState, target),
        ...(banquetInfo ? {
          banquet: {
            name: banquetInfo.name,
            venue: banquetInfo.venue,
            phase: banquetInfo.phase,
            scale: banquetInfo.scale,
          },
        } : {}),
        ...(unconscious ? {
          unconscious_state: {
            kind: "sleep",
            first_person_reply_forbidden: true,
            presentation: "third_person_observation",
          },
        } : {}),
        ...(includeEmotion ? { emotion } : {}),
        ...(includeWeather ? { weather: {
          conditions: weather.weatherName,
          ...(weather.windVisible ? { wind: weather.windName } : {}),
        } } : {}),
        company: present.length > 0 ? "others-present" : "no-other-characters",
        ...(relevantPresent.length > 0 ? { present_characters: relevantPresent.slice(0, 8) } : {}),
      },
      ...(!aiChat ? { [input.counterAction ? "preceding_player_command" : "command"]: {
        id: commandNo,
        kind: "COM",
        // COM300's player-facing label is 会话, but its interaction semantics
        // are a mutual exchange (see L1_TASK_GUIDANCE open-conversation); the
        // AI must not read the command as a formal "player has business" talk.
        label: commandNo === 300 ? "交流" : command?.label ?? `#${commandNo}`,
        family: familyIdOf(commandNo),
        intimate: intimateCommand,
        ...(promptAnswer !== null ? { answer: promptAnswer } : {}),
        settlement: "success",
        ...(!input.counterAction ? { elapsed_minutes: Math.max(0, afterState.time.tickValue - beforeState.time.tickValue) } : {}),
      } } : {}),
      relationship: lens
        ? {
            stage: lens.stage,
            warmth: lens.warmth,
            openness: lens.openness,
            ease: lens.ease,
            tension: lens.tension,
            gradient: relationshipGradientKey(lens),
            angry_overlay: lens.tension === "angry",
            ...(!aiChat && !input.counterAction ? { change_this_turn: describeAiRelationshipChange(beforeState, afterState, target) } : {}),
          }
        : null,
      visible_events: aiChat ? [] : visibleEventEntries(selectL1FactEvents(visibleFactEvents, openConversation), afterState),
      ...(includeClothing ? { clothing } : {}),
      ...(dateInvitation ? {
        date_invitation: {
          location: dateInvitation.location,
          scheduled_start_tick: dateInvitation.scheduledStartTick,
        },
      } : {}),
      ...(aiChat ? { player_semantic: input.playerSemantic ?? "" } : {}),
      ...(eventContext ? { event_context: {
        objective: eventContext.objective,
        actorRole: eventContext.actorRole,
        visibleFactIds: eventContext.visibleFactIds,
        revealableFactIds: eventContext.revealableFactIds,
        forbiddenClaims: eventContext.forbiddenClaims,
        allowedIntentIds: eventContext.allowedIntentIds,
      } } : {}),
      // The runtime-side NarrativeTopicV1 carries canReveal/mustNotClaim ids,
      // but nothing consumes them on the response side and the L1 legend never
      // explains them, so the prompt gets only the readable subject.
      ...(narrativeTopic ? { narrative_topic: {
        source: narrativeTopic.source,
        topic: narrativeTopic.topic,
      } } : {}),
      ...(input.actionOffers && input.actionOffers.length > 0
        ? { action_offers: projectActionOffersForL1(input.actionOffers) }
        : {}),
      ...(input.counterAction ? {
        counter_action: {
          id: input.counterAction.id,
          label: input.counterAction.label,
          initiator: "character",
          settlement: "already_applied",
        },
      } : {}),
      ...(timeStopped ? { special: { time_stopped: true } } : {}),
      ...(background.innerWorld.length > 0 ? { inner_world: { lines: background.innerWorld } } : {}),
      ...(background.experiences.length > 0 ? { recent_experiences: background.experiences } : {}),
      ...(archivedMemories.length > 0 ? { archived_memories: archivedMemories } : {}),
      ...(narrativeHook ? { narrative_hook: { hookId: narrativeHook.id, revision: narrativeHook.revision,
        objective: narrativeHook.objective, dispositions: ["raise", "defer", "decline"],
        ...(hookMind && hookMind.updatedTick <= afterState.time.tickValue ? { currentMind: {
          relationshipUnderstanding: hookMind.relationshipToPlayer.slice(0, 600),
          tendency: hookMind.currentTendency.slice(0, 600),
          scope: "当前角色自己的 L2 主观状态；不覆盖真实关系与当前事实，也不作为其他角色的知识。",
        } } : {}),
        ...(hookArc?.background ? { creativeBackground: hookArc.background,
          backgroundScope: "创作背景，不是已发生事实或角色共有知识；只表达本次 objective，不重演原文。" } : {}) } } : {}),
      ...(storyInteractions.length ? { story_interactions: storyInteractions } : {}),
    },
    ...(styleExamples.length > 0 ? { style_examples: styleExamples } : {}),
    generation: {
      rhythm: hLengthTier ? selectHKojoRhythm(hLengthTier, timeStopped || unconscious) : selectKojoRhythm(
        promptSeed(`${input.requestId}|${input.historyEntryId}|${target}|${commandNo}|rhythm`),
        effectiveMaxTokens,
        timeStopped || unconscious,
      ),
      // 与下面的 system 授权段同源同一布尔，避免两边说法不一致。
      presentation_scope: authorization.scope,
    },
  };

  const compiled = compileL1PromptContext({ document, relationship: lens, history: recentHistory,
    target, masterName: afterState.master.callName ?? "主角" });
  const user = [
    "以下是本次生成的结构化上下文文档；字段语义与枚举表以 system 说明为准。",
    "只输出符合输出格式的 JSON。",
    JSON.stringify(compiled.document, null, 1),
  ].join("\n");

  return attachStateContext({
    system: [
      sceneMode === "h"
        ? promptText(input.settings, "l1.kojo.scene.h.contract", H_SCENE_CONTRACT_PROMPT)
        : promptText(input.settings, "l1.kojo.contract", KOJO_CONTRACT_PROMPT),
      sceneMode === "h"
        ? promptText(input.settings, "l1.kojo.scene.h.base-writing", H_SCENE_BASE_WRITING_GUIDANCE)
        : promptText(input.settings, "l1.kojo.writing", KOJO_WRITING_GUIDANCE),
      PLAYER_FACING_PROSE_GUIDANCE,
      sceneMode === "h"
        ? promptText(input.settings, "l1.kojo.scene.h.base-context", KOJO_CONTEXT_PROMPT)
        : promptText(input.settings, "l1.kojo.context", KOJO_CONTEXT_PROMPT),
      // 场景图例紧跟在通用上下文之后、本轮任务之前：它说明 scene_context 怎么读。
      ...(sceneContext ? [promptText(input.settings, "l1.kojo.scene.h.context", H_SCENE_CONTEXT_GUIDANCE)] : []),
      "# 本轮任务",
      promptText(input.settings, taskSlot, taskSlot === "l1.kojo.scene.h.task" ? H_SCENE_TASK_GUIDANCE : L1_TASK_GUIDANCE[interactionKind]),
      ...(commandNo === 496 ? [
        "收音机场景：角色反应只是边听广播时的自然回应，保持简短（合计约 30-120 字，1-4 行）；不要复述或解释广播里的数值事实，也不要展开成长段动作或完整对话。",
      ] : []),
      ...(unconscious ? [
        "目标角色当前处于睡眠/无意识状态。只能写玩家可观察到的第三视角动作、环境和睡眠状态；不得让目标角色清醒、主动回应、进行问答或表达有意识意图。梦呓只能作为模糊声音或环境细节，不能当作直接对白。输出仍须遵守 JSON lines 合同。",
      ] : []),
      ...(includeClothing ? ["runtime.clothing 只列目标当前在穿的上下身衣物和少量 accents；null 表示该部位未读到衣物，upper_open=true 表示上身衣装敞开。名称没有提供的颜色、材质和结构不能凭默认印象补出；穿着不证明所有部件都可见，按需使用即可。"] : []),
      ...(includeEmotion ? [
        "scene.emotion 为 0-5 仪表。stirred（情緒）：心绪被撩动的程度，不是心情好坏，低值≠沮丧；composure（理性）：自制与冷静，越低越难自持；anger 越高越愤怒。情动不改变关系或行动边界。",
      ] : []),
      ...(banquetInfo ? [
        `scene.banquet 表示当前正在进行的宴会。角色作为参与者，可以自然留意到宴会氛围、其他客人或饮酒场合，但不要求必须提及；宴会只是互动的背景环境。`,
      ] : []),
      ...(eventContext ? ["event_context 是角色当前参与事件的事实与可透露范围，约束连续性，不要求每次把事件目标说出口；不得把未知事实写成已知。"] : []),
      ...(archivedMemories.length ? ["background.archived_memories 是该角色过去实际说过的话与主观反思；按本轮话题使用，不能将旧承诺、旧看法或对话中的说法当成已经执行的动作或当前权威状态。"] : []),
      ...(narrativeHook ? ['narrative_hook 是本次可考虑引出的剧情目标，不是要求角色完成的命令。根据自身 L2 心境、当前状态、关系、眼前氛围及玩家实际表达，自然决定是否提起 objective。不能为了推进故事突然亲密、热情、信任或违背性格；不合时宜可暂缓（defer）或拒绝（decline）。提起（raise）必须在本次真实台词中表达该目标，只表示说出了这件事，不能宣称玩家已接受、同行已开始或计划已执行。未推进将等待下一次演化，不需要在本轮强行圆回来。最多输出8行；完整回复额外输出 hookResult：{"hookId":"所给ID","revision":所给整数,"disposition":"raise 或 defer 或 decline","lineIds":["reply:0"]}。lineIds 使用最终 lines 从零开始的索引，只引用真实处理结果的行；未处理可省略 hookResult，但不能谎报 raise。不得生成新的事实ID；提议和待选动作不能写成已经执行的游戏效果。'] : []),
      ...(storyInteractions.length ? ['story_interactions 是正在演化的故事，initialBackground 是最初局势，不要求重演。当前聊天可改变原计划；允许玩家提出选项之外的新办法。仅在本次台词确实对其中一条故事提出办法、接受、拒绝、撤回、提出请求、报告或陈述立场时，可在回复顶层附带 storyProgress 数组（最多3项）：[{"arcId":"所给ID","revision":所给整数,"kind":"proposal|accept|reject|withdraw|request|report|claim之一","summary":"300字内概括本角色这次表达，不替别人同意或宣布行动完成","lineIds":["reply:0"]}]。只引用最终真实台词行；不相关或无变化时省略，不为寒暄重复提交。接受必须指向具体方案，转述和主观胜利不等于双方共识。它是进展线索，不是世界状态、物品、数值或移动的执行权限。'] : []),
      ...(narrativeHook || storyInteractions.length ? [STORY_CHOICE_GUIDANCE] : []),
      ...(input.counterAction ? ["counter_action 是角色主动做出且已由 Runtime 结算的动作。请以角色的主动选择展开表达，保持动作和结果与本轮事实一致。"] : []),
      ...(!aiChat && !input.counterAction ? ["runtime.command 是本轮已执行动作的权威身份，以 kind、id 和 label 一起识别。COM 与 SCOM 是独立编号空间，同号不代表同一动作。人设及 style_examples 中其他指令的动作只供语气参考，不得替换本轮动作。"] : []),
      // 直接描写授权归代码所有（`h-scene-authorization.ts`）：改 slot 不能取消
      // 它，时停/无意识也不会继承它。
      ...(authorization.block ? [authorization.block] : []),
      ...(input.actionOffers?.length ? [
        'runtime.action_offers 只是可选菜单，不要求采取行动。只有本轮对话自然形成明确行动时，才可添加 action：{"offerId":"原样复制","parameters":{"参数 ID":"选项 ID"}}。只使用列出的 ID；不要输出 version、contextHash、idempotencyKey、null 或额外字段。没有合适项就完全省略 action。',
      ] : []),
      // H 写法放在条件块之后：它的侧重项每轮都变，摆在会逐轮变化的块前面会白白
      // 截断 provider 隐式前缀缓存里本可稳定的部分。
      ...(hSceneWriting ? [hSceneWriting] : []),
      // LAST on purpose: the response shape is what the parser reads, so it is
      // the model's final instruction rather than something buried between the
      // context legend and the per-turn task.
      KOJO_OUTPUT_CONTRACT_PROMPT,
    ].join("\n"),
    user,
    contextMessages: compiled.contextMessages,
    temperature: input.settings.temperature,
    maxTokens: effectiveMaxTokens,
    jsonMode: true,
  }, { state: afterState, beforeState, route: "l1", observer: target,
    cue: input.counterAction ? cue : `${cue} ${command?.label ?? ""}`,
    // 时停 / 无意识只写可观察画面，不给状态数字。除此之外 L1 **一律走确定性预载**
    // （别名命中主题 → 取字段 → 进 semantic_state）。
    // 曾经自由对话被清零（`aiChat && stateQueryEnabled ⇒ 0`）以换取「模型按需补查」，
    // 实测该赌注失败：模型不知道该查什么（主题只有名字没有字段清单），而清零又让
    // 补查答案一起变空。2026-09-11 用户拍板：L1 撤下补查，确定性检索是唯一通路。
    maxFacts: timeStopped || unconscious ? 0 : sceneMode === "h" ? 6 : undefined,
    maxChars: sceneMode === "h" ? 600 : undefined,
    includeBaseline: sceneMode !== "h",
    // `sceneContext.consumedFieldIds` 只列**已经给出档位**的字段：unknown 的轴保留
    // 原始值，否则模型既拿不到档位也拿不到原值，是净信息损失。
    excludeFields: ["favor", "trust", ...(includeEmotion ? ["anger", "emotion", "composure"] : []), ...(includeClothing ? ["clothing"] : []), ...(includeWeather ? ["weather"] : []), ...(sceneContext?.consumedFieldIds ?? [])],
  });
}

export function visibleHistoryLines(events: readonly ObservationEvent[], state: Readonly<GameState>): string[] {
  return visibleEventEntries(events, state).map((entry) =>
    entry.kind === "dialogue"
      ? `${entry.speaker}：${entry.text}`
      : `旁白：${entry.text}`,
  );
}
import { selectNarrativeHook } from "../../../modernization/runtime/story/dialogue-hook.js";
