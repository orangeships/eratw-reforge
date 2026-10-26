/**
 * Character commissions:
 *
 * - COMF366 依頼を聞く / 听取委托
 * - COMF367 依頼実行 / 执行委托
 * - COMF630 ホフゴブリンに依頼 / 霍布哥布林代办服务
 *
 * V1 ports the real request state machine and a conservative source-read
 * catalog. Personal commission kojo is routed through `resolveIraiKojo` and
 * exposes its detailed route status to the shell-side L1 fallback boundary.
 */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommissionSlot, GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { getYogore } from "../../state/yogore.js";
import { GATHERING_SPOT_1_ITEMS } from "../../state/gathering.js";
import {
  COMMISSION_PROGRESS,
  ITEM_CHEAP_INGREDIENT,
  ITEM_HIGH_INGREDIENT,
  acceptCommission,
  canAcceptCommission,
  clearCommissionSlot,
  commissionActName,
  commissionContent,
  commissionRequestDialogLines,
  commissionStatus,
  commissionTitleForTarget,
  describeCommission,
  executeCommissionCore,
  findCommissionDef,
  findSlotByClient,
  reportCommission,
  searchActiveCommissionSlot,
  setCommissionProgress,
  setCommissionExecutionResult,
  iraiIdToClient,
  type CommissionScene,
} from "../../state/commission.js";
import { itemCount } from "../../state/items.js";
import { canAfford, formatMoney, pay } from "../../state/money.js";
import { CFLAG_ID, FLAG_ID, advanceTimeTicks } from "../../state/settlement.js";
import { mergeIraiKojoResolutions } from "../../kojo/irai-kojo.js";
import type { KojoResolution } from "../../kojo/types.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import type { CommandContext, CommandResult, HandlerEntry } from "../types.js";

const HOBGOBLIN_CLEAN_COST = 3000;
const HOBGOBLIN_WATER_COST = 15000;
const HOBGOBLIN_WATER_ITEM = 150;

type CheckResult = { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } };

function block(message: string): CheckResult {
  return { ok: false, reason: { kind: "precondition", message } };
}

function responsiveTarget(state: Readonly<GameState>, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return false;
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) return false;
  return true;
}

