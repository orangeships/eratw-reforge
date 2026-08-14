/**
 * Phase 7 — `COMF751 自慰終了` (self-pleasure exit / state-machine cleanup), as a `ComfDef`.
 *
 * Ports the core of `@COM751` (`ERB/コマンド関連/COMF/700 自慰系/COMF751 自慰終了.ERB`).
 *
 * **Self/auto family exit gate (自慰系).** This is NOT a typical SOURCE-producing command.
 * It is a cleanup/exit: resets equipment, clothing, and grants EXP:自慰経験 if the
 * player masturbated during this session.
 *
 * **Faithful ported core (ERB lines 67-71):**
 *   - TIME += 5 if !時間停止 (ERB 66-67)
 *   - If CFLAG:自慰过了 > 0: EXP:自慰経験++ (ERB 69-70)
 *   - CFLAG:自慰过了 = 0 (ERB 71)
 *   - NO downbase, NO SOURCE additions (the ERB has none in the main block)
 *
 * **DEFERRED (massive):**
 *   - TEQUIP reset (ERB 24: VARSET TEQUIP:PLAYER:0,0,10,150 — clears equipment slots 10-149)
 *   - 射精関係リセット (ERB 27-30)
 *   - CFLAG:现在忙得抽不出手, TEQUIP:50/51, 上半身裸露状態, 强行, TFLAG:運搬 (ERB 31-38)
 *   - 精液 cleanup text + CFLAG resets (ERB 39-56)
 *   - TEQUIP:吸乳头自慰/揉胸自慰, TFLAG:106, はだけフラグ (ERB 57-62)
 *   - CLOTHES_SETTING_TRAIN (ERB 63)
 *   - 上衣脱衣完毕フラグ (ERB 65)
 *   - Clothing SET branch (ERB 6-17): time-stop / 恶作剧 / 睡衣/便装 set
 *
 * Only the EXP grant + CFLAG reset is ported as the minimal faithful core.
 */
import type { HandlerEntry } from "../../types.js";
import { EXP_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

export const comf751Def: ComfDef = {
  commandNo: 751,
  label: "自慰終了",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,
  requiresTarget: false,

  // No downbase in ERB 751.
  downbase: {},

  // No SOURCE additions in ERB 751 — this is a cleanup command.
  buildSources: (_c) => ({}),

  body: (c) => {
    // ERB 69-70: if 自慰过了 > 0, grant EXP:自慰経験 and reset.
    const mastCount = c.master.state.CFLAG[347] ?? 0;
    if (mastCount > 0) {
      c.master.state.EXP[EXP_ID.自慰経験] =
        (c.master.state.EXP[EXP_ID.自慰経験] ?? 0) + 1;
      c.master.state.CFLAG[347] = 0;
    }
  },

  narration: (_c, _favorDelta) =>
    `%CALLNAME:MASTER% 结束了自慰 — 自慰終了.`,
};

export const comf751HandlerEntry: HandlerEntry = makeComfHandler(comf751Def);
