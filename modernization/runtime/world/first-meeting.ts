/**
 * 初対面 — the first-meeting special greeting.
 *
 * Faithful port of the core of `イベント関連/情事発覚.ERB @SYOTAIMEN(C_ID)`
 * (the portable, non-TALENT-reaction part):
 *
 *   SIF CFLAG:C_ID:面識            → RETURN          (once per chara)
 *   ...TALENT reactions (謎之魅力/魅惑/形状…)          ← deferred (stat side-branch)
 *   IF !FLAG:扮演
 *     SETCOLOR 0xc53d43
 *     SIF NO:C_ID != 拠点_家主
 *       PRINTFORMW %CALLNAME:C_ID%向初次见面的%CALLNAME:MASTER%作了问候
 *     CALL KOJO_MESSAGE_SEND("ENCOUNTER",0,C_ID,1,0)   → M_KOJO%RESULTS%_ENCOUNTER_K{n}
 *   CFLAG:C_ID:面識 = 1
 *
 * The ENCOUNTER kojo is the character's personal first-impression 口上
 * (KOJO_MESSAGE.ERB:63), routed through `DialogueRouter.resolveEncounterKojo`.
 *
 * Trigger point: an authoritative `arrived` or `woke` transition. Merely
 * scanning a shared room after an unrelated command is not an encounter.
 *
 * Deferred (documented, not silently dropped):
 *   - the TALENT-gated 好感/親密 reactions at the top of @SYOTAIMEN (a stat
 *     settlement side-branch, orthogonal to the greeting text);
 *   - the `NO:C_ID != 拠点_家主` suppression of the one-line 问候 narration
 *     (the base landlord still plays their ENCOUNTER 口上 upstream; runtime has
 *     no landlord constant, so the one-liner is always shown for now).
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type {
  DialogueRouter,
  InteractiveKojoResolution,
  KojoContinuationResolution,
  PendingKojoChoice,
} from "../kojo/types.js";
import type { Rng } from "../command/types.js";
import type { CharaSlot, GameState } from "../state/index.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { applyKojoEffects } from "../kojo/effects.js";
import type { DomainTransition } from "../state/domain-transition.js";
import { applyValentineFirstMeetingReward } from "./seasonal-events.js";

export interface FirstMeetingDeps {
  now: () => number;
  router?: DialogueRouter;
  rng?: Rng;
}

export interface EncounterTransition {
  kind: "arrived" | "woke";
  location: string;
  candidateCharaNums: readonly number[];
}

export interface EncounterAvailability {
  dialogueSessionAvailable: boolean;
}

function cflag(slot: CharaSlot, id: number): number {
  return slot.state.CFLAG[id] ?? 0;
}

function isAbsentLocation(location: string | undefined): boolean {
  const value = location?.trim() ?? "";
  return value === "" || value === "不在" || value === "外出中" || value === "退場";
}

/** Whether master has already met this chara (`CFLAG:面識`). */
export function hasMetMaster(state: GameState, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (!slot) return true; // unknown chara ⇒ never greet
  return cflag(slot, CFLAG_ID.认识) !== 0;
}

/**
 * Derive the encounter-relevant transition between two authoritative states.
 *
 * Arrival includes either the master entering a room or an NPC entering the
 * master's current room. Wake includes either side becoming awake while
 * already co-located. Candidates are captured at transition time so later
 * unrelated commands cannot rediscover an old shared-room state.
 */
