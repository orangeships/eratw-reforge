/**
 * Phase 7 (Wave 0) — sentinel / dummy COMF commands 201 / 999 / 270.
 *
 * These three are real upstream COMF files (the coverage oracle confirms
 * a `@COM<NNN>` label in each) but their bodies are trivial — they are
 * engine sentinels, not gameplay commands. Ported faithfully as thin
 * bespoke handlers so coverage reaches 270/270 without fabricating
 * behavior that isn't upstream.
 *
 * - **COMF201** (`COMF201.ERB`): `@COM201` body is `RETURN 0` (the
 *   `CALL OPTION_COMMAND_FILTER2(1)` above it is commented out). A
 *   `RETURN 0` from `@COM` means the command did NOT execute (ERA
 *   convention). Faithful port → `outcome: "blocked"`, no state change.
 * - **COMF999** (`COMF999.ERB`): header `;ダミー` (dummy), `@COM999` body
 *   `RETURN 1`. The command NUMBER 999 is, however, the time-stop RELEASE
 *   command — `USERCOM.ERB:534-548` intercepts `RESULT == 999 && FLAG:70
 *   == 1 && !CFLAG:诶嘿嘿` and runs `@時間停止解除` BEFORE dispatching the
 *   (empty) `@COM999`. Our handler IS the dispatch point, so we fold that
 *   intercept in (Parity QA P-16): while time-stop is active (and not
 *   诶嘿嘿), 999 releases time-stop; otherwise it stays the dummy noop.
 *   The release we port is the deterministic CORE of `@時間停止解除`
 *   (時間停止解除.ERB): `FLAG:時間停止 = 0` (line 7), `FLAG:運搬 = 0`
 *   (line 9), per-chara `CFLAG:時間停止行動 = 0` (line 555). The giant
 *   無自覚絶頂/射精/服装/口上 settlement (EX/TEQUIP namespaces) is deferred,
 *   same posture as the rest of H-mode. Release does NOT advance the clock.
 * - **COMF270** (`COMF270-299KOJO.ERB`): `@COM270` body `JUMP
 *   KOJO_MESSAGE_SEND("COM", 2, TARGET, 0)` — the H-mode kojo dispatch
 *   shell for the 270-299 command dialogue range. `@COM_ABLE270` gates
 *   on `TFLAG:100` (the command-selection screen flag, not modeled → 0).
 *   Faithful port → if a `dialogueRouter` is attached, collect the
 *   target's kojo for command 270 and emit the lines; otherwise emit a
 *   fallback narration. The `TFLAG:100` gate is deferred (we don't model
 *   the shop/command-screen flag); the command resolves rather than
 *   hard-blocking so the kojo path is exercisable.
 *
 * - **COMF650** (`COMF650 git.ERB`, Wave 3): a joke command — `@COM650`
 *   prints 「git不会出售给无法使用的人」 then `RETURN -1` (canceled).
 *   No state change, no execCheck. Faithful port → `outcome: "noop"` with
 *   the flavor narration. Resolver-only (not in the action menu).
 *
 * None of these appear in the trial-run action menu
 * (`BASIC_ACTION_NOS` = 300/301/309/304), so they are resolver-only.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { CFLAG_ID, FLAG_ID } from "../../state/settlement.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

// ---------------------------------------------------------------------------
// COMF201 — disabled stub (RETURN 0)
// ---------------------------------------------------------------------------

export const comf201HandlerEntry: HandlerEntry = {
  commandNo: 201,
  handler: (ctx: CommandContext) => {
    // RETURN 0 — command refused, no state change.
    return {
      state: cloneGameState(ctx.state),
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: "（このコマンドは無効です）",
        },
      ],
      outcome: "blocked" as const,
      failReason: { kind: "precondition", message: "COMF201 は無効化されたコマンドです。" },
    };
  },
};

// ---------------------------------------------------------------------------
// COMF999 — dummy (RETURN 1, no effect)
// ---------------------------------------------------------------------------

export const comf999HandlerEntry: HandlerEntry = {
  commandNo: 999,
  handler: (ctx: CommandContext) => {
    let next = cloneGameState(ctx.state);

    // P-16: 999 is the time-stop RELEASE command (USERCOM.ERB:535 intercept
    // `RESULT == 999 && FLAG:70 == 1 && !CFLAG:诶嘿嘿`). When time-stop is
    // active and not in 诶嘿嘿, release it (deterministic core only).
    const stopped = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    const ufufu = (next.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0;
    if (stopped && !ufufu) {
      // 時間停止解除.ERB:7 — the actual release.
      next.flagStore[FLAG_ID.時間停止] = 0;
      // 時間停止解除.ERB:9 — clear the carry flag.
      setTflag(next, TFLAG_ID.運搬, 0);
      // 時間停止解除.ERB:555 (TIMESTOP_RESET tail) — clear per-chara 時間停止行動.
      for (const key of Object.keys(next.charas)) {
        const slot = next.charas[Number(key)];
        if (slot) slot.state.CFLAG[CFLAG_ID.時間停止行動] = 0;
      }
      // The 無自覚絶頂/射精/服装/口上 settlement (EX/TEQUIP) is deferred. No
      // clock advance — time was frozen.
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: "%CALLNAME:MASTER%解除了时间停止。世界重新开始流动。",
          },
        ],
        outcome: "ok" as const,
      };
    }

    // Otherwise: RETURN 1 — executed, no effect (the upstream dummy).
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: "（ダミーコマンド）",
        },
      ],
      outcome: "noop" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF270 — H-mode kojo dispatch shell (JUMP KOJO_MESSAGE_SEND)
// ---------------------------------------------------------------------------

export const comf270HandlerEntry: HandlerEntry = {
  commandNo: 270,
  handler: (ctx: CommandContext) => {
    let next = cloneGameState(ctx.state);
    const events: ObservationEvent[] = [];
    // JUMP KOJO_MESSAGE_SEND("COM", 2, TARGET, 0): if a kojo router is
    // attached, collect the target's reaction lines for command 270.
    if (ctx.dialogueRouter && ctx.target > 0) {
      const resolution = ctx.dialogueRouter.collectDetailed?.(ctx.target, 270, next, ctx.rng);
      const lines = resolution?.lines ?? ctx.dialogueRouter.collect(ctx.target, 270, next, ctx.rng);
      if (resolution?.effects.length) next = applyKojoEffects(next, resolution.effects);
      for (const line of lines) {
        events.push({ kind: "DIALOGUE_LINE", timestamp: ctx.now(), charaNum: ctx.target, text: line.text, form: line.form });
      }
    }
    // Fallback narration when no router / no target — the dispatch shell
    // itself carries no state change (it only routes to dialogue).
    if (events.length === 0) {
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: "（口上ディスパッチ）",
      });
    }
    return { state: next, events, outcome: "ok" as const, kojoHandled: true };
  },
};

// ---------------------------------------------------------------------------
// COMF650 — git joke command (RETURN -1, canceled) — Wave 3
// ---------------------------------------------------------------------------

export const comf650HandlerEntry: HandlerEntry = {
  commandNo: 650,
  handler: (ctx: CommandContext) => {
    // @COM650 prints the joke lines then RETURN -1 (canceled / no effect).
    return {
      state: cloneGameState(ctx.state),
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: "「git不会出售给无法使用的人」git似乎不是常识范畴中能得到的东西。",
        },
      ],
      outcome: "noop" as const,
    };
  },
};
