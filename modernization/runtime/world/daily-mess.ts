/**
 * DAILY_EV0 — 妖精把据点弄得一团糟。
 *
 * This module owns the event-specific RAND order and effects. Selection,
 * first-hit exclusivity, transactionality and per-day lifecycle live in
 * `daily-event.ts`.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { PromptSpec } from "../command/prompt.js";
import { askYn } from "../command/prompt.js";
import type { Rng } from "../command/types.js";
import type { GameState } from "../state/game-state.js";
import { ITEM_ID, hasItem, removeItem } from "../state/items.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  TALENT_ID,
} from "../state/settlement.js";
import { getYogore, setYogore } from "../state/yogore.js";
import { TFLAG_ID, setTflagBit } from "../state/tflag.js";
import { mapKeyOf } from "./location-predicates.js";
import { LOCATION_PLACE_FLAGS } from "./place-flags-data.js";

export const ANONYMOUS_CHARACTER_ID = -1;

export const DAILY_MESS_PROMPT: PromptSpec = askYn(
  "可恶……要教训妖精们一顿吗？",
  "是",
  "否",
);

export type DailyMessResult =
  | { kind: "applied"; events: ObservationEvent[] }
  | {
      kind: "needs-input";
      prompt: PromptSpec;
      previewEvents: ObservationEvent[];
    };

/** Current-map room list, equivalent to MINROOM()..MAXROOM. */
export function roomsInMap(map: string): string[] {
  return Object.keys(LOCATION_PLACE_FLAGS).filter((loc) => mapKeyOf(loc) === map);
}

/** `AVERAGE_YOGORE()` over the master's current map. */
export function averageYogore(state: GameState, map: string): number {
  const rooms = roomsInMap(map);
  if (rooms.length === 0) return 0;
  return rooms.reduce((sum, loc) => sum + getYogore(state, loc), 0) / rooms.length;
}

/**
 * `@DAILY_CONDITION_EV0`. RAND:8 is deliberately consumed before the cheap
 * DAY/dirt gates, matching the upstream function's statement order.
 */
export function dailyMessCondition(state: Readonly<GameState>, rng: Rng): boolean {
  if (rng.int(8) > 0) return false;
  if (state.time.dayIndex <= 30) return false;
  const map = mapKeyOf(state.master.location);
  return averageYogore(state as GameState, map) <= 800;
}

function narration(now: () => number, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: now(), text };
}

function addDirt(state: GameState, location: string, rng: Rng): void {
  setYogore(
    state,
    location,
    Math.min(getYogore(state, location) + 1000 + rng.int(4000), 6000),
  );
}

function hasPenis(state: Readonly<GameState>): boolean {
  return ((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
}

function downBase(state: GameState, id: number, amount: number): void {
  state.master.state.BASE[id] = Math.max(0, (state.master.state.BASE[id] ?? 0) - amount);
}

function recordAnonymousFairyFirstKiss(state: GameState): void {
  if ((state.master.state.TALENT[TALENT_ID.キス未経験] ?? 0) === 0) return;
  state.master.state.TALENT[TALENT_ID.キス未経験] = 0;
  state.master.state.CFLAG[CFLAG_ID.初吻喪失記念日] = state.time.dayIndex;
  state.master.state.CFLAG[CFLAG_ID.初吻喪失对手] = ANONYMOUS_CHARACTER_ID;
  // SET_FIRSTKISS situation bit 4 (penis) writes this category as 1 upstream.
  state.master.state.CFLAG[CFLAG_ID.初吻喪失対象] = 1;
  state.firstKissHistory ??= {};
  state.firstKissHistory[0] = {
    dayIndex: state.time.dayIndex,
    location: state.master.location,
    partner: { kind: "anonymous", label: "妖精" },
    situation: "penis",
  };
}

/** `@DAILY_EV0`, including the INPUT, punishment and chocolate branches. */
export function runDailyMessEvent(
  state: GameState,
  rng: Rng,
  answer: boolean | undefined,
  now: () => number,
): DailyMessResult {
  const map = mapKeyOf(state.master.location);
  const combat = state.master.state.ABL[ABL_ID.战斗能力] ?? 0;
  const events: ObservationEvent[] = [
    narration(now, `在${state.master.callName ?? "主人公"}睡着的时候，${map}里大群的妖精蜂拥而来！`),
  ];

  // MAGIC_DLC is outside the migration boundary, so its 神性 multiplier is 0.
  const caught = rng.int(10) < combat;
  if (caught) {
    events.push(
      narration(now, `妖精们把${map}弄得乱七八糟的。`),
      narration(now, `${state.master.callName ?? "主人公"}途中出现，目瞪口呆地看着这一切……`),
    );
    if (answer === undefined) {
      return { kind: "needs-input", prompt: DAILY_MESS_PROMPT, previewEvents: events };
    }

    if (answer && hasPenis(state)) {
      events.push(narration(now, "你抓住了一只妖精，在她的悲鸣中狠狠教训了她……"));
      state.master.state.EXP[EXP_ID.挿入経験] =
        (state.master.state.EXP[EXP_ID.挿入経験] ?? 0) + rng.int(5);
      state.master.state.EXP[EXP_ID.射精経験] =
        (state.master.state.EXP[EXP_ID.射精経験] ?? 0) + rng.int(5);
      state.master.state.EXP[EXP_ID.絶頂経験] =
        (state.master.state.EXP[EXP_ID.絶頂経験] ?? 0) + rng.int(5);
      recordAnonymousFairyFirstKiss(state);
      downBase(state, BASE_ID.体力, 500);
      downBase(state, BASE_ID.気力, 550);
      const semen = 500 + rng.int(100);
      downBase(state, BASE_ID.精力, semen);
      // 浓厚精液机制:主角射精 → 记下「今日射精」(TFLAG:一日一回 bit 8)。
      setTflagBit(state, TFLAG_ID.一日一回, 8);
      events.push(
        narration(now, `往妖精的子宫内注入了${semen}ml的精液……`),
        narration(now, "狠狠恐吓妖精不要说出去之后，把她赶走了。"),
      );
    } else {
      if (answer && !hasPenis(state)) {
        events.push(narration(now, "但遗憾的是你并没有那活儿……"));
      }
      events.push(narration(now, "还是算了。"));
    }

    for (const location of roomsInMap(map)) {
      if (rng.int(10) <= combat) addDirt(state, location, rng);
    }
    return { kind: "applied", events };
  }

  if (hasItem(state, ITEM_ID.黑雷神巧克力, 10)) {
    const consumed = rng.int(9) + 1;
    removeItem(state, ITEM_ID.黑雷神巧克力, consumed);
    events.push(
      narration(now, `${state.master.callName ?? "主人公"}睁开眼睛时，妖精们已经在咀嚼黑雷神巧克力了。`),
      narration(now, `${state.master.callName ?? "主人公"}擦拭妖精的嘴边，告诫她们可以回家了。`),
    );
    return { kind: "applied", events };
  }

  events.push(narration(now, `妖精们把${map}弄得乱七八糟的。`));
  for (const location of roomsInMap(map)) addDirt(state, location, rng);
  return { kind: "applied", events };
}