export function detectEncounterTransition(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
): EncounterTransition | null {
  const location = after.master.location;
  if (isAbsentLocation(location)) return null;

  const arrived = new Set<number>();
  const woke = new Set<number>();
  const masterArrived = before.master.location !== location;
  const masterWoke =
    cflag(before.master, CFLAG_ID.睡眠) !== 0 &&
    cflag(after.master, CFLAG_ID.睡眠) === 0;

  for (const [rawCharaNum, slot] of Object.entries(after.charas)) {
    const charaNum = Number(rawCharaNum);
    if (!Number.isFinite(charaNum) || charaNum <= 0 || slot.location !== location) continue;
    const prior = before.charas[charaNum];
    if (masterArrived || !prior || prior.location !== location) arrived.add(charaNum);
    if (
      masterWoke ||
      (prior &&
        cflag(prior, CFLAG_ID.睡眠) !== 0 &&
        cflag(slot, CFLAG_ID.睡眠) === 0)
    ) {
      woke.add(charaNum);
    }
  }

  const kind = arrived.size > 0 ? "arrived" : woke.size > 0 ? "woke" : null;
  if (!kind) return null;
  const candidates = kind === "arrived" ? arrived : woke;
  return {
    kind,
    location,
    candidateCharaNums: [...candidates].sort((a, b) => a - b),
  };
}

/**
 * Shared encounter gate for arrival/wake ownership and roster-wide tests.
 */
export function canStartEncounter(
  state: Readonly<GameState>,
  charaNum: number,
  transition: EncounterTransition,
  availability: EncounterAvailability = { dialogueSessionAvailable: true },
): boolean {
  if (!availability.dialogueSessionAvailable) return false;
  if (!transition.candidateCharaNums.includes(charaNum)) return false;
  if (state.master.location !== transition.location) return false;
  if (isAbsentLocation(state.master.location)) return false;
  if (cflag(state.master, CFLAG_ID.睡眠) !== 0 || state.sleepSession) return false;
  if (cflag(state.master, CFLAG_ID.诶嘿嘿) !== 0 || state.training) return false;
  if (state.walkSession) return false;

  const slot = state.charas[charaNum];
  if (!slot || slot.location !== transition.location || isAbsentLocation(slot.location)) {
    return false;
  }
  if (cflag(slot, CFLAG_ID.认识) !== 0) return false;
  if (cflag(slot, CFLAG_ID.睡眠) !== 0 || cflag(slot, CFLAG_ID.衰弱) !== 0) return false;
  if (cflag(slot, CFLAG_ID.行动) === 5) return false;
  if (
    cflag(slot, CFLAG_ID.陪睡中) !== 0 ||
    cflag(slot, CFLAG_ID.恶作剧) !== 0 ||
    cflag(slot, CFLAG_ID.诶嘿嘿) !== 0
  ) {
    return false;
  }
  return true;
}

/** Result of one chara's first-meeting run (KOJO-CHOICE-PLAN P3). When
 *  `pending` is non-null the kojo paused on a player choice — the caller
 *  surfaces the option labels in the UI and calls `runFirstMeeting` again
 *  with `resumeChoices` extended by the picked index (replay-with-choice-
 *  path, same seed → deterministic). */
export interface FirstMeetingResult {
  events: ObservationEvent[];
  pending: PendingKojoChoice | null;
  continuationId?: string;
  continuationValues?: readonly (number | string)[];
  continuationInputMode?: "number" | "string";
  transitions: DomainTransition[];
}

export interface FirstMeetingsForTransitionResult {
  events: ObservationEvent[];
  pending: PendingKojoChoice | null;
  pendingCharaNum: number | null;
  continuationId?: string;
  continuationValues?: readonly (number | string)[];
  continuationInputMode?: "number" | "string";
  /** Event offset where the paused character's replayable transcript begins. */
  pendingEventStart: number | null;
  /** Candidates after the paused character, retained for choice continuation. */
  remainingCandidateCharaNums: number[];
  transitions: DomainTransition[];
}

