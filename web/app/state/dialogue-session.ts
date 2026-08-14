import type { ObservationEvent } from "../../../modernization/schemas/types.js";

export type DialogueSessionOwner =
  | "command"
  | "arrival"
  | "encounter"
  | "event"
  | "sp-event"
  | "mark"
  | "state"
  | "diary";

export interface DialogueChoiceSession {
  kind: "encounter" | "command" | "dayevent" | "event" | "diary";
  charaNum: number;
  commandNo?: number;
  subid?: number;
  arm?: number;
  page?: number;
  args?: number[];
  seed: number;
  choices: number[];
  options: { label: string }[];
  /** A non-replayable VM continuation token for the command owner only. */
  continuationId?: string;
  continuationValues?: (number | string)[];
  continuationInputMode?: "number" | "string";
  /** Number of non-replayed prefix events retained before the KOJO transcript. */
  transcriptStart: number;
  /** Remaining first-meeting candidates after an interactive encounter pause. */
  encounterContinuation?: {
    kind: "arrived" | "woke";
    location: string;
    candidateCharaNums: number[];
  };
}

export interface DialogueSession {
  id: string;
  owner: DialogueSessionOwner;
  priority: number;
  interruptible: boolean;
  transcript: ObservationEvent[];
  choice: DialogueChoiceSession | null;
  /** Pending realtime AI request owned by this exact command session. */
  aiRequestId?: string;
  aiCharaNum?: number;
}

export const DIALOGUE_SESSION_PRIORITY: Readonly<Record<DialogueSessionOwner, number>> = {
  command: 100,
  event: 90,
  "sp-event": 85,
  encounter: 80,
  mark: 70,
  state: 70,
  arrival: 60,
  diary: 50,
};

/**
 * Keep the active non-interruptible session in place. Waiting sessions are
 * ordered by priority and remain FIFO when their priorities match.
 */
export function enqueueDialogueSession(
  queue: readonly DialogueSession[],
  session: DialogueSession,
): DialogueSession[] {
  if (queue.length === 0) return [session];
  const active = queue[0]!;
  if (active.interruptible && session.priority > active.priority) {
    return [session, ...queue];
  }

  const waiting = queue.slice(1);
  const insertAt = waiting.findIndex((candidate) => candidate.priority < session.priority);
  if (insertAt === -1) return [active, ...waiting, session];
  return [
    active,
    ...waiting.slice(0, insertAt),
    session,
    ...waiting.slice(insertAt),
  ];
}

export function replaceActiveDialogueSession(
  queue: readonly DialogueSession[],
  transcript: readonly ObservationEvent[],
  choice: DialogueChoiceSession | null,
): DialogueSession[] {
  if (queue.length === 0) return [];
  return [
    {
      ...queue[0]!,
      transcript: [...transcript],
      choice,
    },
    ...queue.slice(1),
  ];
}

export function advanceDialogueSession(
  queue: readonly DialogueSession[],
): DialogueSession[] {
  return queue.slice(1);
}

function sameReplayEvent(left: ObservationEvent, right: ObservationEvent): boolean {
  if (left.kind !== right.kind) return false;
  if ("text" in left || "text" in right) {
    if (!("text" in left) || !("text" in right) || left.text !== right.text) return false;
  }
  if (left.kind === "DIALOGUE_LINE" && right.kind === "DIALOGUE_LINE") {
    return left.charaNum === right.charaNum && left.form === right.form;
  }
  return true;
}

/**
 * Interactive KOJO resolution replays from the start with the same seed.
 * Replace the prior replay segment when the new result includes that prefix,
 * even when an owner adapter prepends a wrapper event (for example, encounter
 * replay regenerating arrival narration that is already outside the popup).
 * Suffix-only adapters remain supported by appending their delta.
 */
export function mergeReplayedTranscript(
  current: readonly ObservationEvent[],
  transcriptStart: number,
  replay: readonly ObservationEvent[],
): ObservationEvent[] {
  const start = Math.max(0, Math.min(transcriptStart, current.length));
  const prefix = current.slice(0, start);
  const previousReplay = current.slice(start);
  let bestReplayStart = -1;
  let bestCommonPrefix = 0;
  for (let replayStart = 0; replayStart < replay.length; replayStart += 1) {
    let commonPrefix = 0;
    while (
      commonPrefix < previousReplay.length &&
      replayStart + commonPrefix < replay.length &&
      sameReplayEvent(previousReplay[commonPrefix]!, replay[replayStart + commonPrefix]!)
    ) {
      commonPrefix += 1;
    }
    if (commonPrefix > bestCommonPrefix) {
      bestReplayStart = replayStart;
      bestCommonPrefix = commonPrefix;
    }
  }

  const nextReplay = bestCommonPrefix > 0
    ? replay.slice(bestReplayStart)
    : [...previousReplay, ...replay];
  return [...prefix, ...nextReplay];
}
