/**
 * `COMF500 UPDATE` — shop menu hook that walks every present chara and
 * invokes their `@M_KOJO_UPDATE_K{N}` body via the kojo router. Mirrors
 * upstream `qol_update.ERB@UPDATE_OF_KOJO_ORIGIN` which does the same
 * with `TRYCALLFORM M_KOJO%RESULTS%_UPDATE_K{LOCAL}`.
 */
import type { CommandContext, HandlerEntry } from "../types.js";
import type { GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";

function presentChars(state: GameState): number[] {
  const loc = state.master.location;
  const out: number[] = [];
  for (const [charaNum, chara] of Object.entries(state.charas)) {
    const n = Number(charaNum);
    if (!chara) continue;
    if (chara.location === loc) out.push(n);
  }
  return out;
}

function applyUpdate(
  next: GameState,
  router: CommandContext["dialogueRouter"],
  charaNum: number,
  rng: CommandContext["rng"],
): { lines: string[]; touched: boolean } {
  const resolver = router?.resolveUpdateKojoInteractive;
  if (!resolver) return { lines: [], touched: false };
  const res = resolver(charaNum, next, rng, []);
  if (res.status !== "resolved" || res.lines.length === 0) {
    return { lines: [], touched: false };
  }
  return { lines: res.lines.map((l) => l.text), touched: true };
}

export const updateKojoHandlerEntry: HandlerEntry = {
  commandNo: 500,
  execCheck: (_ctx) => ({ ok: true }),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const charas = presentChars(ctx.state);
    const allLines: string[] = [];
    for (const charaNum of charas) {
      const { lines, touched } = applyUpdate(
        next,
        ctx.dialogueRouter,
        charaNum,
        ctx.rng,
      );
      if (touched) allLines.push(...lines);
    }
    return {
      state: next,
      events: allLines.length > 0
        ? allLines.map((text) => ({
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text,
          }))
        : [
            {
              kind: "NARRATION" as const,
              timestamp: ctx.now(),
              text: "没有可执行的 UPDATE。",
            },
          ],
      outcome: allLines.length > 0 ? ("ok" as const) : ("noop" as const),
    };
  },
};
