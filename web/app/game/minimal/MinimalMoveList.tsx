import { useMemo } from "react";
import { SCENES_BY_LOCATION } from "../scenes.js";
import { findPath } from "../pathfind.js";

export interface MinimalMoveListProps {
  currentLocation: string;
  /** One-step destinations: single move command (handleMapMove, ~1 min). */
  onStep: (commandNo: number) => void;
  onClose: () => void;
  /** movementBlocked || trainingMovementLocked: disable every destination. */
  blocked?: boolean;
}

interface MoveOption {
  location: string;
  label: string;
  commandNo: number;
}

/**
 * Minimal-mode 移动 surface: instead of the full colored-map character grid,
 * list only the destinations ONE step away from the current room (direct
 * exits, per SCENES_BY_LOCATION + findPath), tap to move.
 */
export default function MinimalMoveList(props: MinimalMoveListProps) {
  const { currentLocation, onStep, onClose, blocked } = props;

  const options = useMemo<MoveOption[]>(() => {
    const root = currentLocation.split(":")[0]!;
    const out: MoveOption[] = [];
    for (const [loc, scene] of Object.entries(SCENES_BY_LOCATION)) {
      if (loc === currentLocation || loc.split(":")[0] !== root) continue;
      const path = findPath(currentLocation, loc);
      if (!path || path.length !== 1) continue;
      out.push({
        location: loc,
        label: scene.displayName || (loc.includes(":") ? loc.split(":").slice(1).join(":") : loc),
        commandNo: path[0]!.commandNo,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [currentLocation]);

  const currentLabel = SCENES_BY_LOCATION[currentLocation]?.displayName ?? currentLocation;

  return (
    <section className="minimal-move-list" data-testid="minimal-move-list" aria-label="移动（一步内可达）">
      <header className="minimal-move-list__header">
        <strong>移动</strong>
        <span className="minimal-move-list__current">当前位置：{currentLabel}</span>
        <button type="button" className="minimal-move-list__close" data-testid="minimal-move-close" onClick={onClose}>
          [返回场景]
        </button>
      </header>
      {options.length === 0 ? (
        <p className="minimal-move-list__empty" data-testid="minimal-move-empty">
          （没有可直接前往的地点）
        </p>
      ) : (
        <ul>
          {options.map((option) => (
            <li key={option.location}>
              <button
                type="button"
                className="minimal-move-list__btn"
                data-testid="minimal-move-option"
                data-location={option.location}
                disabled={blocked}
                title={blocked ? "移动遭遇处理完毕前无法移动" : undefined}
                onClick={() => onStep(option.commandNo)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
