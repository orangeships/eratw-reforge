import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/rng.js";
import type { DialogueRouter } from "../kojo/types.js";
import { forceSleepFromExhaustion } from "../command/handlers/sleep.js";
import { runEventComEnd2 } from "../command/handlers/event-com-end.js";
import { cloneGameState, type GameState } from "../state/game-state.js";
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

/** Shared EVENTCOMEND/world projection boundary for anything that advances
 * game time: ordinary commands and full-screen activity settlements alike. */
export function finalizeElapsedAction(
  state: GameState,
  options: FinalizeElapsedActionOptions,
): FinalizeElapsedActionResult {
  const beforePost = cloneGameState(state);
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
