/**
 * Compatibility slice for upstream COM433 自慰.
 *
 * Train.csv comments out 433 in the shipped upstream command table, but its
 * COM/COM_ABLE implementation is complete and is the owner of CFLAG 346.
 * The modern runtime intentionally enables it as an explicit migration
 * deviation so the existing 700–751 family can be entered and cleaned up.
 */

import type { CommandContext, CommandResult, ExecCheck, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import {
  beginKojoExecutionFrame,
  isCommandActionPhase,
} from "../../state/tflag.js";
import { isTimeStopped } from "../h-mode.js";

const COMMAND_NO = 433;

function block(message: string): ReturnType<ExecCheck> {
  return { ok: false, reason: { kind: "precondition", message } };
}

function check433(ctx: CommandContext): ReturnType<ExecCheck> {
  if (!isCommandActionPhase(ctx.state)) {
    return block("当前不在行动选择阶段。");
  }
  if (ctx.target > 0) {
    const target = ctx.state.charas[ctx.target];
    if (!target) return block("选择的旁观目标不存在。");
    // COM_ABLE433: ordinary witnesses block. During time-stop, only a target
    // without the stop-action marker (CFLAG 344) is still safely frozen.
    if (
      !isTimeStopped(ctx.state) ||
      (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 1
    ) {
      return block("有能够目击的旁观者。");
    }
  }
  if ((ctx.state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
    return block("气力不足。");
  }
  if ((ctx.state.master.state.CFLAG[CFLAG_ID.现在忙得抽不出手] ?? 0) !== 0) {
    return block("现在正忙得抽不出手。");
  }
  return { ok: true };
}

export const selfPleasure433HandlerEntry: HandlerEntry = {
  commandNo: COMMAND_NO,
  gateStatus: "complete",
  gateDiagnostics: [
    "Enabled by modernization compatibility policy although upstream Train.csv comments out 433.",
  ],
  execCheck: check433,
  displayCheck: (ctx) => ({ shown: check433(ctx).ok, labelOverride: "自慰" }),
  handler: (ctx: CommandContext): CommandResult => {
    const next = cloneGameState(ctx.state);
    next.master.state.CFLAG[CFLAG_ID.现在忙得抽不出手] = 1;

    const events = [] as ReturnType<typeof advanceTimeTicks>;
    if (!isTimeStopped(next)) {
      events.push(...advanceTimeTicks(next, 5));
    }

    // COM433 restores TARGET=MASTER. Keep the command frame in sync so
    // personal-kojo/PALAMCNG and subsequent settlement cannot apply a
    // selected spectator's effects to this master-only entry command.
    const frame = next.turnContext?.frame;
    if (frame) {
      frame.target = 0;
      frame.participants = [0];
      frame.roleAliases = { MASTER: 0, PLAYER: 0, TARGET: 0 };
    } else {
      beginKojoExecutionFrame(next, 0, 0, COMMAND_NO);
    }

    return {
      state: next,
      events: [
        ...events.map((event) => ({ ...event, timestamp: ctx.now() })),
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: "%CALLNAME:MASTER% 开始了自慰。",
        },
      ],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};
