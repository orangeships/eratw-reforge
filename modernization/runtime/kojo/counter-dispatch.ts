/**
 * EVENT_COUNTER dialogue dispatch — shared narration + personal kojo.
 *
 * Shared layer: the generated `shared-counter.native-dialogue.json` asset
 * (upstream `COUNTER_MESSAGE.ERB` @EVENT_COUNTER_MESSAGE<n> bodies, one per
 * counter action, personality-adverb branches intact). Personal layer: the
 * character's `M_KOJO…_MESSAGE_COUNTER` route via the router's
 * `resolveCounterKojoDetailed` (TCVAR:20 contract, `kojo/types.ts:1099`).
 *
 * Execution rules mirror the pack path (`generated-assets.ts` counter
 * branch): the dispatcher-local `有主语` named local rides the VM frame, the
 * DATUI prelude gate keeps unmodelled undress subjects fail-closed, and a
 * personal `unsupported` suppresses the character's own lines without
 * dropping the already-rendered shared narration.
 */

import { resolveKojoFunctionDetailed } from "./static-router.js";
import { createGameStateKojoHostRegistry } from "./host-registry.js";
import { applyKojoEffects } from "./effects.js";
import type { GameState } from "../state/game-state.js";
import type { KojoFunctionResolution, KojoNode, KojoResolutionStatus, KojoStagedEffect } from "./types.js";
import type { Rng } from "../command/types.js";
import {
  counterUndressPrelude,
  inspectCounterUndressMarkers,
} from "../command/counter/counter-undress.js";

export interface SharedCounterDialogueAssets {
  readonly sourceActionCount: number;
  readonly byAction: Readonly<Record<string, KojoNode>>;
}

function unsupportedCounterDatuiPrelude(action: number, detail: string): KojoFunctionResolution {
  const diagnostic = `shared COUNTER:${action} cannot resolve DATUI_MESSAGE prelude: ${detail}`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [diagnostic],
    diagnostics: [{ code: "unsupported-effect", detail: diagnostic }],
    returnValue: 0,
    resultSlots: {},
  };
}

/** Render options for the shared body's `%CALLNAME%` tokens. */
export interface SharedCounterRenderOptions {
  targetName?: string;
  masterName?: string;
}

/**
 * Shared + personal composition used by the native-pack path. Kept in parity
 * with the pack branch of `resolveGeneratedAsset` (shared prologue → apply
 * shared effects → personal body). `collectCounterDialogue` is the two-pass
 * variant the resolver path uses.
 */
export function composeSharedCounterResolution(
  state: Readonly<GameState>,
  charaNum: number,
  action: number,
  shared: KojoNode,
  resolvePersonal: (state: Readonly<GameState>) => KojoFunctionResolution,
  rng: Rng,
  render: SharedCounterRenderOptions = {},
): KojoFunctionResolution {
  const inspection = inspectCounterUndressMarkers(state, charaNum, action);
  if (!inspection.ok) return unsupportedCounterDatuiPrelude(action, inspection.detail);
  const prelude = counterUndressPrelude(state, charaNum, action, render);
  const sharedResult = resolveKojoFunctionDetailed(shared, charaNum, state, rng, [], {
    hostRegistry: createGameStateKojoHostRegistry({ state }),
    vm: { locals: [], result: [], namedLocals: { 有主语: 0 } },
    targetName: render.targetName,
    masterName: render.masterName,
  });
  if (sharedResult.status === "unsupported") return sharedResult;
  const personal = resolvePersonal(applyKojoEffects(state, sharedResult.effects));
  if (personal.status === "unsupported") return personal;
  return {
    status: prelude.length > 0 || sharedResult.status === "resolved" || personal.status === "resolved" ? "resolved" : "gated",
    lines: [
      ...prelude.map((text) => ({ form: "PRINTFORML" as const, text, line: 0 })),
      ...sharedResult.lines,
      ...personal.lines,
    ],
    effects: [...sharedResult.effects, ...personal.effects],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
    returnValue: personal.returnValue,
    resultSlots: personal.resultSlots,
  };
}

/** Structural subset accepted for the personal pass — routers return
 * KojoFunctionResolution (KojoResolution + returnValue/resultSlots); the
 * resolver fallback only needs status/lines/effects. */
export type PersonalResolution = Pick<KojoFunctionResolution, "status" | "lines" | "effects">
  & Partial<Pick<KojoFunctionResolution, "unsupportedPredicates" | "unsupportedEffects" | "diagnostics">>;

