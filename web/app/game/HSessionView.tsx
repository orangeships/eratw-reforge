import { useEffect, useRef } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { TrainingSession } from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { describeClothing } from "../../../modernization/runtime/state/clothing.js";
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import portraits from "./portraits.bundle.json";
import SpriteCrop from "./SpriteCrop.js";
import MobPortrait from "./MobPortrait.js";
import CommandGrid, { type CommandGridAction } from "./CommandGrid.js";
import { HSessionStatus, HTrainingStats } from "./GameStatusBar.js";
import { formatGameEvent } from "./event-format.js";
import { isInteractionVisibleEvent, isMovementNarration } from "./player-visible-events.js";
import { KOJO_COLORS } from "./kojo-colors.js";
import {
  dimensionForKind,
  portraitForClothing,
  portraitForCommand,
  portraitForExpression,
  portraitForState,
  portraitKind,
  portraitSourceForState,
  statePortraitExpression,
  type PortraitSource,
} from "./portrait-expression.js";
import { portraitWithOutfit } from "./portrait-special-outfit-runtime.js";
import { checkNude } from "../../../modernization/runtime/state/portrait-outfit-context.js";
import { lookHSceneProse } from "../../../modernization/runtime/world/h-scene-prose.js";

const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;

export interface HSessionViewProps {
  state: GameState;
  session: Pick<TrainingSession, "target" | "mode" | "startedAtTick">;
  closing: boolean;
  actions: ReadonlyArray<CommandGridAction>;
  filters: ReadonlyArray<{ toggleId: number; label: string; on: boolean }>;
  exitControls: ReadonlyArray<{ commandNo: number; label: string; detail: string }>;
  onAction: (commandNo: number) => void;
  onToggleFilter?: (toggleId: number, target: number) => void;
  /** Completed command history followed by the current live transcript. */
  events: ReadonlyArray<ObservationEvent>;
  currentEvents?: ReadonlyArray<ObservationEvent>;
  onOpenAiSettings?: () => void;
  onClose?: () => void;
  commandNo: number | null;
  choices?: ReadonlyArray<{ label: string }> | null;
  onPickChoice?: (index: number) => void;
  /** Pending prompt or asynchronous authoring work. A choice pause is handled separately. */
  reading: boolean;
}

