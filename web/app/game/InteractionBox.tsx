/**
 * Phase 4.5D — InteractionBox (action sub-loop modal, S4).
 *
 * era's `BEGIN TRAIN` "screen takeover" modernized into a popup. It is a UI
 * overlay (A1 / S1: not GameState, not persisted). While open it shows this
 * sub-loop's reaction, then the player closes the box and picks the next
 * command from the bottom bar.
 *
 * 实玩反馈 (2026-06-28) — restructured into a 立绘 + 口上 dialogue panel:
 *  1. LEFT  = the speaker's portrait (立绘), keyed by the kojo line's charaNum.
 *  2. MIDDLE = the speaker's name + their spoken 口上 lines, colored by the
 *     per-character 口上 color (`@M_KOJO_COLOR_K{N}`, see kojo-colors.ts).
 *  3. Player-visible prose narration is shown before 口上, but migration-era
 *     English placeholder narration is filtered out. Commands with no kojo
 *     (master-only 休憩/做饭/…) still fall back to prose so the box is never blank.
 *  4. The reaction is revealed by lines; the 「继续」 button advances ONE line at a
 *     time (eraTW advances 口上 one PRINTL/WAIT at a time). The 「跳过」 button
 *     (实玩反馈 2026-07-05) jumps to the next speaker — i.e. reveals every line
 *     belonging to the currently-shown charaNum (and inline NARRATION in between),
 *     leaving only the lines after the next chara change still hidden. This
 *     mirrors 「A 連打」pacing without hiding the rest of the current reaction.
 */

import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import portraits from "./portraits.bundle.json";
import { isInteractionVisibleEvent, isMovementNarration } from "./player-visible-events.js";
import SpriteCrop from "./SpriteCrop.js";
import { portraitForSpriteName, type PortraitSource } from "./portrait-expression.js";
import { kojoColor } from "./kojo-colors.js";
import { formatGameEvent } from "./event-format.js";
import RadioBroadcast from "../ai/RadioBroadcast.js";
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import MobPortrait from "./MobPortrait.js";

const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;
export interface InteractionBoxProps {
  /** Stable owner-aware session identity. Reveal state resets when it changes. */
  sessionId?: string;
  /** The sub-loop's output: eventLog tail since the box opened. */
  events: ReadonlyArray<ObservationEvent>;
  /** The live game state — resolves the speaker's 称呼 (callName). */
  state: GameState;
  /** Close the box and return to the scene (S4 exit). */
  onExit: () => void;
  /** Mid-kojo player choice paused (KOJO-CHOICE-PLAN P3). When set, the box
   *  renders the option buttons after the dialogue stream and the "继续" /
   *  "跳过" buttons hide — the player must pick a branch to continue. */
  pendingChoice?: { options: { label: string }[]; inputMode?: "number" | "string" } | null;
  /** Resume a paused choice with the picked option index. Wired to the
   *  store's `resolveKojoChoiceAction(idx)`. */
  onPickChoice?: (optionIndex: number | string) => void;
  /** This exact command session is waiting for a realtime AI reaction. */
  aiPending?: boolean;
  aiCharaNum?: number;
  /** AI-enhanced deterministic weather broadcast from COM496. */
  radioBroadcast?: string;
}

