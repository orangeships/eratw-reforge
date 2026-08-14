/**
 * Phase 7 — `COMF89 ゴム精飲` (drink the condom), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM89`
 * (`ERB/コマンド関連/COMF/COMF89 ゴム精飲.ERB`).
 *
 * **道具系 tail (80-89).** This command consumes `TFLAG:套套内`
 * (condom volume set by prior actions) to drive SOURCE and EXP
 * quanta. Since the runtime does not yet model `TFLAG`, V is
 * pinned to 300 (the mid-bracket: >150, <=300). This yields
 * EXP精液経験 += 5 and SOURCE scaled by the coefficient map below.
 *
 * **Faithful core (ERB 14-53, ELSE branch):**
 *   - DOWNBASE: target 気力 100 (ERB 36) — no 体力 drain.
 *   - SOURCE target: 情愛 = V/2, 性行動 = V/2, 達成 = V/2, 屈従 = V*2,
 *     不潔 = V*2, 反感 = V (ERB 38-43). With V=300 pin: 情愛 150,
 *     性行動 150, 達成 150, 屈従 600, 不潔 600, 反感 300.
 *   - 自己愛<0 || 抵抗 → 鬱屈 +400 (ERB 49-50)
 *   - EXP 精液経験 target += 8 / 5 / 3 by V>300 / V>150 / else (ERB 14-21)
 *   - SELECTCASE → 0 clears TFLAG:套套内 (ERB 52) — not modeled.
 *
 * **DEFERRED (documented):**
 *   - TFLAG:套套内 dynamic read — V pinned to 300; documented.
 *   - EXP精液経験 — no EXP_ID for this concept; deferred.
 *   - STAIN:口 |= 4 (ERB 22) — wired (body); one-way 精液 bit on target mouth.
 *   - CFLAG:口内精液 = 1 or 2 (ERB 23-27) — bit state not modeled.
 *   - CFLAG:累計精飲 += V (ERB 28) — accumulator not modeled.
 *   - TFLAG:193 = V (ERB 29) — outcome roll set to V.
 *   - Time-stop branch (ERB 32-34) — TSP drain.
 *   - COM_ABLE89 — V>0, 精液中毒 < 3, !口球 gates (ERB 59-75).
 *   - TCVAR:116 = PLAYER (ERB 10) — H-scene action marker.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_BIT, STAIN_PART } from "../../../state/stain.js";
import { getTflag, setTflag, TFLAG_ID } from "../../../state/tflag.js";
import { isEquipped } from "../../../state/tequip.js";

const com89Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false, reason: { kind: "precondition", message: "需要在场的对象。" } };
  }
  if (getTflag(ctx.state, TFLAG_ID.套套内) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "避孕套内没有可饮用的精液。" } };
  }
  if (isEquipped(target, TEQUIP_ID.口球)) {
    return { ok: false, reason: { kind: "precondition", message: "口球使用中无法进行。" } };
  }
  const timeStopped = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1;
  const consciouslyActed = (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 1;
  if (
    (target.state.ABL[ABL_ID.精液中毒] ?? 0) < 3 &&
    (!timeStopped || consciouslyActed)
  ) {
    return { ok: false, reason: { kind: "precondition", message: "精液中毒需要达到 3。" } };
  }
  return { ok: true };
};

export const comf89Def: ComfDef = {
  commandNo: 89,
  label: "ゴム精飲",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com89Check,
  hModeMenuCheck: com89Check,

  // ERB 36: target 気力 100 drain — in body.
  downbase: {},

  buildSources: (c) => {
    const V = getTflag(c.next, TFLAG_ID.套套内);
    const frozen =
      (c.next.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
      (c.t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
    if (frozen) return {};
    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: Math.trunc(V / 2),   // 150
      [SOURCE_ID.性行動]: Math.trunc(V / 2), // 150
      [SOURCE_ID.達成]: Math.trunc(V / 2),   // 150
      [SOURCE_ID.屈従]: V * 2,               // 600
      [SOURCE_ID.不潔]: V * 2,               // 600
      [SOURCE_ID.反感]: V,                    // 300
    };
    // ERB 49-50: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  body: (c) => {
    const V = getTflag(c.next, TFLAG_ID.套套内);
    const timeStopped = (c.next.flagStore[FLAG_ID.時間停止] ?? 0) === 1;
    const frozen = timeStopped && (c.t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;

    c.t.state.TCVAR[TCVAR_ID.行為者] = 0;
    c.t.state.EXP[EXP_ID.精液経験] =
      (c.t.state.EXP[EXP_ID.精液経験] ?? 0) + (V > 300 ? 8 : V > 150 ? 5 : 3);
    // ERB 22: STAIN:口 |= 4 — target's mouth gains the 精液 (semen) soil bit.
    // One-way bit set, not a swap (drinking the condom soiles the mouth).
    c.t.state.STAIN[STAIN_PART.口] =
      (c.t.state.STAIN[STAIN_PART.口] ?? 0) | STAIN_BIT.精液;

    c.t.state.CFLAG[CFLAG_ID.口内精液] = timeStopped ? 2 : 1;
    c.t.state.CFLAG[CFLAG_ID.累計精飲] =
      (c.t.state.CFLAG[CFLAG_ID.累計精飲] ?? 0) + V;
    setTflag(c.next, TFLAG_ID.SELECTCOM的分岐, V);
    if (frozen) {
      c.master.state.BASE[BASE_ID.TSP] = (c.master.state.BASE[BASE_ID.TSP] ?? 0) - 50;
    } else {
      c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;
    }
    setTflag(c.next, TFLAG_ID.套套内, 0);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 喝下了精液 — ゴム精飲；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf89HandlerEntry: HandlerEntry = makeComfHandler(comf89Def);
