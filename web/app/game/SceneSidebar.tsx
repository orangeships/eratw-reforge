import { useEffect, useRef } from "react";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { SceneAmbientEntry } from "../ai/types.js";
import { formatEvent } from "../components/TextWindow.js";
import { formatGameEvent } from "./event-format.js";
import kojoColors from "./kojo-colors.bundle.json";
import { isMovementNarration, isPlayerVisibleEvent } from "./player-visible-events.js";

const KOJO_COLORS = kojoColors as Record<string, string>;
const DEFAULT_HISTORY_MAX = 20;

export interface SceneHistoryPanelProps {
  events: ReadonlyArray<ObservationEvent>;
  state?: Readonly<GameState>;
  max?: number;
  placement?: "inline" | "sidebar";
}

/** Shared player-visible history renderer. SceneView uses the inline placement
 * in classic mode; the immersive shell uses the sidebar placement. */
export function SceneHistoryPanel(props: SceneHistoryPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const max = props.max ?? DEFAULT_HISTORY_MAX;
  const visible = props.events.filter(isPlayerVisibleEvent);
  const events = visible.length > max ? visible.slice(visible.length - max) : visible;
  const sidebar = props.placement === "sidebar";

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [events.length, props.events.length]);

  return (
    <div
      className={sidebar ? "text-game-history" : "scene-view__band"}
      data-testid={sidebar ? "text-game-history" : "scene-band"}
      ref={scrollRef}
      aria-live="polite"
    >
      {events.length === 0 ? (
        <p className={sidebar ? "text-game-panel__empty" : "scene-view__band-empty"}>……</p>
      ) : (
        events.map((event, index) => {
          const color = event.kind === "DIALOGUE_LINE"
            ? KOJO_COLORS[String(event.charaNum)]
            : undefined;
          return (
            <p
              key={`${event.timestamp}:${event.kind}:${index}`}
              className={`scene-view__line scene-view__line--${event.kind}${isMovementNarration(event) ? " scene-view__line--movement" : ""}`}
              data-event-kind={event.kind}
              style={color ? { color } : undefined}
            >
              {props.state ? formatGameEvent(event, props.state) : formatEvent(event)}
            </p>
          );
        })
      )}
    </div>
  );
}

export interface SceneAmbientPanelProps {
  entry?: SceneAmbientEntry | null;
  state: Readonly<GameState>;
  enabled: boolean;
  /** Radio presents either ambient mode beside its own broadcast surface. */
  allowCharacterDialogue?: boolean;
}

/** Disposable ambient AI presentation. It never reads formal dialogue or
 * eventLog and therefore cannot replace command/author Kojo in InteractionBox. */
export function SceneAmbientPanel(props: SceneAmbientPanelProps) {
  const entry = props.allowCharacterDialogue || props.entry?.mode === "scene-interaction"
    ? props.entry
    : null;

  return (
    <section
      className="text-game-ambient"
      data-testid="text-game-ambient"
      data-mode={entry?.mode ?? "empty"}
      data-complete={entry ? (entry.complete ? "true" : "false") : undefined}
      data-enabled={props.enabled ? "true" : "false"}
      aria-live="polite"
      aria-label="场景对话"
    >
      <h2 className="text-game-panel__heading">┌ 场景对话 ┐</h2>
      {entry && entry.lines.length > 0 && (
        <div className="text-game-ambient__lines">
          {entry.lines.map((line, index) => {
            const speaker = props.state.charas[line.participantId];
            const color = line.form === "speech"
              ? KOJO_COLORS[String(line.participantId)]
              : undefined;
            return (
              <p
                key={`${line.participantId}:${line.form}:${index}`}
                className={`text-game-ambient__line text-game-ambient__line--${line.form}`}
                style={color ? { color } : undefined}
              >
                {line.form === "speech" && (
                  <span className="text-game-ambient__speaker">
                    {speaker?.callName ?? `#${line.participantId}`}：
                  </span>
                )}
                {line.text}
              </p>
            );
          })}
          {!entry.complete && <span className="text-game-ambient__streaming">生成中…</span>}
        </div>
      )}
    </section>
  );
}