/** Outcome of one counter dialogue dispatch. */
export interface CounterDialogueResult {
  /** Personal route status, or shared unsupported when personal was skipped. */
  readonly status: KojoResolutionStatus;
  /** Shared narration lines (shared body's normalized PRINTL flow). */
  readonly narration: string[];
  /** Personal kojo lines — mapped to DIALOGUE_LINE by the caller. */
  readonly personal: ReadonlyArray<{ text: string; form: string }>;
  /** Staged effects from both passes, unapplied. */
  readonly effects: readonly KojoStagedEffect[];
  /** Whether either layer produced visible text. */
  readonly resolved: boolean;
  /** Structured personal/shared route diagnostics for development tooling. */
  readonly diagnostics: readonly string[];
}

const silentResult: CounterDialogueResult = {
  status: "not-authored",
  narration: [],
  personal: [],
  effects: [],
  resolved: false,
  diagnostics: [],
};

/**
 * Dispatch one counter action's dialogue. The shared body runs first (its
 * narration is kept even when the personal route is not authored — the
 * character's own reaction simply stays silent, mirroring upstream where
 * `KOJO_MESSAGE_SEND("COUNTER")` branches on the chara file). A personal
 * `unsupported` suppresses only the personal lines. A missing shared node
 * keeps the personal route alive — personal counter routes stand on their
 * own for characters without shared coverage.
 */
export function collectCounterDialogue(
  state: Readonly<GameState>,
  charaNum: number,
  action: number,
  resolvePersonal: (state: Readonly<GameState>) => PersonalResolution,
  rng: Rng,
  sharedAssets?: SharedCounterDialogueAssets,
  render: SharedCounterRenderOptions = {},
): CounterDialogueResult {
  let narration: string[] = [];
  let effects: KojoStagedEffect[] = [];
  let diagnostics: string[] = [];
  let workingState: Readonly<GameState> = state;

  const sharedNode = sharedAssets?.byAction[String(action)];
  const inspection = inspectCounterUndressMarkers(state, charaNum, action);
  if (!inspection.ok) {
    const unsupported = unsupportedCounterDatuiPrelude(action, inspection.detail);
    return {
      ...silentResult,
      status: "unsupported",
      diagnostics: [
        ...unsupported.unsupportedPredicates,
        ...unsupported.unsupportedEffects,
        ...unsupported.diagnostics.map((entry) => entry.detail),
      ],
    };
  }
  narration = counterUndressPrelude(state, charaNum, action, render);
  if (sharedNode) {
    const shared = resolveKojoFunctionDetailed(sharedNode, charaNum, state, rng, [], {
      hostRegistry: createGameStateKojoHostRegistry({ state }),
      vm: { locals: [], result: [], namedLocals: { 有主语: 0 } },
      targetName: render.targetName,
      masterName: render.masterName,
    });
    if (shared.status === "unsupported") {
      return {
        ...silentResult,
        status: "unsupported",
        narration,
        resolved: narration.length > 0,
        diagnostics: [
          ...shared.unsupportedPredicates,
          ...shared.unsupportedEffects,
          ...shared.diagnostics.map((entry) => entry.detail),
        ],
      };
    }
    diagnostics.push(...shared.unsupportedPredicates, ...shared.unsupportedEffects, ...shared.diagnostics.map((entry) => entry.detail));
    narration = [
      ...narration,
      ...shared.lines.map((line) => line.text).filter((text) => text.trim()),
    ];
    effects = [...shared.effects];
    workingState = applyKojoEffects(state, shared.effects);
  }

  const personal = resolvePersonal(workingState);
  if (personal.status === "unsupported") {
    return {
      status: "unsupported",
      narration,
      personal: [],
      effects,
      resolved: narration.length > 0,
      diagnostics: [
        ...diagnostics,
        ...(personal.unsupportedPredicates ?? []),
        ...(personal.unsupportedEffects ?? []),
        ...(personal.diagnostics ?? []).map((entry) => entry.detail),
      ],
    };
  }
  return {
    status: personal.status,
    narration,
    personal: personal.lines.map((line) => ({ text: line.text, form: line.form })),
    effects: [...effects, ...personal.effects],
    resolved: narration.length > 0 || personal.lines.length > 0,
    diagnostics: [
      ...diagnostics,
      ...(personal.unsupportedPredicates ?? []),
      ...(personal.unsupportedEffects ?? []),
      ...(personal.diagnostics ?? []).map((entry) => entry.detail),
    ],
  };
}
