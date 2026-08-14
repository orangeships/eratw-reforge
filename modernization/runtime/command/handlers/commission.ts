/**
 * Character commissions:
 *
 * - COMF366 依頼を聞く / 听取委托
 * - COMF367 依頼実行 / 执行委托
 * - COMF630 ホフゴブリンに依頼 / 霍布哥布林代办服务
 *
 * V1 ports the real request state machine and a conservative source-read
 * catalog. Personal commission kojo is routed through `resolveIraiKojo`; when
 * no source body exists, it stays silent (no generated fallback prose).
 */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  COMMISSION_PROGRESS,
  acceptCommission,
  canAcceptCommission,
  clearCommissionSlot,
  commissionActName,
  commissionContent,
  commissionStatus,
  commissionTitleForTarget,
  describeCommission,
  executeCommissionCore,
  findCommissionDef,
  findSlotByClient,
  reportCommission,
  searchActiveCommissionSlot,
  setCommissionExecutionResult,
  iraiIdToClient,
  type CommissionScene,
} from "../../state/commission.js";
import { itemCount } from "../../state/items.js";
import { canAfford, formatMoney, pay } from "../../state/money.js";
import { CFLAG_ID, FLAG_ID, advanceTimeTicks } from "../../state/settlement.js";
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
): ObservationEvent[] {
  const role =
    scene === "依頼報告不要"
      ? "NO_REPORT"
      : charaNum === iraiIdToClient(iraiId)
        ? "CLIENT"
        : "TARGET";
  const lines = ctx.dialogueRouter?.resolveIraiKojo?.(
    charaNum,
    role,
    scene,
    iraiId,
    state,
    ctx.rng,
  ) ?? [];
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

function narration(text: string, ctx: CommandContext): ObservationEvent {
  return { kind: "NARRATION", timestamp: ctx.now(), text };
}

function commission366Prompt(ctx: CommandContext): PromptSpec | null {
  const status = commissionStatus(ctx.state, ctx.target);
  if (status === COMMISSION_PROGRESS.Offered) {
    return pickOne("依頼を受ける？", [
      { id: "accept", label: "依頼を受ける" },
      { id: "decline", label: "断る" },
    ]);
  }
  if (status === COMMISSION_PROGRESS.Active) {
    return pickOne("依頼を確認する？", [
      { id: "confirm", label: "確認" },
      { id: "abandon", label: "破棄" },
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

      events.push(narration("どうやら%CALLNAME:TARGET%は%CALLNAME:MASTER%に頼み事があるようだ", ctx));
      events.push(...kojoEvents(ctx, target, "依頼提示時", iraiId, next));
      events.push(...describeCommission(next, target).map((line) => narration(line, ctx)));

      if (picked === "decline") {
        events.push(narration("%CALLNAME:MASTER%は丁重にお断りした", ctx));
        events.push(...kojoEvents(ctx, target, "依頼非受託時", iraiId, next));
        events.push(narration("%CALLNAME:TARGET%は残念そうな顔をしている", ctx));
        return { state: next, events, outcome: "noop" };
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
      events.push(narration("%CALLNAME:MASTER%は%CALLNAME:TARGET%の依頼を受けた", ctx));
      events.push(...kojoEvents(ctx, target, "依頼受託時", slot.iraiId, next));
      return { state: next, events, outcome: "ok" };
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

      events.push(...kojoEvents(ctx, target, "依頼確認時", slot.iraiId, next));
      events.push(...describeCommission(next, target).map((line) => narration(line, ctx)));
      if (picked === "abandon") {
        events.push(...kojoEvents(ctx, target, "依頼破棄時", slot.iraiId, next));
        events.push(narration("依頼を破棄しました。", ctx));
        clearCommissionSlot(next, slot, COMMISSION_PROGRESS.EndedFailed);
        return { state: next, events, outcome: "ok" };
      }
      return { state: next, events, outcome: "noop" };
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
      events.push(...kojoEvents(ctx, target, success ? "成功報告時" : "失敗報告時", slot.iraiId, next));
      reportCommission(next, slot, ctx.rng);
      events.push(narration(success ? "依頼を報告しました。" : "依頼の失敗を報告しました。", ctx));
      return { state: next, events, outcome: "ok" };
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

function executionSummary(slotLocalId: number, slotKind: "common" | "unique", clientId?: number): string {
  const def = findCommissionDef(slotKind, slotLocalId, clientId);
  return def
    ? `%CALLNAME:MASTER%执行了「${def.name}」。`
    : "%CALLNAME:MASTER%执行了委托。";
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
    events.push(...kojoEvents(ctx, ctx.target, "依頼実行直前", slot.iraiId, next));
    events.push(narration(executionSummary(slot.localId, slot.kind, slot.clientId), ctx));

    const executed = executeCommissionCore(next, slot, ctx.rng);
    events.push(...executed.events.map((event) => ({ ...event, timestamp: ctx.now() })));
    if ((next.flagStore[FLAG_ID.時間停止] ?? 0) === 0) {
      events.push(...advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() })));
    }

    if (executed.result === "cancel") {
      return { state: next, events, outcome: "noop" };
    }

    setCommissionExecutionResult(next, slot, executed.result);
    events.push(...kojoEvents(ctx, ctx.target, "依頼実行直後", slot.iraiId, next));

    if (executed.result === "unresolved") {
      return { state: next, events, outcome: "ok" };
    }

    if (ctx.target === slot.clientId) {
      const success = executed.result === "success";
      events.push(...kojoEvents(ctx, slot.clientId, success ? "成功報告時" : "失敗報告時", slot.iraiId, next));
      reportCommission(next, slot, ctx.rng);
      events.push(narration(success ? "依頼を報告しました。" : "依頼の失敗を報告しました。", ctx));
    } else {
      events.push(narration(`忘れずに%CALLNAME:${slot.clientId}%に報告しよう`, ctx));
    }

    return { state: next, events, outcome: "ok" };
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
