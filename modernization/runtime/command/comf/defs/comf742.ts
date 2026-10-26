/**
 * Phase 7 — COMF742 クリキャップ(慰) (self-pleasure clit cap, toggle).
 * ERB ref: COMF742.ERB
 * DEFERRED: TEQUIP toggle (陰蒂夾), EQUIP_COM742 continuation.
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
 * `@COM_ABLE742` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 技巧<3 gate, TEQUIP:32 淋浴中.
 */
const com742Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除臂: 已装备时显示以便取下 (上游 SIF TEQUIP:11 → RETURN 1).
  if (isEquipped(ctx.state.master, TEQUIP_ID.陰蒂夾)) return { ok: true };
  if (!hasItem(ctx.state, 2)) return block("需要持有阴蒂夹。");
  if (readTequip(ctx.state.master, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("下半身衣着妨碍了动作。");
  }
  // 男人や扶她はダメ (HAS_PENIS(TARGET) → RETURN 0).
  if ((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) {
    return block("男性/扶她无法使用。");
  }
  return { ok: true };
};

export const comf742Def: ComfDef = {
  commandNo: 742,
  label: "クリキャップ(慰)",

  requiresItem: 2,

  canExecute: com742Check,
  hModeMenuCheck: com742Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 5,
  requiresTarget: false,
  settleSourcesOnMaster: true,
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
    `%CALLNAME:MASTER% 给自己戴上了阴蒂帽 — クリキャップ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf742HandlerEntry: HandlerEntry = makeComfHandler(comf742Def);
