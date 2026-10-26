/**
 * 夜间小剧场 — 「〜的呢喃」(EVENT 31), the day-end per-character monologue.
 *
 * Faithful port of the `@EVENTEND` per-chara loop
 * (`イベント関連/AFTERTRA.ERB:267-273`):
 *
 *   IF CFLAG:LOCAL:面識
 *     会ってない日数 = DAY - CFLAG:LOCAL:最後に会った日
 *     CALL KOJO_MESSAGE_SEND("EVENT", 31, LOCAL, TCVAR:LOCAL:今天有否见面 ? 0 # 会ってない日数)
 *
 * The EVENT 31 kojo body starts with `CALL EVENTEND_TSUBUYAKI`
 * (`口上・メッセージ関連/EVENT_MESSAGE.ERB:885`) which prints the
 * `▼%CALLNAME%的呢喃` header once per character. That header lives in a shared
 * CALLed function, so the parsed kojo AST for arm 31 does NOT contain it — we
 * synthesize it here as the block's leading line, gated on the character
 * actually having 呢喃 content (mirroring the upstream `SIF ...デイリー表示
 * RETURN` guard which suppresses an empty header).
 *
 * Only ~half the roster ships EVENT 31 kojo; characters without it (or not yet
 * 面識) simply contribute nothing, exactly as upstream.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { Rng } from "../command/types.js";
import type { GameState } from "../state/index.js";
import { CFLAG_ID, TCVAR_ID } from "../state/settlement.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";

export interface TsubuyakiDeps {
  now: () => number;
  router?: DialogueRouter;
  rng?: Rng;
  /** Day being settled; sleep may already have advanced the world to morning. */
  settlementDayIndex?: number;
}

/**
 * Skip a 呢喃 line that is clearly a mod author's debug scaffold or carries
 * unresolved kojo template tokens (e.g. 小铃's EVENT 31 ships a `※…デバッグ用`
 * variant with `[M_KOJO_K70_KOSUZUBOOM()]` macro calls and raw
 * `{CFLAG:[[小铃]]:1080}` refs the router can't expand). Showing that verbatim
 * in the night 小剧场 would look broken; other characters resolve cleanly and
 * are unaffected.
 */
function isDebugKojoLine(text: string): boolean {
  if (text.includes("デバッグ") || text.startsWith("※")) return true;
  // Unexpanded template markers: chara-name interpolation `[[…]]`, a raw
  // variable ref like `{CFLAG:…}` / `{TALENT:…}`, or an inline macro call.
  return /\[\[|\{(CFLAG|TALENT|TEQUIP|CSTR|EXP|ABL|TCVAR):|\[M_KOJO/.test(text);
}

/**
 * Run the day-end 呢喃 pass over every registered chara (master excluded).
 * Emits, for each 面識 character with EVENT 31 content, a `▼〜的呢喃` header
 * followed by the resolved monologue lines — all tagged with `charaNum` so the
 * night screen can fold them into that character's settlement block.
 *
 * No-op without a router/rng (tests may skip it), matching the DAYEVENT /
 * ONANISM policy in `finishPlayerSleep`.
 */
export function runTsubuyaki(state: GameState, deps: TsubuyakiDeps): ObservationEvent[] {
  const { now, router, rng } = deps;
  if (!router || !rng) return [];

  const events: ObservationEvent[] = [];
  const charaNums = Object.keys(state.charas)
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  for (const charaNum of charaNums) {
    const slot = state.charas[charaNum];
    if (!slot) continue;
    const st = slot.state;
    // Only characters the master has actually met 呢喃 at day-end.
    if ((st.CFLAG[CFLAG_ID.认识] ?? 0) === 0) continue;

    // `TCVAR:今天有否见面 ? 0 # 会ってない日数` — arm arg selects the
    // met-today branch (0) vs the "haven't seen you in N days" branch.
    const metToday = (st.TCVAR[TCVAR_ID.今天有否见面] ?? 0) !== 0;
    const daysSince = Math.max(0, (deps.settlementDayIndex ?? state.time.dayIndex) - (st.CFLAG[CFLAG_ID.最后见面的日子] ?? 0));
    const arg = metToday ? 0 : daysSince;

    const lines = resolveEventKojoAndApply(router, state, charaNum, 31, rng, [arg])
      .filter((l) => !isDebugKojoLine(l.text));
    if (lines.length === 0) continue; // no 呢喃 content ⇒ suppress the header too.

    const name = slot.callName ?? `角色${charaNum}`;
    events.push({
      kind: "DIALOGUE_LINE",
      timestamp: now(),
      charaNum,
      text: `▼${name}的呢喃`,
      form: "PRINTFORML",
    });
    for (const line of lines) {
      events.push({
        kind: "DIALOGUE_LINE",
        timestamp: now(),
        charaNum,
        text: line.text,
        form: line.form,
      });
    }
  }

  return events;
}
