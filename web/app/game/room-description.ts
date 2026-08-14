/**
 * Private-room description prose — the UI-side trigger for the `_ROOM_DESCRIPTION`
 * personal kojo.
 *
 * Upstream, `@情景描写` (ANOTHER_TALK.ERB:1023) does
 * `TRYCCALLFORM K{NO:KROOM_DESC}%RESULTS%_ROOM_DESCRIPTION` whenever the player
 * is standing inside a chara's own room, and the function's `LOCALS` text
 * becomes the room's ambient description. This helper performs the modern
 * equivalent: resolve the room's owner via `privateRoomOwner`, ask the live
 * dialogue router for that chara's `_ROOM_DESCRIPTION` kojo, and return its
 * prose (or `null` when the room is nobody's private room / not authored).
 *
 * `null` and empty are both "no prose" — the caller falls back to whatever
 * scene prose already exists. The RNG is a stable per-(owner, tick) seed so
 * the ambient line is deterministic within a visit but varies as time passes.
 */
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { privateRoomOwner } from "../../../modernization/runtime/world/private-room.js";

export function privateRoomDescriptionProse(
  state: Readonly<GameState>,
  location: string,
  router: DialogueRouter | undefined,
): string | null {
  if (!router?.resolveRoomDescriptionKojo) return null;
  const owner = privateRoomOwner(state as GameState, location);
  if (owner === null) return null;
  const rng = createRng(owner * 1009 + ((state.time.tickValue % 100000) | 0));
  const lines = router.resolveRoomDescriptionKojo(owner, state, rng);
  if (lines.length === 0) return null;
  const text = lines
    .map((line) => line.text)
    .filter((t) => t && t.trim().length > 0)
    .join("");
  return text.length > 0 ? text : null;
}
