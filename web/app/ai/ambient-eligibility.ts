import type { GameState } from "../../../modernization/runtime/state/index.js";
import { CFLAG_ID } from "../../../modernization/runtime/state/settlement.js";
import { deriveRelationshipAuthority } from "../../../modernization/runtime/state/attitude.js";
import { checkHehai } from "../../../modernization/runtime/world/detection.js";
import { isTimeStopped } from "../../../modernization/runtime/command/h-mode.js";
import type { AmbientInitiativeCandidate } from "../../../modernization/runtime/world/ambient-initiative.js";

/** Pure projection of characters who may autonomously appear in L1-Ambient. */
export function ambientEligibleCandidates(
  state: Readonly<GameState>,
  characterEnabled: (participantId: number) => boolean,
): AmbientInitiativeCandidate[] {
  if (isTimeStopped(state)) return [];
  return Object.values(state.charas).flatMap((slot) => {
    if (slot.charaNum <= 0 || slot.location !== state.master.location) return [];
    if (!characterEnabled(slot.charaNum)) return [];
    if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return [];
    if ((slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) return [];
    if (checkHehai(slot, state as GameState) === 3) return [];
    const authority = deriveRelationshipAuthority(slot, state.master, state);
    const affinity = Math.max(
      0,
      Math.min(1, (authority.favor / 1500 + authority.trust / 250 + authority.intimacy / 10) / 3),
    );
    return [{ participantId: slot.charaNum, playerAffinity: affinity }];
  });
}
