/**
 * Phase 7 — `COMF417 昼寝する` (nap), as a `ComfDef`.
 *
 * Ports the core of `@COM417`
 * (`ERB/コマンド関連/COMF/日常系/COMF417 昼寝する.ERB`).
 *
 * **Rest/self-care family sibling of 403 休憩.** Reuses `recoverPermil`
 * (the engine extension 403 introduced) verbatim — nap just has higher
 * rates + an extra 精力 stat + 90 min. The new part is the
 * **sleeping-together SOURCE block** (when a chara with 態度>0 naps with
 * the player): 歓楽 + 情愛 from 親密 brackets + the universal 好感度 bonus.
 * The 親密 brackets are bespoke to the 添い寝/cuddle family (shared with a
 * future 354 添い寝する sibling).
 *
 * **Faithful core captured:**
 *   - master recovery 体力 +200‰ / 気力 +250‰ / 精力 +100‰ MAXBASE (ERB
 *     86-88, tier-0 no-furniture rates)
 *   - if a chara with 態度 (CFLAG:6) > 0 naps along (ERB 40):
 *       · that chara recovers at the same tier-0 rates (ERB 43-45)
 *       · SOURCE:歓楽 = 親密-bracket + 好感度-bonus, clamped ≥0 (ERB 49-76)
 *       · SOURCE:情愛 = 親密-bracket (ERB 49-66)
 *   - TIME += 90 (ERB 90)
 *
 * **DEFERRED (documented):**
 *   - 桐木床 furniture tiers (`回復率:MIN(ITEM:桐木床,3)` → higher rates) —
 *     ITEM not modeled; tier-0 rates used.
 *   - `CFLAG:333 += 90` (ERB 77 — id not in our table; minor accumulator).
 *   - `TFLAG:午睡 / 信頼度管理 / 194` transient flags (trust deferred
 *     uniformly in source-check).
 *
 * **No outcome roll** — pinned to 通常.
 */
import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  SOURCE_ID,
  recoverPermil,
} from "../../../state/settlement.js";
import { computeAttitude } from "../../../state/attitude.js";
import { TFLAG_ID, setTflag } from "../../../state/tflag.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfCtx, ComfDef } from "../comf-def.js";
import {
  bracketBonus,
  favorPleasureBonus,
  SHINMITSU_JOAI_NAP_TIERS,
  SHINMITSU_PLEASURE_NAP_TIERS,
} from "../source-brackets.js";

/** Tier-0 (no furniture) nap recovery rates, permille of MAXBASE. */
const NAP_TAIRYOKU_PERMIL = 200; // 体力
const NAP_KIRYOKU_PERMIL = 250; // 気力
const NAP_SEIRYOKU_PERMIL = 100; // 精力

/** Sleeping together: a present chara with 態度 (CFLAG:6) > 0 (ERB 40). */
function napTogether(c: ComfCtx): boolean {
  return c.hasTarget && computeAttitude(c.t, c.master, c.next) > 0;
}

export const comf417Def: ComfDef = {
  commandNo: 417,
  label: "昼寝する",

  requiresTarget: false,

  // Parity QA Wave 7 (P-17): @COM_ABLE417 faithful gates the auto-extracted
  // gate ({notWhileTimeStopped}) omits. Layer them on explicitly:
  //   - 現在位置 == CFLAG:MASTER:311 (initial position) — strictly the
  //     player's own room, not just any 私室. The earlier
  //     `requiresPrivateRoom: true` was too lenient (let master nap in
  //     any private room) and didn't match upstream. Replaced with
  //     `atMasterHome`, which compares `master.location` to
  //     `state.homeLocation` (the modern canonical form of CFLAG:311).
  //   - 180 ≤ NEMUKE() ≤ 720 (the 3h–12h-awake nap window).
  //   - TFLAG:昼寝(198) == 0 (1/day; set to 90 in body, reset at day-end).
  //   - CFLAG:诶嘿嘿 != 2 (not partner-led H).
  gate: {
    nemuke: { min: 180, max: 720 },
    blocksIfTflagSet: TFLAG_ID.昼寝,
    atMasterHome: true,
    notWhilePartnerLedH: true,
  },

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 90, // ERB 90

  buildSources: (c): Record<number, number> => {
    if (!napTogether(c)) return {};
    const shinmitsu = c.tAbl(ABL_ID.親密);
    let kanraku = bracketBonus(shinmitsu, SHINMITSU_PLEASURE_NAP_TIERS);
    kanraku += favorPleasureBonus(c.favor); // ERB 68-74 (universal)
    if (kanraku < 0) kanraku = 0; // ERB 75
    const joai = bracketBonus(shinmitsu, SHINMITSU_JOAI_NAP_TIERS);
    return { [SOURCE_ID.歓楽]: kanraku, [SOURCE_ID.情愛]: joai };
  },

  body: (c) => {
    // ERB 86-88: master recovers (tier-0 rates).
    recoverPermil(c.master, BASE_ID.体力, NAP_TAIRYOKU_PERMIL);
    recoverPermil(c.master, BASE_ID.気力, NAP_KIRYOKU_PERMIL);
    recoverPermil(c.master, BASE_ID.精力, NAP_SEIRYOKU_PERMIL);

    // ERB 43-45: the napping-together chara recovers too.
    if (napTogether(c)) {
      recoverPermil(c.t, BASE_ID.体力, NAP_TAIRYOKU_PERMIL);
      recoverPermil(c.t, BASE_ID.気力, NAP_KIRYOKU_PERMIL);
      recoverPermil(c.t, BASE_ID.精力, NAP_SEIRYOKU_PERMIL);
    }

    // ERB 91: `TFLAG:昼寝 = 90`. Dual purpose (Parity QA Wave 7): the 90-min
    // credit is subtracted by NEMUKE() (a nap makes you less sleepy), AND
    // `> 0` gates @COM_ABLE417 as a 1/day block. Reset to 0 at day-end.
    setTflag(c.next, TFLAG_ID.昼寝, 90);
  },

  // P0-2 (实玩反馈 #5): upstream only dispatches the 417 personal kojo from
  // the SOURCE path, which `@COM417` opens solely in the nap-together branch
  // (`TARGET > 0 && CFLAG:TARGET:6 > 0`, ERB:40). A solo nap (`TFLAG:194 = 2`,
  // `態度 == 0`) produces no SOURCE and so no kojo upstream — but the factory
  // collects kojo whenever a target is merely present. Gate collect on the
  // same `napTogether` condition so a present-but-not-napping target doesn't
  // surface nap-together kojo lines (e.g. "把X当作抱枕…") on a solo nap.
  kojoGate: napTogether,

  narration: (c, favorDelta) =>
    napTogether(c)
      ? `%CALLNAME:MASTER% 与%CALLNAME:TARGET%一起午睡；好感度 ${
          favorDelta >= 0 ? "+" : ""
        }${favorDelta}.`
      : `%CALLNAME:MASTER% 独自打了个盹.`,
};

export const comf417HandlerEntry: HandlerEntry = makeComfHandler(comf417Def);
