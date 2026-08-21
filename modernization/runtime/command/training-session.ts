import type {
  GameState,
  TrainingMode,
  TrainingSession,
  TrainingSummary,
} from "../state/game-state.js";
import type { CommandContext, CommandResult } from "./types.js";
import { isHMode, requiresHMode } from "./h-mode.js";

const H_MODE_CFLAG_ID = 317;
const TIME_STOP_FLAG_ID = 70;
const RECENT_LIMIT = 16;
const V_POSITION_COMMANDS = new Set([60, 61, 65, 67, 68]);
const A_POSITION_COMMANDS = new Set([62, 63, 66, 69, 70]);

const TRAINING_ENTRY_COMMANDS = new Set<number>([350, 356]);
const TRAINING_SESSION_COMMANDS = new Set<number>([360, 361, 850]);
const TRAINING_EXIT_COMMANDS = new Set<number>([850, 999]);

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

function finishExistingForTargetChange(state: GameState): void {
  if (!state.training) return;
  const previous = state.charas[state.training.target];
  if (previous) previous.state.CFLAG[H_MODE_CFLAG_ID] = 0;
  finishTrainingSession(state, "target-changed");
}

function ensureTrainingSession(
  state: GameState,
  ctx: CommandContext,
): TrainingSession {
  if (state.training && state.training.target !== ctx.target) {
    finishExistingForTargetChange(state);
  }

  if (state.training) return state.training;

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
  return session;
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
): void {
  const session = state.training;
  if (!session) {
    state.training = null;
    return;
  }

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

  const session = ensureTrainingSession(state, ctx);
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
    session.vInserted = true;
    session.aInserted = false;
    session.currentPositionCommandNo = ctx.commandNo;
  } else if (A_POSITION_COMMANDS.has(ctx.commandNo)) {
    session.vInserted = false;
    session.aInserted = true;
    session.currentPositionCommandNo = ctx.commandNo;
  }

  if (TRAINING_EXIT_COMMANDS.has(ctx.commandNo)) {
    clearTrainingMode(state, ctx.target);
    finishTrainingSession(state, "exit-command");
  }

  return result;
}
