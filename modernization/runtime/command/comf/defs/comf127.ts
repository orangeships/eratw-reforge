/**
 * Phase 7 — `COMF127 Ａパールを入れられる` (anal beads inserted into master),
 * as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM127`
 * (`ERB/コマンド関連/COMF/COMF127 Ａパールを入れられる.ERB`).
 *
 * **Oral/hand family.** Target inserts anal beads into the master.
 * Master receives 快Ａ 200; target takes heavy 征服 (800) and moderate
 * 性行動 (300), 達成 (200), 不潔 (200), 反感 (100) with a large 鬱屈
 * penalty for self-loving or resistant targets. Substantial target BASE
 * drain (体力 100 / 気力 150).
 *
 * **Faithful normal-mode core (ERB 23-37):**
 *   - target DOWNBASE: 体力 100 / 気力 150 (ERB 23-24)
 *   - master SOURCE: 快Ａ = 200 (ERB 25)
 *   - target SOURCE: 性行動 300, 達成 200, 征服 800, 不潔 200, 反感 100
 *     (ERB 26-36)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗 (ERB 33-35)
 *   - STAIN 汚れ移動 (ERB 44-45): target 手 ⇔ master Ａ (mutual OR).
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 16-21) — TSP drain, different SOURCE values.
 *   - HETEROSEX EXP writes (ERB 37) — gender-pair helper deferred.
 *   - PEARL_INSERT call (ERB 22) — external procedure; deferred.
 *   - STR text marker (ERB 20) — H-scene chaining system deferred.
 *   - TFLAG interaction (ERB 32) — TFLAG state deferred.
 *   - COM_ABLE127 success-rate calculation — COMABLE layer.
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
import { STAIN_PART } from "../../../state/stain.js";
import { finishTrainingSession } from "../../training-session.js";

export const comf127Def: ComfDef = {
  commandNo: 127,
  label: "Ａパールを入れられる",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Target DOWNBASE uses the shared resource preflight.
  downbase: {},
  targetDownbase: { [BASE_ID.体力]: 100, [BASE_ID.気力]: 150 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.達成]: 200,
      [SOURCE_ID.征服]: 800,
      [SOURCE_ID.不潔]: 200,
      [SOURCE_ID.反感]: 100,
    };

    // ERB 33-35: 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // ERB 25: master SOURCE:PLAYER:快Ａ = 200.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ａ]: 200,
  }),

  body: (c) => {
    // A珠 is an in-session action. H cleanup belongs only to the explicit
    // escape/end commands; keeping this state is required for follow-up acts.
    // ERB 44-45: 汚れ移動 — target 手 ⇔ master Ａ (mutual OR).
    const t1 = c.t.state.STAIN[STAIN_PART.手] ?? 0;
    const ma = c.master.state.STAIN[STAIN_PART.Ａ] ?? 0;
    c.t.state.STAIN[STAIN_PART.手] = t1 | ma;
    c.master.state.STAIN[STAIN_PART.Ａ] = ma | t1;

  },

  // COM127 ends with ENDUFUFU_ALL. Close only after this action's SOURCE and
  // dialogue have settled, so any new edging is cleared with the old balance.
  afterSettlement: (c) => finishTrainingSession(c.next, "exit-command") > 0
    ? "训练结束，未吸收的寸止积累已清除。"
    : undefined,

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% %CALLNAME:TARGET%把肛门拉珠塞入了%CALLNAME:MASTER%体内 — Ａパールを入れられる；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf127HandlerEntry: HandlerEntry = makeComfHandler(comf127Def);
