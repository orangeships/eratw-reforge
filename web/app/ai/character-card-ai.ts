import type { AiCharacterCard } from "./character-card.js";
import type {
  AiCharacterCardListKey,
  AiCharacterCardOverride,
  AiCompletionRequest,
  AiSettings,
} from "./types.js";
import { jsonBody } from "./response-validator.js";
import { promptText } from "./prompt-catalog.js";

/**
 * 角色卡 LLM 结构化编辑：玩家用自然语言描述想调整的性格/约束，模型把它
 * 结构化进派生角色卡（AiCharacterCard）的既定字段——列表字段按条目增删
 * （append/remove），标量字段整体替换（set）。产出的是**卡片段落覆盖**
 * （AiCharacterCardOverride），玩家预览 diff 后手动应用才持久化；原口上
 * 派生卡不被改写，也不产生任何游戏状态写入。
 */

export const CARD_LIST_KEYS: readonly AiCharacterCardListKey[] = [
  "core_traits",
  "interaction_habits",
  "never_say",
  "emphasize",
  "avoid",
  "voice_sentence_endings",
  "voice_exclamations",
];

export const CARD_LIST_LABELS: Record<AiCharacterCardListKey, string> = {
  core_traits: "核心特质",
  interaction_habits: "互动习惯",
  never_say: "绝不提及",
  emphasize: "强调",
  avoid: "避免",
  voice_sentence_endings: "句尾词",
  voice_exclamations: "感叹词",
};

const CARD_SCALAR_LABELS: Record<"self_image" | "voice_tone" | "voice_volume", string> = {
  self_image: "自我认知",
  voice_tone: "语气",
  voice_volume: "音量",
};

const MAX_APPEND_PER_LIST = 3;
const MAX_ENTRY_LENGTH = 120;
const MAX_SCALAR_LENGTH = 240;

export const EMPTY_CARD_OVERRIDE: AiCharacterCardOverride = { append: {}, remove: {} };

export function cardList(card: AiCharacterCard, key: AiCharacterCardListKey): readonly string[] {
  switch (key) {
    case "core_traits": return card.core_traits;
    case "interaction_habits": return card.interaction_habits;
    case "never_say": return card.never_say;
    case "emphasize": return card.emphasize;
    case "avoid": return card.avoid;
    case "voice_sentence_endings": return card.voice.sentence_endings;
    case "voice_exclamations": return card.voice.exclamations;
  }
}

/** 有效列表 = 原卡条目去掉 remove，再拼上 append。 */
function effectiveList(card: AiCharacterCard, override: AiCharacterCardOverride, key: AiCharacterCardListKey): string[] {
  const removed = override.remove?.[key] ?? [];
  return [...cardList(card, key).filter((text) => !removed.includes(text)), ...(override.append?.[key] ?? [])];
}

/** 把覆盖合并进派生卡，返回新的卡对象（其余字段原样保留）。 */
export function applyCardOverride(card: AiCharacterCard, override: AiCharacterCardOverride): AiCharacterCard {
  return {
    ...card,
    self_image: override.self_image ?? card.self_image,
    voice: {
      ...card.voice,
      tone: override.voice_tone ?? card.voice.tone,
      volume: override.voice_volume ?? card.voice.volume,
      sentence_endings: effectiveList(card, override, "voice_sentence_endings"),
      exclamations: effectiveList(card, override, "voice_exclamations"),
    },
    core_traits: effectiveList(card, override, "core_traits"),
    interaction_habits: effectiveList(card, override, "interaction_habits"),
    never_say: effectiveList(card, override, "never_say"),
    emphasize: effectiveList(card, override, "emphasize"),
    avoid: effectiveList(card, override, "avoid"),
  };
}

/** 把 LLM 的增量合并进已持久化覆盖：set 覆盖；append 去重拼接；
 *  remove 若指向既有 append 条目则从 append 里删掉，指向原卡条目才进 remove。 */
