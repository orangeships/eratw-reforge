import type { ObservationEvent } from "../../schemas/types.js";
import type { CommandContext } from "../command/types.js";
import { createRng } from "../command/rng.js";
import { commandKojoSeed } from "../command/command-kojo.js";
import type { KojoStagedEffect, PalamKojoKind } from "./types.js";

/**
 * PALAMCNG dispatch — the post-settlement reaction layer that the original
 * fires from SOURCE.ERB for the command target after every settlement
 * (`KOJO_MESSAGE_SEND("PALAM", 3/4, TARGET, ...)`). The modern runtime had
 * `resolvePalamKojo*` fully implemented (`kojo-cache.ts`) but zero callers, so
 * 137 authored character PALAMCNG variants were dead.
 *
 * Scoped to phase C (調教後口上, SOURCE.ERB:1001) for now: its funcs read
 * TCVAR:破瓜 / TALENT:恋慕 / SELECTCOM / FLAG:時間停止 — all supported by the
 * static router, non-H, and fire every command exactly like the original.
 * Phases B (絶頂, needs NOWEX population), D (needs UP:/IS_SELECTCOM parser
 * support), F (needs EX:寸止め modeling) and A/A2 (H) are deferred — see
 * docs/DEBUG-BOARD.md.
 */
export interface PalamCngKojoCollection {
  events: ObservationEvent[];
  effects: KojoStagedEffect[];
}

const COMMAND_PALAM_PHASES: readonly PalamKojoKind[] = ["C"];

/** Translate PALAMCNG lines into session-owned DIALOGUE_LINE events. */
function linesToEvents(
  lines: ReadonlyArray<{ text: string; form: string }>,
  charaNum: number,
  timestamp: number,
): ObservationEvent[] {
  return lines.map((line) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp,
    charaNum,
    text: line.text,
    form: line.form,
  }));
}

/**
 * Fire the per-command PALAMCNG phases for the target on the post-settlement
 * state. Authored lines win whenever the route resolves; `not-authored`,
 * `gated` and `unsupported` routes stay silent (fail-closed, so a chara with
 * no C func, or a C func the router cannot evaluate faithfully, is unchanged
 * from today). Committed `effects` are returned for the caller to apply once,
 * so FIRSTTIME/memory markers advance and replayed commands do not re-emit.
 */
export function collectCommandPalamCng(
  ctx: CommandContext,
  target: number = ctx.target,
): PalamCngKojoCollection {
  if (!ctx.dialogueRouter || target <= 0) return { events: [], effects: [] };
  const rng = createRng(commandKojoSeed(ctx));
  const events: ObservationEvent[] = [];
  const effects: KojoStagedEffect[] = [];
  for (const kind of COMMAND_PALAM_PHASES) {
    const detailed = ctx.dialogueRouter.resolvePalamKojoDetailed?.(
      target,
      kind,
      undefined,
      ctx.state,
      rng,
    );
    if (!detailed) {
      const lines =
        ctx.dialogueRouter.resolvePalamKojo?.(target, kind, undefined, ctx.state, rng) ?? [];
      events.push(...linesToEvents(lines, target, ctx.now()));
      continue;
    }
    if (detailed.status !== "resolved" && detailed.status !== "partial") continue;
    if (detailed.effects.length > 0) effects.push(...detailed.effects);
    events.push(...linesToEvents(detailed.lines, target, ctx.now()));
  }
  return { events, effects };
}
