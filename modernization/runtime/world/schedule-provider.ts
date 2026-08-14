/**
 * Schedule provider seam — the runtime hook a future agent runtime plugs into
 * to override NPC *movement decisions* WITHOUT rewriting the deterministic
 * work/roam/home model.
 *
 * This is the seam `4c74db1` deleted (for fidelity — the fabricated 24h
 * tables had to go) re-introduced ON TOP of the real 仕事/configured-schedule
 * model: the deterministic decision stays the default/fallback; a provider may
 * override a chara's location per-tick. No LLM, no RNG, no invented game
 * logic — a provider only forwards a stated location (see `agentOverrideProvider`).
 *
 * Relationship to `schemas/types.ts`:
 *   - The schema's `CharacterSchedule` / `CharacterScheduleProvider` are the
 *     *agent-side* contract (whole-day slot tables with `source` tags).
 *   - THIS file is the *runtime-side* adapter: the runtime decides per-tick
 *     *location*, so the seam is `decideLocation(state, charaNum, tick)`.
 *   - A future agent runtime owns the translation: it turns its
 *     `CharacterSchedule` into per-tick `decideLocation` calls (and the
 *     `OVERRIDE_SCHEDULE` intent registers one here, see `agentOverrideProvider`).
 *
 * Hard rule (AGENTs.md): agent output is an *intent*; the intent passes a
 * deterministic validator before the rule system settles. For schedule-driven
 * moves that validator is `canEnterRoom` (@MAP_CAN_MOVE_0): an override whose
 * location is barred to the chara is dropped → the deterministic model runs.
 * So an agent can never route a non-小人 into 虫籠, etc.
 */

import type { GameState } from "../state/index.js";
import type { CharacterSchedule, DialogueCandidate } from "../../schemas/types.js";
import { canEnterRoom } from "./map-can-move.js";
import { activePlanSelection } from "../agent/plan-executor.js";

// =====================================================================
// Provider contract
// =====================================================================

/**
 * Per-tick movement-decision provider. Returns the location `charaNum` should
 * be at `tick`, or `null` to defer to the deterministic work/roam/home model.
 * Pure + deterministic — no LLM, no side effects, no RNG.
 */
export interface ScheduleProvider {
  decideLocation(state: Readonly<GameState>, charaNum: number, tick: number): string | null;
}

// =====================================================================
// OVERRIDE_SCHEDULE registry + the default (agent-override-aware) provider
// =====================================================================

/** Registered agent schedule overrides, keyed by charaNum. */
const scheduleOverrides = new Map<number, CharacterSchedule>();

/** Register a chara's agent schedule override (from an OVERRIDE_SCHEDULE intent). */
export function registerScheduleOverride(charaNum: number, schedule: CharacterSchedule): void {
  scheduleOverrides.set(charaNum, schedule);
}

/** Clear one chara's override, or all (no arg). Test/diagnostic helper. */
export function clearScheduleOverrides(charaNum?: number): void {
  if (charaNum === undefined) scheduleOverrides.clear();
  else scheduleOverrides.delete(charaNum);
}

/** minute-of-day [0,1440) of an absolute tickValue. */
function minuteOfDay(tick: number): number {
  return ((tick % 1440) + 1440) % 1440;
}

/** Whether minute `m` falls in `[start, end)` (wrapping midnight if end<start). */
function inWindow(m: number, start: number, end: number): boolean {
  return start <= end ? m >= start && m < end : m >= start || m < end;
}

/**
 * Find the active `source:"agent"` slot for `charaNum` at `tick`, or null.
 * Only agent-source slots override the deterministic model; deterministic
 * slots are the model's own territory.
 */
function activeAgentSlot(
  schedule: CharacterSchedule,
  tick: number,
): { activity: string } | null {
  const m = minuteOfDay(tick);
  for (const slot of schedule.slots) {
    if (slot.source !== "agent") continue;
    if (inWindow(m, slot.startTime, slot.endTime)) return { activity: slot.activity };
  }
  return null;
}

/**
 * The default provider. Honors a registered `OVERRIDE_SCHEDULE`: if `charaNum`
 * has an active agent slot at `tick`, returns that slot's `activity` as the
 * target location — BUT only if `canEnterRoom` (@MAP_CAN_MOVE_0) permits the
 * chara there; a barred override is dropped (returns null → deterministic
 * fallback). This is the deterministic validator applied to schedule moves.
 *
 * The `activity` field carrying a location string is by agent-runtime
 * convention: the agent runtime is responsible for putting a valid location
 * there. The rule system cannot validate arbitrary strings beyond the room
 * gate, same as it trusts the deterministic `homeLocation`.
 */
export const agentOverrideProvider: ScheduleProvider = {
  decideLocation(state, charaNum, tick) {
    const slot = state.charas[charaNum];
    if (!slot) return null;

    // A3 — check state-backed agent plan first.
    const minOfDay = minuteOfDay(tick);
    const planSel = activePlanSelection(state, charaNum, minOfDay);
    if (planSel) {
      const loc = planSel.location;
      if (loc && canEnterRoom(state, loc, slot)) return loc;
    }

    // Fall back to Map-based overrides (existing behavior).
    const schedule = scheduleOverrides.get(charaNum);
    if (!schedule) return null;
    const active = activeAgentSlot(schedule, tick);
    if (!active) return null;
    if (!canEnterRoom(state, active.activity, slot)) return null;
    return active.activity;
  },
};

// =====================================================================
// Live provider holder (default = agentOverrideProvider, installed below)
// =====================================================================

/**
 * The live provider. Defaults to `agentOverrideProvider` (honors registered
 * `OVERRIDE_SCHEDULE` overrides; returns null otherwise → deterministic). An
 * app/test may swap it via `setScheduleProvider` (e.g. a future agent runtime
 * installs its own). `null` here restores the default override-aware provider.
 */
let liveScheduleProvider: ScheduleProvider | null = agentOverrideProvider;

/** Install/replace the live schedule provider. `null` ⇒ restore the default. */
export function setScheduleProvider(p: ScheduleProvider | null): void {
  liveScheduleProvider = p ?? agentOverrideProvider;
}

/** Read-only access for the scheduler / tests. */
export function getScheduleProvider(): ScheduleProvider {
  return liveScheduleProvider ?? agentOverrideProvider;
}

// =====================================================================
// PROPOSE_DIALOGUE registry (agent dialogue candidates, sideband only)
// =====================================================================

/**
 * Proposed dialogue alternatives, keyed by charaNum. NEVER auto-applied
 * (schemas/types.ts `DialogueCandidate` contract) — a future side UI or the
 * DialogueRouter may surface/use them as a hint. Stored here so the runtime
 * has a place to keep agent proposals until that surface exists.
 */
const dialogueCandidates = new Map<number, DialogueCandidate>();

/** Register an agent-proposed dialogue candidate (from a PROPOSE_DIALOGUE intent). */
export function registerDialogueCandidate(charaNum: number, candidate: DialogueCandidate): void {
  dialogueCandidates.set(charaNum, candidate);
}

/** Read a chara's pending proposed candidate (side UI / router hint), or null. */
export function getProposedDialogue(charaNum: number): DialogueCandidate | null {
  return dialogueCandidates.get(charaNum) ?? null;
}

/** Clear one chara's candidate, or all. Test/diagnostic helper. */
export function clearDialogueCandidates(charaNum?: number): void {
  if (charaNum === undefined) dialogueCandidates.clear();
  else dialogueCandidates.delete(charaNum);
}
