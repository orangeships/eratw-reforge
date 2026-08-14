/**
 * PortraitCommissionBadge — a small "?" bubble overlaid on a chara's
 * SceneView portrait when the character has any commission-related state.
 *
 * Tone mapping (matches eraTW intent):
 *   - 未受託 (green): someone has a new request waiting
 *   - 依頼中  (blue):  you've accepted; act on it
 *   - 報告待ち (yellow): done / failed / expired / missed — please report
 *
 * The badge click stops propagation so it doesn't also fire the parent's
 * portrait-select handler. All visual + behaviour mirrors a button; we
 * render <button> for keyboard accessibility.
 */

import type {
  GameState,
  CommissionProgress,
} from "../../../modernization/runtime/state/game-state.js";
import {
  COMMISSION_PROGRESS,
  commissionStatus,
} from "../../../modernization/runtime/state/commission.js";

export type CommissionBadgeTone = "green" | "blue" | "yellow";

export interface PortraitCommissionBadgeProps {
  state: Readonly<GameState>;
  charaNum: number;
  /** Click → opens CommissionPopup for this chara. */
  onClick: (charaNum: number) => void;
  /** Override tone resolution (used in tests). */
  resolveTone?: (status: CommissionProgress | 0) => CommissionBadgeTone | null;
}

export function portraitCommissionTone(status: CommissionProgress | 0): CommissionBadgeTone | null {
  switch (status) {
    case COMMISSION_PROGRESS.Offered:
      return "green";
    case COMMISSION_PROGRESS.Active:
      return "blue";
    case COMMISSION_PROGRESS.Completed:
    case COMMISSION_PROGRESS.Expired:
    case COMMISSION_PROGRESS.MissedReport:
    case COMMISSION_PROGRESS.Failed:
      return "yellow";
    default:
      return null;
  }
}

export default function PortraitCommissionBadge(
  props: PortraitCommissionBadgeProps,
): JSX.Element | null {
  const status = commissionStatus(props.state, props.charaNum);
  const tone = props.resolveTone
    ? props.resolveTone(status)
    : portraitCommissionTone(status);
  if (!tone) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className={`portrait-badge portrait-badge--${tone}`}
      data-testid="portrait-commission-badge"
      data-tone={tone}
      data-chara={props.charaNum}
      aria-label="委托"
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(props.charaNum);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          props.onClick(props.charaNum);
        }
      }}
    >
      ?
    </span>
  );
}