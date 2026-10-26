/**
 * Phase 4.5D — InteractionBox (action sub-loop modal, S4).
 *
 * era's `BEGIN TRAIN` "screen takeover" modernized into an owned transcript
 * surface (A1 / S1: not GameState, not persisted). Modal callers retain the
 * close-and-continue controls; H-session callers write the same output into
 * their center narrative panel and release automatically after it completes.
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
import {
  portraitForSpriteName,
  portraitForState,
  portraitSourceForState,
  type PortraitSource,
} from "./portrait-expression.js";
import { kojoColor } from "./kojo-colors.js";
import { formatGameEvent } from "./event-format.js";
import RadioBroadcast from "../ai/RadioBroadcast.js";
import { SceneAmbientPanel } from "./SceneSidebar.js";
import type { SceneAmbientEntry, SceneAmbientLine } from "../ai/types.js";
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import MobPortrait from "./MobPortrait.js";
import { AsciiSpinner, TypingHead, useTypewriter } from "./ascii/AsciiEffects.js";
import DialogueAccompanyChoices, { type DialogueAccompanyChoicesProps } from "./DialogueAccompanyChoices.js";
import { dialogueAccompanyInvitations } from "../../../modernization/runtime/ai-state/dialogue-action.js";

const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;

/**
 * COM496 keeps its formal interaction surface, but character reactions belong
 * in the radio side column. Only formal character dialogue is eligible here;
 * scene-ambient prose must stay out of this surface.
 */
