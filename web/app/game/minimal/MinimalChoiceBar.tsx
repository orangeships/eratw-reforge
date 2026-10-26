import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../../modernization/schemas/types.js";
import type { DialogueChoiceSession, DialogueSession } from "../../state/dialogue-session.js";
import { dialogueAccompanyInvitations } from "../../../../modernization/runtime/ai-state/dialogue-action.js";

export interface MinimalChoiceBarProps {
  /** dialogueQueue[0]?.choice — the kojo branch pause (null = no pause). */
  pendingChoice: DialogueChoiceSession | null;
  /** The active session; its transcript tail may carry an AI branch pause. */
  liveSession: DialogueSession | null;
  state: Readonly<GameState>;
  /** Resume the paused kojo choice with the picked option index (or the raw
   *  continuation input value for number/string input pauses). */
  onPickChoice: (value: number | string) => void;
  /** Present the chosen AI-branch lines in the text stream (presentation-only). */
  onAppendAiBranch: (lines: ObservationEvent[], choiceLabel?: string) => void | Promise<boolean>;
}

/**
 * Inline replacement for the InteractionBox choice pause: option buttons /
 * continuation input / AI branch options rendered as a bar above the command
 * rows, so the minimal mode never needs the kojo popup.
 */
export default function MinimalChoiceBar(props: MinimalChoiceBarProps) {
  const { pendingChoice, liveSession } = props;
  const [selectedAiChoice, setSelectedAiChoice] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [branchPending, setBranchPending] = useState(false);
  const branchEpoch = useRef(0);

  useEffect(() => {
    setSelectedAiChoice(null);
    setInputValue("");
    setBranchPending(false);
    branchEpoch.current++;
  }, [liveSession?.id]);

  const transcript = liveSession?.transcript ?? [];
  const aiChoiceLine = [...transcript].reverse().find(
    (line): line is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> =>
      line.kind === "DIALOGUE_LINE" && line.origin === "ai" && line.aiChoice !== undefined,
  );
  const hasAiChoice = aiChoiceLine?.aiChoice !== undefined && selectedAiChoice === null
    && dialogueAccompanyInvitations(props.state).length === 0;
  const hasPendingOptions = (pendingChoice?.options.length ?? 0) > 0;
  const inputMode = pendingChoice?.continuationInputMode;

  if (!hasPendingOptions && !inputMode && !hasAiChoice) return null;

  const pickAiOption = (index: number): void => {
    const option = aiChoiceLine?.aiChoice?.options[index];
    if (!option) return;
    const branchLines: ObservationEvent[] = option.lines.map((line) => ({
      kind: "DIALOGUE_LINE",
      timestamp: aiChoiceLine?.timestamp ?? Date.now(),
      charaNum: aiChoiceLine?.charaNum ?? 0,
      text: line.text,
      form: line.form,
      origin: "ai",
    }));
    const epoch = branchEpoch.current;
    const result = props.onAppendAiBranch(branchLines, option.label);
    if (result instanceof Promise) {
      setBranchPending(true);
      void result.then(ok => {
        if (epoch !== branchEpoch.current) return;
        setBranchPending(false);
        if (ok) setSelectedAiChoice(index);
      }).catch(() => { if (epoch === branchEpoch.current) setBranchPending(false); });
    } else setSelectedAiChoice(index);
  };

  const submitInput = (): void => {
    if (!inputMode) return;
    const value = inputMode === "number" ? Number(inputValue) : inputValue;
    if (inputMode !== "number" || Number.isFinite(value)) props.onPickChoice(value);
  };

  return (
    <div className="minimal-choice-bar" data-testid="minimal-choice-bar" role="group" aria-label="选择">
      {inputMode ? (
        <>
          <input
            className="minimal-choice-bar__input"
            data-testid="minimal-choice-input"
            type={inputMode === "number" ? "number" : "text"}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitInput();
            }}
            aria-label={inputMode === "number" ? "数值输入" : "文本输入"}
          />
          <button
            type="button"
            className="minimal-choice-bar__submit"
            data-testid="minimal-choice-submit"
            onClick={submitInput}
          >
            [确定]
          </button>
        </>
      ) : hasAiChoice ? (
        <div className="minimal-choice-bar__ai" data-testid="minimal-ai-choice">
          {aiChoiceLine!.aiChoice!.options.map((option, index) => (
            <button
              key={index}
              type="button"
              className="minimal-choice-bar__option"
              data-testid={`minimal-ai-choice-${index}`}
              disabled={branchPending}
              onClick={() => pickAiOption(index)}
            >
              [{index + 1}] {option.label}
            </button>
          ))}
        </div>
      ) : (
        pendingChoice!.options.map((option, index) => (
          <button
            key={index}
            type="button"
            className="minimal-choice-bar__option"
            data-testid={`minimal-choice-${index}`}
            onClick={() => props.onPickChoice(index)}
          >
            [{index + 1}] {option.label}
          </button>
        ))
      )}
    </div>
  );
}
