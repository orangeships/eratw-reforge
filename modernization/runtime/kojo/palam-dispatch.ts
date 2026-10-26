import type { ObservationEvent } from "../../schemas/types.js";
import type { CommandContext } from "../command/types.js";
import { createRng } from "../command/rng.js";
import { commandKojoSeed } from "../command/command-kojo.js";
import { hEjaculationKojoRoutes } from "../command/h-ejaculation-semantics.js";
import type { KojoStagedEffect, PalamKojoKind } from "./types.js";
import { CFLAG_ID, EX_ID, TCVAR_ID } from "../state/settlement.js";

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

interface PalamPhase {
  kind: PalamKojoKind;
  detail?: string | number;
}

function commandPalamPhases(ctx: CommandContext, target: number): PalamPhase[] {
  const targetSlot = ctx.state.charas[target];
  const frame = ctx.state.turnContext?.frame;
  const targetNowEx = frame?.nowExByChara[target] ?? {};
  const masterNowEx = frame?.nowExByChara[ctx.state.master.charaNum] ?? {};
  const prank = (targetSlot?.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0;
  const phases: PalamPhase[] = [];
  const orgasmed = [EX_ID.Ｃ絶頂, EX_ID.Ｖ絶頂, EX_ID.Ａ絶頂, EX_ID.Ｂ絶頂, EX_ID.Ｍ絶頂]
    .some((id) => (targetNowEx[id] ?? 0) > 0);
  if (orgasmed) phases.push({ kind: prank ? "B2" : "B" });
  if ((masterNowEx[EX_ID.射精] ?? 0) > 0) {
    const recordedSite = ctx.state.master.state.TCVAR[TCVAR_ID.已射精部位FLAG] ?? 0;
    const markerMask = targetSlot?.state.TCVAR[TCVAR_ID.口上出力用射精部位] ?? 0;
    phases.push(...hEjaculationKojoRoutes(markerMask, recordedSite, prank));
  }
  phases.push({ kind: "C" });
  return phases;
}

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
  let ejaculationRouteSelected = false;
  for (const phase of commandPalamPhases(ctx, target)) {
    const isEjaculationRoute = phase.kind === "A" || phase.kind === "A2";
    if (isEjaculationRoute && ejaculationRouteSelected) continue;
    const detailed = ctx.dialogueRouter.resolvePalamKojoDetailed?.(
      target,
      phase.kind,
      phase.detail,
      ctx.state,
      rng,
    );
    if (!detailed) {
      const lines =
        ctx.dialogueRouter.resolvePalamKojo?.(target, phase.kind, phase.detail, ctx.state, rng) ?? [];
      events.push(...linesToEvents(lines, target, ctx.now()));
      if (isEjaculationRoute && lines.length > 0) ejaculationRouteSelected = true;
      continue;
    }
    if (detailed.status !== "resolved" && detailed.status !== "partial") continue;
    if (isEjaculationRoute) ejaculationRouteSelected = true;
    if (detailed.effects.length > 0) effects.push(...detailed.effects);
    events.push(...linesToEvents(detailed.lines, target, ctx.now()));
  }
  return { events, effects };
}
