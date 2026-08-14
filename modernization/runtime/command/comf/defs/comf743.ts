/**
 * Phase 7 — COMF743 オナホール(慰) (self-pleasure onahole, toggle).
 * ERB ref: COMF743.ERB
 * DEFERRED: TEQUIP toggle (飛機杯), CSTR ops, TCVAR ops, EQUIP_COM743 continuation.
 * Modeled: INITIAL activation only — the toggle's continuation arm is deferred.
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
 * `@COM_ABLE743` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 技巧<3 gate.
 */
const com743Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:12 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.飛機杯)) return { ok: true };
  if (!hasItem(ctx.state, 3)) return block("需要持有飞机杯。");
  // 男人や扶她じゃないとダメ (HAS_PENIS(TARGET) 必须有阴茎).
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return block("需要拥有阴茎。");
  }
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("下半身衣着妨碍了动作。");
  }
  if (isEquipped(ctx.state.master, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法使用。");
  }
  return { ok: true };
};

export const comf743Def: ComfDef = {
  commandNo: 743,
  label: "オナホール(慰)",

  requiresItem: 3,

  canExecute: com743Check,
  hModeMenuCheck: com743Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 5,
  requiresTarget: false,
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },
  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 200,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: 30,
      [SOURCE_ID.反感]: 30,
    };
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
    c.master.state.CFLAG[347] = (c.master.state.CFLAG[347] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.道具使用経験] = (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },
  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了飞机杯 — オナホール(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf743HandlerEntry: HandlerEntry = makeComfHandler(comf743Def);