function kojoEvents(
  ctx: CommandContext,
  charaNum: number,
  scene: CommissionScene,
  iraiId: number,
  state: Readonly<GameState>,
  resolutions: KojoResolution[],
): ObservationEvent[] {
  const role =
    scene === "依頼報告不要"
      ? "NO_REPORT"
      : charaNum === iraiIdToClient(iraiId)
        ? "CLIENT"
        : "TARGET";
  const detailed = ctx.dialogueRouter?.resolveIraiKojoDetailed?.(
    charaNum, role, scene, iraiId, state, ctx.rng,
  );
  const lines = detailed?.lines ?? ctx.dialogueRouter?.resolveIraiKojo?.(
    charaNum, role, scene, iraiId, state, ctx.rng,
  ) ?? [];
  resolutions.push(detailed ?? (lines.length > 0
    ? {
        status: "resolved", lines, effects: [], unsupportedPredicates: [],
        unsupportedEffects: [], diagnostics: [],
      }
    : {
        status: "unsupported", lines: [], effects: [], unsupportedPredicates: [],
        unsupportedEffects: [], diagnostics: [{ code: "unresolved-text", detail: "IRAI router did not expose a detailed route status" }],
      }));
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

function withCommissionKojo(result: CommandResult, resolutions: readonly KojoResolution[]): CommandResult {
  return resolutions.length > 0
    ? { ...result, commandKojoResolution: mergeIraiKojoResolutions(resolutions) }
    : result;
}

function narration(text: string, ctx: CommandContext): ObservationEvent {
  return { kind: "NARRATION", timestamp: ctx.now(), text };
}

function reportRewardEvents(
  slot: CommissionSlot,
  state: GameState,
  beforeMoney: number,
  beforeItems: Readonly<Record<number, number>>,
  materials: readonly { id: number; name: string }[],
  ctx: CommandContext,
): ObservationEvent[] {
  if (slot.kind !== "common") return [];
  // Letter rewards are drawn with replacement and must retain draw order.
  if (slot.localId === 8) return materials.map(({ name }) => narration(`获得了${name}`, ctx));
  const events: ObservationEvent[] = [];
  const moneyGain = state.money - beforeMoney;
  // 一般依頼17/18 大成功 → the client tops the fee up on top of the listed
  // reward (`一般17.ERB:195-201` / `一般18.ERB:281-287`). Report the two
  // payments separately so the bonus line lands between them.
  if (slot.bonus && (slot.localId === 17 || slot.localId === 18) && moneyGain > 0) {
    const listed = slot.localId === 17 ? 2500 : 2000;
    if (moneyGain > listed) {
      const callName = state.charas[slot.clientId]?.callName ?? "对方";
      events.push(narration(`获得了${formatMoney(listed)}`, ctx));
      events.push(narration(
        slot.localId === 17 ? `${callName}支付了奖金！` : `${callName}追加了打赏！`,
        ctx,
      ));
      events.push(narration(`获得了${formatMoney(moneyGain - listed)}`, ctx));
      return events;
    }
  }
  if (moneyGain > 0) events.push(narration(`获得了${formatMoney(moneyGain)}`, ctx));
  for (const [key, count] of Object.entries(state.items ?? {})) {
    const id = Number(key);
    const gain = count - (beforeItems[id] ?? 0);
    if (gain <= 0) continue;
    const name = id === ITEM_CHEAP_INGREDIENT ? "平价食材"
      : id === ITEM_HIGH_INGREDIENT ? "高级食材"
        : GATHERING_SPOT_1_ITEMS.find((item) => item.id === id)?.name ?? `道具${id}`;
    events.push(narration(`获得了${name}${gain > 1 ? `×${gain}` : ""}`, ctx));
  }
  return events;
}

function settleReportWithVisibleRewards(state: GameState, slot: CommissionSlot, ctx: CommandContext): ObservationEvent[] {
  const beforeMoney = state.money;
  const beforeItems = { ...state.items };
  const materials = reportCommission(state, slot, ctx.rng);
  return reportRewardEvents(slot, state, beforeMoney, beforeItems, materials, ctx);
}

function commission366Prompt(ctx: CommandContext): PromptSpec | null {
  const status = commissionStatus(ctx.state, ctx.target);
  if (status === COMMISSION_PROGRESS.Offered) {
    return pickOne("要接受这份委托吗？", [
      { id: "accept", label: "接受委托" },
      { id: "decline", label: "拒绝" },
    ]);
  }
  if (status === COMMISSION_PROGRESS.Active) {
    return pickOne("要确认这份委托吗？", [
      { id: "confirm", label: "确认" },
      { id: "abandon", label: "放弃委托" },
    ]);
  }
  return null;
}

function commission366Check(ctx: CommandContext): CheckResult {
  if (ctx.target <= 0 || !ctx.state.charas[ctx.target]) {
    return block("委托需要选择一个角色。");
  }
  if (!responsiveTarget(ctx.state, ctx.target)) {
    return block("对方现在无法回应委托。");
  }

  const status = commissionStatus(ctx.state, ctx.target);
  switch (status) {
    case COMMISSION_PROGRESS.Offered:
      return canAcceptCommission(ctx.state, ctx.target)
        ? { ok: true }
        : block("当前委托无法受理。");
    case COMMISSION_PROGRESS.Active:
      return findSlotByClient(ctx.state, ctx.target)
        ? { ok: true }
        : block("委托记录不完整。");
    case COMMISSION_PROGRESS.Completed:
    case COMMISSION_PROGRESS.Expired:
    case COMMISSION_PROGRESS.MissedReport:
    case COMMISSION_PROGRESS.Failed:
      return findSlotByClient(ctx.state, ctx.target)
        ? { ok: true }
        : block("没有可以报告的委托。");
    case COMMISSION_PROGRESS.Generated:
    case COMMISSION_PROGRESS.EndedSuccess:
    case COMMISSION_PROGRESS.EndedExpired:
    case COMMISSION_PROGRESS.EndedMissedReport:
    case COMMISSION_PROGRESS.EndedFailed:
    default:
      return block("现在没有可以处理的委托。");
  }
}

export const comf366HandlerEntry: HandlerEntry = {
  commandNo: 366,
  prompt: commission366Prompt,
  execCheck: (ctx) => {
    const r = commission366Check(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  displayCheck: (ctx) => ({
    shown: true,
    labelOverride: commissionTitleForTarget(ctx.state, ctx.target),
  }),
  handler: (ctx: CommandContext): CommandResult => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const status = commissionStatus(next, target);
    const iraiId = commissionContent(next, target);
    const events: ObservationEvent[] = [];
    const kojoResolutions: KojoResolution[] = [];

    if (status === COMMISSION_PROGRESS.Offered) {
      const spec = commission366Prompt(ctx);
      const picked = spec ? requirePickOne(spec, ctx.promptAnswer) : null;
      if (picked == null) {
        return {
          state: next,
          events: [narration("还没有选择是否接受委托。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "missing commission answer" },
        };
      }

      events.push(narration("看来%CALLNAME:TARGET%有事想拜托%CALLNAME:MASTER%。", ctx));
      events.push(...kojoEvents(ctx, target, "依頼提示時", iraiId, next, kojoResolutions));
      events.push(...describeCommission(next, target).map((line) => narration(line, ctx)));

      if (picked === "decline") {
        events.push(narration("%CALLNAME:MASTER%郑重地拒绝了。", ctx));
        events.push(...kojoEvents(ctx, target, "依頼非受託時", iraiId, next, kojoResolutions));
        events.push(narration("%CALLNAME:TARGET%露出了遗憾的神情。", ctx));
        // IRAI_HAPPEN's pending offer is temporary.  Refusal clears both the
        // CFLAG pair and the serialized CommissionOffer, so the next morning
        // can generate a fresh request instead of replaying the old one.
        setCommissionProgress(next, target, 0);
        return withCommissionKojo({ state: next, events, outcome: "noop" }, kojoResolutions);
      }

      const slot = acceptCommission(next, target);
      if (!slot) {
        return {
          state: next,
          events: [narration("委托栏已经满了，无法接受新的委托。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "commission slots full" },
        };
      }
      events.push(narration("%CALLNAME:MASTER%接受了%CALLNAME:TARGET%的委托。", ctx));
      events.push(...kojoEvents(ctx, target, "依頼受託時", slot.iraiId, next, kojoResolutions));
      // COMF366 依頼を聞く.ERB:127-135 — the accepted request is spelled out
      // right here (一般依頼17 only; 18 shows its order in the detail panel).
      events.push(...commissionRequestDialogLines(next, target).map((line) => narration(line, ctx)));
      return withCommissionKojo({ state: next, events, outcome: "ok" }, kojoResolutions);
    }

    if (status === COMMISSION_PROGRESS.Active) {
      const slot = findSlotByClient(next, target);
      if (!slot) {
        return {
          state: next,
          events: [narration("委托记录不完整。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "commission slot missing" },
        };
      }

      const spec = commission366Prompt(ctx);
      const picked = spec ? requirePickOne(spec, ctx.promptAnswer) : null;
      if (picked == null) {
        return {
          state: next,
          events: [narration("还没有选择确认或破弃委托。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "missing commission answer" },
        };
      }

      events.push(...kojoEvents(ctx, target, "依頼確認時", slot.iraiId, next, kojoResolutions));
      events.push(...describeCommission(next, target).map((line) => narration(line, ctx)));
      if (picked === "abandon") {
        events.push(...kojoEvents(ctx, target, "依頼破棄時", slot.iraiId, next, kojoResolutions));
        events.push(narration("已放弃委托。", ctx));
        clearCommissionSlot(next, slot, COMMISSION_PROGRESS.EndedFailed);
        return withCommissionKojo({ state: next, events, outcome: "ok" }, kojoResolutions);
      }
      return withCommissionKojo({ state: next, events, outcome: "noop" }, kojoResolutions);
    }

    if (
      status === COMMISSION_PROGRESS.Completed ||
      status === COMMISSION_PROGRESS.Expired ||
      status === COMMISSION_PROGRESS.MissedReport ||
      status === COMMISSION_PROGRESS.Failed
    ) {
      const slot = findSlotByClient(next, target);
      if (!slot) {
        return {
          state: next,
          events: [narration("没有可以报告的委托。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "commission slot missing" },
        };
      }
      const success = status === COMMISSION_PROGRESS.Completed;
      events.push(...kojoEvents(ctx, target, success ? "成功報告時" : "失敗報告時", slot.iraiId, next, kojoResolutions));
      const rewards = settleReportWithVisibleRewards(next, slot, ctx);
      events.push(...rewards);
      if (!success || rewards.length === 0) {
        events.push(narration(success ? "已报告委托结果。" : "已报告委托失败。", ctx));
      }
      return withCommissionKojo({ state: next, events, outcome: "ok" }, kojoResolutions);
    }

    return {
      state: next,
      events: [narration("现在没有可以处理的委托。", ctx)],
      outcome: "noop",
    };
  },
};

function commission367Check(ctx: CommandContext): CheckResult {
  const slot = searchActiveCommissionSlot(ctx.state, ctx.target);
  return slot ? { ok: true } : block("没有可以在这里执行的委托。");
}

/** Source-backed action lines; complex choice scenes keep a short action line. */
function executionNarration(slot: CommissionSlot, state: GameState): string[] {
  const master = "%CALLNAME:MASTER%";
  const target = "%CALLNAME:TARGET%";
  const client = `%CALLNAME:${slot.clientId}%`;
  const dish = state.dish?.name ?? "料理";
  const cleanRoom = getYogore(state, slot.targetLocation ?? state.master.location) < 1000;
  if (slot.kind === "common") {
    switch (slot.localId) {
      case 1: return [cleanRoom ? `${target}的房间变得十分干净` : `${master}和${target}一起清扫了房间`];
      case 2: return [`${master}给${client}家里的盆栽和植物浇了水`];
      case 3: return [`${master}陪${target}一起玩`];
      case 4: return [`${master}和${target}一起制作着${dish}`];
      case 5: return [`${master}和${target}进行着弹幕游戏的特训`];
      case 6: return [`${master}回答了${target}的疑问`];
      case 7: return [cleanRoom ? `${target}的房间十分干净` : `${master}和${target}合作彻底清扫了房间`];
      case 8: return [`${master}把保管着的信交给了${target}`];
      case 9: return [`${master}把保管着的遗失物交给了${target}`];
      case 10: return [`一直在寻找的${master}终于发现了遗失物`];
      case 11: return [`一直在打听的${master}终于发现了遗失物`];
      case 12: return [`成功惩罚${target}了！`];
      case 13: return [`${master}把美味的鱼交给了${target}`, "总感觉活下去的希望涌出来了。"];
      case 14: return [
        `${master}交付了木柴`,
        ...(state.time.season === 4 ? [`${target}高兴地表示这样就不用在寒冷中发抖了`] : []),
      ];
      case 15: return [`${master}牵起了${client}的手`];
      case 16: return [`${target}对${master}的回答很满意！`];
      case 17:
      case 18:
        // 一般依頼17/18 依頼実行時 (:109-111 / :191-193): the delivery callout
        // first, then the hand-over line naming the ordered dish.
        return [`「这是您点的${dish}」`, `${master}将${target}点的<${dish}>交给了${target}`];
    }
  }
  const def = findCommissionDef(slot.kind, slot.localId, slot.clientId);
  return [def ? `${master}执行了「${def.name}」。` : `${master}执行了委托。`];
}

export const comf367HandlerEntry: HandlerEntry = {
  commandNo: 367,
  execCheck: (ctx) => {
    const r = commission367Check(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  displayCheck: (ctx) => ({
    shown: true,
    labelOverride: commissionActName(ctx.state, ctx.target),
  }),
  handler: (ctx: CommandContext): CommandResult => {
    const next: GameState = cloneGameState(ctx.state);
    const slot = searchActiveCommissionSlot(next, ctx.target);
    if (!slot) {
      return {
        state: next,
        events: [narration("没有可以在这里执行的委托。", ctx)],
        outcome: "blocked",
        failReason: { kind: "precondition", message: "no active commission" },
      };
    }

    const events: ObservationEvent[] = [];
    const kojoResolutions: KojoResolution[] = [];
    events.push(...kojoEvents(ctx, ctx.target, "依頼実行直前", slot.iraiId, next, kojoResolutions));
    events.push(...executionNarration(slot, next).map((text) => narration(text, ctx)));

    const executed = executeCommissionCore(next, slot, ctx.rng);
    events.push(...executed.events.map((event) => ({ ...event, timestamp: ctx.now() })));
    if ((next.flagStore[FLAG_ID.時間停止] ?? 0) === 0) {
      events.push(...advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() })));
    }

    if (executed.result === "cancel") {
      return { state: next, events, outcome: "noop" };
    }

    setCommissionExecutionResult(next, slot, executed.result);
    events.push(...kojoEvents(ctx, ctx.target, "依頼実行直後", slot.iraiId, next, kojoResolutions));

    if (executed.result === "unresolved") {
      return withCommissionKojo({ state: next, events, outcome: "ok" }, kojoResolutions);
    }

    if (ctx.target === slot.clientId) {
      const success = executed.result === "success";
      events.push(...kojoEvents(ctx, slot.clientId, success ? "成功報告時" : "失敗報告時", slot.iraiId, next, kojoResolutions));
      const rewards = settleReportWithVisibleRewards(next, slot, ctx);
      events.push(...rewards);
      if (!success || rewards.length === 0) {
        events.push(narration(success ? "已报告委托结果。" : "已报告委托失败。", ctx));
      }
    } else {
      events.push(narration(`别忘了向%CALLNAME:${slot.clientId}%报告。`, ctx));
    }

    return withCommissionKojo({ state: next, events, outcome: "ok" }, kojoResolutions);
  },
};

function mapRoot(location: string | undefined): string {
  return (location ?? "").split(":")[0] ?? "";
}

function isHobgoblinLocation(state: Readonly<GameState>): boolean {
  const loc = state.master.location;
  if (mapRoot(loc) === "地底") return false;
  if (loc === state.homeLocation) return false;
  return loc.endsWith(":大廳") || loc.endsWith(":大厅") || loc === "大廳" || loc === "大厅";
}

function hobgoblinPrompt(ctx: CommandContext): PromptSpec {
  return pickOne("有什么要委托的么？", [
    { id: "none", label: "没有委托" },
    {
      id: "clean",
      label: "代理扫除",
      detail: formatMoney(HOBGOBLIN_CLEAN_COST),
      disabled:
        (ctx.state.flagStore[FLAG_ID.上门清扫] ?? 0) !== 0 ||
        !canAfford(ctx.state as GameState, HOBGOBLIN_CLEAN_COST),
    },
    {
      id: "water",
      label: "代理浇水",
      detail: `${formatMoney(HOBGOBLIN_WATER_COST)} / 需要道具 ${HOBGOBLIN_WATER_ITEM}`,
      disabled:
        itemCount(ctx.state as GameState, HOBGOBLIN_WATER_ITEM) <= 0 ||
        !canAfford(ctx.state as GameState, HOBGOBLIN_WATER_COST),
    },
  ]);
}

function hobgoblinCheck(ctx: CommandContext): CheckResult {
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return block("时间停止中。");
  if ((ctx.state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return block("睡眠中。");
  if (!isHobgoblinLocation(ctx.state)) return block("这里不能呼叫霍布哥布林代办。");
  return { ok: true };
}

export const comf630HandlerEntry: HandlerEntry = {
  commandNo: 630,
  prompt: hobgoblinPrompt,
  execCheck: (ctx) => {
    const r = hobgoblinCheck(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  displayCheck: () => ({ shown: true, labelOverride: "霍布哥布林代办" }),
  handler: (ctx: CommandContext): CommandResult => {
    const next: GameState = cloneGameState(ctx.state);
    const spec = hobgoblinPrompt(ctx);
    const picked = requirePickOne(spec, ctx.promptAnswer);
    if (picked == null || picked === "none") {
      return {
        state: next,
        events: [narration("没有委托。", ctx)],
        outcome: "noop",
      };
    }

    if (picked === "clean") {
      if (!canAfford(next, HOBGOBLIN_CLEAN_COST)) {
        return {
          state: next,
          events: [narration("钱不够。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "not enough money" },
        };
      }
      pay(next, HOBGOBLIN_CLEAN_COST);
      next.flagStore[FLAG_ID.上门清扫] = 1;
      const clockEvents = advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() }));
      return {
        state: next,
        events: [narration("委托了上门清扫服务。", ctx), ...clockEvents],
        outcome: "ok",
      };
    }

    if (picked === "water") {
      if (itemCount(next, HOBGOBLIN_WATER_ITEM) <= 0 || !canAfford(next, HOBGOBLIN_WATER_COST)) {
        return {
          state: next,
          events: [narration("条件不足，无法委托浇水。", ctx)],
          outcome: "blocked",
          failReason: { kind: "precondition", message: "hobgoblin watering unavailable" },
        };
      }
      pay(next, HOBGOBLIN_WATER_COST);
      next.flagStore[FLAG_ID.澆水代行] = 1;
      const clockEvents = advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() }));
      return {
        state: next,
        events: [narration("委托了浇水。", ctx), ...clockEvents],
        outcome: "ok",
      };
    }

    return {
      state: next,
      events: [narration("没有委托。", ctx)],
      outcome: "noop",
    };
  },
};
