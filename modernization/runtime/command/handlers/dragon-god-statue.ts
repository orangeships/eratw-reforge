/**
 * COMF627 龍神の像 — weather omen display at 人間之里:龍神像.
 *
 * S7 wires the command to the weather forecast/warning display layer. The
 * original command is a village-complex shop-like entry, but the weather core
 * it depends on is now modeled; the remaining flavor is collapsed to a pure
 * oracle narration with a location gate.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { CFLAG_ID, FLAG_ID, advanceTimeTicks } from "../../state/settlement.js";
import { checkWeatherListInfo } from "../../weather/list-info.js";

const STATUE_LOCATION = "人間之里:龍神像";
const TIME_COST = 10;

export const dragonGodStatue627HandlerEntry: HandlerEntry = {
  commandNo: 627,
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
      return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
    }
    if (ctx.state.master.location !== STATUE_LOCATION) {
      return { ok: false, reason: { kind: "precondition", message: "不在龍神像前。" } };
    }
    if ((ctx.state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
      return { ok: false, reason: { kind: "precondition", message: "睡眠中。" } };
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    advanceTimeTicks(next, TIME_COST);
    const info = checkWeatherListInfo(next);
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: [
            "仰望龍神像，石像的眼色像是在预示天候。",
            `预兆：${info.headline}。`,
            ...info.lines,
          ].join("\n"),
        },
      ],
      outcome: "ok" as const,
    };
  },
};