export function mergeCardOverride(
  current: AiCharacterCardOverride,
  delta: AiCharacterCardOverride,
  card: AiCharacterCard,
): AiCharacterCardOverride {
  const append: Partial<Record<AiCharacterCardListKey, readonly string[]>> = {};
  const remove: Partial<Record<AiCharacterCardListKey, readonly string[]>> = {};
  for (const key of CARD_LIST_KEYS) {
    const currentAppend = current.append?.[key] ?? [];
    const deltaAppend = delta.append?.[key] ?? [];
    const deltaRemove = delta.remove?.[key] ?? [];
    const mergedAppend = [...currentAppend, ...deltaAppend]
      .filter((text, index, all) => all.indexOf(text) === index)
      .filter((text) => !deltaRemove.includes(text));
    if (mergedAppend.length > 0) append[key] = mergedAppend;
    const mergedRemove = [...(current.remove?.[key] ?? []), ...deltaRemove]
      .filter((text, index, all) => all.indexOf(text) === index)
      .filter((text) => cardList(card, key).includes(text));
    if (mergedRemove.length > 0) remove[key] = mergedRemove;
  }
  return {
    ...(delta.self_image !== undefined ? { self_image: delta.self_image } : current.self_image !== undefined ? { self_image: current.self_image } : {}),
    ...(delta.voice_tone !== undefined ? { voice_tone: delta.voice_tone } : current.voice_tone !== undefined ? { voice_tone: current.voice_tone } : {}),
    ...(delta.voice_volume !== undefined ? { voice_volume: delta.voice_volume } : current.voice_volume !== undefined ? { voice_volume: current.voice_volume } : {}),
    append,
    remove,
  };
}

export interface CardOverrideDiffEntry {
  key: AiCharacterCardListKey | "self_image" | "voice_tone" | "voice_volume";
  label: string;
  /** 列表字段的变化；标量字段为空。 */
  added: readonly string[];
  removed: readonly string[];
  /** 标量字段的变化；未变化为 undefined。 */
  scalarBefore?: string;
  scalarAfter?: string;
}

/** 预览用：两张有效卡之间的逐字段差异（只列有变化的字段）。 */
export function diffCardOverride(
  card: AiCharacterCard,
  before: AiCharacterCardOverride,
  after: AiCharacterCardOverride,
): CardOverrideDiffEntry[] {
  const entries: CardOverrideDiffEntry[] = [];
  for (const key of CARD_LIST_KEYS) {
    const beforeList = effectiveList(card, before, key);
    const afterList = effectiveList(card, after, key);
    const added = afterList.filter((text) => !beforeList.includes(text));
    const removed = beforeList.filter((text) => !afterList.includes(text));
    if (added.length > 0 || removed.length > 0) entries.push({ key, label: CARD_LIST_LABELS[key], added, removed });
  }
  for (const [key, label] of Object.entries(CARD_SCALAR_LABELS) as Array<[keyof typeof CARD_SCALAR_LABELS, string]>) {
    const beforeValue = key === "self_image" ? before.self_image : key === "voice_tone" ? before.voice_tone : before.voice_volume;
    const afterValue = key === "self_image" ? after.self_image : key === "voice_tone" ? after.voice_tone : after.voice_volume;
    if (beforeValue !== afterValue) {
      const baseValue = key === "self_image" ? card.self_image : key === "voice_tone" ? card.voice.tone : card.voice.volume;
      entries.push({
        key,
        label,
        added: [],
        removed: [],
        scalarBefore: beforeValue ?? baseValue,
        scalarAfter: afterValue ?? baseValue,
      });
    }
  }
  return entries;
}

