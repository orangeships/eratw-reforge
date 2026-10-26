import type { StoryArcEvolutionStateV1, StoryArcInstanceV1, StoryArcMaintenanceV1 } from "./types.js";

/** A fresh maintenance record for an Arc.
 *
 * Nothing is inferred. An Arc that has not run yet has no conflict, no
 * confirmed changes, and no plan, so an unrecorded Arc and an Arc with an
 * empty record mean the same thing: nothing is known. Callers must not use
 * this to fabricate beliefs, secrets, or propagation history. */
export function createArcMaintenance(): StoryArcMaintenanceV1 {
  return {
    conflict: null,
    confirmedChanges: [],
    disposition: "continue",
    waitOn: null,
    nextChance: null,
    lastFailure: null,
    recentScenes: [],
    consumedEvidenceIds: [],
    plannedBeats: [],
  };
}

/** Arcs loaded from pre-schema-31 saves have no record yet. A writer that is
 * about to record something real creates one on the spot. Read paths must use
 * `arc.maintenance?.x` instead, so they never create a record as a side effect. */
export function ensureArcMaintenance(arc: StoryArcInstanceV1): StoryArcMaintenanceV1 {
  arc.maintenance ??= createArcMaintenance();
  return arc.maintenance;
}

/** Materialize only the automatic-evolution bookkeeping that is about to be
 * written. Read paths must continue to treat an absent record as absent. */
export function ensureArcEvolution(arc: StoryArcInstanceV1): StoryArcEvolutionStateV1 {
  const maintenance = ensureArcMaintenance(arc);
  maintenance.evolution ??= { attemptsToday: 0, pendingPlayerIntents: [] };
  return maintenance.evolution;
}
