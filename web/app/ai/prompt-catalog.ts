/** Player-editable AI prompt catalog（当前只覆盖 L1）。
 *
 * 每个 L1 路由的作者提示词用一个 slot id 寻址。运行时的事实抽取、人物卡投影、
 * 输出合同与校验器仍归代码所有：可替换的只有这里的作者文字。
 *
 * 本模块是**叶子**，不能 import 任何路由模块，否则
 * `catalog → 路由 → catalog` 成环。所以 `promptText` 的默认值必填——目录本身
 * 不知道任何默认值；面板用的注册表（prompt-defaults.ts）从各路由模块取默认
 * 值，因此面板显示的文字不可能和实际发送的文字漂移。
 *
 * 只有被玩家改过的块会进 settings.promptOverrides；默认文本不进存档。 */

export type AiPromptLayer = "l1";
export type AiPromptMode = "daily" | "h";

export type AiPromptSlotId =
  | "l1.kojo.contract"
  | "l1.kojo.writing"
  | "l1.kojo.context"
  | "l1.kojo.task.open-conversation"
  | "l1.kojo.task.player-response"
  | "l1.kojo.task.settled-action"
  | "l1.kojo.task.counter-initiative"
  | "l1.kojo.task.event-invitation"
  | "l1.kojo.task.time-stopped"
  | "l1.kojo.scene.h.contract"
  | "l1.kojo.scene.h.base-writing"
  | "l1.kojo.scene.h.base-context"
  | "l1.kojo.scene.h.task.time-stopped"
  | "l1.kojo.scene.h.task"
  | "l1.kojo.scene.h.context"
  | "l1.ambient"
  | "l1.radio"
  | "l1.card"
  | "l1.mob.intro"
  | "l1.mob.persona";

export type AiPromptOverrides = Partial<Record<AiPromptSlotId, string>>;

export interface AiPromptSlotDef {
  id: AiPromptSlotId;
  layer: AiPromptLayer;
  /** 面板显示的编辑模式；省略即为日常。 */
  mode?: AiPromptMode;
  /** 面板里的折叠分组标题。 */
  group: string;
  /** 这个块的名字。 */
  title: string;
  /** 块内含 provider 输出格式行：改坏会让解析失败。 */
  hasOutputContract?: boolean;
}

export const AI_PROMPT_LAYER_TITLES: Record<AiPromptLayer, string> = {
  l1: "L1 · 即时表现",
};

export const AI_PROMPT_LAYER_ORDER: readonly AiPromptLayer[] = ["l1"];
export const AI_PROMPT_MODE_TITLES: Record<AiPromptMode, string> = {
  daily: "日常与其他",
  h: "H 场景",
};

export const AI_PROMPT_SLOT_LIMIT = 12_000;

