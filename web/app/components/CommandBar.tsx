import { useState, type FormEvent } from "react";
import type { AgentIntent } from "../../../modernization/schemas/types.js";
import { validateIntent } from "../../../modernization/schemas/validator.js";

/**
 * Phase 4 — CommandBar.
 *
 * Props-driven text input + submit button that parses a small
 * command vocabulary into an `AgentIntent` and hands it to the
 * parent via `onSubmit`. Phase 4 scope:
 *
 *   - Empty input or "noop" (case-insensitive)
 *       -> { kind: "NOOP", reason: "user typed noop" }
 *   - "talk"
 *       -> { kind: "ISSUE_COMMAND", actor: 0, commandNo: 300 }
 *          (300 = "会話" placeholder until Phase 5 CommandResolver
 *           maps real commandNo values)
 *   - Anything else
 *       -> inline error, do NOT call onSubmit.
 *
 * Every produced intent passes through `validateIntent` before
 * being handed to `onSubmit`; validator failures are surfaced as
 * inline errors with the validator's reason text.
 *
 * No store reads. No IPC. Phase 4D wires this up to the store.
 */

export interface CommandBarProps {
  onSubmit: (intent: AgentIntent) => void;
  disabled?: boolean;
}

const TALK_COMMAND_NO = 300;

export default function CommandBar({ onSubmit, disabled }: CommandBarProps) {
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (disabled) return;

    const raw = value.trim();
    const lowered = raw.toLowerCase();

    // Empty input is treated as a noop (per spec) so that hitting
    // Enter on a freshly-focused input doesn't surface an error.
    if (raw === "" || lowered === "noop") {
      const intent: AgentIntent = { kind: "NOOP", reason: "user typed noop" };
      const validation = validateIntent(intent);
      if (!validation.ok) {
        setError(validation.reason);
        return;
      }
      onSubmit(intent);
      setValue("");
      setError(null);
      return;
    }

    if (lowered === "talk") {
      const intent: AgentIntent = {
        kind: "ISSUE_COMMAND",
        actor: 0,
        commandNo: TALK_COMMAND_NO,
      };
      const validation = validateIntent(intent);
      if (!validation.ok) {
        setError(validation.reason);
        return;
      }
      onSubmit(intent);
      setValue("");
      setError(null);
      return;
    }

    setError(`unknown command: ${raw}`);
  };

  return (
    <form
      className="command-bar"
      data-testid="command-bar"
      onSubmit={handleSubmit}
    >
      <input
        className="command-bar__input"
        data-testid="command-input"
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error !== null) setError(null);
        }}
        disabled={disabled}
        aria-label="command input"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        className="command-bar__submit"
        data-testid="command-submit"
        type="submit"
        disabled={disabled}
      >
        submit
      </button>
      {error !== null && (
        <div
          className="command-bar__error"
          data-testid="command-error"
          role="alert"
        >
          {error}
        </div>
      )}
    </form>
  );
}
