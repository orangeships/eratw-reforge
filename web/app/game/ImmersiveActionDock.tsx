import type { CommandGridAction } from "./CommandGrid.js";

export interface ImmersiveActionDockProps {
  actions: ReadonlyArray<CommandGridAction>;
  hasMap: boolean;
  mapOpen: boolean;
  movementBlocked: boolean;
  secondaryOpen: boolean;
  timeStopped: boolean;
  onAction: (commandNo: number) => void;
  onOpenMap: () => void;
  onToggleTimeStop: () => void;
  onToggleSecondary: () => void;
}

/**
 * A small contextual action dock. It never changes command availability; it
 * only projects the same live actions into a quieter player-facing surface.
 */
export default function ImmersiveActionDock(props: ImmersiveActionDockProps) {
  return (
    <nav className="immersive-action-dock" data-testid="immersive-action-dock" aria-label="当前行动">
      <div className="immersive-action-dock__actions">
        {props.actions.length === 0 ? (
          <span className="immersive-action-dock__empty">暂时没有可用行动</span>
        ) : (
          props.actions.map((action) => (
            <button
              key={action.commandNo}
              type="button"
              className={
                "immersive-action-dock__action" +
                (action.highlighted ? " immersive-action-dock__action--highlighted" : "")
              }
              data-testid="immersive-action-button"
              data-command-no={action.commandNo}
              disabled={props.movementBlocked || !action.usable}
              title={action.usable ? undefined : action.reason}
              onClick={() => props.onAction(action.commandNo)}
            >
              {action.label}
            </button>
          ))
        )}
      </div>

      <div className="immersive-action-dock__tools">
        {props.hasMap && (
          <button
            type="button"
            className="immersive-action-dock__tool"
            data-testid="immersive-map-button"
            disabled={props.movementBlocked}
            onClick={props.onOpenMap}
          >
            {props.mapOpen ? "返回场景" : "移动"}
          </button>
        )}
        {(props.secondaryOpen || props.timeStopped) && (
          <button
            type="button"
            className={
              "immersive-action-dock__tool" +
              (props.timeStopped ? " immersive-action-dock__tool--active" : "")
            }
            data-testid="immersive-time-stop"
            aria-pressed={props.timeStopped}
            disabled={props.movementBlocked}
            onClick={props.onToggleTimeStop}
          >
            {props.timeStopped ? "解除时间停止" : "暂停时间"}
          </button>
        )}
        <button
          type="button"
          className="immersive-action-dock__tool immersive-action-dock__tool--more"
          data-testid="immersive-secondary-toggle"
          aria-expanded={props.secondaryOpen}
          onClick={props.onToggleSecondary}
        >
          {props.secondaryOpen ? "收起更多" : "更多行动"}
        </button>
      </div>
    </nav>
  );
}
