/** Seasonal encounter rewards that are committed after the encounter text. */

import type { ObservationEvent } from "../../schemas/types.js";
import type { GameState } from "../state/game-state.js";
import { addItem, ITEM_ID } from "../state/items.js";
import { pay } from "../state/money.js";
import { CFLAG_ID, EXP_ID, TALENT_ID } from "../state/settlement.js";
import { SEASON_SPRING, SEASON_WINTER, dateOf, seasonOf } from "./calendar.js";

/** Apply the winter-14 Valentine reward for a newly completed first meeting. */
export function applyValentineFirstMeetingReward(
  state: GameState,
  charaNum: number,
  now: () => number,
): ObservationEvent | null {
  if (seasonOf(state.time) !== SEASON_WINTER || dateOf(state.time) !== 14) return null;
  const slot = state.charas[charaNum];
  if (!slot || (slot.state.CFLAG[CFLAG_ID.バレンタイン] ?? 0) !== 0) return null;

  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  let itemId: number;
  let record: 1 | 2 | 3 | 4;
  if (favor >= 1000 && favor <= 3000) {
    itemId = ITEM_ID.黑雷神巧克力;
    record = 1;
  } else if (favor >= 3001 && favor <= 5000) {
    itemId = ITEM_ID.巧克力;
    record = 2;
  } else if (favor > 5000 && (slot.state.EXP[EXP_ID.愛情経験] ?? 0) < 100) {
    itemId = ITEM_ID.高級巧克力;
    record = 3;
  } else if (favor > 5000) {
    itemId = ITEM_ID.本命巧克力;
    record = 4;
  } else {
    // The upstream SELECTCASE has no branch below 好感度 1000.
    return null;
  }
  addItem(state, itemId, 1);
  slot.state.CFLAG[CFLAG_ID.バレンタイン] = record;
  const names = ["", "义理巧克力", "巧克力", "高级巧克力", "亲手制作的本命巧克力"];
  return {
    kind: "NARRATION",
    timestamp: now(),
    charaNum,
    text: `从${slot.callName ?? "对方"}那里收到了${names[record]}。`,
  };
}

/** Apply the upstream New Year `@OTOSHIDAMA` effect after encounter text. */
export function applyOtoshidamaEncounterReward(
  state: GameState,
  charaNum: number,
  now: () => number,
): ObservationEvent[] {
  // Upstream checks DAY <= 1. Modern dayIndex is zero-based.
  if (state.time.dayIndex <= 0) return [];
  const slot = state.charas[charaNum];
  if (!slot) return [];
  const childish = (slot.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0;
  const parenting = (slot.state.TALENT[TALENT_ID.育児中] ?? 0) !== 0;
  if (!childish && !parenting) return [];

  const name = slot.callName ?? "对方";
  const childName = (state.children?.[charaNum] ?? []).find((child) => !child.independent)?.name
    ?? (state.children?.[charaNum] ?? [])[0]?.name
    ?? "孩子";
  const events: ObservationEvent[] = [];
  if (childish) {
    events.push({ kind: "NARRATION", timestamp: now(), charaNum, text: `被${name}要了压岁钱` });
  } else {
    events.push({ kind: "NARRATION", timestamp: now(), charaNum, text: `在${name}的要求下给了${childName}压岁钱` });
  }

  const amount = state.money > 500000
    ? 10000
    : state.money > 100000
      ? 5000
      : state.money > 30000
        ? 3000
        : state.money > 3000
          ? 1000
          : 0;
  if (amount === 0) {
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      charaNum,
      text: `当${state.master.callName ?? "主人公"}展示了空空如也的钱包时、${name}${childish ? "投来了怜悯的眼神" : "露骨地表现出了失望的表情"}`,
    });
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      charaNum,
      text: `${state.master.callName ?? "主人公"}的心灵受到了伤害`,
    });
    return events;
  }

  events.push({ kind: "NARRATION", timestamp: now(), charaNum, text: `被${name}拿走了${amount}…` });
  events.push({ kind: "NARRATION", timestamp: now(), charaNum, text: `${name}很开心` });
  pay(state, amount);
  slot.state.TALENT[TALENT_ID.心情] = 1;
  slot.state.CFLAG[CFLAG_ID.好感度] = Math.max(
    0,
    (slot.state.CFLAG[CFLAG_ID.好感度] ?? 0) + Math.trunc(amount / 200),
  );
  slot.state.CFLAG[CFLAG_ID.信頼度] = Math.max(
    0,
    (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) + Math.trunc(amount / 200),
  );
  return events;
}

/** Shared modern encounter hook for the upstream `@SEASONAL(ARG)` call. */
export function applySeasonalEncounterEffects(
  state: GameState,
  charaNum: number,
  now: () => number,
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const valentine = applyValentineFirstMeetingReward(state, charaNum, now);
  if (valentine) events.push(valentine);
  if (seasonOf(state.time) === SEASON_SPRING && dateOf(state.time) === 1) {
    const slot = state.charas[charaNum];
    if (slot) {
      events.push({
        kind: "NARRATION",
        timestamp: now(),
        charaNum,
        text: `●${state.master.callName ?? "主人公"}向${slot.callName ?? "对方"}致以新年问候`,
      });
    }
    events.push(...applyOtoshidamaEncounterReward(state, charaNum, now));
  }
  return events;
}
