/**
 * Phase 7.5 — `COMF440 待つ` (wait), as a `ComfDef`.
 *
 * Ports the core of `@COM440`
 * (`ERB/コマンド関連/COMF/日常系/COMF440 待つ.ERB`).
 *
 *   DOWNBASE:MASTER:気力 = 50
 *   TIME += 20
 *   RETURN 1
 *
 * Master-centric (`requiresTarget: false`), no SOURCE, no outcome roll —
 * pinned to 通常. The whole effect is a small 気力 drain + 20-min time
 * advance; nothing else. Sibling of 495 空を眺める (the trivial-wait pair).
 *
 * **Modeled `@COM_ABLE440` gates:**
 *   - `BASE:MASTER:気力 > 0`, `CFLAG:MASTER:诶嘿嘿 == 0`, `FLAG:70 == 0`.
 *   - Location gate: base entrances (`CHK_ENTRANCE`) + selected public
 *     field-map spots (see `wait-spot.ts`).
 *
 * **DEFERRED (documented, all in `@COM_ABLE440`):**
 *   - `TFLAG:100` shop-screen gate, `GLOBAL_COMABLE(440)` batch gate,
 *     save-level command overrides. The `FLAG:70==1` TSP-drain arm is
 *     commented out upstream.
 *   - `@COM440_TAGS` sets `BIT_風チラあり` (a catalog tag for the
 *     wind-flutter system) — not part of `@COM440`'s body; deferred.
 */
import type { HandlerEntry } from "../../types.js";
import { BASE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf440Def: ComfDef = {
  commandNo: 440,
  label: "待つ",

  requiresTarget: false,

  gate: { notWhileMasterHMode: true, requiresWaitSpot: true },

  // No outcome roll — pin to 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 20, // ERB 10

  // No SOURCE — pure wait.
  buildSources: () => ({}),

  // ERB 6: DOWNBASE:MASTER:気力 = 50.
  downbase: { [BASE_ID.気力]: 50 },

  narration: () => `%CALLNAME:MASTER% 等待了一会儿.`,
};

export const comf440HandlerEntry: HandlerEntry = makeComfHandler(comf440Def);
