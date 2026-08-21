/** Faithful deterministic port of `COMF304 仕事を手伝う` and `JOB_EFFICIENCY`. */

import type { CharaSlot, GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { ITEM_ID, itemCount } from "../../state/items.js";
import { getSuccessRate } from "../../state/sekuhara.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";
import { getYogore, setYogore } from "../../state/yogore.js";
import { youbiMatch } from "../../world/calendar.js";
import { atPlayerBase } from "../../world/location-predicates.js";
import { JOB_ID, JOB_LABEL } from "../../world/work/work-manifest.js";
import { applySourceCheck } from "../source-check.js";
import {
  JUUJUN_PLEASURE_WORK_TIERS,
  SHINMITSU_PLEASURE_WORK_TIERS,
  bracketBonus,
  favorPleasureBonus,
} from "../comf/source-brackets.js";
import type { HandlerEntry, Rng } from "../types.js";

const REISEN = 52;
const ELLEN = 44;
const MYSTIA = 28;
const MIYOI = 134;
const KEINE = 67;

const JOB_DOWNBASE: Readonly<Record<number, readonly [number, number]>> = {
  [JOB_ID.清掃]: [150, 100],
  [JOB_ID.会話]: [50, 150],
  [JOB_ID.お酒]: [50, 150],
  [JOB_ID.戦闘]: [250, 50],
  [JOB_ID.教養]: [50, 250],
  [JOB_ID.料理]: [150, 150],
  [JOB_ID.音楽]: [200, 100],
  [JOB_ID.遊び]: [200, 100],
  [JOB_ID.商売]: [150, 150],
  [JOB_ID.家事]: [150, 100],
};

const STANDARD_ABILITY: Readonly<Record<number, readonly ["ABL" | "TALENT", number]>> = {
  [JOB_ID.清掃]: ["ABL", ABL_ID.清扫技能],
  [JOB_ID.会話]: ["ABL", ABL_ID.話術技能],
  [JOB_ID.戦闘]: ["ABL", ABL_ID.战斗能力],
  [JOB_ID.教養]: ["ABL", ABL_ID.教養],
  [JOB_ID.料理]: ["ABL", ABL_ID.料理技能],
  [JOB_ID.音楽]: ["ABL", ABL_ID.音楽技能],
  [JOB_ID.商売]: ["ABL", ABL_ID.話術技能],
  [JOB_ID.お酒]: ["ABL", ABL_ID.話術技能],
  [JOB_ID.家事]: ["ABL", ABL_ID.清扫技能],
  [JOB_ID.採集]: ["TALENT", TALENT_ID.採集Lv],
  [JOB_ID.釣り]: ["TALENT", TALENT_ID.釣りLv],
  [JOB_ID.調合]: ["TALENT", TALENT_ID.調合Lv],
};

const JOB_EXP: Readonly<Record<number, number>> = {
  [JOB_ID.清掃]: EXP_ID.清掃経験,
  [JOB_ID.会話]: EXP_ID.会話経験,
  [JOB_ID.戦闘]: EXP_ID.戦闘経験,
  [JOB_ID.教養]: EXP_ID.学習経験,
  [JOB_ID.料理]: EXP_ID.料理経験,
  [JOB_ID.音楽]: EXP_ID.演奏経験,
  [JOB_ID.商売]: EXP_ID.会話経験,
  [JOB_ID.宴会片づけ]: EXP_ID.清掃経験,
  [JOB_ID.お酒]: EXP_ID.会話経験,
  // Upstream literally grants 調合経験 for 家事; preserve that oddity.
  [JOB_ID.家事]: EXP_ID.調合経験,
  [JOB_ID.採集]: EXP_ID.採集経験,
  [JOB_ID.釣り]: EXP_ID.釣り経験,
  [JOB_ID.調合]: EXP_ID.調合経験,
};

const QUARTER_EXP_JOBS: ReadonlySet<number> = new Set<number>([
  JOB_ID.清掃,
  JOB_ID.会話,
  JOB_ID.戦闘,
  JOB_ID.教養,
  JOB_ID.商売,
  JOB_ID.宴会片づけ,
  JOB_ID.お酒,
]);

interface EfficiencyResult {
  workPower: number;
  tier: -1 | 0 | 1;
  trust: number;
}

function ability(master: CharaSlot, job: number): number {
  const spec = STANDARD_ABILITY[job];
  if (!spec) return 0;
  return spec[0] === "ABL"
    ? (master.state.ABL[spec[1]] ?? 0)
    : (master.state.TALENT[spec[1]] ?? 0);
}

function addExp(master: CharaSlot, id: number, value: number): void {
  if (value !== 0) master.state.EXP[id] = (master.state.EXP[id] ?? 0) + value;
}

function resolveEfficiency(
  state: GameState,
  target: CharaSlot,
  job: number,
  rng: Rng,
): EfficiencyResult {
  const forced = getTflag(state, TFLAG_ID.口上によるCOM成否判定);
  let tier = (getTflag(state, TFLAG_ID.SELECTCOM的分岐) > 0
    ? 1
    : getTflag(state, TFLAG_ID.SELECTCOM的分岐) < 0
      ? -1
      : 0) as -1 | 0 | 1;
  let trust = getTflag(state, TFLAG_ID.信頼度管理);
  let workPower = 0;

  if (forced === -2) {
    setTflag(state, TFLAG_ID.SELECTCOM的分岐, -1);
    return { workPower: 0, tier: -1, trust };
  }

  const spec = STANDARD_ABILITY[job];
  if (spec) {
    const level = ability(state.master, job);
    const basePower = 50 + level * 75;
    if (forced === -1) {
      tier = -1;
      trust = -2;
    } else {
      const roll = rng.int(100);
      const great = roll <= 10 + level * 2;
      const failed = forced === 0 && roll >= 75 + level * 5;
      if (great) {
        tier = 1;
        trust = 2;
        workPower = basePower * 2;
      } else if (failed) {
        tier = -1;
        trust = -1;
      } else {
        tier = 0;
        trust = 0;
        workPower = basePower;
      }
    }
  } else if (job === JOB_ID.遊び) {
    if (forced === -1) {
      tier = -1;
      trust = -2;
    } else {
      const roll = rng.int(100);
      const great = forced === 0 ? roll <= 9 : roll <= 0;
      const failAt = Math.min(99, 90 + Math.trunc(getSuccessRate(target, state.master) / 5));
      if (great) {
        tier = 1;
        trust = 2;
        addExp(state.master, EXP_ID.会話経験, 1);
      } else if (forced === 0 && roll >= failAt) {
        tier = -1;
        trust = -1;
      } else {
        tier = 0;
        trust = 0;
      }
    }
  }

  setTflag(state, TFLAG_ID.SELECTCOM的分岐, tier);
  setTflag(state, TFLAG_ID.信頼度管理, trust);

  const expId = JOB_EXP[job];
  if (expId !== undefined) {
    if (tier === 1) addExp(state.master, expId, 1);
    if (QUARTER_EXP_JOBS.has(job)) {
      if (rng.int(4) === 0) addExp(state.master, expId, 1);
    } else {
      addExp(state.master, expId, 1);
    }
  }
  return { workPower, tier, trust };
}

function shiftMinutes(state: Readonly<GameState>, target: number, job: number): number {
  if (job === JOB_ID.宴会準備 || job === JOB_ID.宴会片づけ || job === JOB_ID.清掃) return 30;
  const minute = ((state.time.tickValue % 1440) + 1440) % 1440;
  if (target === KEINE) {
    if (minute >= 14 * 60 + 20 && minute <= 14 * 60 + 30) return 10;
    if (minute >= 14 * 60 + 10 && minute <= 14 * 60 + 30) return 20;
    if (minute >= 14 * 60 && minute <= 14 * 60 + 30) return 30;
  }
  if (target === ELLEN) return (state.charas[target]?.state.TCVAR[354] ?? 0) < 25 ? 30 : 60;
  return 60;
}

function cleanCurrentRoom(state: GameState): void {
  if (!atPlayerBase(state, 0)) return;
  let power =
    2 +
    (state.master.state.ABL[ABL_ID.清扫技能] ?? 0) +
    3 * (state.master.state.TALENT[TALENT_ID.清掃中毒] ?? 0);
  const brooms = itemCount(state, ITEM_ID.特制竹箒);
  if (brooms === 1) power += 2;
  else if (brooms === 2) power += 3;
  else if (brooms === 3) power += 4;
  power = Math.trunc(
    (power * (5 - (state.master.state.TALENT[TALENT_ID.汚臭耐性] ?? 0))) / 5,
  );
  if (power !== 0) {
    setYogore(state, state.master.location, Math.trunc(getYogore(state, state.master.location) / power));
  }
}

export const workHandlerEntry: HandlerEntry = {
  commandNo: 304,
  gateStatus: "complete",
  displayCheck: (ctx) => ({
    shown: true,
    ...(ctx.state.charas[ctx.target]?.state.CFLAG[CFLAG_ID.职种] === JOB_ID.遊び
      ? { labelOverride: "遊びに参加する" }
      : {}),
  }),
  execCheck: (ctx) => {
    const target = ctx.state.charas[ctx.target];
    const blocked = (message: string) => ({
      ok: false as const,
      reason: { kind: "precondition" as const, message },
    });
    if (!target || ctx.target <= 0) return blocked("仕事を手伝う相手がいません。");
    if (target.location !== ctx.state.master.location) return blocked("相手が同じ場所にいません。");
    if ((target.state.CFLAG[CFLAG_ID.行动] ?? 0) !== 5) return blocked("相手は仕事中ではありません。");
    const job = target.state.CFLAG[CFLAG_ID.职种] ?? 0;
    if (job === JOB_ID.宴会参加 || job === JOB_ID.酔いつぶれる) return blocked("今はその仕事を手伝えません。");
    if ((target.state.TCVAR[TCVAR_ID.没法帮忙] ?? 0) === 1) return blocked("相手の仕事は手伝えません。");
    if ((target.state.BASE[BASE_ID.仕事量] ?? 0) <= 0) return blocked("相手の仕事は終わっています。");
    if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return blocked("相手は眠っています。");
    if ((target.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return blocked("添い寝中は手伝えません。");
    if (ctx.state.dateSession?.partner === ctx.target) return blocked("約会中の相手には実行できません。");
    if ((ctx.state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) return blocked("気力が足りません。");
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 && ctx.target === MIYOI) {
      return blocked("時間停止中は美宵の仕事を手伝えません。");
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target];
    if (!target || ctx.target <= 0) {
      return { state: next, events: [], outcome: "noop" };
    }
    const job = target.state.CFLAG[CFLAG_ID.职种] ?? 0;
    const timeStopped = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;

    // Upstream exits before JOB_EFFICIENCY for time-stopped conversation work.
    if (timeStopped && job === JOB_ID.会話) {
      return { state: next, events: [], outcome: "noop" };
    }

    const efficiency = resolveEfficiency(next, target, job, ctx.rng);
    if (getTflag(next, TFLAG_ID.口上によるCOM成否判定) === -2) {
      return { state: next, events: [], outcome: "noop" };
    }

    let amount = efficiency.workPower + ctx.rng.int(80) + ctx.rng.int(80) + 10;
    const noHelp = target.state.TCVAR[TCVAR_ID.没法帮忙] ?? 0;
    if (timeStopped && noHelp === 2) amount = Math.trunc(amount / 5);
    if (ctx.target === ELLEN && job === JOB_ID.商売) amount = Math.trunc(amount / 2);
    if (job === JOB_ID.清掃 || job === JOB_ID.宴会片づけ) amount = Math.trunc(amount / 2);

    if (ctx.target === REISEN && youbiMatch(next.time.dayIndex, "木")) {
      addExp(next.master, EXP_ID.調合経験, 2);
      if ((next.master.state.ABL[ABL_ID.教養] ?? 0) > ctx.rng.int(5)) addExp(next.master, EXP_ID.調合経験, 1);
    }
    if (ctx.target === MYSTIA) addExp(next.master, EXP_ID.料理経験, 1);

    if (noHelp !== 2) {
      const remaining = (target.state.BASE[BASE_ID.仕事量] ?? 0) - amount;
      target.state.BASE[BASE_ID.仕事量] =
        remaining < 0 && (target.state.CFLAG[CFLAG_ID.宴会参加] ?? 0) > 0 ? 1 : Math.max(0, remaining);
    }
    const wage = target.state.TCVAR[TCVAR_ID.工资] ?? 0;
    next.master.state.TCVAR[TCVAR_ID.帮忙工作量_MASTER] =
      (next.master.state.TCVAR[TCVAR_ID.帮忙工作量_MASTER] ?? 0) + amount * wage;
    target.state.TCVAR[TCVAR_ID.帮忙工作量_TARGET] =
      (target.state.TCVAR[TCVAR_ID.帮忙工作量_TARGET] ?? 0) + amount;

    const events = [];
    if (job !== JOB_ID.遊び) {
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `帮助${target.callName ?? `角色${ctx.target}`}完成了${JOB_LABEL[job] ?? "工作"}（${amount}）。`,
      });
    }

    if (timeStopped) {
      const complete = (target.state.BASE[BASE_ID.仕事量] ?? 0) <= 0;
      next.master.state.BASE[BASE_ID.TSP] =
        (next.master.state.BASE[BASE_ID.TSP] ?? 0) - (complete ? 10 : 200);
      if (!complete && (job === JOB_ID.清掃 || job === JOB_ID.宴会片づけ)) cleanCurrentRoom(next);
      return { state: next, events, outcome: complete ? "noop" : "ok" };
    }

    const cost = JOB_DOWNBASE[job];
    if (cost) {
      const willDiscount = job === JOB_ID.清掃 && (next.master.state.TALENT[TALENT_ID.清掃中毒] ?? 0) !== 0 ? 50 : 0;
      next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - cost[0];
      next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - (cost[1] - willDiscount);
    }
    target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 10;
    setTflag(next, TFLAG_ID.信頼度管理, efficiency.trust + 5);
    setTflag(next, TFLAG_ID.情緒上昇抑制, 1);

    const joy = Math.max(
      0,
      300 +
        (job === JOB_ID.宴会参加 ? 200 : 0) +
        bracketBonus(target.state.ABL[ABL_ID.従順] ?? 0, JUUJUN_PLEASURE_WORK_TIERS) +
        bracketBonus(target.state.ABL[ABL_ID.親密] ?? 0, SHINMITSU_PLEASURE_WORK_TIERS) +
        favorPleasureBonus(target.state.CFLAG[CFLAG_ID.好感度] ?? 0),
    );
    const settled = applySourceCheck(
      next,
      ctx.target,
      {
        [SOURCE_ID.歓楽]: joy,
        [SOURCE_ID.受動]: 230 + 80 * (target.state.ABL[ABL_ID.従順] ?? 0),
        [SOURCE_ID.征服]: 150 + 200 * (target.state.ABL[ABL_ID.施虐属性] ?? 0),
      },
      0,
      efficiency.trust + 5,
    );
    events.push(...settled.events.map((event) => ({ ...event, timestamp: ctx.now() })));
    events.push(...advanceTimeTicks(next, shiftMinutes(next, ctx.target, job)));
    if (job === JOB_ID.清掃 || job === JOB_ID.宴会片づけ) cleanCurrentRoom(next);

    return { state: next, events, outcome: "ok", transitions: settled.transitions };
  },
};
