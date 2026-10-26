import type { GameState } from "../state/game-state.js";
import { narrativeContextHash } from "./snapshot.js";
import { hookBlockReason, waitForNextNarrativeEvolution } from "./dialogue-hook.js";
import type { StoryGraphDialogueHookNode, StoryProgramV2 } from "./types.js";

export function programDialogueHookId(program: StoryProgramV2, nodeId: string): string {
  return `l3-hook:${narrativeContextHash({ program: program.id, round: program.roundIndex ?? 0, context: program.contextHash, nodeId })}`;
}

/** Pause at a conversational objective until an ordinary L1 reply really expresses it. */
export function advanceProgramDialogue(state: GameState, program: StoryProgramV2, node: StoryGraphDialogueHookNode): { hookId: string; expressed: boolean } {
  const hookId = programDialogueHookId(program, node.id);
  let hook = state.narrativeHooks?.find(entry => entry.id === hookId);
  if (!hook) {
    state.narrativeHooks ??= [];
    if (state.narrativeHooks.length >= 24) state.narrativeHooks = state.narrativeHooks.filter(entry =>
      entry.id === programDialogueHookId(program, entry.sceneId)
      || state.storylets?.some(owner => owner.status === "active" && owner.id === entry.storyId && owner.currentSceneId === entry.sceneId)
      || (!["resolved", "declined", "expired", "cancelled"].includes(entry.status)
        && !state.narrativeEvents?.some(event => event.program.id === entry.storyId && event.status === "cancelled")));
    const event = state.narrativeEvents?.find(entry => entry.program.id === program.id);
    hook = { version: 1, id: hookId, storyId: program.id, sceneId: node.id, speakerId: node.actorId,
      revision: 1, priority: 20, objective: node.objective, status: "pending", factIds: [],
      guard: { locationIds: [program.locationIds[0]!], ...(event ? { endTick: event.windowEndTick } : {}) },
      completion: { kind: "expression" } };
    if (state.narrativeHooks.length >= 24) {
      waitForNextNarrativeEvolution(state, hook, "剧情钩子名额不足");
      return { hookId, expressed: false };
    }
    state.narrativeHooks.push(hook);
  }
  if (hook.status === "resolved" && hook.lastReceipt?.disposition === "raise") return { hookId, expressed: true };
  const blocked = hookBlockReason(state, hook);
  if (blocked && ["角色不在同一地点", "当前无法进行剧情交流", "尚未到达剧情地点", "尚未到达剧情时间"].includes(blocked)) {
    hook.status = "blocked";
    return { hookId, expressed: false };
  }
  if (blocked || ["deferred", "declined", "expired", "cancelled"].includes(hook.status)) {
    if (blocked) hook.status = "blocked";
    waitForNextNarrativeEvolution(state, hook, blocked ?? "本次剧情目标未被引出");
  }
  return { hookId, expressed: false };
}
