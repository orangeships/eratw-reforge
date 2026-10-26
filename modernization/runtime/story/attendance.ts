import type { GameState } from "../state/game-state.js";
import { CFLAG_ID } from "../state/settlement.js";

/** Read live world ownership; a story never wakes a cast member or ends a job. */
export function narrativeCastWaitReason(state: Readonly<GameState>, actorIds: readonly number[], locationId = state.master.location): string | null {
  for (const id of actorIds) {
    const slot = id === 0 ? state.master : state.charas[id];
    if (!slot) return "等待参与角色到场";
    const flags = slot.state.CFLAG;
    if (flags[CFLAG_ID.睡眠]) return `${slot.callName}正在睡眠，等待醒来后集合`;
    const mustTravel = slot.location !== locationId;
    // An on-site conversation does not end a shift, consume activity time or
    // release a follower. Only relocation needs those owners to become idle.
    if (mustTravel && state.workRuntime?.entries.some(entry => entry.charaNum === id && entry.status === "active")) return `${slot.callName}正在工作，等待空闲后集合`;
    if (mustTravel && (state.freeActions?.[id]?.remainingMinutes ?? 0) > 0) return `${slot.callName}正在活动，等待空闲后集合`;
    if (flags[CFLAG_ID.诶嘿嘿] || flags[CFLAG_ID.陪睡中] || flags[CFLAG_ID.衰弱] || flags[CFLAG_ID.延迟]) return `${slot.callName}暂时无法脱身，等待空闲后集合`;
    if (mustTravel && id !== 0 && flags[CFLAG_ID.同行]) return `${slot.callName}正在同行，等待空闲后集合`;
  }
  return null;
}
