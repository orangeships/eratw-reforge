/**
 * Phase 7 — `COMF180 ローション` (lotion), as a `ComfDef`.
 *
 * Ports the **normal-mode core (no-chocolate)** of `@COM180`
 * (`ERB/コマンド関連/COMF/COMF180 ローション.ERB`).
 *
 * **特殊 family sibling (180 ローション).** No 体力/気力 cost (both
 * 0), a single 液体 5000 SOURCE (deferred — 液体 id not in our SOURCE_ID
 * enum, matches comf0/comf1/comf4/comf8/comf13 deferral pattern),
 * plus a 露出 100 in the non-time-stop branch. The "chocolate play"
 * branch (which uses `INPUT` to pick a chocolate item and adds extra
 * 不潔/逸脱/情愛 SOURCE + 愛情経験++) is C-tier — deferred entirely;
 * the no-chocolate core is the safe, A/B-tier settlement.
 *
 * **Faithful no-chocolate core (ERB 50-83):**
 *   - DOWNBASE: 体力 0, 気力 0 (ERB 51-52)
 *   - SOURCE: 液体 = 5000 (ERB 54) — id not modeled (deferred)
 *   - non-time-stop: SOURCE:露出 = 100 (ERB 67)
 *   - HETEROSEX 同性愛 EXP: 1 target / 1 master (ERB 93-96)
 *
 * **DEFERRED (documented):**
 *   - 液体 SOURCE: 5000 (ERB 54) — id not modeled (matches the
 *     0/1/4/8/13 deferral pattern).
 *   - 体型==-5 SOURCE:液体 += 20000 (ERB 55-56) — 体型 TALENT id not modeled.
 *   - Chocolate interaction (ERB 14-41, 69-81) — INPUT/ITEM menu,
 *     C-tier. SELECTCASE 巧克力 arms + EXP:愛情経験++ write are
 *     unreachable without that input.
 *   - Time-stop branch (ERB 63-65) — no 露出 SOURCE in time-stop.
 *   - TCVAR:116 = PLAYER (行為者 marker, ERB 46) — display-only.
 *   - HETEROSEX EXP writes (ERB 88-97) — gender-pair helper deferred.
 *   - ITEM:40 / NOITEM gate, ITEM:40 auto-replenish, TEQUIP:32 gate
 *     (ERB 107-118) — COMABLE layer / ITEM subsystem deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import { SOURCE_ID } from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE180 menu gate: present target + 潤滑液 (ITEM:40) held, not
 *  while showering (TEQUIP:32). NOITEM/TFLAG:100/GLOBAL_COMABLE deferred. */
const com180Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 40)) return block("没有润滑液。");
  // 上游 TEQUIP:32 (淋浴) → RETURN 0.
  if (isEquipped(target, 32)) return block("淋浴中无法使用。");
  return { ok: true };
};

export const comf180Def: ComfDef = {
  commandNo: 180,
  label: "ローション",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice B: 消耗 潤滑液 (ITEM 40).
  consumeItem: { id: 40 },

  hModeMenuCheck: com180Check,

  // ERB 51-52: 体力/気力 = 0 (both zero → empty downbase).
  downbase: {},

  buildSources: (_c) => {
    // ERB 67 (non-time-stop branch): SOURCE:露出 = 100.
    // 液体 SOURCE: 5000 (ERB 54) deferred — id not modeled.
    return {
      [SOURCE_ID.露出]: 100,
    };
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%涂上了润滑液 — ローション；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf180HandlerEntry: HandlerEntry = makeComfHandler(comf180Def);