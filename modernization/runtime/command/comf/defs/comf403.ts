/**
 * Phase 7 — `COMF403 休憩` (rest), as a `ComfDef`.
 *
 * Ports the normal-rest core of `@COM403`
 * (`ERB/コマンド関連/COMF/日常系/COMF403 休憩.ERB`).
 *
 * **Rest/self-care family exemplar.** First command exercising the new
 * `recoverPermil` primitive + MAXBASE (the engine extension this slice
 * added). Master-centric (factory `requiresTarget: false`); no SOURCE
 * settlement — the whole effect is permille BASE recovery toward MAXBASE,
 * done in `body`. Siblings (417 昼寝, お風呂…) reuse `recoverPermil` and
 * differ only in rates/time and whether they add a SOURCE block.
 *
 * **Faithful core captured (ERB normal-rest ELSE branch):**
 *   - master 体力 +100‰ MAXBASE, 気力 +200‰ MAXBASE (ERB 16-17, tier-0
 *     no-furniture rates; `recoverPermil` caps at MAXBASE)
 *   - if a chara is present with 態度 (CFLAG:6) > 0: that chara recovers
 *     at the same tier-0 rates (ERB 44-58, the non-trait branch)
 *   - TIME += 60 (ERB 68)
 *
 * **DEFERRED (documented):**
 *   - 栎木沙发 furniture tiers (`Restore = MIN(ITEM:栎木沙发,3)` → higher
 *     rates 125/150/175 ‰ 体力, 225/250/275 ‰ 気力) — ITEM not modeled.
 *   - vampire / 月光浴 / 日光浴 / 蓬莱人 target trait variants (ERB 49-54).
 *   - the `NEMUKE() >= 960` fall-asleep branch (ERB 30-35, `BEGIN
 *     AFTERTRAIN`) — `@COM_ABLE403` already gates `NEMUKE>=960 → RETURN 0`,
 *     so it is unreachable on the normal command path.
 *   - recovery delta messages.
 *
 * **No SOURCE, no outcome roll** — pinned to 通常; the factory's settlement
 * + dialogue are skipped when acting alone, and produce nothing when a
 * target is present (empty buildSources).
 */
import type { HandlerEntry } from "../../types.js";
import { BASE_ID, recoverPermil } from "../../../state/settlement.js";
import { computeAttitude } from "../../../state/attitude.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** Tier-0 (no furniture) recovery rates, permille of MAXBASE. */
const REST_TAIRYOKU_PERMIL = 100; // 体力
const REST_KIRYOKU_PERMIL = 200; // 気力

export const comf403Def: ComfDef = {
  commandNo: 403,
  label: "休憩",

  requiresTarget: false,

  // Parity QA Wave 7: @COM_ABLE403:100 `SIF NEMUKE() >= 960 → RETURN 0` —
  // too tired to merely rest, must sleep. The auto-extracted gate
  // (notWhileTimeStopped / requiresPrivateRoom / notWhileCoSleeping) omits
  // this NEMUKE ceiling; layer it on explicitly. (生成 gate already covers
  // the 現在位置==311 / 休憩可 location gate via requiresPrivateRoom.)
  gate: { nemuke: { max: 959 } },

  // No outcome roll — pin to 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 60, // ERB 68

  // No SOURCE — the whole effect is recovery (in body).
  buildSources: () => ({}),

  body: (c) => {
    // ERB 65-66: master recovers (tier-0 rates).
    recoverPermil(c.master, BASE_ID.体力, REST_TAIRYOKU_PERMIL);
    recoverPermil(c.master, BASE_ID.気力, REST_KIRYOKU_PERMIL);

    // ERB 44-58: a present chara with 態度 (CFLAG:6) > 0 rests too
    // (non-trait branch; vampire/月光浴/日光浴/蓬莱人 variants deferred).
    if (c.hasTarget && computeAttitude(c.t, c.master, c.next) > 0) {
      recoverPermil(c.t, BASE_ID.体力, REST_TAIRYOKU_PERMIL);
      recoverPermil(c.t, BASE_ID.気力, REST_KIRYOKU_PERMIL);
    }
  },

  narration: (c) =>
    c.hasTarget && computeAttitude(c.t, c.master, c.next) > 0
      ? `%CALLNAME:MASTER%和%CALLNAME:TARGET%一起稍作休息，恢复了精神。`
      : `%CALLNAME:MASTER%稍作休息，恢复了精神。`,
};

export const comf403HandlerEntry: HandlerEntry = makeComfHandler(comf403Def);