export const AI_PROMPT_SLOTS: readonly AiPromptSlotDef[] = [
  { id: "l1.kojo.contract", layer: "l1", group: "口上（命令 / 自由对话）", title: "创作方向" },
  { id: "l1.kojo.writing", layer: "l1", group: "口上（命令 / 自由对话）", title: "口上写法" },
  // 输出合同已移出本块，改由 `KOJO_OUTPUT_CONTRACT_PROMPT` 拥有并拼在 system 末尾，
  // 所以这里不再带 hasOutputContract 警告。
  { id: "l1.kojo.context", layer: "l1", group: "口上（命令 / 自由对话）", title: "上下文" },
  { id: "l1.kojo.task.open-conversation", layer: "l1", group: "口上 · 本轮任务", title: "交流" },
  { id: "l1.kojo.task.player-response", layer: "l1", group: "口上 · 本轮任务", title: "回应玩家" },
  { id: "l1.kojo.task.settled-action", layer: "l1", group: "口上 · 本轮任务", title: "已结算行动" },
  { id: "l1.kojo.task.counter-initiative", layer: "l1", group: "口上 · 本轮任务", title: "角色主动行动" },
  { id: "l1.kojo.task.event-invitation", layer: "l1", group: "口上 · 本轮任务", title: "约会邀请" },
  { id: "l1.kojo.task.time-stopped", layer: "l1", group: "口上 · 本轮任务", title: "时停" },
  // H 有独立的基础块；任务替换通用任务，上下文按条件补充。输出合同仍在 system 末尾，
  // 由 `KOJO_OUTPUT_CONTRACT_PROMPT` 拥有，所以不带 hasOutputContract 警告。
  // H 场景写法不在目录里：它是「骨架 + 每轮轮换的技法侧重」，归代码所有
  // （`h-scene-writing.ts`），与直接描写授权同级，玩家不能覆盖或取消。
  { id: "l1.kojo.scene.h.contract", layer: "l1", mode: "h", group: "H 场景 · 基础", title: "身份与目标" },
  { id: "l1.kojo.scene.h.base-writing", layer: "l1", mode: "h", group: "H 场景 · 基础", title: "口上通用写法" },
  { id: "l1.kojo.scene.h.base-context", layer: "l1", mode: "h", group: "H 场景 · 基础", title: "通用上下文说明" },
  { id: "l1.kojo.scene.h.task", layer: "l1", mode: "h", group: "H 场景 · 本轮", title: "H 场景本轮任务" },
  { id: "l1.kojo.scene.h.task.time-stopped", layer: "l1", mode: "h", group: "H 场景 · 本轮", title: "H 场景时停任务" },
  { id: "l1.kojo.scene.h.context", layer: "l1", mode: "h", group: "H 场景 · 本轮", title: "H 场景上下文说明" },
  { id: "l1.ambient", layer: "l1", group: "场景与媒体", title: "场景主动口上" },
  { id: "l1.radio", layer: "l1", group: "场景与媒体", title: "收音机串词", hasOutputContract: true },
  { id: "l1.card", layer: "l1", group: "角色资料", title: "角色卡编辑", hasOutputContract: true },
  { id: "l1.mob.intro", layer: "l1", group: "角色资料", title: "路人资料文案", hasOutputContract: true },
  { id: "l1.mob.persona", layer: "l1", group: "角色资料", title: "路人基础画像", hasOutputContract: true },
];

/** 只保留已知 slot、非空、限长。空/纯空白视为「未覆盖」——「恢复默认」就是
 *  删除该键，这样误按 Ctrl+A+Delete 不会静默砍掉一个承载输出合同的块。 */
export function normalizeAiPromptOverrides(value: unknown): AiPromptOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const overrides: AiPromptOverrides = {};
  for (const slot of AI_PROMPT_SLOTS) {
    const text = source[slot.id];
    if (typeof text !== "string" || !text.trim()) continue;
    overrides[slot.id] = text.slice(0, AI_PROMPT_SLOT_LIMIT);
  }
  return overrides;
}

/** Override-else-default. `defaultText` 由拥有该提示词的路由模块提供，目录本身
 *  不知道任何默认值。 */
export function promptText(
  settings: { promptOverrides?: AiPromptOverrides | undefined } | undefined,
  id: AiPromptSlotId,
  defaultText: string,
): string {
  const override = settings?.promptOverrides?.[id];
  return typeof override === "string" && override.trim() ? override : defaultText;
}

/** 写入一个块；空/纯空白等价于恢复默认。 */
export function withPromptOverride(
  overrides: AiPromptOverrides,
  id: AiPromptSlotId,
  text: string,
): AiPromptOverrides {
  const next = { ...overrides };
  if (text.trim()) next[id] = text.slice(0, AI_PROMPT_SLOT_LIMIT);
  else delete next[id];
  return next;
}

export function withoutPromptOverride(
  overrides: AiPromptOverrides,
  id: AiPromptSlotId,
): AiPromptOverrides {
  const next = { ...overrides };
  delete next[id];
  return next;
}
