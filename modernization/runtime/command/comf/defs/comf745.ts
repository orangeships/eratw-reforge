/**
 * Phase 7 — COMF745 アナルバイブ(慰) (self-pleasure anal vibrator, toggle).
 * ERB ref: COMF745.ERB
 * DEFERRED: TEQUIP toggle (肛用振動棒), STAIN ops, PAIN_CHECK_A, EQUIP_COM745 continuation.
 * Modeled: INITIAL activation only.
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
 * `@COM_ABLE745` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 潤滑/従順 gate, TEQUIP:21/22/23
 * (浣腸/バルーン/電極 使用中).
 */
const com745Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:14 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.肛用振動棒)) return { ok: true };
  if (!hasItem(ctx.state, 5)) return block("需要持有肛用振动棒。");
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("下半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.後庭拉珠)) {
    return block("后庭拉珠使用中无法使用。");
  }
  return { ok: true };
};

export const comf745Def: ComfDef = {
  commandNo: 745,
  label: "アナルバイブ(慰)",

  requiresItem: 5,

  canExecute: com745Check,
  hModeMenuCheck: com745Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 5,
  requiresTarget: false,
  settleSourcesOnMaster: true,
  downbase: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 150 },
  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: 250,
      [SOURCE_ID.苦痛]: 250,
      [SOURCE_ID.露出]: 50,
      [SOURCE_ID.屈従]: 50,
      [SOURCE_ID.逸脱]: 50,
      [SOURCE_ID.反感]: 200,
    };

    if (
      c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
      c.master.state.TALENT[TALENT_ID.自己愛] < 0
    ) {
      sources[SOURCE_ID.鬱屈] = 70;
    } else if (c.master.state.TALENT[TALENT_ID.抵抗]) {
      sources[SOURCE_ID.鬱屈] = 70;
    }

    return sources;
  },
  body: (c) => {
    c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.道具使用経験] = (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.Ａ経験] = (c.master.state.EXP[EXP_ID.Ａ経験] ?? 0) + 1;
  },
  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了肛门振动棒 — アナルバイブ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf745HandlerEntry: HandlerEntry = makeComfHandler(comf745Def);
