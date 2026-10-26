import { useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../../../../modernization/runtime/state/index.js";
import type { SceneAsset } from "../../../../modernization/runtime/scene/index.js";
import type { ObservationEvent } from "../../../../modernization/schemas/types.js";
import type { SceneAmbientEntry } from "../../ai/types.js";
import type { DialogueSession } from "../../state/dialogue-session.js";
import { SceneHistoryPanel } from "../SceneSidebar.js";
import { eventInstanceKey, eventKey, trimSuffixOverlap } from "../event-merge.js";
import { isNarrativePresentationEvent } from "../player-visible-events.js";
import kojoColors from "../kojo-colors.bundle.json";

const KOJO_COLORS = kojoColors as Record<string, string>;
/** Cap for cross-session lines that never enter the persistent eventLog
 *  (AI chat turns, kojo choice branches). */
const PERSISTED_EXTRAS_MAX = 200;

function hasAuthoredIntro(intro: string): boolean {
  return intro.trim().length > 0 && !intro.startsWith("[not-authored:");
}

function lastCompletedMoveIndex(events: ReadonlyArray<ObservationEvent>): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind === "NARRATION" && /^移动到了.+。$/u.test(event.text.trim())) return index;
  }
  return -1;
}

/**
 * The eventLog (`band`) and the active session transcript overlap for
 * ordinary command kojo (both carry the same lines), while AI chat /
 * AI-replaced lines / kojo choice branches exist ONLY in the transcript.
 * Merge rule:
 *  1. Trim the band's suffix that exactly matches the transcript prefix
 *     (the transcript renders that segment once).
 *  2. Collect transcript lines missing from the band into a local buffer so
 *     they survive the session closing (cap 200; reset when the eventLog
 *     shrinks, i.e. 读档/重置).
 *  3. Render [...trimmed band, ...buffered extras, ...live transcript].
 */

export interface MinimalTextStreamProps {
  scene: SceneAsset | null;
  /** Player-visible narrative event tail (the persistent eventLog stream). */
  bandEvents: ReadonlyArray<ObservationEvent>;
  /** Disposable AI scene prose; never sourced from eventLog. */
  ambientEntry?: SceneAmbientEntry | null;
  /** The active dialogue session (dialogueQueue[0]); its transcript is the
   *  live kojo/AI stream. */
  liveSession?: DialogueSession | null;
  /** True while a realtime AI request is streaming for this session. */
  aiPending: boolean;
  /** Presentation-only lines appended by the inline AI-branch picker
   *  (MinimalChoiceBar); rendered after the live transcript. */
  extraLines?: ReadonlyArray<ObservationEvent>;
  /** Author dialogue retained in the deterministic eventLog for audit but
   * replaced successfully by full-AI presentation. */
  suppressedEventKeys?: ReadonlyArray<string>;
  state: Readonly<GameState>;
}

/** 地点名 + 静态 intro + 动态场景描述 — the SceneView header, without any
 *  backdrop/stage/portrait rendering. */
function MinimalSceneContext({ scene }: { scene: SceneAsset | null }) {
  if (!scene) {
    return (
      <div className="minimal-stream__scene-context" data-testid="minimal-scene-context">
        <div className="minimal-stream__place">（此处没有场景）</div>
      </div>
    );
  }
  const authoredIntro = hasAuthoredIntro(scene.intro);
  return (
    <div className="minimal-stream__scene-context" data-testid="minimal-scene-context">
      <div className="minimal-stream__place">{scene.displayName}</div>
      {authoredIntro && (
        <p className="minimal-stream__intro" data-testid="minimal-scene-intro">{scene.intro}</p>
      )}
      {scene.ambientProse && (
        <p className="minimal-stream__ambient" data-testid="minimal-scene-ambient">{scene.ambientProse}</p>
      )}
    </div>
  );
}

/** AI scene-interaction prose rendered as a live strip (no panel chrome). */
function MinimalAmbientStrip({
  entry,
  state,
}: {
  entry?: SceneAmbientEntry | null;
  state: Readonly<GameState>;
}) {
  if (!entry || entry.lines.length === 0) return null;
  return (
    <div className="minimal-stream__ambient-live" data-testid="minimal-ambient-live" aria-live="polite">
      {entry.lines.map((line, index) => {
        const speaker = state.charas[line.participantId];
        const color = line.form === "speech" ? KOJO_COLORS[String(line.participantId)] : undefined;
        return (
          <p
            key={`${line.participantId}:${line.form}:${index}`}
            className={`minimal-stream__ambient-line minimal-stream__ambient-line--${line.form}`}
            style={color ? { color } : undefined}
          >
            {line.form === "speech" && (
              <span className="minimal-stream__ambient-speaker">
                {speaker?.callName ?? `#${line.participantId}`}：
              </span>
            )}
            {line.text}
          </p>
        );
      })}
      {!entry.complete && <span className="minimal-stream__ambient-streaming">生成中…</span>}
    </div>
  );
}

