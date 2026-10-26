import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { dialogueAccompanyInvitations, hasDialogueAccompanyPermit } from "../../../modernization/runtime/ai-state/dialogue-action.js";

export interface DialogueAccompanyChoicesProps {
  state: Readonly<GameState>;
  target?: number;
  pending?: boolean;
  onRespond: (target: number, requestId: string, response: "accept" | "reject" | "cancel") => boolean;
}

/** Mechanical choices share the dialogue surface; no classifier notices enter the prose. */
export default function DialogueAccompanyChoices({ state, target, pending, onRespond }: DialogueAccompanyChoicesProps) {
  if (pending) return null;
  const invitation = dialogueAccompanyInvitations(state).find(value => target === undefined || value.target === target);
  const offer = target === undefined ? undefined : state.aiDialogueAccompany?.[target];
  const decision = invitation ?? (offer && hasDialogueAccompanyPermit(state, target!) ? offer : undefined);
  if (!decision) return null;
  const respond = (response: "accept" | "reject" | "cancel") => onRespond(decision.target, decision.requestId, response);
  return (
    <div className="dialogue-accompany-choices" data-testid="dialogue-accompany-choices" role="group" aria-label="同行邀约">
      {invitation ? <>
        <button type="button" className="interaction-box__btn" onClick={() => respond("accept")}>[一起走吧]</button>
        <button type="button" className="interaction-box__btn" onClick={() => respond("reject")}>[这次不了]</button>
      </> : <button type="button" className="interaction-box__btn" onClick={() => respond("cancel")}>[取消同行约定]</button>}
    </div>
  );
}