export default function InteractionBox(props: InteractionBoxProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);

  if (props.radioBroadcast) {
    return (
      <div className="interaction-box__scrim" data-testid="interaction-box">
        <div className="interaction-box interaction-box--radio" role="dialog" aria-modal="true" aria-label="收音机天气播报">
          <RadioBroadcast rawBroadcast={props.radioBroadcast} />
          <div className="interaction-box__grid" data-testid="interaction-actions">
            <button type="button" className="interaction-box__btn interaction-box__btn--exit" onClick={props.onExit}>[关闭]</button>
          </div>
        </div>
      </div>
    );
  }

  // DISPLAY_COM_IMAGE is a visual request, not printable dialogue. The
  // browser currently uses the deterministic speaker portrait; retaining the
  // original command number leaves the resource adapter an explicit seam for
  // authored expression/pose assets.
  const commandImage = props.events.find(
    (event): event is Extract<ObservationEvent, { kind: "KOJO_HOST_EVENT" }> =>
      event.kind === "KOJO_HOST_EVENT" && event.operation === "host-call" && event.name === "DISPLAY_COM_IMAGE",
  );

  // 口上: the character's reaction lines.
  const kojoLines = props.events.filter(
    (e): e is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> =>
      e.kind === "DIALOGUE_LINE",
  );
  const hasKojo = kojoLines.length > 0;
  const hasCommandImage = commandImage !== undefined;
  // Keep command prose, kojo, and later world narration in the exact order the
  // runtime emitted them. Grouping all narration before all dialogue made NPC
  // background messages appear to interrupt the command reaction.
  const lines: ReadonlyArray<ObservationEvent> = props.events.filter(
    (e) => e.kind === "DIALOGUE_LINE" || (e.kind === "NARRATION" && isInteractionVisibleEvent(e)),
  );
  const hasStreamingAi = lines.some(
    (line) => line.kind === "DIALOGUE_LINE" && line.origin === "ai",
  );

  // Click-to-advance: reveal lines one at a time. Starts at 1 on open; new
  // lines appended later stay hidden until the player clicks (eraTW pacing).
  const [revealed, setRevealed] = useState(1);
  const [authoredProgress, setAuthoredProgress] = useState({ line: -1, characters: 0 });
  const [inputValue, setInputValue] = useState("");
  useEffect(() => {
    setRevealed(1);
    setAuthoredProgress({ line: -1, characters: 0 });
    setInputValue("");
  }, [props.sessionId]);
  // A choice pause belongs after the lines emitted before it. Keep the normal
  // line-by-line pacing until then, so a selected branch can continue in this
  // same dialogue session instead of appearing to replay its prelude.
  const inputMode = props.pendingChoice?.inputMode;
  const hasChoice = (props.pendingChoice?.options.length ?? 0) > 0 || inputMode !== undefined;
  // A real AI stream is already paced by provider chunks. Reveal newly
  // appended AI snapshots immediately instead of requiring a click that would
  // hide the stream behind the command narration.
  useEffect(() => {
    if (props.aiPending && hasStreamingAi) {
      setRevealed(lines.length);
    }
  }, [hasStreamingAi, lines.length, props.aiPending]);
  const shownCount = Math.min(revealed, lines.length);
  const more = shownCount < lines.length;
  const choiceReady = hasChoice && !more;
  const shownLines = lines.slice(0, shownCount);
  const typingAuthoredLine = shownLines.length - 1;
  const typingAuthoredEvent = shownLines[typingAuthoredLine];
  const typingAuthoredText = typingAuthoredEvent?.kind === "DIALOGUE_LINE" && typingAuthoredEvent.origin !== "ai"
    ? formatGameEvent(typingAuthoredEvent, props.state)
    : "";
  const typingAuthoredCharacters = authoredProgress.line === typingAuthoredLine
    ? authoredProgress.characters
    : 0;

  // CSS clip-path reveals every wrapped visual row in parallel. Reveal the
  // actual text one character at a time instead, so browser line wrapping
  // naturally completes the first visual row before continuing onto the next.
  useEffect(() => {
    if (!typingAuthoredText) return;
    if (authoredProgress.line !== typingAuthoredLine) {
      setAuthoredProgress({ line: typingAuthoredLine, characters: 0 });
      return;
    }
    if (typingAuthoredCharacters >= typingAuthoredText.length) return;
    const totalDuration = Math.max(280, Math.min(4_000, typingAuthoredText.length * 34));
    const characterDelay = Math.max(16, Math.ceil(totalDuration / Math.max(1, typingAuthoredText.length)));
    const timer = window.setTimeout(() => {
      setAuthoredProgress((current) =>
        current.line === typingAuthoredLine
          ? { ...current, characters: current.characters + 1 }
          : current,
      );
    }, characterDelay);
    return () => window.clearTimeout(timer);
  }, [
    typingAuthoredCharacters,
    typingAuthoredLine,
    typingAuthoredText,
    authoredProgress.line,
  ]);

  // The portrait + name follow the most-recently-revealed speaker. If the first
  // revealed line is narration, use the first kojo speaker so the portrait is
  // already present beside the description.
  const lastShownDialogue = [...lines.slice(0, shownCount)]
    .reverse()
    .find((e): e is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> => e.kind === "DIALOGUE_LINE");
  const activeSpeakerLine = hasKojo ? lastShownDialogue ?? kojoLines[0] : undefined;
  const speakerNum = activeSpeakerLine?.charaNum ?? commandImage?.charaNum;
  const speakerName =
    speakerNum !== undefined
      ? props.state.charas[speakerNum]?.callName ?? `角色${speakerNum}`
      : undefined;
  const speakerColor = speakerNum !== undefined ? kojoColor(speakerNum) : undefined;
  const speakerPortrait = portraitForSpriteName(
    speakerNum !== undefined ? PORTRAITS[String(speakerNum)] as PortraitSource | undefined : undefined,
    commandImage?.args?.[0],
  );
  const dynamicSpeakerPortrait = speakerNum !== undefined
    ? portraitForDynamicCharacter(props.state, speakerNum)
    : undefined;

  // Pin the transcript to its newest wrapped row while lines reveal. Character
  // progress matters on narrow screens because one authored line can grow by
  // several visual rows before `shownCount` changes.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, shownCount, typingAuthoredCharacters]);

  const advance = (): void => {
    if (more) setRevealed((r) => r + 1);
  };

  // 跳过 — reveal every remaining line belonging to the currently-shown
  // speaker (the portrait's charaNum). Stop just BEFORE the first DIALOGUE_LINE
  // whose charaNum differs (the next speaker); inline NARRATION between the
  // current speaker's lines is included so reactions don't get cut mid-thought.
  // Falls back to "reveal everything" if no current speaker (narration-only
  // box) or the current speaker has no more lines.
  const skipSpeaker = (): void => {
    if (!more) return;
    const currentCharaNum = lastShownDialogue?.charaNum;
    let target = lines.length;
    if (currentCharaNum !== undefined) {
      for (let i = shownCount; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.kind === "DIALOGUE_LINE" && line.charaNum !== currentCharaNum) {
          target = i;
          break;
        }
      }
    }
    setRevealed(target);
  };

  return (
    <div className="interaction-box__scrim" data-testid="interaction-box">
      <div
        className={
          "interaction-box" + (hasKojo || hasCommandImage ? " interaction-box--kojo" : "")
        }
        role="dialog"
        aria-modal="true"
        aria-label="动作交互"
      >
        {(hasKojo || hasCommandImage) && (
          <div
            className="interaction-box__portrait"
            data-testid="interaction-portrait"
            data-kojo-com-image={commandImage?.args?.[0]}
          >
            {dynamicSpeakerPortrait ? (
              <MobPortrait
                className="interaction-box__portrait-img interaction-box__portrait-img--mob"
                portrait={dynamicSpeakerPortrait}
                alt={speakerName ?? "立绘"}
                testId="interaction-mob-portrait"
              />
            ) : speakerPortrait ? (
              <SpriteCrop
                className="interaction-box__portrait-img"
                source={speakerPortrait}
                alt={speakerName ?? "立绘"}
                frameWidth={112}
                frameHeight={172}
                cropTestId="interaction-portrait-crop"
                imageTestId="interaction-portrait-img"
              />
            ) : (
              <span className="interaction-box__portrait-fallback" aria-hidden="true" />
            )}
          </div>
        )}

        <div className="interaction-box__body">
          {speakerName && (
            <div
              className="interaction-box__speaker"
              data-testid="interaction-speaker-name"
              style={{ color: speakerColor }}
            >
              {speakerName}
            </div>
          )}

          <div
            className="interaction-box__stream"
            ref={streamRef}
            data-testid="interaction-stream"
            onClick={advance}
            role={more ? "button" : undefined}
            title={more ? "点击继续" : undefined}
          >
            {lines.length === 0 && !props.aiPending ? (
              <p className="interaction-box__empty">……</p>
            ) : (
              shownLines.map((event, i) => {
                const authored = event.kind === "DIALOGUE_LINE" && event.origin !== "ai";
                const eventText = formatGameEvent(event, props.state);
                const typing = authored && i === typingAuthoredLine;
                const visibleText = typing ? eventText.slice(0, typingAuthoredCharacters) : eventText;
                return (
                <p
                  key={`${props.sessionId ?? "default"}:${i}`}
                  className={
                    `interaction-box__line interaction-box__line--${event.kind}` +
                    (isMovementNarration(event) ? " interaction-box__line--movement" : "") +
                    (authored ? " interaction-box__line--authored-stream" : "")
                  }
                  data-event-kind={event.kind}
                  data-origin={event.kind === "DIALOGUE_LINE" ? event.origin : undefined}
                  data-stream-state={authored ? typing ? "typing" : "complete" : undefined}
                  style={
                    event.kind === "DIALOGUE_LINE"
                      ? { color: kojoColor(event.charaNum) }
                      : undefined
                  }
                >
                  {visibleText}
                  {typing && <span className="interaction-box__stream-source">{eventText}</span>}
                  {event.kind === "DIALOGUE_LINE" && event.origin === "ai" && (
                    <span className="interaction-box__ai-badge" aria-label="AI补写">AI</span>
                  )}
                </p>
                );
              })
            )}
            {props.aiPending && (
              <p className="interaction-box__ai-pending" data-testid="interaction-ai-pending">
                {props.state.charas[props.aiCharaNum ?? -1]?.callName ?? "角色"}正在回应……
              </p>
            )}
          </div>

          <div className="interaction-box__controls" data-testid="interaction-controls">
          <div className="interaction-box__grid" data-testid="interaction-actions">
            {more && (
              <>
                <button
                  type="button"
                  className="interaction-box__btn interaction-box__btn--more"
                  data-testid="interaction-more-button"
                  onClick={advance}
                >
                  ▼ 继续（{shownCount}/{lines.length}）
                </button>
                <button
                  type="button"
                  className="interaction-box__btn interaction-box__btn--skip"
                  data-testid="interaction-skip-button"
                  onClick={skipSpeaker}
                  title="跳过当前角色的口上，直接显示完"
                >
                  [跳过]
                </button>
              </>
            )}
            {!more && !hasChoice && !props.aiPending && (
              <button
                type="button"
                className="interaction-box__btn interaction-box__btn--exit"
                data-testid="interaction-exit-button"
                onClick={props.onExit}
              >
                [关闭]
              </button>
            )}
          </div>

          {choiceReady && (
            <div
              className="interaction-box__choice"
              data-testid="interaction-choice-row"
              role="group"
              aria-label="选择"
            >
              {inputMode ? (
                <>
                  <input
                    className="interaction-box__input"
                    data-testid="interaction-choice-input"
                    type={inputMode === "number" ? "number" : "text"}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const value = inputMode === "number" ? Number(inputValue) : inputValue;
                      if (inputMode !== "number" || Number.isFinite(value)) props.onPickChoice?.(value);
                    }}
                    aria-label={inputMode === "number" ? "数值输入" : "文本输入"}
                  />
                  <button
                    type="button"
                    className="interaction-box__btn interaction-box__btn--choice"
                    data-testid="interaction-choice-submit"
                    onClick={() => {
                      const value = inputMode === "number" ? Number(inputValue) : inputValue;
                      if (inputMode !== "number" || Number.isFinite(value)) props.onPickChoice?.(value);
                    }}
                  >
                    [确定]
                  </button>
                </>
              ) : props.pendingChoice!.options.map((opt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="interaction-box__btn interaction-box__btn--choice"
                  data-testid={`interaction-choice-${idx}`}
                  onClick={() => props.onPickChoice?.(idx)}
                >
                  [{idx + 1}] {opt.label}
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
