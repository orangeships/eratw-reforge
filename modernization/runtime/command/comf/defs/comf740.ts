/**
 * Phase 7 — `COMF740 ローター(慰)` (rotor self-use, master-only).
 *
 * Ports the **normal-mode core** of `@COM740`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF740 ローター(慰).ERB`).
 *
 * **Self/auto family sibling** (700 自慰系). Master only. No target.
 *
 * **Faithful normal-mode core (ERB 17-43):**
 *   - DOWNBASE: master 体力 10 / 気力 80 (ERB 21-22)
 *   - SOURCE master: 快Ｃ 250, 露出 20, 逸脱 30, 反感 30 (ERB 24-27)
 *   - 鬱屈 +30 if 自己愛<0 || 抵抗 (ERB 32-33)
 *   - body: 道具使用経験 PLAYER++, 自慰过了 PLAYER++
 *     (ERB 40-42), TIME += 5 (ERB 37-38).
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 14) — display marker.
 *   - TEQUIP-touch setters (ERB 67-73) — TOUCH handler deferred.
 *
 * **Gate (P1-14):** `@COM_ABLE740` — hasItem(0) 跳蛋 + 下半身着衣 bit8 (TEQUIP:0);
 *   deferred TFLAG:100 / GLOBAL_COMABLE / NOITEM.
 *
 * **TIME += 5** (ERB 37-38). Modeled as `timeCost: 5`.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { hasItem } from "../../../state/items.js";
import { readTequip } from "../../../state/tequip.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE740` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, NOITEM 道具無設定 debug mode.
 */
const com740Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 0)) return block("需要持有跳蛋。");
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) & 8) {
    return block("下半身衣着妨碍了动作。");
  }
  return { ok: true };
};

export const comf740Def: ComfDef = {
  commandNo: 740,
  label: "ローター(慰)",

  requiresItem: 0,

  canExecute: com740Check,
  hModeMenuCheck: com740Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,

  requiresTarget: false,

  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 250,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: 30,
      [SOURCE_ID.反感]: 30,
    };

    if (
      (c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
        c.master.state.TALENT[TALENT_ID.自己愛] < 0) ||
      c.master.state.TALENT[TALENT_ID.抵抗]
    ) {
      sources[SOURCE_ID.鬱屈] = 30;
    }

    return sources;
  },

  body: (c) => {
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了跳蛋 — ローター(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf740HandlerEntry: HandlerEntry = makeComfHandler(comf740Def);
