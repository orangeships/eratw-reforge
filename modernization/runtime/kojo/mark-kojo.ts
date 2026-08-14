import type { GameState } from "../state/game-state.js";
import {
  TFLAG_ID,
  createTurnContext,
  setTflag,
} from "../state/tflag.js";

export type RebellionMarkLevel = 1 | 2 | 3;
export type MarkKojoId = 0 | 1 | 2 | 3 | 5;

const MARK_ACQUISITION_TFLAG: Readonly<Record<MarkKojoId, number>> = {
  0: 22,
  1: 23,
  2: 24,
  3: TFLAG_ID.反発刻印取得,
  5: 20,
};

export function withMarkKojoContext(
  state: Readonly<GameState>,
  markId: MarkKojoId,
  level: RebellionMarkLevel,
): Readonly<GameState> {
  const base = state.turnContext ?? createTurnContext();
  const next = {
    ...state,
    tflagStore: { ...state.tflagStore },
    turnContext: {
      ...base,
      tflags: { ...base.tflags },
      result: [...base.result],
      locals: [...base.locals],
    },
  } as GameState;
  // Keep the canonical field reference explicit so the generated state-field
  // audit records this bounded overlay as a producer. The other MARK message
  // inputs are upstream raw TFLAG slots without canonical registry entries.
  if (markId === 3) setTflag(next, TFLAG_ID.反発刻印取得, level);
  else setTflag(next, MARK_ACQUISITION_TFLAG[markId], level);
  return next;
}

/**
 * Bind the upstream `TFLAG:反発刻印取得` input for one MARKCNG resolution
 * without mutating the authoritative state or extending its turn lifetime.
 */
export function withRebellionMarkContext(
  state: Readonly<GameState>,
  level: RebellionMarkLevel,
): Readonly<GameState> {
  return withMarkKojoContext(state, 3, level);
}
