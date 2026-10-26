import { useEffect, useMemo, useRef } from "react";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { SceneAmbientEntry } from "../ai/types.js";
import { formatEvent } from "../components/TextWindow.js";
import { formatGameEvent } from "./event-format.js";
import kojoColors from "./kojo-colors.bundle.json";
import { isMovementNarration, isPlayerVisibleEvent } from "./player-visible-events.js";
import { AsciiSpinner, AsciiText } from "./ascii/AsciiEffects.js";
import { useHistoryWindow } from "./use-history-window.js";

const KOJO_COLORS = kojoColors as Record<string, string>;
const DEFAULT_HISTORY_MAX = 20;
const DEFAULT_SCENE_EVENT_MAX = 8;

export interface SceneHistoryPanelProps {
  events: ReadonlyArray<ObservationEvent>;
  state?: Readonly<GameState>;
  max?: number;
  placement?: "inline" | "sidebar";
  /** The development scene owns streaming; history receives complete text. */
  animateNewLines?: boolean;
}

/** Shared player-visible history renderer. SceneView uses the inline placement
 * in the full shell; the immersive shell uses the sidebar placement. */
export function SceneHistoryPanel(props: SceneHistoryPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const max = props.max ?? DEFAULT_HISTORY_MAX;
  const events = useMemo(() => {
    const visible = props.events.filter(isPlayerVisibleEvent);
    return visible.length > max ? visible.slice(visible.length - max) : visible;
  }, [props.events, max]);
  const initialLength = useRef(props.events.length);
  const sidebar = props.placement === "sidebar";
  const windowed = sidebar && events.length > 200;
  const historyWindow = useHistoryWindow(events, scrollRef, windowed);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && !windowed) element.scrollTop = element.scrollHeight;
  }, [events.length, props.events.length, windowed]);

  return (
    <div
      className={sidebar ? "text-game-history" : "scene-view__band"}
      data-testid={sidebar ? "text-game-history" : "scene-band"}
      ref={scrollRef}
      onScroll={historyWindow.onScroll}
      aria-live="polite"
    >
      {events.length === 0 ? (
        <p className={sidebar ? "text-game-panel__empty" : "scene-view__band-empty"}>……</p>
      ) : (
        <>
          {historyWindow.before > 0 && <div aria-hidden="true" style={{ height: historyWindow.before }} />}
          {events.slice(historyWindow.start, historyWindow.end).map((event, offset) => {
            const index = historyWindow.start + offset;
            const color = event.kind === "DIALOGUE_LINE"
              ? KOJO_COLORS[String(event.charaNum)]
              : undefined;
            const line = (
              <p
                key={`${event.timestamp}:${event.kind}:${index}`}
                className={`scene-view__line scene-view__line--${event.kind}${isMovementNarration(event) ? " scene-view__line--movement" : ""}${event.kind === "NARRATION" && event.surface !== undefined ? ` scene-view__line--${event.surface} scene-view__line--${event.surface}-${event.tone ?? "plain"}` : ""}`}
                data-event-kind={event.kind}
                style={color ? { color } : undefined}
              >
                <AsciiText text={props.state ? formatGameEvent(event, props.state) : formatEvent(event)} animate={props.animateNewLines !== false && sidebar && props.events.length > initialLength.current && index === events.length - 1} />
              </p>
            );
            return windowed
              ? <div key={`${event.timestamp}:${event.kind}:${index}`} data-history-index={index} style={{ display: "flow-root" }}>{line}</div>
              : line;
          })}
          {historyWindow.after > 0 && <div aria-hidden="true" style={{ height: historyWindow.after }} />}
        </>
      )}
    </div>
  );
}

export interface SceneAmbientPanelProps {
  entry?: SceneAmbientEntry | null;
  /** Deterministic scene-description prose retained in the event log. */
  sceneEvents?: ReadonlyArray<ObservationEvent>;
  /** 问题1 — the CURRENT dynamic scene prose (`lookSceneProse` →
   *  `finalScene.ambientProse`), rendered as the 场景动态地文 block. Unlike
   *  `sceneEvents` this is recomputed per render and never carries
   *  world-broadcast narration (moves / work / schedule chatter). */
  dynamicProse?: string;
  state: Readonly<GameState>;
  enabled: boolean;
  /** Radio presents either ambient mode beside its own broadcast surface. */
  allowCharacterDialogue?: boolean;
  title?: string;
}

/** Scene-description panel. The central scene surface owns the static room
 * intro; this panel keeps the current dynamic scene prose (场景动态地文) and
 * the disposable AI scene interaction (场景ai地文) together. */
export function SceneAmbientPanel(props: SceneAmbientPanelProps) {
  const entry = props.allowCharacterDialogue || props.entry?.mode === "scene-interaction"
    ? props.entry
    : null;
  const title = props.title ?? "场景";
  const proseLines = (props.dynamicProse ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sourceEvents = props.sceneEvents ?? [];
  let lastMovementIndex = -1;
  for (let index = 0; index < sourceEvents.length; index += 1) {
    if (isMovementNarration(sourceEvents[index]!)) lastMovementIndex = index;
  }
  const sceneEvents = sourceEvents
    .slice(lastMovementIndex + 1)
    .filter((event) =>
      event.kind === "NARRATION" &&
      event.presentation === "ambient" &&
      isPlayerVisibleEvent(event),
    )
    .slice(-DEFAULT_SCENE_EVENT_MAX);
  const sceneEventsRef = useRef<HTMLDivElement | null>(null);
  // Lines already present when an entry is first seen are shown whole; lines
  // that arrive afterwards type in.
  const seenEntry = useRef<{ requestId: string; count: number } | null>(null);
  if (entry && seenEntry.current?.requestId !== entry.requestId) {
    seenEntry.current = { requestId: entry.requestId, count: entry.complete ? entry.lines.length : 0 };
  }

  useEffect(() => {
    const element = sceneEventsRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [sceneEvents.length, proseLines.length]);

  return (
    <section
      className="text-game-ambient"
      data-testid="text-game-ambient"
      data-mode={entry?.mode ?? "empty"}
      data-complete={entry ? (entry.complete ? "true" : "false") : undefined}
      data-enabled={props.enabled ? "true" : "false"}
      aria-live="polite"
      aria-label={title}
    >
      <h2 className="text-game-panel__heading">┌ {title} ┐</h2>
      {proseLines.length > 0 && (
        <div className="text-game-ambient__scene-events text-game-ambient__dynamic-prose" data-testid="text-game-dynamic-prose" aria-label="当前场景动态地文">
          {proseLines.map((line, index) => (
            <p key={`prose:${index}`} className="text-game-ambient__scene-event">{line}</p>
          ))}
        </div>
      )}
      {sceneEvents.length > 0 && (
        <div className="text-game-ambient__scene-events" data-testid="text-game-scene-events" aria-label="当前场景动态描述" ref={sceneEventsRef}>
          {sceneEvents.map((event, index) => (
            <p
              key={`${event.timestamp}:${index}`}
              className="text-game-ambient__scene-event"
              data-event-kind={event.kind}
            >
              {formatGameEvent(event, props.state)}
            </p>
          ))}
        </div>
      )}
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
                <AsciiText
                  text={line.text}
                  typingKey={`${entry.requestId}:${index}`}
                  animate={index >= (seenEntry.current?.count ?? 0) && index === entry.lines.length - 1}
                />
              </p>
            );
          })}
          {!entry.complete && <span className="text-game-ambient__streaming"><AsciiSpinner label="生成中" /></span>}
        </div>
      )}
    </section>
  );
}
