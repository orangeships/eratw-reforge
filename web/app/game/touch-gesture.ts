export interface DragDirectionInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  focus: boolean;
}

export interface DragVector {
  x: number;
  y: number;
}

export function clampDragVector(x: number, y: number, radius = 48): DragVector {
  const length = Math.hypot(x, y);
  if (length <= radius || length === 0) return { x, y };
  const scale = radius / length;
  return { x: x * scale, y: y * scale };
}

/**
 * Converts a virtual-stick drag into the same deterministic directional input
 * used by keyboard controls. A short drag is focus movement; pulling farther
 * switches to normal speed without adding another mobile-only button.
 */
export function dragToDirectionalInput(
  x: number,
  y: number,
  deadZone = 8,
  focusRadius = 34,
): DragDirectionInput {
  const length = Math.hypot(x, y);
  if (length <= deadZone) {
    return { left: false, right: false, up: false, down: false, focus: false };
  }
  const axisThreshold = deadZone * 0.65;
  return {
    left: x < -axisThreshold,
    right: x > axisThreshold,
    up: y < -axisThreshold,
    down: y > axisThreshold,
    focus: length < focusRadius,
  };
}
