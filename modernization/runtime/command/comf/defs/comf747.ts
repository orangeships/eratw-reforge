/**
 * Phase 7 — `COMF747 ニプルキャップ(慰)` (self-pleasure nipple caps), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM747` (`ERB/コマンド関連/COMF/700 自慰系/COMF747 ニプルキャップ(慰).ERB`).
 *
 * **Self/auto toy family (自慰系 740-749).** Toggle command (TEQUIP:PLAYER:乳頭夾).
 * We model the INITIAL activation (equipping) only.
 *
 * **Faithful normal-mode core (ERB lines 17-43):**
 *   - DOWNBASE: master 体力 10 / 気力 80 (ERB 18-19)
 *   - SOURCE master: 快Ｂ 200, 露出 20, 逸脱 30, 反感 30 (ERB 21-24)
 *   - 鬱屈 +30 if 自己愛<0 || 抵抗 (ERB 31-32)
 *   - Body: 自慰过了 PLAYER++, 道具使用経験 PLAYER++ (ERB 39,41)
 *
 * **DEFERRED:**
 *   - TEQUIP toggle management (着脱, ERB 7)
 *   - EQUIP_COM747 continuation effects (ERB 47-61)
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
 * `@COM_ABLE747` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 技巧<3 gate, TEQUIP:24 乳房電極,
 * TEQUIP:32 淋浴中.
 */
const com747Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:16 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.乳頭夾)) return { ok: true };
  if (!hasItem(ctx.state, 10)) return block("需要持有乳头夹。");
  if (readTequip(ctx.state.master, TEQUIP_ID.上半身着衣状況) > 1) {
    return block("上半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.搾乳機)) {
    return block("搾乳機使用中无法使用。");
  }
  return { ok: true };
};

export const comf747Def: ComfDef = {
  commandNo: 747,
  label: "ニプルキャップ(慰)",

  requiresItem: 10,

  canExecute: com747Check,
  hModeMenuCheck: com747Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,
  requiresTarget: false,
  settleSourcesOnMaster: true,

  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 200,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: 30,
      [SOURCE_ID.反感]: 30,
    };

    // ERB 31-32: 鬱屈 +30 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 30;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 30;
    }

    return sources;
  },

  body: (c) => {
    // ERB 39: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 41: 道具使用経験 PLAYER++.
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给自己戴上了乳头夹 — ニプルキャップ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf747HandlerEntry: HandlerEntry = makeComfHandler(comf747Def);
