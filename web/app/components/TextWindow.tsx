/**
 * Phase 4C — TextWindow.
 *
 * Props-driven, pure-functional React 18 component. No Zustand store
 * reads, no IPC calls. The 4D wiring layer owns the store and feeds
 * `events` in; this component is presentation-only.
 *
 * Renders the last `maxEvents` (default 50) `ObservationEvent`
 * entries as a scrollable list. Older events are dropped — i.e.
 * we keep the tail, not the head. Newer events render below older
 * ones (no auto-reverse); the parent passes events in the order
 * they should appear, top-to-bottom.
 *
 * Empty-state: when `events` is empty, renders a muted "暂无事件"
 * line so the panel never collapses to a blank box.
 *
 * Per-kind formatting (stable, no localization in Phase 4):
 *   STATUS_MESSAGE : "[<source>] <text>"
 *   COMMAND_ISSUED : "[command] actor=<n> commandNo=<m>"
 *   STATE_DELTA    : "[state] <名前±delta …> (subject=<n>)"
 *   TIME_TICK      : "[time] tick=<n>"
 *   FLAG_CHANGED   : "[flag] id=<n> value=<v>"
 *   DIALOGUE_DUE   : "[dialogue] chara=<n> category=<c> subId=<s>"
 *   NARRATION      : "<text>"            (plain in-world prose, S3)
 *   DIALOGUE_LINE  : "「<text>」" or plain prose for PRINTFORMD* 地文
 *                    (color by charaNum in 4.5D)
 *
 * Hard rules carried from Phase 3 / 2.6:
 *   - No settlement code; this is presentation only.
 *   - No forbidden legacy namespace tokens (see modernization/tests/
 *     unit/forbidden-names.test.ts for the closed list). STATE_DELTA's
 *     deltas are surfaced via the namespace-free `describeStateDelta`
 *     helper (id→display-name maps live in the runtime leaf, not here).
 *   - Stub-only behavior; settlement belongs to Phase 5+.
 */

import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { describeStateDelta } from "../../../modernization/runtime/index.js";

export interface TextWindowProps {
  events: ReadonlyArray<ObservationEvent>;
  /** Maximum number of events to render. Older events are dropped. Defaults to 50. */
  maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 50;

function isPlainKojoProse(event: Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>): boolean {
  // eraTW convention: PRINTD*/PRINTFORMD* are 地文
  // descriptions, not spoken dialogue. Generic TRAIN_MESSAGE entries also
  // often arrive as PRINTFORML without quotes, so keep already-quoted strings
  // untouched below and only auto-wrap genuinely bare spoken text.
  return /^PRINT(?:FORM)?D/u.test(event.form ?? "");
}

function alreadyQuoted(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("「") ||
    t.startsWith("『") ||
    t.startsWith("“") ||
    t.startsWith("\"") ||
    t.startsWith("《")
  );
}

/**
 * Pure formatter for one event. Exported for testability — the test
 * suite can pin the format strings here without re-rendering the
 * whole component tree.
 */
export function formatEvent(event: ObservationEvent): string {
  switch (event.kind) {
    case "STATUS_MESSAGE":
      return `[${event.source}] ${event.text}`;
    case "COMMAND_ISSUED":
      return `[command] actor=${event.actor} commandNo=${event.commandNo}`;
    case "STATE_DELTA": {
      // Parity QA F-1c — surface the actual per-field deltas (eraTW prints
      // `気力-100 体力-50`), not just a field count. `describeStateDelta` is a
      // pure leaf import (no settlement/clock transitive deps → browser-safe).
      // Empty / all-zero deltas fall back to the debug `fields=0` form so the
      // event is still visible.
      const delta = describeStateDelta(event);
      return delta
        ? `[state] ${delta} (subject=${event.subject})`
        : `[state] subject=${event.subject} fields=0`;
    }
    case "TIME_TICK":
      return `[time] tick=${event.tickValue}`;
    case "FLAG_CHANGED":
      return `[flag] id=${event.flagId} value=${event.newValue}`;
    case "DIALOGUE_DUE":
      return `[dialogue] chara=${event.charaNum} category=${event.eventCategory} subId=${event.eventSubId}`;
    case "NARRATION":
      return event.text;
    case "DIALOGUE_LINE":
      if (isPlainKojoProse(event) || alreadyQuoted(event.text)) return event.text;
      return `「${event.text}」`;
    case "KOJO_HOST_EVENT":
      return "";
    case "EVENT_PROMPT": {
      // Render a compact prompt summary until the UI's choice picker
      // takes over (the full question+buttons is rendered separately).
      const opts = event.spec.options
        .map((o) => (o.disabled ? `~~${o.label}~~` : o.label))
        .join(" | ");
      return `[prompt] ${event.spec.question} → ${opts}`;
    }
  }
}

export default function TextWindow(props: TextWindowProps) {
  const max = props.maxEvents ?? DEFAULT_MAX_EVENTS;

  // Keep the tail — older entries drop off if the log grows past `max`.
  // No reverse: the caller decides order. Phase 4D appends new events
  // to the end, so the newest line is naturally at the bottom.
  const playerEvents = props.events.filter((event) => event.kind !== "KOJO_HOST_EVENT");
  const visible = playerEvents.length > max
    ? playerEvents.slice(playerEvents.length - max)
    : playerEvents;

  if (visible.length === 0) {
    return (
      <div className="text-window" data-testid="text-window">
        <div
          className="text-window__empty"
          data-testid="text-window-empty"
        >
          暂无事件
        </div>
      </div>
    );
  }

  return (
    <div className="text-window" data-testid="text-window">
      <ul className="text-window__list" role="log" aria-live="polite">
        {visible.map((event, index) => (
          <li
            key={index}
            className={`text-window__line text-window__line--${event.kind}`}
            data-testid="event-line"
            data-event-kind={event.kind}
          >
            {formatEvent(event)}
            {event.kind === "DIALOGUE_LINE" && event.origin === "ai" && (
              <span className="text-window__ai-badge" aria-label="AI补写">AI</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
