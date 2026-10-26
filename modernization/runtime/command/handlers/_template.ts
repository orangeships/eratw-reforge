/**
 * Phase 7.1 — `_template.ts` shared handler helper.
 *
 * For "light-touch" COMF commands (お茶 / 摸肚 / 拥抱 / 杯交わす / 膝枕 / etc.):
 *   - 1-3 source quanta, simple outcome roll, time advance, kojo dispatch.
 *
 * The helper emits: 1 NARRATION line + any DIALOGUE_LINE returned by
 * the kojo router. State writes are the caller's responsibility
 * (passed in as a `body` callback so each handler can opt in to
 * specific BASE/ABL/CFLAG/EXP/TCVAR deltas).
 *
 * **Why a helper, not a generic dispatcher**: the existing 5D/5E
 * handlers (talk, headpat) carry a lot of inline arithmetic that's
 * not worth generalising yet. `_template.ts` covers the *common*
 * case so the 8 Tier 1+2 commands stay < 40 lines each; commands
 * with rich settlement (SOURCE build, success-rate calculator, etc.)
 * still get a hand-written handler.
 */

import type { CommandContext, CommandResult, ExecCheck, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { kojoHostEventsToObservationEvents } from "../command-kojo.js";
import { compileGate, mergedGateFor } from "../comf/compile-gate.js";
import type { ComfGate } from "../comf/comf-def.js";

export interface SimpleComfOpts {
  commandNo: number;
  /** In-game minutes this command costs. Default: 10. */
  timeDelta?: number;
  /** If true (default), the handler returns a `STATUS_MESSAGE` and
   *  outcome "blocked" when `ctx.target <= 0` or no chara slot exists. */
  requiresTarget?: boolean;
  /** Custom body. Receives the cloned `GameState` plus the TARGET
   *  `CharaSlot` (always present when `body` is called). Mutations
   *  to `next` are visible to the returned result. */
  body?: (next: ReturnType<typeof cloneGameState>, target: { charaNum: number; state: ReturnType<typeof cloneGameState>["charas"][0]["state"] }) => void;
  /** Description used to build the auto-NARRATION line. Defaults
   *  to a generic "X acted on Y" phrasing. */
  narrationLabel?: string;
  /** Explicit `@COM_ABLE` gate fields merged UNDER the auto-extracted gate
   *  (the explicit fields win per-field). Use this to add a gate the
   *  extractor missed (e.g. 334's banquet-participant requirement). */
  gate?: ComfGate;
  /** Optional pre-clone execution check (L2: COMABLE room gating).
   *  Runs before state is cloned — if blocked, no time passes. Wins over
   *  `gate` when both are set. */
  execCheck?: ExecCheck;
}

/** Build a `HandlerEntry` for a light-touch command. The handler
 *  clones state, runs the optional body, advances time, asks the
 *  kojo router for the chara's reaction lines, and returns a
 *  `CommandResult`. */
export function makeSimpleComfHandler(opts: SimpleComfOpts): HandlerEntry {
  const timeDelta = opts.timeDelta ?? 10;
  const requiresTarget = opts.requiresTarget ?? true;
  const label = opts.narrationLabel ?? "interacted with";

  // Apply the faithful @COM_ABLE gate (e.g. 311 抱き付く needs 亲热, 305 膝枕
  // needs 亲热+indoor). An explicit `opts.execCheck` wins; otherwise compile
  // the auto-extracted gate merged under `opts.gate`. These bespoke touch
  // handlers WIN over their ComfDef, so without this they'd skip the gate the
  // ComfDef would have had.
  const execCheck =
    opts.execCheck ?? compileGate(mergedGateFor(opts.commandNo, opts.gate), requiresTarget, label);

  return {
    commandNo: opts.commandNo,
    execCheck,
    handler: (ctx: CommandContext): CommandResult => {
      if (requiresTarget && (ctx.target <= 0 || !ctx.state.charas[ctx.target])) {
        return {
          state: ctx.state as never,
          events: [
            {
              kind: "STATUS_MESSAGE",
              timestamp: ctx.now(),
              source: "system",
              text: `Command ${opts.commandNo} requires a present target.`,
            },
          ],
          outcome: "blocked",
          failReason: { kind: "precondition", message: `no target for command ${opts.commandNo}` },
        };
      }

      let next = cloneGameState(ctx.state);
      // A present target (charaNum > 0 with a slot). For requiresTarget:false
      // commands run alone (e.g. 泡茶 P-20), this is undefined and the body /
      // kojo / narration all degrade to the solo path.
      const targetSlot = ctx.target > 0 ? next.charas[ctx.target] : undefined;
      if (opts.body && targetSlot) opts.body(next, targetSlot);
      advanceTimeTicks(next, timeDelta);

      // Kojo dispatch: pull the chara's reaction lines from the
      // router (Phase 6.4). Router is optional; unit tests that
      // don't wire it get an empty array. No target → no reaction lines.
      const kojoResolution =
        ctx.dialogueRouter && targetSlot
          ? ctx.dialogueRouter.collectDetailed?.(ctx.target, ctx.commandNo, next, ctx.rng)
          : undefined;
      const kojoLines = kojoResolution?.lines ??
        (ctx.dialogueRouter && targetSlot
          ? ctx.dialogueRouter.collect(ctx.target, ctx.commandNo, next, ctx.rng)
          : []);
      if (kojoResolution?.effects.length) {
        next = applyKojoEffects(next, kojoResolution.effects);
      }
      const dialogueEvents: ObservationEvent[] = kojoLines.map((l) => ({
        kind: "DIALOGUE_LINE",
        timestamp: ctx.now(),
        charaNum: ctx.target,
        text: l.text,
        form: l.form,
      }));
      const hostEvents = kojoHostEventsToObservationEvents(kojoResolution?.hostEvents, ctx.target, ctx.now);

      // Narration: with a target it reads "%MASTER% <label> %TARGET%."; alone
      // (no target) it's just "%MASTER% <label>." (P-20 泡茶 solo path).
      const narrationText = label.includes("%CALLNAME:")
        ? label
        : targetSlot
          ? `%CALLNAME:MASTER%${label}%CALLNAME:TARGET%。`
          : `%CALLNAME:MASTER%${label}。`;

      return {
        state: next,
        events: [
          {
            kind: "NARRATION",
            timestamp: ctx.now(),
            text: narrationText,
            // Migration-fallback narration: retired by `withTrainMessage`
            // whenever the authored TRAIN_MESSAGE route produced prose.
            origin: "comf-fallback",
          },
          ...dialogueEvents,
          ...hostEvents,
        ],
        outcome: "ok",
        kojoHandled: true,
      };
    },
  };
}