/** 持久化侧的 fail-closed 归一：形状/长度/数量越界一律丢弃该部分。 */
export function normalizeCardOverride(raw: unknown): AiCharacterCardOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { append: {}, remove: {} };
  const record = raw as Record<string, unknown>;
  const scalar = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() && value.trim().length <= MAX_SCALAR_LENGTH ? value.trim() : undefined;
  const listFor = (key: AiCharacterCardListKey): readonly string[] | undefined => {
    const value = (record.append as Record<string, unknown> | undefined)?.[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return undefined;
    const items = value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()) && item.trim().length <= MAX_ENTRY_LENGTH)
      .map((item) => item.trim());
    return items.length > 0 ? [...new Set(items)].slice(0, MAX_APPEND_PER_LIST) : undefined;
  };
  const removeFor = (key: AiCharacterCardListKey): readonly string[] | undefined => {
    const value = (record.remove as Record<string, unknown> | undefined)?.[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === "string" && Boolean(item));
    return items.length > 0 ? [...new Set(items)].slice(0, 12) : undefined;
  };
  const append = Object.fromEntries(CARD_LIST_KEYS.map((key) => [key, listFor(key)]).filter(([, value]) => value !== undefined));
  const remove = Object.fromEntries(CARD_LIST_KEYS.map((key) => [key, removeFor(key)]).filter(([, value]) => value !== undefined));
  return {
    ...(scalar(record.self_image) !== undefined ? { self_image: scalar(record.self_image) } : {}),
    ...(scalar(record.voice_tone) !== undefined ? { voice_tone: scalar(record.voice_tone) } : {}),
    ...(scalar(record.voice_volume) !== undefined ? { voice_volume: scalar(record.voice_volume) } : {}),
    append: append as AiCharacterCardOverride["append"],
    remove: remove as AiCharacterCardOverride["remove"],
  };
}

/** 有效卡的编号视图，供模型按编号移除。 */
export function cardEditPromptView(card: AiCharacterCard, override: AiCharacterCardOverride): string {
  const lines: string[] = [];
  const scalarText = (value: string): string => value || "（空）";
  lines.push(`self_image: ${scalarText(override.self_image ?? card.self_image)}`);
  lines.push(`voice_tone: ${scalarText(override.voice_tone ?? card.voice.tone)}`);
  lines.push(`voice_volume: ${scalarText(override.voice_volume ?? card.voice.volume)}`);
  for (const key of CARD_LIST_KEYS) {
    const list = effectiveList(card, override, key);
    lines.push(list.length > 0
      ? list.map((text, index) => `${key}-${index + 1}: ${text}`).join("\n")
      : `${key}: （空）`);
  }
  return lines.join("\n");
}

/** 角色卡编辑的写作与输出规则；玩家可编辑块 `l1.card`。字段清单由
 *  CARD_LIST_KEYS 插值，所以和解析器用的键名永远一致。 */
export function buildCardEditSystemPrompt(): string {
  return [
    "你是角色卡编辑器。把玩家意图结构化进给定的角色卡字段，不改动其他字段，不发明玩家没表达的内容。",
    `列表字段（append 追加、remove 按编号移除）：${CARD_LIST_KEYS.map((key) => `${key} ${CARD_LIST_LABELS[key]}`).join(" / ")}。`,
    `标量字段（set 整体替换）：self_image 自我认知 / voice_tone 语气 / voice_volume 音量。`,
    "规则：列表条目一行一条、不超过 120 字；与意图无关的既有条目保留；与意图冲突的旧条目用 remove 移除其编号；合并重复含义的条目。",
    '输出 JSON：{"set":{"voice_tone":"..."},"append":{"core_traits":["..."]},"remove":["core_traits-2"]}；三个键都可省略；只输出 JSON。',
  ].join("\n");
}

export function buildCardEditCompletion(input: {
  card: AiCharacterCard;
  override: AiCharacterCardOverride;
  playerIntent: string;
  settings: AiSettings;
}): AiCompletionRequest {
  const charaName = input.card.call_name;
  return {
    system: promptText(input.settings, "l1.card", buildCardEditSystemPrompt()),
    user: `角色：${charaName}\n当前卡片：\n${cardEditPromptView(input.card, input.override)}\n玩家意图：${input.playerIntent.slice(0, 1000)}`,
    temperature: input.settings.temperature,
    maxTokens: Math.min(input.settings.maxTokens, 3000),
    jsonMode: true,
  };
}

