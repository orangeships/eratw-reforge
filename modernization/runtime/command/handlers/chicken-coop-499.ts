/** COMF499 鶏小屋 — faithful menu gate with a fail-closed deferred body. */
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  getMasterBase,
  getMasterCflag,
} from "../../state/settlement.js";
import { hasPlace, PLACE_GARDEN } from "../../world/place-flags.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import type { HandlerEntry } from "../types.js";

export const chickenCoop499HandlerEntry: HandlerEntry = {
  commandNo: 499,
  deferred: true,
  execCheck: (ctx) => {
    const block = (message: string) => ({
      ok: false as const,
      reason: { kind: "precondition" as const, message },
    });
    if (!hasPlace(placeFlagsOf(ctx.state.master.location), PLACE_GARDEN)) {
      return block("鸡舍只能在设有菜园的地点管理。");
    }
    if (getMasterBase(ctx.state, BASE_ID.気力) <= 0) {
      return block("没有气力管理鸡舍。");
    }
    if (getMasterCflag(ctx.state, CFLAG_ID.诶嘿嘿) === 2) {
      return block("当前调教状态下无法管理鸡舍。");
    }
    return { ok: true };
  },
  handler: (ctx) => ({
    state: cloneGameState(ctx.state),
    events: [{
      kind: "STATUS_MESSAGE" as const,
      timestamp: ctx.now(),
      source: "system" as const,
      text: "鸡舍交互尚未迁移；本次没有产生任何结算。",
    }],
    outcome: "blocked" as const,
    failReason: {
      kind: "precondition" as const,
      message: "鸡舍交互尚未迁移。",
    },
  }),
};
