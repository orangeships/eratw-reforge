/**
 * CommissionPopup — dedicated UI for character commissions.
 *
 * Replaces the [366]/[367] commands in the ActCom grid. The SceneView
 * portrait surfaces a "?" badge when the chara has any commission-related
 * state; clicking the badge opens THIS popup for that chara.
 *
 * Lifecycle:
 *   - 玩家点 [接受/拒绝/确认/破弃/执行委托/报告]
 *   - popup 内部调 `applyIntent(state, intent)` 拿 events
 *   - events 写入 popup 右侧"口上面板"立即显示
 *   - 同时 `onIntent(intent)` 提交 store 更新
 *   - popup 进入 done 模式，玩家点 [关闭] → onClose
 *
 * Kojo display 复用既有 `dialogueRouter.resolveIraiKojo`（via handler）。
 * 我们不重新调 kojo 路由，直接展示 handler 流出来的事件。
 */

import { useMemo, useState } from "react";
import type { AgentIntent, IssueCommandIntent } from "../../../modernization/schemas/types.js";
import type {
  GameState,
  CharaSlot,
  CommissionProgress,
} from "../../../modernization/runtime/state/game-state.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { applyIntent } from "../../../modernization/runtime/intent/apply-intent.js";
import {
  COMMISSION_PROGRESS,
  acceptBlockDescription,
  canAcceptCommission,
  commissionActName,
  commissionStatus,
  commissionTitleForTarget,
  describeCommission,
  searchActiveCommissionSlot,
} from "../../../modernization/runtime/state/commission.js";
import { pickOneAnswer } from "../../../modernization/runtime/command/prompt.js";
import kojoColors from "./kojo-colors.bundle.json";

const KOJO_COLORS = kojoColors as Record<string, string>;

export interface CommissionPopupProps {
  state: Readonly<GameState>;
  charaNum: number;
  onIntent: (intent: AgentIntent) => void;
  onClose: () => void;
}

type Mode = "view" | "done";

function buildIntent(
  commandNo: number,
  charaNum: number,
  answerKind: "accept" | "decline" | "confirm" | "abandon" | "execute" | "report" | null,
): IssueCommandIntent {
  const intent: IssueCommandIntent = {
    kind: "ISSUE_COMMAND",
    actor: 0,
    commandNo,
    target: charaNum,
  };
  if (answerKind !== null) intent.promptAnswer = pickOneAnswer(answerKind);
  return intent;
}

function charaCallName(state: Readonly<GameState>, charaNum: number): string {
  const slot: CharaSlot | undefined = state.charas[charaNum];
  return slot?.callName ?? `角色${charaNum}`;
}

function statusToButtons(
  status: CommissionProgress | 0,
  hasActiveSlot: boolean,
): { primary: { kind: "accept" | "confirm" | "execute" | "report"; label: string } | null;
     secondary: { kind: "decline" | "abandon"; label: string } | null;
     noAction: boolean } {
  if (status === COMMISSION_PROGRESS.Offered) {
    return { primary: { kind: "accept", label: "接受委托" }, secondary: { kind: "decline", label: "拒绝" }, noAction: false };
  }
  if (status === COMMISSION_PROGRESS.Active) {
    if (hasActiveSlot) {
      return { primary: { kind: "execute", label: "执行委托" }, secondary: { kind: "abandon", label: "破弃" }, noAction: false };
    }
    return { primary: { kind: "confirm", label: "确认" }, secondary: { kind: "abandon", label: "破弃" }, noAction: false };
  }
  if (
    status === COMMISSION_PROGRESS.Completed ||
    status === COMMISSION_PROGRESS.Expired ||
    status === COMMISSION_PROGRESS.MissedReport ||
    status === COMMISSION_PROGRESS.Failed
  ) {
    return { primary: { kind: "report", label: "报告" }, secondary: null, noAction: false };
  }
  return { primary: null, secondary: null, noAction: true };
}

function statusToTitle(status: CommissionProgress | 0): string {
  switch (status) {
    case COMMISSION_PROGRESS.Offered: return "委托未接";
    case COMMISSION_PROGRESS.Active: return "委托已接";
    case COMMISSION_PROGRESS.Completed: return "委托已达成";
    case COMMISSION_PROGRESS.Expired: return "委托过期";
    case COMMISSION_PROGRESS.MissedReport: return "报告遗忘";
    case COMMISSION_PROGRESS.Failed: return "委托失败";
    default: return "委托";
  }
}

