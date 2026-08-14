/**
 * Phase 7 — `COMF123 足コキする` (give footjob to target), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM123`
 * (`ERB/コマンド関連/COMF/COMF123 足コキする.ERB`).
 *
 * **Oral/hand family.** Master gives a footjob to the target. Target
 * receives substantial 快Ｃ (250), 達成 (200), 露出 (300), 屈従 (300),
 * 逸脱 (350), and 反感 (350). No master SOURCE is produced (master is
 * the actor but no SOURCE:PLAYER writes). No EXP with existing IDs.
 *
 * **Faithful normal-mode core (ERB 26-42):**
 *   - target DOWNBASE: 体力 30 / 気力 150 (ERB 26-27)
 *   - target SOURCE: 快Ｃ 250, 達成 200, 露出 300, 屈従 300, 逸脱 350,
 *     反感 350 (ERB 28-35)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗 (ERB 36-38)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 22-25) — TSP drain, different SOURCE values.
 *   - 不潔 SOURCE calculation (ERB 39) — depends on STAIN state.
 *   - HETEROSEX EXP writes (ERB 40) — gender-pair helper deferred.
 *   - SOURCE:液体 (ERB 41) — no SOURCE_ID; deferred.
 *   - 受虐属性 scaling block (達成/屈従/液体/欲情 ×受虐属性 TIMES +
 *     液体/欲情 flat adds) (ERB 42) — extensive ABL-gated multiplier
 *     block deferred. Also 受虐狂/倒錯的 TALENT modifiers deferred.
 *   - COM_ABLE123 success-rate calculation — COMABLE layer.
 *   - TCVAR markers — H-scene chaining deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf123Def: ComfDef = {
  commandNo: 123,
  label: "足コキする",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 250,
      [SOURCE_ID.達成]: 200,
      [SOURCE_ID.露出]: 300,
      [SOURCE_ID.屈従]: 300,
      [SOURCE_ID.逸脱]: 350,
      [SOURCE_ID.反感]: 350,
    };

    // ERB 36-38: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // No master SOURCE — master is the actor but no SOURCE:PLAYER writes
  // (ERB has no SOURCE:PLAYER block for 足コキ).

  body: (c) => {
    // ERB 26-27: target 体力 30 / 気力 150 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 30;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 150;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 为%CALLNAME:TARGET%足交 — 足コキ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf123HandlerEntry: HandlerEntry = makeComfHandler(comf123Def);
