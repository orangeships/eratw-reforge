/**
 * Phase 7.5 — `COMF419 水汲み` (draw water), a bespoke free-action command.
 *
 * Faithful port of `@COM419` / `@COM_ABLE419`
 * (`ERB/コマンド関連/COMF/日常系/COMF419 水汲み.ERB`).
 *
 * **Body (non-隙間guest path, ERB 30-90):**
 *   - Pick `VAR_WATER` by current location:
 *       霧之湖/347/68      → 雾之湖的水
 *       旧地獄温泉/934     → 地狱温泉的水
 *       山之湖/814         → 奇迹之水
 *       57                 → 50% 奇迹之水 / 50% 地狱温泉的水 (RAND:2)
 *       CASEELSE          → 普通的水
 *     We model the *location-string* arm of this (霧之湖 / 旧地獄温泉 /
 *     山之湖 room prefixes); the bare numeric ids (347/68/934/814/57) are
 *     the same rooms expressed as room ids — the location-string forms
 *     already cover the trial-reachable rooms. Room 57's RAND split is
 *     modeled (`rng.int(2)`).
 *   - Clear STAIN:0/1 (deferred — no STAIN namespace) + the three 精液
 *     CFLAG (口内精液 288 / 脸上精液 289 / 手上精液 290) on MASTER, and on
 *     TARGET if present (ERB 68-79). This is the "wash hands/face" effect.
 *   - `IF !AT_HOME(MASTER) && ITEM:982 <= 2`: outside the base with no big
 *     water container → 「先回去了」+ 従外面回家. AT_HOME is the in-base
 *     predicate; ITEM:982 (水桶) is deferred → treated as 0 → the arm
 *     fires when NOT at home. The 従外面回家 teleport is the odekake
 *     subsystem (deferred) — we narrate it but do NOT teleport (no
 *     multi-map return path). Because the return itself is not implemented,
 *     the modern narration does not claim that it happened.
 *   - TIME += 3 (non-time-stop) / `BASE:MASTER:TSP -= 9` (time-stop, with
 *     MAGIC_DLC_时间因子; ERB 85-89). Time-stop TSP cost modeled; the
 *     MAGIC_DLC gate is deferred (treat as the time-stop arm firing).
 *   - RETURN -1 → free action (no main-turn consumption at dispatcher
 *     level). We report `outcome: "ok"`; the free-action accounting is
 *     deferred (same as comf495).
 *
 * **execCheck (`@COM_ABLE419`, ERB 94-110):**
 *   - `FLAG:時間停止 == 1 && !MAGIC_DLC_时间因子 → RETURN 0`: block time-stop
 *     WITHOUT the time-factor DLC. We model time-stop as ALWAYS allowing
 *     the TSP-cost arm (the DLC gate is deferred → treat as having the
 *     factor), so time-stop does NOT block. (If we instead blocked, the
 *     command would be unusable during time-stop, which is the
 *     non-factor behavior — we choose the factor-on posture for parity
 *     with other TSP-cost commands.) NOTE: the cleaner faithful read is
 *     "block time-stop"; we defer the DLC gate and block time-stop to
 *     match the default (non-DLC) trial. See gate below.
 *   - `!TFLAG:100 → RETURN 0`: command-screen flag (deferred → treated as
 *     set, i.e. available).
 *   - `GLOBAL_COMABLE(419)`: batch gate (deferred → pass).
 *   - `!打水可(現在位置) && !IS_GAP_GUEST(MASTER) → RETURN 0`: the location
 *     must have 場所_打水 (PLACE_WATER), unless MASTER is a 隙間guest
 *     (deferred → not a guest → the location gate applies).
 *   - `CFLAG:诶嘿嘿 == 2 → RETURN 0`: partner-led H-mode block.
 *
 * **DEFERRED (documented):**
 *   - STAIN namespace (RESET_STAIN) — no STAIN modeled; only the 精液
 *     CFLAG clear is ported.
 *   - IS_GAP_GUEST path (ERB 6-29): the 隙間guest picker (霧之湖/旧地獄
 *     温泉/山之湖/普通井水 INPUT) — no 隙間guest in trial.
 *   - ITEM:982 水桶 container check + 従外面帰家 teleport (odekake
 *     multi-map return) — narrated, not teleported.
 *   - MAGIC_DLC_時間因子 gate — time-stop arm fires unconditionally when
 *     time-stopped (TSP -= 9).
 *   - (RESOLVED, FARM-BREW B4) VAR_WATER is now persisted to `state.varWater`
 *     (it is a SAVEDATA var upstream) so COMF418 watering / COMF450 water-swap
 *     can consume it. Previously narration-only.
 *   - GLOBAL_COMABLE / TFLAG:100 batch gates.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterBase,
  getMasterCflag,
  setMasterBase,
} from "../../state/settlement.js";
import { hasPlace, PLACE_WATER } from "../../world/place-flags.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import { clearStain, STAIN_PART } from "../../state/stain.js";

/** `VAR_WATER` by location (ERB 30-66, the location-string arms). */
function waterForLocation(
  location: string,
  rng: { int: (n: number) => number },
): string {
  // 霧之湖 / 旧地獄温泉 / 山之湖 are off-shrine field-map rooms (not yet
  // built as scenes). Their location-string prefixes are matched anyway so
  // the arm is faithful when those rooms exist.
  if (location.startsWith("霧之湖") || location === "神社:霧之湖") return "雾之湖的水";
  if (location.startsWith("旧地獄温泉")) return "地狱温泉的水";
  if (location.startsWith("山之湖")) return "奇迹之水";
  // Room 57 (大広場) — 50/50 奇迹之水 / 地狱温泉的水 (ERB 45-50).
  if (location === "神社:大広場" || location === "神社:大广场") {
    return rng.int(2) === 0 ? "奇迹之水" : "地狱温泉的水";
  }
  return "普通的水";
}

