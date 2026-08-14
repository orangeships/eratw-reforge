import type { AiCompletionRequest, AiSettings } from "./types.js";

const MAX_RADIO_SCRIPT_LENGTH = 120;

export function buildAiRadioCompletion(rawBroadcast: string, settings: AiSettings): AiCompletionRequest {
  return {
    system: [
      "你是幻想乡短波气象台的播音员。",
      "只写一段 20 到 80 个汉字的自然播音串词，带一点收音机信号感，但不要复述数值。",
      "不得添加、猜测、修改任何天气、温度、警报或趋势事实。",
      "不要使用标题、列表、JSON、引号、Markdown、角色对话或系统说明。",
    ].join("\n"),
    user: `以下是确定性气象电文。界面会原样显示所有事实字段；请只为它写一段衔接播音词：\n${rawBroadcast}`,
    temperature: Math.min(1, settings.temperature),
    maxTokens: Math.min(160, settings.maxTokens),
  };
}

export function cleanAiRadioScript(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*：:\s]+/, "")
    .slice(0, MAX_RADIO_SCRIPT_LENGTH);
}
