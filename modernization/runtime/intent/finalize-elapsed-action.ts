import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/rng.js";
import type { DialogueRouter } from "../kojo/types.js";
import { forceSleepFromExhaustion } from "../command/handlers/sleep.js";
import { runEventComEnd2 } from "../command/handlers/event-com-end.js";
import { type CharaSlot, type GameState } from "../state/game-state.js";
import { runUwakiWitnessCheck } from "../state/uwaki.js";
import {
  detectDomainTransitions,
  type DomainTransition,
} from "../state/domain-transition.js";
import { outRoof } from "../world/location-predicates.js";
import { accrueMobDirt } from "../world/mobs.js";
import { reprojectSchedules } from "../world/scheduler.js";
import { currentRegionWeather } from "../weather/region-override.js";
import { weatherCheckUmbrella } from "../weather/umbrella.js";

export interface FinalizeElapsedActionOptions {
  oldTick: number;
  commandNo: number;
  now: () => number;
  rng: Rng;
  dialogueRouter?: DialogueRouter;
  /** Resolver-owned commands already accrue MOB dirt before this boundary. */
  accrueMobDirt?: boolean;
}

export interface FinalizeElapsedActionResult {
  state: GameState;
  events: ObservationEvent[];
  transitions: DomainTransition[];
}

function domainSlotSnapshot(slot: CharaSlot): CharaSlot {
  return {
    ...slot,
    state: {
      ...slot.state,
      CFLAG: { ...slot.state.CFLAG },
      MARK: { ...slot.state.MARK },
      TALENT: { ...slot.state.TALENT },
    },
  };
}

/** The transition detector reads only character domain fields. Avoid cloning
 * the event log, inventories and other large bags at every elapsed-action
 * boundary while retaining a compatibility fallback for malformed saves. */
function domainStateSnapshot(state: GameState): GameState {
  return {
    master: domainSlotSnapshot(state.master),
    charas: Object.fromEntries(
      Object.entries(state.charas).map(([id, slot]) => [id, domainSlotSnapshot(slot)]),
    ),
  } as unknown as GameState;
}

/** Shared EVENTCOMEND/world projection boundary for anything that advances
 * game time: ordinary commands and full-screen activity settlements alike. */
export function finalizeElapsedAction(
  state: GameState,
  options: FinalizeElapsedActionOptions,
): FinalizeElapsedActionResult {
  const beforePost = domainStateSnapshot(state);
  const newTick = state.time.tickValue;
  const elapsed = Math.max(0, newTick - options.oldTick);

  if (options.accrueMobDirt && elapsed > 0) {
    accrueMobDirt(state, options.oldTick, newTick);
  }

  const umbrellaResult =
    elapsed > 0 && outRoof(state, state.master.location)
      ? weatherCheckUmbrella(state, {
          weatherId: currentRegionWeather(state).weatherIndex,
          lapse: elapsed,
        })
      : { state, messages: [] as string[] };
  const postState = umbrellaResult.state;
  const umbrellaEvents: ObservationEvent[] = umbrellaResult.messages.map((text) => ({
    kind: "NARRATION",
    timestamp: options.now(),
    text,
  }));
  const scheduleEvents = reprojectSchedules(
    postState,
    options.oldTick,
    newTick,
    options.now,
    {
      dialogueRouter: options.dialogueRouter,
      rng: options.rng,
    },
  );
  runEventComEnd2(postState, elapsed);
  runUwakiWitnessCheck(postState, options.commandNo);
  const collapseEvents = forceSleepFromExhaustion(postState, options.now);
  return {
    state: postState,
    events: [...umbrellaEvents, ...scheduleEvents, ...collapseEvents],
    transitions: detectDomainTransitions(beforePost, postState),
  };
}
