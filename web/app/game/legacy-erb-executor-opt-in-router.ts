/**
 * RETIRED PRODUCTION ADAPTER.
 *
 * This preserves historical opt-in behavior for focused compatibility tests.
 * It is not a supported player route, fallback, or missing-dialogue solution;
 * no application bootstrap may import it.
 */
import type { DialogueRouter, KojoLine, KojoResolution } from "../../../modernization/runtime/kojo/types.js";
import { createKojoVmCommandDialogueRouter } from "../../../modernization/runtime/kojo-vm/command-router.js";
import { BrowserKojoVmLoader } from "./legacy-erb-executor-loader.js";

interface KojoVmRouteEntry {
  router: DialogueRouter;
  commandNos?: ReadonlySet<number>;
  eventArms?: ReadonlySet<number>;
  spEventSubids?: ReadonlySet<number>;
  encounter?: boolean;
  counterActions?: ReadonlySet<number>;
}

/** Overlay only the explicitly bundled COMMAND routes. This prevents a VM
 * unsupported/gated authored path from falling through to legacy execution. */
export function createKojoVmOptInRouter(base: DialogueRouter, vm: DialogueRouter, charaNums: ReadonlySet<number>): DialogueRouter {
  const useVm = (charaNum: number) => charaNums.has(charaNum);
  const detailed = (charaNum: number, commandNo: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3]): KojoResolution => {
    const router = useVm(charaNum) ? vm : base;
    return router.collectDetailed?.(charaNum, commandNo, state, rng) ?? {
      status: "not-authored", lines: router.collect(charaNum, commandNo, state, rng), effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  return {
    collect(charaNum, commandNo, state, rng): KojoLine[] { return detailed(charaNum, commandNo, state, rng).lines; },
    collectDetailed: detailed,
    collectContinuation(charaNum, commandNo, state, rng) {
      const router = useVm(charaNum) ? vm : base;
      return router.collectContinuation?.(charaNum, commandNo, state, rng) ?? {
        resolution: detailed(charaNum, commandNo, state, rng),
        pending: null,
      };
    },
    resumeContinuation(continuationId, value) {
      if (continuationId.startsWith("kojo-vm:")) {
        return vm.resumeContinuation?.(continuationId, value) ?? {
          resolution: { status: "unsupported", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: ["missing VM continuation adapter"], diagnostics: [] },
          pending: null,
        };
      }
      return base.resumeContinuation?.(continuationId, value) ?? {
        resolution: { status: "unsupported", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: ["missing continuation adapter"], diagnostics: [] },
        pending: null,
      };
    },
    cancelContinuation(continuationId) {
      if (continuationId.startsWith("kojo-vm:")) vm.cancelContinuation?.(continuationId);
      else base.cancelContinuation?.(continuationId);
    },
    resolveEventKojo: (...args) => base.resolveEventKojo(...args),
    resolveEventKojoContinuation: (...args) => (useVm(args[0]) ? vm : base).resolveEventKojoContinuation?.(...args) ?? {
      resolution: (useVm(args[0]) ? vm : base).resolveEventKojoDetailed?.(args[0], args[1], args[2], args[3], args[4] ? [...args[4]] : []) ?? {
        status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
      }, pending: null,
    },
    resolveSpEventKojo: (...args) => base.resolveSpEventKojo(...args),
    resolveSpEventKojoContinuation: (...args) => (useVm(args[0]) ? vm : base).resolveSpEventKojoContinuation?.(...args) ?? {
      resolution: (useVm(args[0]) ? vm : base).resolveSpEventKojoDetailed?.(args[0], args[1], args[2], args[3], args[4] ? [...args[4]] : []) ?? {
        status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
      }, pending: null,
    },
    resolveEncounterKojo: (...args) => base.resolveEncounterKojo?.(...args) ?? [],
    resolveEncounterKojoDetailed: (...args) => base.resolveEncounterKojoDetailed?.(...args) ?? {
      status: "not-authored", lines: base.resolveEncounterKojo?.(...args) ?? [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    },
    resolveEncounterKojoContinuation: (...args) => (useVm(args[0]) ? vm : base).resolveEncounterKojoContinuation?.(...args) ?? {
      resolution: (useVm(args[0]) ? vm : base).resolveEncounterKojoDetailed?.(...args) ?? {
        status: "not-authored", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
      }, pending: null,
    },
  };
}

/** Multi-shard form of the COMMAND overlay. Each character keeps its own VM
 * program, so browser bundles never merge duplicate dispatcher functions.
 * Continuations are bound to the router that created them, not inferred from
 * a mutable global or character number. */
export function createKojoVmMultiOptInRouter(
  base: DialogueRouter,
  vmRouters: ReadonlyMap<number, KojoVmRouteEntry>,
): DialogueRouter {
  const continuations = new Map<string, DialogueRouter>();
  const routerForCommand = (charaNum: number, commandNo: number) => {
    const entry = vmRouters.get(charaNum);
    return entry && (!entry.commandNos || entry.commandNos.has(commandNo)) ? entry.router : base;
  };
  const routerForEvent = (charaNum: number, arm: number) => {
    const entry = vmRouters.get(charaNum);
    return entry?.eventArms?.has(arm) ? entry.router : base;
  };
  const routerForSpEvent = (charaNum: number, subid: number) => {
    const entry = vmRouters.get(charaNum);
    return entry?.spEventSubids?.has(subid) ? entry.router : base;
  };
  const routerForEncounter = (charaNum: number) => {
    const entry = vmRouters.get(charaNum);
    return entry?.encounter ? entry.router : base;
  };
  const routerForCounter = (charaNum: number, action: number) => {
    const entry = vmRouters.get(charaNum);
    return entry?.counterActions?.has(action) ? entry.router : base;
  };
  const detailed = (charaNum: number, commandNo: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3]): KojoResolution => {
    const router = routerForCommand(charaNum, commandNo);
    return router.collectDetailed?.(charaNum, commandNo, state, rng) ?? {
      status: "not-authored", lines: router.collect(charaNum, commandNo, state, rng), effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  const eventDetailed = (charaNum: number, arm: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3], args: number[] = []): KojoResolution => {
    const router = routerForEvent(charaNum, arm);
    return router.resolveEventKojoDetailed?.(charaNum, arm, state, rng, args) ?? {
      status: "not-authored", lines: router.resolveEventKojo(charaNum, arm, state, rng, args), effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  const spEventDetailed = (charaNum: number, subid: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3], args: number[] = []): KojoResolution => {
    const router = routerForSpEvent(charaNum, subid);
    return router.resolveSpEventKojoDetailed?.(charaNum, subid, state, rng, args) ?? {
      status: "not-authored", lines: router.resolveSpEventKojo(charaNum, subid, state, rng, args), effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  const encounterDetailed = (charaNum: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3]): KojoResolution => {
    const router = routerForEncounter(charaNum);
    return router.resolveEncounterKojoDetailed?.(charaNum, state, rng) ?? {
      status: "not-authored", lines: router.resolveEncounterKojo?.(charaNum, state, rng) ?? [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  const counterDetailed = (charaNum: number, action: number, state: Parameters<DialogueRouter["collect"]>[2], rng: Parameters<DialogueRouter["collect"]>[3]): KojoResolution => {
    const router = routerForCounter(charaNum, action);
    return router.resolveCounterKojoDetailed?.(charaNum, action, state, rng) ?? {
      status: "not-authored", lines: router.resolveCounterKojo?.(charaNum, action, state, rng) ?? [], effects: [], unsupportedPredicates: [], unsupportedEffects: [], diagnostics: [],
    };
  };
  const bindContinuation = (router: DialogueRouter, result: ReturnType<NonNullable<DialogueRouter["collectContinuation"]>>) => {
    if (result.continuationId) continuations.set(result.continuationId, router);
    return result;
  };
  return {
    collect(charaNum, commandNo, state, rng): KojoLine[] { return detailed(charaNum, commandNo, state, rng).lines; },
    collectDetailed: detailed,
    collectContinuation(charaNum, commandNo, state, rng) {
      const router = routerForCommand(charaNum, commandNo);
      const result = router.collectContinuation?.(charaNum, commandNo, state, rng) ?? {
        resolution: detailed(charaNum, commandNo, state, rng), pending: null,
      };
      return bindContinuation(router, result);
    },
    resumeContinuation(continuationId, value) {
      const router = continuations.get(continuationId);
      if (router) {
        const result = router.resumeContinuation?.(continuationId, value);
        if (!result?.continuationId) continuations.delete(continuationId);
        return result ?? {
          resolution: { status: "unsupported", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: ["missing VM continuation adapter"], diagnostics: [] },
          pending: null,
        };
      }
      return base.resumeContinuation?.(continuationId, value) ?? {
        resolution: { status: "unsupported", lines: [], effects: [], unsupportedPredicates: [], unsupportedEffects: ["missing continuation adapter"], diagnostics: [] },
        pending: null,
      };
    },
    cancelContinuation(continuationId) {
      const router = continuations.get(continuationId);
      continuations.delete(continuationId);
      if (router) router.cancelContinuation?.(continuationId);
      else base.cancelContinuation?.(continuationId);
    },
    resolveEventKojo(charaNum, arm, state, rng, args = []) {
      return eventDetailed(charaNum, arm, state, rng, args).lines;
    },
    resolveEventKojoDetailed: eventDetailed,
    resolveEventKojoContinuation(charaNum, arm, state, rng, args = []) {
      const router = routerForEvent(charaNum, arm);
      const result = router.resolveEventKojoContinuation?.(charaNum, arm, state, rng, args) ?? {
        resolution: eventDetailed(charaNum, arm, state, rng, [...args]), pending: null,
      };
      return bindContinuation(router, result);
    },
    resolveSpEventKojo(charaNum, subid, state, rng, args = []) {
      return spEventDetailed(charaNum, subid, state, rng, args).lines;
    },
    resolveSpEventKojoDetailed: spEventDetailed,
    resolveSpEventKojoContinuation(charaNum, subid, state, rng, args = []) {
      const router = routerForSpEvent(charaNum, subid);
      const result = router.resolveSpEventKojoContinuation?.(charaNum, subid, state, rng, args) ?? {
        resolution: spEventDetailed(charaNum, subid, state, rng, [...args]), pending: null,
      };
      return bindContinuation(router, result);
    },
    resolveEncounterKojo(charaNum, state, rng) {
      return encounterDetailed(charaNum, state, rng).lines;
    },
    resolveEncounterKojoDetailed: encounterDetailed,
    resolveEncounterKojoContinuation(charaNum, state, rng) {
      const router = routerForEncounter(charaNum);
      const result = router.resolveEncounterKojoContinuation?.(charaNum, state, rng) ?? {
        resolution: encounterDetailed(charaNum, state, rng), pending: null,
      };
      return bindContinuation(router, result);
    },
    resolveCounterKojo(charaNum, action, state, rng) {
      return counterDetailed(charaNum, action, state, rng).lines;
    },
    resolveCounterKojoDetailed: counterDetailed,
  };
}

/** Load any explicitly audited COMMAND shards. A missing or unsafe shard
 * leaves only that character on the established router; a loaded VM route
 * never falls through from gated/unsupported authored content to legacy. */
export async function enableKojoVmCommandOptIn(
  base: DialogueRouter,
  charaNums: readonly number[],
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  const loaded = await Promise.all([...new Set(charaNums)].map(async (charaNum) => [
    charaNum,
    await loader.loadProgram(charaNum),
  ] as const));
  const routers = new Map<number, KojoVmRouteEntry>();
  for (const [charaNum, shard] of loaded) {
    if (shard.status === "resolved") {
      routers.set(charaNum, {
        router: createKojoVmCommandDialogueRouter(shard.program),
        ...(shard.commandNos ? { commandNos: new Set(shard.commandNos) } : {}),
      });
    }
  }
  return routers.size === 0 ? base : createKojoVmMultiOptInRouter(base, routers);
}

/** Load the only audited browser-safe shard and overlay it on any platform's
 * existing router. A bad/missing asset deliberately leaves the established
 * router intact; once loaded, K59 authored COMMAND paths never fall through.
 */
export async function enableK59KojoVmCommandOptIn(
  base: DialogueRouter,
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  return enableKojoVmCommandOptIn(base, [59], loader);
}

/** Overlay only explicitly audited EVENT arms. Command routing remains on the
 * supplied base router, so enabling an event category never broadens a shard's
 * COMMAND coverage by accident. */
export async function enableKojoVmEventOptIn(
  base: DialogueRouter,
  eventArmsByChara: ReadonlyMap<number, readonly number[]>,
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  const loaded = await Promise.all([...eventArmsByChara.entries()].map(async ([charaNum, requestedArms]) => [
    charaNum,
    requestedArms,
    await loader.loadProgram(charaNum),
  ] as const));
  const routers = new Map<number, KojoVmRouteEntry>();
  for (const [charaNum, requestedArms, shard] of loaded) {
    if (shard.status !== "resolved") continue;
    const availableArms = new Set(shard.eventArms ?? []);
    const arms = requestedArms.filter((arm) => availableArms.has(arm));
    if (arms.length === 0) continue;
    routers.set(charaNum, {
      router: createKojoVmCommandDialogueRouter(shard.program),
      // An empty command set prevents this event-only overlay from claiming
      // any command route when it wraps a command opt-in router.
      commandNos: new Set(),
      eventArms: new Set(arms),
    });
  }
  return routers.size === 0 ? base : createKojoVmMultiOptInRouter(base, routers);
}

/** Overlay only explicitly audited SP_EVENT subids. This stays separate from
 * EVENT because their upstream dispatcher arms and caller lifecycles differ. */
export async function enableKojoVmSpEventOptIn(
  base: DialogueRouter,
  subidsByChara: ReadonlyMap<number, readonly number[]>,
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  const loaded = await Promise.all([...subidsByChara.entries()].map(async ([charaNum, requestedSubids]) => [
    charaNum,
    requestedSubids,
    await loader.loadProgram(charaNum),
  ] as const));
  const routers = new Map<number, KojoVmRouteEntry>();
  for (const [charaNum, requestedSubids, shard] of loaded) {
    if (shard.status !== "resolved") continue;
    const availableSubids = new Set(shard.spEventSubids ?? []);
    const subids = requestedSubids.filter((subid) => availableSubids.has(subid));
    if (subids.length === 0) continue;
    routers.set(charaNum, {
      router: createKojoVmCommandDialogueRouter(shard.program),
      commandNos: new Set(),
      spEventSubids: new Set(subids),
    });
  }
  return routers.size === 0 ? base : createKojoVmMultiOptInRouter(base, routers);
}

/** Overlay only explicitly audited first-meeting routes. ENCOUNTER has no
 * arm/subid: a selected character owns exactly one dispatcher route. */
export async function enableKojoVmEncounterOptIn(
  base: DialogueRouter,
  charaNums: readonly number[],
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  const loaded = await Promise.all([...new Set(charaNums)].map(async (charaNum) => [
    charaNum,
    await loader.loadProgram(charaNum),
  ] as const));
  const routers = new Map<number, KojoVmRouteEntry>();
  for (const [charaNum, shard] of loaded) {
    if (shard.status !== "resolved" || !shard.encounter) continue;
    routers.set(charaNum, {
      router: createKojoVmCommandDialogueRouter(shard.program),
      commandNos: new Set(),
      encounter: true,
    });
  }
  return routers.size === 0 ? base : createKojoVmMultiOptInRouter(base, routers);
}

/** Overlay only audited COUNTER actions. These use the original dedicated
 * counter dispatcher and stay isolated from COMMAND/EVENT category opt-ins. */
export async function enableKojoVmCounterOptIn(
  base: DialogueRouter,
  actionsByChara: ReadonlyMap<number, readonly number[]>,
  loader: Pick<BrowserKojoVmLoader, "loadProgram"> = new BrowserKojoVmLoader(),
): Promise<DialogueRouter> {
  const loaded = await Promise.all([...actionsByChara.entries()].map(async ([charaNum, requestedActions]) => [
    charaNum,
    requestedActions,
    await loader.loadProgram(charaNum),
  ] as const));
  const routers = new Map<number, KojoVmRouteEntry>();
  for (const [charaNum, requestedActions, shard] of loaded) {
    if (shard.status !== "resolved") continue;
    const availableActions = new Set(shard.counterActions ?? []);
    const actions = requestedActions.filter((action) => availableActions.has(action));
    if (actions.length === 0) continue;
    routers.set(charaNum, {
      router: createKojoVmCommandDialogueRouter(shard.program),
      commandNos: new Set(),
      counterActions: new Set(actions),
    });
  }
  return routers.size === 0 ? base : createKojoVmMultiOptInRouter(base, routers);
}
