import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { AiSettings } from "./types.js";

export interface NarrativeDirectorAuthorizationInput {
  settings: AiSettings;
  state: GameState | null;
  /** Game day the request was compiled for. */
  requestDayIndex: number;
  /** Clock and place captured when the request was compiled. Only consulted for
   * an unpinned pass. */
  snapshotTick: number;
  snapshotLocation: string;
  /**
   * True when the pass was compiled with `pinArcId` — it is serving a window a
   * background pass already promised, not inventing a premise.
   *
   * This must be an explicit flag, never inferred from "the window happened to
   * have locations": a pinned pass whose `nextChance` was cleared falls back to
   * `nextOpportunities`, which carries no locations, and inferring would
   * silently restore the strict contract and reproduce the abort.
   */
  pinned: boolean;
  participantIds?: readonly number[];
  requireActiveRoster?: boolean;
}

export function narrativeParticipantsAuthorized(settings: AiSettings, state: GameState | null,
  participants: readonly number[] = [], requireActiveRoster = false): boolean {
  return settings.enabled && settings.narrativeEnabled && !!settings.apiKey.trim()
    && state?.agentRuntime?.settings.masterEnabled === true
    && participants.every(id => id === 0 || (state.charas[id] !== undefined
      && settings.characterProfiles[id]?.enabled !== false
      && (!requireActiveRoster || state.agentRuntime!.activeRoster.includes(id))));
}

/**
 * Whether an in-flight narrative director request may still be used.
 *
 * Two different contracts share this check, and conflating them deadlocked the
 * interaction-window handoff: the player walking into the promised window is
 * what triggers the pass, and every step advances the clock, so a strict
 * "nothing may have moved" guard aborted the request with the very movement
 * that asked for it.
 *
 *  - Inventing a premise (`pinned: false`) needs an unmoved world: the
 *    situation menu is authored against an exact tick and place.
 *  - Serving a promise (`pinned: true`) is authorized by the promise itself.
 *    The pass is authored while the player is anywhere — including mid-walk —
 *    and delivery is decided later by the event's own window plus the
 *    presence check in `refreshNarrativeEvents`. Only the game day must hold.
 */
export function narrativeDirectorStillAuthorized(
  input: NarrativeDirectorAuthorizationInput,
): boolean {
  const { settings, state } = input;
  if (!narrativeParticipantsAuthorized(settings, state, input.participantIds, input.requireActiveRoster) || state === null) return false;
  if (state.time.dayIndex !== input.requestDayIndex) return false;
  if (input.pinned) return true;
  return state.time.tickValue === input.snapshotTick
    && state.master.location === input.snapshotLocation;
}
