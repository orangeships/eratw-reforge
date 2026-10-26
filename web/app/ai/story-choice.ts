import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { storyInteractionGrants, type StoryInteractionGrantV1 } from "../../../modernization/runtime/story/interaction-progress.js";
import type { AiGeneratedLine, PreparedAiKojoRequest } from "./types.js";
import type { DialogueSession } from "../state/dialogue-session.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";

/** Consume only a published menu. Persist the selected player contribution
 * and reply in this same transcript, so remounts cannot offer it twice. */
export function selectedBranchTranscript(session: DialogueSession, label: string,
  lines: readonly ObservationEvent[], timestamp: number): ObservationEvent[] | null {
  if (session.aiRequestId !== undefined || session.choice !== null) return null;
  const menu = [...session.transcript].reverse().find(event => event.kind === "DIALOGUE_LINE"
    && event.charaNum === session.aiCharaNum && event.aiChoice !== undefined);
  const option = menu?.kind === "DIALOGUE_LINE" ? menu.aiChoice?.options.find(option => option.label === label) : undefined;
  if (!option || lines.length !== option.lines.length || lines.some((line, index) => line.kind !== "DIALOGUE_LINE"
    || line.charaNum !== session.aiCharaNum || line.text !== option.lines[index]!.text
    || (line.form ?? "PRINTFORML") !== option.lines[index]!.form)) return null;
  return [...session.transcript.map(event => {
    if (event.kind !== "DIALOGUE_LINE") return event;
    const { aiChoice: _choice, ...line } = event;
    return line;
  }), { kind: "DIALOGUE_LINE", charaNum: 0, text: label, form: "PRINTFORMDL", origin: "ai", timestamp },
  ...option.lines.map(line => ({ kind: "DIALOGUE_LINE" as const, charaNum: session.aiCharaNum!,
    text: line.text, form: line.form, origin: "ai" as const, timestamp }))];
}

/** Bind only a fresh, visible story from the request. A stale optional menu
 * is removed without discarding an otherwise valid character reply. */
export function bindStoryChoice(state: GameState,
  prepared: Pick<PreparedAiKojoRequest, "requestId" | "target" | "storyGrants" | "hookGrant">,
  lines: readonly AiGeneratedLine[]): {
  lines: AiGeneratedLine[]; grant?: StoryInteractionGrantV1;
} {
  const choice = lines.at(-1)?.aiChoice;
  const hook = prepared.hookGrant && state.narrativeHooks?.find(hook => hook.id === prepared.hookGrant!.hookId);
  const program = hook && (state.storyProgram?.id === hook.storyId ? state.storyProgram
    : state.narrativeEvents?.find(event => event.program.id === hook.storyId)?.program);
  const arcId = choice?.storyArcId ?? (program?.version === 2 ? program.arcId : undefined);
  if (!choice || !arcId) return { lines: [...lines] };
  const requested = prepared.storyGrants?.find(grant => grant.arcId === arcId);
  const current = storyInteractionGrants(state, prepared.target).find(grant => grant.arcId === arcId);
  const arc = state.storyArcs?.find(arc => arc.id === arcId);
  const ownReplyRecorded = arc?.maintenance?.interaction?.evidenceIds.includes(`interaction:${prepared.requestId}`) === true;
  if (!requested || !current || current.revision !== requested.revision + (ownReplyRecorded ? 1 : 0)
    || state.charas[prepared.target]?.location !== state.master.location) {
    return { lines: lines.map(({ aiChoice: _choice, ...line }) => line) };
  }
  return { lines: lines.map((line, index) => index === lines.length - 1
    ? { ...line, aiChoice: { ...choice, storyArcId: arcId } } : line), grant: current };
}