/**
 * Run the 初対面 greeting for a single chara if master has not met them yet.
 * Mutates `CFLAG:面識 = 1` on the slot and returns the greeting +
 * first-impression 口上 events (empty if already met / no slot).
 *
 * `扮演` (roleplay) mode suppresses the greeting text but STILL marks 面識, so a
 * subsequent vanilla meeting won't re-greet — faithful to upstream.
 *
 * No-op (but still marks 面識) without a router/rng, matching the DAYEVENT /
 * ONANISM policy: tests that don't wire a router just get the flag set.
 *
 * When the router implements `resolveEncounterKojoInteractive`, the walk
 * honours mid-kojo player choices (`PRINTBUTTON`+`INPUT`+`SELECTCASE
 * RESULT(S)`). `resumeChoices` is the indices the player has already
 * picked for THIS chara; on a pending return, the caller appends the next
 * pick and calls again (same seed = stable).
 */
export function runFirstMeeting(
  state: GameState,
  charaNum: number,
  deps: FirstMeetingDeps,
  resumeChoices: readonly number[] = [],
  opts: { replaying?: boolean } = {},
): FirstMeetingResult {
  const slot = state.charas[charaNum];
  if (!slot) return { events: [], pending: null, transitions: [] };
  // On a fresh call: skip already-met charas (one-shot gate). On a replay
  // (resumeChoices non-empty OR replaying=true), the met chara must RE-RUN
  // its kojo so the player can finish the choice path.
  if (!opts.replaying && resumeChoices.length === 0 && cflag(slot, CFLAG_ID.认识) !== 0) {
    return { events: [], pending: null, transitions: [] };
  }

  const events: ObservationEvent[] = [];
  const roleplaying = (state.flagStore[FLAG_ID.扮演] ?? 0) !== 0;
  let pending: PendingKojoChoice | null = null;
  let continuationId: string | undefined;
  let continuationValues: readonly (number | string)[] | undefined;
  let continuationInputMode: "number" | "string" | undefined;
  let completed = true;

  if (!roleplaying) {
    const { now, router, rng } = deps;
    const charaName = slot.callName ?? `角色${charaNum}`;
    const masterName = state.master.callName ?? "主人公";

    // The暗红 `SETCOLOR 0xc53d43` 问候 一行 (地文, about the chara).
    events.push({
      kind: "NARRATION",
      timestamp: now(),
      charaNum,
      text: `${charaName}向初次见面的${masterName}作了问候`,
    });

    // The character's personal first-impression 口上 (ENCOUNTER), if any.
    if (rng) {
      const interactiveRouter = router as
        | (DialogueRouter & {
            resolveEncounterKojoInteractive?: NonNullable<
              DialogueRouter["resolveEncounterKojoInteractive"]
            >;
          })
        | undefined;
      const appendInteractive = (walk: InteractiveKojoResolution): void => {
        for (const line of walk.lines) {
          events.push({
            kind: "DIALOGUE_LINE",
            timestamp: now(),
            charaNum,
            text: line.text,
            form: line.form,
          });
        }
        pending = walk.pending;
        if (!pending && walk.effects?.length) {
          Object.assign(state, applyKojoEffects(state, walk.effects));
        }
      };
      const appendContinuation = (walk: KojoContinuationResolution): void => {
        for (const line of walk.resolution.lines) {
          events.push({ kind: "DIALOGUE_LINE", timestamp: now(), charaNum, text: line.text, form: line.form });
        }
        pending = walk.pending;
        continuationId = walk.continuationId;
        continuationValues = walk.pending?.values;
        continuationInputMode = walk.pending?.inputMode;
        completed = walk.resolution.status === "resolved" || walk.resolution.status === "gated" || walk.resolution.status === "not-authored";
        if (!pending && completed && walk.resolution.effects.length > 0) {
          Object.assign(state, applyKojoEffects(state, walk.resolution.effects));
        }
      };

      // A real VM continuation owns a live ERB stack and wins whenever it
      // actually pauses. Static/native packs also expose the compatibility
      // continuation method, but it cannot carry PRINTBUTTON choices. Probe
      // their established interactive path before accepting a non-pausing
      // continuation, and use that path directly on replay.
      if (resumeChoices.length > 0 && interactiveRouter?.resolveEncounterKojoInteractive) {
        appendInteractive(interactiveRouter.resolveEncounterKojoInteractive(
          charaNum, state, rng, resumeChoices,
        ));
      } else if (router?.resolveEncounterKojoContinuation) {
        const continuation = router.resolveEncounterKojoContinuation(charaNum, state, rng);
        if (!continuation.pending && interactiveRouter?.resolveEncounterKojoInteractive) {
          const interactive = interactiveRouter.resolveEncounterKojoInteractive(charaNum, state, rng, []);
          if (interactive.pending) appendInteractive(interactive);
          else appendContinuation(continuation);
        } else {
          appendContinuation(continuation);
        }
      } else if (interactiveRouter?.resolveEncounterKojoInteractive) {
        appendInteractive(interactiveRouter.resolveEncounterKojoInteractive(
          charaNum, state, rng, resumeChoices,
        ));
      } else if (router?.resolveEncounterKojoDetailed) {
        const resolved = router.resolveEncounterKojoDetailed(charaNum, state, rng);
        for (const line of resolved.lines) {
          events.push({
            kind: "DIALOGUE_LINE",
            timestamp: now(),
            charaNum,
            text: line.text,
            form: line.form,
          });
        }
        if (resolved.status === "resolved" && resolved.effects.length > 0) {
          Object.assign(state, applyKojoEffects(state, resolved.effects));
        }
      } else if (router?.resolveEncounterKojo) {
        for (const line of router.resolveEncounterKojo(charaNum, state, rng)) {
          events.push({
            kind: "DIALOGUE_LINE",
            timestamp: now(),
            charaNum,
            text: line.text,
            form: line.form,
          });
        }
      }
    }
  }

  const transitions: DomainTransition[] = [];
  if (!pending && completed) {
    // `applyKojoEffects()` returns a cloned complete state and the assignment
    // above replaces `state.charas`. Re-read the live slot before making this
    // authoritative one-shot write; `slot` can now be detached.
    const liveSlot = state.charas[charaNum];
    if (liveSlot) {
      const firstMet = cflag(liveSlot, CFLAG_ID.认识) === 0;
      liveSlot.state.CFLAG[CFLAG_ID.认识] = 1;
      if (firstMet) {
        transitions.push({ kind: "first-met", charaNum });
        const seasonalReward = applyValentineFirstMeetingReward(state, charaNum, deps.now);
        if (seasonalReward) events.push(seasonalReward);
      }
    }
  }
  return { events, pending, continuationId, continuationValues, continuationInputMode, transitions };
}

