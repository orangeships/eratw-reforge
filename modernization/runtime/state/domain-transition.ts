import type { CharaSlot, GameState } from "./game-state.js";
import { CFLAG_ID, MARK_ID, TALENT_ID } from "./settlement.js";

export type MarkAcquisitionId = 0 | 1 | 2 | 3 | 5;

/**
 * Relationship-defining talents whose acquisition is surfaced as a
 * `talent-acquired` domain transition. Deliberately narrow: the original game
 * reacts to these moments through authored PALAMCNG/command kojo, and this
 * transition is the fallback + future agent/AI observation. Incidental
 * internal talents (e.g. 心情, set as a side effect of anger) are NOT tracked,
 * so the transition stream stays free of noise the original never produced.
 */
export const TRACKED_TALENT_ACQUISITION_IDS: ReadonlySet<number> = new Set([
  TALENT_ID.恋慕,
  TALENT_ID.思慕,
  TALENT_ID.恋人,
  TALENT_ID.愛欲,
  TALENT_ID.炮友,
]);

export type DomainTransition =
  | {
      kind: "rebellion-mark-acquired";
      charaNum: number;
      level: 1 | 2 | 3;
    }
  | {
      kind: "mark-acquired";
      charaNum: number;
      markId: Exclude<MarkAcquisitionId, 3>;
      level: 1 | 2 | 3;
    }
  | { kind: "anger-entered"; charaNum: number }
  | { kind: "anger-cleared"; charaNum: number }
  | { kind: "first-met"; charaNum: number }
  | {
      kind: "arrived";
      charaNum: number;
      from: string;
      to: string;
    }
  | { kind: "woke"; charaNum: number }
  | {
      kind: "command-completed";
      commandNo: number;
      target: number;
    }
  | {
      kind: "talent-acquired";
      charaNum: number;
      talentId: number;
    };

export interface CharaDomainSnapshot {
  readonly location: string;
  readonly asleep: boolean;
  readonly angry: boolean;
  readonly metMaster: boolean;
  readonly marks: Readonly<Record<MarkAcquisitionId, number>>;
  readonly talents: Readonly<Record<number, number>>;
}

function flag(slot: CharaSlot | undefined, id: number): number {
  return slot?.state.CFLAG[id] ?? 0;
}

function isPresentLocation(location: string): boolean {
  const value = location.trim();
  return value !== "" && value !== "不在" && value !== "外出中" && value !== "退場";
}

export function snapshotCharaDomainState(
  slot: CharaSlot | undefined,
): CharaDomainSnapshot {
  return {
    location: slot?.location ?? "",
    asleep: flag(slot, CFLAG_ID.睡眠) !== 0,
    angry: flag(slot, CFLAG_ID.勃然大怒) !== 0,
    metMaster: flag(slot, CFLAG_ID.认识) !== 0,
    marks: {
      0: slot?.state.MARK?.[MARK_ID.苦痛] ?? 0,
      1: slot?.state.MARK?.[MARK_ID.快乐] ?? 0,
      2: slot?.state.MARK?.[MARK_ID.不埒] ?? 0,
      3: slot?.state.MARK?.[MARK_ID.反発刻印] ?? 0,
      5: slot?.state.MARK?.[MARK_ID.时奸] ?? 0,
    },
    talents: { ...(slot?.state.TALENT ?? {}) },
  };
}

export function detectCharaDomainTransitions(
  charaNum: number,
  before: CharaDomainSnapshot,
  after: CharaDomainSnapshot,
): DomainTransition[] {
  const transitions: DomainTransition[] = [];

  for (const markId of [0, 1, 2, 3, 5] as const) {
    if (after.marks[markId] <= before.marks[markId]) continue;
    const level = Math.min(
      Math.max(Math.trunc(after.marks[markId]), 1),
      3,
    ) as 1 | 2 | 3;
    transitions.push(
      markId === 3
        ? { kind: "rebellion-mark-acquired", charaNum, level }
        : { kind: "mark-acquired", charaNum, markId, level },
    );
  }
  // TALENT gains, scoped to `TRACKED_TALENT_ACQUISITION_IDS`: a tracked talent
  // that was falsy (0) before and is truthy (non-zero) after counts as
  // acquired. TALENT values are not assumed positive (several upstream traits
  // are stored negative), so the check is `!= 0`, not `> 0`. Non-tracked
  // talents are ignored so incidental internal changes (e.g. 心情 flipping on
  // anger) do not pollute the transition stream.
  for (const talentId of TRACKED_TALENT_ACQUISITION_IDS) {
    if ((after.talents[talentId] ?? 0) !== 0 && (before.talents[talentId] ?? 0) === 0) {
      transitions.push({ kind: "talent-acquired", charaNum, talentId });
    }
  }
  if (!before.angry && after.angry) {
    transitions.push({ kind: "anger-entered", charaNum });
  } else if (before.angry && !after.angry) {
    transitions.push({ kind: "anger-cleared", charaNum });
  }
  if (!before.metMaster && after.metMaster) {
    transitions.push({ kind: "first-met", charaNum });
  }
  if (
    before.location !== after.location &&
    isPresentLocation(after.location)
  ) {
    transitions.push({
      kind: "arrived",
      charaNum,
      from: before.location,
      to: after.location,
    });
  }
  if (before.asleep && !after.asleep) {
    transitions.push({ kind: "woke", charaNum });
  }

  return transitions;
}

export function detectDomainTransitions(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
): DomainTransition[] {
  const charaNums = new Set<number>([
    0,
    ...Object.keys(before.charas).map(Number),
    ...Object.keys(after.charas).map(Number),
  ]);
  const transitions: DomainTransition[] = [];

  for (const charaNum of [...charaNums].filter(Number.isFinite).sort((a, b) => a - b)) {
    const beforeSlot = charaNum === 0 ? before.master : before.charas[charaNum];
    const afterSlot = charaNum === 0 ? after.master : after.charas[charaNum];
    if (!afterSlot) continue;
    transitions.push(
      ...detectCharaDomainTransitions(
        charaNum,
        snapshotCharaDomainState(beforeSlot),
        snapshotCharaDomainState(afterSlot),
      ),
    );
  }

  return transitions;
}

function transitionKey(transition: DomainTransition): string {
  switch (transition.kind) {
    case "rebellion-mark-acquired":
      return `${transition.kind}:${transition.charaNum}:${transition.level}`;
    case "mark-acquired":
      return `${transition.kind}:${transition.charaNum}:${transition.markId}:${transition.level}`;
    case "arrived":
      return `${transition.kind}:${transition.charaNum}:${transition.from}:${transition.to}`;
    case "command-completed":
      return `${transition.kind}:${transition.commandNo}:${transition.target}`;
    case "talent-acquired":
      return `${transition.kind}:${transition.charaNum}:${transition.talentId}`;
    default:
      return `${transition.kind}:${transition.charaNum}`;
  }
}

export function mergeDomainTransitions(
  ...groups: ReadonlyArray<readonly DomainTransition[] | undefined>
): DomainTransition[] {
  const seen = new Set<string>();
  const merged: DomainTransition[] = [];
  for (const group of groups) {
    for (const transition of group ?? []) {
      const key = transitionKey(transition);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(transition);
    }
  }
  return merged;
}

export function hasCommandCompletedTransition(
  transitions: readonly DomainTransition[],
): boolean {
  return transitions.some((transition) => transition.kind === "command-completed");
}
