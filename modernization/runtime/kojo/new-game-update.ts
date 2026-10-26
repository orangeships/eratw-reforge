import { createRng } from "../command/rng.js";
import type { GameState } from "../state/index.js";
import { applyKojoEffects } from "./effects.js";
import type {
  DialogueRouter,
  InteractiveKojoResolution,
  KojoLine,
  PendingKojoChoice,
} from "./types.js";

export interface NewGameKojoUpdateCandidate {
  charaNum: number;
  callName: string;
}

export type NewGameKojoUpdateStatus =
  | "pending"
  | "applied"
  | "no-change"
  | "not-authored"
  | "gated"
  | "unsupported";

export interface NewGameKojoUpdateResult {
  state: GameState;
  status: NewGameKojoUpdateStatus;
  lines: KojoLine[];
  pending: PendingKojoChoice | null;
  diagnostics: readonly string[];
  committedEffects: number;
}

/** List only active, selected character packs that own an UPDATE_K body. */
export function listNewGameKojoUpdates(
  state: Readonly<GameState>,
  router: DialogueRouter,
): NewGameKojoUpdateCandidate[] {
  if (!router.hasUpdateKojo) return [];
  return Object.values(state.charas)
    .filter((slot) => router.hasUpdateKojo!(slot.charaNum, state))
    .map((slot) => ({
      charaNum: slot.charaNum,
      callName: slot.callName || `角色${slot.charaNum}`,
    }))
    .sort((left, right) => left.charaNum - right.charaNum);
}

function diagnosticsOf(resolution: InteractiveKojoResolution): string[] {
  return [
    ...resolution.unsupportedPredicates.map((item) => `条件：${item}`),
    ...resolution.unsupportedEffects.map((item) => `效果：${item}`),
    ...resolution.diagnostics.map((item) => item.detail),
  ];
}

/**
 * Replay one opening UPDATE_K with the supplied UI-choice indexes.
 * Effects stay staged while a choice is pending and are committed only after
 * the complete path resolves successfully. Unsupported/partial paths fail
 * closed and return the original state object.
 */
export function resolveNewGameKojoUpdate(
  state: Readonly<GameState>,
  router: DialogueRouter,
  charaNum: number,
  choices: readonly number[] = [],
): NewGameKojoUpdateResult {
  if (!router.resolveUpdateKojoInteractive) {
    return {
      state: state as GameState,
      status: "unsupported",
      lines: [],
      pending: null,
      diagnostics: ["当前口上来源不支持角色 UPDATE_K 解析。"],
      committedEffects: 0,
    };
  }

  // The resolver replays from the root after every pick. A stable per-character
  // seed keeps every replay on the same authored random branches.
  const rng = createRng((0x45524154 ^ Math.imul(charaNum, 0x9e3779b1)) | 0);
  // DialogueRouter may be a stateful adapter (notably KojoCache). Calling a
  // detached method loses its `this` receiver and throws before the UI can
  // receive a fail-closed result.
  const resolution = router.resolveUpdateKojoInteractive(charaNum, state, rng, choices);
  const diagnostics = diagnosticsOf(resolution);

  if (
    resolution.status === "unsupported" ||
    resolution.status === "partial" ||
    resolution.unsupportedPredicates.length > 0 ||
    resolution.unsupportedEffects.length > 0
  ) {
    return {
      state: state as GameState,
      status: "unsupported",
      lines: [],
      pending: null,
      diagnostics,
      committedEffects: 0,
    };
  }

  if (resolution.pending) {
    return {
      state: state as GameState,
      status: "pending",
      lines: resolution.lines,
      pending: resolution.pending,
      diagnostics,
      committedEffects: 0,
    };
  }

  if (resolution.status === "not-authored" || resolution.status === "gated") {
    return {
      state: state as GameState,
      status: resolution.status,
      lines: [],
      pending: null,
      diagnostics,
      committedEffects: 0,
    };
  }

  const nextState = resolution.effects.length > 0
    ? applyKojoEffects(state, resolution.effects)
    : state as GameState;
  return {
    state: nextState,
    status: resolution.effects.length > 0 ? "applied" : "no-change",
    lines: resolution.lines,
    pending: null,
    diagnostics,
    committedEffects: resolution.effects.length,
  };
}
