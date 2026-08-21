/** COMF430 — replace the player's worn panties from PANTS_TEMP. */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { BASE_ID, CFLAG_ID, EQUIP_SLOT, FLAG_ID, advanceTimeTicks, getMasterCflag } from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  getPantsTemp,
  listPantyCollection,
  pantyPieceName,
  spendPantsTemp,
  hasPantsInTransit,
} from "../../state/panty-collection.js";
import { recomputeExposure } from "../../state/clothing-write.js";

function block(message: string): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

function optionsFor(state: Readonly<GameState>): { id: number; label: string }[] {
  return [
    { id: 0, label: "不换" },
    ...listPantyCollection(state)
      .filter((row) => row.source === "transit" && row.count > 0)
      .map((row) => ({
        id: row.charaNum * 100 + row.pieceId,
        label: `${row.name}的${pantyPieceName(state, row.charaNum, row.pieceId)} ×${row.count}`,
      })),
  ];
}

function promptFor(state: GameState): PromptSpec | null {
  const options = optionsFor(state);
  return options.length <= 1 ? null : pickOne("要换掉随身的内裤吗？", options);
}

export const comf430HandlerEntry: HandlerEntry = {
  commandNo: 430,
  gateStatus: "complete",
  gateDiagnostics: ["home location", "FLAG:胖次輸送", "not H mode"],
  prompt: (ctx) => promptFor(ctx.state as GameState),
  execCheck: (ctx) => {
    if (ctx.actor !== 0) return block("主人公だけが実行できます。");
    const home = ctx.state.homeLocation ?? ctx.state.master.homeLocation;
    if (!home || ctx.state.master.location !== home) return block("自宅でのみ执行できます。");
    if (!hasPantsInTransit(ctx.state)) return block("没有随身携带的胖次。");
    if (getMasterCflag(ctx.state as GameState, CFLAG_ID.诶嘿嘿) !== 0) return block("诶嘿嘿中不能更衣。");
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state as GameState);
    const spec = promptFor(next);
    const picked = spec ? requirePickOne(spec, ctx.promptAnswer) : null;
    if (picked === null || picked === 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有更换随身的内裤。" }],
        outcome: "noop" as const,
      };
    }
    const encoded = typeof picked === "number" ? picked : Number(picked);
    if (!Number.isInteger(encoded) || encoded < 100) {
      return { state: next, events: [], outcome: "noop" as const };
    }
    const charaNum = Math.trunc(encoded / 100);
    const pieceId = encoded % 100;
    if (getPantsTemp(next, charaNum, pieceId) <= 0 || !spendPantsTemp(next, charaNum, pieceId)) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "这条胖次已经不在随身携带物中。" }],
        outcome: "noop" as const,
      };
    }

    const pieceName = pantyPieceName(next, charaNum, pieceId);
    const oldPiece = next.master.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
    next.master.state.EQUIP[EQUIP_SLOT.下半身内衣２] = pieceId;
    next.master.state.CFLAG[CFLAG_ID.没穿内裤] = 0;
    // The upstream command updates both the remembered normal/sleep panty and
    // the current-day selector. Keep those canonical aliases in sync even
    // though modern rendering reads EQUIP as the live value.
    next.master.state.CFLAG[CFLAG_ID.当前衣装内裤] = pieceId;
    next.master.state.CFLAG[CFLAG_ID.睡眠衣装内裤] = pieceId;
    next.master.state.CFLAG[CFLAG_ID.きょうのぱんつ] = pieceId;
    next.master.state.CFLAG[CFLAG_ID.睡衣胖次] = pieceId;
    next.master.state.CFLAG[CFLAG_ID.指定胖次] = pieceId;
    recomputeExposure(next.master);

    const stopped = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    if (stopped) {
      next.master.state.BASE[BASE_ID.TSP] = Math.max(0, (next.master.state.BASE[BASE_ID.TSP] ?? 0) - 5);
    } else {
      advanceTimeTicks(next, 3);
    }
    const oldText = oldPiece > 0 ? `脱下了原来的胖次，` : "";
    return {
      state: next,
      events: [{
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `${oldText}换成了${pieceName}。`,
      }],
      outcome: "ok" as const,
    };
  },
};
