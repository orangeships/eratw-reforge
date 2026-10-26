/**
 * `@F衣装セットN(ARG, …)` — the per-character variants of the three date
 * outfit sets that declare one.
 *
 * `GETMETH` dispatches to the `@F衣装セットN` function when it exists
 * (`fromEN/QOL/QOL_CLOTHES_MISC.ERB:52` passes the character as the first
 * argument), and to the plain `@衣装セットN` — the table
 * `outfit-sets.generated.ts` holds — when it does not. All 122 sets ship an F
 * function, but only three of the twelve reachable from a date actually
 * *branch*, and only these are worth modelling; the rest return the same
 * pieces the base table already carries.
 *
 * ## Resolved upstream semantics
 *
 * Both inputs these variants read turned out to be well-defined, so this is a
 * faithful port rather than a guess:
 *
 * - **`DAY:2` is the season**, 1=春 2=夏 3=秋 4=冬 (`天候システム.ERH:885-888`,
 *   `#DIM CONST 季节_春 = 1` … `季节_冬 = 4`). Confirmed by three independent
 *   call sites: `Chara_data_17_アリス.ERB:17` fires on `(季1, 1日) ||
 *   (季4, 31日)` = New Year's Day/Eve, `GMF_MOVEMENTS.ERB:727` rewards
 *   `季冬 && 31日` as 年底大扫除, and `GMF`/`BEFORETRAIN` spell the same slot
 *   `DAY:季節`. This matches the existing kojo router, which already resolves
 *   `DAY:2` to `state.time.season`.
 * - **`FLAG:2` is `長筒襪着用`** (`AutoConst_FLAG.ERH:10`,
 *   `#DIM CONST FLAG_長筒襪着用 = 2`) — a *global option*, toggled in
 *   `OPTION.ERB:511` (`FLAG:長筒襪着用 = !FLAG:長筒襪着用`), not a per-character
 *   worn state. The modern runtime never sets it, so it reads 0 and the socks
 *   arm below is the default.
 *
 * ## Why the socks arm must be set even when the flag is off
 *
 * Sets 76 / 92 have **no `襪子` entry at all** in the base table — the F
 * function is the only place socks are chosen, and its `ELSE` arm is 袜子.
 * Writing the override only when the flag is on would leave the slot empty and
 * so bare-legged, which is the opposite of upstream.
 */

import type { GameState } from "../state/game-state.js";
import { CFLAG_ID, EQUIP_SLOT, FLAG_ID } from "../state/settlement.js";
import { clothingIdByName } from "../state/clothing-catalog.js";

function piece(slot: number, name: string): number {
  const id = clothingIdByName(slot as never, name);
  if (id === undefined) {
    throw new Error(
      `outfit-f-variants: 「${name}」 is not in clothing-catalog.ts for slot ${slot} — ` +
        `regenerate it with \`pnpm run build-clothing-catalog\`.`,
    );
  }
  return id;
}

/**
 * Effective pieces for `setId` = base table + F-variant slots.
 *
 * Returns `undefined` when the set has no branch to apply, which is the common
 * case and lets the caller skip the merge entirely.
 */
export function fVariantPieces(
  setId: number,
  state: Readonly<GameState>,
): Record<number, number> | undefined {
  const season = state.time.season ?? 1;
  const thighHighs = (state.flagStore[FLAG_ID.长筒襪着用] ?? 0) > 0;
  const out: Record<number, number> = {};
  let touched = false;
  const put = (slot: number, name: string): void => {
    out[slot] = piece(slot, name);
    touched = true;
  };

  switch (setId) {
    case 72: // 猯藏和装 — マミゾウ (69). Winter adds 羽织 + 围巾.
      if (season === 4) put(EQUIP_SLOT.其他２, "围巾");
      if (season === 4 || season === 3) put(EQUIP_SLOT.外搭, "羽织");
      break;
    case 76: // 外出女仆套装 — 咲夜 (15)
    case 92: // 盛装和服套装 — 龍 (140)
      // Both declare socks *only* here; the ELSE arm is not a no-op.
      put(EQUIP_SLOT.襪子, thighHighs ? "吊带袜" : "袜子");
      break;
    default:
      return undefined;
  }
  return touched ? out : undefined;
}

/** Kept for readers: the raw `CFLAG` alias of the base set id, referenced by
 *  `@OKIGAE` when a set is restored. Exported so tests can assert the two
 *  stay in step after an F-variant apply. */
export const OUTFIT_SET_CFLAG = CFLAG_ID.基本服装SET;
