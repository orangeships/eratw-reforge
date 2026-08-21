import { useEffect, useRef } from "react";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { checkHehai } from "../../../modernization/runtime/world/detection.js";
import { relationOf } from "../../../modernization/runtime/world/relation.js";
import {
  selectAmbientInitiativeOpportunity,
  type AmbientInitiativeTrigger,
} from "../../../modernization/runtime/world/ambient-initiative.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { useGameStateStore } from "../state/game-state-store.js";
import {
  cancelSceneAmbientRequest,
  generateSceneAmbient,
  prepareSceneAmbientRequest,
  recordSceneAmbientHistory,
  resetSceneAmbientRuntime,
} from "./ambient-runtime.js";
import { useSceneAmbientStore } from "./ambient-store.js";
import { currentAiCharacterProfile, currentAiSettings, useAiStore } from "./store.js";
import type { SceneAmbientEntry } from "./types.js";
import { ambientEligibleCandidates } from "./ambient-eligibility.js";

export interface UseSceneAmbientInput {
  state: Readonly<GameState>;
  router: DialogueRouter;
  formalInteractionActive: boolean;
  exclusiveSurfaceActive: boolean;
  /** Keep the latest scene entry available beside a designated formal
   *  surface such as the COM496 radio window. This does not permit a new
   *  ambient request while the formal surface is active. */
  preserveEntryWhileFormal?: boolean;
}

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sceneAmbientAttemptSeed(
  sceneEpoch: number,
  gameTick: number,
  trigger: AmbientInitiativeTrigger,
  attemptSerial: number,
): number {
  return stableSeed([sceneEpoch, gameTick, trigger, attemptSerial].join("|"));
}

/**
 * Prompt preparation resolves authored voice samples synchronously. Defer it
 * past the next paint so closing an InteractionBox is visible before that
 * CPU-bound work begins. The small grace period also prevents an ambient
 * entry from appearing on the same click that dismissed the previous box.
 */
export const AMBIENT_POST_PAINT_DELAY_MS = 120;

function scheduleAfterPaint(callback: () => void): () => void {
  let cancelled = false;
  let frameId: number | null = null;
  let timerId: number | null = null;

  const run = (): void => {
    if (cancelled) return;
    timerId = null;
    callback();
  };

  if (typeof window === "undefined") {
    callback();
  } else if (typeof window.requestAnimationFrame === "function") {
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      if (!cancelled) timerId = window.setTimeout(run, AMBIENT_POST_PAINT_DELAY_MS);
    });
  } else {
    timerId = window.setTimeout(run, AMBIENT_POST_PAINT_DELAY_MS);
  }

  return () => {
    cancelled = true;
    if (frameId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(frameId);
    }
    if (timerId !== null && typeof window !== "undefined") {
      window.clearTimeout(timerId);
    }
  };
}

function presentNpcIds(state: Readonly<GameState>): number[] {
  return Object.values(state.charas)
    .filter((slot) => slot.charaNum > 0 && slot.location === state.master.location)
    .map((slot) => slot.charaNum)
    .sort((left, right) => left - right);
}

function eligibleCandidates(state: Readonly<GameState>) {
  return ambientEligibleCandidates(state, (participantId) => currentAiCharacterProfile(participantId).enabled);
}

function publicFacts(events: readonly ObservationEvent[]): string[] {
  return events.slice(-12).flatMap((event) => {
    if (event.kind === "NARRATION" && event.presentation === "ambient") return [event.text];
    return [];
  }).slice(-4);
}

function requestStillCurrent(
  requestId: string,
  sceneEpoch: number,
  location: string,
  participantIds: readonly number[],
  blocked: boolean,
): GameState | null {
  if (blocked) return null;
  const session = useSceneAmbientStore.getState().session;
  const state = useGameStateStore.getState().state;
  if (
    !session ||
    session.requestId !== requestId ||
    session.sceneEpoch !== sceneEpoch ||
    session.location !== location ||
    !state ||
    state.master.location !== location
  ) return null;
  const eligible = new Set(eligibleCandidates(state).map((candidate) => candidate.participantId));
  return participantIds.every((participantId) => eligible.has(participantId)) ? state : null;
}

