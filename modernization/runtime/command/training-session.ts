import type {
  GameState,
  TrainingMode,
  TrainingSession,
  TrainingSummary,
} from "../state/game-state.js";
import type { CommandContext, CommandResult } from "./types.js";
import { initializeHEjaculationGauge, isHMode, requiresHMode } from "./h-mode.js";
import {
  CFLAG_ID,
  EX_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "../state/settlement.js";
import { writeTequip } from "../state/tequip.js";
import { H_INSERTION_FIELDS, isPlayerHInsertionActive, readHInsertionRelation, refreshHInsertionSession, type HInsertionSite } from "../state/h-interaction-state.js";
export type { HInsertionSite } from "../state/h-interaction-state.js";
import { recomputeExposure } from "../state/clothing-write.js";
import {
  stainSwapInsertA,
  stainSwapInsertV,
  stainSwapReverseInsertA,
  stainSwapReverseInsertV,
} from "../state/stain.js";
import { clearCurrentTouchRing } from "../state/touch-state.js";
import { dateOf } from "../world/calendar.js";
import { A_POSITION_COMMANDS, V_POSITION_COMMANDS, hCommandReleasesInsertion } from "./h-interaction.js";

const H_MODE_CFLAG_ID = CFLAG_ID.诶嘿嘿;
const TIME_STOP_FLAG_ID = 70;
const RECENT_LIMIT = 16;

const TRAINING_ENTRY_COMMANDS = new Set<number>([350, 356]);
const TRAINING_SESSION_COMMANDS = new Set<number>([360, 361, 850]);
export const TRAINING_EXIT_COMMANDS = new Set<number>([850, 999]);
const EDGING_EX_IDS = [
  EX_ID.Ｃ寸止め,
  EX_ID.Ｖ寸止め,
  EX_ID.Ａ寸止め,
  EX_ID.Ｂ寸止め,
  EX_ID.Ｍ寸止め,
] as const;

const INSERTION_STATE = H_INSERTION_FIELDS;

function clearActiveLink(slot: { state: { TEQUIP: Record<number, number>; TCVAR: Record<number, number> } }, site: HInsertionSite): void {
  slot.state.TEQUIP ??= {};
  slot.state.TCVAR ??= {};
  delete slot.state.TEQUIP[INSERTION_STATE[site].tequip];
  slot.state.TCVAR[INSERTION_STATE[site].tcvar] = -1;
}

/** Whether the canonical target/master links say that PLAYER is inserted. */
export function isHInsertionActive(
  state: Readonly<GameState>,
  target: number,
  site: HInsertionSite,
): boolean {
  return isPlayerHInsertionActive(state, target, site);
}

/** Resolve the one active V/A insertion site, preferring V for malformed
 * legacy states that accidentally contain both links. */
export function activeHInsertionSite(
  state: Readonly<GameState>,
  target: number,
): HInsertionSite | null {
  if (isHInsertionActive(state, target, "v")) return "v";
  if (isHInsertionActive(state, target, "a")) return "a";
  return null;
}

/** Return every active V/A insertion link for one selected target. */
export function activeHInsertionSites(
  state: Readonly<GameState>,
  target: number,
): HInsertionSite[] {
  return (["v", "a"] as const).filter((site) => isHInsertionActive(state, target, site));
}

function writeHInsertionChannel(
  state: GameState,
  target: number,
  site: HInsertionSite,
  actor: number,
  transferStain = true,
): void {
  const t = state.charas[target];
  if (!t) return;
  const m = state.master;
  const ids = INSERTION_STATE[site];
  if (actor !== 0 && actor !== target) return;
  const previous = readHInsertionRelation(state, target, site);
  const wasActive = previous.status === "active" && previous.actor_id === actor;

  // Preserve the existing ERA-facing target actor marker. Positive target
  // markers must not satisfy authored `TEQUIP == PLAYER` predicates.
  writeTequip(t, ids.tequip, actor);
  writeTequip(m, ids.tequip, target);
  t.state.TCVAR[ids.tcvar] = actor;
  m.state.TCVAR[ids.tcvar] = actor === 0 ? -1 : target;
  refreshHInsertionSession(state);
  // A new insertion performs the same STAIN transfer as the upstream
  // TOUCH_SET/MASTER_POSE path. Repeating a thrust does not duplicate it.
  if (!wasActive && transferStain) {
    if (actor === 0) {
      if (site === "v") stainSwapInsertV(t, m);
      else stainSwapInsertA(t, m);
    } else if (site === "v") {
      stainSwapReverseInsertV(t, m);
    } else {
      stainSwapReverseInsertA(t, m);
    }
  }
}

/**
 * Write one authoritative insertion link. The ERA value `PLAYER` is 0, so
 * the active link is an explicit TEQUIP/TCVAR zero; cleanup deletes TEQUIP
 * links and writes the existing morning sentinel -1 to TCVAR. This distinction
 * prevents an absent sparse field from being mistaken for active sex.
 */
export function syncHInsertionState(
  state: GameState,
  target: number,
  site: HInsertionSite,
  actor = 0,
  options: { transferStain?: boolean } = {},
): void {
  const t = state.charas[target];
  if (!t || actor !== 0 && actor !== target) return;
  const m = state.master;
  const other: HInsertionSite = site === "v" ? "a" : "v";
  clearActiveLink(t, other);
  clearActiveLink(m, other);
  writeHInsertionChannel(state, target, site, actor, options.transferStain ?? true);
}

/** Add one insertion channel while preserving the other active channel. */
export function syncHInsertionChannel(
  state: GameState,
  target: number,
  site: HInsertionSite,
  actor = 0,
  options: { transferStain?: boolean } = {},
): void {
  writeHInsertionChannel(state, target, site, actor, options.transferStain ?? true);
}

/**
 * Prepare an accepted position command's insertion links before its handler
 * builds and settles SOURCE. The resolver calls this only after command gates
 * pass and on its private state clone. The post-handler lifecycle repeats the
 * write as an idempotent compatibility guard while recording command history.
 */
export function prepareHInsertionBeforeSettlement(
  state: GameState,
  target: number,
  actor: number,
  commandNo: number,
): boolean {
  if (target <= 0 || !state.charas[target]) return false;
  const session = state.training?.target === target ? state.training : undefined;
  if (!requiresHMode(commandNo) && !session) return false;

  let site: HInsertionSite | undefined;
  if (V_POSITION_COMMANDS.has(commandNo)) site = "v";
  else if (A_POSITION_COMMANDS.has(commandNo)) site = "a";
  if (!site) return false;

  syncHInsertionState(state, target, site, actor);
  if (session) {
    session.currentPositionCommandNo = commandNo;
  }
  return true;
}

/** Upstream service TOUCH hooks call insertion release before SOURCE_CHECK.
 * Clear the canonical links and session envelope together, retaining history. */
export function prepareHInsertionReleaseBeforeSettlement(
  state: GameState,
  target: number,
  commandNo: number,
): string[] {
  if (!hCommandReleasesInsertion(commandNo)) return [];
  const sites = activeHInsertionSites(state, target);
  const messages = sites.flatMap((site) => settleHInsertionHistory(state, target, site));
  // Old saves may carry only the session marker. Clear that marker too.
  if (sites.length > 0 || state.training?.target === target) clearHInsertionState(state, target);
  return messages;
}

/** Mark V/A history at the moment the active insertion is finally closed. */
export function settleHInsertionHistory(
  state: GameState,
  target: number,
  requestedSite?: HInsertionSite,
): string[] {
  const t = state.charas[target];
  if (!t) return [];
  const messages: string[] = [];
  const site = requestedSite ?? activeHInsertionSite(state, target);
  if (site === "v") {
    const virgin = t.state.TALENT[TALENT_ID.処女] ?? 0;
    t.state.TCVAR[TCVAR_ID.破瓜] = 1;
    if (virgin === -1) {
      t.state.TALENT[TALENT_ID.処女] = 0;
      messages.push("不知道什么时候已经失去了处女之身。");
    } else if (virgin === 1 || virgin === 2) {
      if ((t.state.CFLAG[CFLAG_ID.処女喪失記念日] ?? 0) === 0) {
        t.state.CFLAG[CFLAG_ID.処女喪失記念日] = dateOf(state.time);
      }
      t.state.TALENT[TALENT_ID.処女] = 0;
      messages.push("第一次插入终于夺走了处女之身。");
    }
    t.state.CFLAG[CFLAG_ID.処女喪失対象] = (t.state.CFLAG[CFLAG_ID.処女喪失対象] ?? 0) | 1;
    t.state.CFLAG[CFLAG_ID.処女喪失相手] = state.master.charaNum;
  } else if (site === "a" && (t.state.CFLAG[CFLAG_ID.尻穴処女喪失記念日] ?? 0) === 0) {
    t.state.CFLAG[CFLAG_ID.尻穴処女喪失記念日] = dateOf(state.time);
    t.state.TCVAR[TCVAR_ID.Ａ破瓜] = 1;
    t.state.CFLAG[CFLAG_ID.アナル処女喪失対象] = (t.state.CFLAG[CFLAG_ID.アナル処女喪失対象] ?? 0) | 1;
    t.state.CFLAG[CFLAG_ID.アナル処女喪失相手] = state.master.charaNum;
    messages.push("第一次肛门插入留下了记录。");
  } else if (site === "a") {
    t.state.TCVAR[TCVAR_ID.Ａ破瓜] = 1;
    t.state.CFLAG[CFLAG_ID.アナル処女喪失対象] = (t.state.CFLAG[CFLAG_ID.アナル処女喪失対象] ?? 0) | 1;
    t.state.CFLAG[CFLAG_ID.アナル処女喪失相手] = state.master.charaNum;
  }
  return messages;
}

/** Remove only the active V/A pose links; preserve transient H clothing state
 * until the caller decides whether the whole H interaction is ending. */
export function clearHInsertionState(state: GameState, target?: number): void {
  const slots = target === undefined
    ? [state.master, ...Object.values(state.charas)]
    : [state.master, state.charas[target]].filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  for (const slot of slots) {
    clearActiveLink(slot, "v");
    clearActiveLink(slot, "a");
  }
  clearCurrentTouchRing(state);
  refreshHInsertionSession(state);
  if (state.training && (target === undefined || state.training.target === target)) {
    delete state.training.currentPositionCommandNo;
  }
}

/** Remove transient H pose/equipment links while retaining ordinary toys,
 * condom inventory, clothing, and persistent sexual history. */
export function clearHInteractionState(state: GameState, target?: number): number {
  const slots = target === undefined
    ? [state.master, ...Object.values(state.charas)]
    : [state.master, state.charas[target]].filter((slot): slot is NonNullable<typeof slot> => Boolean(slot));
  let clearedEdging = 0;
  for (const slot of slots) {
    clearActiveLink(slot, "v");
    clearActiveLink(slot, "a");
    slot.state.TCVAR[TCVAR_ID.行為者] = -1;
    slot.state.TCVAR[TCVAR_ID.射精箇所] = 0;
    slot.state.TCVAR[TCVAR_ID.射精快感強度] = 0;
    slot.state.TCVAR[TCVAR_ID.破瓜] = 0;
    // H exits discard temporary half-undress state. Keep the committed full
    // strip marker because unique underwear lives in outfit fallback data.
    const committedFullTopStrip =
      slot.state.TEQUIP[TEQUIP_ID.上衣脱衣完毕] === 1 &&
      slot.state.TEQUIP[TEQUIP_ID.上半身裸露状態] !== 1;
    writeTequip(slot, TEQUIP_ID.上半身裸露状態, 0);
    if (!committedFullTopStrip) {
      writeTequip(slot, TEQUIP_ID.上衣脱衣完毕, 0);
    }
    recomputeExposure(slot);
    for (const id of EDGING_EX_IDS) {
      clearedEdging += slot.state.EX[id] ?? 0;
      slot.state.EX[id] = 0;
    }
    slot.state.TEQUIP[TEQUIP_ID.挑逗モード] = 0;
    slot.state.TCVAR[TCVAR_ID.挑逗回数] = 0;
  }
  clearCurrentTouchRing(state);
  refreshHInsertionSession(state);
  return clearedEdging;
}

export function isTrainingCommand(commandNo: number): boolean {
  return (
    TRAINING_ENTRY_COMMANDS.has(commandNo) ||
    TRAINING_SESSION_COMMANDS.has(commandNo) ||
    TRAINING_EXIT_COMMANDS.has(commandNo) ||
    requiresHMode(commandNo)
  );
}

export function isTrainingTarget(state: Readonly<GameState>, target: number): boolean {
  if (target <= 0) return false;
  if (state.training) return state.training.target === target;
  return isHMode(state, target);
}

function inferTrainingMode(
  state: Readonly<GameState>,
  target: number,
): TrainingMode {
  if ((state.flagStore[TIME_STOP_FLAG_ID] ?? 0) !== 0) return "time-stop";
  const slot = state.charas[target];
  if (
    (state.master.state.CFLAG[H_MODE_CFLAG_ID] ?? 0) === 2 ||
    (slot?.state.CFLAG[H_MODE_CFLAG_ID] ?? 0) === 2
  ) {
    return "partner-led";
  }
  return "h";
}

function finishExistingForTargetChange(state: GameState): number {
  if (!state.training) return 0;
  const previous = state.charas[state.training.target];
  if (previous) previous.state.CFLAG[H_MODE_CFLAG_ID] = 0;
  return finishTrainingSession(state, "target-changed");
}

function ensureTrainingSession(
  state: GameState,
  ctx: CommandContext,
): { session: TrainingSession; clearedEdging: number } {
  let clearedEdging = 0;
  if (state.training && state.training.target !== ctx.target) {
    clearedEdging = finishExistingForTargetChange(state);
  }

  if (state.training) return { session: state.training, clearedEdging };

  initializeHEjaculationGauge(state, ctx.target);

  const session: TrainingSession = {
    target: ctx.target,
    startedAtTick: ctx.state.time.tickValue,
    startedDay: ctx.state.time.dayIndex,
    lastTick: state.time.tickValue,
    lastCommandNo: ctx.commandNo,
    commandCount: 0,
    mode: inferTrainingMode(state, ctx.target),
    participants: [ctx.actor, ctx.target],
    recentCommands: [],
  };
  state.training = session;
  return { session, clearedEdging };
}

export function clearTrainingMode(state: GameState, target?: number): void {
  state.master.state.CFLAG[H_MODE_CFLAG_ID] = 0;
  if (target !== undefined) {
    const slot = state.charas[target];
    if (slot) slot.state.CFLAG[H_MODE_CFLAG_ID] = 0;
    return;
  }
  for (const slot of Object.values(state.charas)) {
    if ((slot.state.CFLAG[H_MODE_CFLAG_ID] ?? 0) !== 0) {
      slot.state.CFLAG[H_MODE_CFLAG_ID] = 0;
    }
  }
}

export function finishTrainingSession(
  state: GameState,
  reason: TrainingSummary["reason"] = "manual",
): number {
  const session = state.training;
  if (!session) {
    // Legacy saves can contain only CFLAG/TEQUIP/TCVAR H markers. A safe
    // finish must leave no active insertion link behind even without a
    // migrated TrainingSession envelope.
    for (const slot of Object.values(state.charas)) {
      for (const site of activeHInsertionSites(state, slot.charaNum)) {
        settleHInsertionHistory(state, slot.charaNum, site);
      }
    }
    const clearedEdging = clearHInteractionState(state);
    clearTrainingMode(state);
    state.training = null;
    return clearedEdging;
  }

  for (const site of activeHInsertionSites(state, session.target)) {
    settleHInsertionHistory(state, session.target, site);
  }
  const clearedEdging = clearHInteractionState(state, session.target);
  state.master.state.CFLAG[H_MODE_CFLAG_ID] = 0;
  const target = state.charas[session.target];
  if (target) target.state.CFLAG[H_MODE_CFLAG_ID] = 0;

  state.lastTrainingSummary = {
    target: session.target,
    startedAtTick: session.startedAtTick,
    endedAtTick: state.time.tickValue,
    startedDay: session.startedDay,
    endedDay: state.time.dayIndex,
    commandCount: session.commandCount,
    mode: session.mode,
    lastCommandNo: session.lastCommandNo,
    reason,
  };
  state.training = null;
  return clearedEdging;
}

export function withTrainingSessionLifecycle(
  result: CommandResult,
  ctx: CommandContext,
): CommandResult {
  if (result.outcome !== "ok") return result;
  if (ctx.target <= 0) return result;

  const state = result.state;
  const existingForTarget = state.training?.target === ctx.target;
  const hModeActive = isHMode(state, ctx.target);
  const startsTraining =
    TRAINING_ENTRY_COMMANDS.has(ctx.commandNo) ||
    (requiresHMode(ctx.commandNo) && hModeActive);
  const continuesTraining =
    existingForTarget ||
    (TRAINING_SESSION_COMMANDS.has(ctx.commandNo) && hModeActive);

  if (!startsTraining && !continuesTraining) return result;

  const { session, clearedEdging: clearedOnTargetChange } = ensureTrainingSession(state, ctx);
  session.lastTick = state.time.tickValue;
  session.lastCommandNo = ctx.commandNo;
  session.commandCount += 1;
  session.mode = inferTrainingMode(state, ctx.target);
  if (!session.participants.includes(ctx.actor)) session.participants.push(ctx.actor);
  if (!session.participants.includes(ctx.target)) session.participants.push(ctx.target);
  session.recentCommands = [
    ...session.recentCommands,
    {
      commandNo: ctx.commandNo,
      target: ctx.target,
      tick: state.time.tickValue,
      day: state.time.dayIndex,
      outcome: result.outcome,
    },
  ].slice(-RECENT_LIMIT);

  if (V_POSITION_COMMANDS.has(ctx.commandNo)) {
    syncHInsertionState(state, ctx.target, "v", ctx.actor);
    session.currentPositionCommandNo = ctx.commandNo;
  } else if (A_POSITION_COMMANDS.has(ctx.commandNo)) {
    syncHInsertionState(state, ctx.target, "a", ctx.actor);
    session.currentPositionCommandNo = ctx.commandNo;
  } else if (ctx.commandNo === 71) {
    // COM71 adds the second channel to the existing selected target.  The
    // handler owns the link write; the session envelope records both channels
    // so exit/target-change cleanup does not collapse it back to one site.
    session.currentPositionCommandNo = ctx.commandNo;
  }
  refreshHInsertionSession(state);

  const lifecycleMessages: string[] = [];
  if (clearedOnTargetChange > 0) {
    lifecycleMessages.push("切换训练对象，旧对象未吸收的寸止积累已清除。");
  }
  if (TRAINING_EXIT_COMMANDS.has(ctx.commandNo)) {
    clearTrainingMode(state, ctx.target);
    const clearedEdging = finishTrainingSession(state, "exit-command");
    if (clearedEdging > 0) {
      lifecycleMessages.push("退出训练，未吸收的寸止积累已清除。");
    }
  }

  return lifecycleMessages.length > 0
    ? {
        ...result,
        events: [
          ...result.events,
          ...lifecycleMessages.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
        ],
      }
    : result;
}
