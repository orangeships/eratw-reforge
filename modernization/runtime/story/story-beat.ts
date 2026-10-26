/**
 * The one place a story-beat record is built.
 *
 * A story produces opening/end beats plus bounded capability receipts, and all
 * use the same shape: the OPENING (`beatId: "opening"`, written when the
 * player accepts a situation and the cast is staged), each round's END node,
 * and a receipt for a capability that actually settled. They must agree on the
 * invariants that make the record readable downstream, so the derivation lives
 * here rather than being written out in each caller:
 *
 *   - `actorIds` is never empty (a solo beat still names the protagonist),
 *   - the actors are a subset of the participants,
 *   - `summary` fits `MAX_SUMMARY_LENGTH`, because callers routinely hand us
 *     text with a larger cap of its own (the opening prose allows 800).
 *
 * Keeping the slice inside the builder is deliberate: `acceptExperience`
 * rejects an over-long summary as a validation failure, and the end-node path
 * treats any diagnostic as fatal, so a caller that forgot to slice would abort
 * a live story rather than lose a sentence.
 */
import { ACCEPTED_EXPERIENCE_SCHEMA_VERSION, MAX_SUMMARY_LENGTH, type AcceptedExperience } from "../experience.js";
import type { GameState } from "../state/game-state.js";
import { ensureArcMaintenance } from "./arc-maintenance.js";
import type { StoryProgramV2 } from "./types.js";

export interface StoryBeatOptions {
  /** Identifies the beat within the program; also names the record's id. */
  beatId: string;
  outcomeId: string;
  summary: string;
  startTick: number;
  endTick: number;
  /** Defaults to the program's own scene. */
  locationIds?: readonly string[];
}

export function buildStoryBeatExperience(
  program: StoryProgramV2,
  options: StoryBeatOptions,
): AcceptedExperience {
  const participants = [...new Set([0, ...program.actorIds])];
  const actorIds = program.actorIds.length > 0 ? [...program.actorIds] : [0];
  const id = `${program.id}:${options.beatId}`;
  return {
    id,
    schemaVersion: ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
    factClass: "story-runtime",
    kind: "story-beat",
    startTick: options.startTick,
    endTick: options.endTick,
    actorIds,
    participantIds: participants,
    locationIds: [...(options.locationIds ?? program.locationIds)],
    visibility: { participantIds: participants, witnessIds: [], public: false },
    sourceIds: [id],
    contextHash: program.contextHash,
    payload: {
      summary: options.summary.slice(0, MAX_SUMMARY_LENGTH),
      programId: program.id,
      beatId: options.beatId,
      outcomeId: options.outcomeId,
    },
  };
}

/** Record what actually happened at a round boundary, so a later day can read
 * this Arc's history without replaying the program that produced it. Only
 * material already accepted as having happened is written. */
export function recordArcScene(state: GameState, program: StoryProgramV2, outcomeId: string, summary: string): void {
  const arc = program.arcId ? state.storyArcs?.find((entry) => entry.id === program.arcId) : undefined;
  if (!arc) return;
  const maintenance = ensureArcMaintenance(arc);
  const atTick = state.time.tickValue;
  if (maintenance.recentScenes.some((entry) => entry.programId === program.id && entry.outcomeId === outcomeId && entry.atTick === atTick)) return;
  maintenance.recentScenes = [...maintenance.recentScenes, {
    programId: program.id,
    outcomeId,
    summary: summary.slice(0, MAX_SUMMARY_LENGTH),
    atTick,
  }].slice(-16);
}