export function useSceneAmbient(input: UseSceneAmbientInput): SceneAmbientEntry | null {
  const settings = useAiStore((entry) => entry.settings);
  const session = useSceneAmbientStore((entry) => entry.session);
  const beginLocationSession = useSceneAmbientStore((entry) => entry.beginLocationSession);
  const startRequest = useSceneAmbientStore((entry) => entry.startRequest);
  const updatePartial = useSceneAmbientStore((entry) => entry.updatePartial);
  const completeRequest = useSceneAmbientStore((entry) => entry.completeRequest);
  const failRequest = useSceneAmbientStore((entry) => entry.failRequest);
  const setHidden = useSceneAmbientStore((entry) => entry.setHidden);
  const removeDepartedParticipants = useSceneAmbientStore((entry) => entry.removeDepartedParticipants);
  const clearEntry = useSceneAmbientStore((entry) => entry.clearEntry);
  const stateRef = useRef(input.state);
  const blockedRef = useRef(input.formalInteractionActive || input.exclusiveSurfaceActive);
  const attemptSerial = useRef(0);
  const attemptRef = useRef<(trigger: AmbientInitiativeTrigger) => void>(() => undefined);
  const scheduledAttemptCancelRef = useRef<(() => void) | null>(null);
  stateRef.current = input.state;
  blockedRef.current = input.formalInteractionActive || input.exclusiveSurfaceActive;

  const cancelScheduledAttempt = (): void => {
    scheduledAttemptCancelRef.current?.();
    scheduledAttemptCancelRef.current = null;
  };

  const scheduleAmbientAttempt = (trigger: AmbientInitiativeTrigger): void => {
    cancelScheduledAttempt();
    scheduledAttemptCancelRef.current = scheduleAfterPaint(() => {
      scheduledAttemptCancelRef.current = null;
      attemptRef.current(trigger);
    });
  };

  // A reset/load can clear a same-location session without changing the
  // location string; the null-session dependency starts a new epoch safely.
  useEffect(() => {
    if (!session || session.location !== input.state.master.location) {
      cancelScheduledAttempt();
      cancelSceneAmbientRequest(session?.requestId ?? undefined);
      beginLocationSession(input.state.master.location);
    }
  }, [beginLocationSession, input.state.master.location, session]);

  useEffect(() => () => {
    cancelScheduledAttempt();
    resetSceneAmbientRuntime();
  }, []);

  attemptRef.current = (trigger) => {
    const liveSettings = currentAiSettings();
    const state = stateRef.current;
    const liveSession = useSceneAmbientStore.getState().session;
    if (
      blockedRef.current ||
      !liveSettings.enabled ||
      !liveSettings.ambientEnabled ||
      !liveSession ||
      liveSession.location !== state.master.location
    ) return;
    const candidates = eligibleCandidates(state);
    attemptSerial.current += 1;
    const seed = sceneAmbientAttemptSeed(
      liveSession.sceneEpoch,
      state.time.tickValue,
      trigger,
      attemptSerial.current,
    );
    const opportunity = selectAmbientInitiativeOpportunity({
      trigger,
      seed,
      nowMs: Date.now(),
      location: liveSession.location,
      candidates,
      relationOf,
      locationCooldownUntil: liveSession.locationCooldownUntil,
      characterCooldownUntil: liveSession.characterCooldownUntil,
      scenePublishedCount: liveSession.publishedCount,
      requestInFlight: liveSession.requestId !== null,
    });
    if (!opportunity) return;
    const prepared = prepareSceneAmbientRequest({
      sceneEpoch: liveSession.sceneEpoch,
      state,
      opportunity,
      router: input.router,
      seed,
      visibleFacts: publicFacts(state.eventLog),
    });
    if (!prepared) return;
    startRequest(prepared.requestId, opportunity);
    void generateSceneAmbient(prepared, (lines) => {
      if (requestStillCurrent(
        prepared.requestId,
        prepared.sceneEpoch,
        prepared.opportunity.location,
        prepared.opportunity.participantIds,
        blockedRef.current,
      )) updatePartial(prepared.requestId, lines);
    }).then((lines) => {
      const current = requestStillCurrent(
        prepared.requestId,
        prepared.sceneEpoch,
        prepared.opportunity.location,
        prepared.opportunity.participantIds,
        blockedRef.current,
      );
      if (!current) {
        failRequest(prepared.requestId);
        return;
      }
      completeRequest(prepared.requestId, lines, Date.now());
      recordSceneAmbientHistory({ prepared, state: current, lines });
    }).catch(() => {
      // All failures are intentionally silent and drop partial output.
      failRequest(prepared.requestId);
    });
  };

  useEffect(() => {
    if (!settings.enabled || !settings.ambientEnabled) {
      cancelScheduledAttempt();
      cancelSceneAmbientRequest(session?.requestId ?? undefined);
      clearEntry();
    }
  }, [clearEntry, session?.requestId, settings.ambientEnabled, settings.enabled]);

  const profileEligibilitySignature = presentNpcIds(input.state)
    .map((participantId) => `${participantId}:${currentAiCharacterProfile(participantId).enabled ? 1 : 0}`)
    .join(",");
  useEffect(() => {
    const active = useSceneAmbientStore.getState().session;
    if (!active?.entry) return;
    if (active.entry.participantIds.some((participantId) => !currentAiCharacterProfile(participantId).enabled)) {
      cancelSceneAmbientRequest(active.requestId ?? undefined);
      clearEntry();
    }
  }, [clearEntry, profileEligibilitySignature]);

  const allBlocked = input.formalInteractionActive || input.exclusiveSurfaceActive;
  useEffect(() => {
    if (allBlocked) {
      cancelScheduledAttempt();
      cancelSceneAmbientRequest(session?.requestId ?? undefined);
      setHidden(true, !input.preserveEntryWhileFormal);
    } else {
      setHidden(false);
    }
  }, [allBlocked, input.preserveEntryWhileFormal, session?.requestId, setHidden]);

  const previousFormal = useRef(input.formalInteractionActive);
  useEffect(() => {
    const wasActive = previousFormal.current;
    previousFormal.current = input.formalInteractionActive;
    if (wasActive && !input.formalInteractionActive && !input.exclusiveSurfaceActive) {
      scheduleAmbientAttempt("interaction-ended");
    }
  }, [input.exclusiveSurfaceActive, input.formalInteractionActive]);

  const roster = presentNpcIds(input.state);
  const rosterSignature = roster.join(",");
  const previousRoster = useRef(`${input.state.master.location}|${rosterSignature}`);
  useEffect(() => {
    const key = `${input.state.master.location}|${rosterSignature}`;
    const previous = previousRoster.current;
    previousRoster.current = key;
    const active = useSceneAmbientStore.getState().session;
    if (active?.entry && !active.entry.participantIds.every((participantId) => roster.includes(participantId))) {
      cancelSceneAmbientRequest(active.requestId ?? undefined);
    }
    removeDepartedParticipants(roster);
    if (previous.split("|")[0] === input.state.master.location && previous !== key && !blockedRef.current) {
      scheduleAmbientAttempt("roster-changed");
    }
  }, [input.state.master.location, removeDepartedParticipants, rosterSignature]);

  const activitySignature = roster.map((participantId) => {
    const slot = input.state.charas[participantId]!;
    return `${participantId}:${checkHehai(slot, input.state as GameState)}`;
  }).join(",");
  const previousActivity = useRef(`${input.state.master.location}|${activitySignature}`);
  useEffect(() => {
    const key = `${input.state.master.location}|${activitySignature}`;
    const previous = previousActivity.current;
    previousActivity.current = key;
    if (previous.split("|")[0] === input.state.master.location && previous !== key && !blockedRef.current) {
      scheduleAmbientAttempt("free-action-changed");
    }
  }, [activitySignature, input.state.master.location]);

  useEffect(() => {
    if (!settings.enabled || !settings.ambientEnabled || allBlocked) return;
    let interval: number | undefined;
    const initial = window.setTimeout(() => {
      scheduleAmbientAttempt("location-idle");
      interval = window.setInterval(() => scheduleAmbientAttempt("location-idle"), 15_000);
    }, 8_000);
    return () => {
      window.clearTimeout(initial);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [allBlocked, input.state.master.location, settings.ambientEnabled, settings.enabled]);

  if (
    !session ||
    session.location !== input.state.master.location ||
    (session.hidden && !input.preserveEntryWhileFormal) ||
    !settings.enabled ||
    !settings.ambientEnabled
  ) return null;
  return session.entry;
}
