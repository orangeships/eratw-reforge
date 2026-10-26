import type { DialogueRouter, KojoContinuationResolution, KojoLine, KojoResolution } from "../kojo/types.js";
import type { Rng } from "../command/types.js";
import type { GameState } from "../state/index.js";
import { toKojoVmResolution } from "./resolution.js";
import { createKojoVmGameStateHost } from "./game-state-host.js";
import type { KojoVmInstruction, KojoVmProgram } from "./types.js";
import type { KojoVmContinuation, KojoVmResult } from "./types.js";
import { executeKojoVm } from "./vm.js";
import { executeKojoVmInteractive } from "./interactive.js";

function empty(status: "not-authored" | "gated"): KojoResolution {
  return { status, lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [] };
}

type KojoVmDispatcherCategory = "COMMAND" | "EVENT" | "SP_EVENT" | "ENCOUNTER";

function mayProduceRouteOutput(program: KojoVmProgram, name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const fn = program.functions[name];
  if (!fn) return true;
  const inspect = (instructions: readonly KojoVmInstruction[]): boolean => instructions.some((instruction) => {
    switch (instruction.kind) {
      case "emit":
      case "hph-print":
      case "print-button":
      case "input":
      case "wait":
      case "host-call":
      case "unsupported":
        return true;
      case "call":
        return instruction.dynamic || mayProduceRouteOutput(program, instruction.target, seen);
      case "try-call":
        return instruction.call.dynamic
          || mayProduceRouteOutput(program, instruction.call.target, seen)
          || inspect(instruction.fallback);
      case "if":
        return inspect(instruction.then) || inspect(instruction.otherwise);
      case "select":
      case "string-select":
        return instruction.cases.some((entry) => inspect(entry.body)) || inspect(instruction.defaultCase);
      case "for":
      case "repeat":
      case "do":
        return inspect(instruction.body);
      default:
        return false;
    }
  });
  return inspect(fn.instructions) || Object.values(fn.labels).some((instructions) => inspect(instructions));
}

function toDispatcherResolution(
  program: KojoVmProgram,
  result: KojoVmResult,
  charaNum: number,
  category: KojoVmDispatcherCategory,
  timing: number,
): KojoResolution {
  const resolution = toKojoVmResolution(result, charaNum);
  if (resolution.status !== "gated" || (category !== "COMMAND" && category !== "EVENT")) return resolution;
  // Only the selected author entry itself can establish an intentional empty
  // route. MESSAGECHECK and dispatcher-only returns remain gates.
  const entry = category === "COMMAND"
    ? new RegExp(`^M_KOJO(?:_[^_]+)*_MESSAGE_COM_K${charaNum}_${timing}$`, "i")
    : new RegExp(`^M_KOJO(?:_[^_]+)*_EVENT_K${charaNum}_${timing}$`, "i");
  const authored = [...(result.functionReturns ?? [])].reverse().find((frame) => entry.test(frame.name));
  // EVENT's nonzero author return is the upstream ownership signal even when
  // the current state emits no line. COMMAND retains the stricter static
  // check because its generic fallback semantics differ.
  return authored && authored.returnValue !== 0 && (category === "EVENT" || !mayProduceRouteOutput(program, authored.name))
    ? { ...resolution, status: "resolved" }
    : resolution;
}

/** Executes one original KOJO_MESSAGE_SEND category arm. `timing` maps to
 * ARG:1, the speaking character to ARG:2, and category-specific values start
 * at ARG:3. VM call frames reserve slot zero for bare ARG, so the dispatcher
 * signature begins at index one. The browser host's SELECTCOM is meaningful
 * only for COMMAND. */
function resolveKojoVmDispatcherCategory(
  program: KojoVmProgram,
  category: KojoVmDispatcherCategory,
  charaNum: number,
  timing: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
): KojoResolution {
  if (!program.functions.KOJO_MESSAGE_SEND) return empty("not-authored");
  const result = executeKojoVm(program, "KOJO_MESSAGE_SEND", {
    args: [0, timing, charaNum, ...args],
    stringArgs: [category],
    ...createKojoVmGameStateHost({
      state,
      target: charaNum,
      commandNo: category === "COMMAND" ? timing : state.turnContext?.selectCom ?? 0,
      rng,
    }),
  });
  return toDispatcherResolution(program, result, charaNum, category, timing);
}

/** Executes the original KOJO_MESSAGE_SEND COMMAND arm. This remains a
 * separately constructed opt-in router until host-event/UI parity is proven. */
