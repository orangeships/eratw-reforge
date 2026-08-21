import type { AiInteractionHistoryEntry } from "./types.js";

/**
 * History is observer-scoped: every current participant must have taken part
 * in, or witnessed, an entry. This prevents unrelated characters from being
 * handed private conversation text merely because it occurred recently.
 */
export function interactionHistoryVisibleTo(
  entry: AiInteractionHistoryEntry,
  currentParticipantIds: readonly number[],
): boolean {
  const visibleTo = new Set([...entry.participantIds, ...entry.witnessIds]);
  return currentParticipantIds.every((participantId) => visibleTo.has(participantId));
}

export function relevantInteractionHistory(
  history: readonly AiInteractionHistoryEntry[],
  currentParticipantIds: readonly number[],
  excludeId?: string,
  limit = 6,
): AiInteractionHistoryEntry[] {
  return history
    .filter((entry) => entry.id !== excludeId)
    .filter((entry) => interactionHistoryVisibleTo(entry, currentParticipantIds))
    .slice(-limit);
}

export function formatInteractionHistoryEntry(entry: AiInteractionHistoryEntry): string {
  if (entry.source === "command") {
    return `[${entry.commandNo}]${entry.commandLabel}：${entry.visibleLines.join(" / ") || "没有可见对白"}`;
  }
  return `场景动态（${entry.mode}/${entry.initiativeKind}）：${entry.visibleLines.join(" / ")}`;
}
