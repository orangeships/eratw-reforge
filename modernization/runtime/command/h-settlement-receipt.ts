/**
 * H-family settlement receipt — snapshot the per-turn SOURCE/NOWEX data while
 * `state.turnContext.frame` is still alive.
 *
 * Why this exists: `KojoExecutionFrame.nowExByChara` is the only structured
 * record of "this turn's orgasm / ejaculation / edging", and it is destroyed
 * on the way out of the resolver — `apply-intent.ts` calls `clearTurnContext`
 * on every successful non-pending command, and `game-state-migration.ts`
 * drops `turnContext` on load. The L1 request is prepared from the already
 * committed post-state, so it would otherwise have no evidence at all.
 *
 * Attached at the single exit of `resolveCommand` (`resolver.ts`), which is
 * the last point where all of these hold at once:
 *   - the frame still exists,
 *   - `training` / `lastTrainingSummary` are final (including the
 *     `mobInterruptsHMode` path that lives outside the onion), and
 *   - the caller's pre-command `state` is still available for diffs.
 *
 * Only H-family commands write a receipt; every other command pays one pure
 * predicate call and writes nothing, so ordinary play never grows this field.
 */

import type {
  CharaSlot,
  GameState,
  HSettlementEvent,
  HSettlementReceipt,
  KojoExecutionFrame,
  TrainingSession,
} from "../state/game-state.js";
import { BASE_ID, EX_ID, MARK_ID, TCVAR_ID } from "../state/settlement.js";
import { ejaculationSiteInfo, hEjaculationMarkerLabels } from "./h-ejaculation-semantics.js";
import { isHMode } from "./h-mode.js";
import { activeHInsertionSites, isTrainingCommand } from "./training-session.js";
import type { CommandContext, CommandResult } from "./types.js";

/** 127 (`Ａパールを入れられる`) ends the session via `afterSettlement` but is
 *  not in any of the shared command sets, so it needs an explicit mention. */
const EXTRA_H_COMMANDS: ReadonlySet<number> = new Set([127]);

const ORGASM_CHANNELS = [
  { channel: "Ｃ", orgasm: EX_ID.Ｃ絶頂, unaware: EX_ID.無自覚Ｃ絶頂 },
  { channel: "Ｖ", orgasm: EX_ID.Ｖ絶頂, unaware: EX_ID.無自覚Ｖ絶頂 },
  { channel: "Ａ", orgasm: EX_ID.Ａ絶頂, unaware: EX_ID.無自覚Ａ絶頂 },
  { channel: "Ｂ", orgasm: EX_ID.Ｂ絶頂, unaware: EX_ID.無自覚Ｂ絶頂 },
  { channel: "Ｍ", orgasm: EX_ID.Ｍ絶頂, unaware: EX_ID.無自覚Ｍ絶頂 },
] as const;

/** 寸止め is staged outside NOWEX (the edging branch returns before the
 *  orgasm bookkeeping), so the only honest source is an EX diff. */
const EDGING_CHANNELS = [
  EX_ID.Ｃ寸止め,
  EX_ID.Ｖ寸止め,
  EX_ID.Ａ寸止め,
  EX_ID.Ｂ寸止め,
  EX_ID.Ｍ寸止め,
] as const;

const MARK_LABELS = [
  { id: MARK_ID.苦痛刻印, name: "苦痛刻印" },
  { id: MARK_ID.快楽刻印, name: "快楽刻印" },
  { id: MARK_ID.不埒刻印, name: "不埒刻印" },
  { id: MARK_ID.時姦刻印, name: "時姦刻印" },
] as const;

/**
 * Whether this command should produce a receipt. Deliberately built out of
 * existing predicates rather than a new command list, so it cannot drift from
 * the training lifecycle.
 */
export function isHSettlementCommand(
  state: Readonly<GameState>,
  target: number,
  commandNo: number,
): boolean {
  if (EXTRA_H_COMMANDS.has(commandNo)) return true;
  if (isTrainingCommand(commandNo)) return true;
  if (target <= 0) return false;
  if (isHMode(state, target)) return true;
  return state.training?.target === target;
}

function exValue(slot: CharaSlot | undefined, id: number): number {
  return slot?.state.EX[id] ?? 0;
}

function markValue(slot: CharaSlot | undefined, id: number): number {
  return slot?.state.MARK[id] ?? 0;
}

/** Prefer the session this command actually acted in; fall back to whichever
 *  session exists so an exit command still reports who it was with. */
function pickSession(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
  target: number,
): TrainingSession | null {
  const sessions = [after.training, before.training].filter(
    (session): session is TrainingSession => Boolean(session),
  );
  return sessions.find((session) => session.target === target) ?? sessions[0] ?? null;
}

/**
 * Build the receipt, or `undefined` when there is nothing trustworthy to say.
 * A missing frame yields no receipt rather than an empty `events` array —
 * "unknown" and "none" must stay distinguishable downstream.
 */