export function buildRadioCharacterEntry(
  events: ReadonlyArray<ObservationEvent>,
  sessionId?: string,
): SceneAmbientEntry | null {
  const lines: SceneAmbientLine[] = [];
  const seen = new Set<string>();
  const append = (line: SceneAmbientLine): void => {
    const text = line.text.trim();
    if (!text) return;
    const key = `${line.participantId}:${line.form}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ ...line, text });
  };

  for (const event of events) {
    if (event.kind !== "DIALOGUE_LINE" || event.charaNum <= 0) continue;
    append({
      participantId: event.charaNum,
      // PRINT*D / PRINTFORMD* are authored plain-prose forms; all other
      // dialogue forms retain a visible speaker label in the side column.
      form: event.form?.includes("D") ? "action" : "speech",
      text: event.text,
    });
  }

  if (lines.length === 0) return null;
  return {
    requestId: `radio:${sessionId ?? "current"}`,
    trigger: "interaction-ended",
    mode: "character-dialogue",
    kind: "event-echo",
    participantIds: [...new Set(lines.map((line) => line.participantId))],
    lines,
    complete: true,
  };
}

export interface InteractionBoxProps {
  /** Development preview: float the owned transcript above the scene portraits. */
  presentation?: "modal" | "scene";
  /** Release the owning session once its text and all choices have completed. */
  onReadComplete?: (events: ReadonlyArray<ObservationEvent>) => void;
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
  /** Explicit presentation-only AI chat stays inside this existing character
   * dialogue surface. Draft input and the generated reply share one box. */
  aiChatMode?: boolean;
  aiChatInput?: boolean;
  onSubmitAiChat?: (semantic: string) => boolean;
  /** Persist a picked AI branch in the same chat episode when available. */
  onPickAiBranch?: (choiceLabel: string, lines: ObservationEvent[]) => void | Promise<boolean>;
  /** COM496 owns the formal radio surface regardless of AI settings. */
  radioActive?: boolean;
  /** AI-enhanced deterministic weather broadcast from COM496. */
  radioBroadcast?: string;
  /** Whether the protagonist can understand the broadcast language. */
  radioUnderstood?: boolean;
  /** Formal authored/AI character dialogue shown beside the COM496 radio. */
  radioCharacterEntry?: SceneAmbientEntry | null;
  onRespondAccompany?: DialogueAccompanyChoicesProps["onRespond"];
}

export default function InteractionBox(props: InteractionBoxProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const inScene = props.presentation === "scene";
  const completedTranscriptRef = useRef<{ sessionId?: string; events: ReadonlyArray<ObservationEvent>; branch: number | null } | null>(null);

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
  const baseLines: ReadonlyArray<ObservationEvent> = props.events.filter(
    (e) => e.kind === "DIALOGUE_LINE" || (e.kind === "NARRATION" && isInteractionVisibleEvent(e)),
  );
  const aiChoiceLine = [...baseLines].reverse().find(
    (line): line is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> =>
      line.kind === "DIALOGUE_LINE" && line.origin === "ai" && line.aiChoice !== undefined,
  );
  const [selectedAiChoice, setSelectedAiChoice] = useState<number | null>(null);
  const [branchPending, setBranchPending] = useState(false);
  const branchEpoch = useRef(0);
  const selectedAiOption = selectedAiChoice === null
    ? undefined
    : aiChoiceLine?.aiChoice?.options[selectedAiChoice];
  const aiBranchLines: ObservationEvent[] = selectedAiOption?.lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: aiChoiceLine?.timestamp ?? Date.now(),
    charaNum: aiChoiceLine?.charaNum ?? props.aiCharaNum ?? 0,
    text: line.text,
    form: line.form,
    origin: "ai" as const,
  })) ?? [];
  const lines: ReadonlyArray<ObservationEvent> = selectedAiOption
    ? [...baseLines, ...aiBranchLines]
    : baseLines;
  const omikujiResultCount = baseLines[0]?.kind === "NARRATION" && baseLines[0].surface === "omikuji"
    ? baseLines.findIndex((line) => line.kind !== "NARRATION" || line.surface !== "omikuji")
    : 0;
  const initialRevealCount = omikujiResultCount < 0 ? baseLines.length : Math.max(1, omikujiResultCount);
  const hasStreamingAi = lines.some(
    (line) => line.kind === "DIALOGUE_LINE" && line.origin === "ai",
  );

  // Click-to-advance: reveal lines one at a time. Starts at 1 on open; new
  // lines appended later stay hidden until the player clicks (eraTW pacing).
  const [revealed, setRevealed] = useState(initialRevealCount);
  const [inputValue, setInputValue] = useState("");
  useEffect(() => {
    setRevealed(initialRevealCount);
    setInputValue("");
    setSelectedAiChoice(null);
    setBranchPending(false);
    branchEpoch.current++;
  }, [props.sessionId, initialRevealCount]);
  // A choice pause belongs after the lines emitted before it. Keep the normal
  // line-by-line pacing until then, so a selected branch can continue in this
  // same dialogue session instead of appearing to replay its prelude.
  const inputMode = props.pendingChoice?.inputMode;
  const hasAiChoice = aiChoiceLine?.aiChoice !== undefined && selectedAiChoice === null
    && dialogueAccompanyInvitations(props.state).length === 0;
  const hasChoice = (props.pendingChoice?.options.length ?? 0) > 0 || inputMode !== undefined || hasAiChoice;
  const streamingAi = (props.aiPending === true || props.aiChatMode === true) && hasStreamingAi;
  const shownCount = Math.min(revealed, lines.length);
  const more = shownCount < lines.length;
  const choiceReady = hasChoice && !more;
  const shownLines = lines.slice(0, shownCount);
  const typingLine = shownLines.length - 1;
  const typingEvent = shownLines[typingLine];
  const typeable = (typingEvent?.kind === "DIALOGUE_LINE" || (inScene && typingEvent?.kind === "NARRATION"))
    && (inScene || (typingEvent?.kind === "DIALOGUE_LINE" && (typingEvent.origin === "ai" || !props.aiChatMode)));
  const typingText = typeable ? formatGameEvent(typingEvent, props.state) : "";
  // Character text is typed glyph by glyph. Streamed AI chunks extend the same
  // line key, so arrival bursts never restart or skip the typing head.
  const typed = useTypewriter(typingText, {
    key: `${props.sessionId ?? "default"}:${typingLine}`,
    active: typeable,
    backlog: streamingAi ? lines.length - shownCount : 0,
  });

  // A live AI reply flows on by itself: each line starts once the previous one
  // has finished typing. A long backlog (reopened chat history) jumps to the
  // newest line instead of replaying the whole transcript.
  useEffect(() => {
    if ((!streamingAi && !inScene) || !more) return;
    if (!inScene && lines.length - shownCount > 3) {
      setRevealed(lines.length - 1);
      return;
    }
    if (typed.done) setRevealed((r) => Math.max(r, shownCount) + 1);
  }, [streamingAi, inScene, more, typed.done, lines.length, shownCount]);

  const hasAccompanyInvitation = props.onRespondAccompany !== undefined
    && dialogueAccompanyInvitations(props.state).some((invitation) =>
      props.aiCharaNum === undefined || invitation.target === props.aiCharaNum);
  // Empty shells cannot auto-acknowledge a command that is still preparing.
  // Keep a manual exit after preparation fails or the UI outlives its owner;
  // App's preparation gate still intercepts input until preparation settles.
  const canCloseEmptyScene = inScene && props.onReadComplete !== undefined
    && lines.length === 0 && !props.aiChatInput && !hasAccompanyInvitation
    && !props.radioActive && !props.radioBroadcast;
  useEffect(() => {
    if (!inScene || !props.onReadComplete || props.events.length === 0 || more || !typed.done
      || props.aiPending || props.aiChatInput || hasChoice || hasAccompanyInvitation
      || props.radioActive || props.radioBroadcast) return;
    const completed = completedTranscriptRef.current;
    if (completed && completed.sessionId === props.sessionId && completed.events === props.events && completed.branch === selectedAiChoice) return;
    // Cancel on transcript/owner updates. Opening an empty shell before async
    // command preparation must never acknowledge a command that has not run.
    const timer = window.setTimeout(() => {
      completedTranscriptRef.current = { sessionId: props.sessionId, events: props.events, branch: selectedAiChoice };
      props.onReadComplete?.(lines);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inScene, more, typed.done, props.onReadComplete, props.events, props.aiPending, props.aiChatInput,
    hasChoice, hasAccompanyInvitation, props.radioActive, props.radioBroadcast, props.sessionId, selectedAiChoice, lines]);

  // The portrait + name follow the most-recently-revealed speaker. If the first
  // revealed line is narration, use the first kojo speaker so the portrait is
  // already present beside the description.
  const lastShownDialogue = [...lines.slice(0, shownCount)]
    .reverse()
    .find((e): e is Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }> => e.kind === "DIALOGUE_LINE");
  const showingOmikujiResult = shownLines.some(
    (line) => line.kind === "NARRATION" && line.surface === "omikuji",
  ) && lastShownDialogue === undefined;
  const activeSpeakerLine = hasKojo ? lastShownDialogue ?? (showingOmikujiResult ? undefined : kojoLines[0]) : undefined;
  const speakerNum = props.aiChatMode
    ? props.aiCharaNum
    : activeSpeakerLine?.charaNum ?? commandImage?.charaNum ?? props.aiCharaNum;
  const speakerName =
    speakerNum !== undefined
      ? props.state.charas[speakerNum]?.callName ?? `角色${speakerNum}`
      : undefined;
  const speakerColor = speakerNum !== undefined ? kojoColor(speakerNum) : undefined;
  const speakerPortrait = portraitForSpriteName(
    speakerNum !== undefined
      ? portraitForState(props.state, speakerNum, portraitSourceForState(props.state, speakerNum, PORTRAITS))
      : undefined,
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
    if (!inScene && el) el.scrollTop = el.scrollHeight;
  }, [inScene, lines.length, shownCount, typed.shown]);

  const advance = (): void => {
    if (more) setRevealed((r) => r + 1);
  };
  const onStreamClick = (): void => {
    if (!typed.done) typed.complete();
    else advance();
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

  // Keep this branch after all hooks. The radio surface and the ordinary
  // dialogue surface can replace each other when a queued session advances;
  // returning before the dialogue hooks would change the hook count and blank
  // the app with React's "Rendered more hooks" error.
  if (props.radioActive || props.radioBroadcast) {
    const hasRadioCharacterEntry = (props.radioCharacterEntry?.lines.length ?? 0) > 0;
    return (
      <div className="interaction-box__scrim" data-testid="interaction-box">
        <div className="interaction-box interaction-box--radio" role="dialog" aria-modal="true" aria-label="收音机天气播报">
          <div className={`interaction-box__radio-layout${hasRadioCharacterEntry ? "" : " interaction-box__radio-layout--solo"}`}>
            <div className="interaction-box__radio-main">
              <RadioBroadcast
                rawBroadcast={props.radioBroadcast ?? ""}
                canUnderstand={props.radioUnderstood ?? true}
              />
            </div>
            {hasRadioCharacterEntry && (
              <div className="interaction-box__radio-side" data-testid="radio-character-dialogue">
                <SceneAmbientPanel
                  entry={props.radioCharacterEntry}
                  state={props.state}
                  enabled
                  allowCharacterDialogue
                  title="角色口上"
                />
              </div>
            )}
          </div>
          <div className="interaction-box__grid" data-testid="interaction-actions">
            <button type="button" className="interaction-box__btn interaction-box__btn--exit" onClick={props.onExit}>[关闭]</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={inScene ? "interaction-box__scene" : "interaction-box__scrim"} data-testid="interaction-box">
      <div
        className={
          "interaction-box" + (hasKojo || hasCommandImage || props.aiChatMode ? " interaction-box--kojo" : "")
          + (inScene ? " interaction-box--scene" : "")
        }
        role={inScene ? "region" : "dialog"}
        aria-modal={inScene ? undefined : true}
        aria-label={inScene ? "当前对话" : "动作交互"}
      >
        {!inScene && (hasKojo || hasCommandImage || props.aiChatMode) && (
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
          {!inScene && speakerName && (
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
            onClick={onStreamClick}
            role={more || !typed.done ? "button" : undefined}
            title={!typed.done ? "点击显示整句" : more ? "点击继续" : undefined}
          >
            {lines.length === 0 && !props.aiPending && !props.aiChatInput ? (
              <p className="interaction-box__empty">……</p>
            ) : (
              shownLines.map((event, i) => {
                const authored = event.kind === "DIALOGUE_LINE" && event.origin !== "ai";
                const generated = event.kind === "DIALOGUE_LINE" && event.origin === "ai";
                const eventText = formatGameEvent(event, props.state);
                const typing = i === typingLine && typeable && !typed.done;
                const visibleText = typing ? eventText.slice(0, typed.shown) : eventText;
                return (
                <p
                  key={`${props.sessionId ?? "default"}:${i}`}
                  className={
                    `interaction-box__line interaction-box__line--${event.kind}` +
                    (isMovementNarration(event) ? " interaction-box__line--movement" : "") +
                    (authored ? " interaction-box__line--authored-stream" : "") +
                    (generated ? " interaction-box__line--ai-stream" : "") +
                    (event.kind === "NARRATION" && event.surface !== undefined
                      ? ` interaction-box__line--${event.surface} interaction-box__line--${event.surface}-${event.tone ?? "plain"}`
                      : "")
                  }
                  data-event-kind={event.kind}
                  data-scene-dialogue-line={inScene ? true : undefined}
                  data-origin={event.kind === "DIALOGUE_LINE" ? event.origin : undefined}
                  data-stream-state={authored || generated ? typing ? "typing" : "complete" : undefined}
                  style={{
                    ...(event.kind === "DIALOGUE_LINE" ? { color: kojoColor(event.charaNum) } : {}),
                  }}
                >
                  {inScene && event.kind === "DIALOGUE_LINE" && (
                    <span className="scene-dialogue__name">
                      {props.state.charas[event.charaNum]?.callName ?? (event.charaNum === 0 ? props.state.master.callName ?? "你" : `角色${event.charaNum}`)}
                    </span>
                  )}
                  {visibleText}
                  {typing && <TypingHead seed={typed.shown} />}
                  {typing && <span className="interaction-box__stream-source">{eventText}</span>}
                </p>
                );
              })
            )}
            {props.aiPending && (
              <p className="interaction-box__ai-pending" data-testid="interaction-ai-pending">
                <AsciiSpinner label={`${props.state.charas[props.aiCharaNum ?? -1]?.callName ?? "角色"}正在回应`} />
              </p>
            )}
          </div>

          {props.aiChatInput && (
            <form
              className="interaction-box__ai-chat-input"
              data-testid="interaction-ai-chat-input"
              onSubmit={(event) => {
                event.preventDefault();
                if (!inputValue.trim()) return;
                if (props.onSubmitAiChat?.(inputValue)) setInputValue("");
              }}
            >
              <textarea
                autoFocus
                aria-label="想对当前角色说什么，或希望聊什么？"
                maxLength={1_000}
                placeholder="直接输入本轮对话内容或语义……"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
              />
              <button
                type="submit"
                className="interaction-box__btn interaction-box__btn--ai-chat-send"
                disabled={!inputValue.trim()}
              >
                [发送]
              </button>
            </form>
          )}

          <div className="interaction-box__controls" data-testid="interaction-controls">
          <div className="interaction-box__grid" data-testid="interaction-actions">
            {!inScene && more && (
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
            {(!inScene || canCloseEmptyScene) && !more && !hasChoice && !props.aiPending && (
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

          {props.onRespondAccompany && shownCount >= lines.length && typed.done && !props.pendingChoice && (
            <DialogueAccompanyChoices state={props.state} target={props.aiCharaNum}
              pending={props.aiPending} onRespond={props.onRespondAccompany} />
          )}
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
              ) : hasAiChoice ? (
                <div className="interaction-box__ai-choice" data-testid="interaction-ai-choice">
                  {aiChoiceLine!.aiChoice!.options.map((option, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="interaction-box__btn interaction-box__btn--choice"
                      data-testid={`interaction-ai-choice-${idx}`}
                      disabled={branchPending}
                      onClick={() => {
                        const option = aiChoiceLine!.aiChoice!.options[idx];
                        const epoch = branchEpoch.current;
                        const reveal = () => { setSelectedAiChoice(idx); setRevealed(baseLines.length + 1); };
                        const result = props.onPickAiBranch?.(option.label, option.lines.map((line) => ({
                          kind: "DIALOGUE_LINE" as const,
                          timestamp: aiChoiceLine?.timestamp ?? Date.now(),
                          charaNum: aiChoiceLine?.charaNum ?? props.aiCharaNum ?? 0,
                          text: line.text,
                          form: line.form,
                          origin: "ai" as const,
                        })));
                        if (result instanceof Promise) {
                          setBranchPending(true);
                          void result.then(ok => {
                            if (epoch !== branchEpoch.current) return;
                            setBranchPending(false);
                            if (ok) reveal();
                          }).catch(() => { if (epoch === branchEpoch.current) setBranchPending(false); });
                        } else reveal();
                      }}
                    >
                      [{idx + 1}] {option.label}
                    </button>
                  ))}
                </div>
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
