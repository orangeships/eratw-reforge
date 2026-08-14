/**
 * Phase 7 — `COMF21 何もしない` (do nothing) settlement, as a `ComfDef`.
 *
 * Ports `@COM21` (`ERB/コマンド関連/COMF/COMF21 何もしない.ERB`), the
 * normal-mode (non-時間停止) core.
 *
 * **H foreplay family (root 0-26) sibling.** This is an idle/masochism
 * command — the target does nothing while the player watches. Heavier
 * 欲情/露出/液体 scale up by 受虐属性 bracket (ERB 31-76) and 受虐狂
 * talent (ERB 79-83).
 *
 * **Faithful normal-mode core (ERB 18-83, ELSE branch):**
 *   - DOWNBASE: target 体力 10 / 気力 10 (ERB 19-20)
 *   - SOURCE target: 情愛 10, 露出 10, 逸脱 10 (ERB 22-24)
 *   - 受虐属性 SELECTCASE (ERB 31-76) — 10 arms (0..9, ELSE):
 *       露出 ×0.80..×3.00; 液体 0..500; 欲情 0..500
 *   - 受虐狂 → 露出 ×2.50, 液体 ×1.20, 欲情 ×1.20 (ERB 79-83)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 16-17) — BASE:MASTER:TSP -= 10. Decided
 *     upstream of @COM21.
 *   - TCVAR:116 = -1 (ERB 10) — "no actor" marker.
 *   - TCVAR:301 会話累積 (SIF for comf23 — irrelevant here).
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import { BASE_ID, SOURCE_ID, TALENT_ID } from "../../../state/settlement.js";
// NOTE: SOURCE_ID.液体 = 9 (source.als). An earlier port hardcoded `14`
// here, which is SOURCE 恐怖 — a real settlement bug (fluid leaked into the
// fear PALAM). Fixed to use the enum.
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** ABL id 15 — 受虐属性. */
const ABL_GYAKUTAI = 15;

/** 受虐属性 → (露出倍率, 液体加算, 欲情加算) — ERB 32-76 10 arms. */
const GYAKUTAI_TABLE: ReadonlyArray<{
  rosMul: number;
  ekitai: number;
  yokujo: number;
}> = [
  { rosMul: 0.8, ekitai: 0, yokujo: 0 }, // CASE 0
  { rosMul: 1.0, ekitai: 20, yokujo: 30 }, // CASE 1
  { rosMul: 1.2, ekitai: 40, yokujo: 70 }, // CASE 2
  { rosMul: 1.4, ekitai: 70, yokujo: 120 }, // CASE 3
  { rosMul: 1.5, ekitai: 110, yokujo: 180 }, // CASE 4
  { rosMul: 1.7, ekitai: 150, yokujo: 250 }, // CASE 5
  { rosMul: 1.9, ekitai: 200, yokujo: 300 }, // CASE 6
  { rosMul: 2.1, ekitai: 250, yokujo: 350 }, // CASE 7
  { rosMul: 2.3, ekitai: 300, yokujo: 400 }, // CASE 8
  { rosMul: 2.5, ekitai: 350, yokujo: 450 }, // CASE 9
  // CASEELSE (>=10) — handled separately.
];

export const comf21Def: ComfDef = {
  commandNo: 21,
  label: "何もしない",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 10 },

  buildSources: (c) => {
    // ERB 22-24: base.
    const jouai = 10;
    let roshutsu = 10;
    const itsudev = 10;

    // ERB 31-76: 受虐属性 bracket.
    const gyakutai = c.tAbl(ABL_GYAKUTAI);
    let ekitaiAdd = 0;
    let yokujoAdd = 0;
    let rosMul: number;
    if (gyakutai >= 0 && gyakutai <= 9) {
      const row = GYAKUTAI_TABLE[gyakutai]!;
      rosMul = row.rosMul;
      ekitaiAdd = row.ekitai;
      yokujoAdd = row.yokujo;
    } else {
      // CASEELSE (>=10): ×3.00, 500, 500.
      rosMul = 3.0;
      ekitaiAdd = 500;
      yokujoAdd = 500;
    }
    roshutsu = Math.trunc(roshutsu * rosMul);

    // ERB 79-83: 受虐狂 multipliers.
    if (c.tTalent(TALENT_ID.受虐狂) !== 0) {
      roshutsu = Math.trunc(roshutsu * 2.5);
      ekitaiAdd = Math.trunc(ekitaiAdd * 1.2);
      yokujoAdd = Math.trunc(yokujoAdd * 1.2);
    }

    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
    };
    if (ekitaiAdd) sources[SOURCE_ID.液体] = ekitaiAdd;
    if (yokujoAdd) sources[SOURCE_ID.欲情] = yokujoAdd;
    return sources;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 什么都没做；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf21HandlerEntry: HandlerEntry = makeComfHandler(comf21Def);
