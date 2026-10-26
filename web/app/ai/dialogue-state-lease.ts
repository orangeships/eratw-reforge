import { cloneGameState, type GameState } from "../../../modernization/runtime/state/game-state.js";
import type { AgentCognitiveState } from "../../../modernization/runtime/agent/types.js";

const PRIVATE_FIELDS = ["mind", "memories", "reflections", "goals", "diaries", "pendingEpisodes", "lastUpdatedTick"] as const;

/** Only another actor's private cognition/archive may change during a deferred command. */
function worldKey(state: GameState, actor: number): string {
  const view = cloneGameState(state);
  if (view.agentRuntime) {
    for (const [id, cognition] of Object.entries(view.agentRuntime.cognitions)) if (Number(id) !== actor) {
      for (const key of PRIVATE_FIELDS) delete (cognition as Partial<AgentCognitiveState>)[key];
      delete cognition.daytimeSync;
      if (!cognition.observations.length && !cognition.currentPlan && !cognition.commissionDecision) delete view.agentRuntime.cognitions[Number(id)];
    }
    const root = view.agentRuntime.memoryArchive;
    if (root) {
      root.heads = root.heads[actor] ? { [actor]: root.heads[actor]! } : {};
      root.reflectedThrough = root.reflectedThrough[actor] ? { [actor]: root.reflectedThrough[actor]! } : {};
      // Another character's first archive may import the surviving legacy caches.
      root.legacyImported = false;
      if (!root.heads[actor] && !root.reflectedThrough[actor]) delete view.agentRuntime.memoryArchive;
    }
  }
  return JSON.stringify(view);
}

export function createNarrativeDialogueLease(base: GameState, actor: number) {
  const baseline = worldKey(base, actor);
  const original = structuredClone(base.agentRuntime?.cognitions ?? {});
  return {
    accepts(live: GameState | null): live is GameState { return !!live && worldKey(live, actor) === baseline; },
    merge(projected: GameState, live: GameState): GameState | null {
      if (worldKey(live, actor) !== baseline) return null;
      const next = cloneGameState(projected);
      if (live.agentRuntime && next.agentRuntime) {
        for (const [id, cognition] of Object.entries(live.agentRuntime.cognitions)) {
          if (Number(id) === actor) continue;
          const target = next.agentRuntime.cognitions[Number(id)] ?? structuredClone(cognition);
          const before = original[Number(id)];
          for (const key of PRIVATE_FIELDS) if (JSON.stringify(cognition[key]) !== JSON.stringify(before?.[key])) {
            if (cognition[key] === undefined) delete (target as Partial<AgentCognitiveState>)[key];
            else Object.assign(target, { [key]: structuredClone(cognition[key]) });
          }
          const currentSync = cognition.daytimeSync;
          const projectedSync = target.daytimeSync;
          if (currentSync && projectedSync && JSON.stringify(currentSync) !== JSON.stringify(before?.daytimeSync)) {
            const consumed = [...new Set([...projectedSync.consumedObservationIds, ...currentSync.consumedObservationIds])].slice(-96);
            target.daytimeSync = { ...projectedSync, revision: Math.max(projectedSync.revision, currentSync.revision) + 1,
              consumedObservationIds: consumed, pendingObservationIds: projectedSync.pendingObservationIds.filter(id => !consumed.includes(id)),
              ...(currentSync.lastReactionTick === undefined ? {} : { lastReactionTick: currentSync.lastReactionTick }) };
          } else if (currentSync && !projectedSync) target.daytimeSync = structuredClone(currentSync);
          next.agentRuntime.cognitions[Number(id)] = target;
        }
        // A removed private cognition must not be resurrected by the projection.
        for (const id of Object.keys(next.agentRuntime.cognitions)) if (Number(id) !== actor && !live.agentRuntime.cognitions[Number(id)] && original[Number(id)]) {
          const cognition = next.agentRuntime.cognitions[Number(id)]!;
          for (const key of PRIVATE_FIELDS) delete (cognition as Partial<AgentCognitiveState>)[key];
          if (!cognition.observations.length && !cognition.currentPlan && !cognition.commissionDecision) delete next.agentRuntime.cognitions[Number(id)];
        }
        const current = live.agentRuntime.memoryArchive;
        const root = next.agentRuntime.memoryArchive ?? (current ? structuredClone(current) : undefined);
        if (root) {
          for (const id of Object.keys(root.heads)) if (Number(id) !== actor) delete root.heads[Number(id)];
          for (const id of Object.keys(root.reflectedThrough)) if (Number(id) !== actor) delete root.reflectedThrough[Number(id)];
          for (const [id, head] of Object.entries(current?.heads ?? {})) if (Number(id) !== actor) root.heads[Number(id)] = head;
          for (const [id, cursor] of Object.entries(current?.reflectedThrough ?? {})) if (Number(id) !== actor) root.reflectedThrough[Number(id)] = cursor;
          root.legacyImported ||= current?.legacyImported ?? false;
          next.agentRuntime.memoryArchive = root;
        }
      }
      return next;
    },
  };
}