export function resolveKojoVmDispatcherCommand(
  program: KojoVmProgram,
  charaNum: number,
  commandNo: number,
  state: Readonly<GameState>,
  rng: Rng,
): KojoResolution {
  // COMMAND functions read the selected command from SELECTCOM. Passing it
  // through ARG:1 preserves the original dispatcher signature as well.
  return resolveKojoVmDispatcherCategory(program, "COMMAND", charaNum, commandNo, state, rng);
}

export function resolveKojoVmDispatcherEvent(
  program: KojoVmProgram,
  charaNum: number,
  arm: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
): KojoResolution {
  return resolveKojoVmDispatcherCategory(program, "EVENT", charaNum, arm, state, rng, args);
}

export function resolveKojoVmDispatcherSpEvent(
  program: KojoVmProgram,
  charaNum: number,
  subid: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
): KojoResolution {
  return resolveKojoVmDispatcherCategory(program, "SP_EVENT", charaNum, subid, state, rng, args);
}

/** Executes the original first-meeting dispatcher frame:
 * KOJO_MESSAGE_SEND("ENCOUNTER", 0, C_ID, 1, 0). The fixed trailing
 * arguments are observable by authored encounter functions, so they must not
 * be replaced by a direct M_KOJO_ENCOUNTER_K* call. */
export function resolveKojoVmDispatcherEncounter(
  program: KojoVmProgram,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
): KojoResolution {
  return resolveKojoVmDispatcherCategory(program, "ENCOUNTER", charaNum, 0, state, rng, [1, 0]);
}

/** COUNTER has a dedicated downstream dispatcher in upstream ERB so nested
 * routing does not overwrite its local frame. Invoke that original entrypoint
 * directly with its final frame; this also preserves bare ARG slot zero. */
export function resolveKojoVmDispatcherCounter(
  program: KojoVmProgram,
  charaNum: number,
  counterAction: number,
  state: Readonly<GameState>,
  rng: Rng,
): KojoResolution {
  if (!program.functions.KOJO_MESSAGE_SEND_COUNTER) return empty("not-authored");
  const target = state.charas[charaNum];
  if (!target) return empty("not-authored");
  // The counter selector is transient context, not an authored effect.
  const executionState: GameState = {
    ...state,
    charas: {
      ...state.charas,
      [charaNum]: {
        ...target,
        state: { ...target.state, TCVAR: { ...target.state.TCVAR, 20: counterAction } },
      },
    },
  };
  return toKojoVmResolution(executeKojoVm(program, "KOJO_MESSAGE_SEND_COUNTER", {
    args: [0, counterAction, charaNum, 0, 0, 0, 0],
    ...createKojoVmGameStateHost({
      state: executionState,
      target: charaNum,
      commandNo: executionState.turnContext?.selectCom ?? 0,
      rng,
    }),
  }), charaNum);
}

