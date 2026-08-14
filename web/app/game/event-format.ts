import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { formatEvent } from "../components/TextWindow.js";

export function substituteMasterName(text: string, state: Readonly<GameState>): string {
  const masterName = state.master.callName?.trim();
  if (!masterName || masterName === "主人公") return text;
  return text.replace(/主人公/g, masterName);
}

export function formatGameEvent(
  event: ObservationEvent,
  state: Readonly<GameState>,
): string {
  return substituteMasterName(formatEvent(event), state);
}
