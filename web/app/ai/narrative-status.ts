import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { AiDebugEntry } from "./types.js";
import type { useGameStateStore } from "../state/game-state-store.js";
import { deterministicForegroundConflict, NARRATIVE_ARC_EVOLUTION_DAILY_LIMIT } from "../../../modernization/runtime/story/lifecycle.js";
import { narrativeCastWaitReason } from "../../../modernization/runtime/story/attendance.js";
import { hasPendingStoryInteraction } from "../../../modernization/runtime/story/interaction-progress.js";

export type NarrativeDirectorView = {
  /** authoring: a provider request is in flight. awaiting-choice: a player
   * menu exists. window-open/window-soon: a promised window is (or will be)
   * being served. blocked: the latest director outcome is a skip. missed: the
   * latest event for an active arc was missed. */
  state: "authoring" | "preparing" | "awaiting-choice" | "window-open" | "window-soon" | "blocked" | "missed";
  /** One player-facing line. */
  label: string;
  /** Optional supplementary line for the settings panel. */
  detail?: string;
  arcId?: string;
};

export type DirectorStatus = NonNullable<ReturnType<typeof useGameStateStore.getState>["narrativeDirectorStatus"]>;

export const NARRATIVE_PHASE_LABELS: Record<DirectorStatus["phase"], string> = {
  evolution: "后台剧情正在推演…",
  situations: "叙事导演正在规划局势…",
  opening: "叙事导演正在撰写故事…",
  graph: "正在生成剧情结构…",
  validating: "正在校验并创建剧情…",
  continuation: "故事正在展开下一幕…",
  expression: "角色正在演出…",
  commit: "等待当前对话结束后处理生成结果…",
};

export function formatNarrativeWindow(startTick: number, endTick: number): string {
  const time = (tick: number) => {
    const minute = tick % 1440;
    return `第 ${Math.floor(tick / 1440) + 1} 日 ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  };
  return `${time(startTick)} 至 ${time(endTick)}`;
}

/** Derive what the player should be told about the L3 narrative director.
 * Directions come from accepted events. An Arc promise alone cannot tell the
 * player to travel: the director may not have authored a playable event yet. */
export function describeNarrativeDirectorStatus(
  state: Readonly<GameState> | null,
  status: DirectorStatus | null,
  debugEntries: readonly AiDebugEntry[],
): NarrativeDirectorView | null {
  if (status !== null) {
    return {
      state: "authoring",
      label: NARRATIVE_PHASE_LABELS[status.phase],
      detail: status.arcId ? `正在处理故事线「${state?.storyArcs?.find(arc => arc.id === status.arcId)?.title ?? "尚未创建的新故事"}」（内部 ID：${status.arcId}）；本阶段完成前尚不能确认事件创建成功。` : undefined,
      arcId: status.arcId,
    };
  }
  if (state === null) return null;
  const now = state.time.tickValue;
  const changing = state.storyArcs?.find(a => a.status === "active" && hasPendingStoryInteraction(a));
  if (changing) {
    const budget = changing.maintenance?.evolution;
    const exhausted = budget?.attemptsDayIndex === state.time.dayIndex && (budget.attemptsToday ?? 0) >= NARRATIVE_ARC_EVOLUTION_DAILY_LIMIT;
    return { state: "preparing", label: exhausted ? "互动已保存，等待后续剧情推演" : "剧情正在接收刚才的互动",
      detail: exhausted ? "本日自动推演次数已用完，已发生的互动不会丢失。" : `「${changing.title}」将依据实际沟通调整后续发展。`, arcId: changing.id };
  }
  if (state.narrativeSituationSession != null) {
    return {
      state: "awaiting-choice",
      label: state.narrativeSituationSession.autoSelect ? "叙事导演正在选择剧情…" : "有一个剧情选择等待你决定",
    };
  }
  const pending = (state.narrativeEvents ?? [])
    .filter((event) => (event.status === "scheduled" || event.status === "ready") && now <= event.windowEndTick)
    .sort((a, b) => a.windowStartTick - b.windowStartTick || a.id.localeCompare(b.id))[0];
  if (pending) {
    const places = pending.locationIds.join("、");
    const waitReason = narrativeCastWaitReason(state, pending.participantIds, pending.locationIds[0]);
    if (waitReason) return {
      state: "blocked", label: waitReason, detail: `剧情保留，事件地点：${places}`, arcId: pending.arcId,
    };
    if (now < pending.windowStartTick) return {
      state: "window-soon", label: `剧情已准备好：${places}（约 ${Math.ceil((pending.windowStartTick - now) / 60)} 游戏小时后）`, arcId: pending.arcId,
    };
    if (deterministicForegroundConflict(state)) return {
      state: "blocked", label: "剧情已准备好，等待当前活动结束", detail: `事件地点：${places}`, arcId: pending.arcId,
    };
    return {
      state: "window-open",
      label: pending.status === "ready" ? `剧情可以开始：${places}` : `剧情已准备好，前往 ${places}`,
      detail: pending.startCommandLabel ? `开场指令：${pending.startCommandLabel}` : "到场后可开始剧情",
      arcId: pending.arcId,
    };
  }
  const latest = debugEntries.find((entry) => entry.feature === "narrative-director"
    && (entry.gameDayIndex === undefined || entry.gameDayIndex === state.time.dayIndex));
  const open = (state.storyArcs ?? []).find((arc) => arc.status === "active" && now <= arc.deadlineTick
    && arc.maintenance?.nextChance && arc.maintenance.nextChance.earliestTick <= now && now <= arc.maintenance.nextChance.latestTick);
  if (open) {
    const reason = latest?.status === "skipped" ? latest.skipReason : latest?.status === "error" ? latest.error : undefined;
    return {
      state: reason ? "blocked" : "preparing",
      label: reason ? "剧情准备暂时受阻" : "剧情机会已到，正在等待生成可触发事件",
      detail: reason ?? `候选地点：${open.maintenance!.nextChance!.locationIds.join("、")}；生成完成后会显示实际地点`,
      arcId: open.id,
    };
  }
  const soon = (state.storyArcs ?? [])
    .filter((arc) => arc.status === "active" && now <= arc.deadlineTick)
    .map((arc) => arc.maintenance?.nextChance)
    .filter((chance): chance is NonNullable<typeof chance> => chance != null && chance.earliestTick > now)
    .sort((left, right) => left.earliestTick - right.earliestTick)[0];
  if (soon) {
    const minutes = Math.ceil((soon.earliestTick - now) / 60);
    return {
      state: "window-soon",
      label: `预计剧情机会：${soon.locationIds.join("、")}（约 ${minutes} 游戏小时后，尚未生成事件）`,
    };
  }
  // The most recent director outcome decides between blocked and missed.
  if (latest?.status === "skipped" && latest.skipReason) {
    return { state: "blocked", label: "叙事暂时没有推进", detail: latest.skipReason };
  }
  const missed = (state.narrativeEvents ?? []).some((event) => {
    if (event.status !== "missed") return false;
    return (state.storyArcs ?? []).some((arc) => arc.id === event.arcId && arc.status === "active");
  });
  if (missed) {
    return { state: "missed", label: "有一个故事机会被错过了，剧情会另寻时机" };
  }
  return null;
}
