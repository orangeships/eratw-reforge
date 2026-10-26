import { useState } from "react";

export interface MinimalAiChatBarProps {
  /** Draft input visible (opened from the 对话（AI） command). */
  open: boolean;
  /** The realtime chat start action gates on target/AI availability. */
  aiChatAvailable: boolean;
  /** Display name of the chat partner (callName). */
  targetName?: string;
  /** Start the AI chat; returns true when the session started. */
  onSubmit: (semantic: string) => boolean;
  /** Close the draft without sending. */
  onClose: () => void;
}

/**
 * Bottom inline input bar replacing the InteractionBox AI chat surface in
 * minimal mode. Replies stream into the text stream via the session
 * transcript; startAiChatAction blocks while the dialogue queue is busy.
 */
export default function MinimalAiChatBar(props: MinimalAiChatBarProps) {
  const [value, setValue] = useState("");
  const [submitError, setSubmitError] = useState("");

  if (!props.open) return null;

  const submit = (): void => {
    const text = value.trim();
    if (text.length === 0) return;
    if (props.onSubmit(text)) {
      setValue("");
      setSubmitError("");
    } else {
      setSubmitError("当前对话尚未结束，或 AI 连接不可用，请稍后重试。");
    }
  };

  return (
    <div className="minimal-ai-bar" data-testid="minimal-ai-chat-bar">
      <textarea
        className="minimal-ai-bar__input"
        data-testid="minimal-ai-chat-input"
        maxLength={1000}
        rows={1}
        value={value}
        autoFocus
        placeholder={props.targetName ? `与 ${props.targetName} 对话…` : "AI 对话…"}
        onChange={(event) => {
          setValue(event.target.value);
          setSubmitError("");
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          submit();
        }}
        aria-label={props.targetName ? `与 ${props.targetName} 对话` : "AI 对话"}
      />
      <button
        type="button"
        className="minimal-ai-bar__send"
        data-testid="minimal-ai-chat-send"
        disabled={!props.aiChatAvailable || value.trim().length === 0}
        onClick={submit}
      >
        [发送]
      </button>
      <button
        type="button"
        className="minimal-ai-bar__close"
        data-testid="minimal-ai-chat-close"
        onClick={() => {
          setSubmitError("");
          props.onClose();
        }}
      >
        [收起]
      </button>
      {submitError && <span className="minimal-ai-bar__error" role="alert">{submitError}</span>}
    </div>
  );
}
