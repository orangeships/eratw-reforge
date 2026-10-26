/**
 * Phase 7.5 — `COMF495 空を眺める` (gaze at the sky), as a `ComfDef`.
 *
 * Ports the whole of `@COM495`
 * (`ERB/コマンド関連/COMF/日常系/COMF495 空を眺める.ERB`):
 *
 *   TIME += 1
 *   TFLAG:102 = 0
 *   RETURN 0
 *
 * The trivial "free glance" command — 1-min time tick + clears the
 * COMABLE管理 cache flag (`TFLAG:102`, TFLAG.als id=102) so the command
 * availability list recomputes. Master-centric (`requiresTarget: false`),
 * no SOURCE, no outcome roll, no DOWNBASE.
 *
 * **RETURN 0 vs RETURN 1:** upstream returns 0, marking this a *free
 * action* — it does NOT consume the player's main turn at the USERCOM/COMF
 * dispatcher level (no PREVCOM set, no SHOW_INFO follow-up). That turn-
 * accounting distinction lives in the dispatcher, not the `@COM` body; the
 * ComfDef factory models only the body side-effects (TIME+1, TFLAG:102=0)
 * and reports `outcome: "ok"`. The free-action semantics are deferred.
 *
 * **DEFERRED (documented, all in `@COM_ABLE495`):**
 *   - `GLOBAL_COMABLE(495)` batch gate, `TFLAG:100` shop-screen gate,
 *     `FLAG:70` 時間停止, `CFLAG:诶嘿嘿` (ウフフ), `CFLAG:恶作剧`
 *     (睡眠恶作剧), `CFLAG:陪睡中` gates — COM_ABLE arms, owned by the
 *     resolver/catalog layer (deferred). The commented-out 約会中 arm is
 *     deferred upstream too.
 */
import type { HandlerEntry } from "../../types.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { TFLAG_ID, setTflag } from "../../../state/tflag.js";
import { skySceneTextFromState } from "../../../state/weather.js";

export const comf495Def: ComfDef = {
  commandNo: 495,
  label: "空を眺める",

  requiresTarget: false,

  // No outcome roll — pin to 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 1, // ERB 7

  // No SOURCE, no DOWNBASE — the only side write is the flag clear.
  buildSources: () => ({}),

  body: (c) => {
    // ERB 8: TFLAG:102 = 0 (clear COMABLE管理 cache).
    setTflag(c.next, TFLAG_ID.COMABLE管理, 0);
  },

  // @MESSAGE_COM495 describes the sky according to weather. The migrated
  // command uses the current regional weather as its compact fallback prose.
  narration: (c) => `%CALLNAME:MASTER%看向天空。${skySceneTextFromState(c.ctx.state)}`,
};

export const comf495HandlerEntry: HandlerEntry = makeComfHandler(comf495Def);