/** Fail-closed：未知键、越界长度/数量、不存在的编号一律拒绝。 */
export function parseCardEdit(
  raw: string,
  card: AiCharacterCard,
  currentOverride: AiCharacterCardOverride,
): AiCharacterCardOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody(raw));
  } catch {
    throw new Error("回复不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("回复结构无效");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "set" && key !== "append" && key !== "remove")) {
    throw new Error("回复包含未知字段");
  }

  const set: Partial<Pick<AiCharacterCardOverride, "self_image" | "voice_tone" | "voice_volume">> = {};
  if (record.set !== undefined) {
    if (!record.set || typeof record.set !== "object" || Array.isArray(record.set)) throw new Error("set 无效");
    const setRecord = record.set as Record<string, unknown>;
    if (Object.keys(setRecord).some((key) => !(key in CARD_SCALAR_LABELS))) throw new Error("set 包含未知字段");
    for (const [key, value] of Object.entries(setRecord)) {
      if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_SCALAR_LENGTH) {
        throw new Error(`set.${key} 必须为 1-${MAX_SCALAR_LENGTH} 字`);
      }
      if (key === "self_image") set.self_image = value.trim();
      else if (key === "voice_tone") set.voice_tone = value.trim();
      else set.voice_volume = value.trim();
    }
  }

  const append: Partial<Record<AiCharacterCardListKey, readonly string[]>> = {};
  if (record.append !== undefined) {
    if (!record.append || typeof record.append !== "object" || Array.isArray(record.append)) throw new Error("append 无效");
    const appendRecord = record.append as Record<string, unknown>;
    if (Object.keys(appendRecord).some((key) => !CARD_LIST_KEYS.includes(key as AiCharacterCardListKey))) {
      throw new Error("append 包含未知字段");
    }
    for (const [key, value] of Object.entries(appendRecord)) {
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.length < 1 || value.length > MAX_APPEND_PER_LIST) {
        throw new Error(`append.${key} 必须为 1-${MAX_APPEND_PER_LIST} 条`);
      }
      const items = value.map((item) => {
        if (typeof item !== "string") throw new Error(`append.${key} 条目不是字符串`);
        const trimmed = item.trim();
        if (!trimmed || trimmed.length > MAX_ENTRY_LENGTH) throw new Error(`append.${key} 条目必须为 1-${MAX_ENTRY_LENGTH} 字`);
        return trimmed;
      });
      append[key as AiCharacterCardListKey] = [...new Set(items)];
    }
  }

  const remove: Partial<Record<AiCharacterCardListKey, readonly string[]>> = {};
  if (record.remove !== undefined) {
    if (!Array.isArray(record.remove) || record.remove.length > 12) throw new Error("remove 无效");
    for (const rawId of record.remove) {
      if (typeof rawId !== "string") throw new Error("remove 编号无效");
      const match = /^([a-z_]+)-(\d+)$/.exec(rawId);
      const key = match?.[1] as AiCharacterCardListKey | undefined;
      const index = match ? Number(match[2]) - 1 : -1;
      if (!key || !CARD_LIST_KEYS.includes(key) || index < 0) throw new Error(`remove 引用无效 ${rawId}`);
      const effective = effectiveList(card, currentOverride, key);
      if (index >= effective.length) throw new Error(`remove 引用不存在的条目 ${rawId}`);
      const text = effective[index]!;
      remove[key] = [...(remove[key] ?? []), text];
    }
  }

  const hasSet = Object.keys(set).length > 0;
  const hasAppend = Object.keys(append).length > 0;
  const hasRemove = Object.keys(remove).length > 0;
  if (!hasSet && !hasAppend && !hasRemove) throw new Error("模型没有提出任何修改");
  return {
    ...(hasSet ? set : {}),
    ...(hasAppend ? { append } : {}),
    ...(hasRemove ? { remove } : {}),
  };
}
