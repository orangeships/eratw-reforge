import type { EventPromptLine, EventPromptSpec } from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { formatGameEvent } from "./event-format.js";

export interface EventChoicePanelProps {
  prompt: EventPromptSpec;
  testId: string;
  openingTestId?: string;
  fallbackOpening?: ReadonlyArray<string>;
  onPick: (value: number | string, index: number) => void;
  buttonTestId?: (value: number | string, index: number) => string | undefined;
  className?: string;
}
function openingLines(prompt: EventPromptSpec, fallback: ReadonlyArray<string> | undefined): EventPromptLine[] {
  if (prompt.opening && prompt.opening.length > 0) return prompt.opening;
  return (fallback ?? []).map((text) => ({ kind: "narration" as const, text }));
}

/** Shared rendering for NIGHT and ODEKAKE event choices. */
export function EventChoicePanel({
  prompt,
  testId,
  openingTestId,
  fallbackOpening,
  onPick,
  buttonTestId,
  className = "",
}: EventChoicePanelProps) {
  const opening = openingLines(prompt, fallbackOpening);
  return (
    <div className={`event-choice-panel ${className}`.trim()} data-testid={testId}>
      {opening.length > 0 && (
        <div className="event-choice-panel__opening" data-testid={openingTestId}>
          {opening.map((line, index) => (
            <p key={`${line.kind}-${index}`} className={`event-choice-panel__line event-choice-panel__line--${line.kind}`}>
              {line.speaker && <span className="event-choice-panel__speaker">{line.speaker}</span>}
              {line.text}
            </p>
          ))}
        </div>
      )}
      <div className="event-choice-panel__question">{prompt.question}</div>
      {prompt.options.length > 0 && (
        <div className="event-choice-panel__options">
          {prompt.options.map((option, index) => (
            <button
              key={String(option.id)}
              type="button"
              className="event-choice-panel__option prompt-menu__btn"
              disabled={option.disabled}
              title={option.disabled ? option.detail : undefined}
              data-testid={buttonTestId?.(option.id, index)}
              onClick={() => onPick(option.id, index)}
            >
              <span className="prompt-menu__label">{option.label}</span>
              {option.detail && <span className="prompt-menu__detail">{option.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface EventResultLinesProps {
  events: ReadonlyArray<ObservationEvent>;
  state: Readonly<GameState>;
  testId?: string;
}

/** Render every visible result kind, including DIALOGUE_LINE. */
export function EventResultLines({ events, state, testId = "event-result-lines" }: EventResultLinesProps) {
  const lines = events
    .map((event, index) => ({ event, index, text: formatGameEvent(event, state) }))
    .filter((entry) => entry.text.trim().length > 0);
  return (
    <div className="event-result-lines" data-testid={testId}>
      {lines.length === 0 ? (
        <p className="event-result-lines__empty">这段事件没有可显示的内容。</p>
      ) : lines.map(({ event, index, text }) => (
        <p
          key={`${event.kind}-${index}`}
          className={`event-result-lines__line event-result-lines__line--${event.kind.toLowerCase()}`}
          data-event-kind={event.kind}
        >
          {text}
        </p>
      ))}
    </div>
  );
}
