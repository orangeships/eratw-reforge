/**
 * Phase 7 (Wave 4c) — `COMF22 誘い受ける` (invite / seduce), as a `ComfDef`.
 *
 * Ports the **core** of `@COM22` (`ERB/コマンド関連/COMF/COMF22 誘い受ける.ERB`).
 * A master-initiated seduction: the MASTER produces 露出/液体/欲情 scaled by
 * the master's own 受虐属性 (masochism), the target gets a small 露出.
 *
 * **Faithful core (ERB body):**
 *   - DOWNBASE target 気力 30 (bare = TARGET).
 *   - SOURCE target: 露出 100.
 *   - SOURCE:PLAYER:露出 = 200, then ABL:PLAYER:受虐属性 SELECTCASE:
 *       露出 ×{0.8,1.0,1.2,1.4,1.5,1.7,1.9,2.1,2.3,2.5, else 3.0} by level 0..9/≥10,
 *       液体 += {0,20,40,70,110,150,200,250,300,350, else 500},
 *       欲情 += {0,30,70,120,180,250,300,350,400,450, else 500}.
 *   - 受虐狂 TALENT: 露出 ×2.5, 液体 ×1.2, 欲情 ×1.2.
 *
 * **DEFERRED:** TCVAR:116 = -1 marker; COMABLE gate (TFLAG:100, 恶作剧,
 * time-stop). No target SOURCE settlement beyond 露出 100.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** ABL:受虐属性 → [露出Mul, 液体Add, 欲情Add] (ERB SELECTCASE 0..9 / else). */
const MASO_TABLE: ReadonlyArray<[number, number, number]> = [
  [0.8, 0, 0],
  [1.0, 20, 30],
  [1.2, 40, 70],
  [1.4, 70, 120],
  [1.5, 110, 180],
  [1.7, 150, 250],
  [1.9, 200, 300],
  [2.1, 250, 350],
  [2.3, 300, 400],
  [2.5, 350, 450],
];
const MASO_ELSE: [number, number, number] = [3.0, 500, 500];

export const comf22Def: ComfDef = {
  commandNo: 22,
  label: "誘い受ける",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,
  targetDownbase: { [BASE_ID.気力]: 30 },

  // Target gets only a small 露出.
  buildSources: (): Record<number, number> => ({
    [SOURCE_ID.露出]: 100,
  }),

  // Master produces 露出/液体/欲情 by the master's own 受虐属性.
  buildMasterSources: (c): Record<number, number> => {
    const maso = c.mAbl(ABL_ID.受虐属性);
    const [mul, ekitaiAdd, yokujouAdd] =
      maso >= 0 && maso <= 9 ? MASO_TABLE[maso]! : MASO_ELSE;
    let roshutsu = Math.trunc(200 * mul);
    let ekitai = ekitaiAdd;
    let yokujou = yokujouAdd;
    // 受虐狂 TALENT (master): 露出 ×2.5, 液体 ×1.2, 欲情 ×1.2.
    if (c.master.state.TALENT[TALENT_ID.受虐狂]) {
      roshutsu = Math.trunc(roshutsu * 2.5);
      ekitai = Math.trunc(ekitai * 1.2);
      yokujou = Math.trunc(yokujou * 1.2);
    }
    return {
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.液体]: ekitai,
      [SOURCE_ID.欲情]: yokujou,
    };
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 接受了%CALLNAME:TARGET%的邀请 — 誘い受ける；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf22HandlerEntry: HandlerEntry = makeComfHandler(comf22Def);
