/**
 * Phase 7 — `COMF748 搾乳機(慰)` (self-pleasure milking machine), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM748` (`ERB/コマンド関連/COMF/700 自慰系/COMF748 搾乳機(慰).ERB`).
 *
 * **Self/auto toy family (自慰系 740-749).** Toggle command (TEQUIP:PLAYER:搾乳機).
 * We model the INITIAL activation (equipping) only.
 *
 * **Faithful normal-mode core (ERB lines 17-43):**
 *   - DOWNBASE: master 体力 50 / 気力 100 (ERB 18-19)
 *   - SOURCE master: 快Ｂ 200, 苦痛 100, 露出 30, 屈従 100, 逸脱 100, 反感 100 (ERB 21-26)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 31-33)
 *   - Body: 自慰过了 PLAYER++, 道具使用経験 PLAYER++ (ERB 40-41)
 *
 * **DEFERRED:**
 *   - TEQUIP toggle management (着脱, ERB 7)
 *   - EQUIP_COM748 continuation effects (ERB 47-63)
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
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
import { roomProps } from "../../comable/room-props.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE748` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 技巧<3 gate, TEQUIP:24 乳房電極,
 * TEQUIP:32 淋浴中.
 */
const com748Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:17 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.搾乳機)) return { ok: true };
  if (!hasItem(ctx.state, 11)) return block("需要持有搾乳機。");
  // 母乳体質でないと使えない (TALENT:母乳体質 == 0 → RETURN 0).
  if ((ctx.state.master.state.TALENT[TALENT_ID.母乳体質] ?? 0) === 0) {
    return block("没有母乳体质。");
  }
  // 男人だとダメ (!(TALENT:性別 & 1) → RETURN 0) — 需女性/扶她.
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("男性无法使用。");
  }
  // Ｂ感覚2以下はダメ (ABL:B感覚 <= 2 → RETURN 0).
  if ((ctx.state.master.state.ABL[ABL_ID.Ｂ感覚] ?? 0) <= 2) {
    return block("胸部敏感度不足。");
  }
  if (readTequip(ctx.state.master, TEQUIP_ID.上半身着衣状況) > 1) {
    return block("上半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.乳頭夾)) {
    return block("乳头夹使用中无法使用。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法使用。");
  }
  // !BEDROOM(現在位置) → 近似 roomProps().private (comf23 同款).
  if (!roomProps(ctx.state.master.location).private) {
    return block("需要回到卧室/床铺附近。");
  }
  return { ok: true };
};

export const comf748Def: ComfDef = {
  commandNo: 748,
  label: "搾乳機(慰)",

  requiresItem: 11,

  canExecute: com748Check,
  hModeMenuCheck: com748Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,
  requiresTarget: false,

  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 200,
      [SOURCE_ID.苦痛]: 100,
      [SOURCE_ID.露出]: 30,
      [SOURCE_ID.屈従]: 100,
      [SOURCE_ID.逸脱]: 100,
      [SOURCE_ID.反感]: 100,
    };

    // ERB 31-33: 鬱屈 +100 if 自己愛<0 || 抵抗.
    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 100;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 100;
    }

    return sources;
  },

  body: (c) => {
    // ERB 40: 自慰过了 PLAYER++.
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    // ERB 41: 道具使用経験 PLAYER++.
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了榨乳机 — 搾乳機(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf748HandlerEntry: HandlerEntry = makeComfHandler(comf748Def);
