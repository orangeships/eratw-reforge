/**
 * Phase 7 — `COMF749 乳首ローター(慰)` (nipple-rotor self-use, master-only).
 *
 * Ports the **normal-mode core** of `@COM749`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF749 乳首ローター(慰).ERB`).
 *
 * **Self/auto family sibling** (700 自慰系). Master only. No target.
 *
 * **Faithful normal-mode core (ERB 18-42):**
 *   - DOWNBASE: master 体力 10 / 気力 80 (ERB 21-22)
 *   - SOURCE master: 快Ｂ 250, 露出 20, 逸脱 30, 反感 30 (ERB 24-27)
 *   - 鬱屈 +30 if 自己愛<0 || 抵抗 (ERB 32-33)
 *   - body: 道具使用経験 PLAYER++, 自慰过了 PLAYER++
 *     (ERB 40-41), TIME += 5 (ERB 37-38).
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 15) — display marker.
 *   - ITEM:0 / TEQUIP:17,24 / 上半身着衣 ABLE gates (ERB 56-67) — ABLE.
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
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE749` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, TEQUIP:24 乳房電極.
 */
const com749Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 0)) return block("需要持有跳蛋。");
  // 上半身着衣: (TEQUIP:1 & 2) && TEQUIP:3 == 0 → 挡住乳房.
  if (
    (readTequip(ctx.state.master, TEQUIP_ID.上半身着衣状況) & 2) !== 0 &&
    readTequip(ctx.state.master, TEQUIP_ID.上半身裸露状態) === 0
  ) {
    return block("上半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.搾乳機)) {
    return block("搾乳機使用中无法使用。");
  }
  return { ok: true };
};

export const comf749Def: ComfDef = {
  commandNo: 749,
  label: "乳首ローター(慰)",

  requiresItem: 0,

  canExecute: com749Check,
  hModeMenuCheck: com749Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,

  requiresTarget: false,
  settleSourcesOnMaster: true,

  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 250,
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
    `%CALLNAME:MASTER% 对自己使用了乳头跳蛋 — 乳首ローター(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf749HandlerEntry: HandlerEntry = makeComfHandler(comf749Def);