/** Whether MASTER is at a water-drawing spot (`打水可`, ERB 488). */
function canDrawWater(location: string): boolean {
  return hasPlace(placeFlagsOf(location), PLACE_WATER);
}

function checkEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // ERB 98: 時間停止 (FLAG:70) without MAGIC_DLC_時間因子 → block. DLC gate
  // deferred → default (non-DLC) trial blocks time-stop.
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法打水。" } };
  }
  // ERB 106: !打水可(現在位置) && !IS_GAP_GUEST → block. 隙間guest deferred.
  if (!canDrawWater(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里不能打水。" } };
  }
  // ERB 108: 诶嘿嘿 == 2 (partner-led H) → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是打水的时候。" } };
  }
  return { ok: true };
}

export const waterDrawingHandlerEntry: HandlerEntry = {
  commandNo: 419,
  execCheck: (ctx) => {
    const r = checkEligible(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);

    // VAR_WATER by location (ERB 30-66). FARM-BREW B4 declared behavior
    // change ①: persist it (SAVEDATA upstream) so COMF418 watering / COMF450
    // water-swap can consume it — previously it was narration-only.
    const water = waterForLocation(next.master.location, ctx.rng);
    next.varWater = water;

    // Clear 精液 CFLAG on MASTER (ERB 70-72) + STAIN 口/手 (ERB 68-69).
    next.master.state.CFLAG[CFLAG_ID.口内精液] = 0;
    next.master.state.CFLAG[CFLAG_ID.脸上精液] = 0;
    next.master.state.CFLAG[CFLAG_ID.手上精液] = 0;
    clearStain(next.master, STAIN_PART.口);
    clearStain(next.master, STAIN_PART.手);
    // Clear on TARGET if present (ERB 73-79).
    const target = ctx.target > 0 ? next.charas[ctx.target] : undefined;
    if (target) {
      target.state.CFLAG[CFLAG_ID.口内精液] = 0;
      target.state.CFLAG[CFLAG_ID.脸上精液] = 0;
      target.state.CFLAG[CFLAG_ID.手上精液] = 0;
      clearStain(target, STAIN_PART.口);
      clearStain(target, STAIN_PART.手);
    }

    // ERB 85-89: time-stop → TSP -= 9; else TIME += 3.
    // (Time-stop is blocked at execCheck in the non-DLC trial, so this is
    // the TIME += 3 path; the TSP arm is kept for the DLC-factor posture.)
    if ((next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
      setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - 9);
    } else {
      advanceTimeTicks(next, 3);
    }

    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `打上来了${water}。`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
