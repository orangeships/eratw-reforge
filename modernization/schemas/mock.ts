/**
 * Phase 2.6 — Mock factory functions for the 5 Agent extension types.
 *
 * These exist so test code and future scaffolding (Phase 3+ UI) can
 * spin up realistic-shaped values without hand-rolling them. The
 * mocks are intentionally minimal — they don't fake a full game
 * state, just enough fields to exercise the type / validator.
 *
 * Per the zero-LLM invariant in `validator.ts`, this file does
 * NOT call any LLM, doesn't make network calls, doesn't mutate
 * anything it doesn't own.
 */

import type {
  AgentIntent,
  CharacterSchedule,
  DialogueCandidate,
  IssueCommandIntent,
  NoopIntent,
  ObservationEvent,
  OverrideScheduleIntent,
  ProposeDialogueIntent,
  WorldSnapshot,
} from "./types.js";

/** Fixed timestamp used in all mocks so test snapshots are deterministic. */
export const MOCK_TS = 1718467200000; // 2024-06-15T00:00:00Z, matching the project date

// ---------------------------------------------------------------------
// ObservationEvent mocks
// ---------------------------------------------------------------------

export function mockCommandIssued(
  actor: number = 0,
  commandNo: number = 300,
): ObservationEvent {
  return {
    kind: "COMMAND_ISSUED",
    timestamp: MOCK_TS,
    actor,
    commandNo,
  };
}

export function mockStateDelta(
  subject: number = 1,
  fields: ObservationEvent & { kind: "STATE_DELTA" } extends infer E
    ? E extends { fields: infer F }
      ? F
      : never
    : never = [
      { namespace: "CFLAG", id: 0, delta: 1 },
    ] as never,
): ObservationEvent {
  return {
    kind: "STATE_DELTA",
    timestamp: MOCK_TS,
    subject,
    fields,
  };
}

export function mockTimeTick(tickValue: number = 1): ObservationEvent {
  return { kind: "TIME_TICK", timestamp: MOCK_TS, tickValue };
}

export function mockFlagChanged(
  flagId: number = 0,
  newValue: number = 1,
): ObservationEvent {
  return { kind: "FLAG_CHANGED", timestamp: MOCK_TS, flagId, newValue };
}

export function mockDialogueDue(
  charaNum: number = 1,
  eventCategory: string = "COMMAND",
  eventSubId: number = 300,
): ObservationEvent {
  return { kind: "DIALOGUE_DUE", timestamp: MOCK_TS, charaNum, eventCategory, eventSubId };
}

export function mockStatusMessage(
  text: string = "no-op acknowledged",
  source: "system" | "apply_intent" | "validator" | "watcher" = "apply_intent",
): ObservationEvent {
  return { kind: "STATUS_MESSAGE", timestamp: MOCK_TS, source, text };
}

export function mockNarration(text: string = "晨雾未散，神社的石阶上落着几片红叶。"): ObservationEvent {
  return { kind: "NARRATION", timestamp: MOCK_TS, text };
}

export function mockDialogueLine(
  charaNum: number = 1,
  text: string = "……だから、何の用だ？",
): ObservationEvent {
  return { kind: "DIALOGUE_LINE", timestamp: MOCK_TS, charaNum, text };
}

// ---------------------------------------------------------------------
// WorldSnapshot mock — empty
// ---------------------------------------------------------------------

/** Build a minimal-but-valid `WorldSnapshot` for tests. */
export function mockEmptyWorldSnapshot(): WorldSnapshot {
  return {
    takenAt: MOCK_TS,
    charas: [],
    flagUniverse: [],
    commandCatalog: [],
    functionIndex: [],
    kojoMap: [],
    genericHandlers: [],
    timeOfDay: null,
    locationMap: null,
  };
}

// ---------------------------------------------------------------------
// AgentIntent mocks
// ---------------------------------------------------------------------

export function mockIssueCommandIntent(
  actor: number = 0,
  commandNo: number = 300,
  variant?: { charaNum: number; code: string },
  target?: number,
): IssueCommandIntent {
  const intent: IssueCommandIntent = { kind: "ISSUE_COMMAND", actor, commandNo };
  if (target !== undefined) intent.target = target;
  if (variant) intent.variant = variant;
  return intent;
}

export function mockProposeDialogueIntent(
  charaNum: number = 1,
  candidate: DialogueCandidate = mockDialogueCandidate(charaNum),
): ProposeDialogueIntent {
  return { kind: "PROPOSE_DIALOGUE", charaNum, candidate };
}

export function mockOverrideScheduleIntent(
  charaNum: number = 1,
  schedule: CharacterSchedule = mockCharacterSchedule(charaNum),
): OverrideScheduleIntent {
  return { kind: "OVERRIDE_SCHEDULE", charaNum, schedule };
}

export function mockNoopIntent(reason: string = "nothing to do"): NoopIntent {
  return { kind: "NOOP", reason };
}

/** One example each of the 4 intent kinds, for tests that want the full set. */
export function mockAllIntentKinds(): AgentIntent[] {
  return [
    mockIssueCommandIntent(),
    mockProposeDialogueIntent(),
    mockOverrideScheduleIntent(),
    mockNoopIntent(),
  ];
}

// ---------------------------------------------------------------------
// DialogueCandidate mock
// ---------------------------------------------------------------------

export function mockDialogueCandidate(charaNum: number = 1): DialogueCandidate {
  return {
    charaNum,
    alternatives: [
      {
        text: "「……あら、客人？」",
        kojoFile: `個人口上/${String(charaNum).padStart(3, "0")} Reimu [霊夢]/霊夢/M_KOJO_K1_イベント.ERB`,
        lineRange: null, // 2.3-kojo didn't parse inside-file @-func bodies
      },
    ],
  };
}

// ---------------------------------------------------------------------
// CharacterSchedule mock
// ---------------------------------------------------------------------

export function mockCharacterSchedule(charaNum: number = 1): CharacterSchedule {
  return {
    charaNum,
    slots: [
      { startTime: 0, endTime: 360, activity: "睡眠", source: "deterministic" },
      { startTime: 360, endTime: 720, activity: "仕事", source: "deterministic" },
      { startTime: 720, endTime: 1080, activity: "自由行動", source: "agent" },
    ],
  };
}