export function buildHSettlementReceipt(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
  input: { actor: number; target: number; commandNo: number; frame?: KojoExecutionFrame },
): HSettlementReceipt | undefined {
  const frame = input.frame;
  if (!frame) return undefined;

  // Sort subjects: JS integer-like keys already iterate ascending, but the
  // order must not depend on how a producer happened to populate the map —
  // this feeds a prompt, so it has to be reproducible.
  const subjects = Object.keys(frame.nowExByChara)
    .map(Number)
    .filter((subject) => Number.isFinite(subject))
    .sort((a, b) => a - b);

  const events: HSettlementEvent[] = [];
  const deposits: NonNullable<HSettlementReceipt["deposits"]> = [];
  // These EX slots accumulate accepted deposits; residual slots can already
  // have leaked during the command clock and cannot measure this turn's dose.
  const depositSubjects = [...new Set([0, input.target, input.actor, ...frame.participants])].sort((a, b) => a - b);
  for (const subject of depositSubjects) {
    const previous = subject === 0 ? before.master : before.charas[subject];
    const current = subject === 0 ? after.master : after.charas[subject];
    if (!previous || !current) continue;
    for (const [site, id] of [["v", EX_ID.膣内精液], ["a", EX_ID.肛門内精液]] as const) {
      const amount = (current.state.EX[id] ?? 0) - (previous.state.EX[id] ?? 0);
      if (amount > 0) deposits.push({ subject, site, amount });
    }
  }
  for (const subject of subjects) {
    const nowEx = frame.nowExByChara[subject] ?? {};
    for (const spec of ORGASM_CHANNELS) {
      const amount = nowEx[spec.orgasm] ?? 0;
      if (amount > 0) {
        events.push({ subject, kind: "orgasm", channel: spec.channel, amount });
      }
      const unaware = nowEx[spec.unaware] ?? 0;
      if (unaware > 0) {
        events.push({ subject, kind: "unaware-orgasm", channel: spec.channel, amount: unaware });
      }
    }
  }

  const shoot = frame.nowExByChara[0]?.[EX_ID.射精] ?? 0;
  if (shoot > 0) {
    const site = ejaculationSiteInfo(after.master.state.TCVAR[TCVAR_ID.射精箇所] ?? 0);
    const markerMask = after.charas[input.target]?.state.TCVAR[TCVAR_ID.口上出力用射精部位] ?? 0;
    events.push({
      subject: 0,
      kind: "ejaculation",
      amount: shoot,
      ...(site ? { site } : {}),
      ...(markerMask ? { markerLabels: hEjaculationMarkerLabels(markerMask) } : {}),
    });
  }

  const beforeTarget = before.charas[input.target];
  const afterTarget = after.charas[input.target];

  let edgingGained = 0;
  let edgingCleared = 0;
  const marks: string[] = [];
  for (const id of EDGING_CHANNELS) {
    const was = exValue(beforeTarget, id);
    const now = exValue(afterTarget, id);
    if (now > was) edgingGained += now - was;
    else if (now < was) edgingCleared += was - now;
  }
  for (const mark of MARK_LABELS) {
    const was = markValue(beforeTarget, mark.id);
    const now = markValue(afterTarget, mark.id);
    if (now > was) marks.push(`${mark.name}Lv${now}`);
  }

  const sites = activeHInsertionSites(after, input.target);
  const sitesBefore = activeHInsertionSites(before, input.target);

  const vitality: HSettlementReceipt["vitality"] = [];
  for (const subject of [0, input.target]) {
    const baseline = frame.baseBeforeByChara?.[subject];
    if (!baseline) continue;
    const slot = subject === 0 ? after.master : after.charas[subject];
    if (!slot) continue;
    vitality.push({
      subject,
      stamina: (slot.state.BASE[BASE_ID.体力] ?? 0) - baseline.stamina,
      will: (slot.state.BASE[BASE_ID.気力] ?? 0) - baseline.will,
    });
  }

  const session = pickSession(before, after, input.target);
  const exited = Boolean(before.training) && !after.training;
  // `lastTrainingSummary` is long-lived, so it must be matched against the
  // session that just ended rather than assumed fresh. A reference check would
  // be wrong here: the resolver clones state on several paths, so an *unchanged*
  // summary arrives as a different object.
  const summary = after.lastTrainingSummary;
  const reason =
    exited && before.training && summary &&
    summary.target === before.training.target &&
    summary.startedAtTick === before.training.startedAtTick
      ? summary.reason
      : null;

  return {
    version: 1,
    tick: after.time.tickValue,
    day: after.time.dayIndex,
    commandNo: input.commandNo,
    actor: input.actor,
    session: session
      ? {
          target: session.target,
          mode: session.mode,
          participants: [...session.participants],
          exited,
          exitReason: reason,
          started: !before.training && Boolean(after.training),
        }
      : null,
    events,
    deposits,
    edging: { gained: edgingGained, cleared: edgingCleared },
    marks,
    insertion: { v: sites.includes("v"), a: sites.includes("a") },
    insertionBefore: { v: sitesBefore.includes("v"), a: sitesBefore.includes("a") },
    vitality,
  };
}

/**
 * Attach the receipt to a settled command. Runs at the resolver's single exit
 * point; returns `result` untouched for non-ok outcomes and non-H commands.
 */
export function attachHSettlementReceipt(
  result: CommandResult,
  input: { before: Readonly<GameState>; ctx: CommandContext },
): CommandResult {
  if (result.outcome !== "ok") return result;
  const { actor, target, commandNo } = input.ctx;
  if (!isHSettlementCommand(input.before, target, commandNo)) return result;

  const receipt = buildHSettlementReceipt(input.before, result.state, {
    actor,
    target,
    commandNo,
    frame: result.state.turnContext?.frame,
  });
  if (!receipt) return result;

  return { ...result, state: { ...result.state, lastHSettlement: receipt } };
}
