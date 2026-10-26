import { useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import InteractionBox, { type InteractionBoxProps } from "./InteractionBox.js";
import { formatGameEvent } from "./event-format.js";
import { kojoColor } from "./kojo-colors.js";
import { useSceneDialogueScroll } from "./use-scene-dialogue-scroll.js";
import "./scene-dialogue.css";

interface Props {
  state: GameState;
  live: InteractionBoxProps | null;
  canComplete: boolean;
  onSkipReply?: () => void;
}

/** The full transcript stays until clicked. Requests and choices retain
 * their existing queue owner, independently of this presentation. */
export default function SceneDialogueOverlay({ state, live, canComplete, onSkipReply }: Props) {
  const [finished, setFinished] = useState<ReadonlyArray<ObservationEvent>>([]);
  const scroll = useSceneDialogueScroll(live?.events ?? finished, live?.sessionId);

  const hasLiveText = live?.events.some(event => event.kind === "DIALOGUE_LINE" || event.kind === "NARRATION") ?? false;
  const showAfterimage = finished.length > 0 && (!live || !hasLiveText);
  if (!live && finished.length === 0) return null;
  return (
    <section className="scene-dialogue"
      data-testid="scene-dialogue" data-phase={live ? "streaming" : "holding"}
      aria-label="场景对话">
      <div className="scene-dialogue__transcript" ref={scroll.ref} onScroll={scroll.onScroll}
        data-testid="scene-dialogue-scroll" title="滚轮回看对话">
        <div className="scene-dialogue__content">
          {showAfterimage && <div className="scene-dialogue__afterimage" data-testid="scene-dialogue-afterimage">
            <div role="button" tabIndex={0} aria-label="收起对话" title="点击收起；滚轮回看"
              onClick={() => setFinished([])} onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFinished([]); }
              }}>
              {finished.map((event, index) => <p key={index} className="scene-dialogue__line" data-scene-dialogue-line
                style={{ color: event.kind === "DIALOGUE_LINE" ? kojoColor(event.charaNum) : undefined }}>
                {event.kind === "DIALOGUE_LINE" && <span className="scene-dialogue__name">
                  {state.charas[event.charaNum]?.callName ?? (event.charaNum === 0 ? state.master.callName ?? "你" : `角色${event.charaNum}`)}
                </span>}
                {formatGameEvent(event, state)}
              </p>)}
            </div>
          </div>}
          {live && <InteractionBox key={live.sessionId} {...live} presentation="scene" onReadComplete={canComplete ? events => {
            setFinished(events);
            live.onExit();
          } : undefined} />}
        </div>
      </div>
      {onSkipReply && <button type="button" className="scene-dialogue__skip" onClick={onSkipReply}>[跳过回复]</button>}
    </section>
  );
}
