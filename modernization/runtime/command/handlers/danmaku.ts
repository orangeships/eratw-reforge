/**
 * COMF480 弾幕勝負 — first real minigame slice.
 *
 * Faithful V1: ports the original non-DLC battle/settlement core and exposes
 * it as a playable command on training-capable rooms. The full interactive
 * DANMAKU prompt loop, Gips/item picker, Magic DLC arms, and DANMAKU-specific
 * kojo scenes remain deferred.
 */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommandContext, FailReason, HandlerEntry } from "../types.js";
import { roomProps } from "../comable/room-props.js";
import { applySourceCheck } from "../source-check.js";
import { cloneGameState } from "../../state/game-state.js";
import { settleDanmakuBattle } from "../../state/danmaku.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TCVAR_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

type CheckResult = { ok: true } | { ok: false; reason: FailReason };

function block(message: string): CheckResult {
  return { ok: false, reason: { kind: "precondition", message } };
}

function reasonMessage(reason: FailReason): string {
  if ("message" in reason) return reason.message;
  return `命令 ${reason.commandNo} 不存在。`;
}

function callName(ctx: CommandContext, charaNum: number): string {
  if (charaNum === 0) return ctx.state.master.callName ?? "主人公";
  return ctx.state.charas[charaNum]?.callName ?? `角色${charaNum}`;
}

function eligible(ctx: CommandContext): CheckResult {
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return block("时间停止中无法进行弹幕胜负。");
  }
  if (ctx.target <= 0) return block("没有可挑战的对象。");

  const target = ctx.state.charas[ctx.target];
  if (!target) return block("没有可挑战的对象。");

  if ((target.state.TCVAR[TCVAR_ID.弾幕勝負不能] ?? 0) !== 0) {
    return block(`${callName(ctx, ctx.target)}已经很累了。明天再说吧`);
  }
  if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return block("睡眠中的对象无法进行弹幕胜负。");
  }
  if ((target.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0) {
    return block("烂醉中的对象无法进行弹幕胜负。");
  }
  if ((target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return block("当前状态下无法进行弹幕胜负。");
  }
  if ((target.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) {
    return block("对方正在工作，无法进行弹幕胜负。");
  }
  if ((target.state.ABL[ABL_ID.战斗能力] ?? 0) === 0) {
    return block(`${callName(ctx, ctx.target)}不会弹幕胜负。`);
  }
  if (!roomProps(ctx.state.master.location).training) {
    return block("这里无法进行弹幕胜负。");
  }

  const masterBase = ctx.state.master.state.BASE;
  const targetBase = target.state.BASE;
  if ((masterBase[BASE_ID.気力] ?? 0) < 500 || (masterBase[BASE_ID.体力] ?? 0) < 500) {
    return block(`${callName(ctx, 0)}的体力或气力不足。`);
  }
  if ((targetBase[BASE_ID.気力] ?? 0) < 500 || (targetBase[BASE_ID.体力] ?? 0) < 500) {
    return block(`${callName(ctx, ctx.target)}的体力或气力不足。`);
  }

  return { ok: true };
}

export const comf480HandlerEntry: HandlerEntry = {
  commandNo: 480,
  execCheck: eligible,
  handler: (ctx) => {
    const check = eligible(ctx);
    if (!check.ok) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reasonMessage(check.reason) }],
        outcome: "blocked",
        failReason: check.reason,
      };
    }

    const next = cloneGameState(ctx.state);
    const targetName = callName(ctx, ctx.target);
    const masterName = callName(ctx, 0);
    const events: ObservationEvent[] = [
      {
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: "胜负开始！！",
      },
    ];

    const result = settleDanmakuBattle(next, ctx.target, ctx.rng);
    if (result.favorBonus !== 0) {
      setTflag(next, TFLAG_ID.好感度BONUS, result.favorBonus);
    }

    if (result.won) {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${masterName}赢得了和${targetName}的胜负！`,
      });
    } else {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `${masterName}输掉了……`,
      });
    }

    if (result.firstWin) {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: `【第一次战胜${targetName}】`,
      });
    }
    if (result.strongEnemyBonus) {
      events.push({
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: "【强敌BONUS！所获经验提高】",
      });
    }

    const sourceResult = applySourceCheck(
      next,
      ctx.target,
      { [SOURCE_ID.歓楽]: result.sourcePleasure },
      0,
      result.trustSeed,
    );
    events.push(
      ...sourceResult.events.map((event) => ({
        ...event,
        timestamp: ctx.now(),
      })),
    );

    events.push(
      ...advanceTimeTicks(next, 60).map((event) => ({
        ...event,
        timestamp: ctx.now(),
      })),
    );

    return {
      state: next,
      events,
      outcome: "ok",
    };
  },
};