/**
 * The phone-minimal text stream: one scrolling document holding the scene
 * context, the AI scene strip, and the merged history/live-transcript lines.
 */
export default function MinimalTextStream(props: MinimalTextStreamProps) {
  const { scene, bandEvents, ambientEntry, liveSession, aiPending, extraLines, suppressedEventKeys, state } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // History clearing: the band shows ONLY the current command/event batch —
  // every player-issued command (a new COMMAND_ISSUED event) clears the
  // history and re-accumulates from that batch. A location change is stricter:
  // it advances to the final arrival row of the completed movement batch, so
  // only “移动到了…” and any later destination output remain. 读档/重置
  // (eventLog shrink)
  // restores the whole loaded timeline. Scene context (地点名/intro/
  // ambientProse) renders independently and is never cleared.
  // On FIRST MOUNT (entering minimal mode, e.g. toggling from immersive), the
  // stream must NOT dump the whole eventLog — anchor at the LAST command batch
  // (the most recent COMMAND_ISSUED) so only the current command's output is
  // visible. 读档 restores a full timeline via the shrink branch below.
  const [cutoffIndex, setCutoffIndex] = useState(() => {
    const log = state.eventLog;
    const lastMoveIndex = lastCompletedMoveIndex(log);
    for (let index = log.length - 1; index >= 0; index -= 1) {
      if (log[index]!.kind === "COMMAND_ISSUED") return Math.max(index, lastMoveIndex);
    }
    if (lastMoveIndex >= 0) return lastMoveIndex;
    if (log.length === 0) return 0;
    const lastTimestamp = log[log.length - 1]!.timestamp;
    let index = log.length - 1;
    while (index > 0 && log[index - 1]!.timestamp === lastTimestamp) index -= 1;
    return index;
  });
  const [suppressedSessionId, setSuppressedSessionId] = useState<string | null>(null);
  const prevLocationRef = useRef(state.master.location);
  const prevLogLength = useRef(state.eventLog.length);
  const locationChanged = state.master.location !== prevLocationRef.current;
  const appendedCommandOffset = locationChanged
    ? -1
    : state.eventLog
        .slice(prevLogLength.current)
        .findIndex((event) => event.kind === "COMMAND_ISSUED");
  const appendedMoveOffset = locationChanged
    ? lastCompletedMoveIndex(state.eventLog.slice(prevLogLength.current))
    : -1;
  // Movement settles several rows in one update, often while this component is
  // unmounted behind the map. The new room starts at the final arrival row.
  const effectiveCutoffIndex = locationChanged
    ? appendedMoveOffset >= 0
      ? prevLogLength.current + appendedMoveOffset
      : state.eventLog.length
    : appendedCommandOffset >= 0
      ? prevLogLength.current + appendedCommandOffset
      : Math.min(cutoffIndex, state.eventLog.length);
  const visibleLogEvents = useMemo(
    () => new Set(state.eventLog.slice(effectiveCutoffIndex)),
    [state.eventLog, effectiveCutoffIndex],
  );
  const suppressedKeys = useMemo(() => new Set(suppressedEventKeys ?? []), [suppressedEventKeys]);
  const band = useMemo(
    () => bandEvents.filter(
      (event) =>
        isNarrativePresentationEvent(event) &&
        visibleLogEvents.has(event) &&
        !(event.kind === "DIALOGUE_LINE" && event.origin !== "ai" && suppressedKeys.has(eventInstanceKey(event))),
    ),
    [bandEvents, visibleLogEvents, suppressedKeys],
  );
  // The live transcript is also chapter-scoped: a 移动 or a new command
  // clears older command/arrival 口上 (the tea ceremony lines must not linger
  // after the player walks away). A newly-created session remains eligible.
  const sessionPart = useMemo(
    () => locationChanged || (liveSession != null && liveSession.id === suppressedSessionId)
      ? []
      : (liveSession?.transcript ?? []).filter(
          (event) =>
            isNarrativePresentationEvent(event) &&
            !(event.kind === "DIALOGUE_LINE" && event.origin !== "ai" && suppressedKeys.has(eventInstanceKey(event))),
        ),
    [liveSession, locationChanged, suppressedSessionId, suppressedKeys],
  );
  const bandKeys = useMemo(() => new Set(band.map(eventKey)), [band]);
  const sessionKeys = useMemo(() => new Set(sessionPart.map(eventKey)), [sessionPart]);

  // Cross-session buffer for transcript lines that never enter the eventLog.
  const [extras, setExtras] = useState<ObservationEvent[]>([]);
  useEffect(() => {
    const log = state.eventLog;
    const logShrunk = log.length < prevLogLength.current;
    if (logShrunk) {
      // 读档/重置: drop stale lines from a previous save, show the whole
      // loaded timeline (no chapter cutoff).
      setExtras([]);
      setCutoffIndex(0);
      setSuppressedSessionId(null);
    } else if (state.master.location !== prevLocationRef.current) {
      // 移动 = 新章节: keep only the final arrival and later destination text.
      setExtras([]);
      const moveOffset = lastCompletedMoveIndex(log.slice(prevLogLength.current));
      setCutoffIndex(moveOffset >= 0 ? prevLogLength.current + moveOffset : log.length);
      setSuppressedSessionId(liveSession?.id ?? null);
    } else {
      // A fresh player command batch (COMMAND_ISSUED) resets the history to
      // just that batch — the stream never accumulates past output.
      const commandIssuedOffset = log.slice(prevLogLength.current).findIndex(
        (event) => event.kind === "COMMAND_ISSUED",
      );
      if (commandIssuedOffset >= 0) {
        setExtras([]);
        setCutoffIndex(prevLogLength.current + commandIssuedOffset);
      }
    }
    prevLogLength.current = log.length;
    prevLocationRef.current = state.master.location;
  }, [state.eventLog.length, state.master.location, liveSession?.id]);

  // Extras are chapter-scoped too: when the cutoff moves (new command/移动)
  // the whole buffer resets, and only lines at/after the cutoff are ever
  // collected — otherwise a pre-move transcript line collected on mount would
  // leak back through the extras path after the band/session are cleared.
  const prevCutoffRef = useRef(cutoffIndex);
  useEffect(() => {
    if (prevCutoffRef.current !== cutoffIndex) {
      prevCutoffRef.current = cutoffIndex;
      setExtras([]);
      return;
    }
    setExtras((prev) => {
      const existing = new Set(prev.map(eventKey));
      const additions = sessionPart.filter(
        (event) =>
          !bandKeys.has(eventKey(event)) &&
          !existing.has(eventKey(event)),
      );
      if (additions.length === 0) return prev;
      return [...prev, ...additions].slice(-PERSISTED_EXTRAS_MAX);
    });
  }, [sessionPart, bandKeys, cutoffIndex]);

  const trimmedBand = useMemo(() => trimSuffixOverlap(band, sessionPart), [band, sessionPart]);
  const visibleExtras = useMemo(
    () => extras.filter((event) => !bandKeys.has(eventKey(event)) && !sessionKeys.has(eventKey(event))),
    [extras, bandKeys, sessionKeys],
  );
  const renderEvents = useMemo(
    () => [
      ...trimmedBand,
      ...visibleExtras,
      ...sessionPart,
      ...(locationChanged ? [] : (extraLines ?? [])),
    ],
    [trimmedBand, visibleExtras, sessionPart, extraLines, locationChanged],
  );

  // Page-scroll mode (minimal): follow new output only when the player is
  // already near the bottom — never yank them away from text above.
  useEffect(() => {
    const nearBottom =
      window.innerHeight + window.scrollY >=
      (document.documentElement.scrollHeight ?? 0) - 160;
    if (nearBottom) window.scrollTo(0, document.documentElement.scrollHeight ?? 0);
  }, [renderEvents.length, ambientEntry?.lines.length, aiPending]);

  return (
    <div className="minimal-stream" data-testid="minimal-stream" ref={scrollRef}>
      <MinimalSceneContext scene={scene} />
      <MinimalAmbientStrip entry={locationChanged ? null : ambientEntry} state={state} />
      <SceneHistoryPanel events={renderEvents} state={state} placement="inline" max={500} />
      {aiPending && !locationChanged && <p className="minimal-stream__ai-pending" data-testid="minimal-ai-pending">……正在回应</p>}
    </div>
  );
}