/** The persisted training session owns H state; this component only presents its current result. */
export default function HSessionView(props: HSessionViewProps) {
  const { state, session } = props;
  const narrativeRef = useRef<HTMLElement>(null);
  const followTailRef = useRef(true);
  useEffect(() => {
    const panel = narrativeRef.current;
    if (panel && followTailRef.current) panel.scrollTop = panel.scrollHeight;
  }, [props.events, props.choices]);
  const target = state.charas[session.target];
  const targetName = target?.callName ?? target?.name ?? `角色${session.target}`;
  const visibleEvents = props.events.filter((event) =>
    (event.kind === "NARRATION" && isInteractionVisibleEvent(event)) || event.kind === "DIALOGUE_LINE"
      || (event.kind === "STATUS_MESSAGE" && event.presentation === "command-feedback"),
  );
  const source = portraitForState(state, session.target, portraitSourceForState(state, session.target, PORTRAITS));
  const dimension = dimensionForKind(source, portraitKind(state));
  const clothing = target ? describeClothing(target) : null;
  // 裸/服分支统一走上游 `CHECK_NUDE` 口径（`IMAGE.ERB:898-910`），**不看内衣**。
  // 原来这里用 `describeClothing(target).naked`（上下衣 + 两种内衣全空才算裸），
  // 比上游严格 —— 「只穿内衣」时会与上游选到不同的服装段，进而与换装判定错配。
  // 与 `portrait-outfit-context.ts` 的换装判定同源，两者不会再分叉。
  const naked = session.target === 0 ? checkNude(state, 0) : checkNude(state, session.target);
  const clothingDimension = portraitForClothing(dimension, naked);
  // 特殊服装：上游 `QOL_IMAGE.ERB:945-950` 的「服装段 = 裸/服 + `_` + token」，
  // 必须在选完服装分支之后、选表情之前套上 —— 表情裁切是跟着服装走的。
  // 返回 clothingDimension 表示「这一帧没换装，或这个包里没这套的图」，
  // 那正是上游缺图回退到 `%表示形式%_服_通常_NO` 的行为。
  const outfitDimension = portraitWithOutfit(state, session.target, source, clothingDimension, naked);
  const commandImageEvent = [...(props.currentEvents ?? props.events)].reverse().find(
    (event): event is Extract<ObservationEvent, { kind: "KOJO_HOST_EVENT" }> =>
      event.kind === "KOJO_HOST_EVENT" && event.operation === "host-call" && event.name === "DISPLAY_COM_IMAGE",
  );
  // Upstream DISPLAY_COM_IMAGE receives SELECTCOM. Prefer that authored
  // presentation request, then the command which owns this transcript.
  const displayCommandNo = commandImageEvent?.args?.[0] ?? props.commandNo;
  const commandPortrait = displayCommandNo == null
    ? undefined
    : portraitForCommand(dimension, displayCommandNo, naked);
  const expression = statePortraitExpression(state, session.target);
  const expressionPortrait = portraitForExpression(
    outfitDimension,
    expression,
  );
  // A matching authored pose is the normal fallback. When QOL has a state
  // expression crop for the active clothing, show it so desire/climax and
  // emotion continue to track the current H state instead of freezing on the
  // last command still.
  const hasStateExpression = expression !== "normal" && expressionPortrait !== outfitDimension;
  const portrait = hasStateExpression
    ? expressionPortrait
    : commandPortrait ?? expressionPortrait;
  const dynamicPortrait = portraitForDynamicCharacter(state, session.target);
  const clothingSummary = clothing?.naked
    ? "全裸"
    : clothing?.lines.length
      ? `${clothing.lines.slice(0, 2).map((line) => line.value).join(" · ")}${clothing.lines.length > 2 ? `等${clothing.lines.length}件` : ""}`
      : "衣着未记录";
  const hasChoice = Boolean(props.choices?.length);
  const commandsLocked = props.closing || props.reading || hasChoice;
  const bodyProse = props.closing ? [] : lookHSceneProse(state, session.target);

  return (
    <section className={`h-session-view${bodyProse.length ? " h-session-view--body-prose" : ""}`} data-testid="h-session-view" aria-label="H 会话">
      <div className="h-session-view__stage">
        <aside className="h-session-view__character" aria-label="当前对象">
          <div className="h-session-view__portrait" data-testid="h-session-portrait" data-chara={session.target}>
            {dynamicPortrait ? (
              <MobPortrait className="h-session-view__portrait-image" portrait={dynamicPortrait} alt={targetName} testId="h-session-mob-portrait" />
            ) : portrait ? (
              <SpriteCrop className="h-session-view__portrait-image" source={portrait} alt={targetName} frameWidth={170} frameHeight={250} cropTestId="h-session-portrait-crop" imageTestId="h-session-portrait-img" />
            ) : (
              <div className="h-session-view__portrait-fallback" role="img" aria-label={`${targetName}暂无立绘`}>{targetName}</div>
            )}
          </div>
          <div className="h-session-view__character-caption">
            <strong>{targetName}</strong>
            <span data-testid="h-session-clothing">{clothingSummary}</span>
          </div>
          <HTrainingStats state={state} target={session.target} />
        </aside>

        <main ref={narrativeRef} className="h-session-view__narrative" data-testid="h-session-narrative" onScroll={() => {
          const panel = narrativeRef.current;
          if (panel) followTailRef.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 48;
        }}>
          {visibleEvents.length > 0 ? visibleEvents.map((event, index) => (
            <p
              key={`${event.timestamp}:${event.kind}:${index}`}
              className={`scene-view__line scene-view__line--${event.kind}${isMovementNarration(event) ? " scene-view__line--movement" : ""}${event.kind === "NARRATION" && event.surface !== undefined ? ` scene-view__line--${event.surface} scene-view__line--${event.surface}-${event.tone ?? "plain"}` : ""}`}
              data-event-kind={event.kind}
              data-testid="h-session-event"
              style={event.kind === "DIALOGUE_LINE" && KOJO_COLORS[event.charaNum]
                ? { color: KOJO_COLORS[event.charaNum] }
                : undefined}
            >
              {event.kind === "STATUS_MESSAGE" ? event.text : formatGameEvent(event, state)}
            </p>
          )) : (
            <p className="h-session-view__empty">选择指令后，地文和口上会在这里显示。</p>
          )}
          {hasChoice && (
            <div className="h-session-view__choices" role="group" aria-label="口上选项">
              {props.choices!.map((choice, index) => (
                <button key={`${index}:${choice.label}`} type="button" disabled={props.reading || props.closing} onClick={() => props.onPickChoice?.(index)}>
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </main>

        <aside className="h-session-view__status" data-testid="h-session-state-panel">
          {props.closing
            ? <p>会话已结束。衣着与装备按实际结果保留。</p>
            : <HSessionStatus state={state} focusedTarget={session.target} showGauges={false} />}
          {bodyProse.length > 0 && (
            <section className="h-session-view__body-prose" data-testid="h-session-body-prose" aria-label="当前身体状态">
              {bodyProse.map((section) => (
                <p key={section.id} data-testid={`h-scene-${section.id}`}>
                  <strong>【{section.title}】</strong>{section.text}
                </p>
              ))}
            </section>
          )}
          {props.onOpenAiSettings && <button type="button" className="h-session-view__settings" data-testid="h-ai-settings" onClick={props.onOpenAiSettings}>AI 设置</button>}
          {props.closing && props.onClose && <button type="button" className="h-session-view__settings" data-testid="h-session-close" onClick={props.onClose}>返回场景</button>}
        </aside>
      </div>

      {!props.closing && (
        <div className="h-session-view__commands">
          <div className="h-session-view__command-top">
            <div className="h-exit-controls" data-testid="h-exit-controls" role="group" aria-label="H 会话控制">
              {props.exitControls.map((control) => (
                <button key={control.commandNo} type="button" className="h-exit-controls__button" data-testid={`h-exit-${control.commandNo}`} data-command-no={control.commandNo} title={control.detail} disabled={commandsLocked} onClick={() => props.onAction(control.commandNo)}>
                  {control.label}
                </button>
              ))}
            </div>
          </div>
          {props.filters.length > 0 && (
            <div className="command-filter-row" data-testid="command-filter-row">
              <span className="command-filter-row__label">过滤</span>
              {props.filters.map((filter) => (
                <button key={filter.toggleId} type="button" className={`command-filter-row__btn${filter.on ? "" : " command-filter-row__btn--off"}`} data-testid="filter-toggle" data-toggle-id={filter.toggleId} data-on={filter.on} disabled={commandsLocked} onClick={() => props.onToggleFilter?.(filter.toggleId, session.target)}>
                  [{filter.label}]
                </button>
              ))}
            </div>
          )}
          {props.actions.length > 0 ? (
            <CommandGrid
              exits={[]}
              actions={props.actions.map((action) => commandsLocked
                ? { ...action, usable: false, reason: "请先完成当前对话" }
                : action)}
              showExits={false}
              showActionGroupLabels={false}
              onExit={() => undefined}
              onAction={props.onAction}
            />
          ) : <p className="h-session-view__empty">当前没有可用指令。可以结束会话。</p>}
        </div>
      )}
    </section>
  );
}
