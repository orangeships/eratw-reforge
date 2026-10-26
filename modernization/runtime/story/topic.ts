import type { GameState } from "../state/game-state.js";
import type { AcceptedExperience } from "../experience.js";
import { isExperienceVisibleTo } from "../experience.js";

/** How far back an already-known story beat may be raised again. Three days
 * spans a multi-day arc and keeps a month-old beat from resurfacing as news. */
const TOPIC_EXPERIENCE_WINDOW_TICKS = 3 * 1440;

export type NarrativeTopicSource = "ready-event" | "known-experience";

/** One narrative subject a character may raise in an ordinary conversation.
 *
 * This is the only narrative channel that reaches a character's own dialogue.
 * It is built from facts the character already holds, never from the director's
 * private plan: `StoryArcInstanceV1.maintenance` is read by the director and is
 * deliberately not consulted here. */
export interface NarrativeTopicV1 {
  /** Stable id of the source, so the block stays traceable to one record. */
  sourceId: string;
  source: NarrativeTopicSource;
  /** Objective description of what this character may bring up. */
  topic: string;
  /** Fact ids this character is permitted to state aloud. */
  canReveal: string[];
  /** Claims this character must not make. */
  mustNotClaim: string[];
}

/**
 * Select the narrative subject a character may raise, or null when there is
 * nothing they legitimately know.
 *
 * Visibility is never re-derived: candidates are filtered through
 * `isExperienceVisibleTo`, the single source of truth, so a character can only
 * ever be handed something they already hold. An active event returns null on
 * purpose — the L1 prompt already carries its `event_context`, and the
 * directive's `revealableFactIds` / `forbiddenClaims` bound what may be said.
 *
 * Note for the propagation rule: AI dialogue does not produce an
 * `AcceptedExperience`, so a model that names a fact cannot widen who knows it.
 * The receiving side stays a record the runtime writes, which is why there is no
 * "exceeded revealableFactIds" rejection to perform here.
 */
export function selectNarrativeTopic(
  state: Readonly<GameState>,
  characterId: number,
): NarrativeTopicV1 | null {
  if (characterId <= 0) return null;
  const directive = state.activeEventContext;
  if (directive
    && directive.participantIds.includes(characterId)
    && directive.expiresAtTick >= state.time.tickValue
    && directive.openedAtTick <= state.time.tickValue) return null;

  // A story the player has already been told about is the most actionable
  // subject: the character can raise the pending invitation in their own words.
  const ready = (state.narrativeEvents ?? [])
    .filter((event) => event.status === "ready" && event.participantIds.includes(characterId))
    .sort((left, right) => left.windowStartTick - right.windowStartTick || left.id.localeCompare(right.id))[0];
  if (ready) {
    const topic = (ready.objectiveText ?? ready.introText ?? ready.title).trim();
    if (topic) return { sourceId: ready.id, source: "ready-event", topic, canReveal: [], mustNotClaim: [] };
  }

  const known = (state.acceptedExperiences ?? [])
    .filter((experience) => experience.kind === "story-beat"
      && experience.endTick <= state.time.tickValue
      && experience.endTick >= state.time.tickValue - TOPIC_EXPERIENCE_WINDOW_TICKS
      && isExperienceVisibleTo(experience, characterId))
    .sort((left, right) => right.endTick - left.endTick || left.id.localeCompare(right.id))[0];
  const knownTopic = known ? topicTextOf(known) : "";
  if (known && knownTopic) {
    return { sourceId: known.id, source: "known-experience", topic: knownTopic, canReveal: [known.id], mustNotClaim: [] };
  }
  return null;
}

function topicTextOf(experience: AcceptedExperience): string {
  const payload = experience.payload as { summary?: unknown };
  return typeof payload.summary === "string" ? payload.summary.trim() : "";
}
