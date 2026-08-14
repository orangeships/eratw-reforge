/** Seasonal encounter rewards that are committed after the encounter text. */

import type { ObservationEvent } from "../../schemas/types.js";
import type { GameState } from "../state/game-state.js";
import { addItem, ITEM_ID } from "../state/items.js";
import { CFLAG_ID, EXP_ID } from "../state/settlement.js";
import { SEASON_WINTER, dateOf, seasonOf } from "./calendar.js";

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
