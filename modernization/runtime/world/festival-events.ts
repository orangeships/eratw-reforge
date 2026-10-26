/**
 * Public festival hooks from `祭日イベント.ERB`.
 *
 * The calendar table is only the date lookup.  This module owns the
 * deterministic `BEFORETRAIN` festival morning effects that are shared by
 * every character: the ordinary announcement, the New Year continuation,
 * the White Day reminder/record, and the New Year's Eve schedule override.
 * Personal festival 口上 remains in the static dialogue router; this module
 * never replaces authored dialogue with generated text.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { PromptAnswer } from "../command/prompt.js";
import type { CharaSlot, EventPromptSpec, GameState } from "../state/game-state.js";
import { cloneGameState } from "../state/game-state.js";
import { ABL_ID, CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { festivalNow } from "./calendar.js";
import {
  RABBIT_DAY_NAME,
  runRabbitDayMorning,
} from "./rabbit-day.js";

const NEW_YEAR_NAME = "元旦";
const VALENTINE_NAME = "情人節";
const WHITE_DAY_EVE_NAME = "白色情人節前日";
const WHITE_DAY_NAME = "白色情人節";
const NEW_YEAR_EVE_NAME = "大晦日";

const NEW_YEAR_RESOLUTIONS = [
  { id: 1, label: "自慰奖励" },
  { id: 2, label: "同性爱推进" },
  { id: 3, label: "牝穴开拓" },
  { id: 4, label: "尻穴开发" },
  { id: 5, label: "乳挟振兴" },
  { id: 6, label: "子孙繁栄" },
] as const;

const NEW_YEAR_RESOLUTION_TEXT: Record<number, string> = {
  1: "自慰",
  2: "同性爱",
  3: "性交",
  4: "肛交",
  5: "乳交",
  6: "生孩子",
};

/** The persisted prompt snapshot used by `@NEWYEAR` and its UI adapter. */
export function newYearFestivalPrompt(masterName: string): EventPromptSpec {
  return {
    kind: "pick_one",
    question: `那么、${masterName}今年的抱负是…`,
    options: NEW_YEAR_RESOLUTIONS.map((option) => ({ ...option })),
  };
}

function narration(timestamp: number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp, text };
}

function charaName(slot: CharaSlot): string {
  return slot.callName ?? `角色${slot.charaNum}`;
}

function sortedNpcSlots(state: GameState): CharaSlot[] {
  return Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum);
}

function newYearMorning(state: GameState, now: () => number): ObservationEvent[] {
  // Upstream suppresses NEWYEAR on the initial DAY=1 boot morning. The
  // modern dayIndex is zero-based, so only later cycles open this prompt.
  if (state.time.dayIndex <= 0) return [];

  const events: ObservationEvent[] = [narration(now(), "新年快乐！")];
  let cardCount = 0;
  for (const slot of sortedNpcSlots(state)) {
    if ((slot.state.ABL[ABL_ID.親密] ?? 0) >= 5
      && (slot.state.CFLAG[CFLAG_ID.神社在住] ?? 0) === 0) {
      events.push(narration(now(), `收到了来自${charaName(slot)}的新年贺卡`));
      cardCount += 1;
    }

    // `children` is the modern authoritative child entity list.  The two
    // CFLAG counters remain compatibility mirrors and are used when present
    // to retain the upstream `兒童人数 - 育児人数 > 0` gate.
    const children = (state.children?.[slot.charaNum] ?? [])
      .filter((child) => child.independent)
      .sort((a, b) => a.id - b.id);
    const childCount = slot.state.CFLAG[CFLAG_ID.兒童人数];
    const caringCount = slot.state.CFLAG[CFLAG_ID.育児人数];
    if (children.length === 0
      || (childCount !== undefined && caringCount !== undefined && childCount - caringCount <= 0)) {
      continue;
    }
    for (const child of children) {
      const childLabel = child.sex === 1 ? "女儿" : "儿子";
      events.push(narration(
        now(),
        `收到了来自${charaName(slot)}的${childLabel}${child.name}的新年贺卡`,
      ));
      cardCount += 1;
    }
  }
  if (cardCount > 0) events.push(narration(now(), `总计${cardCount}张！`));

  const prompt = newYearFestivalPrompt(charaName(state.master));
  state.festivalEventSession = {
    kind: "new-year",
    dayIndex: state.time.dayIndex,
    prompt,
  };
  events.push({
    kind: "EVENT_PROMPT",
    timestamp: now(),
    charaNum: 0,
    scenario: 0,
    spec: prompt,
  });
  return events;
}

function whiteDayMorning(state: GameState, now: () => number): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  for (const slot of sortedNpcSlots(state)) {
    const record = slot.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0;
    const name = charaName(slot);
    if (record === 1) {
      events.push(narration(now(), `${name}给了黑雷神巧克力……`));
      events.push(narration(now(), "礼物还算合适吧"));
    } else if (record === 2) {
      events.push(narration(now(), `${name}给了普通的巧克力……`));
      events.push(narration(now(), "要准备相应的回礼"));
    } else if (record === 3) {
      events.push(narration(now(), `${name}给了高级的巧克力……`));
      events.push(narration(now(), "要准备上佳的回礼"));
    } else if (record === 4) {
      events.push(narration(now(), `${name}给了亲手做的巧克力……`));
      events.push(narration(now(), "要准备充满真心的回礼"));
    }
  }
  return events;
}

