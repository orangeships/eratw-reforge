import type { ObservationEvent } from "../../../modernization/schemas/types.js";

const SYNTHETIC_COMF_ENGLISH =
  /\b(?:anal|aphrodisiac|applied|apron|awkward|awkwardly|bathroom|began|blindfolded|bound|bubble|caressed|calmly|candle|carefully|chatted|clumsily|command|condom|diuretic|doggy|drank|dripped|electric|face-fucked|fellatio|fingered|finished|flipped|fondled|footjob|forced|gagged|gave|gently|great|groped|handjob|happily|inserted|invited|kissed|licked|lightly|lotion|massager|masturbat\w*|milking|mock|newlywed|nipple|ordinary|ordered|outdoors|patted|performed|play|playfully|poured|pricked|restrained|rode|scissored|served|serviced|shame|shower|skirt|smoothly|spanked|spread|started|stiffly|stroked|sucked|tenderly|teased|thigh|titfucked|titjob|took|tormented|touched|turned|uneasily|used|vacuum|vibrator|waited|warmly|whipped)\b/i;

/**
 * ComfDef still carries many migration-era English placeholder narrations
 * ("玩家 gently touched 萃香"). They are not eraTW 口上 and should not leak into
 * the player-facing scene/interaction UI. Keep real Chinese/Japanese narration
 * visible; hide only these synthetic COMF summaries.
 */
export function isSyntheticComfNarration(event: ObservationEvent): boolean {
  return event.kind === "NARRATION" && SYNTHETIC_COMF_ENGLISH.test(event.text);
}

export function isPlayerVisibleEvent(event: ObservationEvent): boolean {
  return !isSyntheticComfNarration(event);
}

/** Player-facing narrative surfaces omit deterministic bookkeeping. Classic
 * creator/debug history deliberately keeps those rows, so this is a separate
 * predicate rather than a change to isPlayerVisibleEvent. */
export function isNarrativePresentationEvent(event: ObservationEvent): boolean {
  return isPlayerVisibleEvent(event) &&
    event.kind !== "STATUS_MESSAGE" &&
    event.kind !== "COMMAND_ISSUED" &&
    event.kind !== "STATE_DELTA" &&
    event.kind !== "FLAG_CHANGED";
}

/** Ambient prose belongs to the scene/history but never pauses a command. */
export function isInteractionVisibleEvent(event: ObservationEvent): boolean {
  return isPlayerVisibleEvent(event) && !(event.kind === "NARRATION" && event.presentation === "ambient");
}

/** Presentation-only classifier for SKIP_MOVE narration. */
export function isMovementNarration(event: ObservationEvent): boolean {
  return event.kind === "NARRATION" && /^(?:移动到了|.+\s移动到\s|经过|到达.+遇到了|停下脚步|向.+打了声招呼|没有理会.+径直走了过去|还是算了，没有潜入)/.test(event.text);
}
