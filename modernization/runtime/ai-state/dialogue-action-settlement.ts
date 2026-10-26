import { cloneGameState, type GameState } from "../state/game-state.js";
import { CFLAG_ID } from "../state/settlement.js";
import { applyIntent } from "../intent/index.js";
import { acceptDialogueActionProposal, respondDialogueAccompany, type DialogueActionInput } from "./dialogue-action.js";

/** Closed intents reuse the ordinary command/clock/scheduler/settlement path. */
export function settleDialogueAction(state: GameState, input: DialogueActionInput, proposal: unknown) {
  const candidate = cloneGameState(state);
  const result = acceptDialogueActionProposal(candidate, input, proposal);
  if (result !== "stop-requested") return { state: candidate, result };
  const released = applyIntent(candidate, { kind: "ISSUE_COMMAND", actor: state.master.charaNum, target: input.target, commandNo: 351 });
  if (released.commandOutcome !== "ok" || released.pendingKojoChoice
    || (released.state.charas[input.target]?.state.CFLAG[CFLAG_ID.同行] ?? 0) > 0) return { state, result: "blocked" };
  return { state: released.state, result: "accepted" };
}

/** Only a fresh player click can accept an NPC's invitation. No implicit acceptance. */
export function settleDialogueAccompanyResponse(state: GameState, target: number, requestId: string,
  response: "accept" | "reject" | "cancel") {
  const candidate = cloneGameState(state);
  if (!respondDialogueAccompany(candidate, target, requestId, response)) return null;
  if (response !== "accept") return candidate;
  const accompanied = applyIntent(candidate, { kind: "ISSUE_COMMAND", actor: state.master.charaNum, target, commandNo: 351 });
  return accompanied.commandOutcome === "ok" && !accompanied.pendingKojoChoice
    && (accompanied.state.charas[target]?.state.CFLAG[CFLAG_ID.同行] ?? 0) > 0 ? accompanied.state : null;
}
