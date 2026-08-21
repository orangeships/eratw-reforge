/**
 * P4 — COMF401 收藏 (panty collection transfer).
 *
 * Upstream: `COMF401 コレクション.ERB` — transfers PANTS_TEMP (in-hand
 * panties) to permanent CFLAG storage (CFLAG:chara:[id + 100]).
 *
 * Gate (@COM_ABLE401):
 *   - Must be at home base
 *   - FLAG:胖次輸送 must be set (panties in transit)
 *   - Not in 诶嘿嘿 mode
 *
 * Body: iterate all charas × panty types 0..MAXPANTS, move each count
 *   from PANTS_TEMP to CFLAG, update FLAG:700 species count, reset
 *   FLAG:胖次輸送.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { CFLAG_ID, getMasterCflag } from "../../state/settlement.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  hasPantsInTransit,
  commitPantsCollection,
} from "../../state/panty-collection.js";

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

export const comf401HandlerEntry: HandlerEntry = {
  commandNo: 401,
  gateStatus: "complete",
  gateDiagnostics: ["home location", "FLAG:胖次輸送", "not H mode"],
  execCheck: (ctx) => {
    if (ctx.actor !== 0) return block("主人公だけが実行できます。");
    // At home base
    const masterLoc = ctx.state.master.location;
    const homeLoc = ctx.state.homeLocation ?? ctx.state.master.homeLocation;
    if (!homeLoc || masterLoc !== homeLoc) {
      return block("自宅でのみ実行できます。");
    }
    if (!hasPantsInTransit(ctx.state as GameState)) {
      return block("輸送中の胖次がありません。");
    }
    if (getMasterCflag(ctx.state as GameState, CFLAG_ID.诶嘿嘿) === 2) {
      return block("诶嘿嘿中です。");
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state as GameState);
    const lines = commitPantsCollection(next);
    return {
      state: next,
      events: lines.map((text) => ({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text,
      })),
      outcome: "ok" as const,
    };
  },
};