function isLateNight(value: number): boolean {
  return (value >= 900 && value <= 1440) || (value >= 0 && value < 60);
}

function isLateSleep(value: number): boolean {
  return (value >= 900 && value <= 1440) || (value >= 0 && value < 120);
}

/** Restore the fields changed by the preceding `大晦日` morning. */
export function restoreFestivalSchedule(state: GameState): void {
  const snapshots = state.festivalScheduleSnapshots;
  if (!snapshots) return;
  for (const [rawCharaNum, snapshot] of Object.entries(snapshots)) {
    const slot = state.charas[Number(rawCharaNum)];
    if (!slot) continue;
    slot.state.CFLAG[CFLAG_ID.帰宅時間] = snapshot.returnTime;
    slot.state.CFLAG[CFLAG_ID.就寝時間] = snapshot.sleepTime;
  }
  delete state.festivalScheduleSnapshots;
}

/**
 * Port `COMMON.ERB:@生活時間設定`'s 大晦日 arm.  The upstream call excludes
 * MASTER; only NPCs with actual configured schedule values are touched.
 */
export function applyNewYearEveSchedule(state: GameState): void {
  if (festivalNow(state.time) !== NEW_YEAR_EVE_NAME) return;
  const snapshots = state.festivalScheduleSnapshots ??= {};
  for (const slot of sortedNpcSlots(state)) {
    const returnTime = slot.state.CFLAG[CFLAG_ID.帰宅時間];
    const sleepTime = slot.state.CFLAG[CFLAG_ID.就寝時間];
    if (typeof returnTime !== "number" || !Number.isFinite(returnTime)
      || typeof sleepTime !== "number" || !Number.isFinite(sleepTime)) continue;
    if (!isLateNight(returnTime) && !isLateSleep(sleepTime)) continue;
    if (snapshots[slot.charaNum] === undefined) {
      snapshots[slot.charaNum] = { returnTime, sleepTime };
    }
    slot.state.CFLAG[CFLAG_ID.帰宅時間] = 60;
    slot.state.CFLAG[CFLAG_ID.就寝時間] = 120;
  }
  if (Object.keys(snapshots).length === 0) delete state.festivalScheduleSnapshots;
}

/** Run the shared `BEFORETRAIN` festival morning block. */
export function runFestivalMorning(
  state: GameState,
  now: () => number,
): ObservationEvent[] {
  const festival = festivalNow(state.time);
  if (festival !== NEW_YEAR_EVE_NAME) restoreFestivalSchedule(state);
  applyNewYearEveSchedule(state);
  if (festival === "") return [];

  // Rabbit Day owns its outfit-specific second line and keeps its existing
  // narrow regression contract; the public generic announcement is included
  // by `runRabbitDayMorning` itself.
  if (festival === RABBIT_DAY_NAME) return runRabbitDayMorning(state, now);

  const events: ObservationEvent[] = [narration(now(), `今天是${festival}。`)];
  switch (festival) {
    case NEW_YEAR_NAME:
      events.push(...newYearMorning(state, now));
      break;
    case VALENTINE_NAME:
      events.push(narration(now(), "会收到巧克力吗…"));
      break;
    case WHITE_DAY_EVE_NAME:
      events.push(narration(now(), "需要准备好回礼"));
      break;
    case WHITE_DAY_NAME:
      events.push(...whiteDayMorning(state, now));
      break;
    case NEW_YEAR_EVE_NAME:
      events.push(narration(now(), "今天的每个角色都会熬夜"));
      break;
    default:
      break;
  }
  return events;
}

export interface FestivalEventResolution {
  state: GameState;
  event: ObservationEvent;
}

/** Commit a valid New Year resolution and reset the per-character annual latch. */
export function resolveFestivalEvent(
  state: GameState,
  answer: PromptAnswer,
  now: () => number,
): FestivalEventResolution | null {
  const session = state.festivalEventSession;
  if (!session || session.kind !== "new-year" || answer.kind !== "pick_one") return null;
  if (typeof answer.value !== "number" || !Number.isInteger(answer.value)) return null;
  const option = session.prompt.options.find((candidate) => candidate.id === answer.value && !candidate.disabled);
  if (!option || answer.value < 1 || answer.value > 6) return null;

  const next = cloneGameState(state);
  next.flagStore[FLAG_ID.抱負] = answer.value;
  next.master.state.CFLAG[CFLAG_ID.全年] = 0;
  for (const slot of Object.values(next.charas)) slot.state.CFLAG[CFLAG_ID.全年] = 0;
  next.festivalEventSession = null;
  const event = narration(
    now(),
    `${charaName(next.master)}在心中坚定地发誓，今年要专心于${NEW_YEAR_RESOLUTION_TEXT[answer.value] ?? option.label}。`,
  );
  return { state: next, event };
}
