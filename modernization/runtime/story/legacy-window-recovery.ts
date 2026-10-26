import type { GameState } from "../state/game-state.js";
import { ensureArcMaintenance } from "./arc-maintenance.js";
import { isOpenStoryProgram } from "./reconciliation.js";

/** One-time v34 repair. The old foreground gate could miss an untouched event
 * while its window was still open, then expire its Arc. Real missed deadlines,
 * explicit cancellations and executed graphs must never be replayed. */
export function recoverPrematurelyMissedNarrativeWindows(state: GameState): string[] {
  if (isOpenStoryProgram(state.storyProgram)) return [];
  const warnings: string[] = [];
  const now = state.time.tickValue;
  for (const arc of state.storyArcs ?? []) {
    if (arc.status !== "active" && !(arc.status === "expired" && arc.lifecycleReason === "arc deadline expired")) continue;
    if (arc.status === "expired" && (state.storyArcs ?? []).filter((entry) => entry.status === "active" || entry.status === "paused").length >= 3) continue;
    const linked = (state.narrativeEvents ?? []).filter((event) => event.arcId === arc.id);
    if (linked.some((event) => ["scheduled", "ready", "active"].includes(event.status))) continue;
    const latest = linked.sort((a, b) => b.createdAtTick - a.createdAtTick || b.windowStartTick - a.windowStartTick)[0];
    // A later background promise already replaced this old encounter. Keep
    // the current phase/places instead of resurrecting its earlier opening.
    if (latest && arc.status === "active"
      && (arc.maintenance?.nextChance?.earliestTick ?? 0) > latest.windowEndTick) continue;
    if (!latest || latest.status !== "missed" || latest.deferCount !== 1
      || latest.lastMissedTick === undefined || latest.lastMissedTick < latest.windowStartTick
      || latest.lastMissedTick >= latest.windowEndTick
      || latest.program.status !== "aborted" || latest.program.cursorNodeId !== latest.program.startNodeId
      || latest.program.executedNodeIds.length > 0 || latest.program.executedCapabilityIds.length > 0
      || (latest.program.rounds?.length ?? 0) > 0
      || !latest.program.actorIds.some((id) => id > 0 && !!state.charas[id])
      || latest.program.actorIds.some((id) => id > 0 && !state.charas[id])) continue;
    if (now > latest.windowEndTick) {
      latest.windowStartTick = now;
      latest.windowEndTick = now + 6 * 60;
    }
    latest.status = "scheduled";
    latest.deferCount = 0;
    latest.program.status = "active";
    delete latest.lastMissedTick;
    delete latest.nextAttemptTick;
    delete latest.missCount;
    latest.lifecycleReason = "restored prematurely missed unstarted event";
    arc.status = "active";
    arc.deadlineTick = Math.max(arc.deadlineTick, latest.windowEndTick);
    arc.lifecycleReason = latest.lifecycleReason;
    const maintenance = ensureArcMaintenance(arc);
    maintenance.disposition = "wait";
    maintenance.nextChance = { earliestTick: latest.windowStartTick, latestTick: latest.windowEndTick, locationIds: [...latest.locationIds], onMiss: "defer" };
    maintenance.waitOn = { kind: "event", refId: latest.id, latestTick: latest.windowEndTick };
    warnings.push(`${latest.id}: restored prematurely missed unstarted narrative window`);
  }
  return warnings;
}
