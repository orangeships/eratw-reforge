import type { CharaSlotState } from "./game-state.js";
import { EX_ID, TALENT_ID } from "./settlement.js";

export type BodyFillPart = 1 | 2 | 3 | 4 | 5;

function bodyCapacity(bodyType: number): number | null {
  if (bodyType === -5) return 300;
  if (bodyType >= -4 && bodyType <= -2) return 600;
  if (bodyType === -1) return 1000;
  if (bodyType === 0) return 1200;
  if (bodyType > 0) return 1500;
  return null;
}

function semenAmount(
  state: Readonly<CharaSlotState>,
  bodyPart: BodyFillPart,
  cumulative: boolean,
): number {
  const ex = state.EX;
  switch (bodyPart) {
    case 1:
      return ex[cumulative ? EX_ID.膣内精液 : EX_ID.精液残量] ?? 0;
    case 2:
      return ex[cumulative ? EX_ID.肛門内精液 : EX_ID.アナル精液残量] ?? 0;
    case 3:
      return (
        (ex[cumulative ? EX_ID.膣内精液 : EX_ID.精液残量] ?? 0) +
        (ex[cumulative ? EX_ID.肛門内精液 : EX_ID.アナル精液残量] ?? 0)
      );
    case 4:
      return ex[EX_ID.子宮内精液] ?? 0;
    case 5:
      return ex[EX_ID.妊娠判定用精液量] ?? 0;
  }
}

/**
 * Faithful `@充填率` for body parts 1..5. Returns null only when the stored
 * body type falls outside the source function's defined capacity cases.
 */
export function bodyFillRate(
  state: Readonly<CharaSlotState>,
  bodyPart: BodyFillPart,
  cumulative = false,
): number | null {
  const baseCapacity = bodyCapacity(state.TALENT[TALENT_ID.体型] ?? 0);
  if (baseCapacity === null) return null;
  const capacity =
    bodyPart === 4 || bodyPart === 5
      ? Math.trunc(baseCapacity / 2)
      : bodyPart === 3
        ? baseCapacity * 2
        : baseCapacity;
  const semen = semenAmount(state, bodyPart, cumulative);
  const denominator = 2 * capacity + semen;
  if (denominator === 0) return null;
  return Math.trunc((3 * 100 * semen) / denominator);
}
