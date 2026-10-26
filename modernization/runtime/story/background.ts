import type { GameState } from "../state/game-state.js";
import { NARRATIVE_PLAYER_INTENT_MAX_LENGTH, type NarrativeSituationOptionV1, type StoryArcInstanceV1, type StoryBackgroundV1 } from "./types.js";

export function isStoryBackgroundV1(value: unknown): value is StoryBackgroundV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const background = value as StoryBackgroundV1;
  return Object.keys(value).sort().join() === "createdAtTick,source,text,version"
    && background.version === 1 && ["player", "generated", "legacy"].includes(background.source)
    && typeof background.text === "string" && background.text.trim().length > 0
    && background.text.length <= NARRATIVE_PLAYER_INTENT_MAX_LENGTH
    && Number.isSafeInteger(background.createdAtTick) && background.createdAtTick >= 0;
}

/** Bind only a draft Arc. Accepted backgrounds are never replaced by a later opportunity. */
export function bindStoryBackground(
  arc: StoryArcInstanceV1,
  state: Readonly<GameState>,
  input: { playerIntent?: string; situation?: NarrativeSituationOptionV1 },
): void {
  if (arc.background) return;
  const playerText = input.playerIntent?.trim().slice(0, NARRATIVE_PLAYER_INTENT_MAX_LENGTH);
  if (playerText) {
    arc.background = { version: 1, source: "player", text: playerText, createdAtTick: state.time.tickValue };
  } else if (input.situation) {
    const situation = input.situation;
    const wants = situation.characters.map(character => {
      const name = state.charas[character.characterId]?.callName ?? state.charas[character.characterId]?.name ?? `角色#${character.characterId}`;
      return `${name}希望${character.wants}`;
    }).join("；");
    // Text originates in the validated direction, not in an additional hidden provider pass.
    const text = [situation.premise, wants, situation.tension, situation.meetingPoint].filter(Boolean).join("。")
      .slice(0, NARRATIVE_PLAYER_INTENT_MAX_LENGTH);
    arc.background = { version: 1, source: "generated", text, createdAtTick: state.time.tickValue };
  }
}

/** Pre-v39 saves cannot recover a lost full premise. Preserve only available records. */
export function backfillStoryBackgrounds(state: GameState): void {
  for (const arc of state.storyArcs ?? []) {
    if (arc.background) continue;
    const first = (state.narrativeEvents ?? []).filter(event => event.arcId === arc.id)
      .sort((a, b) => a.createdAtTick - b.createdAtTick || a.id.localeCompare(b.id))[0];
    const scenes = Array.isArray(arc.maintenance?.recentScenes) ? arc.maintenance.recentScenes : [];
    const goals = Array.isArray(arc.goals) ? arc.goals.filter(goal => typeof goal === "string") : [];
    const text = [arc.title, ...goals, first?.introText, first?.objectiveText,
      !first ? scenes[0]?.summary : undefined].filter(Boolean).join("。")
      .slice(0, NARRATIVE_PLAYER_INTENT_MAX_LENGTH);
    arc.background = { version: 1, source: "legacy", text: text || "沿用这条故事线已有的记录。", createdAtTick: first?.createdAtTick ?? state.time.tickValue };
  }
}