export function createKojoVmCommandDialogueRouter(program: KojoVmProgram): DialogueRouter {
  const resolve = (charaNum: number, commandNo: number, state: Readonly<GameState>, rng: Rng) =>
    resolveKojoVmDispatcherCommand(program, charaNum, commandNo, state, rng);
  const resolveEvent = (charaNum: number, arm: number, state: Readonly<GameState>, rng: Rng, args: readonly number[] = []) =>
    resolveKojoVmDispatcherEvent(program, charaNum, arm, state, rng, args);
  const resolveSpEvent = (charaNum: number, subid: number, state: Readonly<GameState>, rng: Rng, args: readonly number[] = []) =>
    resolveKojoVmDispatcherSpEvent(program, charaNum, subid, state, rng, args);
  const resolveEncounter = (charaNum: number, state: Readonly<GameState>, rng: Rng) =>
    resolveKojoVmDispatcherEncounter(program, charaNum, state, rng);
  const resolveCounter = (charaNum: number, counterAction: number, state: Readonly<GameState>, rng: Rng) =>
    resolveKojoVmDispatcherCounter(program, charaNum, counterAction, state, rng);
  let serial = 0;
  const continuations = new Map<string, { continuation: KojoVmContinuation; charaNum: number; category: KojoVmDispatcherCategory; timing: number }>();
  const fromInteractive = (result: KojoVmResult, charaNum: number, category: KojoVmDispatcherCategory, timing: number, reuseId?: string): KojoContinuationResolution => {
    if (result.status !== "paused") return { resolution: toDispatcherResolution(program, result, charaNum, category, timing), pending: null };
    const pendingInput = result.pendingInput;
    const continuation = result.continuation;
    if (!pendingInput || !continuation || (pendingInput.scope === "wait" && pendingInput.options.length === 0)) {
      continuation?.cancel();
      return {
        resolution: {
          status: "unsupported", lines: [], effects: [], unsupportedPredicates: [],
          unsupportedEffects: ["unsupported VM input pause"],
          diagnostics: [{ code: "unsupported-effect", detail: "unsupported VM input pause", line: pendingInput?.location.line }],
        },
        pending: null,
      };
    }
    const continuationId = reuseId ?? `kojo-vm:${++serial}`;
    continuations.set(continuationId, { continuation, charaNum, category, timing });
    return {
      resolution: {
        status: result.events.length > 0 ? "resolved" : "gated",
        lines: result.events.map((event) => ({ text: event.text, form: event.form, line: event.location.line })),
        // The transaction has not completed. Effects and host calls must not
        // escape the owner session before a successful resume.
        effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
      },
      pending: {
        options: pendingInput.options.map((option) => ({ label: option.label })),
        values: pendingInput.options.map((option) => option.value),
        inputMode: pendingInput.options.length === 0
          ? pendingInput.scope === "result" ? "number" : "string"
          : undefined,
        line: pendingInput.location.line,
      },
      continuationId,
    };
  };
  const runInteractiveCategory = (
    category: KojoVmDispatcherCategory,
    charaNum: number,
    timing: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] = [],
  ): KojoContinuationResolution => {
    if (!program.functions.KOJO_MESSAGE_SEND) return { resolution: empty("not-authored"), pending: null };
    // COMMAND historically passes zero in ARG:1 and reads SELECTCOM from the
    // host. Keep that frame stable; all other categories expose their actual
    // upstream dispatcher arguments to the suspended stack.
    const dispatcherArgs = category === "COMMAND"
      ? [0, 0, charaNum]
      : [0, timing, charaNum, ...args];
    const result = executeKojoVmInteractive(program, "KOJO_MESSAGE_SEND", {
      args: dispatcherArgs,
      stringArgs: [category],
      ...createKojoVmGameStateHost({
        state,
        target: charaNum,
        commandNo: category === "COMMAND" ? timing : state.turnContext?.selectCom ?? 0,
        rng,
      }),
    });
    return fromInteractive(result, charaNum, category, timing);
  };
  return {
    collect(charaNum: number, commandNo: number, state: Readonly<GameState>, rng: Rng): KojoLine[] {
      return resolve(charaNum, commandNo, state, rng).lines;
    },
    collectDetailed: resolve,
    collectContinuation(charaNum, commandNo, state, rng) {
      return runInteractiveCategory("COMMAND", charaNum, commandNo, state, rng);
    },
    resumeContinuation(continuationId, value) {
      const continuation = continuations.get(continuationId);
      if (!continuation) {
        return {
          resolution: {
            status: "unsupported", lines: [], effects: [], unsupportedPredicates: [],
            unsupportedEffects: ["stale VM continuation"],
            diagnostics: [{ code: "unsupported-effect", detail: "stale VM continuation" }],
          },
          pending: null,
        };
      }
      continuations.delete(continuationId);
      return fromInteractive(continuation.continuation.resume(value), continuation.charaNum, continuation.category, continuation.timing, continuationId);
    },
    cancelContinuation(continuationId) {
      const continuation = continuations.get(continuationId);
      continuations.delete(continuationId);
      continuation?.continuation.cancel();
    },
    resolveEventKojo(charaNum, arm, state, rng, args = []) {
      return resolveEvent(charaNum, arm, state, rng, args).lines;
    },
    resolveEventKojoDetailed: resolveEvent,
    resolveEventKojoContinuation(charaNum, arm, state, rng, args = []) {
      return runInteractiveCategory("EVENT", charaNum, arm, state, rng, args);
    },
    resolveSpEventKojo(charaNum, subid, state, rng, args = []) {
      return resolveSpEvent(charaNum, subid, state, rng, args).lines;
    },
    resolveSpEventKojoDetailed: resolveSpEvent,
    resolveSpEventKojoContinuation(charaNum, subid, state, rng, args = []) {
      return runInteractiveCategory("SP_EVENT", charaNum, subid, state, rng, args);
    },
    resolveEncounterKojo(charaNum, state, rng) {
      return resolveEncounter(charaNum, state, rng).lines;
    },
    resolveEncounterKojoDetailed: resolveEncounter,
    resolveEncounterKojoContinuation(charaNum, state, rng) {
      return runInteractiveCategory("ENCOUNTER", charaNum, 0, state, rng, [1, 0]);
    },
    resolveCounterKojo(charaNum, counterAction, state, rng) {
      return resolveCounter(charaNum, counterAction, state, rng).lines;
    },
    resolveCounterKojoDetailed: resolveCounter,
  };
}
