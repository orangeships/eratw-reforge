/** COM621 — starts and settles the full-screen fishing game. */
import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommandContext, FailReason, HandlerEntry, Rng } from "../types.js";
import type { DialogueRouter } from "../../kojo/types.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import {
  activityText,
  calcFishingActivity,
  calcFishingPower,
  ensureFishingGear,
  fishingSpot,
  fishingSpotName,
  FISHING_LINES,
  FISHING_RODS,
  resolveFishCatch,
} from "../../state/fishing.js";
import type { FishingGamePhase, FishingGameSession, FishingSettlement } from "../../state/fishing-game.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EXP_ID, FLAG_ID, SOURCE_ID, TALENT_ID, advanceTimeTicks } from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import { collectCommandKojo } from "../command-kojo.js";
import { createRng } from "../rng.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { beginKojoExecutionFrame, setTflag, TFLAG_ID } from "../../state/tflag.js";

type CheckResult = { ok: true } | { ok: false; reason: FailReason };
const block = (message: string): CheckResult => ({ ok: false, reason: { kind: "precondition", message } });

function reasonMessage(reason: FailReason): string {
  return "message" in reason ? reason.message : `命令 ${reason.commandNo} 不存在。`;
}

function eligible(ctx: CommandContext): CheckResult {
  const master = ctx.state.master;
  if ((ctx.state.items?.[37] ?? 0) === 0) return block("需要釣魚竿才能钓鱼。");
  if (!fishingSpot(master.location)) return block("这里不是钓鱼场。");
  if (ctx.state.fishingGame) return block("已经在钓鱼了。");
  const datePartner = ctx.state.flagStore[FLAG_ID.デート相手] ?? 0;
  if (datePartner !== 0 && ctx.target !== datePartner) return block("约会中只能和约会对象一起钓鱼。");
  if ((master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return block("陪睡中无法钓鱼。");
  if ((master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return block("当前状态下无法钓鱼。");
  if ((master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return block("睡眠中无法钓鱼。");
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return block("时间停止中无法钓鱼。");
  return { ok: true };
}

function selectPartner(ctx: CommandContext): number {
  const datePartner = ctx.state.flagStore[FLAG_ID.デート相手] ?? 0;
  if (datePartner !== 0) return datePartner;
  if (!ctx.target || ctx.target <= 0) return 0;
  const target = ctx.state.charas[ctx.target];
  if (!target) return 0;
  const intimacy = target.state.ABL[ABL_ID.親密] ?? 0;
  const fishingLv = target.state.TALENT[TALENT_ID.釣りLv] ?? 0;
  const awake = (target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0;
  const free = (target.state.CFLAG[CFLAG_ID.行动] ?? 0) !== 5;
  return intimacy >= 5 - fishingLv && awake && free ? ctx.target : 0;
}

function fishingSource(state: GameState, charaNum: number, caught: boolean, itemId: number): Record<number, number> {
  const target = state.charas[charaNum]!;
  const obedience = target.state.ABL[ABL_ID.従順] ?? 0;
  const intimacy = target.state.ABL[ABL_ID.親密] ?? 0;
  const sadism = target.state.ABL[ABL_ID.施虐属性] ?? 0;
  let pleasure = 400 + obedience * 70;
  let affection = 50 + intimacy * 30;
  let passive = 200 + obedience * 100;
  let conquer = 200 + sadism * 100;
  const multiplier = !caught ? .5 : itemId === 610 || itemId === 131 ? .1 : itemId === 708 ? 1.5 : [606, 609, 643].includes(itemId) ? 2 : 1;
  pleasure = Math.floor(pleasure * multiplier);
  passive = Math.floor(passive * (caught ? Math.max(.5, multiplier) : .5));
  conquer = Math.floor(conquer * (caught ? Math.max(.5, multiplier) : .5));
  return { [SOURCE_ID.歓楽]: pleasure, [SOURCE_ID.受動]: passive, [SOURCE_ID.征服]: conquer, [SOURCE_ID.情愛]: affection };
}

export const comf621HandlerEntry: HandlerEntry = {
  commandNo: 621,
  execCheck: eligible,
  handler: (ctx) => {
    const check = eligible(ctx);
    if (!check.ok) return { state: cloneGameState(ctx.state), events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reasonMessage(check.reason) }], outcome: "blocked", failReason: check.reason };
    const next = cloneGameState(ctx.state);
    const events: ObservationEvent[] = [];
    const spotId = fishingSpot(next.master.location);
    const season = next.time.season ?? 1;
    const weather = next.weather;
    const activity = calcFishingActivity(season, next.time.hourOfDay, {
      weatherIdx: weather?.gensokyoWeatherSystem?.[0],
      continuousRainfall: weather?.continuousRainfall ?? 0,
      rainbow: (weather?.gensokyoRainbowSystem?.[0] ?? 0) === 1,
      thunderstorm: (weather?.atmosphericInstability ?? 0) > 0,
    });
    const fishingLv = next.master.state.TALENT[TALENT_ID.釣りLv] ?? 0;
    const luck = next.master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 500;
    if (fishingLv >= 3) events.push({ kind: "NARRATION", timestamp: ctx.now(), text: activityText(activity, luck) });
    const gear = ensureFishingGear(next);
    const rod = FISHING_RODS.find((entry) => entry.id === gear.equippedRod) ?? FISHING_RODS[0]!;
    const line = FISHING_LINES.find((entry) => entry.id === gear.equippedLine) ?? FISHING_LINES[0]!;
    const availableLine = gear.lineSpools[line.id] ?? 0;
    if (availableLine <= 0) {
      const reason: FailReason = { kind: "precondition", message: "鱼线已经用尽，请到香霖堂补充。" };
      return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reasonMessage(reason) }], outcome: "blocked", failReason: reason };
    }
    const power = calcFishingPower(activity, fishingLv, luck, 0, rod.power);
    const catchResult = resolveFishCatch(spotId, power, season, ctx.rng.next);
    const seed = (Math.floor(ctx.rng.next() * 0x7fffffff) ^ next.time.tickValue ^ spotId * 65537) | 0;
    const session: FishingGameSession = {
      id: `fishing-${next.time.dayIndex}-${next.time.tickValue}-${seed}`,
      seed,
      spotId,
      spotName: fishingSpotName(spotId),
      partner: selectPartner(ctx),
      startedAtTick: next.time.tickValue,
      rodId: rod.id,
      lineId: line.id,
      rodControl: rod.control,
      lineTension: line.tension,
      lineDurability: Math.min(line.maxDurability, availableLine),
      catch: catchResult,
      biteDelayMs: 1500 + Math.floor(ctx.rng.next() * 2800),
      hookWindowMs: Math.max(620, 1250 - catchResult.rank * 4),
      difficulty: Math.max(8, catchResult.rank + (catchResult.sizeCm ?? 15) * .12),
      fishDensity: Math.max(12, Math.min(38, Math.round(12 + activity * .18 + power * .07))),
    };
    next.fishingGame = session;
    events.push({ kind: "NARRATION", timestamp: ctx.now(), text: `在${session.spotName}选好钓点，架起了${rod.name}。` });
    return { state: next, events, outcome: "ok", kojoHandled: true };
  },
};

export type FishingSettlementOutcome = Extract<FishingGamePhase, "landed" | "escaped" | "snapped"> | "aborted";

export interface FishingSettlementDeps {
  dialogueRouter?: DialogueRouter;
  rng?: Rng;
}

export function finishFishingSession(
  state: GameState,
  outcome: FishingSettlementOutcome,
  remainingLine: number,
  now: () => number = Date.now,
  deps: FishingSettlementDeps = {},
): { state: GameState; events: ObservationEvent[]; settlement: FishingSettlement | null } {
  let next = cloneGameState(state);
  const session = next.fishingGame;
  if (!session) return { state: next, events: [], settlement: null };
  const events: ObservationEvent[] = [];
  /** Authored partner kojo captured at settlement. Branched per outcome
   *  upstream via COM621 dispatch (caught vs. line-snap vs. escaped-hook).
   *  Empty for `aborted` (player left voluntarily, no kojo). Returned
   *  separately from `events` so the store can render the branch on the
   *  fishing page instead of dumping it straight to the eventLog. */
  const settlementKojo: import("../../state/fishing-game.js").FishingKojoLine[] = [];
  const gear = ensureFishingGear(next);
  gear.lineSpools[session.lineId] = Math.max(0, Math.floor(Math.min(session.lineDurability, remainingLine)));
  const partner = session.partner > 0 ? next.charas[session.partner] : undefined;
  next.master.state.EXP[EXP_ID.釣り経験] = (next.master.state.EXP[EXP_ID.釣り経験] ?? 0) + 1;
  if ((next.items?.[107] ?? 0) > 0 && (session.seed & 1) === 0) next.master.state.EXP[EXP_ID.釣り経験] += 1;
  if (partner) partner.state.EXP[EXP_ID.釣り経験] = (partner.state.EXP[EXP_ID.釣り経験] ?? 0) + 1;
  next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 100;
  const caught = outcome === "landed";
  if (caught) {
    next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    next.items ??= {};
    next.items[session.catch.itemId] = (next.items[session.catch.itemId] ?? 0) + 1;
    next.master.state.EXP[EXP_ID.釣り経験] += session.catch.rank >= 100 ? 2 : 1;
    gear.catches += 1;
    if (session.catch.fish) {
      gear.catchCounts[session.catch.fish.id] = (gear.catchCounts[session.catch.fish.id] ?? 0) + 1;
      if (session.catch.sizeCm !== undefined) gear.bestSizes[session.catch.fish.id] = Math.max(gear.bestSizes[session.catch.fish.id] ?? 0, session.catch.sizeCm);
    }
    const size = session.catch.sizeCm === undefined ? "" : `（${session.catch.sizeCm} cm）`;
    events.push({ kind: "NARRATION", timestamp: now(), text: `钓到了${session.catch.name}${size}！` });
  } else {
    const text = outcome === "snapped" ? "鱼线绷断了，水里的东西也随之逃走……" : outcome === "aborted" ? "收起钓具，结束了这次垂钓。" : "鱼挣脱了钩，水面重新恢复平静……";
    events.push({ kind: "NARRATION", timestamp: now(), text });
  }
  if (partner && outcome !== "aborted") {
    const result = applySourceCheck(next, session.partner, fishingSource(next, session.partner, caught, caught ? session.catch.itemId : 0));
    events.push(...result.events.map((event) => ({ ...event, timestamp: now() })));

    // Upstream dispatches COM621 only after the catch result has populated
    // TFLAG:193/194. The full-screen minigame therefore owns this deferred
    // personal-kojo boundary. Branch the upstream dispatch on outcome so the
    // fished/snapped/escaped arms each get the right RESULT:1 / TFLAG:194
    // environment; routes 0 (catch) / 1 (snapped) / 2 (escaped) match the
    // common eraTW COM621 branches.
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, caught ? session.catch.itemId : 0);
    setTflag(next, TFLAG_ID.SOURCEなどに影響しないSELECTCOMの分岐, 0);
    if (deps.dialogueRouter) {
      beginKojoExecutionFrame(next, 0, session.partner, 621);
      const rng = deps.rng ?? createRng(session.seed);
      const commandNo = 621;
      const kojo = collectCommandKojo({
        state: next,
        actor: 0,
        target: session.partner,
        commandNo,
        rng,
        rngSeed: session.seed,
        now,
        dialogueRouter: deps.dialogueRouter,
      });
      if (kojo.effects.length > 0) next = applyKojoEffects(next, kojo.effects);
      // Capture the kojo into the settlement payload rather than appending to
      // events. The store will commit it to the eventLog only after the
      // player dismisses the in-scene terminal phase card.
      for (const event of kojo.events) {
        if (event.kind === "DIALOGUE_LINE" && event.text.trim().length > 0) {
          settlementKojo.push({
            charaNum: event.charaNum,
            text: event.text,
            ...(event.form ? { form: event.form } : {}),
          });
        }
      }
    }
  }
  events.push(...advanceTimeTicks(next, 20).map((event) => ({ ...event, timestamp: now() })));
  // NOTE: kojo is intentionally NOT written to eventLog here. The store
  // writes it when the player commits the settlement (commitFishingSettlement).
  // `aborted` (player pressed 中止/Escape) has no terminal card — the UI
  // returns straight to the scene, so no settlement is held back.
  const settlement: FishingSettlement | null = outcome === "aborted"
    ? null
    : {
        outcome,
        spotName: session.spotName,
        catch: session.catch,
        settlementKojo,
        finishedAtTick: next.time.tickValue,
      };
  // Clear the active session; the settlement lives in its own field so the
  // screen can render the in-scene terminal phase card without fishingGame.
  next.fishingGame = null;
  return { state: next, events, settlement };
}
