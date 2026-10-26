/**
 * H 场景的直接描写授权。
 *
 * **归代码所有**，不是可编辑 slot——和事实边界、解析边界同类：玩家可以改口上
 * 文字，但不应该能单方面取消或无限扩大它。理由同 `player-facing-prose.ts`
 * （「自定义提示词不能移除它」）。
 *
 * 触发条件是 `sceneMode === "h" && !timeStopped && !unconscious`。时停与睡眠**不**
 * 追加授权：进入一个场景不构成角色清醒、愿意回应或允许某项具体动作的证据，而且
 * 既有的时停/睡眠约束文字已经在那里，不需要第二套说法。
 *
 * 本模块只加**肯定性授权**——之前提示词里从来没有「非露骨」限制可拆，全仓
 * `KOJO_OUTPUT_CONTRACT_PROMPT` / `KOJO_WRITING_GUIDANCE` /
 * `PLAYER_FACING_PROSE_GUIDANCE` 都没有暴露度约束。
 *
 * 第二句曾以「不要为了露骨而让人物做出她此刻不会做的事」收尾，已删除：那句是尺度的
 * **自我审查**，会让模型在已授权的场景里替角色预先否决。删掉的是这一层，**不是**角色
 * 一致性——「服从角色卡、当前关系与情绪」与「要与已提供的事实一致」仍在，角色不会因此
 * 做出与卡片或关系不符的反应。
 */

export type PresentationScope = "explicit" | "restrained";

export const H_SCENE_EXPLICIT_AUTHORIZATION = [
  "这是一个已经成立的情色场景：允许直接描写身体反应、行为过程与感官细节，不必留白或只作暗示。",
  "尺度服从角色卡、当前关系与情绪——她此刻的投入、抗拒、羞耻或疲惫要与已提供的事实一致。",
  "事实边界不变：本轮已结算的动作、主体身份和结果不得改写，仍须遵守上面的篇幅参考与 JSON lines 合同。",
].join("\n");

/**
 * 数据侧与 system 段**同源同一布尔**，避免出现「system 说可以、数据说 restrained」
 * 这种自相矛盾。加这个字段不改变 JSON 输出形状（输出合同仍只描述 lines / choice）。
 */
export function hSceneAuthorization(input: {
  sceneMode: "ordinary" | "h";
  timeStopped: boolean;
  unconscious: boolean;
}): { scope: PresentationScope; block: string | null } {
  if (input.sceneMode !== "h" || input.timeStopped || input.unconscious) {
    return { scope: "restrained", block: null };
  }
  return { scope: "explicit", block: H_SCENE_EXPLICIT_AUTHORIZATION };
}
