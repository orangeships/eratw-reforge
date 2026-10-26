/** 面板用的提示词默认值注册表。
 *
 * 只被 PromptSettingsPanel（与其测试）使用。这里不复制任何文字，而是直接取各
 * 路由模块导出的默认值，所以面板显示的内容不可能和实际发送的内容漂移。
 *
 * 依赖方向：面板 → 本模块 → 各路由模块 → prompt-catalog（叶子）。无环。 */

import type { AiPromptSlotId } from "./prompt-catalog.js";
import { KOJO_CONTRACT_PROMPT, KOJO_CONTEXT_PROMPT } from "./context.js";
import { H_SCENE_BASE_WRITING_GUIDANCE, KOJO_WRITING_GUIDANCE } from "./kojo-writing.js";
import { H_SCENE_CONTRACT_PROMPT, H_SCENE_CONTEXT_GUIDANCE, H_SCENE_TASK_GUIDANCE, L1_TASK_GUIDANCE } from "./kojo-context-policy.js";
import { AMBIENT_SYSTEM_PROMPT } from "./ambient-context.js";
import { RADIO_SYSTEM_PROMPT } from "./radio-runtime.js";
import { buildCardEditSystemPrompt } from "./character-card-ai.js";
import { MOB_GIRL_INTRO_SYSTEM_PROMPT, MOB_GIRL_PERSONA_SYSTEM_PROMPT } from "./mob-girl-profile.js";

/** 键必须覆盖 AI_PROMPT_SLOTS 的全部 slot（prompt-catalog.test.ts 校验）。 */
export const AI_PROMPT_DEFAULTS: Record<AiPromptSlotId, string> = {
  "l1.kojo.contract": KOJO_CONTRACT_PROMPT,
  "l1.kojo.writing": KOJO_WRITING_GUIDANCE,
  "l1.kojo.context": KOJO_CONTEXT_PROMPT,
  "l1.kojo.task.open-conversation": L1_TASK_GUIDANCE["open-conversation"],
  "l1.kojo.task.player-response": L1_TASK_GUIDANCE["player-response"],
  "l1.kojo.task.settled-action": L1_TASK_GUIDANCE["settled-action"],
  "l1.kojo.task.counter-initiative": L1_TASK_GUIDANCE["counter-initiative"],
  "l1.kojo.task.event-invitation": L1_TASK_GUIDANCE["event-invitation"],
  "l1.kojo.task.time-stopped": L1_TASK_GUIDANCE["time-stopped"],
  "l1.kojo.scene.h.contract": H_SCENE_CONTRACT_PROMPT,
  "l1.kojo.scene.h.base-writing": H_SCENE_BASE_WRITING_GUIDANCE,
  "l1.kojo.scene.h.base-context": KOJO_CONTEXT_PROMPT,
  "l1.kojo.scene.h.task": H_SCENE_TASK_GUIDANCE,
  "l1.kojo.scene.h.task.time-stopped": L1_TASK_GUIDANCE["time-stopped"],
  "l1.kojo.scene.h.context": H_SCENE_CONTEXT_GUIDANCE,
  "l1.ambient": AMBIENT_SYSTEM_PROMPT,
  "l1.radio": RADIO_SYSTEM_PROMPT,
  "l1.card": buildCardEditSystemPrompt(),
  "l1.mob.intro": MOB_GIRL_INTRO_SYSTEM_PROMPT,
  "l1.mob.persona": MOB_GIRL_PERSONA_SYSTEM_PROMPT,
};