export default function CommissionPopup(props: CommissionPopupProps): JSX.Element {
  const { state, charaNum, onIntent, onClose } = props;
  const status = commissionStatus(state, charaNum);
  const hasActiveSlot = !!searchActiveCommissionSlot(state, charaNum);
  const buttons = statusToButtons(status, hasActiveSlot);
  const title = statusToTitle(status);
  const popupTitle = commissionTitleForTarget(state, charaNum);
  const actName = hasActiveSlot ? commissionActName(state, charaNum) : null;

  const [mode, setMode] = useState<Mode>("view");
  const [events, setEvents] = useState<ReadonlyArray<ObservationEvent>>([]);

  // Detail panel content — re-derive on each render so post-action state is
  // reflected immediately (we capture events + commit intent below).
  const detailLines = useMemo(() => describeCommission(state, charaNum), [state, charaNum]);

  // When Offered, check whether the player can actually accept right now.
  const canAccept =
    status === COMMISSION_PROGRESS.Offered
      ? canAcceptCommission(state, charaNum)
      : false;
  const blockReason =
    status === COMMISSION_PROGRESS.Offered && !canAccept
      ? acceptBlockDescription(state, charaNum)
      : null;

  const handleAction = (kind: "accept" | "decline" | "confirm" | "abandon" | "execute" | "report"): void => {
    // 366 handles accept/decline/confirm/abandon/report; 367 only handles execute.
    const commandNo = kind === "execute" ? 367 : 366;
    const intent = buildIntent(commandNo, charaNum, kind);
    const result = applyIntent(state, intent);
    setEvents(result.appended);
    onIntent(intent);
    setMode("done");
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="commission-popup-scrim"
      data-testid="commission-popup"
      role="dialog"
      aria-modal="true"
      aria-label={`${charaCallName(state, charaNum)} 的委托`}
      onClick={handleBackdrop}
    >
      <div className="commission-popup" data-chara={charaNum}>
        <header className="commission-popup__header">
          <div className="commission-popup__title">
            <span className="commission-popup__title-chara">{charaCallName(state, charaNum)}</span>
            <span className="commission-popup__title-sep">——</span>
            <span className="commission-popup__title-status">{popupTitle}</span>
            <span className="commission-popup__title-progress">· {title}</span>
            {actName && <span className="commission-popup__title-act">· {actName}</span>}
          </div>
          <button
            type="button"
            className="commission-popup__close"
            data-testid="commission-popup-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="commission-popup__body">
          <section className="commission-popup__detail" data-testid="commission-popup-detail">
            <h3>委托内容</h3>
            <ul className="commission-popup__detail-list">
              {detailLines.map((line, i) => (
                <li key={i} className="commission-popup__detail-line">{line}</li>
              ))}
            </ul>
          </section>

          <section className="commission-popup__kojo" data-testid="commission-popup-kojo">
            <h3>对话</h3>
            {mode === "view" && events.length === 0 ? (
              <p className="commission-popup__kojo-empty">（选择一个动作以查看回应）</p>
            ) : (
              <ul className="commission-popup__kojo-list">
                {events.map((e, i) => {
                  const color = e.kind === "DIALOGUE_LINE"
                    ? KOJO_COLORS[String(e.charaNum)]
                    : undefined;
                  return (
                    <li
                      key={i}
                      className={`commission-popup__kojo-line commission-popup__kojo-line--${e.kind}`}
                      style={color ? { color } : undefined}
                    >
                      {formatKojoEvent(e)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <footer className="commission-popup__footer">
          {mode === "view" ? (
            buttons.noAction ? (
              <button
                type="button"
                className="commission-popup__btn commission-popup__btn--close"
                onClick={onClose}
              >
                关闭
              </button>
            ) : (
              <>
                {buttons.primary && (
                  <button
                    type="button"
                    className="commission-popup__btn commission-popup__btn--primary"
                    data-testid={`commission-popup-primary-${buttons.primary.kind}`}
                    onClick={() => handleAction(buttons.primary!.kind)}
                    disabled={!canAccept && buttons.primary.kind === "accept"}
                    title={blockReason ?? undefined}
                  >
                    {buttons.primary.label}
                  </button>
                )}
                {buttons.secondary && (
                  <button
                    type="button"
                    className="commission-popup__btn commission-popup__btn--secondary"
                    data-testid={`commission-popup-secondary-${buttons.secondary.kind}`}
                    onClick={() => handleAction(buttons.secondary!.kind)}
                  >
                    {buttons.secondary.label}
                  </button>
                )}
                {blockReason && (
                  <p className="commission-popup__block-reason">{blockReason}</p>
                )}
              </>
            )
          ) : (
            <button
              type="button"
              className="commission-popup__btn commission-popup__btn--primary"
              data-testid="commission-popup-done"
              onClick={onClose}
            >
              关闭
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function formatKojoEvent(e: ObservationEvent): string {
  if (e.kind === "DIALOGUE_LINE") {
    return `「${e.text}」`;
  }
  if (e.kind === "NARRATION") {
    return e.text;
  }
  if (e.kind === "STATUS_MESSAGE" && "text" in e) {
    return `⚠ ${e.text}`;
  }
  return "";
}
