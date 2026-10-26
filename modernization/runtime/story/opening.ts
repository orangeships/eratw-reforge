import { acceptExperience } from "../experience.js";
import type { GameState } from "../state/game-state.js";
import { projectDaytimeAgentFacts } from "../agent/daytime-sync.js";
import { buildStoryBeatExperience, recordArcScene } from "./story-beat.js";
import type { StoryProgramV2 } from "./types.js";
import type { NarrativeEventPresentationV1 } from "./director.js";

/** Record the premise the player has just been shown as something that really
 * happened to the cast.
 *
 * The write is check-and-skip rather than fail-closed, because
 * `acceptExperience` refuses a repeated id or source and the end-node path
 * treats any diagnostic as fatal. `program.id` is derived from the tick, the
 * arc and the event, so re-accepting the same story after a save round-trip
 * reproduces the same id and must be a silent no-op, not an aborted story. */
export function recordStoryOpening(
  state: GameState,
  program: StoryProgramV2,
  sceneLocation: string,
  presentation: NarrativeEventPresentationV1 | undefined,
): void {
  const summary = (presentation?.introText ?? program.title).trim();
  const experience = buildStoryBeatExperience(program, {
    beatId: "opening",
    outcomeId: "opening",
    summary,
    startTick: state.time.tickValue,
    endTick: state.time.tickValue,
    locationIds: [sceneLocation],
  });
  if (!(state.acceptedExperiences ?? []).some((entry) => entry.id === experience.id)) {
    const accepted = acceptExperience(state.acceptedExperiences ?? [], experience);
    if (accepted.accepted) {
      state.acceptedExperiences = accepted.experiences;
      projectDaytimeAgentFacts(state, { relatedCharacterIds: program.actorIds });
    }
  }
  // Give a later day's director the same scene without replaying this program.
  recordArcScene(state, program, "opening", summary);
}
