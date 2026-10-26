/**
 * CommissionPopup — dedicated UI for character commissions.
 *
 * Supplements the [366]/[367] ActCom commands with a richer report/accept
 * panel. The SceneView portrait surfaces a "?" badge when the chara has
 * commission-related state; clicking the badge opens THIS popup for that
 * chara. The command grid remains the canonical execution surface, which is
 * important for delivery commissions whose recipient is not the client.
 *
 * The popup selects a command; the committed command dialogue is shown by
 * GameClient's InteractionBox so authored kojo and narration share one owner.
 */

import { useMemo, useState } from "react";
import type { AgentIntent, IssueCommandIntent } from "../../../modernization/schemas/types.js";
import type {
  GameState,
  CharaSlot,
  CommissionProgress,
} from "../../../modernization/runtime/state/game-state.js";
import {
  COMMISSION_PROGRESS,
  acceptBlockDescription,
  canAcceptCommission,
  canBringCommissionClient,
  commissionActName,
  commissionStatus,
  commissionTitleForTarget,
  describeCommission,
  findSlotByClient,
  searchActiveCommissionSlot,
} from "../../../modernization/runtime/state/commission.js";
import { liveAvailableCommands } from "../../../modernization/runtime/intent/apply-intent.js";
import { pickOneAnswer } from "../../../modernization/runtime/command/prompt.js";

export interface CommissionPopupProps {
  state: Readonly<GameState>;
  charaNum: number;
  onIntent: (intent: AgentIntent) => void;
  onClose: () => void;
}

type CommissionActionKind = "accept" | "decline" | "confirm" | "abandon" | "execute" | "report" | "take-along";

function buildIntent(
  commandNo: number,
  charaNum: number,
  answerKind: CommissionActionKind | null,
): IssueCommandIntent {
  const intent: IssueCommandIntent = {
    kind: "ISSUE_COMMAND",
    actor: 0,
    commandNo,
    target: charaNum,
  };
  if (answerKind !== null && answerKind !== "take-along") intent.promptAnswer = pickOneAnswer(answerKind);
  return intent;
}

function charaCallName(state: Readonly<GameState>, charaNum: number): string {
  const slot: CharaSlot | undefined = state.charas[charaNum];
  return slot?.callName ?? `角色${charaNum}`;
}

function statusToButtons(
  status: CommissionProgress | 0,
  hasActiveSlot: boolean,
  canTakeAlong: boolean,
): { primary: { kind: "accept" | "confirm" | "execute" | "report" | "take-along"; label: string } | null;
     secondary: { kind: "decline" | "abandon"; label: string } | null;
     noAction: boolean } {
  if (status === COMMISSION_PROGRESS.Offered) {
    return { primary: { kind: "accept", label: "接受委托" }, secondary: { kind: "decline", label: "拒绝" }, noAction: false };
  }
  if (status === COMMISSION_PROGRESS.Active) {
    if (hasActiveSlot) {
      return { primary: { kind: "execute", label: "执行委托" }, secondary: { kind: "abandon", label: "破弃" }, noAction: false };
    }
    if (canTakeAlong) {
      return { primary: { kind: "take-along", label: "带出去" }, secondary: { kind: "abandon", label: "破弃" }, noAction: false };
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
  const commandAvailability = liveAvailableCommands(state, charaNum);
  const reportAvailability = commandAvailability.find((entry) => entry.commandNo === 366);
  const canReport = reportAvailability?.usable === true;
  const hasActiveSlot = !!searchActiveCommissionSlot(state, charaNum);
  const activeSlot = findSlotByClient(state, charaNum);
  // 问题4 — take-along follows the upstream `依頼人連れ出し可能` data slot
  // (FUNC_IRAI.ERB:252) instead of a hard-coded localId. Any ACTIVE
  // canTakeAlong commission client can be brought out (351) when the command
  // is currently usable; if the commission is executable right here the
  // primary action stays 执行委托.
  const canTakeAlong = status === COMMISSION_PROGRESS.Active &&
    activeSlot !== undefined &&
    !hasActiveSlot &&
    canBringCommissionClient(state, charaNum) &&
    commandAvailability.some((entry) => entry.commandNo === 351 && entry.usable);
  const buttons = statusToButtons(status, hasActiveSlot, canTakeAlong);
  const title = statusToTitle(status);
  const popupTitle = commissionTitleForTarget(state, charaNum);
  const actName = hasActiveSlot ? commissionActName(state, charaNum) : null;

  const [actionError, setActionError] = useState<string | null>(null);

  // Detail panel content follows the authoritative state after each command.
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
  const reportBlockReason = !canReport && buttons.primary?.kind === "report"
    ? reportAvailability?.reason?.kind === "precondition"
      ? reportAvailability.reason.message
      : "当前无法向委托人报告。"
    : null;

  const handleAction = (kind: CommissionActionKind): void => {
    if (kind === "report" && !canReport) return;
    // 366 handles accept/decline/confirm/abandon/report; 367 only handles execute.
    const commandNo = kind === "execute" ? 367 : kind === "take-along" ? 351 : 366;
    const availability = commandAvailability.find((entry) => entry.commandNo === commandNo);
    if (!availability?.usable) {
      setActionError(availability?.reason?.kind === "precondition"
        ? availability.reason.message
        : "当前无法执行此委托操作。");
      return;
    }
    const intent = buildIntent(commandNo, charaNum, kind);
    // Settle once in the authoritative store, then read its dialogue session.
    onIntent(intent);
    onClose();
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
            <p className="commission-popup__kojo-empty">{actionError ?? "选择动作后将在对话框中显示回应。"}</p>
          </section>
        </div>

        <footer className="commission-popup__footer">
          {buttons.noAction ? (
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
                    disabled={(!canAccept && buttons.primary.kind === "accept") ||
                      (!canReport && buttons.primary.kind === "report")}
                    title={blockReason ?? reportBlockReason ?? undefined}
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
                {(blockReason || reportBlockReason) && (
                  <p className="commission-popup__block-reason">{blockReason ?? reportBlockReason}</p>
                )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
