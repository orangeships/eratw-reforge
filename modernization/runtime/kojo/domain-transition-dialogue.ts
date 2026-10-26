import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import {
  type DomainTransition,
  TRACKED_TALENT_ACQUISITION_IDS,
} from "../state/domain-transition.js";
import type { GameState } from "../state/game-state.js";
import { TALENT_ID } from "../state/settlement.js";
import { applyKojoEffects } from "./effects.js";
import type { DialogueRouter } from "./types.js";

export interface DomainTransitionDialogueDeps {
  readonly router: DialogueRouter;
  readonly rng: Rng;
  readonly now: () => number;
}

export interface DomainTransitionDialogueResult {
  readonly state: GameState;
  readonly events: readonly ObservationEvent[];
}

function transitionCallName(state: Readonly<GameState>, charaNum: number): string {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  return slot?.callName?.trim() || (charaNum === 0 ? "主人公" : `角色${charaNum}`);
}

const MARK_LABELS = {
  0: "苦痛",
  1: "快乐",
  2: "顺从",
  3: "反感",
  5: "时奸",
} as const;

/**
 * Curated narration for relationship-defining TALENT gains. The original game
 * reacts to these moments through authored PALAMCNG/command kojo, so this is a
 * fallback only: when the character has no authored reaction for the same
 * command, the player still gets deterministic feedback that the bond changed.
 * Non-listed talents stay silent (the transition itself is still observable
 * for future agent/AI consumption). A small allowlist avoids narrating every
 * minor trait gain, which would be noise the original never produced.
 */
const TALENT_ACQUIRED_NARRATION: Readonly<Record<number, string>> = {
  [TALENT_ID.恋慕]: "对主角萌生了恋慕之情……",
  [TALENT_ID.思慕]: "对主角生出了思慕之心……",
  [TALENT_ID.恋人]: "与主角成为了恋人。",
  [TALENT_ID.愛欲]: "对主角的愛欲觉醒了……",
  [TALENT_ID.炮友]: "与主角成为了炮友。",
};

/**
 * Map one named domain transition to its authored dialogue category.
 * Authored personal dialogue wins whenever it yields valid lines. If MARKCNG
 * is missing, gated, or rejected by the strict resolver, emit the original
 * shared-message style narration instead of silently swallowing the event.
 */
export function resolveDomainTransitionDialogue(
  state: GameState,
  transition: DomainTransition,
  deps: DomainTransitionDialogueDeps,
): DomainTransitionDialogueResult {
  if (transition.kind === "anger-entered") {
    return {
      state,
      events: [
        {
          kind: "NARRATION",
          timestamp: deps.now(),
          text: `${transitionCallName(state, transition.charaNum)}被彻底激怒了。`,
        },
      ],
    };
  }

  if (transition.kind === "talent-acquired") {
    const label = TRACKED_TALENT_ACQUISITION_IDS.has(transition.talentId)
      ? TALENT_ACQUIRED_NARRATION[transition.talentId]
      : undefined;
    if (!label) return { state, events: [] };
    return {
      state,
      events: [
        {
          kind: "NARRATION",
          timestamp: deps.now(),
          text: `${transitionCallName(state, transition.charaNum)}${label}`,
        },
      ],
    };
  }

  if (
    transition.kind !== "rebellion-mark-acquired" &&
    transition.kind !== "mark-acquired"
  ) {
    return { state, events: [] };
  }
  const markId = transition.kind === "rebellion-mark-acquired"
    ? 3
    : transition.markId;

  // Modern authored override supplied for Reisen (chara 52). This is not an
  // upstream claim; keep it at the presentation route so SOURCE remains
  // character-agnostic and other residents retain their authored/common text.
  if (transition.kind === "rebellion-mark-acquired" && transition.charaNum === 52) {
    return {
      state,
      events: [{
        kind: "DIALOGUE_LINE",
        timestamp: deps.now(),
        charaNum: transition.charaNum,
        text: "把铃仙弄哭了.....",
        form: "PRINTFORML",
      }],
    };
  }

  const detailed = deps.router.resolveMarkKojoDetailed?.(
    transition.charaNum,
    transition.level,
    state,
    deps.rng,
    markId,
  );
  const lines = detailed
    ? detailed.status === "resolved" || detailed.status === "partial"
      ? detailed.lines
      : []
    : deps.router.resolveMarkKojo?.(
        transition.charaNum,
        transition.level,
        state,
        deps.rng,
        markId,
      ) ?? [];
  const next =
    detailed?.status === "resolved" && detailed.effects.length > 0
      ? applyKojoEffects(state, detailed.effects)
      : state;
  if (lines.length === 0) {
    return {
      state: next,
      events: [
        {
          kind: "NARRATION",
          timestamp: deps.now(),
          text: `${transitionCallName(state, transition.charaNum)}获得了${MARK_LABELS[markId]}刻印LV${transition.level}。`,
        },
      ],
    };
  }
  return {
    state: next,
    events: lines.map((line) => ({
      kind: "DIALOGUE_LINE",
      timestamp: deps.now(),
      charaNum: transition.charaNum,
      text: line.text,
      form: line.form,
    })),
  };
}
