import { create } from "zustand";
import type {
  SceneAmbientEntry,
  SceneAmbientLine,
  SceneAmbientSession,
} from "./types.js";
import type { AmbientInitiativeOpportunity } from "../../../modernization/runtime/world/ambient-initiative.js";

export const AMBIENT_LOCATION_COOLDOWN_MS = 45_000;
export const AMBIENT_CHARACTER_COOLDOWN_MS = 90_000;

interface SceneAmbientState {
  epochCounter: number;
  session: SceneAmbientSession | null;
  beginLocationSession: (location: string) => SceneAmbientSession;
  startRequest: (requestId: string, opportunity: AmbientInitiativeOpportunity) => void;
  updatePartial: (requestId: string, lines: SceneAmbientLine[]) => void;
  completeRequest: (requestId: string, lines: SceneAmbientLine[], nowMs: number) => void;
  failRequest: (requestId: string) => void;
  setHidden: (hidden: boolean, dropPartial?: boolean) => void;
  removeDepartedParticipants: (presentIds: readonly number[]) => void;
  clearEntry: () => void;
  resetSession: () => void;
}

function newSession(location: string, sceneEpoch: number): SceneAmbientSession {
  return {
    location,
    sceneEpoch,
    entry: null,
    requestId: null,
    hidden: false,
    publishedCount: 0,
    locationCooldownUntil: 0,
    characterCooldownUntil: {},
  };
}

function entryFor(
  requestId: string,
  opportunity: AmbientInitiativeOpportunity,
): SceneAmbientEntry {
  return {
    requestId,
    trigger: opportunity.trigger,
    mode: opportunity.mode,
    kind: opportunity.kind,
    participantIds: [...opportunity.participantIds],
    lines: [],
    complete: false,
  };
}

export const useSceneAmbientStore = create<SceneAmbientState>((set, get) => ({
  epochCounter: 0,
  session: null,

  beginLocationSession(location) {
    const current = get().session;
    if (current?.location === location) return current;
    const sceneEpoch = get().epochCounter + 1;
    const session = newSession(location, sceneEpoch);
    set({ epochCounter: sceneEpoch, session });
    return session;
  },

  startRequest(requestId, opportunity) {
    set((state) => {
      const session = state.session;
      if (!session || session.location !== opportunity.location || session.requestId) return state;
      return {
        session: {
          ...session,
          requestId,
          entry: entryFor(requestId, opportunity),
        },
      };
    });
  },

  updatePartial(requestId, lines) {
    set((state) => {
      const session = state.session;
      if (!session || session.requestId !== requestId || session.entry?.requestId !== requestId) return state;
      return { session: { ...session, entry: { ...session.entry, lines: [...lines] } } };
    });
  },

  completeRequest(requestId, lines, nowMs) {
    set((state) => {
      const session = state.session;
      if (!session || session.requestId !== requestId || session.entry?.requestId !== requestId) return state;
      const characterCooldownUntil = { ...session.characterCooldownUntil };
      for (const participantId of session.entry.participantIds) {
        characterCooldownUntil[participantId] = nowMs + AMBIENT_CHARACTER_COOLDOWN_MS;
      }
      return {
        session: {
          ...session,
          requestId: null,
          entry: { ...session.entry, lines: [...lines], complete: true },
          publishedCount: session.publishedCount + 1,
          locationCooldownUntil: nowMs + AMBIENT_LOCATION_COOLDOWN_MS,
          characterCooldownUntil,
        },
      };
    });
  },

  failRequest(requestId) {
    set((state) => {
      const session = state.session;
      if (!session || session.requestId !== requestId) return state;
      return { session: { ...session, requestId: null, entry: null } };
    });
  },

  setHidden(hidden, dropPartial = false) {
    set((state) => {
      const session = state.session;
      if (!session) return state;
      const drop = dropPartial && session.entry && !session.entry.complete;
      return {
        session: {
          ...session,
          hidden,
          ...(drop ? { requestId: null, entry: null } : {}),
        },
      };
    });
  },

  removeDepartedParticipants(presentIds) {
    const present = new Set(presentIds);
    set((state) => {
      const session = state.session;
      if (!session?.entry || session.entry.participantIds.every((id) => present.has(id))) return state;
      return { session: { ...session, requestId: null, entry: null } };
    });
  },

  clearEntry() {
    set((state) => state.session
      ? { session: { ...state.session, requestId: null, entry: null } }
      : state);
  },

  resetSession() {
    set((state) => ({ epochCounter: state.epochCounter + 1, session: null }));
  },
}));

export function currentSceneAmbientSession(): SceneAmbientSession | null {
  return useSceneAmbientStore.getState().session;
}
