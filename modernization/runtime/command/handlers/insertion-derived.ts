import type { CommandContext, ExecCheck, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

const insertedVCheck: ExecCheck = (ctx) => {
  const session = ctx.state.training;
  if (!session || session.target !== ctx.target || !session.vInserted) {
    return block("需要先以Ｖ系体位完成插入。");
  }
  const target = ctx.state.charas[ctx.target];
  if (!target || target.location !== ctx.state.master.location) {
    return block("插入对象已经不在场。");
  }
  return { ok: true };
};

function derivedHandler(kind: "g-spot" | "cervix") {
  return (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const cervixExp = target.state.EXP[EXP_ID.子宮口開発経験] ?? 0;
    const sources: Record<number, number> = kind === "g-spot"
      ? {
          [SOURCE_ID.快Ｖ]: 500,
          [SOURCE_ID.情愛]: 200,
          [SOURCE_ID.苦痛]: 500,
          [SOURCE_ID.露出]: 100,
          [SOURCE_ID.反感]: 500,
        }
      : {
          [SOURCE_ID.快Ｖ]: cervixExp > 300 ? 700 : cervixExp > 150 ? 600 : cervixExp > 50 ? 500 : 250,
          [SOURCE_ID.情愛]: 200,
          [SOURCE_ID.苦痛]: cervixExp > 50 ? Math.max(600 - cervixExp * 2, 400) / 2 : Math.max(600 - cervixExp * 2, 400),
          [SOURCE_ID.露出]: 120,
          [SOURCE_ID.反感]: 500,
        };
    if ((target.state.TALENT[TALENT_ID.自己愛] ?? 0) < 0 || (target.state.TALENT[TALENT_ID.抵抗] ?? 0) !== 0) {
      sources[SOURCE_ID.鬱屈] = 500;
    }

    next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
    target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - (kind === "g-spot" ? 40 : 60);
    target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - (kind === "g-spot" ? 50 : 120);
    target.state.TCVAR[TCVAR_ID.行為者] = 0;
    next.master.state.TCVAR[TCVAR_ID.射精箇所] = 1;
    target.state.TCVAR[TCVAR_ID.射精箇所] = 13;
    next.master.state.EXP[EXP_ID.挿入経験] = (next.master.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;
    target.state.EXP[EXP_ID.Ｖ性交経験] = (target.state.EXP[EXP_ID.Ｖ性交経験] ?? 0) + 1;
    if (kind === "cervix") {
      target.state.EXP[EXP_ID.子宮口開発経験] = cervixExp + 1;
    }
    const settlement = applySourceCheck(next, ctx.target, sources);
    return {
      state: next,
      events: [{
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: kind === "g-spot" ? "插入后继续刺激着Ｇ点。" : "插入后继续刺激着子宫口。",
      }, ...settlement.events],
      outcome: "ok" as const,
      transitions: settlement.transitions,
    };
  };
}

export const insertionGSpot72HandlerEntry: HandlerEntry = {
  commandNo: 72,
  gateStatus: "complete",
  execCheck: insertedVCheck,
  hModeMenuCheck: insertedVCheck,
  handler: derivedHandler("g-spot"),
};

export const insertionCervix73HandlerEntry: HandlerEntry = {
  commandNo: 73,
  gateStatus: "complete",
  execCheck: insertedVCheck,
  hModeMenuCheck: insertedVCheck,
  handler: derivedHandler("cervix"),
};