/**
 * Run 初対面 only for candidates captured by an arrival/wake transition.
 * Iteration is ascending and stops at the first interactive pause.
 */
export function runFirstMeetingsForTransition(
  state: GameState,
  transition: EncounterTransition,
  deps: FirstMeetingDeps,
  availability: EncounterAvailability = { dialogueSessionAvailable: true },
): FirstMeetingsForTransitionResult {
  const events: ObservationEvent[] = [];
  const transitions: DomainTransition[] = [];
  for (let index = 0; index < transition.candidateCharaNums.length; index += 1) {
    const charaNum = transition.candidateCharaNums[index]!;
    if (!canStartEncounter(state, charaNum, transition, availability)) continue;
    const eventStart = events.length;
    const r = runFirstMeeting(state, charaNum, deps);
    events.push(...r.events);
    transitions.push(...r.transitions);
    if (r.pending) {
      return {
        events,
        pending: r.pending,
        pendingCharaNum: charaNum,
        continuationId: r.continuationId,
        continuationValues: r.continuationValues,
        continuationInputMode: r.continuationInputMode,
        pendingEventStart: eventStart,
        remainingCandidateCharaNums: transition.candidateCharaNums.slice(index + 1),
        transitions,
      };
    }
  }
  return {
    events,
    pending: null,
    pendingCharaNum: null,
    continuationId: undefined,
    pendingEventStart: null,
    remainingCandidateCharaNums: [],
    transitions,
  };
}
